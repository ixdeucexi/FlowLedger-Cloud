-- Create a manual Activity transaction and its provisional pending-bank link
-- in one transaction. The pending row lock and caller-supplied stable id make
-- interrupted responses and double taps retry safe without creating duplicates.

create or replace function private.create_pending_activity_transaction(
  p_pending_plaid_transaction_id text,
  p_transaction_id text,
  p_household_id uuid,
  p_budget_id uuid,
  p_amount numeric,
  p_date date,
  p_category text,
  p_note text,
  p_account_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pending public.plaid_transactions%rowtype;
  v_transaction public.transactions%rowtype;
  v_match public.pending_plan_matches%rowtype;
  v_user_id uuid := (select auth.uid());
  v_amount numeric;
  v_category text := btrim(coalesce(p_category, ''));
  v_note text := btrim(coalesce(p_note, ''));
  v_now timestamptz := now();
  v_inserted boolean := false;
begin
  if v_user_id is null then
    raise exception 'Sign in to create a transaction';
  end if;
  if p_household_id is null
    or not private.is_household_editor(p_household_id) then
    raise exception 'You need household edit access to create this transaction';
  end if;
  if not exists (
    select 1
    from public.household_plans plan
    where plan.household_id = p_household_id
      and plan.tier = 'pro'
  ) then
    raise exception 'Pending transaction planning requires the Pro plan';
  end if;
  if p_budget_id is null or not exists (
    select 1
    from public.budgets budget
    where budget.id = p_budget_id
      and budget.household_id = p_household_id
  ) then
    raise exception 'Choose a valid household budget';
  end if;
  if nullif(btrim(coalesce(p_pending_plaid_transaction_id, '')), '') is null
    or length(p_pending_plaid_transaction_id) > 240 then
    raise exception 'A valid pending charge is required';
  end if;
  if nullif(btrim(coalesce(p_transaction_id, '')), '') is null
    or length(p_transaction_id) > 128
    or p_transaction_id !~ '^[A-Za-z0-9_-]+$' then
    raise exception 'A valid transaction id is required';
  end if;
  if p_amount is null
    or lower(p_amount::text) in ('nan', 'infinity', '-infinity') then
    raise exception 'Enter a finite transaction amount';
  end if;
  v_amount := round(p_amount, 2);
  if v_amount >= 0 then
    raise exception 'Only pending money-out charges can create an expense transaction';
  end if;
  if p_date is null then raise exception 'Choose a valid transaction date'; end if;
  if v_category = '' or length(v_category) > 120 then
    raise exception 'Choose a valid transaction category';
  end if;
  if length(v_note) > 500 then
    raise exception 'Keep the transaction note to 500 characters or fewer';
  end if;
  if p_account_id is not null and not exists (
    select 1
    from public.accounts account
    where account.id = p_account_id
      and account.household_id = p_household_id
      and account.budget_id is not distinct from p_budget_id
      and account.is_active = true
  ) then
    raise exception 'Choose an active account from this household';
  end if;

  select * into v_pending
  from public.plaid_transactions pending
  where pending.household_id = p_household_id
    and pending.plaid_transaction_id = p_pending_plaid_transaction_id
    and pending.pending = true
    and pending.removed_at is null
  for update;
  if not found then
    raise exception 'This pending charge is no longer available';
  end if;
  if v_pending.amount >= 0 then
    raise exception 'Only pending money-out charges can create an expense transaction';
  end if;
  if date_trunc('month', p_date::timestamp)
    <> date_trunc('month', v_pending.transaction_date::timestamp) then
    raise exception 'The transaction date must stay in the same month as the pending charge';
  end if;

  select * into v_match
  from public.pending_plan_matches match_row
  where match_row.household_id = p_household_id
    and match_row.pending_plaid_transaction_id = p_pending_plaid_transaction_id
  for update;

  select * into v_transaction
  from public.transactions transaction_row
  where transaction_row.id = p_transaction_id
  for update;

  if found then
    if v_transaction.user_id is distinct from v_user_id
      or v_transaction.household_id is distinct from p_household_id
      or v_transaction.budget_id is distinct from p_budget_id
      or v_transaction.source is not distinct from 'plaid'
      or round(v_transaction.amount, 2) is distinct from v_amount
      or v_transaction.date::date is distinct from p_date
      or btrim(v_transaction.category) is distinct from v_category
      or btrim(coalesce(v_transaction.note, '')) is distinct from v_note
      or v_transaction.account_id is distinct from p_account_id
      or v_transaction.pending is true
      or v_transaction.removed_at is not null
      or v_transaction.deleted_at is not null then
      raise exception 'That transaction id is already in use';
    end if;
  else
    insert into public.transactions (
      id, user_id, household_id, budget_id, date, amount, category, note,
      account_id, source, pending
    ) values (
      p_transaction_id, v_user_id, p_household_id, p_budget_id, p_date::text,
      v_amount, v_category, v_note, p_account_id, null, false
    )
    returning * into v_transaction;
    v_inserted := true;
  end if;

  if v_match.id is not null
    and v_match.status in ('active', 'ready_review', 'completed')
    and (
      v_match.target_type is distinct from 'manual'
      or v_match.target_id is distinct from p_transaction_id
    ) then
    raise exception 'This pending charge is already linked to another plan item';
  end if;

  insert into public.pending_plan_matches (
    user_id, household_id, budget_id, pending_plaid_transaction_id,
    pending_account_id, target_type, target_id, target_name, occurrence_date,
    planned_amount, pending_amount, pending_transaction_date, status,
    posted_transaction_id, posted_plaid_transaction_id, posted_amount,
    created_by, updated_at
  ) values (
    v_user_id, p_household_id, p_budget_id, p_pending_plaid_transaction_id,
    v_pending.plaid_account_id::text, 'manual', p_transaction_id,
    coalesce(nullif(v_note, ''), nullif(v_category, ''), 'Manual Activity'),
    p_date, abs(v_amount), round(abs(v_pending.amount), 2),
    v_pending.transaction_date, 'active', null, null, null, v_user_id, v_now
  )
  on conflict (household_id, pending_plaid_transaction_id) do update set
    user_id = excluded.user_id,
    budget_id = excluded.budget_id,
    pending_account_id = excluded.pending_account_id,
    target_type = excluded.target_type,
    target_id = excluded.target_id,
    target_name = excluded.target_name,
    occurrence_date = excluded.occurrence_date,
    planned_amount = excluded.planned_amount,
    pending_amount = excluded.pending_amount,
    pending_transaction_date = excluded.pending_transaction_date,
    status = 'active',
    posted_transaction_id = null,
    posted_plaid_transaction_id = null,
    posted_amount = null,
    updated_at = excluded.updated_at
  returning * into v_match;

  return jsonb_build_object(
    'transaction_id', v_transaction.id,
    'transaction', to_jsonb(v_transaction),
    'pending_match', to_jsonb(v_match),
    'retry', not v_inserted
  );
end;
$$;

revoke all on function private.create_pending_activity_transaction(
  text, text, uuid, uuid, numeric, date, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function private.create_pending_activity_transaction(
  text, text, uuid, uuid, numeric, date, text, text, text
) to authenticated;

create or replace function public.create_pending_activity_transaction(
  p_pending_plaid_transaction_id text,
  p_transaction_id text,
  p_household_id uuid,
  p_budget_id uuid,
  p_amount numeric,
  p_date date,
  p_category text,
  p_note text,
  p_account_id text default null
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.create_pending_activity_transaction(
    p_pending_plaid_transaction_id,
    p_transaction_id,
    p_household_id,
    p_budget_id,
    p_amount,
    p_date,
    p_category,
    p_note,
    p_account_id
  )
$$;

revoke all on function public.create_pending_activity_transaction(
  text, text, uuid, uuid, numeric, date, text, text, text
) from public, anon, service_role;
grant execute on function public.create_pending_activity_transaction(
  text, text, uuid, uuid, numeric, date, text, text, text
) to authenticated;

comment on function public.create_pending_activity_transaction(
  text, text, uuid, uuid, numeric, date, text, text, text
) is 'Atomically creates a manual expense and links it to one pending bank charge so the posted charge can replace it later.';

do $acl_audit$
begin
  if has_function_privilege(
      'anon',
      'public.create_pending_activity_transaction(text,text,uuid,uuid,numeric,date,text,text,text)',
      'execute'
    )
    or not has_function_privilege(
      'authenticated',
      'public.create_pending_activity_transaction(text,text,uuid,uuid,numeric,date,text,text,text)',
      'execute'
    )
    or has_function_privilege(
      'service_role',
      'public.create_pending_activity_transaction(text,text,uuid,uuid,numeric,date,text,text,text)',
      'execute'
    ) then
    raise exception 'Pending transaction creation RPC role grants are invalid';
  end if;
end
$acl_audit$;

notify pgrst, 'reload schema';
