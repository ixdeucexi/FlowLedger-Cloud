-- An occurrence with no monthly override has NULL paid fields. Treat that as
-- unpaid instead of letting SQL's three-valued logic exclude it from rollover.
do $migration$
declare
  v_function_name text;
  v_source text;
  v_updated_source text;
  v_old_fragment text := $old$
      and not (
        occurrence.paid_date = occurrence.visible_date
        and (
          occurrence.actual_amount is not null
          or occurrence.paid_amount >= occurrence.expected_amount - 0.005
        )
      )
$old$;
  v_new_fragment text := $new$
      and not coalesce((
        occurrence.paid_date = occurrence.visible_date
        and (
          occurrence.actual_amount is not null
          or occurrence.paid_amount >= occurrence.expected_amount - 0.005
        )
      ), false)
$new$;
begin
  foreach v_function_name in array array[
    'rollover_pro_calendar_standard_for_household',
    'rollover_pro_calendar_for_household'
  ]
  loop
    select procedure.prosrc
      into v_source
    from pg_proc as procedure
    join pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'private'
      and procedure.proname = v_function_name
      and procedure.proargtypes = '2950 1082'::oidvector;

    if v_source is null then
      raise exception 'Missing private.%(uuid, date)', v_function_name;
    end if;

    v_updated_source := replace(v_source, v_old_fragment, v_new_fragment);
    if v_updated_source = v_source then
      raise exception 'Could not update NULL paid-state handling in private.%', v_function_name;
    end if;

    execute format(
      'create or replace function private.%I(p_household_id uuid, p_local_today date)
       returns jsonb
       language plpgsql
       security definer
       set search_path = ''''
       as %L',
      v_function_name,
      v_updated_source
    );
  end loop;
end;
$migration$;

revoke all on function private.rollover_pro_calendar_standard_for_household(uuid, date)
  from public, anon, authenticated;
revoke all on function private.rollover_pro_calendar_for_household(uuid, date)
  from public, anon, authenticated;

;
