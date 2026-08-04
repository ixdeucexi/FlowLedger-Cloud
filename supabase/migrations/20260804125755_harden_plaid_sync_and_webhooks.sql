-- Serialize Plaid syncs per Plaid Item. The token prevents an old invocation from
-- releasing a newer invocation's lock, while the timestamp recovers locks
-- abandoned by a terminated function.
alter table public.plaid_items
  add column if not exists sync_lock_token uuid,
  add column if not exists sync_locked_at timestamptz;

create or replace function public.acquire_plaid_sync_lock(
  p_item_id uuid,
  p_user_id uuid,
  p_lock_token uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_rows integer;
begin
  update public.plaid_items
  set sync_lock_token = p_lock_token,
      sync_locked_at = now()
  where id = p_item_id
    and user_id = p_user_id
    and (
      sync_lock_token is null
      or sync_locked_at is null
      or sync_locked_at < now() - interval '10 minutes'
    );
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

create or replace function public.release_plaid_sync_lock(
  p_item_id uuid,
  p_user_id uuid,
  p_lock_token uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_rows integer;
begin
  update public.plaid_items
  set sync_lock_token = null,
      sync_locked_at = null
  where id = p_item_id
    and user_id = p_user_id
    and sync_lock_token = p_lock_token;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

revoke execute on function public.acquire_plaid_sync_lock(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.release_plaid_sync_lock(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.acquire_plaid_sync_lock(uuid, uuid, uuid) to service_role;
grant execute on function public.release_plaid_sync_lock(uuid, uuid, uuid) to service_role;

-- Move a confirmed bill match from a replaced pending transaction to its
-- posted replacement in one database transaction. The function intentionally
-- runs as its service-role caller instead of bypassing RLS as its owner.
create or replace function public.transfer_pending_plaid_bill_match(
  p_user_id uuid,
  p_pending_plaid_transaction_id text,
  p_posted_transaction_id text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_pending public.transactions%rowtype;
  v_posted public.transactions%rowtype;
begin
  select * into v_pending
  from public.transactions
  where user_id = p_user_id
    and plaid_transaction_id = p_pending_plaid_transaction_id
  for update;

  if not found
    or v_pending.linked_bill_id is null
    or v_pending.match_reason <> 'confirmed_bill_match'
  then
    return false;
  end if;

  select * into v_posted
  from public.transactions
  where id = p_posted_transaction_id
    and user_id = p_user_id
  for update;

  if not found or v_posted.id = v_pending.id then
    return false;
  end if;

  perform public.unmatch_transaction_from_bill(v_pending.id);
  perform public.match_transaction_to_bill(v_posted.id, v_pending.linked_bill_id);
  return true;
end;
$$;

revoke execute on function public.transfer_pending_plaid_bill_match(uuid, text, text) from public, anon, authenticated;
grant execute on function public.transfer_pending_plaid_bill_match(uuid, text, text) to service_role;

notify pgrst, 'reload schema';
