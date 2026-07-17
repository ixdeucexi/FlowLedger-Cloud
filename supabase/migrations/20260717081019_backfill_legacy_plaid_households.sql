with single_household_users as (
  select user_id, min(household_id::text)::uuid as household_id
  from public.household_members
  group by user_id
  having count(distinct household_id) = 1
)
update public.plaid_items as item
set household_id = candidate.household_id,
    updated_at = now()
from single_household_users as candidate
where item.user_id = candidate.user_id
  and item.household_id is null;

update public.plaid_accounts as account
set household_id = item.household_id,
    updated_at = now()
from public.plaid_items as item
where account.plaid_item_record_id = item.id
  and account.user_id = item.user_id
  and account.household_id is null
  and item.household_id is not null;

update public.transactions as txn
set household_id = account.household_id
from public.plaid_accounts as account
where txn.plaid_account_id = account.plaid_account_id
  and txn.user_id = account.user_id
  and txn.household_id is null
  and account.household_id is not null;
