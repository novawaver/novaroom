-- Room forms. Run this after 20261109130000_room_pages.sql.
--
-- On top of a room's written page, an admin can give a room a form: a list of fields members fill
-- in (a short text box, a long text box, a dropdown, or a number). Members submit it from the room
-- page in the app; submissions are private to the submitter and to admins.
--
-- The form definition lives in conversations.form as JSON: { title, intro, submitLabel, fields: [
--   { id, label, type: 'text'|'textarea'|'select'|'number', options?, required?, help? } ] }.
-- It is changed only through admin_save_room_form, which validates it and logs the change.
--
-- This is for ordinary information only. It is not a place to collect passwords, API keys or other
-- secrets: submissions are stored as plain text and read by admins, so it must not be used for them.

alter table public.conversations
  add column if not exists form jsonb;

alter table public.conversations
  drop constraint if exists conversations_form_check;

alter table public.conversations
  add constraint conversations_form_check
  check (form is null or (kind = 'room' and char_length(form::text) <= 40000));

-- One filled-in form from one member.
create table if not exists public.room_submissions (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete set null,
  answers jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint room_submissions_answers_size check (char_length(answers::text) <= 20000)
);

create index if not exists room_submissions_conversation_idx
  on public.room_submissions (conversation_id, created_at desc);

alter table public.room_submissions enable row level security;

-- New table in a later migration, so it needs its own API grants (see 20261021130000_table_grants.sql).
grant select on public.room_submissions to anon;
grant select, insert, delete on public.room_submissions to authenticated;

-- A member can submit to a room that has a form, as themselves.
drop policy if exists "Members can submit to a room" on public.room_submissions;
create policy "Members can submit to a room"
  on public.room_submissions
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and public.is_conversation_member(conversation_id)
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id and c.kind = 'room' and c.form is not null
    )
  );

-- People can see and withdraw their own submissions. Admins read everyone's through the function below.
drop policy if exists "People read their own submissions" on public.room_submissions;
create policy "People read their own submissions"
  on public.room_submissions
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "People remove their own submissions" on public.room_submissions;
create policy "People remove their own submissions"
  on public.room_submissions
  for delete
  to authenticated
  using (user_id = auth.uid());

-- Admin: save (or clear) a room's form. new_form null removes it.
drop function if exists public.admin_save_room_form(uuid, jsonb);
create function public.admin_save_room_form(room uuid, new_form jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  room_title text;
  field jsonb;
  field_type text;
begin
  perform public.require_admin();

  select c.title into room_title from public.conversations c where c.id = room and c.kind = 'room';
  if not found then
    raise exception 'That room does not exist';
  end if;

  if new_form is null or new_form = 'null'::jsonb then
    update public.conversations set form = null where id = room and form is not null;
    if found then
      perform public.write_activity(
        'chat', 'room.form', format('Removed the form from the room "%s"', room_title), null, room);
    end if;
    return;
  end if;

  if jsonb_typeof(new_form) <> 'object' then
    raise exception 'The form must be an object';
  end if;
  if jsonb_typeof(new_form -> 'fields') <> 'array' then
    raise exception 'The form needs a list of fields';
  end if;
  if jsonb_array_length(new_form -> 'fields') = 0 then
    raise exception 'Add at least one field, or remove the form';
  end if;
  if jsonb_array_length(new_form -> 'fields') > 30 then
    raise exception 'A form can have at most 30 fields';
  end if;

  for field in select * from jsonb_array_elements(new_form -> 'fields') loop
    field_type := field ->> 'type';
    if coalesce(field ->> 'id', '') = '' then
      raise exception 'Every field needs an id';
    end if;
    if coalesce(btrim(field ->> 'label'), '') = '' then
      raise exception 'Every field needs a label';
    end if;
    if field_type not in ('text', 'textarea', 'select', 'number') then
      raise exception 'Unknown field type: %', coalesce(field_type, '(none)');
    end if;
    if field_type = 'select' and coalesce(jsonb_array_length(field -> 'options'), 0) = 0 then
      raise exception 'The dropdown "%" needs at least one option', field ->> 'label';
    end if;
  end loop;

  if char_length(new_form::text) > 40000 then
    raise exception 'That form is too large';
  end if;

  update public.conversations set form = new_form where id = room and form is distinct from new_form;
  if found then
    perform public.write_activity(
      'chat', 'room.form', format('Updated the form of the room "%s"', room_title), null, room);
  end if;
end;
$$;

-- Admin: every submission for a room, newest first, with the submitter's name.
drop function if exists public.admin_list_room_submissions(uuid);
create function public.admin_list_room_submissions(room uuid)
returns table (submission_id uuid, user_id uuid, user_name text, answers jsonb, created_at timestamptz)
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
    s.id,
    s.user_id,
    case when s.user_id is null then 'Deleted account' else coalesce(nullif(p.display_name, ''), 'Unnamed') end,
    s.answers,
    s.created_at
  from public.room_submissions s
  left join public.profiles p on p.id = s.user_id
  where s.conversation_id = room
  order by s.created_at desc;
end;
$$;

revoke all on function public.admin_save_room_form(uuid, jsonb) from public, anon;
revoke all on function public.admin_list_room_submissions(uuid) from public, anon;
grant execute on function public.admin_save_room_form(uuid, jsonb) to authenticated;
grant execute on function public.admin_list_room_submissions(uuid) to authenticated;
