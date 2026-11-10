-- AI credit reward requests for the earn-reward-aicredits room web app.
-- Run after 20261109150000_room_slugs.sql.
--
-- Members submit reward requests from the room web page; admins manage them in novaroom-admin.
-- API keys are never stored — only verification snapshots.

create table if not exists public.aicredit_reward_requests (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  provider_slug text not null,
  provider_name text not null,
  subscription_plan text,
  subscription_self_reported boolean not null default true,
  verification jsonb not null,
  wallet_address text not null,
  wallet_network text not null default 'bep20',
  cryptocurrency text not null default 'USDT',
  wallet_label text,
  status text not null default 'pending_verification',
  rejection_reason text,
  reward_amount numeric(18, 6),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint aicredit_reward_requests_status_check check (
    status in (
      'pending_verification',
      'eligible',
      'pending_reward',
      'rewarded',
      'confirmed',
      'rejected'
    )
  ),
  constraint aicredit_reward_requests_verification_size check (char_length(verification::text) <= 20000)
);

create index if not exists aicredit_reward_requests_room_idx
  on public.aicredit_reward_requests (conversation_id, created_at desc);
create index if not exists aicredit_reward_requests_user_idx
  on public.aicredit_reward_requests (user_id, created_at desc);

create table if not exists public.aicredit_reward_transactions (
  id uuid primary key default gen_random_uuid(),
  reward_request_id uuid not null unique references public.aicredit_reward_requests (id) on delete cascade,
  transaction_hash text not null,
  cryptocurrency text not null default 'USDT',
  network text not null default 'bep20',
  amount numeric(18, 6) not null,
  recipient_address text not null,
  blockchain_status text not null default 'pending',
  transaction_date timestamptz not null,
  created_at timestamptz not null default now(),
  constraint aicredit_reward_transactions_hash_check check (transaction_hash ~ '^0x[a-fA-F0-9]{64}$'),
  constraint aicredit_reward_transactions_chain_status_check check (
    blockchain_status in ('pending', 'verified', 'failed', 'unavailable')
  )
);

create table if not exists public.aicredit_reward_messages (
  id uuid primary key default gen_random_uuid(),
  reward_request_id uuid not null references public.aicredit_reward_requests (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint aicredit_reward_messages_content_size check (char_length(content) <= 4000)
);

create index if not exists aicredit_reward_messages_request_idx
  on public.aicredit_reward_messages (reward_request_id, created_at asc);

alter table public.aicredit_reward_requests enable row level security;
alter table public.aicredit_reward_transactions enable row level security;
alter table public.aicredit_reward_messages enable row level security;

grant select, insert on public.aicredit_reward_requests to authenticated;
grant select on public.aicredit_reward_transactions to authenticated;
grant select, insert on public.aicredit_reward_messages to authenticated;

drop policy if exists "Members read own aicredit requests" on public.aicredit_reward_requests;
create policy "Members read own aicredit requests"
  on public.aicredit_reward_requests for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "Members create aicredit requests" on public.aicredit_reward_requests;
create policy "Members create aicredit requests"
  on public.aicredit_reward_requests for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.is_conversation_member(conversation_id)
  );

drop policy if exists "Members read txs for own requests" on public.aicredit_reward_transactions;
create policy "Members read txs for own requests"
  on public.aicredit_reward_transactions for select to authenticated
  using (
    exists (
      select 1 from public.aicredit_reward_requests r
      where r.id = reward_request_id and r.user_id = auth.uid()
    )
  );

drop policy if exists "Members read messages on own requests" on public.aicredit_reward_messages;
create policy "Members read messages on own requests"
  on public.aicredit_reward_messages for select to authenticated
  using (
    exists (
      select 1 from public.aicredit_reward_requests r
      where r.id = reward_request_id and r.user_id = auth.uid()
    )
    or public.is_admin()
  );

drop policy if exists "Members send messages on own requests" on public.aicredit_reward_messages;
create policy "Members send messages on own requests"
  on public.aicredit_reward_messages for insert to authenticated
  with check (
    sender_id = auth.uid()
    and (
      exists (
        select 1 from public.aicredit_reward_requests r
        where r.id = reward_request_id and r.user_id = auth.uid()
      )
      or public.is_admin()
    )
  );

-- Room id for the web app (member-only metadata).
drop function if exists public.aicredit_room_by_slug(text);
create function public.aicredit_room_by_slug(slug text)
returns table (room_id uuid, title text, description text, joined boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  cid uuid;
begin
  select c.id into cid
  from public.conversations c
  where c.kind = 'room' and c.slug = lower(btrim(aicredit_room_by_slug.slug));
  if cid is null then return; end if;

  return query
  select
    c.id,
    coalesce(nullif(btrim(c.title), ''), 'Room'),
    coalesce(nullif(btrim(c.description), ''), ''),
    public.is_conversation_member(c.id)
  from public.conversations c
  where c.id = cid;
end;
$$;

revoke all on function public.aicredit_room_by_slug(text) from public, anon;
grant execute on function public.aicredit_room_by_slug(text) to authenticated;

-- Confirm receipt (rewarded → confirmed) and post the confirmation message atomically.
drop function if exists public.aicredit_confirm_request(uuid, text);
create function public.aicredit_confirm_request(request_id uuid, message_body text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  rid uuid;
  req public.aicredit_reward_requests%rowtype;
  mid uuid;
begin
  if coalesce(btrim(message_body), '') = '' then
    raise exception 'Message is required';
  end if;
  if char_length(message_body) > 4000 then
    raise exception 'Message is too long';
  end if;

  select * into req
  from public.aicredit_reward_requests r
  where r.id = request_id and r.user_id = auth.uid();
  if not found then raise exception 'Request not found'; end if;
  if req.status = 'confirmed' then raise exception 'Already confirmed'; end if;
  if req.status <> 'rewarded' then raise exception 'Reward must be in rewarded status'; end if;
  rid := req.id;

  insert into public.aicredit_reward_messages (reward_request_id, sender_id, content, read_at)
  values (request_id, auth.uid(), btrim(message_body), now())
  returning id into mid;

  update public.aicredit_reward_requests
  set status = 'confirmed', updated_at = now()
  where id = request_id and status = 'rewarded';

  perform public.write_activity(
    'chat',
    'aicredit.confirmed',
    'Confirmed AI credit reward receipt',
    auth.uid(),
    req.conversation_id
  );
end;
$$;

revoke all on function public.aicredit_confirm_request(uuid, text) from public, anon;
grant execute on function public.aicredit_confirm_request(uuid, text) to authenticated;

drop function if exists public.admin_list_aicredit_requests(uuid);
create function public.admin_list_aicredit_requests(room uuid)
returns table (
  request_id uuid,
  user_id uuid,
  user_name text,
  user_email text,
  provider_slug text,
  provider_name text,
  subscription_plan text,
  status text,
  wallet_address text,
  reward_amount numeric,
  verification jsonb,
  created_at timestamptz,
  updated_at timestamptz
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
    r.id,
    r.user_id,
    coalesce(nullif(p.display_name, ''), 'Unnamed'),
    u.email::text,
    r.provider_slug,
    r.provider_name,
    r.subscription_plan,
    r.status,
    r.wallet_address,
    r.reward_amount,
    r.verification,
    r.created_at,
    r.updated_at
  from public.aicredit_reward_requests r
  join public.profiles p on p.id = r.user_id
  join auth.users u on u.id = r.user_id
  where r.conversation_id = room
  order by r.created_at desc;
end;
$$;

drop function if exists public.admin_update_aicredit_request(
  uuid, text, text, numeric, text, timestamptz, text, text
);
create function public.admin_update_aicredit_request(
  request_id uuid,
  new_status text,
  rejection_reason text,
  reward_amount numeric,
  transaction_hash text,
  transaction_date timestamptz,
  blockchain_status text,
  reward_notes text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  req public.aicredit_reward_requests%rowtype;
begin
  perform public.require_admin();

  if new_status not in (
    'pending_verification', 'eligible', 'pending_reward', 'rewarded', 'confirmed', 'rejected'
  ) then
    raise exception 'Invalid status';
  end if;

  select * into req from public.aicredit_reward_requests where id = request_id;
  if not found then raise exception 'Request not found'; end if;

  if new_status = 'rewarded' then
    if reward_amount is null or transaction_hash is null or transaction_date is null then
      raise exception 'Rewarded status requires amount, hash, and date';
    end if;
    if transaction_hash !~ '^0x[a-fA-F0-9]{64}$' then
      raise exception 'Invalid transaction hash';
    end if;
  end if;

  update public.aicredit_reward_requests
  set
    status = new_status,
    rejection_reason = case when new_status = 'rejected' then nullif(btrim(rejection_reason), '') else null end,
    reward_amount = coalesce(reward_amount, public.aicredit_reward_requests.reward_amount),
    updated_at = now()
  where id = request_id;

  if new_status = 'rewarded' then
    insert into public.aicredit_reward_transactions (
      reward_request_id, transaction_hash, amount, recipient_address,
      blockchain_status, transaction_date
    )
    values (
      request_id, transaction_hash, reward_amount, req.wallet_address,
      coalesce(nullif(btrim(blockchain_status), ''), 'pending'),
      transaction_date
    )
    on conflict (reward_request_id) do update set
      transaction_hash = excluded.transaction_hash,
      amount = excluded.amount,
      blockchain_status = excluded.blockchain_status,
      transaction_date = excluded.transaction_date;
  end if;

  perform public.write_activity(
    'admin',
    'aicredit.request',
    format('Updated AI credit request %s → %s', request_id, new_status),
    req.user_id,
    req.conversation_id,
    jsonb_build_object('request_id', request_id, 'status', new_status, 'notes', reward_notes)
  );
end;
$$;

revoke all on function public.admin_list_aicredit_requests(uuid) from public, anon;
revoke all on function public.admin_update_aicredit_request(
  uuid, text, text, numeric, text, timestamptz, text, text
) from public, anon;
grant execute on function public.admin_list_aicredit_requests(uuid) to authenticated;
grant execute on function public.admin_update_aicredit_request(
  uuid, text, text, numeric, text, timestamptz, text, text
) to authenticated;
