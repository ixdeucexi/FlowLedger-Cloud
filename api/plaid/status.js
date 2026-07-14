const { authenticatedUser, serviceSupabase, safeError } = require("../_utils/supabase");

module.exports = async function plaidStatus(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  const auth = await authenticatedUser(req);
  if (!auth.user) return res.status(401).json({ error: auth.error, message: "Please sign in again." });
  try {
    const client = serviceSupabase();
    const items = await client.from("plaid_items").select("id,plaid_item_id,institution_id,institution_name,status,error_code,last_attempted_sync_at,last_successful_sync_at,created_at,updated_at").eq("user_id", auth.user.id).order("created_at", { ascending: false });
    if (items.error) throw items.error;
    const accounts = await client.from("plaid_accounts").select("id,plaid_item_record_id,plaid_account_id,name,official_name,mask,account_type,account_subtype,current_balance,available_balance,currency_code,is_active").eq("user_id", auth.user.id).eq("is_active", true);
    if (accounts.error) throw accounts.error;
    return res.status(200).json({ items: items.data || [], accounts: accounts.data || [] });
  } catch (error) {
    return res.status(500).json({ error: "PLAID_STATUS_FAILED", message: safeError(error, "Could not load bank connections.") });
  }
};
