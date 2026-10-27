-- Files attached to LeadDesk events. Run this after 20261026120000_hidden_messages.sql.
--
-- Each file is a row here and an object in the private leaddesk-files bucket at
-- "<event id>/<random id>/<file name>". Whoever can see an event can see its files; whoever can edit
-- it (not locked, or an admin) can add and remove them. Rows go with their event, but Supabase only
-- removes stored files through the Storage API, so the app removes them after deleting the event.

create table if not exists public.leaddesk_event_files (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.leaddesk_events (id) on delete cascade,
  path text not null unique,
  name text not null check (char_length(name) between 1 and 255),
  mime text not null default '' check (char_length(mime) <= 255),
  size bigint not null check (size >= 0),
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  check (path like event_id::text || '/%')
);

create index if not exists leaddesk_event_files_event_idx on public.leaddesk_event_files (event_id, created_at);

-- Whether the signed-in person may see an event, and so its files.
create or replace function public.can_read_leaddesk_event(eid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin()
    or exists (
      select 1 from public.leaddesk_events e
      where e.id = eid
        and public.can_see_leaddesk_event(e.visibility, e.created_by, e.participant_ids)
    );
$$;

-- Whether the signed-in person may change an event's files: as for editing the event itself.
create or replace function public.can_change_leaddesk_event(eid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin()
    or exists (
      select 1 from public.leaddesk_events e
      where e.id = eid
        and not e.locked
        and public.can_see_leaddesk_event(e.visibility, e.created_by, e.participant_ids)
    );
$$;

revoke all on function public.can_read_leaddesk_event(uuid) from public, anon;
grant execute on function public.can_read_leaddesk_event(uuid) to authenticated;
revoke all on function public.can_change_leaddesk_event(uuid) from public, anon;
grant execute on function public.can_change_leaddesk_event(uuid) to authenticated;

alter table public.leaddesk_event_files enable row level security;

grant select on public.leaddesk_event_files to anon;
grant select, insert, update, delete on public.leaddesk_event_files to authenticated;
grant select, insert, update, delete on public.leaddesk_event_files to service_role;

drop policy if exists "People read event files" on public.leaddesk_event_files;
create policy "People read event files" on public.leaddesk_event_files
  for select to authenticated using (public.can_read_leaddesk_event(event_id));

drop policy if exists "People add event files" on public.leaddesk_event_files;
create policy "People add event files" on public.leaddesk_event_files
  for insert to authenticated
  with check (public.can_change_leaddesk_event(event_id) and created_by = auth.uid());

drop policy if exists "People remove event files" on public.leaddesk_event_files;
create policy "People remove event files" on public.leaddesk_event_files
  for delete to authenticated using (public.can_change_leaddesk_event(event_id));

-- Stored files -------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit)
values ('leaddesk-files', 'leaddesk-files', false, 26214400)
on conflict (id) do update
set public = false,
    file_size_limit = 26214400;

drop policy if exists "People read event files" on storage.objects;
create policy "People read event files"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'leaddesk-files'
    and public.can_read_leaddesk_event(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "People upload event files" on storage.objects;
create policy "People upload event files"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'leaddesk-files'
    and public.can_change_leaddesk_event(((storage.foldername(name))[1])::uuid)
  );

-- Also the files of an event that is gone, which the app removes right after deleting it.
drop policy if exists "People remove event files" on storage.objects;
create policy "People remove event files"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'leaddesk-files'
    and (
      public.can_change_leaddesk_event(((storage.foldername(name))[1])::uuid)
      or (
        (public.is_leader() or public.is_admin())
        and not exists (
          select 1 from public.leaddesk_events e where e.id = ((storage.foldername(name))[1])::uuid
        )
      )
    )
  );

-- Stream file changes so files added after an event is saved appear for everyone.
do $$
begin
  alter publication supabase_realtime add table public.leaddesk_event_files;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
