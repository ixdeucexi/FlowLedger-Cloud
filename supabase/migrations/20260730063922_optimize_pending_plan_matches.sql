create index pending_plan_matches_user_idx
  on public.pending_plan_matches (user_id);

create index pending_plan_matches_budget_idx
  on public.pending_plan_matches (budget_id)
  where budget_id is not null;

create index pending_plan_matches_created_by_idx
  on public.pending_plan_matches (created_by);

create index pending_plan_matches_target_idx
  on public.pending_plan_matches (target_id);

drop policy "pending plan matches: pro editors insert"
  on public.pending_plan_matches;

create policy "pending plan matches: pro editors insert"
on public.pending_plan_matches for insert to authenticated
with check (
  user_id = (select auth.uid())
  and created_by = (select auth.uid())
  and public.is_household_editor(household_id)
  and exists (
    select 1
    from public.bills bill
    where bill.id = pending_plan_matches.target_id
      and bill.household_id = pending_plan_matches.household_id
  )
  and exists (
    select 1
    from public.plaid_transactions pt
    where pt.household_id = pending_plan_matches.household_id
      and pt.plaid_transaction_id = pending_plan_matches.pending_plaid_transaction_id
      and pt.pending = true
      and pt.removed_at is null
  )
  and exists (
    select 1
    from public.household_plans plan
    where plan.household_id = pending_plan_matches.household_id
      and plan.tier = 'pro'
  )
);
