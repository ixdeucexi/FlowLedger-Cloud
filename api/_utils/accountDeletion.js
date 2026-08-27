const { bearerToken, authenticatedUser, serviceSupabase } = require("./supabase");
const { decryptAccessToken } = require("./crypto");
const { plaid } = require("./plaid");
const { required } = require("./env");
const { revokeAppleAuthorization } = require("./appleProvider");

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

async function deleteRevenueCatCustomer(userId, dependencies = {}) {
  const request = dependencies.fetch || fetch;
  const apiKey = Object.prototype.hasOwnProperty.call(dependencies, "revenueCatSecretApiKey")
    ? String(dependencies.revenueCatSecretApiKey || "").trim()
    : required("REVENUECAT_SECRET_API_KEY");
  if (!apiKey) throw new Error("REVENUECAT_SECRET_API_KEY_MISSING");
  const response = await request(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
  });
  if (!response.ok && response.status !== 404) throw new Error("REVENUECAT_CUSTOMER_DELETION_FAILED");
}

function userUsesApple(user) {
  const providers = Array.isArray(user?.app_metadata?.providers) ? user.app_metadata.providers : [user?.app_metadata?.provider];
  return providers.map(String).includes("apple");
}

async function disconnectPlaidItems(client, userId, dependencies = {}) {
  const makePlaid = dependencies.plaid || plaid;
  const decrypt = dependencies.decryptAccessToken || decryptAccessToken;
  const { data: ownedHouseholds, error: householdError } = await client
    .from("households")
    .select("id")
    .eq("created_by", userId);
  if (householdError) throw householdError;
  const ownedHouseholdIds = (ownedHouseholds || []).map(row => row.id).filter(Boolean);
  const ownedByUser = await client
    .from("plaid_items")
    .select("id,status,encrypted_access_token,access_token_ciphertext")
    .eq("user_id", userId);
  if (ownedByUser.error) throw ownedByUser.error;
  const ownedByHousehold = ownedHouseholdIds.length
    ? await client.from("plaid_items").select("id,status,encrypted_access_token,access_token_ciphertext").in("household_id", ownedHouseholdIds)
    : { data: [], error: null };
  if (ownedByHousehold.error) throw ownedByHousehold.error;
  const items = [...new Map([...(ownedByUser.data || []), ...(ownedByHousehold.data || [])].map(item => [item.id, item])).values()];

  let revoked = 0;
  for (const item of items) {
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
      .eq("id", item.id);
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
      if (typeof inspection?.billingCustomerExists !== "boolean") {
        throw new Error("ACCOUNT_BILLING_INSPECTION_UNAVAILABLE");
      }

      if (userUsesApple(auth.user)) {
        try {
          await (dependencies.revokeAppleAuthorization || revokeAppleAuthorization)(client, auth.user.id, dependencies);
        } catch (error) {
          console.error("Account deletion Apple revocation failed", error?.message || "unknown");
          return res.status(502).json({ error: "APPLE_REVOCATION_FAILED", message: "Apple sign-in access could not be revoked. No financial records were deleted; try again." });
        }
      }
      if (inspection.billingCustomerExists) {
        try {
          await deleteRevenueCatCustomer(auth.user.id, dependencies);
        } catch (error) {
          console.error("Account deletion RevenueCat cleanup failed", error?.message || "unknown");
          return res.status(502).json({ error: "BILLING_CUSTOMER_DELETION_FAILED", message: "Store subscription history could not be removed from the billing processor. No financial records were deleted; try again." });
        }
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
            message: "Remove every other member from each household you own before deleting your account. Ownership transfer is not currently available.",
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
  deleteRevenueCatCustomer,
  hasRecentVerifiedLogin,
  isAlreadyRemovedPlaidItem,
  jwtIssuedAt,
  jwtSessionId,
  userUsesApple,
};
