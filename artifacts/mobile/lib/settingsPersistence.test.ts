import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { activeVersionedPatch, enqueueMutationByKey } from "./financialMutationRecovery";
import { settingsDbPatch } from "./settingsPersistence";

test("safety, starting balance, and payment method intents stay sparse and compose", () => {
  const tokens = new Map<string, string>([
    ["safety_floor", "safety-a"],
    ["starting_balance", "anchor-b"],
    ["starting_balance_date", "anchor-b"],
    ["paymentMethod", "method-c"],
  ]);
  const safety = activeVersionedPatch({ safety_floor: 500 }, "safety-a", tokens);
  const anchor = activeVersionedPatch({
    starting_balance: 3200,
    starting_balance_date: "2026-08-25",
  }, "anchor-b", tokens);
  const method = activeVersionedPatch({ paymentMethod: "snowball" }, "method-c", tokens);

  assert.deepEqual(settingsDbPatch(safety), { safety_floor: 500 });
  assert.deepEqual(settingsDbPatch(anchor), {
    starting_balance: 3200,
    starting_balance_date: "2026-08-25",
  });
  assert.deepEqual(settingsDbPatch(method), { payment_method: "snowball" });
  assert.deepEqual({ ...safety, ...anchor, ...method }, {
    safety_floor: 500,
    starting_balance: 3200,
    starting_balance_date: "2026-08-25",
    paymentMethod: "snowball",
  });
});

test("a newer same-field settings intent turns the older queued write into a no-op", () => {
  const tokens = new Map<string, string>([["safety_floor", "new"]]);
  assert.deepEqual(activeVersionedPatch({ safety_floor: 200 }, "old", tokens), {});
  assert.deepEqual(activeVersionedPatch({ safety_floor: 600 }, "new", tokens), { safety_floor: 600 });
});

test("queued safety, anchor, and payment-method writes compose from authoritative state", async () => {
  const queues = new Map<string, Promise<unknown>>();
  const tokens = new Map<string, string>();
  let authoritative: Record<string, unknown> = {
    safety_floor: 200,
    starting_balance: 1000,
    starting_balance_date: "2026-08-01",
    paymentMethod: "snowball",
  };
  const calls: Array<{ expected: Record<string, unknown>; patch: Record<string, unknown> }> = [];

  const queue = (patch: Record<string, unknown>, token: string) => {
    Object.keys(patch).forEach(field => tokens.set(field, token));
    return enqueueMutationByKey(queues, "user:household", async () => {
      const active = activeVersionedPatch(patch, token, tokens);
      if (Object.keys(active).length === 0) return;
      const expected = Object.fromEntries(Object.keys(active).map(field => [field, authoritative[field]]));
      calls.push({ expected, patch: active });
      authoritative = { ...authoritative, ...active };
    });
  };

  const safety = queue({ safety_floor: 500 }, "safety-a");
  const anchor = queue({ starting_balance: 3200, starting_balance_date: "2026-08-25" }, "anchor-b");
  const method = queue({ paymentMethod: "snowball" }, "method-c");
  await Promise.all([safety, anchor, method]);

  assert.deepEqual(calls, [
    { expected: { safety_floor: 200 }, patch: { safety_floor: 500 } },
    {
      expected: { starting_balance: 1000, starting_balance_date: "2026-08-01" },
      patch: { starting_balance: 3200, starting_balance_date: "2026-08-25" },
    },
    { expected: { paymentMethod: "snowball" }, patch: { paymentMethod: "snowball" } },
  ]);
  assert.deepEqual(authoritative, {
    safety_floor: 500,
    starting_balance: 3200,
    starting_balance_date: "2026-08-25",
    paymentMethod: "snowball",
  });
});

test("a superseded same-field save uses the last authoritative value as its CAS baseline", async () => {
  const queues = new Map<string, Promise<unknown>>();
  const tokens = new Map<string, string>();
  let authoritative = 200;
  const calls: Array<{ expected: number; desired: number }> = [];

  const queue = (desired: number, token: string) => {
    tokens.set("safety_floor", token);
    return enqueueMutationByKey(queues, "user:household", async () => {
      const active = activeVersionedPatch({ safety_floor: desired }, token, tokens);
      if (active.safety_floor === undefined) return;
      calls.push({ expected: authoritative, desired: active.safety_floor });
      authoritative = active.safety_floor;
    });
  };

  const older = queue(400, "old");
  const newer = queue(600, "new");
  await Promise.all([older, newer]);

  assert.deepEqual(calls, [{ expected: 200, desired: 600 }]);
  assert.equal(authoritative, 600);
});

test("settings persistence is per-scope, sparse, and never whole-record upserted", () => {
  const context = readFileSync("context/BudgetContext.tsx", "utf8");
  const start = context.indexOf("const updateSettings");
  const end = context.indexOf("const addAccount", start);
  const source = context.slice(start, end);
  assert.match(source, /settingsWriteQueuesRef/);
  assert.match(source, /settingsFieldTokensRef/);
  assert.match(source, /authoritativeSettingsByScopeRef/);
  assert.match(source, /const expectedSettings = authoritativeSettingsByScopeRef\.current\.get\(scopeKey\)/);
  assert.match(source, /activeVersionedPatch/);
  assert.match(source, /update_household_settings_patch/);
  assert.match(source, /settingsDbPatch/);
  assert.doesNotMatch(source, /saveSettingsRecord\(next\)/);
  assert.doesNotMatch(source, /from\("household_settings"\)\.upsert/);
});

test("database settings bootstrap and account anchor writes are atomic and scoped", () => {
  const migration = readFileSync(
    "../../supabase/migrations/20260825094547_atomic_account_and_settings_writes.sql",
    "utf8",
  );
  assert.match(migration, /function public\.update_household_settings_patch/i);
  assert.match(migration, /pg_advisory_xact_lock/i);
  assert.match(migration, /insert into public\.household_settings[\s\S]+on conflict \(household_id\) do nothing/i);
  assert.match(migration, /to_jsonb\(v_row\)[\s\S]+is distinct from[\s\S]+update public\.household_settings set/i);
  assert.match(migration, /function public\.add_manual_account_with_anchor/i);
  assert.match(migration, /insert into public\.accounts[\s\S]+insert into public\.account_balances[\s\S]+update public\.household_settings/i);
  assert.match(migration, /get diagnostics v_inserted_count = row_count/i);

  const coherentAnchorMigration = readFileSync(
    "../../supabase/migrations/20260827122031_require_coherent_manual_operating_anchor.sql",
    "utf8",
  );
  assert.match(coherentAnchorMigration, /min\(account\.balance_as_of\)/i);
  assert.match(coherentAnchorMigration, /max\(account\.balance_as_of\)/i);
  assert.match(
    coherentAnchorMigration,
    /if v_account\.is_active and v_account\.account_type in \('checking', 'cash'\) then[\s\S]+v_anchor_min_date is distinct from v_anchor_max_date/i,
  );
  assert.match(coherentAnchorMigration, /v_anchor_min_date is distinct from v_anchor_max_date/i);
  assert.ok(
    coherentAnchorMigration.indexOf("v_anchor_min_date is distinct from v_anchor_max_date")
      < coherentAnchorMigration.indexOf("update public.household_settings set"),
  );
  assert.match(coherentAnchorMigration, /add column if not exists last_mutation_id text/i);
  assert.match(coherentAnchorMigration, /add column if not exists last_mutation_intent jsonb/i);
  assert.match(coherentAnchorMigration, /create table if not exists private\.manual_account_mutation_receipts/i);
  assert.match(coherentAnchorMigration, /mutation_id text primary key/i);
  const receiptTable = coherentAnchorMigration.slice(
    coherentAnchorMigration.indexOf("create table if not exists private.manual_account_mutation_receipts"),
    coherentAnchorMigration.indexOf("revoke all on table private.manual_account_mutation_receipts"),
  );
  assert.doesNotMatch(receiptTable, /actor_id/i);
  assert.match(receiptTable, /manual_account_mutation_receipts_household_idx[\s\S]+\(household_id\)/i);
  assert.match(receiptTable, /manual_account_mutation_receipts_budget_idx[\s\S]+\(budget_id\)/i);
  assert.match(coherentAnchorMigration, /revoke all on table private\.manual_account_mutation_receipts[\s\S]+authenticated, service_role/i);
  assert.match(coherentAnchorMigration, /function private\.sync_manual_operating_anchor\(\)/i);
  assert.match(coherentAnchorMigration, /function private\.update_manual_account_with_anchor/i);
  assert.match(coherentAnchorMigration, /function public\.update_manual_account_with_anchor/i);
  assert.match(coherentAnchorMigration, /pg_advisory_xact_lock[\s\S]+order by id[\s\S]+for update/i);
  assert.match(coherentAnchorMigration, /flowledger-account-mutation:[\s\S]+where mutation_id = p_mutation_id[\s\S]+for update/i);
  assert.match(coherentAnchorMigration, /v_receipt\.intent is distinct from v_intent/i);
  assert.match(coherentAnchorMigration, /insert into private\.manual_account_mutation_receipts/i);
  assert.match(coherentAnchorMigration, /if not v_retry then[\s\S]+insert into public\.account_balances/i);
  assert.match(coherentAnchorMigration, /where id = p_balance_id[\s\S]+for update/i);
  const privateMutation = coherentAnchorMigration.slice(
    coherentAnchorMigration.indexOf("create or replace function private.update_manual_account_with_anchor"),
    coherentAnchorMigration.indexOf("create or replace function public.update_manual_account_with_anchor"),
  );
  assert.doesNotMatch(privateMutation, /insert into public\.account_balances[\s\S]{0,500}on conflict/i);
  assert.match(coherentAnchorMigration, /'checking', 'savings', 'cash', 'credit_card'/i);
  assert.match(coherentAnchorMigration, /legacy credit-card row may be preserved or archived/i);
  assert.match(coherentAnchorMigration, /manual_account_acl_audit/i);

  const compatibilityTrigger = coherentAnchorMigration.slice(
    coherentAnchorMigration.indexOf("create or replace function private.sync_manual_operating_anchor"),
    coherentAnchorMigration.indexOf("create or replace function private.update_manual_account_with_anchor"),
  );
  assert.match(compatibilityTrigger, /if tg_op = 'INSERT'[\s\S]+v_anchor_min_date is distinct from v_anchor_max_date[\s\S]+raise exception/i);
  assert.match(compatibilityTrigger, /if v_anchor_max_date is not null[\s\S]+v_anchor_min_date is not distinct from v_anchor_max_date[\s\S]+update public\.household_settings/i);
  assert.doesNotMatch(compatibilityTrigger, /if tg_op = 'UPDATE'[\s\S]{0,240}raise exception/i);
  assert.doesNotMatch(compatibilityTrigger, /pg_advisory_xact_lock/i);
  assert.match(compatibilityTrigger, /from public\.household_settings[\s\S]+for update/i);
  assert.match(compatibilityTrigger, /order by affected\.household_id/i);
  assert.match(compatibilityTrigger, /after update of household_id, budget_id, is_active, account_type/i);
  assert.match(compatibilityTrigger, /after delete on public\.accounts/i);

  const context = readFileSync("context/BudgetContext.tsx", "utf8");
  const accountStart = context.indexOf("const addAccount");
  const accountEnd = context.indexOf("const updateAccount", accountStart);
  const accountCreation = context.slice(accountStart, accountEnd);
  assert.match(
    accountCreation,
    /const updatesOperatingAnchor = accountUpdatesOperatingAnchor\(toAccountSnapshot\(account\)\)/,
  );
  assert.match(accountCreation, /const accountAnchor = updatesOperatingAnchor[\s\S]+: null/);
  assert.match(accountCreation, /if \(updatesOperatingAnchor && !accountAnchor\)/);

  const saveStart = context.indexOf("const saveManualAccountChange");
  const saveEnd = context.indexOf("const updateAccount", saveStart);
  const accountMutation = context.slice(saveStart, saveEnd);
  assert.match(accountMutation, /const coherentAnchor = touchesOperatingAnchor/);
  assert.match(accountMutation, /const anchorPatch: SettingsPatch = coherentAnchor \? \{/);
  assert.match(accountMutation, /Keep Forecast on the last coherent settings anchor/);
  assert.doesNotMatch(accountMutation, /starting_balance:\s*0/);
  assert.match(accountMutation, /updateManualAccountWithAnchorAtomically\(\{/);
  assert.doesNotMatch(accountMutation, /from\("accounts"\)\.update/);
  assert.doesNotMatch(accountMutation, /from\("account_balances"\)\.upsert/);
});

test("account creation uses one RPC and bill deletion has no client compatibility fallback", () => {
  const context = readFileSync("context/BudgetContext.tsx", "utf8");
  const accountStart = context.indexOf("const addAccount");
  const accountEnd = context.indexOf("const updateAccount", accountStart);
  const account = context.slice(accountStart, accountEnd);
  assert.match(account, /add_manual_account_with_anchor/);
  assert.doesNotMatch(account, /from\("accounts"\)\.upsert/);
  assert.doesNotMatch(account, /from\("account_balances"\)\.upsert/);

  const deleteStart = context.indexOf("const deleteBill =");
  const deleteEnd = context.indexOf("const deleteBillMistake", deleteStart);
  const deletion = context.slice(deleteStart, deleteEnd);
  assert.match(deletion, /delete_bill_completely/);
  assert.doesNotMatch(deletion, /rpcMissing/);
  assert.doesNotMatch(deletion, /Delete bill cleanup/);
  assert.doesNotMatch(deletion, /Promise\.all\(/);
});
