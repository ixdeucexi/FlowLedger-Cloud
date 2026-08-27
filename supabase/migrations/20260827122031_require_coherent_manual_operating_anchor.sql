-- An aggregate balance is only an honest dated observation when every manual
-- checking/cash account in that aggregate was observed on the same date.
-- Reject a new account atomically when it would cause the RPC to relabel older
-- balances with the newest account's date.

create or replace function public.add_manual_account_with_anchor(
  p_household_id uuid,
  p_budget_id uuid,
  p_account jsonb,
  p_balance_id text
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_account public.accounts%rowtype;
  v_settings public.household_settings%rowtype;
  v_anchor_balance numeric;
  v_anchor_min_date date;
  v_anchor_max_date date;
  v_inserted_count integer := 0;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  if p_household_id is null or not public.is_household_editor(p_household_id) then
    raise exception 'Household edit access required';
  end if;
  if not exists (
    select 1 from public.budgets
    where id = p_budget_id and household_id = p_household_id
  ) then
    raise exception 'The active household budget changed';
  end if;
  if jsonb_typeof(coalesce(p_account, '{}'::jsonb)) <> 'object'
     or coalesce(p_account ->> 'id', '') = ''
     or coalesce(p_balance_id, '') = ''
     or p_account ->> 'account_type' not in ('checking', 'savings', 'cash') then
    raise exception 'Invalid account creation intent';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('flowledger-settings:' || p_household_id::text, 0));
  insert into public.accounts (
    id, user_id, household_id, budget_id, name, account_type,
    current_balance, balance_as_of, last_reconciled_at, is_active, created_at
  ) values (
    p_account ->> 'id', v_actor, p_household_id, p_budget_id,
    p_account ->> 'name', p_account ->> 'account_type',
    (p_account ->> 'current_balance')::numeric,
    (p_account ->> 'balance_as_of')::date,
    (p_account ->> 'last_reconciled_at')::timestamptz,
    coalesce((p_account ->> 'is_active')::boolean, true),
    coalesce((p_account ->> 'created_at')::timestamptz, now())
  ) on conflict (id) do nothing;
  get diagnostics v_inserted_count = row_count;

  select * into v_account
  from public.accounts
  where id = p_account ->> 'id'
  for update;
  if not found or v_account.household_id is distinct from p_household_id then
    raise exception 'Account id is already in use';
  end if;
  if v_inserted_count = 0 and (
    v_account.user_id is distinct from v_actor
    or v_account.budget_id is distinct from p_budget_id
    or v_account.name is distinct from (p_account ->> 'name')
    or v_account.account_type is distinct from (p_account ->> 'account_type')
    or v_account.current_balance is distinct from (p_account ->> 'current_balance')::numeric
    or v_account.balance_as_of is distinct from (p_account ->> 'balance_as_of')::date
    or v_account.last_reconciled_at is distinct from (p_account ->> 'last_reconciled_at')::timestamptz
    or v_account.is_active is distinct from coalesce((p_account ->> 'is_active')::boolean, true)
  ) then
    raise exception using
      errcode = '40001',
      message = 'Account creation id is already bound to a different intent';
  end if;

  insert into public.household_settings (household_id, budget_id)
  values (p_household_id, p_budget_id)
  on conflict (household_id) do nothing;

  if v_inserted_count > 0 then
    insert into public.account_balances (
      id, account_id, user_id, household_id, budget_id, balance, as_of_date, source
    ) values (
      p_balance_id, v_account.id, v_actor, p_household_id, p_budget_id,
      (p_account ->> 'current_balance')::numeric,
      (p_account ->> 'balance_as_of')::date,
      'manual'
    );

    -- A savings or inactive account does not participate in the spendable
    -- operating anchor. Save it without validating or rewriting that anchor,
    -- even if older legacy operating rows need separate reconciliation.
    if v_account.is_active and v_account.account_type in ('checking', 'cash') then
      select
        sum(account.current_balance),
        min(account.balance_as_of),
        max(account.balance_as_of)
      into v_anchor_balance, v_anchor_min_date, v_anchor_max_date
      from public.accounts account
      where account.household_id = p_household_id
        and account.is_active
        and account.account_type in ('checking', 'cash');

      if v_anchor_min_date is distinct from v_anchor_max_date then
        raise exception using
          errcode = '22023',
          message = 'Active checking and cash balances must share one as-of date';
      end if;

      if v_anchor_max_date is not null then
        update public.household_settings set
          budget_id = p_budget_id,
          starting_balance = coalesce(v_anchor_balance, 0),
          starting_balance_date = v_anchor_max_date::text,
          calendar_start_date = coalesce(calendar_start_date, to_char(v_anchor_max_date, 'YYYY-MM-01')),
          updated_at = now()
        where household_id = p_household_id;
      end if;
    end if;
  end if;

  select * into v_settings
  from public.household_settings
  where household_id = p_household_id;
  return jsonb_build_object('account', to_jsonb(v_account), 'settings', to_jsonb(v_settings));
end;
$$;

revoke all on function public.add_manual_account_with_anchor(uuid, uuid, jsonb, text)
from public, anon;
grant execute on function public.add_manual_account_with_anchor(uuid, uuid, jsonb, text)
to authenticated, service_role;

-- Bind account-update retries to one exact client intent. The canonical JSON
-- includes whether reconciliation history belongs to the mutation and its
-- stable history id, so an identical account row cannot make a different
-- history request look like a retry.
alter table public.accounts
  add column if not exists last_mutation_id text,
  add column if not exists last_mutation_intent jsonb;

comment on column public.accounts.last_mutation_id is
  'Latest atomic manual-account mutation id; durable replay ownership lives in private.manual_account_mutation_receipts.';
comment on column public.accounts.last_mutation_intent is
  'Canonical latest manual-account mutation for diagnostics and current-row verification.';

-- A latest-token column alone can forget an older request after another edit.
-- Keep a compact permanent receipt so a delayed network replay can never
-- become a fresh CAS merely because the row later cycles back to its old value.
create table if not exists private.manual_account_mutation_receipts (
  mutation_id text primary key,
  account_id text not null
    references public.accounts(id) on delete cascade,
  household_id uuid not null
    references public.households(id) on delete cascade,
  budget_id uuid not null
    references public.budgets(id) on delete cascade,
  intent jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists manual_account_mutation_receipts_account_idx
  on private.manual_account_mutation_receipts (account_id, created_at desc);
create index if not exists manual_account_mutation_receipts_household_idx
  on private.manual_account_mutation_receipts (household_id);
create index if not exists manual_account_mutation_receipts_budget_idx
  on private.manual_account_mutation_receipts (budget_id);

revoke all on table private.manual_account_mutation_receipts
from public, anon, authenticated, service_role;

comment on table private.manual_account_mutation_receipts is
  'Permanent exact-intent receipts that prevent delayed manual-account mutation replays.';

-- Older cached clients can still write the account row directly. Keep their
-- forecast anchor fail-closed too: an update may create temporarily mixed
-- observation dates, but settings remain on the last coherent aggregate until
-- every active checking/cash account again shares one real observation date.
-- A newly inserted operating account is still rejected when it would begin in
-- a mixed state, matching add_manual_account_with_anchor. Legacy scope moves
-- and FK SET NULL actions recompute both affected household aggregates instead
-- of contradicting the schema's referential actions.
create or replace function private.sync_manual_operating_anchor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_household_id uuid;
  v_new_household_id uuid;
  v_old_budget_id uuid;
  v_new_budget_id uuid;
  v_old_operating boolean := false;
  v_new_operating boolean := false;
  v_target_household_id uuid;
  v_target_budget_id uuid;
  v_anchor_balance numeric;
  v_anchor_min_date date;
  v_anchor_max_date date;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    v_old_operating := old.is_active and old.account_type in ('checking', 'cash');
    v_old_household_id := old.household_id;
    v_old_budget_id := old.budget_id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    v_new_operating := new.is_active and new.account_type in ('checking', 'cash');
    v_new_household_id := new.household_id;
    v_new_budget_id := new.budget_id;
  end if;
  if not (v_old_operating or v_new_operating) then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  -- A legacy UPDATE already owns its account row. Lock affected settings rows
  -- in UUID order, matching the account-row -> settings-row part of the current
  -- RPC and avoiding both account/advisory and cross-household lock inversions.
  for v_target_household_id in
    select distinct affected.household_id
    from (
      values
        (case when v_old_operating then v_old_household_id end),
        (case when v_new_operating then v_new_household_id end)
    ) as affected(household_id)
    where affected.household_id is not null
    order by affected.household_id
  loop
    v_target_budget_id := case
      when v_target_household_id is not distinct from v_new_household_id
        then v_new_budget_id
      else v_old_budget_id
    end;
    if v_target_budget_id is not null then
      insert into public.household_settings (household_id, budget_id)
      values (v_target_household_id, v_target_budget_id)
      on conflict (household_id) do nothing;
    end if;

    perform 1
    from public.household_settings
    where household_id = v_target_household_id
    for update;
    if not found then
      continue;
    end if;

    select
      sum(account.current_balance),
      min(account.balance_as_of),
      max(account.balance_as_of)
    into v_anchor_balance, v_anchor_min_date, v_anchor_max_date
    from public.accounts account
    where account.household_id = v_target_household_id
      and account.is_active
      and account.account_type in ('checking', 'cash');

    if tg_op = 'INSERT'
       and v_new_operating
       and v_target_household_id is not distinct from v_new_household_id
       and v_anchor_min_date is distinct from v_anchor_max_date then
      raise exception using
        errcode = '22023',
        message = 'Active checking and cash balances must share one as-of date when an account is added';
    end if;

    if v_anchor_max_date is not null
       and v_anchor_min_date is not distinct from v_anchor_max_date then
      update public.household_settings set
        starting_balance = coalesce(v_anchor_balance, 0),
        starting_balance_date = v_anchor_max_date::text,
        calendar_start_date = coalesce(
          calendar_start_date,
          to_char(v_anchor_max_date, 'YYYY-MM-01')
        ),
        updated_at = now()
      where household_id = v_target_household_id;
    end if;
  end loop;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function private.sync_manual_operating_anchor() from public;

drop trigger if exists sync_manual_operating_anchor_after_insert
on public.accounts;
create trigger sync_manual_operating_anchor_after_insert
after insert on public.accounts
for each row execute function private.sync_manual_operating_anchor();

drop trigger if exists sync_manual_operating_anchor_after_update
on public.accounts;
create trigger sync_manual_operating_anchor_after_update
after update of household_id, budget_id, is_active, account_type,
  current_balance, balance_as_of on public.accounts
for each row execute function private.sync_manual_operating_anchor();

drop trigger if exists sync_manual_operating_anchor_after_delete
on public.accounts;
create trigger sync_manual_operating_anchor_after_delete
after delete on public.accounts
for each row execute function private.sync_manual_operating_anchor();

create or replace function private.update_manual_account_with_anchor(
  p_household_id uuid,
  p_budget_id uuid,
  p_expected_account jsonb,
  p_account jsonb,
  p_mutation_id text,
  p_balance_id text,
  p_record_balance boolean
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_account public.accounts%rowtype;
  v_settings public.household_settings%rowtype;
  v_history public.account_balances%rowtype;
  v_receipt private.manual_account_mutation_receipts%rowtype;
  v_intent jsonb;
  v_matches_expected boolean;
  v_matches_intent boolean;
  v_retry boolean := false;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  if p_household_id is null or not public.is_household_editor(p_household_id) then
    raise exception 'Household edit access required';
  end if;
  if not exists (
    select 1
    from public.budgets
    where id = p_budget_id and household_id = p_household_id
  ) then
    raise exception 'The active household budget changed';
  end if;
  if jsonb_typeof(coalesce(p_expected_account, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_account, '{}'::jsonb)) <> 'object'
     or coalesce(p_expected_account ->> 'id', '') = ''
     or p_expected_account ->> 'id' is distinct from p_account ->> 'id'
     or coalesce(p_mutation_id, '') = ''
     or not (p_expected_account ?& array[
       'name', 'account_type', 'current_balance', 'balance_as_of', 'is_active'
     ])
     or not (p_account ?& array[
       'name', 'account_type', 'current_balance', 'balance_as_of', 'is_active'
     ])
     or coalesce(p_account ->> 'name', '') = ''
     or p_expected_account ->> 'account_type' not in ('checking', 'savings', 'cash', 'credit_card')
     or p_account ->> 'account_type' not in ('checking', 'savings', 'cash', 'credit_card')
     -- A legacy credit-card row may be preserved or archived, but never
     -- silently coerced into or out of an operating/manual account type.
     or (
       ('credit_card' in (
         p_expected_account ->> 'account_type',
         p_account ->> 'account_type'
       ))
       and p_expected_account ->> 'account_type'
         is distinct from p_account ->> 'account_type'
     )
     or (
       coalesce(p_record_balance, false)
       and coalesce(p_balance_id, '') = ''
     ) then
    raise exception 'Invalid account update intent';
  end if;

  v_intent := jsonb_build_object(
    'account', jsonb_build_object(
      'id', p_account ->> 'id',
      'name', p_account ->> 'name',
      'account_type', p_account ->> 'account_type',
      'current_balance', (p_account ->> 'current_balance')::numeric,
      'balance_as_of', (p_account ->> 'balance_as_of')::date,
      'last_reconciled_at', nullif(p_account ->> 'last_reconciled_at', '')::timestamptz,
      'is_active', (p_account ->> 'is_active')::boolean
    ),
    'record_balance', coalesce(p_record_balance, false),
    'balance_id', case
      when coalesce(p_record_balance, false) then to_jsonb(p_balance_id)
      else 'null'::jsonb
    end
  );

  -- Account creation and settings writes use this same household lock. Stable
  -- row ordering prevents two current clients from observing a shifted
  -- operating aggregate while either CAS is in flight.
  perform pg_advisory_xact_lock(
    hashtextextended('flowledger-settings:' || p_household_id::text, 0)
  );
  perform pg_advisory_xact_lock(
    hashtextextended('flowledger-account-mutation:' || p_mutation_id, 0)
  );
  perform 1
  from public.accounts
  where household_id = p_household_id
  order by id
  for update;

  insert into public.household_settings (household_id, budget_id)
  values (p_household_id, p_budget_id)
  on conflict (household_id) do nothing;

  select * into v_settings
  from public.household_settings
  where household_id = p_household_id
  for update;
  if not found then raise exception 'Household settings could not be initialized'; end if;

  select * into v_account
  from public.accounts
  where id = p_account ->> 'id'
  for update;
  if not found
     or v_account.household_id is distinct from p_household_id
     or v_account.budget_id is distinct from p_budget_id then
    raise exception 'Account does not belong to the active household budget';
  end if;

  v_matches_expected :=
    v_account.name is not distinct from p_expected_account ->> 'name'
    and v_account.account_type is not distinct from p_expected_account ->> 'account_type'
    and v_account.current_balance is not distinct from (p_expected_account ->> 'current_balance')::numeric
    and v_account.balance_as_of is not distinct from (p_expected_account ->> 'balance_as_of')::date
    and v_account.last_reconciled_at is not distinct from nullif(p_expected_account ->> 'last_reconciled_at', '')::timestamptz
    and v_account.is_active is not distinct from (p_expected_account ->> 'is_active')::boolean;
  v_matches_intent :=
    v_account.name is not distinct from p_account ->> 'name'
    and v_account.account_type is not distinct from p_account ->> 'account_type'
    and v_account.current_balance is not distinct from (p_account ->> 'current_balance')::numeric
    and v_account.balance_as_of is not distinct from (p_account ->> 'balance_as_of')::date
    and v_account.last_reconciled_at is not distinct from nullif(p_account ->> 'last_reconciled_at', '')::timestamptz
    and v_account.is_active is not distinct from (p_account ->> 'is_active')::boolean;

  select * into v_receipt
  from private.manual_account_mutation_receipts
  where mutation_id = p_mutation_id
  for update;

  if found then
    if v_receipt.account_id is distinct from v_account.id
       or v_receipt.household_id is distinct from p_household_id
       or v_receipt.budget_id is distinct from p_budget_id
       or v_receipt.intent is distinct from v_intent then
      raise exception using
        errcode = '40001',
        message = 'Account mutation id is already bound to a different intent';
    end if;
    if not v_matches_intent then
      raise exception using
        errcode = '40001',
        message = 'Account changed after this mutation was committed';
    end if;
    v_retry := true;
  elsif v_matches_expected then
    update public.accounts set
      name = p_account ->> 'name',
      account_type = p_account ->> 'account_type',
      current_balance = (p_account ->> 'current_balance')::numeric,
      balance_as_of = (p_account ->> 'balance_as_of')::date,
      last_reconciled_at = nullif(p_account ->> 'last_reconciled_at', '')::timestamptz,
      is_active = (p_account ->> 'is_active')::boolean,
      last_mutation_id = p_mutation_id,
      last_mutation_intent = v_intent
    where id = v_account.id
    returning * into v_account;
  else
    raise exception using
      errcode = '40001',
      message = 'Account changed while editing; refresh and try again';
  end if;

  if coalesce(p_record_balance, false) then
    if not v_retry then
      insert into public.account_balances (
        id, account_id, user_id, household_id, budget_id,
        balance, as_of_date, source
      ) values (
        p_balance_id, v_account.id, v_actor, p_household_id, p_budget_id,
        (p_account ->> 'current_balance')::numeric,
        (p_account ->> 'balance_as_of')::date,
        'reconciliation'
      );
    end if;

    select * into v_history
    from public.account_balances
    where id = p_balance_id
    for update;
    if not found
       or v_history.account_id is distinct from v_account.id
       or v_history.user_id is distinct from v_actor
       or v_history.household_id is distinct from p_household_id
       or v_history.budget_id is distinct from p_budget_id
       or v_history.balance is distinct from (p_account ->> 'current_balance')::numeric
       or v_history.as_of_date is distinct from (p_account ->> 'balance_as_of')::date
       or v_history.source is distinct from 'reconciliation' then
      raise exception using
        errcode = '40001',
        message = 'Balance history id is already bound to a different intent';
    end if;
  end if;

  if not v_retry then
    insert into private.manual_account_mutation_receipts (
      mutation_id, account_id, household_id, budget_id, intent
    ) values (
      p_mutation_id, v_account.id, p_household_id, p_budget_id, v_intent
    );
  end if;

  -- The trigger above has already advanced a coherent aggregate or retained
  -- the last coherent observation. Re-read it inside this same transaction so
  -- the client never has to guess which forecast anchor is authoritative.
  select * into v_settings
  from public.household_settings
  where household_id = p_household_id;

  return jsonb_build_object(
    'account', to_jsonb(v_account),
    'settings', to_jsonb(v_settings),
    'retry', v_retry
  );
end;
$$;

revoke all on function private.update_manual_account_with_anchor(
  uuid, uuid, jsonb, jsonb, text, text, boolean
) from public, anon, authenticated, service_role;
grant execute on function private.update_manual_account_with_anchor(
  uuid, uuid, jsonb, jsonb, text, text, boolean
) to authenticated;

create or replace function public.update_manual_account_with_anchor(
  p_household_id uuid,
  p_budget_id uuid,
  p_expected_account jsonb,
  p_account jsonb,
  p_mutation_id text,
  p_balance_id text,
  p_record_balance boolean
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.update_manual_account_with_anchor(
    p_household_id,
    p_budget_id,
    p_expected_account,
    p_account,
    p_mutation_id,
    p_balance_id,
    p_record_balance
  )
$$;

revoke all on function public.update_manual_account_with_anchor(
  uuid, uuid, jsonb, jsonb, text, text, boolean
) from public, anon, service_role;
grant execute on function public.update_manual_account_with_anchor(
  uuid, uuid, jsonb, jsonb, text, text, boolean
) to authenticated;

do $manual_account_acl_audit$
begin
  if has_table_privilege(
       'authenticated',
       'private.manual_account_mutation_receipts',
       'select'
     )
     or has_table_privilege(
       'authenticated',
       'private.manual_account_mutation_receipts',
       'insert'
     )
     or has_function_privilege(
       'anon',
       'public.update_manual_account_with_anchor(uuid,uuid,jsonb,jsonb,text,text,boolean)',
       'execute'
     )
     or has_function_privilege(
       'service_role',
       'public.update_manual_account_with_anchor(uuid,uuid,jsonb,jsonb,text,text,boolean)',
       'execute'
     )
     or not has_function_privilege(
       'authenticated',
       'public.update_manual_account_with_anchor(uuid,uuid,jsonb,jsonb,text,text,boolean)',
       'execute'
     ) then
    raise exception 'Manual account mutation ACLs are invalid';
  end if;
end;
$manual_account_acl_audit$;

-- Repair coherent aggregates whose settings row predates the latest account
-- observation. Mixed households deliberately retain their last coherent
-- historical settings anchor.
with coherent_operating_anchor as (
  select
    account.household_id,
    sum(account.current_balance) as balance,
    min(account.balance_as_of) as min_date,
    max(account.balance_as_of) as max_date
  from public.accounts account
  where account.household_id is not null
    and account.is_active
    and account.account_type in ('checking', 'cash')
  group by account.household_id
  having min(account.balance_as_of) = max(account.balance_as_of)
)
update public.household_settings settings set
  starting_balance = coalesce(anchor.balance, 0),
  starting_balance_date = anchor.max_date::text,
  calendar_start_date = coalesce(
    settings.calendar_start_date,
    to_char(anchor.max_date, 'YYYY-MM-01')
  ),
  updated_at = now()
from coherent_operating_anchor anchor
where settings.household_id = anchor.household_id
  and (
    settings.starting_balance is distinct from coalesce(anchor.balance, 0)
    or settings.starting_balance_date is distinct from anchor.max_date::text
  );

notify pgrst, 'reload schema';
