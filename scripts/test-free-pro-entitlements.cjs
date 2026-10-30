// Actual PostgreSQL tests against disposable fictional records only.
const { execFileSync, spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const container = process.env.FLOWLEDGER_FREE_PRO_TEST_CONTAINER || 'flowledger-free-pro-test';
const database = `free_pro_entitlements_test_${process.pid}`;
const env = { ...process.env };
for (const key of ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']) delete env[key];
const base = ['--host=unix:///var/run/docker.sock', 'exec'];
const ids = {
  founder: '10000000-0000-4000-8000-000000000001',
  permanent: '10000000-0000-4000-8000-000000000002',
  free: '10000000-0000-4000-8000-000000000003',
  paid: '10000000-0000-4000-8000-000000000004',
  admin: '10000000-0000-4000-8000-000000000005',
  viewer: '10000000-0000-4000-8000-000000000006',
  outsider: '10000000-0000-4000-8000-000000000007',
  deleted: '10000000-0000-4000-8000-000000000008',
  other: '10000000-0000-4000-8000-000000000009',
};
const homes = {
  founder: '20000000-0000-4000-8000-000000000001',
  permanent: '20000000-0000-4000-8000-000000000002',
  free: '20000000-0000-4000-8000-000000000003',
  paid: '20000000-0000-4000-8000-000000000004',
  admin: '20000000-0000-4000-8000-000000000005',
  foreign: '20000000-0000-4000-8000-000000000007',
  deleted: '20000000-0000-4000-8000-000000000008',
};
const budgets = Object.fromEntries(Object.entries(homes).map(([key, value]) => [key, value.replace(/^2/, '3')]));
let checks = 0;
function docker(args, input) {
  return execFileSync('docker', [...base, ...args], { env, encoding: 'utf8', input, maxBuffer: 16 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });
}
function sql(statement) { return docker(['-i', container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', database], statement); }
function scalar(statement) { return docker([container, 'psql', '-X', '-At', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', database, '-c', statement]).trim().split('\n').at(-1); }
function json(statement) { return JSON.parse(scalar(statement)); }
const claims = who => `set "request.jwt.claim.sub"='${who}';set role authenticated;`;
const service = "set \"request.jwt.claim.sub\"='';set role service_role;";
function ok(condition, label) { assert(condition, label); checks += 1; console.log(`PASS ${label}`); }
function rejects(statement, pattern, label) {
  let failure;
  try { sql(statement); } catch (error) { failure = String(error.stderr || error.message); }
  assert(failure, label || 'Expected PostgreSQL rejection');
  if (pattern) assert.match(failure, pattern, label);
  checks += 1;
  console.log(`PASS ${label || 'rejected unauthorized statement'}`);
}
function session(statement) {
  return new Promise(resolve => {
    const p = spawn('docker', [...base, container, 'psql', '-X', '-At', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', database, '-c', statement], { env });
    let output = '';
    p.stdout.on('data', chunk => { output += chunk; });
    p.stderr.on('data', chunk => { output += chunk; });
    p.on('close', code => resolve({ code, output }));
  });
}
const access = (who, home, preview = null) => json(`${claims(who)}select public.get_household_feature_access('${home}',${preview ? `'${preview}'` : 'null'})`);
const reserveSql = (who, home, receipt = randomUUID(), preview = null) => `select public.reserve_flo_plan_request('${who}','${home}','${receipt}',${preview ? `'${preview}'` : 'null'})`;
const reserve = (who, home, receipt = randomUUID(), preview = null) => json(service + reserveSql(who, home, receipt, preview));
const refund = (who, home, receipt) => scalar(`${service}select public.refund_flo_plan_request('${who}','${home}','${receipt}')`);
const incomePayload = JSON.stringify({ name: 'Fictional income', amount: 400, frequency: 'monthly', first_date: '2026-11-01' });
const creationSql = (who, home, budget, command, payload = incomePayload) => `${claims(who)}select public.create_flo_entity('${command}','create_income','${payload}'::jsonb,'${home}','${budget}')`;
function source(suffix) {
  const files = fs.readdirSync(path.join(root, 'supabase/migrations')).filter(name => name.endsWith(suffix));
  assert.equal(files.length, 1, `Expected one ${suffix} migration`);
  return fs.readFileSync(path.join(root, 'supabase/migrations', files[0]), 'utf8');
}
function household(key, actor, role = 'owner', backdated = false) {
  return `insert into public.households(id,created_by,is_personal,created_at)values('${homes[key]}','${actor}',false,${backdated ? "'2000-01-01'" : 'now()'});
insert into public.household_members(household_id,user_id,role)values('${homes[key]}','${actor}','${role}');
insert into public.user_preferences(user_id,active_household_id)values('${actor}','${homes[key]}');
insert into public.budgets(id,household_id)values('${budgets[key]}','${homes[key]}');`;
}

(async () => {
  docker([container, 'createdb', '-U', 'postgres', database]);
  try {
    const schema = JSON.parse(fs.readFileSync(path.join(root, 'scripts/fixtures/flo-creation-schema.json'), 'utf8'));
    let setup = `create schema auth;create schema private;
do $$begin create role authenticated;exception when duplicate_object then null;end$$;
do $$begin create role anon;exception when duplicate_object then null;end$$;
do $$begin create role service_role;exception when duplicate_object then null;end$$;
grant usage on schema public,private,auth to authenticated,service_role;
grant usage on schema public,auth to anon;
create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create table auth.users(id uuid primary key);
create table public.households(id uuid primary key,created_by uuid,is_personal boolean,created_at timestamptz default now());
`;
    for (const table of [...new Set(schema.columns.map(value => value.table_name))]) {
      const columns = schema.columns.filter(value => value.table_name === table).map(c => `"${c.column_name}" ${c.data_type}${c.column_default === null ? '' : ` default ${c.column_default}`}${c.is_nullable === 'NO' ? ' not null' : ''}`);
      const constraints = schema.constraintsAndTriggers.filter(value => value.kind === 'constraint' && value.relation === table).map(c => `constraint "${c.name}" ${c.definition}`);
      setup += `create table public."${table}"(${[...columns, ...constraints].join(',')});\n`;
    }
    setup += `grant select,insert,update,delete on all tables in schema public to authenticated,service_role;
create table public.feedback_admins(user_id uuid primary key references auth.users(id)on delete cascade);
grant select on public.feedback_admins to authenticated;
create function public.is_household_member(p_household_id uuid)returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.household_members where household_id=p_household_id and user_id=auth.uid())$$;
create function private.is_household_editor(p_household_id uuid)returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.household_members where household_id=p_household_id and user_id=auth.uid()and role in('owner','manager','editor'))$$;
insert into auth.users values${Object.values(ids).map(id => `('${id}')`).join(',')};
${household('permanent', ids.permanent)}
`;
    sql(setup);
    sql(source('_household_membership_plans.sql'));
    sql(household('founder', ids.founder));
    const dailySource = source('_flo_v3_account_intelligence.sql');
    sql(dailySource.slice(dailySource.indexOf('create table if not exists public.flo_daily_limits'), dailySource.indexOf('create or replace function public.confirm_flo_recurring_bill_proposal')));
    sql(source('_create_flo_entity.sql'));
    sql(source('_create_plan_simulations.sql'));
    sql('create table public.flo_conversations(id uuid primary key);create table public.flo_messages(id uuid primary key);');
    sql(dailySource.slice(dailySource.indexOf('create table if not exists public.flo_proposals'), dailySource.indexOf('-- The original user-global memory')));
    sql(dailySource.slice(dailySource.indexOf('create or replace function public.confirm_flo_recurring_bill_proposal')));
    const hardeningSource = source('_account_deletion_and_flo_rpc_hardening.sql');
    sql(hardeningSource.slice(hardeningSource.indexOf('alter function public.confirm_flo_recurring_bill_proposal')));
    const reviewSource = source('_founding_free_review_center_entitlement.sql');
    sql(reviewSource.slice(0, reviewSource.indexOf('-- Preserve each proven atomic implementation')));
    const reviewDefinition = scalar("select pg_get_functiondef('private.has_review_center_entitlement(uuid)'::regprocedure)");
    const permanentBefore = json(`select row_to_json(p)from public.household_plans p where household_id='${homes.permanent}'`);
    sql(source('_free_pro_feature_access.sql'));

    sql([household('free', ids.free, 'owner', true), household('paid', ids.paid), household('admin', ids.admin), household('foreign', ids.outsider), household('deleted', ids.deleted)].join('\n'));
    sql(`insert into public.household_members(household_id,user_id,role)values('${homes.free}','${ids.viewer}','viewer'),('${homes.free}','${ids.other}','editor');
insert into public.user_preferences(user_id,active_household_id)values('${ids.viewer}','${homes.free}'),('${ids.other}','${homes.free}');
update public.household_plans set tier='pro',source='billing'where household_id='${homes.paid}';
update public.household_plans set tier='pro',source='admin'where household_id='${homes.admin}';
insert into public.feedback_admins values('${ids.admin}');`);

    const free = access(ids.free, homes.free), founder = access(ids.founder, homes.founder), paid = access(ids.paid, homes.paid), permanent = access(ids.permanent, homes.permanent), admin = access(ids.admin, homes.admin);
    ok(free.version === 1 && free.householdId === homes.free && free.plan.tier === 'free' && !free.foundingPlanning, 'new backdated household stays Free without a founding grant');
    const core = ['manual_budgeting', 'flo_basic', 'debt_payoff', 'plan_simulator', 'transaction_matching'];
    ok(core.every(feature => free.features.includes(feature)), 'Free includes manual planning, basic debt/simulator and recovery/review capabilities');
    ok(free.features.includes('flo_account_chat') && !free.features.includes('flo_creation'), 'Free can preview real chat without gaining confirmed AI creation');
    ok(!['debt_strategies', 'saved_scenarios', 'scenario_comparison', 'cloud_scenarios', 'long_term_reports', 'plaid_sync', 'connected_insights'].some(feature => free.features.includes(feature)), 'Free does not receive advanced Pro features');
    ok(free.flo.period === 'month' && free.flo.limit === 10 && free.flo.used === 0 && free.flo.remaining === 10 && !free.flo.canCreate, 'Free preview starts with ten shared monthly requests');
    ok(founder.foundingPlanning && founder.plan.tier === 'free' && founder.plan.source === 'default', 'founding snapshot preserves planning without promoting household tier');
    ok(['debt_strategies', 'saved_scenarios', 'scenario_comparison', 'long_term_reports', 'connected_insights', 'flo_creation'].every(feature => founder.features.includes(feature)), 'founders retain existing advanced planning and Flo creation');
    ok(!founder.features.includes('plaid_sync') && !founder.features.includes('cloud_scenarios'), 'founding planning grant does not unlock bank/cloud cost features');
    ok(founder.flo.period === 'day' && founder.flo.limit === 100 && founder.flo.canCreate, 'founders retain existing per-actor daily Flo allowance');
    ok(paid.plan.tier === 'pro' && paid.flo.period === 'month' && paid.flo.limit === 300 && paid.flo.canCreate && paid.features.includes('cloud_scenarios'), 'new paid Pro receives three hundred shared monthly requests and Pro capabilities');
    ok(permanent.plan.tier === 'pro' && permanent.plan.source === 'grandfathered' && permanent.flo.period === 'day', 'permanent grandfathered Pro keeps its actual plan and legacy allowance');
    assert.deepEqual(json(`select row_to_json(p)from public.household_plans p where household_id='${homes.permanent}'`), permanentBefore); checks += 1;
    ok(admin.plan.source === 'admin' && admin.flo.period === 'day', 'admin Pro keeps its existing daily allowance');
    const viewer = access(ids.viewer, homes.free);
    ok(!viewer.flo.canCreate && viewer.features.includes('manual_budgeting'), 'viewer can read access without creation rights');
    sql(`insert into public.household_members(household_id,user_id,role)values('${homes.founder}','${ids.viewer}','viewer');update public.user_preferences set active_household_id='${homes.founder}'where user_id='${ids.viewer}'`);
    ok(access(ids.viewer, homes.founder).foundingPlanning && !access(ids.viewer, homes.founder).flo.canCreate, 'a founding planning grant never elevates a viewer to an editor');
    rejects(creationSql(ids.viewer, homes.founder, budgets.founder, randomUUID()), /edit access/i, 'founding viewer cannot invoke canonical creation');
    sql(`update public.user_preferences set active_household_id='${homes.free}'where user_id='${ids.viewer}'`);
    const pacific = json(`${claims(ids.free)}set timezone='Pacific/Honolulu';select public.get_household_feature_access('${homes.free}',null)`);
    ok(new Date(pacific.flo.resetsAt).getTime() === new Date(free.flo.resetsAt).getTime(), 'monthly reset is UTC-derived regardless of the database session timezone');

    const preview = access(ids.admin, homes.admin, 'free');
    ok(preview.plan.tier === 'pro' && !preview.foundingPlanning && preview.flo.limit === 10 && !preview.flo.canCreate, 'verified admin preview simulates Free rather than inheriting Pro/founder access');
    rejects(`${claims(ids.free)}select public.get_household_feature_access('${homes.free}','pro')`, /preview|admin/i, 'non-admin cannot spoof a Pro preview');
    rejects(`${claims(ids.admin)}select public.get_household_feature_access('${homes.admin}','unlimited')`, /preview|tier/i, 'unknown preview tier is rejected');
    rejects(`${claims(ids.free)}select public.get_household_feature_access('${homes.foreign}',null)`, /active|household|access/i, 'capability reads reject a different active household');
    rejects(`${claims(ids.outsider)}select public.get_household_feature_access('${homes.free}',null)`, /active|household|access/i, 'nonmember cannot inspect another household entitlement');
    rejects(`set role anon;select public.get_household_feature_access('${homes.free}',null)`, /permission denied/i, 'anonymous capability reads are denied');
    rejects(`set "request.jwt.claim.sub"='';set role authenticated;select public.get_household_feature_access('${homes.free}',null)`, /Sign in|authenticat|session_required/i, 'empty authenticated identity fails closed');
    sql(`delete from auth.users where id='${ids.deleted}'`);
    rejects(`${claims(ids.deleted)}select public.get_household_feature_access('${homes.deleted}',null)`, /Sign in|authenticat|session_required|access/i, 'stale access token for deleted user fails closed');

    ok(scalar("select bool_and(c.relrowsecurity)from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private'and c.relkind='r'") === 't', 'all private grant/quota/receipt tables have RLS enabled');
    for (const role of ['anon', 'authenticated', 'service_role']) {
      ok(scalar(`select bool_and(not has_table_privilege('${role}',c.oid,'select,insert,update,delete'))from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private'and c.relkind='r'`) === 't', `${role} has no direct access to private feature/counter/receipt data`);
    }
    ok(scalar("select bool_and(not p.prosecdef)from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'and p.proname in('get_household_feature_access','reserve_flo_plan_request','refund_flo_plan_request')") === 't', 'public capability and service RPCs are invoker wrappers');
    for (const rpc of ['reserve_flo_plan_request(uuid,uuid,uuid,text)', 'refund_flo_plan_request(uuid,uuid,uuid)']) {
      ok(scalar(`select not has_function_privilege('authenticated','public.${rpc}','execute')and not has_function_privilege('anon','public.${rpc}','execute')and has_function_privilege('service_role','public.${rpc}','execute')`) === 't', `${rpc} is service-only`);
    }
    rejects(`${claims(ids.free)}${reserveSql(ids.free, homes.free)}`, /permission denied/i, 'authenticated callers cannot reserve their own chosen quota');
    rejects(`${service}${reserveSql(ids.free, homes.foreign)}`, /active|household|access/i, 'service reservation validates actor active scope');
    rejects(`${service}${reserveSql(ids.free, homes.free, randomUUID(), 'pro')}`, /preview|admin/i, 'service preview cannot elevate a non-admin actor');

    const receipts = Array.from({ length: 9 }, () => randomUUID());
    const first = reserve(ids.free, homes.free, receipts[0]);
    ok(first.allowed && !first.legacyDaily && first.reservationId === receipts[0] && first.allowance.used === 1, 'first monthly reservation is charged once with a server-derived allowance');
    const duplicate = reserve(ids.free, homes.free, receipts[0]);
    ok(!duplicate.allowed && access(ids.free, homes.free).flo.used === 1, 'same reservation cannot call the provider twice or charge twice');
    for (let i = 1; i < receipts.length; i += 1) reserve(i % 2 ? ids.viewer : ids.other, homes.free, receipts[i]);
    ok(access(ids.free, homes.free).flo.used === 9 && access(ids.viewer, homes.free).flo.used === 9, 'monthly Free allowance is shared across household members');
    const raceIds = [randomUUID(), randomUUID()];
    const raced = await Promise.all(raceIds.map(id => session(service + reserveSql(ids.free, homes.free, id))));
    ok(raced.every(result => result.code === 0), 'concurrent quota reservations complete without database failures');
    const raceResults = raced.map(result => JSON.parse(result.output.trim().split('\n').at(-1)));
    ok(raceResults.filter(result => result.allowed).length === 1 && access(ids.free, homes.free).flo.used === 10, 'concurrent final-slot requests cannot exceed the Free monthly cap');
    ok(!reserve(ids.free, homes.free).allowed && access(ids.free, homes.free).flo.remaining === 0, 'eleventh Free request is denied with zero remaining');
    ok(refund(ids.free, homes.free, receipts[0]) === 't' && access(ids.free, homes.free).flo.used === 9, 'failed provider reservation refunds exactly one consumed request');
    ok(refund(ids.free, homes.free, receipts[0]) === 'f' && access(ids.free, homes.free).flo.used === 9, 'repeat refund cannot create credit');
    ok(!reserve(ids.free, homes.free, receipts[0]).allowed && access(ids.free, homes.free).flo.used === 9, 'refunded reservation ID cannot be reused for another provider request');
    const beforeWrongRefund = access(ids.free, homes.free).flo.used;
    try { refund(ids.free, homes.free, receipts[2]); } catch { /* Denial may throw or return false; neither may move credit. */ }
    ok(access(ids.free, homes.free).flo.used === beforeWrongRefund, 'another actor cannot refund someone else’s reservation');
    try { refund(ids.outsider, homes.foreign, receipts[2]); } catch { /* Scope mismatch must not disclose or move credit. */ }
    ok(access(ids.free, homes.free).flo.used === beforeWrongRefund, 'foreign household refund cannot affect the original counter');
    ok(refund(ids.free, homes.free, randomUUID()) === 'f', 'unknown reservation refund has no effect');
    const replenished = reserve(ids.free, homes.free);
    ok(replenished.allowed && access(ids.free, homes.free).flo.used === 10, 'a genuine refund makes one slot available again');
    sql(`update public.user_preferences set active_household_id='${homes.foreign}'where user_id='${ids.free}'`);
    ok(refund(ids.free, homes.free, replenished.reservationId) === 't', 'an in-flight failure can refund its captured scope after a household switch');
    sql(`update public.user_preferences set active_household_id='${homes.free}'where user_id='${ids.free}'`);
    ok(access(ids.free, homes.free).flo.used === 9, 'scope-switch refund adjusts only the original household counter');
    const oldMonthReceipt = randomUUID();
    sql(`insert into private.flo_monthly_usage(household_id,request_month,request_count)values('${homes.free}',(date_trunc('month',now()at time zone'UTC')-interval '1 month')::date,2);
insert into private.flo_plan_reservations(id,user_id,household_id,request_month,status)values('${oldMonthReceipt}','${ids.free}','${homes.free}',(date_trunc('month',now()at time zone'UTC')-interval '1 month')::date,'charged');`);
    ok(refund(ids.free, homes.free, oldMonthReceipt) === 't' && access(ids.free, homes.free).flo.used === 9, 'late refund of a prior-month request cannot add current-month credit');
    ok(scalar(`select request_count from private.flo_monthly_usage where household_id='${homes.free}'and request_month=(date_trunc('month',now()at time zone'UTC')-interval '1 month')::date`) === '1', 'late refund adjusts its original stored month only');
    const zeroReceipt = randomUUID();
    sql(`update private.flo_monthly_usage set request_count=0 where household_id='${homes.free}'and request_month=(date_trunc('month',now()at time zone'UTC')-interval '1 month')::date;
insert into private.flo_plan_reservations(id,user_id,household_id,request_month,status)values('${zeroReceipt}','${ids.free}','${homes.free}',(date_trunc('month',now()at time zone'UTC')-interval '1 month')::date,'charged');`);
    refund(ids.free, homes.free, zeroReceipt);
    ok(scalar(`select request_count from private.flo_monthly_usage where household_id='${homes.free}'and request_month=(date_trunc('month',now()at time zone'UTC')-interval '1 month')::date`) === '0', 'defensive refund never makes the counter negative');
    const fullPro = json(`${service}select json_agg(public.reserve_flo_plan_request('${ids.paid}','${homes.paid}',gen_random_uuid(),null))from generate_series(1,301)`);
    ok(fullPro.filter(item => item.allowed).length === 300 && access(ids.paid, homes.paid).flo.used === 300, 'Pro monthly cap is three hundred and cannot exceed its trusted limit');
    sql(`update public.household_plans set tier='free',source='default'where household_id='${homes.paid}'`);
    ok(access(ids.paid, homes.paid).flo.limit === 10 && !reserve(ids.paid, homes.paid).allowed, 'downgrade preserves usage and cannot reset a spent monthly cap');
    sql(`insert into public.flo_daily_limits(user_id,household_id,request_day,request_count)values('${ids.founder}','${homes.founder}',(now()at time zone'UTC')::date,95)`);
    const legacyId = randomUUID();
    const legacy = reserve(ids.founder, homes.founder, legacyId);
    ok(legacy.allowed && legacy.legacyDaily && legacy.reservationId === null && legacy.allowance.period === 'day' && legacy.allowance.used === 95, 'legacy requests retain existing daily enforcement without double charging');
    ok(!reserve(ids.founder, homes.founder, legacyId).allowed, 'legacy reservation IDs cannot be used for a second provider call');

    const newCommand = randomUUID();
    rejects(creationSql(ids.free, homes.free, budgets.free, newCommand), /flo_creation_pro_required/, 'new Free cannot invoke canonical AI creation directly');
    ok(scalar(`select count(*)from public.incomes where household_id='${homes.free}'`) === '0', 'denied canonical creation writes no financial row');
    sql(`${claims(ids.free)}insert into public.incomes(id,user_id,household_id,budget_id,name,amount,frequency,start_date,next_payment_date)values('manual-free-income','${ids.free}','${homes.free}','${budgets.free}','Fictional manual income',400,'monthly','2026-11-01','2026-11-01');`);
    ok(scalar(`select count(*)from public.incomes where household_id='${homes.free}'`) === '1', 'Free manual income creation remains available independently of AI creation eligibility');

    const founderReceipt = json(creationSql(ids.founder, homes.founder, budgets.founder, randomUUID()));
    ok(founderReceipt.householdId === homes.founder, 'founder confirmed creation remains available');
    sql(`update public.household_plans set tier='pro',source='billing'where household_id='${homes.paid}'`);
    const command = randomUUID();
    const originalReceipt = json(creationSql(ids.paid, homes.paid, budgets.paid, command));
    sql(`update public.household_plans set tier='free',source='default'where household_id='${homes.paid}'`);
    assert.deepEqual(json(creationSql(ids.paid, homes.paid, budgets.paid, command)), originalReceipt); checks += 1;
    ok(scalar(`select count(*)from public.incomes where household_id='${homes.paid}'`) === '1', 'downgraded exact creation retry replays one committed receipt without duplication');
    rejects(creationSql(ids.paid, homes.paid, budgets.paid, randomUUID()), /flo_creation_pro_required/, 'downgraded paid household cannot create another AI item');
    rejects(creationSql(ids.viewer, homes.free, budgets.free, randomUUID()), /edit access/i, 'viewer cannot create even before feature authorization');
    ok(json(`${claims(ids.paid)}select public.read_flo_creation_receipt('${command}','${homes.paid}','${budgets.paid}')`).entityId === originalReceipt.entityId, 'committed receipt read remains available after downgrade');

    sql(`update public.household_plans set tier='pro',source='billing'where household_id='${homes.paid}'`);
    const scenario = scalar(`${claims(ids.paid)}with made as(insert into public.plan_simulations(household_id,name,horizon_months,changes)values('${homes.paid}','Fictional saved choice',6,'[]')returning id)select id from made`);
    sql(`update public.household_plans set tier='free',source='default'where household_id='${homes.paid}'`);
    ok(scalar(`${claims(ids.paid)}select count(*)from public.plan_simulations where id='${scenario}'`) === '1', 'downgraded member can still read existing cloud scenario data');
    ok(scalar(`${claims(ids.paid)}with attempted as(update public.plan_simulations set name='Forbidden save',version=version+1 where id='${scenario}'returning id)select count(*)from attempted`) === '0', 'downgraded member cannot modify an existing cloud scenario');
    rejects(`${claims(ids.paid)}insert into public.plan_simulations(household_id,name,horizon_months,changes)values('${homes.paid}','Forbidden new save',6,'[]')`, /row-level security|policy/i, 'downgraded member cannot create a cloud scenario');
    ok(scalar(`${claims(ids.outsider)}select count(*)from public.plan_simulations where id='${scenario}'`) === '0', 'other households cannot read retained cloud scenarios');
    sql(`insert into public.household_members(household_id,user_id,role)values('${homes.paid}','${ids.viewer}','viewer');`);
    ok(scalar(`${claims(ids.viewer)}select count(*)from public.plan_simulations where id='${scenario}'`) === '1', 'viewer retains member-only read access to existing cloud data');
    ok(scalar(`${claims(ids.viewer)}with removed as(delete from public.plan_simulations where id='${scenario}'returning id)select count(*)from removed`) === '0', 'viewer cannot delete retained household scenario data');

    ok(scalar(`${claims(ids.paid)}with removed as(delete from public.plan_simulations where id='${scenario}'returning id)select count(*)from removed`) === '1', 'downgraded editor can delete their retained cloud data');
    const conversation = randomUUID(), message = randomUUID();
    sql(`insert into public.flo_conversations values('${conversation}');insert into public.flo_messages values('${message}');`);
    const proposal = (actor, home, budget, bill, id) => `insert into public.bills(id,user_id,household_id,budget_id,name,amount,is_recurring,last_reviewed_at,created_at)values('${bill}','${actor}','${home}','${budget}','Fictional recurring bill',50,true,'2026-10-30T00:00:00Z',now());
insert into public.flo_proposals(id,household_id,conversation_id,message_id,created_by,kind,title,payload)
values('${id}','${home}','${conversation}','${message}','${actor}','recurring_bill_change','Fictional correction',jsonb_build_object('billId','${bill}','expectedAmount',50,'newAmount',60,'expectedLastReviewedAt','2026-10-30T00:00:00Z'));`;
    const freeProposal = randomUUID();
    sql(proposal(ids.free, homes.free, budgets.free, 'free-recurring', freeProposal));
    rejects(`${claims(ids.free)}select public.confirm_flo_recurring_bill_proposal('${freeProposal}')`, /flo_creation_pro_required|proposal_pro_required/, 'Free cannot bypass AI mutation eligibility through the recurring-proposal RPC');
    ok(scalar("select amount from public.bills where id='free-recurring'") === '50', 'denied recurring proposal leaves financial amount unchanged');
    const founderProposal = randomUUID();
    sql(proposal(ids.founder, homes.founder, budgets.founder, 'founder-recurring', founderProposal));
    ok(json(`${claims(ids.founder)}select public.confirm_flo_recurring_bill_proposal('${founderProposal}')`).newAmount === 60, 'founder keeps confirmed recurring-proposal access');
    const paidProposal = randomUUID();
    sql(`update public.household_plans set tier='pro',source='billing'where household_id='${homes.paid}';` + proposal(ids.paid, homes.paid, budgets.paid, 'paid-recurring', paidProposal));
    const confirmedProposal = json(`${claims(ids.paid)}select public.confirm_flo_recurring_bill_proposal('${paidProposal}')`);
    sql(`update public.household_plans set tier='free',source='default'where household_id='${homes.paid}'`);
    assert.deepEqual(json(`${claims(ids.paid)}select public.confirm_flo_recurring_bill_proposal('${paidProposal}')`), confirmedProposal); checks += 1;
    ok(scalar("select count(*)from public.flo_audit_events where parameters->>'kind'='recurring_bill_change'and household_id='" + homes.paid + "'") === '1', 'downgraded confirmed recurring-proposal retry creates no second mutation/audit');
    ok(scalar(`select private.has_review_center_entitlement('${homes.free}')`) === 't', 'new Free keeps the existing Review Center/bucket recovery entitlement');
    ok(scalar("select pg_get_functiondef('private.has_review_center_entitlement(uuid)'::regprocedure)") === reviewDefinition, 'migration leaves the proven free bucket/reversal entitlement helper unchanged');

    console.log(`PASS ${checks} actual PostgreSQL Free/Pro assertions`);
  } finally {
    docker([container, 'dropdb', '--force', '-U', 'postgres', database]);
  }
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
