alter table if exists public.bills
  add column if not exists next_payment_date text;
