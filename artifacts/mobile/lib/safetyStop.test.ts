import assert from "node:assert/strict";
import test from "node:test";

import { buildSafetyStop } from "./safetyStop";

const baseline = [
  { date: "2026-07-01", balance: 600 },
  { date: "2026-07-02", balance: 500 },
  { date: "2026-07-03", balance: 350 },
];

test("does not warn when a scheduled item keeps the forecast above the safety floor", () => {
  const warning = buildSafetyStop({
    baseline,
    safetyFloor: 200,
    scenario: { type: "one_time_purchase", name: "Groceries", amount: 100, date: "2026-07-02" },
  });
  assert.equal(warning, null);
});

test("warns when a scheduled item would take the forecast below the safety floor", () => {
  const warning = buildSafetyStop({
    baseline,
    safetyFloor: 200,
    scenario: { type: "one_time_purchase", name: "Concert", amount: 250, date: "2026-07-02" },
  });
  assert.ok(warning);
  assert.equal(warning.itemName, "Concert");
  assert.equal(warning.lowestBalance, 100);
  assert.equal(warning.shortfall, 100);
  assert.equal(warning.lowestBalanceDate, "2026-07-03");
});

