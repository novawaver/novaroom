-- A task's status follows its assignees' results when the assignees change, not only when someone
-- signs. Run this after 20261023130000_task_partial_signoff.sql.
--
-- Before, taking someone off a task dropped their result but left the status alone: with two
-- assignees, one signed done, removing the other left the task "In progress" instead of done. Adding
-- someone to a finished task now puts it back in progress until they sign too. Tasks already left
-- with the wrong status are fixed at the end.

-- The status a task gets from its assignees' results: failed when anyone failed it, done when all of
-- them signed done, in progress while only some have. With no results, a finished task goes back to
-- in progress and any other keeps its status. A task with no assignees keeps its status.
create or replace function public.task_signed_status(t public.leaddesk_tasks)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when coalesce(array_length(t.assignee_ids, 1), 0) = 0 then t.status
    when exists (
      select 1 from public.leaddesk_task_signoffs s
      where s.task_id = t.id and s.result = 'failed' and s.user_id = any(t.assignee_ids)
    ) then 'failed'
    when not exists (
      select 1 from unnest(t.assignee_ids) as assigned(person)
      where not exists (
        select 1 from public.leaddesk_task_signoffs s
        where s.task_id = t.id and s.user_id = assigned.person and s.result = 'done'
      )
    ) then 'done'
    when exists (
      select 1 from public.leaddesk_task_signoffs s
      where s.task_id = t.id and s.result = 'done' and s.user_id = any(t.assignee_ids)
    ) then 'doing'
    when t.status in ('done', 'failed') then 'doing'
    else t.status
  end;
$$;

revoke all on function public.task_signed_status(public.leaddesk_tasks) from public, anon, authenticated;

-- Signs the signed-in assignee's result on a task: 'done', 'failed', or null to take it back.
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

  next_status := public.task_signed_status(t);
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

-- Someone taken off a task loses their result on it, and the status is worked out again from the
-- results left. Only when the assignees really changed: saving a task sends them every time, and a
-- status set by hand on the admin website should stay.
create or replace function public.drop_removed_signoffs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  next_status text;
begin
  delete from public.leaddesk_task_signoffs s
  where s.task_id = new.id
    and not (s.user_id = any(new.assignee_ids));

  if new.assignee_ids is distinct from old.assignee_ids then
    next_status := public.task_signed_status(new);
    if next_status is distinct from new.status then
      -- Runs inside this trigger, so guard_task_edits lets it through (pg_trigger_depth() > 1).
      update public.leaddesk_tasks set status = next_status, updated_at = now() where id = new.id;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.drop_removed_signoffs() from public, anon, authenticated;

-- Tasks whose status no longer matches their assignees' results.
update public.leaddesk_tasks t
set status = public.task_signed_status(t), updated_at = now()
where coalesce(array_length(t.assignee_ids, 1), 0) > 0
  and exists (select 1 from public.leaddesk_task_signoffs s where s.task_id = t.id)
  and public.task_signed_status(t) is distinct from t.status;
