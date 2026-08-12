alter table public.monthly_overrides
  add column planned_debt_amount numeric;

alter table public.monthly_overrides
  add constraint monthly_overrides_planned_debt_amount_nonnegative
  check (planned_debt_amount is null or planned_debt_amount >= 0);

comment on column public.monthly_overrides.planned_debt_amount is
  'Nullable exact per-occurrence debt amount for Forecast. Null uses automatic planning; zero skips Forecast.';
