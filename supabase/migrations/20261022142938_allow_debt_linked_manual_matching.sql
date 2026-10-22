-- Permit otherwise eligible manual debt payments to be replaced by posted bank activity.
-- Preserve current permissions/entitlement rules and canonical debt synchronization.

drop policy if exists "pending plan matches: pro editors insert"
  on public.pending_plan_matches;

create policy "pending plan matches: pro editors insert"
on public.pending_plan_matches for insert to authenticated
with check (
  user_id = (select auth.uid())
  and created_by = (select auth.uid())
  and public.is_household_editor(household_id)
  and (
    (
      target_type = 'bill'
      and exists (
        select 1
        from public.bills bill
        where bill.id = pending_plan_matches.target_id
          and bill.household_id = pending_plan_matches.household_id
      )
    )
    or (
      target_type = 'manual'
      and exists (
        select 1
        from public.transactions manual
        where manual.id = pending_plan_matches.target_id
          and manual.household_id = pending_plan_matches.household_id
          and manual.budget_id is not distinct from pending_plan_matches.budget_id
          and manual.source is distinct from 'plaid'
          and manual.amount < 0
          and manual.pending is not true
          and manual.removed_at is null
          and manual.deleted_at is null
          and manual.import_hash is null
          and manual.transfer_group_id is null
          and (
            manual.linked_bill_id is null
            or (
              (manual.source is null or manual.source = 'manual')
              and exists (
                select 1 from public.bills linked_debt
                where linked_debt.id = manual.linked_bill_id
                  and linked_debt.household_id = manual.household_id
                  and linked_debt.budget_id is not distinct from manual.budget_id
                  and linked_debt.is_debt = true
              )
            )
          )
          and manual.linked_plan_id is null
          and manual.review_status is distinct from 'matched'
          and manual.category is distinct from 'Transfer'
          and date_trunc('month', manual.date::date)
            = date_trunc('month', pending_plan_matches.pending_transaction_date)
      )
    )
  )
  and exists (
    select 1
    from public.plaid_transactions pt
    where pt.household_id = pending_plan_matches.household_id
      and pt.plaid_transaction_id = pending_plan_matches.pending_plaid_transaction_id
      and pt.pending = true
      and pt.removed_at is null
  )
  and exists (
    select 1
    from public.household_plans plan
    where plan.household_id = pending_plan_matches.household_id
      and plan.tier = 'pro'
  )
);

drop policy if exists "pending plan matches: pro editors update"
  on public.pending_plan_matches;

create policy "pending plan matches: pro editors update"
on public.pending_plan_matches for update to authenticated
using (
  public.is_household_editor(household_id)
  and exists (
    select 1
    from public.household_plans plan
    where plan.household_id = pending_plan_matches.household_id
      and plan.tier = 'pro'
  )
)
with check (
  public.is_household_editor(household_id)
  and status in ('active', 'cancelled')
  and (
    status = 'cancelled'
    or (
      (
        target_type = 'bill'
        and exists (
          select 1
          from public.bills bill
          where bill.id = pending_plan_matches.target_id
            and bill.household_id = pending_plan_matches.household_id
        )
      )
      or (
        target_type = 'manual'
        and exists (
          select 1
          from public.transactions manual
          where manual.id = pending_plan_matches.target_id
            and manual.household_id = pending_plan_matches.household_id
            and manual.budget_id is not distinct from pending_plan_matches.budget_id
            and manual.source is distinct from 'plaid'
            and manual.amount < 0
            and manual.pending is not true
            and manual.removed_at is null
            and manual.deleted_at is null
            and manual.import_hash is null
            and manual.transfer_group_id is null
            and (
            manual.linked_bill_id is null
            or (
              (manual.source is null or manual.source = 'manual')
              and exists (
                select 1 from public.bills linked_debt
                where linked_debt.id = manual.linked_bill_id
                  and linked_debt.household_id = manual.household_id
                  and linked_debt.budget_id is not distinct from manual.budget_id
                  and linked_debt.is_debt = true
              )
            )
          )
            and manual.linked_plan_id is null
            and manual.review_status is distinct from 'matched'
            and manual.category is distinct from 'Transfer'
            and date_trunc('month', manual.date::date)
              = date_trunc('month', pending_plan_matches.pending_transaction_date)
        )
      )
    )
  )
  and exists (
    select 1
    from public.household_plans plan
    where plan.household_id = pending_plan_matches.household_id
      and plan.tier = 'pro'
  )
  and (
    status = 'cancelled'
    or exists (
      select 1
      from public.plaid_transactions pt
      where pt.household_id = pending_plan_matches.household_id
        and pt.plaid_transaction_id = pending_plan_matches.pending_plaid_transaction_id
        and pt.pending = true
        and pt.removed_at is null
    )
  )
);

CREATE OR REPLACE FUNCTION private.reconcile_manual_transaction(p_transaction_id text, p_manual_transaction_id text, p_occurrence_date date, p_planned_amount numeric, p_settlement text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_tx public.transactions%rowtype;
  v_manual public.transactions%rowtype;
  v_existing public.transaction_reconciliations%rowtype;
  v_actual numeric;
  v_allocations jsonb;
  v_snapshot jsonb;
  v_now timestamptz := now();
begin
  if (select auth.uid()) is null then raise exception 'Sign in to review transactions'; end if;

  select * into v_tx
  from public.transactions
  where id = p_transaction_id
    and source = 'plaid'
    and removed_at is null
    and deleted_at is null
    and pending is not true
  for update;
  if not found then raise exception 'Posted bank transaction was not found'; end if;
  if v_tx.amount >= 0 then raise exception 'Only money-out transactions can match a manual plan'; end if;
  -- A second existing applied payment cannot be silently overwritten while
  -- transferring ownership of the manual payment. Refresh/review it first.
  if coalesce(v_tx.debt_applied_amount, 0) <> 0 or v_tx.debt_applied_bill_id is not null then
    raise exception 'This bank transaction already has an applied debt payment. Refresh Review Center before matching';
  end if;
  if v_tx.review_status is distinct from 'needs_review' then
    raise exception 'This transaction has already been reviewed';
  end if;

  if v_tx.household_id is null or not public.is_household_editor(v_tx.household_id) then
    raise exception 'You need household edit access to review transactions';
  end if;
  if not exists (
    select 1 from public.household_plans hp
    where hp.household_id = v_tx.household_id and private.has_review_center_entitlement(v_tx.household_id)
  ) then
    raise exception 'Review Center requires the Pro plan';
  end if;

  select * into v_manual
  from public.transactions
  where id = p_manual_transaction_id
    and id <> p_transaction_id
    and source is distinct from 'plaid'
    and amount < 0
    and pending is not true
    and import_hash is null
    and transfer_group_id is null
    and linked_plan_id is null
    and review_status is distinct from 'matched'
    and category is distinct from 'Transfer'
    and (linked_bill_id is null or ((source is null or source = 'manual') and exists (
      select 1 from public.bills linked_debt
      where linked_debt.id = transactions.linked_bill_id
        and linked_debt.household_id = transactions.household_id
        and linked_debt.budget_id is not distinct from transactions.budget_id
        and linked_debt.is_debt = true
    )))
    and removed_at is null
    and deleted_at is null
  for update;
  if not found then raise exception 'Manual calendar transaction was not found'; end if;
  if v_manual.household_id is distinct from v_tx.household_id
    or v_manual.budget_id is distinct from v_tx.budget_id then
    raise exception 'Manual transaction does not belong to this household plan';
  end if;
  if p_occurrence_date is null or p_planned_amount is null or p_planned_amount <= 0 then
    raise exception 'Manual transaction details are required';
  end if;
  if p_occurrence_date is distinct from v_tx.date::date then
    raise exception 'The posted transaction date changed. Refresh Review Center and try again';
  end if;
  if date_trunc('month', v_manual.date::date) is distinct from date_trunc('month', v_tx.date::date) then
    raise exception 'Manual and posted transactions must be in the same month';
  end if;
  if abs(abs(v_manual.amount) - p_planned_amount) >= 0.01 then
    raise exception 'This manual plan changed. Refresh Review Center and try again';
  end if;
  if coalesce(p_settlement, '') not in ('exact', 'full', 'partial') then
    raise exception 'Choose how this transaction was paid';
  end if;

  select * into v_existing
  from public.transaction_reconciliations
  where transaction_id = p_transaction_id
  for update;

  v_snapshot := case when found then v_existing.restore_snapshot else jsonb_build_object(
    'category', v_tx.category,
    'linkedBillId', v_tx.linked_bill_id,
    'linkedIncomeId', v_tx.linked_income_id,
    'linkedPlanId', v_tx.linked_plan_id,
    'linkedPlanType', v_tx.linked_plan_type,
    'matchConfidence', v_tx.match_confidence,
    'matchReason', v_tx.match_reason,
    'manualTransactionId', v_manual.id,
    'manualRemovedAt', v_manual.removed_at,
    'manualMatchReason', v_manual.match_reason
  ) end;

  v_actual := abs(v_tx.amount);
  v_allocations := jsonb_build_array(jsonb_build_object(
    'type', 'planned_expense',
    'source', 'transaction',
    'targetId', v_manual.id,
    'name', coalesce(nullif(btrim(v_manual.note), ''), v_manual.category, 'Manual transaction'),
    'category', v_manual.category,
    'amount', v_actual,
    'plannedAmount', p_planned_amount,
    'occurrenceDate', p_occurrence_date,
    'settlement', p_settlement
  ));

  update public.transactions
  set removed_at = v_now,
      match_reason = 'replaced_by_posted_transaction'
  where id = v_manual.id;

  update public.transactions
  set category = v_manual.category,
      linked_bill_id = null,
      linked_income_id = null,
      linked_plan_id = v_manual.id,
      linked_plan_type = 'transaction',
      matched_occurrence_date = p_occurrence_date,
      match_confidence = 1,
      match_reason = 'confirmed_manual_match',
      review_status = 'matched',
      review_resolution = 'manual',
      review_allocations = v_allocations,
      reviewed_at = v_now,
      reviewed_by = (select auth.uid())
  where id = p_transaction_id;

  insert into public.transaction_reconciliations (
    transaction_id, user_id, household_id, budget_id, resolution, target_id,
    occurrence_date, settlement, planned_amount, allocations, restore_snapshot,
    reviewed_by, reviewed_at, updated_at
  ) values (
    p_transaction_id, v_tx.user_id, v_tx.household_id, v_tx.budget_id, 'manual',
    v_manual.id, p_occurrence_date, p_settlement, p_planned_amount, v_allocations,
    v_snapshot, (select auth.uid()), v_now, v_now
  )
  on conflict (transaction_id) do update set
    resolution = excluded.resolution,
    target_id = excluded.target_id,
    occurrence_date = excluded.occurrence_date,
    settlement = excluded.settlement,
    planned_amount = excluded.planned_amount,
    allocations = excluded.allocations,
    restore_snapshot = excluded.restore_snapshot,
    reviewed_by = excluded.reviewed_by,
    reviewed_at = excluded.reviewed_at,
    updated_at = excluded.updated_at;

  return jsonb_build_object(
    'transaction_id', p_transaction_id,
    'resolution', 'manual',
    'allocations', v_allocations,
    'reviewed_at', v_now
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION private.transfer_manual_activity_metadata()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_manual public.transactions%rowtype;
  v_restore jsonb;
begin
  if new.review_resolution = 'manual'
    and old.review_resolution is distinct from 'manual' then
    select * into v_manual
    from public.transactions
    where id = new.linked_plan_id
      and household_id is not distinct from new.household_id
      and budget_id is not distinct from new.budget_id
      and source is distinct from 'plaid';
    if not found then raise exception 'Manual Activity entry was not found'; end if;

    if coalesce(old.debt_applied_amount, 0) <> 0 or old.debt_applied_bill_id is not null then
      raise exception 'The bank transaction already owns an applied debt payment';
    end if;
    if v_manual.linked_bill_id is not null and (
      (v_manual.source is not null and v_manual.source <> 'manual')
      or not exists (
        select 1 from public.bills debt
        where debt.id = v_manual.linked_bill_id
          and debt.household_id is not distinct from new.household_id
          and debt.budget_id is not distinct from new.budget_id
          and debt.is_debt = true
      )
    ) then
      raise exception 'The linked manual debt payment is no longer valid';
    end if;

    if v_manual.debt_applied_bill_id is not null and not exists (
      select 1
      from public.bills debt
      where debt.id = v_manual.debt_applied_bill_id
        and debt.household_id is not distinct from new.household_id
        and debt.is_debt = true
    ) then
      raise exception 'The manual debt application is no longer valid';
    end if;

    v_restore := jsonb_build_object(
      'note', old.note,
      'linkedBillId', old.linked_bill_id,
      'debtAppliedAmount', old.debt_applied_amount,
      'debtAppliedBillId', old.debt_applied_bill_id,
      'userEditedAt', old.user_edited_at
    );
    if jsonb_array_length(coalesce(new.review_allocations, '[]'::jsonb)) > 0 then
      new.review_allocations := jsonb_set(
        new.review_allocations,
        '{0,restoreBankActivity}',
        v_restore,
        true
      );
    end if;
    new.note := coalesce(nullif(btrim(v_manual.note), ''), new.note);
    -- The active bank row takes ownership of this already-applied debt payment.
    -- Keeping its debt link prevents canonical sync from reversing the payment.
    new.linked_bill_id := v_manual.linked_bill_id;
    new.debt_applied_amount := coalesce(v_manual.debt_applied_amount, 0);
    new.debt_applied_bill_id := v_manual.debt_applied_bill_id;
    new.user_edited_at := now();
  elsif old.review_resolution = 'manual'
    and new.review_resolution is distinct from 'manual' then
    -- Sync may have adjusted the applied amount for a different posted amount
    -- or date. Hand that current audit back; the next sync computes only delta.
    update public.transactions manual
      set debt_applied_amount = old.debt_applied_amount,
          debt_applied_bill_id = old.debt_applied_bill_id
      where manual.id = old.linked_plan_id
        and manual.household_id is not distinct from old.household_id
        and manual.budget_id is not distinct from old.budget_id;
    v_restore := old.review_allocations->0->'restoreBankActivity';
    if v_restore is not null then
      new.note := coalesce(v_restore->>'note', '');
      if v_restore ? 'linkedBillId' then
        new.linked_bill_id := nullif(v_restore->>'linkedBillId', '');
      end if;
      new.debt_applied_amount := coalesce((v_restore->>'debtAppliedAmount')::numeric, 0);
      new.debt_applied_bill_id := nullif(v_restore->>'debtAppliedBillId', '');
      new.user_edited_at := case
        when v_restore->>'userEditedAt' is null then null
        else (v_restore->>'userEditedAt')::timestamptz
      end;
    else
      new.debt_applied_amount := 0;
      new.debt_applied_bill_id := null;
    end if;
  end if;
  return new;
end;
$function$
;

-- CREATE OR REPLACE retains existing ACLs; public wrappers and debt sync are unchanged.
