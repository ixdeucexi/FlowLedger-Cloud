const assert = require("node:assert/strict");
const test = require("node:test");

const { createDisconnectHandler } = require("../plaid/disconnect");

const householdId = "11111111-1111-4111-8111-111111111111";

function response() {
  return {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
}

function itemDatabase(item = { id: "item-1", encrypted_access_token: "ciphertext" }) {
  const calls = [];
  return {
    calls,
    from(table) {
      const chain = {
        select() { calls.push([table, "select"]); return chain; },
        update(value) { calls.push([table, "update", value]); return chain; },
        eq(column, value) { calls.push([table, "eq", column, value]); return chain; },
        async maybeSingle() { return { data: item, error: null }; },
        then(resolve) { return Promise.resolve({ error: null }).then(resolve); },
      };
      return chain;
    },
  };
}

test("Plaid disconnect denies a viewer before item lookup or Plaid removal", async () => {
  let databaseReads = 0;
  let plaidRemovals = 0;
  const handler = createDisconnectHandler({
    authenticatedUser: async () => ({ user: { id: "user-1" }, error: null }),
    serviceSupabase: () => ({ from() { databaseReads += 1; throw new Error("item lookup should not run"); } }),
    authorizeProHousehold: async () => ({ ok: false, status: 403, error: "HOUSEHOLD_EDIT_REQUIRED", message: "Edit access required." }),
    plaid: () => ({ async itemRemove() { plaidRemovals += 1; } }),
  });
  const res = response();

  await handler({ method: "POST", headers: { "x-flowledger-household-id": householdId }, body: { item_id: "item-1" } }, res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.payload.error, "HOUSEHOLD_EDIT_REQUIRED");
  assert.equal(databaseReads, 0);
  assert.equal(plaidRemovals, 0);
});

test("Plaid disconnect scopes the item and local update to user and household", async () => {
  const db = itemDatabase();
  let plaidRemovals = 0;
  const handler = createDisconnectHandler({
    authenticatedUser: async () => ({ user: { id: "user-1" }, error: null }),
    serviceSupabase: () => db,
    authorizeProHousehold: async (_userId, requested) => ({ ok: true, householdId: requested }),
    plaid: () => ({ async itemRemove(input) { plaidRemovals += 1; assert.equal(input.access_token, "plain-token"); } }),
    decryptAccessToken: () => "plain-token",
  });
  const res = response();

  await handler({ method: "POST", headers: { "x-flowledger-household-id": householdId }, body: { item_id: "item-1" } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(plaidRemovals, 1);
  assert.ok(db.calls.some(call => call[1] === "eq" && call[2] === "household_id" && call[3] === householdId));
  assert.equal(db.calls.filter(call => call[1] === "eq" && call[2] === "household_id").length, 2);
});
