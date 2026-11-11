\set ON_ERROR_STOP on
-- Reuse the prior, trusted fake schema/roles/records, not its test mutations.
\ir ../account-forecasts/fixture.sql
\ir ../../../supabase/migrations/20261111155130_account_forecasts_and_savings_apy.sql
\ir current-helpers.sql

create table test.flow_before_rows(table_name text primary key,rows jsonb);
do $$declare tab text;begin
 foreach tab in array array['accounts','plaid_accounts','household_settings','bills','incomes','goals','extra_payments','transactions','decisions','pending_plan_matches'] loop
 execute format('insert into test.flow_before_rows select %L,coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),''[]''::jsonb) from public.%I t',tab,tab);
 end loop;
end$$;
create table test.flow_before_policies as select * from pg_policies where schemaname='public' and tablename in('accounts','plaid_accounts');
