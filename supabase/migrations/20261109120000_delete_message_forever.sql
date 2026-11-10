-- Deleting a message forever. Run this after 20261102120000_chat_mute.sql.
--
-- admin_delete_message (20261023150000_storage_api_deletes.sql) clears a message but keeps its row,
-- so members see "Message deleted" in its place. admin_delete_message_forever removes the row
-- itself, so nothing is left in the chat or room. It also works on a message that already shows
-- "Message deleted", to take that line away.
--
-- What else points at a message:
--   reports.message_id is set to null. The report keeps its own copy of the text
--   (body_snapshot, attachment_name), and the admin site already shows such a report as deleted.
--   hidden_messages rows are removed with it (on delete cascade).
-- The activity log trigger records it as "Removed <name>'s message from <chat>", without the text.
--
-- Like the other admin deletes, the attached file is handed back as (bucket, path) for the admin
-- site to remove through the Storage API.

drop function if exists public.admin_delete_message_forever(uuid);
create function public.admin_delete_message_forever(mid uuid)
returns table (bucket text, path text)
language plpgsql
security definer
set search_path = public
as $$
declare
  file text;
begin
  perform public.require_admin();

  delete from public.messages m
  where m.id = mid
  returning m.attachment_path into file;

  if not found then
    raise exception 'That message does not exist';
  end if;

  if file is not null then
    return query select 'chat-files'::text, file;
  end if;
end;
$$;

revoke all on function public.admin_delete_message_forever(uuid) from public, anon;
grant execute on function public.admin_delete_message_forever(uuid) to authenticated;
