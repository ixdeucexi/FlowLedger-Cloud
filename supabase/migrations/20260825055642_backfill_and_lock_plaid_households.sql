-- Legacy raw Plaid rows predate household attribution. Every production row
-- has an exact same-user account link, so backfill only from that canonical
-- relationship. Never guess from a user's currently selected household.
update public.plaid_transactions as plaid_transaction
set household_id = plaid_account.household_id,
    updated_at = now()
from public.plaid_accounts as plaid_account
where plaid_transaction.household_id is null
  and plaid_transaction.plaid_account_id = plaid_account.id
  and plaid_transaction.user_id = plaid_account.user_id
  and plaid_account.household_id is not null;

do $$
begin
  if exists (select 1 from public.plaid_items where household_id is null) then
    raise exception 'plaid_items contains rows without a household';
  end if;
  if exists (
    select 1
    from public.plaid_accounts as plaid_account
    left join public.plaid_items as plaid_item
      on plaid_item.id = plaid_account.plaid_item_record_id
     and plaid_item.user_id = plaid_account.user_id
     and plaid_item.household_id = plaid_account.household_id
    where plaid_account.household_id is null
       or plaid_account.plaid_item_record_id is null
       or plaid_item.id is null
  ) then
    raise exception 'plaid_accounts contains an unscoped or mismatched item link';
  end if;
  if exists (
    select 1
    from public.plaid_transactions as plaid_transaction
    left join public.plaid_accounts as plaid_account
      on plaid_account.id = plaid_transaction.plaid_account_id
     and plaid_account.user_id = plaid_transaction.user_id
     and plaid_account.household_id = plaid_transaction.household_id
    left join public.transactions as flowledger_transaction
      on flowledger_transaction.id = plaid_transaction.flowledger_transaction_id
     and flowledger_transaction.user_id = plaid_transaction.user_id
     and flowledger_transaction.household_id = plaid_transaction.household_id
    where plaid_transaction.household_id is null
       or plaid_transaction.plaid_account_id is null
       or plaid_account.id is null
       or (
         plaid_transaction.flowledger_transaction_id is not null
         and flowledger_transaction.id is null
       )
  ) then
    raise exception 'plaid_transactions contains an unscoped or mismatched account/transaction link';
  end if;
end;
$$;

alter table public.plaid_items
  alter column household_id set not null;

alter table public.plaid_accounts
  alter column household_id set not null,
  alter column plaid_item_record_id set not null;

alter table public.plaid_transactions
  alter column household_id set not null,
  alter column plaid_account_id set not null;

create or replace function private.enforce_plaid_item_household_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (
    new.user_id is distinct from old.user_id
    or new.household_id is distinct from old.household_id
  ) then
    raise exception using errcode = '23514', message = 'plaid_item_household_scope_immutable';
  end if;
  return new;
end;
$$;

create or replace function private.enforce_plaid_account_household_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (
    new.user_id is distinct from old.user_id
    or new.household_id is distinct from old.household_id
  ) then
    raise exception using errcode = '23514', message = 'plaid_account_household_scope_immutable';
  end if;
  if not exists (
    select 1 from public.plaid_items as plaid_item
    where plaid_item.id = new.plaid_item_record_id
      and plaid_item.user_id = new.user_id
      and plaid_item.household_id = new.household_id
  ) then
    raise exception using errcode = '23514', message = 'plaid_account_item_scope_mismatch';
  end if;
  return new;
end;
$$;

create or replace function private.enforce_plaid_transaction_household_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (
    new.user_id is distinct from old.user_id
    or new.household_id is distinct from old.household_id
  ) then
    raise exception using errcode = '23514', message = 'plaid_transaction_household_scope_immutable';
  end if;
  if not exists (
    select 1 from public.plaid_accounts as plaid_account
    where plaid_account.id = new.plaid_account_id
      and plaid_account.user_id = new.user_id
      and plaid_account.household_id = new.household_id
  ) then
    raise exception using errcode = '23514', message = 'plaid_transaction_account_scope_mismatch';
  end if;
  if new.flowledger_transaction_id is not null and not exists (
    select 1 from public.transactions as flowledger_transaction
    where flowledger_transaction.id = new.flowledger_transaction_id
      and flowledger_transaction.user_id = new.user_id
      and flowledger_transaction.household_id = new.household_id
  ) then
    raise exception using errcode = '23514', message = 'plaid_transaction_canonical_scope_mismatch';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_plaid_item_household_scope on public.plaid_items;
create trigger enforce_plaid_item_household_scope
before update on public.plaid_items
for each row execute function private.enforce_plaid_item_household_scope();

drop trigger if exists enforce_plaid_account_household_scope on public.plaid_accounts;
create trigger enforce_plaid_account_household_scope
before insert or update on public.plaid_accounts
for each row execute function private.enforce_plaid_account_household_scope();

drop trigger if exists enforce_plaid_transaction_household_scope on public.plaid_transactions;
create trigger enforce_plaid_transaction_household_scope
before insert or update on public.plaid_transactions
for each row execute function private.enforce_plaid_transaction_household_scope();

revoke all on function private.enforce_plaid_item_household_scope() from public, anon, authenticated;
revoke all on function private.enforce_plaid_account_household_scope() from public, anon, authenticated;
revoke all on function private.enforce_plaid_transaction_household_scope() from public, anon, authenticated;

-- Plaid data belongs to the household plan. A creator who later leaves that
-- household must not retain a Data API read path through user_id ownership.
drop policy if exists "plaid items: members read" on public.plaid_items;
create policy "plaid items: members read" on public.plaid_items
for select to authenticated
using ((select private.is_household_member(household_id)));

drop policy if exists "plaid accounts: members read" on public.plaid_accounts;
create policy "plaid accounts: members read" on public.plaid_accounts
for select to authenticated
using ((select private.is_household_member(household_id)));

drop policy if exists "plaid transactions: members read" on public.plaid_transactions;
create policy "plaid transactions: members read" on public.plaid_transactions
for select to authenticated
using ((select private.is_household_member(household_id)));

;
