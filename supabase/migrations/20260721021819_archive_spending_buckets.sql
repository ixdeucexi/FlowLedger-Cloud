alter table public.goals
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users(id) on delete set null;

create index if not exists goals_household_archived_idx
  on public.goals (household_id, archived_at)
  where goal_type = 'planned_expense';

comment on column public.goals.archived_at is
  'Hides a completed spending bucket from active planning while preserving its transaction history.';
