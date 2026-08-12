const { plaid } = require("../_utils/plaid");
const { serviceSupabase, publicError, safeError } = require("../_utils/supabase");
const { syncItem } = require("../_utils/sync");
const { isActualProHousehold } = require("../_utils/plaidAccess");
const { PlaidWebhookReplayGuard, readRawRequestBody, verifyPlaidWebhook } = require("../_utils/plaidWebhookVerification");

const replayGuard = new PlaidWebhookReplayGuard();

function shouldSyncTransactionWebhook(type, code) {
  return type === "TRANSACTIONS" && code === "SYNC_UPDATES_AVAILABLE";
}

function shouldSyncLiabilityWebhook(type, code) {
  return type === "LIABILITIES" && code === "DEFAULT_UPDATE";
}

function createPlaidWebhookHandler(dependencies = {}) {
  const database = dependencies.serviceSupabase || serviceSupabase;
  const plaidClient = dependencies.plaid || plaid;
  const synchronize = dependencies.syncItem || syncItem;
  const proHousehold = dependencies.isActualProHousehold || isActualProHousehold;
  const readBody = dependencies.readRawRequestBody || readRawRequestBody;
  const verify = dependencies.verifyPlaidWebhook || verifyPlaidWebhook;
  const guard = dependencies.replayGuard || replayGuard;

  return async function plaidWebhook(req, res) {
    if (req.method !== "POST") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
    let rawBody;
    let verification;
    try {
      rawBody = await readBody(req);
      verification = await verify(rawBody, req.headers, { plaidClient: plaidClient() });
    } catch (error) {
      console.warn("[plaid:webhook] verification rejected", { code: String(error && error.code || "PLAID_WEBHOOK_INVALID") });
      return res.status(401).json({ error: "PLAID_WEBHOOK_INVALID", message: "Webhook verification failed." });
    }
    if (!guard.claim(verification.fingerprint)) {
      return res.status(200).json({ ok: true, ignored: true, reason: "duplicate" });
    }

    let payload;
    try {
      payload = JSON.parse(rawBody.toString("utf8"));
    } catch {
      guard.release(verification.fingerprint);
      return res.status(400).json({ error: "PLAID_WEBHOOK_BODY_INVALID", message: "Webhook body is invalid." });
    }
    const itemId = String(payload.item_id || "").trim();
    const type = String(payload.webhook_type || "");
    const code = String(payload.webhook_code || "");
    if (!itemId) return res.status(200).json({ ok: true, ignored: true });
    console.log("[plaid:webhook] received", { type, code });
    try {
      const client = database();
      const { data: item, error } = await client.from("plaid_items").select("id,user_id,household_id,status,encrypted_access_token,access_token_ciphertext,transactions_cursor,cursor").eq("plaid_item_id", itemId).maybeSingle();
      if (error) throw error;
      if (!item) return res.status(200).json({ ok: true, ignored: true });
      if (item.status === "removed") return res.status(200).json({ ok: true, ignored: true, reason: item.status });
      if (!(await proHousehold(item.household_id, client))) {
        return res.status(200).json({ ok: true, ignored: true, reason: "pro_required" });
      }
      if (shouldSyncTransactionWebhook(type, code) || shouldSyncLiabilityWebhook(type, code)) {
        const result = await synchronize({ userId: item.user_id, item });
        console.log("[plaid:webhook] sync completed", {
          type,
          code,
          added: result.transactions.added,
          modified: result.transactions.modified,
          removed: result.transactions.removed,
        });
        return res.status(200).json({ ok: true, synced: true, added: result.transactions.added, modified: result.transactions.modified, removed: result.transactions.removed });
      }
      return res.status(200).json({ ok: true, ignored: true });
    } catch (error) {
      guard.release(verification.fingerprint);
      console.error("[plaid:webhook] sync failed", { type, code, error: safeError(error, "Webhook sync failed.") });
      return res.status(500).json({ error: "PLAID_WEBHOOK_SYNC_FAILED", message: publicError(error, "Webhook sync failed.") });
    }
  };
}

module.exports = createPlaidWebhookHandler();
module.exports.createPlaidWebhookHandler = createPlaidWebhookHandler;
module.exports.shouldSyncTransactionWebhook = shouldSyncTransactionWebhook;
module.exports.shouldSyncLiabilityWebhook = shouldSyncLiabilityWebhook;
