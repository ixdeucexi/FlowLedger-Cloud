-- PostgREST can retain the caller JWT claims while a service-role client uses
-- the same pooled database. Authorize server-owned writes by the effective
-- database role, not the JWT claim role.

create or replace function public.guard_flo_ephemeral_conversations()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user in ('authenticated', 'anon')
    and (
      (tg_op = 'INSERT' and new.is_ephemeral)
      or (tg_op = 'UPDATE' and (
        old.is_ephemeral
        or new.is_ephemeral
        or old.is_ephemeral is distinct from new.is_ephemeral
      ))
    )
  then
    raise exception using errcode = '42501', message = 'ephemeral_conversations_are_server_owned';
  end if;
  return new;
end;
$$;

create or replace function public.guard_flo_assistant_messages()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user in ('authenticated', 'anon')
    and (
      (tg_op = 'INSERT' and new.role = 'assistant')
      or (tg_op = 'UPDATE' and (old.role = 'assistant' or new.role = 'assistant'))
    )
  then
    raise exception using errcode = '42501', message = 'assistant_messages_are_server_owned';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_flo_ephemeral_conversations()
  from public, anon, authenticated;
revoke all on function public.guard_flo_assistant_messages()
  from public, anon, authenticated;
