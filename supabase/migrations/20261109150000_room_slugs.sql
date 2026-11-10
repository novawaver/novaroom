-- Room slugs. Run this after 20261109140000_room_forms.sql.
--
-- A room can have a short web address (a "slug") so the web app can link to a detail page for it at
-- /room/<slug>, for example /room/earn-reward-aicredits. The detail page is for signed-in people
-- only, so this opens no new public read path: any signed-in person can already read rooms
-- ("Signed-in users can see topic rooms"), and the slug is just another readable column.
--
-- Slugs are lowercase, made of letters, numbers and single hyphens, and unique across rooms. They
-- change only through admin_set_room_slug, which logs the change.

alter table public.conversations
  add column if not exists slug text;

alter table public.conversations
  drop constraint if exists conversations_slug_check;

alter table public.conversations
  add constraint conversations_slug_check
  check (
    slug is null
    or (kind = 'room' and char_length(slug) between 1 and 60 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
  );

create unique index if not exists conversations_slug_key
  on public.conversations (slug)
  where slug is not null;

drop function if exists public.admin_set_room_slug(uuid, text);
create function public.admin_set_room_slug(room uuid, new_slug text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_slug text := nullif(btrim(lower(coalesce(new_slug, ''))), '');
  room_title text;
begin
  perform public.require_admin();

  select c.title into room_title from public.conversations c where c.id = room and c.kind = 'room';
  if not found then
    raise exception 'That room does not exist';
  end if;

  if clean_slug is not null then
    if char_length(clean_slug) > 60 or clean_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
      raise exception 'A web address uses lowercase letters, numbers and hyphens, like earn-reward-aicredits';
    end if;
    if exists (select 1 from public.conversations where slug = clean_slug and id <> room) then
      raise exception 'The web address "%" is already taken by another room', clean_slug;
    end if;
  end if;

  update public.conversations
  set slug = clean_slug
  where id = room and slug is distinct from clean_slug;

  if found then
    perform public.write_activity(
      'chat', 'room.slug',
      format('%s the web address of the room "%s"', case when clean_slug is null then 'Cleared' else 'Set' end, room_title),
      null, room);
  end if;
end;
$$;

revoke all on function public.admin_set_room_slug(uuid, text) from public, anon;
grant execute on function public.admin_set_room_slug(uuid, text) to authenticated;
