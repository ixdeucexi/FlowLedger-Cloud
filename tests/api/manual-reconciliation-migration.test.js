const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const migrationPath = path.join(
  __dirname,
  "../../supabase/migrations/20260728060934_harden_manual_transaction_reconciliation.sql",
);

test("manual reconciliation serializes both sides and enforces one replacement", async () => {
  const migration = await readFile(migrationPath, "utf8");

  assert.match(
    migration,
    /create unique index if not exists transaction_reconciliations_one_manual_target[\s\S]*where resolution = 'manual' and target_id is not null/i,
  );
  assert.match(
    migration,
    /where id = p_transaction_id[\s\S]*pending is not true[\s\S]*for update/i,
  );
  assert.match(
    migration,
    /where id = p_manual_transaction_id[\s\S]*removed_at is null[\s\S]*deleted_at is null[\s\S]*for update/i,
  );
  assert.match(
    migration,
    /where transaction_id = p_transaction_id[\s\S]*for update/i,
  );
});

test("manual reconciliation keeps posted dates and stale plans from drifting", async () => {
  const migration = await readFile(migrationPath, "utf8");

  assert.match(
    migration,
    /p_occurrence_date is distinct from v_tx\.date::date/i,
  );
  assert.match(
    migration,
    /date_trunc\('month', v_manual\.date::date\) is distinct from date_trunc\('month', v_tx\.date::date\)/i,
  );
  assert.match(
    migration,
    /abs\(abs\(v_manual\.amount\) - p_planned_amount\) >= 0\.01/i,
  );
});

test("manual reconciliation stays behind an invoker-only public wrapper", async () => {
  const foundation = await readFile(
    path.join(
      __dirname,
      "../../supabase/migrations/20260728011948_reconcile_manual_planned_transactions.sql",
    ),
    "utf8",
  );
  const hardening = await readFile(migrationPath, "utf8");

  assert.match(
    foundation,
    /create or replace function public\.reconcile_manual_transaction[\s\S]*security invoker[\s\S]*set search_path = ''/i,
  );
  assert.doesNotMatch(
    hardening,
    /create or replace function public\.[\s\S]*security definer/i,
  );
});
