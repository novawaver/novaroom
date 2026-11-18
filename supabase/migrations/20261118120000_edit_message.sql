-- Editing a message. Run this after 20261117120000_timer_idle_limit.sql.
--
-- People can change the text of their own messages. The message keeps its place in the chat and is
-- marked as edited. Where sending is refused (a muted chat, a blocked direct chat, a chat the person
-- has left), editing is refused too. The activity log already records edits ("message.edited").

alter table public.messages
  add column if not exists edited_at timestamptz;

-- Returns when the message was edited, for the app to show.
create or replace function public.edit_own_message(message_id uuid, new_body text)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  msg record;
  clean text := btrim(coalesce(new_body, ''));
  at timestamptz := now();
begin
  if me is null then
    raise exception 'Sign in before editing a message';
  end if;

  select m.sender_id, m.conversation_id, m.body, m.attachment_path, m.deleted_at, m.edited_at
    into msg
  from public.messages m
  where m.id = message_id;

  if not found or msg.deleted_at is not null then
    raise exception 'That message is not available';
  end if;

  if msg.sender_id is distinct from me then
    raise exception 'You can only edit your own messages';
  end if;

  if not public.is_conversation_member(msg.conversation_id)
     or public.direct_send_blocked(msg.conversation_id)
     or public.conversation_muted(msg.conversation_id) then
    raise exception 'You cannot change messages in this chat right now';
  end if;

  if char_length(clean) > 4000 then
    raise exception 'Messages are limited to 4000 characters';
  end if;

  -- A message with a file can lose its text; one without can't be left empty.
  if clean = '' and msg.attachment_path is null then
    raise exception 'Write a message first';
  end if;

  if clean = coalesce(msg.body, '') then
    return msg.edited_at;
  end if;

  update public.messages
  set body = nullif(clean, ''),
      edited_at = at
  where id = message_id
    and sender_id = me;

  return at;
end;
$$;

revoke all on function public.edit_own_message(uuid, text) from public, anon;
grant execute on function public.edit_own_message(uuid, text) to authenticated;
