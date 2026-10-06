-- Group chats and file attachments. Run this after 20261006130000_messages.sql.
-- Review these row level security rules before launch.

alter table public.conversations
  alter column direct_key drop not null;

alter table public.conversations
  add column if not exists kind text not null default 'direct',
  add column if not exists title text;

alter table public.conversations
  drop constraint if exists conversations_kind_check;

alter table public.conversations
  add constraint conversations_kind_check
  check (kind in ('direct', 'group'));

alter table public.conversations
  drop constraint if exists conversations_group_title_check;

alter table public.conversations
  add constraint conversations_group_title_check
  check (
    kind = 'direct'
    or (title is not null and char_length(btrim(title)) between 1 and 80)
  );

alter table public.messages
  drop constraint if exists messages_body_check;

alter table public.messages
  alter column body drop not null;

alter table public.messages
  add column if not exists attachment_path text,
  add column if not exists attachment_name text,
  add column if not exists attachment_mime text,
  add column if not exists attachment_size bigint;

alter table public.messages
  drop constraint if exists messages_content_check;

alter table public.messages
  add constraint messages_content_check
  check (
    (
      body is not null
      and char_length(btrim(body)) > 0
      and char_length(body) <= 4000
    )
    or attachment_path is not null
  );

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

revoke all on function public.start_group_chat(text, text[]) from public;
grant execute on function public.start_group_chat(text, text[]) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit)
values ('chat-files', 'chat-files', false, 26214400)
on conflict (id) do update
set public = false,
    file_size_limit = 26214400;

create policy "Members read chat files"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'chat-files'
    and public.is_conversation_member(((storage.foldername(name))[1])::uuid)
  );

create policy "Members upload chat files"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'chat-files'
    and public.is_conversation_member(((storage.foldername(name))[1])::uuid)
  );
