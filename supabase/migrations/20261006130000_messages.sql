-- One-to-one chats. Run this after 20261006120000_profiles.sql.
-- Review these row level security rules before launch.

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  direct_key text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  primary key (conversation_id, user_id)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(btrim(body)) > 0 and char_length(body) <= 4000),
  created_at timestamptz not null default now()
);

create index if not exists conversation_members_user_idx
  on public.conversation_members (user_id);

create index if not exists messages_conversation_created_idx
  on public.messages (conversation_id, created_at);

alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;

create or replace function public.is_conversation_member(cid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.conversation_members
    where conversation_id = cid
      and user_id = auth.uid()
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

revoke all on function public.is_conversation_member(uuid) from public;
revoke all on function public.start_direct_chat(text) from public;
grant execute on function public.is_conversation_member(uuid) to authenticated;
grant execute on function public.start_direct_chat(text) to authenticated;

create policy "Members can see their conversations"
  on public.conversations
  for select
  to authenticated
  using (public.is_conversation_member(id));

create policy "Members can see participants"
  on public.conversation_members
  for select
  to authenticated
  using (public.is_conversation_member(conversation_id));

create policy "Members can read messages"
  on public.messages
  for select
  to authenticated
  using (public.is_conversation_member(conversation_id));

create policy "Members can send their own messages"
  on public.messages
  for insert
  to authenticated
  with check (
    sender_id = auth.uid()
    and public.is_conversation_member(conversation_id)
  );

do $$
begin
  alter publication supabase_realtime add table public.messages;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
