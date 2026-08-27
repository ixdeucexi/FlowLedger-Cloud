const crypto = require("crypto");
const { authenticatedUser, serviceSupabase } = require("./supabase");
const { required } = require("./env");

function tokenKey() {
  const raw = required("APPLE_TOKEN_ENCRYPTION_KEY");
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("APPLE_TOKEN_ENCRYPTION_KEY_INVALID");
  return key;
}
function seal(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", tokenKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
}
function open(value) {
  const [, iv, tag, encrypted] = String(value || "").split(".");
  if (!iv || !tag || !encrypted) throw new Error("APPLE_TOKEN_INVALID");
  const decipher = crypto.createDecipheriv("aes-256-gcm", tokenKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
}
function clientSecret(nowSeconds = Math.floor(Date.now() / 1000)) {
  const teamId = required("APPLE_TEAM_ID");
  const keyId = required("APPLE_KEY_ID");
  const clientId = required("APPLE_CLIENT_ID");
  const header = Buffer.from(JSON.stringify({ alg: "ES256", kid: keyId })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ iss: teamId, iat: nowSeconds, exp: nowSeconds + 86400 * 30, aud: "https://appleid.apple.com", sub: clientId })).toString("base64url");
  const content = `${header}.${payload}`;
  const signature = crypto.sign("sha256", Buffer.from(content), { key: required("APPLE_PRIVATE_KEY").replace(/\\n/g, "\n"), dsaEncoding: "ieee-p1363" });
  return `${content}.${signature.toString("base64url")}`;
}
async function appleTokenRequest(parameters, dependencies = {}) {
  const request = dependencies.fetch || fetch;
  const response = await request("https://appleid.apple.com/auth/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: required("APPLE_CLIENT_ID"), client_secret: clientSecret(), ...parameters }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(body.error || "APPLE_TOKEN_REQUEST_FAILED"));
  return body;
}
async function revokeAppleRefreshToken(refreshToken, dependencies = {}) {
  const request = dependencies.fetch || fetch;
  const response = await request("https://appleid.apple.com/auth/revoke", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: required("APPLE_CLIENT_ID"), client_secret: clientSecret(), token: String(refreshToken), token_type_hint: "refresh_token" }),
  });
  if (!response.ok && response.status !== 404) throw new Error("APPLE_REVOCATION_FAILED");
}
function appleSubjectForUser(user) {
  const identity = (user?.identities || []).find(candidate => candidate?.provider === "apple");
  return String(identity?.identity_data?.sub || identity?.id || "").trim() || null;
}
function validateAppleClaims(claims, user, nowSeconds = Math.floor(Date.now() / 1000)) {
  const audience = Array.isArray(claims?.aud) ? claims.aud : [claims?.aud];
  const linkedSubject = appleSubjectForUser(user);
  return claims?.iss === "https://appleid.apple.com"
    && audience.includes(required("APPLE_CLIENT_ID"))
    && Number(claims?.exp) > nowSeconds
    && typeof claims?.sub === "string"
    && Boolean(linkedSubject)
    && claims.sub === linkedSubject;
}
async function verifyAppleIdToken(token, user, dependencies = {}) {
  const [encodedHeader, encodedPayload, encodedSignature] = String(token || "").split(".");
  if (!encodedHeader || !encodedPayload || !encodedSignature) return false;
  let header; let claims;
  try {
    header = JSON.parse(Buffer.from(encodedHeader, "base64url").toString("utf8"));
    claims = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch { return false; }
  if (header.alg !== "RS256" || !header.kid || !validateAppleClaims(claims, user, dependencies.nowSeconds?.())) return false;
  const response = await (dependencies.fetch || fetch)("https://appleid.apple.com/auth/keys");
  if (!response.ok) return false;
  const body = await response.json();
  const jwk = body?.keys?.find(key => key.kid === header.kid && key.alg === "RS256");
  if (!jwk) return false;
  try {
    return crypto.verify("RSA-SHA256", Buffer.from(`${encodedHeader}.${encodedPayload}`), crypto.createPublicKey({ key: jwk, format: "jwk" }), Buffer.from(encodedSignature, "base64url"));
  } catch { return false; }
}
async function storeAppleAuthorization(req, res, dependencies = {}) {
  if (req.method !== "POST") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  const auth = await (dependencies.authenticatedUser || authenticatedUser)(req);
  if (!auth.user) return res.status(401).json({ error: auth.error || "AUTH_REQUIRED" });
  const code = String(req.body?.authorizationCode || "").trim();
  if (!code || code.length > 2048) return res.status(400).json({ error: "APPLE_AUTHORIZATION_CODE_REQUIRED" });
  let exchangedRefreshToken = null;
  try {
    const exchange = dependencies.appleTokenRequest || appleTokenRequest;
    const tokens = await exchange({ grant_type: "authorization_code", code }, dependencies);
    exchangedRefreshToken = tokens.refresh_token ? String(tokens.refresh_token) : null;
    const verify = dependencies.verifyAppleIdToken || verifyAppleIdToken;
    if (!exchangedRefreshToken || !tokens.id_token || !await verify(tokens.id_token, auth.user, dependencies)) {
      throw new Error("APPLE_TOKEN_IDENTITY_MISMATCH");
    }
    const db = (dependencies.serviceSupabase || serviceSupabase)();
    const sealToken = dependencies.seal || seal;
    const { error } = await db.schema("private").from("apple_provider_tokens").upsert({
      user_id: auth.user.id, refresh_token_ciphertext: sealToken(exchangedRefreshToken), revoked_at: null, updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    if (error) throw error;
    return res.status(200).json({ ok: true });
  } catch (error) {
    if (exchangedRefreshToken) {
      const revoke = dependencies.revokeAppleRefreshToken || revokeAppleRefreshToken;
      await revoke(exchangedRefreshToken, dependencies).catch(revocationError => {
        console.error("Apple authorization cleanup failed", revocationError?.message || "unknown");
      });
    }
    console.error("Apple authorization retention failed", error?.message || "unknown");
    return res.status(502).json({ error: "APPLE_AUTHORIZATION_RETENTION_FAILED", message: "Apple sign-in could not be completed securely. Try again." });
  }
}
async function revokeAppleAuthorization(db, userId, dependencies = {}) {
  const { data, error } = await db.schema("private").from("apple_provider_tokens").select("refresh_token_ciphertext,revoked_at").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  if (!data?.refresh_token_ciphertext) throw new Error("APPLE_REVOCATION_TOKEN_MISSING");
  if (data.revoked_at) return;
  const request = dependencies.fetch || fetch;
  const response = await request("https://appleid.apple.com/auth/revoke", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: required("APPLE_CLIENT_ID"), client_secret: clientSecret(), token: open(data.refresh_token_ciphertext), token_type_hint: "refresh_token" }),
  });
  if (!response.ok && response.status !== 404) throw new Error("APPLE_REVOCATION_FAILED");
  const { error: updateError } = await db.schema("private").from("apple_provider_tokens")
    .update({ revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("user_id", userId);
  if (updateError) throw updateError;
}

module.exports = { appleSubjectForUser, appleTokenRequest, revokeAppleAuthorization, revokeAppleRefreshToken, storeAppleAuthorization, validateAppleClaims, verifyAppleIdToken };
