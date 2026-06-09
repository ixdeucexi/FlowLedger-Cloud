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
  start_date      text,
  end_date        text,
  is_recurring    boolean not null default true,
  frequency       text not null default 'monthly',
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
  paid_amount     numeric not null default 0
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
  allocations     jsonb not null default '[]'
);
alter table extra_payments enable row level security;
create policy "extra_payments: user owns rows" on extra_payments for all using (auth.uid() = user_id);

-- ── settings ───────────────────────────────────────────────────────────────────
create table if not exists settings (
  user_id                 uuid primary key references auth.users(id) on delete cascade,
  payment_method          text not null default 'snowball',
  starting_balance        numeric not null default 0,
  starting_balance_date   text
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
