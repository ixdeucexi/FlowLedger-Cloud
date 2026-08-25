-- Founding Free includes Review Center and spending-bucket management, but
-- native Plaid linking, billing, and remote Plan Simulator persistence remain
-- Pro-only. Keep this launch entitlement server-owned and scoped only to the
-- atomic Review Center RPC implementations.

create table if not exists private.release_feature_entitlements (
  feature_key text primary key,
  free_enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint release_feature_entitlements_known_key
    check (feature_key in ('review_center'))
);

alter table private.release_feature_entitlements enable row level security;
revoke all on table private.release_feature_entitlements
  from public, anon, authenticated, service_role;

insert into private.release_feature_entitlements (feature_key, free_enabled)
values ('review_center', true)
on conflict (feature_key) do nothing;

comment on table private.release_feature_entitlements is
  'Server-owned release switches. No client role can read or change these rows.';

create or replace function private.has_review_center_entitlement(p_household_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select p_household_id is not null
    and exists (
      select 1
      from public.household_plans plan
      where plan.household_id = p_household_id
        and (
          plan.tier = 'pro'
          or (
            plan.tier = 'free'
            and exists (
              select 1
              from private.release_feature_entitlements entitlement
              where entitlement.feature_key = 'review_center'
                and entitlement.free_enabled
            )
          )
        )
    )
$$;

revoke all on function private.has_review_center_entitlement(uuid)
  from public, anon, authenticated, service_role;

comment on function private.has_review_center_entitlement(uuid) is
  'Internal server-authoritative Review Center entitlement. Caller must still enforce authentication and household edit access.';

-- Preserve each proven atomic implementation verbatim and replace only its
-- legacy tier predicate. pg_get_functiondef keeps the function owner, SECURITY
-- mode, search_path, volatility, defaults, and existing grants. The explicit
-- target list prevents this release flag from affecting Plaid, billing, plan
-- simulations, pending Plaid matches, or any unrelated Pro capability.
do $migration$
declare
  target record;
  function_oid oid;
  prior_definition text;
  next_definition text;
  match_count integer;
  helper_count integer;
  tier_pattern constant text := '(plan|hp)[.]tier[[:space:]]*=[[:space:]]*''pro''';
begin
  for target in
    select *
    from (values
      ('private.reconcile_transaction(text,text,text,date,numeric,text,text)', 'v_tx.household_id'),
      ('private.reconcile_transaction_unlocked_v1(text,text,text,date,numeric,text,text)', 'v_tx.household_id'),
      ('private.reconcile_snowball_transaction(text,text,date,numeric,text,text)', 'v_tx.household_id'),
      ('private.reconcile_manual_transaction(text,text,date,numeric,text)', 'v_tx.household_id'),
      ('private.undo_transaction_reconciliation(text)', 'v_tx.household_id'),
      ('private.undo_manual_transaction_reconciliation(text)', 'v_tx.household_id'),
      ('private.create_spending_bucket_for_transaction(text,text,text,numeric,date)', 'v_tx.household_id'),
      ('private.close_spending_bucket_keep_available(text,numeric,numeric)', 'v_goal.household_id'),
      ('private.close_spending_bucket_and_route_remainder(text,numeric,numeric,text,integer,integer,date,numeric,jsonb)', 'v_goal.household_id'),
      ('private.reopen_spending_bucket_and_unroute_remainder(text,numeric,jsonb)', 'v_goal.household_id')
    ) as functions(signature, household_expression)
  loop
    function_oid := to_regprocedure(target.signature)::oid;
    if function_oid is null then
      raise exception 'Required Review Center function is missing: %', target.signature;
    end if;

    select pg_get_functiondef(function_oid) into prior_definition;
    helper_count := regexp_count(
      prior_definition,
      'private[.]has_review_center_entitlement[[:space:]]*[(]',
      1,
      'i'
    );
    if helper_count = 1 then
      continue;
    elsif helper_count <> 0 then
      raise exception 'Unexpected Review Center entitlement count in %: %', target.signature, helper_count;
    end if;

    match_count := regexp_count(prior_definition, tier_pattern, 1, 'i');
    if match_count <> 1 then
      raise exception 'Expected one legacy Pro predicate in %, found %', target.signature, match_count;
    end if;

    next_definition := regexp_replace(
      prior_definition,
      tier_pattern,
      format('private.has_review_center_entitlement(%s)', target.household_expression),
      'i'
    );
    execute next_definition;

    select pg_get_functiondef(function_oid) into next_definition;
    helper_count := regexp_count(
      next_definition,
      'private[.]has_review_center_entitlement[[:space:]]*[(]',
      1,
      'i'
    );
    match_count := regexp_count(next_definition, tier_pattern, 1, 'i');
    if helper_count <> 1 or match_count <> 0 then
      raise exception 'Review Center entitlement replacement failed for %', target.signature;
    end if;
  end loop;
end
$migration$;

-- Direct table writes intentionally retain their existing Pro-only RLS. Free
-- users receive the feature only through the authenticated, household-scoped,
-- atomic RPCs above. Pending Plaid match policies also intentionally stay Pro.

notify pgrst, 'reload schema';

;
