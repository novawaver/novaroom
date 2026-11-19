-- Rows and columns shared from a Vault table. Run this after 20261118140000_pinned_messages.sql.
--
-- A Vault stays in a file on its owner's computer. When they share some rows and columns of a table
-- with other registered people, a copy of just that part is kept here, one row per person it was
-- shared with, until that person (or the sender) removes it. Only the two of them can read it.

create table if not exists public.vault_shares (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles (id) on delete cascade,
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  table_name text not null check (char_length(table_name) <= 200),
  note text check (note is null or char_length(note) <= 500),
  -- { "name": text, "columns": [...], "rows": [...] }, as the app's Vault tables are kept.
  data jsonb not null check (octet_length(data::text) <= 2000000),
  created_at timestamptz not null default now(),
  check (sender_id <> recipient_id)
);

create index if not exists vault_shares_recipient_idx on public.vault_shares (recipient_id, created_at desc);
create index if not exists vault_shares_sender_idx on public.vault_shares (sender_id);

alter table public.vault_shares enable row level security;

drop policy if exists "People see what was shared with or by them" on public.vault_shares;
create policy "People see what was shared with or by them"
  on public.vault_shares
  for select
  to authenticated
  using (recipient_id = auth.uid() or sender_id = auth.uid());

-- Nobody can share with someone who blocked them, or whom they blocked.
drop policy if exists "People share their own data" on public.vault_shares;
create policy "People share their own data"
  on public.vault_shares
  for insert
  to authenticated
  with check (
    sender_id = auth.uid()
    and recipient_id <> auth.uid()
    and not public.either_blocked(sender_id, recipient_id)
  );

drop policy if exists "People remove what was shared with or by them" on public.vault_shares;
create policy "People remove what was shared with or by them"
  on public.vault_shares
  for delete
  to authenticated
  using (recipient_id = auth.uid() or sender_id = auth.uid());

grant select, insert, delete on public.vault_shares to authenticated;
grant select, insert, update, delete on public.vault_shares to service_role;

-- Stream shares so they show up for the person they were sent to right away.
do $$
begin
  alter publication supabase_realtime add table public.vault_shares;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
