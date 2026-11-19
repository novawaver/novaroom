-- Messages pinned for everyone in a chat. Run this after 20261118130000_message_replies.sql.
--
-- Anyone in a chat can pin one of its messages for everyone in it, and anyone in it can unpin it.
-- Pins a person makes only for themselves stay on their computer and are not kept here.

create table if not exists public.pinned_messages (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  message_id uuid not null references public.messages (id) on delete cascade,
  pinned_by uuid references public.profiles (id) on delete set null,
  pinned_at timestamptz not null default now(),
  primary key (conversation_id, message_id)
);

alter table public.pinned_messages enable row level security;

drop policy if exists "Members see their chats' pinned messages" on public.pinned_messages;
create policy "Members see their chats' pinned messages"
  on public.pinned_messages
  for select
  to authenticated
  using (public.is_conversation_member(conversation_id));

-- The message must be one of that chat's.
drop policy if exists "Members pin messages of their chats" on public.pinned_messages;
create policy "Members pin messages of their chats"
  on public.pinned_messages
  for insert
  to authenticated
  with check (
    pinned_by = auth.uid()
    and public.is_conversation_member(conversation_id)
    and exists (
      select 1 from public.messages m
      where m.id = message_id and m.conversation_id = pinned_messages.conversation_id
    )
  );

drop policy if exists "Members unpin messages of their chats" on public.pinned_messages;
create policy "Members unpin messages of their chats"
  on public.pinned_messages
  for delete
  to authenticated
  using (public.is_conversation_member(conversation_id));

grant select, insert, delete on public.pinned_messages to authenticated;
grant select, insert, update, delete on public.pinned_messages to service_role;

-- Stream pins so they appear for everyone in the chat at once.
do $$
begin
  alter publication supabase_realtime add table public.pinned_messages;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
