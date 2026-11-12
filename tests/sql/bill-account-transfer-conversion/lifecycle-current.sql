-- Exact existing lifecycle function bodies from catalog-only snapshot.
CREATE OR REPLACE FUNCTION private.account_deletion_user_hash(p_user_id uuid)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE STRICT
 SET search_path TO ''
AS $function$
  select encode(extensions.digest(convert_to(p_user_id::text, 'UTF8'), 'sha256'), 'hex')
$function$
;
CREATE OR REPLACE FUNCTION private.reassign_shared_plan_ownership(p_household_id uuid, p_from_user_id uuid, p_to_user_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_item record;
  v_rows integer := 0;
  v_total integer := 0;
  v_prior_transfer_flag text := current_setting('flowledger.shared_plan_owner_transfer', true);
begin
  if p_household_id is null or p_from_user_id is null or p_to_user_id is null
     or p_from_user_id = p_to_user_id then
    raise exception using errcode = '22023', message = 'shared_plan_owner_transfer_invalid';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_household_id::text || ':shared-plan-owner', 0)
  );
  perform 1
  from public.household_members member
  where member.household_id = p_household_id
    and member.user_id = p_to_user_id
  for update;
  if not found then
    raise exception using errcode = '23503', message = 'shared_plan_surviving_member_missing';
  end if;

  perform set_config('flowledger.shared_plan_owner_transfer', 'on', true);

  for v_item in
    select * from (values
      ('accounts', 'user_id'), ('account_balances', 'user_id'),
      ('bills', 'user_id'), ('transactions', 'user_id'),
      ('incomes', 'user_id'), ('goals', 'user_id'),
      ('extra_payments', 'user_id'), ('categories', 'user_id'),
      ('category_budgets', 'user_id'), ('decisions', 'user_id'),
      ('monthly_overrides', 'user_id'), ('bill_date_moves', 'user_id'),
      ('subscription_bill_links', 'user_id'),
      ('bill_transaction_matches', 'user_id'),
      ('transaction_reconciliations', 'user_id')
    ) as allowed(table_name, column_name)
  loop
    if to_regclass(format('public.%I', v_item.table_name)) is not null then
      execute format(
        'update public.%I set %I = $1 where %I = $2 and household_id = $3',
        v_item.table_name,
        v_item.column_name,
        v_item.column_name
      ) using p_to_user_id, p_from_user_id, p_household_id;
      get diagnostics v_rows = row_count;
      v_total := v_total + v_rows;
    end if;
  end loop;
  perform set_config(
    'flowledger.shared_plan_owner_transfer',
    coalesce(v_prior_transfer_flag, ''),
    true
  );
  return v_total;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.prepare_account_deletion(p_user_id uuid, p_plaid_items_revoked integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_hash text;
  v_receipt private.account_deletion_receipts%rowtype;
  v_owned_count integer := 0;
  v_membership_count integer := 0;
  v_deleted_count integer := 0;
  v_preserved_count integer := 0;
  v_shared_household uuid;
  v_shared_owner uuid;
  v_rows integer;
  v_fk record;
begin
  if p_user_id is null or (select auth.role()) <> 'service_role' then
    raise exception using errcode = '42501', message = 'account_deletion_access_denied';
  end if;
  if coalesce(p_plaid_items_revoked, 0) < 0 then
    raise exception using errcode = '22023', message = 'account_deletion_plaid_count_invalid';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 918273));
  v_hash := private.account_deletion_user_hash(p_user_id);
  select * into v_receipt
  from private.account_deletion_receipts
  where user_id_hash = v_hash
  for update;
  -- A completed receipt is terminal. A data-deleted receipt is deliberately
  -- not terminal: Auth deletion may have failed, and that still-authenticated
  -- user could have recreated memberships or rows before the server retries.
  if found and v_receipt.auth_deleted_at is not null then
    return jsonb_build_object(
      'receiptId', v_receipt.receipt_id, 'status', v_receipt.status,
      'requestedAt', v_receipt.requested_at,
      'dataDeletedAt', v_receipt.data_deleted_at,
      'authDeletedAt', v_receipt.auth_deleted_at,
      'plaidItemsRevoked', v_receipt.plaid_items_revoked,
      'ownedHouseholdsDeleted', v_receipt.owned_households_deleted,
      'membershipsRemoved', v_receipt.memberships_removed
    );
  end if;

  if exists (
    select 1 from public.households household
    where household.created_by = p_user_id
      and exists (
        select 1 from public.household_members survivor
        where survivor.household_id = household.id
          and survivor.user_id <> p_user_id
      )
  ) then
    raise exception using errcode = 'P0001', message = 'account_deletion_owner_transfer_required';
  end if;
  if exists (
    select 1 from public.plaid_items item
    where (item.user_id = p_user_id or exists (
      select 1 from public.households household
      where household.id = item.household_id and household.created_by = p_user_id
    ))
    and (item.status is distinct from 'removed'
      or item.encrypted_access_token is not null
      or item.access_token_ciphertext is not null)
  ) then
    raise exception using errcode = 'P0001', message = 'account_deletion_plaid_disconnect_required';
  end if;

  select count(*)::integer into v_owned_count
  from public.households where created_by = p_user_id;
  select count(*)::integer into v_membership_count
  from public.household_members where user_id = p_user_id;
  if v_receipt.receipt_id is null then
    insert into private.account_deletion_receipts (
      user_id_hash, status, plaid_items_revoked,
      owned_households_deleted, memberships_removed
    ) values (
      v_hash, 'data_deleted', coalesce(p_plaid_items_revoked, 0),
      v_owned_count, v_membership_count
    ) returning * into v_receipt;
  else
    update private.account_deletion_receipts receipt
    set status = 'data_deleted',
      data_deleted_at = now(),
      plaid_items_revoked =
        receipt.plaid_items_revoked + coalesce(p_plaid_items_revoked, 0),
      owned_households_deleted =
        receipt.owned_households_deleted + v_owned_count,
      memberships_removed = receipt.memberships_removed + v_membership_count
    where receipt.receipt_id = v_receipt.receipt_id
    returning * into v_receipt;
  end if;

  for v_shared_household in
    select distinct owned.household_id
    from (
      select household_id from public.accounts where user_id = p_user_id
      union all select household_id from public.account_balances where user_id = p_user_id
      union all select household_id from public.bills where user_id = p_user_id
      union all select household_id from public.transactions where user_id = p_user_id
      union all select household_id from public.incomes where user_id = p_user_id
      union all select household_id from public.goals where user_id = p_user_id
      union all select household_id from public.extra_payments where user_id = p_user_id
      union all select household_id from public.categories where user_id = p_user_id
      union all select household_id from public.category_budgets where user_id = p_user_id
      union all select household_id from public.decisions where user_id = p_user_id
      union all select household_id from public.monthly_overrides where user_id = p_user_id
      union all select household_id from public.bill_date_moves where user_id = p_user_id
      union all select household_id from public.subscription_bill_links where user_id = p_user_id
      union all select household_id from public.bill_transaction_matches where user_id = p_user_id
      union all select household_id from public.transaction_reconciliations where user_id = p_user_id
    ) owned
    where owned.household_id is not null
      and exists (
        select 1 from public.household_members survivor
        where survivor.household_id = owned.household_id
          and survivor.user_id <> p_user_id
      )
    order by owned.household_id
  loop
    perform pg_advisory_xact_lock(
      hashtextextended(v_shared_household::text || ':shared-plan-owner', 0)
    );
    select survivor.user_id into v_shared_owner
    from public.household_members survivor
    where survivor.household_id = v_shared_household
      and survivor.user_id <> p_user_id
    order by case survivor.role when 'owner' then 0 when 'manager' then 1 when 'editor' then 2 else 3 end,
      survivor.created_at,
      survivor.user_id
    limit 1
    for update;
    v_preserved_count := v_preserved_count
      + private.reassign_shared_plan_ownership(
        v_shared_household,
        p_user_id,
        v_shared_owner
      );
  end loop;

  if to_regclass('public.billing_purchase_bindings') is not null
     and to_regclass('public.billing_entitlements') is not null
     and to_regclass('public.household_plans') is not null then
    execute $billing_cleanup$
      update public.household_plans plan
      set tier = 'free', source = 'default', updated_at = now()
      where plan.source = 'billing'
        and exists (
          select 1 from public.billing_purchase_bindings departing
          where departing.household_id = plan.household_id
            and departing.purchaser_user_id = $1
        )
        and not exists (
          select 1 from public.billing_entitlements entitlement
          join public.billing_purchase_bindings binding on binding.id = entitlement.binding_id
          where entitlement.household_id = plan.household_id
            and binding.purchaser_user_id <> $1
            and binding.active
            and entitlement.status in ('active', 'grace', 'cancelled')
            and (entitlement.expires_at is null
              or entitlement.expires_at > now()
              or entitlement.grace_ends_at > now())
        )
    $billing_cleanup$ using p_user_id;
  end if;

  for v_fk in
    select distinct n.nspname as schema_name, table_class.relname as table_name,
      attribute.attname as column_name
    from pg_constraint constraint_row
    join pg_class table_class on table_class.oid = constraint_row.conrelid
    join pg_namespace n on n.oid = table_class.relnamespace
    join pg_attribute attribute on attribute.attrelid = table_class.oid
      and attribute.attnum = constraint_row.conkey[1]
    where constraint_row.contype = 'f'
      and constraint_row.confrelid = 'auth.users'::regclass
      and array_length(constraint_row.conkey, 1) = 1
      and constraint_row.confdeltype in ('c', 'r')
      and n.nspname = 'public'
    order by n.nspname, table_class.relname, attribute.attname
  loop
    execute format('delete from %I.%I where %I = $1',
      v_fk.schema_name, v_fk.table_name, v_fk.column_name)
    using p_user_id;
    get diagnostics v_rows = row_count;
    v_deleted_count := v_deleted_count + v_rows;
  end loop;

  return jsonb_build_object(
    'receiptId', v_receipt.receipt_id, 'status', v_receipt.status,
    'requestedAt', v_receipt.requested_at,
    'dataDeletedAt', v_receipt.data_deleted_at,
    'plaidItemsRevoked', v_receipt.plaid_items_revoked,
    'ownedHouseholdsDeleted', v_receipt.owned_households_deleted,
    'membershipsRemoved', v_receipt.memberships_removed,
    'sharedRowsPreserved', v_preserved_count,
    'applicationRowsDeleted', v_deleted_count
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.prepare_account_deletion(p_user_id uuid, p_plaid_items_revoked integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$ select private.prepare_account_deletion(p_user_id, p_plaid_items_revoked) $function$
;
revoke all on function private.prepare_account_deletion(uuid,integer),public.prepare_account_deletion(uuid,integer) from public,anon,authenticated;
grant execute on function private.prepare_account_deletion(uuid,integer),public.prepare_account_deletion(uuid,integer) to service_role;
