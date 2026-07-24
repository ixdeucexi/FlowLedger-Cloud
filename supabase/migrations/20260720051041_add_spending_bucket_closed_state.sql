alter table public.goals
  add column if not exists closed_at timestamptz,
  add column if not exists closed_by uuid references auth.users(id) on delete set null;

create index if not exists goals_household_open_spending_idx
  on public.goals (household_id, target_date)
  where goal_type = 'planned_expense' and closed_at is null;

create index if not exists goals_closed_by_idx
  on public.goals (closed_by)
  where closed_by is not null;

comment on column public.goals.closed_at is
  'Marks a spending bucket closed without changing its original target or matched-spending total.';

comment on column public.goals.closed_by is
  'Authenticated household editor who closed the spending bucket.';
