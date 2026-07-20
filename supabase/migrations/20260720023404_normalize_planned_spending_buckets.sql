-- Older clients used -1 as a marker for planned spending. The explicit
-- goal_type now carries that meaning, so spending progress must start at 0.
update public.goals
set current_amount = 0
where goal_type = 'planned_expense'
  and current_amount < 0;

update private.planned_reconciliation_bases
set base_amount = 0
where target_type = 'goal'
  and base_amount < 0;
