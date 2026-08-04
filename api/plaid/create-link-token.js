const { plaid, plaidOptions } = require("../_utils/plaid");
const { buildLinkTokenRequest, LINK_INTENTS, normalizeLinkIntent } = require("../_utils/plaidLink");
const { sealPlaidLinkSession } = require("../_utils/crypto");
const { authenticatedUser, safeError } = require("../_utils/supabase");
const { authorizeProHousehold, requestedHouseholdId } = require("../_utils/plaidAccess");

function body(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") { try { return JSON.parse(req.body); } catch { return {}; } }
  return req.body;
}

module.exports = async function createLinkToken(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  const auth = await authenticatedUser(req);
  if (!auth.user) return res.status(401).json({ error: auth.error, message: "Please sign in again." });
  const intent = normalizeLinkIntent(body(req).intent);
  if (!intent) return res.status(400).json({ error: "LINK_INTENT_INVALID", message: "Choose a supported account type to connect." });
  try {
    const access = await authorizeProHousehold(auth.user.id, requestedHouseholdId(req));
    if (!access.ok) return res.status(access.status).json({ error: access.error, message: access.message });
    const config = plaidOptions();
    const hosted = intent === LINK_INTENTS.creditCard;
    const request = buildLinkTokenRequest({ userId: auth.user.id, config, intent, hosted });
    const response = await plaid().linkTokenCreate(request);
    const data = response.data || response;
    if (hosted && !data.hosted_link_url) {
      const error = new Error("Plaid did not return a secure mobile connection URL.");
      error.code = "PLAID_HOSTED_LINK_UNAVAILABLE";
      throw error;
    }
    const hostedSession = hosted ? sealPlaidLinkSession({
      version: 1,
      linkToken: data.link_token,
      userId: auth.user.id,
      householdId: access.householdId,
      intent,
      expiresAt: data.expiration,
    }) : null;
    return res.status(200).json({
      link_token: data.link_token,
      expiration: data.expiration,
      intent,
      hosted_link_url: data.hosted_link_url || null,
      hosted_session: hostedSession,
    });
  } catch (error) {
    const code = error && error.response && error.response.data && error.response.data.error_code;
    return res.status(500).json({ error: code || error.code || "LINK_TOKEN_FAILED", message: safeError(error, "Could not start secure bank linking.") });
  }
};
