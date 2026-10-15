-- Time zones for LeadDesk events, and daily events defined by time of day only.
-- Run this after 20261015160000_leaddesk_repeat.sql.
--
-- One-off events keep exact moments in starts_at/ends_at; time_zone records the zone they were
-- entered in so they can be edited in it again. Daily events have no date: they happen every day
-- from start_time to end_time on the clock of time_zone (an end before the start runs past
-- midnight). The app shows every event in each viewer's own time zone.

alter table public.leaddesk_events
  add column if not exists time_zone text not null default 'UTC',
  add column if not exists start_time time,
  add column if not exists end_time time;

alter table public.leaddesk_events
  alter column starts_at drop not null,
  alter column ends_at drop not null;

alter table public.leaddesk_events
  drop constraint if exists leaddesk_events_repeat_check;

-- Daily events made before this change used their first date's times; keep those times in UTC.
update public.leaddesk_events
set start_time = (starts_at at time zone 'UTC')::time,
    end_time = (ends_at at time zone 'UTC')::time,
    starts_at = null,
    ends_at = null
where repeat = 'daily'
  and start_time is null;

alter table public.leaddesk_events
  drop column if exists repeat_until;

alter table public.leaddesk_events
  drop constraint if exists leaddesk_events_shape_check;

alter table public.leaddesk_events
  add constraint leaddesk_events_shape_check
  check (
    char_length(time_zone) between 1 and 64
    and (
      (repeat = 'none' and starts_at is not null and ends_at is not null)
      or (repeat = 'daily' and start_time is not null and end_time is not null and start_time <> end_time)
    )
  );
