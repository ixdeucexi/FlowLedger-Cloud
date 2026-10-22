// Isolated PostgreSQL regression: real migration, RLS, reconciliation RPC,
// metadata trigger, undo and canonical debt sync. No application credentials.
// Start a network-none postgres:17 container named flowledger-manual-match-test.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const read = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
function fn(file, name) {
  const source = read(`supabase/migrations/${file}`);
  const start = source.search(new RegExp(`create (?:or replace )?function ${name.replaceAll('.', '\\.')}\\(`, 'i'));
  if (start < 0) throw new Error(`Missing function ${name}`);
  return source.slice(start, source.indexOf('$$;', start) + 3);
}
const undo = fn('20260728060934_harden_manual_transaction_reconciliation.sql', 'private.undo_manual_transaction_reconciliation')
  // Same catalog rewrite applied by founding_free_review_center_entitlement.
  .replace("hp.tier = 'pro'", 'private.has_review_center_entitlement(v_tx.household_id)');
const sync = fn('20260827235209_optimize_startup_debt_sync.sql', 'public.sync_due_debt_transactions');
const sql = [
  read('scripts/fixtures/debt-linked-manual-setup.sql'),
  undo, sync,
  fn('20260728060934_harden_manual_transaction_reconciliation.sql', 'private.reconcile_manual_transaction'),
  fn('20260813173723_allow_manual_pending_activity_matches.sql', 'private.transfer_manual_activity_metadata'),
  `revoke all on function private.reconcile_manual_transaction(text,text,date,numeric,text) from public,anon; grant execute on function private.reconcile_manual_transaction(text,text,date,numeric,text) to authenticated,service_role; revoke all on function private.transfer_manual_activity_metadata() from public,anon,authenticated;`,
  read('supabase/migrations/20261022142938_allow_debt_linked_manual_matching.sql'),
  fn('20260728011948_reconcile_manual_planned_transactions.sql', 'public.reconcile_manual_transaction'),
  fn('20260728011948_reconcile_manual_planned_transactions.sql', 'public.undo_manual_transaction_reconciliation'),
  `create trigger transactions_transfer_manual_activity_metadata before update of review_resolution on public.transactions for each row execute function private.transfer_manual_activity_metadata();`,
  read('scripts/fixtures/debt-linked-manual-assertions.sql'),
].join('\n');
const env = { ...process.env };
for (const key of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH']) delete env[key];
const result = spawnSync('docker', ['--host=unix:///var/run/docker.sock', 'exec', '-i', 'flowledger-manual-match-test', 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'], { input: sql, env, encoding: 'utf8', maxBuffer: 8e6 });
process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '');
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
