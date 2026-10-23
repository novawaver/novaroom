-- The time zone a task's due date is counted in: the creator's, saved when the task is added. A task
-- is due by the end of its due date on that zone's clock, wherever the person looking at it is.
-- Run this after 20261022140000_task_signoffs.sql.
--
-- Older tasks, and tasks added without a zone, have none; the app counts those in the viewer's zone.

alter table public.leaddesk_tasks
  add column if not exists time_zone text;

-- The same guard as in 20261022140000_task_signoffs.sql, now also covering time_zone, so an assignee
-- without the task permission can't move a deadline by changing it.
create or replace function public.guard_task_edits()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null
    or pg_trigger_depth() > 1
    or current_setting('novaroom.task_signoff', true) = 'on'
    or public.is_admin()
    or public.may_add_task() then
    return new;
  end if;

  if (new.title, new.notes, new.status, new.priority, new.assignee_ids, new.assignee_id, new.due_date, new.time_zone, new.created_by)
    is distinct from
    (old.title, old.notes, old.status, old.priority, old.assignee_ids, old.assignee_id, old.due_date, old.time_zone, old.created_by) then
    raise exception 'You need an admin''s permission to edit tasks. You can still add notes and sign your result.';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_task_edits() from public, anon, authenticated;
