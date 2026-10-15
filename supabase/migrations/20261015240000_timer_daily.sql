-- Daily Timer totals, for the Last Week / Last Month / This Year / All views.
-- Run this after 20261015230000_timer.sql.
--
-- Returns the signed-in person's awake and idle seconds for each day on their own clock (zone),
-- from from_day (or from the first recorded day when null). Periods crossing midnight are split
-- between the two days. Runs with the caller's own access, so it only ever sees their rows.

create or replace function public.timer_daily(from_day date, zone text)
returns table (day date, awake_seconds bigint, idle_seconds bigint)
language sql
stable
security invoker
set search_path = public
as $$
  with segs as (
    select s.status, s.started_at, s.ended_at
    from public.timer_segments s
    where s.user_id = auth.uid()
      and (from_day is null or s.ended_at >= (from_day::timestamp at time zone zone))
  ),
  pieces as (
    select
      segs.status,
      d::date as piece_day,
      extract(epoch from
        least(segs.ended_at, ((d::date + 1)::timestamp at time zone zone))
        - greatest(segs.started_at, (d::date::timestamp at time zone zone))
      )::bigint as seconds
    from segs,
      generate_series(
        (segs.started_at at time zone zone)::date,
        (segs.ended_at at time zone zone)::date,
        interval '1 day'
      ) as d
  )
  select
    piece_day,
    coalesce(sum(seconds) filter (where status = 'awake'), 0)::bigint,
    coalesce(sum(seconds) filter (where status = 'idle'), 0)::bigint
  from pieces
  where seconds > 0
    and (from_day is null or piece_day >= from_day)
  group by piece_day
  order by piece_day;
$$;

revoke all on function public.timer_daily(date, text) from public, anon;
grant execute on function public.timer_daily(date, text) to authenticated;
