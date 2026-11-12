\set ON_ERROR_STOP on
\ir ../account-planned-transfers/fixture.sql
-- Schema metadata only, aligned to existing hosted table. All rows are fake.
create table public.bill_date_moves (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),bill_id text not null,
 from_date date not null,to_date date not null,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 household_id uuid,budget_id uuid,move_reason text not null default 'manual',custom_amount numeric,is_skipped boolean not null default false
);
alter table public.bill_date_moves enable row level security;
create policy fixture_moves on public.bill_date_moves to authenticated
 using(private.is_household_member(household_id)) with check(private.is_household_editor(household_id));
grant select,insert,update,delete on public.bill_date_moves to authenticated;
insert into public.household_settings(household_id,budget_id,time_zone) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','America/Chicago')
 on conflict(household_id) do update set time_zone=excluded.time_zone;
create function test.local_today() returns date language sql stable as $$select (now() at time zone 'America/Chicago')::date$$;
create function test.cutover() returns date language sql stable as $$select (date_trunc('month',test.local_today()::timestamp)+interval '1 month')::date$$;
create function test.conversion_id(b text) returns text language sql immutable as $$select 'bill-transfer-'||md5('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1:'||b)$$;
create function test.expected(b text) returns jsonb language sql stable as $$
 select jsonb_object_agg(f,to_jsonb(t)->f)||jsonb_build_object('day_of_week',coalesce(t.day_of_week,0)) from public.bills t, unnest(array['name','amount','category','priority','is_debt','balance','interest_rate','due_day','day_of_week','next_payment_date','start_date','end_date','is_recurring','frequency','smart_priority','include_in_snowball','debt_payment_pauses','funding_account_ref']) f where t.id=b group by t.day_of_week
$$;
create function test.conversion_patch() returns jsonb language sql stable as $$select jsonb_build_object('name','FAKE Kids transfer','amount',50,'from_account_ref','bank:00000000-0000-4000-8000-000000000001','to_account_ref','bank:00000000-0000-4000-8000-000000000003','frequency','monthly','start_date',test.cutover(),'end_date',null,'status','active')$$;
create function test.convert(b text,e jsonb default null,p jsonb default null) returns jsonb language sql volatile as $$select public.convert_bill_to_planned_transfer('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',b,coalesce(e,test.expected(b)),coalesce(p,test.conversion_patch()))$$;
create function test.source(b text) returns void language plpgsql as $$begin
 insert into public.bills(id,user_id,household_id,budget_id,name,amount,category,due_day,start_date,created_at,funding_account_ref)
 values(b,'11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','FAKE Kids transfer',50,'Other',4,(date_trunc('month',test.local_today()::timestamp)-interval '4 months')::date::text,'fixture','bank:00000000-0000-4000-8000-000000000001');
 insert into public.monthly_overrides(id,user_id,household_id,budget_id,bill_id,month,year,paid_amount,paid_date)
 select b||'-'||d::date,'11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',b,extract(month from d)::int-1,extract(year from d)::int,50,least((d::date+3),test.local_today())
 from generate_series(date_trunc('month',test.local_today()::timestamp)-interval '4 months',date_trunc('month',test.local_today()::timestamp),interval '1 month') d;
end;$$;
create table test.conversion_baselines(id text primary key,expected jsonb not null);
grant select,insert,update,delete on test.conversion_baselines to authenticated;

create function test.plan_for(b text) returns jsonb language sql stable as $$
 select value from jsonb_array_elements(public.get_planned_account_transfer_data('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1')->'transfers') where value->>'id'=test.conversion_id(b)
$$;
\ir delete-bill-current.sql
-- Actual existing parent actions, absent from the older narrow fixture.
alter table public.bills add constraint bills_household_id_fkey foreign key(household_id) references households(id) on delete set null;
alter table public.bills add constraint bills_budget_id_fkey foreign key(budget_id) references budgets(id) on delete set null;
alter table public.bills add constraint bills_user_id_fkey foreign key(user_id) references auth.users(id) on delete cascade;
alter table public.bills add constraint bills_household_member_owner_fkey foreign key(household_id,user_id) references household_members(household_id,user_id) deferrable initially deferred;
alter table public.households add constraint households_created_by_fkey foreign key(created_by) references auth.users(id) on delete cascade;
alter table public.household_members add constraint household_members_household_id_fkey foreign key(household_id) references households(id) on delete cascade;
alter table public.household_members add constraint household_members_user_id_fkey foreign key(user_id) references auth.users(id) on delete cascade;
create table test.delete_logs(label text);
create function public.log_household_activity(uuid,text,text,text,text,uuid) returns void language sql volatile as $$insert into test.delete_logs values('fake logger')$$;
grant insert,select on test.delete_logs to authenticated;
create function test.delete_checked(b text) returns void language plpgsql as $$begin
 perform public.delete_bill_completely(b,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
 set constraints planned_account_transfers_source_bill_fkey immediate;
end$$;
create function test.recreate_source() returns void language plpgsql as $$begin
 delete from public.bills where id='clean';
 insert into public.bills(id,user_id,household_id,budget_id,name,amount,due_day,created_at)
 values('clean','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','Recreated active source',50,4,'fixture');
end$$;
-- Minimal, empty schema-only dependencies for exact existing account cleanup.
create schema extensions;
create function extensions.digest(bytea,text) returns bytea language sql immutable as $$select public.digest($1,$2)$$;
alter table public.plaid_items add column status text not null default 'active',add column encrypted_access_token text,add column access_token_ciphertext text;
create table private.account_deletion_receipts(receipt_id uuid primary key default gen_random_uuid(),user_id_hash text unique not null,status text not null,requested_at timestamptz not null default now(),data_deleted_at timestamptz default now(),auth_deleted_at timestamptz,plaid_items_revoked int not null default 0,owned_households_deleted int not null default 0,memberships_removed int not null default 0);
create table public.categories(id text,household_id uuid,budget_id uuid,user_id uuid);
create table public.category_budgets(id text,household_id uuid,budget_id uuid,user_id uuid);
create table public.subscription_bill_links(id text,household_id uuid,budget_id uuid,user_id uuid);
\ir lifecycle-current.sql

\ir actual-evidence-policies.sql
-- Refresh pre-migration fixture baselines after adding this task's fake settings
-- and existing-schema move table. This is not application data migration.
truncate test.transfer_before_rows;
do $$declare tab text;begin
 foreach tab in array array['accounts','plaid_accounts','household_settings','bills','incomes','goals','extra_payments','transactions','decisions','pending_plan_matches','account_balances','plaid_transactions','transaction_reconciliations','bill_date_moves'] loop
 execute format('insert into test.transfer_before_rows select %L,coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),''[]''::jsonb) from public.%I t',tab,tab);
 end loop;
end$$;
truncate test.transfer_before_policies;
insert into test.transfer_before_policies select * from pg_policies where schemaname='public';
