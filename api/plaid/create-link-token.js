const { plaid, plaidOptions, Products } = require("../_utils/plaid");
const { authenticatedUser, safeError } = require("../_utils/supabase");
const { authorizeProHousehold, requestedHouseholdId } = require("../_utils/plaidAccess");

module.exports = async function createLinkToken(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  const auth = await authenticatedUser(req);
  if (!auth.user) return res.status(401).json({ error: auth.error, message: "Please sign in again." });
  try {
    const access = await authorizeProHousehold(auth.user.id, requestedHouseholdId(req));
    if (!access.ok) return res.status(access.status).json({ error: access.error, message: access.message });
    const config = plaidOptions();
    const request = {
      user: { client_user_id: auth.user.id },
      client_name: "FlowLedger",
      products: [Products.Transactions],
      country_codes: ["US"],
      language: "en",
      transactions: { days_requested: 90 },
    };
    if (config.webhookUrl) request.webhook = config.webhookUrl;
    if (config.redirectUri) request.redirect_uri = config.redirectUri;
    const response = await plaid().linkTokenCreate(request);
    const data = response.data || response;
    return res.status(200).json({ link_token: data.link_token, expiration: data.expiration });
  } catch (error) {
    const code = error && error.response && error.response.data && error.response.data.error_code;
    return res.status(500).json({ error: code || error.code || "LINK_TOKEN_FAILED", message: safeError(error, "Could not start secure bank linking.") });
  }
};
