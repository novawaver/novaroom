-- Explicit Data API grants for every table. Run this after 20261021120000_local_chat_keys.sql.
--
-- From October 30, 2026 Supabase no longer grants API roles access to new tables in "public"
-- automatically. Tables that already exist keep their grants, but anything that rebuilds the schema
-- from these migrations (supabase db reset, preview branches, new projects) would otherwise end up
-- with tables the app cannot reach ("permission denied").
--
-- Row level security is on for every table, so these grants only open the door: the policies still
-- decide which rows each person may see or change.
--
-- Any table added in a later migration needs the same three grants in the migration that creates it.

do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles',
    'conversations',
    'conversation_members',
    'messages',
    'blocks',
    'reports',
    'room_resources',
    'admins',
    'leaddesk_tasks',
    'leaddesk_events',
    'leaddesk_notes',
    'leaddesk_notifications',
    'leaddesk_event_reads',
    'timer_settings',
    'timer_segments',
    'chat_permissions',
    'task_permissions',
    'leaddesk_task_reads',
    'leaddesk_signals',
    'local_chat_keys'
  ] loop
    execute format('grant select on public.%I to anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end
$$;
