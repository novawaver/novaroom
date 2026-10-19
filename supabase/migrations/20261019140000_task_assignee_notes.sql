-- Notes from a task's assignee about the result. Run this after 20261019130000_task_permissions.sql.
--
-- The app now labels the existing notes column "Description"; the column keeps its name so older
-- app versions keep working. assignee_notes can only be written by the task's assignee (or an
-- admin), even though every leader can edit the rest of the task.

alter table public.leaddesk_tasks
  add column if not exists assignee_notes text not null default '';

alter table public.leaddesk_tasks
  drop constraint if exists leaddesk_tasks_assignee_notes_length;
alter table public.leaddesk_tasks
  add constraint leaddesk_tasks_assignee_notes_length check (char_length(assignee_notes) <= 2000);

create or replace function public.guard_task_assignee_notes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- No signed-in user means the SQL editor or another trusted backend.
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.assignee_notes := '';
    return new;
  end if;

  if new.assignee_notes is distinct from old.assignee_notes
    and (old.assignee_id is null or old.assignee_id <> auth.uid()) then
    raise exception 'Only the assignee can write notes from the assignee';
  end if;

  return new;
end;
$$;

drop trigger if exists leaddesk_tasks_assignee_notes on public.leaddesk_tasks;
create trigger leaddesk_tasks_assignee_notes
  before insert or update on public.leaddesk_tasks
  for each row execute function public.guard_task_assignee_notes();
