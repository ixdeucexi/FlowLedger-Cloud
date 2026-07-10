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
  patchPlaidItem,
  syncPlaidTransactions,
} = require("../_utils/plaid-data");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  try {
    const user = await requireSupabaseUser(req);
    const body = readJsonBody(req);
    if (!body.plaid_item_record_id) {
      return sendJson(res, 400, { error: "Missing bank connection ID." });
    }

    const item = await getItemById(user.id, body.plaid_item_record_id);
    if (!item?.id) return sendJson(res, 404, { error: "Bank connection was not found." });

    const accessToken = decryptItemAccessToken(item);
    await patchPlaidItem(
      item,
      { last_attempted_sync_at: new Date().toISOString() },
      {},
    );
    const result = await syncPlaidTransactions(getPlaidClient(), item, accessToken);
    return sendJson(res, 200, {
      status: "active",
      transactions_imported: result.created,
      transactions_updated: result.updated,
      transactions_removed: result.removed,
      pages: result.pages,
    });
  } catch (error) {
    return sendJson(
      res,
      error.status || error.response?.status || 500,
      safePlaidError(error, "Unable to sync bank activity."),
    );
  }
};
