const PLAID_HOSTS = {
  sandbox: "https://sandbox.plaid.com",
  development: "https://development.plaid.com",
  production: "https://production.plaid.com",
};

function plaidEnv() {
  const env = (process.env.PLAID_ENV || "sandbox").toLowerCase();
  return PLAID_HOSTS[env] ? env : "sandbox";
}

function plaidHost() {
  return PLAID_HOSTS[plaidEnv()];
}

function plaidConfigured() {
  return Boolean(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET);
}

function supabaseConfigured() {
  return Boolean(
    (process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL) &&
      process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

function encryptionConfigured() {
  return Boolean(process.env.PLAID_TOKEN_ENCRYPTION_KEY);
}

function readJsonBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "object") return req.body;
  try {
    return JSON.parse(req.body);
  } catch {
    return {};
  }
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

async function plaidPost(path, body) {
  const response = await fetch(`${plaidHost()}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.PLAID_CLIENT_ID,
      secret: process.env.PLAID_SECRET,
      ...body,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload.error_message || payload.display_message || "Plaid request failed";
    const error = new Error(message);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

function getBearerToken(req) {
  const auth = req.headers.authorization || req.headers.Authorization;
  if (!auth || typeof auth !== "string") return null;
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

async function getSupabaseUser(req) {
  if (!supabaseConfigured()) return null;
  const token = getBearerToken(req);
  if (!token) return null;

  const supabaseUrl = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) return null;
  return response.json().catch(() => null);
}

async function supabaseRest(path, method, body, options = {}) {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      "content-type": "application/json",
      prefer: options.prefer || "return=representation",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error("Supabase write failed");
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

function encryptAccessToken(accessToken) {
  if (!encryptionConfigured()) return null;
  const crypto = require("crypto");
  const key = crypto.createHash("sha256").update(process.env.PLAID_TOKEN_ENCRYPTION_KEY).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(accessToken, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

function decryptAccessToken(ciphertext) {
  if (!encryptionConfigured() || !ciphertext) return null;
  const crypto = require("crypto");
  const raw = Buffer.from(ciphertext, "base64");
  if (raw.length < 29) return null;
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const encrypted = raw.subarray(28);
  const key = crypto.createHash("sha256").update(process.env.PLAID_TOKEN_ENCRYPTION_KEY).digest();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

module.exports = {
  decryptAccessToken,
  encryptionConfigured,
  getSupabaseUser,
  plaidConfigured,
  plaidEnv,
  plaidPost,
  readJsonBody,
  sendJson,
  supabaseConfigured,
  supabaseRest,
  encryptAccessToken,
};
