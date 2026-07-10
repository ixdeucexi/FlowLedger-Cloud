"use strict";

const { getPlaidClient, readJsonBody, sendJson } = require("../_utils/plaid");
const {
  decryptItemAccessToken,
  getItemByPlaidItemIdForWebhook,
  patchPlaidItem,
  syncPlaidTransactions,
} = require("../_utils/plaid-data");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  const body = readJsonBody(req);
  const plaidItemId = body.item_id;
  const webhookType = body.webhook_type;
  const webhookCode = body.webhook_code;

  if (!plaidItemId) return sendJson(res, 200, { ok: true, ignored: true });

  try {
    const item = await getItemByPlaidItemIdForWebhook(plaidItemId);
    if (!item?.id) return sendJson(res, 200, { ok: true, unknown_item: true });

    if (webhookType === "TRANSACTIONS") {
      const accessToken = decryptItemAccessToken(item);
      await syncPlaidTransactions(getPlaidClient(), item, accessToken);
    }

    return sendJson(res, 200, {
      ok: true,
      webhook_type: webhookType || null,
      webhook_code: webhookCode || null,
    });
  } catch (error) {
    try {
      const item = plaidItemId ? await getItemByPlaidItemIdForWebhook(plaidItemId) : null;
      if (item?.id) {
        await patchPlaidItem(
          item,
          {
            last_attempted_sync_at: new Date().toISOString(),
            error_code: error?.response?.data?.error_code || "WEBHOOK_SYNC_FAILED",
            status: error?.response?.data?.error_code === "ITEM_LOGIN_REQUIRED" ? "needs_repair" : item.status,
          },
          {
            status: error?.response?.data?.error_code === "ITEM_LOGIN_REQUIRED" ? "needs_repair" : item.status,
          },
        );
      }
    } catch {
      // Keep webhook response safe and do not leak internals.
    }
    return sendJson(res, 200, { ok: true, sync_error: true });
  }
};
