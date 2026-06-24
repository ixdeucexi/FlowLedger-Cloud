-- Phase 1 account and reconciliation foundation. Additive and safe for older clients.
create table if not exists accounts (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  household_id uuid references households(id) on delete set null,
  budget_id uuid references budgets(id) on delete set null,
  name text not null,
  account_type text not null check (account_type in ('checking', 'savings', 'cash')),
  current_balance numeric not null default 0,
  balance_as_of date not null default current_date,
  last_reconciled_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists account_balances (
  id text primary key,
  account_id text not null references accounts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  balance numeric not null,
  as_of_date date not null,
  source text not null default 'manual' check (source in ('manual', 'reconciliation', 'import')),
  created_at timestamptz not null default now()
);

alter table transactions add column if not exists account_id text references accounts(id) on delete set null;
alter table transactions add column if not exists import_hash text;
create unique index if not exists transactions_user_import_hash_unique
  on transactions(user_id, import_hash) where import_hash is not null;
alter table bills add column if not exists last_reviewed_at timestamptz not null default now();
alter table incomes add column if not exists last_reviewed_at timestamptz not null default now();
alter table settings add column if not exists onboarding_completed boolean not null default false;

drop trigger if exists assign_accounts_budget on accounts;
create trigger assign_accounts_budget before insert on accounts for each row execute function public.assign_personal_budget();

alter table accounts enable row level security;
alter table account_balances enable row level security;
drop policy if exists "accounts: user owns rows" on accounts;
create policy "accounts: user owns rows" on accounts for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "account balances: user owns rows" on account_balances;
create policy "account balances: user owns rows" on account_balances for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index if not exists accounts_user_active_idx on accounts(user_id, is_active);
create index if not exists account_balances_account_date_idx on account_balances(account_id, as_of_date desc);

-- Preserve each user's existing forecast anchor as a personal checking account.
insert into accounts (id, user_id, household_id, budget_id, name, account_type, current_balance, balance_as_of, last_reconciled_at)
select 'phase1-default-' || s.user_id::text, s.user_id, h.id, b.id, 'Checking', 'checking',
       s.starting_balance, coalesce(nullif(s.starting_balance_date, '')::date, current_date),
       (coalesce(nullif(s.starting_balance_date, '')::date, current_date))::timestamptz
from settings s
left join households h on h.created_by = s.user_id and h.is_personal
left join budgets b on b.household_id = h.id and b.is_default
where not exists (select 1 from accounts a where a.user_id = s.user_id);

insert into account_balances (id, account_id, user_id, balance, as_of_date, source)
select 'phase1-opening-' || a.user_id::text, a.id, a.user_id, a.current_balance, a.balance_as_of, 'manual'
from accounts a
where a.id like 'phase1-default-%'
on conflict (id) do nothing;

-- Rollback note: the no-lag and Phase 0 clients ignore these additive tables and columns.
