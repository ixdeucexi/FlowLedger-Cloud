-- Native billing and device-delivery state is deliberately server controlled.
-- Mobile clients use authenticated Edge Function actions; RevenueCat and Expo
-- delivery workers use the service role. No store payload can write a plan row
-- directly, and no client role can read tokens or raw webhook bodies.

create extension if not exists pg_net with schema extensions;
create schema if not exists private;
grant usage on schema private to service_role;

create table private.apple_provider_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  refresh_token_ciphertext text not null check (char_length(refresh_token_ciphertext) between 40 and 4096),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
revoke all on private.apple_provider_tokens from public, anon, authenticated;
grant select, insert, update, delete on private.apple_provider_tokens to service_role;
comment on table private.apple_provider_tokens is 'Encrypted Apple refresh tokens retained only to satisfy provider revocation during account deletion.';

create table public.billing_purchase_intents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  app_user_id uuid not null references auth.users(id) on delete cascade,
  product_id text not null check (product_id in ('flowledger_pro_monthly', 'flowledger_pro_annual')),
  platform text not null check (platform in ('ios', 'android')),
  environment text not null check (environment in ('sandbox', 'production')),
  installation_id uuid not null,
  status text not null default 'confirmed'
    check (status in ('confirmed', 'purchasing', 'applied', 'expired', 'cancelled')),
  confirmed_household_name text not null check (char_length(confirmed_household_name) between 1 and 120),
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_purchase_intents_identity_check check (user_id = app_user_id)
);

create index billing_purchase_intents_lookup_idx
  on public.billing_purchase_intents (user_id, product_id, status, expires_at desc);
create index billing_purchase_intents_household_fk_idx on public.billing_purchase_intents (household_id);
create index billing_purchase_intents_app_user_fk_idx on public.billing_purchase_intents (app_user_id);
create unique index billing_purchase_intents_one_purchasing_idx
  on public.billing_purchase_intents (user_id, platform, environment)
  where status = 'purchasing';

create table public.billing_purchase_bindings (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'revenuecat' check (provider = 'revenuecat'),
  purchaser_user_id uuid not null references auth.users(id) on delete cascade,
  app_user_id uuid not null references auth.users(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  purchase_intent_id uuid references public.billing_purchase_intents(id) on delete set null,
  entitlement_id text not null default 'pro' check (entitlement_id = 'pro'),
  original_transaction_id text not null check (char_length(original_transaction_id) between 1 and 255),
  current_product_id text not null check (current_product_id in ('flowledger_pro_monthly', 'flowledger_pro_annual')),
  store text not null check (store in ('app_store', 'play_store', 'promotional', 'unknown_store')),
  environment text not null check (environment in ('sandbox', 'production')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, original_transaction_id),
  constraint billing_purchase_bindings_identity_check check (purchaser_user_id = app_user_id)
);

create index billing_purchase_bindings_user_idx
  on public.billing_purchase_bindings (purchaser_user_id, household_id, active);
create index billing_purchase_bindings_household_fk_idx on public.billing_purchase_bindings (household_id);
create index billing_purchase_bindings_app_user_fk_idx on public.billing_purchase_bindings (app_user_id);
create index billing_purchase_bindings_intent_fk_idx on public.billing_purchase_bindings (purchase_intent_id) where purchase_intent_id is not null;

create table public.billing_entitlements (
  id uuid primary key default gen_random_uuid(),
  binding_id uuid not null unique references public.billing_purchase_bindings(id) on delete cascade,
  provider text not null default 'revenuecat' check (provider = 'revenuecat'),
  purchaser_user_id uuid not null references auth.users(id) on delete cascade,
  app_user_id uuid not null references auth.users(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  entitlement_id text not null default 'pro' check (entitlement_id = 'pro'),
  product_id text not null check (product_id in ('flowledger_pro_monthly', 'flowledger_pro_annual')),
  store text not null check (store in ('app_store', 'play_store', 'promotional', 'unknown_store')),
  environment text not null check (environment in ('sandbox', 'production')),
  status text not null check (status in ('active', 'grace', 'cancelled', 'expired', 'refunded', 'revoked')),
  transaction_id text,
  original_transaction_id text not null,
  purchased_at timestamptz,
  expires_at timestamptz,
  grace_ends_at timestamptz,
  will_renew boolean,
  last_event_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_entitlements_identity_check check (purchaser_user_id = app_user_id)
);

create index billing_entitlements_household_status_idx
  on public.billing_entitlements (household_id, status, expires_at);
create index billing_entitlements_purchaser_fk_idx on public.billing_entitlements (purchaser_user_id);
create index billing_entitlements_app_user_fk_idx on public.billing_entitlements (app_user_id);

create table public.billing_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'revenuecat' check (provider = 'revenuecat'),
  provider_event_id text not null check (char_length(provider_event_id) between 1 and 255),
  event_type text not null check (char_length(event_type) between 1 and 80),
  app_user_id uuid references auth.users(id) on delete cascade,
  product_id text,
  store text,
  environment text,
  transaction_id text,
  original_transaction_id text,
  event_at timestamptz not null,
  processing_status text not null default 'received'
    check (processing_status in ('received', 'retryable', 'applied', 'duplicate', 'rejected', 'ignored', 'failed')),
  processing_error text,
  raw_event jsonb not null,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (provider, provider_event_id)
);

create index billing_events_identity_idx
  on public.billing_events (app_user_id, event_at desc);

create table public.billing_sandbox_testers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  purpose text not null default 'store_review' check (char_length(purpose) between 1 and 80),
  created_at timestamptz not null default now()
);

create table public.native_push_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  installation_id uuid not null,
  expo_push_token text not null check (char_length(expo_push_token) between 20 and 512),
  platform text not null check (platform in ('ios', 'android')),
  environment text not null check (environment in ('development', 'preview', 'production')),
  status text not null default 'active' check (status in ('active', 'disabled', 'invalid', 'error')),
  last_error text,
  last_success_at timestamptz,
  last_receipt_id text,
  last_registered_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (expo_push_token),
  unique (user_id, installation_id, environment)
);

create index native_push_devices_user_status_idx
  on public.native_push_devices (user_id, status);
create index native_push_devices_household_fk_idx on public.native_push_devices (household_id);

create table public.native_push_receipts (
  id uuid primary key default gen_random_uuid(),
  ticket_id text not null unique check (char_length(ticket_id) between 1 and 255),
  device_id uuid not null references public.native_push_devices(id) on delete cascade,
  event_ids uuid[] not null default '{}',
  status text not null default 'pending' check (status in ('pending', 'succeeded', 'failed', 'abandoned')),
  attempt_count integer not null default 0 check (attempt_count between 0 and 8),
  next_check_at timestamptz not null default (now() + interval '2 minutes'),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index native_push_receipts_pending_idx on public.native_push_receipts (next_check_at, created_at) where status = 'pending';
create index native_push_receipts_device_fk_idx on public.native_push_receipts (device_id);

-- Financial notification outbox rows must carry their source household so a
-- native device bound to another active household never receives or opens it.
alter table public.push_notification_events
  add column if not exists household_id uuid references public.households(id) on delete cascade,
  add column if not exists delivery_claim_id uuid,
  add column if not exists delivery_claimed_at timestamptz;

update public.push_notification_events event
set household_id = transaction.household_id
from public.transactions transaction
where event.household_id is null
  and event.transaction_id = transaction.id
  and transaction.household_id is not null;

update public.push_notification_events event
set household_id = transaction.household_id
from public.plaid_transactions transaction
where event.household_id is null
  and event.plaid_transaction_id = transaction.plaid_transaction_id
  and transaction.household_id is not null;

update public.push_notification_events event
set household_id = bill.household_id
from public.bills bill
where event.household_id is null
  and event.bill_id = bill.id
  and bill.household_id is not null;

create index if not exists push_notification_events_user_household_pending_idx
  on public.push_notification_events (user_id, household_id, created_at)
  where delivered_at is null;

comment on column public.push_notification_events.household_id is
  'Source household for financial delivery. Legacy null rows are never sent to household-bound native devices.';

alter table public.billing_purchase_intents enable row level security;
alter table public.billing_purchase_bindings enable row level security;
alter table public.billing_entitlements enable row level security;
alter table public.billing_events enable row level security;
alter table public.billing_sandbox_testers enable row level security;
alter table public.native_push_devices enable row level security;
alter table public.native_push_receipts enable row level security;

revoke all on public.billing_purchase_intents from public, anon, authenticated;
revoke all on public.billing_purchase_bindings from public, anon, authenticated;
revoke all on public.billing_entitlements from public, anon, authenticated;
revoke all on public.billing_events from public, anon, authenticated;
revoke all on public.billing_sandbox_testers from public, anon, authenticated;
revoke all on public.native_push_devices from public, anon, authenticated;
revoke all on public.native_push_receipts from public, anon, authenticated;
grant select, insert, update, delete on public.billing_purchase_intents to service_role;
grant select, insert, update, delete on public.billing_purchase_bindings to service_role;
grant select, insert, update, delete on public.billing_entitlements to service_role;
grant select, insert, update, delete on public.billing_events to service_role;
grant select, insert, update, delete on public.billing_sandbox_testers to service_role;
grant select, insert, update, delete on public.native_push_devices to service_role;
grant select, insert, update, delete on public.native_push_receipts to service_role;

comment on table public.billing_purchase_intents is
  'Short-lived, user-confirmed binding between a store product and the active household named in the purchase UI.';
comment on table public.billing_purchase_bindings is
  'Immutable purchaser and household ownership for each RevenueCat original transaction. Restore cannot move this binding.';
comment on table public.billing_entitlements is
  'Current server-authoritative Pro lifecycle for a billing-owned household plan.';
comment on table public.billing_events is
  'Idempotent RevenueCat webhook ledger. Raw bodies are service-only and removed with the purchaser account.';
comment on table public.billing_sandbox_testers is
  'Explicit service-only UUID allowlist for App Review/TestFlight sandbox purchases against the production deployment.';
comment on table public.native_push_devices is
  'Service-only Expo device destinations. Web Push remains in push_subscriptions.';
comment on table public.native_push_receipts is
  'Durable Expo ticket receipts polled by the existing notifications dispatcher; unresolved tickets are never overwritten.';

create or replace function private.claim_push_notification_events(p_user_id uuid, p_limit integer default 50)
returns setof public.push_notification_events
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim_id uuid := gen_random_uuid();
begin
  if p_user_id is null or (select auth.role()) <> 'service_role' then
    raise exception using errcode = '42501', message = 'push_claim_access_denied';
  end if;
  return query
  with candidates as (
    select event.id
    from public.push_notification_events event
    where event.user_id = p_user_id
      and event.delivered_at is null
      and (event.delivery_claimed_at is null or event.delivery_claimed_at < now() - interval '5 minutes')
      and not exists (
        select 1 from public.native_push_receipts receipt
        where receipt.status = 'pending' and event.id = any(receipt.event_ids)
      )
    order by event.created_at
    for update skip locked
    limit least(greatest(coalesce(p_limit, 50), 1), 100)
  )
  update public.push_notification_events event
  set delivery_claim_id = v_claim_id, delivery_claimed_at = now()
  from candidates
  where event.id = candidates.id
  returning event.*;
end;
$$;

create or replace function public.claim_push_notification_events(p_user_id uuid, p_limit integer default 50)
returns setof public.push_notification_events
language sql
security invoker
set search_path = ''
as $$ select * from private.claim_push_notification_events(p_user_id, p_limit) $$;

revoke all on function private.claim_push_notification_events(uuid, integer) from public, anon, authenticated;
grant execute on function private.claim_push_notification_events(uuid, integer) to service_role;
revoke all on function public.claim_push_notification_events(uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_push_notification_events(uuid, integer) to service_role;

create or replace function private.apply_native_push_receipt(
  p_receipt_id uuid, p_status text, p_attempt_count integer,
  p_next_check_at timestamptz, p_error text, p_device_invalid boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_receipt public.native_push_receipts%rowtype;
begin
  if (select auth.role()) <> 'service_role'
     or p_status not in ('pending', 'succeeded', 'failed', 'abandoned')
     or p_attempt_count < 0 or p_attempt_count > 8
  then raise exception using errcode = '42501', message = 'push_receipt_access_denied'; end if;

  select * into v_receipt from public.native_push_receipts
  where id = p_receipt_id and status = 'pending' for update;
  if not found then return false; end if;

  update public.native_push_receipts set
    status = p_status, attempt_count = p_attempt_count,
    next_check_at = p_next_check_at, last_error = left(p_error, 500), updated_at = now()
  where id = p_receipt_id;

  if p_status in ('succeeded', 'failed') then
    update public.native_push_devices set
      status = case when p_device_invalid then 'invalid' else 'active' end,
      last_error = left(p_error, 500), updated_at = now()
    where id = v_receipt.device_id;
    if p_status = 'succeeded' then
      update public.push_notification_events set delivered_at = now(), last_error = null,
        delivery_claim_id = null, delivery_claimed_at = null
      where id = any(v_receipt.event_ids);
    else
      update public.push_notification_events set last_error = left(p_error, 500),
        delivery_claim_id = null, delivery_claimed_at = null
      where id = any(v_receipt.event_ids) and delivered_at is null;
    end if;
  elsif p_status = 'abandoned' then
    update public.push_notification_events set last_error = left(p_error, 500),
      delivery_claim_id = null, delivery_claimed_at = null
    where id = any(v_receipt.event_ids) and delivered_at is null;
  end if;
  return true;
end;
$$;

create or replace function public.apply_native_push_receipt(
  p_receipt_id uuid, p_status text, p_attempt_count integer,
  p_next_check_at timestamptz, p_error text, p_device_invalid boolean default false
)
returns boolean language sql security invoker set search_path = ''
as $$ select private.apply_native_push_receipt(p_receipt_id, p_status, p_attempt_count, p_next_check_at, p_error, p_device_invalid) $$;

revoke all on function private.apply_native_push_receipt(uuid, text, integer, timestamptz, text, boolean) from public, anon, authenticated;
grant execute on function private.apply_native_push_receipt(uuid, text, integer, timestamptz, text, boolean) to service_role;
revoke all on function public.apply_native_push_receipt(uuid, text, integer, timestamptz, text, boolean) from public, anon, authenticated;
grant execute on function public.apply_native_push_receipt(uuid, text, integer, timestamptz, text, boolean) to service_role;

create or replace function private.apply_revenuecat_billing_event(
  p_provider_event_id text,
  p_event_type text,
  p_app_user_id uuid,
  p_product_id text,
  p_store text,
  p_environment text,
  p_status text,
  p_transaction_id text,
  p_original_transaction_id text,
  p_event_at timestamptz,
  p_purchased_at timestamptz,
  p_expires_at timestamptz,
  p_grace_ends_at timestamptz,
  p_will_renew boolean,
  p_raw_event jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_id uuid;
  v_intent public.billing_purchase_intents%rowtype;
  v_binding public.billing_purchase_bindings%rowtype;
  v_entitlement public.billing_entitlements%rowtype;
  v_should_unlock boolean;
  v_should_expire boolean;
begin
  if p_product_id not in ('flowledger_pro_monthly', 'flowledger_pro_annual')
     or p_store not in ('app_store', 'play_store', 'promotional', 'unknown_store')
     or p_environment not in ('sandbox', 'production')
     or p_status not in ('active', 'grace', 'cancelled', 'expired', 'refunded', 'revoked')
     or nullif(trim(p_original_transaction_id), '') is null then
    raise exception 'Invalid normalized RevenueCat event';
  end if;

  insert into public.billing_events (
    provider_event_id, event_type, app_user_id, product_id, store, environment,
    transaction_id, original_transaction_id, event_at, raw_event
  ) values (
    p_provider_event_id, p_event_type, p_app_user_id, p_product_id, p_store,
    p_environment, p_transaction_id, p_original_transaction_id, p_event_at, p_raw_event
  )
  on conflict (provider, provider_event_id) do update set
    event_type = excluded.event_type,
    app_user_id = excluded.app_user_id,
    product_id = excluded.product_id,
    store = excluded.store,
    environment = excluded.environment,
    transaction_id = excluded.transaction_id,
    original_transaction_id = excluded.original_transaction_id,
    event_at = excluded.event_at,
    processing_status = 'received',
    processing_error = null,
    raw_event = excluded.raw_event,
    processed_at = null
  where public.billing_events.processing_status = 'retryable'
  returning id into v_event_id;

  if v_event_id is null then
    return jsonb_build_object('result', 'duplicate');
  end if;

  select * into v_binding
  from public.billing_purchase_bindings
  where provider = 'revenuecat'
    and original_transaction_id = p_original_transaction_id
  for update;

  -- A missed initial webhook may be recovered from the authoritative
  -- subscriber API using a server-owned purchaser/store/environment key. It
  -- never includes the rotating store transaction id and is permanently bound
  -- to the household chosen by the confirmed restore intent. The first signed
  -- webhook replaces only that technical key with RevenueCat's stable original
  -- transaction id; it never changes household ownership.
  if v_binding.id is null and p_original_transaction_id not like 'restore-owner:%' then
    select * into v_binding
    from public.billing_purchase_bindings
    where provider = 'revenuecat'
      and purchaser_user_id = p_app_user_id
      and app_user_id = p_app_user_id
      and store = p_store
      and environment = p_environment
      and original_transaction_id like 'restore-owner:%'
      and active
    order by created_at
    limit 1
    for update;

    if v_binding.id is not null then
      update public.billing_purchase_bindings
      set original_transaction_id = p_original_transaction_id,
          current_product_id = p_product_id,
          updated_at = now()
      where id = v_binding.id
      returning * into v_binding;
      update public.billing_entitlements
      set original_transaction_id = p_original_transaction_id, updated_at = now()
      where binding_id = v_binding.id;
    end if;
  end if;

  if v_binding.id is null then
    select * into v_intent
    from public.billing_purchase_intents
    where user_id = p_app_user_id
      and app_user_id = p_app_user_id
      and product_id = p_product_id
      and (environment = p_environment or (
        p_environment = 'sandbox'
        and environment = 'production'
        and exists (select 1 from public.billing_sandbox_testers tester where tester.user_id = p_app_user_id)
      ))
      and ((platform = 'ios' and p_store = 'app_store')
        or (platform = 'android' and p_store = 'play_store')
        or p_store in ('promotional', 'unknown_store'))
      and status = 'purchasing'
      and expires_at > p_event_at - interval '10 minutes'
      and created_at < p_event_at + interval '10 minutes'
    order by created_at desc
    limit 1
    for update skip locked;

    if v_intent.id is null then
      update public.billing_events
      set processing_status = 'retryable',
          processing_error = 'No matching confirmed household purchase intent.',
          processed_at = now()
      where id = v_event_id;
      return jsonb_build_object('result', 'retryable', 'reason', 'purchase_intent_required');
    end if;

    insert into public.billing_purchase_bindings (
      purchaser_user_id, app_user_id, household_id, purchase_intent_id,
      original_transaction_id, current_product_id, store, environment
    ) values (
      p_app_user_id, p_app_user_id, v_intent.household_id, v_intent.id,
      p_original_transaction_id, p_product_id, p_store, p_environment
    ) returning * into v_binding;
  elsif v_binding.purchaser_user_id <> p_app_user_id
     or v_binding.app_user_id <> p_app_user_id then
    update public.billing_events
    set processing_status = 'rejected',
        processing_error = 'Purchaser identity does not own the original transaction binding.',
        processed_at = now()
    where id = v_event_id;
    return jsonb_build_object('result', 'rejected', 'reason', 'purchaser_mismatch');
  end if;

  insert into public.billing_entitlements (
    binding_id, purchaser_user_id, app_user_id, household_id, product_id,
    store, environment, status, transaction_id, original_transaction_id,
    purchased_at, expires_at, grace_ends_at, will_renew, last_event_at
  ) values (
    v_binding.id, p_app_user_id, p_app_user_id, v_binding.household_id,
    p_product_id, p_store, p_environment, p_status, p_transaction_id,
    p_original_transaction_id, p_purchased_at, p_expires_at,
    p_grace_ends_at, p_will_renew, p_event_at
  )
  on conflict (binding_id) do update set
    product_id = excluded.product_id,
    store = excluded.store,
    environment = excluded.environment,
    status = excluded.status,
    transaction_id = excluded.transaction_id,
    original_transaction_id = excluded.original_transaction_id,
    purchased_at = coalesce(excluded.purchased_at, public.billing_entitlements.purchased_at),
    expires_at = excluded.expires_at,
    grace_ends_at = excluded.grace_ends_at,
    will_renew = excluded.will_renew,
    last_event_at = excluded.last_event_at,
    updated_at = now()
  where excluded.last_event_at >= public.billing_entitlements.last_event_at
  returning * into v_entitlement;

  if v_entitlement.id is null then
    update public.billing_events
    set processing_status = 'ignored',
        processing_error = 'An older entitlement event arrived after newer state.',
        processed_at = now()
    where id = v_event_id;
    return jsonb_build_object('result', 'ignored', 'reason', 'stale_event');
  end if;

  update public.billing_purchase_bindings
  set current_product_id = p_product_id,
      store = p_store,
      environment = p_environment,
      active = p_status not in ('expired', 'refunded', 'revoked'),
      updated_at = now()
  where id = v_binding.id;

  update public.billing_purchase_intents
  set status = 'applied', updated_at = now()
  where id = v_binding.purchase_intent_id
    and status in ('confirmed', 'purchasing');

  v_should_unlock := p_status in ('active', 'grace', 'cancelled')
    and (p_expires_at is null or p_expires_at > now() or p_grace_ends_at > now());
  v_should_expire := p_status in ('expired', 'refunded', 'revoked')
    or (p_expires_at is not null and p_expires_at <= now() and coalesce(p_grace_ends_at, p_expires_at) <= now());

  if v_should_unlock then
    update public.household_plans
    set tier = 'pro', source = 'billing', updated_at = now()
    where household_id = v_binding.household_id
      and source in ('default', 'billing');
  elsif v_should_expire then
    update public.household_plans plan
    set tier = 'free', source = 'default', grandfathered_at = null, updated_at = now()
    where plan.household_id = v_binding.household_id
      and plan.source = 'billing'
      and not exists (
        select 1 from public.billing_entitlements active
        where active.household_id = plan.household_id
          and active.binding_id <> v_binding.id
          and active.status in ('active', 'grace', 'cancelled')
          and (active.expires_at is null
            or active.expires_at > now()
            or active.grace_ends_at > now())
      );
  end if;

  update public.billing_events
  set processing_status = 'applied', processed_at = now(), processing_error = null
  where id = v_event_id;

  return jsonb_build_object(
    'result', 'applied',
    'household_id', v_binding.household_id,
    'status', p_status,
    'plan_changed', v_should_unlock or v_should_expire
  );
exception when others then
  if v_event_id is not null then
    update public.billing_events
    set processing_status = 'failed', processing_error = left(sqlerrm, 500), processed_at = now()
    where id = v_event_id;
  end if;
  raise;
end;
$$;

create or replace function public.apply_revenuecat_billing_event(
  p_provider_event_id text, p_event_type text, p_app_user_id uuid, p_product_id text,
  p_store text, p_environment text, p_status text, p_transaction_id text,
  p_original_transaction_id text, p_event_at timestamptz, p_purchased_at timestamptz,
  p_expires_at timestamptz, p_grace_ends_at timestamptz, p_will_renew boolean, p_raw_event jsonb
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.apply_revenuecat_billing_event(
    p_provider_event_id, p_event_type, p_app_user_id, p_product_id, p_store,
    p_environment, p_status, p_transaction_id, p_original_transaction_id,
    p_event_at, p_purchased_at, p_expires_at, p_grace_ends_at, p_will_renew, p_raw_event
  )
$$;

revoke all on function private.apply_revenuecat_billing_event(
  text, text, uuid, text, text, text, text, text, text, timestamptz,
  timestamptz, timestamptz, timestamptz, boolean, jsonb
) from public, anon, authenticated;
grant execute on function private.apply_revenuecat_billing_event(
  text, text, uuid, text, text, text, text, text, text, timestamptz,
  timestamptz, timestamptz, timestamptz, boolean, jsonb
) to service_role;

revoke all on function public.apply_revenuecat_billing_event(
  text, text, uuid, text, text, text, text, text, text, timestamptz,
  timestamptz, timestamptz, timestamptz, boolean, jsonb
) from public, anon, authenticated;
grant execute on function public.apply_revenuecat_billing_event(
  text, text, uuid, text, text, text, text, text, text, timestamptz,
  timestamptz, timestamptz, timestamptz, boolean, jsonb
) to service_role;

comment on function public.apply_revenuecat_billing_event(
  text, text, uuid, text, text, text, text, text, text, timestamptz,
  timestamptz, timestamptz, timestamptz, boolean, jsonb
) is 'Service-only atomic RevenueCat event application. Replays, stale events, identity transfers, and household rebinding fail closed.';

create or replace function private.apply_revenuecat_billing_transfer(
  p_provider_event_id text,
  p_transferred_from uuid[],
  p_environment text,
  p_event_at timestamptz,
  p_raw_event jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_id uuid;
  v_binding public.billing_purchase_bindings%rowtype;
  v_revoked_count integer;
begin
  if nullif(trim(p_provider_event_id), '') is null
     or coalesce(cardinality(p_transferred_from), 0) = 0
     or p_environment not in ('sandbox', 'production')
  then
    raise exception 'Invalid normalized RevenueCat transfer';
  end if;

  select * into v_binding
  from public.billing_purchase_bindings
  where provider = 'revenuecat'
    and purchaser_user_id = any(p_transferred_from)
    and environment = p_environment
    and active
  order by created_at
  limit 1
  for update;

  if v_binding.id is null then
    return jsonb_build_object('result', 'ignored', 'reason', 'binding_not_found');
  end if;

  insert into public.billing_events (
    provider_event_id, event_type, app_user_id, product_id, store, environment,
    event_at, processing_status, raw_event
  ) values (
    p_provider_event_id, 'TRANSFER', v_binding.app_user_id, v_binding.current_product_id,
    v_binding.store, v_binding.environment, p_event_at, 'received', p_raw_event
  ) on conflict (provider, provider_event_id) do nothing
  returning id into v_event_id;
  if v_event_id is null then return jsonb_build_object('result', 'duplicate'); end if;

  update public.billing_entitlements
  set status = 'revoked', will_renew = false, expires_at = least(coalesce(expires_at, p_event_at), p_event_at),
      grace_ends_at = null, last_event_at = p_event_at, updated_at = now()
  where binding_id in (
    select id from public.billing_purchase_bindings
    where purchaser_user_id = any(p_transferred_from)
      and environment = p_environment
  ) and p_event_at >= last_event_at;
  get diagnostics v_revoked_count = row_count;

  if v_revoked_count = 0 then
    update public.billing_events
    set processing_status = 'ignored', processing_error = 'Transfer is older than current entitlement state.', processed_at = now()
    where id = v_event_id;
    return jsonb_build_object('result', 'ignored', 'reason', 'stale_transfer');
  end if;

  update public.billing_purchase_bindings binding set active = false, updated_at = now()
  where binding.purchaser_user_id = any(p_transferred_from)
    and binding.environment = p_environment
    and exists (
      select 1 from public.billing_entitlements entitlement
      where entitlement.binding_id = binding.id
        and entitlement.status = 'revoked'
        and entitlement.last_event_at = p_event_at
    );

  update public.household_plans plan
  set tier = 'free', source = 'default', grandfathered_at = null, updated_at = now()
  where plan.household_id in (
      select household_id from public.billing_purchase_bindings
      where purchaser_user_id = any(p_transferred_from)
        and environment = p_environment
    )
    and plan.source = 'billing'
    and not exists (
      select 1 from public.billing_entitlements active
      where active.household_id = plan.household_id
        and active.status in ('active', 'grace', 'cancelled')
        and (active.expires_at is null or active.expires_at > now() or active.grace_ends_at > now())
    );

  update public.billing_events set processing_status = 'applied', processed_at = now()
  where id = v_event_id;
  return jsonb_build_object('result', 'applied', 'status', 'revoked', 'household_id', v_binding.household_id);
end;
$$;

create or replace function public.apply_revenuecat_billing_transfer(
  p_provider_event_id text, p_transferred_from uuid[],
  p_environment text, p_event_at timestamptz, p_raw_event jsonb
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.apply_revenuecat_billing_transfer(
  p_provider_event_id, p_transferred_from, p_environment, p_event_at, p_raw_event
) $$;

revoke all on function private.apply_revenuecat_billing_transfer(text, uuid[], text, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function private.apply_revenuecat_billing_transfer(text, uuid[], text, timestamptz, jsonb) to service_role;
revoke all on function public.apply_revenuecat_billing_transfer(text, uuid[], text, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.apply_revenuecat_billing_transfer(text, uuid[], text, timestamptz, jsonb) to service_role;

comment on function public.apply_revenuecat_billing_transfer(text, uuid[], text, timestamptz, jsonb) is
  'Service-only wrapper. A known transfer revokes only the original binding and never grants its destination.';

-- Poll Expo receipts without requiring a paid Vercel cron frequency. The
-- operator must store the same CRON_SECRET value in Supabase Vault under
-- `flowledger_cron_secret`; when absent, the scheduled query makes no request.
select cron.schedule(
  'flowledger-native-push-receipts',
  '*/10 * * * *',
  $cron$
    select net.http_get(
      url := 'https://flowledger-algo.com/api/notifications/receipts',
      headers := jsonb_build_object(
        'Authorization',
        'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'flowledger_cron_secret' limit 1)
      ),
      timeout_milliseconds := 30000
    )
    where exists (select 1 from vault.decrypted_secrets where name = 'flowledger_cron_secret');
  $cron$
);

;
