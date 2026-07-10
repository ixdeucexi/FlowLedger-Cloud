"use strict";

const {
  getPlaidClient,
  readJsonBody,
  requireSupabaseUser,
  safePlaidError,
  sendJson,
} = require("../_utils/plaid");
const { decryptItemAccessToken, getItemById } = require("../_utils/plaid-data");

function getValidatedPlaidRedirectUri() {
  const redirectUri = process.env.PLAID_REDIRECT_URI;
  const plaidEnv = String(process.env.PLAID_ENV || "").toLowerCase();

  if (!redirectUri) {
    if (plaidEnv === "production") {
      const error = new Error("PLAID_REDIRECT_URI is required for Plaid OAuth in Production.");
      error.status = 503;
      error.code = "PLAID_REDIRECT_URI_MISSING";
      error.missing = ["PLAID_REDIRECT_URI"];
      throw error;
    }
    return null;
  }

  let parsed;
  try {
    parsed = new URL(redirectUri);
  } catch {
    const error = new Error("PLAID_REDIRECT_URI must be a valid HTTPS URL registered in the Plaid Dashboard.");
    error.status = 503;
    error.code = "PLAID_REDIRECT_URI_INVALID";
    error.missing = ["PLAID_REDIRECT_URI"];
    throw error;
  }

  if (parsed.protocol !== "https:") {
    const error = new Error("PLAID_REDIRECT_URI must use HTTPS.");
    error.status = 503;
    error.code = "PLAID_REDIRECT_URI_REQUIRES_HTTPS";
    error.missing = ["PLAID_REDIRECT_URI"];
    throw error;
  }

  if (parsed.hash) {
    const error = new Error("PLAID_REDIRECT_URI cannot include a URL fragment.");
    error.status = 503;
    error.code = "PLAID_REDIRECT_URI_HAS_FRAGMENT";
    error.missing = ["PLAID_REDIRECT_URI"];
    throw error;
  }

  return redirectUri;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  try {
    const user = await requireSupabaseUser(req);
    const body = readJsonBody(req);
    const client = getPlaidClient();
    const request = {
      user: { client_user_id: String(user.id) },
      client_name: "FlowLedger",
      products: ["transactions"],
      country_codes: ["US"],
      language: "en",
      transactions: {
        days_requested: 90,
      },
    };

    const redirectUri = getValidatedPlaidRedirectUri();
    if (redirectUri) request.redirect_uri = redirectUri;
    if (process.env.PLAID_WEBHOOK_URL) request.webhook = process.env.PLAID_WEBHOOK_URL;

    if (body.plaid_item_record_id) {
      const item = await getItemById(user.id, body.plaid_item_record_id);
      if (!item?.id) return sendJson(res, 404, { error: "Bank connection was not found." });
      request.access_token = decryptItemAccessToken(item);
      delete request.products;
      delete request.transactions;
    }

    const response = await client.linkTokenCreate(request);
    const data = response?.data || {};
    if (!data.link_token) {
      return sendJson(res, 502, { error: "Plaid did not return a link token." });
    }

    return sendJson(res, 200, {
      link_token: data.link_token,
      expiration: data.expiration || null,
    });
  } catch (error) {
    return sendJson(
      res,
      error.status || error.response?.status || 500,
      safePlaidError(error, "Unable to create Plaid link token."),
    );
  }
};
