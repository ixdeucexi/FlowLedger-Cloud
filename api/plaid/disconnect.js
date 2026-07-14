const { plaid } = require("../_utils/plaid");
const { authenticatedUser, serviceSupabase, safeError } = require("../_utils/supabase");
const { decryptAccessToken } = require("../_utils/crypto");

function parsed(req) { if (!req.body) return {}; if (typeof req.body === "string") { try { return JSON.parse(req.body); } catch { return {}; } } return req.body; }

module.exports = async function disconnect(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  const auth = await authenticatedUser(req);
  if (!auth.user) return res.status(401).json({ error: auth.error, message: "Please sign in again." });
  const id = String(parsed(req).item_id || "").trim();
  if (!id) return res.status(400).json({ error: "ITEM_ID_REQUIRED" });
  try {
    const client = serviceSupabase();
    const { data: item, error } = await client.from("plaid_items").select("id,encrypted_access_token,access_token_ciphertext").eq("id", id).eq("user_id", auth.user.id).maybeSingle();
    if (error) throw error;
    if (!item) return res.status(404).json({ error: "PLAID_ITEM_NOT_FOUND" });
    try { await plaid().itemRemove({ access_token: decryptAccessToken(item.encrypted_access_token || item.access_token_ciphertext) }); } catch { /* preserve local disconnect even if Plaid already removed it */ }
    // Keep historical rows for audit/reconciliation. `removed` is the status
    // allowed by the Plaid migration and prevents future syncs.
    const { error: updateError } = await client.from("plaid_items").update({ status: "removed", encrypted_access_token: null, access_token_ciphertext: null, updated_at: new Date().toISOString() }).eq("id", id).eq("user_id", auth.user.id);
    if (updateError) throw updateError;
    return res.status(200).json({ ok: true, status: "disconnected" });
  } catch (error) {
    return res.status(500).json({ error: "PLAID_DISCONNECT_FAILED", message: safeError(error, "Could not disconnect this bank.") });
  }
};
