-- A pending Plaid charge can be tentatively connected to one planned
-- occurrence without turning it into posted spending or a paid bill.
create table public.pending_plan_matches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  budget_id uuid references public.budgets(id) on delete set null,
  pending_plaid_transaction_id text not null,
  pending_account_id text,
  target_type text not null default 'bill'
    check (target_type in ('bill')),
  target_id text not null references public.bills(id) on delete cascade,
  target_name text not null,
  occurrence_date date not null,
  planned_amount numeric not null check (planned_amount >= 0),
  pending_amount numeric not null check (pending_amount >= 0),
  pending_transaction_date date not null,
  status text not null default 'active'
    check (status in ('active', 'ready_review', 'completed', 'expired', 'cancelled')),
  posted_transaction_id text references public.transactions(id) on delete set null,
  posted_plaid_transaction_id text,
  posted_amount numeric check (posted_amount is null or posted_amount >= 0),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, pending_plaid_transaction_id)
);

create index pending_plan_matches_occurrence_idx
  on public.pending_plan_matches (household_id, target_id, occurrence_date)
  where status in ('active', 'ready_review');

create index pending_plan_matches_posted_idx
  on public.pending_plan_matches (posted_transaction_id)
  where posted_transaction_id is not null;

alter table public.pending_plan_matches enable row level security;

create policy "pending plan matches: members read"
on public.pending_plan_matches for select to authenticated
using (public.is_household_member(household_id));

create policy "pending plan matches: pro editors insert"
on public.pending_plan_matches for insert to authenticated
with check (
  user_id = auth.uid()
  and created_by = auth.uid()
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
);

create policy "pending plan matches: pro editors delete"
on public.pending_plan_matches for delete to authenticated
using (
  public.is_household_editor(household_id)
  and exists (
    select 1
    from public.household_plans plan
    where plan.household_id = pending_plan_matches.household_id
      and plan.tier = 'pro'
  )
);

grant select, insert, update, delete on public.pending_plan_matches to authenticated;

create or replace function public.sync_pending_plan_match_review_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.review_status in ('matched', 'categorized', 'transfer') then
    update public.pending_plan_matches
    set status = 'completed',
        updated_at = now()
    where posted_transaction_id = new.id
      and status = 'ready_review';
  elsif new.review_status = 'needs_review' then
    update public.pending_plan_matches
    set status = 'ready_review',
        updated_at = now()
    where posted_transaction_id = new.id
      and status = 'completed';
  end if;
  return new;
end
$$;

revoke all on function public.sync_pending_plan_match_review_status() from public, anon, authenticated;

drop trigger if exists transactions_sync_pending_plan_match_review_status on public.transactions;
create trigger transactions_sync_pending_plan_match_review_status
after update of review_status on public.transactions
for each row
when (old.review_status is distinct from new.review_status)
execute function public.sync_pending_plan_match_review_status();

comment on table public.pending_plan_matches is
  'Temporary Pro-only links between pending Plaid charges and planned bill occurrences. These links never mark bills paid or add posted spending.';
