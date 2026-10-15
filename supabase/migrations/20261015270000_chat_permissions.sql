-- Admin-granted permission to start direct chats and groups. Run this after 20261015260000_admin_timer.sql.
--
-- Nobody can start a new direct chat or group unless an admin turns it on for them, except
-- Leadership members, who are always allowed. People can still reopen a direct chat that already
-- exists, reply in chats they are in, and join rooms. Leader-to-leader chats (start_leader_chat)
-- are unaffected, since both people are leaders.

create table if not exists public.chat_permissions (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  can_start_direct boolean not null default false,
  can_start_group boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

alter table public.chat_permissions enable row level security;

-- People can see their own permissions (so the app can show or hide the buttons); admins see all.
-- Changes only go through admin_set_chat_permissions below.
drop policy if exists "Users read their chat permissions" on public.chat_permissions;
create policy "Users read their chat permissions" on public.chat_permissions
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

-- Whether the signed-in person may start a new chat of this kind ('direct' or 'group').
create or replace function public.may_start_chat(chat_kind text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_leader()
    or exists (
      select 1
      from public.chat_permissions p
      where p.user_id = auth.uid()
        and case when chat_kind = 'group' then p.can_start_group else p.can_start_direct end
    );
$$;

revoke all on function public.may_start_chat(text) from public, anon;
grant execute on function public.may_start_chat(text) to authenticated;

create or replace function public.admin_set_chat_permissions(target uuid, can_direct boolean, can_group boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_admin();
  insert into public.chat_permissions (user_id, can_start_direct, can_start_group, updated_at, updated_by)
  values (target, can_direct, can_group, now(), auth.uid())
  on conflict (user_id) do update
  set can_start_direct = excluded.can_start_direct,
      can_start_group = excluded.can_start_group,
      updated_at = now(),
      updated_by = auth.uid();
end;
$$;

revoke all on function public.admin_set_chat_permissions(uuid, boolean, boolean) from public, anon;
grant execute on function public.admin_set_chat_permissions(uuid, boolean, boolean) to authenticated;

-- start_direct_chat from 20261006150000_safety.sql, now refusing to create a new chat without
-- permission. An existing chat between the two people is still returned.
create or replace function public.start_direct_chat(other_email text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  other uuid;
  pair text;
  created uuid;
begin
  if me is null then
    raise exception 'Sign in before starting a chat';
  end if;

  select id into other
  from auth.users
  where lower(email) = lower(btrim(other_email))
  limit 1;

  if other is null then
    raise exception 'No Novaroom account uses that email';
  end if;

  if other = me then
    raise exception 'You cannot start a chat with yourself';
  end if;

  pair := least(me::text, other::text) || ':' || greatest(me::text, other::text);

  if public.either_blocked(me, other) then
    select id into created
    from public.conversations
    where direct_key = pair;
    if created is not null then
      return created;
    end if;
    raise exception 'You cannot message this person';
  end if;

  select id into created
  from public.conversations
  where direct_key = pair;

  if created is not null then
    return created;
  end if;

  if not public.may_start_chat('direct') then
    raise exception 'You need an admin''s permission to start new chats';
  end if;

  insert into public.conversations (direct_key)
  values (pair)
  returning id into created;

  insert into public.conversation_members (conversation_id, user_id)
  values (created, me), (created, other);

  return created;
exception
  when unique_violation then
    select id into created
    from public.conversations
    where direct_key = pair;
    return created;
end;
$$;

-- start_group_chat from 20261006150000_safety.sql, now requiring permission.
create or replace function public.start_group_chat(group_title text, member_emails text[])
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  clean_title text := btrim(group_title);
  raw_email text;
  other uuid;
  created uuid;
  members uuid[] := array[]::uuid[];
  seen text[] := array[]::text[];
begin
  if me is null then
    raise exception 'Sign in before starting a chat';
  end if;

  if not public.may_start_chat('group') then
    raise exception 'You need an admin''s permission to start groups';
  end if;

  if clean_title is null or char_length(clean_title) = 0 or char_length(clean_title) > 80 then
    raise exception 'Give the group a name up to 80 characters';
  end if;

  members := array_append(members, me);

  if member_emails is not null then
    foreach raw_email in array member_emails loop
      raw_email := lower(btrim(raw_email));
      if raw_email is null or raw_email = '' or raw_email = any(seen) then
        continue;
      end if;
      seen := array_append(seen, raw_email);

      select id into other
      from auth.users
      where lower(email) = raw_email
      limit 1;

      if other is null then
        raise exception 'No Novaroom account uses %', raw_email;
      end if;

      if other = me or other = any(members) then
        continue;
      end if;

      if public.either_blocked(me, other) then
        raise exception 'You cannot add someone you cannot message';
      end if;

      members := array_append(members, other);
    end loop;
  end if;

  if cardinality(members) < 2 then
    raise exception 'Add at least one other person';
  end if;

  if cardinality(members) > 50 then
    raise exception 'Groups can include up to 50 people';
  end if;

  insert into public.conversations (kind, title)
  values ('group', clean_title)
  returning id into created;

  insert into public.conversation_members (conversation_id, user_id)
  select created, member_id
  from unnest(members) as member_id;

  return created;
end;
$$;
