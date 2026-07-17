-- Keep unauthenticated callers away from household security helpers while
-- retaining the grants required by authenticated RLS policies and RPCs.
revoke execute on function public.household_activity_audit_trigger() from public, anon, authenticated, service_role;

revoke execute on function public.household_role(uuid) from public, anon;
revoke execute on function public.is_household_editor(uuid) from public, anon;
revoke execute on function public.is_household_manager(uuid) from public, anon;
revoke execute on function public.is_household_member(uuid) from public, anon;
revoke execute on function public.revoke_household_invite(uuid) from public, anon;

grant execute on function public.household_role(uuid) to authenticated, service_role;
grant execute on function public.is_household_editor(uuid) to authenticated, service_role;
grant execute on function public.is_household_manager(uuid) to authenticated, service_role;
grant execute on function public.is_household_member(uuid) to authenticated, service_role;
grant execute on function public.revoke_household_invite(uuid) to authenticated, service_role;

-- Evaluate auth.uid() once per statement and make the intended authenticated
-- audience explicit. Conditions are otherwise unchanged.
drop policy if exists "diagnostics: user inserts" on public.app_diagnostics;
create policy "diagnostics: user inserts"
on public.app_diagnostics for insert to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "diagnostics: user reads" on public.app_diagnostics;
create policy "diagnostics: user reads"
on public.app_diagnostics for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "budgets: member reads" on public.budgets;
create policy "budgets: member reads"
on public.budgets for select to authenticated
using (
  exists (
    select 1
    from public.household_members hm
    where hm.household_id = budgets.household_id
      and hm.user_id = (select auth.uid())
  )
);

drop policy if exists "flo memory: user owns row" on public.flo_memory;
create policy "flo memory: user owns row"
on public.flo_memory for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "members: user reads membership" on public.household_members;
create policy "members: user reads membership"
on public.household_members for select to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "households: owner reads" on public.households;
create policy "households: owner reads"
on public.households for select to authenticated
using (created_by = (select auth.uid()));

-- These legacy per-command policies duplicate the optimized ownership policy.
drop policy if exists "Users can insert their own preferences" on public.user_preferences;
drop policy if exists "Users can read their own preferences" on public.user_preferences;
drop policy if exists "Users can update their own preferences" on public.user_preferences;
drop policy if exists "user preferences: user owns row" on public.user_preferences;
create policy "user preferences: user owns row"
on public.user_preferences for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

-- Household-scoped screens filter these tables on every load. Index both the
-- foreign keys and the transaction date used by the reconciliation inbox.
create index if not exists accounts_household_active_idx
  on public.accounts (household_id, is_active);
create index if not exists bills_household_idx
  on public.bills (household_id);
create index if not exists incomes_household_idx
  on public.incomes (household_id);
create index if not exists monthly_overrides_household_idx
  on public.monthly_overrides (household_id);
create index if not exists transactions_household_date_idx
  on public.transactions (household_id, date desc);
create index if not exists plaid_accounts_household_active_idx
  on public.plaid_accounts (household_id, is_active);
