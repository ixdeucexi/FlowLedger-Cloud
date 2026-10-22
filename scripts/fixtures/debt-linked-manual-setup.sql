\set ON_ERROR_STOP on
begin;
create schema auth;
create schema private;
create role authenticated;
create role anon;
create role service_role;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create table public.test_members (user_id uuid, household_id uuid, role text);
create function public.is_household_editor(p_household uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.test_members where user_id=auth.uid() and household_id=p_household and role='editor')$$;
create function public.is_household_member(p_household uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.test_members where user_id=auth.uid() and household_id=p_household)$$;
create table public.household_plans(household_id uuid primary key,tier text);
create function private.has_review_center_entitlement(p_household uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.household_plans where household_id=p_household and tier='pro')$$;
-- Only the unrelated minimum-boost calculation is stubbed; actual payment
-- accounting is the unmodified sync_due_debt_transactions function below.
create function public.recalculate_debt_minimum_boosts(uuid) returns void language sql as $$select$$;
create table public.bills(id text primary key, user_id uuid, household_id uuid, budget_id uuid, is_debt boolean, balance numeric, snowball_minimum_boost numeric default 0);
create table public.transactions(
 id text primary key, user_id uuid, household_id uuid, budget_id uuid,
 date text, amount numeric, category text, note text default '', source text default 'manual',
 pending boolean default false, removed_at timestamptz, deleted_at timestamptz,
 import_hash text, transfer_group_id text, linked_bill_id text, linked_income_id text,
 linked_plan_id text, linked_plan_type text, debt_applied_bill_id text, debt_applied_amount numeric default 0,
 review_status text, review_resolution text, review_allocations jsonb default '[]',
 matched_occurrence_date date, match_confidence numeric, match_reason text,
 reviewed_at timestamptz, reviewed_by uuid, user_edited_at timestamptz
);
create table public.transaction_reconciliations(transaction_id text primary key, user_id uuid, household_id uuid,budget_id uuid,resolution text,target_id text,occurrence_date date,settlement text,planned_amount numeric,allocations jsonb,restore_snapshot jsonb,reviewed_by uuid,reviewed_at timestamptz,updated_at timestamptz);
create unique index transaction_reconciliations_one_manual_target on public.transaction_reconciliations(target_id) where resolution='manual' and target_id is not null;
create table public.plaid_transactions(plaid_transaction_id text primary key, household_id uuid,pending boolean,removed_at timestamptz);
create table public.pending_plan_matches(id text primary key,user_id uuid,created_by uuid,household_id uuid,budget_id uuid,target_type text,target_id text,pending_plaid_transaction_id text,pending_transaction_date date,status text);
alter table public.pending_plan_matches enable row level security;
alter table public.transactions enable row level security;
alter table public.bills enable row level security;
create policy tx_scope on public.transactions to authenticated using(public.is_household_member(household_id)) with check(public.is_household_editor(household_id));
create policy bills_scope on public.bills to authenticated using(public.is_household_member(household_id)) with check(public.is_household_editor(household_id));
create policy pending_read on public.pending_plan_matches for select to authenticated using(public.is_household_member(household_id));
create policy "pending plan matches: pro editors insert" on public.pending_plan_matches for insert to authenticated with check(false);
create policy "pending plan matches: pro editors update" on public.pending_plan_matches for update to authenticated using(false) with check(false);
grant usage on schema public,private,auth to authenticated;
grant select,insert,update on public.transactions,public.bills,public.pending_plan_matches to authenticated;
grant select on public.plaid_transactions,public.household_plans to authenticated;
create function public.assert_true(ok boolean, label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; end$$;
create function public.assert_rejected(statement text,label text) returns void language plpgsql as $$begin begin execute statement; exception when others then raise notice 'Rejected as expected: % (%)',label,sqlerrm; return; end; raise exception 'FAIL accepted: %',label; end$$;
insert into test_members values('11111111-1111-1111-1111-111111111111','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','editor'),('22222222-2222-2222-2222-222222222222','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','viewer');
insert into household_plans values('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','pro'),('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','pro');
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
