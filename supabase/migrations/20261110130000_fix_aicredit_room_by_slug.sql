-- Fix ambiguous "slug" parameter vs conversations.slug in aicredit_room_by_slug.
drop function if exists public.aicredit_room_by_slug(text);
create function public.aicredit_room_by_slug(slug text)
returns table (room_id uuid, title text, description text, joined boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  cid uuid;
begin
  select c.id into cid
  from public.conversations c
  where c.kind = 'room' and c.slug = lower(btrim(aicredit_room_by_slug.slug));
  if cid is null then return; end if;

  return query
  select
    c.id,
    coalesce(nullif(btrim(c.title), ''), 'Room'),
    coalesce(nullif(btrim(c.description), ''), ''),
    public.is_conversation_member(c.id)
  from public.conversations c
  where c.id = cid;
end;
$$;

revoke all on function public.aicredit_room_by_slug(text) from public, anon;
grant execute on function public.aicredit_room_by_slug(text) to authenticated;
