const assert = require("node:assert/strict");
const test = require("node:test");

const { createDisconnectHandler, plaidRemovalAlreadyComplete } = require("../plaid/disconnect");

test("Plaid disconnect tolerates only an already removed Item", () => {
  assert.equal(plaidRemovalAlreadyComplete({ response: { data: { error_code: "ITEM_NOT_FOUND" } } }), true);
  assert.equal(plaidRemovalAlreadyComplete({ error_code: "INVALID_ACCESS_TOKEN" }), true);
  assert.equal(plaidRemovalAlreadyComplete({ response: { data: { error_code: "INSTITUTION_DOWN" } } }), false);
  assert.equal(plaidRemovalAlreadyComplete(new Error("network")), false);
});

function subject(options = {}) {
  const rows = {
    plaid_items: [
      { id: "item-1", user_id: "user-1", household_id: "house-1", status: "active", encrypted_access_token: "cipher", access_token_ciphertext: "cipher" },
      { id: "foreign-item", user_id: "other-user", household_id: "other-house", status: "active", encrypted_access_token: "foreign-cipher" },
    ],
    plaid_accounts: [
      { id: "checking", user_id: "user-1", household_id: "house-1", plaid_item_record_id: "item-1", is_active: true },
      { id: "savings", user_id: "user-1", household_id: "house-1", plaid_item_record_id: "item-1", is_active: true },
      { id: "retained-bank", user_id: "user-1", household_id: "house-1", plaid_item_record_id: "item-2", is_active: true },
      { id: "foreign-account", user_id: "other-user", household_id: "other-house", plaid_item_record_id: "foreign-item", is_active: true },
    ],
    transactions: [{ id: "posted-purchase", amount: -25, bill_id: "bill-1" }],
    bills: [{ id: "bill-1", amount: 25 }],
    pending_plan_matches: [{ id: "match-1", status: "ready_review" }],
  };
  if (options.removed) Object.assign(rows.plaid_items[0], { status: "removed", encrypted_access_token: null, access_token_ciphertext: null });
  if (options.missingToken) Object.assign(rows.plaid_items[0], { encrypted_access_token: null, access_token_ciphertext: null });
  const calls = [], providerCalls = [], leases = [];
  let failAccounts = Boolean(options.failAccounts);
  const db = {
    from(table) {
      calls.push({ table, operation: "from" });
      assert(["plaid_items", "plaid_accounts"].includes(table), "Unlink must never alter historical financial tables");
      const filters = []; let update;
      const run = () => {
        const matches = rows[table].filter(row => filters.every(([key, value]) => row[key] === value));
        if (update) {
          if (table === "plaid_accounts" && failAccounts) return { data: null, error: new Error("Account retirement failed") };
          for (const row of matches) Object.assign(row, update);
          calls.push({ table, operation: "update", filters: [...filters], update });
        }
        return { data: matches.map(row => ({ ...row })), error: null };
      };
      const chain = {
        select() { return chain; },
        update(value) { update = value; return chain; },
        eq(key, value) { filters.push([key, value]); return chain; },
        async maybeSingle() { const result = run(); return { ...result, data: result.data?.[0] ?? null }; },
        then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject); },
      };
      return chain;
    },
  };
  const handler = createDisconnectHandler({
    authenticatedUser: async () => options.signedOut ? { user: null, error: "SIGNED_OUT" } : { user: { id: "user-1" } },
    serviceSupabase: () => db,
    authorizeProHousehold: async () => options.viewer ? { ok: false, status: 403, error: "EDITOR_REQUIRED", message: "Edit access required" } : { ok: true, householdId: "house-1" },
    decryptAccessToken: value => { assert.equal(value, "cipher"); return "fictional-provider-token"; },
    plaid: () => ({ async itemRemove(payload) { providerCalls.push(payload); if (options.providerError) throw options.providerError; } }),
    withPlaidSyncLock: async (scope, work) => {
      leases.push({ itemId: scope.itemId, userId: scope.userId });
      if (options.busy) throw Object.assign(new Error("Already syncing"), { code: "PLAID_SYNC_ALREADY_RUNNING" });
      if (options.disappearAfterLock) rows.plaid_items.splice(0, 1);
      return work();
    },
  });
  const request = async (itemId = "item-1") => {
    const res = { code: 0, data: null, status(code) { this.code = code; return this; }, json(value) { this.data = value; return this; } };
    await handler({ method: "POST", body: { item_id: itemId } }, res);
    return res;
  };
  return { request, rows, calls, providerCalls, leases, allowAccountsRetry() { failAccounts = false; } };
}

test("whole-bank unlink retires only the owned connection accounts and preserves all history", async () => {
  const s = subject();
  const history = structuredClone({ transactions: s.rows.transactions, bills: s.rows.bills, pending_plan_matches: s.rows.pending_plan_matches });
  const result = await s.request();
  assert.equal(result.code, 200);
  assert.deepEqual(result.data, { ok: true, status: "disconnected" });
  assert.equal(s.providerCalls.length, 1);
  assert.deepEqual(s.leases, [{ itemId: "item-1", userId: "user-1" }]);
  assert.equal(s.rows.plaid_items[0].status, "removed");
  assert.equal(s.rows.plaid_items[0].encrypted_access_token, null);
  assert.equal(s.rows.plaid_items[0].access_token_ciphertext, null);
  assert.deepEqual(s.rows.plaid_accounts.map(row => row.is_active), [false, false, true, true]);
  assert.deepEqual({ transactions: s.rows.transactions, bills: s.rows.bills, pending_plan_matches: s.rows.pending_plan_matches }, history);
  for (const call of s.calls.filter(call => call.operation === "update")) {
    assert(call.filters.some(([key, value]) => key === "user_id" && value === "user-1"));
    assert(call.filters.some(([key, value]) => key === "household_id" && value === "house-1"));
    assert(call.filters.some(([key, value]) => key === (call.table === "plaid_items" ? "id" : "plaid_item_record_id") && value === "item-1"));
  }
});

test("provider failure preserves tokens and active accounts for a verified retry", async () => {
  const s = subject({ providerError: new Error("Provider unavailable") });
  const before = structuredClone(s.rows);
  const result = await s.request();
  assert.equal(result.code, 500);
  assert.deepEqual(s.rows, before);
});

test("partial local failure can finish account retirement without reusing a cleared token", async () => {
  const s = subject({ failAccounts: true });
  assert.equal((await s.request()).code, 500);
  assert.equal(s.rows.plaid_items[0].status, "removed");
  assert.equal(s.rows.plaid_accounts[0].is_active, true);
  s.allowAccountsRetry();
  assert.equal((await s.request()).code, 200);
  assert.equal(s.providerCalls.length, 1);
  assert.equal(s.rows.plaid_accounts[0].is_active, false);
});

test("already removed items finish ghost account retirement without a provider request", async () => {
  const s = subject({ removed: true });
  assert.equal((await s.request()).code, 200);
  assert.equal(s.providerCalls.length, 0);
  assert.equal(s.rows.plaid_accounts[0].is_active, false);
  assert.equal((await s.request()).code, 200);
  assert.equal(s.providerCalls.length, 0);
});

test("an already removed provider Item still finishes scoped local unlink", async () => {
  const s = subject({ providerError: { response: { data: { error_code: "ITEM_NOT_FOUND" } } } });
  assert.equal((await s.request()).code, 200);
  assert.equal(s.rows.plaid_items[0].status, "removed");
  assert.equal(s.rows.plaid_accounts[0].is_active, false);
});

test("busy sync returns a retryable conflict without removing the provider or local accounts", async () => {
  const s = subject({ busy: true }); const before = structuredClone(s.rows);
  const result = await s.request();
  assert.equal(result.code, 409);
  assert.equal(result.data.error, "PLAID_SYNC_ALREADY_RUNNING");
  assert.equal(s.providerCalls.length, 0);
  assert.deepEqual(s.rows, before);
});

test("foreign and disappeared Items cannot reach the provider or alter accounts", async () => {
  const foreign = subject();
  assert.equal((await foreign.request("foreign-item")).code, 404);
  assert.equal(foreign.providerCalls.length, 0);
  assert.equal(foreign.leases.length, 0);
  const disappeared = subject({ disappearAfterLock: true });
  assert.equal((await disappeared.request()).code, 404);
  assert.equal(disappeared.providerCalls.length, 0);
  assert(disappeared.rows.plaid_accounts.every(row => row.is_active));
});

test("viewers and signed-out users never look up or mutate connections", async () => {
  for (const [options, code] of [[{ viewer: true }, 403], [{ signedOut: true }, 401]]) {
    const s = subject(options);
    assert.equal((await s.request()).code, code);
    assert.equal(s.calls.length, 0);
    assert.equal(s.providerCalls.length, 0);
  }
});

test("an active connection with a missing token is not falsely reported as unlinked", async () => {
  const s = subject({ missingToken: true });
  assert.equal((await s.request()).code, 500);
  assert.equal(s.providerCalls.length, 0);
  assert.equal(s.rows.plaid_items[0].status, "active");
  assert(s.rows.plaid_accounts.every(row => row.is_active));
});
