-- Dated debt transactions and visible snowball minimum rollover.
alter table bills add column if not exists snowball_minimum_boost numeric not null default 0;

alter table transactions add column if not exists debt_applied_amount numeric not null default 0;
alter table transactions add column if not exists debt_applied_bill_id text references bills(id) on delete set null;

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

drop function if exists sync_due_debt_transactions();
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

create or replace function restore_debt_transaction_before_delete()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if old.debt_applied_bill_id is not null and old.debt_applied_amount > 0 then
    update bills set balance = balance + old.debt_applied_amount
    where id = old.debt_applied_bill_id and user_id = old.user_id and is_debt;
    perform recalculate_debt_minimum_boosts();
  end if;
  return old;
end;
$$;

drop trigger if exists restore_debt_transaction_on_delete on transactions;
create trigger restore_debt_transaction_on_delete
before delete on transactions
for each row execute function restore_debt_transaction_before_delete();
