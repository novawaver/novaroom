-- Stream profile changes so the app picks up a new role (or name) from an admin without a restart.
-- Run this after 20261015270000_chat_permissions.sql. Realtime applies the same rules as reads.

do $$
begin
  alter publication supabase_realtime add table public.profiles;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
