-- Run after 20260623_phase0_foundation.sql in the Supabase SQL editor.
do $$
declare missing_count integer;
begin
  if not exists (select 1 from information_schema.columns where table_name = 'settings' and column_name = 'safety_floor') then
    raise exception 'settings.safety_floor is missing';
  end if;
  if not exists (select 1 from information_schema.tables where table_name = 'app_diagnostics') then
    raise exception 'app_diagnostics is missing';
  end if;
  select count(*) into missing_count from bills where household_id is null or budget_id is null;
  if missing_count > 0 then raise exception 'bills backfill incomplete: % rows', missing_count; end if;
  select count(*) into missing_count from transactions where household_id is null or budget_id is null;
  if missing_count > 0 then raise exception 'transactions backfill incomplete: % rows', missing_count; end if;
  select count(*) into missing_count from monthly_overrides where household_id is null or budget_id is null;
  if missing_count > 0 then raise exception 'overrides backfill incomplete: % rows', missing_count; end if;
  select count(*) into missing_count from incomes where household_id is null or budget_id is null;
  if missing_count > 0 then raise exception 'incomes backfill incomplete: % rows', missing_count; end if;
  select count(*) into missing_count from goals where household_id is null or budget_id is null;
  if missing_count > 0 then raise exception 'goals backfill incomplete: % rows', missing_count; end if;
  select count(*) into missing_count from extra_payments where household_id is null or budget_id is null;
  if missing_count > 0 then raise exception 'extra payments backfill incomplete: % rows', missing_count; end if;
  select count(*) into missing_count from categories where household_id is null or budget_id is null;
  if missing_count > 0 then raise exception 'categories backfill incomplete: % rows', missing_count; end if;
end $$;

select 'phase0 foundation checks passed' as result;
