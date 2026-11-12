import os, pathlib, subprocess, sys, time, json
container, directory = sys.argv[1:]
out = pathlib.Path(directory)
env = {k: v for k, v in os.environ.items() if k not in ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH']}
command = ['docker','--host=unix:///var/run/docker.sock','exec','-i',container,'psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-At']
home = '00000000-0000-4000-8000-000000000002'
manager = '00000000-0000-4000-8000-000000000012'
owner = '00000000-0000-4000-8000-000000000011'
def run(sql):
 return subprocess.run(command, input=sql, text=True, capture_output=True, env=env)
def checked(sql):
 result=run(sql)
 assert result.returncode == 0, result.stderr
 return result.stdout.strip()
def begin_case(label, sql):
 path=out/(label+'-a.log')
 log=path.open('w')
 process=subprocess.Popen(command, stdin=subprocess.PIPE, stdout=log, stderr=subprocess.STDOUT, text=True, env=env)
 process.stdin.write(f"set application_name='{label}';begin;{sql};select pg_sleep(1.2);commit;\n")
 process.stdin.close()
 deadline=time.monotonic()+5
 while time.monotonic()<deadline:
  if checked(f"select exists(select 1 from pg_stat_activity where application_name='{label}' and query like '%pg_sleep%' and state='active');")=='t': return process,log
  time.sleep(.03)
 raise AssertionError('First concurrent transaction did not reach hold: '+label)
def finish(process,log):
 assert process.wait(timeout=10)==0
 log.close()
def actor_call(actor,name,expected):
 name_sql='null' if name is None else "'"+name.replace("'","''")+"'"
 expected_sql='null' if expected is None else "'"+expected.replace("'","''")+"'"
 return f"set role authenticated;select set_config('request.jwt.claim.sub','{actor}',false);select public.save_household_nickname('{home}',{name_sql},{expected_sql});"
process,log=begin_case('nickname-cas',actor_call(owner,'First','Owner home'))
result=run(actor_call(owner,None,'Owner home'))
(out/'nickname-cas-b.log').write_text(result.stdout+result.stderr)
assert result.returncode!=0 and 'household_nickname_conflict' in result.stderr,result.stderr
finish(process,log)
assert checked(f"select nickname from public.household_nicknames where household_id='{home}' and user_id='{owner}'")=='First'
process,log=begin_case('nickname-revocation',f"delete from public.household_members where household_id='{home}' and user_id='{manager}'")
result=run(actor_call(manager,'Forbidden','Manager home'))
(out/'nickname-revocation-b.log').write_text(result.stdout+result.stderr)
assert result.returncode!=0,result.stdout
finish(process,log)
assert checked(f"select count(*) from public.household_nicknames where household_id='{home}' and user_id='{manager}'")=='0'
checked(f"insert into public.household_members(household_id,user_id,role) values('{home}','{manager}','manager')")
process,log=begin_case('nickname-before-exit',actor_call(manager,'Allowed',None))
result=run(f"delete from public.household_members where household_id='{home}' and user_id='{manager}'")
assert result.returncode==0,result.stderr
finish(process,log)
assert checked(f"select count(*) from public.household_nicknames where household_id='{home}' and user_id='{manager}'")=='0'
# Precise absent-read/direct-REST INSERT/conditional-clear interleaving. SHARE
# permits the RPC's SELECT FOR UPDATE but blocks DELETE's RowExclusiveLock.
race_user = '00000000-0000-4000-8000-000000000014'
checked(f"insert into public.household_members(household_id,user_id,role) values('{home}','{race_user}','viewer')")
a = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env)
a.stdin.write("begin;lock table public.household_nicknames in share mode;select 'locked';\n")
a.stdin.flush()
assert [a.stdout.readline().strip() for _ in range(3)] == ['BEGIN', 'LOCK TABLE', 'locked']
b = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env)
b.stdin.write("\\set VERBOSITY verbose\nset application_name='nickname-clear-direct-race';" + actor_call(race_user,None,None) + "\n")
b.stdin.close()
deadline = time.monotonic() + 5
waiting = False
while time.monotonic() < deadline:
 waiting = checked("select exists(select 1 from pg_locks l join pg_stat_activity a on a.pid=l.pid where a.application_name='nickname-clear-direct-race' and l.relation='public.household_nicknames'::regclass and l.mode='RowExclusiveLock' and not l.granted)") == 't'
 if waiting: break
 time.sleep(.03)
assert waiting, 'Clear RPC did not reach the conditional DELETE relation lock'
a.stdin.write(f"set role authenticated;select set_config('request.jwt.claim.sub','{race_user}',false);insert into public.household_nicknames(user_id,household_id,nickname) values('{race_user}','{home}','Concurrent direct REST');commit;\n")
a.stdin.close()
assert a.wait(timeout=5) == 0, a.stderr.read()
a_output, a_error = a.stdout.read(), a.stderr.read()
assert b.wait(timeout=5) != 0
b_output, b_error = b.stdout.read(), b.stderr.read()
assert '40001' in b_error and 'household_nickname_conflict' in b_error, b_error
stored = checked(f"select nickname from public.household_nicknames where user_id='{race_user}' and household_id='{home}'")
assert stored == 'Concurrent direct REST'
(out/'clear-direct-race-a.log').write_text(a_output+a_error)
(out/'clear-direct-race-b.log').write_text(b_output+b_error)
(out/'clear-direct-race-proof.json').write_text(json.dumps({'status':'PASS','rpcExitCode':b.returncode,'conflictSQLSTATE':'40001','storedNickname':stored,'falseClearAcknowledgement':False,'exactAbsentReadInsertClearInterleaving':True,'network':'none','realRecords':False},indent=2)+'\n')
(out/'concurrency-summary.json').write_text('{"status":"PASS","cases":4,"hostedDatabaseAccess":false}\n')
print('PASS 4 concurrent nickname CAS, membership cascade and direct REST clear cases')
