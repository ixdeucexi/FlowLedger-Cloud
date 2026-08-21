-- Store-compliant self-service account deletion. Privileged implementations
-- stay in the unexposed private schema and are callable only by service_role.

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to service_role;

create table if not exists private.account_deletion_receipts (
  receipt_id uuid primary key default gen_random_uuid(),
  user_id_hash text not null unique,
  status text not null check (status in ('data_deleted', 'completed')),
  requested_at timestamptz not null default now(),
  data_deleted_at timestamptz not null default now(),
  auth_deleted_at timestamptz,
  plaid_items_revoked integer not null default 0 check (plaid_items_revoked >= 0),
  owned_households_deleted integer not null default 0 check (owned_households_deleted >= 0),
  memberships_removed integer not null default 0 check (memberships_removed >= 0)
);

revoke all on table private.account_deletion_receipts from public, anon, authenticated;
grant select, insert, update on table private.account_deletion_receipts to service_role;

create or replace function private.account_deletion_user_hash(p_user_id uuid)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select encode(extensions.digest(convert_to(p_user_id::text, 'UTF8'), 'sha256'), 'hex')
$$;

revoke all on function private.account_deletion_user_hash(uuid) from public, anon, authenticated;
grant execute on function private.account_deletion_user_hash(uuid) to service_role;

create or replace function private.verify_recent_account_deletion_session(
  p_user_id uuid,
  p_session_id uuid,
  p_max_age_seconds integer default 600
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_user_id is null
      or p_session_id is null
      or (select auth.role()) <> 'service_role'
      or p_max_age_seconds < 60
      or p_max_age_seconds > 600
    then false
    else exists (
      select 1
      from auth.sessions s
      where s.id = p_session_id
        and s.user_id = p_user_id
        and s.created_at >= now() - make_interval(secs => p_max_age_seconds)
        and (s.not_after is null or s.not_after > now())
    )
  end
$$;

revoke all on function private.verify_recent_account_deletion_session(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function private.verify_recent_account_deletion_session(uuid, uuid, integer) to service_role;

create or replace function private.inspect_account_deletion(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_blocked jsonb;
  v_plaid_count integer;
begin
  if p_user_id is null or (select auth.role()) <> 'service_role' then
    raise exception using errcode = '42501', message = 'account_deletion_access_denied';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'householdId', owned.id,
    'name', coalesce(nullif(btrim(owned.name), ''), 'Shared household'),
    'memberCount', owned.member_count
  ) order by owned.name), '[]'::jsonb)
  into v_blocked
  from (
    select h.id, h.name, count(hm.user_id)::integer as member_count
    from public.households h
    left join public.household_members hm on hm.household_id = h.id
    where h.created_by = p_user_id
    group by h.id, h.name
    having count(hm.user_id) > 1
  ) owned;

  select count(*)::integer into v_plaid_count
  from public.plaid_items pi
  where pi.user_id = p_user_id
     or exists (
       select 1 from public.households h
       where h.id = pi.household_id and h.created_by = p_user_id
     );

  return jsonb_build_object(
    'blockedHouseholds', v_blocked,
    'plaidItemCount', v_plaid_count
  );
end;
$$;

revoke all on function private.inspect_account_deletion(uuid) from public, anon, authenticated;
grant execute on function private.inspect_account_deletion(uuid) to service_role;

create or replace function private.prepare_account_deletion(
  p_user_id uuid,
  p_plaid_items_revoked integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
  v_receipt private.account_deletion_receipts%rowtype;
  v_owned_count integer := 0;
  v_membership_count integer := 0;
  v_deleted_count integer := 0;
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
  where user_id_hash = v_hash;
  if found then
    return jsonb_build_object(
      'receiptId', v_receipt.receipt_id,
      'status', v_receipt.status,
      'requestedAt', v_receipt.requested_at,
      'dataDeletedAt', v_receipt.data_deleted_at,
      'authDeletedAt', v_receipt.auth_deleted_at,
      'plaidItemsRevoked', v_receipt.plaid_items_revoked,
      'ownedHouseholdsDeleted', v_receipt.owned_households_deleted,
      'membershipsRemoved', v_receipt.memberships_removed
    );
  end if;

  if exists (
    select 1
    from public.households h
    join public.household_members hm on hm.household_id = h.id
    where h.created_by = p_user_id
    group by h.id
    having count(hm.user_id) > 1
  ) then
    raise exception using errcode = 'P0001', message = 'account_deletion_owner_transfer_required';
  end if;

  if exists (
    select 1 from public.plaid_items pi
    where (
      pi.user_id = p_user_id
      or exists (
        select 1 from public.households h
        where h.id = pi.household_id and h.created_by = p_user_id
      )
    )
    and (
      pi.status is distinct from 'removed'
      or pi.encrypted_access_token is not null
      or pi.access_token_ciphertext is not null
    )
  ) then
    raise exception using errcode = 'P0001', message = 'account_deletion_plaid_disconnect_required';
  end if;

  select count(*)::integer into v_owned_count
  from public.households where created_by = p_user_id;
  select count(*)::integer into v_membership_count
  from public.household_members where user_id = p_user_id;

  insert into private.account_deletion_receipts (
    user_id_hash,
    status,
    plaid_items_revoked,
    owned_households_deleted,
    memberships_removed
  ) values (
    v_hash,
    'data_deleted',
    coalesce(p_plaid_items_revoked, 0),
    v_owned_count,
    v_membership_count
  )
  returning * into v_receipt;

  -- Delete every row that would otherwise cascade or block Auth deletion.
  -- SET NULL audit/attribution references are deliberately left for the final
  -- Auth deletion so retained records no longer identify the deleted account.
  for v_fk in
    select distinct
      n.nspname as schema_name,
      t.relname as table_name,
      a.attname as column_name
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    join pg_attribute a on a.attrelid = t.oid and a.attnum = c.conkey[1]
    where c.contype = 'f'
      and c.confrelid = 'auth.users'::regclass
      and array_length(c.conkey, 1) = 1
      and c.confdeltype in ('c', 'r')
      and n.nspname = 'public'
    order by n.nspname, t.relname, a.attname
  loop
    execute format('delete from %I.%I where %I = $1', v_fk.schema_name, v_fk.table_name, v_fk.column_name)
      using p_user_id;
    get diagnostics v_rows = row_count;
    v_deleted_count := v_deleted_count + v_rows;
  end loop;

  return jsonb_build_object(
    'receiptId', v_receipt.receipt_id,
    'status', v_receipt.status,
    'requestedAt', v_receipt.requested_at,
    'dataDeletedAt', v_receipt.data_deleted_at,
    'plaidItemsRevoked', v_receipt.plaid_items_revoked,
    'ownedHouseholdsDeleted', v_receipt.owned_households_deleted,
    'membershipsRemoved', v_receipt.memberships_removed,
    'applicationRowsDeleted', v_deleted_count
  );
end;
$$;

revoke all on function private.prepare_account_deletion(uuid, integer) from public, anon, authenticated;
grant execute on function private.prepare_account_deletion(uuid, integer) to service_role;

create or replace function private.complete_account_deletion(p_receipt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_receipt private.account_deletion_receipts%rowtype;
begin
  if p_receipt_id is null or (select auth.role()) <> 'service_role' then
    raise exception using errcode = '42501', message = 'account_deletion_access_denied';
  end if;

  update private.account_deletion_receipts
  set status = 'completed', auth_deleted_at = coalesce(auth_deleted_at, now())
  where receipt_id = p_receipt_id
  returning * into v_receipt;

  if not found then
    raise exception using errcode = 'P0002', message = 'account_deletion_receipt_missing';
  end if;

  return jsonb_build_object(
    'receiptId', v_receipt.receipt_id,
    'status', v_receipt.status,
    'requestedAt', v_receipt.requested_at,
    'dataDeletedAt', v_receipt.data_deleted_at,
    'authDeletedAt', v_receipt.auth_deleted_at,
    'plaidItemsRevoked', v_receipt.plaid_items_revoked,
    'ownedHouseholdsDeleted', v_receipt.owned_households_deleted,
    'membershipsRemoved', v_receipt.memberships_removed
  );
end;
$$;

revoke all on function private.complete_account_deletion(uuid) from public, anon, authenticated;
grant execute on function private.complete_account_deletion(uuid) to service_role;

-- PostgREST exposes public RPC names only. These wrappers are invokers and are
-- executable solely by service_role; clients cannot invoke privileged cleanup.
create or replace function public.inspect_account_deletion(p_user_id uuid)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.inspect_account_deletion(p_user_id) $$;

create or replace function public.verify_recent_account_deletion_session(
  p_user_id uuid,
  p_session_id uuid,
  p_max_age_seconds integer default 600
)
returns boolean language sql stable security invoker set search_path = ''
as $$ select private.verify_recent_account_deletion_session(p_user_id, p_session_id, p_max_age_seconds) $$;

create or replace function public.prepare_account_deletion(
  p_user_id uuid,
  p_plaid_items_revoked integer default 0
)
returns jsonb language sql volatile security invoker set search_path = ''
as $$ select private.prepare_account_deletion(p_user_id, p_plaid_items_revoked) $$;

create or replace function public.complete_account_deletion(p_receipt_id uuid)
returns jsonb language sql volatile security invoker set search_path = ''
as $$ select private.complete_account_deletion(p_receipt_id) $$;

revoke all on function public.inspect_account_deletion(uuid) from public, anon, authenticated;
revoke all on function public.verify_recent_account_deletion_session(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.prepare_account_deletion(uuid, integer) from public, anon, authenticated;
revoke all on function public.complete_account_deletion(uuid) from public, anon, authenticated;
grant execute on function public.inspect_account_deletion(uuid) to service_role;
grant execute on function public.verify_recent_account_deletion_session(uuid, uuid, integer) to service_role;
grant execute on function public.prepare_account_deletion(uuid, integer) to service_role;
grant execute on function public.complete_account_deletion(uuid) to service_role;

-- Resolve the exposed SECURITY DEFINER advisor finding without weakening the
-- existing authenticated-user, household, active-household, and Pro checks.
alter function public.confirm_flo_recurring_bill_proposal(uuid) set schema private;
revoke all on function private.confirm_flo_recurring_bill_proposal(uuid) from public, anon;
grant execute on function private.confirm_flo_recurring_bill_proposal(uuid) to authenticated, service_role;

create or replace function public.confirm_flo_recurring_bill_proposal(p_proposal_id uuid)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$ select private.confirm_flo_recurring_bill_proposal(p_proposal_id) $$;

revoke all on function public.confirm_flo_recurring_bill_proposal(uuid) from public, anon;
grant execute on function public.confirm_flo_recurring_bill_proposal(uuid) to authenticated;
