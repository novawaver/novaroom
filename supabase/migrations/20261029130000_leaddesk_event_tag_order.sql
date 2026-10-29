-- The order of LeadDesk event tags, set by admins. Run this after 20261029120000_leaddesk_event_tags.sql.
--
-- Tags are listed by position, lowest first, in the admin site, the event form and the schedule
-- filter. Existing tags start in name order; a new tag goes to the end.

alter table public.leaddesk_event_tags
  add column if not exists position integer not null default 0;

-- Number the tags already there in name order, once.
update public.leaddesk_event_tags t
set position = ordered.n
from (
  select id, row_number() over (order by lower(name), created_at) as n
  from public.leaddesk_event_tags
) ordered
where t.id = ordered.id
  and not exists (select 1 from public.leaddesk_event_tags where position <> 0);

create index if not exists leaddesk_event_tags_position_idx on public.leaddesk_event_tags (position);

create or replace function public.place_new_leaddesk_event_tag()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.position := coalesce((select max(position) from public.leaddesk_event_tags), 0) + 1;
  return new;
end;
$$;

drop trigger if exists place_new_leaddesk_event_tag on public.leaddesk_event_tags;
create trigger place_new_leaddesk_event_tag
  before insert on public.leaddesk_event_tags
  for each row execute function public.place_new_leaddesk_event_tag();

revoke all on function public.place_new_leaddesk_event_tag() from public, anon, authenticated;
