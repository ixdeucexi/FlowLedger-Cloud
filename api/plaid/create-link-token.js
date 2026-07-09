const { getSupabaseUser, plaidConfigured, plaidPost, readJsonBody, sendJson } = require("../_utils/plaid");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  if (!plaidConfigured()) {
    return sendJson(res, 503, { error: "Plaid is not configured yet." });
  }

  const body = readJsonBody(req);
  const user = await getSupabaseUser(req);
  const clientUserId = user?.id || body.userId || "flowledger-web-user";

  try {
    const payload = await plaidPost("/link/token/create", {
      user: { client_user_id: String(clientUserId) },
      client_name: "FlowLedger Algo",
      products: body.products || ["transactions"],
      country_codes: body.country_codes || ["US"],
      language: "en",
      redirect_uri: body.redirect_uri,
      webhook: body.webhook,
    });

    return sendJson(res, 200, {
      link_token: payload.link_token,
      expiration: payload.expiration,
      request_id: payload.request_id,
    });
  } catch (error) {
    return sendJson(res, error.status || 500, {
      error: error.message || "Unable to create Plaid link token.",
      request_id: error.payload?.request_id,
    });
  }
};
