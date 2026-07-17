-- Keep the persisted rollover on exactly one eligible debt for the current
-- month. Paid debts continue contributing their freed base minimum, while
-- excluded, future, and already-stopped debts cannot become the next target.

create or replace function public.recalculate_debt_minimum_boosts(
  p_household_id uuid default null
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_method text := 'snowball';
  v_freed_minimum numeric := 0;
  v_target_id text;
  v_month_start date := date_trunc('month', current_date)::date;
  v_month_end date := (date_trunc('month', current_date) + interval '1 month - 1 day')::date;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_household_id is not null and not public.is_household_editor(p_household_id) then
    raise exception 'Household edit access required';
  end if;

  select coalesce(hs.payment_method, s.payment_method, 'snowball')
    into v_method
    from (select 1) seed
    left join public.household_settings hs
      on p_household_id is not null and hs.household_id = p_household_id
    left join public.settings s
      on s.user_id = v_user_id
   limit 1;

  update public.bills
     set snowball_minimum_boost = 0
   where is_debt
     and (
       (p_household_id is not null and household_id = p_household_id) or
       (p_household_id is null and user_id = v_user_id)
     );

  select coalesce(sum(amount), 0)
    into v_freed_minimum
    from public.bills
   where is_debt
     and include_in_snowball is not false
     and balance <= 0.009
     and (
       (p_household_id is not null and household_id = p_household_id) or
       (p_household_id is null and user_id = v_user_id)
     );

  select id
    into v_target_id
    from public.bills
   where is_debt
     and include_in_snowball is not false
     and balance > 0.009
     and case
       when start_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then start_date::date <= v_month_end
       else true
     end
     and case
       when end_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then end_date::date >= v_month_start
       else true
     end
     and (
       (p_household_id is not null and household_id = p_household_id) or
       (p_household_id is null and user_id = v_user_id)
     )
   order by
     case when v_method = 'avalanche' then interest_rate end desc nulls last,
     balance asc,
     id asc
   limit 1;

  if v_target_id is not null and v_freed_minimum > 0 then
    update public.bills
       set snowball_minimum_boost = v_freed_minimum
     where id = v_target_id
       and (
         (p_household_id is not null and household_id = p_household_id) or
         (p_household_id is null and user_id = v_user_id)
       );
  end if;
end;
$$;

notify pgrst, 'reload schema';
