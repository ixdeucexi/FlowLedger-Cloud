const { authenticatedUser, serviceSupabase, publicError } = require("../_utils/supabase");
const { authorizeProHousehold, requestedHouseholdId } = require("../_utils/plaidAccess");
const { accountsWithDebtStatus } = require("../_utils/plaidDebtStatus");
const { hasInitialImportProfile, initialHistoryStatus } = require("../_utils/plaidInitialImport");
const STATUS_ITEM_COLUMNS = "id,plaid_item_id,institution_id,institution_name,status,error_code,last_attempted_sync_at,last_successful_sync_at,created_at,updated_at,initial_import_version,initial_import_from,initial_history_complete_at";

function createPlaidStatusHandler(dependencies = {}) {
  const authenticate = dependencies.authenticatedUser || authenticatedUser;
  const authorize = dependencies.authorizeProHousehold || authorizeProHousehold;
  const database = dependencies.serviceSupabase || serviceSupabase;
  return async function plaidStatus(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  const auth = await authenticate(req);
  if (!auth.user) return res.status(401).json({ error: auth.error, message: "Please sign in again." });
  try {
    const access = await authorize(auth.user.id, requestedHouseholdId(req));
    if (!access.ok) return res.status(access.status).json({ error: access.error, message: access.message });
    const client = database();
    const [items, accounts, debts] = await Promise.all([
      client.from("plaid_items").select(STATUS_ITEM_COLUMNS).eq("user_id", auth.user.id).eq("household_id", access.householdId).neq("status", "removed").order("created_at", { ascending: false }),
      client.from("plaid_accounts").select("id,plaid_item_record_id,plaid_account_id,persistent_account_id,name,display_name,official_name,mask,account_type,account_subtype,current_balance,available_balance,currency_code,is_active,minimum_payment_amount,next_payment_due_date,last_statement_balance,last_statement_issue_date,is_overdue,purchase_apr,liability_last_synced_at").eq("user_id", auth.user.id).eq("household_id", access.householdId).eq("is_active", true),
      client.from("bills").select("id,name,include_in_snowball,plaid_account_record_id,plaid_account_id,plaid_persistent_account_id").eq("user_id", auth.user.id).eq("household_id", access.householdId).eq("is_debt", true),
    ]);
    if (items.error) throw items.error;
    if (accounts.error) throw accounts.error;
    if (debts.error) throw debts.error;
    const activeItems = [...(items.data || [])];
    const listedItemIds = new Set(activeItems.map(item => item.id));
    const cleanupIds = [...new Set((accounts.data || []).map(account => account.plaid_item_record_id)
      .filter(id => id && !listedItemIds.has(id)))];
    if (cleanupIds.length) {
      // A provider unlink can succeed while local account retirement fails.
      // Preserve an owned, explicit retry target across reload without exposing
      // ordinary removed connections or reviving them for synchronization.
      const cleanup = await client.from("plaid_items").select(STATUS_ITEM_COLUMNS)
        .eq("user_id", auth.user.id).eq("household_id", access.householdId)
        .eq("status", "removed").in("id", cleanupIds);
      if (cleanup.error) throw cleanup.error;
      activeItems.push(...(cleanup.data || []));
    }
    const activeItemIds = new Set(activeItems.map(item => item.id));
    return res.status(200).json({
      items: activeItems.map(item => ({
        ...item,
        initial_import_version: hasInitialImportProfile(item) ? item.initial_import_version : null,
        initial_import_from: hasInitialImportProfile(item) ? item.initial_import_from : null,
        initial_history_complete_at: hasInitialImportProfile(item) ? item.initial_history_complete_at || null : null,
        history_status: initialHistoryStatus(item),
        can_disconnect: true,
        disconnect_cleanup_needed: item.status === "removed",
      })),
      accounts: accountsWithDebtStatus((accounts.data || []).filter(account => activeItemIds.has(account.plaid_item_record_id)), debts.data || []),
      debt_options: (debts.data || [])
        .filter(debt => !debt.plaid_account_record_id && !debt.plaid_account_id && !debt.plaid_persistent_account_id)
        .map(debt => ({ id: debt.id, name: debt.name })),
    });
  } catch (error) {
    return res.status(500).json({ error: "PLAID_STATUS_FAILED", message: publicError(error, "Could not load bank connections.") });
  }
  };
}

module.exports = createPlaidStatusHandler();
module.exports.createPlaidStatusHandler = createPlaidStatusHandler;
