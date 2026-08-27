const assert = require("node:assert/strict");
const test = require("node:test");

const { groupObservations } = require("../plaid/daily-close");

test("daily close dispatcher sends every latest known item observation by household", () => {
  const grouped = groupObservations([
    { id: "item-a", household_id: "home", accounts_observed_at: "2026-08-27T02:00:00Z" },
    { id: "item-b", household_id: "home", accounts_observed_at: "2026-08-27T02:01:00Z" },
    { id: "missing", household_id: "home", accounts_observed_at: null },
  ]);
  assert.deepEqual(grouped.get("home"), [
    { item_id: "item-a", observed_at: "2026-08-27T02:00:00Z" },
    { item_id: "item-b", observed_at: "2026-08-27T02:01:00Z" },
  ]);
});
