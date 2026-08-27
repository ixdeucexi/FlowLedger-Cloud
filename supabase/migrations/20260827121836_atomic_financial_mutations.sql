-- Keep subscription review decisions durable and make compound financial
-- actions all-or-nothing. Every privileged implementation lives outside the
-- exposed schema; public functions are narrow SECURITY INVOKER wrappers.

create table public.subscription_candidates (
  id uuid primary key,
  user_id uuid references auth.users(id) on delete set null,
  household_id uuid not null references public.households(id) on delete cascade,
  merchant text not null check (char_length(btrim(merchant)) between 1 and 240),
  merchant_key text generated always as (
    btrim(regexp_replace(
      regexp_replace(
        regexp_replace(lower(btrim(merchant)), '[^a-z0-9[:space:]]', ' ', 'g'),
        '\m(pos|debit|card|purchase|payment|inc|llc|co)\M', ' ', 'g'
      ),
      '[[:space:]]+', ' ', 'g'
    ))
  ) stored check (char_length(merchant_key) between 1 and 200),
  cadence text not null check (cadence in ('weekly', 'monthly', 'annual', 'unknown')),
  average_amount numeric not null check (average_amount >= 0),
  monthly_equivalent numeric not null check (monthly_equivalent >= 0),
  yearly_equivalent numeric not null check (yearly_equivalent >= 0),
  confidence text not null check (confidence in ('low', 'medium', 'high')),
  status text not null default 'review'
    check (status in ('review', 'keep', 'cancel_manually', 'convert_to_bill', 'not_subscription')),
  source_transaction_ids text[] not null default '{}'::text[]
    check (cardinality(source_transaction_ids) <= 500),
  bill_id text references public.bills(id) on delete set null,
  last_reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscription_candidates_household_member_fkey
    foreign key (household_id, user_id)
    references public.household_members(household_id, user_id)
    on delete set null (user_id)
    deferrable initially deferred,
  unique (household_id, merchant_key)
);

create index if not exists subscription_candidates_household_status_idx
  on public.subscription_candidates (household_id, status, updated_at desc);
create index if not exists subscription_candidates_user_id_idx
  on public.subscription_candidates (user_id)
  where user_id is not null;
create index if not exists subscription_candidates_household_user_idx
  on public.subscription_candidates (household_id, user_id);
create index if not exists subscription_candidates_bill_id_idx
  on public.subscription_candidates (bill_id)
  where bill_id is not null;

alter table public.subscription_candidates enable row level security;

drop policy if exists "subscription candidates: household members read"
  on public.subscription_candidates;
create policy "subscription candidates: household members read"
on public.subscription_candidates for select to authenticated
using ((select private.is_household_member(household_id)));

drop policy if exists "subscription candidates: household editors insert"
  on public.subscription_candidates;
create policy "subscription candidates: household editors insert"
on public.subscription_candidates for insert to authenticated
with check (
  user_id = (select auth.uid())
  and (select private.is_household_editor(household_id))
);

drop policy if exists "subscription candidates: household editors update"
  on public.subscription_candidates;
create policy "subscription candidates: household editors update"
on public.subscription_candidates for update to authenticated
using ((select private.is_household_editor(household_id)))
with check (
  user_id = (select auth.uid())
  and (select private.is_household_editor(household_id))
);

drop policy if exists "subscription candidates: household editors delete"
  on public.subscription_candidates;
create policy "subscription candidates: household editors delete"
on public.subscription_candidates for delete to authenticated
using ((select private.is_household_editor(household_id)));

create or replace function private.validate_subscription_candidate()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.merchant := btrim(new.merchant);
  new.updated_at := now();
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    if tg_op = 'INSERT' then
      if new.user_id is distinct from (select auth.uid()) then
        raise exception 'Subscription decisions must be saved by the signed-in user';
      end if;
    elsif tg_op = 'UPDATE' then
      if new.user_id is distinct from old.user_id
        and new.user_id is not null
        and new.user_id is distinct from (select auth.uid()) then
        raise exception 'Subscription decision ownership is invalid';
      end if;
    end if;
  end if;
  if new.merchant = '' then
    raise exception 'A subscription merchant is required';
  end if;
  if lower(new.average_amount::text) in ('nan', 'infinity', '-infinity')
    or lower(new.monthly_equivalent::text) in ('nan', 'infinity', '-infinity')
    or lower(new.yearly_equivalent::text) in ('nan', 'infinity', '-infinity') then
    raise exception 'Subscription amounts must be finite';
  end if;
  if tg_op = 'INSERT'
     or new.household_id is distinct from old.household_id
     or new.source_transaction_ids is distinct from old.source_transaction_ids then
    if exists (
      select 1
      from unnest(new.source_transaction_ids) source_id
      where not exists (
        select 1 from public.transactions transaction_row
        where transaction_row.id = source_id
          and transaction_row.household_id = new.household_id
      )
    ) then
      raise exception 'Subscription sources must belong to this household';
    end if;
  end if;
  if (
    tg_op = 'INSERT'
    or new.household_id is distinct from old.household_id
    or new.bill_id is distinct from old.bill_id
  ) and new.bill_id is not null then
    if not exists (
      select 1 from public.bills bill
      where bill.id = new.bill_id
        and bill.household_id = new.household_id
        and bill.is_debt is not true
    ) then
      raise exception 'Subscription bill must belong to this household';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists validate_subscription_candidate
  on public.subscription_candidates;
create trigger validate_subscription_candidate
before insert or update on public.subscription_candidates
for each row execute function private.validate_subscription_candidate();
revoke all on function private.validate_subscription_candidate()
  from public, anon, authenticated, service_role;

revoke all on table public.subscription_candidates from public, anon;
grant select, insert, update, delete on table public.subscription_candidates
  to authenticated, service_role;

-- Account deletion should call RevenueCat only when the user actually has a
-- provider-side customer/binding/event. Founding Free accounts have no such
-- record and can be deleted without configuring a RevenueCat secret.
create or replace function private.inspect_account_deletion(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_blocked jsonb;
  v_plaid_count integer;
  v_billing_customer_exists boolean := false;
begin
  if p_user_id is null
    or coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'account_deletion_access_denied';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'householdId', owned.id,
    'name', coalesce(nullif(btrim(owned.name), ''), 'Shared household'),
    'memberCount', owned.member_count
  ) order by owned.name), '[]'::jsonb)
  into v_blocked
  from (
    select household.id, household.name,
      count(member.user_id)::integer as member_count
    from public.households household
    left join public.household_members member
      on member.household_id = household.id
    where household.created_by = p_user_id
      and exists (
        select 1 from public.household_members survivor
        where survivor.household_id = household.id
          and survivor.user_id <> p_user_id
      )
    group by household.id, household.name
  ) owned;

  select count(*)::integer into v_plaid_count
  from public.plaid_items item
  where item.user_id = p_user_id
     or exists (
       select 1 from public.households household
       where household.id = item.household_id
         and household.created_by = p_user_id
     );

  if to_regclass('public.billing_purchase_bindings') is not null then
    execute $query$
      select exists (
        select 1 from public.billing_purchase_bindings binding
        where binding.purchaser_user_id = $1 or binding.app_user_id = $1
      )
    $query$ into v_billing_customer_exists using p_user_id;
  end if;
  if not v_billing_customer_exists
     and to_regclass('public.billing_entitlements') is not null then
    execute $query$
      select exists (
        select 1 from public.billing_entitlements entitlement
        where entitlement.purchaser_user_id = $1 or entitlement.app_user_id = $1
      )
    $query$ into v_billing_customer_exists using p_user_id;
  end if;
  if not v_billing_customer_exists
     and to_regclass('public.billing_events') is not null then
    execute $query$
      select exists (
        select 1 from public.billing_events event
        where event.app_user_id = $1
      )
    $query$ into v_billing_customer_exists using p_user_id;
  end if;

  return jsonb_build_object(
    'blockedHouseholds', v_blocked,
    'plaidItemCount', v_plaid_count,
    'billingCustomerExists', v_billing_customer_exists
  );
end;
$$;

revoke all on function private.inspect_account_deletion(uuid)
  from public, anon, authenticated;
grant execute on function private.inspect_account_deletion(uuid) to service_role;

-- Atomically add a contribution transaction and advance a savings goal. The
-- stable transaction id and expected balance make retries safe without
-- preventing a later intentional contribution.
create or replace function private.fund_goal(
  p_goal_id text,
  p_transaction_id text,
  p_amount numeric,
  p_date date,
  p_expected_current_amount numeric,
  p_account_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_goal public.goals%rowtype;
  v_existing public.transactions%rowtype;
  v_applied numeric;
  v_next numeric;
begin
  if v_actor is null then raise exception 'Sign in to fund a goal'; end if;
  if nullif(btrim(coalesce(p_transaction_id, '')), '') is null then
    raise exception 'A stable contribution id is required';
  end if;
  if char_length(p_transaction_id) > 200 then
    raise exception 'Contribution id is too long';
  end if;
  if p_date is null then raise exception 'Contribution date is required'; end if;
  if p_amount is null or lower(p_amount::text) in ('nan', 'infinity', '-infinity')
    or p_amount <= 0 or p_amount > 1000000000 then
    raise exception 'Enter a finite positive contribution';
  end if;
  v_applied := round(p_amount, 2);
  if v_applied <= 0 then raise exception 'Contribution must be at least one cent'; end if;
  if p_expected_current_amount is null
    or lower(p_expected_current_amount::text) in ('nan', 'infinity', '-infinity')
    or p_expected_current_amount < 0 then
    raise exception 'The goal balance is invalid';
  end if;

  select * into v_goal from public.goals
  where id = p_goal_id for update;
  if not found or v_goal.household_id is null then raise exception 'Goal not found'; end if;
  if not (select private.is_household_editor(v_goal.household_id)) then
    raise exception 'You need household edit access to fund this goal';
  end if;
  if v_goal.goal_type <> 'savings' or v_goal.closed_at is not null
    or v_goal.archived_at is not null then
    raise exception 'Choose an open savings goal';
  end if;
  if p_account_id is not null and not exists (
    select 1 from public.accounts account_row
    where account_row.id = p_account_id
      and account_row.household_id = v_goal.household_id
      and account_row.is_active
  ) then raise exception 'Choose an active household account'; end if;

  select * into v_existing from public.transactions
  where id = p_transaction_id for update;
  if found then
    if v_existing.household_id = v_goal.household_id
      and v_existing.linked_plan_type = 'goal'
      and v_existing.linked_plan_id = v_goal.id
      and v_existing.date::date = p_date
      and abs(v_existing.amount + v_applied) < 0.005
      and v_existing.account_id is not distinct from p_account_id
      and v_existing.source = 'manual'
      and v_existing.category = 'Savings'
      and v_goal.current_amount + 0.005 >=
        round(p_expected_current_amount + v_applied, 2) then
      return jsonb_build_object(
        'goal_id', v_goal.id,
        'transaction_id', v_existing.id,
        'current_amount', v_goal.current_amount,
        'applied_amount', v_applied,
        'retry', true
      );
    end if;
    raise exception 'That contribution id is already in use';
  end if;

  if abs(v_goal.current_amount - p_expected_current_amount) >= 0.005 then
    raise exception 'This goal changed. Refresh and try again';
  end if;
  if v_applied > v_goal.target_amount - v_goal.current_amount then
    raise exception 'Contribution exceeds the amount left on this goal';
  end if;
  v_next := v_goal.current_amount + v_applied;
  if v_next <= v_goal.current_amount then raise exception 'This goal is already funded'; end if;

  update public.goals set current_amount = v_next where id = v_goal.id;
  insert into public.transactions (
    id, user_id, household_id, budget_id, date, amount, category, note,
    account_id, source, linked_plan_id, linked_plan_type
  ) values (
    p_transaction_id, v_actor, v_goal.household_id, v_goal.budget_id,
    p_date::text, -v_applied, 'Savings',
    'Goal funding: ' || v_goal.name, p_account_id, 'manual',
    v_goal.id, 'goal'
  );

  return jsonb_build_object(
    'goal_id', v_goal.id,
    'transaction_id', p_transaction_id,
    'current_amount', v_next,
    'applied_amount', v_applied,
    'retry', false
  );
end;
$$;

revoke all on function private.fund_goal(text, text, numeric, date, numeric, text)
  from public, anon, authenticated, service_role;
grant execute on function private.fund_goal(text, text, numeric, date, numeric, text)
  to authenticated;

create or replace function public.fund_goal(
  p_goal_id text,
  p_transaction_id text,
  p_amount numeric,
  p_date date,
  p_expected_current_amount numeric,
  p_account_id text default null
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.fund_goal(
    p_goal_id, p_transaction_id, p_amount, p_date,
    p_expected_current_amount, p_account_id
  )
$$;

revoke all on function public.fund_goal(text, text, numeric, date, numeric, text)
  from public, anon, service_role;
grant execute on function public.fund_goal(text, text, numeric, date, numeric, text)
  to authenticated;

-- Create a saved bill for a detected subscription and close the candidate in
-- the same transaction. Candidate id and bill id are stable across retries.
create or replace function private.create_subscription_bill(
  p_candidate_id uuid,
  p_bill_id text,
  p_household_id uuid,
  p_merchant text,
  p_cadence text,
  p_average_amount numeric,
  p_monthly_equivalent numeric,
  p_yearly_equivalent numeric,
  p_confidence text,
  p_source_transaction_ids text[],
  p_amount numeric,
  p_start_date date,
  p_due_day integer,
  p_frequency text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_budget_id uuid;
  v_candidate public.subscription_candidates%rowtype;
  v_bill public.bills%rowtype;
  v_existing_link public.subscription_bill_links%rowtype;
  v_name text := btrim(coalesce(p_merchant, ''));
  v_key text;
  v_priority integer;
begin
  if v_actor is null then raise exception 'Sign in to create a subscription bill'; end if;
  if p_household_id is null or not (select private.is_household_editor(p_household_id)) then
    raise exception 'You need household edit access to create this bill';
  end if;
  if p_candidate_id is null or nullif(btrim(coalesce(p_bill_id, '')), '') is null then
    raise exception 'Stable subscription and bill ids are required';
  end if;
  if char_length(p_bill_id) > 200 then raise exception 'Subscription bill id is too long'; end if;
  if v_name = '' or char_length(v_name) > 120 then
    raise exception 'Enter a subscription name up to 120 characters';
  end if;
  if p_cadence not in ('weekly', 'monthly', 'annual', 'unknown')
    or p_frequency not in ('weekly', 'monthly')
    or p_confidence not in ('low', 'medium', 'high') then
    raise exception 'Subscription details are invalid';
  end if;
  if p_amount is null or lower(p_amount::text) in ('nan', 'infinity', '-infinity')
    or round(p_amount, 2) <= 0 or p_amount > 1000000000
    or p_average_amount is null or lower(p_average_amount::text) in ('nan', 'infinity', '-infinity')
    or p_average_amount < 0 or p_average_amount > 1000000000
    or p_monthly_equivalent is null or lower(p_monthly_equivalent::text) in ('nan', 'infinity', '-infinity')
    or p_monthly_equivalent < 0 or p_monthly_equivalent > 1000000000
    or p_yearly_equivalent is null or lower(p_yearly_equivalent::text) in ('nan', 'infinity', '-infinity')
    or p_yearly_equivalent < 0 or p_yearly_equivalent > 1000000000 then
    raise exception 'Subscription amounts must be finite';
  end if;
  if p_start_date is null then raise exception 'Subscription start date is required'; end if;
  if cardinality(coalesce(p_source_transaction_ids, '{}'::text[])) > 500 then
    raise exception 'Subscription has too many source transactions';
  end if;
  if p_due_day not between 1 and 28 then raise exception 'Subscription due day must be between 1 and 28'; end if;

  v_key := btrim(regexp_replace(
    regexp_replace(
      regexp_replace(lower(v_name), '[^a-z0-9[:space:]]', ' ', 'g'),
      '\m(pos|debit|card|purchase|payment|inc|llc|co)\M', ' ', 'g'
    ),
    '[[:space:]]+', ' ', 'g'
  ));
  if v_key = '' then raise exception 'Subscription name is too generic'; end if;

  -- There may be no candidate row to lock yet. Serialize on the stable intent
  -- id so two first-time requests cannot race through duplicate bill inserts.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_candidate_id::text, 0)
  );
  -- Candidate ids are stable for a single client intent, while merchant keys
  -- are stable across every device and candidate for the same subscription.
  -- Lock both so a second create cannot replace an existing merchant link.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_household_id::text || ':' || v_key, 1)
  );

  select id into v_budget_id from public.budgets
  where household_id = p_household_id and is_default limit 1;
  if v_budget_id is null then raise exception 'Household budget not found'; end if;

  select * into v_candidate from public.subscription_candidates
  where id = p_candidate_id for update;
  if found and v_candidate.household_id <> p_household_id then
    raise exception 'Subscription candidate belongs to another household';
  end if;
  if found and v_candidate.bill_id is not null then
    select * into v_bill from public.bills where id = v_candidate.bill_id for update;
    if v_bill.id = p_bill_id and v_bill.household_id = p_household_id
      and abs(v_bill.amount - round(p_amount, 2)) < 0.005
      and v_bill.frequency = p_frequency
      and v_bill.due_day = p_due_day
      and btrim(v_bill.name) = v_name
      and v_bill.category = 'Subscriptions'
      and v_bill.start_date = p_start_date::text
      and v_bill.is_recurring
      and not v_bill.is_debt
      and v_candidate.merchant_key = v_key
      and v_candidate.cadence = p_cadence
      and abs(v_candidate.average_amount - round(p_average_amount, 2)) < 0.005
      and abs(v_candidate.monthly_equivalent - round(p_monthly_equivalent, 2)) < 0.005
      and abs(v_candidate.yearly_equivalent - round(p_yearly_equivalent, 2)) < 0.005
      and v_candidate.confidence = p_confidence
      and v_candidate.status = 'convert_to_bill'
      and v_candidate.source_transaction_ids = coalesce(p_source_transaction_ids, '{}'::text[])
      and exists (
        select 1 from public.subscription_bill_links link
        where link.household_id = p_household_id
          and link.merchant_key = v_key
          and link.bill_id = p_bill_id
      ) then
      return jsonb_build_object(
        'candidate_id', p_candidate_id,
        'bill_id', v_bill.id,
        'retry', true
      );
    end if;
    raise exception 'This subscription already created a different bill';
  end if;

  select * into v_existing_link
  from public.subscription_bill_links
  where household_id = p_household_id
    and merchant_key = v_key
  for update;
  if found then
    raise exception 'This subscription is already linked to an existing bill';
  end if;

  if exists (select 1 from public.bills where id = p_bill_id) then
    raise exception 'That subscription bill id is already in use';
  end if;
  select coalesce(max(priority), 0) + 1 into v_priority
  from public.bills where household_id = p_household_id;

  insert into public.bills (
    id, user_id, household_id, budget_id, name, amount, category, priority,
    is_debt, balance, interest_rate, due_day, start_date, is_recurring,
    frequency, smart_priority, include_in_snowball
  ) values (
    p_bill_id, v_actor, p_household_id, v_budget_id, v_name,
    round(p_amount, 2), 'Subscriptions', v_priority, false, 0, 0,
    p_due_day, p_start_date::text, true, p_frequency, 'must', false
  ) returning * into v_bill;

  insert into public.subscription_candidates (
    id, user_id, household_id, merchant, cadence, average_amount,
    monthly_equivalent, yearly_equivalent, confidence, status,
    source_transaction_ids, bill_id, last_reviewed_at, updated_at
  ) values (
    p_candidate_id, v_actor, p_household_id, v_name, p_cadence,
    round(p_average_amount, 2), round(p_monthly_equivalent, 2),
    round(p_yearly_equivalent, 2), p_confidence, 'convert_to_bill',
    coalesce(p_source_transaction_ids, '{}'::text[]), p_bill_id, now(), now()
  )
  on conflict (id) do update set
    user_id = excluded.user_id,
    merchant = excluded.merchant,
    cadence = excluded.cadence,
    average_amount = excluded.average_amount,
    monthly_equivalent = excluded.monthly_equivalent,
    yearly_equivalent = excluded.yearly_equivalent,
    confidence = excluded.confidence,
    status = excluded.status,
    source_transaction_ids = excluded.source_transaction_ids,
    bill_id = excluded.bill_id,
    last_reviewed_at = excluded.last_reviewed_at,
    updated_at = excluded.updated_at;

  insert into public.subscription_bill_links (
    user_id, household_id, merchant_key, merchant_label, bill_id, updated_at
  ) values (
    v_actor, p_household_id, v_key, v_name, p_bill_id, now()
  );

  return jsonb_build_object(
    'candidate_id', p_candidate_id,
    'bill_id', p_bill_id,
    'retry', false
  );
end;
$$;

revoke all on function private.create_subscription_bill(
  uuid, text, uuid, text, text, numeric, numeric, numeric, text,
  text[], numeric, date, integer, text
) from public, anon, authenticated, service_role;
grant execute on function private.create_subscription_bill(
  uuid, text, uuid, text, text, numeric, numeric, numeric, text,
  text[], numeric, date, integer, text
) to authenticated;

create or replace function public.create_subscription_bill(
  p_candidate_id uuid,
  p_bill_id text,
  p_household_id uuid,
  p_merchant text,
  p_cadence text,
  p_average_amount numeric,
  p_monthly_equivalent numeric,
  p_yearly_equivalent numeric,
  p_confidence text,
  p_source_transaction_ids text[],
  p_amount numeric,
  p_start_date date,
  p_due_day integer,
  p_frequency text
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.create_subscription_bill(
    p_candidate_id, p_bill_id, p_household_id, p_merchant, p_cadence,
    p_average_amount, p_monthly_equivalent, p_yearly_equivalent,
    p_confidence, p_source_transaction_ids, p_amount, p_start_date,
    p_due_day, p_frequency
  )
$$;

revoke all on function public.create_subscription_bill(
  uuid, text, uuid, text, text, numeric, numeric, numeric, text,
  text[], numeric, date, integer, text
) from public, anon, service_role;
grant execute on function public.create_subscription_bill(
  uuid, text, uuid, text, text, numeric, numeric, numeric, text,
  text[], numeric, date, integer, text
) to authenticated;

-- Create a forgotten bill and reconcile its posted charge under the same row
-- lock. The bill id is derived from the posted transaction so a lost response
-- cannot create a duplicate bill on retry.
create or replace function private.create_bill_and_reconcile_transaction(
  p_transaction_id text,
  p_bill jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_tx public.transactions%rowtype;
  v_bill public.bills%rowtype;
  v_existing public.transaction_reconciliations%rowtype;
  v_bill_id text := 'review-bill-' || md5(coalesce(p_transaction_id, ''));
  v_name text := btrim(coalesce(p_bill ->> 'name', ''));
  v_amount numeric;
  v_balance numeric;
  v_interest_rate numeric;
  v_snowball_minimum_boost numeric;
  v_actual numeric;
  v_settlement text;
  v_reconciliation jsonb;
  v_frequency text := coalesce(nullif(p_bill ->> 'frequency', ''), 'monthly');
  v_category text := btrim(coalesce(nullif(p_bill ->> 'category', ''), 'Other'));
  v_requested_priority integer;
  v_priority integer;
  v_due_day integer;
  v_day_of_week integer;
  v_next_payment_date date;
  v_start_date date;
  v_end_date date;
  v_is_debt boolean;
  v_is_recurring boolean;
  v_include_in_snowball boolean;
  v_smart_priority text := coalesce(nullif(p_bill ->> 'smart_priority', ''), 'must');
begin
  if v_actor is null then raise exception 'Sign in to add a forgotten bill'; end if;
  if jsonb_typeof(coalesce(p_bill, '{}'::jsonb)) <> 'object' then
    raise exception 'Bill details are required';
  end if;
  begin
    v_amount := (p_bill ->> 'amount')::numeric;
    v_balance := coalesce(nullif(p_bill ->> 'balance', ''), '0')::numeric;
    v_interest_rate := coalesce(nullif(p_bill ->> 'interest_rate', ''), '0')::numeric;
    v_snowball_minimum_boost := coalesce(
      nullif(p_bill ->> 'snowball_minimum_boost', ''), '0'
    )::numeric;
    v_requested_priority := nullif(p_bill ->> 'priority', '')::integer;
    v_due_day := nullif(p_bill ->> 'due_day', '')::integer;
    v_day_of_week := nullif(p_bill ->> 'day_of_week', '')::integer;
    v_next_payment_date := nullif(p_bill ->> 'next_payment_date', '')::date;
    v_start_date := nullif(p_bill ->> 'start_date', '')::date;
    v_end_date := nullif(p_bill ->> 'end_date', '')::date;
    v_is_debt := coalesce((p_bill ->> 'is_debt')::boolean, false);
    v_is_recurring := coalesce((p_bill ->> 'is_recurring')::boolean, true);
    v_include_in_snowball := coalesce(
      (p_bill ->> 'include_in_snowball')::boolean, true
    );
  exception
    when invalid_text_representation or numeric_value_out_of_range
      or invalid_datetime_format or datetime_field_overflow then
      raise exception 'Bill details contain an invalid number or date';
  end;
  if v_name = '' or char_length(v_name) > 120 then
    raise exception 'Enter a bill name up to 120 characters';
  end if;
  if v_amount is null or lower(v_amount::text) in ('nan', 'infinity', '-infinity')
    or round(v_amount, 2) <= 0 or v_amount > 1000000000 then
    raise exception 'Enter a finite positive bill amount';
  end if;
  if lower(v_balance::text) in ('nan', 'infinity', '-infinity')
    or v_balance < 0 or v_balance > 1000000000
    or lower(v_interest_rate::text) in ('nan', 'infinity', '-infinity')
    or v_interest_rate < 0 or v_interest_rate > 1000
    or lower(v_snowball_minimum_boost::text) in ('nan', 'infinity', '-infinity')
    or v_snowball_minimum_boost < 0
    or v_snowball_minimum_boost > 1000000000 then
    raise exception 'Bill balances and rates must be finite and non-negative';
  end if;
  if v_category = '' or char_length(v_category) > 120 then
    raise exception 'Enter a category up to 120 characters';
  end if;
  if v_requested_priority is not null
    and v_requested_priority not between 0 and 1000000 then
    raise exception 'Bill priority is invalid';
  end if;
  if v_due_day is not null and v_due_day not between 1 and 31 then
    raise exception 'Bill due day must be between 1 and 31';
  end if;
  if v_day_of_week is not null and v_day_of_week not between 0 and 6 then
    raise exception 'Bill weekday is invalid';
  end if;
  if v_smart_priority not in ('must', 'flexible', 'optional') then
    raise exception 'Bill importance is invalid';
  end if;
  if v_frequency not in ('monthly', 'quarterly', 'biweekly', 'weekly') then
    raise exception 'Choose a valid bill frequency';
  end if;

  select * into v_tx from public.transactions
  where id = p_transaction_id
    and source = 'plaid'
    and pending is not true
    and removed_at is null
    and deleted_at is null
  for update;
  if not found or v_tx.amount >= 0 then
    raise exception 'Posted money-out transaction was not found';
  end if;
  v_due_day := coalesce(v_due_day, extract(day from v_tx.date::date)::integer);
  v_start_date := coalesce(v_start_date, v_tx.date::date);
  if v_end_date is not null and v_end_date < v_start_date then
    raise exception 'Bill end date cannot be before its start date';
  end if;
  if v_frequency = 'quarterly' and v_next_payment_date is null then
    raise exception 'Quarterly bills require a first payment date';
  end if;
  if v_tx.household_id is null or not (select private.is_household_editor(v_tx.household_id)) then
    raise exception 'You need household edit access to review transactions';
  end if;
  if not private.has_review_center_entitlement(v_tx.household_id) then
    raise exception 'Review Center is unavailable for this household';
  end if;

  select * into v_existing from public.transaction_reconciliations
  where transaction_id = p_transaction_id for update;
  if v_tx.review_status is distinct from 'needs_review' then
    select * into v_bill from public.bills where id = v_bill_id for update;
    if v_existing.transaction_id = p_transaction_id
      and v_existing.resolution = 'bill'
      and v_existing.target_id = v_bill_id
      and v_bill.household_id = v_tx.household_id
      and btrim(v_bill.name) = v_name
      and abs(v_bill.amount - round(v_amount, 2)) < 0.005
      and v_bill.category = v_category
      and (v_requested_priority is null or v_bill.priority = v_requested_priority)
      and v_bill.is_debt = v_is_debt
      and abs(v_bill.balance - round(v_balance, 2)) < 0.005
      and abs(v_bill.interest_rate - round(v_interest_rate, 4)) < 0.00005
      and v_bill.due_day = v_due_day
      and v_bill.day_of_week is not distinct from v_day_of_week
      and v_bill.next_payment_date is not distinct from v_next_payment_date::text
      and v_bill.start_date is not distinct from v_start_date::text
      and v_bill.end_date is not distinct from v_end_date::text
      and v_bill.is_recurring = v_is_recurring
      and v_bill.frequency = v_frequency
      and v_bill.smart_priority = v_smart_priority
      and v_bill.include_in_snowball = v_include_in_snowball
      and abs(v_bill.snowball_minimum_boost - round(v_snowball_minimum_boost, 2)) < 0.005 then
      return jsonb_build_object(
        'bill_id', v_bill_id,
        'reconciliation', to_jsonb(v_existing),
        'retry', true
      );
    end if;
    raise exception 'This transaction has already been reviewed';
  end if;

  if exists (select 1 from public.bills where id = v_bill_id) then
    raise exception 'The retry bill exists without a matching review';
  end if;
  if v_requested_priority is null then
    select coalesce(max(priority), 0) + 1 into v_priority
    from public.bills where household_id = v_tx.household_id;
  else
    v_priority := v_requested_priority;
  end if;

  insert into public.bills (
    id, user_id, household_id, budget_id, name, amount, category, priority,
    is_debt, balance, interest_rate, due_day, day_of_week,
    next_payment_date, start_date, end_date, is_recurring, frequency,
    smart_priority, include_in_snowball, snowball_minimum_boost
  ) values (
    v_bill_id, v_actor, v_tx.household_id, v_tx.budget_id, v_name,
    round(v_amount, 2), v_category, v_priority,
    v_is_debt, round(v_balance, 2), round(v_interest_rate, 4),
    v_due_day, v_day_of_week, v_next_payment_date::text,
    v_start_date::text, v_end_date::text, v_is_recurring,
    v_frequency,
    v_smart_priority, v_include_in_snowball,
    round(v_snowball_minimum_boost, 2)
  ) returning * into v_bill;

  v_actual := round(abs(v_tx.amount), 2);
  v_settlement := case
    when abs(v_actual - round(v_amount, 2)) < 0.005 then 'exact'
    when v_actual < round(v_amount, 2) then 'partial'
    else 'full'
  end;
  v_reconciliation := private.reconcile_transaction(
    p_transaction_id, 'bill', v_bill_id, v_tx.date::date,
    round(v_amount, 2), v_settlement, null
  );

  return jsonb_build_object(
    'bill_id', v_bill_id,
    'reconciliation', v_reconciliation,
    'retry', false
  );
end;
$$;

revoke all on function private.create_bill_and_reconcile_transaction(text, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function private.create_bill_and_reconcile_transaction(text, jsonb)
  to authenticated;

create or replace function public.create_bill_and_reconcile_transaction(
  p_transaction_id text,
  p_bill jsonb
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.create_bill_and_reconcile_transaction(p_transaction_id, p_bill)
$$;

revoke all on function public.create_bill_and_reconcile_transaction(text, jsonb)
  from public, anon, service_role;
grant execute on function public.create_bill_and_reconcile_transaction(text, jsonb)
  to authenticated;

-- Complete a planned decision and its financial side effect in one database
-- transaction. The decision row is the idempotency record.
create or replace function private.complete_decision(
  p_decision_id text,
  p_actual_amount numeric,
  p_completed_date date,
  p_account_id text default null,
  p_debt_plan jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_decision public.decisions%rowtype;
  v_goal public.goals%rowtype;
  v_income public.incomes%rowtype;
  v_kind text;
  v_name text;
  v_source_id text;
  v_frequency text;
  v_transaction_id text;
  v_bill_id text;
  v_income_id text;
  v_payment_id text;
  v_next_date date;
  v_history jsonb;
  v_applied jsonb := '{}'::jsonb;
  v_request_fingerprint text;
  v_now timestamptz := now();
begin
  if v_actor is null then raise exception 'Sign in to complete a decision'; end if;
  if p_actual_amount is null
    or lower(p_actual_amount::text) in ('nan', 'infinity', '-infinity')
    or p_actual_amount < 0 or p_actual_amount > 1000000000 then
    raise exception 'Enter a finite non-negative actual amount';
  end if;
  if p_completed_date is null then raise exception 'Choose a completion date'; end if;
  v_request_fingerprint := md5(
    round(p_actual_amount, 2)::text || '|' || p_completed_date::text || '|'
    || coalesce(p_account_id, '') || '|'
    || coalesce(p_debt_plan, 'null'::jsonb)::text
  );

  select * into v_decision from public.decisions
  where id = p_decision_id for update;
  if not found or v_decision.household_id is null then raise exception 'Decision not found'; end if;
  if not (select private.is_household_editor(v_decision.household_id)) then
    raise exception 'You need household edit access to complete this decision';
  end if;

  if v_decision.status = 'completed' then
    if abs(coalesce(v_decision.actual_amount, 0) - round(p_actual_amount, 2)) < 0.005
      and v_decision.applied_change ->> 'requestFingerprint' = v_request_fingerprint then
      return jsonb_build_object(
        'decision_id', v_decision.id,
        'applied_change', coalesce(v_decision.applied_change, '{}'::jsonb),
        'retry', true
      );
    end if;
    raise exception 'This decision is already completed with different details';
  end if;
  if v_decision.status not in ('planned', 'calendar') then
    raise exception 'Only a planned decision can be completed';
  end if;

  v_kind := v_decision.scenario ->> 'type';
  v_name := btrim(coalesce(v_decision.scenario ->> 'name', v_decision.name));
  v_source_id := nullif(v_decision.scenario ->> 'sourceId', '');
  v_frequency := coalesce(nullif(v_decision.scenario ->> 'frequency', ''), 'monthly');
  if v_kind is distinct from v_decision.decision_type then
    raise exception 'Decision type does not match its scenario';
  end if;
  if v_name = '' or char_length(v_name) > 120 then
    raise exception 'Decision name must be between 1 and 120 characters';
  end if;
  if p_account_id is not null and not exists (
    select 1 from public.accounts account_row
    where account_row.id = p_account_id
      and account_row.household_id = v_decision.household_id
      and account_row.is_active
  ) then raise exception 'Choose an active household account'; end if;

  if v_kind = 'one_time_purchase' then
    if round(p_actual_amount, 2) > 0 then
      v_transaction_id := 'decision-' || md5(v_decision.id || ':transaction');
      insert into public.transactions (
        id, user_id, household_id, budget_id, date, amount, category, note,
        account_id, source, linked_plan_id, linked_plan_type
      ) values (
        v_transaction_id, v_actor, v_decision.household_id, v_decision.budget_id,
        p_completed_date::text, -round(p_actual_amount, 2), 'Other', v_name,
        p_account_id, 'manual', v_decision.id, 'decision'
      );
      v_applied := jsonb_build_object('kind', 'transaction', 'id', v_transaction_id);
    else
      v_applied := jsonb_build_object('kind', 'no_spend');
    end if;
  elsif v_kind = 'savings_contribution' then
    if round(p_actual_amount, 2) <= 0 then raise exception 'Enter a positive savings contribution'; end if;
    select * into v_goal from public.goals
    where id = v_source_id and household_id = v_decision.household_id
    for update;
    if not found or v_goal.goal_type <> 'savings' or v_goal.closed_at is not null
      or v_goal.archived_at is not null then
      raise exception 'Savings goal not found';
    end if;
    if round(p_actual_amount, 2) > v_goal.target_amount - v_goal.current_amount then
      raise exception 'Savings contribution exceeds the amount left on this goal';
    end if;
    update public.goals
    set current_amount = current_amount + round(p_actual_amount, 2)
    where id = v_goal.id;
    v_transaction_id := 'decision-' || md5(v_decision.id || ':transaction');
    insert into public.transactions (
      id, user_id, household_id, budget_id, date, amount, category, note,
      account_id, source, linked_plan_id, linked_plan_type
    ) values (
      v_transaction_id, v_actor, v_decision.household_id, v_decision.budget_id,
      p_completed_date::text, -round(p_actual_amount, 2), 'Savings', v_name,
      p_account_id, 'manual', v_decision.id, 'decision'
    );
    v_applied := jsonb_build_object(
      'kind', 'goal_contribution', 'goalId', v_goal.id,
      'transactionId', v_transaction_id
    );
  elsif v_kind = 'recurring_bill' then
    if round(p_actual_amount, 2) <= 0 then raise exception 'Enter a positive recurring bill amount'; end if;
    if v_frequency not in ('weekly', 'biweekly', 'monthly') then
      raise exception 'Recurring decision frequency is invalid';
    end if;
    v_transaction_id := 'decision-' || md5(v_decision.id || ':transaction');
    insert into public.transactions (
      id, user_id, household_id, budget_id, date, amount, category, note,
      account_id, source, linked_plan_id, linked_plan_type
    ) values (
      v_transaction_id, v_actor, v_decision.household_id, v_decision.budget_id,
      p_completed_date::text, -round(p_actual_amount, 2), 'Other', v_name,
      p_account_id, 'manual', v_decision.id, 'decision'
    );
    if v_frequency = 'weekly' then
      v_next_date := p_completed_date + 7;
    elsif v_frequency = 'biweekly' then
      v_next_date := p_completed_date + 14;
    else
      v_next_date := (
        date_trunc('month', p_completed_date::timestamp) + interval '1 month'
        + (
          least(
            extract(day from p_completed_date)::integer,
            extract(day from (
              date_trunc('month', p_completed_date::timestamp)
              + interval '2 months - 1 day'
            ))::integer
          ) - 1
        ) * interval '1 day'
      )::date;
    end if;
    v_bill_id := 'decision-' || md5(v_decision.id || ':bill');
    insert into public.bills (
      id, user_id, household_id, budget_id, name, amount, category, priority,
      is_debt, balance, interest_rate, due_day, start_date,
      next_payment_date, is_recurring, frequency, smart_priority,
      include_in_snowball
    ) values (
      v_bill_id, v_actor, v_decision.household_id, v_decision.budget_id,
      v_name, round(p_actual_amount, 2), 'Other',
      (select coalesce(max(priority), 0) + 1 from public.bills
        where household_id = v_decision.household_id),
      false, 0, 0, extract(day from v_next_date)::integer,
      v_next_date::text, v_next_date::text, true, v_frequency,
      'must', false
    );
    v_applied := jsonb_build_object(
      'kind', 'recurring', 'transactionId', v_transaction_id,
      'billId', v_bill_id
    );
  elsif v_kind = 'income_change' then
    if round(p_actual_amount, 2) <= 0 then raise exception 'Enter a positive income amount'; end if;
    if v_frequency not in ('weekly', 'biweekly', 'monthly') then
      raise exception 'Income frequency is invalid';
    end if;
    select * into v_income from public.incomes
    where id = v_source_id and household_id = v_decision.household_id
    for update;
    if found then
      select coalesce(jsonb_agg(history_item), '[]'::jsonb)
      into v_history
      from jsonb_array_elements(coalesce(v_income.amount_history, '[]'::jsonb)) history_item
      where history_item ->> 'effective_from' <>
        to_char(p_completed_date, 'YYYY-MM');
      v_history := v_history || jsonb_build_array(jsonb_build_object(
        'effective_from', to_char(p_completed_date, 'YYYY-MM'),
        'amount', round(p_actual_amount, 2)
      ));
      update public.incomes set
        amount = round(p_actual_amount, 2),
        amount_history = v_history,
        last_reviewed_at = v_now
      where id = v_income.id;
      v_applied := jsonb_build_object('kind', 'income_update', 'incomeId', v_income.id);
    else
      v_income_id := 'decision-' || md5(v_decision.id || ':income');
      insert into public.incomes (
        id, user_id, household_id, budget_id, name, amount, frequency,
        start_date, next_payment_date, amount_history, last_reviewed_at
      ) values (
        v_income_id, v_actor, v_decision.household_id, v_decision.budget_id,
        v_name, round(p_actual_amount, 2), v_frequency,
        p_completed_date::text,
        case when v_frequency = 'monthly' then null else p_completed_date::text end,
        jsonb_build_array(jsonb_build_object(
          'effective_from', to_char(p_completed_date, 'YYYY-MM'),
          'amount', round(p_actual_amount, 2)
        )), v_now
      );
      v_applied := jsonb_build_object('kind', 'income', 'id', v_income_id);
    end if;
  elsif v_kind = 'extra_debt_payment' then
    if round(p_actual_amount, 2) <= 0 then raise exception 'Enter a positive debt payment'; end if;
    if p_debt_plan is not null then
      if jsonb_typeof(p_debt_plan) <> 'object' then
        raise exception 'Debt payment plan is invalid';
      end if;
      if jsonb_typeof(p_debt_plan -> 'allocations') is distinct from 'array' then
        raise exception 'Debt payment plan is invalid';
      end if;
      if jsonb_array_length(p_debt_plan -> 'allocations') = 0 then
        raise exception 'Debt payment plan is invalid';
      end if;
      if nullif(p_debt_plan ->> 'paymentDate', '')::date is distinct from p_completed_date then
        raise exception 'Debt payment date must match the completion date';
      end if;
      if abs(coalesce((p_debt_plan ->> 'selectedExtra')::numeric, 0)
          - round(p_actual_amount, 2)) >= 0.005 then
        raise exception 'Debt allocations must equal the completed amount';
      end if;
      v_payment_id := 'decision-' || md5(v_decision.id || ':debt-payment');
      v_payment_id := public.apply_debt_snowball_payment(
        v_payment_id,
        extract(month from (p_debt_plan ->> 'paymentDate')::date)::integer - 1,
        extract(year from (p_debt_plan ->> 'paymentDate')::date)::integer,
        round(p_actual_amount, 2),
        (p_debt_plan ->> 'paymentDate')::date,
        p_debt_plan -> 'allocations',
        jsonb_build_array(jsonb_build_object(
          'type', 'manual', 'amount', round(p_actual_amount, 2)
        )),
        v_decision.household_id,
        false
      );
      v_applied := jsonb_build_object('kind', 'debt', 'paymentId', v_payment_id);
    else
      v_transaction_id := 'decision-' || md5(v_decision.id || ':transaction');
      insert into public.transactions (
        id, user_id, household_id, budget_id, date, amount, category, note,
        account_id, source, linked_plan_id, linked_plan_type
      ) values (
        v_transaction_id, v_actor, v_decision.household_id, v_decision.budget_id,
        p_completed_date::text, -round(p_actual_amount, 2), 'Debt', v_name,
        p_account_id, 'manual', v_decision.id, 'decision'
      );
      v_applied := jsonb_build_object('kind', 'transaction', 'id', v_transaction_id);
    end if;
  elsif v_kind = 'payment_date_change' then
    v_applied := jsonb_build_object(
      'kind', 'payment_date_change',
      'sourceId', v_source_id,
      'oldDate', v_decision.scenario ->> 'oldDate',
      'newDate', v_decision.scenario ->> 'date'
    );
  else
    raise exception 'Unsupported decision type';
  end if;

  v_applied := v_applied || jsonb_build_object(
    'requestFingerprint', v_request_fingerprint,
    'completedDate', p_completed_date,
    'accountId', p_account_id
  );

  update public.decisions set
    status = 'completed',
    actual_amount = round(p_actual_amount, 2),
    completed_at = v_now,
    applied_change = v_applied,
    remind_at = null,
    updated_at = v_now
  where id = v_decision.id;

  return jsonb_build_object(
    'decision_id', v_decision.id,
    'applied_change', v_applied,
    'retry', false
  );
end;
$$;

revoke all on function private.complete_decision(text, numeric, date, text, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function private.complete_decision(text, numeric, date, text, jsonb)
  to authenticated;

create or replace function public.complete_decision(
  p_decision_id text,
  p_actual_amount numeric,
  p_completed_date date,
  p_account_id text default null,
  p_debt_plan jsonb default null
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.complete_decision(
    p_decision_id, p_actual_amount, p_completed_date,
    p_account_id, p_debt_plan
  )
$$;

revoke all on function public.complete_decision(text, numeric, date, text, jsonb)
  from public, anon, service_role;
grant execute on function public.complete_decision(text, numeric, date, text, jsonb)
  to authenticated;

comment on table public.subscription_candidates is
  'Household-scoped detected subscription patterns and explicit review decisions.';
comment on function public.fund_goal(text, text, numeric, date, numeric, text) is
  'Atomically records one idempotent savings contribution and advances its goal.';
comment on function public.create_subscription_bill(
  uuid, text, uuid, text, text, numeric, numeric, numeric, text,
  text[], numeric, date, integer, text
) is 'Atomically creates one recurring bill and closes its detected subscription candidate.';
comment on function public.create_bill_and_reconcile_transaction(text, jsonb) is
  'Atomically creates a forgotten bill and reconciles its posted bank transaction.';
comment on function public.complete_decision(text, numeric, date, text, jsonb) is
  'Atomically completes a planned decision and persists its financial side effect.';

-- Fail the migration if the intended Data API role boundary drifts. The
-- authenticated role can reach only the exposed wrappers/table policies;
-- anonymous callers cannot execute or read any of these contracts.
do $acl_audit$
declare
  v_signature text;
begin
  if has_table_privilege('anon', 'public.subscription_candidates', 'select')
    or has_table_privilege('anon', 'public.subscription_candidates', 'insert')
    or not has_table_privilege('authenticated', 'public.subscription_candidates', 'select')
    or not has_table_privilege('authenticated', 'public.subscription_candidates', 'insert') then
    raise exception 'subscription_candidates role grants are invalid';
  end if;
  if not (
    select relrowsecurity from pg_catalog.pg_class
    where oid = 'public.subscription_candidates'::regclass
  ) then
    raise exception 'subscription_candidates RLS must be enabled';
  end if;

  if has_function_privilege(
      'anon', 'public.fund_goal(text,text,numeric,date,numeric,text)', 'execute'
    ) or not has_function_privilege(
      'authenticated', 'public.fund_goal(text,text,numeric,date,numeric,text)', 'execute'
    ) or has_function_privilege(
      'anon', 'public.create_subscription_bill(uuid,text,uuid,text,text,numeric,numeric,numeric,text,text[],numeric,date,integer,text)', 'execute'
    ) or not has_function_privilege(
      'authenticated', 'public.create_subscription_bill(uuid,text,uuid,text,text,numeric,numeric,numeric,text,text[],numeric,date,integer,text)', 'execute'
    ) or has_function_privilege(
      'anon', 'public.create_bill_and_reconcile_transaction(text,jsonb)', 'execute'
    ) or not has_function_privilege(
      'authenticated', 'public.create_bill_and_reconcile_transaction(text,jsonb)', 'execute'
    ) or has_function_privilege(
      'anon', 'public.complete_decision(text,numeric,date,text,jsonb)', 'execute'
    ) or not has_function_privilege(
      'authenticated', 'public.complete_decision(text,numeric,date,text,jsonb)', 'execute'
    ) then
    raise exception 'Atomic financial RPC role grants are invalid';
  end if;

  for v_signature in select unnest(array[
    'public.fund_goal(text,text,numeric,date,numeric,text)',
    'public.create_subscription_bill(uuid,text,uuid,text,text,numeric,numeric,numeric,text,text[],numeric,date,integer,text)',
    'public.create_bill_and_reconcile_transaction(text,jsonb)',
    'public.complete_decision(text,numeric,date,text,jsonb)'
  ]::text[])
  loop
    if has_function_privilege('service_role', v_signature, 'execute') then
      raise exception 'Service role must not invoke user-attributed RPC: %', v_signature;
    end if;
  end loop;

  if has_function_privilege(
      'authenticated', 'private.inspect_account_deletion(uuid)', 'execute'
    ) or not has_function_privilege(
      'service_role', 'private.inspect_account_deletion(uuid)', 'execute'
    ) then
    raise exception 'Account deletion inspection role grants are invalid';
  end if;
end
$acl_audit$;

notify pgrst, 'reload schema';
