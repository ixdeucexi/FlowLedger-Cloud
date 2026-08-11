const assert = require("node:assert/strict");
const test = require("node:test");

const { isPlaidSyncAlreadyRunning, plaidAction } = require("../plaid/sync");

test("Plaid sync router dispatches the credit-card attachment rewrite", () => {
  assert.equal(
    plaidAction({ query: { plaidAction: "attach-credit-card" } }),
    "attach-credit-card",
  );
});

test("Plaid sync router dispatches the account nickname rewrite", () => {
  assert.equal(
    plaidAction({ query: { plaidAction: "account-nickname" } }),
    "account-nickname",
  );
});

test("Plaid sync router preserves the normal sync route", () => {
  assert.equal(plaidAction({ query: {} }), "");
});

test("concurrent Plaid syncs are treated as an accepted in-progress request", () => {
  assert.equal(
    isPlaidSyncAlreadyRunning({ code: "PLAID_SYNC_ALREADY_RUNNING" }),
    true,
  );
  assert.equal(
    isPlaidSyncAlreadyRunning({
      response: { data: { error_code: "PLAID_SYNC_ALREADY_RUNNING" } },
    }),
    true,
  );
  assert.equal(
    isPlaidSyncAlreadyRunning({ code: "ITEM_LOGIN_REQUIRED" }),
    false,
  );
});
