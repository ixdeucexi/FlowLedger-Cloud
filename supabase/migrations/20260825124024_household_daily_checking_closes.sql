alter table public.plaid_items
  add column if not exists accounts_observed_at timestamptz;

create table public.household_daily_checking_closes (
  household_id uuid not null references public.households(id) on delete cascade,
  balance_date date not null,
  checking_balance numeric(14, 2) not null,
  observed_at timestamptz not null,
  account_count integer not null check (account_count > 0),
  source text not null default 'plaid_sync' check (source = 'plaid_sync'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (household_id, balance_date)
);

create index household_daily_checking_closes_household_observed_idx
  on public.household_daily_checking_closes (household_id, observed_at desc);

alter table public.household_daily_checking_closes enable row level security;

create policy "daily checking closes: household members read"
on public.household_daily_checking_closes
for select
to authenticated
using ((select private.is_household_member(household_id)));

revoke all on table public.household_daily_checking_closes from public, anon, authenticated;
grant select on table public.household_daily_checking_closes to authenticated;
grant select, insert, update, delete on table public.household_daily_checking_closes to service_role;

create or replace function public.record_household_daily_checking_close(
  p_household_id uuid,
  p_observations jsonb
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_time_zone text;
  v_balance_date date;
  v_latest_observed_at timestamptz;
  v_checking_balance numeric(14, 2);
  v_account_count integer;
  v_invalid_account_count integer;
  v_active_item_count integer;
  v_observed_item_count integer;
  v_first_observation_date date;
  v_last_observation_date date;
  v_item public.plaid_items%rowtype;
begin
  if p_household_id is null or jsonb_typeof(p_observations) <> 'array' then
    raise exception using errcode = '22004', message = 'daily_checking_close_scope_required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_household_id::text, 0)
  );

  -- Lock every connected item in deterministic order. Plaid sync acquisition
  -- updates these same rows, so no item can begin writing account balances until
  -- this aggregate either commits or declines to capture.
  for v_item in
    select item.*
    from public.plaid_items as item
    where item.household_id = p_household_id
      and item.status in ('active', 'needs_repair')
      and coalesce(item.encrypted_access_token, item.access_token_ciphertext) is not null
    order by item.id
    for update
  loop
    if v_item.sync_lock_token is not null then
      return false;
    end if;
  end loop;

  select settings.time_zone
  into v_time_zone
  from public.household_settings as settings
  where settings.household_id = p_household_id;

  if v_time_zone is null or not exists (
    select 1
    from pg_catalog.pg_timezone_names as zone
    where zone.name = v_time_zone
  ) then
    raise exception using errcode = '22023', message = 'daily_checking_close_time_zone_invalid';
  end if;

  with observations as (
    select observation.item_id, max(observation.observed_at) as observed_at
    from jsonb_to_recordset(p_observations)
      as observation(item_id uuid, observed_at timestamptz)
    group by observation.item_id
  ), active_items as (
    select item.id, item.accounts_observed_at
    from public.plaid_items as item
    where item.household_id = p_household_id
      and item.status in ('active', 'needs_repair')
      and coalesce(item.encrypted_access_token, item.access_token_ciphertext) is not null
  )
  select
    count(*)::integer,
    count(observation.observed_at)::integer,
    min((observation.observed_at at time zone v_time_zone)::date),
    max((observation.observed_at at time zone v_time_zone)::date),
    max(observation.observed_at)
  into
    v_active_item_count,
    v_observed_item_count,
    v_first_observation_date,
    v_last_observation_date,
    v_latest_observed_at
  from active_items as item
  left join observations as observation
    on observation.item_id = item.id
   and observation.observed_at = item.accounts_observed_at;

  if v_active_item_count = 0
     or v_observed_item_count <> v_active_item_count
     or v_first_observation_date is distinct from v_last_observation_date then
    return false;
  end if;

  v_balance_date := v_first_observation_date;

  with ranked_accounts as (
    select
      account.id,
      account.current_balance,
      account.updated_at as account_observed_at,
      item.accounts_observed_at as item_accounts_observed_at,
      row_number() over (
        partition by coalesce(
          nullif('persistent:' || lower(trim(account.persistent_account_id)), 'persistent:'),
          case
            when nullif(trim(account.mask), '') is not null then concat_ws(
              ':',
              'fallback',
              lower(coalesce(item.institution_id, '')),
              lower(trim(account.mask)),
              lower(coalesce(account.account_type, account.type, '')),
              lower(coalesce(account.account_subtype, account.subtype, '')),
              lower(trim(coalesce(account.official_name, account.name, '')))
            )
            else 'row:' || account.id::text
          end
        )
        order by account.updated_at desc, account.created_at desc, account.id desc
      ) as canonical_rank
    from public.plaid_accounts as account
    join public.plaid_items as item
     on item.id = account.plaid_item_record_id
     and item.household_id = account.household_id
     and item.status in ('active', 'needs_repair')
     and coalesce(item.encrypted_access_token, item.access_token_ciphertext) is not null
    where account.household_id = p_household_id
      and account.is_active = true
      and lower(coalesce(account.account_subtype, account.subtype, '')) = 'checking'
      and lower(coalesce(account.account_type, account.type, '')) in ('depository', 'checking')
  )
  select
    round(sum(current_balance), 2),
    count(*)::integer,
    count(*) filter (
      where current_balance is null
         or account_observed_at is distinct from item_accounts_observed_at
    )::integer
  into v_checking_balance, v_account_count, v_invalid_account_count
  from ranked_accounts
  where canonical_rank = 1;

  if v_account_count = 0 or v_invalid_account_count > 0 then
    return false;
  end if;

  insert into public.household_daily_checking_closes (
    household_id,
    balance_date,
    checking_balance,
    observed_at,
    account_count,
    source,
    updated_at
  ) values (
    p_household_id,
    v_balance_date,
    v_checking_balance,
    v_latest_observed_at,
    v_account_count,
    'plaid_sync',
    v_latest_observed_at
  )
  on conflict (household_id, balance_date) do update
  set checking_balance = excluded.checking_balance,
      observed_at = excluded.observed_at,
      account_count = excluded.account_count,
      source = excluded.source,
      updated_at = excluded.updated_at
  where excluded.observed_at > public.household_daily_checking_closes.observed_at;

  return true;
end;
$$;

revoke all on function public.record_household_daily_checking_close(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_household_daily_checking_close(uuid, jsonb)
  to service_role;
