-- Read-only Money Health history. Checks are written only by trusted server
-- routes; approved admins can inspect results but cannot mutate them.
create table if not exists public.money_health_runs (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  local_date date not null,
  status text not null check (status in ('clean', 'issues')),
  issue_count integer not null default 0 check (issue_count >= 0),
  issues jsonb not null default '[]'::jsonb check (jsonb_typeof(issues) = 'array'),
  summary jsonb not null default '{}'::jsonb check (jsonb_typeof(summary) = 'object'),
  triggered_by text not null check (triggered_by in ('manual', 'nightly', 'deploy')),
  checked_by uuid references auth.users(id) on delete set null,
  checked_at timestamptz not null default now(),
  notified_at timestamptz
);

create index if not exists money_health_runs_household_checked_idx
  on public.money_health_runs (household_id, checked_at desc);
create unique index if not exists money_health_runs_one_nightly_per_day_idx
  on public.money_health_runs (household_id, local_date)
  where triggered_by = 'nightly';

alter table public.money_health_runs enable row level security;
revoke all on table public.money_health_runs from public, anon, authenticated;
grant select on table public.money_health_runs to authenticated;
grant select, insert, update, delete on table public.money_health_runs to service_role;

drop policy if exists "money health: approved admins read" on public.money_health_runs;
create policy "money health: approved admins read"
on public.money_health_runs for select to authenticated
using (
  exists (
    select 1
    from public.feedback_admins as admin
    where admin.user_id = auth.uid()
  )
);

comment on table public.money_health_runs is
  'Read-only household integrity checks. These rows report issues and never repair money data.';

-- Repair only the missing audit records whose target, occurrence, settlement,
-- and allocations are already explicit on the matched transaction. The
-- transaction itself remains unchanged.
insert into public.transaction_reconciliations (
  transaction_id,
  user_id,
  household_id,
  budget_id,
  resolution,
  target_id,
  occurrence_date,
  settlement,
  planned_amount,
  allocations,
  restore_snapshot,
  reviewed_by,
  reviewed_at
)
select
  transaction.id,
  transaction.user_id,
  transaction.household_id,
  transaction.budget_id,
  transaction.review_resolution,
  nullif(transaction.review_allocations -> 0 ->> 'targetId', ''),
  coalesce(
    nullif(transaction.review_allocations -> 0 ->> 'occurrenceDate', '')::date,
    transaction.matched_occurrence_date,
    case
      when transaction.date ~ '^\d{4}-\d{2}-\d{2}$' then transaction.date::date
      else null
    end
  ),
  coalesce(
    nullif(transaction.review_allocations -> 0 ->> 'settlement', ''),
    'exact'
  ),
  coalesce(
    nullif(transaction.review_allocations -> 0 ->> 'plannedAmount', '')::numeric,
    abs(transaction.amount)
  ),
  transaction.review_allocations,
  '{}'::jsonb,
  coalesce(transaction.reviewed_by, transaction.user_id),
  coalesce(transaction.reviewed_at, now())
from public.transactions as transaction
left join public.transaction_reconciliations as reconciliation
  on reconciliation.transaction_id = transaction.id
where reconciliation.transaction_id is null
  and transaction.review_status = 'matched'
  and transaction.review_resolution in ('bill', 'income', 'goal', 'decision', 'snowball', 'manual')
  and transaction.household_id is not null
  and jsonb_array_length(transaction.review_allocations) > 0
  and nullif(transaction.review_allocations -> 0 ->> 'targetId', '') is not null
  and transaction.date ~ '^\d{4}-\d{2}-\d{2}$'
on conflict (transaction_id) do nothing;
