-- Scope AI Credits referral program to the earn-reward-aicredits room (novaroom-room-aicredits).

alter table public.aicredit_referrals
  add column if not exists conversation_id uuid references public.conversations (id) on delete set null;

create or replace function public.aicredit_earn_room_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select c.id
  from public.conversations c
  where c.kind = 'room' and lower(btrim(c.slug)) = 'earn-reward-aicredits'
  limit 1;
$$;

revoke all on function public.aicredit_earn_room_id() from public, anon;
grant execute on function public.aicredit_earn_room_id() to authenticated;

update public.aicredit_referrals
set conversation_id = public.aicredit_earn_room_id()
where conversation_id is null;

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
  earn_room uuid;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;

  earn_room := public.aicredit_earn_room_id();
  if earn_room is null then
    return jsonb_build_object('ok', false, 'reason', 'earn_room_not_configured');
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

  select id into existing
  from public.aicredit_referrals
  where referred_user_id = uid and conversation_id = earn_room;
  if existing is not null then
    return jsonb_build_object('ok', false, 'reason', 'already_attributed');
  end if;

  perform public.aicredit_ensure_profile_referral_code(uid);
  perform public.aicredit_ensure_profile_referral_code(referrer);

  insert into public.aicredit_referrals (
    referrer_id, referred_user_id, referral_code, conversation_id, status,
    attribution_date, registration_date
  )
  values (referrer, uid, normalized, earn_room, 'registered', now(), now())
  returning id into ref_id;

  perform public.write_activity(
    'account',
    'aicredit.referral.registered',
    'New AI Credits referral registration',
    referrer,
    earn_room,
    jsonb_build_object('referral_id', ref_id, 'referred_user_id', uid)
  );

  return jsonb_build_object('ok', true, 'referralId', ref_id);
end;
$$;

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
  earn_room uuid;
  stats jsonb;
begin
  if uid is null then raise exception 'Not signed in'; end if;
  earn_room := public.aicredit_earn_room_id();
  code := public.aicredit_ensure_profile_referral_code(uid);

  select jsonb_build_object(
    'totalReferrals', count(*) filter (where r.status not in ('invited', 'rejected', 'cancelled')),
    'qualifiedReferrals', count(*) filter (where r.status in ('qualified', 'pending_approval', 'approved', 'paid')),
    'pendingRewards', coalesce((
      select sum(b.amount) from public.aicredit_referral_bonuses b
      join public.aicredit_referrals rr on rr.id = b.referral_id
      where b.referrer_id = uid and b.status in ('pending_approval', 'approved')
        and (earn_room is null or rr.conversation_id = earn_room)
    ), 0),
    'totalEarned', coalesce((
      select sum(b.amount) from public.aicredit_referral_bonuses b
      join public.aicredit_referrals rr on rr.id = b.referral_id
      where b.referrer_id = uid and b.status = 'paid'
        and (earn_room is null or rr.conversation_id = earn_room)
    ), 0)
  ) into stats
  from public.aicredit_referrals r
  where r.referrer_id = uid
    and (earn_room is null or r.conversation_id = earn_room);

  return jsonb_build_object(
    'referralCode', code,
    'program', public.aicredit_referral_public_settings(),
    'stats', coalesce(stats, '{"totalReferrals":0,"qualifiedReferrals":0,"pendingRewards":0,"totalEarned":0}'::jsonb)
  );
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
  earn_room uuid;
begin
  if uid is null then raise exception 'Not signed in'; end if;
  earn_room := public.aicredit_earn_room_id();
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
    and (earn_room is null or r.conversation_id = earn_room)
  order by r.created_at desc
  limit greatest(1, least(page_limit, 100))
  offset greatest(0, page_offset);
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

  select * into ref
  from public.aicredit_referrals
  where referred_user_id = req.user_id
    and (conversation_id is null or conversation_id = req.conversation_id);
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

  next_ref_status := case when s.require_manual_approval then 'pending_approval' else 'approved' end;
  next_bonus_status := case when s.require_manual_approval then 'pending_approval' else 'approved' end;

  update public.aicredit_referrals
  set
    status = next_ref_status,
    qualification_date = now(),
    qualified_reward_request_id = p_request_id,
    conversation_id = coalesce(ref.conversation_id, req.conversation_id),
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
    null,
    case when next_bonus_status = 'approved' then now() else null end
  )
  on conflict (referral_id) do nothing
  returning id into bonus_id;

  if bonus_id is null then return; end if;

  perform public.write_activity(
    'account',
    'aicredit.referral.qualified',
    'Referral qualified for bonus',
    ref.referrer_id,
    req.conversation_id,
    jsonb_build_object('referral_id', ref.id, 'bonus_id', bonus_id, 'request_id', p_request_id)
  );
end;
$$;

drop function if exists public.admin_list_referrals(text, int, int);
create function public.admin_list_referrals(
  room uuid,
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
  if room is null then
    raise exception 'Room id required';
  end if;
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
  where r.conversation_id = room
    and (status_filter is null or btrim(status_filter) = '' or r.status = status_filter)
  order by r.created_at desc
  limit greatest(1, least(page_limit, 200))
  offset greatest(0, page_offset);
end;
$$;

revoke all on function public.admin_list_referrals(uuid, text, int, int) from public, anon;
grant execute on function public.admin_list_referrals(uuid, text, int, int) to authenticated;
