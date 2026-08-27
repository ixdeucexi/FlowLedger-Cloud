const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { appleSubjectForUser, revokeAppleAuthorization, storeAppleAuthorization, validateAppleClaims } = require("./appleProvider");

test("Apple authorization is exchanged immediately and revoked before Auth deletion", () => {
  const apple = fs.readFileSync(path.join(__dirname, "appleProvider.js"), "utf8");
  const auth = fs.readFileSync(path.join(__dirname, "../../artifacts/mobile/context/AuthContext.tsx"), "utf8");
  const deletion = fs.readFileSync(path.join(__dirname, "accountDeletion.js"), "utf8");
  assert.match(auth, /credential\.authorizationCode/);
  assert.match(auth, /api\/account\/apple-authorization/);
  assert.match(apple, /appleid\.apple\.com\/auth\/token/);
  assert.match(apple, /appleid\.apple\.com\/auth\/revoke/);
  assert.match(apple, /refresh_token_ciphertext/);
  assert.match(deletion, /revokeAppleAuthorization/);
});

test("Apple claims must match the authenticated user's linked Apple subject", () => {
  const previous = process.env.APPLE_CLIENT_ID;
  process.env.APPLE_CLIENT_ID = "com.flowledger.app";
  const user = { identities: [{ provider: "apple", id: "apple-subject", identity_data: { sub: "apple-subject" } }] };
  assert.equal(appleSubjectForUser(user), "apple-subject");
  assert.equal(validateAppleClaims({ iss: "https://appleid.apple.com", aud: "com.flowledger.app", exp: 2_000, sub: "apple-subject" }, user, 1_000), true);
  assert.equal(validateAppleClaims({ iss: "https://appleid.apple.com", aud: "com.flowledger.app", exp: 2_000, sub: "other-subject" }, user, 1_000), false);
  if (previous === undefined) delete process.env.APPLE_CLIENT_ID; else process.env.APPLE_CLIENT_ID = previous;
});

test("a completed Apple revocation is durable and retry-safe", async () => {
  let mutations = 0;
  const db = { schema: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { refresh_token_ciphertext: "sealed", revoked_at: "2026-08-21T00:00:00Z" }, error: null }) }) }), update: () => { mutations += 1; } }) }) };
  await revokeAppleAuthorization(db, "user-a", {});
  assert.equal(mutations, 0);
});

test("fresh Apple reauthentication clears a prior revocation marker", () => {
  const source = fs.readFileSync(path.join(__dirname, "appleProvider.js"), "utf8");
  assert.match(source, /refresh_token_ciphertext: sealToken\(exchangedRefreshToken\), revoked_at: null/);
});

function responseRecorder() {
  const result = { statusCode: null, body: null };
  return {
    result,
    response: {
      status(code) { result.statusCode = code; return this; },
      json(body) { result.body = body; return body; },
    },
  };
}

test("a refresh token is revoked when encryption fails after exchange", async () => {
  let revoked = null;
  const { result, response } = responseRecorder();
  await storeAppleAuthorization(
    { method: "POST", body: { authorizationCode: "one-time-code" } },
    response,
    {
      authenticatedUser: async () => ({ user: { id: "user-a" } }),
      appleTokenRequest: async () => ({ refresh_token: "refresh-a", id_token: "id-a" }),
      verifyAppleIdToken: async () => true,
      serviceSupabase: () => ({
        schema: () => ({
          from: () => ({
            upsert: async () => { throw new Error("DB_MUST_NOT_RUN"); },
          }),
        }),
      }),
      seal: () => { throw new Error("APPLE_TOKEN_ENCRYPTION_KEY_INVALID"); },
      revokeAppleRefreshToken: async token => { revoked = token; },
    },
  );
  assert.equal(result.statusCode, 502);
  assert.equal(revoked, "refresh-a");
});

test("a refresh token is revoked when its database upsert fails", async () => {
  let revoked = null;
  const { result, response } = responseRecorder();
  await storeAppleAuthorization(
    { method: "POST", body: { authorizationCode: "one-time-code" } },
    response,
    {
      authenticatedUser: async () => ({ user: { id: "user-a" } }),
      appleTokenRequest: async () => ({ refresh_token: "refresh-b", id_token: "id-b" }),
      verifyAppleIdToken: async () => true,
      seal: token => `sealed:${token}`,
      serviceSupabase: () => ({
        schema: () => ({
          from: () => ({
            upsert: async () => ({ error: new Error("DB_WRITE_FAILED") }),
          }),
        }),
      }),
      revokeAppleRefreshToken: async token => { revoked = token; },
    },
  );
  assert.equal(result.statusCode, 502);
  assert.equal(revoked, "refresh-b");
});
