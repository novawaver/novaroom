-- An alarm before a LeadDesk event starts. Run this after 20261029130000_leaddesk_event_tag_order.sql.
--
-- alarm_minutes: how long before each start the event's participants are alerted, or null for no
-- alarm. The app shows the alert while it is open: a notification at the alarm time, then a
-- countdown until the event starts. Daily events alarm before every day's start.

alter table public.leaddesk_events
  add column if not exists alarm_minutes integer;

alter table public.leaddesk_events
  drop constraint if exists leaddesk_events_alarm_minutes;
alter table public.leaddesk_events
  add constraint leaddesk_events_alarm_minutes check (alarm_minutes is null or alarm_minutes between 1 and 1440);
