-- Cover the composite ownership foreign keys introduced by the shared-plan
-- retention migration. These indexes protect member removal, household
-- deletion, and account-deletion checks from full-table scans as plans grow.

create index if not exists account_balances_household_member_fk_idx
  on public.account_balances (household_id, user_id);
create index if not exists accounts_household_member_fk_idx
  on public.accounts (household_id, user_id);
create index if not exists bill_date_moves_household_member_fk_idx
  on public.bill_date_moves (household_id, user_id);
create index if not exists bill_transaction_matches_household_member_fk_idx
  on public.bill_transaction_matches (household_id, user_id);
create index if not exists bills_household_member_fk_idx
  on public.bills (household_id, user_id);
create index if not exists categories_household_member_fk_idx
  on public.categories (household_id, user_id);
create index if not exists category_budgets_household_member_fk_idx
  on public.category_budgets (household_id, user_id);
create index if not exists decisions_household_member_fk_idx
  on public.decisions (household_id, user_id);
create index if not exists extra_payments_household_member_fk_idx
  on public.extra_payments (household_id, user_id);
create index if not exists goals_household_member_fk_idx
  on public.goals (household_id, user_id);
create index if not exists incomes_household_member_fk_idx
  on public.incomes (household_id, user_id);
create index if not exists monthly_overrides_household_member_fk_idx
  on public.monthly_overrides (household_id, user_id);
create index if not exists plaid_items_household_member_fk_idx
  on public.plaid_items (household_id, user_id);
create index if not exists subscription_bill_links_household_member_fk_idx
  on public.subscription_bill_links (household_id, user_id);
create index if not exists transaction_reconciliations_household_member_fk_idx
  on public.transaction_reconciliations (household_id, user_id);
create index if not exists transactions_household_member_fk_idx
  on public.transactions (household_id, user_id);

-- These two Pro-only references were the remaining single-column FK notices.
-- The table is currently empty, so adding them now is inexpensive and keeps
-- future creator/updater checks bounded.
create index if not exists plan_simulations_created_by_idx
  on public.plan_simulations (created_by);
create index if not exists plan_simulations_updated_by_idx
  on public.plan_simulations (updated_by);
