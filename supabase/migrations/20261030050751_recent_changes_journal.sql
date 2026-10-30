-- Future-change journal. Snapshots stay private; clients receive a bounded,
-- semantic field diff and may request only a server-checked inverse.
create table private.recent_change_versions (
  entity_table text not null check (entity_table in ('bills','incomes','goals','transactions')),
  entity_id text not null,
  version bigint not null,
  primary key (entity_table, entity_id)
);
create table private.recent_changes (
  id uuid primary key default gen_random_uuid(),
  sequence bigint generated always as identity unique,
  household_id uuid not null references public.households(id) on delete cascade,
  budget_id uuid not null,
  actor_id uuid references auth.users(id) on delete set null,
  actor_was_authenticated boolean not null default false,
  entity_table text not null check (entity_table in ('bills','incomes','goals','transactions')),
  entity_id text not null,
  entity_version bigint not null,
  operation text not null check (operation in ('INSERT','UPDATE','DELETE')),
  before_row jsonb,
  after_row jsonb,
  group_id bigint not null default txid_current(),
  created_at timestamptz not null default now(),
  undone_at timestamptz,
  undone_by uuid references auth.users(id) on delete set null,
  inverse_change_id uuid,
  undo_of uuid
);
create index recent_changes_scope_page_idx on private.recent_changes(household_id,budget_id,sequence desc);
create index recent_changes_group_idx on private.recent_changes(group_id);
create index recent_changes_entity_idx on private.recent_changes(entity_table,entity_id,entity_version desc);
create index recent_changes_actor_idx on private.recent_changes(actor_id) where actor_id is not null;
create index recent_changes_undo_actor_idx on private.recent_changes(undone_by) where undone_by is not null;
create index flo_creation_receipts_recent_actor_idx on private.flo_creation_receipts(actor_id,household_id,budget_id,created_at);
alter table private.recent_changes enable row level security;
alter table private.recent_change_versions enable row level security;
revoke all on private.recent_changes,private.recent_change_versions from public,anon,authenticated,service_role;
revoke all on sequence private.recent_changes_sequence_seq from public,anon,authenticated,service_role;

create function private.capture_recent_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare b jsonb; a jsonb; r jsonb; v bigint; h uuid; budget uuid; actor uuid:=auth.uid();
begin
  if tg_op <> 'INSERT' then b := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then a := to_jsonb(new); end if;
  -- Maintenance timestamps and technical owner transfers are not user edits.
  if tg_op='UPDATE' and (b - array['user_id','last_reviewed_at','plaid_last_synced_at','user_edited_at'])
      = (a - array['user_id','last_reviewed_at','plaid_last_synced_at','user_edited_at']) then return new; end if;
  r := coalesce(a,b);
  h := nullif(r->>'household_id','')::uuid;
  budget := nullif(r->>'budget_id','')::uuid;
  -- Unscoped legacy rows cannot safely become household history.
  if h is null or budget is null then return coalesce(new,old); end if;
  -- Parent deletion cascades must not try to re-create a journal FK to the
  -- household being removed. Stale access tokens cannot become actor FKs.
  if not exists(select 1 from public.households where id=h) then return coalesce(new,old); end if;
  if actor is not null and not exists(select 1 from auth.users where id=actor) then actor:=null; end if;
  if tg_op='UPDATE' and (b->>'household_id' is distinct from a->>'household_id' or b->>'budget_id' is distinct from a->>'budget_id') then
    -- A destination household may see the moved row, not the prior workspace's
    -- snapshot. The version still advances and the move is history-only.
    b:=null;actor:=null;
  end if;
  insert into private.recent_change_versions(entity_table,entity_id,version)
    values(tg_table_name,r->>'id',1)
    on conflict(entity_table,entity_id) do update set version=private.recent_change_versions.version+1
    returning version into v;
  insert into private.recent_changes(household_id,budget_id,actor_id,actor_was_authenticated,entity_table,entity_id,entity_version,operation,before_row,after_row)
    values(h,budget,actor,actor is not null,tg_table_name,r->>'id',v,tg_op,b,a);
  return coalesce(new,old);
end;
$$;
revoke all on function private.capture_recent_change() from public,anon,authenticated,service_role;
create trigger recent_changes_capture after insert or update or delete on public.bills for each row execute function private.capture_recent_change();
create trigger recent_changes_capture after insert or update or delete on public.incomes for each row execute function private.capture_recent_change();
create trigger recent_changes_capture after insert or update or delete on public.goals for each row execute function private.capture_recent_change();
create trigger recent_changes_capture after insert or update or delete on public.transactions for each row execute function private.capture_recent_change();

create function private.recent_change_scope(p_household uuid,p_budget uuid,p_edit boolean) returns text
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); h uuid; b uuid; role_name text;
begin
  if actor is null or not exists(select 1 from auth.users where id=actor) then raise exception 'Sign in to view recent changes'; end if;
  if p_household is null or p_budget is null then raise exception 'Choose a household and budget first'; end if;
  select active_household_id into h from public.user_preferences where user_id=actor for share;
  if h is distinct from p_household then raise exception 'Your active household changed. Open Recent Changes again'; end if;
  select role into role_name from public.household_members where household_id=h and user_id=actor for share;
  if role_name is null or role_name not in ('owner','manager','editor','viewer') then raise exception 'Household access is required'; end if;
  if p_edit and role_name not in ('owner','manager','editor') then raise exception 'Household edit access is required to undo changes'; end if;
  begin
    select id into strict b from public.budgets where household_id=h and is_default for share;
  exception when no_data_found or too_many_rows then raise exception 'Choose a household with one default budget'; end;
  if b is distinct from p_budget then raise exception 'Your default budget changed. Open Recent Changes again'; end if;
  return role_name;
end;
$$;
revoke all on function private.recent_change_scope(uuid,uuid,boolean) from public,anon,authenticated,service_role;

create function private.recent_change_fields(p_table text,p_before jsonb,p_after jsonb) returns text[]
language sql immutable set search_path='' as $$
  select coalesce(array_agg(k order by k),'{}'::text[]) from unnest(case p_table
    when 'bills' then array['name','amount','category','is_debt','balance','interest_rate','due_day','day_of_week','start_date','end_date','is_recurring','frequency','include_in_snowball','smart_priority','next_payment_date','snowball_minimum_boost']
    when 'incomes' then array['name','amount','frequency','start_date','next_payment_date','amount_history','excluded_dates']
    when 'goals' then array['name','target_amount','target_date','current_amount','goal_type','closed_at','archived_at']
    when 'transactions' then array['date','amount','category','note','account_id','source','pending','deleted_at','linked_bill_id','linked_income_id','linked_plan_id','review_resolution','review_allocations','debt_applied_amount','transfer_group_id']
    else '{}'::text[] end) k where coalesce(p_before->k,'null'::jsonb) is distinct from coalesce(p_after->k,'null'::jsonb);
$$;
revoke all on function private.recent_change_fields(text,jsonb,jsonb) from public,anon,authenticated,service_role;

-- Foreign-key checks cover cascades and SET NULL side effects. The extra
-- explicit checks cover older text/JSON links that predate foreign keys.
create function private.recent_change_has_links(p_table text,p_id text,p_household uuid,p_budget uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare fk record; found_link boolean; relation regclass;
begin
  if p_table not in ('bills','incomes','goals','transactions') or p_household is null or p_budget is null then return true; end if;
  relation := to_regclass('public.'||p_table);
  for fk in
    select ns.nspname,cl.relname,att.attname
    from pg_catalog.pg_constraint c
    join pg_catalog.pg_class cl on cl.oid=c.conrelid
    join pg_catalog.pg_namespace ns on ns.oid=cl.relnamespace
    join pg_catalog.pg_attribute att on att.attrelid=c.conrelid and att.attnum=c.conkey[1]
    where c.contype='f' and c.confrelid=relation and cardinality(c.conkey)=1
  loop
    execute format('select exists(select 1 from %I.%I where %I::text=$1)',fk.nspname,fk.relname,fk.attname) into found_link using p_id;
    if found_link then return true; end if;
  end loop;
  if p_table in ('bills','goals','incomes') then
    if exists(select 1 from public.transactions t where t.household_id=p_household and t.budget_id=p_budget and (
      (p_table='bills' and (t.linked_bill_id=p_id or t.debt_applied_bill_id=p_id))
      or (p_table='incomes' and t.linked_income_id=p_id)
      or (p_table='goals' and t.linked_plan_id=p_id and t.linked_plan_type='goal')
      or coalesce(t.review_allocations,'[]'::jsonb) @> jsonb_build_array(jsonb_build_object('targetId',p_id)))) then return true; end if;
  end if;
  if p_table='bills' then
    if exists(select 1 from public.monthly_overrides where bill_id=p_id)
      or exists(select 1 from public.bill_date_moves where bill_id=p_id) then return true; end if;
  end if;
  if exists(select 1 from public.transaction_reconciliations t where t.household_id=p_household and t.budget_id=p_budget and t.target_id=p_id) then return true; end if;
  if p_table='goals' and exists(select 1 from private.planned_reconciliation_bases where target_type='goal' and target_id=p_id) then return true; end if;
  if to_regclass('public.pending_plan_matches') is not null then
    execute 'select exists(select 1 from public.pending_plan_matches t where t.household_id=$2 and t.budget_id=$3 and jsonb_path_exists(to_jsonb(t),''strict $.** ? (@ == $id)'',jsonb_build_object(''id'',$1)))' into found_link using p_id,p_household,p_budget;
    if found_link then return true; end if;
  end if;
  if to_regclass('public.extra_payments') is not null then
    execute 'select exists(select 1 from public.extra_payments t where t.household_id=$2 and t.budget_id=$3 and jsonb_path_exists(to_jsonb(t),''strict $.** ? (@ == $id)'',jsonb_build_object(''id'',$1)))' into found_link using p_id,p_household,p_budget;
    if found_link then return true; end if;
  end if;
  return false;
end;
$$;
revoke all on function private.recent_change_has_links(text,text,uuid,uuid) from public,anon,authenticated,service_role;

create function private.recent_change_reason(p_change private.recent_changes) returns text
language plpgsql security definer set search_path='' as $$
declare r jsonb:=coalesce(p_change.after_row,p_change.before_row); b jsonb:=p_change.before_row;
  a jsonb:=p_change.after_row; fields text[]; raw_fields text[]; current_row jsonb; latest bigint;
begin
  if p_change.undone_at is not null then return 'Already undone'; end if;
  if p_change.undo_of is not null then return 'This records an Undo. Open the item to make another change'; end if;
  if not p_change.actor_was_authenticated then return 'Automatic updates are recorded for reference'; end if;
  if p_change.operation='DELETE' then return 'Deletion can have linked effects. Use the item’s existing restore tools when available'; end if;
  if (select count(*) from private.recent_changes where group_id=p_change.group_id)>1 then return 'This changed related records together. Use the item’s dedicated controls'; end if;
  if (b is not null and (b->>'household_id' is distinct from a->>'household_id' or b->>'budget_id' is distinct from a->>'budget_id' or b->>'user_id' is distinct from a->>'user_id')) then return 'Workspace or ownership changes cannot be undone here'; end if;
  select version into latest from private.recent_change_versions where entity_table=p_change.entity_table and entity_id=p_change.entity_id;
  if latest is distinct from p_change.entity_version then return 'This item changed again. Only its latest supported change can be undone'; end if;
  execute format('select to_jsonb(t) from public.%I t where id=$1',p_change.entity_table) into current_row using p_change.entity_id;
  if current_row is distinct from a then return 'This item changed again. Refresh Recent Changes'; end if;
  fields := private.recent_change_fields(p_change.entity_table,b,a);
  if b is not null then
    select coalesce(array_agg(key),'{}'::text[]) into raw_fields from jsonb_object_keys(a||b) key
      where (a->key is distinct from b->key) and key not in ('last_reviewed_at','user_edited_at','plaid_last_synced_at');
  end if;
  if cardinality(fields)=0 then return 'This update has no reversible display fields'; end if;
  case p_change.entity_table
    when 'bills' then
      if p_change.operation='INSERT' then
        if coalesce((a->>'is_debt')::boolean,false) or nullif(a->>'plaid_account_id','') is not null or nullif(a->>'plaid_account_record_id','') is not null then return 'Debt and bank-linked creation needs its dedicated controls'; end if;
        if private.recent_change_has_links('bills',p_change.entity_id,p_change.household_id,p_change.budget_id) then return 'This bill has payments or linked records. Open the bill to make changes'; end if;
      elsif not raw_fields <@ array['name','category'] then return 'Payment, schedule and debt changes need the bill’s dedicated controls'; end if;
    when 'incomes' then
      if private.recent_change_has_links('incomes',p_change.entity_id,p_change.household_id,p_change.budget_id) then return 'This income has linked activity. Open income settings to make changes'; end if;
      -- Complex schedule arrays have a privacy-preserving summary in history,
      -- not a reviewable date/money preview. Do not offer a blind inverse.
      if p_change.operation='UPDATE' and raw_fields && array['amount_history','excluded_dates'] then return 'Income amount history and skipped dates need income settings’ dedicated controls'; end if;
      if p_change.operation='UPDATE' and not raw_fields <@ array['name','amount','frequency','start_date','next_payment_date'] then return 'This income change needs income settings’ dedicated controls'; end if;
    when 'goals' then
      if a->>'goal_type' is distinct from 'savings' or (b is not null and b->>'goal_type' is distinct from 'savings') then return 'Spending bucket budgets and purchases use their dedicated controls'; end if;
      if coalesce((a->>'current_amount')::numeric,0)<>0 or (b is not null and coalesce((b->>'current_amount')::numeric,0)<>0) or private.recent_change_has_links('goals',p_change.entity_id,p_change.household_id,p_change.budget_id) then return 'Funded or linked goals need their dedicated controls'; end if;
      if p_change.operation='UPDATE' and not raw_fields <@ array['name','target_amount','target_date'] then return 'Goal lifecycle changes use their dedicated controls'; end if;
    when 'transactions' then
      if exists(select 1 from unnest(case when b is null then array[a] else array[b,a] end) row_value where
        coalesce(row_value->>'source','manual') is distinct from 'manual' or coalesce((row_value->>'pending')::boolean,false)
        or row_value->>'review_status' is distinct from 'legacy_reviewed'
        or row_value->>'category'='Transfer'
        or nullif(row_value->>'plaid_transaction_id','') is not null or nullif(row_value->>'plaid_account_id','') is not null or nullif(row_value->>'import_hash','') is not null
        or nullif(row_value->>'linked_bill_id','') is not null or nullif(row_value->>'debt_applied_bill_id','') is not null
        or nullif(row_value->>'linked_income_id','') is not null or nullif(row_value->>'linked_plan_id','') is not null
        or nullif(row_value->>'transfer_group_id','') is not null or coalesce((row_value->>'debt_applied_amount')::numeric,0)<>0
        or nullif(row_value->>'review_resolution','') is not null or coalesce(row_value->'review_allocations','[]'::jsonb) not in ('[]'::jsonb,'null'::jsonb)
        or nullif(row_value->>'removed_at','') is not null) then return 'Matched, imported, bank, transfer and bucket activity use their dedicated controls'; end if;
      if private.recent_change_has_links('transactions',p_change.entity_id,p_change.household_id,p_change.budget_id) then return 'This transaction has linked records. Use Activity to make changes'; end if;
      if b is not null and b->>'account_id' is distinct from a->>'account_id' and nullif(b->>'account_id','') is not null
        and not exists(select 1 from public.accounts account where account.id=b->>'account_id' and account.household_id=p_change.household_id and account.budget_id=p_change.budget_id and account.is_active)
      then return 'The previous account is unavailable. Open Activity to choose an account'; end if;
      if p_change.operation='UPDATE' and not raw_fields <@ array['date','amount','category','note','account_id','deleted_at','deleted_by'] then return 'This transaction change needs Activity’s dedicated controls'; end if;
      if p_change.operation='INSERT' and nullif(a->>'deleted_at','') is not null then return 'This transaction is already deleted'; end if;
    else return 'This kind of change cannot be undone here';
  end case;
  return null;
end;
$$;
revoke all on function private.recent_change_reason(private.recent_changes) from public,anon,authenticated,service_role;

create function private.recent_change_diff(p_change private.recent_changes) returns jsonb
language plpgsql stable set search_path='' as $$
declare key text; kind text; label text; before_value jsonb; after_value jsonb; result jsonb:='[]'; account_name text;
begin
  foreach key in array private.recent_change_fields(p_change.entity_table,p_change.before_row,p_change.after_row) loop
    -- Complex arrays can contain account IDs and snapshots. Describe them without
    -- returning their internal contents to a browser or assistive technology.
    kind := case when key in ('amount','balance','target_amount','current_amount','snowball_minimum_boost','debt_applied_amount') then 'money'
      when key in ('date','start_date','end_date','next_payment_date','target_date') then 'date'
      when key in ('is_debt','is_recurring','include_in_snowball','pending') then 'boolean'
      when key in ('due_day','day_of_week','interest_rate') then 'number' else 'text' end;
    before_value:=coalesce(p_change.before_row->key,'null'::jsonb);after_value:=coalesce(p_change.after_row->key,'null'::jsonb);
    label:=case key when 'interest_rate' then 'APR'
      when 'current_amount' then case when coalesce(p_change.after_row,p_change.before_row)->>'goal_type'='planned_expense' then 'Spent' else 'Saved' end
      when 'target_amount' then case when coalesce(p_change.after_row,p_change.before_row)->>'goal_type'='planned_expense' then 'Bucket budget' else 'Savings target' end
      when 'due_day' then 'Due day' when 'next_payment_date' then 'Next payment date'
      when 'deleted_at' then 'Removed from Activity' when 'closed_at' then 'Bucket closed' when 'archived_at' then 'Archived'
      else initcap(replace(key,'_',' ')) end;
    if key in ('amount_history','excluded_dates','review_allocations') then
      before_value:=case when before_value='null'::jsonb then 'null'::jsonb else '"Previous details"'::jsonb end;
      after_value:=case when after_value='null'::jsonb then 'null'::jsonb else '"Updated details"'::jsonb end;
    elsif key='account_id' then
      label:='Account';
      if before_value<>'null'::jsonb then
        select name into account_name from public.accounts where id=p_change.before_row->>'account_id' and household_id=p_change.household_id and budget_id=p_change.budget_id;
        before_value:=to_jsonb(coalesce(account_name,'Previous account'));
      end if;
      if after_value<>'null'::jsonb then
        select name into account_name from public.accounts where id=p_change.after_row->>'account_id' and household_id=p_change.household_id and budget_id=p_change.budget_id;
        after_value:=to_jsonb(coalesce(account_name,'Recorded account'));
      end if;
    elsif key in ('linked_bill_id','linked_income_id','linked_plan_id','transfer_group_id') then
      before_value:=case when before_value='null'::jsonb then 'null'::jsonb else '"Previously linked"'::jsonb end;
      after_value:=case when after_value='null'::jsonb then 'null'::jsonb else '"Linked"'::jsonb end;
    elsif key in ('deleted_at','closed_at','archived_at') then
      kind:='boolean';before_value:=to_jsonb(before_value<>'null'::jsonb);after_value:=to_jsonb(after_value<>'null'::jsonb);
    end if;
    result:=result||jsonb_build_array(jsonb_build_object('key',key,'label',label,'kind',kind,'before',before_value,'after',after_value));
  end loop;
  return result;
end;
$$;
revoke all on function private.recent_change_diff(private.recent_changes) from public,anon,authenticated,service_role;

create function private.list_recent_changes(p_expected_household_id uuid,p_expected_budget_id uuid,p_before_id bigint default null,p_limit integer default 25)
returns jsonb language plpgsql security definer set search_path='' as $$
declare role_name text; change private.recent_changes%rowtype; rows jsonb:='[]'; reason text; source text;
  entity_type text; route text; r jsonb; count_rows integer:=0; cursor bigint;
begin
  role_name:=private.recent_change_scope(p_expected_household_id,p_expected_budget_id,false);
  if p_limit is null or p_limit<1 or p_limit>50 or (p_before_id is not null and p_before_id<1) then raise exception 'Invalid history page'; end if;
  for change in select * from private.recent_changes where household_id=p_expected_household_id and budget_id=p_expected_budget_id
      and (p_before_id is null or sequence<p_before_id) order by sequence desc limit p_limit+1 loop
    count_rows:=count_rows+1;
    if count_rows>p_limit then exit; end if;
    cursor:=change.sequence; r:=coalesce(change.after_row,change.before_row);
    entity_type:=case change.entity_table when 'bills' then case when coalesce((r->>'is_debt')::boolean,false) then 'debt' else 'bill' end
      when 'incomes' then 'income' when 'transactions' then 'transaction' else case when r->>'goal_type'='planned_expense' then 'bucket' else 'goal' end end;
    route:=case entity_type when 'bill' then '/(tabs)/bills' when 'debt' then '/(tabs)/bills?view=debt' when 'income' then '/(tabs)/more?section=money'
      when 'transaction' then '/(tabs)/transactions' when 'bucket' then '/(tabs)/more?section=buckets' else '/(tabs)/more?section=goals' end;
    reason:=private.recent_change_reason(change);
    if reason is null and role_name='viewer' then reason:='View-only members cannot undo changes'; end if;
    source:=case when not change.actor_was_authenticated then 'system' when change.actor_id is null then 'manual' when change.operation='INSERT' and exists(
      select 1 from private.flo_creation_receipts receipt where receipt.actor_id=change.actor_id and receipt.household_id=change.household_id
        and receipt.budget_id=change.budget_id and receipt.receipt->>'entityId'=change.entity_id and receipt.created_at=change.created_at
    ) then 'flo' else 'manual' end;
    rows:=rows||jsonb_build_array(jsonb_build_object('id',change.id,'sequence',change.sequence,'householdId',change.household_id,'budgetId',change.budget_id,
      'action',case when change.operation='INSERT' then 'created' when change.operation='DELETE' or (change.entity_table='transactions' and nullif(change.after_row->>'deleted_at','') is not null and nullif(change.before_row->>'deleted_at','') is null) then 'deleted' else 'updated' end,
      'entityType',entity_type,'entityId',change.entity_id,'label',left(coalesce(nullif(r->>'name',''),nullif(r->>'note',''),nullif(r->>'merchant_name',''),'Transaction'),200),
      'actorId',change.actor_id,'actorLabel',case when change.actor_id is null and change.actor_was_authenticated then 'Former household member' when change.actor_id is null then 'App update' when change.actor_id=auth.uid() then 'You' else 'Household member' end,
      'source',source,'createdAt',change.created_at,'changes',private.recent_change_diff(change),'canUndo',reason is null,'undoReason',reason,
      'undoneAt',change.undone_at,'route',route));
  end loop;
  return jsonb_build_object('items',rows,'nextCursor',case when count_rows>p_limit then cursor::text else null end);
end;
$$;
revoke all on function private.list_recent_changes(uuid,uuid,bigint,integer) from public,anon,authenticated,service_role;
grant execute on function private.list_recent_changes(uuid,uuid,bigint,integer) to authenticated;
create function public.list_recent_changes(p_expected_household_id uuid,p_expected_budget_id uuid,p_before_id bigint default null,p_limit integer default 25)
returns jsonb language sql security invoker set search_path='' as $$select private.list_recent_changes(p_expected_household_id,p_expected_budget_id,p_before_id,p_limit)$$;
revoke all on function public.list_recent_changes(uuid,uuid,bigint,integer) from public,anon,authenticated,service_role;
grant execute on function public.list_recent_changes(uuid,uuid,bigint,integer) to authenticated;

create function private.undo_recent_change(p_change_id uuid,p_expected_household_id uuid,p_expected_budget_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare change private.recent_changes%rowtype; current_row jsonb; reason text; latest bigint; fields text[]; assignments text;
  inverse_id uuid; undone_time timestamptz; actor uuid:=auth.uid(); affected integer;
begin
  perform private.recent_change_scope(p_expected_household_id,p_expected_budget_id,true);
  select * into change from private.recent_changes where id=p_change_id and household_id=p_expected_household_id and budget_id=p_expected_budget_id;
  if not found then raise exception 'This change is unavailable in the selected household'; end if;
  if change.undone_at is null then
    -- All ordinary writers acquire the entity row before its version trigger.
    -- Wait for that row before taking any global dependency-table locks. A bill
    -- writer may already hold the row and be about to insert an override.
    execute format('select to_jsonb(t) from public.%I t where id=$1 for update',change.entity_table) into current_row using change.entity_id;
    select version into latest from private.recent_change_versions where entity_table=change.entity_table and entity_id=change.entity_id for update;
    select * into change from private.recent_changes where id=p_change_id for update;
    -- Re-read the receipt first so an exact concurrent retry needs no legacy
    -- locks. For unused creations, block non-FK links only if every dependency
    -- table is immediately available; never wait while holding global locks.
    if change.undone_at is null and change.operation='INSERT' then
      begin
        lock table public.transactions in share row exclusive mode nowait;
        if to_regclass('public.pending_plan_matches') is not null then execute 'lock table public.pending_plan_matches in share row exclusive mode nowait'; end if;
        if to_regclass('public.extra_payments') is not null then execute 'lock table public.extra_payments in share row exclusive mode nowait'; end if;
        lock table public.transaction_reconciliations in share row exclusive mode nowait;
        if change.entity_table='bills' then
          lock table public.monthly_overrides,public.bill_date_moves in share row exclusive mode nowait;
        elsif change.entity_table='goals' then
          lock table private.planned_reconciliation_bases in share row exclusive mode nowait;
        end if;
      exception when lock_not_available then
        raise exception using errcode='55P03',message='Your plan is being updated. Try Undo again in a moment';
      end;
    end if;
  end if;
  if change.undone_at is not null then
    return jsonb_build_object('changeId',change.id,'householdId',change.household_id,'budgetId',change.budget_id,'undoneAt',change.undone_at,'inverseChangeId',change.inverse_change_id);
  end if;
  reason:=private.recent_change_reason(change);
  if reason is not null then raise exception '%',reason; end if;
  fields:=private.recent_change_fields(change.entity_table,change.before_row,change.after_row);
  if change.operation='INSERT' then
    if change.entity_table='transactions' then
      update public.transactions set deleted_at=now(),deleted_by=actor,user_edited_at=now() where id=change.entity_id;
    else execute format('delete from public.%I where id=$1',change.entity_table) using change.entity_id; end if;
  else
    -- Restore only the explicitly allowed user-edit fields, never a whole row,
    -- identity, ownership field, or caller-supplied snapshot.
    if change.entity_table='transactions' then
      fields:=fields||array['deleted_by','user_edited_at'];
    end if;
    select string_agg(format('%I=s.%I',key,key),',') into assignments from unnest(fields) key;
    execute format('update public.%I t set %s from jsonb_populate_record(null::public.%I,$1) s where t.id=$2',change.entity_table,assignments,change.entity_table)
      using change.before_row,change.entity_id;
  end if;
  get diagnostics affected=row_count;
  if affected<>1 then raise exception 'This item changed again. Refresh Recent Changes'; end if;
  -- The inverse is recorded by the same trigger and committed with the receipt.
  select id into inverse_id from private.recent_changes where entity_table=change.entity_table and entity_id=change.entity_id and group_id=txid_current() order by sequence desc limit 1;
  if inverse_id is null or inverse_id=change.id then raise exception 'Undo did not produce a verified inverse'; end if;
  update private.recent_changes set undo_of=change.id where id=inverse_id;
  undone_time:=clock_timestamp();
  update private.recent_changes set undone_at=undone_time,undone_by=actor,inverse_change_id=inverse_id where id=change.id;
  return jsonb_build_object('changeId',change.id,'householdId',change.household_id,'budgetId',change.budget_id,'undoneAt',undone_time,'inverseChangeId',inverse_id);
end;
$$;
revoke all on function private.undo_recent_change(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.undo_recent_change(uuid,uuid,uuid) to authenticated;
create function public.undo_recent_change(p_change_id uuid,p_expected_household_id uuid,p_expected_budget_id uuid) returns jsonb
language sql security invoker set search_path='' as $$select private.undo_recent_change(p_change_id,p_expected_household_id,p_expected_budget_id)$$;
revoke all on function public.undo_recent_change(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.undo_recent_change(uuid,uuid,uuid) to authenticated;

notify pgrst, 'reload schema';
