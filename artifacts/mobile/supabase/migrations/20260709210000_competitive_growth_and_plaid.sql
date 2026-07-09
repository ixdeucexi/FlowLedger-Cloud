create table if not exists public.transaction_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  household_id uuid references public.households(id) on delete cascade,
  name text not null,
  match_type text not null default 'contains'
    check (match_type in ('contains', 'exact', 'starts_with', 'amount_range')),
  match_value text,
  amount_min numeric,
  amount_max numeric,
  direction text not null default 'any'
    check (direction in ('any', 'income', 'expense', 'transfer', 'debt_payment')),
  category text,
  linked_bill_id uuid,
  mark_as_transfer boolean not null default false,
  priority integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.transaction_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  household_id uuid references public.households(id) on delete cascade,
  transaction_id uuid references public.transactions(id) on delete cascade,
  reasons text[] not null default '{}',
  status text not null default 'needs_review'
    check (status in ('needs_review', 'approved', 'ignored', 'deleted')),
  priority text not null default 'low'
    check (priority in ('low', 'medium', 'high')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.subscription_candidates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  household_id uuid references public.households(id) on delete cascade,
  merchant text not null,
  cadence text not null default 'unknown'
    check (cadence in ('weekly', 'monthly', 'annual', 'unknown')),
  average_amount numeric not null default 0,
  monthly_equivalent numeric not null default 0,
  yearly_equivalent numeric not null default 0,
  confidence text not null default 'low'
    check (confidence in ('low', 'medium', 'high')),
  status text not null default 'review'
    check (status in ('review', 'keep', 'cancel_manually', 'convert_to_bill', 'not_subscription')),
  source_transaction_ids uuid[] not null default '{}',
  last_reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.goal_funding_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  household_id uuid references public.households(id) on delete cascade,
  goal_id uuid references public.goals(id) on delete cascade,
  goal_type text not null default 'savings'
    check (goal_type in ('savings', 'planned_expense', 'emergency_fund', 'house', 'car', 'other')),
  monthly_needed numeric not null default 0,
  safe_monthly_contribution numeric not null default 0,
  linked_account_id uuid references public.accounts(id) on delete set null,
  status text not null default 'needs_review'
    check (status in ('on_track', 'behind', 'unsafe', 'needs_date', 'needs_review')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.flowledger_reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  household_id uuid references public.households(id) on delete cascade,
  reminder_type text not null,
  title text not null,
  message text not null,
  due_date date,
  severity text not null default 'info'
    check (severity in ('info', 'watch', 'risk')),
  status text not null default 'active'
    check (status in ('active', 'done', 'dismissed')),
  source_table text,
  source_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.import_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  household_id uuid references public.households(id) on delete cascade,
  source text not null default 'csv'
    check (source in ('bank_csv', 'monarch_csv', 'mint_csv', 'generic_csv', 'plaid', 'csv')),
  filename text,
  status text not null default 'preview'
    check (status in ('preview', 'applied', 'cancelled', 'failed')),
  total_rows integer not null default 0,
  duplicate_rows integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.import_preview_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.import_batches(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  household_id uuid references public.households(id) on delete cascade,
  row_index integer not null,
  transaction_date date,
  name text,
  amount numeric,
  category text,
  account_id uuid references public.accounts(id) on delete set null,
  import_hash text,
  is_duplicate boolean not null default false,
  selected boolean not null default true,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

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
  account_id uuid references public.accounts(id) on delete set null,
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
  transaction_id uuid references public.transactions(id) on delete set null,
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

create table if not exists public.child_profiles (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  allowance_amount numeric,
  allowance_frequency text check (allowance_frequency in ('weekly', 'biweekly', 'monthly')),
  savings_goal numeric,
  current_savings numeric not null default 0,
  spending_limit numeric,
  view_pin_enabled boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.flowledger_trust_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  household_id uuid references public.households(id) on delete cascade,
  event_type text not null,
  description text not null,
  created_at timestamptz not null default now()
);

create index if not exists transaction_rules_household_idx on public.transaction_rules (household_id, is_active, priority);
create index if not exists transaction_reviews_household_idx on public.transaction_reviews (household_id, status, priority);
create index if not exists subscription_candidates_household_idx on public.subscription_candidates (household_id, status, monthly_equivalent desc);
create index if not exists flowledger_reminders_household_idx on public.flowledger_reminders (household_id, status, severity);
create index if not exists import_batches_household_idx on public.import_batches (household_id, created_at desc);
create index if not exists import_preview_rows_batch_idx on public.import_preview_rows (batch_id, selected);
create index if not exists plaid_items_household_idx on public.plaid_items (household_id, status);
create index if not exists plaid_transactions_household_idx on public.plaid_transactions (household_id, transaction_date desc);
create index if not exists child_profiles_household_idx on public.child_profiles (household_id, is_active);

alter table public.transaction_rules enable row level security;
alter table public.transaction_reviews enable row level security;
alter table public.subscription_candidates enable row level security;
alter table public.goal_funding_plans enable row level security;
alter table public.flowledger_reminders enable row level security;
alter table public.import_batches enable row level security;
alter table public.import_preview_rows enable row level security;
alter table public.plaid_items enable row level security;
alter table public.plaid_accounts enable row level security;
alter table public.plaid_transactions enable row level security;
alter table public.child_profiles enable row level security;
alter table public.flowledger_trust_events enable row level security;

drop policy if exists "transaction rules: household members read" on public.transaction_rules;
create policy "transaction rules: household members read" on public.transaction_rules for select to authenticated
using (household_id is not null and public.is_household_member(household_id));
drop policy if exists "transaction rules: household editors write" on public.transaction_rules;
create policy "transaction rules: household editors write" on public.transaction_rules for all to authenticated
using (household_id is not null and public.is_household_editor(household_id))
with check (household_id is not null and public.is_household_editor(household_id));

drop policy if exists "transaction reviews: household members read" on public.transaction_reviews;
create policy "transaction reviews: household members read" on public.transaction_reviews for select to authenticated
using (household_id is not null and public.is_household_member(household_id));
drop policy if exists "transaction reviews: household editors write" on public.transaction_reviews;
create policy "transaction reviews: household editors write" on public.transaction_reviews for all to authenticated
using (household_id is not null and public.is_household_editor(household_id))
with check (household_id is not null and public.is_household_editor(household_id));

drop policy if exists "subscriptions: household members read" on public.subscription_candidates;
create policy "subscriptions: household members read" on public.subscription_candidates for select to authenticated
using (household_id is not null and public.is_household_member(household_id));
drop policy if exists "subscriptions: household editors write" on public.subscription_candidates;
create policy "subscriptions: household editors write" on public.subscription_candidates for all to authenticated
using (household_id is not null and public.is_household_editor(household_id))
with check (household_id is not null and public.is_household_editor(household_id));

drop policy if exists "goal funding: household members read" on public.goal_funding_plans;
create policy "goal funding: household members read" on public.goal_funding_plans for select to authenticated
using (household_id is not null and public.is_household_member(household_id));
drop policy if exists "goal funding: household editors write" on public.goal_funding_plans;
create policy "goal funding: household editors write" on public.goal_funding_plans for all to authenticated
using (household_id is not null and public.is_household_editor(household_id))
with check (household_id is not null and public.is_household_editor(household_id));

drop policy if exists "reminders: household members read" on public.flowledger_reminders;
create policy "reminders: household members read" on public.flowledger_reminders for select to authenticated
using (household_id is not null and public.is_household_member(household_id));
drop policy if exists "reminders: household editors write" on public.flowledger_reminders;
create policy "reminders: household editors write" on public.flowledger_reminders for all to authenticated
using (household_id is not null and public.is_household_editor(household_id))
with check (household_id is not null and public.is_household_editor(household_id));

drop policy if exists "imports: household members read batches" on public.import_batches;
create policy "imports: household members read batches" on public.import_batches for select to authenticated
using (household_id is not null and public.is_household_member(household_id));
drop policy if exists "imports: household editors write batches" on public.import_batches;
create policy "imports: household editors write batches" on public.import_batches for all to authenticated
using (household_id is not null and public.is_household_editor(household_id))
with check (household_id is not null and public.is_household_editor(household_id));
drop policy if exists "imports: household members read rows" on public.import_preview_rows;
create policy "imports: household members read rows" on public.import_preview_rows for select to authenticated
using (household_id is not null and public.is_household_member(household_id));
drop policy if exists "imports: household editors write rows" on public.import_preview_rows;
create policy "imports: household editors write rows" on public.import_preview_rows for all to authenticated
using (household_id is not null and public.is_household_editor(household_id))
with check (household_id is not null and public.is_household_editor(household_id));

drop policy if exists "plaid items: household members read" on public.plaid_items;
create policy "plaid items: household members read" on public.plaid_items for select to authenticated
using (household_id is not null and public.is_household_member(household_id));
drop policy if exists "plaid items: household editors write" on public.plaid_items;
create policy "plaid items: household editors write" on public.plaid_items for all to authenticated
using (household_id is not null and public.is_household_editor(household_id))
with check (household_id is not null and public.is_household_editor(household_id));
drop policy if exists "plaid accounts: household members read" on public.plaid_accounts;
create policy "plaid accounts: household members read" on public.plaid_accounts for select to authenticated
using (household_id is not null and public.is_household_member(household_id));
drop policy if exists "plaid accounts: household editors write" on public.plaid_accounts;
create policy "plaid accounts: household editors write" on public.plaid_accounts for all to authenticated
using (household_id is not null and public.is_household_editor(household_id))
with check (household_id is not null and public.is_household_editor(household_id));
drop policy if exists "plaid transactions: household members read" on public.plaid_transactions;
create policy "plaid transactions: household members read" on public.plaid_transactions for select to authenticated
using (household_id is not null and public.is_household_member(household_id));
drop policy if exists "plaid transactions: household editors write" on public.plaid_transactions;
create policy "plaid transactions: household editors write" on public.plaid_transactions for all to authenticated
using (household_id is not null and public.is_household_editor(household_id))
with check (household_id is not null and public.is_household_editor(household_id));

drop policy if exists "children: household members read" on public.child_profiles;
create policy "children: household members read" on public.child_profiles for select to authenticated
using (household_id is not null and public.is_household_member(household_id));
drop policy if exists "children: managers write" on public.child_profiles;
create policy "children: managers write" on public.child_profiles for all to authenticated
using (household_id is not null and public.household_role(household_id) in ('owner', 'manager'))
with check (household_id is not null and public.household_role(household_id) in ('owner', 'manager'));

drop policy if exists "trust events: household members read" on public.flowledger_trust_events;
create policy "trust events: household members read" on public.flowledger_trust_events for select to authenticated
using (household_id is not null and public.is_household_member(household_id));
drop policy if exists "trust events: users create own events" on public.flowledger_trust_events;
create policy "trust events: users create own events" on public.flowledger_trust_events for insert to authenticated
with check ((select auth.uid()) = user_id and (household_id is null or public.is_household_member(household_id)));

grant select, insert, update, delete on
  public.transaction_rules,
  public.transaction_reviews,
  public.subscription_candidates,
  public.goal_funding_plans,
  public.flowledger_reminders,
  public.import_batches,
  public.import_preview_rows,
  public.plaid_items,
  public.plaid_accounts,
  public.plaid_transactions,
  public.child_profiles
to authenticated;

grant select, insert on public.flowledger_trust_events to authenticated;
