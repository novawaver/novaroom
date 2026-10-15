-- Which LeadDesk events each person has seen, for the unread badges in the app.
-- Run this after 20261015200000_leaddesk_notifications.sql.
--
-- An event is unread for someone when they can see it, someone else created it, and there is no
-- row here for them. Opening the Schedule tab adds rows for everything currently unread.

create table if not exists public.leaddesk_event_reads (
  user_id uuid not null references public.profiles (id) on delete cascade,
  event_id uuid not null references public.leaddesk_events (id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (user_id, event_id)
);

alter table public.leaddesk_event_reads enable row level security;

drop policy if exists "Users read their event reads" on public.leaddesk_event_reads;
create policy "Users read their event reads" on public.leaddesk_event_reads
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "Users add their event reads" on public.leaddesk_event_reads;
create policy "Users add their event reads" on public.leaddesk_event_reads
  for insert to authenticated with check (user_id = auth.uid());

-- Start everyone off with existing events already read, so the first badge is not every event.
insert into public.leaddesk_event_reads (user_id, event_id)
select p.id, e.id
from public.profiles p
cross join public.leaddesk_events e
where p.role = 'Leadership'
on conflict do nothing;

-- Stream event changes so badges update live. Realtime applies the same visibility rules as reads,
-- so people only hear about events they are allowed to see.
do $$
begin
  alter publication supabase_realtime add table public.leaddesk_events;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
