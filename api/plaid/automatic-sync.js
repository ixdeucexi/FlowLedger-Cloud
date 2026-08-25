const { decryptAccessToken } = require("../_utils/crypto");
const { isAuthorizedCron } = require("../_utils/cronAuth");
const { optional } = require("../_utils/env");
const { plaid, plaidOptions } = require("../_utils/plaid");
const { serviceSupabase, safeError } = require("../_utils/supabase");
const { syncItem } = require("../_utils/sync");
const {
  captureAfterCoherentHouseholdRefresh,
  groupItemsByHousehold,
  refreshHouseholdItems,
} = require("../_utils/dailyCheckingClose");
const { isActualProHousehold } = require("../_utils/plaidAccess");

module.exports = async function automaticPlaidSync(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });

  const secret = optional("CRON_SECRET");
  if (!secret) return res.status(500).json({ error: "CRON_NOT_CONFIGURED" });
  if (!isAuthorizedCron(req, secret)) return res.status(401).json({ error: "UNAUTHORIZED" });

  try {
    const webhook = plaidOptions().webhookUrl;
    if (!webhook) throw new Error("PLAID_WEBHOOK_URL is not configured.");

    const db = serviceSupabase();
    const { data: items, error } = await db
      .from("plaid_items")
      .select("id,user_id,household_id,status,encrypted_access_token,access_token_ciphertext,transactions_cursor,cursor")
      .in("status", ["active", "needs_repair"]);
    if (error) throw error;

    const totals = {
      items: (items || []).length,
      accounts: 0,
      added: 0,
      modified: 0,
      removed: 0,
      creditCards: 0,
      creditCardDebts: 0,
      webhookFailed: 0,
      failed: 0,
    };
    const eligibleItems = (items || []).filter(item => item.encrypted_access_token || item.access_token_ciphertext);
    for (const [householdId, householdItems] of groupItemsByHousehold(eligibleItems)) {
      if (!(await isActualProHousehold(householdId, db))) continue;
      const refresh = await refreshHouseholdItems({
        items: householdItems,
        synchronize: async ({ userId, item }) => {
          const encrypted = item.encrypted_access_token || item.access_token_ciphertext;
          const accessToken = decryptAccessToken(encrypted);
          try {
            await plaid().itemWebhookUpdate({ access_token: accessToken, webhook });
          } catch (error) {
            totals.webhookFailed += 1;
            console.error("[plaid:auto-sync] webhook repair failed", {
              itemRecordId: item.id,
              error: safeError(error, "Plaid webhook repair failed."),
            });
          }
          return syncItem({ userId, item });
        },
      });
      for (const { result } of refresh.results) {
        totals.accounts += result.accounts;
        totals.added += result.transactions.added;
        totals.modified += result.transactions.modified;
        totals.removed += result.transactions.removed;
        totals.creditCards += result.liabilities.cards;
        totals.creditCardDebts += result.liabilities.debts;
      }
      for (const { item, error } of refresh.failures) {
        totals.failed += 1;
        console.error("[plaid:auto-sync] item failed", {
          itemRecordId: item.id,
          error: safeError(error, "Automatic Plaid sync failed."),
        });
      }
      await captureAfterCoherentHouseholdRefresh({ db, householdId, refresh });
    }

    console.log("[plaid:auto-sync] completed", totals);
    const hasFailures = totals.failed > 0 || totals.webhookFailed > 0;
    return res.status(hasFailures ? 500 : 200).json({ ok: !hasFailures, ...totals });
  } catch (error) {
    console.error("[plaid:auto-sync] failed", { error: safeError(error, "Automatic Plaid sync failed.") });
    return res.status(500).json({ error: "PLAID_AUTO_SYNC_FAILED" });
  }
};
