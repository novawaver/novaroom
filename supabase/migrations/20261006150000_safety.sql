-- Safety: block, report, delete a message, delete an account.
-- Run this after 20261006140000_groups_and_files.sql.
-- Review these rules before a public launch. The app does not claim end-to-end encryption.

-- Blocks are one row per pair. Either person blocking closes a direct chat.
create table if not exists public.blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create index if not exists blocks_blocked_idx on public.blocks (blocked_id);

alter table public.blocks enable row level security;

drop policy if exists "Users can see who they blocked" on public.blocks;
create policy "Users can see who they blocked"
  on public.blocks
  for select
  to authenticated
  using (blocker_id = auth.uid());

drop policy if exists "Users can block" on public.blocks;
create policy "Users can block"
  on public.blocks
  for insert
  to authenticated
  with check (blocker_id = auth.uid());

drop policy if exists "Users can unblock" on public.blocks;
create policy "Users can unblock"
  on public.blocks
  for delete
  to authenticated
  using (blocker_id = auth.uid());

-- Reports keep a copy of the message so a later delete does not erase the report.
-- Only the reporter can read their own rows. Review the table in the Supabase dashboard.
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references public.profiles (id) on delete set null,
  message_id uuid references public.messages (id) on delete set null,
  conversation_id uuid,
  reported_user_id uuid references public.profiles (id) on delete set null,
  reason text not null check (reason in ('harassment', 'spam', 'leak', 'other')),
  note text check (note is null or char_length(note) <= 1000),
  body_snapshot text,
  attachment_name text,
  created_at timestamptz not null default now()
);

create unique index if not exists reports_one_per_message
  on public.reports (reporter_id, message_id);

alter table public.reports enable row level security;

drop policy if exists "Reporters can read their own reports" on public.reports;
create policy "Reporters can read their own reports"
  on public.reports
  for select
  to authenticated
  using (reporter_id = auth.uid());

-- A deleted message stays in the chat as "Message deleted" so the report still has a row to point at.
alter table public.messages
  add column if not exists deleted_at timestamptz;

alter table public.messages
  drop constraint if exists messages_content_check;

alter table public.messages
  add constraint messages_content_check
  check (
    deleted_at is not null
    or (
      body is not null
      and char_length(btrim(body)) > 0
      and char_length(body) <= 4000
    )
    or attachment_path is not null
  );

-- Keep the row when an account is deleted, with the sender cleared and the text already removed.
alter table public.messages drop constraint if exists messages_sender_id_fkey;
alter table public.messages alter column sender_id drop not null;
alter table public.messages
  add constraint messages_sender_id_fkey
  foreign key (sender_id) references public.profiles (id) on delete set null;

alter table public.messages replica identity full;

create or replace function public.either_blocked(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select a is not null
    and b is not null
    and exists (
      select 1
      from public.blocks
      where (blocker_id = a and blocked_id = b)
         or (blocker_id = b and blocked_id = a)
    );
$$;

-- True when a direct chat cannot accept a new message from the signed-in user.
create or replace function public.direct_send_blocked(cid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.conversations c
    where c.id = cid
      and c.kind = 'direct'
      and (
        (select count(*) from public.conversation_members m where m.conversation_id = c.id) < 2
        or exists (
          select 1
          from public.conversation_members me
          join public.conversation_members them
            on them.conversation_id = me.conversation_id
           and them.user_id <> me.user_id
          where me.conversation_id = c.id
            and me.user_id = auth.uid()
            and public.either_blocked(me.user_id, them.user_id)
        )
      )
  );
$$;

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

create or replace function public.delete_own_message(message_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  owner uuid;
  path text;
  already timestamptz;
begin
  if me is null then
    raise exception 'Sign in before deleting a message';
  end if;

  select sender_id, attachment_path, deleted_at
    into owner, path, already
  from public.messages
  where id = message_id;

  if not found then
    raise exception 'That message is not available';
  end if;

  if owner is distinct from me then
    raise exception 'You can only delete your own messages';
  end if;

  if already is not null then
    return;
  end if;

  if path is not null then
    delete from storage.objects
    where bucket_id = 'chat-files'
      and name = path;
  end if;

  update public.messages
  set body = null,
      attachment_path = null,
      attachment_name = null,
      attachment_mime = null,
      attachment_size = null,
      deleted_at = now()
  where id = message_id
    and sender_id = me;
end;
$$;

create or replace function public.report_message(target uuid, report_reason text, report_note text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  msg public.messages%rowtype;
  clean_note text := nullif(btrim(coalesce(report_note, '')), '');
  created uuid;
begin
  if me is null then
    raise exception 'Sign in before reporting a message';
  end if;

  if report_reason not in ('harassment', 'spam', 'leak', 'other') then
    raise exception 'Choose a reason';
  end if;

  if clean_note is not null and char_length(clean_note) > 1000 then
    raise exception 'Keep the note under 1000 characters';
  end if;

  select * into msg from public.messages where id = target;
  if not found or not public.is_conversation_member(msg.conversation_id) then
    raise exception 'That message is not available';
  end if;

  if msg.sender_id is not distinct from me then
    raise exception 'You cannot report your own message';
  end if;

  if msg.deleted_at is not null or msg.sender_id is null then
    raise exception 'That message is not available';
  end if;

  insert into public.reports (
    reporter_id,
    message_id,
    conversation_id,
    reported_user_id,
    reason,
    note,
    body_snapshot,
    attachment_name
  )
  values (
    me,
    msg.id,
    msg.conversation_id,
    msg.sender_id,
    report_reason,
    clean_note,
    msg.body,
    msg.attachment_name
  )
  returning id into created;

  return created;
exception
  when unique_violation then
    raise exception 'You already reported that message';
end;
$$;

create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Sign in before deleting your account';
  end if;

  delete from storage.objects o
  using public.messages m
  where m.sender_id = me
    and m.attachment_path is not null
    and o.bucket_id = 'chat-files'
    and o.name = m.attachment_path;

  delete from storage.objects
  where bucket_id = 'avatars'
    and (storage.foldername(name))[1] = me::text;

  update public.messages
  set body = null,
      attachment_path = null,
      attachment_name = null,
      attachment_mime = null,
      attachment_size = null,
      deleted_at = coalesce(deleted_at, now())
  where sender_id = me;

  update public.conversations c
  set title = 'Deleted account'
  where c.kind = 'direct'
    and exists (
      select 1
      from public.conversation_members m
      where m.conversation_id = c.id
        and m.user_id = me
    );

  delete from auth.users where id = me;
end;
$$;

revoke all on function public.either_blocked(uuid, uuid) from public, anon, authenticated;
revoke all on function public.direct_send_blocked(uuid) from public, anon;
revoke all on function public.delete_own_message(uuid) from public, anon;
revoke all on function public.report_message(uuid, text, text) from public, anon;
revoke all on function public.delete_own_account() from public, anon;
revoke all on function public.start_direct_chat(text) from public, anon;
revoke all on function public.start_group_chat(text, text[]) from public, anon;

grant execute on function public.direct_send_blocked(uuid) to authenticated;
grant execute on function public.delete_own_message(uuid) to authenticated;
grant execute on function public.report_message(uuid, text, text) to authenticated;
grant execute on function public.delete_own_account() to authenticated;
grant execute on function public.start_direct_chat(text) to authenticated;
grant execute on function public.start_group_chat(text, text[]) to authenticated;

drop policy if exists "Members can read messages" on public.messages;
create policy "Members can read messages"
  on public.messages
  for select
  to authenticated
  using (
    public.is_conversation_member(conversation_id)
    and (
      sender_id is null
      or sender_id = auth.uid()
      or not exists (
        select 1
        from public.blocks
        where blocker_id = auth.uid()
          and blocked_id = messages.sender_id
      )
    )
  );

drop policy if exists "Members can send their own messages" on public.messages;
create policy "Members can send their own messages"
  on public.messages
  for insert
  to authenticated
  with check (
    sender_id = auth.uid()
    and deleted_at is null
    and public.is_conversation_member(conversation_id)
    and not public.direct_send_blocked(conversation_id)
  );

drop policy if exists "Users delete their own avatar" on storage.objects;
create policy "Users delete their own avatar"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Senders delete their chat files" on storage.objects;
create policy "Senders delete their chat files"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'chat-files'
    and owner_id = auth.uid()::text
  );
