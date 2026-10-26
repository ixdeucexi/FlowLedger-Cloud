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
  sql(fs.readFileSync(path.join(root,'scripts/fixtures/deep-financial-baseline.sql'),'utf8'));
  sql(fs.readFileSync(path.join(root,'scripts/fixtures/deep-debt-baseline.sql'),'utf8'));
  for (const suffix of ['_add_bucket_purchase_flow.sql','_atomic_transfers_and_allocated_edit_guards.sql']) {
    const names=fs.readdirSync(path.join(root,'supabase/migrations')).filter(name=>name.endsWith(suffix));assert.equal(names.length,1);
    sql(fs.readFileSync(path.join(root,'supabase/migrations',names[0]),'utf8'));
  }
  sql(fs.readFileSync(path.join(root,'scripts/fixtures/deep-financial-assertions.sql'),'utf8'));
  console.log(`Deep financial PostgreSQL assertions: ${scalar('select count(*)from public.deep_assertions')} PASS`);
  sql("select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false)");
  let results=await Promise.all([session("select public.deep_transfer('race','race-from','race-to',50)"),session("select public.deep_transfer('race','race-from','race-to',50)")]);
  assert(results.every(r=>r.code===0),JSON.stringify(results));assert.equal(scalar("select count(*)=2 and sum(amount)=0 from public.transactions where transfer_group_id='race'"),'t');
  const expected=scalar("select public.deep_pair('race')").replace(/'/g,"''");
  results=await Promise.all([session(`select public.deep_transfer('race','race-from','race-to',60,'${expected}')`),session(`select public.deep_transfer('race','race-from','race-to',70,'${expected}')`)]);
  assert.equal(results.filter(r=>r.code===0).length,1,JSON.stringify(results));assert.equal(scalar("select sum(amount)=0 from public.transactions where transfer_group_id='race'"),'t');
  console.log('Concurrent create retries and competing CAS edits: PASS');
  const latest=scalar("select public.deep_pair('race')").replace(/'/g,"''");
  results=await Promise.all([session(`select public.deep_transfer('race','race-from','race-to',80,'${latest}')`),session(`select public.deep_transfer('race','race-from','race-to',50,'${latest}','delete')`)]);
  assert.equal(results.filter(r=>r.code===0).length,1,JSON.stringify(results));
  assert.equal(scalar("select sum(amount)=0 and (bool_and(deleted_at is null)or bool_and(deleted_at is not null))from public.transactions where transfer_group_id='race'"),'t');
  console.log('Concurrent edit versus pair deletion: PASS');
 } finally { docker([container,'dropdb','-U','postgres','--force',database]); }
})().catch(error=>{console.error(error);process.exitCode=1;});
