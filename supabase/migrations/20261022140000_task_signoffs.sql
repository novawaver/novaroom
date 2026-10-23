-- Task results signed by assignees, editing limited to people with the task permission, a "failed"
-- status, and who caused each LeadDesk notification. Run this after 20261022130000_read_receipts.sql.
--
-- Each assignee signs their own result: done or failed. A task becomes failed as soon as one of
-- them signs failed, and done once all of them have signed done. The task's creator is told.
--
-- Changing a task (title, description, status, priority, assignees, due date) or deleting one now
-- needs the same admin-granted permission as adding one (task_permissions.can_add_tasks), or being
-- an admin. Without it, an assignee can only write the notes from the assignee and sign a result.

-- Status ----------------------------------------------------------------------

alter table public.leaddesk_tasks
  drop constraint if exists leaddesk_tasks_status_check;
alter table public.leaddesk_tasks
  add constraint leaddesk_tasks_status_check check (status in ('todo', 'doing', 'done', 'failed'));

-- Who may edit ------------------------------------------------------------------

drop policy if exists "Leaders edit tasks" on public.leaddesk_tasks;
create policy "Leaders edit tasks" on public.leaddesk_tasks
  for update to authenticated
  using (public.may_add_task() or auth.uid() = any(assignee_ids))
  with check (public.is_leader());

drop policy if exists "Leaders delete tasks" on public.leaddesk_tasks;
create policy "Leaders delete tasks" on public.leaddesk_tasks
  for delete to authenticated using (public.may_add_task());

-- Assignees without the permission get through the policy above for their notes; this keeps them
-- to that. Changes made by other triggers (pg_trigger_depth() > 1), such as a deleted profile
-- clearing assignee_id, and status changes from sign_task are allowed.
create or replace function public.guard_task_edits()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null
    or pg_trigger_depth() > 1
    or current_setting('novaroom.task_signoff', true) = 'on'
    or public.is_admin()
    or public.may_add_task() then
    return new;
  end if;

  if (new.title, new.notes, new.status, new.priority, new.assignee_ids, new.assignee_id, new.due_date, new.created_by)
    is distinct from
    (old.title, old.notes, old.status, old.priority, old.assignee_ids, old.assignee_id, old.due_date, old.created_by) then
    raise exception 'You need an admin''s permission to edit tasks. You can still add notes and sign your result.';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_task_edits() from public, anon, authenticated;

-- Named to run after leaddesk_tasks_assignees_sync, which tidies the assignee list first.
drop trigger if exists leaddesk_tasks_guard_edits on public.leaddesk_tasks;
create trigger leaddesk_tasks_guard_edits
  before update on public.leaddesk_tasks
  for each row execute function public.guard_task_edits();

-- Sign-offs ---------------------------------------------------------------------

create table if not exists public.leaddesk_task_signoffs (
  task_id uuid not null references public.leaddesk_tasks (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  result text not null check (result in ('done', 'failed')),
  signed_at timestamptz not null default now(),
  primary key (task_id, user_id)
);

alter table public.leaddesk_task_signoffs enable row level security;

-- Everyone on LeadDesk can see results. They only change through sign_task.
drop policy if exists "Leaders read task signoffs" on public.leaddesk_task_signoffs;
create policy "Leaders read task signoffs" on public.leaddesk_task_signoffs
  for select to authenticated using (public.is_leader() or public.is_admin());

grant select on public.leaddesk_task_signoffs to anon;
grant select, insert, update, delete on public.leaddesk_task_signoffs to authenticated;

-- Someone taken off a task loses their result on it.
create or replace function public.drop_removed_signoffs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.leaddesk_task_signoffs s
  where s.task_id = new.id
    and not (s.user_id = any(new.assignee_ids));
  return new;
end;
$$;

revoke all on function public.drop_removed_signoffs() from public, anon, authenticated;

drop trigger if exists leaddesk_tasks_drop_removed_signoffs on public.leaddesk_tasks;
create trigger leaddesk_tasks_drop_removed_signoffs
  after update of assignee_ids, assignee_id on public.leaddesk_tasks
  for each row execute function public.drop_removed_signoffs();

-- Who caused a notification, so the app can show their picture. Rows are made by triggers running
-- as that person, so the default fills it in.
alter table public.leaddesk_notifications
  add column if not exists actor_id uuid references public.profiles (id) on delete set null default auth.uid();

alter table public.leaddesk_notifications
  drop constraint if exists leaddesk_notifications_kind_check;
alter table public.leaddesk_notifications
  add constraint leaddesk_notifications_kind_check
  check (kind in ('event_added', 'task_assigned', 'task_done', 'task_failed'));

-- Signs the signed-in assignee's result on a task: 'done', 'failed', or null to take it back.
create or replace function public.sign_task(task uuid, outcome text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.leaddesk_tasks;
  next_status text;
begin
  select * into t from public.leaddesk_tasks where id = task for update;
  if not found or not public.is_leader() or not (auth.uid() = any(t.assignee_ids)) then
    raise exception 'Only the task''s assignees can sign it.';
  end if;

  if outcome is null then
    delete from public.leaddesk_task_signoffs where task_id = task and user_id = auth.uid();
  elsif outcome in ('done', 'failed') then
    insert into public.leaddesk_task_signoffs (task_id, user_id, result)
    values (task, auth.uid(), outcome)
    on conflict (task_id, user_id) do update set result = excluded.result, signed_at = now();
  else
    raise exception 'A task is signed as done or failed.';
  end if;

  select case
    when exists (
      select 1 from public.leaddesk_task_signoffs s
      where s.task_id = task and s.result = 'failed' and s.user_id = any(t.assignee_ids)
    ) then 'failed'
    when not exists (
      select 1 from unnest(t.assignee_ids) as assigned(person)
      where not exists (
        select 1 from public.leaddesk_task_signoffs s
        where s.task_id = task and s.user_id = assigned.person and s.result = 'done'
      )
    ) then 'done'
    -- Taking back the result that finished the task puts it back in progress.
    when t.status in ('done', 'failed') then 'doing'
    else t.status
  end into next_status;

  if next_status is distinct from t.status then
    perform set_config('novaroom.task_signoff', 'on', true);
    update public.leaddesk_tasks set status = next_status, updated_at = now() where id = task;
    perform set_config('novaroom.task_signoff', 'off', true);
  end if;

  if outcome is not null
    and t.created_by is not null
    and t.created_by <> auth.uid()
    and exists (select 1 from public.profiles p where p.id = t.created_by) then
    insert into public.leaddesk_notifications (user_id, task_id, kind, title)
    values (t.created_by, task, 'task_' || outcome, t.title);
  end if;
end;
$$;

revoke all on function public.sign_task(uuid, text) from public, anon;
grant execute on function public.sign_task(uuid, text) to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.leaddesk_task_signoffs;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
