-- Keep connected credit-card liabilities in the same debt plan used by the
-- mobile PWA and desktop dashboard. Plaid remains the source for live card
-- balances while user-owned snowball preferences stay on public.bills.

alter table public.plaid_accounts
  add column if not exists minimum_payment_amount numeric,
  add column if not exists next_payment_due_date date,
  add column if not exists last_statement_balance numeric,
  add column if not exists last_statement_issue_date date,
  add column if not exists is_overdue boolean,
  add column if not exists purchase_apr numeric,
  add column if not exists liability_last_synced_at timestamptz;

alter table public.bills
  add column if not exists plaid_account_record_id uuid references public.plaid_accounts(id) on delete set null,
  add column if not exists plaid_account_id text,
  add column if not exists plaid_persistent_account_id text,
  add column if not exists plaid_last_synced_at timestamptz;

create unique index if not exists bills_household_plaid_account_uidx
  on public.bills (household_id, plaid_account_id)
  where plaid_account_id is not null;

create unique index if not exists bills_household_plaid_persistent_account_uidx
  on public.bills (household_id, plaid_persistent_account_id)
  where plaid_persistent_account_id is not null;

create index if not exists bills_plaid_account_record_idx
  on public.bills (plaid_account_record_id)
  where plaid_account_record_id is not null;

-- The tables already have RLS policies. Restate the minimum grants explicitly
-- because new columns are not auto-exposed by current Supabase projects.
grant select on public.plaid_accounts to authenticated;
grant select, insert, update, delete on public.bills to authenticated;
grant all on public.plaid_accounts, public.bills to service_role;

notify pgrst, 'reload schema';
