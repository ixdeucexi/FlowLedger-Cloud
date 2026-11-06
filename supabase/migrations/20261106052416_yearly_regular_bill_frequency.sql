-- Add yearly scheduling for regular bills only. No financial rows are changed.
-- Preserve existing authorization, row locks, idempotency and transaction matching.
-- Retired automatic calendar rollover remains disabled and is not redefined.

-- Bill dates are stored as text. Validate the selected yearly anchor without
-- DateStyle, timezone-dependent parsing, or overflowing impossible dates.
create or replace function private.is_valid_yearly_bill_anchor(p_date text)
returns boolean
language plpgsql immutable security invoker set search_path = '' as $$
begin
  if p_date is null or length(p_date) <> 10
    or p_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    return false;
  end if;
  begin
    perform pg_catalog.make_date(
      pg_catalog.substr(p_date,1,4)::integer,
      pg_catalog.substr(p_date,6,2)::integer,
      pg_catalog.substr(p_date,9,2)::integer
    );
  exception when datetime_field_overflow then
    return false;
  end;
  return true;
end;
$$;
revoke all on function private.is_valid_yearly_bill_anchor(text) from public, anon, authenticated, service_role;
grant execute on function private.is_valid_yearly_bill_anchor(text) to authenticated, service_role;

-- Apply to direct imports/inserts and existing edit RPCs as well as creation.
-- Only yearly rows are restricted; current cadences and edit RPC bytes remain.
alter table public.bills add constraint bills_yearly_anchor_non_debt_check check (
  frequency <> 'yearly'
  or (not is_debt and private.is_valid_yearly_bill_anchor(coalesce(next_payment_date,start_date)))
);

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
$function$;

CREATE OR REPLACE FUNCTION private.create_flo_entity(p_command_id uuid, p_kind text, p_payload jsonb, p_expected_household_id uuid, p_expected_budget_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := auth.uid();
  v_household uuid;
  v_budget uuid;
  v_role text;
  v_required text[];
  v_allowed text[];
  v_key text;
  v_number numeric;
  v_date date;
  v_anchor date;
  v_entity text := pg_catalog.gen_random_uuid()::text;
  v_entity_type text;
  v_title text;
  v_route text;
  v_hash text;
  v_existing private.flo_creation_receipts%rowtype;
  v_receipt jsonb;
  v_created timestamptz := pg_catalog.now();
begin
  if v_actor is null then raise exception 'Sign in to add an item'; end if;
  if p_command_id is null or p_expected_household_id is null or p_expected_budget_id is null then raise exception 'Creation command, household and preview budget are required'; end if;
  -- Lock the active selection and membership for this transaction. A concurrent
  -- switch/revocation cannot change scope halfway through a financial write.
  select active_household_id into v_household from public.user_preferences
    where user_id = v_actor for share;
  if v_household is null or v_household is distinct from p_expected_household_id then
    raise exception 'Your active household changed. Start this request again';
  end if;
  select role into v_role from public.household_members
    where household_id = v_household and user_id = v_actor for share;
  if v_role is null or v_role not in ('owner','manager','editor') then
    raise exception 'Household edit access is required';
  end if;
  begin
    select id into strict v_budget from public.budgets
      where household_id = v_household and is_default for share;
  exception when no_data_found or too_many_rows then
    raise exception 'Choose a household with one default budget before adding an item';
  end;
  if v_budget is distinct from p_expected_budget_id then
    raise exception 'Your default budget changed. Preview this request again';
  end if;
  if p_payload is null or pg_catalog.jsonb_typeof(p_payload) <> 'object'
    or pg_catalog.octet_length(p_payload::text) > 16000 then raise exception 'Invalid creation payload'; end if;
  case p_kind
    when 'create_bill' then v_required := array['name','amount','frequency','first_date']; v_allowed := v_required || array['category','is_recurring'];
    when 'create_debt' then v_required := array['name','balance','minimum_payment','apr','frequency','first_date']; v_allowed := v_required;
    when 'create_income' then v_required := array['name','amount','frequency','first_date']; v_allowed := v_required || array['monthly_last_day'];
    when 'create_manual_transaction' then v_required := array['amount','direction','date','category','note','account_id']; v_allowed := v_required;
    when 'create_bucket' then v_required := array['name','target_amount','target_date']; v_allowed := v_required;
    when 'create_savings_goal' then v_required := array['name','target_amount','target_date']; v_allowed := v_required || array['current_amount'];
    else raise exception 'Unsupported Flo creation kind';
  end case;
  if not (p_payload ?& v_required) or exists (
    select 1 from pg_catalog.jsonb_object_keys(p_payload) k where not (k = any(v_allowed))
  ) then raise exception 'Missing or unsupported creation fields'; end if;
  for v_key in select pg_catalog.jsonb_object_keys(p_payload) loop
    if v_key in ('name','category','note','account_id','direction','frequency') then
      if pg_catalog.jsonb_typeof(p_payload->v_key) <> 'string'
        or pg_catalog.length(pg_catalog.btrim(p_payload->>v_key)) = 0
        or pg_catalog.length(pg_catalog.btrim(p_payload->>v_key)) > (case when v_key='note' then 2000 else 120 end)
      then raise exception 'Invalid text field: %', v_key; end if;
    elsif v_key in ('amount','target_amount','balance','minimum_payment','current_amount','apr') then
      if pg_catalog.jsonb_typeof(p_payload->v_key) <> 'number' then raise exception 'Invalid numeric field: %', v_key; end if;
      v_number := (p_payload->>v_key)::numeric;
      if v_number < 0 or v_number >= 1000000000
        or (v_key not in ('balance','current_amount','apr') and v_number = 0)
        or (v_key='apr' and (v_number > 100 or v_number <> pg_catalog.round(v_number,4)))
        or (v_key<>'apr' and v_number <> pg_catalog.round(v_number,2))
      then raise exception 'Invalid numeric field: %', v_key; end if;
    elsif v_key in ('date','first_date','target_date') then
      if pg_catalog.jsonb_typeof(p_payload->v_key) <> 'string'
        or (p_payload->>v_key) !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      then raise exception 'Invalid calendar date: %', v_key; end if;
      begin
        v_date := (p_payload->>v_key)::date;
        if pg_catalog.to_char(v_date,'YYYY-MM-DD') <> p_payload->>v_key then raise exception 'Invalid calendar date'; end if;
      exception when others then raise exception 'Invalid calendar date: %', v_key; end;
    elsif v_key in ('monthly_last_day','is_recurring') and pg_catalog.jsonb_typeof(p_payload->v_key) <> 'boolean' then
      raise exception '% must be a boolean', v_key;
    end if;
  end loop;
  if p_payload ? 'frequency' and (
    p_payload->>'frequency' not in ('monthly','weekly','biweekly','quarterly','yearly')
    or (p_kind='create_income' and p_payload->>'frequency'='quarterly')
    or (p_kind<>'create_bill' and p_payload->>'frequency'='yearly')
  ) then raise exception 'Unsupported recurrence'; end if;
  if coalesce((p_payload->>'monthly_last_day')::boolean,false) and p_payload->>'frequency'<>'monthly' then
    raise exception 'Last-day scheduling is only available for monthly income';
  end if;
  if p_kind='create_manual_transaction' and p_payload->>'direction' not in ('expense','inflow') then raise exception 'Invalid transaction direction'; end if;

  select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    pg_catalog.jsonb_object_agg(key,case when pg_catalog.jsonb_typeof(value)='number'
      then pg_catalog.to_jsonb(pg_catalog.trim_scale((value #>> '{}')::numeric)) else value end)::text,'UTF8')),'hex')
    into v_hash from pg_catalog.jsonb_each(p_payload);
  -- Serialize exact retries, including a lost response, without trusting any
  -- caller-provided entity id or inspecting/overwriting a subsequently edited row.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_actor::text || ':' || v_household::text || ':' || p_command_id::text,0));
  select * into v_existing from private.flo_creation_receipts
    where actor_id=v_actor and household_id=v_household and command_id=p_command_id;
  if found then
    if v_existing.budget_id is distinct from v_budget then raise exception 'This creation command belongs to a different preview budget'; end if;
    if v_existing.kind <> p_kind or v_existing.payload_hash <> v_hash then raise exception 'This creation command was already used with different details'; end if;
    return v_existing.receipt;
  end if;
  if not coalesce((private.feature_access_for_user(v_actor,v_household,null)->'flo'->>'canCreate')::boolean,false) then
    raise exception using errcode='P0001',message='flo_creation_pro_required';
  end if;
  if p_kind='create_manual_transaction' then
    perform 1 from public.accounts where id=p_payload->>'account_id'
      and household_id=v_household and budget_id is not distinct from v_budget
      and is_active and account_type in ('checking','savings','cash') for share;
    if not found then raise exception 'Choose an active account in this household budget'; end if;
    insert into public.transactions(id,user_id,household_id,budget_id,account_id,amount,date,category,note,source)
      values(v_entity,v_actor,v_household,v_budget,p_payload->>'account_id',
        (p_payload->>'amount')::numeric * case when p_payload->>'direction'='expense' then -1 else 1 end,
        p_payload->>'date',pg_catalog.btrim(p_payload->>'category'),pg_catalog.btrim(p_payload->>'note'),'manual');
    v_entity_type := 'transaction'; v_title := pg_catalog.btrim(p_payload->>'note'); v_route := '/(tabs)/transactions';
  elsif p_kind in ('create_bucket','create_savings_goal') then
    insert into public.goals(id,user_id,household_id,budget_id,name,target_amount,target_date,current_amount,goal_type,created_at)
      values(v_entity,v_actor,v_household,v_budget,pg_catalog.btrim(p_payload->>'name'),(p_payload->>'target_amount')::numeric,
        p_payload->>'target_date',coalesce((p_payload->>'current_amount')::numeric,0),
        case when p_kind='create_bucket' then 'planned_expense' else 'savings' end,v_created::text);
    v_entity_type := 'goal'; v_title := pg_catalog.btrim(p_payload->>'name');
    v_route := case when p_kind='create_bucket' then '/(tabs)/more?section=buckets' else '/(tabs)/more?section=goals' end;
  elsif p_kind='create_income' then
    v_date := (p_payload->>'first_date')::date; v_anchor := v_date;
    if coalesce((p_payload->>'monthly_last_day')::boolean,false) then
      -- Match monthlyIncomeAnchorDate: preserve the real first date, then
      -- choose a valid day-31 anchor in this or the next two calendar months.
      for i in 0..2 loop
        v_anchor := (pg_catalog.date_trunc('month',v_date::timestamp) + (i || ' months')::interval + interval '1 month - 1 day')::date;
        exit when extract(day from v_anchor)=31;
      end loop;
    end if;
    insert into public.incomes(id,user_id,household_id,budget_id,name,amount,frequency,start_date,next_payment_date)
      values(v_entity,v_actor,v_household,v_budget,pg_catalog.btrim(p_payload->>'name'),(p_payload->>'amount')::numeric,
        p_payload->>'frequency',p_payload->>'first_date',pg_catalog.to_char(v_anchor,'YYYY-MM-DD'));
    v_entity_type := 'income'; v_title := pg_catalog.btrim(p_payload->>'name'); v_route := '/(tabs)/more?section=money';
  else
    v_date := (p_payload->>'first_date')::date;
    insert into public.bills(id,user_id,household_id,budget_id,name,amount,category,priority,is_debt,balance,interest_rate,due_day,day_of_week,
      start_date,next_payment_date,is_recurring,frequency,include_in_snowball,smart_priority,created_at)
      values(v_entity,v_actor,v_household,v_budget,pg_catalog.btrim(p_payload->>'name'),
        case when p_kind='create_debt' then (p_payload->>'minimum_payment')::numeric else (p_payload->>'amount')::numeric end,
        case when p_kind='create_debt' then 'Debt' else coalesce(pg_catalog.btrim(p_payload->>'category'),'Other') end,
        case when p_kind='create_debt' then 0 else 99 end,p_kind='create_debt',coalesce((p_payload->>'balance')::numeric,0),coalesce((p_payload->>'apr')::numeric,0),
        extract(day from v_date)::integer,case when p_payload->>'frequency' in ('weekly','biweekly') then extract(dow from v_date)::integer else null end,
        p_payload->>'first_date',p_payload->>'first_date',coalesce((p_payload->>'is_recurring')::boolean,true),p_payload->>'frequency',p_kind='create_debt','must',v_created::text);
    v_entity_type := 'bill'; v_title := pg_catalog.btrim(p_payload->>'name'); v_route := '/(tabs)/bills';
  end if;
  v_receipt := pg_catalog.jsonb_build_object('commandId',p_command_id,'householdId',v_household,'kind',p_kind,
    'entityId',v_entity,'entityType',v_entity_type,'title',v_title,'route',v_route,'createdAt',v_created);
  insert into private.flo_creation_receipts(actor_id,household_id,budget_id,command_id,kind,payload_hash,receipt)
    values(v_actor,v_household,v_budget,p_command_id,p_kind,v_hash,v_receipt);
  return v_receipt;
end;
$function$;
