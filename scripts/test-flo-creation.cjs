// Synthetic PostgreSQL integration only. Never connects to a hosted database.
const {execFileSync,spawn}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const container=process.env.FLOWLEDGER_BUCKET_TEST_CONTAINER||'flowledger-bucket-purchases';
const database=`flo_creation_test_${process.pid}`;
const env={...process.env};
for(const key of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'])delete env[key];
const base=['--host=unix:///var/run/docker.sock','exec'];
function docker(args,input){return execFileSync('docker',[...base,...args],{env,encoding:'utf8',input,maxBuffer:16*1024*1024,stdio:['pipe','pipe','pipe']});}
function sql(text){return docker(['-i',container,'psql','-X','-v','ON_ERROR_STOP=1','-U','postgres','-d',database],text);}
function scalar(text){return docker([container,'psql','-X','-At','-v','ON_ERROR_STOP=1','-U','postgres','-d',database,'-c',text]).trim().split('\n').at(-1);}
const actor='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const hh='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',foreign='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const budget='aaaaaaaa-0000-4000-8000-000000000001',foreignBudget='bbbbbbbb-0000-4000-8000-000000000001';
const claims=(id=actor)=>`set "request.jwt.claim.sub"='${id}';set role authenticated;`;
let sequence=0,checks=0;
const command=()=>`00000000-0000-4000-8000-${String(++sequence).padStart(12,'0')}`;
const literal=value=>`'${JSON.stringify(value).replace(/'/g,"''")}'::jsonb`;
function call(id,kind,payload,household=hh,expectedBudget=household===foreign?foreignBudget:budget){return `select public.create_flo_entity('${id}','${kind}',${literal(payload)},'${household}','${expectedBudget}')`;}
function invoke(id,kind,payload,household=hh,who=actor){return JSON.parse(scalar(`${claims(who)}${call(id,kind,payload,household)}`));}
function ok(condition,message){assert(condition,message);checks++;}
function fails(statement,pattern){let error;try{sql(statement);}catch(e){error=String(e.stderr||e.message);}assert(error,'expected SQL rejection');if(pattern)assert.match(error,pattern);checks++;}
function session(statement){return new Promise(resolve=>{const child=spawn('docker',[...base,container,'psql','-X','-At','-v','ON_ERROR_STOP=1','-U','postgres','-d',database,'-c',`begin;${claims()}${statement};select pg_sleep(0.1);commit;`],{env});let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);child.on('close',code=>resolve({code,output}));});}
const payloads={
 create_bill:{name:'Water',amount:75.25,frequency:'monthly',first_date:'2026-10-31'},
 create_debt:{name:'Card',balance:1500,minimum_payment:90,apr:12.3456,frequency:'monthly',first_date:'2026-10-31'},
 create_income:{name:'Salary',amount:2100,frequency:'monthly',first_date:'2027-02-28',monthly_last_day:true},
 create_manual_transaction:{amount:50,direction:'expense',date:'2026-10-28',category:'Food',note:'Dinner',account_id:'checking'},
 create_bucket:{name:'Groceries',target_amount:400,target_date:'2026-11-30'},
 create_savings_goal:{name:'Rainy day',target_amount:1000,target_date:'2027-03-31',current_amount:125},
};
// Optional bridge from successful *real provider* extraction receipts into this
// isolated DB. No extraction is rerun, and no monetary/name/date/cadence field
// is repaired here. Only opaque household/budget/account fixture IDs are mapped.
function modelBridge(receiptsPath){
 const source=fs.readFileSync(receiptsPath),rows=JSON.parse(source.toString('utf8'));
 assert(Array.isArray(rows),'model receipts must be an array');
 const selected=['focused-bill-iso','focused-debt-iso','focused-income-iso','focused-expense-iso','focused-bucket-iso','focused-savings-iso','focused-one-time-iso'];
 const report=[];let bridgeChecks=0;
 const check=(condition,message)=>{assert(condition,message);bridgeChecks++;};
 for(const caseId of selected){
  const record=rows.find(row=>row.data?.caseId===caseId);
  assert(record&&record.status===200&&record.checks?.includes('pass'),`missing successful real-model case ${caseId}`);
  const turns=record.data.turns.filter(turn=>turn.creation?.status==='ready');
  assert.equal(turns.length,1,`expected one READY turn for ${caseId}`);
  const turn=turns[0],creation=turn.creation;
  assert(Object.hasOwn(payloads,creation.kind),`unsupported creation kind in ${caseId}`);
  assert(turn.providerEvidence?.creationExtractionsSucceeded>0,`no real provider extraction proof for ${caseId}`);
  const original=structuredClone(creation.payload),payload=structuredClone(original),id=creation.commandId;
  assert.match(id,/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  const mappings={household:{from:creation.householdId,to:hh},budget:{to:budget}};
  if(creation.kind==='create_manual_transaction'){
   assert.equal(payload.account_id,'manual-checking','only the known fictional account fixture may be remapped');
   mappings.account={from:payload.account_id,to:'checking'};payload.account_id='checking';
  }
  const comparableOriginal={...original},comparablePayload={...payload};delete comparableOriginal.account_id;delete comparablePayload.account_id;
  assert.deepEqual(comparablePayload,comparableOriginal,'financial/name/date/cadence fields must remain provider-derived');
  const countBefore=Number(entityCount()),receipt=invoke(id,creation.kind,payload);
  const type=creation.kind==='create_manual_transaction'?'transaction':creation.kind==='create_income'?'income':creation.kind==='create_bill'||creation.kind==='create_debt'?'bill':'goal';
  const table={bill:'bills',income:'incomes',transaction:'transactions',goal:'goals'}[type];
  check(receipt.kind===creation.kind&&receipt.commandId===id&&receipt.householdId===hh&&receipt.entityType===type,`${caseId}: receipt contract`);
  const route=type==='bill'?'/(tabs)/bills':type==='income'?'/(tabs)/more?section=money':type==='transaction'?'/(tabs)/transactions':creation.kind==='create_bucket'?'/(tabs)/more?section=buckets':'/(tabs)/more?section=goals';
  check(receipt.route===route&&Number.isFinite(Date.parse(receipt.createdAt)),`${caseId}: receipt route/time`);
  check(receipt.title===(payload.name??payload.note),`${caseId}: provider title`);
  check(Number(entityCount())===countBefore+1,`${caseId}: exactly one real entity`);
  const row=JSON.parse(scalar(`select to_jsonb(t)from public.${table} t where id='${receipt.entityId}'`));
  check(row.user_id===actor&&row.household_id===hh&&row.budget_id===budget,`${caseId}: isolated actor/household/budget`);
  if(type==='bill'){
   const debt=creation.kind==='create_debt';
   check(row.name===payload.name&&row.amount===(debt?payload.minimum_payment:payload.amount),`${caseId}: exact provider name/payment`);
   check(row.frequency===payload.frequency&&row.start_date===payload.first_date&&row.next_payment_date===payload.first_date,`${caseId}: exact provider cadence/first date`);
   check(row.is_debt===debt&&row.is_recurring===(payload.is_recurring??true),`${caseId}: debt/one-off classification`);
   check(row.balance===(payload.balance??0)&&row.interest_rate===(payload.apr??0),`${caseId}: exact balance/APR`);
   check(row.category===(debt?'Debt':payload.category??'Other'),`${caseId}: category`);
  }else if(type==='income'){
   check(row.name===payload.name&&row.amount===payload.amount,`${caseId}: exact income`);
   check(row.frequency===payload.frequency&&row.start_date===payload.first_date&&row.next_payment_date===payload.first_date,`${caseId}: exact income dates/cadence`);
  }else if(type==='transaction'){
   check(row.amount===payload.amount*(payload.direction==='expense'?-1:1),`${caseId}: exact signed amount`);
   check(row.date===payload.date&&row.category===payload.category&&row.note===payload.note,`${caseId}: exact transaction details`);
   check(row.account_id==='checking'&&row.source==='manual'&&row.review_status==='legacy_reviewed',`${caseId}: account map/manual review state`);
  }else{
   check(row.name===payload.name&&row.target_amount===payload.target_amount&&row.target_date===payload.target_date,`${caseId}: exact goal details`);
   check(row.goal_type===(creation.kind==='create_bucket'?'planned_expense':'savings')&&row.current_amount===(payload.current_amount??0),`${caseId}: goal classification/progress`);
  }
  assert.deepEqual(invoke(id,creation.kind,payload),receipt);bridgeChecks++;
  check(Number(entityCount())===countBefore+1,`${caseId}: exact retry does not duplicate`);
  check(scalar(`select count(*)from private.flo_creation_receipts where actor_id='${actor}'and household_id='${hh}'and command_id='${id}'`)==='1',`${caseId}: immutable command receipt`);
  report.push({caseId,kind:creation.kind,originalCommandId:id,providerExtractionsSucceeded:turn.providerEvidence.creationExtractionsSucceeded,originalPayload:original,fixtureMappings:mappings,entityType:type,fieldVerification:'PASS',exactRetry:'PASS'});
 }
 assert.equal(new Set(report.map(row=>row.kind)).size,6,'bridge must cover all six kinds');
 const evidence={sourceSha256:require('node:crypto').createHash('sha256').update(source).digest('hex'),bridgeChecks,cases:report};
 const output='/tmp/flo-creation-model-postgres-bridge.json';fs.writeFileSync(output,JSON.stringify(evidence,null,2)+'\n');
 console.log(`Real-model READY → PostgreSQL bridge: ${report.length} creates across six kinds + ${report.length} exact retries, ${bridgeChecks} assertions PASS; ${output}`);
}
function entityCount(){return scalar('select (select count(*)from public.bills)+(select count(*)from public.incomes)+(select count(*)from public.transactions)+(select count(*)from public.goals)');}
(async()=>{
 docker([container,'createdb','-U','postgres',database]);
 try{
  const schema=JSON.parse(fs.readFileSync(path.join(root,'scripts/fixtures/flo-creation-schema.json'),'utf8'));
  const tables=[...new Set(schema.columns.map(c=>c.table_name))];
  let setup=`create schema auth;create schema private;
do $$begin create role authenticated;exception when duplicate_object then null;end$$;
do $$begin create role anon;exception when duplicate_object then null;end$$;
do $$begin create role service_role;exception when duplicate_object then null;end$$;
grant usage on schema public,private,auth to authenticated;
grant usage on schema public,auth to anon;
create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create table auth.users(id uuid primary key);
create table public.households(id uuid primary key,created_by uuid,is_personal boolean);
`;
  for(const table of tables){
   const columns=schema.columns.filter(c=>c.table_name===table).map(c=>`"${c.column_name}" ${c.data_type}${c.column_default===null?'':` default ${c.column_default}`}${c.is_nullable==='NO'?' not null':''}`);
   const constraints=schema.constraintsAndTriggers.filter(c=>c.kind==='constraint'&&c.relation===table).map(c=>`constraint "${c.name}" ${c.definition}`);
   setup+=`create table public."${table}"(${[...columns,...constraints].join(',')});\n`;
  }
  setup+=`insert into auth.users values('${actor}'),('${other}');
insert into public.households values('${hh}','${actor}',true),('${foreign}','${other}',true);
insert into public.household_members(household_id,user_id,role)values('${hh}','${actor}','owner'),('${foreign}','${other}','owner');
insert into public.user_preferences(user_id,active_household_id)values('${actor}','${hh}'),('${other}','${foreign}');
insert into public.budgets(id,household_id)values('${budget}','${hh}'),('${foreignBudget}','${foreign}');
insert into public.accounts(id,user_id,household_id,budget_id,name,account_type)values
('checking','${actor}','${hh}','${budget}','Checking','checking'),
('foreign','${other}','${foreign}','${foreignBudget}','Other checking','checking'),
('wrong-budget','${actor}','${hh}','${foreignBudget}','Wrong budget','cash'),
('credit','${actor}','${hh}','${budget}','Credit','credit_card');
`;
  sql(setup);
  // Install actual insert guards/default-budget triggers from the metadata-only
  // capture. Unrelated UPDATE/DELETE and activity logging are outside this RPC
  // test; their tables/services are not replaced with pretend implementations.
  sql(fs.readFileSync(path.join(root,'scripts/fixtures/flo-creation-insert-triggers.sql'),'utf8'));
  const insertTriggers=schema.constraintsAndTriggers.filter(c=>c.kind==='trigger'&&c.definition.includes('INSERT')&&!c.name.includes('audit'));
  for(const trigger of insertTriggers)sql(`${trigger.definition};`);
  const migrations=fs.readdirSync(path.join(root,'supabase/migrations')).filter(n=>n.endsWith('_create_flo_entity.sql'));
  assert.equal(migrations.length,1);sql(fs.readFileSync(path.join(root,'supabase/migrations',migrations[0]),'utf8'));
  const receipts={};
  for(const[kind,payload]of Object.entries(payloads)){
   const id=command(),receipt=invoke(id,kind,payload);receipts[kind]={id,receipt};
   ok(receipt.commandId===id&&receipt.householdId===hh&&receipt.kind===kind,'receipt scope');
   ok(/^[0-9a-f-]{36}$/.test(receipt.entityId)&&Number.isFinite(Date.parse(receipt.createdAt)),'receipt identity/date');
   const entityType=kind==='create_bill'||kind==='create_debt'?'bill':kind==='create_income'?'income':kind==='create_manual_transaction'?'transaction':'goal';
   const route=entityType==='bill'?'/(tabs)/bills':entityType==='income'?'/(tabs)/more?section=money':entityType==='transaction'?'/(tabs)/transactions':kind==='create_bucket'?'/(tabs)/more?section=buckets':'/(tabs)/more?section=goals';
   ok(receipt.entityType===entityType&&receipt.route===route,'receipt entity/route');
   const table={bill:'bills',income:'incomes',transaction:'transactions',goal:'goals'}[entityType];
   ok(scalar(`select user_id='${actor}'and household_id='${hh}'and budget_id='${budget}'from public.${table} where id='${receipt.entityId}'`)==='t','actor and active household/default budget derived on server');
   const before=entityCount();assert.deepEqual(invoke(id,kind,payload),receipt);ok(entityCount()===before,'exact retry does not create again');
   fails(`${claims()}${call(id,kind,{...payload,...('name'in payload?{name:'Changed'}:{note:'Changed'})})}`,/different details/);
   fails(`${claims()}${call(id,kind==='create_bucket'?'create_savings_goal':'create_bucket',payloads.create_bucket)}`,/different details/);
  }
  const read=(id,household=hh,who=actor,expectedBudget=household===foreign?foreignBudget:budget)=>scalar(`${claims(who)}select coalesce(public.read_flo_creation_receipt('${id}','${household}','${expectedBudget}')::text,'null')`);
  assert.deepEqual(JSON.parse(read(receipts.create_bucket.id)),receipts.create_bucket.receipt);checks++;
  ok(read(command())==='null','missing receipt reads null without creating');
  fails(`${claims()}select public.read_flo_creation_receipt('${receipts.create_bucket.id}','${foreign}','${foreignBudget}')`,/household again/);
  fails(`set role anon;select public.read_flo_creation_receipt('${receipts.create_bucket.id}','${hh}','${budget}')`,/permission denied/);
  fails(`set role authenticated;select public.read_flo_creation_receipt('${receipts.create_bucket.id}','${hh}','${budget}')`,/Sign in/);
  const once=invoke(command(),'create_bill',{...payloads.create_bill,is_recurring:false});
  ok(scalar(`select not is_recurring and next_payment_date='2026-10-31' from public.bills where id='${once.entityId}'`)==='t','explicit one-time bill');
  // JSON object ordering and numeric trailing zeros are canonical on replay.
  assert.deepEqual(JSON.parse(scalar(`${claims()}select public.create_flo_entity('${receipts.create_bill.id}','create_bill','{"first_date":"2026-10-31","frequency":"monthly","amount":75.2500,"name":"Water"}','${hh}','${budget}')`)),receipts.create_bill.receipt);checks++;
  ok(scalar(`select amount=75.25 and category='Other' and priority=99 and not is_debt and not include_in_snowball and smart_priority='must' and due_day=31 and start_date='2026-10-31' and next_payment_date='2026-10-31' from public.bills where id='${receipts.create_bill.receipt.entityId}'`)==='t','bill defaults');
  ok(scalar(`select amount=90 and balance=1500 and interest_rate=12.3456 and is_debt and include_in_snowball and priority=0 from public.bills where id='${receipts.create_debt.receipt.entityId}'`)==='t','debt defaults');
  ok(scalar(`select start_date='2027-02-28' and next_payment_date='2027-03-31' and amount_history='[]'::jsonb from public.incomes where id='${receipts.create_income.receipt.entityId}'`)==='t','real first payday and valid day31 anchor');
  ok(scalar(`select amount=-50 and source='manual' and review_status='legacy_reviewed' and linked_bill_id is null and linked_plan_id is null and debt_applied_amount=0 and account_id='checking' from public.transactions where id='${receipts.create_manual_transaction.receipt.entityId}'`)==='t','manual audit/link defaults');
  ok(scalar(`select current_amount=0 and goal_type='planned_expense' from public.goals where id='${receipts.create_bucket.receipt.entityId}'`)==='t','bucket zero spending');
  ok(scalar(`select current_amount=125 and goal_type='savings' from public.goals where id='${receipts.create_savings_goal.receipt.entityId}'`)==='t','savings explicit progress');
  // Lost response after commit, even after the financial entity was edited or
  // deleted, must return its original receipt and never overwrite/recreate it.
  const bill=receipts.create_bill;
  sql(`update public.bills set name='Owner edited',amount=999 where id='${bill.receipt.entityId}'`);
  assert.deepEqual(invoke(bill.id,'create_bill',payloads.create_bill),bill.receipt);
  ok(scalar(`select name='Owner edited'and amount=999 from public.bills where id='${bill.receipt.entityId}'`)==='t','edited row retained');
  sql(`delete from public.bills where id='${bill.receipt.entityId}'`);
  const beforeDeleted=entityCount();assert.deepEqual(invoke(bill.id,'create_bill',payloads.create_bill),bill.receipt);ok(entityCount()===beforeDeleted,'deleted entity not resurrected');
  const race=command(),beforeRace=entityCount();
  const results=await Promise.all([session(call(race,'create_bucket',payloads.create_bucket)),session(call(race,'create_bucket',payloads.create_bucket))]);
  ok(results.every(r=>r.code===0),JSON.stringify(results));ok(Number(entityCount())===Number(beforeRace)+1,'concurrent retry creates one entity');
  ok(scalar(`select count(*)from private.flo_creation_receipts where command_id='${race}'`)==='1','one concurrent receipt');
  const altered=command(),mixed=await Promise.all([session(call(altered,'create_bucket',payloads.create_bucket)),session(call(altered,'create_bucket',{...payloads.create_bucket,target_amount:500}))]);
  ok(mixed.filter(r=>r.code===0).length===1,'concurrent altered payload rejects one');
  for(const role of ['manager','editor']){sql(`update public.household_members set role='${role}'where household_id='${hh}'and user_id='${actor}'`);invoke(command(),'create_bucket',payloads.create_bucket);checks++;}
  sql(`update public.household_members set role='viewer'where household_id='${hh}'and user_id='${actor}'`);
  assert.deepEqual(JSON.parse(read(receipts.create_bucket.id)),receipts.create_bucket.receipt);checks++;
  fails(`${claims()}${call(command(),'create_bucket',payloads.create_bucket)}`,/edit access/);
  fails(`${claims()}${call(receipts.create_bucket.id,'create_bucket',payloads.create_bucket)}`,/edit access/);
  sql(`delete from public.household_members where household_id='${hh}'and user_id='${actor}'`);
  fails(`${claims()}${call(command(),'create_bucket',payloads.create_bucket)}`,/edit access/);
  fails(`${claims()}select public.read_flo_creation_receipt('${receipts.create_bucket.id}','${hh}','${budget}')`,/household again/);
  sql(`insert into public.household_members(household_id,user_id,role)values('${hh}','${actor}','owner')`);
  fails(`${claims()}${call(command(),'create_bucket',payloads.create_bucket,foreign)}`,/active household changed/);
  sql(`update public.user_preferences set active_household_id='${foreign}'where user_id='${actor}'`);
  fails(`${claims()}${call(command(),'create_bucket',payloads.create_bucket)}`,/active household changed/);
  fails(`${claims()}${call(command(),'create_bucket',payloads.create_bucket,foreign)}`,/edit access/);
  sql(`update public.user_preferences set active_household_id='${hh}'where user_id='${actor}'`);
  const foreignReceipt=invoke(receipts.create_bucket.id,'create_bucket',payloads.create_bucket,foreign,other);
  ok(foreignReceipt.entityId!==receipts.create_bucket.receipt.entityId,'commands are scoped per actor and household');
  fails(`set role anon;${call(command(),'create_bucket',payloads.create_bucket)}`,/permission denied/);
  fails(`set role authenticated;${call(command(),'create_bucket',payloads.create_bucket)}`,/Sign in/);
  fails(`${claims()}select *from private.flo_creation_receipts`,/permission denied/);
  fails(`${claims()}update private.flo_creation_receipts set kind='create_bill'`,/permission denied/);
  fails(`${claims()}delete from private.flo_creation_receipts`,/permission denied/);
  fails(`update private.flo_creation_receipts set kind='create_bill'`,/immutable/);
  // No implicit account fallback or acceptance of foreign/inactive/card accounts.
  for(const account of ['missing','foreign','wrong-budget','credit'])fails(`${claims()}${call(command(),'create_manual_transaction',{...payloads.create_manual_transaction,account_id:account})}`,/active account/);
  sql("update public.accounts set is_active=false where id='checking'");
  fails(`${claims()}${call(command(),'create_manual_transaction',payloads.create_manual_transaction)}`,/active account/);
  assert.deepEqual(invoke(receipts.create_manual_transaction.id,'create_manual_transaction',payloads.create_manual_transaction),receipts.create_manual_transaction.receipt);checks++;
  sql("update public.accounts set is_active=true where id='checking'");
  sql(`update public.budgets set is_default=false where id='${budget}'`);
  fails(`${claims()}${call(command(),'create_bucket',payloads.create_bucket)}`,/one default budget/);
  sql(`update public.budgets set is_default=true where id='${budget}';insert into public.budgets(id,household_id)values('aaaaaaaa-0000-4000-8000-000000000002','${hh}')`);
  fails(`${claims()}${call(command(),'create_bucket',payloads.create_bucket)}`,/one default budget/);
  sql("delete from public.budgets where id='aaaaaaaa-0000-4000-8000-000000000002'");
  // Preview in A, then another session switches the household default to B.
  // A stale preview must neither write to B nor recover an A receipt as B.
  const switchedBudget='aaaaaaaa-0000-4000-8000-000000000003',beforeSwitch=entityCount();
  sql(`update public.budgets set is_default=false where id='${budget}';insert into public.budgets(id,household_id)values('${switchedBudget}','${hh}')`);
  fails(`${claims()}${call(command(),'create_bucket',payloads.create_bucket)}`,/default budget changed/);
  fails(`${claims()}${call(receipts.create_bucket.id,'create_bucket',payloads.create_bucket)}`,/default budget changed/);
  fails(`${claims()}${call(receipts.create_bucket.id,'create_bucket',payloads.create_bucket,hh,switchedBudget)}`,/different preview budget/);
  fails(`${claims()}select public.read_flo_creation_receipt('${receipts.create_bucket.id}','${hh}','${budget}')`,/default budget changed/);
  ok(read(receipts.create_bucket.id,hh,actor,switchedBudget)==='null','reader never returns another budget receipt');
  ok(entityCount()===beforeSwitch,'stale preview and altered-budget replays create no entity');
  fails(`${claims()}${call(command(),'create_manual_transaction',payloads.create_manual_transaction,hh,switchedBudget)}`,/active account/);
  const inNewBudget=JSON.parse(scalar(`${claims()}${call(command(),'create_bucket',payloads.create_bucket,hh,switchedBudget)}`));
  ok(scalar(`select budget_id='${switchedBudget}'from public.goals where id='${inNewBudget.entityId}'`)==='t','fresh preview writes to agreed current budget');
  sql(`update public.budgets set is_default=false where id='${switchedBudget}';update public.budgets set is_default=true where id='${budget}'`);
  assert.deepEqual(invoke(receipts.create_bucket.id,'create_bucket',payloads.create_bucket),receipts.create_bucket.receipt);checks++;
  ok(scalar(`select budget_id='${budget}'from private.flo_creation_receipts where command_id='${receipts.create_bucket.id}'and actor_id='${actor}'`)==='t','immutable command retains preview budget');
  fails(`${claims()}select public.create_flo_entity('${command()}','create_bucket',${literal(payloads.create_bucket)},'${hh}',null)`,/preview budget are required/);
  ok(scalar("select count(*)from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'and ((p.proname='create_flo_entity'and p.pronargs=4)or(p.proname='read_flo_creation_receipt'and p.pronargs=2))")==='0','no unscoped legacy overload');
  const inflow=invoke(command(),'create_manual_transaction',{...payloads.create_manual_transaction,direction:'inflow'});
  ok(scalar(`select amount=50 from public.transactions where id='${inflow.entityId}'`)==='t','inflow signed once');
  const invalid=[
   ['create_bill',{...payloads.create_bill,user_id:other}],['create_bill',{...payloads.create_bill,amount:'12'}],
   ['create_bill',{...payloads.create_bill,amount:0}],['create_bill',{...payloads.create_bill,amount:-1}],
   ['create_bill',{...payloads.create_bill,amount:1.001}],['create_bill',{...payloads.create_bill,amount:1e9}],
   ['create_bill',{...payloads.create_bill,frequency:'daily'}],['create_bill',{...payloads.create_bill,first_date:'2027-02-29'}],
   ['create_bill',{...payloads.create_bill,first_date:'2026-04-31'}],['create_bill',{...payloads.create_bill,first_date:'0000-01-01'}],
   ['create_bill',{...payloads.create_bill,first_date:'10/28/2026'}],['create_bill',{...payloads.create_bill,name:' '}],
   ['create_bill',{...payloads.create_bill,category:null}],['create_bill',{...payloads.create_bill,first_date:null}],
   ['create_debt',{...payloads.create_debt,apr:100.001}],['create_debt',{...payloads.create_debt,apr:0.00001}],
   ['create_income',{...payloads.create_income,frequency:'quarterly'}],['create_income',{...payloads.create_income,frequency:'weekly'}],
   ['create_income',{...payloads.create_income,monthly_last_day:'true'}],
   ['create_bill',{...payloads.create_bill,is_recurring:'false'}],['create_debt',{...payloads.create_debt,is_recurring:false}],
   ['create_manual_transaction',{...payloads.create_manual_transaction,direction:'transfer'}],
   ['create_manual_transaction',{...payloads.create_manual_transaction,linked_bill_id:'anything'}],
   ['create_bucket',{...payloads.create_bucket,current_amount:20}],
   ['create_savings_goal',{...payloads.create_savings_goal,current_amount:-1}],
   ['create_bill',{}],['create_bill',[]],['create_bill',null],['unsupported',{}],
  ];
  for(const[kind,payload]of invalid){const before=entityCount();fails(`${claims()}${call(command(),kind,payload)}`);ok(before===entityCount(),'invalid request atomic');}
  for(const frequency of ['weekly','biweekly','quarterly']){
   const receipt=invoke(command(),'create_bill',{...payloads.create_bill,frequency,first_date:'2026-10-28'});
   ok(scalar(`select frequency='${frequency}'and next_payment_date='2026-10-28'${frequency==='quarterly'?'':' and day_of_week=3'} from public.bills where id='${receipt.entityId}'`)==='t','bill recurrence anchor');
  }
  for(const [date,anchor]of [['2026-04-30','2026-05-31'],['2028-02-29','2028-03-31'],['2026-12-31','2026-12-31']]){
   const receipt=invoke(command(),'create_income',{...payloads.create_income,first_date:date});
   ok(scalar(`select start_date='${date}'and next_payment_date='${anchor}'from public.incomes where id='${receipt.entityId}'`)==='t','monthly lastday boundary');
  }
  const income=invoke(command(),'create_income',{...payloads.create_income,frequency:'biweekly',monthly_last_day:false});
  ok(scalar(`select next_payment_date=start_date from public.incomes where id='${income.entityId}'`)==='t','biweekly real startdate');
  // Force a receipt failure after insertion, proving the entity cannot survive
  // a failed commit. Retrying that same command is safe after failure removal.
  sql(`create function private.test_abort_receipt()returns trigger language plpgsql as $$begin if new.receipt->>'title'='Rollback test'then raise exception 'injected receipt fault';end if;return new;end$$;create trigger test_abort_receipt before insert on private.flo_creation_receipts for each row execute function private.test_abort_receipt();`);
  const rollbackId=command(),rollbackPayload={...payloads.create_bucket,name:'Rollback test'},beforeRollback=entityCount();
  fails(`${claims()}${call(rollbackId,'create_bucket',rollbackPayload)}`,/injected receipt fault/);
  ok(entityCount()===beforeRollback&&scalar(`select count(*)from private.flo_creation_receipts where command_id='${rollbackId}'`)==='0','entity and receipt rollback together');
  sql('drop trigger test_abort_receipt on private.flo_creation_receipts;drop function private.test_abort_receipt()');
  invoke(rollbackId,'create_bucket',rollbackPayload);checks++;
  const modelFlag=process.argv.indexOf('--model-receipts');
  if(modelFlag!==-1){assert(process.argv[modelFlag+1],'--model-receipts requires a file path');modelBridge(path.resolve(process.argv[modelFlag+1]));}
  // Receipt lifecycle cleanup is not tied to deletable chat/history rows.
  sql(`delete from auth.users where id='${other}'`);
  ok(scalar(`select count(*)from private.flo_creation_receipts where actor_id='${other}'`)==='0','account deletion erases private receipts');
  sql(`delete from public.households where id='${hh}'`);
  ok(scalar(`select count(*)from private.flo_creation_receipts where household_id='${hh}'`)==='0','household deletion erases private receipts');
  console.log(`Flo creation PostgreSQL: ${checks} assertions PASS (six kinds, retries, concurrency, authorization, scope, validation, rollback, lifecycle)`);
 }finally{docker([container,'dropdb','-U','postgres','--force',database]);}
})().catch(error=>{console.error(error.stderr?.toString()||error);process.exitCode=1;});
