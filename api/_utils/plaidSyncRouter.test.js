const assert = require("node:assert/strict");
const test = require("node:test");

const { plaidAction } = require("../plaid/sync");

test("Plaid sync router dispatches the credit-card attachment rewrite", () => {
  assert.equal(plaidAction({ query: { plaidAction: "attach-credit-card" } }), "attach-credit-card");
});

test("Plaid sync router preserves the normal sync route", () => {
  assert.equal(plaidAction({ query: {} }), "");
});
