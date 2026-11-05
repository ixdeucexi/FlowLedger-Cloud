const { plaid } = require("../_utils/plaid");
const { authenticatedUser, serviceSupabase, publicError } = require("../_utils/supabase");
const { decryptAccessToken } = require("../_utils/crypto");
const { authorizeProHousehold, requestedHouseholdId } = require("../_utils/plaidAccess");
const { withPlaidSyncLock } = require("../_utils/sync");

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
  const lock = dependencies.withPlaidSyncLock || withPlaidSyncLock;

  const readOwnedItem = async (client, id, userId, householdId) => {
    const { data, error } = await client.from("plaid_items")
      .select("id,status,encrypted_access_token,access_token_ciphertext")
      .eq("id", id).eq("user_id", userId).eq("household_id", householdId).maybeSingle();
    if (error) throw error;
    return data;
  };

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
      const item = await readOwnedItem(client, id, auth.user.id, access.householdId);
      if (!item) return res.status(404).json({ error: "PLAID_ITEM_NOT_FOUND" });
      await lock({ db: client, itemId: id, userId: auth.user.id }, async () => {
        // Re-read after acquiring the same lease as sync. Another completed
        // unlink may have cleared the token while this request was waiting.
        const current = await readOwnedItem(client, id, auth.user.id, access.householdId);
        if (!current) throw Object.assign(new Error("That bank connection is no longer available."), { code: "PLAID_ITEM_NOT_FOUND" });
        const encrypted = current.encrypted_access_token || current.access_token_ciphertext;
        if (encrypted) {
          try {
            await plaidClient().itemRemove({ access_token: decrypt(encrypted) });
          } catch (removeError) {
            if (!plaidRemovalAlreadyComplete(removeError)) throw removeError;
          }
        } else if (current.status !== "removed") {
          throw Object.assign(new Error("The bank connection could not be verified. Try again or contact support."), { code: "PLAID_ITEM_TOKEN_MISSING" });
        }
        // Mark the Item first: if account retirement fails, retry can finish
        // locally without attempting to decrypt a token already cleared here.
        const updatedAt = new Date().toISOString();
        const { data: removed, error: updateError } = await client.from("plaid_items")
          .update({ status: "removed", encrypted_access_token: null, access_token_ciphertext: null, updated_at: updatedAt })
          .eq("id", id).eq("user_id", auth.user.id).eq("household_id", access.householdId)
          .select("id,status,encrypted_access_token,access_token_ciphertext").maybeSingle();
        if (updateError) throw updateError;
        if (!removed || removed.status !== "removed" || removed.encrypted_access_token !== null || removed.access_token_ciphertext !== null) {
          throw new Error("Could not confirm the disconnected bank. Please try again.");
        }
        const { error: accountsError } = await client.from("plaid_accounts")
          .update({ is_active: false, updated_at: updatedAt })
          .eq("plaid_item_record_id", id).eq("user_id", auth.user.id).eq("household_id", access.householdId);
        if (accountsError) throw accountsError;
        // Historical transactions, matching decisions and bills stay saved.
      });
      return res.status(200).json({ ok: true, status: "disconnected" });
    } catch (error) {
      if (error?.code === "PLAID_SYNC_ALREADY_RUNNING") {
        return res.status(409).json({ error: error.code, message: "This bank is syncing. Wait for it to finish, then unlink it." });
      }
      if (error?.code === "PLAID_ITEM_NOT_FOUND") return res.status(404).json({ error: error.code });
      return res.status(500).json({ error: "PLAID_DISCONNECT_FAILED", message: publicError(error, "Could not disconnect this bank.") });
    }
  };
}

module.exports = createDisconnectHandler();
module.exports.createDisconnectHandler = createDisconnectHandler;
module.exports.plaidRemovalAlreadyComplete = plaidRemovalAlreadyComplete;
