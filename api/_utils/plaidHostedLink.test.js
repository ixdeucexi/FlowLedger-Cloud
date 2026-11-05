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

test("finished Hosted Link sessions wait for delayed results unless an exit is explicit", () => {
  const finished = { finished_at: "2026-11-05T17:00:00Z", results: null, on_success: null, exit: null, on_exit: null };
  assert.deepEqual(hostedLinkCompletion({ link_sessions: [finished] }), { status: "pending", publicTokens: [] });
  for (const exit of [null, false, "exit", []]) {
    assert.equal(hostedLinkCompletion({ link_sessions: [{ ...finished, exit }] }).status, "pending");
  }
  assert.equal(hostedLinkCompletion({ link_sessions: [{ ...finished, on_exit: {} }] }).status, "exited");
  assert.equal(hostedLinkCompletion({ link_sessions: [{ ...finished, exit: {} }, finished] }).status, "pending");
  assert.deepEqual(hostedLinkCompletion({ link_sessions: [{ ...finished, on_success: { public_token: "public-fixture-delayed" } }] }),
    { status: "success", publicTokens: ["public-fixture-delayed"] });
});

test("new Hosted Link bank and card sessions complete with the same security bindings", () => {
  const previous = process.env.PLAID_TOKEN_ENCRYPTION_KEY;
  process.env.PLAID_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
  try {
    const now = Date.UTC(2026, 10, 5, 17);
    const payload = {
      version: 1, linkToken: "link-fixture-new-connection", userId: "fixture-user",
      householdId: "fixture-household", expiresAt: new Date(now + 60_000).toISOString(),
    };
    const scope = { userId: payload.userId, householdId: payload.householdId, now };
    for (const intent of ["bank", "credit_card"]) {
      const session = sealPlaidLinkSession({ ...payload, intent });
      assert.equal(validateHostedLinkSession(session, scope).intent, intent);
      assert.throws(() => validateHostedLinkSession(session, { ...scope, userId: "another-user" }), /expired/i);
      assert.throws(() => validateHostedLinkSession(session, { ...scope, householdId: "another-household" }), /expired/i);
      assert.throws(() => validateHostedLinkSession(session, { ...scope, now: now + 60_000 }), /expired/i);
    }
    for (const change of [
      { intent: "BANK" }, { intent: "investments" }, { intent: "" }, { intent: null },
      { version: 2 }, { linkToken: "public-invalid-token" }, { expiresAt: "not-a-date" },
    ]) {
      const session = sealPlaidLinkSession({ ...payload, intent: "bank", ...change });
      assert.throws(() => validateHostedLinkSession(session, scope), /expired/i);
    }
    const session = sealPlaidLinkSession({ ...payload, intent: "bank" });
    assert.throws(() => validateHostedLinkSession(session.slice(0, -3) + "bad", scope));
  } finally {
    if (previous == null) delete process.env.PLAID_TOKEN_ENCRYPTION_KEY;
    else process.env.PLAID_TOKEN_ENCRYPTION_KEY = previous;
  }
});
