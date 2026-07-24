-- Keep every planned-expense target derived from its reconciliation ledger.
-- All rows for a target share the original pre-reconciliation snapshot so an
-- undo is correct even when transactions are undone out of order.
with baselines as (
  select distinct on (resolution, target_id)
    resolution,
    target_id,
    restore_snapshot
  from public.transaction_reconciliations
  where resolution in ('decision', 'goal') and target_id is not null
  order by resolution, target_id, reviewed_at, transaction_id
)
update public.transaction_reconciliations r
set restore_snapshot = case
  when r.resolution = 'decision' then r.restore_snapshot || jsonb_build_object(
    'decisionStatus', b.restore_snapshot->'decisionStatus',
    'decisionActualAmount', b.restore_snapshot->'decisionActualAmount',
    'decisionCompletedAt', b.restore_snapshot->'decisionCompletedAt'
  )
  else r.restore_snapshot || jsonb_build_object(
    'goalCurrentAmount', b.restore_snapshot->'goalCurrentAmount'
  )
end
from baselines b
where r.resolution = b.resolution and r.target_id = b.target_id;

create or replace function public.normalize_reconciliation_restore_snapshot()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_base jsonb;
begin
  if new.resolution not in ('decision', 'goal') or new.target_id is null then
    return new;
  end if;

  select r.restore_snapshot into v_base
  from public.transaction_reconciliations r
  where r.resolution = new.resolution
    and r.target_id = new.target_id
    and r.transaction_id <> new.transaction_id
  order by r.reviewed_at, r.transaction_id
  limit 1;

  if v_base is null then return new; end if;
  if new.resolution = 'decision' then
    new.restore_snapshot := new.restore_snapshot || jsonb_build_object(
      'decisionStatus', v_base->'decisionStatus',
      'decisionActualAmount', v_base->'decisionActualAmount',
      'decisionCompletedAt', v_base->'decisionCompletedAt'
    );
  else
    new.restore_snapshot := new.restore_snapshot || jsonb_build_object(
      'goalCurrentAmount', v_base->'goalCurrentAmount'
    );
  end if;
  return new;
end;
$$;

create or replace function public.sync_reconciliation_target_progress()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_resolution text;
  v_target_id text;
  v_fallback_snapshot jsonb;
  v_base jsonb;
  v_total numeric := 0;
  v_has_final boolean := false;
  v_finalized_at timestamptz;
  v_base_amount numeric;
begin
  if tg_op = 'DELETE' then
    v_resolution := old.resolution;
    v_target_id := old.target_id;
    v_fallback_snapshot := old.restore_snapshot;
  else
    v_resolution := new.resolution;
    v_target_id := new.target_id;
    v_fallback_snapshot := new.restore_snapshot;
  end if;

  if v_resolution not in ('decision', 'goal') or v_target_id is null then
    return null;
  end if;

  select r.restore_snapshot into v_base
  from public.transaction_reconciliations r
  where r.resolution = v_resolution and r.target_id = v_target_id
  order by r.reviewed_at, r.transaction_id
  limit 1;
  v_base := coalesce(v_base, v_fallback_snapshot, '{}'::jsonb);

  select
    coalesce(sum((allocation.value->>'amount')::numeric), 0),
    coalesce(bool_or(coalesce(allocation.value->>'settlement', '') <> 'partial'), false),
    max(r.reviewed_at) filter (where coalesce(allocation.value->>'settlement', '') <> 'partial')
  into v_total, v_has_final, v_finalized_at
  from public.transaction_reconciliations r
  cross join lateral jsonb_array_elements(coalesce(r.allocations, '[]'::jsonb)) allocation(value)
  where r.resolution = v_resolution
    and r.target_id = v_target_id
    and allocation.value->>'type' = 'planned_expense'
    and allocation.value->>'source' = v_resolution
    and allocation.value->>'targetId' = v_target_id;

  if v_resolution = 'decision' then
    v_base_amount := case
      when v_base ? 'decisionActualAmount' and v_base->>'decisionActualAmount' is not null
      then (v_base->>'decisionActualAmount')::numeric
      else null
    end;
    update public.decisions
    set actual_amount = case when v_base_amount is null and v_total = 0 then null else coalesce(v_base_amount, 0) + v_total end,
        status = case when v_has_final then 'completed' else coalesce(nullif(v_base->>'decisionStatus', ''), status) end,
        completed_at = case
          when v_has_final then v_finalized_at
          when v_base ? 'decisionCompletedAt' and v_base->>'decisionCompletedAt' is not null
            then (v_base->>'decisionCompletedAt')::timestamptz
          else null
        end,
        updated_at = now()
    where id = v_target_id;
  else
    v_base_amount := coalesce((v_base->>'goalCurrentAmount')::numeric, 0);
    update public.goals
    set current_amount = case
      when v_has_final then target_amount
      else least(target_amount, v_base_amount + v_total)
    end
    where id = v_target_id;
  end if;
  return null;
end;
$$;

drop trigger if exists normalize_reconciliation_restore_snapshot on public.transaction_reconciliations;
create trigger normalize_reconciliation_restore_snapshot
before insert or update of resolution, target_id, restore_snapshot
on public.transaction_reconciliations
for each row execute function public.normalize_reconciliation_restore_snapshot();

drop trigger if exists sync_reconciliation_target_progress on public.transaction_reconciliations;
create trigger sync_reconciliation_target_progress
after insert or update of resolution, target_id, allocations, restore_snapshot or delete
on public.transaction_reconciliations
for each row execute function public.sync_reconciliation_target_progress();

-- Recalculate existing planned targets once with the normalized baselines.
update public.transaction_reconciliations
set restore_snapshot = restore_snapshot
where resolution in ('decision', 'goal') and target_id is not null;

-- This function is an internal audit helper called by other database routines.
-- Clients must not be able to manufacture arbitrary activity-log entries.
revoke all on function public.log_household_activity(uuid, text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.log_household_activity(uuid, text, text, text, text, uuid) to service_role;

-- Cover every foreign key used by cascading deletes and household joins.
create index if not exists account_balances_budget_id_idx on public.account_balances (budget_id);
create index if not exists account_balances_household_id_idx on public.account_balances (household_id);
create index if not exists account_balances_user_id_idx on public.account_balances (user_id);
create index if not exists accounts_budget_id_idx on public.accounts (budget_id);
create index if not exists bill_date_moves_budget_id_idx on public.bill_date_moves (budget_id);
create index if not exists bills_budget_id_idx on public.bills (budget_id);
create index if not exists bills_user_id_idx on public.bills (user_id);
create index if not exists categories_budget_id_idx on public.categories (budget_id);
create index if not exists categories_household_id_idx on public.categories (household_id);
create index if not exists category_budgets_household_id_idx on public.category_budgets (household_id);
create index if not exists decisions_budget_id_idx on public.decisions (budget_id);
create index if not exists decisions_household_id_idx on public.decisions (household_id);
create index if not exists extra_payments_budget_id_idx on public.extra_payments (budget_id);
create index if not exists extra_payments_household_id_idx on public.extra_payments (household_id);
create index if not exists goals_budget_id_idx on public.goals (budget_id);
create index if not exists goals_user_id_idx on public.goals (user_id);
create index if not exists household_activity_actor_user_id_idx on public.household_activity (actor_user_id);
create index if not exists household_invites_accepted_by_idx on public.household_invites (accepted_by);
create index if not exists household_invites_created_by_idx on public.household_invites (created_by);
create index if not exists household_members_user_id_idx on public.household_members (user_id);
create index if not exists household_settings_budget_id_idx on public.household_settings (budget_id);
create index if not exists incomes_budget_id_idx on public.incomes (budget_id);
create index if not exists incomes_user_id_idx on public.incomes (user_id);
create index if not exists monthly_overrides_budget_id_idx on public.monthly_overrides (budget_id);
create index if not exists monthly_overrides_user_id_idx on public.monthly_overrides (user_id);
create index if not exists plaid_accounts_account_id_idx on public.plaid_accounts (account_id);
create index if not exists plaid_accounts_flowledger_account_id_idx on public.plaid_accounts (flowledger_account_id);
create index if not exists plaid_transactions_transaction_id_idx on public.plaid_transactions (transaction_id);
create index if not exists transactions_account_id_idx on public.transactions (account_id);
create index if not exists transactions_budget_id_idx on public.transactions (budget_id);
create index if not exists transactions_debt_applied_bill_id_idx on public.transactions (debt_applied_bill_id);
create index if not exists transactions_linked_income_id_idx on public.transactions (linked_income_id);
create index if not exists user_preferences_active_household_id_idx on public.user_preferences (active_household_id);
