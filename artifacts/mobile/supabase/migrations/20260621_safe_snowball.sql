alter table bills add column if not exists include_in_snowball boolean not null default true;

alter table monthly_overrides add column if not exists actual_amount numeric;
alter table monthly_overrides add column if not exists paid_date date;

alter table extra_payments add column if not exists payment_date date;
alter table extra_payments add column if not exists sources jsonb not null default '[]'::jsonb;

update extra_payments
set payment_date = make_date(year, month + 1, 1)
where payment_date is null;

update extra_payments
set sources = jsonb_build_array(jsonb_build_object('type', 'manual', 'amount', amount))
where sources = '[]'::jsonb;

create unique index if not exists extra_payments_user_month_year_idx
  on extra_payments(user_id, year, month);
