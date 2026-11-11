\set ON_ERROR_STOP on

create extension if not exists pgcrypto;

do $$ begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if; if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if; if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if; end $$;

create schema auth;create schema private;create schema test;

grant usage on schema auth,private,public,test to anon,authenticated,service_role;

create table auth.users(id uuid primary key);

create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;

grant execute on function auth.uid() to anon,authenticated,service_role;

create function auth.role() returns text language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),'authenticated')$$;

create table public.plaid_items(id uuid primary key,user_id uuid,household_id uuid,access_token text);

set check_function_bodies=off;

create table public."accounts"("id" text not null,"user_id" uuid not null,"household_id" uuid,"budget_id" uuid,"name" text not null,"account_type" text not null,"current_balance" numeric not null default 0,"balance_as_of" date not null default CURRENT_DATE,"last_reconciled_at" timestamp with time zone,"is_active" boolean not null default true,"created_at" timestamp with time zone not null default now(),"last_mutation_id" text,"last_mutation_intent" jsonb);

create table public."bills"("id" text not null,"user_id" uuid not null,"name" text not null,"amount" numeric not null default 0,"category" text not null default 'Other'::text,"priority" integer not null default 0,"is_debt" boolean not null default false,"balance" numeric not null default 0,"interest_rate" numeric not null default 0,"due_day" integer not null default 1,"day_of_week" integer,"start_date" text,"end_date" text,"is_recurring" boolean not null default true,"frequency" text not null default 'monthly'::text,"created_at" text not null,"include_in_snowball" boolean not null default true,"household_id" uuid,"budget_id" uuid,"last_reviewed_at" timestamp with time zone not null default now(),"snowball_minimum_boost" numeric not null default 0,"smart_priority" text not null default 'must'::text,"next_payment_date" text,"plaid_account_record_id" uuid,"plaid_account_id" text,"plaid_persistent_account_id" text,"plaid_last_synced_at" timestamp with time zone,"debt_payment_pauses" jsonb not null default '[]'::jsonb);

create table public."decisions"("id" text not null,"user_id" uuid not null,"household_id" uuid,"budget_id" uuid,"name" text not null,"decision_type" text not null,"scenario" jsonb not null,"result" jsonb not null,"status" text not null default 'saved'::text,"calendar_date" date,"applied_change" jsonb,"created_at" timestamp with time zone not null default now(),"updated_at" timestamp with time zone not null default now(),"remind_at" timestamp with time zone,"actual_amount" numeric,"completed_at" timestamp with time zone,"next_due_date" date);

create table public."extra_payments"("id" text not null,"user_id" uuid not null,"month" integer not null,"year" integer not null,"amount" numeric not null default 0,"allocations" jsonb not null default '[]'::jsonb,"payment_date" date,"sources" jsonb not null default '[]'::jsonb,"household_id" uuid,"budget_id" uuid);

create table public."goals"("id" text not null,"user_id" uuid not null,"name" text not null,"target_amount" numeric not null default 0,"target_date" text not null,"current_amount" numeric not null default 0,"created_at" text not null,"household_id" uuid,"budget_id" uuid,"goal_type" text not null default 'savings'::text,"closed_at" timestamp with time zone,"closed_by" uuid,"archived_at" timestamp with time zone,"archived_by" uuid);

create table public."household_settings"("household_id" uuid not null,"budget_id" uuid,"payment_method" text not null default 'snowball'::text,"starting_balance" numeric not null default 0,"starting_balance_date" text,"safety_floor" numeric not null default 200,"forecast_horizon_months" integer not null default 6,"onboarding_completed" boolean not null default false,"updated_at" timestamp with time zone not null default now(),"planning_mode" text not null default 'snowball'::text,"zero_based_budget_enabled" boolean not null default false,"debt_payoff_enabled" boolean not null default true,"calendar_start_date" text,"time_zone" text not null default 'UTC'::text,"automatic_rollover_started_on" date not null default CURRENT_DATE);

create table public."incomes"("id" text not null,"user_id" uuid not null,"name" text not null,"amount" numeric not null default 0,"frequency" text not null default 'monthly'::text,"start_date" text,"next_payment_date" text,"amount_history" jsonb not null default '[]'::jsonb,"household_id" uuid,"budget_id" uuid,"last_reviewed_at" timestamp with time zone not null default now(),"excluded_dates" jsonb not null default '[]'::jsonb);

create table public."pending_plan_matches"("id" uuid not null default gen_random_uuid(),"user_id" uuid not null,"household_id" uuid not null,"budget_id" uuid,"pending_plaid_transaction_id" text not null,"pending_account_id" text,"target_type" text not null default 'bill'::text,"target_id" text not null,"target_name" text not null,"occurrence_date" date not null,"planned_amount" numeric not null,"pending_amount" numeric not null,"pending_transaction_date" date not null,"status" text not null default 'active'::text,"posted_transaction_id" text,"posted_plaid_transaction_id" text,"posted_amount" numeric,"created_by" uuid not null,"created_at" timestamp with time zone not null default now(),"updated_at" timestamp with time zone not null default now());

create table public."plaid_accounts"("id" uuid not null default gen_random_uuid(),"user_id" uuid not null,"household_id" uuid not null,"plaid_item_id" uuid,"account_id" text,"flowledger_account_id" text,"plaid_account_id" text not null,"name" text not null,"mask" text,"type" text,"subtype" text,"current_balance" numeric,"available_balance" numeric,"created_at" timestamp with time zone not null default now(),"updated_at" timestamp with time zone not null default now(),"plaid_item_record_id" uuid not null,"persistent_account_id" text,"official_name" text,"account_type" text,"account_subtype" text,"credit_limit" numeric,"currency_code" text,"is_active" boolean not null default true,"minimum_payment_amount" numeric,"next_payment_due_date" date,"last_statement_balance" numeric,"last_statement_issue_date" date,"is_overdue" boolean,"purchase_apr" numeric,"liability_last_synced_at" timestamp with time zone,"display_name" text);

create table public."transactions"("id" text not null,"user_id" uuid not null,"date" text not null,"amount" numeric not null,"category" text not null default 'Other'::text,"note" text not null default ''::text,"linked_bill_id" text,"household_id" uuid,"budget_id" uuid,"account_id" text,"import_hash" text,"debt_applied_amount" numeric not null default 0,"debt_applied_bill_id" text,"source" text,"plaid_transaction_id" text,"plaid_account_id" text,"authorized_date" date,"merchant_name" text,"original_name" text,"pending" boolean not null default false,"payment_channel" text,"plaid_category_primary" text,"plaid_category_detailed" text,"iso_currency_code" text,"match_confidence" numeric,"match_reason" text,"removed_at" timestamp with time zone,"review_status" text not null default 'legacy_reviewed'::text,"review_resolution" text,"review_allocations" jsonb not null default '[]'::jsonb,"reviewed_at" timestamp with time zone,"reviewed_by" uuid,"linked_income_id" text,"linked_plan_id" text,"linked_plan_type" text,"matched_occurrence_date" date,"user_edited_at" timestamp with time zone,"deleted_at" timestamp with time zone,"deleted_by" uuid,"transfer_group_id" text);

create table public."account_balances"("id" text not null,"account_id" text not null,"user_id" uuid not null,"balance" numeric not null,"as_of_date" date not null,"source" text not null default 'manual'::text,"created_at" timestamp with time zone not null default now(),"household_id" uuid,"budget_id" uuid);

create table public."budgets"("id" uuid not null default gen_random_uuid(),"household_id" uuid not null,"name" text not null default 'Main Budget'::text,"is_default" boolean not null default true,"created_at" timestamp with time zone not null default now());

create table public."household_members"("household_id" uuid not null,"user_id" uuid not null,"role" text not null default 'owner'::text,"created_at" timestamp with time zone not null default now());

create table public."household_plans"("household_id" uuid not null,"tier" text not null default 'free'::text,"source" text not null default 'default'::text,"grandfathered_at" timestamp with time zone,"created_at" timestamp with time zone not null default now(),"updated_at" timestamp with time zone not null default now());

create table public."households"("id" uuid not null default gen_random_uuid(),"name" text not null default 'My Household'::text,"created_by" uuid not null,"is_personal" boolean not null default false,"created_at" timestamp with time zone not null default now());

create table public."monthly_overrides"("id" text not null,"user_id" uuid not null,"bill_id" text not null,"month" integer not null,"year" integer not null,"custom_amount" numeric,"custom_due_day" integer,"paid_amount" numeric not null default 0,"actual_amount" numeric,"paid_date" date,"household_id" uuid not null,"budget_id" uuid,"planned_debt_amount" numeric,"required_debt_amount" numeric);

create table public."settings"("user_id" uuid not null,"payment_method" text not null default 'snowball'::text,"starting_balance" numeric not null default 0,"starting_balance_date" text,"safety_floor" numeric not null default 200,"forecast_horizon_months" integer not null default 6,"onboarding_completed" boolean not null default false,"planning_mode" text not null default 'snowball'::text,"zero_based_budget_enabled" boolean not null default false,"debt_payoff_enabled" boolean not null default true,"calendar_start_date" text);

create table public."transaction_reconciliations"("transaction_id" text not null,"user_id" uuid not null,"household_id" uuid not null,"budget_id" uuid,"resolution" text not null,"target_id" text,"occurrence_date" date,"settlement" text,"planned_amount" numeric,"allocations" jsonb not null default '[]'::jsonb,"restore_snapshot" jsonb not null default '{}'::jsonb,"reviewed_by" uuid,"reviewed_at" timestamp with time zone not null default now(),"created_at" timestamp with time zone not null default now(),"updated_at" timestamp with time zone not null default now());

create table public."plaid_transactions"("id" uuid not null,"user_id" uuid not null,"household_id" uuid not null,"plaid_account_id" uuid not null,"transaction_id" text,"flowledger_transaction_id" text,"plaid_transaction_id" text not null,"transaction_date" date not null,"name" text not null,"amount" numeric not null,"category" text,"pending" boolean not null,"raw" jsonb not null,"created_at" timestamp with time zone not null,"updated_at" timestamp with time zone not null,"authorized_date" date,"merchant_name" text,"original_name" text,"payment_channel" text,"iso_currency_code" text,"removed_at" timestamp with time zone);

alter table public."accounts" add constraint "accounts_account_type_check" CHECK ((account_type = ANY (ARRAY['checking'::text, 'savings'::text, 'cash'::text, 'credit_card'::text])));

alter table public."accounts" add constraint "accounts_pkey" PRIMARY KEY (id);

alter table public."budgets" add constraint "budgets_pkey" PRIMARY KEY (id);

alter table public."household_settings" add constraint "household_settings_calendar_start_date_check" CHECK (((calendar_start_date IS NULL) OR (calendar_start_date ~ '^\d{4}-\d{2}-\d{2}$'::text)));

alter table public."household_settings" add constraint "household_settings_forecast_horizon_months_check" CHECK (((forecast_horizon_months >= 1) AND (forecast_horizon_months <= 24)));

alter table public."household_settings" add constraint "household_settings_payment_method_check" CHECK ((payment_method = ANY (ARRAY['snowball'::text, 'avalanche'::text])));

alter table public."household_settings" add constraint "household_settings_pkey" PRIMARY KEY (household_id);

alter table public."household_settings" add constraint "household_settings_planning_mode_check" CHECK ((planning_mode = ANY (ARRAY['snowball'::text, 'zero_budget'::text, 'free_flow'::text])));

alter table public."household_settings" add constraint "household_settings_safety_floor_check" CHECK ((safety_floor >= (0)::numeric));

alter table public."plaid_accounts" add constraint "plaid_accounts_display_name_check" CHECK (((display_name IS NULL) OR ((display_name = btrim(display_name)) AND ((char_length(display_name) >= 1) AND (char_length(display_name) <= 80)))));

alter table public."plaid_accounts" add constraint "plaid_accounts_pkey" PRIMARY KEY (id);

alter table public."plaid_accounts" add constraint "plaid_accounts_user_id_plaid_account_id_key" UNIQUE (user_id, plaid_account_id);

alter table public."bills" add primary key(id);

alter table public."decisions" add primary key(id);

alter table public."extra_payments" add primary key(id);

alter table public."goals" add primary key(id);

alter table public."incomes" add primary key(id);

alter table public."pending_plan_matches" add primary key(id);

alter table public."transactions" add primary key(id);

alter table public."account_balances" add primary key(id);

alter table public."household_members" add primary key(household_id,user_id);

alter table public."household_plans" add primary key(household_id);

alter table public."households" add primary key(id);

alter table public."monthly_overrides" add primary key(id);

alter table public."settings" add primary key(user_id);

alter table public."transaction_reconciliations" add primary key(transaction_id);

alter table public."plaid_transactions" add primary key(id);

alter table public.pending_plan_matches add unique(household_id,pending_plaid_transaction_id);alter table public.monthly_overrides add unique(household_id,bill_id,month,year);

alter table public."accounts" add constraint "accounts_budget_id_fkey" FOREIGN KEY (budget_id) REFERENCES budgets(id) ON DELETE SET NULL;

alter table public."accounts" add constraint "accounts_household_id_fkey" FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE SET NULL;

alter table public."accounts" add constraint "accounts_household_member_owner_fkey" FOREIGN KEY (household_id, user_id) REFERENCES household_members(household_id, user_id) DEFERRABLE INITIALLY DEFERRED;

alter table public."accounts" add constraint "accounts_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table public."budgets" add constraint "budgets_household_id_fkey" FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE;

alter table public."household_settings" add constraint "household_settings_budget_id_fkey" FOREIGN KEY (budget_id) REFERENCES budgets(id) ON DELETE SET NULL;

alter table public."household_settings" add constraint "household_settings_household_id_fkey" FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE;

alter table public."plaid_accounts" add constraint "plaid_accounts_account_id_fkey" FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL;

alter table public."plaid_accounts" add constraint "plaid_accounts_flowledger_account_id_fkey" FOREIGN KEY (flowledger_account_id) REFERENCES accounts(id) ON DELETE SET NULL;

alter table public."plaid_accounts" add constraint "plaid_accounts_household_id_fkey" FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE;

alter table public."plaid_accounts" add constraint "plaid_accounts_plaid_item_id_fkey" FOREIGN KEY (plaid_item_id) REFERENCES plaid_items(id) ON DELETE CASCADE;

alter table public."plaid_accounts" add constraint "plaid_accounts_plaid_item_record_id_fkey" FOREIGN KEY (plaid_item_record_id) REFERENCES plaid_items(id) ON DELETE CASCADE;

alter table public."plaid_accounts" add constraint "plaid_accounts_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table public.transactions add foreign key(account_id) references public.accounts(id);

create function private.is_household_member(p_household_id uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.household_members hm where hm.household_id=p_household_id and hm.user_id=auth.uid())$$;

create function public.is_household_member(p_household_id uuid) returns boolean language sql stable security invoker set search_path='' as $$select private.is_household_member(p_household_id)$$;

create function private.is_household_editor(p_household_id uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.household_members hm where hm.household_id=p_household_id and hm.user_id=auth.uid() and hm.role in ('owner','manager','editor'))$$;

create function public.is_household_editor(p_household_id uuid) returns boolean language sql stable security invoker set search_path='' as $$select private.is_household_editor(p_household_id)$$;

create function private.has_review_center_entitlement(p_household_id uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.household_plans where household_id=p_household_id and tier='pro')$$;

create function private.has_financial_transaction_reconciliation(p_transaction_id text,p_household_id uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.transaction_reconciliations where transaction_id=p_transaction_id and household_id=p_household_id and resolution not in ('category','transfer'))$$;

create function public.recalculate_debt_minimum_boosts(p_household_id uuid) returns void language plpgsql as $$begin return;end$$;

create table private.planned_reconciliation_bases(target_type text not null check(target_type in ('goal','decision')),target_id text not null,base_amount numeric not null default 0,base_status text,base_completed_at timestamptz,primary key(target_type,target_id));revoke all on private.planned_reconciliation_bases from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.add_bucket_purchase(p_bucket_id text, p_transaction_id text, p_expected_amount numeric, p_expected_date date, p_new_transaction jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_variable
declare
 actor uuid := auth.uid(); g public.goals%rowtype; t public.transactions%rowtype;
 r public.transaction_reconciliations%rowtype; prior jsonb; allocations jsonb; intent jsonb;
 actual numeric; account text; created boolean := false;
begin
 if actor is null then raise exception 'Sign in to add a purchase'; end if;
 if nullif(btrim(p_transaction_id),'') is null or length(p_transaction_id)>200 then raise exception 'A stable purchase id is required'; end if;
 if p_expected_amount is null or lower(p_expected_amount::text) in ('nan','infinity','-infinity') or p_expected_amount<=0 or p_expected_amount>1000000000 or round(p_expected_amount,2)<>p_expected_amount then raise exception 'Choose a positive purchase amount with at most two decimals'; end if;
 if p_expected_date is null then raise exception 'Choose a purchase date'; end if;
 perform pg_advisory_xact_lock(hashtextextended('bucket-purchase:'||p_transaction_id,0));
 select * into t from public.transactions where id=p_transaction_id for update;
 select * into g from public.goals where id=p_bucket_id for update;
 if not found or g.household_id is null or g.goal_type<>'planned_expense' then raise exception 'Spending bucket not found'; end if;
 if not private.is_household_editor(g.household_id) then raise exception 'You need household edit access to add a purchase'; end if;
 if not private.has_review_center_entitlement(g.household_id) then raise exception 'Bucket purchase matching is unavailable for this household'; end if;
 intent := jsonb_build_object('version',1,'bucketId',p_bucket_id,'amount',p_expected_amount,'date',p_expected_date,'newTransaction',p_new_transaction);
 select * into r from public.transaction_reconciliations where transaction_id=p_transaction_id for update;
 if r.transaction_id is not null and r.resolution='goal' and r.target_id=p_bucket_id and r.restore_snapshot->'bucketPurchaseIntent'=intent
   and t.household_id=g.household_id and t.budget_id is not distinct from g.budget_id
   and t.linked_plan_type='goal' and t.linked_plan_id=g.id and t.deleted_at is null and t.removed_at is null then
  return jsonb_build_object('transaction',to_jsonb(t),'goal',to_jsonb(g),'retry',true);
 end if;
 if g.closed_at is not null or g.archived_at is not null then raise exception 'Reopen this bucket before adding a purchase'; end if;
 if t.id is null then
  if p_new_transaction is null or jsonb_typeof(p_new_transaction)<>'object' then raise exception 'Transaction not found'; end if;
  if (p_new_transaction->>'amount')::numeric is distinct from -p_expected_amount or (p_new_transaction->>'date')::date is distinct from p_expected_date then raise exception 'The purchase details changed'; end if;
  if nullif(btrim(p_new_transaction->>'category'),'') is null or p_new_transaction->>'category'='Transfer' then raise exception 'Choose a purchase category'; end if;
  if length(coalesce(p_new_transaction->>'note',''))>2000 then raise exception 'Keep the purchase description under 2000 characters'; end if;
  account := nullif(p_new_transaction->>'account_id','');
  if account is not null and not exists(select 1 from public.accounts a where a.id=account and a.household_id=g.household_id and a.is_active) then raise exception 'Choose an active household account'; end if;
  insert into public.transactions(id,user_id,household_id,budget_id,date,amount,category,note,account_id,source,review_status)
   values(p_transaction_id,actor,g.household_id,g.budget_id,p_expected_date::text,-p_expected_amount,p_new_transaction->>'category',coalesce(p_new_transaction->>'note',''),account,'manual','legacy_reviewed') returning * into t;
  created:=true;
 elsif p_new_transaction is not null then
  raise exception 'That purchase id is already in use';
 end if;
 if t.household_id is distinct from g.household_id or t.budget_id is distinct from g.budget_id then raise exception 'Choose a transaction from this household plan'; end if;
 if t.pending is true or t.removed_at is not null or t.deleted_at is not null or t.amount>=0 or t.transfer_group_id is not null or t.category='Transfer'
  or t.linked_bill_id is not null or t.linked_income_id is not null or t.linked_plan_id is not null or t.debt_applied_bill_id is not null or coalesce(t.debt_applied_amount,0)<>0
  or t.review_status in ('matched','transfer') or (t.source is not null and t.source not in ('manual','plaid','statement')) then raise exception 'This transaction is already assigned or cannot be used as a purchase'; end if;
 if r.transaction_id is not null and r.resolution<>'category' then raise exception 'Undo the existing transaction match before using this bucket'; end if;
 if t.source='plaid' and not exists(select 1 from public.plaid_accounts a where a.household_id=g.household_id and (a.plaid_account_id=t.plaid_account_id or a.id::text=t.plaid_account_id) and lower(coalesce(a.account_type,a.type,'')) in ('depository','checking') and lower(coalesce(a.account_subtype,a.subtype,''))='checking') then raise exception 'Choose a posted checking-account transaction'; end if;
 actual:=round(abs(t.amount),2);
 if actual<>p_expected_amount or t.date::date<>p_expected_date then raise exception 'The transaction changed. Refresh and choose it again'; end if;
 if actual>g.target_amount-g.current_amount+0.005 then raise exception 'This purchase exceeds the money left. Adjust the bucket budget first'; end if;
 prior:=jsonb_build_object('category',t.category,'linkedBillId',t.linked_bill_id,'linkedIncomeId',t.linked_income_id,'linkedPlanId',t.linked_plan_id,'linkedPlanType',t.linked_plan_type,'matchConfidence',t.match_confidence,'matchReason',t.match_reason,
  'goalCurrentAmount',g.current_amount,'bucketPurchaseIntent',intent,'bucketPriorTransaction',to_jsonb(t),'bucketPriorReconciliation',case when r.transaction_id is null then null else to_jsonb(r) end,'bucketCreated',created);
 allocations:=jsonb_build_array(jsonb_build_object('type','planned_expense','source','goal','targetId',g.id,'name',g.name,'amount',actual,'plannedAmount',actual,'occurrenceDate',t.date,'settlement','partial'));
 if r.transaction_id is not null then delete from public.transaction_reconciliations where transaction_id=t.id; end if;
 update public.transactions set linked_plan_id=g.id,linked_plan_type='goal',matched_occurrence_date=p_expected_date,match_confidence=1,match_reason='confirmed_bucket_purchase',review_status='matched',review_resolution='goal',review_allocations=allocations,reviewed_at=now(),reviewed_by=actor where id=t.id returning * into t;
 insert into public.transaction_reconciliations(transaction_id,user_id,household_id,budget_id,resolution,target_id,occurrence_date,settlement,planned_amount,allocations,restore_snapshot,reviewed_by,reviewed_at,updated_at)
  values(t.id,t.user_id,t.household_id,t.budget_id,'goal',g.id,p_expected_date,'partial',actual,allocations,prior,actor,now(),now());
 select * into g from public.goals where id=p_bucket_id;
 return jsonb_build_object('transaction',to_jsonb(t),'goal',to_jsonb(g),'retry',false);
end;
$function$
;

CREATE OR REPLACE FUNCTION private.complete_decision(p_decision_id text, p_actual_amount numeric, p_completed_date date, p_account_id text DEFAULT NULL::text, p_debt_plan jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_decision public.decisions%rowtype;
  v_goal public.goals%rowtype;
  v_income public.incomes%rowtype;
  v_kind text;
  v_name text;
  v_source_id text;
  v_frequency text;
  v_transaction_id text;
  v_bill_id text;
  v_income_id text;
  v_payment_id text;
  v_next_date date;
  v_history jsonb;
  v_applied jsonb := '{}'::jsonb;
  v_request_fingerprint text;
  v_now timestamptz := now();
begin
  if v_actor is null then raise exception 'Sign in to complete a decision'; end if;
  if p_actual_amount is null
    or lower(p_actual_amount::text) in ('nan', 'infinity', '-infinity')
    or p_actual_amount < 0 or p_actual_amount > 1000000000 then
    raise exception 'Enter a finite non-negative actual amount';
  end if;
  if p_completed_date is null then raise exception 'Choose a completion date'; end if;
  v_request_fingerprint := md5(
    round(p_actual_amount, 2)::text || '|' || p_completed_date::text || '|'
    || coalesce(p_account_id, '') || '|'
    || coalesce(p_debt_plan, 'null'::jsonb)::text
  );

  select * into v_decision from public.decisions
  where id = p_decision_id for update;
  if not found or v_decision.household_id is null then raise exception 'Decision not found'; end if;
  if not (select private.is_household_editor(v_decision.household_id)) then
    raise exception 'You need household edit access to complete this decision';
  end if;

  if v_decision.status = 'completed' then
    if abs(coalesce(v_decision.actual_amount, 0) - round(p_actual_amount, 2)) < 0.005
      and v_decision.applied_change ->> 'requestFingerprint' = v_request_fingerprint then
      return jsonb_build_object(
        'decision_id', v_decision.id,
        'applied_change', coalesce(v_decision.applied_change, '{}'::jsonb),
        'retry', true
      );
    end if;
    raise exception 'This decision is already completed with different details';
  end if;
  if v_decision.status not in ('planned', 'calendar') then
    raise exception 'Only a planned decision can be completed';
  end if;

  v_kind := v_decision.scenario ->> 'type';
  v_name := btrim(coalesce(v_decision.scenario ->> 'name', v_decision.name));
  v_source_id := nullif(v_decision.scenario ->> 'sourceId', '');
  v_frequency := coalesce(nullif(v_decision.scenario ->> 'frequency', ''), 'monthly');
  if v_kind is distinct from v_decision.decision_type then
    raise exception 'Decision type does not match its scenario';
  end if;
  if v_name = '' or char_length(v_name) > 120 then
    raise exception 'Decision name must be between 1 and 120 characters';
  end if;
  if p_account_id is not null and not exists (
    select 1 from public.accounts account_row
    where account_row.id = p_account_id
      and account_row.household_id = v_decision.household_id
      and account_row.is_active
  ) then raise exception 'Choose an active household account'; end if;

  if v_kind = 'one_time_purchase' then
    if round(p_actual_amount, 2) > 0 then
      v_transaction_id := 'decision-' || md5(v_decision.id || ':transaction');
      insert into public.transactions (
        id, user_id, household_id, budget_id, date, amount, category, note,
        account_id, source, linked_plan_id, linked_plan_type
      ) values (
        v_transaction_id, v_actor, v_decision.household_id, v_decision.budget_id,
        p_completed_date::text, -round(p_actual_amount, 2), 'Other', v_name,
        p_account_id, 'manual', v_decision.id, 'decision'
      );
      v_applied := jsonb_build_object('kind', 'transaction', 'id', v_transaction_id);
    else
      v_applied := jsonb_build_object('kind', 'no_spend');
    end if;
  elsif v_kind = 'savings_contribution' then
    if round(p_actual_amount, 2) <= 0 then raise exception 'Enter a positive savings contribution'; end if;
    select * into v_goal from public.goals
    where id = v_source_id and household_id = v_decision.household_id
    for update;
    if not found or v_goal.goal_type <> 'savings' or v_goal.closed_at is not null
      or v_goal.archived_at is not null then
      raise exception 'Savings goal not found';
    end if;
    if round(p_actual_amount, 2) > v_goal.target_amount - v_goal.current_amount then
      raise exception 'Savings contribution exceeds the amount left on this goal';
    end if;
    update public.goals
    set current_amount = current_amount + round(p_actual_amount, 2)
    where id = v_goal.id;
    v_transaction_id := 'decision-' || md5(v_decision.id || ':transaction');
    insert into public.transactions (
      id, user_id, household_id, budget_id, date, amount, category, note,
      account_id, source, linked_plan_id, linked_plan_type
    ) values (
      v_transaction_id, v_actor, v_decision.household_id, v_decision.budget_id,
      p_completed_date::text, -round(p_actual_amount, 2), 'Savings', v_name,
      p_account_id, 'manual', v_decision.id, 'decision'
    );
    v_applied := jsonb_build_object(
      'kind', 'goal_contribution', 'goalId', v_goal.id,
      'transactionId', v_transaction_id
    );
  elsif v_kind = 'recurring_bill' then
    if round(p_actual_amount, 2) <= 0 then raise exception 'Enter a positive recurring bill amount'; end if;
    if v_frequency not in ('weekly', 'biweekly', 'monthly') then
      raise exception 'Recurring decision frequency is invalid';
    end if;
    v_transaction_id := 'decision-' || md5(v_decision.id || ':transaction');
    insert into public.transactions (
      id, user_id, household_id, budget_id, date, amount, category, note,
      account_id, source, linked_plan_id, linked_plan_type
    ) values (
      v_transaction_id, v_actor, v_decision.household_id, v_decision.budget_id,
      p_completed_date::text, -round(p_actual_amount, 2), 'Other', v_name,
      p_account_id, 'manual', v_decision.id, 'decision'
    );
    if v_frequency = 'weekly' then
      v_next_date := p_completed_date + 7;
    elsif v_frequency = 'biweekly' then
      v_next_date := p_completed_date + 14;
    else
      v_next_date := (
        date_trunc('month', p_completed_date::timestamp) + interval '1 month'
        + (
          least(
            extract(day from p_completed_date)::integer,
            extract(day from (
              date_trunc('month', p_completed_date::timestamp)
              + interval '2 months - 1 day'
            ))::integer
          ) - 1
        ) * interval '1 day'
      )::date;
    end if;
    v_bill_id := 'decision-' || md5(v_decision.id || ':bill');
    insert into public.bills (
      id, user_id, household_id, budget_id, name, amount, category, priority,
      is_debt, balance, interest_rate, due_day, start_date,
      next_payment_date, is_recurring, frequency, smart_priority,
      include_in_snowball
    ) values (
      v_bill_id, v_actor, v_decision.household_id, v_decision.budget_id,
      v_name, round(p_actual_amount, 2), 'Other',
      (select coalesce(max(priority), 0) + 1 from public.bills
        where household_id = v_decision.household_id),
      false, 0, 0, extract(day from v_next_date)::integer,
      v_next_date::text, v_next_date::text, true, v_frequency,
      'must', false
    );
    v_applied := jsonb_build_object(
      'kind', 'recurring', 'transactionId', v_transaction_id,
      'billId', v_bill_id
    );
  elsif v_kind = 'income_change' then
    if round(p_actual_amount, 2) <= 0 then raise exception 'Enter a positive income amount'; end if;
    if v_frequency not in ('weekly', 'biweekly', 'monthly') then
      raise exception 'Income frequency is invalid';
    end if;
    select * into v_income from public.incomes
    where id = v_source_id and household_id = v_decision.household_id
    for update;
    if found then
      select coalesce(jsonb_agg(history_item), '[]'::jsonb)
      into v_history
      from jsonb_array_elements(coalesce(v_income.amount_history, '[]'::jsonb)) history_item
      where history_item ->> 'effective_from' <>
        to_char(p_completed_date, 'YYYY-MM');
      v_history := v_history || jsonb_build_array(jsonb_build_object(
        'effective_from', to_char(p_completed_date, 'YYYY-MM'),
        'amount', round(p_actual_amount, 2)
      ));
      update public.incomes set
        amount = round(p_actual_amount, 2),
        amount_history = v_history,
        last_reviewed_at = v_now
      where id = v_income.id;
      v_applied := jsonb_build_object('kind', 'income_update', 'incomeId', v_income.id);
    else
      v_income_id := 'decision-' || md5(v_decision.id || ':income');
      insert into public.incomes (
        id, user_id, household_id, budget_id, name, amount, frequency,
        start_date, next_payment_date, amount_history, last_reviewed_at
      ) values (
        v_income_id, v_actor, v_decision.household_id, v_decision.budget_id,
        v_name, round(p_actual_amount, 2), v_frequency,
        p_completed_date::text,
        case when v_frequency = 'monthly' then null else p_completed_date::text end,
        jsonb_build_array(jsonb_build_object(
          'effective_from', to_char(p_completed_date, 'YYYY-MM'),
          'amount', round(p_actual_amount, 2)
        )), v_now
      );
      v_applied := jsonb_build_object('kind', 'income', 'id', v_income_id);
    end if;
  elsif v_kind = 'extra_debt_payment' then
    if round(p_actual_amount, 2) <= 0 then raise exception 'Enter a positive debt payment'; end if;
    if p_debt_plan is not null then
      if jsonb_typeof(p_debt_plan) <> 'object' then
        raise exception 'Debt payment plan is invalid';
      end if;
      if jsonb_typeof(p_debt_plan -> 'allocations') is distinct from 'array' then
        raise exception 'Debt payment plan is invalid';
      end if;
      if jsonb_array_length(p_debt_plan -> 'allocations') = 0 then
        raise exception 'Debt payment plan is invalid';
      end if;
      if nullif(p_debt_plan ->> 'paymentDate', '')::date is distinct from p_completed_date then
        raise exception 'Debt payment date must match the completion date';
      end if;
      if abs(coalesce((p_debt_plan ->> 'selectedExtra')::numeric, 0)
          - round(p_actual_amount, 2)) >= 0.005 then
        raise exception 'Debt allocations must equal the completed amount';
      end if;
      v_payment_id := 'decision-' || md5(v_decision.id || ':debt-payment');
      v_payment_id := public.apply_debt_snowball_payment(
        v_payment_id,
        extract(month from (p_debt_plan ->> 'paymentDate')::date)::integer - 1,
        extract(year from (p_debt_plan ->> 'paymentDate')::date)::integer,
        round(p_actual_amount, 2),
        (p_debt_plan ->> 'paymentDate')::date,
        p_debt_plan -> 'allocations',
        jsonb_build_array(jsonb_build_object(
          'type', 'manual', 'amount', round(p_actual_amount, 2)
        )),
        v_decision.household_id,
        false
      );
      v_applied := jsonb_build_object('kind', 'debt', 'paymentId', v_payment_id);
    else
      v_transaction_id := 'decision-' || md5(v_decision.id || ':transaction');
      insert into public.transactions (
        id, user_id, household_id, budget_id, date, amount, category, note,
        account_id, source, linked_plan_id, linked_plan_type
      ) values (
        v_transaction_id, v_actor, v_decision.household_id, v_decision.budget_id,
        p_completed_date::text, -round(p_actual_amount, 2), 'Debt', v_name,
        p_account_id, 'manual', v_decision.id, 'decision'
      );
      v_applied := jsonb_build_object('kind', 'transaction', 'id', v_transaction_id);
    end if;
  elsif v_kind = 'payment_date_change' then
    v_applied := jsonb_build_object(
      'kind', 'payment_date_change',
      'sourceId', v_source_id,
      'oldDate', v_decision.scenario ->> 'oldDate',
      'newDate', v_decision.scenario ->> 'date'
    );
  else
    raise exception 'Unsupported decision type';
  end if;

  v_applied := v_applied || jsonb_build_object(
    'requestFingerprint', v_request_fingerprint,
    'completedDate', p_completed_date,
    'accountId', p_account_id
  );

  update public.decisions set
    status = 'completed',
    actual_amount = round(p_actual_amount, 2),
    completed_at = v_now,
    applied_change = v_applied,
    remind_at = null,
    updated_at = v_now
  where id = v_decision.id;

  return jsonb_build_object(
    'decision_id', v_decision.id,
    'applied_change', v_applied,
    'retry', false
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION private.create_bill_and_reconcile_transaction(p_transaction_id text, p_bill jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_tx public.transactions%rowtype;
  v_bill public.bills%rowtype;
  v_existing public.transaction_reconciliations%rowtype;
  v_bill_id text := 'review-bill-' || md5(coalesce(p_transaction_id, ''));
  v_name text := btrim(coalesce(p_bill ->> 'name', ''));
  v_amount numeric;
  v_balance numeric;
  v_interest_rate numeric;
  v_snowball_minimum_boost numeric;
  v_actual numeric;
  v_settlement text;
  v_reconciliation jsonb;
  v_frequency text := coalesce(nullif(p_bill ->> 'frequency', ''), 'monthly');
  v_category text := btrim(coalesce(nullif(p_bill ->> 'category', ''), 'Other'));
  v_requested_priority integer;
  v_priority integer;
  v_due_day integer;
  v_day_of_week integer;
  v_next_payment_date date;
  v_start_date date;
  v_end_date date;
  v_is_debt boolean;
  v_is_recurring boolean;
  v_include_in_snowball boolean;
  v_smart_priority text := coalesce(nullif(p_bill ->> 'smart_priority', ''), 'must');
begin
  if v_actor is null then raise exception 'Sign in to add a forgotten bill'; end if;
  if jsonb_typeof(coalesce(p_bill, '{}'::jsonb)) <> 'object' then
    raise exception 'Bill details are required';
  end if;
  begin
    v_amount := (p_bill ->> 'amount')::numeric;
    v_balance := coalesce(nullif(p_bill ->> 'balance', ''), '0')::numeric;
    v_interest_rate := coalesce(nullif(p_bill ->> 'interest_rate', ''), '0')::numeric;
    v_snowball_minimum_boost := coalesce(
      nullif(p_bill ->> 'snowball_minimum_boost', ''), '0'
    )::numeric;
    v_requested_priority := nullif(p_bill ->> 'priority', '')::integer;
    v_due_day := nullif(p_bill ->> 'due_day', '')::integer;
    v_day_of_week := nullif(p_bill ->> 'day_of_week', '')::integer;
    v_next_payment_date := nullif(p_bill ->> 'next_payment_date', '')::date;
    v_start_date := nullif(p_bill ->> 'start_date', '')::date;
    v_end_date := nullif(p_bill ->> 'end_date', '')::date;
    v_is_debt := coalesce((p_bill ->> 'is_debt')::boolean, false);
    v_is_recurring := coalesce((p_bill ->> 'is_recurring')::boolean, true);
    v_include_in_snowball := coalesce(
      (p_bill ->> 'include_in_snowball')::boolean, true
    );
  exception
    when invalid_text_representation or numeric_value_out_of_range
      or invalid_datetime_format or datetime_field_overflow then
      raise exception 'Bill details contain an invalid number or date';
  end;
  if v_name = '' or char_length(v_name) > 120 then
    raise exception 'Enter a bill name up to 120 characters';
  end if;
  if v_amount is null or lower(v_amount::text) in ('nan', 'infinity', '-infinity')
    or round(v_amount, 2) <= 0 or v_amount > 1000000000 then
    raise exception 'Enter a finite positive bill amount';
  end if;
  if lower(v_balance::text) in ('nan', 'infinity', '-infinity')
    or v_balance < 0 or v_balance > 1000000000
    or lower(v_interest_rate::text) in ('nan', 'infinity', '-infinity')
    or v_interest_rate < 0 or v_interest_rate > 1000
    or lower(v_snowball_minimum_boost::text) in ('nan', 'infinity', '-infinity')
    or v_snowball_minimum_boost < 0
    or v_snowball_minimum_boost > 1000000000 then
    raise exception 'Bill balances and rates must be finite and non-negative';
  end if;
  if v_category = '' or char_length(v_category) > 120 then
    raise exception 'Enter a category up to 120 characters';
  end if;
  if v_requested_priority is not null
    and v_requested_priority not between 0 and 1000000 then
    raise exception 'Bill priority is invalid';
  end if;
  if v_due_day is not null and v_due_day not between 1 and 31 then
    raise exception 'Bill due day must be between 1 and 31';
  end if;
  if v_day_of_week is not null and v_day_of_week not between 0 and 6 then
    raise exception 'Bill weekday is invalid';
  end if;
  if v_smart_priority not in ('must', 'flexible', 'optional') then
    raise exception 'Bill importance is invalid';
  end if;
  if v_frequency not in ('monthly', 'quarterly', 'biweekly', 'weekly', 'yearly') then
    raise exception 'Choose a valid bill frequency';
  end if;

  if v_frequency = 'yearly' then
    if v_is_debt then
      raise exception 'Yearly scheduling is only available for bills, not debts';
    end if;
    if not private.is_valid_yearly_bill_anchor(coalesce(p_bill ->> 'next_payment_date', p_bill ->> 'start_date')) then
      raise exception 'Yearly bills require a valid first payment date';
    end if;
  end if;

  select * into v_tx from public.transactions
  where id = p_transaction_id
    and source = 'plaid'
    and pending is not true
    and removed_at is null
    and deleted_at is null
  for update;
  if not found or v_tx.amount >= 0 then
    raise exception 'Posted money-out transaction was not found';
  end if;
  v_due_day := coalesce(v_due_day, extract(day from case
    when v_frequency = 'yearly' then coalesce(v_next_payment_date, v_start_date)
    else v_tx.date::date
  end)::integer);
  v_start_date := coalesce(v_start_date, v_tx.date::date);
  if v_end_date is not null and v_end_date < v_start_date then
    raise exception 'Bill end date cannot be before its start date';
  end if;
  if v_frequency = 'quarterly' and v_next_payment_date is null then
    raise exception 'Quarterly bills require a first payment date';
  end if;
  if v_tx.household_id is null or not (select private.is_household_editor(v_tx.household_id)) then
    raise exception 'You need household edit access to review transactions';
  end if;
  if not private.has_review_center_entitlement(v_tx.household_id) then
    raise exception 'Review Center is unavailable for this household';
  end if;

  select * into v_existing from public.transaction_reconciliations
  where transaction_id = p_transaction_id for update;
  if v_tx.review_status is distinct from 'needs_review' then
    select * into v_bill from public.bills where id = v_bill_id for update;
    if v_existing.transaction_id = p_transaction_id
      and v_existing.resolution = 'bill'
      and v_existing.target_id = v_bill_id
      and v_bill.household_id = v_tx.household_id
      and btrim(v_bill.name) = v_name
      and abs(v_bill.amount - round(v_amount, 2)) < 0.005
      and v_bill.category = v_category
      and (v_requested_priority is null or v_bill.priority = v_requested_priority)
      and v_bill.is_debt = v_is_debt
      and abs(v_bill.balance - round(v_balance, 2)) < 0.005
      and abs(v_bill.interest_rate - round(v_interest_rate, 4)) < 0.00005
      and v_bill.due_day = v_due_day
      and v_bill.day_of_week is not distinct from v_day_of_week
      and v_bill.next_payment_date is not distinct from v_next_payment_date::text
      and v_bill.start_date is not distinct from v_start_date::text
      and v_bill.end_date is not distinct from v_end_date::text
      and v_bill.is_recurring = v_is_recurring
      and v_bill.frequency = v_frequency
      and v_bill.smart_priority = v_smart_priority
      and v_bill.include_in_snowball = v_include_in_snowball
      and abs(v_bill.snowball_minimum_boost - round(v_snowball_minimum_boost, 2)) < 0.005 then
      return jsonb_build_object(
        'bill_id', v_bill_id,
        'reconciliation', to_jsonb(v_existing),
        'retry', true
      );
    end if;
    raise exception 'This transaction has already been reviewed';
  end if;

  if exists (select 1 from public.bills where id = v_bill_id) then
    raise exception 'The retry bill exists without a matching review';
  end if;
  if v_requested_priority is null then
    select coalesce(max(priority), 0) + 1 into v_priority
    from public.bills where household_id = v_tx.household_id;
  else
    v_priority := v_requested_priority;
  end if;

  insert into public.bills (
    id, user_id, household_id, budget_id, name, amount, category, priority,
    is_debt, balance, interest_rate, due_day, day_of_week,
    next_payment_date, start_date, end_date, is_recurring, frequency,
    smart_priority, include_in_snowball, snowball_minimum_boost, created_at
  ) values (
    v_bill_id, v_actor, v_tx.household_id, v_tx.budget_id, v_name,
    round(v_amount, 2), v_category, v_priority,
    v_is_debt, round(v_balance, 2), round(v_interest_rate, 4),
    v_due_day, v_day_of_week, v_next_payment_date::text,
    v_start_date::text, v_end_date::text, v_is_recurring,
    v_frequency,
    v_smart_priority, v_include_in_snowball,
    round(v_snowball_minimum_boost, 2), pg_catalog.now()::text
  ) returning * into v_bill;

  v_actual := round(abs(v_tx.amount), 2);
  v_settlement := case
    when abs(v_actual - round(v_amount, 2)) < 0.005 then 'exact'
    when v_actual < round(v_amount, 2) then 'partial'
    else 'full'
  end;
  v_reconciliation := private.reconcile_transaction(
    p_transaction_id, 'bill', v_bill_id, v_tx.date::date,
    round(v_amount, 2), v_settlement, null
  );

  return jsonb_build_object(
    'bill_id', v_bill_id,
    'reconciliation', v_reconciliation,
    'retry', false
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION private.create_pending_activity_transaction(p_pending_plaid_transaction_id text, p_transaction_id text, p_household_id uuid, p_budget_id uuid, p_amount numeric, p_date date, p_category text, p_note text, p_account_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_pending public.plaid_transactions%rowtype;
  v_transaction public.transactions%rowtype;
  v_match public.pending_plan_matches%rowtype;
  v_user_id uuid := (select auth.uid());
  v_amount numeric;
  v_category text := btrim(coalesce(p_category, ''));
  v_note text := btrim(coalesce(p_note, ''));
  v_now timestamptz := now();
  v_inserted boolean := false;
begin
  if v_user_id is null then
    raise exception 'Sign in to create a transaction';
  end if;
  if p_household_id is null
    or not private.is_household_editor(p_household_id) then
    raise exception 'You need household edit access to create this transaction';
  end if;
  if not exists (
    select 1
    from public.household_plans plan
    where plan.household_id = p_household_id
      and plan.tier = 'pro'
  ) then
    raise exception 'Pending transaction planning requires the Pro plan';
  end if;
  if p_budget_id is null or not exists (
    select 1
    from public.budgets budget
    where budget.id = p_budget_id
      and budget.household_id = p_household_id
  ) then
    raise exception 'Choose a valid household budget';
  end if;
  if nullif(btrim(coalesce(p_pending_plaid_transaction_id, '')), '') is null
    or length(p_pending_plaid_transaction_id) > 240 then
    raise exception 'A valid pending charge is required';
  end if;
  if nullif(btrim(coalesce(p_transaction_id, '')), '') is null
    or length(p_transaction_id) > 128
    or p_transaction_id !~ '^[A-Za-z0-9_-]+$' then
    raise exception 'A valid transaction id is required';
  end if;
  if p_amount is null
    or lower(p_amount::text) in ('nan', 'infinity', '-infinity') then
    raise exception 'Enter a finite transaction amount';
  end if;
  v_amount := round(p_amount, 2);
  if v_amount >= 0 then
    raise exception 'Only pending money-out charges can create an expense transaction';
  end if;
  if p_date is null then raise exception 'Choose a valid transaction date'; end if;
  if v_category = '' or length(v_category) > 120 then
    raise exception 'Choose a valid transaction category';
  end if;
  if length(v_note) > 500 then
    raise exception 'Keep the transaction note to 500 characters or fewer';
  end if;
  if p_account_id is not null and not exists (
    select 1
    from public.accounts account
    where account.id = p_account_id
      and account.household_id = p_household_id
      and account.budget_id is not distinct from p_budget_id
      and account.is_active = true
  ) then
    raise exception 'Choose an active account from this household';
  end if;

  select * into v_pending
  from public.plaid_transactions pending
  where pending.household_id = p_household_id
    and pending.plaid_transaction_id = p_pending_plaid_transaction_id
    and pending.pending = true
    and pending.removed_at is null
  for update;
  if not found then
    raise exception 'This pending charge is no longer available';
  end if;
  if v_pending.amount >= 0 then
    raise exception 'Only pending money-out charges can create an expense transaction';
  end if;
  if date_trunc('month', p_date::timestamp)
    <> date_trunc('month', v_pending.transaction_date::timestamp) then
    raise exception 'The transaction date must stay in the same month as the pending charge';
  end if;

  select * into v_match
  from public.pending_plan_matches match_row
  where match_row.household_id = p_household_id
    and match_row.pending_plaid_transaction_id = p_pending_plaid_transaction_id
  for update;

  select * into v_transaction
  from public.transactions transaction_row
  where transaction_row.id = p_transaction_id
  for update;

  if found then
    if v_transaction.user_id is distinct from v_user_id
      or v_transaction.household_id is distinct from p_household_id
      or v_transaction.budget_id is distinct from p_budget_id
      or v_transaction.source is not distinct from 'plaid'
      or round(v_transaction.amount, 2) is distinct from v_amount
      or v_transaction.date::date is distinct from p_date
      or btrim(v_transaction.category) is distinct from v_category
      or btrim(coalesce(v_transaction.note, '')) is distinct from v_note
      or v_transaction.account_id is distinct from p_account_id
      or v_transaction.pending is true
      or v_transaction.removed_at is not null
      or v_transaction.deleted_at is not null then
      raise exception 'That transaction id is already in use';
    end if;
  else
    insert into public.transactions (
      id, user_id, household_id, budget_id, date, amount, category, note,
      account_id, source, pending
    ) values (
      p_transaction_id, v_user_id, p_household_id, p_budget_id, p_date::text,
      v_amount, v_category, v_note, p_account_id, null, false
    )
    returning * into v_transaction;
    v_inserted := true;
  end if;

  if v_match.id is not null
    and v_match.status in ('active', 'ready_review', 'completed')
    and (
      v_match.target_type is distinct from 'manual'
      or v_match.target_id is distinct from p_transaction_id
    ) then
    raise exception 'This pending charge is already linked to another plan item';
  end if;

  insert into public.pending_plan_matches (
    user_id, household_id, budget_id, pending_plaid_transaction_id,
    pending_account_id, target_type, target_id, target_name, occurrence_date,
    planned_amount, pending_amount, pending_transaction_date, status,
    posted_transaction_id, posted_plaid_transaction_id, posted_amount,
    created_by, updated_at
  ) values (
    v_user_id, p_household_id, p_budget_id, p_pending_plaid_transaction_id,
    v_pending.plaid_account_id::text, 'manual', p_transaction_id,
    coalesce(nullif(v_note, ''), nullif(v_category, ''), 'Manual Activity'),
    p_date, abs(v_amount), round(abs(v_pending.amount), 2),
    v_pending.transaction_date, 'active', null, null, null, v_user_id, v_now
  )
  on conflict (household_id, pending_plaid_transaction_id) do update set
    user_id = excluded.user_id,
    budget_id = excluded.budget_id,
    pending_account_id = excluded.pending_account_id,
    target_type = excluded.target_type,
    target_id = excluded.target_id,
    target_name = excluded.target_name,
    occurrence_date = excluded.occurrence_date,
    planned_amount = excluded.planned_amount,
    pending_amount = excluded.pending_amount,
    pending_transaction_date = excluded.pending_transaction_date,
    status = 'active',
    posted_transaction_id = null,
    posted_plaid_transaction_id = null,
    posted_amount = null,
    updated_at = excluded.updated_at
  returning * into v_match;

  return jsonb_build_object(
    'transaction_id', v_transaction.id,
    'transaction', to_jsonb(v_transaction),
    'pending_match', to_jsonb(v_match),
    'retry', not v_inserted
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION private.create_spending_bucket_for_transaction(p_transaction_id text, p_goal_id text, p_name text, p_target_amount numeric, p_target_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_tx public.transactions%rowtype;
  v_goal public.goals%rowtype;
  v_existing public.transaction_reconciliations%rowtype;
  v_name text;
  v_actual numeric;
  v_target numeric;
  v_settlement text;
  v_reconciliation jsonb;
  v_now timestamptz := now();
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in to create a spending bucket';
  end if;

  if nullif(btrim(coalesce(p_goal_id, '')), '') is null
    or length(p_goal_id) > 128
    or p_goal_id !~ '^[A-Za-z0-9_-]+$' then
    raise exception 'A valid spending bucket id is required';
  end if;
  v_name := btrim(coalesce(p_name, ''));
  if v_name = '' then raise exception 'Enter a name for this spending bucket'; end if;
  if length(v_name) > 120 then raise exception 'Keep the spending bucket name to 120 characters or fewer'; end if;
  if p_target_date is null then raise exception 'Choose a valid target date'; end if;
  if p_target_amount is null
    or lower(p_target_amount::text) in ('nan', 'infinity', '-infinity')
    or p_target_amount <= 0 then
    raise exception 'Enter a positive spending bucket amount';
  end if;

  select * into v_tx
  from public.transactions
  where id = p_transaction_id
    and source = 'plaid'
    and pending is not true
    and removed_at is null
    and deleted_at is null
  for update;
  if not found then raise exception 'Posted bank transaction was not found'; end if;
  if v_tx.amount >= 0 then raise exception 'Only money-out transactions can create a spending bucket'; end if;
  if v_tx.household_id is null or not public.is_household_editor(v_tx.household_id) then
    raise exception 'You need household edit access to review transactions';
  end if;
  if not exists (
    select 1 from public.household_plans hp
    where hp.household_id = v_tx.household_id and private.has_review_center_entitlement(v_tx.household_id)
  ) then
    raise exception 'Review Center requires the Pro plan';
  end if;

  v_actual := round(abs(v_tx.amount), 2);
  v_target := round(p_target_amount, 2);
  if lower(v_actual::text) in ('nan', 'infinity', '-infinity')
    or lower(v_target::text) in ('nan', 'infinity', '-infinity') then
    raise exception 'Enter a finite spending bucket amount';
  end if;
  if v_target < v_actual then
    raise exception 'Bucket amount must be at least $% to include this transaction', to_char(v_actual, 'FM999999999990.00');
  end if;
  v_settlement := case when v_target = v_actual then 'exact' else 'partial' end;

  -- The RPC may have committed even if the client lost its response. A retry
  -- can carry a new proposed goal id, so recover by the locked transaction's
  -- authoritative linked goal and require the full original request to match.
  if v_tx.review_status is distinct from 'needs_review' then
    if v_tx.review_status = 'matched'
      and v_tx.review_resolution = 'goal'
      and v_tx.linked_plan_type = 'goal'
      and nullif(v_tx.linked_plan_id, '') is not null
      and v_tx.matched_occurrence_date = p_target_date then
      select * into v_existing
      from public.transaction_reconciliations
      where transaction_id = p_transaction_id
      for update;
      select * into v_goal
      from public.goals
      where id = v_tx.linked_plan_id
      for update;

      if v_existing.transaction_id = p_transaction_id
        and v_existing.resolution = 'goal'
        and v_existing.target_id = v_goal.id
        and v_existing.occurrence_date = p_target_date
        and round(v_existing.planned_amount, 2) = v_target
        and v_existing.settlement = v_settlement
        and v_goal.user_id = v_tx.user_id
        and v_goal.household_id is not distinct from v_tx.household_id
        and v_goal.budget_id is not distinct from v_tx.budget_id
        and v_goal.goal_type = 'planned_expense'
        and btrim(v_goal.name) = v_name
        and round(v_goal.target_amount, 2) = v_target
        and v_goal.target_date::date = p_target_date
        and jsonb_array_length(coalesce(v_existing.allocations, '[]'::jsonb)) = 1
        and exists (
          select 1
          from jsonb_array_elements(coalesce(v_existing.allocations, '[]'::jsonb)) allocation
          where allocation ->> 'type' = 'planned_expense'
            and allocation ->> 'source' = 'goal'
            and allocation ->> 'targetId' = v_goal.id
            and round((allocation ->> 'amount')::numeric, 2) = v_actual
            and round((allocation ->> 'plannedAmount')::numeric, 2) = v_target
            and (allocation ->> 'occurrenceDate')::date = p_target_date
            and allocation ->> 'settlement' = v_settlement
        ) then
        return jsonb_build_object(
          'goal_id', v_goal.id,
          'goal', to_jsonb(v_goal),
          'reconciliation', to_jsonb(v_existing),
          'retry', true
        );
      end if;
    end if;
    raise exception 'This transaction has already been reviewed with different details';
  end if;

  if exists (select 1 from public.goals where id = p_goal_id) then
    raise exception 'That spending bucket id is already in use';
  end if;

  insert into public.goals (
    id, user_id, household_id, budget_id, name, target_amount, target_date,
    current_amount, created_at, goal_type
  ) values (
    p_goal_id, v_tx.user_id, v_tx.household_id, v_tx.budget_id, v_name,
    v_target, p_target_date::text, 0, v_now::text, 'planned_expense'
  )
  returning * into v_goal;

  v_reconciliation := private.reconcile_transaction(
    p_transaction_id,
    'goal',
    p_goal_id,
    p_target_date,
    v_target,
    v_settlement,
    null
  );

  select * into v_goal from public.goals where id = p_goal_id;
  return jsonb_build_object(
    'goal_id', p_goal_id,
    'goal', to_jsonb(v_goal),
    'reconciliation', v_reconciliation
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION private.delete_bucket_purchase(p_transaction_id text, p_bucket_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_variable
declare result jsonb; t public.transactions%rowtype; g public.goals%rowtype;
begin
 if auth.uid() is null then raise exception 'Sign in to delete a purchase'; end if;
 select * into t from public.transactions where id=p_transaction_id for update;
 if not found or t.household_id is null or not private.is_household_editor(t.household_id) then raise exception 'Household edit access is required'; end if;
 if t.deleted_at is null then
  result:=private.undo_bucket_purchase(t.id,p_bucket_id);
  update public.transactions set deleted_at=now(),deleted_by=auth.uid() where id=t.id returning * into t;
 end if;
 select * into g from public.goals where id=p_bucket_id and household_id=t.household_id and budget_id is not distinct from t.budget_id;
 if not found then raise exception 'Spending bucket not found'; end if;
 return jsonb_build_object('transaction',to_jsonb(t),'goal',to_jsonb(g),'retry',result is null);
end;
$function$
;

CREATE OR REPLACE FUNCTION private.fund_goal(p_goal_id text, p_transaction_id text, p_amount numeric, p_date date, p_expected_current_amount numeric, p_account_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_goal public.goals%rowtype;
  v_existing public.transactions%rowtype;
  v_applied numeric;
  v_next numeric;
begin
  if v_actor is null then raise exception 'Sign in to fund a goal'; end if;
  if nullif(btrim(coalesce(p_transaction_id, '')), '') is null then
    raise exception 'A stable contribution id is required';
  end if;
  if char_length(p_transaction_id) > 200 then
    raise exception 'Contribution id is too long';
  end if;
  if p_date is null then raise exception 'Contribution date is required'; end if;
  if p_amount is null or lower(p_amount::text) in ('nan', 'infinity', '-infinity')
    or p_amount <= 0 or p_amount > 1000000000 then
    raise exception 'Enter a finite positive contribution';
  end if;
  v_applied := round(p_amount, 2);
  if v_applied <= 0 then raise exception 'Contribution must be at least one cent'; end if;
  if p_expected_current_amount is null
    or lower(p_expected_current_amount::text) in ('nan', 'infinity', '-infinity')
    or p_expected_current_amount < 0 then
    raise exception 'The goal balance is invalid';
  end if;

  select * into v_goal from public.goals
  where id = p_goal_id for update;
  if not found or v_goal.household_id is null then raise exception 'Goal not found'; end if;
  if not (select private.is_household_editor(v_goal.household_id)) then
    raise exception 'You need household edit access to fund this goal';
  end if;
  if v_goal.goal_type <> 'savings' or v_goal.closed_at is not null
    or v_goal.archived_at is not null then
    raise exception 'Choose an open savings goal';
  end if;
  if p_account_id is not null and not exists (
    select 1 from public.accounts account_row
    where account_row.id = p_account_id
      and account_row.household_id = v_goal.household_id
      and account_row.is_active
  ) then raise exception 'Choose an active household account'; end if;

  select * into v_existing from public.transactions
  where id = p_transaction_id for update;
  if found then
    if v_existing.household_id = v_goal.household_id
      and v_existing.linked_plan_type = 'goal'
      and v_existing.linked_plan_id = v_goal.id
      and v_existing.date::date = p_date
      and abs(v_existing.amount + v_applied) < 0.005
      and v_existing.account_id is not distinct from p_account_id
      and v_existing.source = 'manual'
      and v_existing.category = 'Savings'
      and v_goal.current_amount + 0.005 >=
        round(p_expected_current_amount + v_applied, 2) then
      return jsonb_build_object(
        'goal_id', v_goal.id,
        'transaction_id', v_existing.id,
        'current_amount', v_goal.current_amount,
        'applied_amount', v_applied,
        'retry', true
      );
    end if;
    raise exception 'That contribution id is already in use';
  end if;

  if abs(v_goal.current_amount - p_expected_current_amount) >= 0.005 then
    raise exception 'This goal changed. Refresh and try again';
  end if;
  if v_applied > v_goal.target_amount - v_goal.current_amount then
    raise exception 'Contribution exceeds the amount left on this goal';
  end if;
  v_next := v_goal.current_amount + v_applied;
  if v_next <= v_goal.current_amount then raise exception 'This goal is already funded'; end if;

  update public.goals set current_amount = v_next where id = v_goal.id;
  insert into public.transactions (
    id, user_id, household_id, budget_id, date, amount, category, note,
    account_id, source, linked_plan_id, linked_plan_type
  ) values (
    p_transaction_id, v_actor, v_goal.household_id, v_goal.budget_id,
    p_date::text, -v_applied, 'Savings',
    'Goal funding: ' || v_goal.name, p_account_id, 'manual',
    v_goal.id, 'goal'
  );

  return jsonb_build_object(
    'goal_id', v_goal.id,
    'transaction_id', p_transaction_id,
    'current_amount', v_next,
    'applied_amount', v_applied,
    'retry', false
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION private.mutate_transfer(p_household_id uuid, p_budget_id uuid, p_group_id text, p_from_id text, p_to_id text, p_expected jsonb, p_payload jsonb, p_action text DEFAULT 'save'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_variable
declare
 rows public.transactions[]; t public.transactions%rowtype; outgoing public.transactions%rowtype; incoming public.transactions%rowtype;
 old_pair jsonb; desired_pair jsonb; result jsonb; amount numeric; transfer_date date; from_account text; to_account text; from_note text; to_note text; n integer;
begin
 if p_action is null or p_action not in('save','delete','restore') then raise exception 'Choose a transfer action'; end if;
 if auth.uid() is null or p_household_id is null or not private.is_household_editor(p_household_id) then raise exception 'Household edit access is required'; end if;
 if p_budget_id is null or not exists(select 1 from public.budgets where id=p_budget_id and household_id=p_household_id) then raise exception 'Choose a budget in this household'; end if;
 if nullif(btrim(p_group_id),'') is null or length(p_group_id)>200 or nullif(btrim(p_from_id),'') is null or nullif(btrim(p_to_id),'') is null or p_from_id=p_to_id then raise exception 'A stable transfer pair is required'; end if;
 perform pg_advisory_xact_lock(hashtextextended('transfer:'||p_group_id,0));
 select array_agg(q order by q.id) into rows from (select * from public.transactions where transfer_group_id=p_group_id or id in(p_from_id,p_to_id) order by id for update) q;
 n:=coalesce(array_length(rows,1),0);
 if n<>0 and n<>2 then raise exception 'This transfer no longer has exactly two legs. Refresh before editing'; end if;
 if n=2 then
  foreach t in array rows loop
   if t.household_id is distinct from p_household_id or t.budget_id is distinct from p_budget_id or t.transfer_group_id is distinct from p_group_id or t.id not in(p_from_id,p_to_id)
    or t.removed_at is not null or t.pending is true or t.source is not null and t.source<>'manual' or t.import_hash is not null
    or t.category<>'Transfer' or t.linked_bill_id is not null or t.linked_income_id is not null or t.linked_plan_id is not null or t.debt_applied_bill_id is not null or coalesce(t.debt_applied_amount,0)<>0
    or exists(select 1 from public.transaction_reconciliations where transaction_id=t.id) then raise exception 'This pair cannot be changed as a manual transfer'; end if;
   if t.id=p_from_id then outgoing:=t; else incoming:=t; end if;
  end loop;
  if outgoing.amount>=0 or incoming.amount<=0 or outgoing.amount<>-incoming.amount or outgoing.date<>incoming.date or outgoing.account_id is null or incoming.account_id is null or outgoing.account_id=incoming.account_id then raise exception 'Transfer legs are inconsistent. Refresh before editing'; end if;
  old_pair:=jsonb_build_array(jsonb_build_object('id',outgoing.id,'amount',outgoing.amount,'date',outgoing.date,'account_id',outgoing.account_id,'note',outgoing.note,'category',outgoing.category),jsonb_build_object('id',incoming.id,'amount',incoming.amount,'date',incoming.date,'account_id',incoming.account_id,'note',incoming.note,'category',incoming.category));
  if p_action='delete' and outgoing.deleted_at is not null and incoming.deleted_at is not null then return jsonb_build_object('transactions',to_jsonb(rows),'retry',true); end if;
  if p_action='restore' then
   if p_expected is distinct from old_pair then raise exception 'This transfer changed before restore'; end if;
   if (outgoing.deleted_at is null)<>(incoming.deleted_at is null) then raise exception 'Transfer deletion state is inconsistent'; end if;
   perform 1 from public.accounts where id in(outgoing.account_id,incoming.account_id) and household_id=p_household_id and budget_id is not distinct from p_budget_id and is_active order by id for share;
   get diagnostics n=row_count;
   if n<>2 then raise exception 'Restore requires two active household accounts'; end if;
   update public.transactions set deleted_at=null,deleted_by=null where id in(p_from_id,p_to_id);
   select jsonb_agg(x order by x.id) into result from public.transactions x where id in(p_from_id,p_to_id);
   return jsonb_build_object('transactions',result,'retry',outgoing.deleted_at is null);
  end if;
  if outgoing.deleted_at is not null or incoming.deleted_at is not null then raise exception 'This transfer was deleted. Refresh before editing'; end if;
 elsif p_action in('delete','restore') or p_expected is not null then raise exception 'Transfer not found';
 end if;
 if p_action='delete' then
  if p_expected is distinct from old_pair then raise exception 'This transfer changed on another device. Refresh before deleting'; end if;
  update public.transactions set deleted_at=now(),deleted_by=auth.uid() where id in(p_from_id,p_to_id);
 else
  amount:=(p_payload->>'amount')::numeric; transfer_date:=(p_payload->>'date')::date;
  from_account:=p_payload->>'fromAccountId'; to_account:=p_payload->>'toAccountId'; from_note:=coalesce(p_payload->>'fromNote',''); to_note:=coalesce(p_payload->>'toNote','');
  if amount is null or lower(amount::text) in('nan','infinity','-infinity') or amount<=0 or amount>1000000000 or round(amount,2)<>amount or transfer_date is null or length(from_note)>2000 or length(to_note)>2000 then raise exception 'Choose a valid transfer amount, date and description'; end if;
  if from_account is null or to_account is null or from_account=to_account then raise exception 'Choose two different active accounts'; end if;
  -- Hold account locks through commit so deactivation cannot race validation.
  perform 1 from public.accounts where id in(from_account,to_account) and household_id=p_household_id and budget_id is not distinct from p_budget_id and is_active order by id for share;
  get diagnostics n=row_count;
  if n<>2 then raise exception 'Choose two active accounts in this household'; end if;
  desired_pair:=jsonb_build_array(jsonb_build_object('id',p_from_id,'amount',-amount,'date',transfer_date::text,'account_id',from_account,'note',from_note,'category','Transfer'),jsonb_build_object('id',p_to_id,'amount',amount,'date',transfer_date::text,'account_id',to_account,'note',to_note,'category','Transfer'));
  if old_pair=desired_pair then return jsonb_build_object('transactions',to_jsonb(rows),'retry',true); end if;
  if old_pair is not null then
   if p_expected is distinct from old_pair then raise exception 'This transfer changed on another device. Refresh before editing'; end if;
   update public.transactions set amount=case when id=p_from_id then -amount else amount end,date=transfer_date::text,account_id=case when id=p_from_id then from_account else to_account end,note=case when id=p_from_id then from_note else to_note end,user_edited_at=now() where id in(p_from_id,p_to_id);
  else
   if p_expected is not null then raise exception 'Transfer not found'; end if;
   insert into public.transactions(id,user_id,household_id,budget_id,amount,date,account_id,category,note,source,transfer_group_id,review_status)
    values(p_from_id,auth.uid(),p_household_id,p_budget_id,-amount,transfer_date::text,from_account,'Transfer',from_note,'manual',p_group_id,'legacy_reviewed'),
          (p_to_id,auth.uid(),p_household_id,p_budget_id,amount,transfer_date::text,to_account,'Transfer',to_note,'manual',p_group_id,'legacy_reviewed');
  end if;
 end if;
 select jsonb_agg(x order by x.id) into result from public.transactions x where id in(p_from_id,p_to_id);
 return jsonb_build_object('transactions',result,'retry',false);
end;
$function$
;

CREATE OR REPLACE FUNCTION private.reconcile_manual_transaction(p_transaction_id text, p_manual_transaction_id text, p_occurrence_date date, p_planned_amount numeric, p_settlement text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_tx public.transactions%rowtype;
  v_manual public.transactions%rowtype;
  v_existing public.transaction_reconciliations%rowtype;
  v_actual numeric;
  v_allocations jsonb;
  v_snapshot jsonb;
  v_now timestamptz := now();
begin
  if (select auth.uid()) is null then raise exception 'Sign in to review transactions'; end if;

  select * into v_tx
  from public.transactions
  where id = p_transaction_id
    and source = 'plaid'
    and removed_at is null
    and deleted_at is null
    and pending is not true
  for update;
  if not found then raise exception 'Posted bank transaction was not found'; end if;
  if v_tx.amount >= 0 then raise exception 'Only money-out transactions can match a manual plan'; end if;
  -- A second existing applied payment cannot be silently overwritten while
  -- transferring ownership of the manual payment. Refresh/review it first.
  if coalesce(v_tx.debt_applied_amount, 0) <> 0 or v_tx.debt_applied_bill_id is not null then
    raise exception 'This bank transaction already has an applied debt payment. Refresh Review Center before matching';
  end if;
  if v_tx.review_status is distinct from 'needs_review' then
    raise exception 'This transaction has already been reviewed';
  end if;

  if v_tx.household_id is null or not public.is_household_editor(v_tx.household_id) then
    raise exception 'You need household edit access to review transactions';
  end if;
  if not exists (
    select 1 from public.household_plans hp
    where hp.household_id = v_tx.household_id and private.has_review_center_entitlement(v_tx.household_id)
  ) then
    raise exception 'Review Center requires the Pro plan';
  end if;

  select * into v_manual
  from public.transactions
  where id = p_manual_transaction_id
    and id <> p_transaction_id
    and source is distinct from 'plaid'
    and amount < 0
    and pending is not true
    and import_hash is null
    and transfer_group_id is null
    and linked_plan_id is null
    and review_status is distinct from 'matched'
    and category is distinct from 'Transfer'
    and (linked_bill_id is null or ((source is null or source = 'manual') and exists (
      select 1 from public.bills linked_debt
      where linked_debt.id = transactions.linked_bill_id
        and linked_debt.household_id = transactions.household_id
        and linked_debt.budget_id is not distinct from transactions.budget_id
        and linked_debt.is_debt = true
    )))
    and removed_at is null
    and deleted_at is null
  for update;
  if not found then raise exception 'Manual calendar transaction was not found'; end if;
  if v_manual.household_id is distinct from v_tx.household_id
    or v_manual.budget_id is distinct from v_tx.budget_id then
    raise exception 'Manual transaction does not belong to this household plan';
  end if;
  if p_occurrence_date is null or p_planned_amount is null or p_planned_amount <= 0 then
    raise exception 'Manual transaction details are required';
  end if;
  if p_occurrence_date is distinct from v_tx.date::date then
    raise exception 'The posted transaction date changed. Refresh Review Center and try again';
  end if;
  if date_trunc('month', v_manual.date::date) is distinct from date_trunc('month', v_tx.date::date) then
    raise exception 'Manual and posted transactions must be in the same month';
  end if;
  if abs(abs(v_manual.amount) - p_planned_amount) >= 0.01 then
    raise exception 'This manual plan changed. Refresh Review Center and try again';
  end if;
  if coalesce(p_settlement, '') not in ('exact', 'full', 'partial') then
    raise exception 'Choose how this transaction was paid';
  end if;

  select * into v_existing
  from public.transaction_reconciliations
  where transaction_id = p_transaction_id
  for update;

  v_snapshot := case when found then v_existing.restore_snapshot else jsonb_build_object(
    'category', v_tx.category,
    'linkedBillId', v_tx.linked_bill_id,
    'linkedIncomeId', v_tx.linked_income_id,
    'linkedPlanId', v_tx.linked_plan_id,
    'linkedPlanType', v_tx.linked_plan_type,
    'matchConfidence', v_tx.match_confidence,
    'matchReason', v_tx.match_reason,
    'manualTransactionId', v_manual.id,
    'manualRemovedAt', v_manual.removed_at,
    'manualMatchReason', v_manual.match_reason
  ) end;

  v_actual := abs(v_tx.amount);
  v_allocations := jsonb_build_array(jsonb_build_object(
    'type', 'planned_expense',
    'source', 'transaction',
    'targetId', v_manual.id,
    'name', coalesce(nullif(btrim(v_manual.note), ''), v_manual.category, 'Manual transaction'),
    'category', v_manual.category,
    'amount', v_actual,
    'plannedAmount', p_planned_amount,
    'occurrenceDate', p_occurrence_date,
    'settlement', p_settlement
  ));

  update public.transactions
  set removed_at = v_now,
      match_reason = 'replaced_by_posted_transaction'
  where id = v_manual.id;

  update public.transactions
  set category = v_manual.category,
      linked_bill_id = null,
      linked_income_id = null,
      linked_plan_id = v_manual.id,
      linked_plan_type = 'transaction',
      matched_occurrence_date = p_occurrence_date,
      match_confidence = 1,
      match_reason = 'confirmed_manual_match',
      review_status = 'matched',
      review_resolution = 'manual',
      review_allocations = v_allocations,
      reviewed_at = v_now,
      reviewed_by = (select auth.uid())
  where id = p_transaction_id;

  insert into public.transaction_reconciliations (
    transaction_id, user_id, household_id, budget_id, resolution, target_id,
    occurrence_date, settlement, planned_amount, allocations, restore_snapshot,
    reviewed_by, reviewed_at, updated_at
  ) values (
    p_transaction_id, v_tx.user_id, v_tx.household_id, v_tx.budget_id, 'manual',
    v_manual.id, p_occurrence_date, p_settlement, p_planned_amount, v_allocations,
    v_snapshot, (select auth.uid()), v_now, v_now
  )
  on conflict (transaction_id) do update set
    resolution = excluded.resolution,
    target_id = excluded.target_id,
    occurrence_date = excluded.occurrence_date,
    settlement = excluded.settlement,
    planned_amount = excluded.planned_amount,
    allocations = excluded.allocations,
    restore_snapshot = excluded.restore_snapshot,
    reviewed_by = excluded.reviewed_by,
    reviewed_at = excluded.reviewed_at,
    updated_at = excluded.updated_at;

  return jsonb_build_object(
    'transaction_id', p_transaction_id,
    'resolution', 'manual',
    'allocations', v_allocations,
    'reviewed_at', v_now
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION private.reconcile_snowball_transaction(p_transaction_id text, p_debt_id text, p_occurrence_date date, p_planned_amount numeric, p_settlement text, p_extra_category text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tx public.transactions%rowtype;
  v_debt public.bills%rowtype;
  v_payment public.extra_payments%rowtype;
  v_scheduled_plan public.transactions%rowtype;
  v_existing public.transaction_reconciliations%rowtype;
  v_plan_id text;
  v_actual numeric;
  v_primary numeric;
  v_extra numeric;
  v_plan_amount numeric;
  v_plan_original_amount numeric;
  v_prior_amount numeric;
  v_remaining numeric;
  v_allocations jsonb;
  v_snapshot jsonb;
  v_now timestamptz := now();
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in to review transactions';
  end if;

  select *
  into v_tx
  from public.transactions
  where id = p_transaction_id
    and removed_at is null
    and pending is not true;
  if not found then raise exception 'Posted transaction was not found'; end if;
  if v_tx.amount >= 0 then raise exception 'Only money-out transactions can match a Snowball payment'; end if;
  if v_tx.review_status is distinct from 'needs_review' then
    raise exception 'This transaction has already been reviewed';
  end if;
  if v_tx.household_id is null or not private.is_household_editor(v_tx.household_id) then
    raise exception 'You need household edit access to review transactions';
  end if;
  if not exists (
    select 1
    from public.household_plans plan
    where plan.household_id = v_tx.household_id
      and private.has_review_center_entitlement(v_tx.household_id)
  ) then
    raise exception 'Review Center requires the Pro plan';
  end if;
  if p_occurrence_date is null or p_planned_amount is null or p_planned_amount <= 0 then
    raise exception 'Snowball occurrence details are required';
  end if;
  if coalesce(p_settlement, '') not in ('exact', 'full', 'partial', 'split', 'extra_principal') then
    raise exception 'Choose how this Snowball payment was paid';
  end if;

  select *
  into v_debt
  from public.bills
  where id = p_debt_id
    and is_debt;
  if not found
    or v_debt.household_id is distinct from v_tx.household_id
    or v_debt.budget_id is distinct from v_tx.budget_id then
    raise exception 'Debt does not belong to this household plan';
  end if;

  select payment.*
  into v_payment
  from public.extra_payments payment
  where payment.household_id = v_tx.household_id
    and payment.budget_id is not distinct from v_tx.budget_id
    and payment.payment_date = p_occurrence_date
    and exists (
      select 1
      from jsonb_array_elements(coalesce(payment.allocations, '[]'::jsonb)) allocation
      where allocation ->> 'billId' = p_debt_id
        and coalesce((allocation ->> 'payment')::numeric, 0) > 0
    )
  order by payment.id
  limit 1
  for update;

  if found then
    v_plan_id := v_payment.id;
    select coalesce(sum((allocation ->> 'payment')::numeric), 0)
    into v_plan_amount
    from jsonb_array_elements(coalesce(v_payment.allocations, '[]'::jsonb)) allocation
    where allocation ->> 'billId' = p_debt_id;
  else
    select plan.*
    into v_scheduled_plan
    from public.transactions plan
    where plan.household_id = v_tx.household_id
      and plan.budget_id is not distinct from v_tx.budget_id
      and plan.source = 'snowball_plan'
      and plan.date::date = p_occurrence_date
      and plan.amount < 0
      and plan.removed_at is null
      and plan.pending is not true
      and coalesce(plan.debt_applied_bill_id, plan.linked_bill_id) = p_debt_id
    order by plan.id
    limit 1
    for update;
    if not found then raise exception 'Snowball payment was not found'; end if;

    v_plan_id := v_scheduled_plan.id;
    v_plan_amount := abs(v_scheduled_plan.amount);
  end if;

  select coalesce(sum((allocation ->> 'amount')::numeric), 0)
  into v_prior_amount
  from public.transaction_reconciliations reconciliation
  cross join lateral jsonb_array_elements(coalesce(reconciliation.allocations, '[]'::jsonb)) allocation
  where reconciliation.resolution = 'snowball'
    and reconciliation.target_id = v_plan_id
    and reconciliation.occurrence_date = p_occurrence_date
    and allocation ->> 'type' = 'extra_principal'
    and allocation ->> 'targetId' = p_debt_id;

  v_remaining := case
    when v_scheduled_plan.id is not null then v_plan_amount
    else greatest(0, v_plan_amount - v_prior_amount)
  end;
  v_plan_original_amount := case
    when v_scheduled_plan.id is not null then v_plan_amount + v_prior_amount
    else v_plan_amount
  end;
  if v_remaining <= 0.005 then raise exception 'This Snowball payment is already complete'; end if;
  if abs(v_remaining - p_planned_amount) >= 0.01 then
    raise exception 'This Snowball payment changed. Refresh Review Center and try again';
  end if;

  select *
  into v_existing
  from public.transaction_reconciliations
  where transaction_id = p_transaction_id;
  v_snapshot := case when found then v_existing.restore_snapshot else jsonb_build_object(
    'category', v_tx.category,
    'linkedBillId', v_tx.linked_bill_id,
    'linkedIncomeId', v_tx.linked_income_id,
    'linkedPlanId', v_tx.linked_plan_id,
    'linkedPlanType', v_tx.linked_plan_type,
    'matchConfidence', v_tx.match_confidence,
    'matchReason', v_tx.match_reason,
    'scheduledPlanId', v_scheduled_plan.id,
    'scheduledPlanOriginalAmount', v_plan_original_amount
  ) end;

  v_actual := abs(v_tx.amount);
  v_primary := case
    when p_settlement = 'split' then least(v_actual, v_remaining)
    else v_actual
  end;
  v_extra := greatest(0, v_actual - v_primary);
  if p_settlement = 'partial' and v_primary >= v_remaining - 0.005 then
    raise exception 'A partial payment must leave part of the Snowball plan open';
  end if;
  if p_settlement = 'split'
    and (v_extra <= 0 or nullif(btrim(coalesce(p_extra_category, '')), '') is null) then
    raise exception 'Choose a category for the extra amount';
  end if;

  update public.bills
  set balance = greatest(0, balance - v_primary)
  where id = p_debt_id
    and household_id = v_tx.household_id;

  v_allocations := jsonb_build_array(jsonb_build_object(
    'type', 'extra_principal',
    'targetId', p_debt_id,
    'name', v_debt.name,
    'category', 'Debt',
    'amount', v_primary,
    'plannedAmount', v_remaining,
    'occurrenceDate', p_occurrence_date,
    'settlement', p_settlement
  ));
  if v_extra > 0 then
    v_allocations := v_allocations || jsonb_build_array(jsonb_build_object(
      'type', 'category',
      'category', p_extra_category,
      'amount', v_extra
    ));
  end if;

  update public.transactions
  set category = 'Debt',
      linked_bill_id = null,
      linked_income_id = null,
      linked_plan_id = v_plan_id,
      linked_plan_type = 'snowball',
      matched_occurrence_date = p_occurrence_date,
      match_confidence = 1,
      match_reason = 'confirmed_snowball_match',
      review_status = 'matched',
      review_resolution = 'snowball',
      review_allocations = v_allocations,
      reviewed_at = v_now,
      reviewed_by = (select auth.uid())
  where id = p_transaction_id;

  if v_scheduled_plan.id is not null then
    if p_settlement = 'partial' then
      update public.transactions
      set amount = -round(greatest(0, v_remaining - v_primary), 2),
          removed_at = null
      where id = v_scheduled_plan.id
        and household_id = v_tx.household_id;
    else
      update public.transactions
      set removed_at = v_now
      where id = v_scheduled_plan.id
        and household_id = v_tx.household_id;
    end if;
  end if;

  insert into public.transaction_reconciliations (
    transaction_id, user_id, household_id, budget_id, resolution, target_id,
    occurrence_date, settlement, planned_amount, allocations, restore_snapshot,
    reviewed_by, reviewed_at, updated_at
  ) values (
    p_transaction_id, v_tx.user_id, v_tx.household_id, v_tx.budget_id, 'snowball',
    v_plan_id, p_occurrence_date, p_settlement, v_remaining, v_allocations,
    v_snapshot, (select auth.uid()), v_now, v_now
  )
  on conflict (transaction_id) do update set
    resolution = excluded.resolution,
    target_id = excluded.target_id,
    occurrence_date = excluded.occurrence_date,
    settlement = excluded.settlement,
    planned_amount = excluded.planned_amount,
    allocations = excluded.allocations,
    restore_snapshot = excluded.restore_snapshot,
    reviewed_by = excluded.reviewed_by,
    reviewed_at = excluded.reviewed_at,
    updated_at = excluded.updated_at;

  return jsonb_build_object(
    'transaction_id', p_transaction_id,
    'resolution', 'snowball',
    'allocations', v_allocations,
    'reviewed_at', v_now
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION private.reconcile_transaction(p_transaction_id text, p_resolution text, p_target_id text DEFAULT NULL::text, p_occurrence_date date DEFAULT NULL::date, p_planned_amount numeric DEFAULT NULL::numeric, p_settlement text DEFAULT NULL::text, p_extra_category text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_tx public.transactions%rowtype;
  v_existing public.transaction_reconciliations%rowtype;
  v_expected_status text;
begin
  if (select auth.uid()) is null then raise exception 'Sign in to review transactions'; end if;
  if p_resolution not in ('bill', 'income', 'goal', 'decision', 'category', 'transfer') then
    raise exception 'Unsupported review resolution';
  end if;

  select * into v_tx
  from public.transactions
  where id = p_transaction_id
    and source = 'plaid'
    and pending is not true
    and removed_at is null
    and deleted_at is null
  for update;
  if not found then raise exception 'Posted bank transaction was not found'; end if;
  if v_tx.household_id is null or not public.is_household_editor(v_tx.household_id) then
    raise exception 'You need household edit access to review transactions';
  end if;
  if not exists (
    select 1 from public.household_plans plan
    where plan.household_id = v_tx.household_id and private.has_review_center_entitlement(v_tx.household_id)
  ) then raise exception 'Review Center requires the Pro plan'; end if;

  select * into v_existing
  from public.transaction_reconciliations
  where transaction_id = p_transaction_id
  for update;

  if v_tx.review_status is distinct from 'needs_review' then
    v_expected_status := case
      when p_resolution = 'category' then 'categorized'
      when p_resolution = 'transfer' then 'transfer'
      else 'matched'
    end;
    if v_existing.transaction_id is not null
      and v_existing.resolution = p_resolution
      and v_existing.target_id is not distinct from p_target_id
      and v_existing.occurrence_date is not distinct from p_occurrence_date
      and v_existing.settlement is not distinct from coalesce(p_settlement, 'regular')
      and (
        (v_existing.planned_amount is null and p_planned_amount is null)
        or abs(v_existing.planned_amount - p_planned_amount) < 0.005
      )
      and v_tx.review_status = v_expected_status
      and v_tx.review_resolution = p_resolution
      and (case
        when p_resolution = 'goal' then v_tx.linked_plan_id = p_target_id and v_tx.linked_plan_type = 'goal'
        when p_resolution = 'decision' then v_tx.linked_plan_id = p_target_id and v_tx.linked_plan_type = 'decision'
        when p_resolution = 'bill' then v_tx.linked_bill_id = p_target_id
        when p_resolution = 'income' then v_tx.linked_income_id = p_target_id
        when p_resolution = 'category' then v_tx.category = p_target_id
        when p_resolution = 'transfer' then v_tx.category = 'Transfer'
        else false
      end)
      and (
        nullif(btrim(coalesce(p_extra_category, '')), '') is null
        or exists (
          select 1
          from jsonb_array_elements(coalesce(v_existing.allocations, '[]'::jsonb)) allocation
          where allocation ->> 'type' = 'category'
            and allocation ->> 'category' = p_extra_category
        )
      ) then
      return jsonb_build_object(
        'transaction_id', p_transaction_id,
        'resolution', v_existing.resolution,
        'allocations', v_existing.allocations,
        'reviewed_at', v_existing.reviewed_at,
        'retry', true
      );
    end if;
    raise exception 'This transaction has already been reviewed';
  end if;
  if v_existing.transaction_id is not null then
    raise exception 'This transaction review state changed. Refresh and try again';
  end if;

  -- Lock the mutable destination before the legacy implementation snapshots
  -- and changes it. Undo returns the transaction to needs_review, so a later
  -- deliberate redo takes these locks and can apply once again.
  if p_resolution = 'goal' then
    perform 1 from public.goals where id = p_target_id for update;
  elsif p_resolution = 'decision' then
    perform 1 from public.decisions where id = p_target_id for update;
  elsif p_resolution = 'bill' then
    perform 1 from public.bills where id = p_target_id for update;
  elsif p_resolution = 'income' then
    perform 1 from public.incomes where id = p_target_id for update;
  end if;

  return private.reconcile_transaction_unlocked_v1(
    p_transaction_id,
    p_resolution,
    p_target_id,
    p_occurrence_date,
    p_planned_amount,
    p_settlement,
    p_extra_category
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION private.reconcile_transaction_unlocked_v1(p_transaction_id text, p_resolution text, p_target_id text DEFAULT NULL::text, p_occurrence_date date DEFAULT NULL::date, p_planned_amount numeric DEFAULT NULL::numeric, p_settlement text DEFAULT NULL::text, p_extra_category text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_tx public.transactions%rowtype;
  v_bill public.bills%rowtype;
  v_income public.incomes%rowtype;
  v_goal public.goals%rowtype;
  v_decision public.decisions%rowtype;
  v_match public.bill_transaction_matches%rowtype;
  v_existing public.transaction_reconciliations%rowtype;
  v_actual numeric;
  v_primary numeric;
  v_extra numeric;
  v_allocations jsonb;
  v_snapshot jsonb;
  v_now timestamptz := now();
begin
  if (select auth.uid()) is null then raise exception 'Sign in to review transactions'; end if;
  select * into v_tx from public.transactions where id = p_transaction_id and removed_at is null and pending is not true;
  if not found then raise exception 'Posted transaction was not found'; end if;
  if v_tx.household_id is null or not public.is_household_editor(v_tx.household_id) then
    raise exception 'You need household edit access to review transactions';
  end if;
  if not exists (select 1 from public.household_plans hp where hp.household_id = v_tx.household_id and private.has_review_center_entitlement(v_tx.household_id)) then
    raise exception 'Review Center requires the Pro plan';
  end if;
  if p_resolution not in ('bill', 'income', 'goal', 'decision', 'category', 'transfer') then
    raise exception 'Unsupported review resolution';
  end if;

  select * into v_existing from public.transaction_reconciliations where transaction_id = p_transaction_id;
  v_snapshot := case when found then v_existing.restore_snapshot else jsonb_build_object(
    'category', v_tx.category,
    'linkedBillId', v_tx.linked_bill_id,
    'linkedIncomeId', v_tx.linked_income_id,
    'linkedPlanId', v_tx.linked_plan_id,
    'linkedPlanType', v_tx.linked_plan_type,
    'matchConfidence', v_tx.match_confidence,
    'matchReason', v_tx.match_reason
  ) end;
  v_actual := abs(v_tx.amount);

  if p_resolution = 'category' then
    if nullif(btrim(coalesce(p_target_id, '')), '') is null then raise exception 'Choose a category'; end if;
    v_allocations := jsonb_build_array(jsonb_build_object('type', 'category', 'category', p_target_id, 'amount', v_actual));
    update public.transactions set category = p_target_id, review_status = 'categorized', review_resolution = 'category',
      review_allocations = v_allocations, reviewed_at = v_now, reviewed_by = (select auth.uid()),
      linked_income_id = null, linked_plan_id = null, linked_plan_type = null, matched_occurrence_date = null
    where id = p_transaction_id;
  elsif p_resolution = 'transfer' then
    v_allocations := jsonb_build_array(jsonb_build_object('type', 'transfer', 'amount', v_actual));
    update public.transactions set category = 'Transfer', review_status = 'transfer', review_resolution = 'transfer',
      review_allocations = v_allocations, reviewed_at = v_now, reviewed_by = (select auth.uid()),
      linked_income_id = null, linked_plan_id = null, linked_plan_type = null, matched_occurrence_date = null
    where id = p_transaction_id;
  elsif p_resolution = 'bill' then
    if v_tx.amount >= 0 then raise exception 'Only money-out transactions can match bills'; end if;
    select * into v_bill from public.bills where id = p_target_id;
    if not found or v_bill.household_id is distinct from v_tx.household_id or v_bill.budget_id is distinct from v_tx.budget_id then
      raise exception 'Bill does not belong to this household plan';
    end if;
    if p_occurrence_date is null or p_planned_amount is null or p_planned_amount <= 0 then raise exception 'Bill occurrence details are required'; end if;
    if coalesce(p_settlement, '') not in ('exact', 'full', 'partial', 'split', 'extra_principal') then raise exception 'Choose how this bill was paid'; end if;
    v_primary := case when p_settlement in ('split', 'extra_principal') then least(v_actual, p_planned_amount) else v_actual end;
    v_extra := greatest(0, v_actual - v_primary);
    if p_settlement = 'split' and (v_extra <= 0 or nullif(btrim(coalesce(p_extra_category, '')), '') is null) then
      raise exception 'Choose a category for the extra amount';
    end if;
    perform public.match_transaction_to_bill(p_transaction_id, p_target_id);
    select * into v_match from public.bill_transaction_matches where transaction_id = p_transaction_id;
    update public.bill_transaction_matches set matched_amount = v_primary, occurrence_date = p_occurrence_date,
      planned_amount = p_planned_amount, settlement = p_settlement where transaction_id = p_transaction_id;
    update public.monthly_overrides o set
      paid_amount = totals.amount,
      actual_amount = totals.amount,
      paid_date = totals.latest_date,
      custom_amount = case
        when v_bill.frequency = 'monthly' and p_settlement = 'full' and v_primary < p_planned_amount then v_primary
        else o.custom_amount
      end
    from (
      select coalesce(sum(matched_amount), 0) amount, max(transaction_date) latest_date
      from public.bill_transaction_matches
      where bill_id = p_target_id and match_month = v_match.match_month and match_year = v_match.match_year
    ) totals
    where o.id = v_match.override_id;
    v_allocations := jsonb_build_array(jsonb_build_object(
      'type', 'bill', 'targetId', p_target_id, 'name', v_bill.name, 'category', v_bill.category,
      'amount', v_primary, 'plannedAmount', p_planned_amount, 'occurrenceDate', p_occurrence_date, 'settlement', p_settlement
    ));
    if v_extra > 0 then
      v_allocations := v_allocations || jsonb_build_array(jsonb_build_object(
        'type', case when p_settlement = 'extra_principal' then 'extra_principal' else 'category' end,
        'targetId', case when p_settlement = 'extra_principal' then p_target_id else null end,
        'category', case when p_settlement = 'extra_principal' then 'Debt' else p_extra_category end,
        'amount', v_extra
      ));
    end if;
    update public.transactions set review_status = 'matched', review_resolution = 'bill', review_allocations = v_allocations,
      reviewed_at = v_now, reviewed_by = (select auth.uid()), matched_occurrence_date = p_occurrence_date
    where id = p_transaction_id;
  elsif p_resolution = 'income' then
    if v_tx.amount <= 0 then raise exception 'Only deposits can match planned income'; end if;
    select * into v_income from public.incomes where id = p_target_id;
    if not found or v_income.household_id is distinct from v_tx.household_id or v_income.budget_id is distinct from v_tx.budget_id then
      raise exception 'Income does not belong to this household plan';
    end if;
    if p_occurrence_date is null or p_planned_amount is null or p_planned_amount <= 0 then raise exception 'Income occurrence details are required'; end if;
    if coalesce(p_settlement, '') not in ('exact', 'full', 'partial') then raise exception 'Choose how this income was received'; end if;
    v_allocations := jsonb_build_array(jsonb_build_object(
      'type', 'income', 'targetId', p_target_id, 'name', v_income.name, 'amount', v_actual,
      'plannedAmount', p_planned_amount, 'occurrenceDate', p_occurrence_date, 'settlement', p_settlement
    ));
    update public.transactions set category = 'Income', linked_bill_id = null, linked_income_id = p_target_id,
      linked_plan_id = null, linked_plan_type = null, matched_occurrence_date = p_occurrence_date,
      match_confidence = 1, match_reason = 'confirmed_income_match', review_status = 'matched', review_resolution = 'income',
      review_allocations = v_allocations, reviewed_at = v_now, reviewed_by = (select auth.uid())
    where id = p_transaction_id;
  elsif p_resolution = 'goal' then
    if v_tx.amount >= 0 then raise exception 'Only money-out transactions can match planned expenses'; end if;
    if p_occurrence_date is null or p_planned_amount is null or p_planned_amount <= 0 then raise exception 'Planned occurrence details are required'; end if;
    if coalesce(p_settlement, '') not in ('exact', 'full', 'partial', 'split') then raise exception 'Choose how this planned expense was paid'; end if;
    if p_settlement = 'split' and nullif(btrim(coalesce(p_extra_category, '')), '') is null then raise exception 'Choose a category for the extra amount'; end if;
    select * into v_goal from public.goals where id = p_target_id and goal_type = 'planned_expense';
    if not found or v_goal.household_id is distinct from v_tx.household_id or v_goal.budget_id is distinct from v_tx.budget_id then
      raise exception 'Planned expense does not belong to this household plan';
    end if;
    v_snapshot := v_snapshot || jsonb_build_object('goalCurrentAmount', v_goal.current_amount);
    v_primary := case when p_settlement = 'split' then least(v_actual, coalesce(p_planned_amount, v_actual)) else v_actual end;
    v_extra := greatest(0, v_actual - v_primary);
    update public.goals set current_amount = case when p_settlement = 'partial' then least(target_amount, current_amount + v_primary) else target_amount end where id = p_target_id;
    v_allocations := jsonb_build_array(jsonb_build_object('type', 'planned_expense', 'source', 'goal', 'targetId', p_target_id,
      'name', v_goal.name, 'amount', v_primary, 'plannedAmount', p_planned_amount, 'occurrenceDate', p_occurrence_date, 'settlement', p_settlement));
    if v_extra > 0 then v_allocations := v_allocations || jsonb_build_array(jsonb_build_object('type', 'category', 'category', p_extra_category, 'amount', v_extra)); end if;
    update public.transactions set linked_bill_id = null, linked_income_id = null, linked_plan_id = p_target_id, linked_plan_type = 'goal',
      matched_occurrence_date = p_occurrence_date, match_confidence = 1, match_reason = 'confirmed_plan_match', review_status = 'matched',
      review_resolution = 'goal', review_allocations = v_allocations, reviewed_at = v_now, reviewed_by = (select auth.uid()) where id = p_transaction_id;
  else
    if v_tx.amount >= 0 then raise exception 'Only money-out transactions can match planned expenses'; end if;
    if p_occurrence_date is null or p_planned_amount is null or p_planned_amount <= 0 then raise exception 'Planned occurrence details are required'; end if;
    if coalesce(p_settlement, '') not in ('exact', 'full', 'partial', 'split') then raise exception 'Choose how this planned expense was paid'; end if;
    if p_settlement = 'split' and nullif(btrim(coalesce(p_extra_category, '')), '') is null then raise exception 'Choose a category for the extra amount'; end if;
    select * into v_decision from public.decisions where id = p_target_id;
    if not found or v_decision.household_id is distinct from v_tx.household_id or v_decision.budget_id is distinct from v_tx.budget_id then
      raise exception 'Calendar plan does not belong to this household plan';
    end if;
    v_snapshot := v_snapshot || jsonb_build_object('decisionStatus', v_decision.status, 'decisionActualAmount', v_decision.actual_amount, 'decisionCompletedAt', v_decision.completed_at);
    v_primary := case when p_settlement = 'split' then least(v_actual, coalesce(p_planned_amount, v_actual)) else v_actual end;
    v_extra := greatest(0, v_actual - v_primary);
    update public.decisions set status = case when p_settlement = 'partial' then status else 'completed' end,
      actual_amount = v_primary, completed_at = case when p_settlement = 'partial' then completed_at else v_now end, updated_at = v_now where id = p_target_id;
    v_allocations := jsonb_build_array(jsonb_build_object('type', 'planned_expense', 'source', 'decision', 'targetId', p_target_id,
      'name', v_decision.name, 'amount', v_primary, 'plannedAmount', p_planned_amount, 'occurrenceDate', p_occurrence_date, 'settlement', p_settlement));
    if v_extra > 0 then v_allocations := v_allocations || jsonb_build_array(jsonb_build_object('type', 'category', 'category', p_extra_category, 'amount', v_extra)); end if;
    update public.transactions set linked_bill_id = null, linked_income_id = null, linked_plan_id = p_target_id, linked_plan_type = 'decision',
      matched_occurrence_date = p_occurrence_date, match_confidence = 1, match_reason = 'confirmed_plan_match', review_status = 'matched',
      review_resolution = 'decision', review_allocations = v_allocations, reviewed_at = v_now, reviewed_by = (select auth.uid()) where id = p_transaction_id;
  end if;

  insert into public.transaction_reconciliations (
    transaction_id, user_id, household_id, budget_id, resolution, target_id, occurrence_date,
    settlement, planned_amount, allocations, restore_snapshot, reviewed_by, reviewed_at, updated_at
  ) values (
    p_transaction_id, v_tx.user_id, v_tx.household_id, v_tx.budget_id, p_resolution, p_target_id,
    p_occurrence_date, coalesce(p_settlement, 'regular'), p_planned_amount, v_allocations, v_snapshot,
    (select auth.uid()), v_now, v_now
  ) on conflict (transaction_id) do update set
    resolution = excluded.resolution, target_id = excluded.target_id, occurrence_date = excluded.occurrence_date,
    settlement = excluded.settlement, planned_amount = excluded.planned_amount, allocations = excluded.allocations,
    restore_snapshot = excluded.restore_snapshot, reviewed_by = excluded.reviewed_by,
    reviewed_at = excluded.reviewed_at, updated_at = excluded.updated_at;

  return jsonb_build_object('transaction_id', p_transaction_id, 'resolution', p_resolution, 'allocations', v_allocations, 'reviewed_at', v_now);
end;
$function$
;

CREATE OR REPLACE FUNCTION private.replace_bucket_purchase(p_bank_id text, p_manual_id text, p_expected_manual_amount numeric, p_expected_bank_amount numeric, p_expected_bank_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_variable
declare b public.transactions%rowtype; m public.transactions%rowtype; g public.goals%rowtype;
 r public.transaction_reconciliations%rowtype; allocation jsonb; snapshot jsonb; amount numeric;
begin
 if auth.uid() is null then raise exception 'Sign in to match this purchase'; end if;
 select * into b from public.transactions where id=p_bank_id for update;
 if not found or b.source is distinct from 'plaid' or b.pending is true or b.deleted_at is not null or b.removed_at is not null then raise exception 'Posted bank transaction not found'; end if;
 if b.household_id is null or not private.is_household_editor(b.household_id) or not private.has_review_center_entitlement(b.household_id) then raise exception 'Household edit access is required'; end if;
 select * into r from public.transaction_reconciliations where transaction_id=b.id for update;
 if r.resolution='goal' and r.restore_snapshot->>'bucketReplacementManualId'=p_manual_id
   and (r.restore_snapshot->>'bucketReplacementExpectedManualAmount')::numeric=p_expected_manual_amount
   and abs(b.amount)=p_expected_bank_amount and b.date::date=p_expected_bank_date then
  select * into g from public.goals where id=r.target_id;
  return jsonb_build_object('transaction',to_jsonb(b),'goal',to_jsonb(g),'retry',true);
 end if;
 if b.review_status<>'needs_review' or b.linked_bill_id is not null or b.linked_plan_id is not null or b.linked_income_id is not null
  or b.transfer_group_id is not null or b.debt_applied_bill_id is not null or coalesce(b.debt_applied_amount,0)<>0 or r.transaction_id is not null then raise exception 'This bank transaction is already assigned'; end if;
 if not exists(select 1 from public.plaid_accounts a where a.household_id=b.household_id and (a.plaid_account_id=b.plaid_account_id or a.id::text=b.plaid_account_id) and lower(coalesce(a.account_type,a.type,'')) in ('depository','checking') and lower(coalesce(a.account_subtype,a.subtype,''))='checking') then raise exception 'Choose a posted checking-account transaction'; end if;
 select * into m from public.transactions where id=p_manual_id and id<>p_bank_id for update;
 if not found or (m.source is not null and m.source<>'manual') or m.import_hash is not null or m.pending is true or m.deleted_at is not null or m.removed_at is not null
  or m.linked_plan_type is distinct from 'goal' or m.review_resolution is distinct from 'goal' or m.linked_bill_id is not null or m.linked_income_id is not null or m.transfer_group_id is not null
  or m.debt_applied_bill_id is not null or coalesce(m.debt_applied_amount,0)<>0 or m.amount>=0 then raise exception 'Manual bucket purchase not found'; end if;
 if m.household_id is distinct from b.household_id or m.budget_id is distinct from b.budget_id then raise exception 'Choose a purchase from this household plan'; end if;
 if abs(m.amount) is distinct from p_expected_manual_amount or abs(b.amount) is distinct from p_expected_bank_amount or b.date::date is distinct from p_expected_bank_date
  then raise exception 'Purchase details changed. Refresh and choose again'; end if;
 if date_trunc('month',m.date::date)<>date_trunc('month',b.date::date) and not exists(
  select 1 from public.pending_plan_matches link where link.target_type='manual' and link.target_id=m.id and link.status='ready_review'
   and link.household_id=b.household_id and link.budget_id is not distinct from b.budget_id
   and (link.posted_transaction_id=b.id or link.posted_plaid_transaction_id=b.plaid_transaction_id)
   and (link.posted_transaction_id is null or link.posted_transaction_id=b.id)
   and (link.posted_plaid_transaction_id is null or link.posted_plaid_transaction_id=b.plaid_transaction_id)
 ) then raise exception 'Manual and posted purchases must be in the same month unless explicitly linked while pending'; end if;
 select * into r from public.transaction_reconciliations where transaction_id=m.id and resolution='goal' and target_id=m.linked_plan_id for update;
 if not found then raise exception 'The manual purchase allocation is no longer available'; end if;
 select * into g from public.goals where id=r.target_id for update;
 if not found or g.goal_type<>'planned_expense' or g.household_id is distinct from b.household_id or g.budget_id is distinct from b.budget_id then raise exception 'Spending bucket not found'; end if;
 if g.closed_at is not null or g.archived_at is not null then raise exception 'Reopen the bucket before replacing this purchase'; end if;
 select coalesce(sum((x->>'amount')::numeric),0) into amount from jsonb_array_elements(r.allocations) x where x->>'type'='planned_expense' and x->>'source'='goal' and x->>'targetId'=g.id;
 if amount<=0 or abs(amount-abs(m.amount))>0.005 then raise exception 'This split purchase must be removed from its bucket before replacement'; end if;
 if p_expected_bank_amount<=0 or p_expected_bank_amount>1000000000 or lower(p_expected_bank_amount::text) in ('nan','infinity','-infinity')
  or p_expected_bank_amount>g.target_amount-g.current_amount+amount+0.005 then raise exception 'The posted amount exceeds the bucket budget. Adjust the budget first'; end if;
 snapshot:=r.restore_snapshot||jsonb_build_object('bucketReplacementManualId',m.id,'bucketReplacementExpectedManualAmount',p_expected_manual_amount,
  'bucketReplacementManual',to_jsonb(m),'bucketReplacementReconciliation',to_jsonb(r),'bucketReplacementBank',to_jsonb(b));
 allocation:=jsonb_build_array(jsonb_build_object('type','planned_expense','source','goal','targetId',g.id,'name',g.name,'amount',p_expected_bank_amount,'plannedAmount',p_expected_bank_amount,'occurrenceDate',b.date,'settlement','partial'));
 update public.transaction_reconciliations set transaction_id=b.id,user_id=b.user_id,occurrence_date=b.date::date,settlement='partial',planned_amount=p_expected_bank_amount,allocations=allocation,restore_snapshot=snapshot,reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now() where transaction_id=m.id;
 update public.transactions set removed_at=now(),match_reason='replaced_by_posted_transaction' where id=m.id;
 update public.transactions set category=m.category,note=coalesce(nullif(btrim(m.note),''),b.note),linked_plan_id=g.id,linked_plan_type='goal',matched_occurrence_date=b.date::date,
  review_status='matched',review_resolution='goal',review_allocations=allocation,match_confidence=1,match_reason='confirmed_bucket_replacement',reviewed_at=now(),reviewed_by=auth.uid() where id=b.id returning * into b;
 select * into g from public.goals where id=g.id;
 return jsonb_build_object('transaction',to_jsonb(b),'goal',to_jsonb(g),'manual_id',m.id,'retry',false);
end;
$function$
;

CREATE OR REPLACE FUNCTION private.transfer_manual_activity_metadata()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

    if coalesce(old.debt_applied_amount, 0) <> 0 or old.debt_applied_bill_id is not null then
      raise exception 'The bank transaction already owns an applied debt payment';
    end if;
    if v_manual.linked_bill_id is not null and (
      (v_manual.source is not null and v_manual.source <> 'manual')
      or not exists (
        select 1 from public.bills debt
        where debt.id = v_manual.linked_bill_id
          and debt.household_id is not distinct from new.household_id
          and debt.budget_id is not distinct from new.budget_id
          and debt.is_debt = true
      )
    ) then
      raise exception 'The linked manual debt payment is no longer valid';
    end if;

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
      'linkedBillId', old.linked_bill_id,
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
    -- The active bank row takes ownership of this already-applied debt payment.
    -- Keeping its debt link prevents canonical sync from reversing the payment.
    new.linked_bill_id := v_manual.linked_bill_id;
    new.debt_applied_amount := coalesce(v_manual.debt_applied_amount, 0);
    new.debt_applied_bill_id := v_manual.debt_applied_bill_id;
    new.user_edited_at := now();
  elsif old.review_resolution = 'manual'
    and new.review_resolution is distinct from 'manual' then
    -- Sync may have adjusted the applied amount for a different posted amount
    -- or date. Hand that current audit back; the next sync computes only delta.
    update public.transactions manual
      set debt_applied_amount = old.debt_applied_amount,
          debt_applied_bill_id = old.debt_applied_bill_id
      where manual.id = old.linked_plan_id
        and manual.household_id is not distinct from old.household_id
        and manual.budget_id is not distinct from old.budget_id;
    v_restore := old.review_allocations->0->'restoreBankActivity';
    if v_restore is not null then
      new.note := coalesce(v_restore->>'note', '');
      if v_restore ? 'linkedBillId' then
        new.linked_bill_id := nullif(v_restore->>'linkedBillId', '');
      end if;
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
$function$
;

CREATE OR REPLACE FUNCTION private.undo_bucket_purchase(p_transaction_id text, p_bucket_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_variable
declare t public.transactions%rowtype; m public.transactions%rowtype; g public.goals%rowtype;
 r public.transaction_reconciliations%rowtype; saved public.transaction_reconciliations%rowtype; snapshot jsonb; prior public.transactions%rowtype;
begin
 if auth.uid() is null then raise exception 'Sign in to remove a purchase'; end if;
 select * into t from public.transactions where id=p_transaction_id for update;
 if not found or t.household_id is null or not private.is_household_editor(t.household_id) or not private.has_review_center_entitlement(t.household_id) then raise exception 'Household edit access is required'; end if;
 select * into r from public.transaction_reconciliations where transaction_id=t.id for update;
 if r.transaction_id is null and t.linked_plan_id is not null then raise exception 'This purchase is no longer available'; end if;
 -- Lock both cash representations before the goal, matching the replacement RPC.
 if r.restore_snapshot ? 'bucketReplacementManualId' then
  perform 1 from public.transactions where id=r.restore_snapshot->>'bucketReplacementManualId' for update;
 end if;
 select * into g from public.goals where id=p_bucket_id for update;
 if not found or g.goal_type<>'planned_expense' or g.household_id is distinct from t.household_id or g.budget_id is distinct from t.budget_id then raise exception 'Spending bucket not found'; end if;
 if r.transaction_id is null and t.linked_plan_id is null then return jsonb_build_object('transaction',to_jsonb(t),'goal',to_jsonb(g),'retry',true); end if;
 if r.resolution is distinct from 'goal' or r.target_id is distinct from p_bucket_id or t.linked_plan_type is distinct from 'goal' or t.linked_plan_id is distinct from p_bucket_id or t.removed_at is not null or t.deleted_at is not null then raise exception 'This transaction is not an active purchase in this bucket'; end if;
 if g.closed_at is not null or g.archived_at is not null then raise exception 'Reopen this bucket before removing a purchase'; end if;
 snapshot:=r.restore_snapshot;
 if snapshot ? 'bucketReplacementManualId' then
  select * into m from public.transactions where id=snapshot->>'bucketReplacementManualId' for update;
  if not found or m.household_id is distinct from g.household_id or m.budget_id is distinct from g.budget_id or m.deleted_at is not null then raise exception 'The original manual purchase is no longer available'; end if;
  if exists(select 1 from public.transaction_reconciliations where transaction_id=m.id) then raise exception 'The manual purchase already has a different match'; end if;
  saved:=jsonb_populate_record(null::public.transaction_reconciliations,snapshot->'bucketReplacementReconciliation');
  update public.transaction_reconciliations set transaction_id=m.id,user_id=saved.user_id,occurrence_date=saved.occurrence_date,settlement=saved.settlement,planned_amount=saved.planned_amount,allocations=saved.allocations,restore_snapshot=saved.restore_snapshot,reviewed_by=saved.reviewed_by,reviewed_at=saved.reviewed_at,updated_at=now() where transaction_id=t.id;
  prior:=jsonb_populate_record(null::public.transactions,snapshot->'bucketReplacementManual');
  update public.transactions set removed_at=prior.removed_at,match_reason=prior.match_reason where id=m.id;
  prior:=jsonb_populate_record(null::public.transactions,snapshot->'bucketReplacementBank');
  update public.transactions set category=prior.category,note=prior.note,linked_plan_id=prior.linked_plan_id,linked_plan_type=prior.linked_plan_type,linked_bill_id=prior.linked_bill_id,linked_income_id=prior.linked_income_id,
   matched_occurrence_date=prior.matched_occurrence_date,match_confidence=prior.match_confidence,match_reason=prior.match_reason,review_status=prior.review_status,review_resolution=prior.review_resolution,review_allocations=prior.review_allocations,reviewed_at=prior.reviewed_at,reviewed_by=prior.reviewed_by where id=t.id returning * into t;
 else
  perform private.undo_transaction_reconciliation(t.id);
  if snapshot ? 'bucketPriorTransaction' then
   prior:=jsonb_populate_record(null::public.transactions,snapshot->'bucketPriorTransaction');
   if snapshot->'bucketPriorReconciliation' is not null and snapshot->'bucketPriorReconciliation'<>'null'::jsonb then
    saved:=jsonb_populate_record(null::public.transaction_reconciliations,snapshot->'bucketPriorReconciliation');
    insert into public.transaction_reconciliations select saved.*;
   end if;
   update public.transactions set review_status=prior.review_status,review_resolution=prior.review_resolution,review_allocations=prior.review_allocations,reviewed_at=prior.reviewed_at,reviewed_by=prior.reviewed_by,matched_occurrence_date=prior.matched_occurrence_date where id=t.id;
  end if;
  select * into t from public.transactions where id=t.id;
 end if;
 select * into g from public.goals where id=p_bucket_id;
 return jsonb_build_object('transaction',to_jsonb(t),'goal',to_jsonb(g),'retry',false);
end;
$function$
;

CREATE OR REPLACE FUNCTION private.update_bucket_budget(p_bucket_id text, p_name text, p_target_amount numeric, p_target_date date, p_expected jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_variable
declare g public.goals%rowtype;
begin
 if auth.uid() is null then raise exception 'Sign in to adjust the bucket'; end if;
 select * into g from public.goals where id=p_bucket_id for update;
 if not found or g.household_id is null or g.goal_type<>'planned_expense' or not private.is_household_editor(g.household_id) then raise exception 'Household edit access is required'; end if;
 if g.closed_at is not null or g.archived_at is not null then raise exception 'Reopen this bucket before adjusting its budget'; end if;
 if p_target_amount is null or lower(p_target_amount::text) in ('nan','infinity','-infinity') or p_target_amount<=0 or p_target_amount>1000000000 or round(p_target_amount,2)<>p_target_amount or p_target_amount+0.005<g.current_amount then raise exception 'The bucket budget must cover its existing purchases'; end if;
 if nullif(btrim(p_name),'') is null or length(btrim(p_name))>120 or p_target_date is null then raise exception 'Choose a bucket name and target date'; end if;
 if g.name=p_name and g.target_amount=p_target_amount and g.target_date::date=p_target_date then return jsonb_build_object('goal',to_jsonb(g),'retry',true); end if;
 if p_expected is null or g.name is distinct from p_expected->>'name' or g.target_amount is distinct from (p_expected->>'target_amount')::numeric or g.target_date::date is distinct from (p_expected->>'target_date')::date then raise exception 'The bucket budget changed on another device. Refresh and try again'; end if;
 update public.goals set name=btrim(p_name),target_amount=p_target_amount,target_date=p_target_date::text where id=g.id returning * into g;
 return jsonb_build_object('goal',to_jsonb(g),'retry',false);
end;
$function$
;

CREATE OR REPLACE FUNCTION private.update_bucket_purchase(p_transaction_id text, p_bucket_id text, p_expected_amount numeric, p_transaction jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_variable
declare t public.transactions%rowtype; g public.goals%rowtype; r public.transaction_reconciliations%rowtype; actual numeric; old_applied numeric; account text; allocations jsonb;
begin
 if auth.uid() is null then raise exception 'Sign in to update a purchase'; end if;
 select * into t from public.transactions where id=p_transaction_id for update;
 if not found or t.household_id is null or not private.is_household_editor(t.household_id) or not private.has_review_center_entitlement(t.household_id) then raise exception 'Household edit access is required'; end if;
 select * into r from public.transaction_reconciliations where transaction_id=t.id and resolution='goal' and target_id=p_bucket_id for update;
 if not found or t.linked_plan_type is distinct from 'goal' or t.linked_plan_id is distinct from p_bucket_id or t.pending is true or t.removed_at is not null or t.deleted_at is not null then raise exception 'Active bucket purchase not found'; end if;
 select * into g from public.goals where id=p_bucket_id for update;
 if not found or g.goal_type<>'planned_expense' or g.household_id is distinct from t.household_id or g.budget_id is distinct from t.budget_id or g.closed_at is not null or g.archived_at is not null then raise exception 'Reopen the bucket before changing its purchase'; end if;
 if (t.source is not null and t.source<>'manual') or t.import_hash is not null then raise exception 'Remove this bank purchase from its bucket before changing transaction details'; end if;
 actual:=-(p_transaction->>'amount')::numeric;
 if actual is null or lower(actual::text) in ('nan','infinity','-infinity') or actual<=0 or actual>1000000000 or round(actual,2)<>actual then raise exception 'Enter a positive purchase amount'; end if;
 if nullif(p_transaction->>'date','') is null or nullif(btrim(p_transaction->>'category'),'') is null or p_transaction->>'category'='Transfer' then raise exception 'Choose a purchase date and category'; end if;
 perform (p_transaction->>'date')::date;
 account:=nullif(p_transaction->>'account_id','');
 if account is not null and not exists(select 1 from public.accounts a where a.id=account and a.household_id=g.household_id and a.is_active) then raise exception 'Choose an active household account'; end if;
 if t.amount=-actual and t.date=p_transaction->>'date' and t.category=p_transaction->>'category' and t.note=coalesce(p_transaction->>'note','') and t.account_id is not distinct from account then
  return jsonb_build_object('transaction',to_jsonb(t),'goal',to_jsonb(g),'retry',true);
 end if;
 if t.amount is distinct from p_expected_amount then raise exception 'The purchase changed on another device. Refresh and try again'; end if;
 select coalesce(sum((x->>'amount')::numeric),0) into old_applied from jsonb_array_elements(r.allocations) x where x->>'type'='planned_expense' and x->>'source'='goal' and x->>'targetId'=g.id;
 if abs(old_applied-abs(t.amount))>0.005 then raise exception 'Remove this split purchase from the bucket before editing its amount'; end if;
 if actual>old_applied+0.005 and actual>g.target_amount-g.current_amount+old_applied+0.005 then raise exception 'The purchase exceeds the bucket budget. Adjust the budget first'; end if;
 allocations:=jsonb_build_array(jsonb_build_object('type','planned_expense','source','goal','targetId',g.id,'name',g.name,'amount',actual,'plannedAmount',actual,'occurrenceDate',p_transaction->>'date','settlement','partial'));
 update public.transaction_reconciliations set allocations=allocations,planned_amount=actual,settlement='partial',occurrence_date=(p_transaction->>'date')::date,updated_at=now() where transaction_id=t.id;
 update public.transactions set amount=-actual,date=p_transaction->>'date',category=p_transaction->>'category',note=coalesce(p_transaction->>'note',''),account_id=account,review_allocations=allocations,matched_occurrence_date=(p_transaction->>'date')::date,user_edited_at=now() where id=t.id returning * into t;
 select * into g from public.goals where id=p_bucket_id;
 return jsonb_build_object('transaction',to_jsonb(t),'goal',to_jsonb(g),'retry',false);
end;
$function$
;

CREATE OR REPLACE FUNCTION private.update_manual_account_with_anchor(p_household_id uuid, p_budget_id uuid, p_expected_account jsonb, p_account jsonb, p_mutation_id text, p_balance_id text, p_record_balance boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := auth.uid();
  v_account public.accounts%rowtype;
  v_settings public.household_settings%rowtype;
  v_history public.account_balances%rowtype;
  v_receipt private.manual_account_mutation_receipts%rowtype;
  v_intent jsonb;
  v_matches_expected boolean;
  v_matches_intent boolean;
  v_retry boolean := false;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  if p_household_id is null or not public.is_household_editor(p_household_id) then
    raise exception 'Household edit access required';
  end if;
  if not exists (
    select 1
    from public.budgets
    where id = p_budget_id and household_id = p_household_id
  ) then
    raise exception 'The active household budget changed';
  end if;
  if jsonb_typeof(coalesce(p_expected_account, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_account, '{}'::jsonb)) <> 'object'
     or coalesce(p_expected_account ->> 'id', '') = ''
     or p_expected_account ->> 'id' is distinct from p_account ->> 'id'
     or coalesce(p_mutation_id, '') = ''
     or not (p_expected_account ?& array[
       'name', 'account_type', 'current_balance', 'balance_as_of', 'is_active'
     ])
     or not (p_account ?& array[
       'name', 'account_type', 'current_balance', 'balance_as_of', 'is_active'
     ])
     or coalesce(p_account ->> 'name', '') = ''
     or p_expected_account ->> 'account_type' not in ('checking', 'savings', 'cash', 'credit_card')
     or p_account ->> 'account_type' not in ('checking', 'savings', 'cash', 'credit_card')
     -- A legacy credit-card row may be preserved or archived, but never
     -- silently coerced into or out of an operating/manual account type.
     or (
       ('credit_card' in (
         p_expected_account ->> 'account_type',
         p_account ->> 'account_type'
       ))
       and p_expected_account ->> 'account_type'
         is distinct from p_account ->> 'account_type'
     )
     or (
       coalesce(p_record_balance, false)
       and coalesce(p_balance_id, '') = ''
     ) then
    raise exception 'Invalid account update intent';
  end if;

  v_intent := jsonb_build_object(
    'account', jsonb_build_object(
      'id', p_account ->> 'id',
      'name', p_account ->> 'name',
      'account_type', p_account ->> 'account_type',
      'current_balance', (p_account ->> 'current_balance')::numeric,
      'balance_as_of', (p_account ->> 'balance_as_of')::date,
      'last_reconciled_at', nullif(p_account ->> 'last_reconciled_at', '')::timestamptz,
      'is_active', (p_account ->> 'is_active')::boolean
    ),
    'record_balance', coalesce(p_record_balance, false),
    'balance_id', case
      when coalesce(p_record_balance, false) then to_jsonb(p_balance_id)
      else 'null'::jsonb
    end
  );

  -- Account creation and settings writes use this same household lock. Stable
  -- row ordering prevents two current clients from observing a shifted
  -- operating aggregate while either CAS is in flight.
  perform pg_advisory_xact_lock(
    hashtextextended('flowledger-settings:' || p_household_id::text, 0)
  );
  perform pg_advisory_xact_lock(
    hashtextextended('flowledger-account-mutation:' || p_mutation_id, 0)
  );
  perform 1
  from public.accounts
  where household_id = p_household_id
  order by id
  for update;

  insert into public.household_settings (household_id, budget_id)
  values (p_household_id, p_budget_id)
  on conflict (household_id) do nothing;

  select * into v_settings
  from public.household_settings
  where household_id = p_household_id
  for update;
  if not found then raise exception 'Household settings could not be initialized'; end if;

  select * into v_account
  from public.accounts
  where id = p_account ->> 'id'
  for update;
  if not found
     or v_account.household_id is distinct from p_household_id
     or v_account.budget_id is distinct from p_budget_id then
    raise exception 'Account does not belong to the active household budget';
  end if;

  v_matches_expected :=
    v_account.name is not distinct from p_expected_account ->> 'name'
    and v_account.account_type is not distinct from p_expected_account ->> 'account_type'
    and v_account.current_balance is not distinct from (p_expected_account ->> 'current_balance')::numeric
    and v_account.balance_as_of is not distinct from (p_expected_account ->> 'balance_as_of')::date
    and v_account.last_reconciled_at is not distinct from nullif(p_expected_account ->> 'last_reconciled_at', '')::timestamptz
    and v_account.is_active is not distinct from (p_expected_account ->> 'is_active')::boolean;
  v_matches_intent :=
    v_account.name is not distinct from p_account ->> 'name'
    and v_account.account_type is not distinct from p_account ->> 'account_type'
    and v_account.current_balance is not distinct from (p_account ->> 'current_balance')::numeric
    and v_account.balance_as_of is not distinct from (p_account ->> 'balance_as_of')::date
    and v_account.last_reconciled_at is not distinct from nullif(p_account ->> 'last_reconciled_at', '')::timestamptz
    and v_account.is_active is not distinct from (p_account ->> 'is_active')::boolean;

  select * into v_receipt
  from private.manual_account_mutation_receipts
  where mutation_id = p_mutation_id
  for update;

  if found then
    if v_receipt.account_id is distinct from v_account.id
       or v_receipt.household_id is distinct from p_household_id
       or v_receipt.budget_id is distinct from p_budget_id
       or v_receipt.intent is distinct from v_intent then
      raise exception using
        errcode = '40001',
        message = 'Account mutation id is already bound to a different intent';
    end if;
    if not v_matches_intent then
      raise exception using
        errcode = '40001',
        message = 'Account changed after this mutation was committed';
    end if;
    v_retry := true;
  elsif v_matches_expected then
    update public.accounts set
      name = p_account ->> 'name',
      account_type = p_account ->> 'account_type',
      current_balance = (p_account ->> 'current_balance')::numeric,
      balance_as_of = (p_account ->> 'balance_as_of')::date,
      last_reconciled_at = nullif(p_account ->> 'last_reconciled_at', '')::timestamptz,
      is_active = (p_account ->> 'is_active')::boolean,
      last_mutation_id = p_mutation_id,
      last_mutation_intent = v_intent
    where id = v_account.id
    returning * into v_account;
  else
    raise exception using
      errcode = '40001',
      message = 'Account changed while editing; refresh and try again';
  end if;

  if coalesce(p_record_balance, false) then
    if not v_retry then
      insert into public.account_balances (
        id, account_id, user_id, household_id, budget_id,
        balance, as_of_date, source
      ) values (
        p_balance_id, v_account.id, v_actor, p_household_id, p_budget_id,
        (p_account ->> 'current_balance')::numeric,
        (p_account ->> 'balance_as_of')::date,
        'reconciliation'
      );
    end if;

    select * into v_history
    from public.account_balances
    where id = p_balance_id
    for update;
    if not found
       or v_history.account_id is distinct from v_account.id
       or v_history.user_id is distinct from v_actor
       or v_history.household_id is distinct from p_household_id
       or v_history.budget_id is distinct from p_budget_id
       or v_history.balance is distinct from (p_account ->> 'current_balance')::numeric
       or v_history.as_of_date is distinct from (p_account ->> 'balance_as_of')::date
       or v_history.source is distinct from 'reconciliation' then
      raise exception using
        errcode = '40001',
        message = 'Balance history id is already bound to a different intent';
    end if;
  end if;

  if not v_retry then
    insert into private.manual_account_mutation_receipts (
      mutation_id, account_id, household_id, budget_id, intent
    ) values (
      p_mutation_id, v_account.id, p_household_id, p_budget_id, v_intent
    );
  end if;

  -- The trigger above has already advanced a coherent aggregate or retained
  -- the last coherent observation. Re-read it inside this same transaction so
  -- the client never has to guess which forecast anchor is authoritative.
  select * into v_settings
  from public.household_settings
  where household_id = p_household_id;

  return jsonb_build_object(
    'account', to_jsonb(v_account),
    'settings', to_jsonb(v_settings),
    'retry', v_retry
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION private.guard_allocated_transaction_edit()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
 if current_user in('postgres','service_role','supabase_admin') then return case when tg_op='DELETE' then old else new end; end if;
 if tg_op='INSERT' then
  if new.transfer_group_id is not null then raise exception 'Use the transfer editor to save both sides together'; end if;
  return new;
 end if;
 if old.transfer_group_id is not null or (tg_op='UPDATE' and new.transfer_group_id is not null) then raise exception 'Use the transfer editor to change both sides together'; end if;
 if tg_op='UPDATE' and row(new.amount,new.date) is distinct from row(old.amount,old.date)
  and (old.linked_income_id is not null or old.linked_plan_id is not null
   or ((old.source='plaid' or old.import_hash is not null or old.review_status='matched')
    and (old.linked_bill_id is not null or old.debt_applied_bill_id is not null or coalesce(old.debt_applied_amount,0)<>0))
   or coalesce(old.review_resolution,'category') not in('category','transfer')
   or private.has_financial_transaction_reconciliation(old.id,old.household_id)
   or exists(select 1 from jsonb_array_elements(old.review_allocations) a where coalesce(a->>'type','') not in('category','transfer'))) then
  raise exception 'Undo this transaction match before changing its amount or date';
 end if;
 return case when tg_op='DELETE' then old else new end;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.guard_bucket_purchase_edit()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
 if current_user not in ('postgres','service_role','supabase_admin') and old.linked_plan_type='goal'
  and exists(select 1 from public.goals where id=old.linked_plan_id and goal_type='planned_expense')
  and row(new.amount,new.date,new.account_id,new.deleted_at,new.removed_at,new.source,new.household_id,new.budget_id)
    is distinct from row(old.amount,old.date,old.account_id,old.deleted_at,old.removed_at,old.source,old.household_id,old.budget_id) then
  raise exception 'Use the bucket purchase action to update or remove this allocated transaction';
 end if;
 return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.recompute_planned_reconciliation_target(p_target_type text, p_target_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_variable
declare
  v_base private.planned_reconciliation_bases%rowtype;
  v_total numeric := 0;
  v_count integer := 0;
  v_has_closing boolean := false;
  v_latest timestamptz;
begin
  select * into v_base
  from private.planned_reconciliation_bases
  where target_type = p_target_type and target_id = p_target_id;
  if not found then return; end if;

  select
    coalesce(sum(
      case when allocation->>'type' = 'planned_expense'
        then coalesce((allocation->>'amount')::numeric, 0)
        else 0
      end
    ), 0),
    count(distinct reconciliation.transaction_id),
    coalesce(bool_or(reconciliation.settlement in ('exact', 'full', 'split')), false),
    max(reconciliation.reviewed_at)
  into v_total, v_count, v_has_closing, v_latest
  from public.transaction_reconciliations reconciliation
  left join lateral jsonb_array_elements(reconciliation.allocations) allocation on true
  where reconciliation.resolution = p_target_type
    and reconciliation.target_id = p_target_id;

  if p_target_type = 'goal' then
    update public.goals
    set current_amount = case
      when v_count = 0 then v_base.base_amount
      when goal_type = 'planned_expense' then v_base.base_amount + v_total
      when v_has_closing then target_amount
      else least(target_amount, v_base.base_amount + v_total)
    end
    where id = p_target_id;
  elsif p_target_type = 'decision' then
    update public.decisions
    set actual_amount = case when v_count = 0 then nullif(v_base.base_amount, 0) else v_base.base_amount + v_total end,
        status = case
          when v_count = 0 then coalesce(v_base.base_status, status)
          when v_has_closing
            or v_base.base_amount + v_total + 0.005 >= abs(coalesce((scenario->>'amount')::numeric, 0))
            then 'completed'
          else coalesce(v_base.base_status, status)
        end,
        completed_at = case
          when v_count = 0 then v_base.base_completed_at
          when v_has_closing
            or v_base.base_amount + v_total + 0.005 >= abs(coalesce((scenario->>'amount')::numeric, 0))
            then coalesce(v_latest, now())
          else v_base.base_completed_at
        end,
        updated_at = now()
    where id = p_target_id;
  end if;

  if v_count = 0 then
    delete from private.planned_reconciliation_bases
    where target_type = p_target_type and target_id = p_target_id;
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.sync_planned_reconciliation_progress()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_row public.transaction_reconciliations%rowtype;
begin
  v_row := case when tg_op = 'DELETE' then old else new end;

  if tg_op <> 'DELETE' and v_row.resolution in ('goal', 'decision') and v_row.target_id is not null then
    insert into private.planned_reconciliation_bases (
      target_type, target_id, base_amount, base_status, base_completed_at
    ) values (
      v_row.resolution,
      v_row.target_id,
      case
        when v_row.resolution = 'goal'
          then coalesce((v_row.restore_snapshot->>'goalCurrentAmount')::numeric, 0)
        else coalesce((v_row.restore_snapshot->>'decisionActualAmount')::numeric, 0)
      end,
      case when v_row.resolution = 'decision' then v_row.restore_snapshot->>'decisionStatus' else null end,
      case
        when v_row.resolution = 'decision' and nullif(v_row.restore_snapshot->>'decisionCompletedAt', '') is not null
          then (v_row.restore_snapshot->>'decisionCompletedAt')::timestamptz
        else null
      end
    )
    on conflict (target_type, target_id) do nothing;
  end if;

  if tg_op = 'UPDATE'
    and old.resolution in ('goal', 'decision')
    and old.target_id is not null
    and row(old.resolution, old.target_id) is distinct from row(new.resolution, new.target_id) then
    perform private.recompute_planned_reconciliation_target(old.resolution, old.target_id);
  end if;

  if v_row.resolution in ('goal', 'decision') and v_row.target_id is not null then
    perform private.recompute_planned_reconciliation_target(v_row.resolution, v_row.target_id);
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.add_bucket_purchase(p_bucket_id text, p_transaction_id text, p_expected_amount numeric, p_expected_date date, p_new_transaction jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$ select private.add_bucket_purchase(p_bucket_id,p_transaction_id,p_expected_amount,p_expected_date,p_new_transaction) $function$
;

CREATE OR REPLACE FUNCTION public.add_manual_account_with_anchor(p_household_id uuid, p_budget_id uuid, p_account jsonb, p_balance_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := auth.uid();
  v_account public.accounts%rowtype;
  v_settings public.household_settings%rowtype;
  v_anchor_balance numeric;
  v_anchor_min_date date;
  v_anchor_max_date date;
  v_inserted_count integer := 0;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  if p_household_id is null or not public.is_household_editor(p_household_id) then
    raise exception 'Household edit access required';
  end if;
  if not exists (
    select 1 from public.budgets
    where id = p_budget_id and household_id = p_household_id
  ) then
    raise exception 'The active household budget changed';
  end if;
  if jsonb_typeof(coalesce(p_account, '{}'::jsonb)) <> 'object'
     or coalesce(p_account ->> 'id', '') = ''
     or coalesce(p_balance_id, '') = ''
     or p_account ->> 'account_type' not in ('checking', 'savings', 'cash') then
    raise exception 'Invalid account creation intent';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('flowledger-settings:' || p_household_id::text, 0));
  insert into public.accounts (
    id, user_id, household_id, budget_id, name, account_type,
    current_balance, balance_as_of, last_reconciled_at, is_active, created_at
  ) values (
    p_account ->> 'id', v_actor, p_household_id, p_budget_id,
    p_account ->> 'name', p_account ->> 'account_type',
    (p_account ->> 'current_balance')::numeric,
    (p_account ->> 'balance_as_of')::date,
    (p_account ->> 'last_reconciled_at')::timestamptz,
    coalesce((p_account ->> 'is_active')::boolean, true),
    coalesce((p_account ->> 'created_at')::timestamptz, now())
  ) on conflict (id) do nothing;
  get diagnostics v_inserted_count = row_count;

  select * into v_account
  from public.accounts
  where id = p_account ->> 'id'
  for update;
  if not found or v_account.household_id is distinct from p_household_id then
    raise exception 'Account id is already in use';
  end if;
  if v_inserted_count = 0 and (
    v_account.user_id is distinct from v_actor
    or v_account.budget_id is distinct from p_budget_id
    or v_account.name is distinct from (p_account ->> 'name')
    or v_account.account_type is distinct from (p_account ->> 'account_type')
    or v_account.current_balance is distinct from (p_account ->> 'current_balance')::numeric
    or v_account.balance_as_of is distinct from (p_account ->> 'balance_as_of')::date
    or v_account.last_reconciled_at is distinct from (p_account ->> 'last_reconciled_at')::timestamptz
    or v_account.is_active is distinct from coalesce((p_account ->> 'is_active')::boolean, true)
  ) then
    raise exception using
      errcode = '40001',
      message = 'Account creation id is already bound to a different intent';
  end if;

  insert into public.household_settings (household_id, budget_id)
  values (p_household_id, p_budget_id)
  on conflict (household_id) do nothing;

  if v_inserted_count > 0 then
    insert into public.account_balances (
      id, account_id, user_id, household_id, budget_id, balance, as_of_date, source
    ) values (
      p_balance_id, v_account.id, v_actor, p_household_id, p_budget_id,
      (p_account ->> 'current_balance')::numeric,
      (p_account ->> 'balance_as_of')::date,
      'manual'
    );

    -- A savings or inactive account does not participate in the spendable
    -- operating anchor. Save it without validating or rewriting that anchor,
    -- even if older legacy operating rows need separate reconciliation.
    if v_account.is_active and v_account.account_type in ('checking', 'cash') then
      select
        sum(account.current_balance),
        min(account.balance_as_of),
        max(account.balance_as_of)
      into v_anchor_balance, v_anchor_min_date, v_anchor_max_date
      from public.accounts account
      where account.household_id = p_household_id
        and account.is_active
        and account.account_type in ('checking', 'cash');

      if v_anchor_min_date is distinct from v_anchor_max_date then
        raise exception using
          errcode = '22023',
          message = 'Active checking and cash balances must share one as-of date';
      end if;

      if v_anchor_max_date is not null then
        update public.household_settings set
          budget_id = p_budget_id,
          starting_balance = coalesce(v_anchor_balance, 0),
          starting_balance_date = v_anchor_max_date::text,
          calendar_start_date = coalesce(calendar_start_date, to_char(v_anchor_max_date, 'YYYY-MM-01')),
          updated_at = now()
        where household_id = p_household_id;
      end if;
    end if;
  end if;

  select * into v_settings
  from public.household_settings
  where household_id = p_household_id;
  return jsonb_build_object('account', to_jsonb(v_account), 'settings', to_jsonb(v_settings));
end;
$function$
;

CREATE OR REPLACE FUNCTION public.apply_debt_snowball_payment(p_payment_id text, p_month integer, p_year integer, p_amount numeric, p_payment_date date, p_allocations jsonb, p_sources jsonb, p_household_id uuid DEFAULT NULL::uuid, p_apply_now boolean DEFAULT false)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_existing_id text;
  v_payment_id text;
  v_old_month integer;
  v_old_year integer;
  v_old_allocations jsonb := '[]'::jsonb;
  v_old_sources jsonb := '[]'::jsonb;
  v_old_applied boolean := false;
  v_override_id text;
  v_change record;
  v_budget_id uuid;
  v_allocation_total numeric;
  v_plan_sources jsonb;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_household_id is not null and not public.is_household_editor(p_household_id) then
    raise exception 'Household edit access required';
  end if;
  if p_month < 0 or p_month > 11 or extract(year from p_payment_date)::integer <> p_year
     or extract(month from p_payment_date)::integer <> p_month + 1 then
    raise exception 'Payment date must stay in the selected Snowball month';
  end if;
  if p_amount <= 0 or jsonb_typeof(coalesce(p_allocations, '[]'::jsonb)) <> 'array' then
    raise exception 'A positive Snowball payment and allocations are required';
  end if;

  select coalesce(sum((item ->> 'payment')::numeric), 0)
  into v_allocation_total
  from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) item;
  if abs(v_allocation_total - p_amount) >= 0.01 then
    raise exception 'Snowball allocations must equal the payment amount';
  end if;

  select coalesce(
    jsonb_agg(source || jsonb_build_object('pendingBalanceApply', true)),
    '[]'::jsonb
  )
  into v_plan_sources
  from jsonb_array_elements(coalesce(p_sources, '[]'::jsonb)) source;
  if jsonb_array_length(v_plan_sources) = 0 then
    v_plan_sources := jsonb_build_array(jsonb_build_object(
      'type', 'manual',
      'amount', p_amount,
      'pendingBalanceApply', true
    ));
  end if;

  if p_household_id is not null then
    select id into v_budget_id
    from public.budgets
    where household_id = p_household_id and is_default
    limit 1;
  end if;

  if p_payment_id is not null then
    select id, month, year, allocations, sources
    into v_existing_id, v_old_month, v_old_year, v_old_allocations, v_old_sources
    from public.extra_payments
    where id = p_payment_id
      and (
        (p_household_id is not null and household_id = p_household_id) or
        (p_household_id is null and user_id = v_user_id)
      )
    limit 1
    for update;
  end if;

  if v_existing_id is null then
    select id, month, year, allocations, sources
    into v_existing_id, v_old_month, v_old_year, v_old_allocations, v_old_sources
    from public.extra_payments
    where month = p_month
      and year = p_year
      and (
        (p_household_id is not null and household_id = p_household_id) or
        (p_household_id is null and user_id = v_user_id)
      )
    limit 1
    for update;
  end if;

  if v_existing_id is not null
     and (v_old_month <> p_month or v_old_year <> p_year)
     and exists (
       select 1
       from public.extra_payments destination
       where destination.id <> v_existing_id
         and destination.month = p_month
         and destination.year = p_year
         and (
           (p_household_id is not null and destination.household_id = p_household_id) or
           (p_household_id is null and destination.user_id = v_user_id)
         )
     ) then
    raise exception 'That month already has a Snowball plan';
  end if;

  v_old_applied := v_existing_id is not null and not exists (
    select 1
    from jsonb_array_elements(coalesce(v_old_sources, '[]'::jsonb)) source
    where coalesce((source ->> 'pendingBalanceApply')::boolean, false)
  );

  if v_old_applied and (v_old_month <> p_month or v_old_year <> p_year) then
    raise exception 'An applied Snowball payment cannot move to another month';
  end if;

  for v_change in
    select bill_id, round(sum(delta), 2) as delta
    from (
      select item ->> 'billId' as bill_id,
             case when p_apply_now then (item ->> 'payment')::numeric else 0 end as delta
      from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) item
      union all
      select item ->> 'billId' as bill_id,
             case when v_old_applied then -((item ->> 'payment')::numeric) else 0 end as delta
      from jsonb_array_elements(coalesce(v_old_allocations, '[]'::jsonb)) item
    ) changes
    group by bill_id
    having abs(sum(delta)) >= 0.005
  loop
    update public.bills
    set balance = greatest(0, balance - v_change.delta)
    where id = v_change.bill_id
      and is_debt
      and (
        (p_household_id is not null and household_id = p_household_id) or
        (p_household_id is null and user_id = v_user_id)
      );
    if not found then raise exception 'Debt % was not found', v_change.bill_id; end if;

    select id into v_override_id
    from public.monthly_overrides
    where bill_id = v_change.bill_id
      and month = p_month
      and year = p_year
      and (
        (p_household_id is not null and household_id = p_household_id) or
        (p_household_id is null and user_id = v_user_id)
      )
    limit 1
    for update;

    if v_override_id is null then
      insert into public.monthly_overrides (
        id, user_id, household_id, budget_id, bill_id, month, year, paid_amount
      )
      values (
        gen_random_uuid()::text, v_user_id, p_household_id, v_budget_id,
        v_change.bill_id, p_month, p_year, greatest(0, v_change.delta)
      );
    else
      update public.monthly_overrides
      set paid_amount = greatest(0, paid_amount + v_change.delta)
      where id = v_override_id
        and (
          (p_household_id is not null and household_id = p_household_id) or
          (p_household_id is null and user_id = v_user_id)
        );
    end if;
    v_override_id := null;
  end loop;

  if v_existing_id is null then
    v_payment_id := coalesce(p_payment_id, gen_random_uuid()::text);
    insert into public.extra_payments (
      id, user_id, household_id, budget_id, month, year,
      amount, allocations, payment_date, sources
    )
    values (
      v_payment_id, v_user_id, p_household_id, v_budget_id, p_month, p_year,
      p_amount, coalesce(p_allocations, '[]'::jsonb), p_payment_date, v_plan_sources
    )
    returning id into v_payment_id;
  else
    update public.extra_payments
    set month = p_month,
        year = p_year,
        amount = p_amount,
        allocations = coalesce(p_allocations, '[]'::jsonb),
        payment_date = p_payment_date,
        sources = v_plan_sources
    where id = v_existing_id
      and (
        (p_household_id is not null and household_id = p_household_id) or
        (p_household_id is null and user_id = v_user_id)
      )
    returning id into v_payment_id;
  end if;

  return v_payment_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.complete_decision(p_decision_id text, p_actual_amount numeric, p_completed_date date, p_account_id text DEFAULT NULL::text, p_debt_plan jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$
  select private.complete_decision(
    p_decision_id, p_actual_amount, p_completed_date,
    p_account_id, p_debt_plan
  )
$function$
;

CREATE OR REPLACE FUNCTION public.create_bill_and_reconcile_transaction(p_transaction_id text, p_bill jsonb)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$
  select private.create_bill_and_reconcile_transaction(p_transaction_id, p_bill)
$function$
;

CREATE OR REPLACE FUNCTION public.create_pending_activity_transaction(p_pending_plaid_transaction_id text, p_transaction_id text, p_household_id uuid, p_budget_id uuid, p_amount numeric, p_date date, p_category text, p_note text, p_account_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$
  select private.create_pending_activity_transaction(
    p_pending_plaid_transaction_id,
    p_transaction_id,
    p_household_id,
    p_budget_id,
    p_amount,
    p_date,
    p_category,
    p_note,
    p_account_id
  )
$function$
;

CREATE OR REPLACE FUNCTION public.create_spending_bucket_for_transaction(p_transaction_id text, p_goal_id text, p_name text, p_target_amount numeric, p_target_date date)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$
  select private.create_spending_bucket_for_transaction(
    p_transaction_id,
    p_goal_id,
    p_name,
    p_target_amount,
    p_target_date
  )
$function$
;

CREATE OR REPLACE FUNCTION public.delete_bucket_purchase(p_transaction_id text, p_bucket_id text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$ select private.delete_bucket_purchase(p_transaction_id,p_bucket_id) $function$
;

CREATE OR REPLACE FUNCTION public.fund_goal(p_goal_id text, p_transaction_id text, p_amount numeric, p_date date, p_expected_current_amount numeric, p_account_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$
  select private.fund_goal(
    p_goal_id, p_transaction_id, p_amount, p_date,
    p_expected_current_amount, p_account_id
  )
$function$
;

CREATE OR REPLACE FUNCTION public.mutate_transfer(p_household_id uuid, p_budget_id uuid, p_group_id text, p_from_id text, p_to_id text, p_expected jsonb, p_payload jsonb, p_action text DEFAULT 'save'::text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$select private.mutate_transfer(p_household_id,p_budget_id,p_group_id,p_from_id,p_to_id,p_expected,p_payload,p_action)$function$
;

CREATE OR REPLACE FUNCTION public.protect_pending_plan_match_identity()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.reconcile_manual_transaction(p_transaction_id text, p_manual_transaction_id text, p_occurrence_date date, p_planned_amount numeric, p_settlement text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$
  select private.reconcile_manual_transaction(
    p_transaction_id,
    p_manual_transaction_id,
    p_occurrence_date,
    p_planned_amount,
    p_settlement
  )
$function$
;

CREATE OR REPLACE FUNCTION public.reconcile_snowball_transaction(p_transaction_id text, p_debt_id text, p_occurrence_date date, p_planned_amount numeric, p_settlement text, p_extra_category text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$
  select private.reconcile_snowball_transaction(
    p_transaction_id,
    p_debt_id,
    p_occurrence_date,
    p_planned_amount,
    p_settlement,
    p_extra_category
  )
$function$
;

CREATE OR REPLACE FUNCTION public.reconcile_transaction(p_transaction_id text, p_resolution text, p_target_id text DEFAULT NULL::text, p_occurrence_date date DEFAULT NULL::date, p_planned_amount numeric DEFAULT NULL::numeric, p_settlement text DEFAULT NULL::text, p_extra_category text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$
  select private.reconcile_transaction(
    p_transaction_id,
    p_resolution,
    p_target_id,
    p_occurrence_date,
    p_planned_amount,
    p_settlement,
    p_extra_category
  )
$function$
;

CREATE OR REPLACE FUNCTION public.remove_debt_snowball_payment(p_month integer, p_year integer, p_household_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_payment_id text;
  v_allocations jsonb;
  v_item jsonb;
  v_bill_id text;
  v_payment numeric;
  v_override_id text;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_household_id is not null and not public.is_household_editor(p_household_id) then
    raise exception 'Household edit access required';
  end if;

  select id, allocations into v_payment_id, v_allocations
    from extra_payments
   where month = p_month
     and year = p_year
     and (
       (p_household_id is not null and household_id = p_household_id) or
       (p_household_id is null and user_id = v_user_id)
     )
   limit 1
   for update;

  if v_payment_id is null then return; end if;

  for v_item in select * from jsonb_array_elements(coalesce(v_allocations, '[]'::jsonb))
  loop
    v_bill_id := v_item ->> 'billId';
    v_payment := (v_item ->> 'payment')::numeric;

    update bills
       set balance = balance + v_payment
     where id = v_bill_id
       and (
         (p_household_id is not null and household_id = p_household_id) or
         (p_household_id is null and user_id = v_user_id)
       );

    select id into v_override_id
      from monthly_overrides
     where bill_id = v_bill_id
       and month = p_month
       and year = p_year
       and (
         (p_household_id is not null and household_id = p_household_id) or
         (p_household_id is null and user_id = v_user_id)
       )
     limit 1
     for update;

    if v_override_id is not null then
      update monthly_overrides
         set paid_amount = greatest(0, paid_amount - v_payment)
       where id = v_override_id
         and (
           (p_household_id is not null and household_id = p_household_id) or
           (p_household_id is null and user_id = v_user_id)
         );
    end if;
    v_override_id := null;
  end loop;

  delete from extra_payments
   where id = v_payment_id
     and (
       (p_household_id is not null and household_id = p_household_id) or
       (p_household_id is null and user_id = v_user_id)
     );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.replace_bucket_purchase(p_bank_id text, p_manual_id text, p_expected_manual_amount numeric, p_expected_bank_amount numeric, p_expected_bank_date date)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$ select private.replace_bucket_purchase(p_bank_id,p_manual_id,p_expected_manual_amount,p_expected_bank_amount,p_expected_bank_date) $function$
;

CREATE OR REPLACE FUNCTION public.undo_bucket_purchase(p_transaction_id text, p_bucket_id text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$ select private.undo_bucket_purchase(p_transaction_id,p_bucket_id) $function$
;

CREATE OR REPLACE FUNCTION public.update_bill_with_override_intents(p_bill_id text, p_expected jsonb, p_patch jsonb, p_overrides jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := auth.uid();
  v_bill public.bills%rowtype;
  v_was_debt boolean;
  v_key text;
  v_intent jsonb;
  v_override_patch jsonb;
  v_override_expected jsonb;
  v_override public.monthly_overrides%rowtype;
  v_saved_overrides jsonb := '[]'::jsonb;
  v_debt_minimums jsonb := '[]'::jsonb;
begin
  if v_actor is null then
    raise exception 'Authentication required';
  end if;
  if p_bill_id is null or p_bill_id = '' then
    raise exception 'Bill id is required';
  end if;
  if jsonb_typeof(coalesce(p_expected, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_patch, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_overrides, '[]'::jsonb)) <> 'array' then
    raise exception 'Invalid bill edit payload';
  end if;

  for v_key in select jsonb_object_keys(coalesce(p_patch, '{}'::jsonb)) loop
    if not (v_key = any (array[
      'name', 'amount', 'category', 'priority', 'is_debt', 'balance',
      'interest_rate', 'due_day', 'day_of_week', 'next_payment_date',
      'start_date', 'end_date', 'is_recurring', 'frequency',
      'smart_priority', 'include_in_snowball', 'debt_payment_pauses'
    ])) then
      raise exception 'Unsupported bill edit field: %', v_key;
    end if;
    if not coalesce(p_expected, '{}'::jsonb) ? v_key then
      raise exception 'Missing expected value for bill field: %', v_key;
    end if;
  end loop;

  select * into v_bill
  from public.bills
  where id = p_bill_id
  for update;
  if not found then
    raise exception 'Bill not found or edit access changed';
  end if;
  if v_bill.household_id is null
     or not public.is_household_editor(v_bill.household_id) then
    raise exception 'Household edit access required';
  end if;

  -- Permit the original expected value (first attempt) or the requested value
  -- (a retry after a committed response was lost). Anything else is a conflict.
  for v_key in select jsonb_object_keys(coalesce(p_patch, '{}'::jsonb)) loop
    if (to_jsonb(v_bill) -> v_key) is distinct from (p_expected -> v_key)
       and (to_jsonb(v_bill) -> v_key) is distinct from (p_patch -> v_key) then
      raise exception using
        errcode = '40001',
        message = format('Bill changed while editing field %s; refresh and try again', v_key);
    end if;
  end loop;

  v_was_debt := v_bill.is_debt;
  update public.bills set
    name = case when p_patch ? 'name' then p_patch ->> 'name' else name end,
    amount = case when p_patch ? 'amount' then (p_patch ->> 'amount')::numeric else amount end,
    category = case when p_patch ? 'category' then p_patch ->> 'category' else category end,
    priority = case when p_patch ? 'priority' then (p_patch ->> 'priority')::integer else priority end,
    is_debt = case when p_patch ? 'is_debt' then (p_patch ->> 'is_debt')::boolean else is_debt end,
    balance = case when p_patch ? 'balance' then (p_patch ->> 'balance')::numeric else balance end,
    interest_rate = case when p_patch ? 'interest_rate' then (p_patch ->> 'interest_rate')::numeric else interest_rate end,
    due_day = case when p_patch ? 'due_day' then (p_patch ->> 'due_day')::integer else due_day end,
    day_of_week = case when p_patch ? 'day_of_week' then (p_patch ->> 'day_of_week')::integer else day_of_week end,
    next_payment_date = case when p_patch ? 'next_payment_date' then p_patch ->> 'next_payment_date' else next_payment_date end,
    start_date = case when p_patch ? 'start_date' then p_patch ->> 'start_date' else start_date end,
    end_date = case when p_patch ? 'end_date' then p_patch ->> 'end_date' else end_date end,
    is_recurring = case when p_patch ? 'is_recurring' then (p_patch ->> 'is_recurring')::boolean else is_recurring end,
    frequency = case when p_patch ? 'frequency' then p_patch ->> 'frequency' else frequency end,
    smart_priority = case when p_patch ? 'smart_priority' then p_patch ->> 'smart_priority' else smart_priority end,
    include_in_snowball = case when p_patch ? 'include_in_snowball' then (p_patch ->> 'include_in_snowball')::boolean else include_in_snowball end,
    debt_payment_pauses = case when p_patch ? 'debt_payment_pauses' then p_patch -> 'debt_payment_pauses' else debt_payment_pauses end,
    last_reviewed_at = now()
  where id = p_bill_id
  returning * into v_bill;

  for v_intent in select value from jsonb_array_elements(coalesce(p_overrides, '[]'::jsonb)) loop
    if jsonb_typeof(v_intent) <> 'object'
       or jsonb_typeof(coalesce(v_intent -> 'patch', '{}'::jsonb)) <> 'object'
       or jsonb_typeof(coalesce(v_intent -> 'expected', '{}'::jsonb)) <> 'object' then
      raise exception 'Invalid monthly override intent';
    end if;
    v_override_patch := coalesce(v_intent -> 'patch', '{}'::jsonb);
    v_override_expected := coalesce(v_intent -> 'expected', '{}'::jsonb);
    for v_key in select jsonb_object_keys(v_override_patch) loop
      if not (v_key = any (array['custom_amount', 'custom_due_day'])) then
        raise exception 'Unsupported monthly override field: %', v_key;
      end if;
      if not v_override_expected ? v_key then
        raise exception 'Missing expected monthly override field: %', v_key;
      end if;
    end loop;
    if (v_intent ->> 'id') is null
       or (v_intent ->> 'month') is null
       or (v_intent ->> 'year') is null
       or (v_intent ->> 'month')::integer not between 0 and 11
       or (v_intent ->> 'year')::integer not between 2000 and 2200 then
      raise exception 'Invalid monthly override identity';
    end if;

    insert into public.monthly_overrides (
      id, user_id, household_id, budget_id, bill_id, month, year,
      custom_amount, custom_due_day
    ) values (
      v_intent ->> 'id', v_actor, v_bill.household_id, v_bill.budget_id,
      v_bill.id, (v_intent ->> 'month')::integer, (v_intent ->> 'year')::integer,
      case when v_override_patch ? 'custom_amount' then (v_override_patch ->> 'custom_amount')::numeric else null end,
      case when v_override_patch ? 'custom_due_day' then (v_override_patch ->> 'custom_due_day')::integer else null end
    )
    on conflict (household_id, bill_id, month, year) do nothing;

    select * into v_override
    from public.monthly_overrides
    where household_id = v_bill.household_id
      and bill_id = v_bill.id
      and month = (v_intent ->> 'month')::integer
      and year = (v_intent ->> 'year')::integer
    for update;
    if not found then
      raise exception 'Monthly override could not be saved';
    end if;
    for v_key in select jsonb_object_keys(v_override_patch) loop
      if (to_jsonb(v_override) -> v_key) is distinct from (v_override_expected -> v_key)
         and (to_jsonb(v_override) -> v_key) is distinct from (v_override_patch -> v_key) then
        raise exception using
          errcode = '40001',
          message = format('Monthly override changed while editing field %s; refresh and try again', v_key);
      end if;
    end loop;

    update public.monthly_overrides set
      custom_amount = case
        when v_override_patch ? 'custom_amount' then (v_override_patch ->> 'custom_amount')::numeric
        else custom_amount
      end,
      custom_due_day = case
        when v_override_patch ? 'custom_due_day' then (v_override_patch ->> 'custom_due_day')::integer
        else custom_due_day
      end
    where id = v_override.id
    returning * into v_override;
    v_saved_overrides := v_saved_overrides || jsonb_build_array(to_jsonb(v_override));
  end loop;

  if (v_was_debt or v_bill.is_debt)
     and p_patch ?| array['amount', 'balance', 'is_debt', 'include_in_snowball'] then
    perform public.recalculate_debt_minimum_boosts(v_bill.household_id);
    select * into v_bill from public.bills where id = p_bill_id;
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', debt.id,
      'snowball_minimum_boost', debt.snowball_minimum_boost
    )), '[]'::jsonb)
    into v_debt_minimums
    from public.bills debt
    where debt.household_id = v_bill.household_id and debt.is_debt;
  end if;

  return jsonb_build_object(
    'bill', to_jsonb(v_bill),
    'overrides', v_saved_overrides,
    'debt_minimums', v_debt_minimums
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.update_bucket_budget(p_bucket_id text, p_name text, p_target_amount numeric, p_target_date date, p_expected jsonb)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$ select private.update_bucket_budget(p_bucket_id,p_name,p_target_amount,p_target_date,p_expected) $function$
;

CREATE OR REPLACE FUNCTION public.update_bucket_purchase(p_transaction_id text, p_bucket_id text, p_expected_amount numeric, p_transaction jsonb)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$ select private.update_bucket_purchase(p_transaction_id,p_bucket_id,p_expected_amount,p_transaction) $function$
;

CREATE OR REPLACE FUNCTION public.update_manual_account_with_anchor(p_household_id uuid, p_budget_id uuid, p_expected_account jsonb, p_account jsonb, p_mutation_id text, p_balance_id text, p_record_balance boolean)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$
  select private.update_manual_account_with_anchor(
    p_household_id,
    p_budget_id,
    p_expected_account,
    p_account,
    p_mutation_id,
    p_balance_id,
    p_record_balance
  )
$function$
;

CREATE OR REPLACE FUNCTION public.normalize_reconciliation_restore_snapshot()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.restore_bill_custom_amount_after_review_undo()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_transaction_date date;
  v_month integer;
  v_year integer;
  v_remaining_total numeric := 0;
  v_has_remaining_lower_full boolean := false;
begin
  if old.resolution <> 'bill' or old.target_id is null then
    return old;
  end if;

  select transaction.date::date
  into v_transaction_date
  from public.transactions transaction
  where transaction.id = old.transaction_id;

  if v_transaction_date is null then
    return old;
  end if;
  v_month := extract(month from v_transaction_date)::integer - 1;
  v_year := extract(year from v_transaction_date)::integer;

  select
    coalesce(sum(match.matched_amount), 0),
    coalesce(bool_or(
      reconciliation.settlement = 'full'
      and reconciliation.planned_amount > match.matched_amount + 0.005
    ), false)
  into v_remaining_total, v_has_remaining_lower_full
  from public.bill_transaction_matches match
  left join public.transaction_reconciliations reconciliation
    on reconciliation.transaction_id = match.transaction_id
  where match.bill_id = old.target_id
    and match.match_month = v_month
    and match.match_year = v_year;

  update public.monthly_overrides override
  set custom_amount = case
    when v_has_remaining_lower_full then v_remaining_total
    else null
  end
  where override.bill_id = old.target_id
    and override.month = v_month
    and override.year = v_year;

  return old;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.restore_snowball_reconciliation_on_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  allocation jsonb;
  v_scheduled_plan_id text;
  v_debt_id text;
  v_old_amount numeric := 0;
  v_other_paid numeric := 0;
  v_plan_current_amount numeric;
  v_plan_original_amount numeric;
  v_plan_remaining numeric;
begin
  if old.resolution <> 'snowball' then return old; end if;

  for allocation in
    select value
    from jsonb_array_elements(coalesce(old.allocations, '[]'::jsonb))
    where value ->> 'type' = 'extra_principal'
      and nullif(value ->> 'targetId', '') is not null
      and coalesce((value ->> 'amount')::numeric, 0) > 0
  loop
    update public.bills
    set balance = round(balance + (allocation ->> 'amount')::numeric, 2)
    where id = allocation ->> 'targetId'
      and household_id = old.household_id
      and is_debt;
  end loop;

  v_scheduled_plan_id := nullif(old.restore_snapshot ->> 'scheduledPlanId', '');
  if v_scheduled_plan_id is null then return old; end if;

  select nullif(item ->> 'targetId', ''),
         coalesce((item ->> 'amount')::numeric, 0)
  into v_debt_id, v_old_amount
  from jsonb_array_elements(coalesce(old.allocations, '[]'::jsonb)) item
  where item ->> 'type' = 'extra_principal'
  limit 1;

  select abs(plan.amount)
  into v_plan_current_amount
  from public.transactions plan
  where plan.id = v_scheduled_plan_id
    and plan.household_id = old.household_id
    and plan.source = 'snowball_plan'
  for update;
  if not found then return old; end if;

  select coalesce(sum((item ->> 'amount')::numeric), 0)
  into v_other_paid
  from public.transaction_reconciliations reconciliation
  cross join lateral jsonb_array_elements(coalesce(reconciliation.allocations, '[]'::jsonb)) item
  where reconciliation.transaction_id <> old.transaction_id
    and reconciliation.resolution = 'snowball'
    and reconciliation.target_id = v_scheduled_plan_id
    and reconciliation.occurrence_date = old.occurrence_date
    and item ->> 'type' = 'extra_principal'
    and item ->> 'targetId' = v_debt_id;

  v_plan_original_amount := nullif(old.restore_snapshot ->> 'scheduledPlanOriginalAmount', '')::numeric;
  if v_plan_original_amount is null then
    v_plan_original_amount := greatest(v_plan_current_amount, v_other_paid + v_old_amount);
  end if;
  v_plan_remaining := greatest(0, v_plan_original_amount - v_other_paid);

  if v_plan_remaining > 0.005 then
    update public.transactions
    set amount = -round(v_plan_remaining, 2),
        removed_at = null
    where id = v_scheduled_plan_id
      and household_id = old.household_id
      and source = 'snowball_plan';
  else
    update public.transactions
    set removed_at = coalesce(removed_at, now())
    where id = v_scheduled_plan_id
      and household_id = old.household_id
      and source = 'snowball_plan';
  end if;

  return old;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.suppress_plaid_mirrors_after_review()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_winner public.transactions%rowtype;
  v_description_key text;
  v_mirror_ids jsonb;
begin
  select * into v_winner
  from public.transactions
  where id = new.transaction_id;

  if not found
    or v_winner.source <> 'plaid'
    or v_winner.pending is true
    or v_winner.removed_at is not null
    or v_winner.plaid_account_id is null then
    return new;
  end if;

  v_description_key := btrim(lower(regexp_replace(
    coalesce(nullif(v_winner.merchant_name, ''), nullif(v_winner.note, ''), v_winner.category, ''),
    '[^[:alnum:]]+', ' ', 'g'
  )));
  if v_description_key = '' then return new; end if;

  with suppressed as (
    update public.transactions d
    set removed_at = now(),
        review_status = 'legacy_reviewed',
        review_resolution = null,
        review_allocations = '[]'::jsonb,
        reviewed_at = null,
        reviewed_by = null
    where d.id <> v_winner.id
      and d.source = 'plaid'
      and d.pending is not true
      and d.removed_at is null
      and d.household_id is not distinct from v_winner.household_id
      and d.budget_id is not distinct from v_winner.budget_id
      and d.date = v_winner.date
      and d.amount = v_winner.amount
      and d.plaid_account_id is not null
      and d.plaid_account_id is distinct from v_winner.plaid_account_id
      and d.review_status in ('needs_review', 'legacy_reviewed')
      and d.reviewed_at is null
      and d.linked_bill_id is null
      and d.linked_income_id is null
      and d.linked_plan_id is null
      and not exists (
        select 1 from public.transaction_reconciliations existing
        where existing.transaction_id = d.id
      )
      and btrim(lower(regexp_replace(
        coalesce(nullif(d.merchant_name, ''), nullif(d.note, ''), d.category, ''),
        '[^[:alnum:]]+', ' ', 'g'
      ))) = v_description_key
    returning d.id
  )
  select coalesce(jsonb_agg(id order by id), '[]'::jsonb)
  into v_mirror_ids
  from suppressed;

  if jsonb_array_length(v_mirror_ids) > 0 then
    update public.transaction_reconciliations
    set restore_snapshot = jsonb_set(
      coalesce(restore_snapshot, '{}'::jsonb),
      '{suppressedMirrorIds}',
      coalesce(restore_snapshot->'suppressedMirrorIds', '[]'::jsonb) || v_mirror_ids,
      true
    )
    where transaction_id = new.transaction_id;
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_reconciliation_target_progress()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
#variable_conflict use_variable
declare r public.transaction_reconciliations%rowtype;
begin
  r := case when tg_op = 'DELETE' then old else new end;
  if r.resolution in ('goal','decision') and r.target_id is not null then
    perform private.recompute_planned_reconciliation_target(r.resolution,r.target_id);
  end if;
  return null;
end;
$function$
;

create trigger transactions_guard_allocated_transaction_edit before insert or update or delete on public.transactions for each row execute function private.guard_allocated_transaction_edit();create trigger transactions_guard_bucket_purchase_edit before update on public.transactions for each row execute function private.guard_bucket_purchase_edit();

CREATE TRIGGER normalize_reconciliation_restore_snapshot BEFORE INSERT OR UPDATE OF resolution, target_id, restore_snapshot ON public.transaction_reconciliations FOR EACH ROW EXECUTE FUNCTION normalize_reconciliation_restore_snapshot();

CREATE TRIGGER restore_snowball_reconciliation_on_delete AFTER DELETE ON public.transaction_reconciliations FOR EACH ROW EXECUTE FUNCTION restore_snowball_reconciliation_on_delete();

CREATE TRIGGER suppress_plaid_mirrors_after_review AFTER INSERT ON public.transaction_reconciliations FOR EACH ROW EXECUTE FUNCTION suppress_plaid_mirrors_after_review();

CREATE TRIGGER sync_planned_reconciliation_progress AFTER INSERT OR DELETE OR UPDATE ON public.transaction_reconciliations FOR EACH ROW EXECUTE FUNCTION private.sync_planned_reconciliation_progress();

CREATE TRIGGER sync_reconciliation_target_progress AFTER INSERT OR DELETE OR UPDATE OF resolution, target_id, allocations, restore_snapshot ON public.transaction_reconciliations FOR EACH ROW EXECUTE FUNCTION sync_reconciliation_target_progress();

CREATE TRIGGER transaction_reconciliations_restore_bill_custom_amount AFTER DELETE ON public.transaction_reconciliations FOR EACH ROW EXECUTE FUNCTION restore_bill_custom_amount_after_review_undo();

create trigger pending_identity before update on public.pending_plan_matches for each row execute function public.protect_pending_plan_match_identity();

alter table public."accounts" enable row level security;

create policy "accounts: authenticated delete" on public."accounts" for DELETE to authenticated using ((((household_id IS NULL) AND (user_id = ( SELECT auth.uid() AS uid))) OR ((household_id IS NOT NULL) AND ( SELECT private.is_household_editor(accounts.household_id) AS is_household_editor))));

create policy "accounts: authenticated insert" on public."accounts" for INSERT to authenticated with check ((((household_id IS NULL) AND (user_id = ( SELECT auth.uid() AS uid))) OR ((household_id IS NOT NULL) AND ( SELECT private.is_household_editor(accounts.household_id) AS is_household_editor))));

create policy "accounts: authenticated read" on public."accounts" for SELECT to authenticated using ((((household_id IS NULL) AND (user_id = ( SELECT auth.uid() AS uid))) OR ((household_id IS NOT NULL) AND ( SELECT private.is_household_member(accounts.household_id) AS is_household_member))));

create policy "accounts: authenticated update" on public."accounts" for UPDATE to authenticated using ((((household_id IS NULL) AND (user_id = ( SELECT auth.uid() AS uid))) OR ((household_id IS NOT NULL) AND ( SELECT private.is_household_editor(accounts.household_id) AS is_household_editor)))) with check ((((household_id IS NULL) AND (user_id = ( SELECT auth.uid() AS uid))) OR ((household_id IS NOT NULL) AND ( SELECT private.is_household_editor(accounts.household_id) AS is_household_editor))));

alter table public."bills" enable row level security;

create policy "bills: authenticated delete" on public."bills" for DELETE to authenticated using ((((household_id IS NULL) AND (user_id = ( SELECT auth.uid() AS uid))) OR ((household_id IS NOT NULL) AND ( SELECT private.is_household_editor(bills.household_id) AS is_household_editor))));

create policy "bills: authenticated insert" on public."bills" for INSERT to authenticated with check ((((household_id IS NULL) AND (user_id = ( SELECT auth.uid() AS uid))) OR ((household_id IS NOT NULL) AND ( SELECT private.is_household_editor(bills.household_id) AS is_household_editor))));

create policy "bills: authenticated read" on public."bills" for SELECT to authenticated using ((((household_id IS NULL) AND (user_id = ( SELECT auth.uid() AS uid))) OR ((household_id IS NOT NULL) AND ( SELECT private.is_household_member(bills.household_id) AS is_household_member))));

create policy "bills: authenticated update" on public."bills" for UPDATE to authenticated using ((((household_id IS NULL) AND (user_id = ( SELECT auth.uid() AS uid))) OR ((household_id IS NOT NULL) AND ( SELECT private.is_household_editor(bills.household_id) AS is_household_editor)))) with check ((((household_id IS NULL) AND (user_id = ( SELECT auth.uid() AS uid))) OR ((household_id IS NOT NULL) AND ( SELECT private.is_household_editor(bills.household_id) AS is_household_editor))));

alter table public."household_settings" enable row level security;

create policy "household settings: authenticated read" on public."household_settings" for SELECT to authenticated using (( SELECT private.is_household_member(household_settings.household_id) AS is_household_member));

create policy "household settings: editors delete" on public."household_settings" for DELETE to authenticated using (( SELECT private.is_household_editor(household_settings.household_id) AS is_household_editor));

create policy "household settings: editors insert" on public."household_settings" for INSERT to authenticated with check (( SELECT private.is_household_editor(household_settings.household_id) AS is_household_editor));

create policy "household settings: editors update" on public."household_settings" for UPDATE to authenticated using (( SELECT private.is_household_editor(household_settings.household_id) AS is_household_editor)) with check (( SELECT private.is_household_editor(household_settings.household_id) AS is_household_editor));

alter table public."incomes" enable row level security;

create policy "incomes: authenticated delete" on public."incomes" for DELETE to authenticated using ((((household_id IS NULL) AND (user_id = ( SELECT auth.uid() AS uid))) OR ((household_id IS NOT NULL) AND ( SELECT private.is_household_editor(incomes.household_id) AS is_household_editor))));

create policy "incomes: authenticated insert" on public."incomes" for INSERT to authenticated with check ((((household_id IS NULL) AND (user_id = ( SELECT auth.uid() AS uid))) OR ((household_id IS NOT NULL) AND ( SELECT private.is_household_editor(incomes.household_id) AS is_household_editor))));

create policy "incomes: authenticated read" on public."incomes" for SELECT to authenticated using ((((household_id IS NULL) AND (user_id = ( SELECT auth.uid() AS uid))) OR ((household_id IS NOT NULL) AND ( SELECT private.is_household_member(incomes.household_id) AS is_household_member))));

create policy "incomes: authenticated update" on public."incomes" for UPDATE to authenticated using ((((household_id IS NULL) AND (user_id = ( SELECT auth.uid() AS uid))) OR ((household_id IS NOT NULL) AND ( SELECT private.is_household_editor(incomes.household_id) AS is_household_editor)))) with check ((((household_id IS NULL) AND (user_id = ( SELECT auth.uid() AS uid))) OR ((household_id IS NOT NULL) AND ( SELECT private.is_household_editor(incomes.household_id) AS is_household_editor))));

alter table public."pending_plan_matches" enable row level security;

create policy "pending plan matches: members read" on public."pending_plan_matches" for SELECT to authenticated using (is_household_member(household_id));

create policy "pending plan matches: pro editors delete" on public."pending_plan_matches" for DELETE to authenticated using ((is_household_editor(household_id) AND (EXISTS ( SELECT 1
   FROM household_plans plan
  WHERE ((plan.household_id = pending_plan_matches.household_id) AND (plan.tier = 'pro'::text))))));

create policy "pending plan matches: pro editors insert" on public."pending_plan_matches" for INSERT to authenticated with check (((user_id = ( SELECT auth.uid() AS uid)) AND (created_by = ( SELECT auth.uid() AS uid)) AND is_household_editor(household_id) AND (((target_type = 'bill'::text) AND (EXISTS ( SELECT 1
   FROM bills bill
  WHERE ((bill.id = pending_plan_matches.target_id) AND (bill.household_id = pending_plan_matches.household_id))))) OR ((target_type = 'manual'::text) AND (EXISTS ( SELECT 1
   FROM transactions manual
  WHERE ((manual.id = pending_plan_matches.target_id) AND (manual.household_id = pending_plan_matches.household_id) AND (NOT (manual.budget_id IS DISTINCT FROM pending_plan_matches.budget_id)) AND (manual.source IS DISTINCT FROM 'plaid'::text) AND (manual.amount < (0)::numeric) AND (manual.pending IS NOT TRUE) AND (manual.removed_at IS NULL) AND (manual.deleted_at IS NULL) AND (manual.import_hash IS NULL) AND (manual.transfer_group_id IS NULL) AND ((manual.linked_bill_id IS NULL) OR (((manual.source IS NULL) OR (manual.source = 'manual'::text)) AND (EXISTS ( SELECT 1
           FROM bills linked_debt
          WHERE ((linked_debt.id = manual.linked_bill_id) AND (linked_debt.household_id = manual.household_id) AND (NOT (linked_debt.budget_id IS DISTINCT FROM manual.budget_id)) AND (linked_debt.is_debt = true)))))) AND (manual.linked_plan_id IS NULL) AND (manual.review_status IS DISTINCT FROM 'matched'::text) AND (manual.category IS DISTINCT FROM 'Transfer'::text) AND (date_trunc('month'::text, ((manual.date)::date)::timestamp with time zone) = date_trunc('month'::text, (pending_plan_matches.pending_transaction_date)::timestamp with time zone))))))) AND (EXISTS ( SELECT 1
   FROM plaid_transactions pt
  WHERE ((pt.household_id = pending_plan_matches.household_id) AND (pt.plaid_transaction_id = pending_plan_matches.pending_plaid_transaction_id) AND (pt.pending = true) AND (pt.removed_at IS NULL)))) AND (EXISTS ( SELECT 1
   FROM household_plans plan
  WHERE ((plan.household_id = pending_plan_matches.household_id) AND (plan.tier = 'pro'::text))))));

create policy "pending plan matches: pro editors update" on public."pending_plan_matches" for UPDATE to authenticated using ((is_household_editor(household_id) AND (EXISTS ( SELECT 1
   FROM household_plans plan
  WHERE ((plan.household_id = pending_plan_matches.household_id) AND (plan.tier = 'pro'::text)))))) with check ((is_household_editor(household_id) AND (status = ANY (ARRAY['active'::text, 'cancelled'::text])) AND ((status = 'cancelled'::text) OR (((target_type = 'bill'::text) AND (EXISTS ( SELECT 1
   FROM bills bill
  WHERE ((bill.id = pending_plan_matches.target_id) AND (bill.household_id = pending_plan_matches.household_id))))) OR ((target_type = 'manual'::text) AND (EXISTS ( SELECT 1
   FROM transactions manual
  WHERE ((manual.id = pending_plan_matches.target_id) AND (manual.household_id = pending_plan_matches.household_id) AND (NOT (manual.budget_id IS DISTINCT FROM pending_plan_matches.budget_id)) AND (manual.source IS DISTINCT FROM 'plaid'::text) AND (manual.amount < (0)::numeric) AND (manual.pending IS NOT TRUE) AND (manual.removed_at IS NULL) AND (manual.deleted_at IS NULL) AND (manual.import_hash IS NULL) AND (manual.transfer_group_id IS NULL) AND ((manual.linked_bill_id IS NULL) OR (((manual.source IS NULL) OR (manual.source = 'manual'::text)) AND (EXISTS ( SELECT 1
           FROM bills linked_debt
          WHERE ((linked_debt.id = manual.linked_bill_id) AND (linked_debt.household_id = manual.household_id) AND (NOT (linked_debt.budget_id IS DISTINCT FROM manual.budget_id)) AND (linked_debt.is_debt = true)))))) AND (manual.linked_plan_id IS NULL) AND (manual.review_status IS DISTINCT FROM 'matched'::text) AND (manual.category IS DISTINCT FROM 'Transfer'::text) AND (date_trunc('month'::text, ((manual.date)::date)::timestamp with time zone) = date_trunc('month'::text, (pending_plan_matches.pending_transaction_date)::timestamp with time zone)))))))) AND (EXISTS ( SELECT 1
   FROM household_plans plan
  WHERE ((plan.household_id = pending_plan_matches.household_id) AND (plan.tier = 'pro'::text)))) AND ((status = 'cancelled'::text) OR (EXISTS ( SELECT 1
   FROM plaid_transactions pt
  WHERE ((pt.household_id = pending_plan_matches.household_id) AND (pt.plaid_transaction_id = pending_plan_matches.pending_plaid_transaction_id) AND (pt.pending = true) AND (pt.removed_at IS NULL)))))));

alter table public."plaid_accounts" enable row level security;

create policy "plaid accounts: members read" on public."plaid_accounts" for SELECT to authenticated using (( SELECT private.is_household_member(plaid_accounts.household_id) AS is_household_member));

alter table public."transactions" enable row level security;

create policy "transactions: authenticated delete" on public."transactions" for DELETE to authenticated using ((((household_id IS NULL) AND (user_id = ( SELECT auth.uid() AS uid))) OR ((household_id IS NOT NULL) AND ( SELECT private.is_household_editor(transactions.household_id) AS is_household_editor))));

create policy "transactions: authenticated insert" on public."transactions" for INSERT to authenticated with check ((((household_id IS NULL) AND (user_id = ( SELECT auth.uid() AS uid))) OR ((household_id IS NOT NULL) AND ( SELECT private.is_household_editor(transactions.household_id) AS is_household_editor))));

create policy "transactions: authenticated read" on public."transactions" for SELECT to authenticated using ((((household_id IS NULL) AND (user_id = ( SELECT auth.uid() AS uid))) OR ((household_id IS NOT NULL) AND ( SELECT private.is_household_member(transactions.household_id) AS is_household_member))));

create policy "transactions: authenticated update" on public."transactions" for UPDATE to authenticated using ((((household_id IS NULL) AND (user_id = ( SELECT auth.uid() AS uid))) OR ((household_id IS NOT NULL) AND ( SELECT private.is_household_editor(transactions.household_id) AS is_household_editor)))) with check ((((household_id IS NULL) AND (user_id = ( SELECT auth.uid() AS uid))) OR ((household_id IS NOT NULL) AND ( SELECT private.is_household_editor(transactions.household_id) AS is_household_editor))));

alter table public.goals enable row level security;

create policy fixture_member_read on public.goals for select to authenticated using (private.is_household_member(household_id));

create policy fixture_editor_update on public.goals for update to authenticated using (private.is_household_editor(household_id)) with check (private.is_household_editor(household_id));

create policy fixture_editor_insert on public.goals for insert to authenticated with check (private.is_household_editor(household_id));

alter table public.decisions enable row level security;

create policy fixture_member_read on public.decisions for select to authenticated using (private.is_household_member(household_id));

create policy fixture_editor_update on public.decisions for update to authenticated using (private.is_household_editor(household_id)) with check (private.is_household_editor(household_id));

create policy fixture_editor_insert on public.decisions for insert to authenticated with check (private.is_household_editor(household_id));

alter table public.extra_payments enable row level security;

create policy fixture_member_read on public.extra_payments for select to authenticated using (private.is_household_member(household_id));

create policy fixture_editor_update on public.extra_payments for update to authenticated using (private.is_household_editor(household_id)) with check (private.is_household_editor(household_id));

create policy fixture_editor_insert on public.extra_payments for insert to authenticated with check (private.is_household_editor(household_id));

alter table public.budgets enable row level security;

create policy fixture_member_read on public.budgets for select to authenticated using (private.is_household_member(household_id));

create policy fixture_editor_update on public.budgets for update to authenticated using (private.is_household_editor(household_id)) with check (private.is_household_editor(household_id));

create policy fixture_editor_insert on public.budgets for insert to authenticated with check (private.is_household_editor(household_id));

alter table public.household_members enable row level security;

create policy fixture_member_read on public.household_members for select to authenticated using (private.is_household_member(household_id));

alter table public.household_plans enable row level security;

create policy fixture_member_read on public.household_plans for select to authenticated using (private.is_household_member(household_id));

alter table public.transaction_reconciliations enable row level security;

create policy fixture_member_read on public.transaction_reconciliations for select to authenticated using (private.is_household_member(household_id));

alter table public.plaid_items enable row level security;

create policy owner_private on public.plaid_items for select to authenticated using (user_id=auth.uid());

alter table public.plaid_transactions enable row level security;

create policy fixture_member_read on public.plaid_transactions for select to authenticated using (private.is_household_member(household_id));

grant select,insert,update,delete on all tables in schema public to authenticated;revoke insert,update,delete on public.plaid_accounts,public.plaid_items,public.plaid_transactions from authenticated;grant execute on all functions in schema public,private to authenticated;

revoke all on function private.add_bucket_purchase(text,text,numeric,date,jsonb) from public,anon;

revoke all on function private.complete_decision(text,numeric,date,text,jsonb) from public,anon;

revoke all on function private.create_bill_and_reconcile_transaction(text,jsonb) from public,anon;

revoke all on function private.create_pending_activity_transaction(text,text,uuid,uuid,numeric,date,text,text,text) from public,anon;

revoke all on function private.create_spending_bucket_for_transaction(text,text,text,numeric,date) from public,anon;

revoke all on function private.delete_bucket_purchase(text,text) from public,anon;

revoke all on function private.fund_goal(text,text,numeric,date,numeric,text) from public,anon;

revoke all on function private.is_household_editor(uuid) from public,anon;

revoke all on function private.is_household_member(uuid) from public,anon;

revoke all on function private.mutate_transfer(uuid,uuid,text,text,text,jsonb,jsonb,text) from public,anon;

revoke all on function private.reconcile_manual_transaction(text,text,date,numeric,text) from public,anon;

revoke all on function private.reconcile_snowball_transaction(text,text,date,numeric,text,text) from public,anon;

revoke all on function private.reconcile_transaction(text,text,text,date,numeric,text,text) from public,anon;

revoke all on function private.reconcile_transaction_unlocked_v1(text,text,text,date,numeric,text,text) from public,anon;

revoke all on function private.replace_bucket_purchase(text,text,numeric,numeric,date) from public,anon;

revoke all on function private.transfer_manual_activity_metadata() from public,anon;

revoke all on function private.undo_bucket_purchase(text,text) from public,anon;

revoke all on function private.update_bucket_budget(text,text,numeric,date,jsonb) from public,anon;

revoke all on function private.update_bucket_purchase(text,text,numeric,jsonb) from public,anon;

revoke all on function private.update_manual_account_with_anchor(uuid,uuid,jsonb,jsonb,text,text,boolean) from public,anon;

revoke all on function public.add_bucket_purchase(text,text,numeric,date,jsonb) from public,anon;

revoke all on function public.add_manual_account_with_anchor(uuid,uuid,jsonb,text) from public,anon;

revoke all on function public.apply_debt_snowball_payment(text,integer,integer,numeric,date,jsonb,jsonb,uuid,boolean) from public,anon;

revoke all on function public.complete_decision(text,numeric,date,text,jsonb) from public,anon;

revoke all on function public.create_bill_and_reconcile_transaction(text,jsonb) from public,anon;

revoke all on function public.create_pending_activity_transaction(text,text,uuid,uuid,numeric,date,text,text,text) from public,anon;

revoke all on function public.create_spending_bucket_for_transaction(text,text,text,numeric,date) from public,anon;

revoke all on function public.delete_bucket_purchase(text,text) from public,anon;

revoke all on function public.fund_goal(text,text,numeric,date,numeric,text) from public,anon;

revoke all on function public.is_household_editor(uuid) from public,anon;

revoke all on function public.is_household_member(uuid) from public,anon;

revoke all on function public.mutate_transfer(uuid,uuid,text,text,text,jsonb,jsonb,text) from public,anon;

revoke all on function public.protect_pending_plan_match_identity() from public,anon;

revoke all on function public.reconcile_manual_transaction(text,text,date,numeric,text) from public,anon;

revoke all on function public.reconcile_snowball_transaction(text,text,date,numeric,text,text) from public,anon;

revoke all on function public.reconcile_transaction(text,text,text,date,numeric,text,text) from public,anon;

revoke all on function public.remove_debt_snowball_payment(integer,integer,uuid) from public,anon;

revoke all on function public.replace_bucket_purchase(text,text,numeric,numeric,date) from public,anon;

revoke all on function public.undo_bucket_purchase(text,text) from public,anon;

revoke all on function public.update_bill_with_override_intents(text,jsonb,jsonb,jsonb) from public,anon;

revoke all on function public.update_bucket_budget(text,text,numeric,date,jsonb) from public,anon;

revoke all on function public.update_bucket_purchase(text,text,numeric,jsonb) from public,anon;

revoke all on function public.update_manual_account_with_anchor(uuid,uuid,jsonb,jsonb,text,text,boolean) from public,anon;

revoke all on function private.guard_allocated_transaction_edit() from public,anon;

revoke all on function private.guard_bucket_purchase_edit() from public,anon;

revoke all on function private.recompute_planned_reconciliation_target(text,text) from public,anon;

revoke all on function private.sync_planned_reconciliation_progress() from public,anon;

revoke all on function public.normalize_reconciliation_restore_snapshot() from public,anon;

revoke all on function public.restore_bill_custom_amount_after_review_undo() from public,anon;

revoke all on function public.restore_snowball_reconciliation_on_delete() from public,anon;

revoke all on function public.suppress_plaid_mirrors_after_review() from public,anon;

revoke all on function public.sync_reconciliation_target_progress() from public,anon;

insert into auth.users values ('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222'),('33333333-3333-4333-8333-333333333333'),('44444444-4444-4444-8444-444444444444'),('55555555-5555-4555-8555-555555555555');

insert into public.households(id,name,created_by) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','FAKE Wells household','11111111-1111-4111-8111-111111111111');

insert into public.households(id,name,created_by) values('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','FAKE other household','44444444-4444-4444-8444-444444444444');

insert into public.household_members(household_id,user_id,role) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','owner');

insert into public.household_members(household_id,user_id,role) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','22222222-2222-4222-8222-222222222222','editor');

insert into public.household_members(household_id,user_id,role) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','33333333-3333-4333-8333-333333333333','viewer');

insert into public.household_members(household_id,user_id,role) values('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','44444444-4444-4444-8444-444444444444','owner');

insert into public.budgets(id,household_id,name) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','FAKE budget');

insert into public.budgets(id,household_id,name) values('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','FAKE other budget');

insert into public.household_plans(household_id,tier) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','pro');

insert into public.household_plans(household_id,tier) values('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','pro');

insert into public.accounts(id,user_id,household_id,budget_id,name,account_type,current_balance) values('manual-checking','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','FAKE manual-checking','checking',1000);

insert into public.accounts(id,user_id,household_id,budget_id,name,account_type,current_balance) values('manual-savings','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','FAKE manual-savings','savings',2000);

insert into public.accounts(id,user_id,household_id,budget_id,name,account_type,current_balance) values('manual-cash','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','FAKE manual-cash','cash',75);

insert into public.accounts(id,user_id,household_id,budget_id,name,account_type,current_balance) values('manual-card','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','FAKE manual-card','credit_card',200);

insert into public.accounts(id,user_id,household_id,budget_id,name,account_type,current_balance) values('foreign-manual','44444444-4444-4444-8444-444444444444','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','FAKE foreign','checking',900);

insert into public.plaid_items values('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','FAKE_SECRET_NEVER_EXPOSE');

insert into public.plaid_accounts(id,user_id,household_id,plaid_item_record_id,plaid_account_id,name,type,subtype,account_type,account_subtype,current_balance,available_balance,is_active,currency_code) values('00000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','fake-provider-1','FAKE Checking','depository','checking','depository','checking',1000,1000,true,'USD');

insert into public.plaid_accounts(id,user_id,household_id,plaid_item_record_id,plaid_account_id,name,type,subtype,account_type,account_subtype,current_balance,available_balance,is_active,currency_code) values('00000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','fake-provider-2','FAKE Bills','depository','checking','depository','checking',500,500,true,'USD');

insert into public.plaid_accounts(id,user_id,household_id,plaid_item_record_id,plaid_account_id,name,type,subtype,account_type,account_subtype,current_balance,available_balance,is_active,currency_code) values('00000000-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','fake-provider-3','FAKE Savings','depository','savings','depository','savings',2000,2000,true,'USD');

insert into public.plaid_accounts(id,user_id,household_id,plaid_item_record_id,plaid_account_id,name,type,subtype,account_type,account_subtype,current_balance,available_balance,is_active,currency_code) values('00000000-0000-4000-8000-000000000004','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','fake-provider-4','FAKE Credit','credit','credit card','credit','credit card',250,250,true,'USD');

insert into public.plaid_accounts(id,user_id,household_id,plaid_item_record_id,plaid_account_id,name,type,subtype,account_type,account_subtype,current_balance,available_balance,is_active,currency_code) values('00000000-0000-4000-8000-000000000005','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','fake-provider-5','FAKE Inactive','depository','checking','depository','checking',40,40,false,'USD');

insert into public.plaid_accounts(id,user_id,household_id,plaid_item_record_id,plaid_account_id,name,type,subtype,account_type,account_subtype,current_balance,available_balance,is_active,currency_code) values('00000000-0000-4000-8000-000000000006','44444444-4444-4444-8444-444444444444','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','fake-provider-6','FAKE Foreign','depository','checking','depository','checking',900,900,true,'USD');

insert into public.plaid_accounts(id,user_id,household_id,plaid_item_record_id,plaid_account_id,name,type,subtype,account_type,account_subtype,current_balance,available_balance,is_active,currency_code) values('00000000-0000-4000-8000-000000000007','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','fake-provider-7','FAKE Euro Savings','depository','savings','depository','savings',400,400,true,'EUR');

insert into public.bills(id,user_id,household_id,budget_id,name,amount,category,due_day,created_at) values('bill-1','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','FAKE utilities',100,'Utilities',15,'fixture');

insert into public.incomes(id,user_id,household_id,budget_id,name,amount,frequency,start_date) values('income-1','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','FAKE paycheck',500,'monthly','2026-11-01');

insert into public.goals(id,user_id,household_id,budget_id,name,target_amount,target_date,current_amount,goal_type,created_at) values('bucket-1','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','FAKE gas',200,'2026-12-01',0,'planned_expense','fixture');

insert into public.goals(id,user_id,household_id,budget_id,name,target_amount,target_date,current_amount,goal_type,created_at) values('savings-goal','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','FAKE goal',1000,'2027-12-01',0,'savings','fixture');

insert into public.transactions(id,user_id,household_id,budget_id,date,amount,category,note,account_id) values('manual-1','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','2026-11-11',-30,'Other','FAKE manual','manual-checking');

insert into public.transactions(id,user_id,household_id,budget_id,date,amount,category,note,source,plaid_account_id,pending,review_status) values('bank-savings-1','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','2026-11-11',-20,'Other','FAKE bank','plaid','fake-provider-3',false,'needs_review');

insert into public.plaid_transactions(id,user_id,household_id,plaid_account_id,plaid_transaction_id,transaction_date,name,amount,pending,raw,created_at,updated_at) values('cccccccc-cccc-4ccc-8ccc-cccccccccccc','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','00000000-0000-4000-8000-000000000002','fake-pending-1','2026-11-11','FAKE pending',-25,true,'{}','2026-11-11T12:00:00Z','2026-11-11T12:00:00Z');

create table test.before_rows(table_name text primary key,rows jsonb);

insert into test.before_rows select 'accounts',coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.accounts t;

insert into test.before_rows select 'plaid_accounts',coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.plaid_accounts t;

insert into test.before_rows select 'bills',coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.bills t;

insert into test.before_rows select 'incomes',coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.incomes t;

insert into test.before_rows select 'goals',coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.goals t;

insert into test.before_rows select 'decisions',coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.decisions t;

insert into test.before_rows select 'extra_payments',coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.extra_payments t;

insert into test.before_rows select 'transactions',coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.transactions t;

insert into test.before_rows select 'pending_plan_matches',coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.pending_plan_matches t;

insert into test.before_rows select 'account_balances',coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.account_balances t;

create function test.assert(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'ASSERTION FAILED: %',label;end if;raise notice 'PASS: %',label;end$$;

create function test.must_fail(statement text,label text,expected text default null) returns void language plpgsql security invoker as $$declare caught text;begin begin execute statement;exception when others then caught:=sqlerrm;end;if caught is null then raise exception 'ASSERTION FAILED expected rejection: %',label;end if;if expected is not null and position(expected in caught)=0 then raise exception 'ASSERTION FAILED unexpected rejection for %: %',label,caught;end if;raise notice 'PASS rejected: % [%]',label,caught;end$$;

grant select on test.before_rows to authenticated;grant execute on all functions in schema test to anon,authenticated;


-- Additional actual bill-settlement schema/functions for review creation tests.

create table public.bill_transaction_matches("transaction_id" text not null,"bill_id" text not null,"override_id" text not null,"user_id" uuid not null,"household_id" uuid,"budget_id" uuid,"match_month" integer not null,"match_year" integer not null,"transaction_date" date not null,"matched_amount" numeric not null,"baseline_paid_amount" numeric not null default 0,"baseline_actual_amount" numeric,"baseline_paid_date" date,"previous_category" text not null default 'Other'::text,"previous_linked_bill_id" text,"previous_match_confidence" numeric,"previous_match_reason" text,"created_at" timestamp with time zone not null default now(),"occurrence_date" date,"planned_amount" numeric,"settlement" text);

alter table public.bill_transaction_matches add constraint "bill_transaction_matches_bill_id_fkey" FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE CASCADE;

alter table public.bill_transaction_matches add constraint "bill_transaction_matches_budget_id_fkey" FOREIGN KEY (budget_id) REFERENCES budgets(id) ON DELETE SET NULL;

alter table public.bill_transaction_matches add constraint "bill_transaction_matches_household_id_fkey" FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE;

alter table public.bill_transaction_matches add constraint "bill_transaction_matches_household_member_owner_fkey" FOREIGN KEY (household_id, user_id) REFERENCES household_members(household_id, user_id) DEFERRABLE INITIALLY DEFERRED;

alter table public.bill_transaction_matches add constraint "bill_transaction_matches_match_month_check" CHECK (((match_month >= 0) AND (match_month <= 11)));

alter table public.bill_transaction_matches add constraint "bill_transaction_matches_matched_amount_check" CHECK ((matched_amount > (0)::numeric));

alter table public.bill_transaction_matches add constraint "bill_transaction_matches_override_id_fkey" FOREIGN KEY (override_id) REFERENCES monthly_overrides(id) ON DELETE CASCADE;

alter table public.bill_transaction_matches add constraint "bill_transaction_matches_pkey" PRIMARY KEY (transaction_id);

alter table public.bill_transaction_matches add constraint "bill_transaction_matches_settlement_check" CHECK (((settlement IS NULL) OR (settlement = ANY (ARRAY['exact'::text, 'full'::text, 'partial'::text, 'split'::text, 'extra_principal'::text]))));

alter table public.bill_transaction_matches add constraint "bill_transaction_matches_transaction_id_fkey" FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE;

alter table public.bill_transaction_matches add constraint "bill_transaction_matches_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table public.bill_transaction_matches enable row level security;

grant select on public.bill_transaction_matches to authenticated;

create policy "bill matches: members read" on public.bill_transaction_matches as PERMISSIVE for SELECT to authenticated using ((((household_id IS NULL) AND (( SELECT auth.uid() AS uid) = user_id)) OR ((household_id IS NOT NULL) AND private.is_household_member(household_id))));

CREATE OR REPLACE FUNCTION private.reconcile_transaction_unlocked_v1(p_transaction_id text, p_resolution text, p_target_id text DEFAULT NULL::text, p_occurrence_date date DEFAULT NULL::date, p_planned_amount numeric DEFAULT NULL::numeric, p_settlement text DEFAULT NULL::text, p_extra_category text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_tx public.transactions%rowtype;
  v_bill public.bills%rowtype;
  v_income public.incomes%rowtype;
  v_goal public.goals%rowtype;
  v_decision public.decisions%rowtype;
  v_match public.bill_transaction_matches%rowtype;
  v_existing public.transaction_reconciliations%rowtype;
  v_actual numeric;
  v_primary numeric;
  v_extra numeric;
  v_allocations jsonb;
  v_snapshot jsonb;
  v_now timestamptz := now();
begin
  if (select auth.uid()) is null then raise exception 'Sign in to review transactions'; end if;
  select * into v_tx from public.transactions where id = p_transaction_id and removed_at is null and pending is not true;
  if not found then raise exception 'Posted transaction was not found'; end if;
  if v_tx.household_id is null or not public.is_household_editor(v_tx.household_id) then
    raise exception 'You need household edit access to review transactions';
  end if;
  if not exists (select 1 from public.household_plans hp where hp.household_id = v_tx.household_id and private.has_review_center_entitlement(v_tx.household_id)) then
    raise exception 'Review Center requires the Pro plan';
  end if;
  if p_resolution not in ('bill', 'income', 'goal', 'decision', 'category', 'transfer') then
    raise exception 'Unsupported review resolution';
  end if;

  select * into v_existing from public.transaction_reconciliations where transaction_id = p_transaction_id;
  v_snapshot := case when found then v_existing.restore_snapshot else jsonb_build_object(
    'category', v_tx.category,
    'linkedBillId', v_tx.linked_bill_id,
    'linkedIncomeId', v_tx.linked_income_id,
    'linkedPlanId', v_tx.linked_plan_id,
    'linkedPlanType', v_tx.linked_plan_type,
    'matchConfidence', v_tx.match_confidence,
    'matchReason', v_tx.match_reason
  ) end;
  v_actual := abs(v_tx.amount);

  if p_resolution = 'category' then
    if nullif(btrim(coalesce(p_target_id, '')), '') is null then raise exception 'Choose a category'; end if;
    v_allocations := jsonb_build_array(jsonb_build_object('type', 'category', 'category', p_target_id, 'amount', v_actual));
    update public.transactions set category = p_target_id, review_status = 'categorized', review_resolution = 'category',
      review_allocations = v_allocations, reviewed_at = v_now, reviewed_by = (select auth.uid()),
      linked_income_id = null, linked_plan_id = null, linked_plan_type = null, matched_occurrence_date = null
    where id = p_transaction_id;
  elsif p_resolution = 'transfer' then
    v_allocations := jsonb_build_array(jsonb_build_object('type', 'transfer', 'amount', v_actual));
    update public.transactions set category = 'Transfer', review_status = 'transfer', review_resolution = 'transfer',
      review_allocations = v_allocations, reviewed_at = v_now, reviewed_by = (select auth.uid()),
      linked_income_id = null, linked_plan_id = null, linked_plan_type = null, matched_occurrence_date = null
    where id = p_transaction_id;
  elsif p_resolution = 'bill' then
    if v_tx.amount >= 0 then raise exception 'Only money-out transactions can match bills'; end if;
    select * into v_bill from public.bills where id = p_target_id;
    if not found or v_bill.household_id is distinct from v_tx.household_id or v_bill.budget_id is distinct from v_tx.budget_id then
      raise exception 'Bill does not belong to this household plan';
    end if;
    if p_occurrence_date is null or p_planned_amount is null or p_planned_amount <= 0 then raise exception 'Bill occurrence details are required'; end if;
    if coalesce(p_settlement, '') not in ('exact', 'full', 'partial', 'split', 'extra_principal') then raise exception 'Choose how this bill was paid'; end if;
    v_primary := case when p_settlement in ('split', 'extra_principal') then least(v_actual, p_planned_amount) else v_actual end;
    v_extra := greatest(0, v_actual - v_primary);
    if p_settlement = 'split' and (v_extra <= 0 or nullif(btrim(coalesce(p_extra_category, '')), '') is null) then
      raise exception 'Choose a category for the extra amount';
    end if;
    perform public.match_transaction_to_bill(p_transaction_id, p_target_id);
    select * into v_match from public.bill_transaction_matches where transaction_id = p_transaction_id;
    update public.bill_transaction_matches set matched_amount = v_primary, occurrence_date = p_occurrence_date,
      planned_amount = p_planned_amount, settlement = p_settlement where transaction_id = p_transaction_id;
    update public.monthly_overrides o set
      paid_amount = totals.amount,
      actual_amount = totals.amount,
      paid_date = totals.latest_date,
      custom_amount = case
        when v_bill.frequency = 'monthly' and p_settlement = 'full' and v_primary < p_planned_amount then v_primary
        else o.custom_amount
      end
    from (
      select coalesce(sum(matched_amount), 0) amount, max(transaction_date) latest_date
      from public.bill_transaction_matches
      where bill_id = p_target_id and match_month = v_match.match_month and match_year = v_match.match_year
    ) totals
    where o.id = v_match.override_id;
    v_allocations := jsonb_build_array(jsonb_build_object(
      'type', 'bill', 'targetId', p_target_id, 'name', v_bill.name, 'category', v_bill.category,
      'amount', v_primary, 'plannedAmount', p_planned_amount, 'occurrenceDate', p_occurrence_date, 'settlement', p_settlement
    ));
    if v_extra > 0 then
      v_allocations := v_allocations || jsonb_build_array(jsonb_build_object(
        'type', case when p_settlement = 'extra_principal' then 'extra_principal' else 'category' end,
        'targetId', case when p_settlement = 'extra_principal' then p_target_id else null end,
        'category', case when p_settlement = 'extra_principal' then 'Debt' else p_extra_category end,
        'amount', v_extra
      ));
    end if;
    update public.transactions set review_status = 'matched', review_resolution = 'bill', review_allocations = v_allocations,
      reviewed_at = v_now, reviewed_by = (select auth.uid()), matched_occurrence_date = p_occurrence_date
    where id = p_transaction_id;
  elsif p_resolution = 'income' then
    if v_tx.amount <= 0 then raise exception 'Only deposits can match planned income'; end if;
    select * into v_income from public.incomes where id = p_target_id;
    if not found or v_income.household_id is distinct from v_tx.household_id or v_income.budget_id is distinct from v_tx.budget_id then
      raise exception 'Income does not belong to this household plan';
    end if;
    if p_occurrence_date is null or p_planned_amount is null or p_planned_amount <= 0 then raise exception 'Income occurrence details are required'; end if;
    if coalesce(p_settlement, '') not in ('exact', 'full', 'partial') then raise exception 'Choose how this income was received'; end if;
    v_allocations := jsonb_build_array(jsonb_build_object(
      'type', 'income', 'targetId', p_target_id, 'name', v_income.name, 'amount', v_actual,
      'plannedAmount', p_planned_amount, 'occurrenceDate', p_occurrence_date, 'settlement', p_settlement
    ));
    update public.transactions set category = 'Income', linked_bill_id = null, linked_income_id = p_target_id,
      linked_plan_id = null, linked_plan_type = null, matched_occurrence_date = p_occurrence_date,
      match_confidence = 1, match_reason = 'confirmed_income_match', review_status = 'matched', review_resolution = 'income',
      review_allocations = v_allocations, reviewed_at = v_now, reviewed_by = (select auth.uid())
    where id = p_transaction_id;
  elsif p_resolution = 'goal' then
    if v_tx.amount >= 0 then raise exception 'Only money-out transactions can match planned expenses'; end if;
    if p_occurrence_date is null or p_planned_amount is null or p_planned_amount <= 0 then raise exception 'Planned occurrence details are required'; end if;
    if coalesce(p_settlement, '') not in ('exact', 'full', 'partial', 'split') then raise exception 'Choose how this planned expense was paid'; end if;
    if p_settlement = 'split' and nullif(btrim(coalesce(p_extra_category, '')), '') is null then raise exception 'Choose a category for the extra amount'; end if;
    select * into v_goal from public.goals where id = p_target_id and goal_type = 'planned_expense';
    if not found or v_goal.household_id is distinct from v_tx.household_id or v_goal.budget_id is distinct from v_tx.budget_id then
      raise exception 'Planned expense does not belong to this household plan';
    end if;
    v_snapshot := v_snapshot || jsonb_build_object('goalCurrentAmount', v_goal.current_amount);
    v_primary := case when p_settlement = 'split' then least(v_actual, coalesce(p_planned_amount, v_actual)) else v_actual end;
    v_extra := greatest(0, v_actual - v_primary);
    update public.goals set current_amount = case when p_settlement = 'partial' then least(target_amount, current_amount + v_primary) else target_amount end where id = p_target_id;
    v_allocations := jsonb_build_array(jsonb_build_object('type', 'planned_expense', 'source', 'goal', 'targetId', p_target_id,
      'name', v_goal.name, 'amount', v_primary, 'plannedAmount', p_planned_amount, 'occurrenceDate', p_occurrence_date, 'settlement', p_settlement));
    if v_extra > 0 then v_allocations := v_allocations || jsonb_build_array(jsonb_build_object('type', 'category', 'category', p_extra_category, 'amount', v_extra)); end if;
    update public.transactions set linked_bill_id = null, linked_income_id = null, linked_plan_id = p_target_id, linked_plan_type = 'goal',
      matched_occurrence_date = p_occurrence_date, match_confidence = 1, match_reason = 'confirmed_plan_match', review_status = 'matched',
      review_resolution = 'goal', review_allocations = v_allocations, reviewed_at = v_now, reviewed_by = (select auth.uid()) where id = p_transaction_id;
  else
    if v_tx.amount >= 0 then raise exception 'Only money-out transactions can match planned expenses'; end if;
    if p_occurrence_date is null or p_planned_amount is null or p_planned_amount <= 0 then raise exception 'Planned occurrence details are required'; end if;
    if coalesce(p_settlement, '') not in ('exact', 'full', 'partial', 'split') then raise exception 'Choose how this planned expense was paid'; end if;
    if p_settlement = 'split' and nullif(btrim(coalesce(p_extra_category, '')), '') is null then raise exception 'Choose a category for the extra amount'; end if;
    select * into v_decision from public.decisions where id = p_target_id;
    if not found or v_decision.household_id is distinct from v_tx.household_id or v_decision.budget_id is distinct from v_tx.budget_id then
      raise exception 'Calendar plan does not belong to this household plan';
    end if;
    v_snapshot := v_snapshot || jsonb_build_object('decisionStatus', v_decision.status, 'decisionActualAmount', v_decision.actual_amount, 'decisionCompletedAt', v_decision.completed_at);
    v_primary := case when p_settlement = 'split' then least(v_actual, coalesce(p_planned_amount, v_actual)) else v_actual end;
    v_extra := greatest(0, v_actual - v_primary);
    update public.decisions set status = case when p_settlement = 'partial' then status else 'completed' end,
      actual_amount = v_primary, completed_at = case when p_settlement = 'partial' then completed_at else v_now end, updated_at = v_now where id = p_target_id;
    v_allocations := jsonb_build_array(jsonb_build_object('type', 'planned_expense', 'source', 'decision', 'targetId', p_target_id,
      'name', v_decision.name, 'amount', v_primary, 'plannedAmount', p_planned_amount, 'occurrenceDate', p_occurrence_date, 'settlement', p_settlement));
    if v_extra > 0 then v_allocations := v_allocations || jsonb_build_array(jsonb_build_object('type', 'category', 'category', p_extra_category, 'amount', v_extra)); end if;
    update public.transactions set linked_bill_id = null, linked_income_id = null, linked_plan_id = p_target_id, linked_plan_type = 'decision',
      matched_occurrence_date = p_occurrence_date, match_confidence = 1, match_reason = 'confirmed_plan_match', review_status = 'matched',
      review_resolution = 'decision', review_allocations = v_allocations, reviewed_at = v_now, reviewed_by = (select auth.uid()) where id = p_transaction_id;
  end if;

  insert into public.transaction_reconciliations (
    transaction_id, user_id, household_id, budget_id, resolution, target_id, occurrence_date,
    settlement, planned_amount, allocations, restore_snapshot, reviewed_by, reviewed_at, updated_at
  ) values (
    p_transaction_id, v_tx.user_id, v_tx.household_id, v_tx.budget_id, p_resolution, p_target_id,
    p_occurrence_date, coalesce(p_settlement, 'regular'), p_planned_amount, v_allocations, v_snapshot,
    (select auth.uid()), v_now, v_now
  ) on conflict (transaction_id) do update set
    resolution = excluded.resolution, target_id = excluded.target_id, occurrence_date = excluded.occurrence_date,
    settlement = excluded.settlement, planned_amount = excluded.planned_amount, allocations = excluded.allocations,
    restore_snapshot = excluded.restore_snapshot, reviewed_by = excluded.reviewed_by,
    reviewed_at = excluded.reviewed_at, updated_at = excluded.updated_at;

  return jsonb_build_object('transaction_id', p_transaction_id, 'resolution', p_resolution, 'allocations', v_allocations, 'reviewed_at', v_now);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.match_transaction_to_bill(p_transaction_id text, p_bill_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_tx public.transactions%rowtype;
  v_bill public.bills%rowtype;
  v_override public.monthly_overrides%rowtype;
  v_existing_match public.bill_transaction_matches%rowtype;
  v_month integer;
  v_year integer;
  v_amount numeric;
  v_total numeric;
  v_latest_date date;
  v_has_group boolean := false;
begin
  select * into v_tx
  from public.transactions
  where id = p_transaction_id
    and removed_at is null;

  if not found then
    raise exception 'Transaction was not found';
  end if;
  if v_tx.amount >= 0 then
    raise exception 'Only money-out transactions can be matched to a bill';
  end if;

  select * into v_bill
  from public.bills
  where id = p_bill_id;

  if not found then
    raise exception 'Bill was not found';
  end if;
  if v_tx.household_id is distinct from v_bill.household_id
     or v_tx.budget_id is distinct from v_bill.budget_id then
    raise exception 'The transaction and bill must belong to the same FlowLedger plan';
  end if;
  if current_user <> 'service_role' and v_tx.household_id is null and (select auth.uid()) is distinct from v_tx.user_id then
    raise exception 'You cannot edit this personal transaction';
  end if;
  if current_user <> 'service_role' and v_tx.household_id is not null and not public.is_household_editor(v_tx.household_id) then
    raise exception 'You need edit access to match this household transaction';
  end if;

  select * into v_existing_match
  from public.bill_transaction_matches
  where transaction_id = p_transaction_id;

  if found then
    if v_existing_match.bill_id = p_bill_id then
      return jsonb_build_object(
        'transaction_id', p_transaction_id,
        'bill_id', p_bill_id,
        'already_matched', true
      );
    end if;
    raise exception 'Unmatch this transaction before choosing a different bill';
  end if;

  v_month := extract(month from v_tx.date::date)::integer - 1;
  v_year := extract(year from v_tx.date::date)::integer;
  v_amount := abs(v_tx.amount);

  select * into v_override
  from public.monthly_overrides
  where bill_id = p_bill_id
    and month = v_month
    and year = v_year
    and household_id is not distinct from v_bill.household_id
  order by id
  limit 1;

  if not found then
    insert into public.monthly_overrides (
      id, user_id, household_id, budget_id, bill_id, month, year,
      paid_amount, actual_amount, paid_date
    ) values (
      gen_random_uuid()::text,
      v_tx.user_id,
      v_bill.household_id,
      v_bill.budget_id,
      p_bill_id,
      v_month,
      v_year,
      0,
      null,
      null
    )
    returning * into v_override;
  end if;

  select * into v_existing_match
  from public.bill_transaction_matches
  where bill_id = p_bill_id
    and match_month = v_month
    and match_year = v_year
  order by created_at, transaction_id
  limit 1;
  v_has_group := found;

  insert into public.bill_transaction_matches (
    transaction_id,
    bill_id,
    override_id,
    user_id,
    household_id,
    budget_id,
    match_month,
    match_year,
    transaction_date,
    matched_amount,
    baseline_paid_amount,
    baseline_actual_amount,
    baseline_paid_date,
    previous_category,
    previous_linked_bill_id,
    previous_match_confidence,
    previous_match_reason
  ) values (
    p_transaction_id,
    p_bill_id,
    v_override.id,
    v_tx.user_id,
    v_bill.household_id,
    v_bill.budget_id,
    v_month,
    v_year,
    v_tx.date::date,
    v_amount,
    case when v_has_group then v_existing_match.baseline_paid_amount else coalesce(v_override.paid_amount, 0) end,
    case when v_has_group then v_existing_match.baseline_actual_amount else v_override.actual_amount end,
    case when v_has_group then v_existing_match.baseline_paid_date else v_override.paid_date end,
    v_tx.category,
    v_tx.linked_bill_id,
    v_tx.match_confidence,
    v_tx.match_reason
  );

  select coalesce(sum(matched_amount), 0), max(transaction_date)
  into v_total, v_latest_date
  from public.bill_transaction_matches
  where bill_id = p_bill_id
    and match_month = v_month
    and match_year = v_year;

  update public.monthly_overrides
  set paid_amount = v_total,
      actual_amount = v_total,
      paid_date = v_latest_date
  where id = v_override.id;

  update public.transactions
  set linked_bill_id = p_bill_id,
      category = v_bill.category,
      match_confidence = 1,
      match_reason = 'confirmed_bill_match'
  where id = p_transaction_id;

  return jsonb_build_object(
    'transaction_id', p_transaction_id,
    'bill_id', p_bill_id,
    'override_id', v_override.id,
    'paid_amount', v_total,
    'paid_date', v_latest_date
  );
end;
$function$
;

insert into test.before_rows(table_name,rows) values('bill_transaction_matches','[]'::jsonb);
