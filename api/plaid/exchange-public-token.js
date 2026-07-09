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

    if (canStore && user?.id && body.household_id) {
      await supabaseRest("plaid_items", "POST", {
        user_id: user.id,
        household_id: body.household_id,
        item_id: exchange.item_id,
        access_token_ciphertext: accessTokenCiphertext,
        institution_name: body.institution_name || null,
        status: "active",
        last_sync_at: null,
      });
    }

    return sendJson(res, 200, {
      item_id: exchange.item_id,
      request_id: exchange.request_id,
      stored: Boolean(canStore && user?.id && body.household_id),
      message: canStore
        ? "Plaid item exchanged securely."
        : "Plaid item exchanged, but storage is waiting on Supabase/encryption configuration.",
    });
  } catch (error) {
    return sendJson(res, error.status || 500, {
      error: error.message || "Unable to exchange Plaid public token.",
      request_id: error.payload?.request_id,
    });
  }
};
