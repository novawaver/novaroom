-- Repeating LeadDesk events. Run this after 20261015150000_leaddesk_admin.sql.
-- A daily event stores its first occurrence in starts_at/ends_at and repeats at the same time
-- every day, up to and including repeat_until (or forever when that is empty).

alter table public.leaddesk_events
  add column if not exists repeat text not null default 'none',
  add column if not exists repeat_until date;

alter table public.leaddesk_events
  drop constraint if exists leaddesk_events_repeat_check;

alter table public.leaddesk_events
  add constraint leaddesk_events_repeat_check
  check (
    repeat in ('none', 'daily')
    and (repeat_until is null or repeat = 'daily')
  );
