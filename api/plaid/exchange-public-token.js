const { plaid, plaidOptions } = require("../_utils/plaid");
const { authenticatedUser, serviceSupabase, safeError } = require("../_utils/supabase");
const { encryptAccessToken } = require("../_utils/crypto");
const { syncItem } = require("../_utils/sync");

function body(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") { try { return JSON.parse(req.body); } catch { return {}; } }
  return req.body;
}

module.exports = async function exchangePublicToken(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  const auth = await authenticatedUser(req);
  if (!auth.user) return res.status(401).json({ error: auth.error, message: "Please sign in again." });
  const publicToken = String(body(req).public_token || "").trim();
  if (!publicToken || publicToken.length > 512) return res.status(400).json({ error: "PUBLIC_TOKEN_INVALID", message: "Plaid did not return a valid connection token." });
  try {
    const exchanged = (await plaid().itemPublicTokenExchange({ public_token: publicToken })).data;
    const accessToken = exchanged.access_token;
    const itemId = exchanged.item_id;
    const client = serviceSupabase();
    const existing = await client.from("plaid_items").select("id,user_id,plaid_item_id,item_id").eq("plaid_item_id", itemId).maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data && existing.data.user_id !== auth.user.id) return res.status(409).json({ error: "PLAID_ITEM_ALREADY_CONNECTED", message: "That bank connection is already linked to another FlowLedger user." });
    let institutionId = null;
    let institutionName = "Connected bank";
    let consentExpiration = null;
    try {
      const item = (await plaid().itemGet({ access_token: accessToken })).data.item;
      institutionId = item && item.institution_id || null;
      consentExpiration = item && item.consent_expiration_time || null;
      if (institutionId) {
        const institution = await plaid().institutionsGet({ institution_ids: [institutionId], country_codes: ["US"], options: { include_optional_metadata: true } });
        institutionName = institution.data && institution.data.institutions && institution.data.institutions[0] && institution.data.institutions[0].name || institutionName;
      }
    } catch { /* metadata is optional; the connection remains valid */ }
    const encrypted = encryptAccessToken(accessToken);
    const row = {
      user_id: auth.user.id,
      plaid_item_id: itemId,
      item_id: itemId,
      encrypted_access_token: encrypted,
      access_token_ciphertext: encrypted,
      institution_id: institutionId,
      institution_name: institutionName,
      status: "active",
      consent_expiration_time: consentExpiration,
      error_code: null,
      error_message: null,
      updated_at: new Date().toISOString(),
    };
    const saved = existing.data
      ? await client.from("plaid_items").update(row).eq("id", existing.data.id).eq("user_id", auth.user.id).select("id, status, institution_name").single()
      : await client.from("plaid_items").insert(row).select("id, status, institution_name").single();
    if (saved.error) throw saved.error;
    const sync = await syncItem({ userId: auth.user.id, item: { id: saved.data.id, encrypted_access_token: encrypted, transactions_cursor: null, cursor: null } });
    return res.status(200).json({
      ok: true,
      item_id: saved.data.id,
      institution_name: saved.data.institution_name || institutionName,
      status: sync.duplicate ? "already_connected" : "connected",
      already_connected: Boolean(sync.duplicate),
      accounts_count: sync.accounts,
      transactions_count: sync.transactions.added + sync.transactions.modified,
      transactions_pending: Boolean(sync.transactions_pending),
    });
  } catch (error) {
    const code = error && error.response && error.response.data && error.response.data.error_code || error.code || "PUBLIC_TOKEN_EXCHANGE_FAILED";
    return res.status(500).json({ error: code, message: safeError(error, "Could not finish connecting this bank.") });
  }
};
