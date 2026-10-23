-- Supabase no longer allows deleting files with SQL ("Direct deletion from storage tables is not
-- allowed. Use the Storage API instead."): a row deleted that way would leave its file behind in the
-- file store. Run this after 20261023140000_task_status_on_reassign.sql.
--
-- The functions that used to delete files now leave them alone and return the files they would have
-- deleted, as (bucket, path). The app and the admin website remove those through the Storage API
-- right after the call. Admins get a storage policy for that; people already had one for their own
-- avatar and the chat files they sent.
--
-- Changing what a function returns needs it dropped first, so each is dropped and made again with its
-- grants.

-- Admins remove avatars and chat files ------------------------------------------

drop policy if exists "Admins delete avatars and chat files" on storage.objects;
create policy "Admins delete avatars and chat files"
  on storage.objects
  for delete
  to authenticated
  using (bucket_id in ('avatars', 'chat-files') and public.is_admin());

-- A person's files: their avatar folder and the files on messages they sent.
create or replace function public.account_files(target uuid)
returns table (bucket text, path text)
language sql
stable
security definer
set search_path = public
as $$
  select o.bucket_id, o.name
  from storage.objects o
  join public.messages m on m.attachment_path = o.name
  where o.bucket_id = 'chat-files'
    and m.sender_id = target
  union
  select o.bucket_id, o.name
  from storage.objects o
  where o.bucket_id = 'avatars'
    and (storage.foldername(o.name))[1] = target::text;
$$;

revoke all on function public.account_files(uuid) from public, anon, authenticated;

-- People -------------------------------------------------------------------------

drop function if exists public.delete_own_message(uuid);
create function public.delete_own_message(message_id uuid)
returns table (bucket text, path text)
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  owner uuid;
  file text;
  already timestamptz;
begin
  if me is null then
    raise exception 'Sign in before deleting a message';
  end if;

  select m.sender_id, m.attachment_path, m.deleted_at
    into owner, file, already
  from public.messages m
  where m.id = message_id;

  if not found then
    raise exception 'That message is not available';
  end if;

  if owner is distinct from me then
    raise exception 'You can only delete your own messages';
  end if;

  if already is not null then
    return;
  end if;

  update public.messages
  set body = null,
      attachment_path = null,
      attachment_name = null,
      attachment_mime = null,
      attachment_size = null,
      deleted_at = now()
  where id = message_id
    and sender_id = me;

  if file is not null then
    return query select 'chat-files'::text, file;
  end if;
end;
$$;

revoke all on function public.delete_own_message(uuid) from public, anon;
grant execute on function public.delete_own_message(uuid) to authenticated;

drop function if exists public.delete_own_account();
create function public.delete_own_account()
returns table (bucket text, path text)
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Sign in before deleting your account';
  end if;

  -- Collected before the messages lose their attachment paths.
  return query select f.bucket, f.path from public.account_files(me) f;

  update public.messages
  set body = null,
      attachment_path = null,
      attachment_name = null,
      attachment_mime = null,
      attachment_size = null,
      deleted_at = coalesce(deleted_at, now())
  where sender_id = me;

  update public.conversations c
  set title = 'Deleted account'
  where c.kind = 'direct'
    and exists (
      select 1
      from public.conversation_members m
      where m.conversation_id = c.id
        and m.user_id = me
    );

  delete from auth.users where id = me;
end;
$$;

revoke all on function public.delete_own_account() from public, anon;
grant execute on function public.delete_own_account() to authenticated;

-- Admins -------------------------------------------------------------------------

-- Mirrors delete_own_account for someone else's account.
drop function if exists public.admin_delete_user(uuid);
create function public.admin_delete_user(target uuid)
returns table (bucket text, path text)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_admin();

  if target = auth.uid() then
    raise exception 'You cannot delete your own account here';
  end if;

  return query select f.bucket, f.path from public.account_files(target) f;

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

revoke all on function public.admin_delete_user(uuid) from public, anon;
grant execute on function public.admin_delete_user(uuid) to authenticated;

drop function if exists public.admin_delete_message(uuid);
create function public.admin_delete_message(mid uuid)
returns table (bucket text, path text)
language plpgsql
security definer
set search_path = public
as $$
declare
  file text;
begin
  perform public.require_admin();

  select m.attachment_path into file from public.messages m where m.id = mid;
  if not found then
    raise exception 'That message does not exist';
  end if;

  update public.messages
  set body = null,
      attachment_path = null,
      attachment_name = null,
      attachment_mime = null,
      attachment_size = null,
      deleted_at = coalesce(deleted_at, now())
  where id = mid;

  if file is not null then
    return query select 'chat-files'::text, file;
  end if;
end;
$$;

revoke all on function public.admin_delete_message(uuid) from public, anon;
grant execute on function public.admin_delete_message(uuid) to authenticated;

-- Removes a chat or room with its members, messages and files. Reports keep their copy of the text.
drop function if exists public.admin_delete_conversation(uuid);
create function public.admin_delete_conversation(cid uuid)
returns table (bucket text, path text)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_admin();

  if not exists (select 1 from public.conversations c where c.id = cid) then
    raise exception 'That chat does not exist';
  end if;

  return query
  select o.bucket_id::text, o.name::text
  from storage.objects o
  where o.bucket_id = 'chat-files'
    and (storage.foldername(o.name))[1] = cid::text;

  delete from public.conversations where id = cid;
end;
$$;

revoke all on function public.admin_delete_conversation(uuid) from public, anon;
grant execute on function public.admin_delete_conversation(uuid) to authenticated;
