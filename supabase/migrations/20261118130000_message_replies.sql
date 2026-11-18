-- Replying to a message. Run this after 20261118120000_edit_message.sql.
--
-- A message can answer another message of the same chat, which the app then shows above it. If the
-- answered message is later removed for good, the reply stays, without the quote.

alter table public.messages
  add column if not exists reply_to uuid references public.messages (id) on delete set null;

-- A reply only points at a message of its own chat; anything else is dropped rather than refused,
-- so the message itself is still sent.
create or replace function public.messages_check_reply()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.reply_to is not null and not exists (
    select 1 from public.messages m
    where m.id = new.reply_to and m.conversation_id = new.conversation_id
  ) then
    new.reply_to := null;
  end if;
  return new;
end;
$$;

drop trigger if exists messages_check_reply on public.messages;
create trigger messages_check_reply
  before insert on public.messages
  for each row execute function public.messages_check_reply();
