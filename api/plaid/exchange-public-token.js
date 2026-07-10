"use strict";

const {
  encryptAccessToken,
  getPlaidClient,
  readJsonBody,
  requireSupabaseUser,
  safePlaidError,
  sendJson,
} = require("../_utils/plaid");
const {
  getItemByPlaidItemId,
  savePlaidItem,
  syncPlaidAccountMetadata,
  syncPlaidTransactions,
} = require("../_utils/plaid-data");

async function getInstitutionName(client, accessToken, fallback) {
  try {
    const item = await client.itemGet({ access_token: accessToken });
    const institutionId = item?.data?.item?.institution_id || null;
    if (!institutionId) return { institutionId: null, institutionName: fallback || null };
    const institution = await client.institutionsGetById({
      institution_id: institutionId,
      country_codes: ["US"],
    });
    return {
      institutionId,
      institutionName: institution?.data?.institution?.name || fallback || null,
    };
  } catch {
    return { institutionId: null, institutionName: fallback || null };
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  try {
    const user = await requireSupabaseUser(req);
    const body = readJsonBody(req);
    if (!body.public_token || typeof body.public_token !== "string") {
      return sendJson(res, 400, { error: "Missing public_token." });
    }

    const client = getPlaidClient();
    const exchange = await client.itemPublicTokenExchange({ public_token: body.public_token });
    const accessToken = exchange?.data?.access_token;
    const plaidItemId = exchange?.data?.item_id;
    if (!accessToken || !plaidItemId) {
      return sendJson(res, 502, { error: "Plaid did not return a bank connection." });
    }

    const existing = await getItemByPlaidItemId(user.id, plaidItemId);
    if (existing?.id) {
      return sendJson(res, 409, {
        error: "This bank connection already exists in FlowLedger.",
        plaid_item_record_id: existing.id,
        institution_name: existing.institution_name || null,
        status: existing.status || "active",
      });
    }

    const encryptedAccessToken = encryptAccessToken(accessToken);
    const metadata = await getInstitutionName(client, accessToken, body.institution_name || null);
    const item = await savePlaidItem({
      userId: user.id,
      householdId: body.household_id || null,
      plaidItemId,
      encryptedAccessToken,
      institutionId: body.institution_id || metadata.institutionId,
      institutionName: body.institution_name || metadata.institutionName,
      status: "active",
    });

    const accounts = await syncPlaidAccountMetadata(client, accessToken, item, user.id);
    let transactionSync = {
      status: "not_started",
      created: 0,
      updated: 0,
      removed: 0,
      pages: 0,
      message: "Transaction sync has not started yet.",
    };

    try {
      const accountLinks = accounts.synced.map(entry => entry.row).filter(Boolean);
      const synced = await syncPlaidTransactions(client, item, accessToken, accountLinks);
      transactionSync = {
        status: "complete",
        created: synced.created,
        updated: synced.updated,
        removed: synced.removed,
        pages: synced.pages,
        empty: synced.empty,
        message: synced.empty
          ? "Bank connected. Plaid may still be preparing recent activity."
          : "Bank connected and recent activity started syncing.",
      };
    } catch (syncError) {
      const safeSyncError = safePlaidError(syncError, "Plaid is still preparing transaction history.");
      transactionSync = {
        status: "pending",
        created: 0,
        updated: 0,
        removed: 0,
        pages: 0,
        error_code: safeSyncError.error_code || null,
        message: "Bank connected. Plaid is still preparing transaction history, so sync again shortly.",
      };
    }

    return sendJson(res, 200, {
      plaid_item_record_id: item?.id || null,
      institution_name: item?.institution_name || metadata.institutionName || "Connected bank",
      status: "active",
      accounts: accounts.previews,
      transaction_sync: transactionSync,
      message: transactionSync.message || "Bank connected. Choose which accounts FlowLedger should add.",
    });
  } catch (error) {
    return sendJson(
      res,
      error.status || error.response?.status || 500,
      safePlaidError(error, "Unable to save this Plaid connection."),
    );
  }
};
