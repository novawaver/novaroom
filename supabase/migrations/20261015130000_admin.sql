-- Super admin tools for the Novaroom admin site (novaroom-admin).
-- Run this after 20261015120000_profile_role.sql.
--
-- Every admin_* function checks public.is_admin() first and runs with elevated rights, so the
-- admin site never needs the service-role key.
--
-- The existing read rules are deliberately unchanged. The main app listens for every new message
-- it is allowed to read, so letting admins read all messages through table rules would flood an
-- admin's own app with other people's chats and notifications. Admin reads go through the
-- functions below instead.
--
-- Make the first admin in the SQL editor (after that, admins can promote others from the site):
--   insert into public.admins (user_id)
--   select id from auth.users where email = 'you@example.com';

create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- No policies: the table is only reached through the functions below.
alter table public.admins enable row level security;

alter table public.reports
  add column if not exists resolved_at timestamptz,
  add column if not exists resolved_by uuid references public.profiles (id) on delete set null;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

create or replace function public.require_admin()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Admins only';
  end if;
end;
$$;

-- Dashboard ------------------------------------------------------------------

create or replace function public.admin_stats()
returns table (
  total_users bigint,
  total_admins bigint,
  banned_users bigint,
  direct_chats bigint,
  group_chats bigint,
  room_count bigint,
  message_count bigint,
  messages_today bigint,
  open_reports bigint
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
    (select count(*) from auth.users),
    (select count(*) from public.admins),
    (select count(*) from auth.users u where u.banned_until > now()),
    (select count(*) from public.conversations c where c.kind = 'direct'),
    (select count(*) from public.conversations c where c.kind = 'group'),
    (select count(*) from public.conversations c where c.kind = 'room'),
    (select count(*) from public.messages m where m.deleted_at is null),
    (select count(*) from public.messages m
      where m.deleted_at is null and m.created_at > now() - interval '1 day'),
    (select count(*) from public.reports r where r.resolved_at is null);
end;
$$;

-- Users ----------------------------------------------------------------------

create or replace function public.admin_list_users()
returns table (
  user_id uuid,
  email text,
  display_name text,
  role text,
  status text,
  avatar_url text,
  joined_at timestamptz,
  last_sign_in_at timestamptz,
  banned_until timestamptz,
  is_admin boolean,
  message_count bigint
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
    u.id,
    u.email::text,
    coalesce(p.display_name, ''),
    coalesce(p.role, ''),
    coalesce(p.status, ''),
    p.avatar_url,
    u.created_at,
    u.last_sign_in_at,
    u.banned_until,
    exists (select 1 from public.admins a where a.user_id = u.id),
    (select count(*) from public.messages m where m.sender_id = u.id and m.deleted_at is null)
  from auth.users u
  left join public.profiles p on p.id = u.id
  order by u.created_at desc;
end;
$$;

create or replace function public.admin_update_user(
  target uuid,
  new_name text,
  new_role text,
  new_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_name text := btrim(coalesce(new_name, ''));
  clean_status text := btrim(coalesce(new_status, ''));
  clean_role text := btrim(coalesce(new_role, ''));
begin
  perform public.require_admin();

  if char_length(clean_name) = 0 or char_length(clean_name) > 40 then
    raise exception 'Names need 1 to 40 characters';
  end if;

  if char_length(clean_status) > 80 then
    raise exception 'Statuses are limited to 80 characters';
  end if;

  if char_length(clean_role) > 40 then
    raise exception 'Roles are limited to 40 characters';
  end if;

  insert into public.profiles (id, display_name, role, status)
  values (target, clean_name, clean_role, clean_status)
  on conflict (id) do update
  set display_name = excluded.display_name,
      role = excluded.role,
      status = excluded.status,
      updated_at = now();
end;
$$;

create or replace function public.admin_set_banned(target uuid, banned boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_admin();

  if target = auth.uid() then
    raise exception 'You cannot ban yourself';
  end if;

  update auth.users
  set banned_until = case when banned then now() + interval '100 years' else null end
  where id = target;

  if not found then
    raise exception 'That account does not exist';
  end if;

  -- Sign the person out everywhere. Their current access token still works until it expires.
  if banned then
    delete from auth.sessions where user_id = target;
  end if;
end;
$$;

create or replace function public.admin_set_admin(target uuid, make boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_admin();

  if make then
    insert into public.admins (user_id) values (target) on conflict do nothing;
    return;
  end if;

  if target = auth.uid() then
    raise exception 'You cannot remove your own admin access';
  end if;

  delete from public.admins where user_id = target;
end;
$$;

-- Mirrors delete_own_account for someone else's account.
create or replace function public.admin_delete_user(target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_admin();

  if target = auth.uid() then
    raise exception 'You cannot delete your own account here';
  end if;

  delete from storage.objects o
  using public.messages m
  where m.sender_id = target
    and m.attachment_path is not null
    and o.bucket_id = 'chat-files'
    and o.name = m.attachment_path;

  delete from storage.objects
  where bucket_id = 'avatars'
    and (storage.foldername(name))[1] = target::text;

  update public.messages
  set body = null,
      attachment_path = null,
      attachment_name = null,
      attachment_mime = null,
      attachment_size = null,
      deleted_at = coalesce(deleted_at, now())
  where sender_id = target;

  update public.conversations c
  set title = 'Deleted account'
  where c.kind = 'direct'
    and exists (
      select 1
      from public.conversation_members m
      where m.conversation_id = c.id
        and m.user_id = target
    );

  delete from auth.users where id = target;
end;
$$;

-- Chats and rooms ------------------------------------------------------------

create or replace function public.admin_list_conversations()
returns table (
  conversation_id uuid,
  kind text,
  title text,
  description text,
  created_at timestamptz,
  member_count bigint,
  message_count bigint,
  last_message_at timestamptz,
  member_names text[]
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
    c.id,
    c.kind,
    c.title,
    c.description,
    c.created_at,
    (select count(*) from public.conversation_members cm where cm.conversation_id = c.id),
    (select count(*) from public.messages m where m.conversation_id = c.id and m.deleted_at is null),
    (select max(m.created_at) from public.messages m where m.conversation_id = c.id),
    array(
      select coalesce(nullif(p.display_name, ''), 'Unnamed')
      from public.conversation_members cm
      join public.profiles p on p.id = cm.user_id
      where cm.conversation_id = c.id
      order by p.display_name
      limit 6
    )
  from public.conversations c
  order by 8 desc nulls last, 5 desc;
end;
$$;

create or replace function public.admin_list_members(cid uuid)
returns table (user_id uuid, display_name text, email text)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  perform public.require_admin();
  return query
  select cm.user_id, coalesce(p.display_name, ''), u.email::text
  from public.conversation_members cm
  left join public.profiles p on p.id = cm.user_id
  left join auth.users u on u.id = cm.user_id
  where cm.conversation_id = cid
  order by 2;
end;
$$;

-- The latest max_rows messages of one conversation, oldest first.
create or replace function public.admin_list_messages(cid uuid, max_rows integer default 500)
returns table (
  message_id uuid,
  sender_id uuid,
  sender_name text,
  body text,
  created_at timestamptz,
  deleted_at timestamptz,
  attachment_path text,
  attachment_name text,
  attachment_mime text,
  attachment_size bigint
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
  select t.mid, t.sid, t.sname, t.mbody, t.mcreated, t.mdeleted, t.apath, t.aname, t.amime, t.asize
  from (
    select
      m.id as mid,
      m.sender_id as sid,
      case
        when m.sender_id is null then 'Deleted account'
        else coalesce(nullif(p.display_name, ''), 'Unnamed')
      end as sname,
      m.body as mbody,
      m.created_at as mcreated,
      m.deleted_at as mdeleted,
      m.attachment_path as apath,
      m.attachment_name as aname,
      m.attachment_mime as amime,
      m.attachment_size as asize
    from public.messages m
    left join public.profiles p on p.id = m.sender_id
    where m.conversation_id = cid
    order by m.created_at desc
    limit greatest(1, least(coalesce(max_rows, 500), 2000))
  ) t
  order by t.mcreated;
end;
$$;

create or replace function public.admin_delete_message(mid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  path text;
begin
  perform public.require_admin();

  select attachment_path into path from public.messages where id = mid;
  if not found then
    raise exception 'That message does not exist';
  end if;

  if path is not null then
    delete from storage.objects
    where bucket_id = 'chat-files'
      and name = path;
  end if;

  update public.messages
  set body = null,
      attachment_path = null,
      attachment_name = null,
      attachment_mime = null,
      attachment_size = null,
      deleted_at = coalesce(deleted_at, now())
  where id = mid;
end;
$$;

-- Removes a chat or room with its members, messages and files. Reports keep their copy of the text.
create or replace function public.admin_delete_conversation(cid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_admin();

  delete from storage.objects
  where bucket_id = 'chat-files'
    and (storage.foldername(name))[1] = cid::text;

  delete from public.conversations where id = cid;

  if not found then
    raise exception 'That chat does not exist';
  end if;
end;
$$;

create or replace function public.admin_remove_member(cid uuid, target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_admin();
  delete from public.conversation_members
  where conversation_id = cid
    and user_id = target;
end;
$$;

-- Creates a room when room_id is null, otherwise renames it. Returns the room id.
create or replace function public.admin_save_room(room_id uuid, room_title text, room_description text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_title text := btrim(coalesce(room_title, ''));
  clean_description text := nullif(btrim(coalesce(room_description, '')), '');
  saved uuid;
begin
  perform public.require_admin();

  if char_length(clean_title) = 0 or char_length(clean_title) > 80 then
    raise exception 'Give the room a name up to 80 characters';
  end if;

  if clean_description is not null and char_length(clean_description) > 200 then
    raise exception 'Descriptions are limited to 200 characters';
  end if;

  if room_id is null then
    insert into public.conversations (kind, title, description)
    values ('room', clean_title, clean_description)
    returning id into saved;
    return saved;
  end if;

  update public.conversations
  set title = clean_title,
      description = clean_description
  where id = room_id
    and kind = 'room'
  returning id into saved;

  if saved is null then
    raise exception 'That room does not exist';
  end if;

  return saved;
end;
$$;

create or replace function public.admin_list_room_resources(room uuid)
returns table (resource_id uuid, title text, url text, created_at timestamptz, added_by text)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  perform public.require_admin();
  return query
  select r.id, r.title, r.url, r.created_at, coalesce(nullif(p.display_name, ''), 'Novaroom')
  from public.room_resources r
  left join public.profiles p on p.id = r.created_by
  where r.conversation_id = room
  order by r.created_at;
end;
$$;

create or replace function public.admin_add_room_resource(room uuid, resource_title text, resource_url text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_title text := btrim(coalesce(resource_title, ''));
  clean_url text := btrim(coalesce(resource_url, ''));
  created uuid;
begin
  perform public.require_admin();

  if not exists (select 1 from public.conversations where id = room and kind = 'room') then
    raise exception 'That room does not exist';
  end if;

  if char_length(clean_title) = 0 or char_length(clean_title) > 80 then
    raise exception 'Give the link a name up to 80 characters';
  end if;

  if clean_url !~ '^https://[^[:space:]]+$' or char_length(clean_url) > 500 then
    raise exception 'Links must start with https://';
  end if;

  insert into public.room_resources (conversation_id, title, url, created_by)
  values (room, clean_title, clean_url, auth.uid())
  returning id into created;

  return created;
end;
$$;

create or replace function public.admin_delete_room_resource(resource uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_admin();
  delete from public.room_resources where id = resource;
end;
$$;

-- Reports --------------------------------------------------------------------

create or replace function public.admin_list_reports()
returns table (
  report_id uuid,
  created_at timestamptz,
  reason text,
  note text,
  body_snapshot text,
  attachment_name text,
  message_id uuid,
  message_deleted boolean,
  conversation_id uuid,
  conversation_kind text,
  conversation_title text,
  reporter_id uuid,
  reporter_name text,
  reported_user_id uuid,
  reported_name text,
  resolved_at timestamptz
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
    r.created_at,
    r.reason,
    r.note,
    r.body_snapshot,
    r.attachment_name,
    r.message_id,
    m.id is null or m.deleted_at is not null,
    r.conversation_id,
    c.kind,
    c.title,
    r.reporter_id,
    coalesce(nullif(rp.display_name, ''), 'Deleted account'),
    r.reported_user_id,
    coalesce(nullif(tp.display_name, ''), 'Deleted account'),
    r.resolved_at
  from public.reports r
  left join public.messages m on m.id = r.message_id
  left join public.conversations c on c.id = r.conversation_id
  left join public.profiles rp on rp.id = r.reporter_id
  left join public.profiles tp on tp.id = r.reported_user_id
  order by (r.resolved_at is null) desc, r.created_at desc;
end;
$$;

create or replace function public.admin_resolve_report(report uuid, resolved boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_admin();
  update public.reports
  set resolved_at = case when resolved then now() else null end,
      resolved_by = case when resolved then auth.uid() else null end
  where id = report;
end;
$$;

-- Blocks ---------------------------------------------------------------------

create or replace function public.admin_list_blocks()
returns table (
  blocker_id uuid,
  blocker_name text,
  blocked_id uuid,
  blocked_name text,
  created_at timestamptz
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
    b.blocker_id,
    coalesce(nullif(bp.display_name, ''), 'Unnamed'),
    b.blocked_id,
    coalesce(nullif(dp.display_name, ''), 'Unnamed'),
    b.created_at
  from public.blocks b
  left join public.profiles bp on bp.id = b.blocker_id
  left join public.profiles dp on dp.id = b.blocked_id
  order by b.created_at desc;
end;
$$;

create or replace function public.admin_delete_block(blocker uuid, blocked uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_admin();
  delete from public.blocks
  where blocker_id = blocker
    and blocked_id = blocked;
end;
$$;

-- Admins can open chat attachments from the admin site (signed links only, no listing in the app).
drop policy if exists "Admins read chat files" on storage.objects;
create policy "Admins read chat files"
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'chat-files' and public.is_admin());

-- Permissions ----------------------------------------------------------------

revoke all on function public.is_admin() from public, anon;
revoke all on function public.require_admin() from public, anon, authenticated;
revoke all on function public.admin_stats() from public, anon;
revoke all on function public.admin_list_users() from public, anon;
revoke all on function public.admin_update_user(uuid, text, text, text) from public, anon;
revoke all on function public.admin_set_banned(uuid, boolean) from public, anon;
revoke all on function public.admin_set_admin(uuid, boolean) from public, anon;
revoke all on function public.admin_delete_user(uuid) from public, anon;
revoke all on function public.admin_list_conversations() from public, anon;
revoke all on function public.admin_list_members(uuid) from public, anon;
revoke all on function public.admin_list_messages(uuid, integer) from public, anon;
revoke all on function public.admin_delete_message(uuid) from public, anon;
revoke all on function public.admin_delete_conversation(uuid) from public, anon;
revoke all on function public.admin_remove_member(uuid, uuid) from public, anon;
revoke all on function public.admin_save_room(uuid, text, text) from public, anon;
revoke all on function public.admin_list_room_resources(uuid) from public, anon;
revoke all on function public.admin_add_room_resource(uuid, text, text) from public, anon;
revoke all on function public.admin_delete_room_resource(uuid) from public, anon;
revoke all on function public.admin_list_reports() from public, anon;
revoke all on function public.admin_resolve_report(uuid, boolean) from public, anon;
revoke all on function public.admin_list_blocks() from public, anon;
revoke all on function public.admin_delete_block(uuid, uuid) from public, anon;

grant execute on function public.is_admin() to authenticated;
grant execute on function public.admin_stats() to authenticated;
grant execute on function public.admin_list_users() to authenticated;
grant execute on function public.admin_update_user(uuid, text, text, text) to authenticated;
grant execute on function public.admin_set_banned(uuid, boolean) to authenticated;
grant execute on function public.admin_set_admin(uuid, boolean) to authenticated;
grant execute on function public.admin_delete_user(uuid) to authenticated;
grant execute on function public.admin_list_conversations() to authenticated;
grant execute on function public.admin_list_members(uuid) to authenticated;
grant execute on function public.admin_list_messages(uuid, integer) to authenticated;
grant execute on function public.admin_delete_message(uuid) to authenticated;
grant execute on function public.admin_delete_conversation(uuid) to authenticated;
grant execute on function public.admin_remove_member(uuid, uuid) to authenticated;
grant execute on function public.admin_save_room(uuid, text, text) to authenticated;
grant execute on function public.admin_list_room_resources(uuid) to authenticated;
grant execute on function public.admin_add_room_resource(uuid, text, text) to authenticated;
grant execute on function public.admin_delete_room_resource(uuid) to authenticated;
grant execute on function public.admin_list_reports() to authenticated;
grant execute on function public.admin_resolve_report(uuid, boolean) to authenticated;
grant execute on function public.admin_list_blocks() to authenticated;
grant execute on function public.admin_delete_block(uuid, uuid) to authenticated;
