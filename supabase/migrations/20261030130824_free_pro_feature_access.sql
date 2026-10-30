-- Household feature access is server-owned. Existing planning access is captured
-- once; it does not change a plan, start billing or grant bank/cloud features.
create table private.founding_planning_access (
  household_id uuid primary key references public.households(id) on delete cascade,
  feature_version smallint not null default 1 check (feature_version = 1),
  granted_at timestamptz not null default now()
);
alter table private.founding_planning_access enable row level security;
revoke all on private.founding_planning_access from public,anon,authenticated,service_role;
insert into private.founding_planning_access(household_id)
select id from public.households;
comment on table private.founding_planning_access is
  'Immutable launch-cutoff planning grant v1. Not a Pro tier, billing entitlement, bank entitlement or cloud scenario write grant.';

create table private.flo_monthly_usage (
  household_id uuid not null references public.households(id) on delete cascade,
  request_month date not null check (request_month = date_trunc('month',request_month)::date),
  request_count integer not null default 0 check (request_count >= 0),
  primary key(household_id,request_month)
);
create table private.flo_plan_reservations (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  -- Null for retained legacy daily access; monthly refunds always use the
  -- original period stored here, never a period supplied by a caller.
  request_month date,
  status text not null check (status in ('charged','refunded','denied')),
  created_at timestamptz not null default now(),
  refunded_at timestamptz,
  foreign key(household_id,request_month)
    references private.flo_monthly_usage(household_id,request_month) on delete cascade
);
create index flo_plan_reservations_user_idx on private.flo_plan_reservations(user_id);
create index flo_plan_reservations_month_idx on private.flo_plan_reservations(household_id,request_month);
alter table private.flo_monthly_usage enable row level security;
alter table private.flo_plan_reservations enable row level security;
revoke all on private.flo_monthly_usage,private.flo_plan_reservations from public,anon,authenticated,service_role;

-- Shared read policy. The actor comes from auth.uid() or a service-only RPC
-- after Edge authentication, never user metadata or a client-provided tier.
create function private.feature_access_for_user(p_user_id uuid,p_household_id uuid,p_preview_tier text default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_active uuid; v_role text; v_tier text:='free'; v_source text:='default';
  v_effective text; v_founding boolean:=false; v_legacy boolean:=false;
  v_features text[]:=array['manual_budgeting','flo_basic','debt_payoff','plan_simulator','transaction_matching','flo_account_chat'];
  v_today date:=(now() at time zone 'UTC')::date;
  v_month date:=date_trunc('month',now() at time zone 'UTC')::date;
  v_limit integer; v_used integer:=0; v_period text; v_reset timestamptz; v_create boolean;
begin
  if p_user_id is null or not exists(select 1 from auth.users where id=p_user_id) then
    raise exception using errcode='42501',message='feature_session_required';
  end if;
  if p_household_id is null then raise exception using errcode='42501',message='feature_household_required'; end if;
  select active_household_id into v_active from public.user_preferences where user_id=p_user_id;
  if v_active is distinct from p_household_id then raise exception using errcode='42501',message='feature_active_household_required'; end if;
  select role into v_role from public.household_members where user_id=p_user_id and household_id=p_household_id;
  if v_role is null or v_role not in ('owner','manager','editor','viewer') then
    raise exception using errcode='42501',message='feature_household_access_denied';
  end if;
  select tier,source into v_tier,v_source from public.household_plans where household_id=p_household_id;
  v_tier:=coalesce(v_tier,'free'); v_source:=coalesce(v_source,'default');
  if p_preview_tier is not null then
    if p_preview_tier not in ('free','pro') then raise exception using errcode='22023',message='feature_preview_invalid'; end if;
    if not exists(select 1 from public.feedback_admins where user_id=p_user_id) then
      raise exception using errcode='42501',message='feature_preview_denied';
    end if;
  else
    v_founding:=exists(select 1 from private.founding_planning_access where household_id=p_household_id and feature_version=1);
  end if;
  v_effective:=coalesce(p_preview_tier,v_tier);
  if v_effective='pro' or v_founding then
    v_features:=v_features||array['debt_strategies','saved_scenarios','scenario_comparison','long_term_reports','flo_creation','connected_insights'];
  end if;
  -- No founding grant ever substitutes for an actual Pro cloud/bank plan.
  -- An admin preview may preview UI but cannot change database write policies.
  if v_effective='pro' then v_features:=v_features||array['cloud_scenarios','plaid_sync']; end if;
  v_legacy:=p_preview_tier is null and (v_founding or (v_tier='pro' and v_source in ('admin','grandfathered')));
  if v_legacy then
    v_period:='day';v_limit:=100;v_reset:=(v_today+1)::timestamp at time zone 'UTC';
    select request_count into v_used from public.flo_daily_limits
      where user_id=p_user_id and household_id=p_household_id and request_day=v_today;
  else
    v_period:='month';v_limit:=case when v_effective='pro' then 300 else 10 end;
    v_reset:=(v_month+interval '1 month')::timestamp at time zone 'UTC';
    select request_count into v_used from private.flo_monthly_usage where household_id=p_household_id and request_month=v_month;
  end if;
  v_used:=coalesce(v_used,0);
  v_create:='flo_creation'=any(v_features) and v_role in ('owner','manager','editor');
  return jsonb_build_object('version',1,'householdId',p_household_id,
    'plan',jsonb_build_object('tier',v_tier,'source',v_source),
    'foundingPlanning',v_founding,'features',to_jsonb(v_features),
    'flo',jsonb_build_object('period',v_period,'limit',v_limit,'used',v_used,
      'remaining',greatest(0,v_limit-v_used),'resetsAt',v_reset,'canCreate',v_create));
end;
$$;
revoke all on function private.feature_access_for_user(uuid,uuid,text) from public,anon,authenticated,service_role;

-- Quota reservations pin the actor/household roots, active scope and plan.
-- All locks fail fast to avoid reversing the existing account lifecycle order.
-- SQLSTATE 55P03 rolls the request back; a retry revalidates current scope.
-- Financial functions keep their proven role/scope checks and use a capability
-- read at the new-write boundary, without holding new locks across financial
-- row waits. The read RPC itself remains read-only.
create function private.lock_feature_scope(p_user_id uuid,p_household_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_active uuid;v_role text;
begin
  perform 1 from auth.users where id=p_user_id for key share nowait;
  if not found then raise exception using errcode='42501',message='feature_session_required';end if;
  perform 1 from public.households where id=p_household_id for key share nowait;
  if not found then raise exception using errcode='42501',message='feature_household_required';end if;
  select active_household_id into v_active from public.user_preferences where user_id=p_user_id for share nowait;
  if p_household_id is null or v_active is distinct from p_household_id then
    raise exception using errcode='42501',message='feature_active_household_required';
  end if;
  select role into v_role from public.household_members where user_id=p_user_id and household_id=p_household_id for share nowait;
  if v_role is null or v_role not in ('owner','manager','editor','viewer') then
    raise exception using errcode='42501',message='feature_household_access_denied';
  end if;
  perform 1 from public.household_plans where household_id=p_household_id for share nowait;
  perform 1 from private.founding_planning_access where household_id=p_household_id for share nowait;
end;
$$;
revoke all on function private.lock_feature_scope(uuid,uuid) from public,anon,authenticated,service_role;

create function private.get_household_feature_access(p_expected_household_id uuid,p_preview_tier text default null)
returns jsonb language sql stable security definer set search_path='' as $$
  select private.feature_access_for_user(auth.uid(),p_expected_household_id,p_preview_tier)
$$;
revoke all on function private.get_household_feature_access(uuid,text) from public,anon,authenticated,service_role;
grant execute on function private.get_household_feature_access(uuid,text) to authenticated;
create function public.get_household_feature_access(p_expected_household_id uuid,p_preview_tier text default null)
returns jsonb language sql stable security invoker set search_path='' as $$
  select private.get_household_feature_access(p_expected_household_id,p_preview_tier)
$$;
revoke all on function public.get_household_feature_access(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.get_household_feature_access(uuid,text) to authenticated;

-- Only trusted Edge code may reserve. No client supplies a limit, period,
-- subscription claim or founding claim. Reusing ANY receipt ID is rejected.
create function private.reserve_flo_plan_request(p_user_id uuid,p_household_id uuid,p_reservation_id uuid,p_preview_tier text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_access jsonb;v_allowance jsonb;v_legacy boolean;v_month date;
  v_id uuid;v_count integer;v_limit integer;v_allowed boolean:=false;
begin
  if p_reservation_id is null then raise exception using errcode='22023',message='flo_reservation_required'; end if;
  perform private.lock_feature_scope(p_user_id,p_household_id);
  v_access:=private.feature_access_for_user(p_user_id,p_household_id,p_preview_tier);
  v_allowance:=v_access->'flo';v_legacy:=v_allowance->>'period'='day';
  v_limit:=(v_allowance->>'limit')::integer;
  if not v_legacy then
    v_month:=date_trunc('month',now() at time zone 'UTC')::date;
    insert into private.flo_monthly_usage(household_id,request_month)values(p_household_id,v_month)
      on conflict(household_id,request_month)do nothing;
  end if;
  insert into private.flo_plan_reservations(id,user_id,household_id,request_month,status)
    values(p_reservation_id,p_user_id,p_household_id,v_month,'denied')
    on conflict(id)do nothing returning id into v_id;
  if v_id is null then
    return jsonb_build_object('allowed',false,'reservationId',null,'legacyDaily',v_legacy,'allowance',v_allowance);
  end if;
  if v_legacy then
    -- The unchanged legacy daily function and per-minute guard run in Edge.
    v_allowed:=true;
  else
    update private.flo_monthly_usage set request_count=request_count+1
      where household_id=p_household_id and request_month=v_month and request_count<v_limit
      returning request_count into v_count;
    v_allowed:=found;
  end if;
  if v_allowed then update private.flo_plan_reservations set status='charged'where id=p_reservation_id;end if;
  v_allowance:=private.feature_access_for_user(p_user_id,p_household_id,p_preview_tier)->'flo';
  return jsonb_build_object('allowed',v_allowed,
    'reservationId',case when v_allowed and not v_legacy then p_reservation_id else null end,
    'legacyDaily',v_legacy,'allowance',v_allowance);
end;
$$;
revoke all on function private.reserve_flo_plan_request(uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function private.reserve_flo_plan_request(uuid,uuid,uuid,text) to service_role;
create function public.reserve_flo_plan_request(p_user_id uuid,p_household_id uuid,p_reservation_id uuid,p_preview_tier text default null)
returns jsonb language sql security invoker set search_path='' as $$
  select private.reserve_flo_plan_request(p_user_id,p_household_id,p_reservation_id,p_preview_tier)
$$;
revoke all on function public.reserve_flo_plan_request(uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.reserve_flo_plan_request(uuid,uuid,uuid,text) to service_role;

create function private.refund_flo_plan_request(p_user_id uuid,p_household_id uuid,p_reservation_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_receipt private.flo_plan_reservations%rowtype;
begin
  -- Pin parent roots before receipt/counter locks, so Auth/household cascades
  -- cannot hold a counter while waiting for this receipt. No active/member
  -- check: a legitimate switch/revocation must not burn its captured credit.
  perform 1 from auth.users where id=p_user_id for key share nowait;
  if not found then return false;end if;
  perform 1 from public.households where id=p_household_id for key share nowait;
  if not found then return false;end if;
  select * into v_receipt from private.flo_plan_reservations
    where id=p_reservation_id and user_id=p_user_id and household_id=p_household_id for update;
  if not found or v_receipt.status<>'charged' or v_receipt.request_month is null then return false;end if;
  update private.flo_monthly_usage set request_count=greatest(0,request_count-1)
    where household_id=v_receipt.household_id and request_month=v_receipt.request_month;
  update private.flo_plan_reservations set status='refunded',refunded_at=now()where id=v_receipt.id;
  return true;
end;
$$;
revoke all on function private.refund_flo_plan_request(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.refund_flo_plan_request(uuid,uuid,uuid) to service_role;
create function public.refund_flo_plan_request(p_user_id uuid,p_household_id uuid,p_reservation_id uuid)
returns boolean language sql security invoker set search_path='' as $$
  select private.refund_flo_plan_request(p_user_id,p_household_id,p_reservation_id)
$$;
revoke all on function public.refund_flo_plan_request(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.refund_flo_plan_request(uuid,uuid,uuid) to service_role;

-- Preserve the existing canonical financial implementation verbatim apart from
-- a new entitlement check AFTER its immutable committed-receipt replay path.
do $guard$
declare v_oid oid:=to_regprocedure('private.create_flo_entity(uuid,text,jsonb,uuid,uuid)');v_definition text;
  v_needle text:=E'  if p_kind=''create_manual_transaction'' then\n    perform 1 from public.accounts';
  v_guard text:=E'  if not coalesce((private.feature_access_for_user(v_actor,v_household,null)->''flo''->>''canCreate'')::boolean,false) then\n    raise exception using errcode=''P0001'',message=''flo_creation_pro_required'';\n  end if;\n';
begin
  if v_oid is null then raise exception 'Canonical Flo creation function is missing';end if;
  v_definition:=pg_get_functiondef(v_oid);
  if regexp_count(v_definition,'return v_existing[.]receipt;')<>1
    or (length(v_definition)-length(replace(v_definition,v_needle,'')))/length(v_needle)<>1
    or strpos(v_definition,'return v_existing.receipt;')>strpos(v_definition,v_needle)
    then raise exception 'Canonical Flo creation receipt/write boundary changed';end if;
  execute replace(v_definition,v_needle,v_guard||v_needle);
end;
$guard$;

-- Existing proposals also retain their committed result after plan downgrade.
do $proposal_guard$
declare v_oid oid:=to_regprocedure('private.confirm_flo_recurring_bill_proposal(uuid)');v_definition text;
  v_needle text:=E'  if not exists (select 1 from public.household_plans where household_id = v_proposal.household_id and tier = ''pro'')\n    then raise exception using errcode = ''42501'', message = ''proposal_pro_required''; end if;\n  if v_proposal.status = ''confirmed'' then return v_proposal.result; end if;';
  v_guard text:=E'  if v_proposal.status = ''confirmed'' then return v_proposal.result; end if;\n  if not coalesce((private.feature_access_for_user(v_user_id,v_proposal.household_id,null)->''flo''->>''canCreate'')::boolean,false) then\n    raise exception using errcode=''P0001'',message=''flo_creation_pro_required'';\n  end if;';
begin
  if v_oid is null then raise exception 'Canonical Flo proposal function is missing';end if;
  v_definition:=pg_get_functiondef(v_oid);
  if (length(v_definition)-length(replace(v_definition,v_needle,'')))/length(v_needle)<>1 then
    raise exception 'Canonical Flo proposal receipt/tier boundary changed';end if;
  execute replace(v_definition,v_needle,v_guard);
end;
$proposal_guard$;

-- Saved definitions belong to the household even after a subscription ends.
-- Read/export and editor deletion stay available; new saves/updates retain the
-- original actual-Pro + editor RLS policies and protected-definition trigger.
drop policy "plan simulations: pro members read" on public.plan_simulations;
create policy "plan simulations: members read saved data" on public.plan_simulations for select to authenticated
using ((select public.is_household_member(household_id)));
drop policy "plan simulations: pro editors delete" on public.plan_simulations;
create policy "plan simulations: editors delete saved data" on public.plan_simulations for delete to authenticated
using (exists(select 1 from public.household_members member where member.household_id=plan_simulations.household_id
  and member.user_id=(select auth.uid()) and member.role in ('owner','manager','editor')));

notify pgrst,'reload schema';
