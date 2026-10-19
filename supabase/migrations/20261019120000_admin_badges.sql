-- Lets the app show an admin badge on the People page. Run this after 20261016120000_profiles_realtime.sql.
--
-- The admins table stays closed to direct reads; this only reveals who is an admin, which every
-- signed-in person can already infer from the badge.

create or replace function public.list_admin_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select user_id from public.admins;
$$;

revoke all on function public.list_admin_ids() from public, anon;
grant execute on function public.list_admin_ids() to authenticated;
