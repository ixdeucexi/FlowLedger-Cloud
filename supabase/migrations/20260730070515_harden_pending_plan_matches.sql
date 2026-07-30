-- Keep client updates within the same household/source identity and reserve
-- posted/review lifecycle transitions for the trusted sync path.

create or replace function public.protect_pending_plan_match_identity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if new.user_id is distinct from old.user_id
    or new.household_id is distinct from old.household_id
    or new.budget_id is distinct from old.budget_id
    or new.pending_plaid_transaction_id is distinct from old.pending_plaid_transaction_id
    or new.pending_account_id is distinct from old.pending_account_id
    or new.pending_amount is distinct from old.pending_amount
    or new.pending_transaction_date is distinct from old.pending_transaction_date
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at
  then
    raise exception 'Pending payment source identity cannot be changed';
  end if;

  if coalesce((select auth.role()), '') <> 'service_role'
    and (
      new.posted_transaction_id is distinct from old.posted_transaction_id
      or new.posted_plaid_transaction_id is distinct from old.posted_plaid_transaction_id
      or new.posted_amount is distinct from old.posted_amount
    )
  then
    raise exception 'Posted payment details can only be changed by the trusted sync path';
  end if;

  return new;
end;
$function$;

revoke all on function public.protect_pending_plan_match_identity()
  from public, anon, authenticated;

drop trigger if exists pending_plan_matches_protect_identity
  on public.pending_plan_matches;
create trigger pending_plan_matches_protect_identity
before update on public.pending_plan_matches
for each row
execute function public.protect_pending_plan_match_identity();

drop policy "pending plan matches: pro editors update"
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
  and exists (
    select 1
    from public.bills bill
    where bill.id = pending_plan_matches.target_id
      and bill.household_id = pending_plan_matches.household_id
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
