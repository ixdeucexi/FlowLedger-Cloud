const {
  encryptAccessToken,
  encryptionConfigured,
  getSupabaseUser,
  plaidConfigured,
  plaidPost,
  readJsonBody,
  sendJson,
  supabaseConfigured,
  supabaseRest,
} = require("../_utils/plaid");

function accountTypeFromPlaid(account) {
  if (account.type === "depository" && account.subtype === "savings") return "savings";
  if (account.type === "depository") return "checking";
  return null;
}

function safeAccountPreview(account) {
  const suggestedAccountType = accountTypeFromPlaid(account);
  return {
    plaid_account_id: account.account_id,
    name: account.name,
    official_name: account.official_name || null,
    mask: account.mask || null,
    type: account.type,
    subtype: account.subtype || null,
    current_balance: account.balances?.current ?? null,
    available_balance: account.balances?.available ?? null,
    supported: Boolean(suggestedAccountType),
    suggested_account_type: suggestedAccountType,
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  if (!plaidConfigured()) {
    return sendJson(res, 503, { error: "Plaid is not configured yet." });
  }

  const body = readJsonBody(req);
  if (!body.public_token) {
    return sendJson(res, 400, { error: "Missing public_token." });
  }

  try {
    const exchange = await plaidPost("/item/public_token/exchange", {
      public_token: body.public_token,
    });

    const accessTokenCiphertext = encryptAccessToken(exchange.access_token);
    const canStore = Boolean(accessTokenCiphertext && supabaseConfigured() && encryptionConfigured());
    const user = canStore ? await getSupabaseUser(req) : null;
    const accountsPayload = await plaidPost("/accounts/get", {
      access_token: exchange.access_token,
    });

    let storedItem = null;

    if (canStore && user?.id) {
      const inserted = await supabaseRest("plaid_items?on_conflict=user_id,item_id", "POST", {
        user_id: user.id,
        household_id: body.household_id || null,
        item_id: exchange.item_id,
        access_token_ciphertext: accessTokenCiphertext,
        institution_id: body.institution_id || null,
        institution_name: body.institution_name || null,
        status: "active",
        last_synced_at: null,
      }, { prefer: "resolution=merge-duplicates,return=representation" });
      storedItem = Array.isArray(inserted) ? inserted[0] : inserted;
    }

    return sendJson(res, 200, {
      item_id: exchange.item_id,
      plaid_item_record_id: storedItem?.id || null,
      request_id: exchange.request_id,
      stored: Boolean(storedItem?.id),
      accounts: (accountsPayload.accounts || []).map(safeAccountPreview),
      message: canStore
        ? "Bank connected. Choose which accounts FlowLedger should add."
        : "Plaid item exchanged, but storage is waiting on Supabase/encryption configuration.",
    });
  } catch (error) {
    return sendJson(res, error.status || 500, {
      error: error.message || "Unable to exchange Plaid public token.",
      request_id: error.payload?.request_id,
    });
  }
};
