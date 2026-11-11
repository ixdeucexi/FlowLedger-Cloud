\set ON_ERROR_STOP on
-- Only reusable fictional schema/data; never connects to a hosted project.
\ir ../account-forecasts/fixture.sql
\ir ../../../supabase/migrations/20261111155130_account_forecasts_and_savings_apy.sql
\ir ../account-flow-repair/current-helpers.sql
\ir ../../../supabase/migrations/20261111172633_account_flow_names_and_assignment_setup.sql
\ir current-helpers.sql
create table test.transfer_before_rows(table_name text primary key,rows jsonb);
do $$declare tab text;begin
 foreach tab in array array['accounts','plaid_accounts','household_settings','bills','incomes','goals','extra_payments','transactions','decisions','pending_plan_matches','account_balances','plaid_transactions','transaction_reconciliations'] loop
 execute format('insert into test.transfer_before_rows select %L,coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),''[]''::jsonb) from public.%I t',tab,tab);
 end loop;
end$$;
create table test.transfer_before_policies as select * from pg_policies where schemaname='public' and tablename not in('planned_account_transfers','planned_account_transfer_occurrences');
