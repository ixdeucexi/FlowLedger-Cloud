const { authenticatedUser, serviceSupabase, safeError } = require("../_utils/supabase");
const { syncItem } = require("../_utils/sync");

module.exports = async function plaidSync(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  const auth = await authenticatedUser(req);
  if (!auth.user) return res.status(401).json({ error: auth.error, message: "Please sign in again." });
  try {
    const client = serviceSupabase();
    const { data: items, error } = await client.from("plaid_items").select("id,encrypted_access_token,access_token_ciphertext,transactions_cursor,cursor").eq("user_id", auth.user.id).eq("status", "active").order("updated_at", { ascending: false });
    if (error) throw error;
    if (!items?.length) return res.status(404).json({ error: "PLAID_ITEM_NOT_FOUND", message: "Connect a bank before syncing." });
    const results = [];
    for (const item of items) results.push(await syncItem({ userId: auth.user.id, item }));
    return res.status(200).json({
      ok: true,
      accounts_count: results.reduce((total, result) => total + result.accounts, 0),
      transactions: results.reduce((totals, result) => ({
        added: totals.added + result.transactions.added,
        modified: totals.modified + result.transactions.modified,
        removed: totals.removed + result.transactions.removed,
      }), { added: 0, modified: 0, removed: 0 }),
      transactions_pending: results.some(result => result.transactions_pending),
    });
  } catch (error) {
    const code = error && error.response && error.response.data && error.response.data.error_code || error.code || "PLAID_SYNC_FAILED";
    return res.status(500).json({ error: code, message: safeError(error, "Could not sync bank activity.") });
  }
};
