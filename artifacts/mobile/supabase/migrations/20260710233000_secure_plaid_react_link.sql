-- Secure Plaid React Link integration hardening.
-- This migration keeps the earlier Plaid data model compatible while adding
-- the canonical columns used by the Vercel server routes. It also removes
-- normal client write access to Plaid token tables; token storage must happen
-- server-side through the Supabase service-role key.

alter table public.plaid_items add column if not exists plaid_item_id text;
alter table public.plaid_items add column if not exists encrypted_access_token text;
alter table public.plaid_items add column if not exists transactions_cursor text;
alter table public.plaid_items add column if not exists consent_expiration_time timestamptz;
alter table public.plaid_items add column if not exists last_successful_sync_at timestamptz;
alter table public.plaid_items add column if not exists last_attempted_sync_at timestamptz;
alter table public.plaid_items add column if not exists error_code text;
alter table public.plaid_items add column if not exists error_message text;

update public.plaid_items
set
  plaid_item_id = coalesce(plaid_item_id, item_id),
  encrypted_access_token = coalesce(encrypted_access_token, access_token_ciphertext),
  transactions_cursor = coalesce(transactions_cursor, cursor),
  last_successful_sync_at = coalesce(last_successful_sync_at, last_synced_at)
where plaid_item_id is null
   or encrypted_access_token is null
   or transactions_cursor is null
   or last_successful_sync_at is null;

create unique index if not exists plaid_items_plaid_item_id_uidx
  on public.plaid_items (plaid_item_id)
  where plaid_item_id is not null;

create index if not exists plaid_items_user_idx
  on public.plaid_items (user_id);

create index if not exists plaid_items_status_idx
  on public.plaid_items (status);

alter table public.plaid_accounts add column if not exists plaid_item_record_id uuid;
alter table public.plaid_accounts add column if not exists persistent_account_id text;
alter table public.plaid_accounts add column if not exists official_name text;
alter table public.plaid_accounts add column if not exists account_type text;
alter table public.plaid_accounts add column if not exists account_subtype text;
alter table public.plaid_accounts add column if not exists credit_limit numeric;
alter table public.plaid_accounts add column if not exists currency_code text;
alter table public.plaid_accounts add column if not exists is_active boolean not null default true;

update public.plaid_accounts
set
  plaid_item_record_id = coalesce(plaid_item_record_id, plaid_item_id),
  account_type = coalesce(account_type, type),
  account_subtype = coalesce(account_subtype, subtype)
where plaid_item_record_id is null
   or account_type is null
   or account_subtype is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'plaid_accounts_plaid_item_record_id_fkey'
      and conrelid = 'public.plaid_accounts'::regclass
  ) then
    alter table public.plaid_accounts
      add constraint plaid_accounts_plaid_item_record_id_fkey
      foreign key (plaid_item_record_id)
      references public.plaid_items(id)
      on delete cascade;
  end if;
end $$;

create unique index if not exists plaid_accounts_plaid_account_id_uidx
  on public.plaid_accounts (plaid_account_id)
  where plaid_account_id is not null;

create index if not exists plaid_accounts_user_idx
  on public.plaid_accounts (user_id);

create index if not exists plaid_accounts_item_record_idx
  on public.plaid_accounts (plaid_item_record_id);

alter table public.plaid_transactions add column if not exists flowledger_transaction_id text references public.transactions(id) on delete set null;
alter table public.plaid_transactions add column if not exists authorized_date date;
alter table public.plaid_transactions add column if not exists merchant_name text;
alter table public.plaid_transactions add column if not exists original_name text;
alter table public.plaid_transactions add column if not exists payment_channel text;
alter table public.plaid_transactions add column if not exists iso_currency_code text;
alter table public.plaid_transactions add column if not exists removed_at timestamptz;

create index if not exists plaid_transactions_account_idx
  on public.plaid_transactions (plaid_account_id);

create index if not exists plaid_transactions_user_date_idx
  on public.plaid_transactions (user_id, transaction_date desc);

alter table public.transactions add column if not exists source text;
alter table public.transactions add column if not exists plaid_transaction_id text;
alter table public.transactions add column if not exists plaid_account_id text;
alter table public.transactions add column if not exists authorized_date date;
alter table public.transactions add column if not exists merchant_name text;
alter table public.transactions add column if not exists original_name text;
alter table public.transactions add column if not exists pending boolean not null default false;
alter table public.transactions add column if not exists payment_channel text;
alter table public.transactions add column if not exists plaid_category_primary text;
alter table public.transactions add column if not exists plaid_category_detailed text;
alter table public.transactions add column if not exists iso_currency_code text;
alter table public.transactions add column if not exists match_confidence numeric;
alter table public.transactions add column if not exists match_reason text;
alter table public.transactions add column if not exists removed_at timestamptz;

create unique index if not exists transactions_plaid_transaction_id_uidx
  on public.transactions (plaid_transaction_id)
  where plaid_transaction_id is not null;

create index if not exists transactions_user_source_date_idx
  on public.transactions (user_id, source, date desc);

alter table public.plaid_items enable row level security;
alter table public.plaid_accounts enable row level security;
alter table public.plaid_transactions enable row level security;

drop policy if exists "plaid items: members read" on public.plaid_items;
drop policy if exists "plaid items: editors write" on public.plaid_items;
drop policy if exists "plaid items: household members read" on public.plaid_items;
drop policy if exists "plaid items: household editors write" on public.plaid_items;
create policy "plaid items: members read" on public.plaid_items
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or (household_id is not null and public.is_household_member(household_id))
  );

drop policy if exists "plaid accounts: members read" on public.plaid_accounts;
drop policy if exists "plaid accounts: editors write" on public.plaid_accounts;
drop policy if exists "plaid accounts: household members read" on public.plaid_accounts;
drop policy if exists "plaid accounts: household editors write" on public.plaid_accounts;
create policy "plaid accounts: members read" on public.plaid_accounts
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or (household_id is not null and public.is_household_member(household_id))
  );

drop policy if exists "plaid transactions: members read" on public.plaid_transactions;
drop policy if exists "plaid transactions: editors write" on public.plaid_transactions;
drop policy if exists "plaid transactions: household members read" on public.plaid_transactions;
drop policy if exists "plaid transactions: household editors write" on public.plaid_transactions;
create policy "plaid transactions: members read" on public.plaid_transactions
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or (household_id is not null and public.is_household_member(household_id))
  );

revoke all on table public.plaid_items from anon, authenticated;
revoke all on table public.plaid_accounts from anon, authenticated;
revoke all on table public.plaid_transactions from anon, authenticated;

grant select (
  id,
  user_id,
  household_id,
  plaid_item_id,
  item_id,
  institution_id,
  institution_name,
  status,
  transactions_cursor,
  consent_expiration_time,
  last_successful_sync_at,
  last_attempted_sync_at,
  error_code,
  error_message,
  created_at,
  updated_at
) on public.plaid_items to authenticated;

grant select on public.plaid_accounts to authenticated;
grant select on public.plaid_transactions to authenticated;
