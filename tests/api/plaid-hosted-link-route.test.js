const assert = require("node:assert/strict");
const test = require("node:test");

function responseRecorder() {
  return {
    statusCode: null,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
}

test("credit-card linking creates and completes an authenticated Hosted Link session", async t => {
  const previousKey = process.env.PLAID_TOKEN_ENCRYPTION_KEY;
  process.env.PLAID_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 11).toString("base64");
  const plaidModule = require("../../api/_utils/plaid");
  const supabaseModule = require("../../api/_utils/supabase");
  const accessModule = require("../../api/_utils/plaidAccess");
  const connectModule = require("../../api/_utils/plaidConnect");
  const requests = [];
  const connected = [];
  const plaidClient = {
    async linkTokenCreate(request) {
      requests.push(request);
      return { data: {
        link_token: "link-production-hosted",
        expiration: "2099-08-04T23:59:00Z",
        hosted_link_url: "https://secure.plaid.com/link/hosted-session",
      } };
    },
    async linkTokenGet({ link_token }) {
      assert.equal(link_token, "link-production-hosted");
      return { data: { link_sessions: [{
        finished_at: "2026-08-04T23:50:00Z",
        results: { item_add_results: [{ public_token: "public-production-card" }] },
      }] } };
    },
  };

  t.mock.method(plaidModule, "plaid", () => plaidClient);
  t.mock.method(plaidModule, "plaidOptions", () => ({
    redirectUri: "https://flowledger-algo.com/plaid/oauth",
    webhookUrl: "https://flowledger-algo.com/api/plaid/webhook",
  }));
  t.mock.method(supabaseModule, "authenticatedUser", async () => ({ user: { id: "user-1" } }));
  t.mock.method(accessModule, "authorizeProHousehold", async () => ({ ok: true, householdId: "house-1" }));
  t.mock.method(connectModule, "connectPlaidPublicToken", async input => {
    connected.push(input);
    return {
      item_id: "item-row-1",
      institution_name: "Connected bank",
      already_connected: false,
      accounts_count: 1,
      credit_cards_count: 1,
      credit_card_debts_count: 1,
      liability_details_available: true,
      transactions_count: 3,
      transactions_pending: false,
    };
  });

  try {
    delete require.cache[require.resolve("../../api/plaid/create-link-token")];
    delete require.cache[require.resolve("../../api/plaid/exchange-public-token")];
    const createLinkToken = require("../../api/plaid/create-link-token");
    const exchangePublicToken = require("../../api/plaid/exchange-public-token");

    const createResponse = responseRecorder();
    await createLinkToken({ method: "POST", body: { intent: "credit_card" }, headers: {} }, createResponse);
    assert.equal(createResponse.statusCode, 200);
    assert.equal(createResponse.payload.hosted_link_url, "https://secure.plaid.com/link/hosted-session");
    assert.equal(createResponse.payload.hosted_session.includes("link-production-hosted"), false);
    assert.equal(requests[0].hosted_link.completion_redirect_uri, "https://flowledger-algo.com/plaid/oauth");

    const exchangeResponse = responseRecorder();
    await exchangePublicToken({
      method: "POST",
      body: { hosted_session: createResponse.payload.hosted_session },
      headers: { "x-flowledger-household-id": "house-1" },
    }, exchangeResponse);
    assert.equal(exchangeResponse.statusCode, 200);
    assert.equal(exchangeResponse.payload.credit_card_debts_count, 1);
    assert.deepEqual(connected, [{ publicToken: "public-production-card", userId: "user-1", householdId: "house-1" }]);
  } finally {
    if (previousKey == null) delete process.env.PLAID_TOKEN_ENCRYPTION_KEY;
    else process.env.PLAID_TOKEN_ENCRYPTION_KEY = previousKey;
  }
});
