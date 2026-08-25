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
