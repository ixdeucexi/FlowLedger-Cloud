-- Keep elevated implementations out of the exposed API schema. Public wrappers
-- run with the caller's role and only forward to the individually granted private
-- implementation.

alter function public.rollover_my_pro_calendar(uuid)
  set schema private;
alter function public.reconcile_posted_to_manual_transaction(text, text, date, numeric, text)
  set schema private;
alter function public.undo_posted_manual_transaction_match(text)
  set schema private;
grant usage on schema private to authenticated, service_role;
revoke all on function private.rollover_my_pro_calendar(uuid)
  from public, anon, authenticated;
revoke all on function private.reconcile_posted_to_manual_transaction(text, text, date, numeric, text)
  from public, anon, authenticated;
revoke all on function private.undo_posted_manual_transaction_match(text)
  from public, anon, authenticated;
grant execute on function private.rollover_my_pro_calendar(uuid)
  to authenticated, service_role;
grant execute on function private.reconcile_posted_to_manual_transaction(text, text, date, numeric, text)
  to authenticated, service_role;
grant execute on function private.undo_posted_manual_transaction_match(text)
  to authenticated, service_role;
create function public.rollover_my_pro_calendar(
  p_household_id uuid
)
returns jsonb
language sql
security invoker
set search_path = ''
as $function$
  select private.rollover_my_pro_calendar(p_household_id);
$function$;
create function public.reconcile_posted_to_manual_transaction(
  p_transaction_id text,
  p_manual_transaction_id text,
  p_occurrence_date date,
  p_planned_amount numeric,
  p_settlement text default 'exact'
)
returns jsonb
language sql
security invoker
set search_path = ''
as $function$
  select private.reconcile_posted_to_manual_transaction(
    p_transaction_id,
    p_manual_transaction_id,
    p_occurrence_date,
    p_planned_amount,
    p_settlement
  );
$function$;
create function public.undo_posted_manual_transaction_match(
  p_transaction_id text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $function$
  select private.undo_posted_manual_transaction_match(p_transaction_id);
$function$;
revoke all on function public.rollover_my_pro_calendar(uuid)
  from public, anon;
revoke all on function public.reconcile_posted_to_manual_transaction(text, text, date, numeric, text)
  from public, anon;
revoke all on function public.undo_posted_manual_transaction_match(text)
  from public, anon;
grant execute on function public.rollover_my_pro_calendar(uuid)
  to authenticated, service_role;
grant execute on function public.reconcile_posted_to_manual_transaction(text, text, date, numeric, text)
  to authenticated, service_role;
grant execute on function public.undo_posted_manual_transaction_match(text)
  to authenticated, service_role;
revoke all on function public.protect_transaction_review_state()
  from public, anon, authenticated;
notify pgrst, 'reload schema';
