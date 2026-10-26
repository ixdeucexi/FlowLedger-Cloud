-- Source metadata SHA-256 (schema-only captures, no financial rows):
-- flowledger-bucket-live-schema.json: cc9109d8cd41041d49c27f6b7a36f4a1b37b9f3bb7afc398b7914e82468edffb
-- flowledger-bucket-live-bridge-schema.json: eeef1c595ba56f44ca503b56042ba46ee314fdea6825a82496aae4d55efb506d
-- Accounting/review baseline captured from the schema-only b00c15a production
-- contract. No user data. Auth claims and household rows are local fixtures.
-- Unrelated audit/default-budget triggers are omitted; all goal progress,
-- review-state, mirror and manual metadata functions under test are real.
\set ON_ERROR_STOP on
create schema auth;
create schema private;
do $$begin create role authenticated; exception when duplicate_object then null; end$$;
do $$begin create role anon; exception when duplicate_object then null; end$$;
do $$begin create role service_role; exception when duplicate_object then null; end$$;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create table public.household_members(household_id uuid,user_id uuid,role text);
create table public.household_plans(household_id uuid primary key,tier text);
create table private.release_feature_entitlements(feature_key text primary key,free_enabled boolean);
create table public.accounts(id text primary key,household_id uuid,is_active boolean,account_type text);
create table public.plaid_accounts(id uuid primary key,household_id uuid,plaid_account_id text,type text,subtype text,account_type text,account_subtype text,is_active boolean default true);
create table public.bills(id text primary key,household_id uuid,budget_id uuid,is_debt boolean,balance numeric,snowball_minimum_boost numeric default 0);
create table public.incomes(id text primary key);
create table public.decisions(id text primary key,actual_amount numeric,status text,completed_at timestamptz,updated_at timestamptz,scenario jsonb);
create table public.extra_payments(id text primary key,household_id uuid,budget_id uuid,sources jsonb default '[]');
create table public.monthly_overrides(id text primary key,bill_id text,month integer,year integer,paid_amount numeric,actual_amount numeric,paid_date text,custom_amount numeric);
create table public.bill_transaction_matches(transaction_id text primary key,bill_id text,override_id text,matched_amount numeric,transaction_date text);
create function public.unmatch_transaction_from_bill(text) returns jsonb language sql as $$select '{}'::jsonb$$;

create table public.goals(
"id" text not null,
"user_id" uuid not null,
"name" text not null,
"target_amount" numeric default 0 not null,
"target_date" text not null,
"current_amount" numeric default 0 not null,
"created_at" text not null,
"household_id" uuid,
"budget_id" uuid,
"goal_type" text default 'savings'::text not null,
"closed_at" timestamp with time zone,
"closed_by" uuid,
"archived_at" timestamp with time zone,
"archived_by" uuid,
constraint "goals_goal_type_check" CHECK ((goal_type = ANY (ARRAY['savings'::text, 'planned_expense'::text]))),
constraint "goals_pkey" PRIMARY KEY (id)
);

create table public.transactions(
"id" text not null,
"user_id" uuid not null,
"date" text not null,
"amount" numeric not null,
"category" text default 'Other'::text not null,
"note" text default ''::text not null,
"linked_bill_id" text,
"household_id" uuid,
"budget_id" uuid,
"account_id" text,
"import_hash" text,
"debt_applied_amount" numeric default 0 not null,
"debt_applied_bill_id" text,
"source" text,
"plaid_transaction_id" text,
"plaid_account_id" text,
"authorized_date" date,
"merchant_name" text,
"original_name" text,
"pending" boolean default false not null,
"payment_channel" text,
"plaid_category_primary" text,
"plaid_category_detailed" text,
"iso_currency_code" text,
"match_confidence" numeric,
"match_reason" text,
"removed_at" timestamp with time zone,
"review_status" text default 'legacy_reviewed'::text not null,
"review_resolution" text,
"review_allocations" jsonb default '[]'::jsonb not null,
"reviewed_at" timestamp with time zone,
"reviewed_by" uuid,
"linked_income_id" text,
"linked_plan_id" text,
"linked_plan_type" text,
"matched_occurrence_date" date,
"user_edited_at" timestamp with time zone,
"deleted_at" timestamp with time zone,
"deleted_by" uuid,
"transfer_group_id" text,
constraint "transactions_linked_plan_type_check" CHECK (((linked_plan_type IS NULL) OR (linked_plan_type = ANY (ARRAY['goal'::text, 'decision'::text, 'snowball'::text, 'transaction'::text])))),
constraint "transactions_pkey" PRIMARY KEY (id),
constraint "transactions_review_allocations_array_check" CHECK ((jsonb_typeof(review_allocations) = 'array'::text)),
constraint "transactions_review_resolution_check" CHECK (((review_resolution IS NULL) OR (review_resolution = ANY (ARRAY['bill'::text, 'income'::text, 'goal'::text, 'decision'::text, 'snowball'::text, 'manual'::text, 'category'::text, 'transfer'::text])))),
constraint "transactions_review_status_check" CHECK ((review_status = ANY (ARRAY['needs_review'::text, 'matched'::text, 'categorized'::text, 'transfer'::text, 'legacy_reviewed'::text])))
);

create table public.transaction_reconciliations(
"transaction_id" text not null,
"user_id" uuid not null,
"household_id" uuid not null,
"budget_id" uuid,
"resolution" text not null,
"target_id" text,
"occurrence_date" date,
"settlement" text,
"planned_amount" numeric,
"allocations" jsonb default '[]'::jsonb not null,
"restore_snapshot" jsonb default '{}'::jsonb not null,
"reviewed_by" uuid,
"reviewed_at" timestamp with time zone default now() not null,
"created_at" timestamp with time zone default now() not null,
"updated_at" timestamp with time zone default now() not null,
constraint "transaction_reconciliations_allocations_check" CHECK ((jsonb_typeof(allocations) = 'array'::text)),
constraint "transaction_reconciliations_pkey" PRIMARY KEY (transaction_id),
constraint "transaction_reconciliations_resolution_check" CHECK ((resolution = ANY (ARRAY['bill'::text, 'income'::text, 'goal'::text, 'decision'::text, 'snowball'::text, 'manual'::text, 'category'::text, 'transfer'::text]))),
constraint "transaction_reconciliations_restore_snapshot_check" CHECK ((jsonb_typeof(restore_snapshot) = 'object'::text)),
constraint "transaction_reconciliations_settlement_check" CHECK (((settlement IS NULL) OR (settlement = ANY (ARRAY['exact'::text, 'full'::text, 'partial'::text, 'split'::text, 'extra_principal'::text, 'regular'::text]))))
);

alter table public.transaction_reconciliations add foreign key(transaction_id) references public.transactions(id) on delete cascade;
create unique index one_manual_target on public.transaction_reconciliations(target_id) where resolution='manual' and target_id is not null;

create table private.planned_reconciliation_bases("target_type" text not null,"target_id" text not null,"base_amount" numeric default 0 not null,"base_status" text,"base_completed_at" timestamp with time zone,primary key(target_type,target_id));

-- Baseline md5 76eb27f0df4f6ed5d19a403a680f1f79
CREATE OR REPLACE FUNCTION private.is_household_editor(p_household_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.household_members hm
    where hm.household_id = p_household_id
      and hm.user_id = auth.uid()
      and hm.role in ('owner', 'manager', 'editor')
  )
$function$
;

-- Baseline md5 4d64687d5c274e1d7bfcb143a07c0889
CREATE OR REPLACE FUNCTION private.is_household_member(p_household_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from household_members hm
    where hm.household_id = p_household_id
      and hm.user_id = auth.uid()
  )
$function$
;

-- Baseline md5 2e2b1ba5225e104a708e1c5054f084ae
CREATE OR REPLACE FUNCTION public.is_household_editor(p_household_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$ select private.is_household_editor(p_household_id) $function$
;

-- Baseline md5 2f20abb040e671093b37a1aa55c159f6
CREATE OR REPLACE FUNCTION public.is_household_member(p_household_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$ select private.is_household_member(p_household_id) $function$
;

-- Baseline md5 bad301fe78f46162a5558df7ffb5e6d9
CREATE OR REPLACE FUNCTION private.has_review_center_entitlement(p_household_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select p_household_id is not null
    and exists (
      select 1
      from public.household_plans plan
      where plan.household_id = p_household_id
        and (
          plan.tier = 'pro'
          or (
            plan.tier = 'free'
            and exists (
              select 1
              from private.release_feature_entitlements entitlement
              where entitlement.feature_key = 'review_center'
                and entitlement.free_enabled
            )
          )
        )
    )
$function$
;

-- Baseline md5 29dda0ddfc25ebae7f646a919ced16ad
CREATE OR REPLACE FUNCTION private.recompute_planned_reconciliation_target(p_target_type text, p_target_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

-- Baseline md5 796d3760c359082f3d69a4000352dea0
CREATE OR REPLACE FUNCTION private.undo_transaction_reconciliation(p_transaction_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_tx public.transactions%rowtype;
  v_recon public.transaction_reconciliations%rowtype;
  v_snapshot jsonb;
  v_mirror_id text;
begin
  if (select auth.uid()) is null then raise exception 'Sign in to undo a review'; end if;
  select * into v_tx from public.transactions where id = p_transaction_id;
  select * into v_recon from public.transaction_reconciliations where transaction_id = p_transaction_id;
  if not found then raise exception 'This transaction has not been reviewed'; end if;
  if v_tx.household_id is null or not public.is_household_editor(v_tx.household_id) then raise exception 'You need household edit access'; end if;
  if not exists (select 1 from public.household_plans hp where hp.household_id = v_tx.household_id and private.has_review_center_entitlement(v_tx.household_id)) then raise exception 'Review Center requires the Pro plan'; end if;
  v_snapshot := v_recon.restore_snapshot;

  if v_recon.resolution = 'bill' and v_tx.linked_bill_id is not null then
    perform public.unmatch_transaction_from_bill(p_transaction_id);
  elsif v_recon.resolution = 'goal' and v_recon.target_id is not null then
    update public.goals set current_amount = coalesce((v_snapshot->>'goalCurrentAmount')::numeric, current_amount) where id = v_recon.target_id;
  elsif v_recon.resolution = 'decision' and v_recon.target_id is not null then
    update public.decisions set
      status = coalesce(v_snapshot->>'decisionStatus', status),
      actual_amount = case when v_snapshot ? 'decisionActualAmount' and v_snapshot->>'decisionActualAmount' is not null then (v_snapshot->>'decisionActualAmount')::numeric else null end,
      completed_at = case when v_snapshot ? 'decisionCompletedAt' and v_snapshot->>'decisionCompletedAt' is not null then (v_snapshot->>'decisionCompletedAt')::timestamptz else null end,
      updated_at = now()
    where id = v_recon.target_id;
  end if;

  delete from public.transaction_reconciliations where transaction_id = p_transaction_id;
  update public.transactions set
    category = coalesce(v_snapshot->>'category', category),
    linked_bill_id = nullif(v_snapshot->>'linkedBillId', ''),
    linked_income_id = nullif(v_snapshot->>'linkedIncomeId', ''),
    linked_plan_id = nullif(v_snapshot->>'linkedPlanId', ''),
    linked_plan_type = nullif(v_snapshot->>'linkedPlanType', ''),
    match_confidence = case when v_snapshot ? 'matchConfidence' and v_snapshot->>'matchConfidence' is not null then (v_snapshot->>'matchConfidence')::numeric else null end,
    match_reason = nullif(v_snapshot->>'matchReason', ''),
    matched_occurrence_date = null,
    review_status = case
      when source = 'plaid'
        and pending is not true
        and removed_at is null
        and date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        and date_trunc('month', date::date) = date_trunc('month', current_date)
      then 'needs_review'
      else 'legacy_reviewed'
    end,
    review_resolution = null,
    review_allocations = '[]'::jsonb,
    reviewed_at = null,
    reviewed_by = null
  where id = p_transaction_id;

  for v_mirror_id in
    select jsonb_array_elements_text(coalesce(v_snapshot->'suppressedMirrorIds', '[]'::jsonb))
  loop
    update public.transactions set
      removed_at = null,
      review_status = case
        when source = 'plaid'
          and pending is not true
          and date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
          and date_trunc('month', date::date) = date_trunc('month', current_date)
        then 'needs_review'
        else 'legacy_reviewed'
      end,
      review_resolution = null,
      review_allocations = '[]'::jsonb,
      reviewed_at = null,
      reviewed_by = null
    where id = v_mirror_id;
  end loop;

  return jsonb_build_object('transaction_id', p_transaction_id, 'status', 'needs_review');
end;
$function$
;

-- Baseline md5 5e5ec5528b03c3f1aacf492b8dc3c54e
CREATE OR REPLACE FUNCTION public.undo_transaction_reconciliation(p_transaction_id text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$ select private.undo_transaction_reconciliation(p_transaction_id) $function$
;

-- Baseline md5 f5e0241649d91ba54f611c06de67e218
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

-- Baseline md5 7b0800109f15fa0286baee07fbbc6d05
CREATE OR REPLACE FUNCTION private.undo_manual_transaction_reconciliation(p_transaction_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_tx public.transactions%rowtype;
  v_recon public.transaction_reconciliations%rowtype;
  v_snapshot jsonb;
  v_manual_id text;
begin
  if (select auth.uid()) is null then raise exception 'Sign in to undo this review'; end if;

  select * into v_tx
  from public.transactions
  where id = p_transaction_id
  for update;

  select * into v_recon
  from public.transaction_reconciliations
  where transaction_id = p_transaction_id and resolution = 'manual'
  for update;
  if not found then raise exception 'This manual match was not found'; end if;
  if v_tx.household_id is null or not public.is_household_editor(v_tx.household_id) then
    raise exception 'You need household edit access';
  end if;
  if not exists (
    select 1 from public.household_plans hp
    where hp.household_id = v_tx.household_id and private.has_review_center_entitlement(v_tx.household_id)
  ) then
    raise exception 'Review Center requires the Pro plan';
  end if;

  v_snapshot := v_recon.restore_snapshot;
  v_manual_id := coalesce(v_snapshot->>'manualTransactionId', v_recon.target_id);

  update public.transactions
  set removed_at = case
        when v_snapshot ? 'manualRemovedAt' and v_snapshot->>'manualRemovedAt' is not null
          then (v_snapshot->>'manualRemovedAt')::timestamptz
        else null
      end,
      match_reason = nullif(v_snapshot->>'manualMatchReason', '')
  where id = v_manual_id
    and household_id is not distinct from v_tx.household_id
    and budget_id is not distinct from v_tx.budget_id;

  delete from public.transaction_reconciliations where transaction_id = p_transaction_id;

  update public.transactions
  set category = coalesce(v_snapshot->>'category', category),
      linked_bill_id = nullif(v_snapshot->>'linkedBillId', ''),
      linked_income_id = nullif(v_snapshot->>'linkedIncomeId', ''),
      linked_plan_id = nullif(v_snapshot->>'linkedPlanId', ''),
      linked_plan_type = nullif(v_snapshot->>'linkedPlanType', ''),
      match_confidence = case
        when v_snapshot ? 'matchConfidence' and v_snapshot->>'matchConfidence' is not null
          then (v_snapshot->>'matchConfidence')::numeric
        else null
      end,
      match_reason = nullif(v_snapshot->>'matchReason', ''),
      matched_occurrence_date = null,
      review_status = case
        when source = 'plaid'
          and pending is not true
          and removed_at is null
          and date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
          and date_trunc('month', date::date) = date_trunc('month', current_date)
        then 'needs_review'
        else 'legacy_reviewed'
      end,
      review_resolution = null,
      review_allocations = '[]'::jsonb,
      reviewed_at = null,
      reviewed_by = null
  where id = p_transaction_id;

  return jsonb_build_object('transaction_id', p_transaction_id, 'status', 'needs_review');
end;
$function$
;

-- Baseline md5 e8c89918416967e4c27f47b65f4941b7
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

CREATE OR REPLACE FUNCTION private.guard_routed_bucket_progress()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if tg_op = 'UPDATE'
     and current_user = 'postgres'
     and current_setting('flowledger.shared_plan_owner_transfer', true) = 'on'
     and new.user_id is distinct from old.user_id
     and row(
       new.id, new.name, new.target_amount, new.target_date, new.goal_type,
       new.household_id, new.budget_id, new.current_amount,
       new.closed_at, new.closed_by, new.archived_at, new.archived_by,
       new.created_at
      ) is not distinct from row(
       old.id, old.name, old.target_amount, old.target_date, old.goal_type,
       old.household_id, old.budget_id, old.current_amount,
       old.closed_at, old.closed_by, old.archived_at, old.archived_by,
       old.created_at
     )
     and exists (
       select 1 from public.household_members member
       where member.household_id = old.household_id
         and member.user_id = new.user_id
     ) then
    return new;
  end if;

  if exists (
      select 1 from public.extra_payments payment
      where payment.household_id is not distinct from old.household_id
        and payment.budget_id is not distinct from old.budget_id
        and exists (
          select 1 from jsonb_array_elements(coalesce(payment.sources, '[]'::jsonb)) source
          where source ->> 'type' = 'bucket_remainder'
            and source ->> 'bucketId' = old.id
        )
    ) then
    if tg_op = 'DELETE' then
      raise exception 'Reopen and unroute this spending bucket before deleting it';
    end if;
    if row(
      new.name, new.target_amount, new.target_date, new.goal_type,
      new.user_id, new.household_id, new.budget_id,
      new.current_amount, new.closed_at, new.closed_by, new.archived_at, new.archived_by
    ) is distinct from row(
      old.name, old.target_amount, old.target_date, old.goal_type,
      old.user_id, old.household_id, old.budget_id,
      old.current_amount, old.closed_at, old.closed_by, old.archived_at, old.archived_by
    ) then
      raise exception 'Reopen and unroute this spending bucket before changing it';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$
;

CREATE TRIGGER guard_routed_bucket_progress BEFORE DELETE OR UPDATE OF name, target_amount, target_date, goal_type, user_id, household_id, budget_id, current_amount, closed_at, closed_by, archived_at, archived_by ON public.goals FOR EACH ROW EXECUTE FUNCTION private.guard_routed_bucket_progress();

CREATE OR REPLACE FUNCTION public.normalize_reconciliation_restore_snapshot()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_base jsonb;
begin
  if new.resolution not in ('decision', 'goal') or new.target_id is null then
    return new;
  end if;

  select r.restore_snapshot into v_base
  from public.transaction_reconciliations r
  where r.resolution = new.resolution
    and r.target_id = new.target_id
    and r.transaction_id <> new.transaction_id
  order by r.reviewed_at, r.transaction_id
  limit 1;

  if v_base is null then return new; end if;
  if new.resolution = 'decision' then
    new.restore_snapshot := new.restore_snapshot || jsonb_build_object(
      'decisionStatus', v_base->'decisionStatus',
      'decisionActualAmount', v_base->'decisionActualAmount',
      'decisionCompletedAt', v_base->'decisionCompletedAt'
    );
  else
    new.restore_snapshot := new.restore_snapshot || jsonb_build_object(
      'goalCurrentAmount', v_base->'goalCurrentAmount'
    );
  end if;
  return new;
end;
$function$
;

CREATE TRIGGER normalize_reconciliation_restore_snapshot BEFORE INSERT OR UPDATE OF resolution, target_id, restore_snapshot ON public.transaction_reconciliations FOR EACH ROW EXECUTE FUNCTION normalize_reconciliation_restore_snapshot();

CREATE OR REPLACE FUNCTION public.suppress_plaid_mirrors_after_review()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_winner public.transactions%rowtype;
  v_description_key text;
  v_mirror_ids jsonb;
begin
  select * into v_winner
  from public.transactions
  where id = new.transaction_id;

  if not found
    or v_winner.source <> 'plaid'
    or v_winner.pending is true
    or v_winner.removed_at is not null
    or v_winner.plaid_account_id is null then
    return new;
  end if;

  v_description_key := btrim(lower(regexp_replace(
    coalesce(nullif(v_winner.merchant_name, ''), nullif(v_winner.note, ''), v_winner.category, ''),
    '[^[:alnum:]]+', ' ', 'g'
  )));
  if v_description_key = '' then return new; end if;

  with suppressed as (
    update public.transactions d
    set removed_at = now(),
        review_status = 'legacy_reviewed',
        review_resolution = null,
        review_allocations = '[]'::jsonb,
        reviewed_at = null,
        reviewed_by = null
    where d.id <> v_winner.id
      and d.source = 'plaid'
      and d.pending is not true
      and d.removed_at is null
      and d.household_id is not distinct from v_winner.household_id
      and d.budget_id is not distinct from v_winner.budget_id
      and d.date = v_winner.date
      and d.amount = v_winner.amount
      and d.plaid_account_id is not null
      and d.plaid_account_id is distinct from v_winner.plaid_account_id
      and d.review_status in ('needs_review', 'legacy_reviewed')
      and d.reviewed_at is null
      and d.linked_bill_id is null
      and d.linked_income_id is null
      and d.linked_plan_id is null
      and not exists (
        select 1 from public.transaction_reconciliations existing
        where existing.transaction_id = d.id
      )
      and btrim(lower(regexp_replace(
        coalesce(nullif(d.merchant_name, ''), nullif(d.note, ''), d.category, ''),
        '[^[:alnum:]]+', ' ', 'g'
      ))) = v_description_key
    returning d.id
  )
  select coalesce(jsonb_agg(id order by id), '[]'::jsonb)
  into v_mirror_ids
  from suppressed;

  if jsonb_array_length(v_mirror_ids) > 0 then
    update public.transaction_reconciliations
    set restore_snapshot = jsonb_set(
      coalesce(restore_snapshot, '{}'::jsonb),
      '{suppressedMirrorIds}',
      coalesce(restore_snapshot->'suppressedMirrorIds', '[]'::jsonb) || v_mirror_ids,
      true
    )
    where transaction_id = new.transaction_id;
  end if;

  return new;
end;
$function$
;

CREATE TRIGGER suppress_plaid_mirrors_after_review AFTER INSERT ON public.transaction_reconciliations FOR EACH ROW EXECUTE FUNCTION suppress_plaid_mirrors_after_review();

CREATE OR REPLACE FUNCTION private.sync_planned_reconciliation_progress()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

CREATE TRIGGER sync_planned_reconciliation_progress AFTER INSERT OR DELETE OR UPDATE ON public.transaction_reconciliations FOR EACH ROW EXECUTE FUNCTION private.sync_planned_reconciliation_progress();

CREATE OR REPLACE FUNCTION public.sync_reconciliation_target_progress()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_resolution text;
  v_target_id text;
  v_fallback_snapshot jsonb;
  v_base jsonb;
  v_total numeric := 0;
  v_has_final boolean := false;
  v_finalized_at timestamptz;
  v_base_amount numeric;
begin
  if tg_op = 'DELETE' then
    v_resolution := old.resolution;
    v_target_id := old.target_id;
    v_fallback_snapshot := old.restore_snapshot;
  else
    v_resolution := new.resolution;
    v_target_id := new.target_id;
    v_fallback_snapshot := new.restore_snapshot;
  end if;

  if v_resolution not in ('decision', 'goal') or v_target_id is null then
    return null;
  end if;

  select r.restore_snapshot into v_base
  from public.transaction_reconciliations r
  where r.resolution = v_resolution and r.target_id = v_target_id
  order by r.reviewed_at, r.transaction_id
  limit 1;
  v_base := coalesce(v_base, v_fallback_snapshot, '{}'::jsonb);

  select
    coalesce(sum((allocation.value->>'amount')::numeric), 0),
    coalesce(bool_or(coalesce(allocation.value->>'settlement', '') <> 'partial'), false),
    max(r.reviewed_at) filter (where coalesce(allocation.value->>'settlement', '') <> 'partial')
  into v_total, v_has_final, v_finalized_at
  from public.transaction_reconciliations r
  cross join lateral jsonb_array_elements(coalesce(r.allocations, '[]'::jsonb)) allocation(value)
  where r.resolution = v_resolution
    and r.target_id = v_target_id
    and allocation.value->>'type' = 'planned_expense'
    and allocation.value->>'source' = v_resolution
    and allocation.value->>'targetId' = v_target_id;

  if v_resolution = 'decision' then
    v_base_amount := case
      when v_base ? 'decisionActualAmount' and v_base->>'decisionActualAmount' is not null
      then (v_base->>'decisionActualAmount')::numeric
      else null
    end;
    update public.decisions
    set actual_amount = case when v_base_amount is null and v_total = 0 then null else coalesce(v_base_amount, 0) + v_total end,
        status = case when v_has_final then 'completed' else coalesce(nullif(v_base->>'decisionStatus', ''), status) end,
        completed_at = case
          when v_has_final then v_finalized_at
          when v_base ? 'decisionCompletedAt' and v_base->>'decisionCompletedAt' is not null
            then (v_base->>'decisionCompletedAt')::timestamptz
          else null
        end,
        updated_at = now()
    where id = v_target_id;
  else
    v_base_amount := coalesce((v_base->>'goalCurrentAmount')::numeric, 0);
    update public.goals
    set current_amount = case
      when v_has_final then target_amount
      else least(target_amount, v_base_amount + v_total)
    end
    where id = v_target_id;
  end if;
  return null;
end;
$function$
;

CREATE TRIGGER sync_reconciliation_target_progress AFTER INSERT OR DELETE OR UPDATE OF resolution, target_id, allocations, restore_snapshot ON public.transaction_reconciliations FOR EACH ROW EXECUTE FUNCTION sync_reconciliation_target_progress();

CREATE OR REPLACE FUNCTION public.protect_transaction_review_state()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if current_user in ('postgres', 'service_role') then return new; end if;
  if tg_op = 'INSERT' then
    if new.review_status <> 'legacy_reviewed'
      or new.review_resolution is not null
      or new.review_allocations <> '[]'::jsonb
      or new.reviewed_at is not null
      or new.reviewed_by is not null
      or new.linked_income_id is not null
      or new.linked_plan_id is not null
      or new.linked_plan_type is not null
      or new.matched_occurrence_date is not null then
      raise exception 'Review state must be changed through Review Center';
    end if;
  elsif row(
    new.review_status, new.review_resolution, new.review_allocations,
    new.reviewed_at, new.reviewed_by, new.linked_income_id,
    new.linked_plan_id, new.linked_plan_type, new.matched_occurrence_date
  ) is distinct from row(
    old.review_status, old.review_resolution, old.review_allocations,
    old.reviewed_at, old.reviewed_by, old.linked_income_id,
    old.linked_plan_id, old.linked_plan_type, old.matched_occurrence_date
  ) then
    raise exception 'Review state must be changed through Review Center';
  end if;
  return new;
end;
$function$
;

CREATE TRIGGER protect_transaction_review_state BEFORE INSERT OR UPDATE ON public.transactions FOR EACH ROW EXECUTE FUNCTION protect_transaction_review_state();

CREATE OR REPLACE FUNCTION public.reject_deleted_transaction_reconciliation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if old.deleted_at is not null
    and old.review_status = 'needs_review'
    and new.review_status in ('matched', 'categorized', 'transfer') then
    raise exception 'Deleted transactions cannot be reviewed';
  end if;

  return new;
end;
$function$
;

CREATE TRIGGER reject_deleted_transaction_reconciliation BEFORE UPDATE OF review_status, review_resolution ON public.transactions FOR EACH ROW EXECUTE FUNCTION reject_deleted_transaction_reconciliation();

CREATE TRIGGER transactions_transfer_manual_activity_metadata BEFORE UPDATE OF review_resolution ON public.transactions FOR EACH ROW EXECUTE FUNCTION private.transfer_manual_activity_metadata();


grant usage on schema auth,private,public to authenticated;
grant execute on function auth.uid() to authenticated;
grant select on public.household_members,public.household_plans,private.release_feature_entitlements to authenticated;
alter table public.goals enable row level security;
alter table public.transactions enable row level security;
alter table public.transaction_reconciliations enable row level security;
create policy goals_read on public.goals for select to authenticated using(private.is_household_member(household_id));
create policy goals_write on public.goals for all to authenticated using(private.is_household_editor(household_id)) with check(private.is_household_editor(household_id));
create policy tx_read on public.transactions for select to authenticated using(private.is_household_member(household_id));
create policy tx_write on public.transactions for all to authenticated using(private.is_household_editor(household_id)) with check(private.is_household_editor(household_id));
grant select,insert,update,delete on public.transactions,public.goals to authenticated;
revoke all on public.transaction_reconciliations from authenticated;

create table public.pending_plan_matches(id text primary key,household_id uuid,budget_id uuid,target_type text,target_id text,status text,posted_transaction_id text,posted_plaid_transaction_id text,posted_amount numeric,pending_plaid_transaction_id text,updated_at timestamptz);
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
CREATE TRIGGER transactions_cancel_pending_manual_matches AFTER DELETE OR UPDATE OF removed_at, deleted_at ON public.transactions FOR EACH ROW EXECUTE FUNCTION private.cancel_pending_matches_for_removed_target();
CREATE OR REPLACE FUNCTION public.sync_pending_plan_match_review_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.review_status in ('matched', 'categorized', 'transfer') then
    update public.pending_plan_matches
    set status = 'completed',
        updated_at = now()
    where posted_transaction_id = new.id
      and status = 'ready_review';
  elsif new.review_status = 'needs_review' then
    update public.pending_plan_matches
    set status = 'ready_review',
        updated_at = now()
    where posted_transaction_id = new.id
      and status = 'completed';
  end if;
  return new;
end
$function$
;
CREATE TRIGGER transactions_sync_pending_plan_match_review_status AFTER UPDATE OF review_status ON public.transactions FOR EACH ROW WHEN ((old.review_status IS DISTINCT FROM new.review_status)) EXECUTE FUNCTION sync_pending_plan_match_review_status();

-- Actual existing posted review RPCs, retained for compatibility assertions.
CREATE OR REPLACE FUNCTION private.reconcile_transaction_unlocked_v1(p_transaction_id text, p_resolution text, p_target_id text DEFAULT NULL::text, p_occurrence_date date DEFAULT NULL::date, p_planned_amount numeric DEFAULT NULL::numeric, p_settlement text DEFAULT NULL::text, p_extra_category text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_tx public.transactions%rowtype;
  v_bill public.bills%rowtype;
  v_income public.incomes%rowtype;
  v_goal public.goals%rowtype;
  v_decision public.decisions%rowtype;
  v_match public.bill_transaction_matches%rowtype;
  v_existing public.transaction_reconciliations%rowtype;
  v_actual numeric;
  v_primary numeric;
  v_extra numeric;
  v_allocations jsonb;
  v_snapshot jsonb;
  v_now timestamptz := now();
begin
  if (select auth.uid()) is null then raise exception 'Sign in to review transactions'; end if;
  select * into v_tx from public.transactions where id = p_transaction_id and removed_at is null and pending is not true;
  if not found then raise exception 'Posted transaction was not found'; end if;
  if v_tx.household_id is null or not public.is_household_editor(v_tx.household_id) then
    raise exception 'You need household edit access to review transactions';
  end if;
  if not exists (select 1 from public.household_plans hp where hp.household_id = v_tx.household_id and private.has_review_center_entitlement(v_tx.household_id)) then
    raise exception 'Review Center requires the Pro plan';
  end if;
  if p_resolution not in ('bill', 'income', 'goal', 'decision', 'category', 'transfer') then
    raise exception 'Unsupported review resolution';
  end if;

  select * into v_existing from public.transaction_reconciliations where transaction_id = p_transaction_id;
  v_snapshot := case when found then v_existing.restore_snapshot else jsonb_build_object(
    'category', v_tx.category,
    'linkedBillId', v_tx.linked_bill_id,
    'linkedIncomeId', v_tx.linked_income_id,
    'linkedPlanId', v_tx.linked_plan_id,
    'linkedPlanType', v_tx.linked_plan_type,
    'matchConfidence', v_tx.match_confidence,
    'matchReason', v_tx.match_reason
  ) end;
  v_actual := abs(v_tx.amount);

  if p_resolution = 'category' then
    if nullif(btrim(coalesce(p_target_id, '')), '') is null then raise exception 'Choose a category'; end if;
    v_allocations := jsonb_build_array(jsonb_build_object('type', 'category', 'category', p_target_id, 'amount', v_actual));
    update public.transactions set category = p_target_id, review_status = 'categorized', review_resolution = 'category',
      review_allocations = v_allocations, reviewed_at = v_now, reviewed_by = (select auth.uid()),
      linked_income_id = null, linked_plan_id = null, linked_plan_type = null, matched_occurrence_date = null
    where id = p_transaction_id;
  elsif p_resolution = 'transfer' then
    v_allocations := jsonb_build_array(jsonb_build_object('type', 'transfer', 'amount', v_actual));
    update public.transactions set category = 'Transfer', review_status = 'transfer', review_resolution = 'transfer',
      review_allocations = v_allocations, reviewed_at = v_now, reviewed_by = (select auth.uid()),
      linked_income_id = null, linked_plan_id = null, linked_plan_type = null, matched_occurrence_date = null
    where id = p_transaction_id;
  elsif p_resolution = 'bill' then
    if v_tx.amount >= 0 then raise exception 'Only money-out transactions can match bills'; end if;
    select * into v_bill from public.bills where id = p_target_id;
    if not found or v_bill.household_id is distinct from v_tx.household_id or v_bill.budget_id is distinct from v_tx.budget_id then
      raise exception 'Bill does not belong to this household plan';
    end if;
    if p_occurrence_date is null or p_planned_amount is null or p_planned_amount <= 0 then raise exception 'Bill occurrence details are required'; end if;
    if coalesce(p_settlement, '') not in ('exact', 'full', 'partial', 'split', 'extra_principal') then raise exception 'Choose how this bill was paid'; end if;
    v_primary := case when p_settlement in ('split', 'extra_principal') then least(v_actual, p_planned_amount) else v_actual end;
    v_extra := greatest(0, v_actual - v_primary);
    if p_settlement = 'split' and (v_extra <= 0 or nullif(btrim(coalesce(p_extra_category, '')), '') is null) then
      raise exception 'Choose a category for the extra amount';
    end if;
    perform public.match_transaction_to_bill(p_transaction_id, p_target_id);
    select * into v_match from public.bill_transaction_matches where transaction_id = p_transaction_id;
    update public.bill_transaction_matches set matched_amount = v_primary, occurrence_date = p_occurrence_date,
      planned_amount = p_planned_amount, settlement = p_settlement where transaction_id = p_transaction_id;
    update public.monthly_overrides o set
      paid_amount = totals.amount,
      actual_amount = totals.amount,
      paid_date = totals.latest_date,
      custom_amount = case
        when v_bill.frequency = 'monthly' and p_settlement = 'full' and v_primary < p_planned_amount then v_primary
        else o.custom_amount
      end
    from (
      select coalesce(sum(matched_amount), 0) amount, max(transaction_date) latest_date
      from public.bill_transaction_matches
      where bill_id = p_target_id and match_month = v_match.match_month and match_year = v_match.match_year
    ) totals
    where o.id = v_match.override_id;
    v_allocations := jsonb_build_array(jsonb_build_object(
      'type', 'bill', 'targetId', p_target_id, 'name', v_bill.name, 'category', v_bill.category,
      'amount', v_primary, 'plannedAmount', p_planned_amount, 'occurrenceDate', p_occurrence_date, 'settlement', p_settlement
    ));
    if v_extra > 0 then
      v_allocations := v_allocations || jsonb_build_array(jsonb_build_object(
        'type', case when p_settlement = 'extra_principal' then 'extra_principal' else 'category' end,
        'targetId', case when p_settlement = 'extra_principal' then p_target_id else null end,
        'category', case when p_settlement = 'extra_principal' then 'Debt' else p_extra_category end,
        'amount', v_extra
      ));
    end if;
    update public.transactions set review_status = 'matched', review_resolution = 'bill', review_allocations = v_allocations,
      reviewed_at = v_now, reviewed_by = (select auth.uid()), matched_occurrence_date = p_occurrence_date
    where id = p_transaction_id;
  elsif p_resolution = 'income' then
    if v_tx.amount <= 0 then raise exception 'Only deposits can match planned income'; end if;
    select * into v_income from public.incomes where id = p_target_id;
    if not found or v_income.household_id is distinct from v_tx.household_id or v_income.budget_id is distinct from v_tx.budget_id then
      raise exception 'Income does not belong to this household plan';
    end if;
    if p_occurrence_date is null or p_planned_amount is null or p_planned_amount <= 0 then raise exception 'Income occurrence details are required'; end if;
    if coalesce(p_settlement, '') not in ('exact', 'full', 'partial') then raise exception 'Choose how this income was received'; end if;
    v_allocations := jsonb_build_array(jsonb_build_object(
      'type', 'income', 'targetId', p_target_id, 'name', v_income.name, 'amount', v_actual,
      'plannedAmount', p_planned_amount, 'occurrenceDate', p_occurrence_date, 'settlement', p_settlement
    ));
    update public.transactions set category = 'Income', linked_bill_id = null, linked_income_id = p_target_id,
      linked_plan_id = null, linked_plan_type = null, matched_occurrence_date = p_occurrence_date,
      match_confidence = 1, match_reason = 'confirmed_income_match', review_status = 'matched', review_resolution = 'income',
      review_allocations = v_allocations, reviewed_at = v_now, reviewed_by = (select auth.uid())
    where id = p_transaction_id;
  elsif p_resolution = 'goal' then
    if v_tx.amount >= 0 then raise exception 'Only money-out transactions can match planned expenses'; end if;
    if p_occurrence_date is null or p_planned_amount is null or p_planned_amount <= 0 then raise exception 'Planned occurrence details are required'; end if;
    if coalesce(p_settlement, '') not in ('exact', 'full', 'partial', 'split') then raise exception 'Choose how this planned expense was paid'; end if;
    if p_settlement = 'split' and nullif(btrim(coalesce(p_extra_category, '')), '') is null then raise exception 'Choose a category for the extra amount'; end if;
    select * into v_goal from public.goals where id = p_target_id and goal_type = 'planned_expense';
    if not found or v_goal.household_id is distinct from v_tx.household_id or v_goal.budget_id is distinct from v_tx.budget_id then
      raise exception 'Planned expense does not belong to this household plan';
    end if;
    v_snapshot := v_snapshot || jsonb_build_object('goalCurrentAmount', v_goal.current_amount);
    v_primary := case when p_settlement = 'split' then least(v_actual, coalesce(p_planned_amount, v_actual)) else v_actual end;
    v_extra := greatest(0, v_actual - v_primary);
    update public.goals set current_amount = case when p_settlement = 'partial' then least(target_amount, current_amount + v_primary) else target_amount end where id = p_target_id;
    v_allocations := jsonb_build_array(jsonb_build_object('type', 'planned_expense', 'source', 'goal', 'targetId', p_target_id,
      'name', v_goal.name, 'amount', v_primary, 'plannedAmount', p_planned_amount, 'occurrenceDate', p_occurrence_date, 'settlement', p_settlement));
    if v_extra > 0 then v_allocations := v_allocations || jsonb_build_array(jsonb_build_object('type', 'category', 'category', p_extra_category, 'amount', v_extra)); end if;
    update public.transactions set linked_bill_id = null, linked_income_id = null, linked_plan_id = p_target_id, linked_plan_type = 'goal',
      matched_occurrence_date = p_occurrence_date, match_confidence = 1, match_reason = 'confirmed_plan_match', review_status = 'matched',
      review_resolution = 'goal', review_allocations = v_allocations, reviewed_at = v_now, reviewed_by = (select auth.uid()) where id = p_transaction_id;
  else
    if v_tx.amount >= 0 then raise exception 'Only money-out transactions can match planned expenses'; end if;
    if p_occurrence_date is null or p_planned_amount is null or p_planned_amount <= 0 then raise exception 'Planned occurrence details are required'; end if;
    if coalesce(p_settlement, '') not in ('exact', 'full', 'partial', 'split') then raise exception 'Choose how this planned expense was paid'; end if;
    if p_settlement = 'split' and nullif(btrim(coalesce(p_extra_category, '')), '') is null then raise exception 'Choose a category for the extra amount'; end if;
    select * into v_decision from public.decisions where id = p_target_id;
    if not found or v_decision.household_id is distinct from v_tx.household_id or v_decision.budget_id is distinct from v_tx.budget_id then
      raise exception 'Calendar plan does not belong to this household plan';
    end if;
    v_snapshot := v_snapshot || jsonb_build_object('decisionStatus', v_decision.status, 'decisionActualAmount', v_decision.actual_amount, 'decisionCompletedAt', v_decision.completed_at);
    v_primary := case when p_settlement = 'split' then least(v_actual, coalesce(p_planned_amount, v_actual)) else v_actual end;
    v_extra := greatest(0, v_actual - v_primary);
    update public.decisions set status = case when p_settlement = 'partial' then status else 'completed' end,
      actual_amount = v_primary, completed_at = case when p_settlement = 'partial' then completed_at else v_now end, updated_at = v_now where id = p_target_id;
    v_allocations := jsonb_build_array(jsonb_build_object('type', 'planned_expense', 'source', 'decision', 'targetId', p_target_id,
      'name', v_decision.name, 'amount', v_primary, 'plannedAmount', p_planned_amount, 'occurrenceDate', p_occurrence_date, 'settlement', p_settlement));
    if v_extra > 0 then v_allocations := v_allocations || jsonb_build_array(jsonb_build_object('type', 'category', 'category', p_extra_category, 'amount', v_extra)); end if;
    update public.transactions set linked_bill_id = null, linked_income_id = null, linked_plan_id = p_target_id, linked_plan_type = 'decision',
      matched_occurrence_date = p_occurrence_date, match_confidence = 1, match_reason = 'confirmed_plan_match', review_status = 'matched',
      review_resolution = 'decision', review_allocations = v_allocations, reviewed_at = v_now, reviewed_by = (select auth.uid()) where id = p_transaction_id;
  end if;

  insert into public.transaction_reconciliations (
    transaction_id, user_id, household_id, budget_id, resolution, target_id, occurrence_date,
    settlement, planned_amount, allocations, restore_snapshot, reviewed_by, reviewed_at, updated_at
  ) values (
    p_transaction_id, v_tx.user_id, v_tx.household_id, v_tx.budget_id, p_resolution, p_target_id,
    p_occurrence_date, coalesce(p_settlement, 'regular'), p_planned_amount, v_allocations, v_snapshot,
    (select auth.uid()), v_now, v_now
  ) on conflict (transaction_id) do update set
    resolution = excluded.resolution, target_id = excluded.target_id, occurrence_date = excluded.occurrence_date,
    settlement = excluded.settlement, planned_amount = excluded.planned_amount, allocations = excluded.allocations,
    restore_snapshot = excluded.restore_snapshot, reviewed_by = excluded.reviewed_by,
    reviewed_at = excluded.reviewed_at, updated_at = excluded.updated_at;

  return jsonb_build_object('transaction_id', p_transaction_id, 'resolution', p_resolution, 'allocations', v_allocations, 'reviewed_at', v_now);
end;
$function$
;
CREATE OR REPLACE FUNCTION private.reconcile_transaction(p_transaction_id text, p_resolution text, p_target_id text DEFAULT NULL::text, p_occurrence_date date DEFAULT NULL::date, p_planned_amount numeric DEFAULT NULL::numeric, p_settlement text DEFAULT NULL::text, p_extra_category text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_tx public.transactions%rowtype;
  v_existing public.transaction_reconciliations%rowtype;
  v_expected_status text;
begin
  if (select auth.uid()) is null then raise exception 'Sign in to review transactions'; end if;
  if p_resolution not in ('bill', 'income', 'goal', 'decision', 'category', 'transfer') then
    raise exception 'Unsupported review resolution';
  end if;

  select * into v_tx
  from public.transactions
  where id = p_transaction_id
    and source = 'plaid'
    and pending is not true
    and removed_at is null
    and deleted_at is null
  for update;
  if not found then raise exception 'Posted bank transaction was not found'; end if;
  if v_tx.household_id is null or not public.is_household_editor(v_tx.household_id) then
    raise exception 'You need household edit access to review transactions';
  end if;
  if not exists (
    select 1 from public.household_plans plan
    where plan.household_id = v_tx.household_id and private.has_review_center_entitlement(v_tx.household_id)
  ) then raise exception 'Review Center requires the Pro plan'; end if;

  select * into v_existing
  from public.transaction_reconciliations
  where transaction_id = p_transaction_id
  for update;

  if v_tx.review_status is distinct from 'needs_review' then
    v_expected_status := case
      when p_resolution = 'category' then 'categorized'
      when p_resolution = 'transfer' then 'transfer'
      else 'matched'
    end;
    if v_existing.transaction_id is not null
      and v_existing.resolution = p_resolution
      and v_existing.target_id is not distinct from p_target_id
      and v_existing.occurrence_date is not distinct from p_occurrence_date
      and v_existing.settlement is not distinct from coalesce(p_settlement, 'regular')
      and (
        (v_existing.planned_amount is null and p_planned_amount is null)
        or abs(v_existing.planned_amount - p_planned_amount) < 0.005
      )
      and v_tx.review_status = v_expected_status
      and v_tx.review_resolution = p_resolution
      and (case
        when p_resolution = 'goal' then v_tx.linked_plan_id = p_target_id and v_tx.linked_plan_type = 'goal'
        when p_resolution = 'decision' then v_tx.linked_plan_id = p_target_id and v_tx.linked_plan_type = 'decision'
        when p_resolution = 'bill' then v_tx.linked_bill_id = p_target_id
        when p_resolution = 'income' then v_tx.linked_income_id = p_target_id
        when p_resolution = 'category' then v_tx.category = p_target_id
        when p_resolution = 'transfer' then v_tx.category = 'Transfer'
        else false
      end)
      and (
        nullif(btrim(coalesce(p_extra_category, '')), '') is null
        or exists (
          select 1
          from jsonb_array_elements(coalesce(v_existing.allocations, '[]'::jsonb)) allocation
          where allocation ->> 'type' = 'category'
            and allocation ->> 'category' = p_extra_category
        )
      ) then
      return jsonb_build_object(
        'transaction_id', p_transaction_id,
        'resolution', v_existing.resolution,
        'allocations', v_existing.allocations,
        'reviewed_at', v_existing.reviewed_at,
        'retry', true
      );
    end if;
    raise exception 'This transaction has already been reviewed';
  end if;
  if v_existing.transaction_id is not null then
    raise exception 'This transaction review state changed. Refresh and try again';
  end if;

  -- Lock the mutable destination before the legacy implementation snapshots
  -- and changes it. Undo returns the transaction to needs_review, so a later
  -- deliberate redo takes these locks and can apply once again.
  if p_resolution = 'goal' then
    perform 1 from public.goals where id = p_target_id for update;
  elsif p_resolution = 'decision' then
    perform 1 from public.decisions where id = p_target_id for update;
  elsif p_resolution = 'bill' then
    perform 1 from public.bills where id = p_target_id for update;
  elsif p_resolution = 'income' then
    perform 1 from public.incomes where id = p_target_id for update;
  end if;

  return private.reconcile_transaction_unlocked_v1(
    p_transaction_id,
    p_resolution,
    p_target_id,
    p_occurrence_date,
    p_planned_amount,
    p_settlement,
    p_extra_category
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.reconcile_transaction(p_transaction_id text, p_resolution text, p_target_id text DEFAULT NULL::text, p_occurrence_date date DEFAULT NULL::date, p_planned_amount numeric DEFAULT NULL::numeric, p_settlement text DEFAULT NULL::text, p_extra_category text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$
  select private.reconcile_transaction(
    p_transaction_id,
    p_resolution,
    p_target_id,
    p_occurrence_date,
    p_planned_amount,
    p_settlement,
    p_extra_category
  )
$function$
;
grant execute on function public.reconcile_transaction(text,text,text,date,numeric,text,text) to authenticated;
grant execute on function private.reconcile_transaction(text,text,text,date,numeric,text,text) to authenticated;
grant execute on function private.reconcile_transaction_unlocked_v1(text,text,text,date,numeric,text,text) to authenticated;
