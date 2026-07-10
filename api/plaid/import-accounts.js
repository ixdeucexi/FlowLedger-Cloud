"use strict";

const {
  getPlaidClient,
  readJsonBody,
  requireSupabaseUser,
  safePlaidError,
  sendJson,
} = require("../_utils/plaid");
const {
  decryptItemAccessToken,
  getItemById,
  getPlaidAccountLinksForItem,
  patchPlaidItem,
  syncPlaidTransactions,
  upsertFlowLedgerAccountForPlaid,
} = require("../_utils/plaid-data");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  try {
    const user = await requireSupabaseUser(req);
    const body = readJsonBody(req);
    const selectedAccountIds = Array.isArray(body.selected_account_ids)
      ? body.selected_account_ids.filter(id => typeof id === "string")
      : [];

    if (!body.plaid_item_record_id || !selectedAccountIds.length) {
      return sendJson(res, 400, { error: "Choose at least one account to add." });
    }

    const item = await getItemById(user.id, body.plaid_item_record_id);
    if (!item?.id) return sendJson(res, 404, { error: "Bank connection was not found. Connect again." });

    const accessToken = decryptItemAccessToken(item);
    const client = getPlaidClient();
    const response = await client.accountsGet({ access_token: accessToken });
    const selectedAccounts = (response?.data?.accounts || [])
      .filter(account => selectedAccountIds.includes(account.account_id));

    const importedLinks = [];
    let accountsAdded = 0;
    let accountsSkipped = 0;
    for (const account of selectedAccounts) {
      const result = await upsertFlowLedgerAccountForPlaid(
        user.id,
        item.household_id || body.household_id || null,
        item.id,
        account,
      );
      if (result.skipped) {
        accountsSkipped += 1;
      } else {
        accountsAdded += 1;
        importedLinks.push(result);
      }
    }

    const links = await getPlaidAccountLinksForItem(user.id, item.id);
    let syncResult = { created: 0, updated: 0, removed: 0, pending: false };
    try {
      syncResult = await syncPlaidTransactions(client, item, accessToken, links);
    } catch (error) {
      const code = error?.response?.data?.error_code || error?.payload?.error_code;
      await patchPlaidItem(
        item,
        {
          last_attempted_sync_at: new Date().toISOString(),
          error_code: code || "SYNC_FAILED",
          status: code === "ITEM_LOGIN_REQUIRED" ? "needs_repair" : "active",
        },
        {
          status: code === "ITEM_LOGIN_REQUIRED" ? "needs_repair" : "active",
        },
      );
      if (code === "PRODUCT_NOT_READY") {
        syncResult = { created: 0, updated: 0, removed: 0, pending: true };
      } else {
        throw error;
      }
    }

    return sendJson(res, 200, {
      accounts_added: accountsAdded,
      accounts_skipped: accountsSkipped,
      transactions_imported: syncResult.created,
      transactions_updated: syncResult.updated,
      transactions_removed: syncResult.removed,
      transactions_pending: Boolean(syncResult.pending),
      message: syncResult.pending
        ? "Accounts were added. Plaid is still preparing transactions, so sync again in a moment."
        : `Added ${accountsAdded} account${accountsAdded === 1 ? "" : "s"} and imported ${syncResult.created} transaction${syncResult.created === 1 ? "" : "s"}.`,
    });
  } catch (error) {
    return sendJson(
      res,
      error.status || error.response?.status || 500,
      safePlaidError(error, "Bank accounts could not be imported."),
    );
  }
};
