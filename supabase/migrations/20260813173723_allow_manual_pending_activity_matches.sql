-- Pending Plaid charges may point to either a planned bill occurrence or an
-- existing manual Activity row. The link remains provisional until Plaid
-- replaces the pending ID with a posted transaction.

alter table public.pending_plan_matches
  drop constraint if exists pending_plan_matches_target_id_fkey;

alter table public.pending_plan_matches
  drop constraint if exists pending_plan_matches_target_type_check;

alter table public.pending_plan_matches
  add constraint pending_plan_matches_target_type_check
  check (target_type in ('bill', 'manual'));

drop policy if exists "pending plan matches: pro editors insert"
  on public.pending_plan_matches;

create policy "pending plan matches: pro editors insert"
on public.pending_plan_matches for insert to authenticated
with check (
  user_id = (select auth.uid())
  and created_by = (select auth.uid())
  and public.is_household_editor(household_id)
  and (
    (
      target_type = 'bill'
      and exists (
        select 1
        from public.bills bill
        where bill.id = pending_plan_matches.target_id
          and bill.household_id = pending_plan_matches.household_id
      )
    )
    or (
      target_type = 'manual'
      and exists (
        select 1
        from public.transactions manual
        where manual.id = pending_plan_matches.target_id
          and manual.household_id = pending_plan_matches.household_id
          and manual.budget_id is not distinct from pending_plan_matches.budget_id
          and manual.source is distinct from 'plaid'
          and manual.amount < 0
          and manual.pending is not true
          and manual.removed_at is null
          and manual.deleted_at is null
          and manual.import_hash is null
          and manual.transfer_group_id is null
          and manual.linked_bill_id is null
          and manual.linked_plan_id is null
          and manual.review_status is distinct from 'matched'
          and manual.category is distinct from 'Transfer'
          and date_trunc('month', manual.date::date)
            = date_trunc('month', pending_plan_matches.pending_transaction_date)
      )
    )
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

drop policy if exists "pending plan matches: pro editors update"
  on public.pending_plan_matches;

create policy "pending plan matches: pro editors update"
on public.pending_plan_matches for update to authenticated
using (
  public.is_household_editor(household_id)
  and exists (
    select 1
    from public.household_plans plan
    where plan.household_id = pending_plan_matches.household_id
      and plan.tier = 'pro'
  )
)
with check (
  public.is_household_editor(household_id)
  and status in ('active', 'cancelled')
  and (
    status = 'cancelled'
    or (
      (
        target_type = 'bill'
        and exists (
          select 1
          from public.bills bill
          where bill.id = pending_plan_matches.target_id
            and bill.household_id = pending_plan_matches.household_id
        )
      )
      or (
        target_type = 'manual'
        and exists (
          select 1
          from public.transactions manual
          where manual.id = pending_plan_matches.target_id
            and manual.household_id = pending_plan_matches.household_id
            and manual.budget_id is not distinct from pending_plan_matches.budget_id
            and manual.source is distinct from 'plaid'
            and manual.amount < 0
            and manual.pending is not true
            and manual.removed_at is null
            and manual.deleted_at is null
            and manual.import_hash is null
            and manual.transfer_group_id is null
            and manual.linked_bill_id is null
            and manual.linked_plan_id is null
            and manual.review_status is distinct from 'matched'
            and manual.category is distinct from 'Transfer'
            and date_trunc('month', manual.date::date)
              = date_trunc('month', pending_plan_matches.pending_transaction_date)
        )
      )
    )
  )
  and exists (
    select 1
    from public.household_plans plan
    where plan.household_id = pending_plan_matches.household_id
      and plan.tier = 'pro'
  )
  and (
    status = 'cancelled'
    or exists (
      select 1
      from public.plaid_transactions pt
      where pt.household_id = pending_plan_matches.household_id
        and pt.plaid_transaction_id = pending_plan_matches.pending_plaid_transaction_id
        and pt.pending = true
        and pt.removed_at is null
    )
  )
);

create or replace function private.cancel_pending_matches_for_removed_target()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id text := case when tg_op = 'DELETE' then old.id else new.id end;
  v_inactive boolean := tg_op = 'DELETE';
begin
  if tg_table_name = 'transactions' and tg_op <> 'DELETE' then
    v_inactive := new.removed_at is not null or new.deleted_at is not null;
    if new.match_reason = 'replaced_by_posted_transaction' then return new; end if;
  end if;
  if not v_inactive then return new; end if;

  update public.pending_plan_matches
  set status = 'cancelled', updated_at = now()
  where target_type = case when tg_table_name = 'transactions' then 'manual' else 'bill' end
    and target_id = v_id
    and status in ('active', 'ready_review');
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function private.cancel_pending_matches_for_removed_target()
  from public, anon, authenticated;

drop trigger if exists transactions_cancel_pending_manual_matches
  on public.transactions;
create trigger transactions_cancel_pending_manual_matches
after update of removed_at, deleted_at or delete on public.transactions
for each row execute function private.cancel_pending_matches_for_removed_target();

drop trigger if exists bills_cancel_pending_plan_matches
  on public.bills;
create trigger bills_cancel_pending_plan_matches
after delete on public.bills
for each row execute function private.cancel_pending_matches_for_removed_target();

-- A manual Activity row may already carry an audited debt application. Move
-- that reference to the posted bank row without touching the debt balance;
-- the original payment has already been applied. Store the bank row's prior
-- values inside its allocation so Undo can restore both records exactly.
create or replace function private.transfer_manual_activity_metadata()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_manual public.transactions%rowtype;
  v_restore jsonb;
begin
  if new.review_resolution = 'manual'
    and old.review_resolution is distinct from 'manual' then
    select * into v_manual
    from public.transactions
    where id = new.linked_plan_id
      and household_id is not distinct from new.household_id
      and budget_id is not distinct from new.budget_id
      and source is distinct from 'plaid';
    if not found then raise exception 'Manual Activity entry was not found'; end if;

    if v_manual.debt_applied_bill_id is not null and not exists (
      select 1
      from public.bills debt
      where debt.id = v_manual.debt_applied_bill_id
        and debt.household_id is not distinct from new.household_id
        and debt.is_debt = true
    ) then
      raise exception 'The manual debt application is no longer valid';
    end if;

    v_restore := jsonb_build_object(
      'note', old.note,
      'debtAppliedAmount', old.debt_applied_amount,
      'debtAppliedBillId', old.debt_applied_bill_id,
      'userEditedAt', old.user_edited_at
    );
    if jsonb_array_length(coalesce(new.review_allocations, '[]'::jsonb)) > 0 then
      new.review_allocations := jsonb_set(
        new.review_allocations,
        '{0,restoreBankActivity}',
        v_restore,
        true
      );
    end if;
    new.note := coalesce(nullif(btrim(v_manual.note), ''), new.note);
    new.debt_applied_amount := coalesce(v_manual.debt_applied_amount, 0);
    new.debt_applied_bill_id := v_manual.debt_applied_bill_id;
    new.user_edited_at := now();
  elsif old.review_resolution = 'manual'
    and new.review_resolution is distinct from 'manual' then
    v_restore := old.review_allocations->0->'restoreBankActivity';
    if v_restore is not null then
      new.note := coalesce(v_restore->>'note', '');
      new.debt_applied_amount := coalesce((v_restore->>'debtAppliedAmount')::numeric, 0);
      new.debt_applied_bill_id := nullif(v_restore->>'debtAppliedBillId', '');
      new.user_edited_at := case
        when v_restore->>'userEditedAt' is null then null
        else (v_restore->>'userEditedAt')::timestamptz
      end;
    else
      new.debt_applied_amount := 0;
      new.debt_applied_bill_id := null;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.transfer_manual_activity_metadata()
  from public, anon, authenticated;

drop trigger if exists transactions_transfer_manual_activity_metadata
  on public.transactions;
create trigger transactions_transfer_manual_activity_metadata
before update of review_resolution on public.transactions
for each row execute function private.transfer_manual_activity_metadata();

comment on column public.pending_plan_matches.target_type is
  'Provisional match target: a planned bill occurrence or an existing manual Activity row.';

notify pgrst, 'reload schema';
