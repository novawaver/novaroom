-- Admin-granted permission to add LeadDesk tasks. Run this after 20261019120000_admin_badges.sql.
--
-- Leadership members can no longer add new tasks unless an admin turns it on for them. They can
-- still see, edit, move and delete existing tasks. Admins keep full access through
-- "Admins manage tasks" from 20261015150000_leaddesk_admin.sql.

create table if not exists public.task_permissions (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  can_add_tasks boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

alter table public.task_permissions enable row level security;

-- People can see their own permission (so the app can enable the button); admins see all.
-- Changes only go through admin_set_task_permission below.
drop policy if exists "Users read their task permission" on public.task_permissions;
create policy "Users read their task permission" on public.task_permissions
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

-- Whether the signed-in person may add a new LeadDesk task.
create or replace function public.may_add_task()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_leader()
    and exists (
      select 1
      from public.task_permissions p
      where p.user_id = auth.uid()
        and p.can_add_tasks
    );
$$;

revoke all on function public.may_add_task() from public, anon;
grant execute on function public.may_add_task() to authenticated;

drop policy if exists "Leaders add tasks" on public.leaddesk_tasks;
create policy "Leaders add tasks" on public.leaddesk_tasks
  for insert to authenticated with check (public.may_add_task() and created_by = auth.uid());

create or replace function public.admin_set_task_permission(target uuid, allowed boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_admin();
  insert into public.task_permissions (user_id, can_add_tasks, updated_at, updated_by)
  values (target, allowed, now(), auth.uid())
  on conflict (user_id) do update
  set can_add_tasks = excluded.can_add_tasks,
      updated_at = now(),
      updated_by = auth.uid();
end;
$$;

revoke all on function public.admin_set_task_permission(uuid, boolean) from public, anon;
grant execute on function public.admin_set_task_permission(uuid, boolean) to authenticated;
