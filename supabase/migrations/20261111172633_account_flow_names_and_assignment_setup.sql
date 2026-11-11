-- Account names are shared household metadata. These functions expose only
-- name edits, without granting UPDATE on bank balances or connection controls.
-- No existing account, financial record, or routing choice is backfilled.

create or replace function private.preserve_plaid_account_display_name()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  peer_name text;
  peer_exists boolean := false;
  cash_kind text;
begin
  if tg_op = 'UPDATE' then
    -- This trigger fires on provider/source/observation columns, including a
    -- retry that sets them to the same values. A stale sync read must neither
    -- replace a newer nickname nor resurrect a nickname that was reset.
    -- The existing row lock orders this against a rename. Do NOT acquire the
    -- metadata advisory lock here: UPDATE already owns its row lock.
    new.display_name := old.display_name;
    return new;
  end if;

  if new.household_id is null then return new; end if;
  -- BEFORE INSERT runs before ON CONFLICT locks its existing row. All current
  -- ingestion calls use one household and one row per upsert. The same one-HH
  -- lock also serializes reconnect inserts against name-only user edits.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'flowledger:account-name:' || new.household_id::text, 0));
  cash_kind := case
    when pg_catalog.lower(coalesce(new.account_type,new.type,'')) in ('depository','checking','savings')
      and pg_catalog.lower(coalesce(new.account_subtype,new.subtype,'')) in ('checking','savings')
      then pg_catalog.lower(coalesce(new.account_subtype,new.subtype))
    else null end;
  if nullif(pg_catalog.btrim(new.persistent_account_id),'') is not null and cash_kind is not null then
    select true, a.display_name into peer_exists, peer_name
    from public.plaid_accounts a
    where a.household_id = new.household_id
      and a.persistent_account_id = new.persistent_account_id
      and pg_catalog.lower(coalesce(a.account_type,a.type,'')) in ('depository','checking','savings')
      and pg_catalog.lower(coalesce(a.account_subtype,a.subtype,'')) = cash_kind
      and coalesce(pg_catalog.upper(pg_catalog.btrim(a.currency_code)),'USD')
        = coalesce(pg_catalog.upper(pg_catalog.btrim(new.currency_code)),'USD')
    order by a.is_active desc, a.updated_at desc nulls last, a.id
    limit 1;
  end if;
  -- The sync API's incoming display_name is only an echo from its saved-name
  -- index; provider names use name/official_name. Never infer a custom name
  -- for a new physical account, or retain an orphaned stale index value.
  new.display_name := case when coalesce(peer_exists,false) then peer_name else null end;
  return new;
end;
$$;

revoke all on function private.preserve_plaid_account_display_name() from public, anon, authenticated, service_role;

drop trigger if exists preserve_plaid_account_name_on_provider_update on public.plaid_accounts;
create trigger preserve_plaid_account_name_on_provider_update
before update of user_id, household_id, plaid_item_id, plaid_item_record_id,
  account_id, flowledger_account_id, plaid_account_id, persistent_account_id,
  name, official_name, mask, type, subtype, account_type, account_subtype,
  current_balance, available_balance, credit_limit, currency_code, is_active,
  updated_at, minimum_payment_amount, next_payment_due_date,
  last_statement_balance, last_statement_issue_date, is_overdue, purchase_apr,
  liability_last_synced_at
on public.plaid_accounts
for each row execute function private.preserve_plaid_account_display_name();

drop trigger if exists inherit_plaid_account_name_on_insert on public.plaid_accounts;
create trigger inherit_plaid_account_name_on_insert
before insert on public.plaid_accounts
for each row execute function private.preserve_plaid_account_display_name();

create or replace function private.rename_forecast_account(
  p_household_id uuid,
  p_budget_id uuid,
  p_account_ref text,
  p_expected_name text,
  p_name text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  details jsonb;
  locked_details jsonb;
  current_name text;
  normalized_name text;
  target_name text;
  local_account public.accounts%rowtype;
  bank_account public.plaid_accounts%rowtype;
  bank_ids uuid[];
  fallback_bank public.plaid_accounts%rowtype;
  fallback_groups integer;
  fallback_links text[];
  fallback_key text;
  bridge_name text;
  local_rows jsonb := '[]'::jsonb;
  unchanged boolean := false;
begin
  if auth.uid() is null or p_household_id is null or not private.is_household_editor(p_household_id) then
    raise exception 'Household edit access required';
  end if;
  if p_budget_id is null or not exists (
    select 1 from public.budgets where id=p_budget_id and household_id=p_household_id
  ) then raise exception 'Choose a budget in this household'; end if;
  if p_account_ref is null or p_expected_name is null then raise exception 'The current account name is required'; end if;
  if p_name is not null then
    normalized_name := pg_catalog.btrim(pg_catalog.regexp_replace(p_name, '[[:space:]]+', ' ', 'g'));
    if normalized_name = '' or pg_catalog.char_length(normalized_name) > 80 or normalized_name ~ '[[:cntrl:]]' then
      raise exception 'Enter an account name from 1 to 80 characters';
    end if;
  end if;

  -- Lock before forecast_account_details obtains a manual FOR SHARE lock.
  -- Otherwise two manual renames could hold SHARE locks while waiting for
  -- each other's advisory lock/UPDATE upgrade. One household lock also keeps
  -- explicit manual-bank aliases and reconnect inserts in one order.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'flowledger:account-name:' || p_household_id::text, 0));
  details := private.forecast_account_details(p_household_id,p_budget_id,p_account_ref,true);
  if details is null then raise exception 'Choose an active household account'; end if;

  if details->>'bank_id' is null then
    if normalized_name is null then raise exception 'A manual account needs a name'; end if;
    select * into local_account from public.accounts
      where id=details->>'local_id' and household_id=p_household_id
        and budget_id is not distinct from p_budget_id and is_active
      for update;
    if not found then raise exception 'Choose an active account in this household plan'; end if;
    -- A disconnected bank may expose its explicit local mirror again. Keep
    -- one provable inactive lineage coherent so reconnect cannot revive the
    -- old name. Ambiguous historical bridges are rejected, never guessed.
    select count(distinct case when nullif(pg_catalog.btrim(a.persistent_account_id),'') is not null
      then 'persistent:'||a.persistent_account_id else 'bank:'||a.id::text end)
      into fallback_groups from public.plaid_accounts a where a.household_id=p_household_id
        and (a.account_id=local_account.id or a.flowledger_account_id=local_account.id);
    if fallback_groups>1 then raise exception 'This account has conflicting bank links'; end if;
    if fallback_groups=1 then
      select * into fallback_bank from public.plaid_accounts a where a.household_id=p_household_id
        and (a.account_id=local_account.id or a.flowledger_account_id=local_account.id)
        order by a.updated_at desc nulls last,a.id limit 1;
      fallback_key := case when nullif(pg_catalog.btrim(fallback_bank.persistent_account_id),'') is not null
        then 'persistent:'||fallback_bank.persistent_account_id else 'bank:'||fallback_bank.id::text end;
      select array_agg(a.id order by a.id) into bank_ids from public.plaid_accounts a
        where a.household_id=p_household_id and (a.id=fallback_bank.id
          or (nullif(pg_catalog.btrim(fallback_bank.persistent_account_id),'') is not null and a.persistent_account_id=fallback_bank.persistent_account_id));
      perform 1 from public.plaid_accounts a where a.household_id=p_household_id and a.id=any(bank_ids) order by a.id for update;
      if exists(select 1 from public.plaid_accounts a where a.household_id=p_household_id and a.id=any(bank_ids)
        and (a.is_active or pg_catalog.lower(coalesce(a.account_type,a.type,'')) not in('depository','checking','savings')
          or pg_catalog.lower(coalesce(a.account_subtype,a.subtype,''))<>local_account.account_type
          or (a.currency_code is not null and pg_catalog.upper(pg_catalog.btrim(a.currency_code))<>'USD')
          or (case when nullif(pg_catalog.btrim(a.persistent_account_id),'') is not null then 'persistent:'||a.persistent_account_id else 'bank:'||a.id::text end)<>fallback_key)) then
        raise exception 'This account has an invalid or changed bank link';
      end if;
      select array_agg(distinct x.link) into fallback_links from public.plaid_accounts a
        cross join lateral (values(a.account_id),(a.flowledger_account_id))x(link)
        where a.household_id=p_household_id and a.id=any(bank_ids) and x.link is not null;
      if coalesce(array_length(fallback_links,1),0)<>1 or fallback_links[1]<>local_account.id then
        raise exception 'This account has conflicting bank links';
      end if;
    end if;
    current_name := local_account.name;
    target_name := normalized_name;
    if current_name is distinct from p_expected_name and current_name is distinct from target_name then
      raise exception using errcode='40001', message='The account name changed. Refresh and try again';
    end if;
    unchanged := current_name is not distinct from target_name;
    if not unchanged then
      update public.accounts set name=target_name
        where id=local_account.id and household_id=p_household_id
          and budget_id is not distinct from p_budget_id;
    end if;
    if bank_ids is not null then
      unchanged := unchanged and not exists(select 1 from public.plaid_accounts a where a.household_id=p_household_id
        and a.id=any(bank_ids) and a.display_name is distinct from normalized_name);
      update public.plaid_accounts set display_name=normalized_name where household_id=p_household_id
        and id=any(bank_ids) and display_name is distinct from normalized_name;
    end if;
    local_rows := pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id',local_account.id,'name',target_name));
  else
    select array_agg(substring(alias #>> '{}' from 6)::uuid order by alias #>> '{}')
      into bank_ids from pg_catalog.jsonb_array_elements(details->'aliases') alias
      where alias #>> '{}' like 'bank:%';
    -- Stable row order prevents conflicting alias-set updates from depending
    -- on heap order; the physical identity was strictly validated above.
    perform 1 from public.plaid_accounts
      where household_id=p_household_id and id=any(bank_ids) order by id for update;
    locked_details := private.forecast_account_details(p_household_id,p_budget_id,p_account_ref,true);
    if locked_details->>'physical_key' is distinct from details->>'physical_key'
      or locked_details->'aliases' is distinct from details->'aliases' then
      raise exception using errcode='40001', message='The account details changed. Refresh and try again';
    end if;
    details := locked_details;
    select * into bank_account from public.plaid_accounts
      where id=(details->>'bank_id')::uuid and household_id=p_household_id;
    if not found then raise exception 'Choose an active bank account in this household'; end if;
    current_name := coalesce(nullif(pg_catalog.btrim(bank_account.display_name),''),
      nullif(bank_account.name,''),nullif(bank_account.official_name,''),'Bank account');
    target_name := coalesce(normalized_name,nullif(bank_account.name,''),
      nullif(bank_account.official_name,''),'Bank account');
    if current_name is distinct from p_expected_name and current_name is distinct from target_name then
      raise exception using errcode='40001', message='The account name changed. Refresh and try again';
    end if;
    select not exists(select 1 from public.plaid_accounts
      where household_id=p_household_id and id=any(bank_ids)
        and display_name is distinct from normalized_name) into unchanged;
    -- UPDATE display_name ONLY deliberately does not fire the provider-column
    -- guard. Provider names, source IDs and bank observation fields stay put.
    update public.plaid_accounts set display_name=normalized_name
      where household_id=p_household_id and id=any(bank_ids)
        and display_name is distinct from normalized_name;
    if details->>'bridge_local_id' is not null then
      select name into bridge_name from public.accounts where id=details->>'bridge_local_id'
        and household_id=p_household_id and is_active for update;
      if not found then raise exception 'This account has an invalid bank link'; end if;
      unchanged := unchanged and bridge_name is not distinct from target_name;
      update public.accounts set name=target_name where id=details->>'bridge_local_id'
        and household_id=p_household_id and is_active and name is distinct from target_name;
      local_rows := pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id',details->>'bridge_local_id','name',target_name));
    end if;
  end if;

  -- Revalidate authorization after waiting for any metadata/row lock.
  if auth.uid() is null or not private.is_household_editor(p_household_id) then
    raise exception 'Household edit access required';
  end if;
  return pg_catalog.jsonb_build_object('account_ref',details->>'ref','name',target_name,
    'accounts',local_rows,'bank_accounts',private.get_household_forecast_accounts(p_household_id),'retry',unchanged);
end;
$$;

create or replace function public.rename_forecast_account(
  p_household_id uuid,p_budget_id uuid,p_account_ref text,p_expected_name text,p_name text
) returns jsonb language sql volatile security invoker set search_path='' as $$
  select private.rename_forecast_account(p_household_id,p_budget_id,p_account_ref,p_expected_name,p_name)
$$;
revoke all on function private.rename_forecast_account(uuid,uuid,text,text,text) from public, anon, service_role;
revoke all on function public.rename_forecast_account(uuid,uuid,text,text,text) from public, anon, service_role;
grant execute on function private.rename_forecast_account(uuid,uuid,text,text,text) to authenticated;
grant execute on function public.rename_forecast_account(uuid,uuid,text,text,text) to authenticated;

create or replace function private.set_forecast_account_routing_batch(
  p_household_id uuid,p_budget_id uuid,p_changes jsonb
) returns jsonb
language plpgsql
security invoker
set search_path=''
as $$
declare
  change jsonb;
  field text;
  allowed text[];
  results jsonb := '[]'::jsonb;
  result jsonb;
  before_row jsonb;
  table_name text;
  scenario_type text;
begin
  if auth.uid() is null or p_household_id is null or not private.is_household_editor(p_household_id) then
    raise exception 'Household edit access required';
  end if;
  if p_budget_id is null or not exists (
    select 1 from public.budgets where id=p_budget_id and household_id=p_household_id
  ) then raise exception 'Choose a budget in this household'; end if;
  if p_changes is null or pg_catalog.jsonb_typeof(p_changes)<>'array' then
    raise exception 'Choose from 1 to 100 plan assignments';
  end if;
  if pg_catalog.jsonb_array_length(p_changes)<1 or pg_catalog.jsonb_array_length(p_changes)>100 then
    raise exception 'Choose from 1 to 100 plan assignments';
  end if;
  for change in select value from pg_catalog.jsonb_array_elements(p_changes) loop
    if pg_catalog.jsonb_typeof(change)<>'object' or not change ?& array['entity_type','entity_id','expected','patch']
      or exists(select 1 from pg_catalog.jsonb_object_keys(change) key where key not in('entity_type','entity_id','expected','patch'))
      or pg_catalog.jsonb_typeof(change->'entity_type')<>'string' or pg_catalog.jsonb_typeof(change->'entity_id')<>'string'
      or nullif(change->>'entity_id','') is null or pg_catalog.char_length(change->>'entity_id')>240
      or pg_catalog.jsonb_typeof(change->'expected')<>'object' or pg_catalog.jsonb_typeof(change->'patch')<>'object'
      or change->'patch'='{}'::jsonb then raise exception 'Choose valid plan account assignments'; end if;
    if (select count(*) from pg_catalog.jsonb_object_keys(change->'patch'))<>1 then
      raise exception 'Choose one payment or deposit field per plan';
    end if;
    case change->>'entity_type'
      when 'bill' then allowed:=array['funding_account_ref'];
      when 'income' then allowed:=array['deposit_account_ref'];
      when 'goal' then allowed:=array['funding_account_ref','deposit_account_ref'];
      when 'decision' then allowed:=array['funding_account_ref','deposit_account_ref'];
      when 'extra_payment' then allowed:=array['funding_account_ref'];
      else raise exception 'Batch account setup accepts plans only';
    end case;
    for field in select pg_catalog.jsonb_object_keys(change->'patch') loop
      if not field=any(allowed) or not (change->'expected') ? field
        or pg_catalog.jsonb_typeof(change->'patch'->field) not in('string','null')
        or pg_catalog.jsonb_typeof(change->'expected'->field) not in('string','null') then
        raise exception 'Unsupported or missing expected account field';
      end if;
    end loop;
    if exists(select 1 from pg_catalog.jsonb_object_keys(change->'expected') key
      where not (change->'patch') ? key) then raise exception 'Unexpected expected account field'; end if;
  end loop;
  if exists(select 1 from pg_catalog.jsonb_array_elements(p_changes) item
    group by item->>'entity_type',item->>'entity_id' having count(*)>1) then
    raise exception 'Choose each plan item only once';
  end if;
  -- Serialize reviewed multi-plan edits in one household/budget, then call
  -- the existing row-scoped CAS helper in stable order. Any failure rolls
  -- back every assignment; no financial amount or actual transaction is sent.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'flowledger:routing-batch:'||p_household_id::text||':'||p_budget_id::text,0));
  for change in select value from pg_catalog.jsonb_array_elements(p_changes)
    order by value->>'entity_type',value->>'entity_id' loop
    table_name := case change->>'entity_type'
      when 'bill' then 'bills' when 'income' then 'incomes' when 'goal' then 'goals'
      when 'decision' then 'decisions' when 'extra_payment' then 'extra_payments' end;
    execute pg_catalog.format('select to_jsonb(r) from public.%I r where id=$1 and household_id=$2 and budget_id is not distinct from $3 for update',table_name)
      into before_row using change->>'entity_id',p_household_id,p_budget_id;
    if before_row is null then raise exception 'This plan item is unavailable in this household'; end if;
    if change->>'entity_type'='goal' and (before_row->>'goal_type' is distinct from 'planned_expense'
      or before_row->>'closed_at' is not null or before_row->>'archived_at' is not null
      or not (change->'patch') ? 'funding_account_ref' or (change->'patch') ? 'deposit_account_ref') then
      raise exception 'Batch account setup accepts open spending plans only';
    end if;
    if change->>'entity_type'='decision' then
      scenario_type := before_row->'scenario'->>'type';
      if before_row->>'status' not in('planned','calendar')
        or scenario_type is null or scenario_type not in('one_time_purchase','recurring_bill','income_change','payment_date_change','extra_debt_payment') then
        raise exception 'Batch account setup accepts active single-account plans only';
      end if;
      if (select count(*) from pg_catalog.jsonb_object_keys(change->'patch'))<>1
        or (scenario_type='income_change' and not (change->'patch') ? 'deposit_account_ref')
        or (scenario_type<>'income_change' and not (change->'patch') ? 'funding_account_ref') then
        raise exception 'Choose the payment or deposit field for this plan';
      end if;
    end if;
    result := private.set_forecast_account_routing(p_household_id,p_budget_id,
      change->>'entity_type',change->>'entity_id',change->'expected',change->'patch');
    results := results || pg_catalog.jsonb_build_array(result);
  end loop;
  if not private.is_household_editor(p_household_id) then raise exception 'Household edit access required'; end if;
  return pg_catalog.jsonb_build_object('results',results);
end;
$$;
create or replace function public.set_forecast_account_routing_batch(
  p_household_id uuid,p_budget_id uuid,p_changes jsonb
) returns jsonb language sql volatile security invoker set search_path='' as $$
  select private.set_forecast_account_routing_batch(p_household_id,p_budget_id,p_changes)
$$;
revoke all on function private.set_forecast_account_routing_batch(uuid,uuid,jsonb) from public, anon, service_role;
revoke all on function public.set_forecast_account_routing_batch(uuid,uuid,jsonb) from public, anon, service_role;
grant execute on function private.set_forecast_account_routing_batch(uuid,uuid,jsonb) to authenticated;
grant execute on function public.set_forecast_account_routing_batch(uuid,uuid,jsonb) to authenticated;
