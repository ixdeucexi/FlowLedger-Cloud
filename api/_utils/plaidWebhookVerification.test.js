const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const test = require("node:test");

const { createPlaidWebhookHandler } = require("../plaid/webhook");
const { PlaidWebhookReplayGuard, verifyPlaidWebhook } = require("./plaidWebhookVerification");

async function signedFixture({ issuedAt, body = '{"item_id":"item-1"}', signingKey, publicJwk, alg = "ES256" } = {}) {
  const { exportJWK, generateKeyPair, SignJWT } = await import("jose");
  const pair = signingKey ? null : await generateKeyPair("ES256");
  const privateKey = signingKey || pair.privateKey;
  const jwk = publicJwk || { ...(await exportJWK(pair.publicKey)), alg: "ES256", kid: "key-1", use: "sig" };
  const nowSeconds = issuedAt || Math.floor(Date.now() / 1000);
  const token = await new SignJWT({ request_body_sha256: createHash("sha256").update(body).digest("hex") })
    .setProtectedHeader({ alg, kid: jwk.kid, typ: "JWT" })
    .setIssuedAt(nowSeconds)
    .sign(privateKey);
  return { body, jwk, nowSeconds, token };
}

function plaidKeyClient(jwk) {
  return { async webhookVerificationKeyGet() { return { data: { key: jwk } }; } };
}

test("valid Plaid webhook signature verifies its exact raw body", async () => {
  const fixture = await signedFixture();
  const result = await verifyPlaidWebhook(fixture.body, { "Plaid-Verification": fixture.token }, {
    plaidClient: plaidKeyClient(fixture.jwk),
    now: fixture.nowSeconds * 1000,
    keyCache: new Map(),
  });

  assert.match(result.fingerprint, /^[a-f0-9]{64}$/);
});

test("Plaid webhook verification rejects a body mismatch and stale token", async () => {
  const fixture = await signedFixture();
  await assert.rejects(
    verifyPlaidWebhook(`${fixture.body} `, { "plaid-verification": fixture.token }, {
      plaidClient: plaidKeyClient(fixture.jwk),
      now: fixture.nowSeconds * 1000,
      keyCache: new Map(),
    }),
    error => error.code === "PLAID_WEBHOOK_BODY_MISMATCH",
  );
  await assert.rejects(
    verifyPlaidWebhook(fixture.body, { "plaid-verification": fixture.token }, {
      plaidClient: plaidKeyClient(fixture.jwk),
      now: (fixture.nowSeconds + 301) * 1000,
      keyCache: new Map(),
    }),
  );
});

test("Plaid webhook verification rejects missing and non-ES256 signatures before key lookup", async () => {
  let keyLookups = 0;
  const plaidClient = { async webhookVerificationKeyGet() { keyLookups += 1; throw new Error("not expected"); } };
  await assert.rejects(
    verifyPlaidWebhook("{}", {}, { plaidClient, keyCache: new Map() }),
    error => error.code === "PLAID_WEBHOOK_SIGNATURE_MISSING",
  );
  const encodedHeader = Buffer.from(JSON.stringify({ alg: "HS256", kid: "key-1" })).toString("base64url");
  await assert.rejects(
    verifyPlaidWebhook("{}", { "plaid-verification": `${encodedHeader}.e30.invalid` }, { plaidClient, keyCache: new Map() }),
    error => error.code === "PLAID_WEBHOOK_HEADER_INVALID",
  );
  assert.equal(keyLookups, 0);
});

test("replay guard accepts one delivery, rejects replay, and permits a failed delivery retry", () => {
  const guard = new PlaidWebhookReplayGuard(300000);
  assert.equal(guard.claim("fingerprint", 1000), true);
  assert.equal(guard.claim("fingerprint", 1001), false);
  guard.release("fingerprint");
  assert.equal(guard.claim("fingerprint", 1002), true);
});

function response() {
  return {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
}

test("invalid Plaid webhook never reaches the database or sync", async () => {
  let databaseCalls = 0;
  let syncCalls = 0;
  const handler = createPlaidWebhookHandler({
    readRawRequestBody: async () => Buffer.from("{}"),
    verifyPlaidWebhook: async () => { throw Object.assign(new Error("bad signature"), { code: "PLAID_WEBHOOK_BODY_MISMATCH" }); },
    plaid: () => ({}),
    serviceSupabase: () => { databaseCalls += 1; return {}; },
    syncItem: async () => { syncCalls += 1; },
  });
  const res = response();

  await handler({ method: "POST", headers: {} }, res);

  assert.equal(res.statusCode, 401);
  assert.equal(res.payload.error, "PLAID_WEBHOOK_INVALID");
  assert.equal(databaseCalls, 0);
  assert.equal(syncCalls, 0);
});
