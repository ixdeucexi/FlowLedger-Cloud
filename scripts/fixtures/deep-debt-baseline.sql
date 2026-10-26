-- Actual debt-sync fixture source SHA256 5fac3b6f5b527f38ab90eb6f79e59986e744bad7b8f2e5429ecb8bd7499e0b88
alter table public.bills add column "user_id" uuid not null;
alter table public.bills add column "name" text not null;
alter table public.bills add column "amount" numeric default 0 not null;
alter table public.bills add column "category" text default 'Other'::text not null;
alter table public.bills add column "priority" integer default 0 not null;
alter table public.bills add column "interest_rate" numeric default 0 not null;
alter table public.bills add column "due_day" integer default 1 not null;
alter table public.bills add column "day_of_week" integer;
alter table public.bills add column "start_date" text;
alter table public.bills add column "end_date" text;
alter table public.bills add column "is_recurring" boolean default true not null;
alter table public.bills add column "frequency" text default 'monthly'::text not null;
alter table public.bills add column "created_at" text not null;
alter table public.bills add column "include_in_snowball" boolean default true not null;
alter table public.bills add column "last_reviewed_at" timestamp with time zone default now() not null;
alter table public.bills add column "smart_priority" text default 'must'::text not null;
alter table public.bills add column "next_payment_date" text;
alter table public.bills add column "plaid_account_record_id" uuid;
alter table public.bills add column "plaid_account_id" text;
alter table public.bills add column "plaid_persistent_account_id" text;
alter table public.bills add column "plaid_last_synced_at" timestamp with time zone;
create table public.settings("user_id" uuid not null,"payment_method" text default 'snowball'::text not null,"starting_balance" numeric default 0 not null,"starting_balance_date" text,"safety_floor" numeric default 200 not null,"forecast_horizon_months" integer default 6 not null,"onboarding_completed" boolean default false not null,"planning_mode" text default 'snowball'::text not null,"zero_based_budget_enabled" boolean default false not null,"debt_payoff_enabled" boolean default true not null,"calendar_start_date" text);
create table public.household_settings("household_id" uuid not null,"budget_id" uuid,"payment_method" text default 'snowball'::text not null,"starting_balance" numeric default 0 not null,"starting_balance_date" text,"safety_floor" numeric default 200 not null,"forecast_horizon_months" integer default 6 not null,"onboarding_completed" boolean default false not null,"updated_at" timestamp with time zone default now() not null,"planning_mode" text default 'snowball'::text not null,"zero_based_budget_enabled" boolean default false not null,"debt_payoff_enabled" boolean default true not null,"calendar_start_date" text,"time_zone" text default 'UTC'::text not null,"automatic_rollover_started_on" date default CURRENT_DATE not null);
CREATE OR REPLACE FUNCTION public.recalculate_debt_minimum_boosts(p_household_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
$function$
;
CREATE OR REPLACE FUNCTION public.sync_due_debt_transactions(p_as_of_date date, p_household_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
$function$
;
grant select,update on public.bills to authenticated;
grant select on public.settings,public.household_settings to authenticated;
CREATE OR REPLACE FUNCTION public.assign_personal_budget()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.household_id is null or new.budget_id is null then
    select h.id, b.id into new.household_id, new.budget_id
      from households h join budgets b on b.household_id = h.id and b.is_default
      where h.created_by = new.user_id and h.is_personal limit 1;
  end if;
  return new;
end $function$
;
CREATE TRIGGER assign_bills_budget BEFORE INSERT ON public.bills FOR EACH ROW EXECUTE FUNCTION assign_personal_budget();
CREATE OR REPLACE FUNCTION private.cancel_pending_matches_for_removed_target()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id text := case when tg_op = 'DELETE' then old.id else new.id end;
  v_inactive boolean := tg_op = 'DELETE';
begin
  if tg_table_name = 'transactions' and tg_op <> 'DELETE' then
    v_inactive := new.removed_at is not null or new.deleted_at is not null;
    if new.match_reason = 'replaced_by_posted_transaction' then return new; end if;
  end if;
  if not v_inactive then return new; end if;

  update public.pending_plan_matches
  set status = 'cancelled', updated_at = now()
  where target_type = case when tg_table_name = 'transactions' then 'manual' else 'bill' end
    and target_id = v_id
    and status in ('active', 'ready_review');
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$
;
CREATE TRIGGER bills_cancel_pending_plan_matches AFTER DELETE ON public.bills FOR EACH ROW EXECUTE FUNCTION private.cancel_pending_matches_for_removed_target();
