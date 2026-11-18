-- Referral program for earn-reward-aicredits (extends 20261110120000).

-- Referral codes on profiles
alter table public.profiles
  add column if not exists referral_code text;

create unique index if not exists profiles_referral_code_uidx
  on public.profiles (referral_code)
  where referral_code is not null and referral_code <> '';

create or replace function public.aicredit_random_referral_code()
returns text
language plpgsql
volatile
as $$
declare
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  out text := '';
  i int;
begin
  for i in 1..8 loop
    out := out || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return out;
end;
$$;

create or replace function public.aicredit_ensure_profile_referral_code(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  existing text;
  candidate text;
  attempts int := 0;
begin
  select referral_code into existing from public.profiles where id = p_user_id;
  if coalesce(existing, '') <> '' then
    return existing;
  end if;
  loop
    attempts := attempts + 1;
    candidate := public.aicredit_random_referral_code();
    begin
      update public.profiles set referral_code = candidate, updated_at = now()
      where id = p_user_id and coalesce(referral_code, '') = '';
      if found then
        return candidate;
      end if;
      select referral_code into existing from public.profiles where id = p_user_id;
      if coalesce(existing, '') <> '' then
        return existing;
      end if;
    exception when unique_violation then
      null;
    end;
    exit when attempts > 25;
  end loop;
  raise exception 'Could not assign referral code';
end;
$$;

-- Backfill existing profiles (idempotent)
do $$
declare
  r record;
begin
  for r in select id from public.profiles where coalesce(referral_code, '') = '' loop
    perform public.aicredit_ensure_profile_referral_code(r.id);
  end loop;
end;
$$;

create or replace function public.aicredit_profiles_referral_code_on_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(new.referral_code, '') = '' then
    perform public.aicredit_ensure_profile_referral_code(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists aicredit_profiles_referral_code on public.profiles;
create trigger aicredit_profiles_referral_code
  after insert on public.profiles
  for each row execute function public.aicredit_profiles_referral_code_on_insert();

-- Program settings (singleton row)
create table if not exists public.aicredit_referral_settings (
  id smallint primary key default 1 check (id = 1),
  enabled boolean not null default false,
  allow_new_referrals boolean not null default true,
  reward_type text not null default 'fixed' check (reward_type in ('fixed')),
  fixed_reward_amount numeric(18, 6),
  currency text not null default 'USDT',
  network text not null default 'bep20',
  attribution_days int not null default 30 check (attribution_days between 1 and 365),
  max_rewards_per_user int,
  require_primary_reward_confirmation boolean not null default true,
  require_manual_approval boolean not null default true,
  require_fraud_checks boolean not null default true,
  one_bonus_per_referred_user boolean not null default true,
  terms text not null default '',
  program_description text not null default '',
  updated_at timestamptz not null default now()
);

insert into public.aicredit_referral_settings (id)
values (1)
on conflict (id) do nothing;

alter table public.aicredit_referral_settings enable row level security;

create table if not exists public.aicredit_referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references public.profiles (id) on delete cascade,
  referred_user_id uuid not null references public.profiles (id) on delete cascade,
  referral_code text not null,
  status text not null default 'registered',
  attribution_date timestamptz not null default now(),
  registration_date timestamptz not null default now(),
  qualification_date timestamptz,
  qualified_reward_request_id uuid references public.aicredit_reward_requests (id) on delete set null,
  rejection_reason text,
  reward_snapshot_amount numeric(18, 6),
  reward_snapshot_currency text,
  reward_snapshot_network text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint aicredit_referrals_status_check check (
    status in (
      'invited', 'registered', 'in_progress', 'qualified', 'pending_approval',
      'approved', 'paid', 'rejected', 'cancelled'
    )
  ),
  constraint aicredit_referrals_not_self check (referrer_id <> referred_user_id),
  constraint aicredit_referrals_referred_unique unique (referred_user_id)
);

create index if not exists aicredit_referrals_referrer_idx
  on public.aicredit_referrals (referrer_id, created_at desc);

create table if not exists public.aicredit_referral_bonuses (
  id uuid primary key default gen_random_uuid(),
  referral_id uuid not null unique references public.aicredit_referrals (id) on delete cascade,
  referrer_id uuid not null references public.profiles (id) on delete cascade,
  amount numeric(18, 6) not null,
  currency text not null default 'USDT',
  network text not null default 'bep20',
  status text not null default 'pending_approval',
  approved_by uuid references public.profiles (id) on delete set null,
  approved_at timestamptz,
  paid_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint aicredit_referral_bonuses_status_check check (
    status in ('pending_approval', 'approved', 'paid', 'rejected', 'cancelled')
  )
);

create index if not exists aicredit_referral_bonuses_referrer_idx
  on public.aicredit_referral_bonuses (referrer_id, created_at desc);

create table if not exists public.aicredit_referral_payouts (
  id uuid primary key default gen_random_uuid(),
  referral_bonus_id uuid not null unique references public.aicredit_referral_bonuses (id) on delete cascade,
  wallet_address text not null,
  amount numeric(18, 6) not null,
  currency text not null default 'USDT',
  network text not null default 'bep20',
  transaction_hash text,
  blockchain_status text not null default 'pending',
  processed_by uuid references public.profiles (id) on delete set null,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint aicredit_referral_payouts_hash_check check (
    transaction_hash is null or transaction_hash ~ '^0x[a-fA-F0-9]{64}$'
  ),
  constraint aicredit_referral_payouts_chain_status_check check (
    blockchain_status in ('pending', 'verified', 'failed', 'unavailable')
  )
);

alter table public.aicredit_referrals enable row level security;
alter table public.aicredit_referral_bonuses enable row level security;
alter table public.aicredit_referral_payouts enable row level security;

drop policy if exists "Referrers read own referrals" on public.aicredit_referrals;
create policy "Referrers read own referrals"
  on public.aicredit_referrals for select to authenticated
  using (referrer_id = auth.uid() or referred_user_id = auth.uid() or public.is_admin());

drop policy if exists "Referrers read own bonuses" on public.aicredit_referral_bonuses;
create policy "Referrers read own bonuses"
  on public.aicredit_referral_bonuses for select to authenticated
  using (referrer_id = auth.uid() or public.is_admin());

drop policy if exists "Referrers read own payouts" on public.aicredit_referral_payouts;
create policy "Referrers read own payouts"
  on public.aicredit_referral_payouts for select to authenticated
  using (
    exists (
      select 1 from public.aicredit_referral_bonuses b
      where b.id = referral_bonus_id and b.referrer_id = auth.uid()
    )
    or public.is_admin()
  );

create or replace function public.aicredit_referral_settings_row()
returns public.aicredit_referral_settings
language sql
stable
security definer
set search_path = public
as $$
  select * from public.aicredit_referral_settings where id = 1;
$$;

create or replace function public.aicredit_referral_public_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s public.aicredit_referral_settings%rowtype;
begin
  select * into s from public.aicredit_referral_settings where id = 1;
  return jsonb_build_object(
    'enabled', s.enabled,
    'allowNewReferrals', s.allow_new_referrals,
    'rewardType', s.reward_type,
    'fixedRewardAmount', s.fixed_reward_amount,
    'currency', s.currency,
    'network', s.network,
    'attributionDays', s.attribution_days,
    'terms', s.terms,
    'programDescription', s.program_description,
    'requireManualApproval', s.require_manual_approval
  );
end;
$$;

revoke all on function public.aicredit_referral_public_settings() from public, anon;
grant execute on function public.aicredit_referral_public_settings() to anon, authenticated;

create or replace function public.aicredit_lookup_referral_code(code text)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  rid uuid;
  normalized text;
  s public.aicredit_referral_settings%rowtype;
begin
  normalized := upper(btrim(code));
  if normalized !~ '^[A-Z0-9]{6,12}$' then
    return null;
  end if;
  select * into s from public.aicredit_referral_settings where id = 1;
  if not s.enabled or not s.allow_new_referrals then
    return null;
  end if;
  select id into rid from public.profiles where referral_code = normalized;
  return rid;
end;
$$;

revoke all on function public.aicredit_lookup_referral_code(text) from public;
grant execute on function public.aicredit_lookup_referral_code(text) to anon, authenticated;

create or replace function public.aicredit_apply_referral(code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  referrer uuid;
  normalized text;
  s public.aicredit_referral_settings%rowtype;
  ref_id uuid;
  existing uuid;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;

  select * into s from public.aicredit_referral_settings where id = 1;
  if not s.enabled or not s.allow_new_referrals then
    return jsonb_build_object('ok', false, 'reason', 'program_disabled');
  end if;

  normalized := upper(btrim(code));
  referrer := public.aicredit_lookup_referral_code(normalized);
  if referrer is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_code');
  end if;
  if referrer = uid then
    return jsonb_build_object('ok', false, 'reason', 'self_referral');
  end if;

  select id into existing from public.aicredit_referrals where referred_user_id = uid;
  if existing is not null then
    return jsonb_build_object('ok', false, 'reason', 'already_attributed');
  end if;

  perform public.aicredit_ensure_profile_referral_code(uid);
  perform public.aicredit_ensure_profile_referral_code(referrer);

  insert into public.aicredit_referrals (
    referrer_id, referred_user_id, referral_code, status,
    attribution_date, registration_date
  )
  values (referrer, uid, normalized, 'registered', now(), now())
  returning id into ref_id;

  perform public.write_activity(
    'account',
    'aicredit.referral.registered',
    'New referral registration',
    referrer,
    null,
    jsonb_build_object('referral_id', ref_id, 'referred_user_id', uid)
  );

  return jsonb_build_object('ok', true, 'referralId', ref_id);
end;
$$;

revoke all on function public.aicredit_apply_referral(text) from public, anon;
grant execute on function public.aicredit_apply_referral(text) to authenticated;

create or replace function public.aicredit_referral_me()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  code text;
  s public.aicredit_referral_settings%rowtype;
  stats jsonb;
begin
  if uid is null then raise exception 'Not signed in'; end if;
  code := public.aicredit_ensure_profile_referral_code(uid);
  select * into s from public.aicredit_referral_settings where id = 1;

  select jsonb_build_object(
    'totalReferrals', count(*) filter (where r.status not in ('invited', 'rejected', 'cancelled')),
    'qualifiedReferrals', count(*) filter (where r.status in ('qualified', 'pending_approval', 'approved', 'paid')),
    'pendingRewards', coalesce((
      select sum(b.amount) from public.aicredit_referral_bonuses b
      where b.referrer_id = uid and b.status in ('pending_approval', 'approved')
    ), 0),
    'totalEarned', coalesce((
      select sum(b.amount) from public.aicredit_referral_bonuses b
      where b.referrer_id = uid and b.status = 'paid'
    ), 0)
  ) into stats
  from public.aicredit_referrals r
  where r.referrer_id = uid;

  return jsonb_build_object(
    'referralCode', code,
    'program', public.aicredit_referral_public_settings(),
    'stats', coalesce(stats, '{"totalReferrals":0,"qualifiedReferrals":0,"pendingRewards":0,"totalEarned":0}'::jsonb)
  );
end;
$$;

grant execute on function public.aicredit_referral_me() to authenticated;

create or replace function public.aicredit_referral_mark_in_progress(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.aicredit_referrals
  set status = 'in_progress', updated_at = now()
  where referred_user_id = p_user
    and status = 'registered';
end;
$$;

create or replace function public.aicredit_process_referral_qualification(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  req public.aicredit_reward_requests%rowtype;
  ref public.aicredit_referrals%rowtype;
  s public.aicredit_referral_settings%rowtype;
  bonus_id uuid;
  next_ref_status text;
  next_bonus_status text;
begin
  select * into s from public.aicredit_referral_settings where id = 1;
  if not s.enabled then return; end if;

  select * into req from public.aicredit_reward_requests where id = p_request_id;
  if not found or req.status <> 'confirmed' then return; end if;

  select * into ref from public.aicredit_referrals where referred_user_id = req.user_id;
  if not found then return; end if;
  if ref.status in ('paid', 'rejected', 'cancelled') then return; end if;
  if ref.qualified_reward_request_id is not null and ref.qualified_reward_request_id <> p_request_id then
    return;
  end if;

  if exists (select 1 from public.aicredit_referral_bonuses b where b.referral_id = ref.id) then
    return;
  end if;

  if s.fixed_reward_amount is null or s.fixed_reward_amount <= 0 then
    return;
  end if;

  if s.require_primary_reward_confirmation and req.status <> 'confirmed' then
    return;
  end if;

  next_ref_status := case when s.require_manual_approval then 'pending_approval' else 'approved' end;
  next_bonus_status := case when s.require_manual_approval then 'pending_approval' else 'approved' end;

  update public.aicredit_referrals
  set
    status = next_ref_status,
    qualification_date = now(),
    qualified_reward_request_id = p_request_id,
    reward_snapshot_amount = s.fixed_reward_amount,
    reward_snapshot_currency = s.currency,
    reward_snapshot_network = s.network,
    updated_at = now()
  where id = ref.id;

  insert into public.aicredit_referral_bonuses (
    referral_id, referrer_id, amount, currency, network, status,
    approved_by, approved_at
  )
  values (
    ref.id, ref.referrer_id, s.fixed_reward_amount, s.currency, s.network, next_bonus_status,
    case when next_bonus_status = 'approved' then null else null end,
    case when next_bonus_status = 'approved' then now() else null end
  )
  on conflict (referral_id) do nothing
  returning id into bonus_id;

  if bonus_id is null then
    return;
  end if;

  perform public.write_activity(
    'account',
    'aicredit.referral.qualified',
    'Referral qualified for bonus',
    ref.referrer_id,
    null,
    jsonb_build_object('referral_id', ref.id, 'bonus_id', bonus_id, 'request_id', p_request_id)
  );
end;
$$;

revoke all on function public.aicredit_process_referral_qualification(uuid) from public, anon;
grant execute on function public.aicredit_referral_mark_in_progress(uuid) to authenticated;
grant execute on function public.aicredit_process_referral_qualification(uuid) to authenticated;

-- Hook qualification after primary reward confirmation
create or replace function public.aicredit_confirm_request(request_id uuid, message_body text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
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

  perform public.aicredit_process_referral_qualification(request_id);
end;
$$;

create or replace function public.aicredit_referral_history(
  page_limit int default 25,
  page_offset int default 0
)
returns table (
  referral_id uuid,
  referred_label text,
  status text,
  bonus_amount numeric,
  bonus_status text,
  registered_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Not signed in'; end if;
  return query
  select
    r.id,
    coalesce(
      nullif(btrim(p.display_name), ''),
      'User ' || left(r.referred_user_id::text, 8)
    ),
    r.status,
    coalesce(b.amount, r.reward_snapshot_amount),
    coalesce(b.status, 'none'),
    r.registration_date,
    r.updated_at
  from public.aicredit_referrals r
  join public.profiles p on p.id = r.referred_user_id
  left join public.aicredit_referral_bonuses b on b.referral_id = r.id
  where r.referrer_id = uid
  order by r.created_at desc
  limit greatest(1, least(page_limit, 100))
  offset greatest(0, page_offset);
end;
$$;

grant execute on function public.aicredit_referral_history(int, int) to authenticated;

create or replace function public.aicredit_referral_detail(p_referral_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  row_rec record;
  bonus_rec record;
  payout_rec record;
begin
  if uid is null then raise exception 'Not signed in'; end if;

  select r.*, coalesce(nullif(p.display_name, ''), 'User') as referred_label
  into row_rec
  from public.aicredit_referrals r
  join public.profiles p on p.id = r.referred_user_id
  where r.id = p_referral_id and r.referrer_id = uid;
  if not found then raise exception 'Not found'; end if;

  select * into bonus_rec from public.aicredit_referral_bonuses where referral_id = p_referral_id;
  select * into payout_rec from public.aicredit_referral_payouts where referral_bonus_id = bonus_rec.id;

  return jsonb_build_object(
    'id', row_rec.id,
    'status', row_rec.status,
    'referredLabel', row_rec.referred_label,
    'registeredAt', row_rec.registration_date,
    'qualificationDate', row_rec.qualification_date,
    'qualifiedRewardRequestId', row_rec.qualified_reward_request_id,
    'rejectionReason', row_rec.rejection_reason,
    'rewardAmount', coalesce(bonus_rec.amount, row_rec.reward_snapshot_amount),
    'currency', coalesce(bonus_rec.currency, row_rec.reward_snapshot_currency),
    'bonusStatus', bonus_rec.status,
    'payout', case when payout_rec.id is null then null else jsonb_build_object(
      'transactionHash', payout_rec.transaction_hash,
      'blockchainStatus', payout_rec.blockchain_status,
      'walletAddress', left(payout_rec.wallet_address, 6) || '…' || right(payout_rec.wallet_address, 4),
      'processedAt', payout_rec.processed_at
    ) end
  );
end;
$$;

grant execute on function public.aicredit_referral_detail(uuid) to authenticated;

-- Admin
drop function if exists public.admin_list_referrals(text, int, int);
create function public.admin_list_referrals(
  status_filter text default null,
  page_limit int default 50,
  page_offset int default 0
)
returns table (
  referral_id uuid,
  referrer_name text,
  referred_name text,
  status text,
  bonus_amount numeric,
  bonus_status text,
  registered_at timestamptz,
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
    coalesce(nullif(pr.display_name, ''), 'Unnamed'),
    coalesce(nullif(pd.display_name, ''), 'Unnamed'),
    r.status,
    b.amount,
    b.status,
    r.registration_date,
    r.updated_at
  from public.aicredit_referrals r
  join public.profiles pr on pr.id = r.referrer_id
  join public.profiles pd on pd.id = r.referred_user_id
  left join public.aicredit_referral_bonuses b on b.referral_id = r.id
  where status_filter is null or btrim(status_filter) = '' or r.status = status_filter
  order by r.created_at desc
  limit greatest(1, least(page_limit, 200))
  offset greatest(0, page_offset);
end;
$$;

create or replace function public.admin_approve_referral(p_referral_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_admin();
  update public.aicredit_referrals
  set status = 'approved', updated_at = now()
  where id = p_referral_id and status in ('qualified', 'pending_approval');
  update public.aicredit_referral_bonuses
  set status = 'approved', approved_by = auth.uid(), approved_at = now(), updated_at = now()
  where referral_id = p_referral_id and status = 'pending_approval';
  perform public.write_activity('admin', 'aicredit.referral.approve', 'Approved referral bonus', null, null,
    jsonb_build_object('referral_id', p_referral_id));
end;
$$;

create or replace function public.admin_reject_referral(p_referral_id uuid, reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_admin();
  update public.aicredit_referrals
  set status = 'rejected', rejection_reason = nullif(btrim(reason), ''), updated_at = now()
  where id = p_referral_id;
  update public.aicredit_referral_bonuses
  set status = 'rejected', rejection_reason = nullif(btrim(reason), ''), updated_at = now()
  where referral_id = p_referral_id;
  perform public.write_activity('admin', 'aicredit.referral.reject', 'Rejected referral', null, null,
    jsonb_build_object('referral_id', p_referral_id, 'reason', reason));
end;
$$;

create or replace function public.admin_record_referral_payout(
  p_referral_id uuid,
  wallet_address text,
  transaction_hash text,
  amount numeric,
  blockchain_status text,
  processed_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  bonus public.aicredit_referral_bonuses%rowtype;
begin
  perform public.require_admin();
  select * into bonus from public.aicredit_referral_bonuses b
  join public.aicredit_referrals r on r.id = b.referral_id
  where r.id = p_referral_id and b.status = 'approved';
  if not found then raise exception 'Approved bonus not found'; end if;
  if transaction_hash !~ '^0x[a-fA-F0-9]{64}$' then
    raise exception 'Invalid transaction hash';
  end if;

  insert into public.aicredit_referral_payouts (
    referral_bonus_id, wallet_address, amount, currency, network,
    transaction_hash, blockchain_status, processed_by, processed_at
  )
  values (
    bonus.id, btrim(wallet_address), coalesce(amount, bonus.amount), bonus.currency, bonus.network,
    transaction_hash, coalesce(nullif(btrim(blockchain_status), ''), 'pending'), auth.uid(),
    coalesce(processed_at, now())
  )
  on conflict (referral_bonus_id) do update set
    wallet_address = excluded.wallet_address,
    amount = excluded.amount,
    transaction_hash = excluded.transaction_hash,
    blockchain_status = excluded.blockchain_status,
    processed_by = excluded.processed_by,
    processed_at = excluded.processed_at,
    updated_at = now();

  update public.aicredit_referral_bonuses
  set status = 'paid', paid_at = coalesce(processed_at, now()), updated_at = now()
  where id = bonus.id;

  update public.aicredit_referrals
  set status = 'paid', updated_at = now()
  where id = p_referral_id;

  perform public.write_activity('admin', 'aicredit.referral.paid', 'Recorded referral payout', bonus.referrer_id, null,
    jsonb_build_object('referral_id', p_referral_id, 'tx', transaction_hash));
end;
$$;

create or replace function public.admin_get_referral_settings()
returns public.aicredit_referral_settings
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.require_admin();
  return public.aicredit_referral_settings_row();
end;
$$;

create or replace function public.admin_update_referral_settings(
  p_enabled boolean,
  p_allow_new boolean,
  p_fixed_amount numeric,
  p_attribution_days int,
  p_max_rewards int,
  p_require_confirmation boolean,
  p_require_manual boolean,
  p_terms text,
  p_description text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_admin();
  update public.aicredit_referral_settings
  set
    enabled = p_enabled,
    allow_new_referrals = p_allow_new,
    fixed_reward_amount = p_fixed_amount,
    attribution_days = coalesce(p_attribution_days, 30),
    max_rewards_per_user = p_max_rewards,
    require_primary_reward_confirmation = coalesce(p_require_confirmation, true),
    require_manual_approval = coalesce(p_require_manual, true),
    terms = coalesce(p_terms, ''),
    program_description = coalesce(p_description, ''),
    updated_at = now()
  where id = 1;
  perform public.write_activity('admin', 'aicredit.referral.settings', 'Updated referral settings');
end;
$$;

grant execute on function public.admin_list_referrals(text, int, int) to authenticated;
grant execute on function public.admin_approve_referral(uuid) to authenticated;
grant execute on function public.admin_reject_referral(uuid, text) to authenticated;
grant execute on function public.admin_record_referral_payout(uuid, text, text, numeric, text, timestamptz) to authenticated;
grant execute on function public.admin_get_referral_settings() to authenticated;
grant execute on function public.admin_update_referral_settings(boolean, boolean, numeric, int, int, boolean, boolean, text, text) to authenticated;

revoke all on function public.aicredit_ensure_profile_referral_code(uuid) from public;
grant execute on function public.aicredit_ensure_profile_referral_code(uuid) to authenticated;
