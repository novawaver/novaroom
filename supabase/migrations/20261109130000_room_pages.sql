-- Room pages. Run this after 20261109120000_delete_message_forever.sql.
--
-- Each topic room gets its own page: text an admin writes on the admin site, in simple Markdown
-- (headings, lists, bold, links). The app shows it in the main area with the room's chat beside it.
--
-- Anyone signed in can already read rooms ("Signed-in users can see topic rooms"), so people can
-- read a room's page before they join it. Nobody can change conversations directly; the page only
-- changes through admin_save_room_page, which writes the change to the activity log.
-- conversations is already in the realtime publication (20261102120000_chat_mute.sql), so an open
-- room page updates when an admin saves it.

alter table public.conversations
  add column if not exists page text,
  add column if not exists page_updated_at timestamptz;

alter table public.conversations
  drop constraint if exists conversations_page_check;

alter table public.conversations
  add constraint conversations_page_check
  check (page is null or (kind = 'room' and char_length(page) <= 20000));

drop function if exists public.admin_save_room_page(uuid, text);
create function public.admin_save_room_page(room uuid, new_page text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_page text := nullif(btrim(coalesce(new_page, '')), '');
  room_title text;
begin
  perform public.require_admin();

  select c.title into room_title
  from public.conversations c
  where c.id = room and c.kind = 'room';
  if not found then
    raise exception 'That room does not exist';
  end if;

  if char_length(clean_page) > 20000 then
    raise exception 'Room pages are limited to 20,000 characters';
  end if;

  update public.conversations
  set page = clean_page,
      page_updated_at = now()
  where id = room
    and page is distinct from clean_page;

  if found then
    perform public.write_activity(
      'chat', 'room.page',
      format('%s the page of the room "%s"', case when clean_page is null then 'Cleared' else 'Updated' end, room_title),
      null, room);
  end if;
end;
$$;

revoke all on function public.admin_save_room_page(uuid, text) from public, anon;
grant execute on function public.admin_save_room_page(uuid, text) to authenticated;
