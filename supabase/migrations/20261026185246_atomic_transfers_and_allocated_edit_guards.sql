-- One transaction owns both transfer legs; no compensation or partial saves.
create or replace function private.mutate_transfer(p_household_id uuid,p_budget_id uuid,p_group_id text,p_from_id text,p_to_id text,p_expected jsonb,p_payload jsonb,p_action text default 'save')
returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare
 rows public.transactions[]; t public.transactions%rowtype; outgoing public.transactions%rowtype; incoming public.transactions%rowtype;
 old_pair jsonb; desired_pair jsonb; result jsonb; amount numeric; transfer_date date; from_account text; to_account text; from_note text; to_note text; n integer;
begin
 if p_action is null or p_action not in('save','delete','restore') then raise exception 'Choose a transfer action'; end if;
 if auth.uid() is null or p_household_id is null or not private.is_household_editor(p_household_id) then raise exception 'Household edit access is required'; end if;
 if p_budget_id is null or not exists(select 1 from public.budgets where id=p_budget_id and household_id=p_household_id) then raise exception 'Choose a budget in this household'; end if;
 if nullif(btrim(p_group_id),'') is null or length(p_group_id)>200 or nullif(btrim(p_from_id),'') is null or nullif(btrim(p_to_id),'') is null or p_from_id=p_to_id then raise exception 'A stable transfer pair is required'; end if;
 perform pg_advisory_xact_lock(hashtextextended('transfer:'||p_group_id,0));
 select array_agg(q order by q.id) into rows from (select * from public.transactions where transfer_group_id=p_group_id or id in(p_from_id,p_to_id) order by id for update) q;
 n:=coalesce(array_length(rows,1),0);
 if n<>0 and n<>2 then raise exception 'This transfer no longer has exactly two legs. Refresh before editing'; end if;
 if n=2 then
  foreach t in array rows loop
   if t.household_id is distinct from p_household_id or t.budget_id is distinct from p_budget_id or t.transfer_group_id is distinct from p_group_id or t.id not in(p_from_id,p_to_id)
    or t.removed_at is not null or t.pending is true or t.source is not null and t.source<>'manual' or t.import_hash is not null
    or t.category<>'Transfer' or t.linked_bill_id is not null or t.linked_income_id is not null or t.linked_plan_id is not null or t.debt_applied_bill_id is not null or coalesce(t.debt_applied_amount,0)<>0
    or exists(select 1 from public.transaction_reconciliations where transaction_id=t.id) then raise exception 'This pair cannot be changed as a manual transfer'; end if;
   if t.id=p_from_id then outgoing:=t; else incoming:=t; end if;
  end loop;
  if outgoing.amount>=0 or incoming.amount<=0 or outgoing.amount<>-incoming.amount or outgoing.date<>incoming.date or outgoing.account_id is null or incoming.account_id is null or outgoing.account_id=incoming.account_id then raise exception 'Transfer legs are inconsistent. Refresh before editing'; end if;
  old_pair:=jsonb_build_array(jsonb_build_object('id',outgoing.id,'amount',outgoing.amount,'date',outgoing.date,'account_id',outgoing.account_id,'note',outgoing.note,'category',outgoing.category),jsonb_build_object('id',incoming.id,'amount',incoming.amount,'date',incoming.date,'account_id',incoming.account_id,'note',incoming.note,'category',incoming.category));
  if p_action='delete' and outgoing.deleted_at is not null and incoming.deleted_at is not null then return jsonb_build_object('transactions',to_jsonb(rows),'retry',true); end if;
  if p_action='restore' then
   if p_expected is distinct from old_pair then raise exception 'This transfer changed before restore'; end if;
   if (outgoing.deleted_at is null)<>(incoming.deleted_at is null) then raise exception 'Transfer deletion state is inconsistent'; end if;
   perform 1 from public.accounts where id in(outgoing.account_id,incoming.account_id) and household_id=p_household_id and budget_id is not distinct from p_budget_id and is_active order by id for share;
   get diagnostics n=row_count;
   if n<>2 then raise exception 'Restore requires two active household accounts'; end if;
   update public.transactions set deleted_at=null,deleted_by=null where id in(p_from_id,p_to_id);
   select jsonb_agg(x order by x.id) into result from public.transactions x where id in(p_from_id,p_to_id);
   return jsonb_build_object('transactions',result,'retry',outgoing.deleted_at is null);
  end if;
  if outgoing.deleted_at is not null or incoming.deleted_at is not null then raise exception 'This transfer was deleted. Refresh before editing'; end if;
 elsif p_action in('delete','restore') or p_expected is not null then raise exception 'Transfer not found';
 end if;
 if p_action='delete' then
  if p_expected is distinct from old_pair then raise exception 'This transfer changed on another device. Refresh before deleting'; end if;
  update public.transactions set deleted_at=now(),deleted_by=auth.uid() where id in(p_from_id,p_to_id);
 else
  amount:=(p_payload->>'amount')::numeric; transfer_date:=(p_payload->>'date')::date;
  from_account:=p_payload->>'fromAccountId'; to_account:=p_payload->>'toAccountId'; from_note:=coalesce(p_payload->>'fromNote',''); to_note:=coalesce(p_payload->>'toNote','');
  if amount is null or lower(amount::text) in('nan','infinity','-infinity') or amount<=0 or amount>1000000000 or round(amount,2)<>amount or transfer_date is null or length(from_note)>2000 or length(to_note)>2000 then raise exception 'Choose a valid transfer amount, date and description'; end if;
  if from_account is null or to_account is null or from_account=to_account then raise exception 'Choose two different active accounts'; end if;
  -- Hold account locks through commit so deactivation cannot race validation.
  perform 1 from public.accounts where id in(from_account,to_account) and household_id=p_household_id and budget_id is not distinct from p_budget_id and is_active order by id for share;
  get diagnostics n=row_count;
  if n<>2 then raise exception 'Choose two active accounts in this household'; end if;
  desired_pair:=jsonb_build_array(jsonb_build_object('id',p_from_id,'amount',-amount,'date',transfer_date::text,'account_id',from_account,'note',from_note,'category','Transfer'),jsonb_build_object('id',p_to_id,'amount',amount,'date',transfer_date::text,'account_id',to_account,'note',to_note,'category','Transfer'));
  if old_pair=desired_pair then return jsonb_build_object('transactions',to_jsonb(rows),'retry',true); end if;
  if old_pair is not null then
   if p_expected is distinct from old_pair then raise exception 'This transfer changed on another device. Refresh before editing'; end if;
   update public.transactions set amount=case when id=p_from_id then -amount else amount end,date=transfer_date::text,account_id=case when id=p_from_id then from_account else to_account end,note=case when id=p_from_id then from_note else to_note end,user_edited_at=now() where id in(p_from_id,p_to_id);
  else
   if p_expected is not null then raise exception 'Transfer not found'; end if;
   insert into public.transactions(id,user_id,household_id,budget_id,amount,date,account_id,category,note,source,transfer_group_id,review_status)
    values(p_from_id,auth.uid(),p_household_id,p_budget_id,-amount,transfer_date::text,from_account,'Transfer',from_note,'manual',p_group_id,'legacy_reviewed'),
          (p_to_id,auth.uid(),p_household_id,p_budget_id,amount,transfer_date::text,to_account,'Transfer',to_note,'manual',p_group_id,'legacy_reviewed');
  end if;
 end if;
 select jsonb_agg(x order by x.id) into result from public.transactions x where id in(p_from_id,p_to_id);
 return jsonb_build_object('transactions',result,'retry',false);
end;
$$;
create or replace function public.mutate_transfer(p_household_id uuid,p_budget_id uuid,p_group_id text,p_from_id text,p_to_id text,p_expected jsonb,p_payload jsonb,p_action text default 'save')
returns jsonb language sql security invoker set search_path='' as $$select private.mutate_transfer(p_household_id,p_budget_id,p_group_id,p_from_id,p_to_id,p_expected,p_payload,p_action)$$;
revoke all on function private.mutate_transfer(uuid,uuid,text,text,text,jsonb,jsonb,text) from public,anon,service_role;
revoke all on function public.mutate_transfer(uuid,uuid,text,text,text,jsonb,jsonb,text) from public,anon,service_role;
grant execute on function private.mutate_transfer(uuid,uuid,text,text,text,jsonb,jsonb,text) to authenticated;
grant execute on function public.mutate_transfer(uuid,uuid,text,text,text,jsonb,jsonb,text) to authenticated;

-- The invoker guard must not grant clients access to the reconciliation ledger.
-- This constrained predicate exposes only the caller's editable household rows.
create or replace function private.has_financial_transaction_reconciliation(p_transaction_id text,p_household_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and p_household_id is not null
  and private.is_household_editor(p_household_id)
  and exists(select 1 from public.transaction_reconciliations r where r.transaction_id=p_transaction_id
   and r.household_id=p_household_id and r.resolution not in('category','transfer'))
$$;
revoke all on function private.has_financial_transaction_reconciliation(text,uuid) from public,anon,service_role;
grant execute on function private.has_financial_transaction_reconciliation(text,uuid) to authenticated;

create or replace function private.guard_allocated_transaction_edit() returns trigger language plpgsql set search_path='' as $$
begin
 if current_user in('postgres','service_role','supabase_admin') then return case when tg_op='DELETE' then old else new end; end if;
 if tg_op='INSERT' then
  if new.transfer_group_id is not null then raise exception 'Use the transfer editor to save both sides together'; end if;
  return new;
 end if;
 if old.transfer_group_id is not null or (tg_op='UPDATE' and new.transfer_group_id is not null) then raise exception 'Use the transfer editor to change both sides together'; end if;
 if tg_op='UPDATE' and row(new.amount,new.date) is distinct from row(old.amount,old.date)
  and (old.linked_income_id is not null or old.linked_plan_id is not null
   or ((old.source='plaid' or old.import_hash is not null or old.review_status='matched')
    and (old.linked_bill_id is not null or old.debt_applied_bill_id is not null or coalesce(old.debt_applied_amount,0)<>0))
   or coalesce(old.review_resolution,'category') not in('category','transfer')
   or private.has_financial_transaction_reconciliation(old.id,old.household_id)
   or exists(select 1 from jsonb_array_elements(old.review_allocations) a where coalesce(a->>'type','') not in('category','transfer'))) then
  raise exception 'Undo this transaction match before changing its amount or date';
 end if;
 return case when tg_op='DELETE' then old else new end;
end;
$$;
revoke all on function private.guard_allocated_transaction_edit() from public,anon,authenticated,service_role;
create trigger transactions_guard_allocated_edit before insert or update or delete on public.transactions for each row execute function private.guard_allocated_transaction_edit();
notify pgrst,'reload schema';
