"""Real concurrent PostgreSQL sessions inside a network-isolated fake database."""
import json,os,pathlib,subprocess,sys,time
container,output=sys.argv[1:];logs=pathlib.Path(output)
env={k:v for k,v in os.environ.items() if k not in {'DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'}}
command=['docker','--host=unix:///var/run/docker.sock','exec','-i',container,'psql','-U','postgres','-v','ON_ERROR_STOP=1','-d','postgres']
auth="set role authenticated; select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);\n"
def query(sql,label):
 r=subprocess.run(command,input=sql,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,env=env,timeout=30);(logs/f'{label}.log').write_text(r.stdout)
 if r.returncode:raise RuntimeError(f'{label}: {r.stdout}')
def parallel(label,first,second,verify):
 fa,fb=logs/f'{label}-a.log',logs/f'{label}-b.log'
 held='begin;\n'+first+'\n\\echo FIRST_SESSION_READY\nselect pg_sleep(0.8);\ncommit;\n'
 with fa.open('w') as al,fb.open('w') as bl:
  a=subprocess.Popen(command,stdin=subprocess.PIPE,stdout=al,stderr=subprocess.STDOUT,text=True,env=env);a.stdin.write(held);a.stdin.close();deadline=time.monotonic()+10
  while 'FIRST_SESSION_READY' not in fa.read_text():
   if a.poll() is not None or time.monotonic()>deadline:raise RuntimeError(f'{label}: {fa.read_text()}')
   time.sleep(.01)
  b=subprocess.Popen(command,stdin=subprocess.PIPE,stdout=bl,stderr=subprocess.STDOUT,text=True,env=env);b.stdin.write(second);b.stdin.close()
  if a.wait(timeout=30) or b.wait(timeout=30):raise RuntimeError(f'{label}: {fa.read_text()}\n{fb.read_text()}')
 query(verify,label+'-verify');return {'case':label,'status':'PASS'}
proof=[]
proof.append(parallel('same-conversion-idempotent',auth+"select test.convert('race-same');",auth+"select test.assert((test.convert('race-same',(select expected from test.conversion_baselines where id='race-same'))->>'retry')::boolean,'second same conversion retries');","select test.assert((select count(*)=1 and max(revision)=1 from planned_account_transfers where source_bill_id='race-same'),'one plan in simultaneous conversion');"))
proof.append(parallel('source-edit-CAS',"update bills set amount=51 where id='race-cas';",auth+"select test.must_fail($q$select test.convert('race-cas',(select expected from test.conversion_baselines where id='race-cas'))$q$,'busy source edit fails cleanly','activity is being updated');","select test.assert((select amount=51 and end_date is null from bills where id='race-cas') and not exists(select 1 from planned_account_transfers where source_bill_id='race-cas'),'concurrent source edit never partially converts');"))
proof.append(parallel('evidence-writer-NOWAIT',"update monthly_overrides set paid_amount=0 where bill_id='race-evidence';",auth+"select test.must_fail($q$select test.convert('race-evidence')$q$,'busy evidence snapshot fails cleanly','activity is being updated');","select test.assert((select end_date is null from bills where id='race-evidence') and not exists(select 1 from planned_account_transfers where source_bill_id='race-evidence'),'no conversion while evidence changes');"))
proof.append(parallel('revocation-during-advisory-wait',"select pg_advisory_xact_lock(hashtextextended('flowledger:planned-transfers:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',0));delete from household_members where household_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and user_id='22222222-2222-4222-8222-222222222222';",auth+"select test.must_fail($q$select test.convert('race-revoke')$q$,'membership rechecked after lock wait','Household access required');","select test.assert((select end_date is null from bills where id='race-revoke') and not exists(select 1 from planned_account_transfers where source_bill_id='race-revoke'),'revoked waiting conversion writes nothing');insert into household_members(household_id,user_id,role) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','22222222-2222-4222-8222-222222222222','editor');"))
proof.append(parallel('ordinary-edit-after-conversion',auth+"select test.convert('race-after');",auth+"select test.must_fail($q$update bills set end_date=null where id='race-after'$q$,'waiting old client cannot reactivate','Edit the transfer instead');","select test.assert((select end_date=(test.cutover()-1)::text from bills where id='race-after'),'cutoff remains fixed after waiting old edit');"))
proof.append(parallel('future-exception-after-conversion',auth+"select test.convert('race-after-exception');",auth+"select test.must_fail($q$insert into monthly_overrides(id,user_id,household_id,budget_id,bill_id,month,year,custom_due_day) values('race-resurrection',auth.uid(),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','race-after-exception',extract(month from test.cutover())::int-1,extract(year from test.cutover())::int,21)$q$,'waiting future exception sees committed source link','Edit future dates');", "select test.assert(not exists(select 1 from monthly_overrides where id='race-resurrection'),'waiting future override creates no resurrection');"))
# Force the actual service transaction boundary, not only a test savepoint.
commit_sql='begin;\n'+auth+"select public.delete_bill_completely('clean','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');\ncommit;\n"
r=subprocess.run(command,input=commit_sql,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,env=env,timeout=30)
(logs/'standalone-delete-commit-failure.log').write_text(r.stdout)
if r.returncode==0 or 'planned_account_transfers_source_bill_fkey' not in r.stdout:raise RuntimeError('Expected deferred FK failure at actual COMMIT: '+r.stdout)
query("select test.assert(exists(select 1 from bills where id='clean') and exists(select 1 from monthly_overrides where bill_id='clean') and (select linked_bill_id='clean' from transactions where id='conversion-history') and not exists(select 1 from test.delete_logs),'COMMIT failure restores source, overrides, actual links and journal');",'standalone-delete-commit-rollback-verify')
proof.append({'case':'standalone-delete-actual-commit-rollback','status':'PASS'})
(logs/'concurrency-proof.json').write_text(json.dumps({'status':'PASS','cases':proof},indent=2)+'\n');print(f'Concurrent conversion cases PASS: {len(proof)}')
