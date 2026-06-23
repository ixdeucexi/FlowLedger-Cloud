-- Phase 0 is additive: existing user_id ownership and policies remain intact.
create extension if not exists "pgcrypto";

alter table settings add column if not exists safety_floor numeric not null default 200 check (safety_floor >= 0);
alter table settings add column if not exists forecast_horizon_months integer not null default 6 check (forecast_horizon_months between 1 and 24);

create table if not exists households (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'My Household',
  created_by uuid not null references auth.users(id) on delete cascade,
  is_personal boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists households_one_personal_per_user on households(created_by) where is_personal;

create table if not exists household_members (
  household_id uuid not null references households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'editor', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

create table if not exists budgets (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  name text not null default 'Main Budget',
  is_default boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists budgets_one_default_per_household on budgets(household_id) where is_default;

alter table bills add column if not exists household_id uuid references households(id) on delete set null;
alter table bills add column if not exists budget_id uuid references budgets(id) on delete set null;
alter table monthly_overrides add column if not exists household_id uuid references households(id) on delete set null;
alter table monthly_overrides add column if not exists budget_id uuid references budgets(id) on delete set null;
alter table transactions add column if not exists household_id uuid references households(id) on delete set null;
alter table transactions add column if not exists budget_id uuid references budgets(id) on delete set null;
alter table incomes add column if not exists household_id uuid references households(id) on delete set null;
alter table incomes add column if not exists budget_id uuid references budgets(id) on delete set null;
alter table goals add column if not exists household_id uuid references households(id) on delete set null;
alter table goals add column if not exists budget_id uuid references budgets(id) on delete set null;
alter table extra_payments add column if not exists household_id uuid references households(id) on delete set null;
alter table extra_payments add column if not exists budget_id uuid references budgets(id) on delete set null;
alter table categories add column if not exists household_id uuid references households(id) on delete set null;
alter table categories add column if not exists budget_id uuid references budgets(id) on delete set null;

do $$
declare
  owner_id uuid;
  household uuid;
  budget uuid;
begin
  for owner_id in select id from auth.users
  loop
    insert into households (created_by, is_personal) values (owner_id, true)
      on conflict (created_by) where is_personal do update set created_by = excluded.created_by
      returning id into household;
    insert into household_members (household_id, user_id, role)
      values (household, owner_id, 'owner') on conflict do nothing;
    select id into budget from budgets where household_id = household and is_default limit 1;
    if budget is null then
      insert into budgets (household_id) values (household) returning id into budget;
    end if;
    update bills set household_id = household, budget_id = budget where user_id = owner_id and household_id is null;
    update monthly_overrides set household_id = household, budget_id = budget where user_id = owner_id and household_id is null;
    update transactions set household_id = household, budget_id = budget where user_id = owner_id and household_id is null;
    update incomes set household_id = household, budget_id = budget where user_id = owner_id and household_id is null;
    update goals set household_id = household, budget_id = budget where user_id = owner_id and household_id is null;
    update extra_payments set household_id = household, budget_id = budget where user_id = owner_id and household_id is null;
    update categories set household_id = household, budget_id = budget where user_id = owner_id and household_id is null;
  end loop;
end $$;

create or replace function public.bootstrap_personal_household()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  household uuid;
begin
  insert into households (created_by, is_personal) values (new.id, true)
    on conflict (created_by) where is_personal do update set created_by = excluded.created_by
    returning id into household;
  insert into household_members (household_id, user_id, role)
    values (household, new.id, 'owner') on conflict do nothing;
  insert into budgets (household_id)
    select household where not exists (select 1 from budgets where household_id = household and is_default);
  return new;
end $$;
drop trigger if exists create_personal_household on auth.users;
create trigger create_personal_household after insert on auth.users
for each row execute function public.bootstrap_personal_household();

create or replace function public.assign_personal_budget()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.household_id is null or new.budget_id is null then
    select h.id, b.id into new.household_id, new.budget_id
      from households h join budgets b on b.household_id = h.id and b.is_default
      where h.created_by = new.user_id and h.is_personal limit 1;
  end if;
  return new;
end $$;

drop trigger if exists assign_bills_budget on bills;
create trigger assign_bills_budget before insert on bills for each row execute function public.assign_personal_budget();
drop trigger if exists assign_overrides_budget on monthly_overrides;
create trigger assign_overrides_budget before insert on monthly_overrides for each row execute function public.assign_personal_budget();
drop trigger if exists assign_transactions_budget on transactions;
create trigger assign_transactions_budget before insert on transactions for each row execute function public.assign_personal_budget();
drop trigger if exists assign_incomes_budget on incomes;
create trigger assign_incomes_budget before insert on incomes for each row execute function public.assign_personal_budget();
drop trigger if exists assign_goals_budget on goals;
create trigger assign_goals_budget before insert on goals for each row execute function public.assign_personal_budget();
drop trigger if exists assign_extra_payments_budget on extra_payments;
create trigger assign_extra_payments_budget before insert on extra_payments for each row execute function public.assign_personal_budget();
drop trigger if exists assign_categories_budget on categories;
create trigger assign_categories_budget before insert on categories for each row execute function public.assign_personal_budget();

alter table households enable row level security;
alter table household_members enable row level security;
alter table budgets enable row level security;
drop policy if exists "households: owner reads" on households;
create policy "households: owner reads" on households for select using (created_by = auth.uid());
drop policy if exists "members: user reads membership" on household_members;
create policy "members: user reads membership" on household_members for select using (user_id = auth.uid());
drop policy if exists "budgets: member reads" on budgets;
create policy "budgets: member reads" on budgets for select using (
  exists (select 1 from household_members hm where hm.household_id = budgets.household_id and hm.user_id = auth.uid())
);

create table if not exists app_diagnostics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  app_version text not null,
  platform text not null check (platform in ('web', 'ios', 'android', 'unknown')),
  event_type text not null check (event_type in ('performance', 'save_failure', 'unhandled_error')),
  operation text not null,
  error_code text,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  created_at timestamptz not null default now()
);
alter table app_diagnostics enable row level security;
drop policy if exists "diagnostics: user inserts" on app_diagnostics;
create policy "diagnostics: user inserts" on app_diagnostics for insert with check (auth.uid() = user_id);
drop policy if exists "diagnostics: user reads" on app_diagnostics;
create policy "diagnostics: user reads" on app_diagnostics for select using (auth.uid() = user_id);
create index if not exists app_diagnostics_user_created_idx on app_diagnostics(user_id, created_at desc);

-- Rollback notes: the application remains compatible if these new columns and tables are left in place.
