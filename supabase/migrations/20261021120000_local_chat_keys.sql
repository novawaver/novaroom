-- Keys for Local chat (chat over the office network, without internet). Run this after
-- 20261019160000_admin_chat_start.sql.
--
-- Each Novaroom install makes a key pair for each account that signs in on it and registers the
-- public half here while online. On the office network, apps prove who they are with the private
-- half, and others check it against the keys they downloaded from here the last time they were
-- online. Local chat messages themselves never come here.
--
-- Anyone may register any key for their own account only. Registering someone else's public key
-- for yourself gains nothing: only its owner holds the private half, so only they can use it.

create table if not exists public.local_chat_keys (
  user_id uuid not null references public.profiles (id) on delete cascade,
  public_key text not null check (public_key ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  primary key (user_id, public_key)
);

alter table public.local_chat_keys enable row level security;

drop policy if exists "Users read local chat keys" on public.local_chat_keys;
create policy "Users read local chat keys" on public.local_chat_keys
  for select to authenticated using (true);

drop policy if exists "Users add their local chat keys" on public.local_chat_keys;
create policy "Users add their local chat keys" on public.local_chat_keys
  for insert to authenticated with check (user_id = auth.uid());

-- People can remove their own keys (e.g. an old computer); admins can remove anyone's.
drop policy if exists "Users remove their local chat keys" on public.local_chat_keys;
create policy "Users remove their local chat keys" on public.local_chat_keys
  for delete to authenticated using (user_id = auth.uid() or public.is_admin());
