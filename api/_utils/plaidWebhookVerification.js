const { createHash, timingSafeEqual } = require("node:crypto");

const MAX_WEBHOOK_BYTES = 1024 * 1024;
const MAX_TOKEN_AGE_MS = 5 * 60 * 1000;
const keyCache = new Map();

function headerValue(headers, name) {
  const expected = String(name).toLowerCase();
  for (const [key, value] of Object.entries(headers || {})) {
    if (String(key).toLowerCase() === expected) {
      return Array.isArray(value) ? String(value[0] || "") : String(value || "");
    }
  }
  return "";
}

function bodyBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (typeof value === "string") return Buffer.from(value, "utf8");
  return null;
}

async function readRawRequestBody(req) {
  const explicit = bodyBuffer(req && req.rawBody);
  if (explicit) {
    if (explicit.length > MAX_WEBHOOK_BYTES) throw Object.assign(new Error("Webhook body is too large."), { code: "PLAID_WEBHOOK_TOO_LARGE" });
    return explicit;
  }

  if (req && typeof req[Symbol.asyncIterator] === "function") {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > MAX_WEBHOOK_BYTES) throw Object.assign(new Error("Webhook body is too large."), { code: "PLAID_WEBHOOK_TOO_LARGE" });
      chunks.push(buffer);
    }
    return Buffer.concat(chunks);
  }

  const fallback = bodyBuffer(req && req.body);
  if (fallback) {
    if (fallback.length > MAX_WEBHOOK_BYTES) throw Object.assign(new Error("Webhook body is too large."), { code: "PLAID_WEBHOOK_TOO_LARGE" });
    return fallback;
  }
  throw Object.assign(new Error("Raw webhook body is unavailable."), { code: "PLAID_WEBHOOK_RAW_BODY_REQUIRED" });
}

function validJwk(key, kid, nowSeconds) {
  if (!key || key.alg !== "ES256" || key.kid !== kid || key.kty !== "EC" || key.crv !== "P-256" || key.use !== "sig") return false;
  if (key.expired_at != null && Number(key.expired_at) <= nowSeconds) return false;
  return typeof key.x === "string" && typeof key.y === "string";
}

async function verificationKey(plaidClient, kid, nowSeconds, cache) {
  const cached = cache.get(kid);
  if (cached && validJwk(cached, kid, nowSeconds)) return cached;
  const response = await plaidClient.webhookVerificationKeyGet({ key_id: kid });
  const key = response && response.data ? response.data.key : response && response.key;
  if (!validJwk(key, kid, nowSeconds)) throw Object.assign(new Error("Plaid verification key is invalid."), { code: "PLAID_WEBHOOK_KEY_INVALID" });
  if (cache.size >= 8) cache.delete(cache.keys().next().value);
  cache.set(kid, key);
  return key;
}

async function verifyPlaidWebhook(rawBody, headers, options = {}) {
  const body = bodyBuffer(rawBody);
  if (!body) throw Object.assign(new Error("Raw webhook body is required."), { code: "PLAID_WEBHOOK_RAW_BODY_REQUIRED" });
  const signedJwt = headerValue(headers, "plaid-verification").trim();
  if (!signedJwt || signedJwt.length > 4096) throw Object.assign(new Error("Plaid verification is missing."), { code: "PLAID_WEBHOOK_SIGNATURE_MISSING" });
  const plaidClient = options.plaidClient;
  if (!plaidClient) throw Object.assign(new Error("Plaid client is required."), { code: "PLAID_WEBHOOK_CLIENT_REQUIRED" });
  const now = Number.isFinite(options.now) ? Number(options.now) : Date.now();
  const nowSeconds = Math.floor(now / 1000);
  const cache = options.keyCache || keyCache;
  const { decodeProtectedHeader, importJWK, jwtVerify } = await import("jose");
  const header = decodeProtectedHeader(signedJwt);
  if (header.alg !== "ES256" || typeof header.kid !== "string" || !header.kid || header.kid.length > 160) {
    throw Object.assign(new Error("Plaid verification header is invalid."), { code: "PLAID_WEBHOOK_HEADER_INVALID" });
  }
  const jwk = await verificationKey(plaidClient, header.kid, nowSeconds, cache);
  const key = await importJWK(jwk, "ES256");
  const verified = await jwtVerify(signedJwt, key, {
    algorithms: ["ES256"],
    currentDate: new Date(now),
    maxTokenAge: "5 min",
    clockTolerance: "5 sec",
  });
  const issuedAt = Number(verified.payload.iat);
  if (!Number.isFinite(issuedAt) || issuedAt > nowSeconds + 5 || now - issuedAt * 1000 > MAX_TOKEN_AGE_MS) {
    throw Object.assign(new Error("Plaid verification token is stale."), { code: "PLAID_WEBHOOK_STALE" });
  }
  const expectedHash = String(verified.payload.request_body_sha256 || "");
  if (!/^[a-f0-9]{64}$/i.test(expectedHash)) throw Object.assign(new Error("Plaid body hash is invalid."), { code: "PLAID_WEBHOOK_HASH_INVALID" });
  const actual = createHash("sha256").update(body).digest();
  const expected = Buffer.from(expectedHash, "hex");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw Object.assign(new Error("Plaid body hash does not match."), { code: "PLAID_WEBHOOK_BODY_MISMATCH" });
  }
  return {
    fingerprint: createHash("sha256").update(signedJwt).digest("hex"),
    issuedAt,
  };
}

class PlaidWebhookReplayGuard {
  constructor(ttlMs = MAX_TOKEN_AGE_MS) {
    this.ttlMs = ttlMs;
    this.seen = new Map();
  }

  claim(fingerprint, now = Date.now()) {
    for (const [key, expiresAt] of this.seen) {
      if (expiresAt <= now) this.seen.delete(key);
    }
    if (this.seen.has(fingerprint)) return false;
    this.seen.set(fingerprint, now + this.ttlMs);
    return true;
  }

  release(fingerprint) {
    this.seen.delete(fingerprint);
  }
}

module.exports = {
  PlaidWebhookReplayGuard,
  headerValue,
  readRawRequestBody,
  verifyPlaidWebhook,
};
