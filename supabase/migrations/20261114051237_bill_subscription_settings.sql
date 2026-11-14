-- Manual bill classification: NULL preserves Automatic for existing bills.
-- Additive only: no financial rows, RLS policies, grants, or undo rights change.
alter table public.bills add column if not exists is_subscription boolean;
-- Setting a default affects only later inserts; existing NULL rows stay Automatic.
alter table public.bills alter column is_subscription set default false;
comment on column public.bills.is_subscription is 'NULL: Automatic subscription clues; true: Subscription; false: Regular bill. Explicit choices override inferred merchant links and names.';

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
      'smart_priority', 'include_in_snowball', 'debt_payment_pauses', 'funding_account_ref', 'is_subscription'
    ])) then
      raise exception 'Unsupported bill edit field: %', v_key;
    end if;
    if not coalesce(p_expected, '{}'::jsonb) ? v_key then
      raise exception 'Missing expected value for bill field: %', v_key;
    end if;
  end loop;

  if p_patch ? 'is_subscription' and jsonb_typeof(p_patch -> 'is_subscription') not in ('boolean', 'null') then
    raise exception 'Choose a valid bill type';
  end if;

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

  if p_patch ? 'funding_account_ref' then
    p_patch:=p_patch||jsonb_build_object('funding_account_ref',(private.forecast_account_details(v_bill.household_id,v_bill.budget_id,p_patch->>'funding_account_ref',true))->>'ref');
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
    funding_account_ref = case when p_patch ? 'funding_account_ref' then p_patch ->> 'funding_account_ref' else funding_account_ref end,
    is_subscription = case when p_patch ? 'is_subscription' then (p_patch ->> 'is_subscription')::boolean else is_subscription end,
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
$function$;



CREATE OR REPLACE FUNCTION private.create_subscription_bill(p_candidate_id uuid, p_bill_id text, p_household_id uuid, p_merchant text, p_cadence text, p_average_amount numeric, p_monthly_equivalent numeric, p_yearly_equivalent numeric, p_confidence text, p_source_transaction_ids text[], p_amount numeric, p_start_date date, p_due_day integer, p_frequency text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_budget_id uuid;
  v_candidate public.subscription_candidates%rowtype;
  v_bill public.bills%rowtype;
  v_existing_link public.subscription_bill_links%rowtype;
  v_name text := btrim(coalesce(p_merchant, ''));
  v_key text;
  v_priority integer;
begin
  if v_actor is null then raise exception 'Sign in to create a subscription bill'; end if;
  if p_household_id is null or not (select private.is_household_editor(p_household_id)) then
    raise exception 'You need household edit access to create this bill';
  end if;
  if p_candidate_id is null or nullif(btrim(coalesce(p_bill_id, '')), '') is null then
    raise exception 'Stable subscription and bill ids are required';
  end if;
  if char_length(p_bill_id) > 200 then raise exception 'Subscription bill id is too long'; end if;
  if v_name = '' or char_length(v_name) > 120 then
    raise exception 'Enter a subscription name up to 120 characters';
  end if;
  if p_cadence not in ('weekly', 'monthly', 'annual', 'unknown')
    or p_frequency not in ('weekly', 'monthly')
    or p_confidence not in ('low', 'medium', 'high') then
    raise exception 'Subscription details are invalid';
  end if;
  if p_amount is null or lower(p_amount::text) in ('nan', 'infinity', '-infinity')
    or round(p_amount, 2) <= 0 or p_amount > 1000000000
    or p_average_amount is null or lower(p_average_amount::text) in ('nan', 'infinity', '-infinity')
    or p_average_amount < 0 or p_average_amount > 1000000000
    or p_monthly_equivalent is null or lower(p_monthly_equivalent::text) in ('nan', 'infinity', '-infinity')
    or p_monthly_equivalent < 0 or p_monthly_equivalent > 1000000000
    or p_yearly_equivalent is null or lower(p_yearly_equivalent::text) in ('nan', 'infinity', '-infinity')
    or p_yearly_equivalent < 0 or p_yearly_equivalent > 1000000000 then
    raise exception 'Subscription amounts must be finite';
  end if;
  if p_start_date is null then raise exception 'Subscription start date is required'; end if;
  if cardinality(coalesce(p_source_transaction_ids, '{}'::text[])) > 500 then
    raise exception 'Subscription has too many source transactions';
  end if;
  if p_due_day not between 1 and 28 then raise exception 'Subscription due day must be between 1 and 28'; end if;

  v_key := btrim(regexp_replace(
    regexp_replace(
      regexp_replace(lower(v_name), '[^a-z0-9[:space:]]', ' ', 'g'),
      '\m(pos|debit|card|purchase|payment|inc|llc|co)\M', ' ', 'g'
    ),
    '[[:space:]]+', ' ', 'g'
  ));
  if v_key = '' then raise exception 'Subscription name is too generic'; end if;

  -- There may be no candidate row to lock yet. Serialize on the stable intent
  -- id so two first-time requests cannot race through duplicate bill inserts.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_candidate_id::text, 0)
  );
  -- Candidate ids are stable for a single client intent, while merchant keys
  -- are stable across every device and candidate for the same subscription.
  -- Lock both so a second create cannot replace an existing merchant link.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_household_id::text || ':' || v_key, 1)
  );

  select id into v_budget_id from public.budgets
  where household_id = p_household_id and is_default limit 1;
  if v_budget_id is null then raise exception 'Household budget not found'; end if;

  select * into v_candidate from public.subscription_candidates
  where id = p_candidate_id for update;
  if found and v_candidate.household_id <> p_household_id then
    raise exception 'Subscription candidate belongs to another household';
  end if;
  if found and v_candidate.bill_id is not null then
    select * into v_bill from public.bills where id = v_candidate.bill_id for update;
    if v_bill.id = p_bill_id and v_bill.household_id = p_household_id
      and abs(v_bill.amount - round(p_amount, 2)) < 0.005
      and v_bill.frequency = p_frequency
      and v_bill.due_day = p_due_day
      and btrim(v_bill.name) = v_name
      and v_bill.category = 'Subscriptions'
      and v_bill.start_date = p_start_date::text
      and v_bill.is_recurring
      and not v_bill.is_debt
      and v_candidate.merchant_key = v_key
      and v_candidate.cadence = p_cadence
      and abs(v_candidate.average_amount - round(p_average_amount, 2)) < 0.005
      and abs(v_candidate.monthly_equivalent - round(p_monthly_equivalent, 2)) < 0.005
      and abs(v_candidate.yearly_equivalent - round(p_yearly_equivalent, 2)) < 0.005
      and v_candidate.confidence = p_confidence
      and v_candidate.status = 'convert_to_bill'
      and v_candidate.source_transaction_ids = coalesce(p_source_transaction_ids, '{}'::text[])
      and exists (
        select 1 from public.subscription_bill_links link
        where link.household_id = p_household_id
          and link.merchant_key = v_key
          and link.bill_id = p_bill_id
      ) then
      return jsonb_build_object(
        'candidate_id', p_candidate_id,
        'bill_id', v_bill.id,
        'retry', true
      );
    end if;
    raise exception 'This subscription already created a different bill';
  end if;

  select * into v_existing_link
  from public.subscription_bill_links
  where household_id = p_household_id
    and merchant_key = v_key
  for update;
  if found then
    raise exception 'This subscription is already linked to an existing bill';
  end if;

  if exists (select 1 from public.bills where id = p_bill_id) then
    raise exception 'That subscription bill id is already in use';
  end if;
  select coalesce(max(priority), 0) + 1 into v_priority
  from public.bills where household_id = p_household_id;

  insert into public.bills (
    id, user_id, household_id, budget_id, name, amount, category, priority,
    is_debt, balance, interest_rate, due_day, start_date, is_recurring,
    frequency, smart_priority, include_in_snowball, is_subscription
  ) values (
    p_bill_id, v_actor, p_household_id, v_budget_id, v_name,
    round(p_amount, 2), 'Subscriptions', v_priority, false, 0, 0,
    p_due_day, p_start_date::text, true, p_frequency, 'must', false, true
  ) returning * into v_bill;

  insert into public.subscription_candidates (
    id, user_id, household_id, merchant, cadence, average_amount,
    monthly_equivalent, yearly_equivalent, confidence, status,
    source_transaction_ids, bill_id, last_reviewed_at, updated_at
  ) values (
    p_candidate_id, v_actor, p_household_id, v_name, p_cadence,
    round(p_average_amount, 2), round(p_monthly_equivalent, 2),
    round(p_yearly_equivalent, 2), p_confidence, 'convert_to_bill',
    coalesce(p_source_transaction_ids, '{}'::text[]), p_bill_id, now(), now()
  )
  on conflict (id) do update set
    user_id = excluded.user_id,
    merchant = excluded.merchant,
    cadence = excluded.cadence,
    average_amount = excluded.average_amount,
    monthly_equivalent = excluded.monthly_equivalent,
    yearly_equivalent = excluded.yearly_equivalent,
    confidence = excluded.confidence,
    status = excluded.status,
    source_transaction_ids = excluded.source_transaction_ids,
    bill_id = excluded.bill_id,
    last_reviewed_at = excluded.last_reviewed_at,
    updated_at = excluded.updated_at;

  insert into public.subscription_bill_links (
    user_id, household_id, merchant_key, merchant_label, bill_id, updated_at
  ) values (
    v_actor, p_household_id, v_key, v_name, p_bill_id, now()
  );

  return jsonb_build_object(
    'candidate_id', p_candidate_id,
    'bill_id', p_bill_id,
    'retry', false
  );
end;
$function$;



CREATE OR REPLACE FUNCTION private.recent_change_fields(p_table text, p_before jsonb, p_after jsonb)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select coalesce(array_agg(k order by k),'{}'::text[]) from unnest(case p_table
    when 'bills' then array['name','amount','category','is_debt','balance','interest_rate','due_day','day_of_week','start_date','end_date','is_recurring','frequency','include_in_snowball','smart_priority','next_payment_date','snowball_minimum_boost','debt_payment_pauses','is_subscription']
    when 'incomes' then array['name','amount','frequency','start_date','next_payment_date','amount_history','excluded_dates']
    when 'goals' then array['name','target_amount','target_date','current_amount','goal_type','closed_at','archived_at']
    when 'transactions' then array['date','amount','category','note','account_id','source','pending','deleted_at','linked_bill_id','linked_income_id','linked_plan_id','review_resolution','review_allocations','debt_applied_amount','transfer_group_id']
    else '{}'::text[] end) k where case when p_table='bills' and k='debt_payment_pauses'
      then coalesce(nullif(p_before->k,'null'::jsonb),'[]'::jsonb) is distinct from coalesce(nullif(p_after->k,'null'::jsonb),'[]'::jsonb)
      else coalesce(p_before->k,'null'::jsonb) is distinct from coalesce(p_after->k,'null'::jsonb) end;
$function$;
