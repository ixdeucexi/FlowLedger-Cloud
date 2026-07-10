"use strict";

const {
  getPlaidClient,
  readJsonBody,
  requireSupabaseUser,
  safePlaidError,
  sendJson,
} = require("../_utils/plaid");
const { decryptItemAccessToken, getItemById } = require("../_utils/plaid-data");

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

    const redirectUri = process.env.PLAID_OAUTH_REDIRECT_URI || process.env.PLAID_REDIRECT_URI;
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
