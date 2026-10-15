-- Lets admins manage LeadDesk from the admin site. Run this after 20261015140000_leaddesk.sql.
-- These are extra rules alongside the leader rules, so leaders keep exactly the access they had.
-- LeadDesk tables are not streamed to the app, so admins reading them does not affect the app.

drop policy if exists "Admins manage tasks" on public.leaddesk_tasks;
create policy "Admins manage tasks" on public.leaddesk_tasks
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Admins manage events" on public.leaddesk_events;
create policy "Admins manage events" on public.leaddesk_events
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Admins manage notes" on public.leaddesk_notes;
create policy "Admins manage notes" on public.leaddesk_notes
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
