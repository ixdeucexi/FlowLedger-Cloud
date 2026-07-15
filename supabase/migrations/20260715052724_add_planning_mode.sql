alter table public.settings
  add column if not exists planning_mode text not null default 'snowball';

alter table public.settings
  drop constraint if exists settings_planning_mode_check;

alter table public.settings
  add constraint settings_planning_mode_check
  check (planning_mode in ('snowball', 'zero_budget', 'free_flow'));

alter table public.household_settings
  add column if not exists planning_mode text not null default 'snowball';

alter table public.household_settings
  drop constraint if exists household_settings_planning_mode_check;

alter table public.household_settings
  add constraint household_settings_planning_mode_check
  check (planning_mode in ('snowball', 'zero_budget', 'free_flow'));
