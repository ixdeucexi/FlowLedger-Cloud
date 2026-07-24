-- Phase 2: additive decision history and explicit goal types.
alter table goals add column if not exists goal_type text not null default 'savings' check (goal_type in ('savings', 'planned_expense'));
update goals set goal_type = 'planned_expense' where current_amount < 0;

create table if not exists decisions (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  household_id uuid references households(id) on delete set null,
  budget_id uuid references budgets(id) on delete set null,
  name text not null,
  decision_type text not null check (decision_type in ('one_time_purchase','recurring_bill','income_change','payment_date_change','savings_contribution','extra_debt_payment')),
  scenario jsonb not null,
  result jsonb not null,
  status text not null default 'saved' check (status in ('saved','calendar','applied','reversed')),
  calendar_date date,
  applied_change jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists assign_decisions_budget on decisions;
create trigger assign_decisions_budget before insert on decisions for each row execute function public.assign_personal_budget();
alter table decisions enable row level security;
drop policy if exists "decisions: user owns rows" on decisions;
create policy "decisions: user owns rows" on decisions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index if not exists decisions_user_created_idx on decisions(user_id, created_at desc);
