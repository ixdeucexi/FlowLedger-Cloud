create table public.household_plans (
  household_id uuid primary key references public.households(id) on delete cascade,
  tier text not null default 'free' check (tier in ('free', 'pro')),
  source text not null default 'default'
    check (source in ('default', 'grandfathered', 'admin', 'billing')),
  grandfathered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint household_plans_grandfathered_date_check check (
    source <> 'grandfathered' or grandfathered_at is not null
  )
);

comment on table public.household_plans is
  'Server-controlled membership tier shared by every member of a household.';
comment on column public.household_plans.tier is
  'FlowLedger membership tier: free or pro.';
comment on column public.household_plans.source is
  'How the tier was assigned. Client applications cannot change this value.';

-- Every household that exists when memberships launch keeps permanent Pro.
insert into public.household_plans (
  household_id,
  tier,
  source,
  grandfathered_at
)
select
  id,
  'pro',
  'grandfathered',
  now()
from public.households
on conflict (household_id) do nothing;

alter table public.household_plans enable row level security;

revoke all on table public.household_plans from anon, authenticated;
grant select on table public.household_plans to authenticated;

create policy "household members can read shared plan"
on public.household_plans
for select
to authenticated
using (public.is_household_member(household_id));

-- Use a non-exposed schema so only the database trigger can assign new plans.
create schema if not exists private;

create or replace function private.assign_default_household_plan()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.household_plans (household_id, tier, source)
  values (new.id, 'free', 'default')
  on conflict (household_id) do nothing;

  return new;
end;
$$;

revoke all on function private.assign_default_household_plan() from public, anon, authenticated;

create trigger assign_default_household_plan
after insert on public.households
for each row
execute function private.assign_default_household_plan();
