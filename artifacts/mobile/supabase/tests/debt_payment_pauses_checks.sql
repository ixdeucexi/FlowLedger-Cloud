-- Owner-only validation using constants, synthetic composite records and a
-- temporary CHECK probe. No application-row reads or writes and no auth/session
-- data. Before apply: BEGIN; <migration SQL>; <this SQL>; ROLLBACK;
-- After apply: BEGIN; <this SQL>; ROLLBACK;

create temporary table debt_pause_check_probe (
  pauses jsonb not null default '[]'::jsonb
    check (public.is_valid_debt_payment_pauses(pauses))
) on commit drop;

do $$
declare
  sample record;
  base jsonb := '{"id":"pause_1-A","start_date":"2026-11-03","resume_date":"2026-12-03","redirect_payment":true}';
  max_pauses jsonb;
  count_checked integer := 0;
begin
  for sample in
    select * from (values
      ('empty', '[]'::jsonb, true),
      ('one interval', jsonb_build_array(base), true),
      ('redirect disabled', jsonb_build_array(base || '{"redirect_payment":false}'::jsonb), true),
      ('id length 128', jsonb_build_array(base || jsonb_build_object('id',repeat('a',128))), true),
      ('adjacent', jsonb_build_array(base,base || '{"id":"next","start_date":"2026-12-03","resume_date":"2027-01-03"}'::jsonb), true),
      ('leap year', jsonb_build_array(base || '{"start_date":"2028-02-29","resume_date":"2028-03-01"}'::jsonb), true),
      ('leap century', jsonb_build_array(base || '{"start_date":"2000-02-29","resume_date":"2000-03-01"}'::jsonb), true),
      ('date limits', jsonb_build_array(base || '{"start_date":"0001-01-01","resume_date":"9999-12-31"}'::jsonb), true),
      ('SQL null', null::jsonb, false),
      ('JSON null', 'null'::jsonb, false),
      ('object', base, false),
      ('string', '"[]"'::jsonb, false),
      ('array element null', '[null]'::jsonb, false),
      ('array element string', '["pause"]'::jsonb, false),
      ('missing key', jsonb_build_array(base - 'redirect_payment'), false),
      ('unknown key', jsonb_build_array(base || '{"css":"display:none"}'::jsonb), false),
      ('empty id', jsonb_build_array(base || '{"id":""}'::jsonb), false),
      ('oversized id', jsonb_build_array(base || jsonb_build_object('id',repeat('a',129))), false),
      ('CSS id', jsonb_build_array(base || '{"id":"<style>body{display:none}</style>"}'::jsonb), false),
      ('spaced id', jsonb_build_array(base || '{"id":"two words"}'::jsonb), false),
      ('number id', jsonb_build_array(base || '{"id":1}'::jsonb), false),
      ('null id', jsonb_build_array(base || '{"id":null}'::jsonb), false),
      ('boolean string', jsonb_build_array(base || '{"redirect_payment":"true"}'::jsonb), false),
      ('null boolean', jsonb_build_array(base || '{"redirect_payment":null}'::jsonb), false),
      ('date number', jsonb_build_array(base || '{"start_date":20261103}'::jsonb), false),
      ('date null', jsonb_build_array(base || '{"resume_date":null}'::jsonb), false),
      ('short date', jsonb_build_array(base || '{"start_date":"2026-1-03"}'::jsonb), false),
      ('datetime', jsonb_build_array(base || '{"start_date":"2026-11-03T00:00:00Z"}'::jsonb), false),
      ('year zero', jsonb_build_array(base || '{"start_date":"0000-01-01"}'::jsonb), false),
      ('bad month', jsonb_build_array(base || '{"start_date":"2026-13-01"}'::jsonb), false),
      ('bad day', jsonb_build_array(base || '{"start_date":"2026-11-31"}'::jsonb), false),
      ('nonleap day', jsonb_build_array(base || '{"start_date":"2025-02-29"}'::jsonb), false),
      ('nonleap century', jsonb_build_array(base || '{"start_date":"1900-02-29"}'::jsonb), false),
      ('bad resume date', jsonb_build_array(base || '{"resume_date":"2026-12-32"}'::jsonb), false),
      ('same day', jsonb_build_array(base || '{"resume_date":"2026-11-03"}'::jsonb), false),
      ('reverse interval', jsonb_build_array(base || '{"resume_date":"2026-11-02"}'::jsonb), false),
      ('duplicate id', jsonb_build_array(base,base || '{"start_date":"2026-12-03","resume_date":"2027-01-03"}'::jsonb), false),
      ('overlap', jsonb_build_array(base,base || '{"id":"next","start_date":"2026-12-02","resume_date":"2027-01-03"}'::jsonb), false),
      ('unsorted', jsonb_build_array(base || '{"id":"next","start_date":"2026-12-03","resume_date":"2027-01-03"}'::jsonb,base), false)
    ) as cases(name,payload,expected)
  loop
    if public.is_valid_debt_payment_pauses(sample.payload) is distinct from sample.expected then
      raise exception 'Validator case failed: %',sample.name;
    end if;
    count_checked := count_checked + 1;
  end loop;
  select jsonb_agg(jsonb_build_object('id','pause_'||n,'start_date',to_char(date '2026-01-01'+n*2,'YYYY-MM-DD'),
    'resume_date',to_char(date '2026-01-02'+n*2,'YYYY-MM-DD'),'redirect_payment',true) order by n)
    into max_pauses from generate_series(0,119) n;
  if not public.is_valid_debt_payment_pauses(max_pauses) then raise exception '120 intervals rejected'; end if;
  if public.is_valid_debt_payment_pauses(max_pauses || jsonb_build_array(base)) then raise exception '121 intervals accepted'; end if;
  insert into pg_temp.debt_pause_check_probe default values;
  if (select pauses from pg_temp.debt_pause_check_probe limit 1) <> '[]'::jsonb then raise exception 'Default mismatch'; end if;
  begin
    insert into pg_temp.debt_pause_check_probe values ('[{"id":"invalid"}]');
    raise exception 'CHECK accepted malformed data';
  exception when check_violation then null;
  end;
  begin
    insert into pg_temp.debt_pause_check_probe values (null);
    raise exception 'NOT NULL accepted SQL null';
  exception when not_null_violation then null;
  end;
  raise notice 'PASS: % validator cases, 120/121 bound, real CHECK and NOT NULL',count_checked;
end;
$$;

do $$
declare
  history jsonb := '[{"id":"old","start_date":"2025-01-01","resume_date":"2025-02-01","redirect_payment":false}]';
  added jsonb := '[{"id":"new","start_date":"2026-11-03","resume_date":"2026-12-03","redirect_payment":true}]';
  resumed jsonb := '[{"id":"new","start_date":"2026-11-03","resume_date":"2026-11-10","redirect_payment":true}]';
  change private.recent_changes;
  detail jsonb;
  item jsonb;
  many jsonb;
  summary text;
  sample record;
begin
  if private.recent_change_fields('bills','{}','{"debt_payment_pauses":[]}') <> '{}'::text[] then
    raise exception 'Legacy missing [] produces a false pause edit';
  end if;
  for sample in select * from (values
    ('append',history,history||added,'2026-12-03'),
    ('resume',history||added,history||resumed,'2026-11-10'),
    ('cancel',history||added,history,null::text)
  ) as cases(action,before_pauses,after_pauses,expected_resume)
  loop
    change := jsonb_populate_record(null::private.recent_changes,jsonb_build_object(
      'entity_table','bills','operation','UPDATE','actor_was_authenticated',true,
      'before_row',jsonb_build_object('debt_payment_pauses',sample.before_pauses),
      'after_row',jsonb_build_object('debt_payment_pauses',sample.after_pauses)));
    detail := private.recent_change_diff(change);
    if jsonb_array_length(detail) <> 1 then raise exception 'Wrong diff count for %',sample.action; end if;
    item := detail->0;
    if item->>'key' <> 'debt_payment_pauses' or item->>'label' <> 'Payment pauses' or item->>'kind' <> 'text'
       or jsonb_typeof(item->'before') <> 'string' or jsonb_typeof(item->'after') <> 'string'
       or length(item->>'before') > 3000 or length(item->>'after') > 3000
       or detail::text like '%2025-01-01%' or detail::text like '%"redirect_payment"%' then
      raise exception 'Unsafe or irrelevant history detail for %: %',sample.action,detail;
    end if;
    if sample.expected_resume is not null and (item->>'after' not like '%'||sample.expected_resume||'%'
       or item->>'after' not like '%redirect: Yes%') then raise exception 'Missing changed pause details for %',sample.action; end if;
    if sample.action='resume' and item->>'before' not like '%2026-12-03%' then raise exception 'Lost previous resume date'; end if;
    if sample.action='cancel' and item->>'after' <> 'No saved pause for these dates' then raise exception 'Wrong cancel summary'; end if;
    if private.recent_change_reason(change) is distinct from 'Payment pauses use the debt’s Resume or Cancel controls' then
      raise exception 'Generic Undo enabled or incorrect pause reason for %',sample.action;
    end if;
  end loop;
  select jsonb_agg(jsonb_build_object('id','pause_'||n,'start_date',to_char(date '2026-01-01'+n*2,'YYYY-MM-DD'),
    'resume_date',to_char(date '2026-01-02'+n*2,'YYYY-MM-DD'),'redirect_payment',false) order by n)
    into many from generate_series(0,119) n;
  summary := private.recent_change_pause_summary(many,'[]');
  if length(summary)>3000 or summary not like '%+117 more changed pauses%' or summary like '%2026-01-07%' then
    raise exception 'Summary limit failed: %',summary;
  end if;
  if private.recent_change_pause_summary('"malformed"','[]') <> 'Payment pause details unavailable' then
    raise exception 'Malformed summary input leaked or failed';
  end if;
  raise notice 'PASS: append/resume/cancel, changed IDs only, primitive summaries, bound and no Undo';
end;
$$;

do $$
declare fn record; col record;
begin
  select a.attnotnull,pg_get_expr(d.adbin,d.adrelid) as default_value into col
    from pg_catalog.pg_attribute a join pg_catalog.pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
    where a.attrelid='public.bills'::regclass and a.attname='debt_payment_pauses' and a.atttypid='jsonb'::regtype;
  if not found or not col.attnotnull or col.default_value is distinct from '''[]''::jsonb' then raise exception 'Column contract mismatch'; end if;
  if not exists(select 1 from pg_catalog.pg_constraint where conrelid='public.bills'::regclass
    and conname='bills_debt_payment_pauses_valid' and contype='c' and convalidated) then raise exception 'Validated CHECK missing'; end if;
  select p.prosecdef,p.provolatile,p.proconfig into fn from pg_catalog.pg_proc p where p.oid='public.is_valid_debt_payment_pauses(jsonb)'::regprocedure;
  if fn.prosecdef or fn.provolatile<>'i' or not fn.proconfig @> array['search_path=""'] then raise exception 'Validator security/config mismatch'; end if;
  if has_function_privilege('anon','public.is_valid_debt_payment_pauses(jsonb)','EXECUTE')
    or not has_function_privilege('authenticated','public.is_valid_debt_payment_pauses(jsonb)','EXECUTE')
    or not has_function_privilege('service_role','public.is_valid_debt_payment_pauses(jsonb)','EXECUTE') then raise exception 'Validator grants mismatch'; end if;
  if not exists(select 1 from pg_catalog.pg_class where oid='public.bills'::regclass and relrowsecurity) then raise exception 'Bills RLS disabled'; end if;
  select p.prosecdef,p.proconfig,pg_get_functiondef(p.oid) as definition into fn from pg_catalog.pg_proc p where p.oid='public.update_bill_with_override_intents(text,jsonb,jsonb,jsonb)'::regprocedure;
  if fn.prosecdef or not fn.proconfig @> array['search_path=""'] then raise exception 'Bill editor gained privileges or lost fixed path'; end if;
  if fn.definition not like '%and p_patch ?| array[''amount'', ''balance'', ''is_debt'', ''include_in_snowball''] then%' then
    raise exception 'Debt minimum trigger fields changed';
  end if;
  if has_function_privilege('anon','public.update_bill_with_override_intents(text,jsonb,jsonb,jsonb)','EXECUTE')
    or not has_function_privilege('authenticated','public.update_bill_with_override_intents(text,jsonb,jsonb,jsonb)','EXECUTE') then raise exception 'Bill edit RPC grants mismatch'; end if;
  for fn in select p.proname,p.prosecdef,p.proconfig,p.oid from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='private' and p.proname in ('recent_change_fields','recent_change_diff','recent_change_reason','recent_change_pause_summary')
  loop
    if fn.prosecdef is distinct from (fn.proname='recent_change_reason') or not fn.proconfig @> array['search_path=""']
      or has_function_privilege('anon',fn.oid,'EXECUTE') or has_function_privilege('authenticated',fn.oid,'EXECUTE')
      or has_function_privilege('service_role',fn.oid,'EXECUTE') then raise exception 'Private history privileges changed: %',fn.proname; end if;
  end loop;
  raise notice 'PASS: JSONB/default/CHECK, RLS, invoker RPC, unchanged boost trigger and least privileges';
end;
$$;

select 'debt payment pause checks passed' as result;
