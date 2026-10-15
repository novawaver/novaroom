-- Participants and visibility for LeadDesk events. Run this after 20261015170000_leaddesk_time_zones.sql.
--
-- participant_ids: the leaders who should take part.
-- visibility: 'leaders' (every leader can see it) or 'participants' (only the participants and the
-- person who created it). Admins see every event through their own rule.

alter table public.leaddesk_events
  add column if not exists participant_ids uuid[] not null default '{}',
  add column if not exists visibility text not null default 'leaders';

alter table public.leaddesk_events
  drop constraint if exists leaddesk_events_people_check;

alter table public.leaddesk_events
  add constraint leaddesk_events_people_check
  check (visibility in ('leaders', 'participants') and cardinality(participant_ids) <= 100);

-- Whether the signed-in leader may see (and so edit) an event.
create or replace function public.can_see_leaddesk_event(event_visibility text, event_creator uuid, event_participants uuid[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_leader()
    and (
      event_visibility = 'leaders'
      or event_creator = auth.uid()
      or auth.uid() = any(event_participants)
    );
$$;

revoke all on function public.can_see_leaddesk_event(text, uuid, uuid[]) from public, anon;
grant execute on function public.can_see_leaddesk_event(text, uuid, uuid[]) to authenticated;

drop policy if exists "Leaders read events" on public.leaddesk_events;
create policy "Leaders read events" on public.leaddesk_events
  for select to authenticated
  using (public.can_see_leaddesk_event(visibility, created_by, participant_ids));

drop policy if exists "Leaders edit events" on public.leaddesk_events;
create policy "Leaders edit events" on public.leaddesk_events
  for update to authenticated
  using (public.can_see_leaddesk_event(visibility, created_by, participant_ids))
  with check (public.is_leader());

drop policy if exists "Leaders delete events" on public.leaddesk_events;
create policy "Leaders delete events" on public.leaddesk_events
  for delete to authenticated
  using (public.can_see_leaddesk_event(visibility, created_by, participant_ids));
