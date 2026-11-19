-- Voice calls between the two people of a direct chat. Run this after 20261119120000_vault_shares.sql.
--
-- The sound of a call goes straight between the two apps and is never kept here. This table only
-- carries the short messages the apps use to set a call up ("ringing", "accepted", how to reach
-- each other, "ended"). The apps delete them when the call is over.

create table if not exists public.call_signals (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('ring', 'accept', 'decline', 'busy', 'offer', 'answer', 'ice', 'end')),
  payload jsonb check (payload is null or octet_length(payload::text) <= 20000),
  created_at timestamptz not null default now(),
  check (sender_id <> recipient_id)
);

create index if not exists call_signals_recipient_idx on public.call_signals (recipient_id, created_at);
create index if not exists call_signals_call_idx on public.call_signals (call_id);

alter table public.call_signals enable row level security;

-- True when the signed-in person may call `other` in this chat: it is a direct chat, both of them
-- are in it, and neither has blocked the other.
create or replace function public.can_call(cid uuid, other uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
      select 1 from public.conversations c
      where c.id = cid and c.kind = 'direct'
    )
    and exists (
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

drop policy if exists "People see their own call signals" on public.call_signals;
create policy "People see their own call signals"
  on public.call_signals
  for select
  to authenticated
  using (recipient_id = auth.uid() or sender_id = auth.uid());

drop policy if exists "People signal calls in their direct chats" on public.call_signals;
create policy "People signal calls in their direct chats"
  on public.call_signals
  for insert
  to authenticated
  with check (
    sender_id = auth.uid()
    and recipient_id <> auth.uid()
    and public.can_call(conversation_id, recipient_id)
  );

drop policy if exists "People clear their own call signals" on public.call_signals;
create policy "People clear their own call signals"
  on public.call_signals
  for delete
  to authenticated
  using (recipient_id = auth.uid() or sender_id = auth.uid());

grant select, insert, delete on public.call_signals to authenticated;
grant select, insert, update, delete on public.call_signals to service_role;

-- Stream the signals, so a call rings on the other person's app at once.
do $$
begin
  alter publication supabase_realtime add table public.call_signals;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
