-- Shared financial rows belong to the household, not to the member who first
-- created them. Reassign the legacy technical user_id before a member leaves,
-- is removed, or later deletes their Auth account. Keep attribution,
-- credentials, proposals, notifications, simulations, and billing identities
-- out of this explicit ownership allowlist.

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

-- Membership deletion must pass through the guarded lifecycle RPCs below.
-- Direct owner DELETE previously bypassed plan transfer and provider checks.
drop policy if exists "members: owners delete" on public.household_members;
revoke delete on table public.household_members from anon, authenticated;

-- Legacy uniqueness followed the row creator, so changing technical ownership
-- could collide with an unrelated household owned by the survivor. Household
-- rows now use household identity; the creator key remains only for legacy
-- personal rows. Fail closed before changing the indexes if duplicates exist.
do $$
begin
  if exists (
    select 1 from public.extra_payments payment
    where payment.household_id is not null
    group by payment.household_id,
      coalesce(payment.budget_id, '00000000-0000-0000-0000-000000000000'::uuid),
      payment.year,
      payment.month
    having count(*) > 1
  ) or exists (
    select 1 from public.extra_payments payment
    where payment.household_id is null
    group by payment.user_id, payment.year, payment.month
    having count(*) > 1
  ) then
    raise exception 'extra payment ownership uniqueness preflight failed';
  end if;

  if exists (
    select 1 from public.transactions transaction_row
    where transaction_row.household_id is not null
      and transaction_row.import_hash is not null
    group by transaction_row.household_id, transaction_row.import_hash
    having count(*) > 1
  ) or exists (
    select 1 from public.transactions transaction_row
    where transaction_row.household_id is null
      and transaction_row.import_hash is not null
    group by transaction_row.user_id, transaction_row.import_hash
    having count(*) > 1
  ) then
    raise exception 'transaction import ownership uniqueness preflight failed';
  end if;
end;
$$;

create unique index if not exists extra_payments_household_budget_month_year_idx
  on public.extra_payments (
    household_id,
    coalesce(budget_id, '00000000-0000-0000-0000-000000000000'::uuid),
    year,
    month
  ) where household_id is not null;
drop index if exists public.extra_payments_user_month_year_idx;
create unique index extra_payments_user_month_year_idx
  on public.extra_payments (user_id, year, month)
  where household_id is null;

create unique index if not exists transactions_household_import_hash_unique
  on public.transactions (household_id, import_hash)
  where household_id is not null and import_hash is not null;
drop index if exists public.transactions_user_import_hash_unique;
create unique index transactions_user_import_hash_unique
  on public.transactions (user_id, import_hash)
  where household_id is null and import_hash is not null;

-- Technical owner reassignment is maintenance, not a member-authored financial
-- edit. Suppress the row-level audit fan-out only while the trusted transfer
-- helper's transaction-local flag is set; the single leave/remove activity is
-- still written after the helper restores the prior flag.
create or replace function public.log_household_activity(
  p_household_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id text default null,
  p_entity_label text default null,
  p_actor_user_id uuid default auth.uid()
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_email text;
  actor_name text;
  request_actor_id uuid := auth.uid();
  resolved_actor_id uuid := coalesce(auth.uid(), p_actor_user_id);
  normalized_action text := left(coalesce(p_action, 'updated'), 60);
  normalized_entity_type text := left(coalesce(p_entity_type, 'item'), 80);
  normalized_entity_id text := nullif(p_entity_id, '');
  normalized_entity_label text := nullif(left(coalesce(p_entity_label, ''), 160), '');
begin
  if current_setting('flowledger.shared_plan_owner_transfer', true) = 'on' then
    return;
  end if;
  if p_household_id is null then
    return;
  end if;
  if not exists (
    select 1 from public.households household where household.id = p_household_id
  ) then
    return;
  end if;
  if request_actor_id is not null then
    resolved_actor_id := request_actor_id;
  end if;
  if request_actor_id is not null
     and not public.is_household_member(p_household_id) then
    return;
  end if;

  select auth_user.email::text,
    coalesce(
      auth_user.raw_user_meta_data->>'full_name',
      auth_user.raw_user_meta_data->>'name',
      auth_user.email::text
    )
  into actor_email, actor_name
  from auth.users auth_user
  where auth_user.id = resolved_actor_id;

  if exists (
    select 1 from public.household_activity activity
    where activity.household_id = p_household_id
      and activity.actor_user_id is not distinct from resolved_actor_id
      and activity.action = normalized_action
      and activity.entity_type = normalized_entity_type
      and activity.entity_id is not distinct from normalized_entity_id
      and activity.entity_label is not distinct from normalized_entity_label
      and activity.created_at >= clock_timestamp() - interval '10 seconds'
  ) then
    return;
  end if;

  insert into public.household_activity (
    household_id, actor_user_id, actor_email, actor_name, actor_verified,
    action, entity_type, entity_id, entity_label
  ) values (
    p_household_id, resolved_actor_id, actor_email, actor_name,
    request_actor_id is not null and resolved_actor_id = request_actor_id,
    normalized_action, normalized_entity_type, normalized_entity_id,
    normalized_entity_label
  );
end;
$$;

revoke execute on function public.log_household_activity(uuid, text, text, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.log_household_activity(uuid, text, text, text, text, uuid)
  to service_role;

-- A field-preserving technical ownership transfer must not fail because the
-- linked bill later ended. Ordinary client writes still require auth.uid() and
-- a currently active, non-debt bill.
create or replace function private.validate_subscription_bill_link()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner_transfer boolean;
begin
  new.merchant_key := lower(btrim(new.merchant_key));
  new.merchant_label := btrim(new.merchant_label);
  new.updated_at := now();

  v_owner_transfer := current_user = 'postgres'
    and current_setting('flowledger.shared_plan_owner_transfer', true) = 'on'
    and tg_op = 'UPDATE'
    and new.user_id is distinct from old.user_id
    and new.id is not distinct from old.id
    and new.household_id is not distinct from old.household_id
    and new.merchant_key is not distinct from old.merchant_key
    and new.merchant_label is not distinct from old.merchant_label
    and new.bill_id is not distinct from old.bill_id
    and new.created_at is not distinct from old.created_at
    and exists (
      select 1 from public.household_members member
      where member.household_id = new.household_id
        and member.user_id = new.user_id
    );

  if not v_owner_transfer and new.user_id is distinct from (select auth.uid()) then
    raise exception 'Subscription bill links must be saved by the signed-in user';
  end if;
  if new.merchant_key = '' or new.merchant_key !~ '^[a-z0-9]+([ ][a-z0-9]+)*$' then
    raise exception 'A normalized subscription merchant is required';
  end if;
  if not v_owner_transfer and not exists (
    select 1 from public.bills bill
    where bill.id = new.bill_id
      and bill.household_id = new.household_id
      and bill.is_debt is not true
      and (bill.end_date is null or bill.end_date >= current_date::text)
  ) then
    raise exception 'Choose an active non-debt bill from this household';
  end if;
  return new;
end;
$$;

revoke all on function private.validate_subscription_bill_link() from public, anon, authenticated;
grant execute on function private.validate_subscription_bill_link() to service_role;

-- Routed spending buckets normally block user_id changes. Permit only the same
-- narrow postgres-owned technical transfer used by the household lifecycle
-- functions; every other routed-bucket invariant remains unchanged.
create or replace function private.guard_routed_bucket_progress()
returns trigger
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $$
begin
  if tg_op = 'UPDATE'
     and current_user = 'postgres'
     and current_setting('flowledger.shared_plan_owner_transfer', true) = 'on'
     and new.user_id is distinct from old.user_id
     and row(
       new.id, new.name, new.target_amount, new.target_date, new.goal_type,
       new.household_id, new.budget_id, new.current_amount,
       new.closed_at, new.closed_by, new.archived_at, new.archived_by,
       new.created_at
      ) is not distinct from row(
       old.id, old.name, old.target_amount, old.target_date, old.goal_type,
       old.household_id, old.budget_id, old.current_amount,
       old.closed_at, old.closed_by, old.archived_at, old.archived_by,
       old.created_at
     )
     and exists (
       select 1 from public.household_members member
       where member.household_id = old.household_id
         and member.user_id = new.user_id
     ) then
    return new;
  end if;

  if exists (
      select 1 from public.extra_payments payment
      where payment.household_id is not distinct from old.household_id
        and payment.budget_id is not distinct from old.budget_id
        and exists (
          select 1 from jsonb_array_elements(coalesce(payment.sources, '[]'::jsonb)) source
          where source ->> 'type' = 'bucket_remainder'
            and source ->> 'bucketId' = old.id
        )
    ) then
    if tg_op = 'DELETE' then
      raise exception 'Reopen and unroute this spending bucket before deleting it';
    end if;
    if row(
      new.name, new.target_amount, new.target_date, new.goal_type,
      new.user_id, new.household_id, new.budget_id,
      new.current_amount, new.closed_at, new.closed_by, new.archived_at, new.archived_by
    ) is distinct from row(
      old.name, old.target_amount, old.target_date, old.goal_type,
      old.user_id, old.household_id, old.budget_id,
      old.current_amount, old.closed_at, old.closed_by, old.archived_at, old.archived_by
    ) then
      raise exception 'Reopen and unroute this spending bucket before changing it';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function private.guard_routed_bucket_progress() from public, anon, authenticated;
grant execute on function private.guard_routed_bucket_progress() to service_role;

-- Reviewer attribution is historical audit data. Auth deletion anonymizes it;
-- it must never be assigned to a person who did not perform the review.
alter table public.transaction_reconciliations alter column reviewed_by drop not null;
alter table public.transaction_reconciliations
  drop constraint if exists transaction_reconciliations_reviewed_by_fkey;
alter table public.transaction_reconciliations
  add constraint transaction_reconciliations_reviewed_by_fkey
  foreign key (reviewed_by) references auth.users(id) on delete set null;

create or replace function private.reassign_shared_plan_ownership(
  p_household_id uuid,
  p_from_user_id uuid,
  p_to_user_id uuid
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
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
$$;

revoke all on function private.reassign_shared_plan_ownership(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

-- Repair any historical shared rows whose technical creator already left,
-- before adding membership integrity constraints. A household with no survivor
-- is not safe to guess and aborts the migration.
do $$
declare
  v_item record;
  v_owner record;
  v_survivor uuid;
begin
  for v_item in
    select * from (values
      ('accounts'), ('account_balances'), ('bills'), ('transactions'),
      ('incomes'), ('goals'), ('extra_payments'), ('categories'),
      ('category_budgets'), ('decisions'), ('monthly_overrides'),
      ('bill_date_moves'), ('subscription_bill_links'),
      ('bill_transaction_matches'), ('transaction_reconciliations')
    ) as allowed(table_name)
  loop
    if to_regclass(format('public.%I', v_item.table_name)) is null then
      continue;
    end if;
    for v_owner in execute format(
      'select distinct owned_row.household_id, owned_row.user_id
       from public.%I owned_row
       where owned_row.household_id is not null
         and not exists (
           select 1 from public.household_members member
           where member.household_id = owned_row.household_id
             and member.user_id = owned_row.user_id
         )',
      v_item.table_name
    )
    loop
      select member.user_id into v_survivor
      from public.household_members member
      where member.household_id = v_owner.household_id
      order by case member.role when 'owner' then 0 when 'manager' then 1 when 'editor' then 2 else 3 end,
        member.created_at,
        member.user_id
      limit 1
      for update;
      if v_survivor is null then
        raise exception using errcode = '23503', message =
          format('shared_plan_orphan_without_survivor:%s:%s', v_item.table_name, v_owner.household_id);
      end if;
      perform private.reassign_shared_plan_ownership(
        v_owner.household_id,
        v_owner.user_id,
        v_survivor
      );
    end loop;
  end loop;
end;
$$;

-- Every shared canonical row must point at a current household member. Deferred
-- NO ACTION keeps whole-household cascades valid while making direct membership
-- removal fail atomically if a concurrent writer leaves even one row behind.
do $$
declare
  v_table text;
  v_constraint text;
begin
  foreach v_table in array array[
    'accounts', 'account_balances', 'bills', 'transactions', 'incomes',
    'goals', 'extra_payments', 'categories', 'category_budgets', 'decisions',
    'monthly_overrides', 'bill_date_moves', 'subscription_bill_links',
    'bill_transaction_matches', 'transaction_reconciliations'
  ]
  loop
    if to_regclass(format('public.%I', v_table)) is null then
      continue;
    end if;
    v_constraint := v_table || '_household_member_owner_fkey';
    execute format('alter table public.%I drop constraint if exists %I', v_table, v_constraint);
    execute format(
      'alter table public.%I add constraint %I
       foreign key (household_id, user_id)
       references public.household_members(household_id, user_id)
       deferrable initially deferred',
      v_table,
      v_constraint
    );
  end loop;
end;
$$;

-- A disconnected Plaid tombstone is safe to remove. Any active/credentialed
-- historical orphan is not safe to guess, and a membership FK closes the race
-- with a provider exchange that began just before the member exited.
delete from public.plaid_items item
where item.household_id is not null
  and item.status = 'removed'
  and item.encrypted_access_token is null
  and item.access_token_ciphertext is null
  and not exists (
    select 1 from public.household_members member
    where member.household_id = item.household_id
      and member.user_id = item.user_id
  );

do $$
begin
  if exists (
    select 1 from public.plaid_items item
    where item.household_id is not null
      and not exists (
        select 1 from public.household_members member
        where member.household_id = item.household_id
          and member.user_id = item.user_id
      )
  ) then
    raise exception using errcode = '23503', message = 'plaid_item_member_integrity_preflight_failed';
  end if;
end;
$$;

alter table public.plaid_items
  drop constraint if exists plaid_items_household_member_owner_fkey;
alter table public.plaid_items
  add constraint plaid_items_household_member_owner_fkey
  foreign key (household_id, user_id)
  references public.household_members(household_id, user_id)
  deferrable initially deferred;

-- Purchase intents and binding writes participate in the same household
-- lifecycle lock. A store flow finishing after membership removal therefore
-- fails membership validation; if it starts first, leave/remove sees the live
-- intent or active binding and stops before the member can be detached.
create or replace function private.guard_billing_intent_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household_id uuid;
begin
  for v_household_id in
    select household_id
    from (
      select new.household_id as household_id
      union
      select old.household_id
      where tg_op = 'UPDATE'
        and old.household_id is distinct from new.household_id
    ) households
    where household_id is not null
    order by household_id
  loop
    perform pg_advisory_xact_lock(
      hashtextextended(v_household_id::text || ':shared-plan-owner', 0)
    );
  end loop;

  if new.status in ('confirmed', 'purchasing')
     and new.expires_at > now()
     and not exists (
       select 1 from public.household_members member
       where member.household_id = new.household_id
         and member.user_id = new.user_id
     ) then
    raise exception using errcode = '23503', message = 'billing_intent_membership_required';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_billing_intent_membership()
  from public, anon, authenticated, service_role;
drop trigger if exists billing_intent_membership_guard
  on public.billing_purchase_intents;
create trigger billing_intent_membership_guard
before insert or update
on public.billing_purchase_intents
for each row execute function private.guard_billing_intent_membership();

create or replace function private.guard_billing_binding_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household_id uuid;
begin
  -- Every binding update takes the same lifecycle lock as leave/remove. Lock
  -- both households in deterministic order if a binding is ever moved.
  for v_household_id in
    select household_id
    from (
      select new.household_id as household_id
      union
      select old.household_id
      where tg_op = 'UPDATE'
        and old.household_id is distinct from new.household_id
    ) households
    where household_id is not null
    order by household_id
  loop
    perform pg_advisory_xact_lock(
      hashtextextended(v_household_id::text || ':shared-plan-owner', 0)
    );
  end loop;

  if new.active is true and not exists (
    select 1 from public.household_members member
    where member.household_id = new.household_id
      and member.user_id = new.purchaser_user_id
  ) then
    raise exception using errcode = '23503', message = 'billing_purchaser_membership_required';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_billing_binding_membership()
  from public, anon, authenticated, service_role;
drop trigger if exists billing_binding_membership_guard
  on public.billing_purchase_bindings;
create trigger billing_binding_membership_guard
before insert or update
on public.billing_purchase_bindings
for each row execute function private.guard_billing_binding_membership();

create or replace function private.prepare_member_exit_dependencies(
  p_household_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.plaid_items item
    where item.household_id = p_household_id
      and item.user_id = p_user_id
      and (
        item.status is distinct from 'removed'
        or item.encrypted_access_token is not null
        or item.access_token_ciphertext is not null
      )
  ) then
    raise exception using errcode = 'P0001', message = 'household_member_plaid_disconnect_required';
  end if;

  if exists (
    select 1
    from public.billing_purchase_intents intent
    where intent.household_id = p_household_id
      and intent.user_id = p_user_id
      and intent.status in ('confirmed', 'purchasing')
      and intent.expires_at > now()
  ) then
    raise exception using errcode = 'P0001', message = 'household_member_billing_management_required';
  end if;

  if exists (
    select 1
    from public.billing_purchase_bindings binding
    where binding.household_id = p_household_id
      and binding.purchaser_user_id = p_user_id
      and binding.active
  ) then
    raise exception using errcode = 'P0001', message = 'household_member_billing_management_required';
  end if;

  delete from public.plaid_items item
  where item.household_id = p_household_id
    and item.user_id = p_user_id
    and item.status = 'removed'
    and item.encrypted_access_token is null
    and item.access_token_ciphertext is null;
end;
$$;

revoke all on function private.prepare_member_exit_dependencies(uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function private.leave_household(p_household_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_role text;
  v_survivor uuid;
begin
  if v_actor is null then
    raise exception 'Sign in before leaving a household.';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_household_id::text || ':shared-plan-owner', 0)
  );

  select member.role into v_actor_role
  from public.household_members member
  where member.household_id = p_household_id
    and member.user_id = v_actor
  for update;
  if v_actor_role is null then
    raise exception 'You are not a member of this household.';
  end if;
  if v_actor_role = 'owner' then
    raise exception 'Transfer household ownership before leaving.';
  end if;
  perform private.prepare_member_exit_dependencies(p_household_id, v_actor);

  select survivor.user_id into v_survivor
  from public.household_members survivor
  where survivor.household_id = p_household_id
    and survivor.user_id <> v_actor
  order by case survivor.role when 'owner' then 0 when 'manager' then 1 when 'editor' then 2 else 3 end,
    survivor.created_at,
    survivor.user_id
  limit 1
  for update;
  if v_survivor is null then
    raise exception 'A surviving household member is required.';
  end if;

  perform private.reassign_shared_plan_ownership(p_household_id, v_actor, v_survivor);

  perform public.log_household_activity(
    p_household_id,
    'left',
    'household_member',
    v_actor::text,
    null,
    v_actor
  );
  delete from public.household_members
  where household_id = p_household_id and user_id = v_actor;
  update public.user_preferences
  set active_household_id = null, updated_at = now()
  where user_id = v_actor and active_household_id = p_household_id;
end;
$$;

create or replace function private.remove_household_member(
  p_household_id uuid,
  p_member_user_id uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_role text;
  v_target_role text;
  v_target_label text;
  v_survivor uuid;
begin
  if v_actor is null then
    raise exception 'Sign in before removing a member.';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended(p_household_id::text || ':shared-plan-owner', 0)
  );
  select member.role into v_actor_role
  from public.household_members member
  where member.household_id = p_household_id and member.user_id = v_actor
  for update;
  if v_actor_role not in ('owner', 'manager') then
    raise exception 'Only household owners or managers can remove members.';
  end if;
  select member.role into v_target_role
  from public.household_members member
  where member.household_id = p_household_id and member.user_id = p_member_user_id
  for update;
  if v_target_role is null then raise exception 'Household member not found.'; end if;
  if p_member_user_id = v_actor then raise exception 'You cannot remove yourself from the household.'; end if;
  if v_target_role = 'owner' then raise exception 'The household owner cannot be removed.'; end if;
  if v_actor_role = 'manager' and v_target_role = 'manager' then
    raise exception 'Only the household owner can remove managers.';
  end if;
  select coalesce(
    nullif(btrim(auth_user.raw_user_meta_data->>'full_name'), ''),
    nullif(btrim(auth_user.raw_user_meta_data->>'name'), ''),
    nullif(btrim(auth_user.email::text), ''),
    'Household member'
  ) into v_target_label
  from auth.users auth_user
  where auth_user.id = p_member_user_id;
  v_target_label := coalesce(v_target_label, 'Household member');
  perform private.prepare_member_exit_dependencies(
    p_household_id,
    p_member_user_id
  );

  select survivor.user_id into v_survivor
  from public.household_members survivor
  where survivor.household_id = p_household_id
    and survivor.user_id <> p_member_user_id
  order by case survivor.role when 'owner' then 0 when 'manager' then 1 when 'editor' then 2 else 3 end,
    survivor.created_at,
    survivor.user_id
  limit 1
  for update;
  if v_survivor is null then raise exception 'A surviving household member is required.'; end if;

  perform private.reassign_shared_plan_ownership(
    p_household_id,
    p_member_user_id,
    v_survivor
  );
  perform public.log_household_activity(
    p_household_id,
    'removed',
    'household_member',
    p_member_user_id::text,
    v_target_label,
    v_actor
  );
  delete from public.household_members
  where household_id = p_household_id and user_id = p_member_user_id;
  update public.user_preferences
  set active_household_id = null, updated_at = now()
  where user_id = p_member_user_id and active_household_id = p_household_id;
end;
$$;

revoke all on function private.leave_household(uuid) from public, anon;
revoke all on function private.remove_household_member(uuid, uuid) from public, anon;
grant execute on function private.leave_household(uuid) to authenticated, service_role;
grant execute on function private.remove_household_member(uuid, uuid) to authenticated, service_role;

-- An owner who already left the membership table can still be the technical
-- households.created_by value. Any surviving member requires an ownership
-- transfer before Auth deletion, even when only one survivor remains.
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
    select household.id, household.name,
      count(member.user_id)::integer as member_count
    from public.households household
    left join public.household_members member
      on member.household_id = household.id
    where household.created_by = p_user_id
      and exists (
        select 1 from public.household_members survivor
        where survivor.household_id = household.id
          and survivor.user_id <> p_user_id
      )
    group by household.id, household.name
  ) owned;

  select count(*)::integer into v_plaid_count
  from public.plaid_items item
  where item.user_id = p_user_id
     or exists (
       select 1 from public.households household
       where household.id = item.household_id
         and household.created_by = p_user_id
     );

  return jsonb_build_object(
    'blockedHouseholds', v_blocked,
    'plaidItemCount', v_plaid_count
  );
end;
$$;

revoke all on function private.inspect_account_deletion(uuid)
  from public, anon, authenticated;
grant execute on function private.inspect_account_deletion(uuid) to service_role;

-- Replace the older deletion implementation. The backstop discovers shared
-- household rows even after membership was previously removed, reassigns only
-- the canonical plan ownership allowlist, and then deletes account-private
-- CASCADE/RESTRICT rows. Protected plan sources are never downgraded.
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
$$;

revoke all on function private.prepare_account_deletion(uuid, integer)
  from public, anon, authenticated;
grant execute on function private.prepare_account_deletion(uuid, integer) to service_role;

notify pgrst, 'reload schema';
