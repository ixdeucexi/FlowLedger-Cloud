create or replace function public.preserve_reconciled_bill_link()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_bill_id text;
begin
  if new.review_status = 'matched'
    and new.review_resolution = 'bill'
    and new.match_reason = 'confirmed_bill_match'
  then
    select allocation ->> 'targetId'
      into v_bill_id
    from jsonb_array_elements(coalesce(new.review_allocations, '[]'::jsonb)) as allocation
    where allocation ->> 'type' = 'bill'
      and nullif(allocation ->> 'targetId', '') is not null
    limit 1;

    new.linked_bill_id := coalesce(new.linked_bill_id, v_bill_id);
    if new.linked_bill_id is not null then
      new.match_confidence := 1;
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.preserve_reconciled_bill_link() from public, anon, authenticated;

drop trigger if exists transactions_preserve_reconciled_bill_link on public.transactions;
create trigger transactions_preserve_reconciled_bill_link
before insert or update of review_status, review_resolution, review_allocations, linked_bill_id, match_reason
on public.transactions
for each row
execute function public.preserve_reconciled_bill_link();

update public.transactions as transaction
set linked_bill_id = (
      select allocation ->> 'targetId'
      from jsonb_array_elements(coalesce(transaction.review_allocations, '[]'::jsonb)) as allocation
      where allocation ->> 'type' = 'bill'
        and nullif(allocation ->> 'targetId', '') is not null
      limit 1
    ),
    match_confidence = 1
where transaction.linked_bill_id is null
  and transaction.review_status = 'matched'
  and transaction.review_resolution = 'bill'
  and transaction.match_reason = 'confirmed_bill_match'
  and exists (
    select 1
    from jsonb_array_elements(coalesce(transaction.review_allocations, '[]'::jsonb)) as allocation
    where allocation ->> 'type' = 'bill'
      and nullif(allocation ->> 'targetId', '') is not null
  );

comment on function public.preserve_reconciled_bill_link() is
  'Keeps the canonical bill link aligned with a completed bill reconciliation so clients render one merged activity item.';
