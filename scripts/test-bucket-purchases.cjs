const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const container = process.env.FLOWLEDGER_BUCKET_TEST_CONTAINER || 'flowledger-bucket-purchases';
const database = `bucket_purchase_test_${process.pid}`;
const env = { ...process.env };
for (const key of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH']) delete env[key];
const base = ['--host=unix:///var/run/docker.sock', 'exec'];
function docker(args, input) { return execFileSync('docker',[...base,...args],{env,encoding:'utf8',input,maxBuffer:16*1024*1024}); }
function sql(text) { return docker(['-i',container,'psql','-X','-v','ON_ERROR_STOP=1','-U','postgres','-d',database],text); }
function scalar(text) { return docker([container,'psql','-X','-At','-v','ON_ERROR_STOP=1','-U','postgres','-d',database,'-c',text]).trim(); }
const claims = `select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false); set role authenticated;`;
function session(statement) {
 return new Promise(resolve=>{const child=spawn('docker',[...base,container,'psql','-X','-v','ON_ERROR_STOP=1','-U','postgres','-d',database,'-c',`begin;${claims}${statement};select pg_sleep(0.15);commit;`],{env});let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);child.on('close',code=>resolve({code,output}));});
}
function goal(id,target=1000) { sql(`insert into public.goals(id,user_id,household_id,budget_id,name,target_amount,current_amount,target_date,goal_type,created_at) values('${id}','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-0000-4000-8000-000000000001','Concurrent',${target},0,'2026-11-20','planned_expense','2026-10-01');`); }
function add(g,id,amount) { return `select public.add_bucket_purchase('${g}','${id}',${amount},'2026-10-26','{"amount":-${amount},"date":"2026-10-26","category":"Food","note":"Concurrent"}')`; }
(async()=>{
 docker([container,'createdb','-U','postgres',database]);
 try {
  sql(fs.readFileSync(path.join(root,'scripts/fixtures/bucket-purchase-baseline.sql'),'utf8'));
  const migration = fs.readdirSync(path.join(root,'supabase/migrations')).filter(name=>name.endsWith('_add_bucket_purchase_flow.sql'));
  assert.equal(migration.length,1);
  sql(fs.readFileSync(path.join(root,'supabase/migrations',migration[0]),'utf8'));
  const output=sql(fs.readFileSync(path.join(root,'scripts/fixtures/bucket-purchase-assertions.sql'),'utf8'));
  const count=scalar('select count(*) from public.fixture_assertions');
  console.log(`PostgreSQL role/accounting assertions: ${count} PASS`);
  goal('concurrent-id');
  let results=await Promise.all([session(add('concurrent-id','same-id',30)),session(add('concurrent-id','same-id',30))]);
  assert(results.every(r=>r.code===0),JSON.stringify(results));
  assert.equal(scalar("select current_amount from public.goals where id='concurrent-id'"),'30.00');
  assert.equal(scalar("select count(*) from public.transactions where id='same-id'"),'1');
  console.log('Concurrent identical stable-id retries: PASS');
  goal('concurrent-budget',100);
  results=await Promise.all([session(add('concurrent-budget','budget-a',80)),session(add('concurrent-budget','budget-b',80))]);
  assert.equal(results.filter(r=>r.code===0).length,1,JSON.stringify(results));
  assert.equal(scalar("select current_amount from public.goals where id='concurrent-budget'"),'80.00');
  assert.equal(scalar("select count(*) from public.transactions where id in ('budget-a','budget-b')"),'1');
  console.log('Concurrent remaining-budget conflict and orphan rollback: PASS');
  goal('concurrent-adjust',100);
  results=await Promise.all([session(add('concurrent-adjust','adjust-cash',80)),session(`select public.update_bucket_budget('concurrent-adjust','Concurrent',50,'2026-11-20','{"name":"Concurrent","target_amount":100,"target_date":"2026-11-20"}')`)]);
  assert.equal(results.filter(r=>r.code===0).length,1,JSON.stringify(results));
  assert.equal(scalar("select target_amount>=current_amount from public.goals where id='concurrent-adjust'"),'t');
  console.log('Concurrent budget shrink versus purchase: PASS');
  goal('bridge-race');
  sql(`${claims}${add('bridge-race','race-manual',50)};reset role;insert into public.transactions(id,user_id,household_id,budget_id,date,amount,category,note,source,review_status,plaid_account_id) values('race-bank','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-0000-4000-8000-000000000001','2026-10-26',-50,'Food','Race bank','plaid','needs_review','bank-checking');`);
  results=await Promise.all([session("select public.replace_bucket_purchase('race-bank','race-manual',50,50,'2026-10-26')"),session("select public.undo_bucket_purchase('race-manual','bridge-race')")]);
  assert.equal(results.filter(r=>r.code===0).length,1,JSON.stringify(results));
  assert(!results.some(r=>/deadlock detected/i.test(r.output)),JSON.stringify(results));
  assert.equal(scalar("select current_amount=(select coalesce(sum((x->>'amount')::numeric),0) from public.transaction_reconciliations r cross join lateral jsonb_array_elements(r.allocations)x where r.target_id='bridge-race') from public.goals where id='bridge-race'"),'t');
  console.log('Concurrent posted handoff versus manual removal: PASS');
  console.log(`Bucket purchase SQL verification passed: ${count} assertions and 4 real concurrent-session scenarios.`);
 } finally { docker([container,'dropdb','-U','postgres','--force',database]); }
})().catch(error=>{console.error(error);process.exitCode=1;});
