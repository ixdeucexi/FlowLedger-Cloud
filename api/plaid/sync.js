const { authenticatedUser, serviceSupabase, safeError } = require("../_utils/supabase");
const { syncItem } = require("../_utils/sync");

module.exports = async function plaidSync(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  const auth = await authenticatedUser(req);
  if (!auth.user) return res.status(401).json({ error: auth.error, message: "Please sign in again." });
  try {
    const client = serviceSupabase();
    const { data: item, error } = await client.from("plaid_items").select("id,encrypted_access_token,access_token_ciphertext,transactions_cursor,cursor").eq("user_id", auth.user.id).eq("status", "active").order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    if (!item) return res.status(404).json({ error: "PLAID_ITEM_NOT_FOUND", message: "Connect a bank before syncing." });
    const result = await syncItem({ userId: auth.user.id, item });
    return res.status(200).json({
      ok: true,
      accounts_count: result.accounts,
      transactions: result.transactions,
      transactions_pending: Boolean(result.transactions_pending),
    });
  } catch (error) {
    const code = error && error.response && error.response.data && error.response.data.error_code || error.code || "PLAID_SYNC_FAILED";
    return res.status(500).json({ error: code, message: safeError(error, "Could not sync bank activity.") });
  }
};
