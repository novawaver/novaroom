-- Stream LeadDesk task changes so new and edited tasks appear in the app without a refresh.
-- Run this after 20261015210000_leaddesk_event_reads.sql. Realtime applies the same rules as reads,
-- so only leaders (and admins) receive task changes.

do $$
begin
  alter publication supabase_realtime add table public.leaddesk_tasks;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
