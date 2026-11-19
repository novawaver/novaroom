-- Calls in group chats and rooms. Run this after 20261119130000_voice_calls.sql.
--
-- Until now only the two people of a direct chat could set up a call. Now any two members of the
-- same chat can, whatever its kind, so a group or a room can hold a call together. Each pair of
-- apps in a call still connects directly; nothing of the call itself is kept here.

create or replace function public.can_call(cid uuid, other uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
      select 1 from public.conversation_members m
      where m.conversation_id = cid and m.user_id = auth.uid()
    )
    and exists (
      select 1 from public.conversation_members m
      where m.conversation_id = cid and m.user_id = other
    )
    and not public.either_blocked(auth.uid(), other);
$$;

revoke all on function public.can_call(uuid, uuid) from public, anon;
grant execute on function public.can_call(uuid, uuid) to authenticated;
