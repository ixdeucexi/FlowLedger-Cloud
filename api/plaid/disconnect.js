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

    try {
      const accessToken = decryptItemAccessToken(item);
      await getPlaidClient().itemRemove({ access_token: accessToken });
    } catch {
      // If Plaid cannot remove the item, still disable future FlowLedger sync.
    }

    await patchPlaidItem(
      item,
      {
        encrypted_access_token: null,
        access_token_ciphertext: null,
        status: "removed",
        error_code: null,
      },
      {
        access_token_ciphertext: null,
        status: "removed",
      },
    );

    return sendJson(res, 200, {
      status: "removed",
      message: "Bank disconnected. Historical transactions were kept for your records.",
    });
  } catch (error) {
    return sendJson(
      res,
      error.status || error.response?.status || 500,
      safePlaidError(error, "Unable to disconnect this bank."),
    );
  }
};
