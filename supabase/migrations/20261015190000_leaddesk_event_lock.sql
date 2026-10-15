-- Locked LeadDesk events. Run this after 20261015180000_leaddesk_event_people.sql.
-- Admins lock and unlock events from the admin site. Leaders can still see a locked event (if its
-- visibility allows) but cannot edit or delete it, and cannot lock or unlock events themselves.
-- The admins' own rule ("Admins manage events") is unchanged, so admins can always edit.

alter table public.leaddesk_events
  add column if not exists locked boolean not null default false;

drop policy if exists "Leaders edit events" on public.leaddesk_events;
create policy "Leaders edit events" on public.leaddesk_events
  for update to authenticated
  using (not locked and public.can_see_leaddesk_event(visibility, created_by, participant_ids))
  with check (not locked and public.is_leader());

drop policy if exists "Leaders delete events" on public.leaddesk_events;
create policy "Leaders delete events" on public.leaddesk_events
  for delete to authenticated
  using (not locked and public.can_see_leaddesk_event(visibility, created_by, participant_ids));

-- New events from leaders always start unlocked.
drop policy if exists "Leaders add events" on public.leaddesk_events;
create policy "Leaders add events" on public.leaddesk_events
  for insert to authenticated
  with check (public.is_leader() and created_by = auth.uid() and not locked);
