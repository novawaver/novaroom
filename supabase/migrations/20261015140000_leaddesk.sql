-- LeadDesk: tasks, schedule and notes shared by Leadership members only.
-- Run this after 20261015130000_admin.sql.

-- Only admins can give someone the Leadership role. People can still pick their other roles
-- themselves, and a leader can step down by choosing another role.
create or replace function public.guard_leadership_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Compare with the stored row rather than OLD: the app saves with an upsert, whose insert
  -- half runs this trigger first, and a leader re-saving their profile must keep the role.
  if new.role = 'Leadership'
     and auth.uid() is not null
     and not public.is_admin()
     and not exists (select 1 from public.profiles p where p.id = new.id and p.role = 'Leadership') then
    new.role := coalesce((select p.role from public.profiles p where p.id = new.id), '');
  end if;
  return new;
end;
$$;

drop trigger if exists guard_leadership_role on public.profiles;
create trigger guard_leadership_role
  before insert or update of role on public.profiles
  for each row execute function public.guard_leadership_role();

create or replace function public.is_leader()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'Leadership'
  );
$$;

revoke all on function public.is_leader() from public, anon;
grant execute on function public.is_leader() to authenticated;
revoke all on function public.guard_leadership_role() from public, anon, authenticated;

-- Tasks ----------------------------------------------------------------------

create table if not exists public.leaddesk_tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  notes text not null default '' check (char_length(notes) <= 2000),
  status text not null default 'todo' check (status in ('todo', 'doing', 'done')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  assignee_id uuid references public.profiles (id) on delete set null,
  due_date date,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists leaddesk_tasks_status_idx on public.leaddesk_tasks (status, due_date);

-- Schedule -------------------------------------------------------------------

create table if not exists public.leaddesk_events (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  notes text not null default '' check (char_length(notes) <= 2000),
  location text not null default '' check (char_length(location) <= 120),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  check (ends_at >= starts_at)
);

create index if not exists leaddesk_events_starts_idx on public.leaddesk_events (starts_at);

-- Notes ----------------------------------------------------------------------

create table if not exists public.leaddesk_notes (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  body text not null default '' check (char_length(body) <= 5000),
  pinned boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Access: every leader can read and change everything on LeadDesk. -----------

alter table public.leaddesk_tasks enable row level security;
alter table public.leaddesk_events enable row level security;
alter table public.leaddesk_notes enable row level security;

drop policy if exists "Leaders read tasks" on public.leaddesk_tasks;
create policy "Leaders read tasks" on public.leaddesk_tasks
  for select to authenticated using (public.is_leader());
drop policy if exists "Leaders add tasks" on public.leaddesk_tasks;
create policy "Leaders add tasks" on public.leaddesk_tasks
  for insert to authenticated with check (public.is_leader() and created_by = auth.uid());
drop policy if exists "Leaders edit tasks" on public.leaddesk_tasks;
create policy "Leaders edit tasks" on public.leaddesk_tasks
  for update to authenticated using (public.is_leader()) with check (public.is_leader());
drop policy if exists "Leaders delete tasks" on public.leaddesk_tasks;
create policy "Leaders delete tasks" on public.leaddesk_tasks
  for delete to authenticated using (public.is_leader());

drop policy if exists "Leaders read events" on public.leaddesk_events;
create policy "Leaders read events" on public.leaddesk_events
  for select to authenticated using (public.is_leader());
drop policy if exists "Leaders add events" on public.leaddesk_events;
create policy "Leaders add events" on public.leaddesk_events
  for insert to authenticated with check (public.is_leader() and created_by = auth.uid());
drop policy if exists "Leaders edit events" on public.leaddesk_events;
create policy "Leaders edit events" on public.leaddesk_events
  for update to authenticated using (public.is_leader()) with check (public.is_leader());
drop policy if exists "Leaders delete events" on public.leaddesk_events;
create policy "Leaders delete events" on public.leaddesk_events
  for delete to authenticated using (public.is_leader());

drop policy if exists "Leaders read notes" on public.leaddesk_notes;
create policy "Leaders read notes" on public.leaddesk_notes
  for select to authenticated using (public.is_leader());
drop policy if exists "Leaders add notes" on public.leaddesk_notes;
create policy "Leaders add notes" on public.leaddesk_notes
  for insert to authenticated with check (public.is_leader() and created_by = auth.uid());
drop policy if exists "Leaders edit notes" on public.leaddesk_notes;
create policy "Leaders edit notes" on public.leaddesk_notes
  for update to authenticated using (public.is_leader()) with check (public.is_leader());
drop policy if exists "Leaders delete notes" on public.leaddesk_notes;
create policy "Leaders delete notes" on public.leaddesk_notes
  for delete to authenticated using (public.is_leader());
