-- Leadership members can start a direct chat with each other from the People page.
-- Run this after 20261015240000_timer_daily.sql.
--
-- Normal direct chats need the other person's email. Leaders start one by user id instead, but
-- only when both people have the Leadership role. Blocks apply as they do in start_direct_chat.

create or replace function public.start_leader_chat(other uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  pair text;
  created uuid;
begin
  if me is null then
    raise exception 'Sign in before starting a chat';
  end if;

  if not public.is_leader() then
    raise exception 'Only Leadership members can start chats this way';
  end if;

  if other is null or other = me then
    raise exception 'You cannot start a chat with yourself';
  end if;

  if not exists (select 1 from public.profiles where id = other and role = 'Leadership') then
    raise exception 'You can only start chats with other Leadership members here';
  end if;

  pair := least(me::text, other::text) || ':' || greatest(me::text, other::text);

  select id into created from public.conversations where direct_key = pair;

  if public.either_blocked(me, other) then
    if created is not null then
      return created;
    end if;
    raise exception 'You cannot message this person';
  end if;

  if created is not null then
    return created;
  end if;

  insert into public.conversations (direct_key)
  values (pair)
  returning id into created;

  insert into public.conversation_members (conversation_id, user_id)
  values (created, me), (created, other);

  return created;
exception
  when unique_violation then
    select id into created from public.conversations where direct_key = pair;
    return created;
end;
$$;

revoke all on function public.start_leader_chat(uuid) from public, anon;
grant execute on function public.start_leader_chat(uuid) to authenticated;
