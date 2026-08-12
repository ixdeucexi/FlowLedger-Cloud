const { authenticatedUser, serviceSupabase, publicError } = require("../_utils/supabase");
const { authorizeProHousehold, requestedHouseholdId } = require("../_utils/plaidAccess");
const { accountsWithDebtStatus } = require("../_utils/plaidDebtStatus");

module.exports = async function plaidStatus(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  const auth = await authenticatedUser(req);
  if (!auth.user) return res.status(401).json({ error: auth.error, message: "Please sign in again." });
  try {
    const access = await authorizeProHousehold(auth.user.id, requestedHouseholdId(req));
    if (!access.ok) return res.status(access.status).json({ error: access.error, message: access.message });
    const client = serviceSupabase();
    const [items, accounts, debts] = await Promise.all([
      client.from("plaid_items").select("id,plaid_item_id,institution_id,institution_name,status,error_code,last_attempted_sync_at,last_successful_sync_at,created_at,updated_at").eq("user_id", auth.user.id).eq("household_id", access.householdId).neq("status", "removed").order("created_at", { ascending: false }),
      client.from("plaid_accounts").select("id,plaid_item_record_id,plaid_account_id,persistent_account_id,name,official_name,mask,account_type,account_subtype,current_balance,available_balance,currency_code,is_active,minimum_payment_amount,next_payment_due_date,last_statement_balance,last_statement_issue_date,is_overdue,purchase_apr,liability_last_synced_at").eq("user_id", auth.user.id).eq("household_id", access.householdId).eq("is_active", true),
      client.from("bills").select("id,name,include_in_snowball,plaid_account_record_id,plaid_account_id,plaid_persistent_account_id").eq("user_id", auth.user.id).eq("household_id", access.householdId).eq("is_debt", true),
    ]);
    if (items.error) throw items.error;
    if (accounts.error) throw accounts.error;
    if (debts.error) throw debts.error;
    return res.status(200).json({
      items: items.data || [],
      accounts: accountsWithDebtStatus(accounts.data || [], debts.data || []),
      debt_options: (debts.data || [])
        .filter(debt => !debt.plaid_account_record_id && !debt.plaid_account_id && !debt.plaid_persistent_account_id)
        .map(debt => ({ id: debt.id, name: debt.name })),
    });
  } catch (error) {
    return res.status(500).json({ error: "PLAID_STATUS_FAILED", message: publicError(error, "Could not load bank connections.") });
  }
};
