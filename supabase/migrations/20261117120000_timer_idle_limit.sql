-- How long someone can go without keyboard or mouse input before the Time Tracker records them as
-- idle. One setting for everyone, set in Novaroom Admin > Time Tracker and read by the app.

create table if not exists public.timer_config (
  id smallint primary key default 1 check (id = 1),
  idle_after_seconds integer not null default 60,
  updated_at timestamptz not null default now(),
  constraint timer_config_idle_after check (idle_after_seconds between 60 and 7200)
);

insert into public.timer_config (id) values (1) on conflict (id) do nothing;

-- No policies: the table is only reached through the functions below.
alter table public.timer_config enable row level security;

-- For anyone signed in: the app needs it to record time.
create or replace function public.timer_idle_after_seconds()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select c.idle_after_seconds from public.timer_config c where c.id = 1;
$$;

revoke all on function public.timer_idle_after_seconds() from public, anon;
grant execute on function public.timer_idle_after_seconds() to authenticated;

create or replace function public.admin_set_timer_idle_minutes(p_minutes integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_admin();
  if p_minutes is null or p_minutes < 1 or p_minutes > 120 then
    raise exception 'The idle limit must be between 1 and 120 minutes';
  end if;
  update public.timer_config
  set idle_after_seconds = p_minutes * 60, updated_at = now()
  where id = 1;
  perform public.write_activity(
    'admin',
    'timer.idle_limit',
    'Set the Time Tracker idle limit to ' || p_minutes || case when p_minutes = 1 then ' minute' else ' minutes' end
  );
end;
$$;

revoke all on function public.admin_set_timer_idle_minutes(integer) from public, anon;
grant execute on function public.admin_set_timer_idle_minutes(integer) to authenticated;
