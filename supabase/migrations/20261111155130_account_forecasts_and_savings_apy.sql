-- Additive account planning. Existing rows remain unassigned; no balance or
-- financial-history backfill is performed by this migration.
alter table public.bills add column if not exists funding_account_ref text;
alter table public.incomes add column if not exists deposit_account_ref text;
alter table public.goals add column if not exists funding_account_ref text;
alter table public.goals add column if not exists deposit_account_ref text;
alter table public.decisions add column if not exists funding_account_ref text;
alter table public.decisions add column if not exists deposit_account_ref text;
alter table public.extra_payments add column if not exists funding_account_ref text;
alter table public.transactions add column if not exists forecast_account_ref text;

create table if not exists public.account_forecast_preferences (
  household_id uuid not null references public.households(id) on delete cascade,
  account_ref text not null,
  savings_apy numeric,
  safety_floor numeric,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (household_id, account_ref),
  constraint account_forecast_preferences_apy check (
    savings_apy is null or (savings_apy between 0 and 100 and lower(savings_apy::text) not in ('nan','infinity','-infinity'))
  ),
  constraint account_forecast_preferences_floor check (
    safety_floor is null or (safety_floor between 0 and 1000000000 and lower(safety_floor::text) not in ('nan','infinity','-infinity'))
  ),
  constraint account_forecast_preferences_ref check (length(account_ref) between 8 and 240)
);
alter table public.account_forecast_preferences enable row level security;
revoke all on public.account_forecast_preferences from public, anon, authenticated, service_role;
grant select on public.account_forecast_preferences to authenticated;
create policy account_forecast_preferences_members_read
on public.account_forecast_preferences for select to authenticated
using ((select auth.uid()) is not null and (select private.is_household_member(household_id)));

-- Reference validation uses existing household-member bank SELECT policies.
-- It reveals no credential, item, raw bank payload or balance and grants no
-- bank-connection control. Every invocation checks current membership, and
-- every writable reference requires a current cash account in the requested
-- household/budget.
-- Canonical physical identity is an explicit local account, or bank rows with
-- the same nonempty provider persistent ID. Names and masks never establish it.
create or replace function private.forecast_account_details(
 p_household_id uuid,p_budget_id uuid,p_account_ref text,p_strict_budget boolean default false
) returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare m public.accounts%rowtype; b public.plaid_accounts%rowtype; initial public.plaid_accounts%rowtype;
 kind text; bridge text; local_id text; bank_id uuid; links text[]; physical_count integer; aliases jsonb;
begin
 if auth.uid() is null or p_household_id is null or not private.is_household_member(p_household_id) then raise exception 'Household access required'; end if;
 if p_account_ref is null then return null; end if;
 if length(p_account_ref)>240 or p_account_ref<>btrim(p_account_ref) then raise exception 'Choose a valid account'; end if;
 if p_budget_id is not null and not exists(select 1 from public.budgets where id=p_budget_id and household_id=p_household_id) then raise exception 'Choose a budget in this household'; end if;
 if p_account_ref like 'manual:%' then
  local_id:=substring(p_account_ref from 8);
  select * into m from public.accounts where id=local_id and household_id=p_household_id and is_active
   and ((not p_strict_budget and p_budget_id is null) or budget_id is not distinct from p_budget_id) for share;
  if not found then raise exception 'Choose an active account in this household plan'; end if;
  if m.account_type not in('checking','savings','cash') then raise exception 'Choose a cash account'; end if;
  select count(distinct case when nullif(btrim(a.persistent_account_id),'') is not null then 'persistent:'||a.persistent_account_id else 'row:'||a.id::text end)
   into physical_count from public.plaid_accounts a where a.household_id=p_household_id and (a.is_active or (nullif(btrim(a.persistent_account_id),'') is not null and exists(select 1 from public.plaid_accounts peer where peer.household_id=p_household_id and peer.is_active and peer.persistent_account_id=a.persistent_account_id))) and (a.account_id=m.id or a.flowledger_account_id=m.id);
  if physical_count>1 then raise exception 'This account has conflicting bank links'; end if;
  if physical_count=0 then return jsonb_build_object('ref','manual:'||m.id,'type',m.account_type,'local_id',m.id,'bank_id',null,'bridge_local_id',null,'aliases',jsonb_build_array('manual:'||m.id),'physical_key','manual:'||m.id); end if;
  select a.id into bank_id from public.plaid_accounts a where a.household_id=p_household_id and (a.is_active or (nullif(btrim(a.persistent_account_id),'') is not null and exists(select 1 from public.plaid_accounts peer where peer.household_id=p_household_id and peer.is_active and peer.persistent_account_id=a.persistent_account_id))) and (a.account_id=m.id or a.flowledger_account_id=m.id)
   order by a.is_active desc,a.updated_at desc nulls last,a.id limit 1;
 elsif p_account_ref ~ '^bank:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
  bank_id:=substring(p_account_ref from 6)::uuid;
 else raise exception 'Choose a valid account reference';
 end if;
 select * into initial from public.plaid_accounts where id=bank_id and household_id=p_household_id;
 if not found then raise exception 'Choose an active bank account in this household'; end if;
 select * into b from public.plaid_accounts a where a.household_id=p_household_id and a.is_active
  and (a.id=initial.id or (nullif(btrim(initial.persistent_account_id),'') is not null and a.persistent_account_id=initial.persistent_account_id))
  order by a.updated_at desc nulls last,a.id limit 1;
 if not found then raise exception 'Choose an active bank account in this household'; end if;
 kind:=case when lower(coalesce(b.account_type,b.type,'')) in('depository','checking','savings') and lower(coalesce(b.account_subtype,b.subtype,'')) in('checking','savings') then lower(coalesce(b.account_subtype,b.subtype)) else null end;
 if kind is null then raise exception 'Choose a checking or savings account'; end if;
 if exists(select 1 from public.plaid_accounts a where a.household_id=p_household_id
  and (a.id=b.id or (nullif(btrim(b.persistent_account_id),'') is not null and a.persistent_account_id=b.persistent_account_id))
  and (lower(coalesce(a.account_type,a.type,'')) not in('depository','checking','savings') or lower(coalesce(a.account_subtype,a.subtype,''))<>kind)) then raise exception 'This account has an invalid bank link'; end if;
 if exists(select 1 from public.plaid_accounts a where a.household_id=p_household_id
  and (a.id=b.id or (nullif(btrim(b.persistent_account_id),'') is not null and a.persistent_account_id=b.persistent_account_id))
  and a.currency_code is not null and upper(btrim(a.currency_code))<>'USD') then raise exception 'This app plans in USD. Choose a USD account'; end if;
 select array_agg(distinct x.link) into links from public.plaid_accounts a
  cross join lateral (values(a.account_id),(a.flowledger_account_id)) x(link)
  where a.household_id=p_household_id and (a.id=b.id or (nullif(btrim(b.persistent_account_id),'') is not null and a.persistent_account_id=b.persistent_account_id)) and x.link is not null;
 if coalesce(array_length(links,1),0)>1 then raise exception 'This account has conflicting bank links'; end if;
 bridge:=links[1];
 if bridge is not null then
  select * into m from public.accounts where id=bridge and household_id=p_household_id and is_active for share;
  if not found or m.account_type<>kind then raise exception 'This account has an invalid bank link'; end if;
  if exists(select 1 from public.plaid_accounts a where a.household_id=p_household_id and (a.is_active or (nullif(btrim(a.persistent_account_id),'') is not null and exists(select 1 from public.plaid_accounts peer where peer.household_id=p_household_id and peer.is_active and peer.persistent_account_id=a.persistent_account_id))) and a.id<>b.id and (a.account_id=bridge or a.flowledger_account_id=bridge)
   and (nullif(btrim(b.persistent_account_id),'') is null or a.persistent_account_id is distinct from b.persistent_account_id)) then raise exception 'This account has conflicting bank links'; end if;
 end if;
 select jsonb_agg('bank:'||a.id::text order by a.id) into aliases from public.plaid_accounts a where a.household_id=p_household_id
  and (a.id=b.id or (nullif(btrim(b.persistent_account_id),'') is not null and a.persistent_account_id=b.persistent_account_id));
 if bridge is not null then aliases:=aliases||jsonb_build_array('manual:'||bridge); end if;
 return jsonb_build_object('ref','bank:'||b.id::text,'type',kind,'local_id',local_id,'bank_id',b.id,'bridge_local_id',bridge,'aliases',aliases,
  'physical_key',case when nullif(btrim(b.persistent_account_id),'') is not null then 'persistent:'||b.persistent_account_id else 'bank:'||b.id::text end);
end;
$$;
revoke all on function private.forecast_account_details(uuid,uuid,text,boolean) from public,anon,service_role;
grant execute on function private.forecast_account_details(uuid,uuid,text,boolean) to authenticated;


create or replace function private.get_household_forecast_accounts(p_household_id uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
begin
  if auth.uid() is null or p_household_id is null or not private.is_household_member(p_household_id) then
    raise exception 'Household access required';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id',a.id,'household_id',a.household_id,'plaid_account_id',a.plaid_account_id,
    'account_id',a.account_id,'flowledger_account_id',a.flowledger_account_id,
    'persistent_account_id',a.persistent_account_id,'name',a.name,'display_name',a.display_name,
    'official_name',a.official_name,'mask',a.mask,'account_type',a.account_type,'account_subtype',a.account_subtype,
    'type',a.type,'subtype',a.subtype,'current_balance',a.current_balance,'available_balance',a.available_balance,
    'currency_code',a.currency_code,'is_active',a.is_active,'updated_at',a.updated_at,
    'minimum_payment_amount',a.minimum_payment_amount,'next_payment_due_date',a.next_payment_due_date,
    'last_statement_balance',a.last_statement_balance,'last_statement_issue_date',a.last_statement_issue_date,
    'is_overdue',a.is_overdue,'purchase_apr',a.purchase_apr,'liability_last_synced_at',a.liability_last_synced_at
  ) order by a.created_at,a.id) from public.plaid_accounts a where a.household_id=p_household_id),'[]'::jsonb);
end;
$$;
create or replace function public.get_household_forecast_accounts(p_household_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
  select private.get_household_forecast_accounts(p_household_id)
$$;
revoke all on function private.get_household_forecast_accounts(uuid) from public,anon,service_role;
revoke all on function public.get_household_forecast_accounts(uuid) from public,anon,service_role;
grant execute on function private.get_household_forecast_accounts(uuid) to authenticated;
grant execute on function public.get_household_forecast_accounts(uuid) to authenticated;

create or replace function private.set_account_forecast_preferences(
  p_household_id uuid, p_account_ref text, p_expected_updated_at timestamptz, p_patch jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  d jsonb; prior public.account_forecast_preferences%rowtype; saved public.account_forecast_preferences%rowtype;
  k text; ref text; apy numeric; floor_amount numeric; same_patch boolean;
begin
  if auth.uid() is null or p_household_id is null or not private.is_household_editor(p_household_id) then
    raise exception 'Household edit access required';
  end if;
  if p_account_ref is null or p_patch is null or jsonb_typeof(p_patch)<>'object' then raise exception 'Choose account planning settings'; end if;
  for k in select jsonb_object_keys(p_patch) loop
    if k not in ('savings_apy','safety_floor') then raise exception 'Unsupported account planning setting'; end if;
  end loop;
  d := private.forecast_account_details(p_household_id,null,p_account_ref); ref := d->>'ref';
  if p_patch ? 'savings_apy' and p_patch->'savings_apy'<>'null'::jsonb then
    if jsonb_typeof(p_patch->'savings_apy')<>'number' then raise exception 'Enter a numeric savings APY'; end if;
    apy := (p_patch->>'savings_apy')::numeric;
    if lower(apy::text) in ('nan','infinity','-infinity') or apy<0 or apy>100 then raise exception 'Savings APY must be between 0 and 100 percent'; end if;
    if d->>'type'<>'savings' then raise exception 'APY is only available for savings accounts'; end if;
  end if;
  if p_patch ? 'safety_floor' and p_patch->'safety_floor'<>'null'::jsonb then
    if jsonb_typeof(p_patch->'safety_floor')<>'number' then raise exception 'Enter a numeric minimum balance'; end if;
    floor_amount := (p_patch->>'safety_floor')::numeric;
    if lower(floor_amount::text) in ('nan','infinity','-infinity') or floor_amount<0 or floor_amount>1000000000 then raise exception 'Choose a valid minimum balance'; end if;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('account-forecast:'||p_household_id::text||':'||(d->>'physical_key'),0));
  select * into prior from public.account_forecast_preferences where household_id=p_household_id and (account_ref=ref or account_ref in(select jsonb_array_elements_text(d->'aliases'))) order by (account_ref=ref) desc,updated_at desc limit 1 for update;
  if prior.account_ref is not null then
    same_patch := (not p_patch ? 'savings_apy' or to_jsonb(prior.savings_apy) is not distinct from nullif(p_patch->'savings_apy','null'::jsonb))
      and (not p_patch ? 'safety_floor' or to_jsonb(prior.safety_floor) is not distinct from nullif(p_patch->'safety_floor','null'::jsonb));
    if same_patch and prior.account_ref=ref then return to_jsonb(prior); end if;
    if p_expected_updated_at is distinct from prior.updated_at then raise exception using errcode='40001',message='Account settings changed. Refresh and try again'; end if;
  elsif p_expected_updated_at is not null then
    raise exception using errcode='40001',message='Account settings changed. Refresh and try again';
  end if;
  if prior.account_ref is not null and prior.account_ref<>ref then
    update public.account_forecast_preferences set account_ref=ref where household_id=p_household_id and account_ref=prior.account_ref;
  end if;
  insert into public.account_forecast_preferences(household_id,account_ref,savings_apy,safety_floor,updated_at)
  values(p_household_id,ref,case when p_patch ? 'savings_apy' then apy else prior.savings_apy end,
    case when p_patch ? 'safety_floor' then floor_amount else prior.safety_floor end,clock_timestamp())
  on conflict(household_id,account_ref) do update set savings_apy=excluded.savings_apy,safety_floor=excluded.safety_floor,updated_at=excluded.updated_at
  returning * into saved;
  return to_jsonb(saved);
end;
$$;
create or replace function public.set_account_forecast_preferences(p_household_id uuid,p_account_ref text,p_expected_updated_at timestamptz,p_patch jsonb)
returns jsonb language sql volatile security invoker set search_path='' as $$
  select private.set_account_forecast_preferences(p_household_id,p_account_ref,p_expected_updated_at,p_patch)
$$;
revoke all on function private.set_account_forecast_preferences(uuid,text,timestamptz,jsonb) from public,anon,service_role;
revoke all on function public.set_account_forecast_preferences(uuid,text,timestamptz,jsonb) from public,anon,service_role;
grant execute on function private.set_account_forecast_preferences(uuid,text,timestamptz,jsonb) to authenticated;
grant execute on function public.set_account_forecast_preferences(uuid,text,timestamptz,jsonb) to authenticated;

create or replace function private.validate_forecast_account_routing()
returns trigger language plpgsql security invoker set search_path='' as $$
declare data jsonb := to_jsonb(new); previous jsonb; k text; d jsonb; patch jsonb := '{}'::jsonb;
  hh uuid; budget uuid; ref text; source text; local_id text; fields text[];
begin
  if tg_op='UPDATE' then previous:=to_jsonb(old); else previous:='{}'::jsonb; end if;
  fields := case tg_table_name when 'incomes' then array['deposit_account_ref']
    when 'transactions' then array['forecast_account_ref']
    when 'goals' then array['funding_account_ref','deposit_account_ref']
    when 'decisions' then array['funding_account_ref','deposit_account_ref']
    else array['funding_account_ref'] end;
  hh := (data->>'household_id')::uuid; budget := (data->>'budget_id')::uuid;
  foreach k in array fields loop
    if (tg_op='INSERT' and data->>k is not null) or (tg_op='UPDATE' and (data->k is distinct from previous->k or (data->>k is not null and (data->'household_id' is distinct from previous->'household_id' or data->'budget_id' is distinct from previous->'budget_id')))) then
      if auth.uid() is null or hh is null or not private.is_household_editor(hh) then raise exception 'Household edit access required'; end if;
      ref := data->>k;
      if tg_table_name='transactions' and coalesce(data->>'source','')='plaid' then raise exception 'A bank transaction keeps its original account'; end if;
      d := private.forecast_account_details(hh,budget,ref,true);
      patch := patch || jsonb_build_object(k,d->>'ref');
    end if;
  end loop;
  if tg_table_name='transactions' and data->>'forecast_account_ref' is not null and (
    tg_op='INSERT' or data->'account_id' is distinct from previous->'account_id' or data->'forecast_account_ref' is distinct from previous->'forecast_account_ref'
  ) then
    local_id := data->>'account_id'; ref := coalesce(patch->>'forecast_account_ref',data->>'forecast_account_ref');
    if local_id is not null then
      d := private.forecast_account_details(hh,budget,'manual:'||local_id,true);
      if ref is not null and ref<>d->>'ref' and ref<>'manual:'||local_id then raise exception 'Transaction accounts do not agree'; end if;
    end if;
  end if;
  if tg_table_name='transactions' and tg_op='UPDATE' and auth.uid() is not null
    and previous->>'source'='plaid'
    and row(data->'plaid_account_id',data->'account_id',data->'forecast_account_ref',data->'source',data->'household_id',data->'budget_id')
      is distinct from row(previous->'plaid_account_id',previous->'account_id',previous->'forecast_account_ref',previous->'source',previous->'household_id',previous->'budget_id') then
    raise exception 'A bank transaction keeps its original account';
  end if;
  if (tg_table_name='decisions' and data->>'decision_type'='savings_contribution')
    or (tg_table_name='goals' and data->>'goal_type'='savings') then
    -- Compare canonical physical identities, including explicit bridges and
    -- persistent reconnect aliases, before any planning row can be saved.
    if data->>'funding_account_ref' is not null and data->>'deposit_account_ref' is not null then
      if (private.forecast_account_details(hh,budget,data->>'funding_account_ref',true))->>'ref'
        = (private.forecast_account_details(hh,budget,data->>'deposit_account_ref',true))->>'ref' then
        raise exception 'Choose two different accounts for the savings contribution';
      end if;
    end if;
  end if;
  if tg_table_name='extra_payments' and data->'sources' is not null and data->'sources'<>'null'::jsonb and (tg_op='INSERT' or data->'sources' is distinct from previous->'sources' or data->'household_id' is distinct from previous->'household_id' or data->'budget_id' is distinct from previous->'budget_id') then
    perform private.forecast_sources_account(hh,budget,data->'sources');
  end if;
  new := jsonb_populate_record(new,patch);
  return new;
end;
$$;
revoke all on function private.validate_forecast_account_routing() from public,anon,authenticated,service_role;
do $$ declare t text; begin
  foreach t in array array['bills','incomes','goals','decisions','extra_payments','transactions'] loop
    execute format('create trigger zzz_validate_forecast_account_routing before insert or update on public.%I for each row execute function private.validate_forecast_account_routing()',t);
  end loop;
end $$;

create or replace function private.set_forecast_account_routing(
  p_household_id uuid,p_budget_id uuid,p_entity_type text,p_entity_id text,p_expected jsonb,p_patch jsonb
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare tab text; allowed text[]; before_row jsonb; after_row jsonb; k text; d jsonb; patch jsonb:='{}'::jsonb; assignments text;
begin
  if auth.uid() is null or p_household_id is null or not private.is_household_editor(p_household_id) then raise exception 'Household edit access required'; end if;
  if p_budget_id is null or not exists(select 1 from public.budgets where id=p_budget_id and household_id=p_household_id) then raise exception 'Choose a budget in this household'; end if;
  if nullif(p_entity_id,'') is null or p_patch is null or jsonb_typeof(p_patch)<>'object' or p_expected is null or jsonb_typeof(p_expected)<>'object' then raise exception 'Choose an account assignment'; end if;
  case p_entity_type
    when 'bill' then tab:='bills';allowed:=array['funding_account_ref'];
    when 'income' then tab:='incomes';allowed:=array['deposit_account_ref'];
    when 'goal' then tab:='goals';allowed:=array['funding_account_ref','deposit_account_ref'];
    when 'decision' then tab:='decisions';allowed:=array['funding_account_ref','deposit_account_ref'];
    when 'extra_payment' then tab:='extra_payments';allowed:=array['funding_account_ref'];
    when 'transaction' then tab:='transactions';allowed:=array['forecast_account_ref'];
    else raise exception 'Choose a valid plan item';
  end case;
  -- The only dynamic identifiers come from the closed case statement above.
  execute format('select to_jsonb(r) from public.%I r where id=$1 and household_id=$2 and budget_id is not distinct from $3 for update',tab)
    into before_row using p_entity_id,p_household_id,p_budget_id;
  if before_row is null then raise exception 'This plan item is unavailable in this household'; end if;
  if p_entity_type='decision' and before_row->>'status'='completed' then raise exception 'A completed decision keeps its account history'; end if;
  if p_entity_type='transaction' and (before_row->>'source'='plaid' or before_row->>'transfer_group_id' is not null
      or before_row->>'linked_plan_id' is not null or before_row->>'review_status'='matched'
      or jsonb_array_length(coalesce(nullif(before_row->'review_allocations','null'::jsonb),'[]'::jsonb))>0) then
    raise exception 'Use the transaction or transfer editor for this payment';
  end if;
  for k in select jsonb_object_keys(p_patch) loop
    if not k=any(allowed) or not p_expected ? k then raise exception 'Unsupported or missing expected account field'; end if;
    d:=private.forecast_account_details(p_household_id,p_budget_id,p_patch->>k);
    patch:=patch||jsonb_build_object(k,d->>'ref');
    if before_row->k is distinct from p_expected->k and before_row->k is distinct from patch->k then
      raise exception using errcode='40001',message='The account assignment changed. Refresh and try again';
    end if;
  end loop;
  if p_entity_type='transaction' and p_patch ? 'forecast_account_ref' then
    if not p_expected ? 'account_id' then raise exception 'The existing transaction account is required'; end if;
    d:=private.forecast_account_details(p_household_id,p_budget_id,p_patch->>'forecast_account_ref');
    patch:=patch||jsonb_build_object('account_id',case when p_patch->>'forecast_account_ref' like 'manual:%' then substring(p_patch->>'forecast_account_ref' from 8) else null end);
    if before_row->'account_id' is distinct from p_expected->'account_id' and before_row->'account_id' is distinct from patch->'account_id' then
      raise exception using errcode='40001',message='The transaction account changed. Refresh and try again';
    end if;
  end if;
  if patch='{}'::jsonb then return jsonb_build_object('entity_type',p_entity_type,'row',before_row); end if;
  select string_agg(format('%I=(jsonb_populate_record(null::public.%I,$1)).%I',key,tab,key),',') into assignments from jsonb_object_keys(patch) key;
  execute format('update public.%I set %s where id=$2 and household_id=$3 and budget_id is not distinct from $4 returning to_jsonb(%I)',tab,assignments,tab)
    into after_row using patch,p_entity_id,p_household_id,p_budget_id;
  return jsonb_build_object('entity_type',p_entity_type,'row',after_row);
end;
$$;
create or replace function public.set_forecast_account_routing(p_household_id uuid,p_budget_id uuid,p_entity_type text,p_entity_id text,p_expected jsonb,p_patch jsonb)
returns jsonb language sql volatile security invoker set search_path='' as $$
  select private.set_forecast_account_routing(p_household_id,p_budget_id,p_entity_type,p_entity_id,p_expected,p_patch)
$$;
revoke all on function private.set_forecast_account_routing(uuid,uuid,text,text,jsonb,jsonb) from public,anon,service_role;
revoke all on function public.set_forecast_account_routing(uuid,uuid,text,text,jsonb,jsonb) from public,anon,service_role;
grant execute on function private.set_forecast_account_routing(uuid,uuid,text,text,jsonb,jsonb) to authenticated;
grant execute on function public.set_forecast_account_routing(uuid,uuid,text,text,jsonb,jsonb) to authenticated;


-- Source budget IDs are never interpreted as cash accounts. Only explicit,
-- scoped accountRef values may supply the funding account for a saved extra.
create or replace function private.forecast_sources_account(p_household_id uuid,p_budget_id uuid,p_sources jsonb)
returns text language plpgsql volatile security invoker set search_path='' as $$
declare item jsonb; d jsonb; ref text; candidate text; all_assigned boolean:=true; positives integer:=0; amount numeric;
begin
 if p_sources is null then return null; end if;
 if jsonb_typeof(p_sources)<>'array' then raise exception 'Payment sources must be a list'; end if;
 for item in select value from jsonb_array_elements(p_sources) loop
  if jsonb_typeof(item)<>'object' then raise exception 'Invalid payment source'; end if;
  if item ? 'accountRef' and item ? 'fundingAccountRef' and item->'accountRef' is distinct from item->'fundingAccountRef' then raise exception 'Payment source accounts do not agree'; end if;
  ref:=coalesce(item->>'accountRef',item->>'fundingAccountRef');
  if ref is not null then d:=private.forecast_account_details(p_household_id,p_budget_id,ref,true); else d:=null; end if;
  amount:=coalesce((item->>'amount')::numeric,0);
  if lower(amount::text) in ('nan','infinity','-infinity') then raise exception 'Payment source amount must be finite'; end if;
  if amount>0 then
   positives:=positives+1;
   if d is null then all_assigned:=false;
   elsif candidate is null then candidate:=d->>'ref';
   elsif candidate<>d->>'ref' then all_assigned:=false;
   end if;
  end if;
 end loop;
 return case when positives>0 and all_assigned then candidate else null end;
end;
$$;
revoke all on function private.forecast_sources_account(uuid,uuid,jsonb) from public,anon,service_role;
grant execute on function private.forecast_sources_account(uuid,uuid,jsonb) to authenticated;

-- Posted Activity carries the provider account ID, while pending records carry
-- the row UUID. Never compare the two namespaces or guess from a name/mask.
create or replace function private.forecast_posted_cash_account(p_household_id uuid,p_provider_account_id text)
returns boolean language plpgsql volatile security invoker set search_path='' as $$
declare bank_id uuid; n integer;
begin
 if auth.uid() is null or p_household_id is null or not private.is_household_member(p_household_id) then raise exception 'Household access required'; end if;
 select count(distinct case when nullif(btrim(persistent_account_id),'') is not null then 'persistent:'||persistent_account_id else 'row:'||id::text end),(array_agg(id order by is_active desc,updated_at desc nulls last,id))[1] into n,bank_id from public.plaid_accounts where household_id=p_household_id and plaid_account_id=p_provider_account_id;
 if n<>1 then return false; end if;
 perform private.forecast_account_details(p_household_id,null,'bank:'||bank_id::text);
 return true;
end;
$$;
revoke all on function private.forecast_posted_cash_account(uuid,text) from public,anon,service_role;
grant execute on function private.forecast_posted_cash_account(uuid,text) to authenticated;


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
      'smart_priority', 'include_in_snowball', 'debt_payment_pauses', 'funding_account_ref'
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
 if tg_op='UPDATE' and row(new.amount,new.date,new.account_id,new.forecast_account_ref,new.plaid_account_id,new.source,new.household_id,new.budget_id) is distinct from row(old.amount,old.date,old.account_id,old.forecast_account_ref,old.plaid_account_id,old.source,old.household_id,old.budget_id)
  and (old.linked_income_id is not null or old.linked_plan_id is not null
   or ((old.source='plaid' or old.import_hash is not null or old.review_status='matched')
    and (old.linked_bill_id is not null or old.debt_applied_bill_id is not null or coalesce(old.debt_applied_amount,0)<>0))
   or coalesce(old.review_resolution,'category') not in('category','transfer')
   or private.has_financial_transaction_reconciliation(old.id,old.household_id)
   or exists(select 1 from jsonb_array_elements(old.review_allocations) a where coalesce(a->>'type','') not in('category','transfer'))) then
  raise exception 'Undo this transaction match before changing its amount, date or account';
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
  and row(new.amount,new.date,new.account_id,new.forecast_account_ref,new.plaid_account_id,new.deleted_at,new.removed_at,new.source,new.household_id,new.budget_id)
    is distinct from row(old.amount,old.date,old.account_id,old.forecast_account_ref,old.plaid_account_id,old.deleted_at,old.removed_at,old.source,old.household_id,old.budget_id) then
  raise exception 'Use the bucket purchase action to update or remove this allocated transaction';
 end if;
 return new;
end;
$function$
;

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
  insert into public.transactions(id,user_id,household_id,budget_id,date,amount,category,note,account_id,forecast_account_ref,source,review_status)
   values(p_transaction_id,actor,g.household_id,g.budget_id,p_expected_date::text,-p_expected_amount,p_new_transaction->>'category',coalesce(p_new_transaction->>'note',''),account,p_new_transaction->>'forecast_account_ref','manual','legacy_reviewed') returning * into t;
  created:=true;
 elsif p_new_transaction is not null then
  raise exception 'That purchase id is already in use';
 end if;
 if t.household_id is distinct from g.household_id or t.budget_id is distinct from g.budget_id then raise exception 'Choose a transaction from this household plan'; end if;
 if t.pending is true or t.removed_at is not null or t.deleted_at is not null or t.amount>=0 or t.transfer_group_id is not null or t.category='Transfer'
  or t.linked_bill_id is not null or t.linked_income_id is not null or t.linked_plan_id is not null or t.debt_applied_bill_id is not null or coalesce(t.debt_applied_amount,0)<>0
  or t.review_status in ('matched','transfer') or (t.source is not null and t.source not in ('manual','plaid','statement')) then raise exception 'This transaction is already assigned or cannot be used as a purchase'; end if;
 if r.transaction_id is not null and r.resolution<>'category' then raise exception 'Undo the existing transaction match before using this bucket'; end if;
 if t.source='plaid' and not private.forecast_posted_cash_account(g.household_id,t.plaid_account_id) then raise exception 'Choose a posted checking or savings transaction'; end if;
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
 if t.amount=-actual and t.date=p_transaction->>'date' and t.category=p_transaction->>'category' and t.note=coalesce(p_transaction->>'note','') and t.account_id is not distinct from account and t.forecast_account_ref is not distinct from p_transaction->>'forecast_account_ref' then
  return jsonb_build_object('transaction',to_jsonb(t),'goal',to_jsonb(g),'retry',true);
 end if;
 if t.amount is distinct from p_expected_amount then raise exception 'The purchase changed on another device. Refresh and try again'; end if;
 select coalesce(sum((x->>'amount')::numeric),0) into old_applied from jsonb_array_elements(r.allocations) x where x->>'type'='planned_expense' and x->>'source'='goal' and x->>'targetId'=g.id;
 if abs(old_applied-abs(t.amount))>0.005 then raise exception 'Remove this split purchase from the bucket before editing its amount'; end if;
 if actual>old_applied+0.005 and actual>g.target_amount-g.current_amount+old_applied+0.005 then raise exception 'The purchase exceeds the bucket budget. Adjust the budget first'; end if;
 allocations:=jsonb_build_array(jsonb_build_object('type','planned_expense','source','goal','targetId',g.id,'name',g.name,'amount',actual,'plannedAmount',actual,'occurrenceDate',p_transaction->>'date','settlement','partial'));
 update public.transaction_reconciliations set allocations=allocations,planned_amount=actual,settlement='partial',occurrence_date=(p_transaction->>'date')::date,updated_at=now() where transaction_id=t.id;
 update public.transactions set amount=-actual,date=p_transaction->>'date',category=p_transaction->>'category',note=coalesce(p_transaction->>'note',''),account_id=account,forecast_account_ref=p_transaction->>'forecast_account_ref',review_allocations=allocations,matched_occurrence_date=(p_transaction->>'date')::date,user_edited_at=now() where id=t.id returning * into t;
 select * into g from public.goals where id=p_bucket_id;
 return jsonb_build_object('transaction',to_jsonb(t),'goal',to_jsonb(g),'retry',false);
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
 if not private.forecast_posted_cash_account(b.household_id,b.plaid_account_id) then raise exception 'Choose a posted checking or savings transaction'; end if;
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

  if not private.forecast_posted_cash_account(v_tx.household_id,v_tx.plaid_account_id) then raise exception 'Choose a posted checking or savings transaction'; end if;

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

-- New names keep old clients/signatures unambiguous while one user Save stays
-- atomic across financial edits and the accompanying account assignment.
create or replace function private.update_bucket_budget_with_account(
 p_bucket_id text,p_name text,p_target_amount numeric,p_target_date date,p_expected jsonb,p_account_patch jsonb default '{}'
) returns jsonb language plpgsql security definer set search_path='' as $$
declare g public.goals%rowtype; result jsonb; routed jsonb;
begin
 select * into g from public.goals where id=p_bucket_id for update;
 if not found or auth.uid() is null or g.household_id is null or not private.is_household_editor(g.household_id) then raise exception 'Household edit access required'; end if;
 if p_account_patch is null or jsonb_typeof(p_account_patch)<>'object' then raise exception 'Invalid bucket account assignment'; end if;
 result:=private.update_bucket_budget(p_bucket_id,p_name,p_target_amount,p_target_date,p_expected);
 if p_account_patch<>'{}'::jsonb then
  routed:=private.set_forecast_account_routing(g.household_id,g.budget_id,'goal',g.id,p_expected,p_account_patch);
  result:=result||jsonb_build_object('goal',routed->'row');
 end if;
 return result;
end;
$$;
create or replace function public.update_bucket_budget_with_account(p_bucket_id text,p_name text,p_target_amount numeric,p_target_date date,p_expected jsonb,p_account_patch jsonb default '{}')
returns jsonb language sql volatile security invoker set search_path='' as $$
 select private.update_bucket_budget_with_account(p_bucket_id,p_name,p_target_amount,p_target_date,p_expected,p_account_patch)
$$;
revoke all on function private.update_bucket_budget_with_account(text,text,numeric,date,jsonb,jsonb) from public,anon,service_role;
revoke all on function public.update_bucket_budget_with_account(text,text,numeric,date,jsonb,jsonb) from public,anon,service_role;
grant execute on function private.update_bucket_budget_with_account(text,text,numeric,date,jsonb,jsonb) to authenticated;
grant execute on function public.update_bucket_budget_with_account(text,text,numeric,date,jsonb,jsonb) to authenticated;

create or replace function private.create_pending_activity_transaction_with_account(
 p_pending_plaid_transaction_id text,p_transaction_id text,p_household_id uuid,p_budget_id uuid,p_amount numeric,p_date date,p_category text,p_note text,p_account_id text default null,p_forecast_account_ref text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare d jsonb; local_details jsonb; result jsonb; prior public.transactions%rowtype; saved public.transactions%rowtype; ref text;
begin
 if auth.uid() is null or p_household_id is null or not private.is_household_editor(p_household_id) then raise exception 'Household edit access required'; end if;
 d:=private.forecast_account_details(p_household_id,p_budget_id,p_forecast_account_ref); ref:=d->>'ref';
 if p_account_id is not null then
  local_details:=private.forecast_account_details(p_household_id,p_budget_id,'manual:'||p_account_id);
  if ref is not null and ref<>local_details->>'ref' then raise exception 'Transaction accounts do not agree'; end if;
 end if;
 select * into prior from public.transactions where id=p_transaction_id for update;
 if found and prior.forecast_account_ref is not null and prior.forecast_account_ref is distinct from ref then raise exception 'That transaction id has a different account'; end if;
 result:=private.create_pending_activity_transaction(p_pending_plaid_transaction_id,p_transaction_id,p_household_id,p_budget_id,p_amount,p_date,p_category,p_note,p_account_id);
 update public.transactions set forecast_account_ref=ref where id=p_transaction_id returning * into saved;
 return result||jsonb_build_object('transaction',to_jsonb(saved));
end;
$$;
create or replace function public.create_pending_activity_transaction_with_account(
 p_pending_plaid_transaction_id text,p_transaction_id text,p_household_id uuid,p_budget_id uuid,p_amount numeric,p_date date,p_category text,p_note text,p_account_id text default null,p_forecast_account_ref text default null
) returns jsonb language sql volatile security invoker set search_path='' as $$
 select private.create_pending_activity_transaction_with_account(p_pending_plaid_transaction_id,p_transaction_id,p_household_id,p_budget_id,p_amount,p_date,p_category,p_note,p_account_id,p_forecast_account_ref)
$$;
revoke all on function private.create_pending_activity_transaction_with_account(text,text,uuid,uuid,numeric,date,text,text,text,text) from public,anon,service_role;
revoke all on function public.create_pending_activity_transaction_with_account(text,text,uuid,uuid,numeric,date,text,text,text,text) from public,anon,service_role;
grant execute on function private.create_pending_activity_transaction_with_account(text,text,uuid,uuid,numeric,date,text,text,text,text) to authenticated;
grant execute on function public.create_pending_activity_transaction_with_account(text,text,uuid,uuid,numeric,date,text,text,text,text) to authenticated;


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
  v_route text; v_local text; v_details jsonb;
  v_deposit text; v_deposit_local text; v_deposit_id text; v_group_id text; v_incoming public.transactions%rowtype;
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

  v_route:=v_goal.funding_account_ref; v_local:=p_account_id;
  if v_route is not null then
    v_details:=private.forecast_account_details(v_goal.household_id,v_goal.budget_id,v_route);
    v_route:=v_details->>'ref';
    if p_account_id is not null and (private.forecast_account_details(v_goal.household_id,v_goal.budget_id,'manual:'||p_account_id))->>'ref'<>v_route then raise exception 'The contribution account does not match the saved goal'; end if;
    if v_local is null and v_goal.funding_account_ref like 'manual:%' then v_local:=substring(v_goal.funding_account_ref from 8); end if;
  end if;

  v_deposit:=v_goal.deposit_account_ref;
  if v_deposit is not null then
    v_deposit:=(private.forecast_account_details(v_goal.household_id,v_goal.budget_id,v_deposit))->>'ref';
    v_deposit_local:=case when v_goal.deposit_account_ref like 'manual:%' then substring(v_goal.deposit_account_ref from 8) else null end;
  end if;
  if v_route is not null and v_deposit is not null then
    if v_route=v_deposit then raise exception 'Choose two different accounts for the savings contribution'; end if;
    v_deposit_id:='goal-'||md5(p_transaction_id||':deposit-transaction');
    v_group_id:='goal-'||md5(v_goal.id||':'||p_transaction_id||':savings-transfer');
  end if;

  select * into v_existing from public.transactions
  where id = p_transaction_id for update;
  if found then
    if v_existing.household_id = v_goal.household_id
      and v_existing.linked_plan_type = 'goal'
      and v_existing.linked_plan_id = v_goal.id
      and v_existing.date::date = p_date
      and abs(v_existing.amount + v_applied) < 0.005
      and v_existing.account_id is not distinct from v_local
      and v_existing.forecast_account_ref is not distinct from v_route
      and v_existing.source = 'manual'
      and ((v_group_id is null and v_existing.category='Savings' and v_existing.transfer_group_id is null)
        or (v_group_id is not null and v_existing.category='Transfer' and v_existing.transfer_group_id=v_group_id))
      and v_existing.deleted_at is null and v_existing.removed_at is null
      and v_goal.current_amount + 0.005 >=
        round(p_expected_current_amount + v_applied, 2) then
      if v_group_id is not null then
        select * into v_incoming from public.transactions where id=v_deposit_id for update;
        if not found or v_incoming.household_id is distinct from v_goal.household_id or v_incoming.budget_id is distinct from v_goal.budget_id
          or v_incoming.linked_plan_type is distinct from 'goal' or v_incoming.linked_plan_id is distinct from v_goal.id
          or v_incoming.transfer_group_id is distinct from v_group_id or v_incoming.category is distinct from 'Transfer' or v_incoming.source is distinct from 'manual'
          or v_incoming.amount is distinct from v_applied or v_incoming.date::date is distinct from p_date
          or v_incoming.account_id is distinct from v_deposit_local or v_incoming.forecast_account_ref is distinct from v_deposit
          or v_incoming.deleted_at is not null or v_incoming.removed_at is not null then
          raise exception 'That contribution no longer has its original two account movements';
        end if;
      end if;
      return jsonb_build_object(
        'goal_id', v_goal.id,
        'transaction_id', v_existing.id,
        'deposit_transaction_id',v_deposit_id,'transfer_group_id',v_group_id,
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
  if v_group_id is not null then
    insert into public.transactions (
      id,user_id,household_id,budget_id,date,amount,category,note,
      account_id,forecast_account_ref,source,linked_plan_id,linked_plan_type,transfer_group_id,review_status
    ) values (
      p_transaction_id,v_actor,v_goal.household_id,v_goal.budget_id,p_date::text,-v_applied,'Transfer',
      'Goal funding: '||v_goal.name,v_local,v_route,'manual',v_goal.id,'goal',v_group_id,'legacy_reviewed'
    ),(
      v_deposit_id,v_actor,v_goal.household_id,v_goal.budget_id,p_date::text,v_applied,'Transfer',
      'Goal funding: '||v_goal.name,v_deposit_local,v_deposit,'manual',v_goal.id,'goal',v_group_id,'legacy_reviewed'
    );
  else
  insert into public.transactions (
    id, user_id, household_id, budget_id, date, amount, category, note,
    account_id, forecast_account_ref, source, linked_plan_id, linked_plan_type
  ) values (
    p_transaction_id, v_actor, v_goal.household_id, v_goal.budget_id,
    p_date::text, -v_applied, 'Savings',
    'Goal funding: ' || v_goal.name, v_local, v_route, 'manual',
    v_goal.id, 'goal'
  );
  end if;

  return jsonb_build_object(
    'goal_id', v_goal.id,
    'transaction_id', p_transaction_id,
    'deposit_transaction_id',v_deposit_id,'transfer_group_id',v_group_id,
    'current_amount', v_next,
    'applied_amount', v_applied,
    'retry', false
  );
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
  v_route text; v_deposit text; v_local text; v_details jsonb;
  v_deposit_transaction_id text; v_transfer_group_id text; v_deposit_local text;
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

  if v_decision.funding_account_ref is not null or v_decision.deposit_account_ref is not null then
    v_request_fingerprint:=md5(v_request_fingerprint||'|'||coalesce(v_decision.funding_account_ref,'')||'|'||coalesce(v_decision.deposit_account_ref,''));
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
  v_route:=v_decision.funding_account_ref; v_deposit:=v_decision.deposit_account_ref; v_local:=p_account_id;
  if v_route is not null then
    v_details:=private.forecast_account_details(v_decision.household_id,v_decision.budget_id,v_route); v_route:=v_details->>'ref';
    if p_account_id is not null and (private.forecast_account_details(v_decision.household_id,v_decision.budget_id,'manual:'||p_account_id))->>'ref'<>v_route then raise exception 'The payment account does not match the saved decision'; end if;
    if v_local is null and v_decision.funding_account_ref like 'manual:%' then v_local:=substring(v_decision.funding_account_ref from 8); end if;
  end if;
  if v_deposit is not null then
    v_deposit:=(private.forecast_account_details(v_decision.household_id,v_decision.budget_id,v_deposit))->>'ref';
    if v_decision.decision_type='income_change' and p_account_id is not null and (private.forecast_account_details(v_decision.household_id,v_decision.budget_id,'manual:'||p_account_id))->>'ref'<>v_deposit then raise exception 'The deposit account does not match the saved decision'; end if;
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
        account_id, forecast_account_ref, source, linked_plan_id, linked_plan_type
      ) values (
        v_transaction_id, v_actor, v_decision.household_id, v_decision.budget_id,
        p_completed_date::text, -round(p_actual_amount, 2), 'Other', v_name,
        v_local, v_route, 'manual', v_decision.id, 'decision'
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
    if v_route is not null and v_deposit is not null then
      if v_route=v_deposit then raise exception 'Choose two different accounts for the savings contribution'; end if;
      v_deposit_transaction_id:='decision-'||md5(v_decision.id||':deposit-transaction');
      v_transfer_group_id:='decision-'||md5(v_decision.id||':savings-transfer');
      v_deposit_local:=case when v_decision.deposit_account_ref like 'manual:%' then substring(v_decision.deposit_account_ref from 8) else null end;
      -- This is an explicit movement of existing cash, separate from the goal
      -- milestone. Insert both legs in this transaction or roll everything back.
      insert into public.transactions (
        id,user_id,household_id,budget_id,date,amount,category,note,
        account_id,forecast_account_ref,source,linked_plan_id,linked_plan_type,
        transfer_group_id,review_status
      ) values (
        v_transaction_id,v_actor,v_decision.household_id,v_decision.budget_id,
        p_completed_date::text,-round(p_actual_amount,2),'Transfer',v_name,
        v_local,v_route,'manual',v_decision.id,'decision',v_transfer_group_id,'legacy_reviewed'
      ),(
        v_deposit_transaction_id,v_actor,v_decision.household_id,v_decision.budget_id,
        p_completed_date::text,round(p_actual_amount,2),'Transfer',v_name,
        v_deposit_local,v_deposit,'manual',v_decision.id,'decision',v_transfer_group_id,'legacy_reviewed'
      );
      v_applied:=jsonb_build_object('kind','goal_contribution','goalId',v_goal.id,
        'transactionId',v_transaction_id,'depositTransactionId',v_deposit_transaction_id,
        'transferGroupId',v_transfer_group_id);
    else
      -- Unassigned legacy contributions retain their existing single expense;
      -- a destination is never inferred from the goal name or its progress.
      insert into public.transactions (
        id,user_id,household_id,budget_id,date,amount,category,note,
        account_id,forecast_account_ref,source,linked_plan_id,linked_plan_type
      ) values (
        v_transaction_id,v_actor,v_decision.household_id,v_decision.budget_id,
        p_completed_date::text,-round(p_actual_amount,2),'Savings',v_name,
        v_local,v_route,'manual',v_decision.id,'decision'
      );
      v_applied:=jsonb_build_object('kind','goal_contribution','goalId',v_goal.id,'transactionId',v_transaction_id);
    end if;
  elsif v_kind = 'recurring_bill' then
    if round(p_actual_amount, 2) <= 0 then raise exception 'Enter a positive recurring bill amount'; end if;
    if v_frequency not in ('weekly', 'biweekly', 'monthly') then
      raise exception 'Recurring decision frequency is invalid';
    end if;
    v_transaction_id := 'decision-' || md5(v_decision.id || ':transaction');
    insert into public.transactions (
      id, user_id, household_id, budget_id, date, amount, category, note,
      account_id, forecast_account_ref, source, linked_plan_id, linked_plan_type
    ) values (
      v_transaction_id, v_actor, v_decision.household_id, v_decision.budget_id,
      p_completed_date::text, -round(p_actual_amount, 2), 'Other', v_name,
      v_local, v_route, 'manual', v_decision.id, 'decision'
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
      include_in_snowball, funding_account_ref, created_at
    ) values (
      v_bill_id, v_actor, v_decision.household_id, v_decision.budget_id,
      v_name, round(p_actual_amount, 2), 'Other',
      (select coalesce(max(priority), 0) + 1 from public.bills
        where household_id = v_decision.household_id),
      false, 0, 0, extract(day from v_next_date)::integer,
      v_next_date::text, v_next_date::text, true, v_frequency,
      'must', false, v_route, v_now::text
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
        deposit_account_ref = coalesce(v_deposit,deposit_account_ref),
        last_reviewed_at = v_now
      where id = v_income.id;
      v_applied := jsonb_build_object('kind', 'income_update', 'incomeId', v_income.id);
    else
      v_income_id := 'decision-' || md5(v_decision.id || ':income');
      insert into public.incomes (
        id, user_id, household_id, budget_id, name, amount, frequency,
        start_date, next_payment_date, amount_history, last_reviewed_at, deposit_account_ref
      ) values (
        v_income_id, v_actor, v_decision.household_id, v_decision.budget_id,
        v_name, round(p_actual_amount, 2), v_frequency,
        p_completed_date::text,
        case when v_frequency = 'monthly' then null else p_completed_date::text end,
        jsonb_build_array(jsonb_build_object(
          'effective_from', to_char(p_completed_date, 'YYYY-MM'),
          'amount', round(p_actual_amount, 2)
        )), v_now, v_deposit
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
      if v_route is not null then
        update public.extra_payments set funding_account_ref=v_route where id=v_payment_id and household_id=v_decision.household_id;
        if not found then raise exception 'The debt payment account could not be assigned'; end if;
      end if;
      v_applied := jsonb_build_object('kind', 'debt', 'paymentId', v_payment_id);
    else
      v_transaction_id := 'decision-' || md5(v_decision.id || ':transaction');
      insert into public.transactions (
        id, user_id, household_id, budget_id, date, amount, category, note,
        account_id, forecast_account_ref, source, linked_plan_id, linked_plan_type
      ) values (
        v_transaction_id, v_actor, v_decision.household_id, v_decision.budget_id,
        p_completed_date::text, -round(p_actual_amount, 2), 'Debt', v_name,
        v_local, v_route, 'manual', v_decision.id, 'decision'
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
    'accountId', v_local, 'fundingAccountRef',v_route,'depositAccountRef',v_deposit
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

CREATE OR REPLACE FUNCTION private.mutate_transfer(p_household_id uuid, p_budget_id uuid, p_group_id text, p_from_id text, p_to_id text, p_expected jsonb, p_payload jsonb, p_action text DEFAULT 'save'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_variable
declare
 rows public.transactions[]; t public.transactions%rowtype; outgoing public.transactions%rowtype; incoming public.transactions%rowtype;
 old_pair jsonb; desired_pair jsonb; result jsonb; amount numeric; transfer_date date; from_account text; to_account text; from_note text; to_note text; n integer; from_ref text; to_ref text; from_details jsonb; to_details jsonb; expected_pair jsonb;
begin
 if p_action is null or p_action not in('save','delete','restore') then raise exception 'Choose a transfer action'; end if;
 if auth.uid() is null or p_household_id is null or not private.is_household_editor(p_household_id) then raise exception 'Household edit access is required'; end if;
 if p_budget_id is null or not exists(select 1 from public.budgets where id=p_budget_id and household_id=p_household_id) then raise exception 'Choose a budget in this household'; end if;
 if nullif(btrim(p_group_id),'') is null or length(p_group_id)>200 or nullif(btrim(p_from_id),'') is null or nullif(btrim(p_to_id),'') is null or p_from_id=p_to_id then raise exception 'A stable transfer pair is required'; end if;
 if p_expected is not null and jsonb_typeof(p_expected)<>'array' then raise exception 'Invalid transfer revision'; end if;
 select jsonb_agg(case when e ? 'forecast_account_ref' then e else e||jsonb_build_object('forecast_account_ref',null) end order by ord) into expected_pair from jsonb_array_elements(p_expected) with ordinality q(e,ord);
 perform pg_advisory_xact_lock(hashtextextended('transfer:'||p_group_id,0));
 select array_agg(q order by q.id) into rows from (select * from public.transactions where transfer_group_id=p_group_id or id in(p_from_id,p_to_id) order by id for update) q;
 n:=coalesce(array_length(rows,1),0);
 if n<>0 and n<>2 then raise exception 'This transfer no longer has exactly two legs. Refresh before editing'; end if;
 if n=2 then
  foreach t in array rows loop
   if t.household_id is distinct from p_household_id or t.budget_id is distinct from p_budget_id or t.transfer_group_id is distinct from p_group_id or t.id not in(p_from_id,p_to_id)
    or t.removed_at is not null or t.pending is true or t.source is not null and t.source<>'manual' or t.import_hash is not null or t.plaid_account_id is not null
    or t.category<>'Transfer' or t.linked_bill_id is not null or t.linked_income_id is not null or t.linked_plan_id is not null or t.debt_applied_bill_id is not null or coalesce(t.debt_applied_amount,0)<>0
    or exists(select 1 from public.transaction_reconciliations where transaction_id=t.id) then raise exception 'This pair cannot be changed as a manual transfer'; end if;
   if t.id=p_from_id then outgoing:=t; else incoming:=t; end if;
  end loop;
  if outgoing.amount>=0 or incoming.amount<=0 or outgoing.amount<>-incoming.amount or outgoing.date<>incoming.date or coalesce(outgoing.forecast_account_ref,'manual:'||outgoing.account_id) is null or coalesce(incoming.forecast_account_ref,'manual:'||incoming.account_id) is null or coalesce(outgoing.forecast_account_ref,'manual:'||outgoing.account_id)=coalesce(incoming.forecast_account_ref,'manual:'||incoming.account_id) then raise exception 'Transfer legs are inconsistent. Refresh before editing'; end if;
  old_pair:=jsonb_build_array(jsonb_build_object('id',outgoing.id,'amount',outgoing.amount,'date',outgoing.date,'account_id',outgoing.account_id,'forecast_account_ref',outgoing.forecast_account_ref,'note',outgoing.note,'category',outgoing.category),jsonb_build_object('id',incoming.id,'amount',incoming.amount,'date',incoming.date,'account_id',incoming.account_id,'forecast_account_ref',incoming.forecast_account_ref,'note',incoming.note,'category',incoming.category));
  if p_action='delete' and outgoing.deleted_at is not null and incoming.deleted_at is not null then return jsonb_build_object('transactions',to_jsonb(rows),'retry',true); end if;
  if p_action='restore' then
   if expected_pair is distinct from old_pair then raise exception 'This transfer changed before restore'; end if;
   if (outgoing.deleted_at is null)<>(incoming.deleted_at is null) then raise exception 'Transfer deletion state is inconsistent'; end if;
   from_details:=private.forecast_account_details(p_household_id,p_budget_id,coalesce(outgoing.forecast_account_ref,'manual:'||outgoing.account_id));
   to_details:=private.forecast_account_details(p_household_id,p_budget_id,coalesce(incoming.forecast_account_ref,'manual:'||incoming.account_id));
   if from_details is null or to_details is null or from_details->>'ref'=to_details->>'ref' then raise exception 'Restore requires two different active household accounts'; end if;
   update public.transactions set deleted_at=null,deleted_by=null where id in(p_from_id,p_to_id);
   select jsonb_agg(x order by x.id) into result from public.transactions x where id in(p_from_id,p_to_id);
   return jsonb_build_object('transactions',result,'retry',outgoing.deleted_at is null);
  end if;
  if outgoing.deleted_at is not null or incoming.deleted_at is not null then raise exception 'This transfer was deleted. Refresh before editing'; end if;
 elsif p_action in('delete','restore') or p_expected is not null then raise exception 'Transfer not found';
 end if;
 if p_action='delete' then
  if expected_pair is distinct from old_pair then raise exception 'This transfer changed on another device. Refresh before deleting'; end if;
  update public.transactions set deleted_at=now(),deleted_by=auth.uid() where id in(p_from_id,p_to_id);
 else
  amount:=(p_payload->>'amount')::numeric; transfer_date:=(p_payload->>'date')::date;
  from_account:=p_payload->>'fromAccountId'; to_account:=p_payload->>'toAccountId'; from_note:=coalesce(p_payload->>'fromNote',''); to_note:=coalesce(p_payload->>'toNote','');
  if amount is null or lower(amount::text) in('nan','infinity','-infinity') or amount<=0 or amount>1000000000 or round(amount,2)<>amount or transfer_date is null or length(from_note)>2000 or length(to_note)>2000 then raise exception 'Choose a valid transfer amount, date and description'; end if;
  from_ref:=p_payload->>'fromAccountRef'; to_ref:=p_payload->>'toAccountRef';
  from_details:=private.forecast_account_details(p_household_id,p_budget_id,coalesce(from_ref,'manual:'||from_account));
  to_details:=private.forecast_account_details(p_household_id,p_budget_id,coalesce(to_ref,'manual:'||to_account));
  if from_details is null or to_details is null or from_details->>'ref'=to_details->>'ref' then raise exception 'Choose two different active accounts'; end if;
  if from_ref is not null then
   if from_account is not null and from_ref like 'bank:%' then raise exception 'A bank reference cannot be used as a local account id'; end if;
   if from_account is not null and from_ref<>'manual:'||from_account then raise exception 'Transfer source accounts do not agree'; end if;
   from_account:=case when from_ref like 'manual:%' then substring(from_ref from 8) else null end;
   from_ref:=from_details->>'ref';
  end if;
  if to_ref is not null then
   if to_account is not null and to_ref like 'bank:%' then raise exception 'A bank reference cannot be used as a local account id'; end if;
   if to_account is not null and to_ref<>'manual:'||to_account then raise exception 'Transfer destination accounts do not agree'; end if;
   to_account:=case when to_ref like 'manual:%' then substring(to_ref from 8) else null end;
   to_ref:=to_details->>'ref';
  end if;
  desired_pair:=jsonb_build_array(jsonb_build_object('id',p_from_id,'amount',-amount,'date',transfer_date::text,'account_id',from_account,'forecast_account_ref',from_ref,'note',from_note,'category','Transfer'),jsonb_build_object('id',p_to_id,'amount',amount,'date',transfer_date::text,'account_id',to_account,'forecast_account_ref',to_ref,'note',to_note,'category','Transfer'));
  if old_pair=desired_pair then return jsonb_build_object('transactions',to_jsonb(rows),'retry',true); end if;
  if old_pair is not null then
   if expected_pair is distinct from old_pair then raise exception 'This transfer changed on another device. Refresh before editing'; end if;
   update public.transactions set amount=case when id=p_from_id then -amount else amount end,date=transfer_date::text,account_id=case when id=p_from_id then from_account else to_account end,forecast_account_ref=case when id=p_from_id then from_ref else to_ref end,note=case when id=p_from_id then from_note else to_note end,user_edited_at=now() where id in(p_from_id,p_to_id);
  else
   if p_expected is not null then raise exception 'Transfer not found'; end if;
   insert into public.transactions(id,user_id,household_id,budget_id,amount,date,account_id,forecast_account_ref,category,note,source,transfer_group_id,review_status)
    values(p_from_id,auth.uid(),p_household_id,p_budget_id,-amount,transfer_date::text,from_account,from_ref,'Transfer',from_note,'manual',p_group_id,'legacy_reviewed'),
          (p_to_id,auth.uid(),p_household_id,p_budget_id,amount,transfer_date::text,to_account,to_ref,'Transfer',to_note,'manual',p_group_id,'legacy_reviewed');
  end if;
 end if;
 select jsonb_agg(x order by x.id) into result from public.transactions x where id in(p_from_id,p_to_id);
 return jsonb_build_object('transactions',result,'retry',false);
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
  v_account_ref text; v_explicit_account boolean:=false;
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

  v_explicit_account:=exists(select 1 from jsonb_array_elements(v_plan_sources) s where s ? 'accountRef' or s ? 'fundingAccountRef');
  if v_explicit_account then v_account_ref:=private.forecast_sources_account(p_household_id,v_budget_id,v_plan_sources); end if;

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
      amount, allocations, payment_date, sources, funding_account_ref
    )
    values (
      v_payment_id, v_user_id, p_household_id, v_budget_id, p_month, p_year,
      p_amount, coalesce(p_allocations, '[]'::jsonb), p_payment_date, v_plan_sources, v_account_ref
    )
    returning id into v_payment_id;
  else
    update public.extra_payments
    set month = p_month,
        year = p_year,
        amount = p_amount,
        allocations = coalesce(p_allocations, '[]'::jsonb),
        payment_date = p_payment_date,
        sources = v_plan_sources,
        funding_account_ref = case when v_explicit_account then v_account_ref else funding_account_ref end
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
      -- Equal merchant/date/amount across cash accounts is normal activity.
      -- A duplicate requires the same immutable provider account AND posting.
      and d.plaid_account_id = v_winner.plaid_account_id
      and v_winner.plaid_transaction_id is not null
      and d.plaid_transaction_id = v_winner.plaid_transaction_id
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
  v_funding_ref text;
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

  v_funding_ref:=(private.forecast_account_details(v_tx.household_id,v_tx.budget_id,p_bill->>'funding_account_ref',true))->>'ref';

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
      and v_bill.funding_account_ref is not distinct from v_funding_ref
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
    smart_priority, include_in_snowball, snowball_minimum_boost, created_at, funding_account_ref
  ) values (
    v_bill_id, v_actor, v_tx.household_id, v_tx.budget_id, v_name,
    round(v_amount, 2), v_category, v_priority,
    v_is_debt, round(v_balance, 2), round(v_interest_rate, 4),
    v_due_day, v_day_of_week, v_next_payment_date::text,
    v_start_date::text, v_end_date::text, v_is_recurring,
    v_frequency,
    v_smart_priority, v_include_in_snowball,
    round(v_snowball_minimum_boost, 2), pg_catalog.now()::text, v_funding_ref
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

notify pgrst,'reload schema';
