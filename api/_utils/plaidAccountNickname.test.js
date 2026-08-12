const assert = require("node:assert/strict");
const test = require("node:test");

const {
  displayNameForSyncedPlaidAccount,
  indexedPlaidAccountDisplayNames,
  isPlaidAccountRecordId,
  normalizePlaidAccountDisplayName,
  updatePlaidSavingsAccountDisplayName,
} = require("./plaidAccountNickname");

test("normalizes savings account nicknames and supports resetting to the bank name", () => {
  assert.deepEqual(normalizePlaidAccountDisplayName("  Emergency   fund  "), { ok: true, value: "Emergency fund" });
  assert.deepEqual(normalizePlaidAccountDisplayName(null), { ok: true, value: null });
  assert.equal(normalizePlaidAccountDisplayName(" ").ok, false);
  assert.equal(normalizePlaidAccountDisplayName("x".repeat(81)).ok, false);
});

test("accepts only a Plaid account record UUID", () => {
  assert.equal(isPlaidAccountRecordId("11111111-1111-4111-8111-111111111111"), true);
  assert.equal(isPlaidAccountRecordId("savings-1"), false);
});

test("carries the newest nickname across a Plaid reconnection", () => {
  const index = indexedPlaidAccountDisplayNames([
    { plaid_account_id: "old", persistent_account_id: "stable", display_name: "Old label", updated_at: "2026-08-01" },
    { plaid_account_id: "current", persistent_account_id: "stable", display_name: "Emergency fund", updated_at: "2026-08-10" },
  ]);
  assert.equal(displayNameForSyncedPlaidAccount({ account_id: "new", persistent_account_id: "stable" }, index), "Emergency fund");
  assert.equal(displayNameForSyncedPlaidAccount({ account_id: "current" }, index), "Emergency fund");
});

function mockDb({ existing = { id: "savings-1", persistent_account_id: "stable-savings" } } = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      const call = { table, filters: {}, update: null };
      calls.push(call);
      const chain = {
        select() { return chain; },
        update(value) { call.update = value; return chain; },
        eq(key, value) { call.filters[key] = value; return chain; },
        async maybeSingle() { return { data: existing, error: null }; },
        then(resolve) {
          return Promise.resolve({
            data: existing ? [{ id: existing.id, display_name: call.update?.display_name ?? null }] : [],
            error: null,
          }).then(resolve);
        },
      };
      return chain;
    },
  };
}

test("updates only an active savings account in the authorized household", async () => {
  const db = mockDb();
  const result = await updatePlaidSavingsAccountDisplayName({
    db,
    householdId: "household-1",
    accountId: "savings-1",
    displayName: "Emergency fund",
  });
  assert.equal(result.ok, true);
  assert.deepEqual(db.calls[0].filters, {
    household_id: "household-1",
    id: "savings-1",
    account_subtype: "savings",
    is_active: true,
  });
  assert.deepEqual(db.calls[1].filters, {
    household_id: "household-1",
    account_subtype: "savings",
    persistent_account_id: "stable-savings",
  });
  assert.deepEqual(db.calls[1].update, { display_name: "Emergency fund" });
});

test("rejects unknown accounts without writing", async () => {
  const db = mockDb({ existing: null });
  const result = await updatePlaidSavingsAccountDisplayName({
    db,
    householdId: "household-1",
    accountId: "missing",
    displayName: "Emergency fund",
  });
  assert.equal(result.status, 404);
  assert.equal(db.calls.length, 1);
});
