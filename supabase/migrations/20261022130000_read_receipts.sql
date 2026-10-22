-- Read receipts: how far each member has read a chat, for the double check on sent messages.
-- Run this after 20261022120000_task_multiple_assignees.sql.
--
-- last_read_at is the created_at of the newest message the member has seen. Members can already
-- see each other's rows ("Members can see participants"), so everyone in a chat sees how far the
-- others have read. It only changes through mark_conversation_read, and only moves forward.

alter table public.conversation_members
  add column if not exists last_read_at timestamptz;

create or replace function public.mark_conversation_read(cid uuid, read_up_to timestamptz)
returns void
language sql
security definer
set search_path = public
as $$
  update public.conversation_members
  set last_read_at = least(read_up_to, now())
  where conversation_id = cid
    and user_id = auth.uid()
    and (last_read_at is null or last_read_at < least(read_up_to, now()));
$$;

revoke all on function public.mark_conversation_read(uuid, timestamptz) from public, anon;
grant execute on function public.mark_conversation_read(uuid, timestamptz) to authenticated;

-- Live updates, so a double check appears while the chat is open. Realtime applies the same rules
-- as reads, so only members of a chat hear about it.
do $$
begin
  alter publication supabase_realtime add table public.conversation_members;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
