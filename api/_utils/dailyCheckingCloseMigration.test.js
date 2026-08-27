const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const migration = fs.readFileSync(path.resolve(
  __dirname,
  "../../supabase/migrations/20260825124024_household_daily_checking_closes.sql",
), "utf8");
const manualSync = fs.readFileSync(path.resolve(__dirname, "../plaid/sync.js"), "utf8");
const automaticSync = fs.readFileSync(path.resolve(__dirname, "../plaid/automatic-sync.js"), "utf8");
const webhook = fs.readFileSync(path.resolve(__dirname, "../plaid/webhook.js"), "utf8");
const closeDispatcher = fs.readFileSync(path.resolve(__dirname, "./dailyCloseDispatcher.js"), "utf8");
const vercel = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../vercel.json"), "utf8"));

test("daily checking closes are household-scoped read-only client data", () => {
  assert.match(migration, /household_id uuid not null references public\.households\(id\) on delete cascade/i);
  assert.match(migration, /alter table public\.household_daily_checking_closes enable row level security/i);
  assert.match(migration, /for select\s+to authenticated\s+using \(\(select private\.is_household_member\(household_id\)\)\)/i);
  assert.match(migration, /revoke all on table public\.household_daily_checking_closes from public, anon, authenticated/i);
  assert.match(migration, /grant select on table public\.household_daily_checking_closes to authenticated/i);
  assert.doesNotMatch(migration, /grant (?:insert|update|delete|all).*authenticated/i);
});

test("the aggregate writer is service-only, invoker-secured, canonical, and retry-safe", () => {
  assert.match(migration, /security invoker/i);
  assert.match(migration, /set search_path = ''/i);
  assert.match(migration, /grant execute on function public\.record_household_daily_checking_close\(uuid, jsonb\)\s+to service_role/i);
  assert.match(migration, /revoke all on function public\.record_household_daily_checking_close\(uuid, jsonb\)\s+from public, anon, authenticated/i);
  assert.match(migration, /pg_catalog\.pg_advisory_xact_lock/i);
  assert.match(migration, /pg_catalog\.pg_timezone_names/i);
  assert.match(migration, /item\.status in \('active', 'needs_repair'\)/i);
  assert.match(migration, /coalesce\(item\.encrypted_access_token, item\.access_token_ciphertext\) is not null/i);
  assert.match(migration, /v_observed_item_count <> v_active_item_count/i);
  assert.match(migration, /v_first_observation_date is distinct from v_last_observation_date/i);
  assert.match(migration, /account\.is_active = true/i);
  assert.match(migration, /account_subtype, account\.subtype, ''\)\) = 'checking'/i);
  assert.match(migration, /canonical_rank = 1/i);
  assert.match(migration, /where excluded\.observed_at > public\.household_daily_checking_closes\.observed_at/i);
});

test("the writer excludes disconnected items and inactive accounts from the close", () => {
  assert.match(migration, /item\.status in \('active', 'needs_repair'\)[\s\S]*encrypted_access_token/i);
  assert.match(migration, /account\.is_active = true/i);
  assert.doesNotMatch(migration, /item\.status = 'removed'/i);
});

test("concurrent captures serialize and an older retry cannot overwrite the newer close", () => {
  assert.match(migration, /pg_catalog\.pg_advisory_xact_lock\([\s\S]*p_household_id/i);
  assert.match(migration, /order by item\.id\s+for update/i);
  assert.match(migration, /if v_item\.sync_lock_token is not null then\s+return false/i);
  assert.match(migration, /observation\.observed_at = item\.accounts_observed_at/i);
  assert.match(migration, /on conflict \(household_id, balance_date\) do update/i);
  assert.match(migration, /where excluded\.observed_at > public\.household_daily_checking_closes\.observed_at/i);
});

test("the migration adds an authoritative per-item account observation", () => {
  assert.match(migration, /alter table public\.plaid_items\s+add column if not exists accounts_observed_at timestamptz/i);
});

test("a canonical checking account with a null or stale balance fails closed", () => {
  assert.match(migration, /current_balance is null\s+or account_observed_at is distinct from item_accounts_observed_at/i);
  assert.match(migration, /v_invalid_account_count > 0/i);
  assert.doesNotMatch(migration, /account\.current_balance is not null/i);
});

test("the migration does not infer or backfill historical closes", () => {
  const inserts = migration.match(/insert into public\.household_daily_checking_closes/gi) ?? [];
  assert.equal(inserts.length, 1);
  assert.doesNotMatch(migration, /generate_series|backfill/i);
});

test("manual, automatic, and webhook refreshes include credentialed needs-repair items", () => {
  for (const source of [manualSync, automaticSync, webhook]) {
    assert.match(source, /\.in\("status", \["active", "needs_repair"\]\)/);
  }
  assert.match(manualSync, /encrypted_access_token\.not\.is\.null,access_token_ciphertext\.not\.is\.null/);
  assert.match(webhook, /encrypted_access_token\.not\.is\.null,access_token_ciphertext\.not\.is\.null/);
  assert.match(automaticSync, /item\.encrypted_access_token \|\| item\.access_token_ciphertext/);
});

test("a Hobby-compatible daily dispatcher saves the latest coherent known balance near Chicago midnight", () => {
  assert.ok(vercel.crons.some(cron => (
    cron.path === "/api/plaid/daily-close" && cron.schedule === "55 5 * * *"
  )));
  assert.ok(vercel.rewrites.some(rewrite => (
    rewrite.source === "/api/plaid/daily-close"
      && rewrite.destination === "/api/plaid/automatic-sync?plaidAction=daily-close"
  )));
  assert.match(automaticSync, /isAuthorizedCron\(req, secret\)/);
  assert.match(automaticSync, /req\.query\?\.plaidAction === "daily-close"/);
  assert.match(automaticSync, /dispatchDailyCheckingCloses/);
  assert.match(closeDispatcher, /isLocalCloseWindow\(now, timeZone, \[23, 0\]\)/);
  assert.match(closeDispatcher, /Vercel Hobby permits only a once-daily cron/);
  assert.match(closeDispatcher, /accounts_observed_at/);
  assert.match(closeDispatcher, /recordHouseholdDailyCheckingClose/);
  assert.doesNotMatch(closeDispatcher, /plaid\(\)|syncItem/);
});

test("the Hobby deployment stays within its twelve-function limit", () => {
  const apiRoot = path.resolve(__dirname, "..");
  const deployedFunctions = [];
  const visit = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === "_utils") continue;
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.name.endsWith(".js") && !entry.name.endsWith(".test.js")) deployedFunctions.push(target);
    }
  };
  visit(apiRoot);
  assert.equal(deployedFunctions.length, 12);
  assert.ok(!deployedFunctions.some(file => file.endsWith(path.join("plaid", "daily-close.js"))));
});
