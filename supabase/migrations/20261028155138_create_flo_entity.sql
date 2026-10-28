-- Flo creation has no history-row dependency: retries outlive chat retention.
-- Financial writes and the immutable command receipt commit together.
create table private.flo_creation_receipts (
  actor_id uuid not null references auth.users(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  -- Keep the original budget even if that budget is later removed; otherwise
  -- deleting a budget could erase retry protection and recreate the command.
  budget_id uuid not null,
  command_id uuid not null,
  kind text not null,
  payload_hash text not null,
  receipt jsonb not null,
  created_at timestamptz not null default now(),
  primary key (actor_id, household_id, command_id),
  check (kind in ('create_bill','create_debt','create_income','create_manual_transaction','create_bucket','create_savings_goal')),
  check (jsonb_typeof(receipt) = 'object')
);
alter table private.flo_creation_receipts enable row level security;
revoke all on private.flo_creation_receipts from public, anon, authenticated, service_role;

create function private.reject_flo_creation_receipt_change() returns trigger
language plpgsql set search_path = '' as $$
begin raise exception 'Flo creation receipts are immutable'; end;
$$;
revoke all on function private.reject_flo_creation_receipt_change() from public, anon, authenticated, service_role;
-- Client roles have no DELETE right. Lifecycle cascades must remain possible
-- so deleting an account/household also erases its private creation receipts.
create trigger flo_creation_receipts_immutable before update
on private.flo_creation_receipts for each row execute function private.reject_flo_creation_receipt_change();

create function private.create_flo_entity(
  p_command_id uuid, p_kind text, p_payload jsonb, p_expected_household_id uuid, p_expected_budget_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
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
    p_payload->>'frequency' not in ('monthly','weekly','biweekly','quarterly')
    or (p_kind='create_income' and p_payload->>'frequency'='quarterly')
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
$$;
revoke all on function private.create_flo_entity(uuid,text,jsonb,uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function private.create_flo_entity(uuid,text,jsonb,uuid,uuid) to authenticated;

create function public.create_flo_entity(p_command_id uuid,p_kind text,p_payload jsonb,p_expected_household_id uuid,p_expected_budget_id uuid)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.create_flo_entity(p_command_id,p_kind,p_payload,p_expected_household_id,p_expected_budget_id);
$$;
revoke all on function public.create_flo_entity(uuid,text,jsonb,uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function public.create_flo_entity(uuid,text,jsonb,uuid,uuid) to authenticated;

-- History hydration/recovery reads a committed receipt without ever replaying
-- an old creation proposal. It is restricted to the original actor in their
-- currently selected household, with current household membership.
create function private.read_flo_creation_receipt(p_command_id uuid,p_expected_household_id uuid,p_expected_budget_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_household uuid; v_budget uuid; v_receipt jsonb;
begin
  if v_actor is null then raise exception 'Sign in to read a creation receipt'; end if;
  select active_household_id into v_household from public.user_preferences where user_id=v_actor;
  if v_household is null or p_expected_household_id is null or v_household is distinct from p_expected_household_id
    or not exists(select 1 from public.household_members where household_id=v_household and user_id=v_actor)
  then raise exception 'Choose your household again before reading this receipt'; end if;
  begin
    select id into strict v_budget from public.budgets where household_id=v_household and is_default;
  exception when no_data_found or too_many_rows then
    raise exception 'Choose a household with one default budget before reading this receipt';
  end;
  if p_expected_budget_id is null or v_budget is distinct from p_expected_budget_id then
    raise exception 'Your default budget changed. Refresh before reading this receipt';
  end if;
  select receipt into v_receipt from private.flo_creation_receipts
    where actor_id=v_actor and household_id=v_household and budget_id=v_budget and command_id=p_command_id;
  return v_receipt;
end;
$$;
revoke all on function private.read_flo_creation_receipt(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.read_flo_creation_receipt(uuid,uuid,uuid) to authenticated;
create function public.read_flo_creation_receipt(p_command_id uuid,p_expected_household_id uuid,p_expected_budget_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.read_flo_creation_receipt(p_command_id,p_expected_household_id,p_expected_budget_id);
$$;
revoke all on function public.read_flo_creation_receipt(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_flo_creation_receipt(uuid,uuid,uuid) to authenticated;
