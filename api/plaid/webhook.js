const { serviceSupabase, safeError } = require("../_utils/supabase");
const { syncItem } = require("../_utils/sync");
const { isActualProHousehold } = require("../_utils/plaidAccess");

function shouldSyncTransactionWebhook(type, code) {
  return type === "TRANSACTIONS" && code === "SYNC_UPDATES_AVAILABLE";
}

async function plaidWebhook(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  const payload = typeof req.body === "string" ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body || {});
  const itemId = String(payload.item_id || "").trim();
  const type = String(payload.webhook_type || "");
  const code = String(payload.webhook_code || "");
  if (!itemId) return res.status(200).json({ ok: true, ignored: true });
  console.log("[plaid:webhook] received", { type, code });
  try {
    const client = serviceSupabase();
    const { data: item, error } = await client.from("plaid_items").select("id,user_id,household_id,status,encrypted_access_token,access_token_ciphertext,transactions_cursor,cursor").eq("plaid_item_id", itemId).maybeSingle();
    if (error) throw error;
    if (!item) return res.status(200).json({ ok: true, ignored: true });
    if (item.status === "removed") {
      return res.status(200).json({ ok: true, ignored: true, reason: item.status });
    }
    if (!(await isActualProHousehold(item.household_id, client))) {
      return res.status(200).json({ ok: true, ignored: true, reason: "pro_required" });
    }
    // Transactions Sync emits SYNC_UPDATES_AVAILABLE alongside legacy
    // DEFAULT_UPDATE / TRANSACTIONS_REMOVED webhooks. Sync once for the
    // cursor-based event so the same update cannot start overlapping imports.
    if (shouldSyncTransactionWebhook(type, code)) {
      const result = await syncItem({ userId: item.user_id, item });
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
    // Plaid retries webhooks. Responding with a safe error lets the retry happen
    // without exposing credentials or a transaction payload.
    const message = safeError(error, "Webhook sync failed.");
    console.error("[plaid:webhook] sync failed", { type, code, error: message });
    return res.status(500).json({ error: "PLAID_WEBHOOK_SYNC_FAILED", message });
  }
}

module.exports = plaidWebhook;
module.exports.shouldSyncTransactionWebhook = shouldSyncTransactionWebhook;
