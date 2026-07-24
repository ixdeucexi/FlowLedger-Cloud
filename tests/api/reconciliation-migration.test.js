const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const migrationPath = path.join(
  __dirname,
  "../../supabase/migrations/20260724075304_reject_deleted_transaction_reconciliation.sql",
);

test("deleted transactions cannot transition from needs_review into a reviewed state", async () => {
  const migration = await readFile(migrationPath, "utf8");

  assert.match(migration, /old\.deleted_at is not null/i);
  assert.match(migration, /old\.review_status = 'needs_review'/i);
  assert.match(
    migration,
    /new\.review_status in \('matched', 'categorized', 'transfer'\)/i,
  );
  assert.match(
    migration,
    /before update of review_status, review_resolution on public\.transactions/i,
  );
});

test("the reconciliation guard cannot be called directly", async () => {
  const migration = await readFile(migrationPath, "utf8");

  assert.match(migration, /security invoker/i);
  assert.match(migration, /set search_path = public, pg_temp/i);
  assert.match(
    migration,
    /revoke execute on function public\.reject_deleted_transaction_reconciliation\(\)[\s\S]*from public, anon, authenticated, service_role/i,
  );
});
