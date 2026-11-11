"""Independent local psql sessions exercise real PostgreSQL locking/CAS."""
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
hh = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
budget = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
ref = 'bank:00000000-0000-4000-8000-000000000020'

def rename(account, expected, name):
    target = 'null' if name is None else "'" + name.replace("'", "''") + "'"
    return f"select public.rename_forecast_account('{hh}','{budget}','{account}','{expected}',{target});\n"

def query(sql, label):
    result = subprocess.run(command, input=sql, text=True, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, env=env, timeout=20)
    (logs / f'{label}.log').write_text(result.stdout)
    if result.returncode:
        raise RuntimeError(f'{label} failed: {result.stdout}')
    return result.stdout

def parallel(label, first, second, verify):
    file_a, file_b = logs / f'{label}-a.log', logs / f'{label}-b.log'
    held = 'begin;\n' + first + '\\echo FIRST_SESSION_READY\nselect pg_sleep(0.8);\ncommit;\n'
    with file_a.open('w') as a_log, file_b.open('w') as b_log:
        a = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=a_log,
                             stderr=subprocess.STDOUT, text=True, env=env)
        a.stdin.write(held)
        a.stdin.close()
        deadline = time.monotonic() + 10
        while 'FIRST_SESSION_READY' not in file_a.read_text():
            if a.poll() is not None or time.monotonic() > deadline:
                raise RuntimeError(f'{label}: first session failed before its held lock: {file_a.read_text()}')
            time.sleep(0.01)
        b = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=b_log,
                             stderr=subprocess.STDOUT, text=True, env=env)
        b.stdin.write(second)
        b.stdin.close()
        if a.wait(timeout=20) or b.wait(timeout=20):
            raise RuntimeError(f'{label} sessions failed: {file_a.read_text()}\n{file_b.read_text()}')
    query(verify, label + '-verify')
    return {'case': label, 'status': 'PASS', 'sessions': [str(file_a), str(file_b)]}

proof = []
proof.append(parallel('manual-rename-cas', auth + rename('manual:manual-race', 'Race Cash', 'Cash A'),
    auth + "select test.must_fail($q$" + rename('manual:manual-race', 'Race Cash', 'Cash B').strip() + "$q$,'stale concurrent manual rename conflicts without deadlock','name changed');",
    "select test.assert((select name='Cash A' and current_balance=25 from accounts where id='manual-race'),'one concurrent manual name wins without balance change');"))
proof.append(parallel('bank-rename-cas', auth + rename(ref, 'Race Bank', 'Bank A'),
    auth + "select test.must_fail($q$" + rename(ref, 'Race Bank', 'Bank B').strip() + "$q$,'stale concurrent bank rename conflicts without deadlock','name changed');",
    "select test.assert((select display_name='Bank A' and current_balance=100 and updated_at='2027-01-01' from plaid_accounts where id='00000000-0000-4000-8000-000000000020'),'one concurrent bank name wins without observation change');"))
proof.append(parallel('provider-update-after-rename', auth + rename(ref, 'Bank A', 'New Family Name'),
    "update plaid_accounts set current_balance=150,available_balance=140,updated_at='2030-01-01',display_name='Stale API index' where id='00000000-0000-4000-8000-000000000020';",
    "select test.assert((select display_name='New Family Name' and current_balance=150 and updated_at='2030-01-01' from plaid_accounts where id='00000000-0000-4000-8000-000000000020'),'stale provider update preserves newest name and legitimate observation');"))
proof.append(parallel('rename-after-provider-row-lock',
    "update plaid_accounts set current_balance=175,available_balance=165,updated_at='2031-01-01',display_name='Stale API index' where id='00000000-0000-4000-8000-000000000020';",
    auth + rename(ref, 'New Family Name', None),
    "select test.assert((select display_name is null and current_balance=175 and updated_at='2031-01-01' from plaid_accounts where id='00000000-0000-4000-8000-000000000020'),'row-first provider update and advisory-first reset do not deadlock or roll back balances');"))
query(auth + rename(ref, 'Race Bank', 'Temporary'), 'prepare-reset-retry')
proof.append(parallel('same-asof-refresh-after-reset', auth + rename(ref, 'Temporary', None),
    "update plaid_accounts set updated_at=updated_at,display_name='Temporary' where id='00000000-0000-4000-8000-000000000020';",
    "select test.assert((select display_name is null and current_balance=175 and updated_at='2031-01-01' from plaid_accounts where id='00000000-0000-4000-8000-000000000020'),'same-asof stale retry cannot resurrect reset name');"))
reconnect = """insert into plaid_accounts(id,user_id,household_id,plaid_item_record_id,plaid_account_id,persistent_account_id,name,type,subtype,account_type,account_subtype,current_balance,available_balance,is_active,currency_code,updated_at,display_name)
values('00000000-0000-4000-8000-000000000021','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','race-reconnected','race-physical','Race Reconnected','depository','checking','depository','checking',225,200,true,'USD','2032-01-01','Temporary');"""
proof.append(parallel('reconnect-after-rename', auth + rename(ref, 'Race Bank', 'Family account'), reconnect,
    "select test.assert((select count(*)=2 and bool_and(display_name='Family account') from plaid_accounts where persistent_account_id='race-physical'),'reconnect waits for current physical name without stale resurrection');"))
proof.append(parallel('revocation-during-wait',
    "select pg_advisory_xact_lock(hashtextextended('flowledger:account-name:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',0)); delete from household_members where household_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and user_id='22222222-2222-4222-8222-222222222222';",
    auth + "select test.must_fail($q$" + rename(ref, 'Family account', 'Forbidden late name').strip() + "$q$,'revoked editor cannot finish waiting rename','access required');",
    "select test.assert((select bool_and(display_name='Family account') from plaid_accounts where persistent_account_id='race-physical'),'revocation rolls back waiting name write'); insert into household_members(household_id,user_id,role) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','22222222-2222-4222-8222-222222222222','editor');"))
first_changes = json.dumps([
    {'entity_type': 'bill', 'entity_id': 'bill-1', 'expected': {'funding_account_ref': 'bank:00000000-0000-4000-8000-000000000013'}, 'patch': {'funding_account_ref': 'bank:00000000-0000-4000-8000-000000000001'}},
    {'entity_type': 'income', 'entity_id': 'income-1', 'expected': {'deposit_account_ref': 'bank:00000000-0000-4000-8000-000000000001'}, 'patch': {'deposit_account_ref': 'bank:00000000-0000-4000-8000-000000000003'}}])
second_changes = json.dumps([
    {'entity_type': 'bill', 'entity_id': 'bill-1', 'expected': {'funding_account_ref': 'bank:00000000-0000-4000-8000-000000000013'}, 'patch': {'funding_account_ref': 'bank:00000000-0000-4000-8000-000000000003'}},
    {'entity_type': 'income', 'entity_id': 'income-1', 'expected': {'deposit_account_ref': 'bank:00000000-0000-4000-8000-000000000001'}, 'patch': {'deposit_account_ref': 'bank:00000000-0000-4000-8000-000000000013'}}])
first_batch = f"select public.set_forecast_account_routing_batch('{hh}','{budget}',$changes${first_changes}$changes$);"
second_batch = f"select public.set_forecast_account_routing_batch('{hh}','{budget}',$changes${second_changes}$changes$);"
proof.append(parallel('batch-concurrent-cas', auth + first_batch,
    auth + 'select test.must_fail($reject$' + second_batch + "$reject$,'second reviewed batch is all-or-nothing after first commit','assignment changed');",
    "select test.assert((select funding_account_ref='bank:00000000-0000-4000-8000-000000000001' from bills where id='bill-1') and (select deposit_account_ref='bank:00000000-0000-4000-8000-000000000003' from incomes where id='income-1'),'concurrent rejected batch changes neither row');"))
(logs / 'concurrency-proof.json').write_text(json.dumps({'status': 'PASS', 'cases': proof}, indent=2) + '\n')
print(f'Concurrent SQL cases passed: {len(proof)}. Proof: {logs / "concurrency-proof.json"}')
