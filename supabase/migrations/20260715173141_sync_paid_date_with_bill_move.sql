-- Keep a finalized bill's settlement date aligned with its moved calendar occurrence.
-- Forecasts use monthly_overrides.paid_date, while the calendar uses bill_date_moves.
create or replace function public.sync_settled_bill_date_with_move()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_bill_id text;
  v_occurrence_date date;
  v_previous_date date;
  v_next_date date;
  v_user_id uuid;
  v_household_id uuid;
begin
  if tg_op = 'DELETE' then
    v_bill_id := old.bill_id;
    v_occurrence_date := old.from_date;
    v_previous_date := old.to_date;
    v_next_date := old.from_date;
    v_user_id := old.user_id;
    v_household_id := old.household_id;
  elsif tg_op = 'UPDATE' then
    v_bill_id := new.bill_id;
    v_occurrence_date := new.from_date;
    v_previous_date := old.to_date;
    v_next_date := new.to_date;
    v_user_id := new.user_id;
    v_household_id := new.household_id;
  else
    v_bill_id := new.bill_id;
    v_occurrence_date := new.from_date;
    v_previous_date := new.from_date;
    v_next_date := new.to_date;
    v_user_id := new.user_id;
    v_household_id := new.household_id;
  end if;

  update public.monthly_overrides as override
  set paid_date = v_next_date
  where override.bill_id = v_bill_id
    and override.year = extract(year from v_occurrence_date)::integer
    and override.month = extract(month from v_occurrence_date)::integer - 1
    and (override.actual_amount is not null or override.paid_amount > 0.005)
    and override.paid_date = v_previous_date
    and (
      (v_household_id is not null and override.household_id = v_household_id)
      or
      (v_household_id is null and override.household_id is null and override.user_id = v_user_id)
    );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.sync_settled_bill_date_with_move() from public, anon, authenticated;

drop trigger if exists sync_settled_bill_date_with_move on public.bill_date_moves;
create trigger sync_settled_bill_date_with_move
after insert or update of to_date or delete on public.bill_date_moves
for each row execute function public.sync_settled_bill_date_with_move();

-- Repair existing settled bills whose visible occurrence already moved but whose
-- forecast settlement date was left on the original day.
update public.monthly_overrides as override
set paid_date = move.to_date
from public.bill_date_moves as move
where override.bill_id = move.bill_id
  and override.year = extract(year from move.from_date)::integer
  and override.month = extract(month from move.from_date)::integer - 1
  and (override.actual_amount is not null or override.paid_amount > 0.005)
  and override.paid_date = move.from_date
  and (
    (move.household_id is not null and override.household_id = move.household_id)
    or
    (move.household_id is null and override.household_id is null and override.user_id = move.user_id)
  );
