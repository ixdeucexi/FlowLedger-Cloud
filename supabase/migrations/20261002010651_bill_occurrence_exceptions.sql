-- A recurring bill remains one series. This row records only what differs for
-- one original occurrence, so changing or removing it cannot rewrite siblings.
alter table public.bill_date_moves
  add column if not exists custom_amount numeric;

alter table public.bill_date_moves
  add column if not exists is_skipped boolean not null default false;

alter table public.bill_date_moves
  drop constraint if exists bill_date_moves_custom_amount_nonnegative;

alter table public.bill_date_moves
  add constraint bill_date_moves_custom_amount_nonnegative
  check (custom_amount is null or custom_amount >= 0);

comment on column public.bill_date_moves.custom_amount is
  'Optional amount for this original bill occurrence only.';

comment on column public.bill_date_moves.is_skipped is
  'When true, hides this occurrence without deleting the recurring bill or its history.';
