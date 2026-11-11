"""Two real isolated PostgreSQL sessions; no hosted connection or actual records."""
import json
import os
import pathlib
import subprocess
import sys
import time
container, output = sys.argv[1:]
logs = pathlib.Path(output)
env = {k: v for k, v in os.environ.items() if k not in {
 'DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH'}}
command = ['docker', '--host=unix:///var/run/docker.sock', 'exec', '-i', container,
 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-d', 'postgres']
auth = "set role authenticated; select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);\n"
def query(sql, label):
 r = subprocess.run(command, input=sql, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env, timeout=20)
 (logs / f'{label}.log').write_text(r.stdout)
 if r.returncode: raise RuntimeError(f'{label}: {r.stdout}')
def parallel(label, first, second, verify):
 fa, fb = logs / f'{label}-a.log', logs / f'{label}-b.log'
 held = 'begin;\n' + first + '\\echo FIRST_SESSION_READY\nselect pg_sleep(0.8);\ncommit;\n'
 with fa.open('w') as al, fb.open('w') as bl:
  a = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=al, stderr=subprocess.STDOUT, text=True, env=env)
  a.stdin.write(held); a.stdin.close()
  deadline = time.monotonic()+10
  while 'FIRST_SESSION_READY' not in fa.read_text():
   if a.poll() is not None or time.monotonic()>deadline: raise RuntimeError(f'{label}: {fa.read_text()}')
   time.sleep(.01)
  b = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=bl, stderr=subprocess.STDOUT, text=True, env=env)
  b.stdin.write(second); b.stdin.close()
  if a.wait(timeout=20) or b.wait(timeout=20): raise RuntimeError(f'{label}: {fa.read_text()}\n{fb.read_text()}')
 query(verify,label+'-verify')
 return {'case':label,'status':'PASS','sessions':[str(fa),str(fb)]}
proof=[]
proof.append(parallel('same-create-idempotence',auth+"select test.save_plan('race-create',null,test.plan_patch());\n",auth+"select test.assert((test.save_plan('race-create',null,test.plan_patch())->>'retry')::boolean,'simultaneous identical create retries');", "select test.assert((select count(*)=1 and max(revision)=1 from planned_account_transfers where id='race-create'),'one concurrently created template');"))
proof.append(parallel('different-create-conflict',auth+"select test.save_plan('race-create-different',null,test.plan_patch());\n",auth+"select test.must_fail($q$select test.save_plan('race-create-different',null,test.plan_patch()||'{\"amount\":999}')$q$,'same ID divergent create conflicts','Transfer changed');", "select test.assert((select amount=100 and revision=1 from planned_account_transfers where id='race-create-different'),'divergent create no partial write');"))
proof.append(parallel('template-edit-cas',auth+"select test.save_plan('race-edit',1,'{\"amount\":150}');\n",auth+"select test.must_fail($q$select test.save_plan('race-edit',1,'{\"amount\":200}')$q$,'second simultaneous edit conflicts','Transfer changed');", "select test.assert((select amount=150 and revision=2 from planned_account_transfers where id='race-edit'),'one simultaneous edit wins');"))
proof.append(parallel('occurrence-edit-cas',auth+"select test.state('race-state','2028-01-31',1,null,'{\"skipped\":true}');\n",auth+"select test.must_fail($q$select test.state('race-state','2028-01-31',1,null,'{\"from_reflected\":true,\"from_balance_as_of\":\"2028-01-31\"}')$q$,'second simultaneous state conflicts','Occurrence changed');", "select test.assert((select skipped and not from_reflected and revision=1 from planned_account_transfer_occurrences where transfer_id='race-state'),'one occurrence state wins');"))
proof.append(parallel('template-vs-occurrence',auth+"select test.save_plan('race-template-state',1,'{\"amount\":175}');\n",auth+"select test.must_fail($q$select test.state('race-template-state','2028-01-31',1,null,'{\"skipped\":true}')$q$,'template revision rechecked after waiting','Transfer changed');", "select test.assert(not exists(select 1 from planned_account_transfer_occurrences where transfer_id='race-template-state'),'stale state creates no mixed snapshot');"))
proof.append(parallel('revoked-editor-during-wait',"select pg_advisory_xact_lock(hashtextextended('flowledger:planned-transfers:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',0)); delete from household_members where household_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and user_id='22222222-2222-4222-8222-222222222222';\n",auth+"select test.must_fail($q$select test.save_plan('race-revoke',1,'{\"amount\":250}')$q$,'revoked editor fails after blocked wait','Household access required');", "select test.assert((select amount=100 and revision=1 from planned_account_transfers where id='race-revoke'),'revocation prevents waiting write'); insert into household_members(household_id,user_id,role) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','22222222-2222-4222-8222-222222222222','editor');"))
proof.append(parallel('state-then-series-edit',auth+"select test.state('race-snapshot','2028-01-31',1,null,'{\"from_reflected\":true,\"from_balance_as_of\":\"2028-01-31\"}');\n",auth+"select test.save_plan('race-snapshot',1,'{\"amount\":225,\"start_date\":\"2028-01-15\"}');", "select test.assert((select amount=225 and revision=2 from planned_account_transfers where id='race-snapshot') and (select amount_snapshot=100 and occurrence_date='2028-01-31' and template_revision_snapshot=1 and from_reflected from planned_account_transfer_occurrences where transfer_id='race-snapshot'),'concurrent later series edit preserves exact reviewed snapshot');"))
proof.append(parallel('atomic-read-during-commit',auth+"select test.save_plan('race-read',1,'{\"amount\":250}'); select test.state('race-read','2028-01-31',2,null,'{\"skipped\":true}');\n",auth+"select test.assert((test.data()->'transfers') @> '[{\"id\":\"race-read\",\"amount\":100,\"revision\":1}]'::jsonb and not ((test.data()->'occurrences') @> '[{\"transfer_id\":\"race-read\"}]'::jsonb),'reader sees old committed pair before writer commits');", "select test.assert((select amount=250 and revision=2 from planned_account_transfers where id='race-read') and (select amount_snapshot=250 and template_revision_snapshot=2 from planned_account_transfer_occurrences where transfer_id='race-read'),'after commit atomic template and state are visible together');"))
proof.append(parallel('delete-vs-occurrence',auth+"select test.erase('race-delete',1);\n",auth+"select test.must_fail($q$select test.state('race-delete','2028-01-31',1,null,'{\"skipped\":true}')$q$,'deleted concurrent template rejects stale state','Transfer changed');", "select test.assert(not exists(select 1 from planned_account_transfer_occurrences where transfer_id='race-delete') and (select deleted_at is not null and revision=2 from planned_account_transfers where id='race-delete'),'delete tombstone cannot acquire stale occurrence');"))
proof.append(parallel('role-downgrade-during-wait',"select pg_advisory_xact_lock(hashtextextended('flowledger:planned-transfers:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',0)); update household_members set role='viewer' where household_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and user_id='22222222-2222-4222-8222-222222222222';\n",auth+"select test.must_fail($q$select test.save_plan('race-downgrade',1,'{\"amount\":250}')$q$,'downgraded editor fails after blocked wait','Household edit access required');", "select test.assert((select amount=100 and revision=1 from planned_account_transfers where id='race-downgrade'),'downgrade prevents waiting write'); update household_members set role='editor' where household_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and user_id='22222222-2222-4222-8222-222222222222';"))
(logs/'concurrency-proof.json').write_text(json.dumps({'status':'PASS','cases':proof},indent=2)+'\n')
print(f'Concurrent planned transfer SQL cases passed: {len(proof)}. Proof: {logs / "concurrency-proof.json"}')
