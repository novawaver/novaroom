-- Topic rooms for the private beta. Run this after 20261006150000_safety.sql.
-- Coding, Writing, Math, and Rating are open to any signed-in person.

alter table public.conversations
  drop constraint if exists conversations_kind_check;

alter table public.conversations
  add constraint conversations_kind_check
  check (kind in ('direct', 'group', 'room'));

alter table public.conversations
  add column if not exists description text;

alter table public.conversations
  drop constraint if exists conversations_description_check;

alter table public.conversations
  add constraint conversations_description_check
  check (description is null or char_length(description) <= 200);

insert into public.conversations (id, kind, title, description)
values
  (
    '11111111-1111-4111-8111-111111111111',
    'room',
    'Coding',
    'Coding tasks, tools, and prompts.'
  ),
  (
    '22222222-2222-4222-8222-222222222222',
    'room',
    'Writing',
    'Writing tasks, style, and prompts.'
  ),
  (
    '33333333-3333-4333-8333-333333333333',
    'room',
    'Math',
    'Math tasks, checks, and explanations.'
  ),
  (
    '44444444-4444-4444-8444-444444444444',
    'room',
    'Rating',
    'Rating, comparisons, and review habits.'
  )
on conflict (id) do nothing;

create table if not exists public.room_resources (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 80),
  url text not null check (url ~ '^https://[^[:space:]]+$' and char_length(url) <= 500),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists room_resources_conversation_idx
  on public.room_resources (conversation_id, created_at);

alter table public.room_resources enable row level security;

drop policy if exists "Members can read room links" on public.room_resources;
create policy "Members can read room links"
  on public.room_resources
  for select
  to authenticated
  using (public.is_conversation_member(conversation_id));

drop policy if exists "Signed-in users can see topic rooms" on public.conversations;
create policy "Signed-in users can see topic rooms"
  on public.conversations
  for select
  to authenticated
  using (kind = 'room');

insert into public.room_resources (id, conversation_id, title, url)
values
  (
    'c1111111-1111-4111-8111-111111111111',
    '11111111-1111-4111-8111-111111111111',
    'Python docs',
    'https://docs.python.org/3/'
  ),
  (
    'c2222222-2222-4222-8222-222222222222',
    '22222222-2222-4222-8222-222222222222',
    'Purdue OWL',
    'https://owl.purdue.edu/owl/general_writing/index.html'
  ),
  (
    'c3333333-3333-4333-8333-333333333333',
    '33333333-3333-4333-8333-333333333333',
    'Khan Academy',
    'https://www.khanacademy.org/'
  ),
  (
    'c4444444-4444-4444-8444-444444444444',
    '44444444-4444-4444-8444-444444444444',
    'What is RLHF',
    'https://en.wikipedia.org/wiki/Reinforcement_learning_from_human_feedback'
  )
on conflict (id) do nothing;

create or replace function public.join_room(room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Sign in before joining a room';
  end if;

  if not exists (
    select 1 from public.conversations where id = room_id and kind = 'room'
  ) then
    raise exception 'That room is not available';
  end if;

  insert into public.conversation_members (conversation_id, user_id)
  values (room_id, me)
  on conflict do nothing;
end;
$$;

create or replace function public.leave_room(room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Sign in before leaving a room';
  end if;

  delete from public.conversation_members m
  using public.conversations c
  where m.conversation_id = room_id
    and m.user_id = me
    and c.id = m.conversation_id
    and c.kind = 'room';
end;
$$;

create or replace function public.add_room_resource(
  room_id uuid,
  resource_title text,
  resource_url text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  clean_title text := btrim(resource_title);
  clean_url text := btrim(resource_url);
  created uuid;
begin
  if me is null then
    raise exception 'Sign in before adding a link';
  end if;

  if not public.is_conversation_member(room_id) then
    raise exception 'Join the room before adding a link';
  end if;

  if not exists (
    select 1 from public.conversations where id = room_id and kind = 'room'
  ) then
    raise exception 'That room is not available';
  end if;

  if clean_title is null or char_length(clean_title) = 0 or char_length(clean_title) > 80 then
    raise exception 'Give the link a name up to 80 characters';
  end if;

  if clean_url !~ '^https://[^[:space:]]+$' or char_length(clean_url) > 500 then
    raise exception 'Links must start with https://';
  end if;

  if (
    select count(*) from public.room_resources where conversation_id = room_id
  ) >= 20 then
    raise exception 'This room already has 20 links';
  end if;

  insert into public.room_resources (conversation_id, title, url, created_by)
  values (room_id, clean_title, clean_url, me)
  returning id into created;

  return created;
end;
$$;

create or replace function public.delete_room_resource(resource_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Sign in before removing a link';
  end if;

  delete from public.room_resources
  where id = resource_id
    and created_by = me;

  if not found then
    raise exception 'You can only remove links you added';
  end if;
end;
$$;

revoke all on function public.join_room(uuid) from public, anon;
revoke all on function public.leave_room(uuid) from public, anon;
revoke all on function public.add_room_resource(uuid, text, text) from public, anon;
revoke all on function public.delete_room_resource(uuid) from public, anon;

grant execute on function public.join_room(uuid) to authenticated;
grant execute on function public.leave_room(uuid) to authenticated;
grant execute on function public.add_room_resource(uuid, text, text) to authenticated;
grant execute on function public.delete_room_resource(uuid) to authenticated;
