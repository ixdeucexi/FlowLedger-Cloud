-- Metadata-only captures from FlowLedger, 2026-10-28; no customer rows.
CREATE OR REPLACE FUNCTION public.assign_personal_budget()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.household_id is null or new.budget_id is null then
    select h.id, b.id into new.household_id, new.budget_id
      from households h join budgets b on b.household_id = h.id and b.is_default
      where h.created_by = new.user_id and h.is_personal limit 1;
  end if;
  return new;
end $function$
;
CREATE OR REPLACE FUNCTION public.preserve_reconciled_bill_link()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_bill_id text;
begin
  if new.review_status = 'matched'
    and new.review_resolution = 'bill'
    and new.match_reason = 'confirmed_bill_match'
  then
    select allocation ->> 'targetId'
      into v_bill_id
    from jsonb_array_elements(coalesce(new.review_allocations, '[]'::jsonb)) as allocation
    where allocation ->> 'type' = 'bill'
      and nullif(allocation ->> 'targetId', '') is not null
    limit 1;

    new.linked_bill_id := coalesce(new.linked_bill_id, v_bill_id);
    if new.linked_bill_id is not null then
      new.match_confidence := 1;
    end if;
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.protect_transaction_review_state()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if current_user in ('postgres', 'service_role') then return new; end if;
  if tg_op = 'INSERT' then
    if new.review_status <> 'legacy_reviewed'
      or new.review_resolution is not null
      or new.review_allocations <> '[]'::jsonb
      or new.reviewed_at is not null
      or new.reviewed_by is not null
      or new.linked_income_id is not null
      or new.linked_plan_id is not null
      or new.linked_plan_type is not null
      or new.matched_occurrence_date is not null then
      raise exception 'Review state must be changed through Review Center';
    end if;
  elsif row(
    new.review_status, new.review_resolution, new.review_allocations,
    new.reviewed_at, new.reviewed_by, new.linked_income_id,
    new.linked_plan_id, new.linked_plan_type, new.matched_occurrence_date
  ) is distinct from row(
    old.review_status, old.review_resolution, old.review_allocations,
    old.reviewed_at, old.reviewed_by, old.linked_income_id,
    old.linked_plan_id, old.linked_plan_type, old.matched_occurrence_date
  ) then
    raise exception 'Review state must be changed through Review Center';
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.household_activity_audit_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  source_row jsonb;
  previous_row jsonb;
  target_household uuid;
  actor_id uuid;
  action_name text;
  item_id text;
  item_label text;
begin
  if tg_op = 'DELETE' then
    source_row := to_jsonb(old);
    action_name := 'deleted';
  elsif tg_op = 'INSERT' then
    source_row := to_jsonb(new);
    action_name := 'created';
  else
    source_row := to_jsonb(new);
    previous_row := to_jsonb(old);
    action_name := 'updated';

    -- Timestamp/review heartbeats are maintenance, not household edits.
    if (
      source_row - array[
        'updated_at',
        'last_reviewed_at',
        'synced_at',
        'last_synced_at',
        'last_reconciled_at',
        'provider_updated_at'
      ]
    ) = (
      previous_row - array[
        'updated_at',
        'last_reviewed_at',
        'synced_at',
        'last_synced_at',
        'last_reconciled_at',
        'provider_updated_at'
      ]
    ) then
      return new;
    end if;
  end if;

  if nullif(source_row->>'household_id', '') is null then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  -- Never credit a background/service update to the user who originally
  -- created the row. Only an authenticated member can appear as the actor.
  actor_id := auth.uid();
  if actor_id is null then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  target_household := (source_row->>'household_id')::uuid;
  item_id := coalesce(source_row->>'id', source_row->>'bill_id', source_row->>'account_id', source_row->>'user_id');
  item_label := coalesce(
    source_row->>'name',
    nullif(source_row->>'note', ''),
    nullif(source_row->>'category', ''),
    initcap(replace(tg_table_name, '_', ' '))
  );

  if tg_table_name = 'monthly_overrides' then
    item_label := 'Monthly bill update';
  elsif tg_table_name = 'extra_payments' then
    item_label := 'Debt snowball payment';
  elsif tg_table_name = 'bill_date_moves' then
    item_label := 'Bill date move';
  elsif tg_table_name = 'account_balances' then
    item_label := 'Account balance';
  end if;

  -- Creating an item can be followed by an initialization update in the
  -- same user action. Keep the creation as the single visible activity.
  if action_name = 'updated'
     and item_id is not null
     and exists (
       select 1
       from public.household_activity a
       where a.household_id = target_household
         and a.actor_user_id = actor_id
         and a.action = 'created'
         and a.entity_type = tg_table_name
         and a.entity_id = item_id
         and a.created_at >= clock_timestamp() - interval '2 minutes'
     ) then
    return new;
  end if;

  perform public.log_household_activity(
    target_household,
    action_name,
    tg_table_name,
    item_id,
    item_label,
    actor_id
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
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
 if tg_op='UPDATE' and row(new.amount,new.date) is distinct from row(old.amount,old.date)
  and (old.linked_income_id is not null or old.linked_plan_id is not null
   or ((old.source='plaid' or old.import_hash is not null or old.review_status='matched')
    and (old.linked_bill_id is not null or old.debt_applied_bill_id is not null or coalesce(old.debt_applied_amount,0)<>0))
   or coalesce(old.review_resolution,'category') not in('category','transfer')
   or private.has_financial_transaction_reconciliation(old.id,old.household_id)
   or exists(select 1 from jsonb_array_elements(old.review_allocations) a where coalesce(a->>'type','') not in('category','transfer'))) then
  raise exception 'Undo this transaction match before changing its amount or date';
 end if;
 return case when tg_op='DELETE' then old else new end;
end;
$function$
;
