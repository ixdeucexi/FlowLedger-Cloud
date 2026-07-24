-- Independent planning tools: zero-based budgeting can be used with or without debt payoff automation.
-- Only backfill from the former exclusive mode when these columns are first introduced. This keeps
-- the migration safe if it is replayed under a different migration version later.
do $migration$
declare
  settings_needs_backfill boolean;
  household_settings_needs_backfill boolean;
begin
  select not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'settings'
      and column_name = 'zero_based_budget_enabled'
  ) into settings_needs_backfill;

  select not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'household_settings'
      and column_name = 'zero_based_budget_enabled'
  ) into household_settings_needs_backfill;

  alter table public.settings
    add column if not exists zero_based_budget_enabled boolean not null default false,
    add column if not exists debt_payoff_enabled boolean not null default true;

  alter table public.household_settings
    add column if not exists zero_based_budget_enabled boolean not null default false,
    add column if not exists debt_payoff_enabled boolean not null default true;

  if settings_needs_backfill then
    update public.settings
    set zero_based_budget_enabled = planning_mode = 'zero_budget',
        debt_payoff_enabled = planning_mode = 'snowball';
  end if;

  if household_settings_needs_backfill then
    update public.household_settings
    set zero_based_budget_enabled = planning_mode = 'zero_budget',
        debt_payoff_enabled = planning_mode = 'snowball';
  end if;
end
$migration$;

-- Category assignments belong to the active budget so household editors share one plan.
with ranked as (
  select id,
         row_number() over (
           partition by budget_id, category, month, year
           order by updated_at desc, created_at desc, id desc
         ) as duplicate_rank
  from public.category_budgets
  where budget_id is not null
)
delete from public.category_budgets cb
using ranked
where cb.id = ranked.id
  and ranked.duplicate_rank > 1;

alter table public.category_budgets
  drop constraint if exists category_budgets_user_id_category_month_year_key;

alter table public.category_budgets
  drop constraint if exists category_budgets_budget_category_month_year_key;

alter table public.category_budgets
  add constraint category_budgets_budget_category_month_year_key
  unique (budget_id, category, month, year);

create index if not exists category_budgets_budget_month_idx
  on public.category_budgets (budget_id, year, month);

grant select, insert, update, delete on table public.category_budgets to authenticated;
