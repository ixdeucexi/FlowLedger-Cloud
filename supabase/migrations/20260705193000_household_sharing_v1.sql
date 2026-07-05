-- Household sharing V1.
-- Additive and rollback-safe: existing user_id ownership stays active.
create extension if not exists "pgcrypto";

alter table user_preferences
  add column if not exists active_household_id uuid references households(id) on delete set null;

alter table bill_date_moves add column if not exists household_id uuid references households(id) on delete set null;
alter table bill_date_moves add column if not exists budget_id uuid references budgets(id) on delete set null;

alter table account_balances add column if not exists household_id uuid references households(id) on delete set null;
alter table account_balances add column if not exists budget_id uuid references budgets(id) on delete set null;

create table if not exists household_settings (
  household_id uuid primary key references households(id) on delete cascade,
  budget_id uuid references budgets(id) on delete set null,
  payment_method text not null default 'snowball' check (payment_method in ('snowball', 'avalanche')),
  starting_balance numeric not null default 0,
  starting_balance_date text,
  safety_floor numeric not null default 200 check (safety_floor >= 0),
  forecast_horizon_months integer not null default 6 check (forecast_horizon_months between 1 and 24),
  onboarding_completed boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists household_invites (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  code_hash text not null unique,
  role text not null default 'editor' check (role in ('editor', 'viewer')),
  created_by uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists household_invites_household_created_idx on household_invites(household_id, created_at desc);

-- Make sure every existing user has a personal household/budget before backfilling.
do $$
declare
  owner_id uuid;
  household uuid;
  budget uuid;
begin
  for owner_id in select id from auth.users
  loop
    insert into households (created_by, is_personal)
      values (owner_id, true)
      on conflict (created_by) where is_personal do update set created_by = excluded.created_by
      returning id into household;

    insert into household_members (household_id, user_id, role)
      values (household, owner_id, 'owner')
      on conflict do nothing;

    select id into budget from budgets where household_id = household and is_default limit 1;
    if budget is null then
      insert into budgets (household_id) values (household) returning id into budget;
    end if;

    update bill_date_moves m
      set household_id = household, budget_id = budget
      where m.user_id = owner_id and m.household_id is null;

    update account_balances ab
      set household_id = household, budget_id = budget
      where ab.user_id = owner_id and ab.household_id is null;

    insert into household_settings (
      household_id, budget_id, payment_method, starting_balance, starting_balance_date,
      safety_floor, forecast_horizon_months, onboarding_completed
    )
    select household, budget, s.payment_method, s.starting_balance, s.starting_balance_date,
           coalesce(s.safety_floor, 200), coalesce(s.forecast_horizon_months, 6), coalesce(s.onboarding_completed, false)
    from settings s
    where s.user_id = owner_id
    on conflict (household_id) do nothing;
  end loop;
end $$;

create or replace function public.household_role(p_household_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select hm.role
  from household_members hm
  where hm.household_id = p_household_id
    and hm.user_id = auth.uid()
  limit 1
$$;

create or replace function public.is_household_member(p_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from household_members hm
    where hm.household_id = p_household_id
      and hm.user_id = auth.uid()
  )
$$;

create or replace function public.is_household_editor(p_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from household_members hm
    where hm.household_id = p_household_id
      and hm.user_id = auth.uid()
      and hm.role in ('owner', 'editor')
  )
$$;

create or replace function public.create_household_invite(
  p_household_id uuid,
  p_role text default 'editor'
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  invite_code text;
begin
  if public.household_role(p_household_id) <> 'owner' then
    raise exception 'Only the household owner can create invites';
  end if;

  if coalesce(p_role, 'editor') not in ('editor', 'viewer') then
    raise exception 'Invalid invite role';
  end if;

  invite_code := upper(substr(encode(gen_random_bytes(9), 'hex'), 1, 12));

  insert into household_invites (household_id, code_hash, role, created_by)
  values (
    p_household_id,
    encode(digest(invite_code, 'sha256'), 'hex'),
    coalesce(p_role, 'editor'),
    auth.uid()
  );

  return invite_code;
end $$;

create or replace function public.accept_household_invite(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  invite household_invites%rowtype;
  clean_code text;
begin
  clean_code := upper(regexp_replace(coalesce(p_code, ''), '\s+', '', 'g'));
  if clean_code = '' then
    raise exception 'Invite code is required';
  end if;

  select *
    into invite
  from household_invites
  where code_hash = encode(digest(clean_code, 'sha256'), 'hex')
    and revoked_at is null
    and accepted_at is null
    and expires_at > now()
  limit 1;

  if invite.id is null then
    raise exception 'Invite code is invalid or expired';
  end if;

  insert into household_members (household_id, user_id, role)
  values (invite.household_id, auth.uid(), invite.role)
  on conflict (household_id, user_id) do update set role = excluded.role;

  update household_invites
    set accepted_by = auth.uid(), accepted_at = now()
  where id = invite.id;

  insert into user_preferences (user_id, active_household_id, updated_at)
  values (auth.uid(), invite.household_id, now())
  on conflict (user_id) do update
    set active_household_id = excluded.active_household_id,
        updated_at = now();

  return invite.household_id;
end $$;

create or replace function public.revoke_household_invite(p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_household uuid;
begin
  select household_id into target_household
  from household_invites
  where id = p_invite_id;

  if target_household is null then
    return;
  end if;

  if public.household_role(target_household) <> 'owner' then
    raise exception 'Only the household owner can revoke invites';
  end if;

  update household_invites
    set revoked_at = now()
  where id = p_invite_id;
end $$;

alter table household_settings enable row level security;
alter table household_invites enable row level security;

drop policy if exists "households: members read" on households;
create policy "households: members read" on households for select using (
  public.is_household_member(id)
);

drop policy if exists "members: household members read" on household_members;
create policy "members: household members read" on household_members for select using (
  public.is_household_member(household_id)
);

drop policy if exists "members: owner manages" on household_members;
create policy "members: owner manages" on household_members for all using (
  public.household_role(household_id) = 'owner'
) with check (
  public.household_role(household_id) = 'owner'
);

drop policy if exists "household settings: members read" on household_settings;
create policy "household settings: members read" on household_settings for select using (
  public.is_household_member(household_id)
);

drop policy if exists "household settings: editors write" on household_settings;
create policy "household settings: editors write" on household_settings for all using (
  public.is_household_editor(household_id)
) with check (
  public.is_household_editor(household_id)
);

drop policy if exists "household invites: owners read" on household_invites;
create policy "household invites: owners read" on household_invites for select using (
  public.household_role(household_id) = 'owner'
);

-- Shared-data policies. Existing user_id policies remain in place for personal ownership.
drop policy if exists "bills: household members read" on bills;
create policy "bills: household members read" on bills for select using (household_id is not null and public.is_household_member(household_id));
drop policy if exists "bills: household editors write" on bills;
create policy "bills: household editors write" on bills for all using (household_id is not null and public.is_household_editor(household_id)) with check (household_id is not null and public.is_household_editor(household_id));

drop policy if exists "monthly overrides: household members read" on monthly_overrides;
create policy "monthly overrides: household members read" on monthly_overrides for select using (household_id is not null and public.is_household_member(household_id));
drop policy if exists "monthly overrides: household editors write" on monthly_overrides;
create policy "monthly overrides: household editors write" on monthly_overrides for all using (household_id is not null and public.is_household_editor(household_id)) with check (household_id is not null and public.is_household_editor(household_id));

drop policy if exists "transactions: household members read" on transactions;
create policy "transactions: household members read" on transactions for select using (household_id is not null and public.is_household_member(household_id));
drop policy if exists "transactions: household editors write" on transactions;
create policy "transactions: household editors write" on transactions for all using (household_id is not null and public.is_household_editor(household_id)) with check (household_id is not null and public.is_household_editor(household_id));

drop policy if exists "incomes: household members read" on incomes;
create policy "incomes: household members read" on incomes for select using (household_id is not null and public.is_household_member(household_id));
drop policy if exists "incomes: household editors write" on incomes;
create policy "incomes: household editors write" on incomes for all using (household_id is not null and public.is_household_editor(household_id)) with check (household_id is not null and public.is_household_editor(household_id));

drop policy if exists "goals: household members read" on goals;
create policy "goals: household members read" on goals for select using (household_id is not null and public.is_household_member(household_id));
drop policy if exists "goals: household editors write" on goals;
create policy "goals: household editors write" on goals for all using (household_id is not null and public.is_household_editor(household_id)) with check (household_id is not null and public.is_household_editor(household_id));

drop policy if exists "extra payments: household members read" on extra_payments;
create policy "extra payments: household members read" on extra_payments for select using (household_id is not null and public.is_household_member(household_id));
drop policy if exists "extra payments: household editors write" on extra_payments;
create policy "extra payments: household editors write" on extra_payments for all using (household_id is not null and public.is_household_editor(household_id)) with check (household_id is not null and public.is_household_editor(household_id));

drop policy if exists "categories: household members read" on categories;
create policy "categories: household members read" on categories for select using (household_id is not null and public.is_household_member(household_id));
drop policy if exists "categories: household editors write" on categories;
create policy "categories: household editors write" on categories for all using (household_id is not null and public.is_household_editor(household_id)) with check (household_id is not null and public.is_household_editor(household_id));

drop policy if exists "accounts: household members read" on accounts;
create policy "accounts: household members read" on accounts for select using (household_id is not null and public.is_household_member(household_id));
drop policy if exists "accounts: household editors write" on accounts;
create policy "accounts: household editors write" on accounts for all using (household_id is not null and public.is_household_editor(household_id)) with check (household_id is not null and public.is_household_editor(household_id));

drop policy if exists "account balances: household members read" on account_balances;
create policy "account balances: household members read" on account_balances for select using (household_id is not null and public.is_household_member(household_id));
drop policy if exists "account balances: household editors write" on account_balances;
create policy "account balances: household editors write" on account_balances for all using (household_id is not null and public.is_household_editor(household_id)) with check (household_id is not null and public.is_household_editor(household_id));

drop policy if exists "decisions: household members read" on decisions;
create policy "decisions: household members read" on decisions for select using (household_id is not null and public.is_household_member(household_id));
drop policy if exists "decisions: household editors write" on decisions;
create policy "decisions: household editors write" on decisions for all using (household_id is not null and public.is_household_editor(household_id)) with check (household_id is not null and public.is_household_editor(household_id));

do $$
begin
  if to_regclass('public.category_budgets') is not null then
    drop policy if exists "category budgets: household members read" on category_budgets;
    create policy "category budgets: household members read" on category_budgets for select using (household_id is not null and public.is_household_member(household_id));
    drop policy if exists "category budgets: household editors write" on category_budgets;
    create policy "category budgets: household editors write" on category_budgets for all using (household_id is not null and public.is_household_editor(household_id)) with check (household_id is not null and public.is_household_editor(household_id));
  end if;
end $$;

drop policy if exists "bill date moves: household members read" on bill_date_moves;
create policy "bill date moves: household members read" on bill_date_moves for select using (household_id is not null and public.is_household_member(household_id));
drop policy if exists "bill date moves: household editors write" on bill_date_moves;
create policy "bill date moves: household editors write" on bill_date_moves for all using (household_id is not null and public.is_household_editor(household_id)) with check (household_id is not null and public.is_household_editor(household_id));
