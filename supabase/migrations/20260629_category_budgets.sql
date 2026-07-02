-- Phase 4 category-budget foundation.
-- Additive only: current app can run without this table, and rollback is safe.

create table if not exists category_budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  household_id uuid references households(id) on delete set null,
  budget_id uuid references budgets(id) on delete set null,
  category text not null,
  month integer not null check (month between 0 and 11),
  year integer not null check (year between 2000 and 2200),
  amount numeric not null default 0 check (amount >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, category, month, year)
);

drop trigger if exists assign_category_budgets_budget on category_budgets;
create trigger assign_category_budgets_budget
before insert on category_budgets
for each row execute function public.assign_personal_budget();

alter table category_budgets enable row level security;

drop policy if exists "category_budgets: user reads" on category_budgets;
create policy "category_budgets: user reads" on category_budgets
for select using (auth.uid() = user_id);

drop policy if exists "category_budgets: user inserts" on category_budgets;
create policy "category_budgets: user inserts" on category_budgets
for insert with check (auth.uid() = user_id);

drop policy if exists "category_budgets: user updates" on category_budgets;
create policy "category_budgets: user updates" on category_budgets
for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "category_budgets: user deletes" on category_budgets;
create policy "category_budgets: user deletes" on category_budgets
for delete using (auth.uid() = user_id);

create index if not exists category_budgets_user_month_idx
on category_budgets(user_id, year, month);
