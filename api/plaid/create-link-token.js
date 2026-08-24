const { plaid, plaidOptions } = require("../_utils/plaid");
const { buildLinkTokenRequest, normalizeLinkIntent, normalizeLinkPlatform } = require("../_utils/plaidLink");
const { decryptAccessToken, sealPlaidLinkSession } = require("../_utils/crypto");
const { authenticatedUser, publicError, serviceSupabase } = require("../_utils/supabase");
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
  const platform = normalizeLinkPlatform(body(req).platform);
  if (!platform) return res.status(400).json({ error: "LINK_PLATFORM_INVALID", message: "Use a supported FlowLedger app to connect this bank." });
  const mode = body(req).mode === "update" ? "update" : "create";
  try {
    const db = serviceSupabase();
    const access = await authorizeProHousehold(auth.user.id, requestedHouseholdId(req), db);
    if (!access.ok) return res.status(access.status).json({ error: access.error, message: access.message });
    const config = plaidOptions();
    let accessToken = null;
    if (mode === "update") {
      const itemId = String(body(req).item_id || "").trim();
      if (!itemId) return res.status(400).json({ error: "ITEM_ID_REQUIRED", message: "Choose a bank connection to reconnect." });
      const { data: item, error: itemError } = await db.from("plaid_items")
        .select("id,encrypted_access_token,access_token_ciphertext,status")
        .eq("id", itemId).eq("user_id", auth.user.id).eq("household_id", access.householdId).neq("status", "removed").maybeSingle();
      if (itemError) throw itemError;
      if (!item) return res.status(404).json({ error: "PLAID_ITEM_NOT_FOUND", message: "That bank connection is no longer available." });
      accessToken = decryptAccessToken(item.encrypted_access_token || item.access_token_ciphertext);
    }
    // Hosted Link remains web-only. Native builds open Plaid's official SDK,
    // and Android OAuth is bound to FlowLedger's exact package identifier.
    const hosted = platform === "web";
    const request = buildLinkTokenRequest({ userId: auth.user.id, config, intent, platform, hosted, accessToken });
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
      mode,
      platform,
      hosted_link_url: data.hosted_link_url || null,
      hosted_session: hostedSession,
    });
  } catch (error) {
    const code = error && error.response && error.response.data && error.response.data.error_code;
    return res.status(500).json({ error: code || error.code || "LINK_TOKEN_FAILED", message: publicError(error, "Could not start secure bank linking.") });
  }
};
