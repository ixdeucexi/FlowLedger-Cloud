-- Preserve a bill's real due date. Users may still plan a different payment
-- date, but unpaid occurrences must not be moved forward by automation.

do $$
declare
  scheduled_job record;
begin
  for scheduled_job in
    select jobid
    from cron.job
    where jobname = 'flowledger-pro-calendar-rollover'
  loop
    perform cron.unschedule(scheduled_job.jobid);
  end loop;
exception
  when undefined_table or invalid_schema_name then
    null;
end
$$;

-- Restore only occurrences moved by the retired automation. Manual plans and
-- their forecast dates remain intact.
delete from public.bill_date_moves
where move_reason = 'automatic';

create or replace function private.rollover_pro_calendar_for_household(
  p_household_id uuid,
  p_local_today date
)
returns jsonb
language sql
security definer
set search_path = ''
as $function$
  select jsonb_build_object(
    'household_id', p_household_id,
    'local_date', p_local_today,
    'moved', 0,
    'disabled', true
  );
$function$;

create or replace function private.run_pro_calendar_rollover(
  p_run_at timestamptz default now()
)
returns jsonb
language sql
security definer
set search_path = ''
as $function$
  select jsonb_build_object(
    'households_checked', 0,
    'moved', 0,
    'ran_at', p_run_at,
    'disabled', true
  );
$function$;

create or replace function public.rollover_my_pro_calendar(
  p_household_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in to access calendar planning';
  end if;

  if not public.is_household_member(p_household_id) then
    raise exception 'Household access is required';
  end if;

  return jsonb_build_object(
    'household_id', p_household_id,
    'moved', 0,
    'disabled', true
  );
end;
$function$;

revoke all on function private.rollover_pro_calendar_for_household(uuid, date)
  from public, anon, authenticated;
revoke all on function private.run_pro_calendar_rollover(timestamptz)
  from public, anon, authenticated;
revoke all on function public.rollover_my_pro_calendar(uuid)
  from public, anon;
grant execute on function public.rollover_my_pro_calendar(uuid)
  to authenticated, service_role;

notify pgrst, 'reload schema';
