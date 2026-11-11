-- Current hosted function DDL, metadata only, exported 2026-11-11.
-- Used only to align the fictional fixture with production authorization helpers.
-- SHA256 febb081156193b63d7d36b1178d391dbfdac7de00ac3609c153d0dc014717855
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
-- SHA256 a4a9306576a726d32e0946de71bc4c2fedd873215b4c1910050cd4693778d66c
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
-- SHA256 a10019ad9cafeea027eec7a317ee395eaae24cb45011523a6757d028a94970c9
CREATE OR REPLACE FUNCTION private.is_household_member(p_household_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from household_members hm
    where hm.household_id = p_household_id
      and hm.user_id = auth.uid()
  )
$function$;
