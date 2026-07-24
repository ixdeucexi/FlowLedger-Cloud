-- Bill importance is the source of truth for Must Pay protection.
update public.bills
set smart_priority = 'must'
where smart_priority is null
   or smart_priority not in ('must', 'flexible', 'optional')
   or is_debt = true;

alter table public.bills
  alter column smart_priority set default 'must',
  alter column smart_priority set not null;

alter table public.bills
  drop constraint if exists bills_smart_priority_check;

alter table public.bills
  add constraint bills_smart_priority_check
  check (smart_priority in ('must', 'flexible', 'optional'));

-- Keep the visible Calendar start separate from the latest balance anchor.
alter table public.settings
  add column if not exists calendar_start_date text;

alter table public.household_settings
  add column if not exists calendar_start_date text;

update public.settings
set calendar_start_date = concat(substring(starting_balance_date from 1 for 7), '-01')
where calendar_start_date is null
  and starting_balance_date ~ '^\d{4}-\d{2}-\d{2}$';

update public.household_settings
set calendar_start_date = concat(substring(starting_balance_date from 1 for 7), '-01')
where calendar_start_date is null
  and starting_balance_date ~ '^\d{4}-\d{2}-\d{2}$';

alter table public.settings
  drop constraint if exists settings_calendar_start_date_check;

alter table public.settings
  add constraint settings_calendar_start_date_check
  check (calendar_start_date is null or calendar_start_date ~ '^\d{4}-\d{2}-\d{2}$');

alter table public.household_settings
  drop constraint if exists household_settings_calendar_start_date_check;

alter table public.household_settings
  add constraint household_settings_calendar_start_date_check
  check (calendar_start_date is null or calendar_start_date ~ '^\d{4}-\d{2}-\d{2}$');

-- Keep notification event keys nullable across posted and pending alerts.
alter table public.push_notification_events
  alter column event_key drop not null;

-- Replace overlapping ALL/public policies with one authenticated policy per command.
-- Owners retain personal-row access; household members read and editors write.
do $migration$
declare
  table_name text;
  policy_row record;
  table_names constant text[] := array[
    'account_balances',
    'accounts',
    'bills',
    'bill_date_moves',
    'categories',
    'category_budgets',
    'decisions',
    'extra_payments',
    'goals',
    'incomes',
    'monthly_overrides',
    'transactions'
  ];
begin
  foreach table_name in array table_names loop
    for policy_row in
      select policyname
      from pg_policies
      where schemaname = 'public'
        and tablename = table_name
    loop
      execute format('drop policy if exists %I on public.%I', policy_row.policyname, table_name);
    end loop;

    execute format(
      'create policy %I on public.%I for select to authenticated using (
        (user_id = (select auth.uid()))
        or (household_id is not null and (select public.is_household_member(household_id)))
      )',
      table_name || ': authenticated read',
      table_name
    );

    execute format(
      'create policy %I on public.%I for insert to authenticated with check (
        (household_id is null and user_id = (select auth.uid()))
        or (household_id is not null and (select public.is_household_editor(household_id)))
      )',
      table_name || ': authenticated insert',
      table_name
    );

    execute format(
      'create policy %I on public.%I for update to authenticated using (
        (household_id is null and user_id = (select auth.uid()))
        or (household_id is not null and (select public.is_household_editor(household_id)))
      ) with check (
        (household_id is null and user_id = (select auth.uid()))
        or (household_id is not null and (select public.is_household_editor(household_id)))
      )',
      table_name || ': authenticated update',
      table_name
    );

    execute format(
      'create policy %I on public.%I for delete to authenticated using (
        (household_id is null and user_id = (select auth.uid()))
        or (household_id is not null and (select public.is_household_editor(household_id)))
      )',
      table_name || ': authenticated delete',
      table_name
    );
  end loop;
end
$migration$;
