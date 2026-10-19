-- Task assignment alerts, unread task badges, and live updates when an event is hidden from someone.
-- Run this after 20261019140000_task_assignee_notes.sql.

-- Task reads ------------------------------------------------------------------
--
-- A task is unread for its assignee until they open it. Assigning a task to someone else clears
-- their read row (so it counts as new again); assigning it to yourself marks it read.

create table if not exists public.leaddesk_task_reads (
  user_id uuid not null references public.profiles (id) on delete cascade,
  task_id uuid not null references public.leaddesk_tasks (id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (user_id, task_id)
);

alter table public.leaddesk_task_reads enable row level security;

drop policy if exists "Users read their task reads" on public.leaddesk_task_reads;
create policy "Users read their task reads" on public.leaddesk_task_reads
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "Users add their task reads" on public.leaddesk_task_reads;
create policy "Users add their task reads" on public.leaddesk_task_reads
  for insert to authenticated with check (user_id = auth.uid());

-- Start with existing assigned tasks already read, so the first badge is not every task.
insert into public.leaddesk_task_reads (user_id, task_id)
select t.assignee_id, t.id
from public.leaddesk_tasks t
where t.assignee_id is not null
  and exists (select 1 from public.profiles p where p.id = t.assignee_id)
on conflict do nothing;

-- Task notifications ----------------------------------------------------------

alter table public.leaddesk_notifications
  add column if not exists task_id uuid references public.leaddesk_tasks (id) on delete cascade;

alter table public.leaddesk_notifications
  drop constraint if exists leaddesk_notifications_kind_check;
alter table public.leaddesk_notifications
  add constraint leaddesk_notifications_kind_check check (kind in ('event_added', 'task_assigned'));

create or replace function public.notify_leaddesk_task_assignee()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := coalesce(auth.uid(), new.created_by);
begin
  if new.assignee_id is null
    or (tg_op = 'UPDATE' and new.assignee_id is not distinct from old.assignee_id)
    or not exists (select 1 from public.profiles p where p.id = new.assignee_id) then
    return new;
  end if;

  if new.assignee_id = actor then
    insert into public.leaddesk_task_reads (user_id, task_id)
    values (new.assignee_id, new.id)
    on conflict do nothing;
    return new;
  end if;

  delete from public.leaddesk_task_reads
  where user_id = new.assignee_id
    and task_id = new.id;

  insert into public.leaddesk_notifications (user_id, task_id, kind, title)
  values (new.assignee_id, new.id, 'task_assigned', new.title);

  return new;
end;
$$;

revoke all on function public.notify_leaddesk_task_assignee() from public, anon, authenticated;

drop trigger if exists notify_leaddesk_task_assignee on public.leaddesk_tasks;
create trigger notify_leaddesk_task_assignee
  after insert or update of assignee_id on public.leaddesk_tasks
  for each row execute function public.notify_leaddesk_task_assignee();

-- Desk signals ----------------------------------------------------------------
--
-- Realtime only sends a change to people who can still read the row afterwards, so someone who
-- loses access to an event (it became participants-only, or they were removed) never hears about
-- it. Each such change adds a row here, which every leader can read, and the app reloads on it.

create table if not exists public.leaddesk_signals (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now()
);

alter table public.leaddesk_signals enable row level security;

drop policy if exists "Leaders read desk signals" on public.leaddesk_signals;
create policy "Leaders read desk signals" on public.leaddesk_signals
  for select to authenticated using (public.is_leader() or public.is_admin());

create or replace function public.signal_leaddesk_access_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.visibility is distinct from old.visibility
    or new.participant_ids is distinct from old.participant_ids
    or new.created_by is distinct from old.created_by then
    insert into public.leaddesk_signals default values;
    -- Signals are only needed for a moment; keep the table small.
    delete from public.leaddesk_signals where created_at < now() - interval '1 day';
  end if;
  return new;
end;
$$;

revoke all on function public.signal_leaddesk_access_change() from public, anon, authenticated;

drop trigger if exists signal_leaddesk_access_change on public.leaddesk_events;
create trigger signal_leaddesk_access_change
  after update on public.leaddesk_events
  for each row execute function public.signal_leaddesk_access_change();

do $$
begin
  alter publication supabase_realtime add table public.leaddesk_signals;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
