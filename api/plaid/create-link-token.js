const {
  getPlaidClient,
  getSupabaseUser,
  plaidErrorPayload,
  readJsonBody,
  sendJson,
} = require("../_utils/plaid");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  const body = readJsonBody(req);
  const user = await getSupabaseUser(req);
  const clientUserId = user?.id || body.userId || "flowledger-web-user";

  try {
    const client = getPlaidClient();
    const request = {
      user: { client_user_id: String(clientUserId) },
      client_name: "FlowLedger Algo",
      products: body.products || ["transactions"],
      country_codes: body.country_codes || ["US"],
      language: "en",
    };

    if (body.redirect_uri) request.redirect_uri = body.redirect_uri;
    if (body.webhook) request.webhook = body.webhook;

    const response = await client.linkTokenCreate(request);
    const linkToken = response?.data?.link_token;

    if (!linkToken) {
      return sendJson(res, 502, { error: "Plaid did not return a link token." });
    }

    return sendJson(res, 200, { link_token: linkToken });
  } catch (error) {
    return sendJson(
      res,
      error.status || error.response?.status || 500,
      plaidErrorPayload(error, "Unable to create Plaid link token."),
    );
  }
};
