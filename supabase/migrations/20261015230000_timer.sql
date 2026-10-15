-- Timer: awake and idle time per person. Run this after 20261015220000_leaddesk_tasks_realtime.sql.
--
-- The app records periods of 'awake' (input within the last minute) and 'idle' (no input for over
-- a minute). Offline time is not stored: it is the rest of the day, when no period was recorded.
-- The Timer is always on for Leadership members and optional for everyone else.

create table if not exists public.timer_settings (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.timer_segments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  status text not null check (status in ('awake', 'idle')),
  started_at timestamptz not null,
  ended_at timestamptz not null,
  check (ended_at >= started_at)
);

create index if not exists timer_segments_user_time_idx
  on public.timer_segments (user_id, started_at);

alter table public.timer_settings enable row level security;
alter table public.timer_segments enable row level security;

-- People manage their own setting; admins can read everyone's.
drop policy if exists "Users read their timer setting" on public.timer_settings;
create policy "Users read their timer setting" on public.timer_settings
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

drop policy if exists "Users add their timer setting" on public.timer_settings;
create policy "Users add their timer setting" on public.timer_settings
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "Users change their timer setting" on public.timer_settings;
create policy "Users change their timer setting" on public.timer_settings
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- People record and read their own time; admins can read everyone's.
drop policy if exists "Users read their timer" on public.timer_segments;
create policy "Users read their timer" on public.timer_segments
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

drop policy if exists "Users record their timer" on public.timer_segments;
create policy "Users record their timer" on public.timer_segments
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "Users extend their timer" on public.timer_segments;
create policy "Users extend their timer" on public.timer_segments
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Keep recorded time honest: a period can only be started near the present and only extended
-- forward up to now. Its status and start cannot be changed afterwards.
create or replace function public.guard_timer_segment()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.started_at < now() - interval '15 minutes' or new.ended_at > now() + interval '2 minutes' then
      raise exception 'Timer periods must be recorded as they happen';
    end if;
  else
    if new.user_id <> old.user_id or new.status <> old.status or new.started_at <> old.started_at then
      raise exception 'Recorded timer periods cannot be changed';
    end if;
    if new.ended_at < old.ended_at or new.ended_at > now() + interval '2 minutes' then
      raise exception 'Timer periods can only be extended up to now';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_timer_segment on public.timer_segments;
create trigger guard_timer_segment
  before insert or update on public.timer_segments
  for each row execute function public.guard_timer_segment();
