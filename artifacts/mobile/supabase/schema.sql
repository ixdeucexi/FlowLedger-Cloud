-- Enable UUID extension
create extension if not exists "pgcrypto";

-- ── bills ──────────────────────────────────────────────────────────────────────
create table if not exists bills (
  id              text primary key,
  user_id         uuid not null references auth.users(id) on delete cascade,
  name            text not null,
  amount          numeric not null default 0,
  category        text not null default 'Other',
  priority        integer not null default 0,
  is_debt         boolean not null default false,
  balance         numeric not null default 0,
  interest_rate   numeric not null default 0,
  due_day         integer not null default 1,
  day_of_week     integer,
  next_payment_date text,
  start_date      text,
  end_date        text,
  is_recurring    boolean not null default true,
  frequency       text not null default 'monthly',
  include_in_snowball boolean not null default true,
  created_at      text not null
);
alter table bills enable row level security;
create policy "bills: user owns rows" on bills for all using (auth.uid() = user_id);

-- ── monthly_overrides ──────────────────────────────────────────────────────────
create table if not exists monthly_overrides (
  id              text primary key,
  user_id         uuid not null references auth.users(id) on delete cascade,
  bill_id         text not null,
  month           integer not null,
  year            integer not null,
  custom_amount   numeric,
  custom_due_day  integer,
  paid_amount     numeric not null default 0,
  actual_amount   numeric,
  paid_date       date
);
alter table monthly_overrides enable row level security;
create policy "overrides: user owns rows" on monthly_overrides for all using (auth.uid() = user_id);

-- ── transactions ───────────────────────────────────────────────────────────────
create table if not exists transactions (
  id              text primary key,
  user_id         uuid not null references auth.users(id) on delete cascade,
  date            text not null,
  amount          numeric not null,
  category        text not null default 'Other',
  note            text not null default '',
  linked_bill_id  text
);
alter table transactions enable row level security;
create policy "transactions: user owns rows" on transactions for all using (auth.uid() = user_id);

-- ── incomes ────────────────────────────────────────────────────────────────────
create table if not exists incomes (
  id                  text primary key,
  user_id             uuid not null references auth.users(id) on delete cascade,
  name                text not null,
  amount              numeric not null default 0,
  frequency           text not null default 'monthly',
  start_date          text,
  next_payment_date   text,
  amount_history      jsonb not null default '[]'
);
alter table incomes enable row level security;
create policy "incomes: user owns rows" on incomes for all using (auth.uid() = user_id);

-- ── goals ──────────────────────────────────────────────────────────────────────
create table if not exists goals (
  id              text primary key,
  user_id         uuid not null references auth.users(id) on delete cascade,
  name            text not null,
  target_amount   numeric not null default 0,
  target_date     text not null,
  current_amount  numeric not null default 0,
  created_at      text not null
);
alter table goals enable row level security;
create policy "goals: user owns rows" on goals for all using (auth.uid() = user_id);

-- ── extra_payments ─────────────────────────────────────────────────────────────
create table if not exists extra_payments (
  id              text primary key,
  user_id         uuid not null references auth.users(id) on delete cascade,
  month           integer not null,
  year            integer not null,
  amount          numeric not null default 0,
  allocations     jsonb not null default '[]',
  payment_date    date,
  sources         jsonb not null default '[]'
);
alter table extra_payments enable row level security;
create policy "extra_payments: user owns rows" on extra_payments for all using (auth.uid() = user_id);

-- ── settings ───────────────────────────────────────────────────────────────────
create table if not exists settings (
  user_id                 uuid primary key references auth.users(id) on delete cascade,
  payment_method          text not null default 'snowball',
  starting_balance        numeric not null default 0,
  starting_balance_date   text,
  safety_floor            numeric not null default 200 check (safety_floor >= 0),
  forecast_horizon_months integer not null default 6 check (forecast_horizon_months between 1 and 24)
);
alter table settings enable row level security;
create policy "settings: user owns row" on settings for all using (auth.uid() = user_id);

-- ── categories ─────────────────────────────────────────────────────────────────
create table if not exists categories (
  user_id   uuid not null references auth.users(id) on delete cascade,
  name      text not null,
  primary key (user_id, name)
);
alter table categories enable row level security;
create policy "categories: user owns rows" on categories for all using (auth.uid() = user_id);

-- Phase 0 household-ready ownership. Existing user_id policies remain authoritative.
create table if not exists households (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'My Household',
  created_by uuid not null references auth.users(id) on delete cascade,
  is_personal boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists households_one_personal_per_user on households(created_by) where is_personal;
create table if not exists household_members (
  household_id uuid not null references households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'editor', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (household_id, user_id)
);
create table if not exists budgets (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  name text not null default 'Main Budget',
  is_default boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists budgets_one_default_per_household on budgets(household_id) where is_default;

alter table bills add column if not exists household_id uuid references households(id) on delete set null;
alter table bills add column if not exists budget_id uuid references budgets(id) on delete set null;
alter table monthly_overrides add column if not exists household_id uuid references households(id) on delete set null;
alter table monthly_overrides add column if not exists budget_id uuid references budgets(id) on delete set null;
alter table transactions add column if not exists household_id uuid references households(id) on delete set null;
alter table transactions add column if not exists budget_id uuid references budgets(id) on delete set null;
alter table incomes add column if not exists household_id uuid references households(id) on delete set null;
alter table incomes add column if not exists budget_id uuid references budgets(id) on delete set null;
alter table goals add column if not exists household_id uuid references households(id) on delete set null;
alter table goals add column if not exists budget_id uuid references budgets(id) on delete set null;
alter table extra_payments add column if not exists household_id uuid references households(id) on delete set null;
alter table extra_payments add column if not exists budget_id uuid references budgets(id) on delete set null;
alter table categories add column if not exists household_id uuid references households(id) on delete set null;
alter table categories add column if not exists budget_id uuid references budgets(id) on delete set null;

alter table households enable row level security;
alter table household_members enable row level security;
alter table budgets enable row level security;
create policy "households: owner reads" on households for select using (created_by = auth.uid());
create policy "members: user reads membership" on household_members for select using (user_id = auth.uid());
create policy "budgets: member reads" on budgets for select using (
  exists (select 1 from household_members hm where hm.household_id = budgets.household_id and hm.user_id = auth.uid())
);

create table if not exists app_diagnostics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  app_version text not null,
  platform text not null check (platform in ('web', 'ios', 'android', 'unknown')),
  event_type text not null check (event_type in ('performance', 'save_failure', 'unhandled_error')),
  operation text not null,
  error_code text,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  created_at timestamptz not null default now()
);
alter table app_diagnostics enable row level security;
create policy "diagnostics: user inserts" on app_diagnostics for insert with check (auth.uid() = user_id);
create policy "diagnostics: user reads" on app_diagnostics for select using (auth.uid() = user_id);
