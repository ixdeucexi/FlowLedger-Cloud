-- Keep privileged implementations outside the exposed Data API schema while
-- preserving the public RPC signatures through SECURITY INVOKER wrappers.
-- The private functions retain their existing auth.uid()/household checks.

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

do $$
declare
  rpc record;
begin
  for rpc in
    select
      p.proname,
      pg_get_function_identity_arguments(p.oid) as arguments
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and has_function_privilege('authenticated', p.oid, 'execute')
      and p.proname in (
        'accept_household_invite',
        'create_household_invite',
        'delete_bill_completely',
        'get_household_members',
        'household_role',
        'is_household_editor',
        'is_household_manager',
        'is_household_member',
        'leave_household',
        'reconcile_snowball_transaction',
        'reconcile_transaction',
        'remove_household_member',
        'revoke_household_invite',
        'undo_transaction_reconciliation',
        'update_household_member_role'
      )
  loop
    execute format(
      'alter function public.%I(%s) set schema private',
      rpc.proname,
      rpc.arguments
    );
  end loop;
end;
$$;

do $$
declare
  rpc record;
begin
  for rpc in
    select
      p.proname,
      pg_get_function_identity_arguments(p.oid) as arguments
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.proname in (
        'accept_household_invite',
        'create_household_invite',
        'delete_bill_completely',
        'get_household_members',
        'household_role',
        'is_household_editor',
        'is_household_manager',
        'is_household_member',
        'leave_household',
        'reconcile_snowball_transaction',
        'reconcile_transaction',
        'remove_household_member',
        'revoke_household_invite',
        'undo_transaction_reconciliation',
        'update_household_member_role'
      )
  loop
    execute format(
      'revoke all on function private.%I(%s) from public, anon',
      rpc.proname,
      rpc.arguments
    );
    execute format(
      'grant execute on function private.%I(%s) to authenticated, service_role',
      rpc.proname,
      rpc.arguments
    );
  end loop;
end;
$$;

create or replace function public.accept_household_invite(p_code text)
returns uuid
language sql
volatile
security invoker
set search_path = ''
as $$ select private.accept_household_invite(p_code) $$;

create or replace function public.create_household_invite(
  p_household_id uuid,
  p_role text default 'editor'
)
returns text
language sql
volatile
security invoker
set search_path = ''
as $$ select private.create_household_invite(p_household_id, p_role) $$;

create or replace function public.delete_bill_completely(
  p_bill_id text,
  p_household_id uuid default null
)
returns boolean
language sql
volatile
security invoker
set search_path = ''
as $$ select private.delete_bill_completely(p_bill_id, p_household_id) $$;

create or replace function public.get_household_members(p_household_id uuid)
returns table (
  user_id uuid,
  role text,
  joined_at timestamptz,
  email text,
  display_name text,
  is_current_user boolean
)
language sql
stable
security invoker
set search_path = ''
as $$ select * from private.get_household_members(p_household_id) $$;

create or replace function public.household_role(p_household_id uuid)
returns text
language sql
stable
security invoker
set search_path = ''
as $$ select private.household_role(p_household_id) $$;

create or replace function public.is_household_editor(p_household_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$ select private.is_household_editor(p_household_id) $$;

create or replace function public.is_household_manager(p_household_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$ select private.is_household_manager(p_household_id) $$;

create or replace function public.is_household_member(p_household_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$ select private.is_household_member(p_household_id) $$;

create or replace function public.leave_household(p_household_id uuid)
returns void
language sql
volatile
security invoker
set search_path = ''
as $$ select private.leave_household(p_household_id) $$;

create or replace function public.reconcile_snowball_transaction(
  p_transaction_id text,
  p_debt_id text,
  p_occurrence_date date,
  p_planned_amount numeric,
  p_settlement text,
  p_extra_category text default null
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.reconcile_snowball_transaction(
    p_transaction_id,
    p_debt_id,
    p_occurrence_date,
    p_planned_amount,
    p_settlement,
    p_extra_category
  )
$$;

create or replace function public.reconcile_transaction(
  p_transaction_id text,
  p_resolution text,
  p_target_id text default null,
  p_occurrence_date date default null,
  p_planned_amount numeric default null,
  p_settlement text default null,
  p_extra_category text default null
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.reconcile_transaction(
    p_transaction_id,
    p_resolution,
    p_target_id,
    p_occurrence_date,
    p_planned_amount,
    p_settlement,
    p_extra_category
  )
$$;

create or replace function public.remove_household_member(
  p_household_id uuid,
  p_member_user_id uuid
)
returns void
language sql
volatile
security invoker
set search_path = ''
as $$ select private.remove_household_member(p_household_id, p_member_user_id) $$;

create or replace function public.revoke_household_invite(p_invite_id uuid)
returns void
language sql
volatile
security invoker
set search_path = ''
as $$ select private.revoke_household_invite(p_invite_id) $$;

create or replace function public.undo_transaction_reconciliation(p_transaction_id text)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$ select private.undo_transaction_reconciliation(p_transaction_id) $$;

create or replace function public.update_household_member_role(
  p_household_id uuid,
  p_member_user_id uuid,
  p_role text
)
returns void
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.update_household_member_role(
    p_household_id,
    p_member_user_id,
    p_role
  )
$$;

do $$
declare
  rpc record;
begin
  for rpc in
    select
      p.proname,
      pg_get_function_identity_arguments(p.oid) as arguments
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'accept_household_invite',
        'create_household_invite',
        'delete_bill_completely',
        'get_household_members',
        'household_role',
        'is_household_editor',
        'is_household_manager',
        'is_household_member',
        'leave_household',
        'reconcile_snowball_transaction',
        'reconcile_transaction',
        'remove_household_member',
        'revoke_household_invite',
        'undo_transaction_reconciliation',
        'update_household_member_role'
      )
  loop
    execute format(
      'revoke all on function public.%I(%s) from public, anon',
      rpc.proname,
      rpc.arguments
    );
    execute format(
      'grant execute on function public.%I(%s) to authenticated, service_role',
      rpc.proname,
      rpc.arguments
    );
  end loop;
end;
$$;

-- These server-only tables deliberately have no client access. Explicit
-- restrictive policies document that contract while service_role keeps its
-- existing RLS bypass for the notification API.

drop policy if exists "push subscriptions: deny client access" on public.push_subscriptions;
create policy "push subscriptions: deny client access"
on public.push_subscriptions
as restrictive
for all
to anon, authenticated
using (false)
with check (false);

drop policy if exists "push events: deny client access" on public.push_notification_events;
create policy "push events: deny client access"
on public.push_notification_events
as restrictive
for all
to anon, authenticated
using (false)
with check (false);

drop policy if exists "notification preferences: deny client access" on public.user_notification_preferences;
create policy "notification preferences: deny client access"
on public.user_notification_preferences
as restrictive
for all
to anon, authenticated
using (false)
with check (false);

-- Cover the remaining foreign key used when archived bucket owners are removed.
create index if not exists goals_archived_by_idx
  on public.goals (archived_by);
