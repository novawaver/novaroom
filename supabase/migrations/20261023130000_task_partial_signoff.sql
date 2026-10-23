-- A task whose assignees have only partly signed it done now shows as in progress instead of staying
-- "To do". Run this after 20261023120000_task_time_zone.sql.
--
-- sign_task is the same as in 20261022140000_task_signoffs.sql apart from the "doing" case for some
-- done results. Tasks already stuck are moved too.

create or replace function public.sign_task(task uuid, outcome text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.leaddesk_tasks;
  next_status text;
begin
  select * into t from public.leaddesk_tasks where id = task for update;
  if not found or not public.is_leader() or not (auth.uid() = any(t.assignee_ids)) then
    raise exception 'Only the task''s assignees can sign it.';
  end if;

  if outcome is null then
    delete from public.leaddesk_task_signoffs where task_id = task and user_id = auth.uid();
  elsif outcome in ('done', 'failed') then
    insert into public.leaddesk_task_signoffs (task_id, user_id, result)
    values (task, auth.uid(), outcome)
    on conflict (task_id, user_id) do update set result = excluded.result, signed_at = now();
  else
    raise exception 'A task is signed as done or failed.';
  end if;

  select case
    when exists (
      select 1 from public.leaddesk_task_signoffs s
      where s.task_id = task and s.result = 'failed' and s.user_id = any(t.assignee_ids)
    ) then 'failed'
    when not exists (
      select 1 from unnest(t.assignee_ids) as assigned(person)
      where not exists (
        select 1 from public.leaddesk_task_signoffs s
        where s.task_id = task and s.user_id = assigned.person and s.result = 'done'
      )
    ) then 'done'
    -- Some assignees have signed it done, the others not yet.
    when exists (
      select 1 from public.leaddesk_task_signoffs s
      where s.task_id = task and s.result = 'done' and s.user_id = any(t.assignee_ids)
    ) then 'doing'
    -- Taking back the result that finished the task puts it back in progress.
    when t.status in ('done', 'failed') then 'doing'
    else t.status
  end into next_status;

  if next_status is distinct from t.status then
    perform set_config('novaroom.task_signoff', 'on', true);
    update public.leaddesk_tasks set status = next_status, updated_at = now() where id = task;
    perform set_config('novaroom.task_signoff', 'off', true);
  end if;

  if outcome is not null
    and t.created_by is not null
    and t.created_by <> auth.uid()
    and exists (select 1 from public.profiles p where p.id = t.created_by) then
    insert into public.leaddesk_notifications (user_id, task_id, kind, title)
    values (t.created_by, task, 'task_' || outcome, t.title);
  end if;
end;
$$;

revoke all on function public.sign_task(uuid, text) from public, anon;
grant execute on function public.sign_task(uuid, text) to authenticated;

-- Tasks left "To do" though an assignee already signed them done.
update public.leaddesk_tasks t
set status = 'doing', updated_at = now()
where t.status = 'todo'
  and exists (
    select 1 from public.leaddesk_task_signoffs s
    where s.task_id = t.id and s.result = 'done' and s.user_id = any(t.assignee_ids)
  );
