-- Tags on LeadDesk events. Run this after 20261027130000_activity_logs.sql.
--
-- Admins keep the list of tags from the admin site; leaders pick from it when they add or edit an
-- event, and filter the schedule by it. An event keeps its tags in tag_ids, like participant_ids.
-- Ids that are not a tag are dropped when the event is saved, and deleting a tag takes it off every
-- event, so tag_ids only ever holds tags that exist.

create table if not exists public.leaddesk_event_tags (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 40),
  -- One of the app's accent colours.
  color text not null default 'blue' check (color in ('violet', 'green', 'indigo', 'blue', 'amber', 'red')),
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

-- "Planning" and "planning " are the same tag.
create unique index if not exists leaddesk_event_tags_name_idx on public.leaddesk_event_tags (lower(btrim(name)));

alter table public.leaddesk_events
  add column if not exists tag_ids uuid[] not null default '{}';

alter table public.leaddesk_events
  drop constraint if exists leaddesk_events_tag_count;
alter table public.leaddesk_events
  add constraint leaddesk_events_tag_count check (cardinality(tag_ids) <= 10);

-- Keeps only ids that are tags, once each, in the order they were given.
create or replace function public.clean_leaddesk_event_tags()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.tag_ids := coalesce(
    (
      select array_agg(given.id order by given.first_at)
      from (
        select id, min(idx) as first_at
        from unnest(new.tag_ids) with ordinality as u(id, idx)
        group by id
      ) given
      where exists (select 1 from public.leaddesk_event_tags t where t.id = given.id)
    ),
    '{}'
  );
  return new;
end;
$$;

drop trigger if exists clean_leaddesk_event_tags on public.leaddesk_events;
create trigger clean_leaddesk_event_tags
  before insert or update of tag_ids on public.leaddesk_events
  for each row execute function public.clean_leaddesk_event_tags();

-- A deleted tag comes off every event, locked ones included.
create or replace function public.drop_leaddesk_event_tag()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.leaddesk_events
  set tag_ids = array_remove(tag_ids, old.id)
  where old.id = any (tag_ids);
  return old;
end;
$$;

drop trigger if exists drop_leaddesk_event_tag on public.leaddesk_event_tags;
create trigger drop_leaddesk_event_tag
  after delete on public.leaddesk_event_tags
  for each row execute function public.drop_leaddesk_event_tag();

revoke all on function public.clean_leaddesk_event_tags() from public, anon, authenticated;
revoke all on function public.drop_leaddesk_event_tag() from public, anon, authenticated;

-- Access: leaders and admins read the tags; only admins change them. ---------

alter table public.leaddesk_event_tags enable row level security;

grant select, insert, update, delete on public.leaddesk_event_tags to authenticated;
grant select, insert, update, delete on public.leaddesk_event_tags to service_role;

drop policy if exists "Leaders read event tags" on public.leaddesk_event_tags;
create policy "Leaders read event tags" on public.leaddesk_event_tags
  for select to authenticated using (public.is_leader() or public.is_admin());

drop policy if exists "Admins manage event tags" on public.leaddesk_event_tags;
create policy "Admins manage event tags" on public.leaddesk_event_tags
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Stream tag changes so a renamed or new tag shows in the app without a reload.
do $$
begin
  alter publication supabase_realtime add table public.leaddesk_event_tags;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
