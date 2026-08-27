const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  createAccountDeletionHandler,
  disconnectPlaidItems,
  deleteRevenueCatCustomer,
  hasRecentVerifiedLogin,
  isAlreadyRemovedPlaidItem,
  userUsesApple,
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

test("account deletion reuses the feedback function on the free Vercel plan", () => {
  const root = path.resolve(__dirname, "..", "..");
  const vercel = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
  assert.ok(vercel.rewrites.some(route => route.source === "/api/account/delete"
    && route.destination === "/api/feedback?accountAction=delete"));
  const feedback = fs.readFileSync(path.join(root, "api", "feedback.js"), "utf8");
  assert.match(feedback, /accountAction === "delete"/);
  assert.equal(fs.existsSync(path.join(root, "api", "account", "delete.js")), false);
});

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

test("billing processor deletion is retry-safe only for success or an absent customer", async () => {
  const calls = [];
  await deleteRevenueCatCustomer("user-a", { revenueCatSecretApiKey: "secret", fetch: async (url, init) => { calls.push({ url, init }); return { ok: false, status: 404 }; } });
  assert.match(calls[0].url, /subscribers\/user-a$/);
  assert.equal(calls[0].init.method, "DELETE");
  await assert.rejects(() => deleteRevenueCatCustomer("user-a", { revenueCatSecretApiKey: "secret", fetch: async () => ({ ok: false, status: 503 }) }), /REVENUECAT_CUSTOMER_DELETION_FAILED/);
});

test("Apple provider deletion is detected from the authenticated identity", () => {
  assert.equal(userUsesApple({ app_metadata: { providers: ["google", "apple"] } }), true);
  assert.equal(userUsesApple({ app_metadata: { provider: "google" } }), false);
});

test("deletion revokes Plaid items owned by the user or their single-member household", async () => {
  const removed = [];
  const updated = [];
  let plaidSelectCount = 0;
  const client = {
    from(table) {
      if (table === "households") return { select: () => ({ eq: async () => ({ data: [{ id: "house-a" }], error: null }) }) };
      assert.equal(table, "plaid_items");
      return {
        select: () => {
          plaidSelectCount += 1;
          return plaidSelectCount === 1
            ? { eq: async () => ({ data: [{ id: "item-user", encrypted_access_token: "user-token" }], error: null }) }
            : { in: async () => ({ data: [{ id: "item-household", encrypted_access_token: "house-token" }], error: null }) };
        },
        update: () => ({ eq: async (_column, id) => { updated.push(id); return { error: null }; } }),
      };
    },
  };
  const count = await disconnectPlaidItems(client, "user-a", {
    decryptAccessToken: value => value,
    plaid: () => ({ itemRemove: async ({ access_token }) => removed.push(access_token) }),
  });
  assert.equal(count, 2);
  assert.deepEqual(removed.sort(), ["house-token", "user-token"]);
  assert.deepEqual(updated.sort(), ["item-household", "item-user"]);
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
    revenueCatSecretApiKey: "secret",
    fetch: async () => ({ ok: false, status: 404 }),
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
    revenueCatSecretApiKey: "secret",
    fetch: async () => ({ ok: false, status: 404 }),
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
      if (name === "inspect_account_deletion") return { data: { blockedHouseholds: [], billingCustomerExists: false }, error: null };
      if (name === "prepare_account_deletion") {
        return { data: { receiptId: "receipt-a", status: "data_deleted" }, error: null };
      }
      assert.equal(name, "complete_account_deletion");
      assert.deepEqual(events, ["verify_recent_account_deletion_session", "inspect_account_deletion", "prepare_account_deletion", "delete_auth_user", "complete_account_deletion"]);
      return { data: { receiptId: "receipt-a", status: "completed" }, error: null };
    },
    from: table => {
      assert.ok(["households", "plaid_items"].includes(table));
      return { select: () => ({ eq: async () => ({ data: [], error: null }) }) };
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

test("Founding Free deletion skips RevenueCat when no billing customer exists", async () => {
  let billingCalls = 0;
  const client = {
    rpc: async name => {
      if (name === "verify_recent_account_deletion_session") return { data: true, error: null };
      if (name === "inspect_account_deletion") {
        return { data: { blockedHouseholds: [], billingCustomerExists: false }, error: null };
      }
      if (name === "prepare_account_deletion") return { data: { receiptId: "receipt-free" }, error: null };
      if (name === "complete_account_deletion") return { data: { receiptId: "receipt-free", status: "completed" }, error: null };
      throw new Error(`Unexpected RPC ${name}`);
    },
    from: table => {
      assert.ok(["households", "plaid_items"].includes(table));
      return { select: () => ({ eq: async () => ({ data: [], error: null }) }) };
    },
    auth: { admin: { deleteUser: async () => ({ error: null }) } },
  };
  const handler = createAccountDeletionHandler({
    authenticatedUser: async () => ({ user: { id: "user-free" } }),
    serviceSupabase: () => client,
    nowSeconds: () => 1_100,
    revenueCatSecretApiKey: null,
    fetch: async () => { billingCalls += 1; return { ok: true, status: 200 }; },
  });
  const res = response();
  await handler({ method: "POST", body: { confirmation: "DELETE" }, headers: { authorization: `Bearer ${token(1_000)}` } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(billingCalls, 0);
});

test("billing deletion fails closed when a customer exists but the secret is missing", async () => {
  let dataCleanupStarted = false;
  const client = {
    rpc: async name => {
      if (name === "verify_recent_account_deletion_session") return { data: true, error: null };
      if (name === "inspect_account_deletion") {
        return { data: { blockedHouseholds: [], billingCustomerExists: true }, error: null };
      }
      dataCleanupStarted = true;
      throw new Error(`Unexpected RPC ${name}`);
    },
  };
  const handler = createAccountDeletionHandler({
    authenticatedUser: async () => ({ user: { id: "user-billing" } }),
    serviceSupabase: () => client,
    nowSeconds: () => 1_100,
    revenueCatSecretApiKey: null,
  });
  const res = response();
  await handler({ method: "POST", body: { confirmation: "DELETE" }, headers: { authorization: `Bearer ${token(1_000)}` } }, res);
  assert.equal(res.statusCode, 502);
  assert.equal(res.body.error, "BILLING_CUSTOMER_DELETION_FAILED");
  assert.equal(dataCleanupStarted, false);
});

test("deletion fails closed when billing inspection omits its provider-history result", async () => {
  let dataCleanupStarted = false;
  let appleRevocationStarted = false;
  const client = {
    rpc: async name => {
      if (name === "verify_recent_account_deletion_session") return { data: true, error: null };
      if (name === "inspect_account_deletion") {
        return { data: { blockedHouseholds: [] }, error: null };
      }
      dataCleanupStarted = true;
      throw new Error(`Unexpected RPC ${name}`);
    },
  };
  const handler = createAccountDeletionHandler({
    authenticatedUser: async () => ({
      user: {
        id: "user-unknown-billing",
        app_metadata: { providers: ["apple"] },
      },
    }),
    serviceSupabase: () => client,
    nowSeconds: () => 1_100,
    revokeAppleAuthorization: async () => { appleRevocationStarted = true; },
  });
  const res = response();
  await handler({ method: "POST", body: { confirmation: "DELETE" }, headers: { authorization: `Bearer ${token(1_000)}` } }, res);
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.error, "ACCOUNT_DELETION_FAILED");
  assert.equal(dataCleanupStarted, false);
  assert.equal(appleRevocationStarted, false);
});
