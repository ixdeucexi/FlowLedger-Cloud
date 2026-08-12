-- Saved Pro Plan Simulator definitions. Results are always recomputed from the
-- current household plan and are intentionally never persisted here.
create table public.plan_simulations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  horizon_months integer not null check (horizon_months in (3, 6, 12, 24)),
  changes jsonb not null default '[]'::jsonb check (
    jsonb_typeof(changes) = 'array'
    and jsonb_array_length(changes) <= 50
    and octet_length(changes::text) <= 65536
  ),
  schema_version smallint not null default 1 check (schema_version = 1),
  version integer not null default 1 check (version >= 1),
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index plan_simulations_household_normalized_name_idx
  on public.plan_simulations (household_id, lower(btrim(name)));

create index plan_simulations_household_updated_idx
  on public.plan_simulations (household_id, updated_at desc);

comment on table public.plan_simulations is
  'Versioned Plan Simulator definitions only; financial results and baseline snapshots are never stored.';

alter table public.plan_simulations enable row level security;

revoke all on table public.plan_simulations from public, anon, authenticated, service_role;
grant select, insert, delete on table public.plan_simulations to authenticated;
grant update (name, horizon_months, changes, version) on table public.plan_simulations to authenticated;

create policy "plan simulations: pro members read"
on public.plan_simulations for select to authenticated
using (
  (select public.is_household_member(household_id))
  and exists (
    select 1 from public.household_plans plan
    where plan.household_id = plan_simulations.household_id
      and plan.tier = 'pro'
  )
);

create policy "plan simulations: pro editors insert"
on public.plan_simulations for insert to authenticated
with check (
  exists (
    select 1 from public.household_members member
    where member.household_id = plan_simulations.household_id
      and member.user_id = (select auth.uid())
      and member.role in ('owner', 'manager', 'editor')
  )
  and exists (
    select 1 from public.household_plans plan
    where plan.household_id = plan_simulations.household_id
      and plan.tier = 'pro'
  )
);

create policy "plan simulations: pro editors update"
on public.plan_simulations for update to authenticated
using (
  exists (
    select 1 from public.household_members member
    where member.household_id = plan_simulations.household_id
      and member.user_id = (select auth.uid())
      and member.role in ('owner', 'manager', 'editor')
  )
  and exists (
    select 1 from public.household_plans plan
    where plan.household_id = plan_simulations.household_id
      and plan.tier = 'pro'
  )
)
with check (
  exists (
    select 1 from public.household_members member
    where member.household_id = plan_simulations.household_id
      and member.user_id = (select auth.uid())
      and member.role in ('owner', 'manager', 'editor')
  )
  and exists (
    select 1 from public.household_plans plan
    where plan.household_id = plan_simulations.household_id
      and plan.tier = 'pro'
  )
);

create policy "plan simulations: pro editors delete"
on public.plan_simulations for delete to authenticated
using (
  exists (
    select 1 from public.household_members member
    where member.household_id = plan_simulations.household_id
      and member.user_id = (select auth.uid())
      and member.role in ('owner', 'manager', 'editor')
  )
  and exists (
    select 1 from public.household_plans plan
    where plan.household_id = plan_simulations.household_id
      and plan.tier = 'pro'
  )
);

create or replace function private.protect_plan_simulation_definition()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Plan Simulator requires an authenticated user';
  end if;

  if tg_op = 'INSERT' then
    new.id := gen_random_uuid();
    new.created_by := (select auth.uid());
    new.updated_by := (select auth.uid());
    new.created_at := now();
    new.updated_at := now();
    new.version := 1;
  else
    if new.id is distinct from old.id
      or new.household_id is distinct from old.household_id
      or new.created_by is distinct from old.created_by
      or new.created_at is distinct from old.created_at
    then
      raise exception 'Plan Simulator identity cannot be changed';
    end if;
    if new.version is distinct from old.version + 1 then
      raise exception 'Plan Simulator version conflict';
    end if;
    new.updated_by := (select auth.uid());
    new.updated_at := now();
  end if;

  new.name := btrim(new.name);
  return new;
end;
$$;

revoke all on function private.protect_plan_simulation_definition()
  from public, anon, authenticated;

create trigger plan_simulations_protect_definition
before insert or update on public.plan_simulations
for each row execute function private.protect_plan_simulation_definition();
