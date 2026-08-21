const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createAccountDeletionHandler,
  hasRecentVerifiedLogin,
  isAlreadyRemovedPlaidItem,
} = require("./accountDeletion");

function token(iat, sessionId = "00000000-0000-4000-8000-000000000001") {
  return `x.${Buffer.from(JSON.stringify({ iat, session_id: sessionId }), "utf8").toString("base64url")}.x`;
}

function response() {
  return {
    statusCode: 0,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test("recent-login guard fails closed for missing, old, and future-issued tokens", () => {
  assert.equal(hasRecentVerifiedLogin(token(1_000), 1_300), true);
  assert.equal(hasRecentVerifiedLogin(token(1_000), 1_601), false);
  assert.equal(hasRecentVerifiedLogin(token(1_100), 1_000), false);
  assert.equal(hasRecentVerifiedLogin("bad", 1_000), false);
});

test("Plaid already-removed errors remain retry-safe", () => {
  assert.equal(isAlreadyRemovedPlaidItem({ response: { data: { error_code: "ITEM_NOT_FOUND" } } }), true);
  assert.equal(isAlreadyRemovedPlaidItem({ error_code: "INVALID_ACCESS_TOKEN" }), true);
  assert.equal(isAlreadyRemovedPlaidItem({ error_code: "INSTITUTION_DOWN" }), false);
});

test("deletion refuses a stale session before any database mutation", async () => {
  let databaseCalls = 0;
  const handler = createAccountDeletionHandler({
    authenticatedUser: async () => ({ user: { id: "user-a" } }),
    serviceSupabase: () => { databaseCalls += 1; return {}; },
    nowSeconds: () => 2_000,
  });
  const res = response();
  await handler({ method: "POST", body: { confirmation: "DELETE" }, headers: { authorization: `Bearer ${token(1_000)}` } }, res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, "RECENT_LOGIN_REQUIRED");
  assert.equal(databaseCalls, 0);
});

test("deletion blocks shared-household owners before Plaid or cleanup", async () => {
  let queryCalls = 0;
  const client = {
    rpc: async name => {
      if (name === "verify_recent_account_deletion_session") return { data: true, error: null };
      assert.equal(name, "inspect_account_deletion");
      return { data: { blockedHouseholds: [{ name: "Family", memberCount: 2 }] }, error: null };
    },
    from: () => { queryCalls += 1; throw new Error("must not query"); },
  };
  const handler = createAccountDeletionHandler({
    authenticatedUser: async () => ({ user: { id: "user-a" } }),
    serviceSupabase: () => client,
    nowSeconds: () => 1_100,
  });
  const res = response();
  await handler({ method: "POST", body: { confirmation: "DELETE" }, headers: { authorization: `Bearer ${token(1_000)}` } }, res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, "HOUSEHOLD_OWNER_TRANSFER_REQUIRED");
  assert.equal(queryCalls, 0);
});

test("a refreshed token cannot make an old Auth session recent", async () => {
  const rpcCalls = [];
  const client = {
    rpc: async name => {
      rpcCalls.push(name);
      assert.equal(name, "verify_recent_account_deletion_session");
      return { data: false, error: null };
    },
  };
  const handler = createAccountDeletionHandler({
    authenticatedUser: async () => ({ user: { id: "user-a" } }),
    serviceSupabase: () => client,
    nowSeconds: () => 1_100,
  });
  const res = response();
  await handler({ method: "POST", body: { confirmation: "DELETE" }, headers: { authorization: `Bearer ${token(1_099)}` } }, res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, "RECENT_LOGIN_REQUIRED");
  assert.deepEqual(rpcCalls, ["verify_recent_account_deletion_session"]);
});

test("deletion prepares application cleanup before deleting Auth and finalizes its receipt last", async () => {
  const events = [];
  const client = {
    rpc: async name => {
      events.push(name);
      if (name === "verify_recent_account_deletion_session") return { data: true, error: null };
      if (name === "inspect_account_deletion") return { data: { blockedHouseholds: [] }, error: null };
      if (name === "prepare_account_deletion") {
        return { data: { receiptId: "receipt-a", status: "data_deleted" }, error: null };
      }
      assert.equal(name, "complete_account_deletion");
      assert.deepEqual(events, ["verify_recent_account_deletion_session", "inspect_account_deletion", "prepare_account_deletion", "delete_auth_user", "complete_account_deletion"]);
      return { data: { receiptId: "receipt-a", status: "completed" }, error: null };
    },
    from: table => {
      assert.equal(table, "plaid_items");
      return {
        select: () => ({ eq: async () => ({ data: [], error: null }) }),
      };
    },
    auth: {
      admin: {
        deleteUser: async () => {
          events.push("delete_auth_user");
          return { error: null };
        },
      },
    },
  };
  const handler = createAccountDeletionHandler({
    authenticatedUser: async () => ({ user: { id: "user-a" } }),
    serviceSupabase: () => client,
    nowSeconds: () => 1_100,
  });
  const res = response();
  await handler({ method: "POST", body: { confirmation: "DELETE" }, headers: { authorization: `Bearer ${token(1_000)}` } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.receipt.status, "completed");
});
