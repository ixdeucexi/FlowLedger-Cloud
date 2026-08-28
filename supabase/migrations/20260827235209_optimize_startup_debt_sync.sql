-- The startup pending-transaction read asks for the newest active rows for one
-- household. Plaid rows have required household attribution since
-- 20260825055642, so a second legacy user_id index would be unreachable.
create index if not exists plaid_transactions_household_active_pending_date_idx
  on public.plaid_transactions (household_id, transaction_date desc)
  where pending is true and removed_at is null;

-- Avoid rewriting every debt bill when the calculated snowball boost is
-- already correct. Keep the established public signature and invoker security
-- so all existing callers retain the same contract.
create or replace function public.recalculate_debt_minimum_boosts(
  p_household_id uuid default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_method text := 'snowball';
  v_freed_minimum numeric := 0;
  v_target_id text;
  v_month_start date := pg_catalog.date_trunc('month', current_date)::date;
  v_month_end date := (
    pg_catalog.date_trunc('month', current_date) + interval '1 month - 1 day'
  )::date;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_household_id is not null
     and not public.is_household_editor(p_household_id) then
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

  select coalesce(pg_catalog.sum(amount), 0)
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
       when start_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
         then start_date::date <= v_month_end
       else true
     end
     and case
       when end_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
         then end_date::date >= v_month_start
       else true
     end
     and (
       (p_household_id is not null and household_id = p_household_id) or
       (p_household_id is null and user_id = v_user_id)
     )
   order by
     case when v_method = 'avalanche' then interest_rate end desc nulls last,
     balance asc,
     case when v_method = 'snowball' then interest_rate end desc nulls last,
     id asc
   limit 1;

  update public.bills
     set snowball_minimum_boost = case
       when id = v_target_id and v_freed_minimum > 0 then v_freed_minimum
       else 0
     end
   where is_debt
     and snowball_minimum_boost is distinct from case
       when id = v_target_id and v_freed_minimum > 0 then v_freed_minimum
       else 0
     end
     and (
       (p_household_id is not null and household_id = p_household_id) or
       (p_household_id is null and user_id = v_user_id)
     );
end;
$$;

-- PostgreSQL cannot replace a function while changing its return type. There
-- are no database dependents on this RPC; existing clients ignore its response
-- and therefore remain compatible with the new JSON object.
do $sync_dependency_audit$
begin
  if exists (
    select 1
    from pg_catalog.pg_depend dependency
    where dependency.refobjid = pg_catalog.to_regprocedure(
        'public.sync_due_debt_transactions(date,uuid)'
      )
      and dependency.deptype not in ('i', 'e')
  ) then
    raise exception 'sync_due_debt_transactions has database dependents';
  end if;
end;
$sync_dependency_audit$;

drop function if exists public.sync_due_debt_transactions(date, uuid);

create function public.sync_due_debt_transactions(
  p_as_of_date date,
  p_household_id uuid default null
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_tx public.transactions%rowtype;
  v_desired numeric;
  v_current numeric;
  v_balance numeric;
  v_allocated_to_debt numeric;
  v_target_bill_id text;
  v_changed_id text;
  v_changed_transaction_ids text[] := array[]::text[];
  v_changed_bill_ids text[] := array[]::text[];
  v_boost_changed_bill_ids text[] := array[]::text[];
  v_boosts_before jsonb := '{}'::jsonb;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_household_id is not null
     and not public.is_household_editor(p_household_id) then
    raise exception 'Household edit access required';
  end if;

  -- Boost changes are part of the durable bill result. Snapshot their logical
  -- values so the response includes only bills whose saved value changed.
  select coalesce(
    pg_catalog.jsonb_object_agg(bill.id, bill.snowball_minimum_boost),
    '{}'::jsonb
  )
  into v_boosts_before
  from public.bills bill
  where bill.is_debt
    and (
      (p_household_id is not null and bill.household_id = p_household_id) or
      (p_household_id is null and bill.user_id = v_user_id)
    );

  for v_tx in
    select transaction_row.*
    from public.transactions transaction_row
    where (
        transaction_row.linked_bill_id is not null
        or transaction_row.debt_applied_bill_id is not null
        or transaction_row.debt_applied_amount > 0
      )
      and transaction_row.deleted_at is null
      and transaction_row.removed_at is null
      and not coalesce(transaction_row.pending, false)
      and (
        (
          p_household_id is not null
          and transaction_row.household_id = p_household_id
        ) or (
          p_household_id is null
          and transaction_row.user_id = v_user_id
        )
      )
    for update
  loop
    if v_tx.debt_applied_bill_id is not null
       and v_tx.debt_applied_bill_id is distinct from v_tx.linked_bill_id
       and v_tx.debt_applied_amount > 0 then
      v_changed_id := null;
      update public.bills
         set balance = balance + v_tx.debt_applied_amount
       where id = v_tx.debt_applied_bill_id
         and is_debt
         and (
           (p_household_id is not null and household_id = p_household_id) or
           (p_household_id is null and user_id = v_user_id)
         )
      returning id into v_changed_id;
      if v_changed_id is not null then
        v_changed_bill_ids := pg_catalog.array_append(
          v_changed_bill_ids,
          v_changed_id
        );
      end if;
      v_tx.debt_applied_amount := 0;
      v_tx.debt_applied_bill_id := null;
    end if;

    select pg_catalog.sum(
      coalesce((allocation ->> 'amount')::numeric, 0)
    )
    into v_allocated_to_debt
    from pg_catalog.jsonb_array_elements(
      coalesce(v_tx.review_allocations, '[]'::jsonb)
    ) allocation
    where allocation ->> 'type' in ('bill', 'extra_principal');

    v_desired := case
      when v_tx.linked_bill_id is not null
        and coalesce(v_tx.source, '') <> 'snowball_plan'
        and v_tx.amount < 0
        and v_tx.date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        and v_tx.date::date <= p_as_of_date
        then coalesce(v_allocated_to_debt, pg_catalog.abs(v_tx.amount))
      else 0
    end;
    v_current := case
      when v_tx.debt_applied_bill_id = v_tx.linked_bill_id
        then coalesce(v_tx.debt_applied_amount, 0)
      else 0
    end;

    if v_tx.linked_bill_id is not null and v_desired > 0 then
      v_balance := null;
      select balance
      into v_balance
      from public.bills
      where id = v_tx.linked_bill_id
        and is_debt
        and (
          (p_household_id is not null and household_id = p_household_id) or
          (p_household_id is null and user_id = v_user_id)
        )
      for update;
      if v_balance is null then
        v_changed_id := null;
        update public.transactions
           set linked_bill_id = null,
               debt_applied_amount = 0,
               debt_applied_bill_id = null
         where id = v_tx.id
           and (
             linked_bill_id is not null
             or debt_applied_amount is distinct from 0::numeric
             or debt_applied_bill_id is not null
           )
        returning id into v_changed_id;
        if v_changed_id is not null then
          v_changed_transaction_ids := pg_catalog.array_append(
            v_changed_transaction_ids,
            v_changed_id
          );
        end if;
        continue;
      end if;
      v_desired := least(v_desired, v_balance + v_current);
    end if;

    if v_tx.linked_bill_id is not null
       and pg_catalog.abs(v_desired - v_current) >= 0.005 then
      v_changed_id := null;
      update public.bills
         set balance = greatest(
           0,
           balance - (v_desired - v_current)
         )
       where id = v_tx.linked_bill_id
         and is_debt
         and (
           (p_household_id is not null and household_id = p_household_id) or
           (p_household_id is null and user_id = v_user_id)
         )
      returning id into v_changed_id;
      if v_changed_id is null then
        update public.transactions
           set linked_bill_id = null,
               debt_applied_amount = 0,
               debt_applied_bill_id = null
         where id = v_tx.id
           and (
             linked_bill_id is not null
             or debt_applied_amount is distinct from 0::numeric
             or debt_applied_bill_id is not null
           )
        returning id into v_changed_id;
        if v_changed_id is not null then
          v_changed_transaction_ids := pg_catalog.array_append(
            v_changed_transaction_ids,
            v_changed_id
          );
        end if;
        continue;
      end if;
      v_changed_bill_ids := pg_catalog.array_append(
        v_changed_bill_ids,
        v_changed_id
      );
    end if;

    v_target_bill_id := case
      when v_desired > 0 then v_tx.linked_bill_id
      else null
    end;
    v_changed_id := null;
    update public.transactions
       set debt_applied_amount = v_desired,
           debt_applied_bill_id = v_target_bill_id
     where id = v_tx.id
       and (
         (p_household_id is not null and household_id = p_household_id) or
         (p_household_id is null and user_id = v_user_id)
       )
       and (
         debt_applied_amount is distinct from v_desired
         or debt_applied_bill_id is distinct from v_target_bill_id
       )
    returning id into v_changed_id;
    if v_changed_id is not null then
      v_changed_transaction_ids := pg_catalog.array_append(
        v_changed_transaction_ids,
        v_changed_id
      );
    end if;
  end loop;

  perform public.recalculate_debt_minimum_boosts(p_household_id);

  select coalesce(
    pg_catalog.array_agg(bill.id order by bill.id),
    array[]::text[]
  )
  into v_boost_changed_bill_ids
  from public.bills bill
  where bill.is_debt
    and (
      (p_household_id is not null and bill.household_id = p_household_id) or
      (p_household_id is null and bill.user_id = v_user_id)
    )
    and (v_boosts_before ->> bill.id)::numeric
      is distinct from bill.snowball_minimum_boost;

  v_changed_bill_ids := v_changed_bill_ids || v_boost_changed_bill_ids;

  select coalesce(
    pg_catalog.array_agg(distinct changed_id order by changed_id),
    array[]::text[]
  )
  into v_changed_transaction_ids
  from pg_catalog.unnest(v_changed_transaction_ids) changed_id;

  select coalesce(
    pg_catalog.array_agg(distinct changed_id order by changed_id),
    array[]::text[]
  )
  into v_changed_bill_ids
  from pg_catalog.unnest(v_changed_bill_ids) changed_id;

  return pg_catalog.jsonb_build_object(
    'changed',
      pg_catalog.cardinality(v_changed_transaction_ids) > 0
      or pg_catalog.cardinality(v_changed_bill_ids) > 0,
    'changed_transaction_ids', v_changed_transaction_ids,
    'changed_bill_ids', v_changed_bill_ids
  );
end;
$$;

revoke all on function public.sync_due_debt_transactions(date, uuid)
from public, anon, service_role;
grant execute on function public.sync_due_debt_transactions(date, uuid)
to authenticated;

comment on function public.sync_due_debt_transactions(date, uuid) is
  'Atomically reconciles due debt effects and reports exact changed bill and transaction ids.';

do $startup_debt_acl_audit$
begin
  if pg_catalog.has_function_privilege(
      'anon',
      'public.sync_due_debt_transactions(date,uuid)',
      'execute'
    ) or not pg_catalog.has_function_privilege(
      'authenticated',
      'public.sync_due_debt_transactions(date,uuid)',
      'execute'
    ) or pg_catalog.has_function_privilege(
      'service_role',
      'public.sync_due_debt_transactions(date,uuid)',
      'execute'
    ) then
    raise exception 'sync_due_debt_transactions role grants are invalid';
  end if;
end;
$startup_debt_acl_audit$;

notify pgrst, 'reload schema';
