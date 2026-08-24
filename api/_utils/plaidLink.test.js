const assert = require("node:assert/strict");
const test = require("node:test");

const { buildLinkTokenRequest, LINK_INTENTS, normalizeLinkIntent, normalizeLinkPlatform, PLAID_ANDROID_PACKAGE } = require("./plaidLink");

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

test("hosted credit-card linking returns to the canonical FlowLedger URL", () => {
  const request = buildLinkTokenRequest({
    userId: "user-1",
    config: {
      redirectUri: "https://flowledger-algo.com/plaid/oauth",
      webhookUrl: "https://flowledger-algo.com/api/plaid/webhook",
    },
    intent: LINK_INTENTS.creditCard,
    hosted: true,
  });

  assert.deepEqual(request.hosted_link, {
    completion_redirect_uri: "https://flowledger-algo.com/plaid/oauth",
    is_mobile_app: false,
    url_lifetime_seconds: 1800,
  });
  assert.equal(request.redirect_uri, "https://flowledger-algo.com/plaid/oauth");
});

test("hosted linking fails closed without a canonical redirect URL", () => {
  assert.throws(() => buildLinkTokenRequest({
    userId: "user-1",
    config: {},
    intent: LINK_INTENTS.creditCard,
    hosted: true,
  }), error => error.code === "PLAID_REDIRECT_URI_MISSING");
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

test("the unified hosted connection keeps all account types available", () => {
  const request = buildLinkTokenRequest({
    userId: "user-1",
    config: { redirectUri: "https://flowledger-algo.com/plaid/oauth" },
    intent: LINK_INTENTS.bank,
    hosted: true,
  });

  assert.equal(request.account_filters, undefined);
  assert.deepEqual(request.products, ["transactions"]);
  assert.deepEqual(request.additional_consented_products, ["liabilities"]);
  assert.equal(request.hosted_link.completion_redirect_uri, "https://flowledger-algo.com/plaid/oauth");
});

test("link intent validation defaults safely and rejects unknown values", () => {
  assert.equal(normalizeLinkIntent(undefined), LINK_INTENTS.bank);
  assert.equal(normalizeLinkIntent("credit_card"), LINK_INTENTS.creditCard);
  assert.equal(normalizeLinkIntent("not-a-real-flow"), null);
});

test("native Android link is not hosted and binds exact package", () => {
  const request = buildLinkTokenRequest({
    userId: "user-1",
    config: { redirectUri: "https://flowledger-algo.com/plaid/oauth" },
    intent: LINK_INTENTS.bank,
    platform: "android",
  });
  assert.equal(request.android_package_name, PLAID_ANDROID_PACKAGE);
  assert.equal(request.android_package_name, "com.flowledger.app");
  assert.equal(request.redirect_uri, undefined);
  assert.equal(request.hosted_link, undefined);
});

test("native iOS keeps OAuth redirect but never uses Hosted Link", () => {
  const request = buildLinkTokenRequest({
    userId: "user-1",
    config: { redirectUri: "https://flowledger-algo.com/plaid/oauth" },
    intent: LINK_INTENTS.bank,
    platform: "ios",
  });
  assert.equal(request.redirect_uri, "https://flowledger-algo.com/plaid/oauth");
  assert.equal(request.hosted_link, undefined);
});

test("update mode is access-token scoped and does not request new products", () => {
  const request = buildLinkTokenRequest({
    userId: "user-1",
    config: { webhookUrl: "https://flowledger-algo.com/api/plaid/webhook" },
    intent: LINK_INTENTS.bank,
    platform: "android",
    accessToken: "access-existing",
  });
  assert.equal(request.access_token, "access-existing");
  assert.equal(request.products, undefined);
  assert.equal(request.additional_consented_products, undefined);
});

test("platform validation defaults to web and rejects spoofed clients", () => {
  assert.equal(normalizeLinkPlatform(undefined), "web");
  assert.equal(normalizeLinkPlatform("android"), "android");
  assert.equal(normalizeLinkPlatform("native-ish"), null);
  assert.throws(() => buildLinkTokenRequest({
    userId: "user-1",
    config: { redirectUri: "https://flowledger-algo.com/plaid/oauth" },
    intent: LINK_INTENTS.bank,
    platform: "ios",
    hosted: true,
  }), error => error.code === "PLAID_HOSTED_PLATFORM_INVALID");
});
