const assert = require("node:assert/strict");
const test = require("node:test");

const { authorizeProHousehold, requestedHouseholdId } = require("./plaidAccess");

function mockDb(role, tier) {
  return {
    from(table) {
      const data = table === "household_members" ? (role ? { role } : null) : (tier ? { tier } : null);
      const chain = {
        select() { return chain; },
        eq() { return chain; },
        async maybeSingle() { return { data, error: null }; },
      };
      return chain;
    },
  };
}

const householdId = "11111111-1111-4111-8111-111111111111";

test("Plaid access requires an editable actual-Pro household", async () => {
  assert.equal((await authorizeProHousehold("user-1", householdId, mockDb("owner", "pro"))).ok, true);
  assert.equal((await authorizeProHousehold("user-1", householdId, mockDb("viewer", "pro"))).error, "HOUSEHOLD_EDIT_REQUIRED");
  assert.equal((await authorizeProHousehold("user-1", householdId, mockDb("editor", "free"))).error, "PRO_PLAN_REQUIRED");
  assert.equal((await authorizeProHousehold("user-1", "bad-id", mockDb("owner", "pro"))).error, "HOUSEHOLD_REQUIRED");
});

test("Plaid household scope comes from the request header", () => {
  assert.equal(requestedHouseholdId({ headers: { "x-flowledger-household-id": householdId } }), householdId);
});
