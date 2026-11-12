import os, pathlib, subprocess, sys, time
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
 return f"set role authenticated;select set_config('request.jwt.claim.sub','{actor}',false);select public.rename_household('{home}','{name}','{expected}');"
process,log=begin_case('rename-cas',actor_call(owner,'First',"Cousin's home & 🏡".replace("'","''")))
result=run(actor_call(owner,'Second',"Cousin's home & 🏡".replace("'","''")))
(out/'rename-cas-b.log').write_text(result.stdout+result.stderr)
assert result.returncode!=0 and 'household_name_conflict' in result.stderr,result.stderr
finish(process,log)
assert checked(f"select name from public.households where id='{home}'")=='First'
for label, mutation in [('revocation',f"delete from public.household_members where household_id='{home}' and user_id='{manager}'"),('demotion',f"update public.household_members set role='viewer' where household_id='{home}' and user_id='{manager}'")]:
 process,log=begin_case(label,mutation)
 result=run(actor_call(manager,'Forbidden','First'))
 (out/(label+'-b.log')).write_text(result.stdout+result.stderr)
 assert result.returncode!=0 and 'Only household owners or managers' in result.stderr,result.stderr
 finish(process,log)
 assert checked(f"select name from public.households where id='{home}'")=='First'
 checked(f"insert into public.household_members(household_id,user_id,role) values('{home}','{manager}','manager') on conflict(household_id,user_id) do update set role='manager'")
process,log=begin_case('authorized-before-demotion',actor_call(manager,'Authorized','First'))
result=run(f"update public.household_members set role='viewer' where household_id='{home}' and user_id='{manager}'")
assert result.returncode==0,result.stderr
finish(process,log)
assert checked(f"select name from public.households where id='{home}'")=='Authorized'
(out/'concurrency-summary.json').write_text('{"status":"PASS","cases":4,"hostedDatabaseAccess":false}\n')
print('PASS 4 concurrent rename/CAS/current membership cases')
