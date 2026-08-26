const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const attachCreditCard = require("./plaidAttachCreditCard");

test("connected card balance validation preserves zero and rejects unavailable values", () => {
  assert.equal(attachCreditCard.verifiedConnectedCreditBalance(0), 0);
  assert.equal(attachCreditCard.verifiedConnectedCreditBalance("125.42"), 125.42);
  assert.equal(attachCreditCard.verifiedConnectedCreditBalance(-5), 0);
  assert.equal(attachCreditCard.verifiedConnectedCreditBalance(null), null);
  assert.equal(attachCreditCard.verifiedConnectedCreditBalance(undefined), null);
  assert.equal(attachCreditCard.verifiedConnectedCreditBalance("not-a-balance"), null);
});

test("attachment defers before any debt lookup or mutation when the refreshed balance is unavailable", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "plaidAttachCreditCard.js"), "utf8");
  const validation = source.indexOf("const balance = verifiedConnectedCreditBalance(refreshedAccount.current_balance)");
  const unavailableResponse = source.indexOf('error: "PLAID_BALANCE_UNAVAILABLE"', validation);
  const existingDebtLookup = source.indexOf("const alreadyLinked = await findConnectedCardDebt", validation);
  const billLookup = source.indexOf('.from("bills")', validation);

  assert.ok(validation >= 0);
  assert.ok(unavailableResponse > validation);
  assert.ok(existingDebtLookup > unavailableResponse);
  assert.ok(billLookup > unavailableResponse);
  assert.doesNotMatch(source, /Number\(refreshedAccount\.current_balance \|\| 0\)/);
});
