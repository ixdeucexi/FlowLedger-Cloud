const assert = require("node:assert/strict");
const test = require("node:test");

const { accountsWithDebtStatus, connectedDebtForAccount } = require("./plaidDebtStatus");

test("a connected card reports its Debt and Snowball attachment", () => {
  const account = { id: "account-row", plaid_account_id: "plaid-account", persistent_account_id: "persistent-card" };
  const debt = {
    id: "debt-row",
    name: "Everyday card",
    plaid_account_record_id: "account-row",
    plaid_account_id: "plaid-account",
    plaid_persistent_account_id: "persistent-card",
    include_in_snowball: true,
  };

  assert.equal(connectedDebtForAccount(account, [debt]), debt);
  assert.deepEqual(accountsWithDebtStatus([account], [debt]), [{
    ...account,
    linked_debt_id: "debt-row",
    linked_debt_name: "Everyday card",
    include_in_snowball: true,
  }]);
});

test("an unattached card stays available for one-click attachment", () => {
  const account = { id: "new-card", plaid_account_id: "new-plaid-card", persistent_account_id: null };
  assert.deepEqual(accountsWithDebtStatus([account], []), [{
    ...account,
    linked_debt_id: null,
    linked_debt_name: null,
    include_in_snowball: false,
  }]);
});

test("persistent account identity preserves an attachment after a Plaid relink", () => {
  const account = { id: "replacement-row", plaid_account_id: "replacement-id", persistent_account_id: "stable-card" };
  const debt = {
    id: "existing-debt",
    name: "Existing debt",
    plaid_account_record_id: "old-row",
    plaid_account_id: "old-id",
    plaid_persistent_account_id: "stable-card",
    include_in_snowball: true,
  };
  assert.equal(connectedDebtForAccount(account, [debt]), debt);
});
