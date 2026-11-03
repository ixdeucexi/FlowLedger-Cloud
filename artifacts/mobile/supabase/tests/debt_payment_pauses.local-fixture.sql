-- LOCAL ONLY. Synthetic data and auth.uid stub for the no-network disposable
-- PostgreSQL container. Never execute this against Supabase or any existing DB.
do $$ begin
  if current_database()<>'flowledger_pause_tests'
    or exists(select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
      where n.nspname in ('public','auth','private') and c.relkind in ('r','p')) then
    raise exception 'Refusing fixture setup outside the empty disposable test database';
  end if;
end $$;
create role anon;
create role authenticated;
create role service_role bypassrls;
create schema auth;
create schema private;
grant usage on schema public,auth,private to authenticated,service_role;
create function auth.uid() returns uuid language sql stable security invoker set search_path='' as $$
  select nullif(current_setting('test.actor_id',true),'')::uuid
$$;
create table auth.users(id uuid primary key);
create table public.households(id uuid primary key);
create table public.budgets(id uuid primary key,household_id uuid,is_default boolean);
create table public.household_members(household_id uuid,user_id uuid,role text);
create table public.user_preferences(user_id uuid,active_household_id uuid);
create function private.is_household_member(p_household uuid) returns boolean
language sql stable security invoker set search_path='' as $$
  select exists(select 1 from public.household_members where household_id=p_household and user_id=auth.uid())
$$;
create function private.is_household_editor(p_household uuid) returns boolean
language sql stable security invoker set search_path='' as $$
  select exists(select 1 from public.household_members where household_id=p_household and user_id=auth.uid() and role in ('owner','manager','editor'))
$$;
create function public.is_household_editor(p_household uuid) returns boolean
language sql stable security invoker set search_path='' as $$select private.is_household_editor(p_household)$$;
create table public.bills (
  id text not null primary key,
  user_id uuid not null,
  name text not null,
  amount numeric not null default 0,
  category text not null default 'Other'::text,
  priority integer not null default 0,
  is_debt boolean not null default false,
  balance numeric not null default 0,
  interest_rate numeric not null default 0,
  due_day integer not null default 1,
  day_of_week integer,
  start_date text,
  end_date text,
  is_recurring boolean not null default true,
  frequency text not null default 'monthly'::text,
  created_at text not null,
  include_in_snowball boolean not null default true,
  household_id uuid,
  budget_id uuid,
  last_reviewed_at timestamp with time zone not null default now(),
  snowball_minimum_boost numeric not null default 0,
  smart_priority text not null default 'must'::text,
  next_payment_date text,
  plaid_account_record_id uuid,
  plaid_account_id text,
  plaid_persistent_account_id text,
  plaid_last_synced_at timestamp with time zone
);
create table public.monthly_overrides(
  id text primary key,user_id uuid,household_id uuid,budget_id uuid,bill_id text,month integer,year integer,
  custom_amount numeric,custom_due_day integer,paid_amount numeric default 0,actual_amount numeric,paid_date date
);
create table public.accounts(id text,name text,household_id uuid,budget_id uuid,is_active boolean);
create table public.incomes(id text,user_id uuid,household_id uuid,budget_id uuid,name text);
create table public.goals(id text,user_id uuid,household_id uuid,budget_id uuid,name text);
create table public.transactions(id text,user_id uuid,household_id uuid,budget_id uuid,
  linked_bill_id text,debt_applied_bill_id text,linked_income_id text,linked_plan_id text,linked_plan_type text,
  review_allocations jsonb,debt_applied_amount numeric,deleted_at timestamptz,deleted_by uuid,user_edited_at timestamptz);
create table public.bill_date_moves(id text,bill_id text);
create table public.transaction_reconciliations(id text,household_id uuid,budget_id uuid,target_id text);
create table private.planned_reconciliation_bases(target_type text,target_id text);
create table private.flo_creation_receipts(actor_id uuid,household_id uuid,budget_id uuid,created_at timestamptz,receipt jsonb);
create table public.pause_test_boost_calls(household_id uuid);
create table public.pause_test_state(key text primary key,value jsonb);
create function public.recalculate_debt_minimum_boosts(p_household uuid) returns void
language sql security invoker set search_path='' as $$insert into public.pause_test_boost_calls values(p_household)$$;
alter table public.bills enable row level security;
create policy "bills: authenticated read" on public.bills for select to authenticated using (
  ((household_id is null and user_id=(select auth.uid()))
    or (household_id is not null and (select private.is_household_member(bills.household_id))))
);
create policy "bills: authenticated insert" on public.bills for insert to authenticated with check (
  ((household_id is null and user_id=(select auth.uid()))
    or (household_id is not null and (select private.is_household_editor(bills.household_id))))
);
create policy "bills: authenticated update" on public.bills for update to authenticated using (
  ((household_id is null and user_id=(select auth.uid()))
    or (household_id is not null and (select private.is_household_editor(bills.household_id))))
) with check (
  ((household_id is null and user_id=(select auth.uid()))
    or (household_id is not null and (select private.is_household_editor(bills.household_id))))
);
create policy "bills: authenticated delete" on public.bills for delete to authenticated using (
  ((household_id is null and user_id=(select auth.uid()))
    or (household_id is not null and (select private.is_household_editor(bills.household_id))))
);
alter table public.monthly_overrides enable row level security;
create policy "override fixture read" on public.monthly_overrides for select to authenticated
  using (private.is_household_member(household_id));
create policy "override fixture insert" on public.monthly_overrides for insert to authenticated
  with check (private.is_household_editor(household_id));
create policy "override fixture update" on public.monthly_overrides for update to authenticated
  using (private.is_household_editor(household_id)) with check (private.is_household_editor(household_id));
grant select,insert,update,delete on all tables in schema public to authenticated,service_role;
-- All identities below are constants for this disposable database.
insert into auth.users values
  ('11111111-1111-1111-1111-111111111111'),
  ('22222222-2222-2222-2222-222222222222'),
  ('33333333-3333-3333-3333-333333333333');
insert into public.households values('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
insert into public.budgets values
  ('cccccccc-cccc-cccc-cccc-cccccccccccc','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',true),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',true);
insert into public.household_members values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111','owner'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','22222222-2222-2222-2222-222222222222','viewer'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','33333333-3333-3333-3333-333333333333','owner');
insert into public.user_preferences values
  ('11111111-1111-1111-1111-111111111111','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('22222222-2222-2222-2222-222222222222','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('33333333-3333-3333-3333-333333333333','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
