-- Hard-delete a bill/debt as an intentional correction.
--
-- This is separate from the existing "stop future" behavior.  Stop future
-- keeps history by ending a recurring bill after the current month.  This RPC
-- removes the bill from Bills and Calendar completely while preserving manual
-- transactions by unlinking them from the deleted bill.

set search_path = public, extensions;

create or replace function public.delete_bill_completely(
  p_bill_id text,
  p_household_id uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  target_bill public.bills%rowtype;
  target_household uuid;
  caller uuid := auth.uid();
begin
  if caller is null then
    raise exception 'You must be signed in to delete a bill';
  end if;

  select *
    into target_bill
  from public.bills
  where id = p_bill_id
  limit 1;

  if not found then
    return false;
  end if;

  target_household := target_bill.household_id;

  if p_household_id is not null and target_household is distinct from p_household_id then
    raise exception 'This bill does not belong to the active household';
  end if;

  if target_household is not null then
    if not public.is_household_editor(target_household) then
      raise exception 'Only household owners or editors can delete bills';
    end if;
  elsif target_bill.user_id is distinct from caller then
    raise exception 'Only the bill owner can delete this bill';
  end if;

  delete from public.monthly_overrides
  where bill_id = p_bill_id;

  delete from public.bill_date_moves
  where bill_id = p_bill_id;

  update public.transactions
  set linked_bill_id = null
  where linked_bill_id = p_bill_id;

  update public.transactions
  set debt_applied_bill_id = null,
      debt_applied_amount = 0
  where debt_applied_bill_id = p_bill_id;

  delete from public.bills
  where id = p_bill_id;

  perform public.log_household_activity(
    target_household,
    'deleted',
    case when target_bill.is_debt then 'debt' else 'bill' end,
    p_bill_id,
    target_bill.name,
    caller
  );

  if target_bill.is_debt then
    perform public.recalculate_debt_minimum_boosts(target_household);
  end if;

  return true;
end;
$$;

revoke execute on function public.delete_bill_completely(text, uuid) from public;
revoke execute on function public.delete_bill_completely(text, uuid) from anon;
grant execute on function public.delete_bill_completely(text, uuid) to authenticated;
