alter table public.incomes
  add column if not exists excluded_dates jsonb not null default '[]'::jsonb;
