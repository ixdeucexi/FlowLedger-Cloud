const { plaid } = require("../_utils/plaid");
const { authenticatedUser, serviceSupabase, publicError } = require("../_utils/supabase");
const { decryptAccessToken } = require("../_utils/crypto");
const { authorizeProHousehold, requestedHouseholdId } = require("../_utils/plaidAccess");

function parsed(req) { if (!req.body) return {}; if (typeof req.body === "string") { try { return JSON.parse(req.body); } catch { return {}; } } return req.body; }

function plaidRemovalAlreadyComplete(error) {
  const code = error && typeof error === "object"
    ? String(error.response?.data?.error_code || error.error_code || "")
    : "";
  return code === "ITEM_NOT_FOUND" || code === "INVALID_ACCESS_TOKEN";
}

function createDisconnectHandler(dependencies = {}) {
  const authenticate = dependencies.authenticatedUser || authenticatedUser;
  const database = dependencies.serviceSupabase || serviceSupabase;
  const authorize = dependencies.authorizeProHousehold || authorizeProHousehold;
  const plaidClient = dependencies.plaid || plaid;
  const decrypt = dependencies.decryptAccessToken || decryptAccessToken;

  return async function disconnect(req, res) {
    if (req.method !== "POST") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
    const auth = await authenticate(req);
    if (!auth.user) return res.status(401).json({ error: auth.error, message: "Please sign in again." });
    const id = String(parsed(req).item_id || "").trim();
    if (!id) return res.status(400).json({ error: "ITEM_ID_REQUIRED" });
    try {
      const client = database();
      const access = await authorize(auth.user.id, requestedHouseholdId(req), client);
      if (!access.ok) return res.status(access.status).json({ error: access.error, message: access.message });
      const { data: item, error } = await client
        .from("plaid_items")
        .select("id,encrypted_access_token,access_token_ciphertext")
        .eq("id", id)
        .eq("user_id", auth.user.id)
        .eq("household_id", access.householdId)
        .maybeSingle();
      if (error) throw error;
      if (!item) return res.status(404).json({ error: "PLAID_ITEM_NOT_FOUND" });
      try {
        await plaidClient().itemRemove({ access_token: decrypt(item.encrypted_access_token || item.access_token_ciphertext) });
      } catch (removeError) {
        if (!plaidRemovalAlreadyComplete(removeError)) throw removeError;
      }
      // Keep historical rows for audit/reconciliation. `removed` is the status
      // allowed by the Plaid migration and prevents future syncs.
      const { error: updateError } = await client
        .from("plaid_items")
        .update({ status: "removed", encrypted_access_token: null, access_token_ciphertext: null, updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("user_id", auth.user.id)
        .eq("household_id", access.householdId);
      if (updateError) throw updateError;
      return res.status(200).json({ ok: true, status: "disconnected" });
    } catch (error) {
      return res.status(500).json({ error: "PLAID_DISCONNECT_FAILED", message: publicError(error, "Could not disconnect this bank.") });
    }
  };
}

module.exports = createDisconnectHandler();
module.exports.createDisconnectHandler = createDisconnectHandler;
module.exports.plaidRemovalAlreadyComplete = plaidRemovalAlreadyComplete;
