const { Configuration, PlaidApi, PlaidEnvironments } = require("plaid");

const PLAID_HOSTS = {
  sandbox: PlaidEnvironments.sandbox,
  development: "https://development.plaid.com",
  production: PlaidEnvironments.production,
};

let plaidClientInstance = null;

class PlaidConfigurationError extends Error {
  constructor(message, missing = []) {
    super(message);
    this.name = "PlaidConfigurationError";
    this.status = 503;
    this.code = "PLAID_CONFIGURATION_MISSING";
    this.missing = missing;
  }
}

function plaidEnv() {
  const env = (process.env.PLAID_ENV || "").toLowerCase();
  return PLAID_HOSTS[env] ? env : "";
}

function plaidHost() {
  return PLAID_HOSTS[plaidEnv()] || null;
}

function missingPlaidEnvVars() {
  const missing = [];
  if (!process.env.PLAID_CLIENT_ID) missing.push("PLAID_CLIENT_ID");
  if (!process.env.PLAID_SECRET) missing.push("PLAID_SECRET");
  if (!process.env.PLAID_ENV) missing.push("PLAID_ENV");
  if (process.env.PLAID_ENV && !PLAID_HOSTS[String(process.env.PLAID_ENV).toLowerCase()]) {
    missing.push("PLAID_ENV must be sandbox, development, or production");
  }
  return missing;
}

function plaidConfigured() {
  return missingPlaidEnvVars().length === 0;
}

function getPlaidClient() {
  const missing = missingPlaidEnvVars();
  if (missing.length) {
    throw new PlaidConfigurationError(
      `Plaid is missing required server configuration: ${missing.join(", ")}.`,
      missing,
    );
  }

  const env = plaidEnv();
  if (!plaidClientInstance || plaidClientInstance.__flowledgerPlaidEnv !== env) {
    const configuration = new Configuration({
      basePath: PLAID_HOSTS[env],
      baseOptions: {
        headers: {
          "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID,
          "PLAID-SECRET": process.env.PLAID_SECRET,
        },
      },
    });

    plaidClientInstance = new PlaidApi(configuration);
    plaidClientInstance.__flowledgerPlaidEnv = env;
  }

  return plaidClientInstance;
}

function plaidErrorPayload(error, fallbackMessage) {
  const plaidData = error?.response?.data || error?.payload || {};
  return {
    error: plaidData.error_message || error.message || fallbackMessage,
    error_code: plaidData.error_code || error.code,
    request_id: plaidData.request_id,
    missing: error.missing,
  };
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
  const host = plaidHost();
  if (!host) {
    const missing = missingPlaidEnvVars();
    throw new PlaidConfigurationError(
      `Plaid is missing required server configuration: ${missing.join(", ")}.`,
      missing,
    );
  }

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
  getPlaidClient,
  getSupabaseUser,
  missingPlaidEnvVars,
  PlaidConfigurationError,
  plaidConfigured,
  plaidEnv,
  plaidErrorPayload,
  plaidPost,
  readJsonBody,
  sendJson,
  supabaseConfigured,
  supabaseRest,
  encryptAccessToken,
};
