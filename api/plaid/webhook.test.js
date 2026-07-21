const assert = require("node:assert/strict");
const test = require("node:test");

const { shouldSyncTransactionWebhook } = require("./webhook");

test("only the Transactions Sync webhook starts an import", () => {
  assert.equal(shouldSyncTransactionWebhook("TRANSACTIONS", "SYNC_UPDATES_AVAILABLE"), true);
  assert.equal(shouldSyncTransactionWebhook("TRANSACTIONS", "DEFAULT_UPDATE"), false);
  assert.equal(shouldSyncTransactionWebhook("TRANSACTIONS", "TRANSACTIONS_REMOVED"), false);
  assert.equal(shouldSyncTransactionWebhook("TRANSACTIONS", "INITIAL_UPDATE"), false);
  assert.equal(shouldSyncTransactionWebhook("ITEM", "SYNC_UPDATES_AVAILABLE"), false);
});
