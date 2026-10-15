-- Notifications for LeadDesk event participants. Run this after 20261015190000_leaddesk_event_lock.sql.
--
-- When an event is created with participants, or people are added to an existing event, each new
-- participant gets a row here. The app shows it at once if they are online (realtime) or the next
-- time they open it, then marks it delivered. Whoever made the change is not notified.
-- Reminders at an event's start time are shown by the app itself and need no rows here.

create table if not exists public.leaddesk_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  event_id uuid references public.leaddesk_events (id) on delete cascade,
  kind text not null check (kind in ('event_added')),
  title text not null,
  created_at timestamptz not null default now(),
  delivered_at timestamptz
);

create index if not exists leaddesk_notifications_user_idx
  on public.leaddesk_notifications (user_id, delivered_at);

alter table public.leaddesk_notifications enable row level security;

-- People read and mark only their own notifications. Rows are only created by the trigger below.
drop policy if exists "Users read their notifications" on public.leaddesk_notifications;
create policy "Users read their notifications" on public.leaddesk_notifications
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "Users mark their notifications" on public.leaddesk_notifications;
create policy "Users mark their notifications" on public.leaddesk_notifications
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function public.notify_leaddesk_participants()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.leaddesk_notifications (user_id, event_id, kind, title)
  select participant, new.id, 'event_added', new.title
  from unnest(new.participant_ids) as participant
  where participant is distinct from coalesce(auth.uid(), new.created_by)
    and (tg_op = 'INSERT' or not (participant = any(old.participant_ids)))
    and exists (select 1 from public.profiles p where p.id = participant);
  return new;
end;
$$;

revoke all on function public.notify_leaddesk_participants() from public, anon, authenticated;

drop trigger if exists notify_leaddesk_participants on public.leaddesk_events;
create trigger notify_leaddesk_participants
  after insert or update of participant_ids on public.leaddesk_events
  for each row execute function public.notify_leaddesk_participants();

do $$
begin
  alter publication supabase_realtime add table public.leaddesk_notifications;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
