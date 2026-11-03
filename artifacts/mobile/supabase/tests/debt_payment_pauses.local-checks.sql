-- LOCAL ONLY: end-to-end checks against the synthetic isolated fixture.
do $$ begin
  if current_database()<>'flowledger_pause_tests' then raise exception 'Local fixture database required'; end if;
  if (select debt_payment_pauses from public.bills where id='debt_a') <> '[]'::jsonb then raise exception 'Legacy default failed'; end if;
  if (select to_jsonb(count(*)) from private.recent_changes) <> (select value from public.pause_test_state where key='journal_count_before') then
    raise exception 'Migration generated row journal events'; end if;
  if to_jsonb(pg_get_functiondef('private.capture_recent_change()'::regprocedure)) <> (select value from public.pause_test_state where key='capture_before') then
    raise exception 'Raw journal capture changed'; end if;
  if (select jsonb_agg(to_jsonb(p) order by policyname) from pg_policies p where schemaname='public' and tablename='bills')
    <> (select value from public.pause_test_state where key='policies_before') then raise exception 'Bill RLS policies changed'; end if;
end $$;

set role authenticated;
set test.actor_id='11111111-1111-1111-1111-111111111111';
do $$
declare result jsonb; pause jsonb := '[{"id":"pause_a","start_date":"2026-11-03","resume_date":"2026-12-03","redirect_payment":true}]';
begin
  result := public.update_bill_with_override_intents('debt_a','{"debt_payment_pauses":[]}',jsonb_build_object('debt_payment_pauses',pause));
  if result->'bill'->'debt_payment_pauses' <> pause or result->'overrides' <> '[]' or result->'debt_minimums' <> '[]' then
    raise exception 'Pause save did not return the full bill/unchanged related records'; end if;
  if ((result->'bill') - array['debt_payment_pauses','last_reviewed_at'])
    <> ((select value from public.pause_test_state where key='bill_before') - array['debt_payment_pauses','last_reviewed_at']) then
    raise exception 'Pause save changed another financial or schedule field'; end if;
  -- Lost-response retry: old expected value + exact committed target is allowed.
  perform public.update_bill_with_override_intents('debt_a','{"debt_payment_pauses":[]}',jsonb_build_object('debt_payment_pauses',pause));
  begin
    perform public.update_bill_with_override_intents('debt_a','{"debt_payment_pauses":[]}',
      '{"debt_payment_pauses":[{"id":"pause_a","start_date":"2026-11-03","resume_date":"2026-11-20","redirect_payment":true}]}');
    raise exception 'Stale pause overwrite accepted';
  exception when serialization_failure then null;
  end;
  begin
    perform public.update_bill_with_override_intents('debt_a','{}','{"debt_payment_pauses":[]}');
    raise exception 'Missing expected value accepted';
  exception when raise_exception then
    if sqlerrm not like 'Missing expected value for bill field:%' then raise; end if;
  end;
  begin
    perform public.update_bill_with_override_intents('debt_a','{"paid_amount":0}','{"paid_amount":100}');
    raise exception 'Unsupported paid-state patch accepted';
  exception when raise_exception then
    if sqlerrm not like 'Unsupported bill edit field:%' then raise; end if;
  end;
  begin
    perform public.update_bill_with_override_intents('debt_a',jsonb_build_object('debt_payment_pauses',pause),
      '{"debt_payment_pauses":[{"id":"bad"}]}');
    raise exception 'Invalid pause RPC patch accepted';
  exception when check_violation then null;
  end;
  begin
    perform public.update_bill_with_override_intents('debt_a',jsonb_build_object('debt_payment_pauses',pause),'{"debt_payment_pauses":null}');
    raise exception 'JSON null RPC patch accepted';
  exception when check_violation then null;
  end;
  -- A conflicting override after the bill write must roll back the pause and
  -- journal together, preserving the existing paid/actual/posted date fields.
  begin
    perform public.update_bill_with_override_intents('debt_a',jsonb_build_object('debt_payment_pauses',pause),
      '{"debt_payment_pauses":[]}',
      '[{"id":"override_a","month":10,"year":2026,"expected":{"custom_amount":0},"patch":{"custom_amount":200}}]');
    raise exception 'Conflicting override accepted';
  exception when serialization_failure then null;
  end;
  if (select debt_payment_pauses from public.bills where id='debt_a') <> pause then raise exception 'Failed transaction partially saved pause'; end if;
  if (select to_jsonb(o) from public.monthly_overrides o where id='override_a')
    <> (select value from public.pause_test_state where key='override_before') then raise exception 'Pause changed paid or override data'; end if;
  if exists(select 1 from public.pause_test_boost_calls) then raise exception 'Pause recalculated permanent debt minimums'; end if;
  raise notice 'PASS: editor save, financial fields unchanged, retry, stale conflict, payload CHECK and atomic override rollback';
end $$;
reset role;

do $$ begin
  if (select count(*) from private.recent_changes where entity_id='debt_a') <> 2 then
    raise exception 'Retry or failed save added journal entries'; end if;
  if not exists(select 1 from private.recent_changes where entity_id='debt_a' and operation='UPDATE'
    and before_row->'debt_payment_pauses'='[]'::jsonb and jsonb_typeof(after_row->'debt_payment_pauses')='array') then
    raise exception 'Raw before/after pause truth missing'; end if;
  insert into public.pause_test_state values('pause_change_id',
    (select to_jsonb(id) from private.recent_changes where entity_id='debt_a' and operation='UPDATE'));
end $$;

set role authenticated;
set test.actor_id='11111111-1111-1111-1111-111111111111';
do $$
declare result jsonb; change_id uuid; detail jsonb;
begin
  result := public.list_recent_changes('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','cccccccc-cccc-cccc-cccc-cccccccccccc');
  select (value #>> '{}')::uuid into change_id from public.pause_test_state where key='pause_change_id';
  select value into detail from jsonb_array_elements(result->'items') where value->>'id'=change_id::text;
  if detail is null or (detail->>'canUndo')::boolean or detail->>'undoReason'<>'Payment pauses use the debt’s Resume or Cancel controls'
    or detail->'changes'->0->>'label'<>'Payment pauses' or jsonb_typeof(detail->'changes'->0->'after')<>'string'
    or detail ? 'before_row' or detail ? 'after_row' then raise exception 'Public history contract failed: %',detail; end if;
  begin
    perform public.undo_recent_change(change_id,'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','cccccccc-cccc-cccc-cccc-cccccccccccc');
    raise exception 'Generic Undo reverted a pause';
  exception when raise_exception then
    if sqlerrm <> 'Payment pauses use the debt’s Resume or Cancel controls' then raise; end if;
  end;
  -- A different household is invisible to the current household owner.
  if exists(select 1 from public.bills where id='debt_b') then raise exception 'Cross-household read allowed'; end if;
  begin
    perform public.update_bill_with_override_intents('debt_b','{"debt_payment_pauses":[]}','{"debt_payment_pauses":[]}');
    raise exception 'Cross-household RPC allowed';
  exception when raise_exception then
    if sqlerrm<>'Bill not found or edit access changed' then raise; end if;
  end;
  if (public.list_recent_changes('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','cccccccc-cccc-cccc-cccc-cccccccccccc')->'items')::text like '%Synthetic other household%' then
    raise exception 'Cross-household history exposed'; end if;
  raise notice 'PASS: scoped public history, primitive pause summaries and original Undo rejects dedicated pause change';
end $$;

set test.actor_id='22222222-2222-2222-2222-222222222222';
do $$ declare affected integer;
begin
  if not exists(select 1 from public.bills where id='debt_a') then raise exception 'Viewer lost read access'; end if;
  begin
    perform public.update_bill_with_override_intents('debt_a','{"debt_payment_pauses":[]}','{"debt_payment_pauses":[]}');
    raise exception 'Viewer RPC edit allowed';
  exception when raise_exception then
    if sqlerrm not in ('Bill not found or edit access changed','Household edit access required') then raise; end if;
  end;
  update public.bills set debt_payment_pauses='[]' where id='debt_a';
  get diagnostics affected=row_count;
  if affected<>0 then raise exception 'Viewer direct update allowed'; end if;
  begin
    insert into public.bills(id,user_id,household_id,budget_id,name,created_at) values(
      'viewer_insert','22222222-2222-2222-2222-222222222222','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','cccccccc-cccc-cccc-cccc-cccccccccccc','Rejected','2026-11-03');
    raise exception 'Viewer direct insert allowed';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS: viewer retains SELECT and cannot edit/insert pauses by RPC or direct table write';
end $$;
set test.actor_id='';
do $$ begin
  begin
    perform public.update_bill_with_override_intents('debt_a','{"debt_payment_pauses":[]}','{"debt_payment_pauses":[]}');
    raise exception 'Unauthenticated edit accepted';
  exception when raise_exception then
    if sqlerrm<>'Authentication required' then raise; end if;
  end;
end $$;
reset role;

-- Other supported edits retain sparse behavior; omitted pause history survives.
set role authenticated;
set test.actor_id='11111111-1111-1111-1111-111111111111';
do $$ declare result jsonb;
begin
  result := public.update_bill_with_override_intents('debt_a','{"name":"Synthetic debt A"}','{"name":"Renamed synthetic debt"}');
  if result->'bill'->>'name'<>'Renamed synthetic debt' or jsonb_array_length(result->'bill'->'debt_payment_pauses')<>1 then
    raise exception 'Sparse unrelated edit dropped pause history'; end if;
end $$;
reset role;

do $$ begin
  if (select to_jsonb(b) - 'debt_payment_pauses' from public.bills b where id='debt_b')
    <> (select value from public.pause_test_state where key='other_bill_before') then raise exception 'Other household changed'; end if;
  if exists(select 1 from public.pause_test_boost_calls) then raise exception 'Unrelated edit recalculated minimums'; end if;
  raise notice 'PASS: no auth, unrelated sparse edits, other household and permanent boosts unchanged';
end $$;
select 'local debt payment pause integration checks passed' as result;
