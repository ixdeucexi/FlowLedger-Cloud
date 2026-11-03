// Runs only against a disposable PostgreSQL 17 container with no network or
// published ports. No project dependencies, Supabase keys or customer data.
// Run from the repository root:
// node artifacts/mobile/supabase/tests/debt_payment_pauses.local.mjs
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const env = { ...process.env };
for (const key of ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']) delete env[key];
const container = `flowledger-pause-test-${process.pid}-${Date.now()}`;
const docker = (args, options = {}) => execFileSync('docker', ['--host=unix:///var/run/docker.sock', ...args], {
  env, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, ...options,
});
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = readdirSync(`${repo}supabase/migrations`).filter((name) => name.endsWith('_saved_debt_payment_pauses.sql'));
if (migration.length !== 1) throw new Error('Expected one CLI-created saved_debt_payment_pauses migration');
try {
  docker(['info', '--format', '{{.ServerVersion}}']);
  docker(['run', '--rm', '--detach', '--name', container, '--network', 'none',
    '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', '-e', 'POSTGRES_DB=flowledger_pause_tests', 'postgres:17-alpine']);
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      // The image briefly starts a temporary server during init. Wait for PID 1
      // to become the final server before accepting pg_isready.
      if (docker(['exec', container, 'cat', '/proc/1/comm']).trim() !== 'postgres') { await setTimeout(100); continue; }
      docker(['exec', container, 'pg_isready', '-U', 'postgres'], { stdio: 'pipe' }); ready = true; break;
    }
    catch { await setTimeout(100); }
  }
  if (!ready) throw new Error('Disposable PostgreSQL did not become ready');
  const sql = [
    read('debt_payment_pauses.local-fixture.sql'),
    read('../../../../supabase/migrations/20260825094545_unique_monthly_override_occurrences.sql'),
    read('../../../../supabase/migrations/20261030065552_recent_changes_journal.sql'),
    read('debt_payment_pauses.local-seed.sql'),
    readFileSync(`${repo}supabase/migrations/${migration[0]}`, 'utf8'),
    'begin;', read('debt_payment_pauses_checks.sql'), 'rollback;',
    read('debt_payment_pauses.local-checks.sql'),
  ].join('\n');
  const output = docker(['exec', '-i', container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'flowledger_pause_tests'], { input: sql, stdio: ['pipe', 'pipe', 'inherit'] });
  console.log(output.split('\n').filter((line) => /passed|rows?\)|PASS:/.test(line)).join('\n'));
  console.log(`Verified ${migration[0]} on an isolated PostgreSQL 17 database.`);
} catch (error) {
  console.error(error.message.split('\n')[0]);
  process.exitCode = 1;
} finally {
  docker(['rm', '--force', container], { stdio: 'ignore' });
}
