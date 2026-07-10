-- Plaid live import support.
-- FlowLedger's account and transaction IDs are text, so Plaid links use text-safe
-- FlowLedger ID columns instead of assuming UUID primary keys.

create table if not exists public.plaid_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  household_id uuid references public.households(id) on delete cascade,
  item_id text not null,
  access_token_ciphertext text,
  institution_id text,
  institution_name text,
  status text not null default 'active'
    check (status in ('active', 'needs_repair', 'removed')),
  cursor text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, item_id)
);

create table if not exists public.plaid_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  household_id uuid references public.households(id) on delete cascade,
  plaid_item_id uuid references public.plaid_items(id) on delete cascade,
  account_id text references public.accounts(id) on delete set null,
  flowledger_account_id text references public.accounts(id) on delete set null,
  plaid_account_id text not null,
  name text not null,
  mask text,
  type text,
  subtype text,
  current_balance numeric,
  available_balance numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, plaid_account_id)
);

create table if not exists public.plaid_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  household_id uuid references public.households(id) on delete cascade,
  plaid_account_id uuid references public.plaid_accounts(id) on delete cascade,
  transaction_id text references public.transactions(id) on delete set null,
  flowledger_transaction_id text references public.transactions(id) on delete set null,
  plaid_transaction_id text not null,
  transaction_date date not null,
  name text not null,
  amount numeric not null,
  category text,
  pending boolean not null default false,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, plaid_transaction_id)
);

alter table public.plaid_accounts add column if not exists flowledger_account_id text references public.accounts(id) on delete set null;
alter table public.plaid_transactions add column if not exists flowledger_transaction_id text references public.transactions(id) on delete set null;

create index if not exists plaid_items_household_idx on public.plaid_items (household_id, status);
create index if not exists plaid_accounts_item_idx on public.plaid_accounts (plaid_item_id);
create index if not exists plaid_transactions_household_idx on public.plaid_transactions (household_id, transaction_date desc);
create index if not exists plaid_transactions_flowledger_idx on public.plaid_transactions (flowledger_transaction_id);

alter table public.plaid_items enable row level security;
alter table public.plaid_accounts enable row level security;
alter table public.plaid_transactions enable row level security;

drop policy if exists "plaid items: members read" on public.plaid_items;
create policy "plaid items: members read" on public.plaid_items for select to authenticated
using (user_id = (select auth.uid()) or (household_id is not null and public.is_household_member(household_id)));

drop policy if exists "plaid items: editors write" on public.plaid_items;
create policy "plaid items: editors write" on public.plaid_items for all to authenticated
using (user_id = (select auth.uid()) or (household_id is not null and public.is_household_editor(household_id)))
with check (user_id = (select auth.uid()) or (household_id is not null and public.is_household_editor(household_id)));

drop policy if exists "plaid accounts: members read" on public.plaid_accounts;
create policy "plaid accounts: members read" on public.plaid_accounts for select to authenticated
using (user_id = (select auth.uid()) or (household_id is not null and public.is_household_member(household_id)));

drop policy if exists "plaid accounts: editors write" on public.plaid_accounts;
create policy "plaid accounts: editors write" on public.plaid_accounts for all to authenticated
using (user_id = (select auth.uid()) or (household_id is not null and public.is_household_editor(household_id)))
with check (user_id = (select auth.uid()) or (household_id is not null and public.is_household_editor(household_id)));

drop policy if exists "plaid transactions: members read" on public.plaid_transactions;
create policy "plaid transactions: members read" on public.plaid_transactions for select to authenticated
using (user_id = (select auth.uid()) or (household_id is not null and public.is_household_member(household_id)));

drop policy if exists "plaid transactions: editors write" on public.plaid_transactions;
create policy "plaid transactions: editors write" on public.plaid_transactions for all to authenticated
using (user_id = (select auth.uid()) or (household_id is not null and public.is_household_editor(household_id)))
with check (user_id = (select auth.uid()) or (household_id is not null and public.is_household_editor(household_id)));

grant select, insert, update, delete on public.plaid_items to authenticated;
grant select, insert, update, delete on public.plaid_accounts to authenticated;
grant select, insert, update, delete on public.plaid_transactions to authenticated;
