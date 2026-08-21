const { bearerToken, authenticatedUser, serviceSupabase } = require("./supabase");
const { decryptAccessToken } = require("./crypto");
const { plaid } = require("./plaid");

const RECENT_LOGIN_SECONDS = 10 * 60;

function parseBody(req) {
  if (!req?.body) return {};
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return req.body;
}

function jwtIssuedAt(token) {
  try {
    const payload = JSON.parse(Buffer.from(String(token).split(".")[1] || "", "base64url").toString("utf8"));
    return Number.isFinite(payload?.iat) ? Number(payload.iat) : null;
  } catch {
    return null;
  }
}

function jwtSessionId(token) {
  try {
    const payload = JSON.parse(Buffer.from(String(token).split(".")[1] || "", "base64url").toString("utf8"));
    return typeof payload?.session_id === "string" && payload.session_id ? payload.session_id : null;
  } catch {
    return null;
  }
}

function hasRecentVerifiedLogin(token, nowSeconds = Math.floor(Date.now() / 1000)) {
  const issuedAt = jwtIssuedAt(token);
  if (issuedAt == null) return false;
  const age = nowSeconds - issuedAt;
  return age >= -60 && age <= RECENT_LOGIN_SECONDS;
}

function isAlreadyRemovedPlaidItem(error) {
  const code = String(error?.response?.data?.error_code || error?.error_code || error?.code || "").toUpperCase();
  return code === "ITEM_NOT_FOUND" || code === "INVALID_ACCESS_TOKEN";
}

async function disconnectPlaidItems(client, userId, dependencies = {}) {
  const makePlaid = dependencies.plaid || plaid;
  const decrypt = dependencies.decryptAccessToken || decryptAccessToken;
  const { data, error } = await client
    .from("plaid_items")
    .select("id,status,encrypted_access_token,access_token_ciphertext")
    .eq("user_id", userId);
  if (error) throw error;

  let revoked = 0;
  for (const item of data || []) {
    const encrypted = item.encrypted_access_token || item.access_token_ciphertext;
    if (encrypted) {
      try {
        await makePlaid().itemRemove({ access_token: decrypt(encrypted) });
      } catch (removeError) {
        if (!isAlreadyRemovedPlaidItem(removeError)) throw removeError;
      }
    }
    const { error: updateError } = await client
      .from("plaid_items")
      .update({
        status: "removed",
        encrypted_access_token: null,
        access_token_ciphertext: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", item.id)
      .eq("user_id", userId);
    if (updateError) throw updateError;
    revoked += 1;
  }
  return revoked;
}

function createAccountDeletionHandler(dependencies = {}) {
  const authenticate = dependencies.authenticatedUser || authenticatedUser;
  const database = dependencies.serviceSupabase || serviceSupabase;
  const nowSeconds = dependencies.nowSeconds || (() => Math.floor(Date.now() / 1000));

  return async function accountDeletion(req, res) {
    if (req.method !== "POST") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
    if (String(parseBody(req).confirmation || "").trim() !== "DELETE") {
      return res.status(400).json({ error: "DELETION_CONFIRMATION_REQUIRED", message: "Type DELETE to confirm." });
    }

    const auth = await authenticate(req);
    if (!auth.user) return res.status(401).json({ error: auth.error || "AUTH_TOKEN_INVALID", message: "Please sign in again." });
    const token = bearerToken(req);
    if (!token || !hasRecentVerifiedLogin(token, nowSeconds())) {
      return res.status(403).json({
        error: "RECENT_LOGIN_REQUIRED",
        message: "For security, sign in again and return here within 10 minutes.",
      });
    }

    const client = database();
    try {
      const sessionId = jwtSessionId(token);
      if (!sessionId) {
        return res.status(403).json({ error: "RECENT_LOGIN_REQUIRED", message: "For security, sign in again before deleting your account." });
      }
      const { data: recentSession, error: recentSessionError } = await client.rpc("verify_recent_account_deletion_session", {
        p_user_id: auth.user.id,
        p_session_id: sessionId,
        p_max_age_seconds: RECENT_LOGIN_SECONDS,
      });
      if (recentSessionError) throw recentSessionError;
      if (recentSession !== true) {
        return res.status(403).json({ error: "RECENT_LOGIN_REQUIRED", message: "For security, sign in again before deleting your account." });
      }

      const { data: inspection, error: inspectionError } = await client.rpc("inspect_account_deletion", { p_user_id: auth.user.id });
      if (inspectionError) throw inspectionError;
      const blocked = Array.isArray(inspection?.blockedHouseholds) ? inspection.blockedHouseholds : [];
      if (blocked.length) {
        return res.status(409).json({
          error: "HOUSEHOLD_OWNER_TRANSFER_REQUIRED",
          message: "Transfer ownership or remove the other members before deleting your account.",
          households: blocked.map(item => ({ name: String(item?.name || "Shared household"), memberCount: Number(item?.memberCount || 0) })),
        });
      }

      let plaidItemsRevoked;
      try {
        plaidItemsRevoked = await disconnectPlaidItems(client, auth.user.id, dependencies);
      } catch (error) {
        console.error("Account deletion Plaid disconnect failed", error?.code || error?.message || "unknown");
        return res.status(502).json({
          error: "PLAID_DISCONNECT_FAILED",
          message: "A connected bank could not be disconnected. No financial records were deleted; links already processed remain disconnected. Try again.",
        });
      }

      const { data: prepared, error: prepareError } = await client.rpc("prepare_account_deletion", {
        p_user_id: auth.user.id,
        p_plaid_items_revoked: plaidItemsRevoked,
      });
      if (prepareError) {
        if (String(prepareError.message || "").includes("account_deletion_owner_transfer_required")) {
          return res.status(409).json({
            error: "HOUSEHOLD_OWNER_TRANSFER_REQUIRED",
            message: "Transfer ownership or remove the other members before deleting your account.",
          });
        }
        throw prepareError;
      }

      const receiptId = String(prepared?.receiptId || "");
      if (!receiptId) throw new Error("Account deletion receipt was not created.");

      const { error: deleteError } = await client.auth.admin.deleteUser(auth.user.id, false);
      if (deleteError) {
        console.error("Account deletion Auth cleanup failed", deleteError.message || "unknown");
        return res.status(503).json({
          error: "AUTH_DELETION_PENDING",
          message: "Your data was removed, but account access cleanup needs another attempt.",
          receiptId,
        });
      }

      const { data: completed, error: completeError } = await client.rpc("complete_account_deletion", { p_receipt_id: receiptId });
      if (completeError) {
        console.error("Account deletion receipt finalization failed", completeError.message || "unknown");
      }

      return res.status(200).json({
        ok: true,
        receipt: completed || prepared,
        receiptFinalizationPending: Boolean(completeError),
      });
    } catch (error) {
      console.error("Account deletion failed", error?.code || error?.message || "unknown");
      return res.status(500).json({ error: "ACCOUNT_DELETION_FAILED", message: "Your account was not deleted. Please try again." });
    }
  };
}

module.exports = {
  RECENT_LOGIN_SECONDS,
  createAccountDeletionHandler,
  disconnectPlaidItems,
  hasRecentVerifiedLogin,
  isAlreadyRemovedPlaidItem,
  jwtIssuedAt,
  jwtSessionId,
};
