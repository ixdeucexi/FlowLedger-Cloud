-- Reconciliation writes only occur inside the validated SECURITY DEFINER RPCs,
-- so read policies do not need overlapping write-policy branches.
drop policy if exists "reconciliations: pro editors write" on public.transaction_reconciliations;
drop policy if exists "bill matches: editors write" on public.bill_transaction_matches;
drop policy if exists "bill matches: pro households only" on public.bill_transaction_matches;

create index if not exists transaction_reconciliations_user_idx
  on public.transaction_reconciliations (user_id);
create index if not exists transaction_reconciliations_budget_idx
  on public.transaction_reconciliations (budget_id);
create index if not exists transaction_reconciliations_reviewer_idx
  on public.transaction_reconciliations (reviewed_by);
create index if not exists bill_transaction_matches_budget_idx
  on public.bill_transaction_matches (budget_id);
create index if not exists bill_transaction_matches_override_idx
  on public.bill_transaction_matches (override_id);
