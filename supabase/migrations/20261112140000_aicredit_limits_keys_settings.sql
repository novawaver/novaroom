-- Credits limit, estimated reward, stored API keys (admin-only), reward %, tx explorer URL.

create table if not exists public.aicredit_earn_settings (
  id smallint primary key default 1 check (id = 1),
  reward_percentage numeric(7, 4) not null default 0.30,
  updated_at timestamptz not null default now(),
  constraint aicredit_earn_settings_pct check (reward_percentage > 0 and reward_percentage <= 1)
);

insert into public.aicredit_earn_settings (id) values (1) on conflict (id) do nothing;

alter table public.aicredit_earn_settings enable row level security;

alter table public.aicredit_reward_requests
  add column if not exists credits_limit_usd numeric(18, 2),
  add column if not exists estimated_reward_usd numeric(18, 6),
  add column if not exists api_key_secret text;

alter table public.aicredit_reward_transactions
  add column if not exists explorer_url text;

create or replace function public.aicredit_earn_settings_public()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'rewardPercentage', s.reward_percentage,
    'rewardPercentageDisplay', round(s.reward_percentage * 100, 2)
  )
  from public.aicredit_earn_settings s
  where s.id = 1;
$$;

grant execute on function public.aicredit_earn_settings_public() to anon, authenticated;

create or replace function public.admin_get_earn_settings()
returns public.aicredit_earn_settings
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.require_admin();
  return (select s from public.aicredit_earn_settings s where s.id = 1);
end;
$$;

create or replace function public.admin_update_earn_settings(p_reward_percentage numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_admin();
  if p_reward_percentage is null or p_reward_percentage <= 0 or p_reward_percentage > 1 then
    raise exception 'Reward percentage must be between 0 and 1';
  end if;
  update public.aicredit_earn_settings
  set reward_percentage = p_reward_percentage, updated_at = now()
  where id = 1;
  perform public.write_activity('admin', 'aicredit.earn_settings', 'Updated earn room reward percentage');
end;
$$;

grant execute on function public.admin_get_earn_settings() to authenticated;
grant execute on function public.admin_update_earn_settings(numeric) to authenticated;

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
  credits_limit_usd numeric,
  estimated_reward_usd numeric,
  api_key_secret text,
  transaction_hash text,
  transaction_explorer_url text,
  verification jsonb,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
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
    r.credits_limit_usd,
    r.estimated_reward_usd,
    r.api_key_secret,
    t.transaction_hash,
    t.explorer_url,
    r.verification,
    r.created_at,
    r.updated_at
  from public.aicredit_reward_requests r
  join public.profiles p on p.id = r.user_id
  join auth.users u on u.id = r.user_id
  left join public.aicredit_reward_transactions t on t.reward_request_id = r.id
  where r.conversation_id = room
  order by r.created_at desc;
end;
$$;

grant execute on function public.admin_list_aicredit_requests(uuid) to authenticated;

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
  reward_notes text,
  transaction_explorer_url text
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
      blockchain_status, transaction_date, explorer_url
    )
    values (
      request_id, transaction_hash, reward_amount, req.wallet_address,
      coalesce(nullif(btrim(blockchain_status), ''), 'pending'),
      transaction_date,
      nullif(btrim(transaction_explorer_url), '')
    )
    on conflict (reward_request_id) do update set
      transaction_hash = excluded.transaction_hash,
      amount = excluded.amount,
      blockchain_status = excluded.blockchain_status,
      transaction_date = excluded.transaction_date,
      explorer_url = coalesce(excluded.explorer_url, public.aicredit_reward_transactions.explorer_url);
  elsif nullif(btrim(transaction_explorer_url), '') is not null then
    update public.aicredit_reward_transactions
    set explorer_url = nullif(btrim(transaction_explorer_url), '')
    where reward_request_id = request_id;
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

grant execute on function public.admin_update_aicredit_request(
  uuid, text, text, numeric, text, timestamptz, text, text, text
) to authenticated;
