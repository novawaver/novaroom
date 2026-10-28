-- Activity log: what everyone does in Novaroom, shown on the admin site's Activity page.
-- Run this after 20261027120000_leaddesk_event_files.sql.
--
-- Triggers write the log, so every change is recorded the same way whether it comes from the app,
-- the admin site or a database function, and nobody can skip or forge an entry. Nobody can read the
-- table directly; admins read it through admin_list_activity().
--
-- Left out on purpose: read receipts, notifications, Time Tracker periods, LeadDesk signals and Local
-- chat keys. They are written constantly in the background and say nothing about what someone did.
-- Rows changed by a cascade or by another trigger (deleting a chat removes its messages) are not
-- logged one by one either; the action that caused them is.
--
-- Message text is never copied into the log, so deleting a message still removes its text.

create table if not exists public.activity_logs (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  -- Who did it. Null for changes made outside a signed-in session (the SQL editor, Supabase itself).
  -- There are no foreign keys, so entries outlive deleted accounts and chats; names are copied in.
  actor_id uuid,
  actor_name text not null default '',
  actor_email text not null default '',
  area text not null check (area in ('account', 'chat', 'safety', 'leaddesk', 'timer', 'admin')),
  action text not null,
  summary text not null,
  -- The other person the action was about, if any.
  target_user_id uuid,
  conversation_id uuid,
  details jsonb not null default '{}'
);

create index if not exists activity_logs_actor_idx on public.activity_logs (actor_id, id desc);
create index if not exists activity_logs_target_idx on public.activity_logs (target_user_id, id desc);
create index if not exists activity_logs_area_idx on public.activity_logs (area, id desc);

-- No policies: the table is only reached through the functions below. Unlike the other tables the
-- app's roles get no grants either, so the log can't be written or read from the Data API.
alter table public.activity_logs enable row level security;
revoke all on public.activity_logs from anon, authenticated;
grant select, insert, update, delete on public.activity_logs to service_role;

-- Helpers --------------------------------------------------------------------

create or replace function public.write_activity(
  log_area text,
  log_action text,
  log_summary text,
  log_target uuid default null,
  log_conversation uuid default null,
  log_details jsonb default '{}',
  log_actor uuid default auth.uid()
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.activity_logs
    (actor_id, actor_name, actor_email, area, action, summary, target_user_id, conversation_id, details)
  values (
    log_actor,
    coalesce((select display_name from public.profiles where id = log_actor), ''),
    coalesce((select email::text from auth.users where id = log_actor), ''),
    log_area,
    log_action,
    log_summary,
    log_target,
    log_conversation,
    coalesce(log_details, '{}')
  );
exception when others then
  -- A failed log entry must never stop the change it describes.
  raise warning 'Activity log entry skipped (%): %', log_action, sqlerrm;
end;
$$;

-- A person's name for a log line: display name, else email, else "a deleted account".
create or replace function public.activity_person(person uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when person is null then 'someone'
    else coalesce(
      (select nullif(display_name, '') from public.profiles where id = person),
      (select email::text from auth.users where id = person),
      'a deleted account'
    )
  end;
$$;

-- A chat's name for a log line. Direct chats are named by their members other than `viewer`.
create or replace function public.activity_chat(cid uuid, viewer uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select case c.kind
        when 'room' then format('room "%s"', c.title)
        when 'group' then format('group "%s"', c.title)
        else coalesce(
          'a direct chat with ' || (
            select string_agg(public.activity_person(m.user_id), ', ')
            from public.conversation_members m
            where m.conversation_id = c.id
              and m.user_id is distinct from viewer
          ),
          'a direct chat'
        )
      end
      from public.conversations c
      where c.id = cid
    ),
    'a deleted chat'
  );
$$;

-- Which of `fields` differ between two versions of a row, as readable labels without repeats.
create or replace function public.activity_changes(old_row jsonb, new_row jsonb, fields text[])
returns text[]
language sql
immutable
as $$
  select coalesce(array_agg(label order by first_seen), '{}')
  from (
    select label, min(ord) as first_seen
    from (
      select
        ord,
        case f
          when 'display_name' then 'name'
          when 'avatar_url' then 'photo'
          when 'assignee_notes' then 'result notes'
          when 'assignee_ids' then 'assignees'
          when 'participant_ids' then 'people'
          when 'starts_at' then 'time'
          when 'ends_at' then 'time'
          when 'start_time' then 'time'
          when 'end_time' then 'time'
          when 'time_zone' then 'time'
          when 'repeat_until' then 'repeat'
          when 'locked' then 'lock'
          else replace(f, '_', ' ')
        end as label
      from unnest(fields) with ordinality as t (f, ord)
      where old_row -> f is distinct from new_row -> f
    ) changed
    group by label
  ) labels;
$$;

-- Table changes --------------------------------------------------------------

-- Runs after inserts and updates, and before deletes so related rows (members, titles) can still be
-- read for the summary.
create or replace function public.log_row_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  changed text[];
  chat_kind text;
  chat_created timestamptz;
  item_title text;
begin
  -- Rows touched by a cascade or by another trigger belong to the action that caused them.
  if pg_trigger_depth() > 1 then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  begin
  case tg_table_name

  when 'messages' then
    if tg_op = 'INSERT' then
      perform public.write_activity(
        'chat', 'message.sent',
        format('Sent %s in %s',
          case when new.attachment_path is not null then 'a file' else 'a message' end,
          public.activity_chat(new.conversation_id, actor)),
        null, new.conversation_id, jsonb_build_object('message_id', new.id));
    elsif tg_op = 'UPDATE' and old.deleted_at is null and new.deleted_at is not null then
      perform public.write_activity(
        'chat', 'message.deleted',
        case
          when new.sender_id is not distinct from actor then 'Deleted their message in '
          else format('Deleted %s''s message in ', public.activity_person(new.sender_id))
        end || public.activity_chat(new.conversation_id, actor),
        new.sender_id, new.conversation_id, jsonb_build_object('message_id', new.id));
    elsif tg_op = 'UPDATE' and new.body is distinct from old.body and new.deleted_at is null then
      perform public.write_activity(
        'chat', 'message.edited',
        'Edited a message in ' || public.activity_chat(new.conversation_id, actor),
        new.sender_id, new.conversation_id, jsonb_build_object('message_id', new.id));
    elsif tg_op = 'DELETE' then
      perform public.write_activity(
        'chat', 'message.removed',
        format('Removed %s''s message from %s',
          public.activity_person(old.sender_id), public.activity_chat(old.conversation_id, actor)),
        old.sender_id, old.conversation_id, jsonb_build_object('message_id', old.id));
    end if;

  when 'conversations' then
    -- Direct chats are logged when their members are added.
    if tg_op = 'INSERT' and new.kind <> 'direct' then
      perform public.write_activity(
        'chat', 'chat.created', format('Created the %s "%s"', new.kind, new.title),
        null, new.id);
    elsif tg_op = 'UPDATE' and new.kind <> 'direct' then
      changed := public.activity_changes(to_jsonb(old), to_jsonb(new), array['title', 'description']);
      if cardinality(changed) > 0 then
        perform public.write_activity(
          'chat', 'chat.updated',
          format('Updated the %s "%s" (%s)', new.kind, new.title, array_to_string(changed, ', ')),
          null, new.id, jsonb_build_object('old_title', old.title, 'new_title', new.title));
      end if;
    elsif tg_op = 'DELETE' then
      perform public.write_activity(
        'chat', 'chat.deleted', 'Deleted ' || public.activity_chat(old.id, null),
        null, old.id);
    end if;

  when 'conversation_members' then
    if tg_op = 'INSERT' then
      select kind, created_at into chat_kind, chat_created
      from public.conversations where id = new.conversation_id;
      if chat_kind = 'direct' then
        if new.user_id is distinct from actor then
          perform public.write_activity(
            'chat', 'chat.started', 'Started a direct chat with ' || public.activity_person(new.user_id),
            new.user_id, new.conversation_id);
        end if;
      elsif new.user_id is not distinct from actor then
        -- The creator joining the chat they just made is part of creating it.
        if chat_created is distinct from now() then
          perform public.write_activity(
            'chat', 'chat.joined', 'Joined the ' || public.activity_chat(new.conversation_id, actor),
            null, new.conversation_id);
        end if;
      else
        perform public.write_activity(
          'chat', 'chat.member_added',
          format('Added %s to the %s',
            public.activity_person(new.user_id), public.activity_chat(new.conversation_id, actor)),
          new.user_id, new.conversation_id);
      end if;
    elsif tg_op = 'UPDATE' and new.cleared_at is distinct from old.cleared_at and new.cleared_at is not null then
      perform public.write_activity(
        'chat', 'chat.cleared', 'Cleared their history in ' || public.activity_chat(new.conversation_id, actor),
        null, new.conversation_id);
    elsif tg_op = 'DELETE' then
      if old.user_id is not distinct from actor then
        perform public.write_activity(
          'chat', 'chat.left', 'Left ' || public.activity_chat(old.conversation_id, actor),
          null, old.conversation_id);
      else
        perform public.write_activity(
          'chat', 'chat.member_removed',
          format('Removed %s from %s',
            public.activity_person(old.user_id), public.activity_chat(old.conversation_id, actor)),
          old.user_id, old.conversation_id);
      end if;
    end if;

  when 'hidden_messages' then
    if tg_op = 'INSERT' then
      perform public.write_activity(
        'chat', 'message.hidden',
        'Deleted a message for themselves in ' || public.activity_chat(new.conversation_id, actor),
        null, new.conversation_id, jsonb_build_object('message_id', new.message_id));
    end if;

  when 'room_resources' then
    if tg_op = 'INSERT' then
      perform public.write_activity(
        'chat', 'room.link_added',
        format('Added the link "%s" to the %s', new.title, public.activity_chat(new.conversation_id, actor)),
        null, new.conversation_id, jsonb_build_object('url', new.url));
    elsif tg_op = 'DELETE' then
      perform public.write_activity(
        'chat', 'room.link_removed',
        format('Removed the link "%s" from the %s', old.title, public.activity_chat(old.conversation_id, actor)),
        null, old.conversation_id, jsonb_build_object('url', old.url));
    end if;

  when 'profiles' then
    if tg_op = 'INSERT' then
      perform public.write_activity(
        'account', 'profile.created',
        case when new.id is not distinct from actor then 'Set up their profile'
          else format('Set up %s''s profile', public.activity_person(new.id)) end,
        new.id);
    elsif tg_op = 'UPDATE' then
      changed := public.activity_changes(to_jsonb(old), to_jsonb(new),
        array['display_name', 'role', 'status', 'avatar_url', 'skills', 'languages', 'domains']);
      if cardinality(changed) > 0 then
        perform public.write_activity(
          'account', 'profile.updated',
          case when new.id is not distinct from actor then 'Updated their profile'
            else format('Updated %s''s profile', public.activity_person(new.id)) end
            || format(' (%s)', array_to_string(changed, ', ')),
          new.id, null,
          jsonb_strip_nulls(jsonb_build_object(
            'name', case when new.display_name is distinct from old.display_name
              then jsonb_build_object('from', old.display_name, 'to', new.display_name) end,
            'role', case when new.role is distinct from old.role
              then jsonb_build_object('from', old.role, 'to', new.role) end,
            'status', case when new.status is distinct from old.status
              then jsonb_build_object('from', old.status, 'to', new.status) end)));
      end if;
    end if;

  when 'blocks' then
    if tg_op = 'INSERT' then
      perform public.write_activity(
        'safety', 'safety.blocked', 'Blocked ' || public.activity_person(new.blocked_id), new.blocked_id);
    elsif tg_op = 'DELETE' then
      perform public.write_activity(
        'safety', 'safety.unblocked',
        case when old.blocker_id is not distinct from actor then 'Unblocked ' || public.activity_person(old.blocked_id)
          else format('Removed %s''s block on %s',
            public.activity_person(old.blocker_id), public.activity_person(old.blocked_id)) end,
        old.blocked_id);
    end if;

  when 'reports' then
    if tg_op = 'INSERT' then
      perform public.write_activity(
        'safety', 'safety.reported',
        format('Reported a message by %s (%s)', public.activity_person(new.reported_user_id), new.reason),
        new.reported_user_id, new.conversation_id, jsonb_build_object('report_id', new.id));
    elsif tg_op = 'UPDATE' and new.resolved_at is distinct from old.resolved_at then
      perform public.write_activity(
        'safety',
        case when new.resolved_at is null then 'safety.report_reopened' else 'safety.report_resolved' end,
        format('%s a report against %s',
          case when new.resolved_at is null then 'Reopened' else 'Resolved' end,
          public.activity_person(new.reported_user_id)),
        new.reported_user_id, new.conversation_id, jsonb_build_object('report_id', new.id));
    end if;

  when 'admins' then
    if tg_op = 'INSERT' then
      perform public.write_activity(
        'admin', 'admin.granted', format('Made %s an admin', public.activity_person(new.user_id)), new.user_id);
    elsif tg_op = 'DELETE' then
      perform public.write_activity(
        'admin', 'admin.revoked', format('Removed %s''s admin access', public.activity_person(old.user_id)),
        old.user_id);
    end if;

  when 'chat_permissions' then
    if tg_op = 'INSERT'
      or (tg_op = 'UPDATE' and (new.can_start_direct, new.can_start_group)
        is distinct from (old.can_start_direct, old.can_start_group)) then
      perform public.write_activity(
        'admin', 'permission.chats',
        format('Set %s''s chat permissions: direct chats %s, groups %s',
          public.activity_person(new.user_id),
          case when new.can_start_direct then 'allowed' else 'not allowed' end,
          case when new.can_start_group then 'allowed' else 'not allowed' end),
        new.user_id);
    end if;

  when 'task_permissions' then
    if tg_op = 'INSERT' or (tg_op = 'UPDATE' and new.can_add_tasks is distinct from old.can_add_tasks) then
      perform public.write_activity(
        'admin', 'permission.tasks',
        case when new.can_add_tasks then format('Allowed %s to add LeadDesk tasks', public.activity_person(new.user_id))
          else format('Stopped %s from adding LeadDesk tasks', public.activity_person(new.user_id)) end,
        new.user_id);
    end if;

  when 'timer_settings' then
    if tg_op = 'INSERT' or (tg_op = 'UPDATE' and new.enabled is distinct from old.enabled) then
      perform public.write_activity(
        'timer', case when new.enabled then 'timer.on' else 'timer.off' end,
        format('Turned the Time Tracker %s', case when new.enabled then 'on' else 'off' end)
          || case when new.user_id is not distinct from actor then ''
            else ' for ' || public.activity_person(new.user_id) end,
        new.user_id);
    end if;

  when 'leaddesk_tasks' then
    if tg_op = 'INSERT' then
      perform public.write_activity(
        'leaddesk', 'task.created', format('Created the task "%s"', new.title),
        null, null, jsonb_build_object('task_id', new.id));
    elsif tg_op = 'UPDATE' then
      changed := public.activity_changes(to_jsonb(old), to_jsonb(new),
        array['title', 'notes', 'assignee_notes', 'status', 'priority', 'assignee_ids', 'due_date']);
      if changed = array['status'] then
        perform public.write_activity(
          'leaddesk', 'task.status',
          format('Moved the task "%s" to %s', new.title,
            case new.status when 'todo' then 'To do' when 'doing' then 'In progress'
              when 'done' then 'Done' when 'failed' then 'Failed' else new.status end),
          null, null, jsonb_build_object('task_id', new.id, 'from', old.status, 'to', new.status));
      elsif cardinality(changed) > 0 then
        perform public.write_activity(
          'leaddesk', 'task.updated',
          format('Updated the task "%s" (%s)', new.title, array_to_string(changed, ', ')),
          null, null, jsonb_build_object('task_id', new.id));
      end if;
    elsif tg_op = 'DELETE' then
      perform public.write_activity(
        'leaddesk', 'task.deleted', format('Deleted the task "%s"', old.title),
        null, null, jsonb_build_object('task_id', old.id));
    end if;

  when 'leaddesk_task_signoffs' then
    if tg_op = 'INSERT' or (tg_op = 'UPDATE' and new.result is distinct from old.result) then
      select title into item_title from public.leaddesk_tasks where id = new.task_id;
      perform public.write_activity(
        'leaddesk', 'task.signed_off',
        format('Signed off the task "%s" as %s', item_title, new.result),
        case when new.user_id is distinct from actor then new.user_id end, null,
        jsonb_build_object('task_id', new.task_id));
    elsif tg_op = 'DELETE' then
      select title into item_title from public.leaddesk_tasks where id = old.task_id;
      perform public.write_activity(
        'leaddesk', 'task.signoff_withdrawn',
        case when old.user_id is not distinct from actor
          then format('Withdrew their sign-off on the task "%s"', item_title)
          else format('Removed %s''s sign-off on the task "%s"', public.activity_person(old.user_id), item_title) end,
        case when old.user_id is distinct from actor then old.user_id end, null,
        jsonb_build_object('task_id', old.task_id));
    end if;

  when 'leaddesk_events' then
    if tg_op = 'INSERT' then
      perform public.write_activity(
        'leaddesk', 'event.created', format('Created the event "%s"', new.title),
        null, null, jsonb_build_object('event_id', new.id));
    elsif tg_op = 'UPDATE' then
      changed := public.activity_changes(to_jsonb(old), to_jsonb(new),
        array['title', 'notes', 'location', 'starts_at', 'ends_at', 'start_time', 'end_time', 'time_zone',
          'repeat', 'repeat_until', 'participant_ids', 'visibility', 'locked']);
      if changed = array['lock'] then
        perform public.write_activity(
          'leaddesk', case when new.locked then 'event.locked' else 'event.unlocked' end,
          format('%s the event "%s"', case when new.locked then 'Locked' else 'Unlocked' end, new.title),
          null, null, jsonb_build_object('event_id', new.id));
      elsif cardinality(changed) > 0 then
        perform public.write_activity(
          'leaddesk', 'event.updated',
          format('Updated the event "%s" (%s)', new.title, array_to_string(changed, ', ')),
          null, null, jsonb_build_object('event_id', new.id));
      end if;
    elsif tg_op = 'DELETE' then
      perform public.write_activity(
        'leaddesk', 'event.deleted', format('Deleted the event "%s"', old.title),
        null, null, jsonb_build_object('event_id', old.id));
    end if;

  when 'leaddesk_event_files' then
    if tg_op = 'INSERT' then
      select title into item_title from public.leaddesk_events where id = new.event_id;
      perform public.write_activity(
        'leaddesk', 'event.file_added', format('Attached "%s" to the event "%s"', new.name, item_title),
        null, null, jsonb_build_object('event_id', new.event_id));
    elsif tg_op = 'DELETE' then
      select title into item_title from public.leaddesk_events where id = old.event_id;
      perform public.write_activity(
        'leaddesk', 'event.file_removed', format('Removed "%s" from the event "%s"', old.name, item_title),
        null, null, jsonb_build_object('event_id', old.event_id));
    end if;

  when 'leaddesk_notes' then
    if tg_op = 'INSERT' then
      perform public.write_activity(
        'leaddesk', 'note.created', format('Wrote the note "%s"', new.title),
        null, null, jsonb_build_object('note_id', new.id));
    elsif tg_op = 'UPDATE' then
      changed := public.activity_changes(to_jsonb(old), to_jsonb(new), array['title', 'body', 'pinned']);
      if changed = array['pinned'] then
        perform public.write_activity(
          'leaddesk', case when new.pinned then 'note.pinned' else 'note.unpinned' end,
          format('%s the note "%s"', case when new.pinned then 'Pinned' else 'Unpinned' end, new.title),
          null, null, jsonb_build_object('note_id', new.id));
      elsif cardinality(changed) > 0 then
        perform public.write_activity(
          'leaddesk', 'note.updated', format('Edited the note "%s"', new.title),
          null, null, jsonb_build_object('note_id', new.id));
      end if;
    elsif tg_op = 'DELETE' then
      perform public.write_activity(
        'leaddesk', 'note.deleted', format('Deleted the note "%s"', old.title),
        null, null, jsonb_build_object('note_id', old.id));
    end if;

  else
    null;
  end case;
  exception when others then
    -- A failed log entry must never stop the change it describes.
    raise warning 'Activity log entry skipped (%): %', tg_table_name, sqlerrm;
  end;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'messages',
    'conversations',
    'conversation_members',
    'hidden_messages',
    'room_resources',
    'profiles',
    'blocks',
    'reports',
    'admins',
    'chat_permissions',
    'task_permissions',
    'timer_settings',
    'leaddesk_tasks',
    'leaddesk_task_signoffs',
    'leaddesk_events',
    'leaddesk_event_files',
    'leaddesk_notes'
  ] loop
    execute format('drop trigger if exists log_activity on public.%I', t);
    execute format(
      'create trigger log_activity after insert or update on public.%I '
      'for each row execute function public.log_row_activity()', t);
    execute format('drop trigger if exists log_activity_delete on public.%I', t);
    execute format(
      'create trigger log_activity_delete before delete on public.%I '
      'for each row execute function public.log_row_activity()', t);
  end loop;
end
$$;

-- Accounts -------------------------------------------------------------------

-- New accounts, sign-ins, bans and deleted accounts, read from Supabase's own users table. Sign-ins
-- come from Supabase Auth with no signed-in user, so the account itself is recorded as the actor.
create or replace function public.log_account_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if pg_trigger_depth() > 1 then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  begin
  if tg_op = 'INSERT' then
    perform public.write_activity(
      'account', 'account.created', 'Created an account', null, null, '{}', new.id);
  elsif tg_op = 'UPDATE' then
    if new.last_sign_in_at is distinct from old.last_sign_in_at and new.last_sign_in_at is not null then
      perform public.write_activity(
        'account', 'account.signed_in', 'Signed in', null, null, '{}', new.id);
    end if;
    if new.banned_until is distinct from old.banned_until then
      if new.banned_until > now() then
        perform public.write_activity(
          'admin', 'admin.banned', 'Banned ' || public.activity_person(new.id), new.id);
      elsif old.banned_until > now() then
        perform public.write_activity(
          'admin', 'admin.unbanned', 'Unbanned ' || public.activity_person(new.id), new.id);
      end if;
    end if;
    if new.email is distinct from old.email then
      perform public.write_activity(
        'account', 'account.email_changed', 'Changed their email', null, null,
        jsonb_build_object('from', old.email, 'to', new.email), new.id);
    end if;
  elsif tg_op = 'DELETE' then
    if old.id is not distinct from auth.uid() then
      perform public.write_activity(
        'account', 'account.deleted', 'Deleted their account', null, null,
        jsonb_build_object('email', old.email));
    else
      perform public.write_activity(
        'admin', 'account.deleted', format('Deleted %s''s account', public.activity_person(old.id)),
        old.id, null, jsonb_build_object('email', old.email));
    end if;
  end if;
  exception when others then
    -- Never let the log get in the way of signing in or deleting an account.
    raise warning 'Account activity entry skipped: %', sqlerrm;
  end;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists log_account_activity on auth.users;
create trigger log_account_activity
  after insert or update of last_sign_in_at, banned_until, email on auth.users
  for each row execute function public.log_account_activity();

drop trigger if exists log_account_activity_delete on auth.users;
create trigger log_account_activity_delete
  before delete on auth.users
  for each row execute function public.log_account_activity();

-- Signing out only ends the session in Supabase Auth, so the app and the admin site report it here
-- just before they sign out.
create or replace function public.log_sign_out()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return;
  end if;
  perform public.write_activity('account', 'account.signed_out', 'Signed out');
end;
$$;

-- Admin site -----------------------------------------------------------------

-- Newest first. Pass the smallest id already shown as before_id to load older entries. `person`
-- matches entries by that person and entries about them.
create or replace function public.admin_list_activity(
  before_id bigint default null,
  max_rows integer default 100,
  person uuid default null,
  area_filter text default null,
  search text default null
)
returns table (
  id bigint,
  created_at timestamptz,
  actor_id uuid,
  actor_name text,
  actor_email text,
  area text,
  action text,
  summary text,
  target_user_id uuid,
  conversation_id uuid,
  details jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  needle text := nullif(btrim(coalesce(search, '')), '');
begin
  perform public.require_admin();
  return query
  select
    l.id,
    l.created_at,
    l.actor_id,
    coalesce(nullif(p.display_name, ''), l.actor_name),
    l.actor_email,
    l.area,
    l.action,
    l.summary,
    l.target_user_id,
    l.conversation_id,
    l.details
  from public.activity_logs l
  left join public.profiles p on p.id = l.actor_id
  where (before_id is null or l.id < before_id)
    and (person is null or l.actor_id = person or l.target_user_id = person)
    and (area_filter is null or l.area = area_filter)
    and (
      needle is null
      or l.summary ilike '%' || needle || '%'
      or l.actor_name ilike '%' || needle || '%'
      or l.actor_email ilike '%' || needle || '%'
      or p.display_name ilike '%' || needle || '%'
    )
  order by l.id desc
  limit greatest(1, least(coalesce(max_rows, 100), 500));
end;
$$;

-- Permissions ----------------------------------------------------------------

revoke all on function public.write_activity(text, text, text, uuid, uuid, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.activity_person(uuid) from public, anon, authenticated;
revoke all on function public.activity_chat(uuid, uuid) from public, anon, authenticated;
revoke all on function public.activity_changes(jsonb, jsonb, text[]) from public, anon, authenticated;
revoke all on function public.log_row_activity() from public, anon, authenticated;
revoke all on function public.log_account_activity() from public, anon, authenticated;
revoke all on function public.log_sign_out() from public, anon;
revoke all on function public.admin_list_activity(bigint, integer, uuid, text, text) from public, anon;

grant execute on function public.log_sign_out() to authenticated;
grant execute on function public.admin_list_activity(bigint, integer, uuid, text, text) to authenticated;
