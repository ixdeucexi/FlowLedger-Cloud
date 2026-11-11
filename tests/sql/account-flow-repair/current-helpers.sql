-- Trusted, read-only production metadata captured 2026-11-11. Local fake fixture only.

CREATE OR REPLACE FUNCTION private.sync_manual_operating_anchor()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_old_household_id uuid;
  v_new_household_id uuid;
  v_old_budget_id uuid;
  v_new_budget_id uuid;
  v_old_operating boolean := false;
  v_new_operating boolean := false;
  v_target_household_id uuid;
  v_target_budget_id uuid;
  v_anchor_balance numeric;
  v_anchor_min_date date;
  v_anchor_max_date date;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    v_old_operating := old.is_active and old.account_type in ('checking', 'cash');
    v_old_household_id := old.household_id;
    v_old_budget_id := old.budget_id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    v_new_operating := new.is_active and new.account_type in ('checking', 'cash');
    v_new_household_id := new.household_id;
    v_new_budget_id := new.budget_id;
  end if;
  if not (v_old_operating or v_new_operating) then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  -- A legacy UPDATE already owns its account row. Lock affected settings rows
  -- in UUID order, matching the account-row -> settings-row part of the current
  -- RPC and avoiding both account/advisory and cross-household lock inversions.
  for v_target_household_id in
    select distinct affected.household_id
    from (
      values
        (case when v_old_operating then v_old_household_id end),
        (case when v_new_operating then v_new_household_id end)
    ) as affected(household_id)
    where affected.household_id is not null
    order by affected.household_id
  loop
    v_target_budget_id := case
      when v_target_household_id is not distinct from v_new_household_id
        then v_new_budget_id
      else v_old_budget_id
    end;
    if v_target_budget_id is not null then
      insert into public.household_settings (household_id, budget_id)
      values (v_target_household_id, v_target_budget_id)
      on conflict (household_id) do nothing;
    end if;

    perform 1
    from public.household_settings
    where household_id = v_target_household_id
    for update;
    if not found then
      continue;
    end if;

    select
      sum(account.current_balance),
      min(account.balance_as_of),
      max(account.balance_as_of)
    into v_anchor_balance, v_anchor_min_date, v_anchor_max_date
    from public.accounts account
    where account.household_id = v_target_household_id
      and account.is_active
      and account.account_type in ('checking', 'cash');

    if tg_op = 'INSERT'
       and v_new_operating
       and v_target_household_id is not distinct from v_new_household_id
       and v_anchor_min_date is distinct from v_anchor_max_date then
      raise exception using
        errcode = '22023',
        message = 'Active checking and cash balances must share one as-of date when an account is added';
    end if;

    if v_anchor_max_date is not null
       and v_anchor_min_date is not distinct from v_anchor_max_date then
      update public.household_settings set
        starting_balance = coalesce(v_anchor_balance, 0),
        starting_balance_date = v_anchor_max_date::text,
        calendar_start_date = coalesce(
          calendar_start_date,
          to_char(v_anchor_max_date, 'YYYY-MM-01')
        ),
        updated_at = now()
      where household_id = v_target_household_id;
    end if;
  end loop;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;

drop trigger if exists sync_manual_operating_anchor_after_update on public.accounts;

CREATE TRIGGER sync_manual_operating_anchor_after_update AFTER UPDATE OF household_id, budget_id, is_active, account_type, current_balance, balance_as_of ON public.accounts FOR EACH ROW EXECUTE FUNCTION private.sync_manual_operating_anchor();

CREATE OR REPLACE FUNCTION private.forecast_account_details(p_household_id uuid, p_budget_id uuid, p_account_ref text, p_strict_budget boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.get_household_forecast_accounts(p_household_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select private.get_household_forecast_accounts(p_household_id)
$function$;

CREATE OR REPLACE FUNCTION private.get_household_forecast_accounts(p_household_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.is_household_editor(p_household_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$ select private.is_household_editor(p_household_id) $function$;

CREATE OR REPLACE FUNCTION private.is_household_editor(p_household_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.household_members hm
    where hm.household_id = p_household_id
      and hm.user_id = auth.uid()
      and hm.role in ('owner', 'manager', 'editor')
  )
$function$;

CREATE OR REPLACE FUNCTION private.set_forecast_account_routing(p_household_id uuid, p_budget_id uuid, p_entity_type text, p_entity_id text, p_expected jsonb, p_patch jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.set_forecast_account_routing(p_household_id uuid, p_budget_id uuid, p_entity_type text, p_entity_id text, p_expected jsonb, p_patch jsonb)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$
  select private.set_forecast_account_routing(p_household_id,p_budget_id,p_entity_type,p_entity_id,p_expected,p_patch)
$function$;
