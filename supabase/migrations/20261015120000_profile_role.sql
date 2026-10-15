-- Role shown on profiles and used to group people on the People page.

alter table public.profiles
  add column if not exists role text not null default '';
