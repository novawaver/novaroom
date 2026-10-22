-- Several assignees per LeadDesk task. Run this after 20261021130000_table_grants.sql.
--
-- assignee_ids holds everyone the task is assigned to. assignee_id stays for older app versions:
-- it always mirrors the first entry of assignee_ids, and when an older app changes assignee_id the
-- first entry is swapped for the new person (or removed for "No one"), leaving the others alone.
-- That also covers a deleted profile, where the foreign key sets assignee_id to null.

alter table public.leaddesk_tasks
  add column if not exists assignee_ids uuid[] not null default '{}';

alter table public.leaddesk_tasks
  drop constraint if exists leaddesk_tasks_assignee_ids_check;
alter table public.leaddesk_tasks
  add constraint leaddesk_tasks_assignee_ids_check check (cardinality(assignee_ids) <= 100);

update public.leaddesk_tasks
set assignee_ids = array[assignee_id]
where assignee_id is not null
  and cardinality(assignee_ids) = 0;

create or replace function public.sync_task_assignees()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if cardinality(new.assignee_ids) = 0 and new.assignee_id is not null then
      new.assignee_ids := array[new.assignee_id];
    end if;
  elsif new.assignee_ids is not distinct from old.assignee_ids
    and new.assignee_id is distinct from old.assignee_id then
    if old.assignee_id is null then
      new.assignee_ids := array_prepend(new.assignee_id, new.assignee_ids);
    elsif new.assignee_id is null then
      new.assignee_ids := array_remove(new.assignee_ids, old.assignee_id);
    else
      new.assignee_ids := array_replace(new.assignee_ids, old.assignee_id, new.assignee_id);
    end if;
  end if;

  -- No nulls or repeats, first appearance wins.
  new.assignee_ids := coalesce(
    (
      select array_agg(person order by first_at)
      from (
        select person, min(ord) as first_at
        from unnest(new.assignee_ids) with ordinality as listed(person, ord)
        where person is not null
        group by person
      ) people
    ),
    '{}'
  );
  new.assignee_id := new.assignee_ids[1];
  return new;
end;
$$;

revoke all on function public.sync_task_assignees() from public, anon, authenticated;

drop trigger if exists leaddesk_tasks_assignees_sync on public.leaddesk_tasks;
create trigger leaddesk_tasks_assignees_sync
  before insert or update on public.leaddesk_tasks
  for each row execute function public.sync_task_assignees();

-- Any assignee (or an admin) may write the notes from the assignee.
create or replace function public.guard_task_assignee_notes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- No signed-in user means the SQL editor or another trusted backend.
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.assignee_notes := '';
    return new;
  end if;

  if new.assignee_notes is distinct from old.assignee_notes
    and not (auth.uid() = any(old.assignee_ids)) then
    raise exception 'Only an assignee can write notes from the assignee';
  end if;

  return new;
end;
$$;

-- Alert everyone newly added to a task. Adding yourself marks it read instead.
create or replace function public.notify_leaddesk_task_assignee()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := coalesce(auth.uid(), new.created_by);
  before_ids uuid[] := case when tg_op = 'UPDATE' then old.assignee_ids else '{}'::uuid[] end;
  person uuid;
begin
  for person in
    select added.person
    from unnest(new.assignee_ids) as added(person)
    where not (added.person = any(before_ids))
      and exists (select 1 from public.profiles p where p.id = added.person)
  loop
    if person = actor then
      insert into public.leaddesk_task_reads (user_id, task_id)
      values (person, new.id)
      on conflict do nothing;
    else
      delete from public.leaddesk_task_reads
      where user_id = person
        and task_id = new.id;

      insert into public.leaddesk_notifications (user_id, task_id, kind, title)
      values (person, new.id, 'task_assigned', new.title);
    end if;
  end loop;

  return new;
end;
$$;

revoke all on function public.notify_leaddesk_task_assignee() from public, anon, authenticated;

-- Newer apps set assignee_ids, older ones assignee_id.
drop trigger if exists notify_leaddesk_task_assignee on public.leaddesk_tasks;
create trigger notify_leaddesk_task_assignee
  after insert or update of assignee_ids, assignee_id on public.leaddesk_tasks
  for each row execute function public.notify_leaddesk_task_assignee();
