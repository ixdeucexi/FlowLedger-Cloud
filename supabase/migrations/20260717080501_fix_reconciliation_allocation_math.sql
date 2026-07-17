-- Preserve the original manual state once, then derive planned-expense
-- progress from every reviewed allocation. This makes partial payments
-- cumulative and makes undo independent of review order.
create table if not exists private.planned_reconciliation_bases (
  target_type text not null check (target_type in ('goal', 'decision')),
  target_id text not null,
  base_amount numeric not null default 0,
  base_status text,
  base_completed_at timestamptz,
  primary key (target_type, target_id)
);

revoke all on table private.planned_reconciliation_bases from public, anon, authenticated, service_role;

create or replace function private.recompute_planned_reconciliation_target(
  p_target_type text,
  p_target_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base private.planned_reconciliation_bases%rowtype;
  v_total numeric := 0;
  v_count integer := 0;
  v_has_closing boolean := false;
  v_latest timestamptz;
begin
  select * into v_base
  from private.planned_reconciliation_bases
  where target_type = p_target_type and target_id = p_target_id;
  if not found then return; end if;

  select
    coalesce(sum(
      case when allocation->>'type' = 'planned_expense'
        then coalesce((allocation->>'amount')::numeric, 0)
        else 0
      end
    ), 0),
    count(distinct reconciliation.transaction_id),
    coalesce(bool_or(reconciliation.settlement in ('exact', 'full', 'split')), false),
    max(reconciliation.reviewed_at)
  into v_total, v_count, v_has_closing, v_latest
  from public.transaction_reconciliations reconciliation
  left join lateral jsonb_array_elements(reconciliation.allocations) allocation on true
  where reconciliation.resolution = p_target_type
    and reconciliation.target_id = p_target_id;

  if p_target_type = 'goal' then
    update public.goals
    set current_amount = case
      when v_count = 0 then v_base.base_amount
      when v_has_closing then target_amount
      else least(target_amount, v_base.base_amount + v_total)
    end
    where id = p_target_id;
  elsif p_target_type = 'decision' then
    update public.decisions
    set actual_amount = case when v_count = 0 then nullif(v_base.base_amount, 0) else v_base.base_amount + v_total end,
        status = case
          when v_count = 0 then coalesce(v_base.base_status, status)
          when v_has_closing
            or v_base.base_amount + v_total + 0.005 >= abs(coalesce((scenario->>'amount')::numeric, 0))
            then 'completed'
          else coalesce(v_base.base_status, status)
        end,
        completed_at = case
          when v_count = 0 then v_base.base_completed_at
          when v_has_closing
            or v_base.base_amount + v_total + 0.005 >= abs(coalesce((scenario->>'amount')::numeric, 0))
            then coalesce(v_latest, now())
          else v_base.base_completed_at
        end,
        updated_at = now()
    where id = p_target_id;
  end if;

  if v_count = 0 then
    delete from private.planned_reconciliation_bases
    where target_type = p_target_type and target_id = p_target_id;
  end if;
end;
$$;

revoke all on function private.recompute_planned_reconciliation_target(text, text)
from public, anon, authenticated, service_role;

create or replace function private.sync_planned_reconciliation_progress()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.transaction_reconciliations%rowtype;
begin
  v_row := case when tg_op = 'DELETE' then old else new end;

  if tg_op <> 'DELETE' and v_row.resolution in ('goal', 'decision') and v_row.target_id is not null then
    insert into private.planned_reconciliation_bases (
      target_type, target_id, base_amount, base_status, base_completed_at
    ) values (
      v_row.resolution,
      v_row.target_id,
      case
        when v_row.resolution = 'goal'
          then coalesce((v_row.restore_snapshot->>'goalCurrentAmount')::numeric, 0)
        else coalesce((v_row.restore_snapshot->>'decisionActualAmount')::numeric, 0)
      end,
      case when v_row.resolution = 'decision' then v_row.restore_snapshot->>'decisionStatus' else null end,
      case
        when v_row.resolution = 'decision' and nullif(v_row.restore_snapshot->>'decisionCompletedAt', '') is not null
          then (v_row.restore_snapshot->>'decisionCompletedAt')::timestamptz
        else null
      end
    )
    on conflict (target_type, target_id) do nothing;
  end if;

  if tg_op = 'UPDATE'
    and old.resolution in ('goal', 'decision')
    and old.target_id is not null
    and row(old.resolution, old.target_id) is distinct from row(new.resolution, new.target_id) then
    perform private.recompute_planned_reconciliation_target(old.resolution, old.target_id);
  end if;

  if v_row.resolution in ('goal', 'decision') and v_row.target_id is not null then
    perform private.recompute_planned_reconciliation_target(v_row.resolution, v_row.target_id);
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function private.sync_planned_reconciliation_progress()
from public, anon, authenticated, service_role;

insert into private.planned_reconciliation_bases (
  target_type, target_id, base_amount, base_status, base_completed_at
)
select
  first_review.resolution,
  first_review.target_id,
  case
    when first_review.resolution = 'goal'
      then coalesce((first_review.restore_snapshot->>'goalCurrentAmount')::numeric, 0)
    else coalesce((first_review.restore_snapshot->>'decisionActualAmount')::numeric, 0)
  end,
  case when first_review.resolution = 'decision' then first_review.restore_snapshot->>'decisionStatus' else null end,
  case
    when first_review.resolution = 'decision' and nullif(first_review.restore_snapshot->>'decisionCompletedAt', '') is not null
      then (first_review.restore_snapshot->>'decisionCompletedAt')::timestamptz
    else null
  end
from (
  select distinct on (resolution, target_id)
    resolution, target_id, restore_snapshot
  from public.transaction_reconciliations
  where resolution in ('goal', 'decision') and target_id is not null
  order by resolution, target_id, reviewed_at, transaction_id
) first_review
on conflict (target_type, target_id) do nothing;

do $$
declare
  target record;
begin
  for target in
    select target_type, target_id from private.planned_reconciliation_bases
  loop
    perform private.recompute_planned_reconciliation_target(target.target_type, target.target_id);
  end loop;
end;
$$;

drop trigger if exists sync_planned_reconciliation_progress on public.transaction_reconciliations;
create trigger sync_planned_reconciliation_progress
after insert or update or delete on public.transaction_reconciliations
for each row execute function private.sync_planned_reconciliation_progress();

-- Debt balance changes follow the allocation ledger. A category split reduces
-- debt only by its bill allocation; explicit extra principal still counts.
create or replace function public.sync_due_debt_transactions(
  p_as_of_date date,
  p_household_id uuid default null
)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_tx record;
  v_desired numeric;
  v_current numeric;
  v_balance numeric;
  v_allocated_to_debt numeric;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_household_id is not null and not public.is_household_editor(p_household_id) then
    raise exception 'Household edit access required';
  end if;

  for v_tx in
    select *
    from public.transactions
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
      update public.bills
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

    select sum(coalesce((allocation->>'amount')::numeric, 0))
    into v_allocated_to_debt
    from jsonb_array_elements(coalesce(v_tx.review_allocations, '[]'::jsonb)) allocation
    where allocation->>'type' in ('bill', 'extra_principal');

    v_desired := case
      when v_tx.linked_bill_id is not null
        and v_tx.amount < 0
        and v_tx.date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        and v_tx.date::date <= p_as_of_date
        then coalesce(v_allocated_to_debt, abs(v_tx.amount))
      else 0
    end;
    v_current := case
      when v_tx.debt_applied_bill_id = v_tx.linked_bill_id
        then coalesce(v_tx.debt_applied_amount, 0)
      else 0
    end;

    if v_tx.linked_bill_id is not null and v_desired > 0 then
      v_balance := null;
      select balance into v_balance
      from public.bills
      where id = v_tx.linked_bill_id
        and is_debt
        and (
          (p_household_id is not null and household_id = p_household_id) or
          (p_household_id is null and user_id = v_user_id)
        )
      for update;
      if v_balance is null then
        update public.transactions
        set linked_bill_id = null,
            debt_applied_amount = 0,
            debt_applied_bill_id = null
        where id = v_tx.id;
        continue;
      end if;
      v_desired := least(v_desired, v_balance + v_current);
    end if;

    if v_tx.linked_bill_id is not null and abs(v_desired - v_current) >= 0.005 then
      update public.bills
      set balance = greatest(0, balance - (v_desired - v_current))
      where id = v_tx.linked_bill_id
        and is_debt
        and (
          (p_household_id is not null and household_id = p_household_id) or
          (p_household_id is null and user_id = v_user_id)
        );
      if not found then
        update public.transactions
        set linked_bill_id = null,
            debt_applied_amount = 0,
            debt_applied_bill_id = null
        where id = v_tx.id;
        continue;
      end if;
    end if;

    update public.transactions
    set debt_applied_amount = v_desired,
        debt_applied_bill_id = case when v_desired > 0 then v_tx.linked_bill_id else null end
    where id = v_tx.id
      and (
        (p_household_id is not null and household_id = p_household_id) or
        (p_household_id is null and user_id = v_user_id)
      );
  end loop;

  perform public.recalculate_debt_minimum_boosts(p_household_id);
end;
$$;

notify pgrst, 'reload schema';
