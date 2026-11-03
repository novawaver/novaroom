-- Muting a group or room. Run this after 20261029140000_leaddesk_event_alarm.sql.
--
-- An admin can mute a group chat or a room from the admin site. While it is muted nobody can send
-- messages or upload files in it, admins and leaders included; everyone can still read it, and
-- people can still delete their own messages. Direct chats cannot be muted. Muting and unmuting are
-- written to the activity log.

alter table public.conversations
  add column if not exists muted boolean not null default false,
  add column if not exists muted_at timestamptz,
  add column if not exists muted_by uuid references public.profiles (id) on delete set null;

-- Whether a chat is muted. Security definer, so the send rules below can ask about any chat.
create or replace function public.conversation_muted(cid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select muted from public.conversations where id = cid), false);
$$;

revoke all on function public.conversation_muted(uuid) from public, anon;
grant execute on function public.conversation_muted(uuid) to authenticated;

-- "Members can send their own messages" from 20261006150000_safety.sql, now also refusing muted chats.
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
    and not public.conversation_muted(conversation_id)
  );

-- "Members upload chat files" from 20261006140000_groups_and_files.sql, so a file cannot be uploaded
-- into a muted chat either.
drop policy if exists "Members upload chat files" on storage.objects;
create policy "Members upload chat files"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'chat-files'
    and public.is_conversation_member(((storage.foldername(name))[1])::uuid)
    and not public.conversation_muted(((storage.foldername(name))[1])::uuid)
  );

create or replace function public.admin_set_conversation_muted(cid uuid, mute boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  chat_kind text;
  chat_title text;
  was_muted boolean;
begin
  perform public.require_admin();

  select kind, title, muted into chat_kind, chat_title, was_muted
  from public.conversations
  where id = cid;

  if chat_kind is null then
    raise exception 'That chat no longer exists';
  end if;
  if chat_kind = 'direct' then
    raise exception 'Only groups and rooms can be muted';
  end if;
  if was_muted = mute then
    return;
  end if;

  update public.conversations
  set muted = mute,
      muted_at = case when mute then now() end,
      muted_by = case when mute then auth.uid() end
  where id = cid;

  perform public.write_activity(
    'admin',
    case when mute then 'chat.muted' else 'chat.unmuted' end,
    format('%s the %s "%s"', case when mute then 'Muted' else 'Unmuted' end, chat_kind, chat_title),
    null, cid);
end;
$$;

revoke all on function public.admin_set_conversation_muted(uuid, boolean) from public, anon;
grant execute on function public.admin_set_conversation_muted(uuid, boolean) to authenticated;

-- admin_list_conversations from 20261015130000_admin.sql, now also saying whether each chat is muted.
-- Its columns changed, so it is dropped first.
drop function if exists public.admin_list_conversations();

create function public.admin_list_conversations()
returns table (
  conversation_id uuid,
  kind text,
  title text,
  description text,
  created_at timestamptz,
  member_count bigint,
  message_count bigint,
  last_message_at timestamptz,
  member_names text[],
  muted boolean
)
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
    c.id,
    c.kind,
    c.title,
    c.description,
    c.created_at,
    (select count(*) from public.conversation_members cm where cm.conversation_id = c.id),
    (select count(*) from public.messages m where m.conversation_id = c.id and m.deleted_at is null),
    (select max(m.created_at) from public.messages m where m.conversation_id = c.id),
    array(
      select coalesce(nullif(p.display_name, ''), 'Unnamed')
      from public.conversation_members cm
      join public.profiles p on p.id = cm.user_id
      where cm.conversation_id = c.id
      order by p.display_name
      limit 6
    ),
    c.muted
  from public.conversations c
  order by 8 desc nulls last, 5 desc;
end;
$$;

revoke all on function public.admin_list_conversations() from public, anon;
grant execute on function public.admin_list_conversations() to authenticated;

-- Live updates, so an open chat locks and unlocks as soon as an admin mutes or unmutes it. Realtime
-- applies the same rules as reads, so only people who can see a chat hear about it.
do $$
begin
  alter publication supabase_realtime add table public.conversations;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
