-- Reversible bill-to-transaction matching.
-- A match turns an imported bank transaction into the actual occurrence of a
-- planned bill. The original override values are retained so an incorrect
-- match can be undone without losing the user's prior bill state.

alter table public.transactions add column if not exists source text;
alter table public.transactions add column if not exists match_confidence numeric;
alter table public.transactions add column if not exists match_reason text;
alter table public.transactions add column if not exists removed_at timestamptz;

create table if not exists public.bill_transaction_matches (
  transaction_id text primary key references public.transactions(id) on delete cascade,
  bill_id text not null references public.bills(id) on delete cascade,
  override_id text not null references public.monthly_overrides(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  household_id uuid references public.households(id) on delete cascade,
  budget_id uuid references public.budgets(id) on delete set null,
  match_month integer not null check (match_month between 0 and 11),
  match_year integer not null,
  transaction_date date not null,
  matched_amount numeric not null check (matched_amount > 0),
  baseline_paid_amount numeric not null default 0,
  baseline_actual_amount numeric,
  baseline_paid_date date,
  previous_category text not null default 'Other',
  previous_linked_bill_id text,
  previous_match_confidence numeric,
  previous_match_reason text,
  created_at timestamptz not null default now()
);

create index if not exists bill_transaction_matches_bill_month_idx
  on public.bill_transaction_matches (bill_id, match_year, match_month);
create index if not exists bill_transaction_matches_user_idx
  on public.bill_transaction_matches (user_id);
create index if not exists bill_transaction_matches_household_idx
  on public.bill_transaction_matches (household_id)
  where household_id is not null;

alter table public.bill_transaction_matches enable row level security;

drop policy if exists "bill matches: members read" on public.bill_transaction_matches;
create policy "bill matches: members read"
on public.bill_transaction_matches
for select
to authenticated
using (
  (household_id is null and (select auth.uid()) = user_id)
  or (household_id is not null and public.is_household_member(household_id))
);

drop policy if exists "bill matches: editors write" on public.bill_transaction_matches;
create policy "bill matches: editors write"
on public.bill_transaction_matches
for all
to authenticated
using (
  (household_id is null and (select auth.uid()) = user_id)
  or (household_id is not null and public.is_household_editor(household_id))
)
with check (
  (household_id is null and (select auth.uid()) = user_id)
  or (household_id is not null and public.is_household_editor(household_id))
);

grant select, insert, update, delete on public.bill_transaction_matches to authenticated;

create or replace function public.match_transaction_to_bill(
  p_transaction_id text,
  p_bill_id text
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_tx public.transactions%rowtype;
  v_bill public.bills%rowtype;
  v_override public.monthly_overrides%rowtype;
  v_existing_match public.bill_transaction_matches%rowtype;
  v_month integer;
  v_year integer;
  v_amount numeric;
  v_total numeric;
  v_latest_date date;
  v_has_group boolean := false;
begin
  select * into v_tx
  from public.transactions
  where id = p_transaction_id
    and removed_at is null;

  if not found then
    raise exception 'Transaction was not found';
  end if;
  if v_tx.amount >= 0 then
    raise exception 'Only money-out transactions can be matched to a bill';
  end if;

  select * into v_bill
  from public.bills
  where id = p_bill_id;

  if not found then
    raise exception 'Bill was not found';
  end if;
  if v_tx.household_id is distinct from v_bill.household_id
     or v_tx.budget_id is distinct from v_bill.budget_id then
    raise exception 'The transaction and bill must belong to the same FlowLedger plan';
  end if;
  if current_user <> 'service_role' and v_tx.household_id is null and (select auth.uid()) is distinct from v_tx.user_id then
    raise exception 'You cannot edit this personal transaction';
  end if;
  if current_user <> 'service_role' and v_tx.household_id is not null and not public.is_household_editor(v_tx.household_id) then
    raise exception 'You need edit access to match this household transaction';
  end if;

  select * into v_existing_match
  from public.bill_transaction_matches
  where transaction_id = p_transaction_id;

  if found then
    if v_existing_match.bill_id = p_bill_id then
      return jsonb_build_object(
        'transaction_id', p_transaction_id,
        'bill_id', p_bill_id,
        'already_matched', true
      );
    end if;
    raise exception 'Unmatch this transaction before choosing a different bill';
  end if;

  v_month := extract(month from v_tx.date::date)::integer - 1;
  v_year := extract(year from v_tx.date::date)::integer;
  v_amount := abs(v_tx.amount);

  select * into v_override
  from public.monthly_overrides
  where bill_id = p_bill_id
    and month = v_month
    and year = v_year
    and household_id is not distinct from v_bill.household_id
  order by id
  limit 1;

  if not found then
    insert into public.monthly_overrides (
      id, user_id, household_id, budget_id, bill_id, month, year,
      paid_amount, actual_amount, paid_date
    ) values (
      gen_random_uuid()::text,
      v_tx.user_id,
      v_bill.household_id,
      v_bill.budget_id,
      p_bill_id,
      v_month,
      v_year,
      0,
      null,
      null
    )
    returning * into v_override;
  end if;

  select * into v_existing_match
  from public.bill_transaction_matches
  where bill_id = p_bill_id
    and match_month = v_month
    and match_year = v_year
  order by created_at, transaction_id
  limit 1;
  v_has_group := found;

  insert into public.bill_transaction_matches (
    transaction_id,
    bill_id,
    override_id,
    user_id,
    household_id,
    budget_id,
    match_month,
    match_year,
    transaction_date,
    matched_amount,
    baseline_paid_amount,
    baseline_actual_amount,
    baseline_paid_date,
    previous_category,
    previous_linked_bill_id,
    previous_match_confidence,
    previous_match_reason
  ) values (
    p_transaction_id,
    p_bill_id,
    v_override.id,
    v_tx.user_id,
    v_bill.household_id,
    v_bill.budget_id,
    v_month,
    v_year,
    v_tx.date::date,
    v_amount,
    case when v_has_group then v_existing_match.baseline_paid_amount else coalesce(v_override.paid_amount, 0) end,
    case when v_has_group then v_existing_match.baseline_actual_amount else v_override.actual_amount end,
    case when v_has_group then v_existing_match.baseline_paid_date else v_override.paid_date end,
    v_tx.category,
    v_tx.linked_bill_id,
    v_tx.match_confidence,
    v_tx.match_reason
  );

  select coalesce(sum(matched_amount), 0), max(transaction_date)
  into v_total, v_latest_date
  from public.bill_transaction_matches
  where bill_id = p_bill_id
    and match_month = v_month
    and match_year = v_year;

  update public.monthly_overrides
  set paid_amount = v_total,
      actual_amount = v_total,
      paid_date = v_latest_date
  where id = v_override.id;

  update public.transactions
  set linked_bill_id = p_bill_id,
      category = v_bill.category,
      match_confidence = 1,
      match_reason = 'confirmed_bill_match'
  where id = p_transaction_id;

  return jsonb_build_object(
    'transaction_id', p_transaction_id,
    'bill_id', p_bill_id,
    'override_id', v_override.id,
    'paid_amount', v_total,
    'paid_date', v_latest_date
  );
end;
$$;

create or replace function public.unmatch_transaction_from_bill(
  p_transaction_id text
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_match public.bill_transaction_matches%rowtype;
  v_total numeric;
  v_latest_date date;
  v_remaining integer;
begin
  select * into v_match
  from public.bill_transaction_matches
  where transaction_id = p_transaction_id;

  if not found then
    raise exception 'This transaction is not matched to a bill';
  end if;
  if current_user <> 'service_role' and v_match.household_id is null and (select auth.uid()) is distinct from v_match.user_id then
    raise exception 'You cannot edit this personal transaction';
  end if;
  if current_user <> 'service_role' and v_match.household_id is not null and not public.is_household_editor(v_match.household_id) then
    raise exception 'You need edit access to unmatch this household transaction';
  end if;

  delete from public.bill_transaction_matches
  where transaction_id = p_transaction_id;

  select count(*), coalesce(sum(matched_amount), 0), max(transaction_date)
  into v_remaining, v_total, v_latest_date
  from public.bill_transaction_matches
  where bill_id = v_match.bill_id
    and match_month = v_match.match_month
    and match_year = v_match.match_year;

  if v_remaining > 0 then
    update public.monthly_overrides
    set paid_amount = v_total,
        actual_amount = v_total,
        paid_date = v_latest_date
    where id = v_match.override_id;
  else
    update public.monthly_overrides
    set paid_amount = v_match.baseline_paid_amount,
        actual_amount = v_match.baseline_actual_amount,
        paid_date = v_match.baseline_paid_date
    where id = v_match.override_id;
  end if;

  update public.transactions
  set linked_bill_id = v_match.previous_linked_bill_id,
      category = v_match.previous_category,
      match_confidence = v_match.previous_match_confidence,
      match_reason = v_match.previous_match_reason
  where id = p_transaction_id;

  return jsonb_build_object(
    'transaction_id', p_transaction_id,
    'bill_id', v_match.bill_id,
    'remaining_matches', v_remaining,
    'paid_amount', case when v_remaining > 0 then v_total else v_match.baseline_paid_amount end
  );
end;
$$;

revoke execute on function public.match_transaction_to_bill(text, text) from public, anon;
revoke execute on function public.unmatch_transaction_from_bill(text) from public, anon;
grant execute on function public.match_transaction_to_bill(text, text) to authenticated;
grant execute on function public.unmatch_transaction_from_bill(text) to authenticated;
grant execute on function public.match_transaction_to_bill(text, text) to service_role;
grant execute on function public.unmatch_transaction_from_bill(text) to service_role;
