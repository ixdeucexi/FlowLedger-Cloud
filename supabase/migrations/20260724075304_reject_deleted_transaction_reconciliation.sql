-- Recycled transactions are intentionally hidden from Review Center, but the
-- reconciliation RPCs must also reject a stale client that still has one open.
-- Keep undo available for transactions that were reviewed before deletion by
-- guarding only the transition from needs_review into a reviewed state.

create or replace function public.reject_deleted_transaction_reconciliation()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if old.deleted_at is not null
    and old.review_status = 'needs_review'
    and new.review_status in ('matched', 'categorized', 'transfer') then
    raise exception 'Deleted transactions cannot be reviewed';
  end if;

  return new;
end;
$$;

drop trigger if exists reject_deleted_transaction_reconciliation on public.transactions;
create trigger reject_deleted_transaction_reconciliation
before update of review_status, review_resolution on public.transactions
for each row
execute function public.reject_deleted_transaction_reconciliation();

revoke execute on function public.reject_deleted_transaction_reconciliation()
from public, anon, authenticated, service_role;
