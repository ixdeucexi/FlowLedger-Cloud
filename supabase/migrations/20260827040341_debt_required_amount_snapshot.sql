-- Manual finalization needs an immutable month-level lender requirement. The
-- recurring bill amount may change later for future months, while this saved
-- value keeps the completed historical occurrence from becoming overdue.
alter table public.monthly_overrides
  add column if not exists required_debt_amount numeric;

alter table public.monthly_overrides
  drop constraint if exists monthly_overrides_required_debt_amount_nonnegative;
alter table public.monthly_overrides
  add constraint monthly_overrides_required_debt_amount_nonnegative
  check (required_debt_amount is null or required_debt_amount >= 0);

comment on column public.monthly_overrides.required_debt_amount is
  'Lender-required total captured when a debt payment is explicitly finalized; excludes Snowball rollover and forecast-only extras.';

notify pgrst, 'reload schema';
