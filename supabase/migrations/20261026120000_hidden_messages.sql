-- Clearing a chat and deleting messages "for me". Run this after 20261023150000_storage_api_deletes.sql.
--
-- Both only change what one person sees; everyone else in the chat keeps every message.
-- Clearing a chat sets cleared_at on the person's own membership row, and messages from before it
-- are no longer loaded for them. Deleting chosen messages for yourself adds rows to hidden_messages.
-- Both change only through the functions below.

alter table public.conversation_members
  add column if not exists cleared_at timestamptz;

create table if not exists public.hidden_messages (
  user_id uuid not null references public.profiles (id) on delete cascade,
  message_id uuid not null references public.messages (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, message_id)
);

create index if not exists hidden_messages_user_conversation_idx
  on public.hidden_messages (user_id, conversation_id);

alter table public.hidden_messages enable row level security;

drop policy if exists "People see the messages they hid" on public.hidden_messages;
create policy "People see the messages they hid"
  on public.hidden_messages
  for select
  to authenticated
  using (user_id = auth.uid());

-- Only reads are allowed straight on the table; the functions below make the changes.
grant select on public.hidden_messages to anon;
grant select, insert, update, delete on public.hidden_messages to authenticated;
grant select, insert, update, delete on public.hidden_messages to service_role;

create or replace function public.hide_messages(cid uuid, message_ids uuid[])
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.hidden_messages (user_id, message_id, conversation_id)
  select auth.uid(), m.id, m.conversation_id
  from public.messages m
  where m.id = any (message_ids)
    and m.conversation_id = cid
    and public.is_conversation_member(cid)
  on conflict do nothing;
$$;

revoke all on function public.hide_messages(uuid, uuid[]) from public, anon;
grant execute on function public.hide_messages(uuid, uuid[]) to authenticated;

create or replace function public.clear_conversation(cid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.conversation_members
  set cleared_at = now()
  where conversation_id = cid
    and user_id = auth.uid();
  -- Everything hidden one by one is now before cleared_at, so those rows are no longer needed.
  delete from public.hidden_messages
  where conversation_id = cid
    and user_id = auth.uid();
end;
$$;

revoke all on function public.clear_conversation(uuid) from public, anon;
grant execute on function public.clear_conversation(uuid) to authenticated;
