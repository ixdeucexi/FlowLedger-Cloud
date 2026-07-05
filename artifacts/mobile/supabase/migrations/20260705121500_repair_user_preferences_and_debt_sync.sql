-- Repair remote preference storage and scheduled debt sync.
-- This migration is additive and safe to run on projects that already have these objects.

create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  decision_hub_settings jsonb not null default '{}'::jsonb,
  onboarding_preferences jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_preferences
  add column if not exists decision_hub_settings jsonb not null default '{}'::jsonb,
  add column if not exists onboarding_preferences jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

alter table public.user_preferences enable row level security;

drop policy if exists "Users can read their own preferences" on public.user_preferences;
create policy "Users can read their own preferences"
on public.user_preferences for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert their own preferences" on public.user_preferences;
create policy "Users can insert their own preferences"
on public.user_preferences for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update their own preferences" on public.user_preferences;
create policy "Users can update their own preferences"
on public.user_preferences for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create or replace function recalculate_debt_minimum_boosts()
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_method text;
  v_freed_minimum numeric := 0;
  v_target_id text;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;

  update bills set snowball_minimum_boost = 0
  where user_id = v_user_id and is_debt;

  select coalesce(payment_method, 'snowball') into v_method
  from settings where user_id = v_user_id;

  select coalesce(sum(amount), 0) into v_freed_minimum
  from bills
  where user_id = v_user_id and is_debt and include_in_snowball is not false and balance <= 0.009;

  select id into v_target_id
  from bills
  where user_id = v_user_id and is_debt and include_in_snowball is not false and balance > 0.009
  order by
    case when v_method = 'avalanche' then interest_rate end desc nulls last,
    balance asc,
    id asc
  limit 1;

  if v_target_id is not null and v_freed_minimum > 0 then
    update bills set snowball_minimum_boost = v_freed_minimum
    where id = v_target_id and user_id = v_user_id;
  end if;
end;
$$;

create or replace function sync_due_debt_transactions(p_as_of_date date)
returns void
language plpgsql
security invoker
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

  for v_tx in
    select * from transactions
    where user_id = v_user_id
      and (linked_bill_id is not null or debt_applied_bill_id is not null or debt_applied_amount > 0)
    for update
  loop
    if v_tx.debt_applied_bill_id is not null
       and v_tx.debt_applied_bill_id is distinct from v_tx.linked_bill_id
       and v_tx.debt_applied_amount > 0 then
      update bills set balance = balance + v_tx.debt_applied_amount
      where id = v_tx.debt_applied_bill_id and user_id = v_user_id and is_debt;
      v_tx.debt_applied_amount := 0;
      v_tx.debt_applied_bill_id := null;
    end if;

    v_desired := case
      when v_tx.linked_bill_id is not null and v_tx.amount < 0 and v_tx.date <= p_as_of_date
        then abs(v_tx.amount)
      else 0
    end;
    v_current := case when v_tx.debt_applied_bill_id = v_tx.linked_bill_id then coalesce(v_tx.debt_applied_amount, 0) else 0 end;

    if v_tx.linked_bill_id is not null and v_desired > 0 then
      select balance into v_balance from bills
      where id = v_tx.linked_bill_id and user_id = v_user_id and is_debt
      for update;
      if v_balance is null then raise exception 'Debt % was not found', v_tx.linked_bill_id; end if;
      v_desired := least(v_desired, v_balance + v_current);
    end if;

    if v_tx.linked_bill_id is not null and abs(v_desired - v_current) >= 0.005 then
      update bills
      set balance = greatest(0, balance - (v_desired - v_current))
      where id = v_tx.linked_bill_id and user_id = v_user_id and is_debt;
      if not found then raise exception 'Debt % was not found', v_tx.linked_bill_id; end if;
    end if;

    update transactions set
      debt_applied_amount = v_desired,
      debt_applied_bill_id = case when v_desired > 0 then v_tx.linked_bill_id else null end
    where id = v_tx.id and user_id = v_user_id;
  end loop;

  perform recalculate_debt_minimum_boosts();
end;
$$;
