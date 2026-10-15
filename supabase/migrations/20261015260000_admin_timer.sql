-- Time Tracker review for the admin site. Run this after 20261015250000_leader_direct_chat.sql.
-- Both functions check public.is_admin() first. Admins could already read timer rows directly;
-- these add them up on the server so long ranges do not download every recorded period.

-- Each person's online ('awake') and idle seconds within [from_ts, to_ts), with their last activity.
-- People with nothing recorded in the range are not returned.
create or replace function public.admin_timer_summary(from_ts timestamptz, to_ts timestamptz)
returns table (user_id uuid, awake_seconds bigint, idle_seconds bigint, last_seen timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  perform public.require_admin();
  return query
  select
    s.user_id,
    coalesce(sum(extract(epoch from least(s.ended_at, to_ts) - greatest(s.started_at, from_ts)))
      filter (where s.status = 'awake'), 0)::bigint,
    coalesce(sum(extract(epoch from least(s.ended_at, to_ts) - greatest(s.started_at, from_ts)))
      filter (where s.status = 'idle'), 0)::bigint,
    max(s.ended_at)
  from public.timer_segments s
  where s.ended_at > from_ts
    and s.started_at < to_ts
  group by s.user_id;
end;
$$;

-- One person's online and idle seconds per day on the given zone's calendar, from from_day up to
-- (but not including) to_day. Same splitting at midnight as timer_daily.
create or replace function public.admin_timer_daily(target uuid, from_day date, to_day date, zone text)
returns table (day date, awake_seconds bigint, idle_seconds bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  perform public.require_admin();
  return query
  with segs as (
    select s.status, s.started_at, s.ended_at
    from public.timer_segments s
    where s.user_id = target
      and s.ended_at >= (from_day::timestamp at time zone zone)
      and s.started_at < (to_day::timestamp at time zone zone)
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
    pieces.piece_day,
    coalesce(sum(pieces.seconds) filter (where pieces.status = 'awake'), 0)::bigint,
    coalesce(sum(pieces.seconds) filter (where pieces.status = 'idle'), 0)::bigint
  from pieces
  where pieces.seconds > 0
    and pieces.piece_day >= from_day
    and pieces.piece_day < to_day
  group by pieces.piece_day
  order by pieces.piece_day;
end;
$$;

revoke all on function public.admin_timer_summary(timestamptz, timestamptz) from public, anon;
revoke all on function public.admin_timer_daily(uuid, date, date, text) from public, anon;
grant execute on function public.admin_timer_summary(timestamptz, timestamptz) to authenticated;
grant execute on function public.admin_timer_daily(uuid, date, date, text) to authenticated;
