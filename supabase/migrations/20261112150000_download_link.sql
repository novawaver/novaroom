-- The address of the Novaroom installer that the website's Download buttons send people to.
-- Set in Novaroom Admin > Downloads; read by https://novawave.llc/novaroom/download.

create table if not exists public.download_settings (
  id smallint primary key default 1 check (id = 1),
  windows_url text not null
    default 'https://downloads.novawave.llc/novaroom/0.6.0/Novaroom_0.6.0_x64-setup.exe',
  updated_at timestamptz not null default now(),
  constraint download_settings_windows_url check (windows_url ~ '^https://[^[:space:]]+$')
);

insert into public.download_settings (id) values (1) on conflict (id) do nothing;

-- No policies: the table is only reached through the functions below.
alter table public.download_settings enable row level security;

-- Public, because the website reads it without signing in. It returns only the address.
create or replace function public.novaroom_download_url()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select s.windows_url from public.download_settings s where s.id = 1;
$$;

grant execute on function public.novaroom_download_url() to anon, authenticated;

create or replace function public.admin_set_download_url(p_windows_url text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  cleaned text := btrim(coalesce(p_windows_url, ''));
begin
  perform public.require_admin();
  if cleaned !~ '^https://[^[:space:]]+$' then
    raise exception 'The download link must start with https:// and have no spaces';
  end if;
  update public.download_settings
  set windows_url = cleaned, updated_at = now()
  where id = 1;
  perform public.write_activity('admin', 'download.link', 'Changed the Novaroom download link');
end;
$$;

grant execute on function public.admin_set_download_url(text) to authenticated;
