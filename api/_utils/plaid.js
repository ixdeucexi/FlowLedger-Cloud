"use strict";

if (typeof window !== "undefined") {
  throw new Error("Plaid server utilities cannot be imported in the browser.");
}

const crypto = require("crypto");
const { Configuration, PlaidApi, PlaidEnvironments } = require("plaid");
const { createClient } = require("@supabase/supabase-js");

const PLAID_HOSTS = {
  sandbox: PlaidEnvironments.sandbox,
  development: PlaidEnvironments.development || "https://development.plaid.com",
  production: PlaidEnvironments.production,
};

let plaidClientInstance = null;
let supabaseAuthClientInstance = null;
let supabaseAuthClientUrl = null;

class PlaidConfigurationError extends Error {
  constructor(message, missing = []) {
    super(message);
    this.name = "PlaidConfigurationError";
    this.status = 503;
    this.code = "PLAID_CONFIGURATION_MISSING";
    this.missing = missing;
  }
}

class AuthRequiredError extends Error {
  constructor(message = "Sign in again before connecting your bank.", code = "AUTH_REQUIRED", safeAuthError = null) {
    super(message);
    this.name = "AuthRequiredError";
    this.status = 401;
    this.code = code;
    this.safeAuthError = safeAuthError;
  }
}

function logPlaidAuthStage(stage, details = {}) {
  console.log("[plaid-auth]", { stage, ...details });
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

function requireSupabaseConfigured() {
  if (!supabaseConfigured()) {
    throw new PlaidConfigurationError(
      "Supabase service configuration is missing for secure Plaid storage.",
      ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"],
    );
  }
}

function getSupabaseAuthClient() {
  requireSupabaseConfigured();
  const supabaseUrl = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
  if (!supabaseAuthClientInstance || supabaseAuthClientUrl !== supabaseUrl) {
    supabaseAuthClientInstance = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    });
    supabaseAuthClientUrl = supabaseUrl;
  }
  return supabaseAuthClientInstance;
}

function encryptionConfigured() {
  return Boolean(process.env.PLAID_TOKEN_ENCRYPTION_KEY);
}

function decodeEncryptionKey() {
  const value = process.env.PLAID_TOKEN_ENCRYPTION_KEY || "";
  if (!value) {
    throw new PlaidConfigurationError(
      "Plaid token encryption key is missing.",
      ["PLAID_TOKEN_ENCRYPTION_KEY"],
    );
  }

  const trimmed = value.trim();
  const candidates = [];
  if (/^[a-f0-9]{64}$/i.test(trimmed)) candidates.push(Buffer.from(trimmed, "hex"));
  try {
    candidates.push(Buffer.from(trimmed, "base64"));
  } catch {
    // ignore invalid base64 candidate
  }
  candidates.push(Buffer.from(trimmed, "utf8"));

  const key = candidates.find(candidate => candidate.length === 32);
  if (!key) {
    throw new PlaidConfigurationError(
      "PLAID_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes.",
      ["PLAID_TOKEN_ENCRYPTION_KEY"],
    );
  }
  return key;
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

  const response = await fetch(`${host}${path}`, {
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
  if (!auth || typeof auth !== "string") {
    logPlaidAuthStage("AUTH_HEADER_MISSING");
    throw new AuthRequiredError(
      "Your session has expired. Please sign in again.",
      "AUTH_HEADER_MISSING",
    );
  }
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    logPlaidAuthStage("AUTH_TOKEN_INVALID");
    throw new AuthRequiredError(
      "Your session is invalid or expired.",
      "AUTH_TOKEN_INVALID",
    );
  }
  const token = match[1]?.trim();
  if (!token) {
    logPlaidAuthStage("AUTH_TOKEN_INVALID");
    throw new AuthRequiredError(
      "Your session is invalid or expired.",
      "AUTH_TOKEN_INVALID",
    );
  }
  return token;
}

async function getSupabaseUser(req) {
  requireSupabaseConfigured();
  const token = getBearerToken(req);
  logPlaidAuthStage("AUTH_TOKEN_RECEIVED");

  const supabase = getSupabaseAuthClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);

  if (error || !user?.id) {
    const safeAuthError = {
      name: error?.name,
      message: error?.message || "Supabase did not return a verified user.",
      status: error?.status,
      code: error?.code,
    };
    logPlaidAuthStage("AUTH_TOKEN_INVALID", safeAuthError);
    throw new AuthRequiredError(
      safeAuthError.message || "Your session is invalid or expired.",
      "AUTH_TOKEN_INVALID",
      safeAuthError,
    );
  }
  logPlaidAuthStage("AUTH_USER_VERIFIED");
  return user;
}

async function requireSupabaseUser(req) {
  const user = await getSupabaseUser(req);
  if (!user?.id) throw new AuthRequiredError();
  return user;
}

async function supabaseRest(path, method, body, options = {}) {
  requireSupabaseConfigured();
  const supabaseUrl = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
  const headers = {
    apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    "content-type": "application/json",
    prefer: options.prefer || "return=representation",
  };
  if (options.headers) Object.assign(headers, options.headers);

  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error("Supabase request failed");
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

function encryptAccessToken(accessToken) {
  const key = decodeEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(accessToken, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    "v1",
    iv.toString("base64"),
    tag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

function decryptLegacyAccessToken(ciphertext) {
  const raw = Buffer.from(ciphertext, "base64");
  if (raw.length < 29) return null;
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const encrypted = raw.subarray(28);
  const key = crypto.createHash("sha256").update(process.env.PLAID_TOKEN_ENCRYPTION_KEY || "").digest();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

function decryptAccessToken(ciphertext) {
  if (!ciphertext) return null;
  if (String(ciphertext).startsWith("v1:")) {
    const [, ivText, tagText, ciphertextText] = String(ciphertext).split(":");
    if (!ivText || !tagText || !ciphertextText) return null;
    const key = decodeEncryptionKey();
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivText, "base64"));
    decipher.setAuthTag(Buffer.from(tagText, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextText, "base64")),
      decipher.final(),
    ]).toString("utf8");
  }

  if (!encryptionConfigured()) return null;
  return decryptLegacyAccessToken(ciphertext);
}

function accountTypeFromPlaid(account) {
  if (account?.type === "depository" && account?.subtype === "savings") return "savings";
  if (account?.type === "depository") return "checking";
  if (account?.type === "credit") return "credit";
  if (account?.type === "loan") return "loan";
  return "other";
}

function isCashAccount(account) {
  const type = accountTypeFromPlaid(account);
  return type === "checking" || type === "savings";
}

function safeAccountPreview(account) {
  const suggestedAccountType = accountTypeFromPlaid(account);
  const balances = account?.balances || {};
  return {
    plaid_account_id: account.account_id,
    persistent_account_id: account.persistent_account_id || null,
    name: account.name,
    official_name: account.official_name || null,
    mask: account.mask || null,
    type: account.type,
    subtype: account.subtype || null,
    current_balance: balances.current ?? null,
    available_balance: balances.available ?? null,
    credit_limit: balances.limit ?? null,
    currency_code: balances.iso_currency_code || balances.unofficial_currency_code || null,
    supported: isCashAccount(account),
    suggested_account_type: suggestedAccountType === "savings" ? "savings" : "checking",
  };
}

function mapPlaidCategory(transaction) {
  if (Number(transaction.amount) < 0) return "Income";
  const primary = transaction.personal_finance_category?.primary || "";
  const detailed = transaction.personal_finance_category?.detailed || "";
  const legacy = Array.isArray(transaction.category) ? transaction.category.join(" ") : "";
  const source = `${primary} ${detailed} ${legacy}`.toLowerCase();
  if (/food|restaurant|coffee|grocery/.test(source)) return "Food";
  if (/transport|gas|parking|taxi|rideshare|automotive/.test(source)) return "Transportation";
  if (/rent|utility|utilities|telephone|internet|electric|water/.test(source)) return "Utilities";
  if (/medical|health|pharmacy|doctor/.test(source)) return "Health";
  if (/education|school|tuition/.test(source)) return "Education";
  if (/loan|credit|debt/.test(source)) return "Debt";
  if (/merchandise|shopping|retail/.test(source)) return "Shopping";
  if (/entertainment|streaming|subscription|recreation/.test(source)) return "Entertainment";
  return "Other";
}

function normalizePlaidAmount(amount) {
  // Plaid uses positive values for money leaving the account and negative
  // values for money entering the account. FlowLedger uses the opposite sign.
  return -Number(amount || 0);
}

function safePlaidError(error, fallback = "Plaid request failed.") {
  if (error instanceof AuthRequiredError || error?.name === "AuthRequiredError") {
    return {
      error: error.code || "AUTH_REQUIRED",
      message: error.message || "Your session is invalid or expired.",
      status: error.status || 401,
    };
  }
  const payload = plaidErrorPayload(error, fallback);
  return {
    error: payload.error || fallback,
    error_code: payload.error_code,
    request_id: payload.request_id,
    missing: payload.missing,
  };
}

module.exports = {
  AuthRequiredError,
  accountTypeFromPlaid,
  decodeEncryptionKey,
  decryptAccessToken,
  encryptionConfigured,
  encryptAccessToken,
  getPlaidClient,
  getSupabaseAuthClient,
  getSupabaseUser,
  isCashAccount,
  mapPlaidCategory,
  missingPlaidEnvVars,
  normalizePlaidAmount,
  PlaidConfigurationError,
  plaidConfigured,
  plaidEnv,
  plaidErrorPayload,
  plaidPost,
  readJsonBody,
  requireSupabaseConfigured,
  requireSupabaseUser,
  safeAccountPreview,
  safePlaidError,
  sendJson,
  supabaseConfigured,
  supabaseRest,
};
