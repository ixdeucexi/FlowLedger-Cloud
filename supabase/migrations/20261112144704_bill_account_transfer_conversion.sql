-- A durable, server-owned association survives ordinary plan edits and soft
-- deletion. Existing plans remain NULL; no financial rows are backfilled.
alter table public.planned_account_transfers add column source_bill_id text;
alter table public.planned_account_transfers add constraint planned_account_transfers_source_bill_fkey
 foreign key(source_bill_id) references public.bills(id) on delete no action deferrable initially deferred;
create unique index planned_account_transfers_source_bill_uidx
 on public.planned_account_transfers(source_bill_id) where source_bill_id is not null;

-- Match the app's read scope without trusting an evidence row's claimed
-- budget or creator. This private predicate is called only inside trusted code.
create function private.bill_transfer_evidence_admitted(p_source_household uuid,p_row_household uuid,p_row_user uuid)
returns boolean language sql stable security invoker set search_path='' as $$
 select coalesce(p_row_household=p_source_household or (p_row_household is null and exists(
  select 1 from public.households h join public.household_members m on m.household_id=h.id
  where h.id=p_source_household and h.is_personal and m.role='owner' and m.user_id=p_row_user)),false)
$$;
revoke all on function private.bill_transfer_evidence_admitted(uuid,uuid,uuid) from public,anon,authenticated,service_role;

-- Convert only an explicitly chosen, supported bill. Planning metadata never
-- initiates a bank transfer or changes past payments, matches, or balances.
create function private.convert_bill_to_planned_transfer(
 p_household_id uuid,p_budget_id uuid,p_bill_id text,p_expected jsonb,p_patch jsonb
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
 b public.bills%rowtype; t public.planned_account_transfers%rowtype;
 o public.monthly_overrides%rowtype; k text; current_fields jsonb;
 fields constant text[]:=array['name','amount','category','priority','is_debt','balance','interest_rate','due_day','day_of_week','next_payment_date','start_date','end_date','is_recurring','frequency','smart_priority','include_in_snowball','debt_payment_pauses','funding_account_ref'];
 first_date date; cutoff date; local_today date; this_month date; month_date date;
 occurrence date; source_start date; next_occurrence date; zone text;
 transfer_id text; receipt jsonb; saved jsonb; has_plan boolean; legacy_owner_ids uuid[]:='{}'::uuid[]; matching_paid_rows integer;
begin
 perform private.planned_transfer_scope(p_household_id,p_budget_id,true);
 if p_bill_id is null or length(p_bill_id) not between 1 and 160
  or p_bill_id<>btrim(p_bill_id) then raise exception 'Choose a valid bill'; end if;
 if p_expected is null or jsonb_typeof(p_expected)<>'object'
  or not (p_expected ?& fields) or (select count(*) from jsonb_object_keys(p_expected))<>cardinality(fields)
 then raise exception 'Refresh this bill before changing it to a transfer'; end if;
 if p_patch is null or jsonb_typeof(p_patch)<>'object'
  or not (p_patch ?& array['name','amount','from_account_ref','to_account_ref','frequency','start_date','end_date','status'])
  or (select count(*) from jsonb_object_keys(p_patch))<>8
 then raise exception 'Complete the transfer details'; end if;
 if p_patch->>'status' is distinct from 'active' then raise exception 'Start the replacement transfer active'; end if;
 first_date:=private.planned_transfer_date(p_patch->>'start_date');
 cutoff:=first_date-1;
 transfer_id:='bill-transfer-'||md5(p_household_id::text||':'||p_budget_id::text||':'||p_bill_id);
 receipt:=jsonb_build_object('bill_id',p_bill_id,'expected',p_expected,'cutoff',cutoff::text);
 perform pg_advisory_xact_lock(hashtextextended('flowledger:planned-transfers:'||p_household_id::text,0));
 perform private.planned_transfer_lock_scope(p_household_id,p_budget_id);
 if not exists(select 1 from public.planned_account_transfers where id=transfer_id) then
  perform private.planned_transfer_pair(p_household_id,p_budget_id,p_patch->>'from_account_ref',p_patch->>'to_account_ref');
 end if;
 -- Read only evidence admitted by the app's household loader: all rows in
 -- this household (any budget), plus personal-household owners' legacy rows.
 -- A foreign household's arbitrary Bill-ID reference must not block or settle
 -- this source. Post-conversion write guards remain global by logical Bill ID.
 -- Older bill/matching writers do not use the planning advisory lock. Protect
 -- the evidence snapshot, including absent rows, without waiting behind them.
 -- A busy operation asks the user to retry; it never takes a partial snapshot.
 begin
  lock table public.bills,public.monthly_overrides,public.bill_date_moves,
   public.transactions,public.pending_plan_matches,public.transaction_reconciliations,
   public.households,public.household_members in share row exclusive mode nowait;
 exception when lock_not_available then
  raise exception using errcode='40001',message='Bill activity is being updated. Try again shortly';
 end;
 select * into b from public.bills where id=p_bill_id and household_id=p_household_id and budget_id=p_budget_id for update;
 if not found then raise exception 'Bill not found in this household plan'; end if;
 select coalesce(array_agg(m.user_id),'{}'::uuid[]) into legacy_owner_ids
 from public.household_members m join public.households h on h.id=m.household_id
 where m.household_id=p_household_id and m.role='owner' and h.is_personal;
 select coalesce((select z.name from pg_catalog.pg_timezone_names z where z.name=s.time_zone limit 1),'UTC') into zone
  from public.household_settings s where s.household_id=p_household_id;
 local_today:=(now() at time zone coalesce(zone,'UTC'))::date;
 this_month:=date_trunc('month',local_today::timestamp)::date;
 select jsonb_object_agg(f,to_jsonb(b)->f) into current_fields from unnest(fields) f;
 -- Compare the same semantic shape used by normalizeBillRow in the app. In
 -- particular ordinary monthly rows store day_of_week NULL but display 0.
 current_fields:=current_fields||jsonb_build_object(
  'frequency',coalesce(b.frequency,'monthly'),'day_of_week',coalesce(b.day_of_week,0),
  'amount',case when lower(b.amount::text) in('nan','infinity','-infinity') then 0 else coalesce(b.amount,0) end,
  'balance',case when lower(b.balance::text) in('nan','infinity','-infinity') then 0 else coalesce(b.balance,0) end,
  'interest_rate',case when lower(b.interest_rate::text) in('nan','infinity','-infinity') then 0 else coalesce(b.interest_rate,0) end,
  'smart_priority',case when not coalesce(b.is_debt,false) and b.smart_priority in('flexible','optional') then b.smart_priority else 'must' end,
  'include_in_snowball',b.include_in_snowball is distinct from false,
  'debt_payment_pauses',coalesce(b.debt_payment_pauses,'[]'::jsonb));
 select * into t from public.planned_account_transfers where id=transfer_id for update;
 has_plan:=found;
 -- Internal receipt cannot be supplied through the ordinary plan writer. This
 -- makes a lost-response retry distinguishable from a separately created plan.
 if has_plan then
  if t.household_id=p_household_id and t.budget_id=p_budget_id
   and t.source_bill_id=b.id and t.deleted_at is null and t.revision=1
   and t.last_intent=jsonb_build_object('actor',auth.uid(),'expected',null,'patch',p_patch,'bill_conversion',receipt)
   and current_fields=(p_expected||jsonb_build_object('end_date',cutoff::text))
  then return jsonb_build_object('bill',to_jsonb(b),'transfer',to_jsonb(t)-'last_intent','retry',true); end if;
  raise exception using errcode='40001',message='This bill or its transfer changed. Refresh and try again';
 end if;
 if current_fields is distinct from p_expected then
  raise exception using errcode='40001',message='Bill changed while editing. Refresh and try again';
 end if;
 if b.is_debt or (b.is_recurring and coalesce(b.frequency,'monthly')<>'monthly') then
  raise exception 'Only monthly bills and one-time bills can change to a transfer'; end if;
 if nullif(b.end_date,'') is not null then raise exception 'This bill schedule has already ended'; end if;
 if (b.is_recurring and p_patch->>'frequency'<>'monthly')
  or (not b.is_recurring and p_patch->>'frequency'<>'once')
 then raise exception 'Keep this bill''s supported transfer frequency'; end if;
 if p_patch->>'frequency'='once' and p_patch->'end_date'<>'null'::jsonb
 then raise exception 'A one-time transfer has no recurring end date'; end if;
 if first_date<=local_today then raise exception 'Choose a first transfer date after today'; end if;
 source_start:=case when nullif(b.start_date,'') is null then null else private.planned_transfer_date(b.start_date) end;
 if source_start is not null and first_date<source_start then raise exception 'Choose a first date on or after this bill starts'; end if;
 -- Future exceptions can survive end_date in existing schedule semantics. Do
 -- not remove or reinterpret them during conversion, including date-move chains.
 if exists(select 1 from public.monthly_overrides x where x.bill_id=b.id and case when (x.household_id=p_household_id or (x.household_id is null and x.user_id=any(legacy_owner_ids))) then (
   make_date(x.year,x.month+1,1)>this_month
   or (make_date(x.year,x.month+1,1)=this_month and x.custom_due_day is not null)) else false end) then raise exception 'Review future bill overrides or date changes before changing it to a transfer'; end if;
 if exists(select 1 from public.bill_date_moves x where x.bill_id=b.id and (x.household_id=p_household_id or (x.household_id is null and x.user_id=any(legacy_owner_ids))) and not x.is_skipped
  and (x.from_date>=this_month or x.to_date>=this_month))
 then raise exception 'Review moved bill payments before changing it to a transfer'; end if;
 if exists(select 1 from public.pending_plan_matches x where (x.household_id=p_household_id or (x.household_id is null and x.user_id=any(legacy_owner_ids))) and x.target_type='bill' and x.target_id=b.id
  and x.status in('active','ready_review'))
 then raise exception 'Finish matching pending bill payments before changing it to a transfer'; end if;
 if exists(select 1 from public.monthly_overrides x where x.bill_id=b.id and case when (x.household_id=p_household_id or (x.household_id is null and x.user_id=any(legacy_owner_ids))) then (
  x.paid_date>local_today or (x.paid_amount>0 or x.actual_amount is not null) and x.paid_date is null
  or (make_date(x.year,x.month+1,1)<this_month and x.actual_amount is null
   and coalesce(x.custom_amount,b.amount)>x.paid_amount+0.005)) else false end) then raise exception 'Review unsettled or future bill payments before changing it to a transfer'; end if;
 if exists(select 1 from public.transactions x where (x.household_id=p_household_id or (x.household_id is null and x.user_id=any(legacy_owner_ids))) and
  (x.linked_bill_id=b.id or x.debt_applied_bill_id=b.id or exists(
    select 1 from jsonb_array_elements(case when jsonb_typeof(x.review_allocations)='array' then x.review_allocations else '[]'::jsonb end) a
    where a->>'type'='bill' and a->>'targetId'=b.id))
  and ((to_jsonb(x)->>'deleted_at') is null and (to_jsonb(x)->>'removed_at') is null)
  and (x.pending or x.date>=first_date::text or (to_jsonb(x)->>'matched_occurrence_date')>=first_date::text
   or exists(select 1 from jsonb_array_elements(case when jsonb_typeof(x.review_allocations)='array' then x.review_allocations else '[]'::jsonb end) a
     where a->>'type'='bill' and a->>'targetId'=b.id and (a->>'occurrenceDate'>=first_date::text or a->>'occurrenceDate' is null))))
 then raise exception 'Review future or pending bill activity before changing it to a transfer'; end if;
 if exists(select 1 from public.transaction_reconciliations x where (x.household_id=p_household_id or (x.household_id is null and x.user_id=any(legacy_owner_ids))) and
  ((x.resolution='bill' and x.target_id=b.id) or exists(select 1 from jsonb_array_elements(case when jsonb_typeof(x.allocations)='array' then x.allocations else '[]'::jsonb end) a where a->>'type'='bill' and a->>'targetId'=b.id))
  and (x.occurrence_date>=first_date or exists(select 1 from jsonb_array_elements(case when jsonb_typeof(x.allocations)='array' then x.allocations else '[]'::jsonb end) a
    where a->>'type'='bill' and a->>'targetId'=b.id and (a->>'occurrenceDate'>=first_date::text or a->>'occurrenceDate' is null))))
 then raise exception 'Review future bill matches before changing it to a transfer'; end if;
 -- The current simple schedule has at most one remaining occurrence per month.
 -- Require every obligation retained before the cutover to be settled. Future
 -- months cannot be silently prepaid here (their overrides were guarded above).
 if b.is_recurring then
  if b.due_day not between 1 and 31 then raise exception 'Review this bill''s payment date first'; end if;
  month_date:=greatest(this_month,coalesce(date_trunc('month',source_start::timestamp)::date,this_month));
  occurrence:=month_date+least(b.due_day,extract(day from (month_date+interval '1 month - 1 day'))::int)-1;
  if source_start is not null and occurrence<source_start then
   month_date:=(month_date+interval '1 month')::date;
   occurrence:=month_date+least(b.due_day,extract(day from (month_date+interval '1 month - 1 day'))::int)-1;
  end if;
 else
  occurrence:=private.planned_transfer_date(coalesce(nullif(b.next_payment_date,''),nullif(b.start_date,'')));
  month_date:=date_trunc('month',occurrence::timestamp)::date;
 end if;
 if occurrence<first_date then
  select count(*) into matching_paid_rows from public.monthly_overrides x where x.bill_id=b.id and (x.household_id=p_household_id or (x.household_id is null and x.user_id=any(legacy_owner_ids))) and x.year=extract(year from occurrence)::int and x.month=extract(month from occurrence)::int-1;
  if matching_paid_rows>1 then raise exception 'Review duplicate bill payment records before changing it to a transfer'; end if;
  select x.* into o from public.monthly_overrides x where x.bill_id=b.id and (x.household_id=p_household_id or (x.household_id is null and x.user_id=any(legacy_owner_ids))) and x.year=extract(year from occurrence)::int and x.month=extract(month from occurrence)::int-1;
  if (b.is_recurring and month_date<>this_month) or matching_paid_rows<>1 or o.paid_date is null or o.paid_date>local_today
   or (o.actual_amount is null and coalesce(o.paid_amount,0)+0.005<coalesce(o.custom_amount,b.amount))
  then raise exception 'Settle this bill''s unpaid payments before changing it to a transfer'; end if;
  if b.is_recurring then
   month_date:=(month_date+interval '1 month')::date;
   next_occurrence:=month_date+least(b.due_day,extract(day from (month_date+interval '1 month - 1 day'))::int)-1;
   if next_occurrence<first_date then raise exception 'Choose a first transfer before the next unpaid bill payment'; end if;
  end if;
 end if;
 saved:=private.save_planned_account_transfer(p_household_id,p_budget_id,transfer_id,null,p_patch);
 update public.bills set end_date=cutoff::text where id=b.id returning * into b;
 update public.planned_account_transfers set source_bill_id=b.id,last_intent=last_intent||jsonb_build_object('bill_conversion',receipt)
  where id=transfer_id returning * into t;
 return jsonb_build_object('bill',to_jsonb(b),'transfer',to_jsonb(t)-'last_intent','retry',false);
end;
$$;
create function public.convert_bill_to_planned_transfer(
 p_household_id uuid,p_budget_id uuid,p_bill_id text,p_expected jsonb,p_patch jsonb
) returns jsonb language sql volatile security invoker set search_path='' as $$
 select private.convert_bill_to_planned_transfer(p_household_id,p_budget_id,p_bill_id,p_expected,p_patch)
$$;
revoke all on function private.convert_bill_to_planned_transfer(uuid,uuid,text,jsonb,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.convert_bill_to_planned_transfer(uuid,uuid,text,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.convert_bill_to_planned_transfer(uuid,uuid,text,jsonb,jsonb) to authenticated;
grant execute on function public.convert_bill_to_planned_transfer(uuid,uuid,text,jsonb,jsonb) to authenticated;

-- Retired source schedules cannot be reactivated through a different editor,
-- old client, or a direct ordinary Bill/override/matching write. Metadata from
-- a bank remains free to refresh; no historical evidence is changed here.
create function private.guard_planned_transfer_source_link() returns trigger
 language plpgsql security definer set search_path='' as $$
declare b public.bills%rowtype;
begin
 -- An authorized whole-parent cascade may remove sibling Bill/plan rows in
 -- either order. Global definer reads cannot mistake RLS hiding for absence.
 if tg_op<>'INSERT' and old.source_bill_id is not null and (
  not exists(select 1 from public.households where id=old.household_id)
  or not exists(select 1 from public.budgets where id=old.budget_id)) then
  if tg_op='DELETE' then return old; else return new; end if;
 end if;
 if tg_op='DELETE' then
  if old.source_bill_id is not null then raise exception 'Keep the converted bill history; remove the transfer using its normal controls'; end if;
  return old;
 end if;
 if tg_op='UPDATE' and old.source_bill_id is not null then
  if new.source_bill_id is distinct from old.source_bill_id or new.id is distinct from old.id
   or new.household_id is distinct from old.household_id or new.budget_id is distinct from old.budget_id then
   raise exception 'A transfer''s source bill history cannot be changed'; end if;
 elsif new.source_bill_id is not null then
  select * into b from public.bills where id=new.source_bill_id and household_id=new.household_id and budget_id=new.budget_id;
  if not found or b.end_date is null or new.id<>'bill-transfer-'||md5(new.household_id::text||':'||new.budget_id::text||':'||b.id)
   or new.last_intent->'bill_conversion'->>'bill_id' is distinct from b.id
   or new.last_intent->'bill_conversion'->>'cutoff' is distinct from b.end_date
   or new.last_intent->>'actor' is distinct from auth.uid()::text
  then raise exception 'A source bill can only be linked by its confirmed conversion'; end if;
 end if;
 return new;
end;$$;
create trigger planned_transfer_source_link_immutable before insert or update or delete on public.planned_account_transfers
 for each row execute function private.guard_planned_transfer_source_link();

create function private.guard_converted_bill_history() returns trigger
 language plpgsql security definer set search_path='' as $$
declare target text; cutoff text; occurrence date; bill_due_day integer; source_household uuid; same_payload boolean; k text;
 fields constant text[]:=array['is_debt','due_day','day_of_week','next_payment_date','start_date','end_date','is_recurring','frequency'];
begin
 if tg_table_name='bills' then
  if tg_op='INSERT' then
   if exists(select 1 from public.planned_account_transfers where source_bill_id=new.id) then
    raise exception 'A converted bill cannot be recreated. Edit its transfer instead'; end if;
   return new;
  end if;
  if tg_op='DELETE' then return old; end if;
  if not exists(select 1 from public.planned_account_transfers where source_bill_id=old.id) then
   if tg_op='DELETE' then return old; else return new; end if;
  end if;
  if (old.household_id is not null and not exists(select 1 from public.households where id=old.household_id))
   or (old.budget_id is not null and not exists(select 1 from public.budgets where id=old.budget_id)) then
   if tg_op='DELETE' then return old; else return new; end if;
  end if;
  foreach k in array fields loop
   if to_jsonb(new)->k is distinct from to_jsonb(old)->k then
    raise exception 'This bill was changed to a transfer. Edit the transfer instead'; end if;
  end loop;
  if new.id is distinct from old.id or new.household_id is distinct from old.household_id or new.budget_id is distinct from old.budget_id then
   raise exception 'This bill''s saved history cannot be moved'; end if;
  return new;
 end if;
 -- Corrections and Undo to historical settlements/moves remain ordinary writes.
 -- They may restore a past outstanding obligation; never erase that obligation.
 if tg_op='DELETE' then return old; end if;
 target:=new.bill_id;
 select b.end_date,b.due_day,p.household_id into cutoff,bill_due_day,source_household from public.planned_account_transfers p join public.bills b on b.id=p.source_bill_id
  where p.source_bill_id=target;
 if not found then return new; end if;
 if tg_op='UPDATE' then
  same_payload:=(to_jsonb(new)-array['household_id','budget_id','user_id','created_at','updated_at'])
   =(to_jsonb(old)-array['household_id','budget_id','user_id','created_at','updated_at']);
  if same_payload and not private.bill_transfer_evidence_admitted(source_household,new.household_id,new.user_id) then return new; end if;
 end if;
 if tg_table_name='monthly_overrides' then
  if coalesce(new.custom_due_day,bill_due_day) not between 1 and 31 then raise exception 'Choose a valid bill date'; end if;
  occurrence:=make_date(new.year,new.month+1,1);
  occurrence:=occurrence+least(coalesce(new.custom_due_day,bill_due_day),extract(day from (occurrence+interval '1 month - 1 day'))::int)-1;
  if occurrence::text>cutoff then raise exception 'This bill was changed to a transfer. Edit future dates in the transfer'; end if;
 else
  if not new.is_skipped and (new.from_date::text>cutoff or new.to_date::text>cutoff) then
   raise exception 'This bill was changed to a transfer. Edit future dates in the transfer'; end if;
 end if;
 return new;
end;$$;
create trigger converted_bill_readonly before insert or update or delete on public.bills
 for each row execute function private.guard_converted_bill_history();
create trigger converted_bill_override_readonly before insert or update or delete on public.monthly_overrides
 for each row execute function private.guard_converted_bill_history();
create trigger converted_bill_move_readonly before insert or update or delete on public.bill_date_moves
 for each row execute function private.guard_converted_bill_history();

create function private.guard_converted_bill_matching() returns trigger
 language plpgsql security definer set search_path='' as $$
declare allocation jsonb; target text; occurrence text; cutoff text; source_household uuid; old_binding jsonb; new_binding jsonb; same_binding boolean:=false; was_active boolean; now_active boolean;
begin
 if tg_table_name='pending_plan_matches' then
  if new.target_type='bill' and new.status in('active','ready_review') then
   select b.end_date,p.household_id into cutoff,source_household from public.planned_account_transfers p join public.bills b on b.id=p.source_bill_id
    where p.source_bill_id=new.target_id;
   if found and (new.occurrence_date is null or new.occurrence_date::text>cutoff) then
    if tg_op='UPDATE' and row(new.target_type,new.target_id,new.occurrence_date,new.pending_plaid_transaction_id)
      is not distinct from row(old.target_type,old.target_id,old.occurrence_date,old.pending_plaid_transaction_id)
      and not private.bill_transfer_evidence_admitted(source_household,new.household_id,new.user_id) then return new; end if;
    raise exception 'This bill was changed to a transfer. Review the transfer instead'; end if;
  end if;
  return new;
 end if;
 if tg_table_name='transactions' then
  -- Bank metadata/observed amounts do not change a Bill binding. A scope hop
  -- or restoration to active Activity must still validate newly exposed links.
  new_binding:=jsonb_build_array(new.linked_bill_id,new.debt_applied_bill_id,to_jsonb(new)->'matched_occurrence_date',new.review_allocations);
  now_active:=new.removed_at is null and new.deleted_at is null and new.pending is not true;
  if tg_op='UPDATE' then
   old_binding:=jsonb_build_array(old.linked_bill_id,old.debt_applied_bill_id,to_jsonb(old)->'matched_occurrence_date',old.review_allocations);
   same_binding:=new_binding=old_binding;
   was_active:=old.removed_at is null and old.deleted_at is null and old.pending is not true;
   if was_active and not now_active then return new; end if;
   if same_binding and not (now_active and not was_active)
    and new.household_id is not distinct from old.household_id
    and new.budget_id is not distinct from old.budget_id
    and (new.household_id is not null or new.user_id is not distinct from old.user_id) then return new; end if;
  end if;
  foreach target in array array[new.linked_bill_id,new.debt_applied_bill_id] loop
   select b.end_date,p.household_id into cutoff,source_household from public.planned_account_transfers p join public.bills b on b.id=p.source_bill_id where p.source_bill_id=target;
   occurrence:=coalesce(to_jsonb(new)->>'matched_occurrence_date',new.date);
   if found and (occurrence is null or occurrence>cutoff) then
    if same_binding and not private.bill_transfer_evidence_admitted(source_household,new.household_id,new.user_id) then continue; end if;
    raise exception 'This bill was changed to a transfer. Match future activity to the transfer instead'; end if;
  end loop;
  for allocation in select * from jsonb_array_elements(case when jsonb_typeof(new.review_allocations)='array' then new.review_allocations else '[]'::jsonb end) loop
   select b.end_date,p.household_id into cutoff,source_household from public.planned_account_transfers p join public.bills b on b.id=p.source_bill_id where allocation->>'type'='bill' and p.source_bill_id=allocation->>'targetId';
   if found and (allocation->>'occurrenceDate' is null or allocation->>'occurrenceDate'>cutoff) then
    if same_binding and not private.bill_transfer_evidence_admitted(source_household,new.household_id,new.user_id) then continue; end if;
    raise exception 'This bill was changed to a transfer. Match future activity to the transfer instead'; end if;
  end loop;
 else
  if tg_op='UPDATE' then same_binding:=row(new.resolution,new.target_id,new.occurrence_date,new.allocations) is not distinct from row(old.resolution,old.target_id,old.occurrence_date,old.allocations); end if;
  select b.end_date,p.household_id into cutoff,source_household from public.planned_account_transfers p join public.bills b on b.id=p.source_bill_id where new.resolution='bill' and p.source_bill_id=new.target_id;
  if found and (new.occurrence_date is null or new.occurrence_date::text>cutoff) then
   if not (same_binding and not private.bill_transfer_evidence_admitted(source_household,new.household_id,new.user_id)) then
    raise exception 'This bill was changed to a transfer. Review the transfer instead'; end if;
  end if;
  for allocation in select * from jsonb_array_elements(case when jsonb_typeof(new.allocations)='array' then new.allocations else '[]'::jsonb end) loop
   select b.end_date,p.household_id into cutoff,source_household from public.planned_account_transfers p join public.bills b on b.id=p.source_bill_id where allocation->>'type'='bill' and p.source_bill_id=allocation->>'targetId';
   if found and (allocation->>'occurrenceDate' is null or allocation->>'occurrenceDate'>cutoff) then
    if same_binding and not private.bill_transfer_evidence_admitted(source_household,new.household_id,new.user_id) then continue; end if;
    raise exception 'This bill was changed to a transfer. Review the transfer instead'; end if;
  end loop;
 end if;
 return new;
end;$$;
create trigger converted_bill_future_transaction_guard before insert or update on public.transactions
 for each row execute function private.guard_converted_bill_matching();
create trigger converted_bill_future_reconciliation_guard before insert or update on public.transaction_reconciliations
 for each row execute function private.guard_converted_bill_matching();
create trigger converted_bill_pending_match_guard before insert or update on public.pending_plan_matches
 for each row execute function private.guard_converted_bill_matching();
revoke all on function private.guard_planned_transfer_source_link() from public,anon,authenticated,service_role;
revoke all on function private.guard_converted_bill_history() from public,anon,authenticated,service_role;
revoke all on function private.guard_converted_bill_matching() from public,anon,authenticated,service_role;
