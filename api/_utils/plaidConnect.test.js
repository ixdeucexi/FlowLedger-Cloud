const assert = require("node:assert/strict");
const test = require("node:test");

const { createPlaidConnector } = require("./plaidConnect");

const householdId = "11111111-1111-4111-8111-111111111111";

function cleanupDatabase() {
  const calls = [];
  return {
    calls,
    from(table) {
      const chain = {
        update(value) { calls.push([table, "update", value]); return chain; },
        eq(column, value) { calls.push([table, "eq", column, value]); return chain; },
        select() { return chain; },
        async maybeSingle() {
          const update = calls.findLast(call => call[1] === "update")?.[2] || {};
          return { data: { id: "new-record", status: update.status, encrypted_access_token: update.encrypted_access_token, access_token_ciphertext: update.access_token_ciphertext }, error: null };
        },
        then(resolve) { return Promise.resolve({ error: null }).then(resolve); },
      };
      return chain;
    },
  };
}

function connector({ refreshedExistingItem = false, removeFails = false } = {}) {
  const db = cleanupDatabase();
  const providerRemovals = [];
  const plaidClient = {
    async itemPublicTokenExchange() { return { data: { access_token: "plain-token", item_id: "provider-item" } }; },
    async itemGet() { return { data: { item: { institution_id: null, consent_expiration_time: null } } }; },
    async itemRemove(input) {
      providerRemovals.push(input);
      if (removeFails) throw Object.assign(new Error("provider unavailable"), { code: "INTERNAL_SERVER_ERROR" });
    },
  };
  const connect = createPlaidConnector({
    plaid: () => plaidClient,
    serviceSupabase: () => db,
    encryptAccessToken: () => "ciphertext",
    savePlaidItemConnection: async () => ({
      data: { id: "new-record", household_id: householdId, institution_name: "Bank" },
      refreshedExistingItem,
    }),
    syncItem: async () => { throw Object.assign(new Error("cross-household conflict"), { code: "PLAID_ACCOUNT_ALREADY_CONNECTED_TO_ANOTHER_HOUSEHOLD" }); },
  });
  return { connect, db, providerRemovals };
}

test("a new conflicting Plaid Item is revoked and its local token is cleared", async () => {
  const subject = connector();
  await assert.rejects(() => subject.connect({ publicToken: "public", userId: "user-1", householdId }), error => error.code === "PLAID_ACCOUNT_ALREADY_CONNECTED_TO_ANOTHER_HOUSEHOLD");
  assert.deepEqual(subject.providerRemovals, [{ access_token: "plain-token" }]);
  const removal = subject.db.calls.find(call => call[1] === "update" && call[2].status === "removed");
  assert.equal(removal[2].encrypted_access_token, null);
  assert.equal(removal[2].access_token_ciphertext, null);
  assert.ok(subject.db.calls.some(call => call[1] === "eq" && call[2] === "household_id" && call[3] === householdId));
});

test("an existing retained connection is never revoked by a cross-household preflight", async () => {
  const subject = connector({ refreshedExistingItem: true });
  await assert.rejects(() => subject.connect({ publicToken: "public", userId: "user-1", householdId }), error => error.code === "PLAID_ACCOUNT_ALREADY_CONNECTED_TO_ANOTHER_HOUSEHOLD");
  assert.equal(subject.providerRemovals.length, 0);
  assert.equal(subject.db.calls.some(call => call[1] === "update" && call[2].status === "removed"), false);
});

test("a provider cleanup failure keeps ciphertext for a verified retry and returns a typed error", async () => {
  const subject = connector({ removeFails: true });
  await assert.rejects(() => subject.connect({ publicToken: "public", userId: "user-1", householdId }), error => error.code === "PLAID_CONFLICT_CLEANUP_FAILED");
  const repair = subject.db.calls.find(call => call[1] === "update" && call[2].status === "needs_repair");
  assert.equal(repair[2].error_code, "PLAID_CONFLICT_CLEANUP_REQUIRED");
  assert.equal("encrypted_access_token" in repair[2], false);
});
