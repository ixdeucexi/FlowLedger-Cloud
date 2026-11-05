-- Opt-in metadata for new non-admin connections only. No existing connection,
-- cursor, financial record or administrator is backfilled or updated.
alter table public.plaid_items
  add column initial_import_version smallint,
  add column initial_import_from date,
  add column initial_history_complete_at timestamptz;

alter table public.plaid_items add constraint plaid_items_initial_import_profile_check check (
  (initial_import_version is null and initial_import_from is null and initial_history_complete_at is null)
  or (initial_import_version is not distinct from 1 and initial_import_from is not null
      and initial_import_from between date '2000-01-01' and date '2200-12-31')
);

-- Existing column grants deliberately do not expose these service-managed
-- fields directly. The authenticated status endpoint returns their safe DTO.
revoke insert (initial_import_version, initial_import_from, initial_history_complete_at),
  update (initial_import_version, initial_import_from, initial_history_complete_at)
  on public.plaid_items from anon, authenticated;

notify pgrst, 'reload schema';

-- New-connection review evidence is separate from canonical cash transaction
-- IDs. Legacy rows retain NULL provenance and unchanged review behavior.
alter table public.subscription_candidates
  add column initial_import_version smallint,
  add column initial_import_item_id uuid,
  add column source_plaid_transaction_ids text[];
alter table public.subscription_candidates
  add constraint subscription_candidates_initial_import_provenance check (
    (initial_import_version is null and initial_import_item_id is null and source_plaid_transaction_ids is null)
    or (initial_import_version is not distinct from 1 and initial_import_item_id is not null
      and source_plaid_transaction_ids is not null
      and cardinality(source_plaid_transaction_ids) between 1 and 500)
  );
comment on column public.subscription_candidates.initial_import_item_id is
  'Historical origin validated on write; retained without a foreign key so removing a connection cannot erase review history.';

create or replace function private.validate_new_connection_subscription_provenance()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'UPDATE'
    and new.initial_import_version is not distinct from old.initial_import_version
    and new.initial_import_item_id is not distinct from old.initial_import_item_id
    and new.source_plaid_transaction_ids is not distinct from old.source_plaid_transaction_ids
    and new.source_transaction_ids is not distinct from old.source_transaction_ids
    and new.household_id is not distinct from old.household_id then
    return new;
  end if;
  if new.initial_import_version is null and new.initial_import_item_id is null
    and new.source_plaid_transaction_ids is null then
    if tg_op = 'INSERT' or (old.initial_import_version is null and old.initial_import_item_id is null
      and old.source_plaid_transaction_ids is null) then return new; end if;
  end if;
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then
    raise exception using errcode='42501', message='Connection review evidence is managed by the server';
  end if;
  if new.initial_import_version is distinct from 1
    or not exists(select 1 from public.plaid_items item where item.id=new.initial_import_item_id
      and item.household_id=new.household_id and item.initial_import_version=1
      and item.status in ('active','needs_repair')
      and not exists(select 1 from public.feedback_admins admin where admin.user_id=item.user_id)) then
    raise exception using errcode='22023', message='New connection review evidence requires an eligible connection';
  end if;
  if new.source_plaid_transaction_ids is null
    or cardinality(new.source_plaid_transaction_ids) not between 1 and 500
    or exists(
      select 1 from unnest(new.source_plaid_transaction_ids) source_id
      where source_id is null or not exists(
        select 1 from public.plaid_transactions tx
        join public.plaid_accounts account on account.id=tx.plaid_account_id
        join public.plaid_items item on item.id=account.plaid_item_record_id
        where tx.plaid_transaction_id=source_id and tx.household_id=new.household_id
          and account.household_id=new.household_id and account.is_active
          and item.household_id=new.household_id and item.initial_import_version=1
          and item.status in ('active','needs_repair')
          and not exists(select 1 from public.feedback_admins admin where admin.user_id=item.user_id)
          and not tx.pending and tx.removed_at is null and tx.amount<0
      )
    ) then
    raise exception using errcode='22023', message='Subscription evidence must belong to an eligible connection in this household';
  end if;
  if exists (
    select 1 from unnest(coalesce(new.source_transaction_ids,'{}'::text[])) canonical_id
    where not exists(select 1 from public.plaid_transactions tx
      where tx.household_id=new.household_id and tx.flowledger_transaction_id=canonical_id
        and tx.plaid_transaction_id=any(new.source_plaid_transaction_ids))
  ) then
    raise exception using errcode='22023', message='Canonical subscription evidence must match the retained bank evidence';
  end if;
  return new;
end;
$$;
revoke all on function private.validate_new_connection_subscription_provenance()
from public, anon, authenticated, service_role;
create trigger validate_new_connection_subscription_provenance
before insert or update on public.subscription_candidates
for each row execute function private.validate_new_connection_subscription_provenance();

create or replace function private.merge_new_connection_subscription_candidates(
  p_user_id uuid, p_household_id uuid, p_item_id uuid, p_candidates jsonb
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_candidate record;
  v_saved integer := 0;
  v_count integer;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then
    raise exception using errcode='42501', message='Server access is required';
  end if;
  -- This only writes metadata for an explicitly new, non-admin connection.
  -- Never convert an existing or admin connection to the new policy.
  if not exists(select 1 from public.plaid_items item where item.id=p_item_id
    and item.user_id=p_user_id and item.household_id=p_household_id
    and item.initial_import_version=1 and item.status in ('active','needs_repair'))
    or exists(select 1 from public.feedback_admins admin where admin.user_id=p_user_id) then
    return jsonb_build_object('saved',0,'skipped',true);
  end if;
  if jsonb_typeof(p_candidates) is distinct from 'array' or jsonb_array_length(p_candidates)>500 then
    raise exception using errcode='22023', message='Send a valid batch of subscription review candidates';
  end if;
  for v_candidate in select * from jsonb_to_recordset(p_candidates) as candidate(
    id uuid, merchant text, cadence text, average_amount numeric,
    monthly_equivalent numeric, yearly_equivalent numeric, confidence text,
    source_transaction_ids text[], source_plaid_transaction_ids text[]
  ) loop
    insert into public.subscription_candidates as saved (
      id,user_id,household_id,merchant,cadence,average_amount,monthly_equivalent,
      yearly_equivalent,confidence,status,source_transaction_ids,
      initial_import_version,initial_import_item_id,source_plaid_transaction_ids,updated_at
    ) values (
      v_candidate.id,p_user_id,p_household_id,v_candidate.merchant,v_candidate.cadence,
      v_candidate.average_amount,v_candidate.monthly_equivalent,v_candidate.yearly_equivalent,
      v_candidate.confidence,'review',coalesce(v_candidate.source_transaction_ids,'{}'::text[]),
      1,p_item_id,v_candidate.source_plaid_transaction_ids,now()
    ) on conflict(household_id,merchant_key) do update set
      merchant=excluded.merchant,cadence=excluded.cadence,
      average_amount=excluded.average_amount,monthly_equivalent=excluded.monthly_equivalent,
      yearly_equivalent=excluded.yearly_equivalent,confidence=excluded.confidence,
      source_transaction_ids=excluded.source_transaction_ids,
      initial_import_item_id=excluded.initial_import_item_id,
      source_plaid_transaction_ids=excluded.source_plaid_transaction_ids,updated_at=now()
    where saved.status='review' and saved.bill_id is null and saved.initial_import_version=1;
    get diagnostics v_count = row_count;
    v_saved := v_saved+v_count;
  end loop;
  return jsonb_build_object('saved',v_saved);
end;
$$;
revoke all on function private.merge_new_connection_subscription_candidates(uuid,uuid,uuid,jsonb)
from public,anon,authenticated;
grant execute on function private.merge_new_connection_subscription_candidates(uuid,uuid,uuid,jsonb) to service_role;
create or replace function public.merge_new_connection_subscription_candidates(
  p_user_id uuid,p_household_id uuid,p_item_id uuid,p_candidates jsonb
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.merge_new_connection_subscription_candidates(p_user_id,p_household_id,p_item_id,p_candidates)
$$;
revoke all on function public.merge_new_connection_subscription_candidates(uuid,uuid,uuid,jsonb)
from public,anon,authenticated;
grant execute on function public.merge_new_connection_subscription_candidates(uuid,uuid,uuid,jsonb) to service_role;
