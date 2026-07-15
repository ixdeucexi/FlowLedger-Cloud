-- A removed or cross-household debt must not block every scheduled debt edit.
-- Clear the stale transaction link and continue processing the remaining rows.

create or replace function public.sync_due_debt_transactions(
  p_as_of_date date,
  p_household_id uuid default null
)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_tx record;
  v_desired numeric;
  v_current numeric;
  v_balance numeric;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_household_id is not null and not public.is_household_editor(p_household_id) then
    raise exception 'Household edit access required';
  end if;

  for v_tx in
    select *
      from transactions
     where (linked_bill_id is not null or debt_applied_bill_id is not null or debt_applied_amount > 0)
       and (
         (p_household_id is not null and household_id = p_household_id) or
         (p_household_id is null and user_id = v_user_id)
       )
     for update
  loop
    if v_tx.debt_applied_bill_id is not null
       and v_tx.debt_applied_bill_id is distinct from v_tx.linked_bill_id
       and v_tx.debt_applied_amount > 0 then
      update bills
         set balance = balance + v_tx.debt_applied_amount
       where id = v_tx.debt_applied_bill_id
         and is_debt
         and (
           (p_household_id is not null and household_id = p_household_id) or
           (p_household_id is null and user_id = v_user_id)
         );
      v_tx.debt_applied_amount := 0;
      v_tx.debt_applied_bill_id := null;
    end if;

    v_desired := case
      when v_tx.linked_bill_id is not null
        and v_tx.amount < 0
        and v_tx.date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        and v_tx.date::date <= p_as_of_date
        then abs(v_tx.amount)
      else 0
    end;
    v_current := case when v_tx.debt_applied_bill_id = v_tx.linked_bill_id then coalesce(v_tx.debt_applied_amount, 0) else 0 end;

    if v_tx.linked_bill_id is not null and v_desired > 0 then
      v_balance := null;
      select balance into v_balance
        from bills
       where id = v_tx.linked_bill_id
         and is_debt
         and (
           (p_household_id is not null and household_id = p_household_id) or
           (p_household_id is null and user_id = v_user_id)
         )
       for update;
      if v_balance is null then
        update transactions
           set linked_bill_id = null,
               debt_applied_amount = 0,
               debt_applied_bill_id = null
         where id = v_tx.id;
        continue;
      end if;
      v_desired := least(v_desired, v_balance + v_current);
    end if;

    if v_tx.linked_bill_id is not null and abs(v_desired - v_current) >= 0.005 then
      update bills
         set balance = greatest(0, balance - (v_desired - v_current))
       where id = v_tx.linked_bill_id
         and is_debt
         and (
           (p_household_id is not null and household_id = p_household_id) or
           (p_household_id is null and user_id = v_user_id)
         );
      if not found then
        update transactions
           set linked_bill_id = null,
               debt_applied_amount = 0,
               debt_applied_bill_id = null
         where id = v_tx.id;
        continue;
      end if;
    end if;

    update transactions
       set debt_applied_amount = v_desired,
           debt_applied_bill_id = case when v_desired > 0 then v_tx.linked_bill_id else null end
     where id = v_tx.id
       and (
         (p_household_id is not null and household_id = p_household_id) or
         (p_household_id is null and user_id = v_user_id)
       );
  end loop;

  perform recalculate_debt_minimum_boosts(p_household_id);
end;
$$;

notify pgrst, 'reload schema';
