const assert = require("node:assert/strict");
const test = require("node:test");

const { sealPlaidLinkSession } = require("./crypto");
const { hostedLinkCompletion, validateHostedLinkSession } = require("./plaidHostedLink");

test("hosted Plaid sessions are encrypted, user-bound, household-bound, and expiring", () => {
  const previous = process.env.PLAID_TOKEN_ENCRYPTION_KEY;
  process.env.PLAID_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  try {
    const now = Date.UTC(2026, 7, 4, 23, 30);
    const sealed = sealPlaidLinkSession({
      version: 1,
      linkToken: "link-production-secret",
      userId: "user-1",
      householdId: "house-1",
      intent: "credit_card",
      expiresAt: new Date(now + 60_000).toISOString(),
    });
    assert.equal(sealed.includes("link-production-secret"), false);
    assert.equal(validateHostedLinkSession(sealed, { userId: "user-1", householdId: "house-1", now }).linkToken, "link-production-secret");
    assert.throws(() => validateHostedLinkSession(sealed, { userId: "user-2", householdId: "house-1", now }), /expired/i);
    assert.throws(() => validateHostedLinkSession(sealed, { userId: "user-1", householdId: "house-2", now }), /expired/i);
    assert.throws(() => validateHostedLinkSession(sealed, { userId: "user-1", householdId: "house-1", now: now + 60_001 }), /expired/i);
  } finally {
    if (previous == null) delete process.env.PLAID_TOKEN_ENCRYPTION_KEY;
    else process.env.PLAID_TOKEN_ENCRYPTION_KEY = previous;
  }
});

test("Hosted Link completion waits, reports exits, and extracts deduplicated public tokens", () => {
  assert.deepEqual(hostedLinkCompletion({ link_sessions: [] }), { status: "pending", publicTokens: [] });
  assert.deepEqual(hostedLinkCompletion({ link_sessions: [{ finished_at: null }] }), { status: "pending", publicTokens: [] });
  assert.deepEqual(hostedLinkCompletion({ link_sessions: [{ finished_at: "2026-08-04T23:31:00Z", exit: {} }] }), { status: "exited", publicTokens: [] });
  assert.deepEqual(hostedLinkCompletion({
    link_sessions: [{
      finished_at: "2026-08-04T23:31:00Z",
      results: { item_add_results: [{ public_token: "public-one" }, { public_token: "public-one" }, { public_token: "public-two" }] },
    }],
  }), { status: "success", publicTokens: ["public-one", "public-two"] });
});
