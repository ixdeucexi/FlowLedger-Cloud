const assert = require("node:assert/strict");
const test = require("node:test");
const { createLinkTokenHandler } = require("../plaid/create-link-token");
const { createPlaidStatusHandler } = require("../plaid/status");

function response() { return { statusCode: 0, payload: null, status(code) { this.statusCode = code; return this; }, json(value) { this.payload = value; return this; } }; }

for (const admin of [false, true]) test(`${admin ? "actual app-admin" : "new ordinary Pro"} Link request keeps the intended history policy`, async () => {
  let request, registryQueries = 0;
  const db = { from(table) { assert.equal(table, "feedback_admins"); registryQueries += 1;
    return { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: admin ? { user_id: "actor" } : null, error: null }; } };
  } };
  const handler = createLinkTokenHandler({
    authenticatedUser: async () => ({ user: { id: "actor" } }), serviceSupabase: () => db,
    authorizeProHousehold: async () => ({ ok: true, householdId: "house" }),
    plaidOptions: () => ({ redirectUri: "https://example.test/plaid/oauth" }),
    plaid: () => ({ async linkTokenCreate(input) { request = input; return { data: { link_token: "link-fixture", expiration: "2030-01-01T00:00:00Z", hosted_link_url: "https://example.test/link" } }; } }),
    sealPlaidLinkSession: () => "fictional-sealed-session",
  });
  const res = response(); await handler({ method: "POST", headers: {}, body: { platform: "web", intent: "bank" } }, res);
  assert.equal(res.statusCode, 200); assert.equal(registryQueries, 1);
  assert.equal(request.transactions.days_requested === 90, admin);
  if (!admin) assert(request.transactions.days_requested >= 60 && request.transactions.days_requested <= 63);
  assert.deepEqual(request.products, ["transactions"]); assert.deepEqual(request.additional_consented_products, ["liabilities"]);
});

test("update/reconnect never requests a new import profile or resets product history", async () => {
  let request;
  const handler = createLinkTokenHandler({
    authenticatedUser: async () => ({ user: { id: "actor" } }),
    serviceSupabase: () => ({ from(table) { assert.equal(table, "plaid_items"); return {
      select() { return this; }, eq() { return this; }, neq() { return this; }, async maybeSingle() { return { data: { id: "old-item", encrypted_access_token: "old-cipher" }, error: null }; },
    }; } }),
    authorizeProHousehold: async () => ({ ok: true, householdId: "house" }),
    newConnectionImportProfile: () => { throw new Error("Reconnect cannot opt in legacy/admin imports"); },
    decryptAccessToken: () => "old-token", plaidOptions: () => ({}),
    plaid: () => ({ async linkTokenCreate(value) { request = value; return { data: { link_token: "link-update", expiration: "2030-01-01T00:00:00Z" } }; } }),
  });
  const res = response(); await handler({ method: "POST", headers: {}, body: { platform: "android", mode: "update", item_id: "old-item" } }, res);
  assert.equal(res.statusCode, 200); assert.equal(request.access_token, "old-token");
  assert.equal(Object.hasOwn(request, "transactions"), false); assert.equal(Object.hasOwn(request, "products"), false);
});

function statusDatabase() {
  const tables = {
    plaid_items: [{ id: "active", user_id: "actor", household_id: "house", institution_name: "Fresh bank", status: "active", initial_import_version: 1, initial_import_from: "2026-09-05", initial_history_complete_at: null },
      { id: "cleanup", user_id: "actor", household_id: "house", status: "removed" },
      { id: "removed", user_id: "actor", household_id: "house", status: "removed" },
      { id: "foreign", user_id: "other", household_id: "elsewhere", status: "active" }],
    plaid_accounts: [{ id: "a", user_id: "actor", household_id: "house", plaid_item_record_id: "active", is_active: true },
      { id: "b", user_id: "actor", household_id: "house", plaid_item_record_id: "cleanup", is_active: true },
      { id: "c", user_id: "actor", household_id: "house", plaid_item_record_id: "removed", is_active: false },
      { id: "d", user_id: "other", household_id: "elsewhere", plaid_item_record_id: "foreign", is_active: true }],
    bills: [],
  };
  const queries = [];
  return { queries, from(table) { const filters = [];const q = {
    select() { return q; }, eq(k, v) { filters.push(r => r[k] === v); return q; }, neq(k, v) { filters.push(r => r[k] !== v); return q; },
    in(k, values) { filters.push(r => values.includes(r[k])); return q; }, order() { return q; },
    then(resolve) { const data = tables[table].filter(r => filters.every(f => f(r)));queries.push({ table, ids: data.map(r => r.id) }); return Promise.resolve({ data, error: null }).then(resolve); },
  };return q; } };
}

test("status retains an explicit owned cleanup retry after unlink account retirement fails", async () => {
  const db = statusDatabase();const handler = createPlaidStatusHandler({ authenticatedUser: async () => ({ user: { id: "actor" } }),
    serviceSupabase: () => db, authorizeProHousehold: async () => ({ ok: true, householdId: "house" }),
  });
  const res = response();await handler({ method: "GET", headers: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload.items.map(i => i.id), ["active", "cleanup"]);
  const cleanup = res.payload.items.find(i => i.id === "cleanup");assert.equal(cleanup.disconnect_cleanup_needed, true); assert.equal(cleanup.can_disconnect, true);
  assert.equal(res.payload.items[0].history_status, "importing"); assert.equal(res.payload.items[0].disconnect_cleanup_needed, false);
  assert.deepEqual(res.payload.accounts.map(i => i.id), ["a", "b"]);
  assert.equal(JSON.stringify(res.payload).includes("foreign"), false);assert.equal(JSON.stringify(res.payload).includes("encrypted_access_token"), false);
});

test("status permissions fail before loading connection data", async () => {
  let reads = 0; const handler = createPlaidStatusHandler({ authenticatedUser: async () => ({ user: { id: "viewer" } }),
    authorizeProHousehold: async () => ({ ok: false, status: 403, error: "HOUSEHOLD_EDIT_REQUIRED" }),
    serviceSupabase: () => { reads += 1; throw new Error("No unauthorized reads"); },
  });
  const res = response();await handler({ method: "GET", headers: {} }, res);
  assert.equal(res.statusCode, 403);assert.equal(reads, 0);
});
