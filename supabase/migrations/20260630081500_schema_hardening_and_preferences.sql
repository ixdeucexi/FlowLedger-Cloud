-- Keep trigger-only helper functions out of the public RPC surface.
revoke execute on function public.bootstrap_personal_household() from public, anon, authenticated;
revoke execute on function public.assign_personal_budget() from public, anon, authenticated;

-- User preference foundation for Decision Hub / Flo toggles.
create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  decision_hub_settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_preferences enable row level security;

drop policy if exists "user preferences: user owns row" on public.user_preferences;
create policy "user preferences: user owns row"
on public.user_preferences
for all
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

-- Category budget foundation. The app can keep using local storage until the UI
-- is wired to this table, but the database is now ready for cross-device sync.
create table if not exists public.category_budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  household_id uuid references public.households(id) on delete set null,
  budget_id uuid references public.budgets(id) on delete set null,
  category text not null,
  month integer not null check (month between 0 and 11),
  year integer not null check (year between 2000 and 2200),
  amount numeric not null default 0 check (amount >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, category, month, year)
);

drop trigger if exists assign_category_budgets_budget on public.category_budgets;
create trigger assign_category_budgets_budget
before insert on public.category_budgets
for each row execute function public.assign_personal_budget();

alter table public.category_budgets enable row level security;

drop policy if exists "category_budgets: user reads" on public.category_budgets;
create policy "category_budgets: user reads"
on public.category_budgets
for select
using ((select auth.uid()) = user_id);

drop policy if exists "category_budgets: user inserts" on public.category_budgets;
create policy "category_budgets: user inserts"
on public.category_budgets
for insert
with check ((select auth.uid()) = user_id);

drop policy if exists "category_budgets: user updates" on public.category_budgets;
create policy "category_budgets: user updates"
on public.category_budgets
for update
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "category_budgets: user deletes" on public.category_budgets;
create policy "category_budgets: user deletes"
on public.category_budgets
for delete
using ((select auth.uid()) = user_id);

create index if not exists category_budgets_user_month_idx
on public.category_budgets(user_id, year, month);

-- Recreate ownership policies with init-plan friendly auth.uid() usage.
drop policy if exists "bills: user owns rows" on public.bills;
create policy "bills: user owns rows"
on public.bills
for all
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "overrides: user owns rows" on public.monthly_overrides;
create policy "overrides: user owns rows"
on public.monthly_overrides
for all
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "transactions: user owns rows" on public.transactions;
create policy "transactions: user owns rows"
on public.transactions
for all
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "incomes: user owns rows" on public.incomes;
create policy "incomes: user owns rows"
on public.incomes
for all
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "goals: user owns rows" on public.goals;
create policy "goals: user owns rows"
on public.goals
for all
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "extra_payments: user owns rows" on public.extra_payments;
create policy "extra_payments: user owns rows"
on public.extra_payments
for all
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "settings: user owns row" on public.settings;
create policy "settings: user owns row"
on public.settings
for all
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "categories: user owns rows" on public.categories;
create policy "categories: user owns rows"
on public.categories
for all
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "accounts: user owns rows" on public.accounts;
create policy "accounts: user owns rows"
on public.accounts
for all
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "account balances: user owns rows" on public.account_balances;
create policy "account balances: user owns rows"
on public.account_balances
for all
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "decisions: user owns rows" on public.decisions;
create policy "decisions: user owns rows"
on public.decisions
for all
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "flo memory: user owns row" on public.flo_memory;
create policy "flo memory: user owns row"
on public.flo_memory
for all
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "flo usage: user inserts" on public.flo_usage;
create policy "flo usage: user inserts"
on public.flo_usage
for insert
with check ((select auth.uid()) = user_id);

drop policy if exists "diagnostics: user inserts" on public.app_diagnostics;
create policy "diagnostics: user inserts"
on public.app_diagnostics
for insert
with check ((select auth.uid()) = user_id);

drop policy if exists "diagnostics: user reads" on public.app_diagnostics;
create policy "diagnostics: user reads"
on public.app_diagnostics
for select
using ((select auth.uid()) = user_id);

drop policy if exists "households: owner reads" on public.households;
create policy "households: owner reads"
on public.households
for select
using (created_by = (select auth.uid()));

drop policy if exists "members: user reads membership" on public.household_members;
create policy "members: user reads membership"
on public.household_members
for select
using (user_id = (select auth.uid()));

drop policy if exists "budgets: member reads" on public.budgets;
create policy "budgets: member reads"
on public.budgets
for select
using (
  exists (
    select 1
    from public.household_members hm
    where hm.household_id = budgets.household_id
      and hm.user_id = (select auth.uid())
  )
);

drop policy if exists "Users can view their bill date moves" on public.bill_date_moves;
create policy "Users can view their bill date moves"
on public.bill_date_moves
for select
using ((select auth.uid()) = user_id);

drop policy if exists "Users can create their bill date moves" on public.bill_date_moves;
create policy "Users can create their bill date moves"
on public.bill_date_moves
for insert
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their bill date moves" on public.bill_date_moves;
create policy "Users can update their bill date moves"
on public.bill_date_moves
for update
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their bill date moves" on public.bill_date_moves;
create policy "Users can delete their bill date moves"
on public.bill_date_moves
for delete
using ((select auth.uid()) = user_id);
