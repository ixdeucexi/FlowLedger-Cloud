const assert = require("node:assert/strict");
const test = require("node:test");

const { shouldImportPlaidTransaction } = require("./sync");

test("only posted Plaid activity becomes a FlowLedger transaction", () => {
  assert.equal(shouldImportPlaidTransaction({ pending: true }), false);
  assert.equal(shouldImportPlaidTransaction({ pending: false }), true);
  assert.equal(shouldImportPlaidTransaction({}), true);
});
