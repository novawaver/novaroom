-- Admins can always start direct chats and groups, like Leadership members.
-- Run this after 20261019150000_leaddesk_task_alerts.sql.

create or replace function public.may_start_chat(chat_kind text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_leader()
    or public.is_admin()
    or exists (
      select 1
      from public.chat_permissions p
      where p.user_id = auth.uid()
        and case when chat_kind = 'group' then p.can_start_group else p.can_start_direct end
    );
$$;
