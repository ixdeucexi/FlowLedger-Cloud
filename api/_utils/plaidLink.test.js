const assert = require("node:assert/strict");
const test = require("node:test");

const { buildLinkTokenRequest, LINK_INTENTS, normalizeLinkIntent } = require("./plaidLink");

test("credit-card linking opens a new Plaid session limited to credit accounts", () => {
  const request = buildLinkTokenRequest({
    userId: "user-1",
    config: { webhookUrl: "https://flowledger-algo.com/api/plaid/webhook" },
    intent: LINK_INTENTS.creditCard,
  });

  assert.deepEqual(request.products, ["transactions"]);
  assert.deepEqual(request.additional_consented_products, ["liabilities"]);
  assert.deepEqual(request.account_filters, {
    credit: { account_subtypes: ["all"] },
  });
  assert.equal(request.webhook, "https://flowledger-algo.com/api/plaid/webhook");
});

test("general bank linking remains available without hiding non-credit accounts", () => {
  const request = buildLinkTokenRequest({
    userId: "user-1",
    config: { redirectUri: "https://flowledger-algo.com/more" },
    intent: LINK_INTENTS.bank,
  });

  assert.equal(request.account_filters, undefined);
  assert.equal(request.redirect_uri, "https://flowledger-algo.com/more");
});

test("link intent validation defaults safely and rejects unknown values", () => {
  assert.equal(normalizeLinkIntent(undefined), LINK_INTENTS.bank);
  assert.equal(normalizeLinkIntent("credit_card"), LINK_INTENTS.creditCard);
  assert.equal(normalizeLinkIntent("not-a-real-flow"), null);
});
