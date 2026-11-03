-- Saved debt payment pauses. No balance, amount, schedule, priority or paid-state backfill.

-- This is a pure JSON predicate. It reads no rows, uses no extensions and
-- evaluates with the caller's privileges, including when used by the CHECK.
create or replace function public.is_valid_debt_payment_pauses(p_pauses jsonb)
returns boolean
language plpgsql immutable security invoker set search_path = '' as $$
declare
  v_pause jsonb;
  v_id text;
  v_start_text text;
  v_resume_text text;
  v_start date;
  v_resume date;
  v_previous_resume date;
  v_seen_ids text[] := '{}'::text[];
begin
  if p_pauses is null or jsonb_typeof(p_pauses) <> 'array' then return false; end if;
  if jsonb_array_length(p_pauses) > 120 then return false; end if;
  for v_pause in select value from jsonb_array_elements(p_pauses) loop
    if jsonb_typeof(v_pause) <> 'object' then return false; end if;
    if not (v_pause ?& array['id','start_date','resume_date','redirect_payment'])
       or (v_pause - array['id','start_date','resume_date','redirect_payment']) <> '{}'::jsonb
       or jsonb_typeof(v_pause->'id') is distinct from 'string'
       or jsonb_typeof(v_pause->'start_date') is distinct from 'string'
       or jsonb_typeof(v_pause->'resume_date') is distinct from 'string'
       or jsonb_typeof(v_pause->'redirect_payment') is distinct from 'boolean' then
      return false;
    end if;
    v_id := v_pause->>'id';
    if length(v_id) not between 1 and 128 or v_id !~ '^[A-Za-z0-9_-]+$'
       or v_id = any(v_seen_ids) then return false; end if;
    v_start_text := v_pause->>'start_date';
    v_resume_text := v_pause->>'resume_date';
    if length(v_start_text) <> 10 or length(v_resume_text) <> 10
       or v_start_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
       or v_resume_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return false; end if;
    begin
      -- make_date rejects impossible dates and year zero without DateStyle or
      -- timezone-dependent parsing, so the immutable contract is genuine.
      v_start := make_date(substr(v_start_text,1,4)::integer,substr(v_start_text,6,2)::integer,substr(v_start_text,9,2)::integer);
      v_resume := make_date(substr(v_resume_text,1,4)::integer,substr(v_resume_text,6,2)::integer,substr(v_resume_text,9,2)::integer);
    exception when datetime_field_overflow then return false;
    end;
    -- [start, resume): chronological, nonoverlapping intervals; adjacency is OK.
    if v_start >= v_resume or (v_previous_resume is not null and v_start < v_previous_resume) then return false; end if;
    v_previous_resume := v_resume;
    v_seen_ids := array_append(v_seen_ids,v_id);
  end loop;
  return true;
end;
$$;
revoke all on function public.is_valid_debt_payment_pauses(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.is_valid_debt_payment_pauses(jsonb) to authenticated,service_role;

-- PostgreSQL's constant default supplies [] to legacy rows without a data
-- backfill or row-level UPDATE/journal events. Keep completed pause history.
alter table public.bills
  add column debt_payment_pauses jsonb not null default '[]'::jsonb
  constraint bills_debt_payment_pauses_valid check (public.is_valid_debt_payment_pauses(debt_payment_pauses));
comment on column public.bills.debt_payment_pauses is
  'Saved payment-pause history: canonical nonoverlapping [start_date,resume_date) intervals; redirect_payment is temporary and never a minimum boost.';

-- Preserve auth, RLS, row locking, sparse expected-value CAS and retry semantics.
-- Pauses deliberately do not join the debt-minimum recalculation trigger fields.
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
$function$;

-- Public history contains bounded text for the changed IDs only. Full before
-- and after rows remain in the existing private journal for audit truth.
create or replace function private.recent_change_pause_summary(p_value jsonb,p_other jsonb)
returns text
language plpgsql immutable security invoker set search_path = '' as $$
declare
  v_value jsonb := coalesce(nullif(p_value,'null'::jsonb),'[]'::jsonb);
  v_other jsonb := coalesce(nullif(p_other,'null'::jsonb),'[]'::jsonb);
  v_pause jsonb;
  v_count integer := 0;
  v_result text := '';
begin
  if not public.is_valid_debt_payment_pauses(v_value)
     or not public.is_valid_debt_payment_pauses(v_other) then
    return 'Payment pause details unavailable';
  end if;
  for v_pause in
    select item.value from jsonb_array_elements(v_value) item
    where not exists (
      select 1 from jsonb_array_elements(v_other) other
      where other.value->>'id' = item.value->>'id' and other.value = item.value
    )
    order by item.value->>'start_date',item.value->>'id'
  loop
    v_count := v_count + 1;
    if v_count <= 3 then
      v_result := v_result || case when v_count > 1 then ' | ' else '' end || format(
        'Pause %s; resume %s; redirect: %s',v_pause->>'start_date',v_pause->>'resume_date',
        case when (v_pause->>'redirect_payment')::boolean then 'Yes' else 'No' end);
    end if;
  end loop;
  if v_count = 0 then return 'No saved pause for these dates'; end if;
  if v_count > 3 then v_result := v_result || format(' | +%s more changed pauses',v_count - 3); end if;
  return left(v_result,3000);
end;
$$;
revoke all on function private.recent_change_pause_summary(jsonb,jsonb) from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.recent_change_fields(p_table text, p_before jsonb, p_after jsonb)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select coalesce(array_agg(k order by k),'{}'::text[]) from unnest(case p_table
    when 'bills' then array['name','amount','category','is_debt','balance','interest_rate','due_day','day_of_week','start_date','end_date','is_recurring','frequency','include_in_snowball','smart_priority','next_payment_date','snowball_minimum_boost','debt_payment_pauses']
    when 'incomes' then array['name','amount','frequency','start_date','next_payment_date','amount_history','excluded_dates']
    when 'goals' then array['name','target_amount','target_date','current_amount','goal_type','closed_at','archived_at']
    when 'transactions' then array['date','amount','category','note','account_id','source','pending','deleted_at','linked_bill_id','linked_income_id','linked_plan_id','review_resolution','review_allocations','debt_applied_amount','transfer_group_id']
    else '{}'::text[] end) k where case when p_table='bills' and k='debt_payment_pauses'
      then coalesce(nullif(p_before->k,'null'::jsonb),'[]'::jsonb) is distinct from coalesce(nullif(p_after->k,'null'::jsonb),'[]'::jsonb)
      else coalesce(p_before->k,'null'::jsonb) is distinct from coalesce(p_after->k,'null'::jsonb) end;
$function$;

CREATE OR REPLACE FUNCTION private.recent_change_diff(p_change private.recent_changes)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare key text; kind text; label text; before_value jsonb; after_value jsonb; result jsonb:='[]'; account_name text;
begin
  foreach key in array private.recent_change_fields(p_change.entity_table,p_change.before_row,p_change.after_row) loop
    -- Complex arrays can contain account IDs and snapshots. Describe them without
    -- returning their internal contents to a browser or assistive technology.
    kind := case when key in ('amount','balance','target_amount','current_amount','snowball_minimum_boost','debt_applied_amount') then 'money'
      when key in ('date','start_date','end_date','next_payment_date','target_date') then 'date'
      when key in ('is_debt','is_recurring','include_in_snowball','pending') then 'boolean'
      when key in ('due_day','day_of_week','interest_rate') then 'number' else 'text' end;
    before_value:=coalesce(p_change.before_row->key,'null'::jsonb);after_value:=coalesce(p_change.after_row->key,'null'::jsonb);
    label:=case key when 'interest_rate' then 'APR'
      when 'current_amount' then case when coalesce(p_change.after_row,p_change.before_row)->>'goal_type'='planned_expense' then 'Spent' else 'Saved' end
      when 'target_amount' then case when coalesce(p_change.after_row,p_change.before_row)->>'goal_type'='planned_expense' then 'Bucket budget' else 'Savings target' end
      when 'due_day' then 'Due day' when 'next_payment_date' then 'Next payment date'
      when 'deleted_at' then 'Removed from Activity' when 'closed_at' then 'Bucket closed' when 'archived_at' then 'Archived'
      else initcap(replace(key,'_',' ')) end;
    if key='debt_payment_pauses' then
      label:='Payment pauses';kind:='text';
      before_value:=to_jsonb(private.recent_change_pause_summary(p_change.before_row->key,p_change.after_row->key));
      after_value:=to_jsonb(private.recent_change_pause_summary(p_change.after_row->key,p_change.before_row->key));
    elsif key in ('amount_history','excluded_dates','review_allocations') then
      before_value:=case when before_value='null'::jsonb then 'null'::jsonb else '"Previous details"'::jsonb end;
      after_value:=case when after_value='null'::jsonb then 'null'::jsonb else '"Updated details"'::jsonb end;
    elsif key='account_id' then
      label:='Account';
      if before_value<>'null'::jsonb then
        select name into account_name from public.accounts where id=p_change.before_row->>'account_id' and household_id=p_change.household_id and budget_id=p_change.budget_id;
        before_value:=to_jsonb(coalesce(account_name,'Previous account'));
      end if;
      if after_value<>'null'::jsonb then
        select name into account_name from public.accounts where id=p_change.after_row->>'account_id' and household_id=p_change.household_id and budget_id=p_change.budget_id;
        after_value:=to_jsonb(coalesce(account_name,'Recorded account'));
      end if;
    elsif key in ('linked_bill_id','linked_income_id','linked_plan_id','transfer_group_id') then
      before_value:=case when before_value='null'::jsonb then 'null'::jsonb else '"Previously linked"'::jsonb end;
      after_value:=case when after_value='null'::jsonb then 'null'::jsonb else '"Linked"'::jsonb end;
    elsif key in ('deleted_at','closed_at','archived_at') then
      kind:='boolean';before_value:=to_jsonb(before_value<>'null'::jsonb);after_value:=to_jsonb(after_value<>'null'::jsonb);
    end if;
    result:=result||jsonb_build_array(jsonb_build_object('key',key,'label',label,'kind',kind,'before',before_value,'after',after_value));
  end loop;
  return result;
end;
$function$;

CREATE OR REPLACE FUNCTION private.recent_change_reason(p_change private.recent_changes)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r jsonb:=coalesce(p_change.after_row,p_change.before_row); b jsonb:=p_change.before_row;
  a jsonb:=p_change.after_row; fields text[]; raw_fields text[]; current_row jsonb; latest bigint;
begin
  if p_change.undone_at is not null then return 'Already undone'; end if;
  if p_change.undo_of is not null then return 'This records an Undo. Open the item to make another change'; end if;
  if not p_change.actor_was_authenticated then return 'Automatic updates are recorded for reference'; end if;
  if p_change.operation='DELETE' then return 'Deletion can have linked effects. Use the item’s existing restore tools when available'; end if;
  if p_change.entity_table='bills'
     and coalesce(nullif(b->'debt_payment_pauses','null'::jsonb),'[]'::jsonb) is distinct from coalesce(nullif(a->'debt_payment_pauses','null'::jsonb),'[]'::jsonb) then
    return 'Payment pauses use the debt’s Resume or Cancel controls';
  end if;
  if (select count(*) from private.recent_changes where group_id=p_change.group_id)>1 then return 'This changed related records together. Use the item’s dedicated controls'; end if;
  if (b is not null and (b->>'household_id' is distinct from a->>'household_id' or b->>'budget_id' is distinct from a->>'budget_id' or b->>'user_id' is distinct from a->>'user_id')) then return 'Workspace or ownership changes cannot be undone here'; end if;
  select version into latest from private.recent_change_versions where entity_table=p_change.entity_table and entity_id=p_change.entity_id;
  if latest is distinct from p_change.entity_version then return 'This item changed again. Only its latest supported change can be undone'; end if;
  execute format('select to_jsonb(t) from public.%I t where id=$1',p_change.entity_table) into current_row using p_change.entity_id;
  if current_row is distinct from a then return 'This item changed again. Refresh Recent Changes'; end if;
  fields := private.recent_change_fields(p_change.entity_table,b,a);
  if b is not null then
    select coalesce(array_agg(key),'{}'::text[]) into raw_fields from jsonb_object_keys(a||b) key
      where (a->key is distinct from b->key) and key not in ('last_reviewed_at','user_edited_at','plaid_last_synced_at');
  end if;
  if cardinality(fields)=0 then return 'This update has no reversible display fields'; end if;
  case p_change.entity_table
    when 'bills' then
      if p_change.operation='INSERT' then
        if coalesce((a->>'is_debt')::boolean,false) or nullif(a->>'plaid_account_id','') is not null or nullif(a->>'plaid_account_record_id','') is not null then return 'Debt and bank-linked creation needs its dedicated controls'; end if;
        if private.recent_change_has_links('bills',p_change.entity_id,p_change.household_id,p_change.budget_id) then return 'This bill has payments or linked records. Open the bill to make changes'; end if;
      elsif not raw_fields <@ array['name','category'] then return 'Payment, schedule and debt changes need the bill’s dedicated controls'; end if;
    when 'incomes' then
      if private.recent_change_has_links('incomes',p_change.entity_id,p_change.household_id,p_change.budget_id) then return 'This income has linked activity. Open income settings to make changes'; end if;
      -- Complex schedule arrays have a privacy-preserving summary in history,
      -- not a reviewable date/money preview. Do not offer a blind inverse.
      if p_change.operation='UPDATE' and raw_fields && array['amount_history','excluded_dates'] then return 'Income amount history and skipped dates need income settings’ dedicated controls'; end if;
      if p_change.operation='UPDATE' and not raw_fields <@ array['name','amount','frequency','start_date','next_payment_date'] then return 'This income change needs income settings’ dedicated controls'; end if;
    when 'goals' then
      if a->>'goal_type' is distinct from 'savings' or (b is not null and b->>'goal_type' is distinct from 'savings') then return 'Spending bucket budgets and purchases use their dedicated controls'; end if;
      if coalesce((a->>'current_amount')::numeric,0)<>0 or (b is not null and coalesce((b->>'current_amount')::numeric,0)<>0) or private.recent_change_has_links('goals',p_change.entity_id,p_change.household_id,p_change.budget_id) then return 'Funded or linked goals need their dedicated controls'; end if;
      if p_change.operation='UPDATE' and not raw_fields <@ array['name','target_amount','target_date'] then return 'Goal lifecycle changes use their dedicated controls'; end if;
    when 'transactions' then
      if exists(select 1 from unnest(case when b is null then array[a] else array[b,a] end) row_value where
        coalesce(row_value->>'source','manual') is distinct from 'manual' or coalesce((row_value->>'pending')::boolean,false)
        or row_value->>'review_status' is distinct from 'legacy_reviewed'
        or row_value->>'category'='Transfer'
        or nullif(row_value->>'plaid_transaction_id','') is not null or nullif(row_value->>'plaid_account_id','') is not null or nullif(row_value->>'import_hash','') is not null
        or nullif(row_value->>'linked_bill_id','') is not null or nullif(row_value->>'debt_applied_bill_id','') is not null
        or nullif(row_value->>'linked_income_id','') is not null or nullif(row_value->>'linked_plan_id','') is not null
        or nullif(row_value->>'transfer_group_id','') is not null or coalesce((row_value->>'debt_applied_amount')::numeric,0)<>0
        or nullif(row_value->>'review_resolution','') is not null or coalesce(row_value->'review_allocations','[]'::jsonb) not in ('[]'::jsonb,'null'::jsonb)
        or nullif(row_value->>'removed_at','') is not null) then return 'Matched, imported, bank, transfer and bucket activity use their dedicated controls'; end if;
      if private.recent_change_has_links('transactions',p_change.entity_id,p_change.household_id,p_change.budget_id) then return 'This transaction has linked records. Use Activity to make changes'; end if;
      if b is not null and b->>'account_id' is distinct from a->>'account_id' and nullif(b->>'account_id','') is not null
        and not exists(select 1 from public.accounts account where account.id=b->>'account_id' and account.household_id=p_change.household_id and account.budget_id=p_change.budget_id and account.is_active)
      then return 'The previous account is unavailable. Open Activity to choose an account'; end if;
      if p_change.operation='UPDATE' and not raw_fields <@ array['date','amount','category','note','account_id','deleted_at','deleted_by'] then return 'This transaction change needs Activity’s dedicated controls'; end if;
      if p_change.operation='INSERT' and nullif(a->>'deleted_at','') is not null then return 'This transaction is already deleted'; end if;
    else return 'This kind of change cannot be undone here';
  end case;
  return null;
end;
$function$;

notify pgrst, 'reload schema';
