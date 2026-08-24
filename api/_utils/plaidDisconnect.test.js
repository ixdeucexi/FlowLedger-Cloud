const assert = require("node:assert/strict");
const test = require("node:test");

const { plaidRemovalAlreadyComplete } = require("../plaid/disconnect");

test("Plaid disconnect tolerates only an already removed Item", () => {
  assert.equal(plaidRemovalAlreadyComplete({ response: { data: { error_code: "ITEM_NOT_FOUND" } } }), true);
  assert.equal(plaidRemovalAlreadyComplete({ error_code: "INVALID_ACCESS_TOKEN" }), true);
  assert.equal(plaidRemovalAlreadyComplete({ response: { data: { error_code: "INSTITUTION_DOWN" } } }), false);
  assert.equal(plaidRemovalAlreadyComplete(new Error("network")), false);
});
