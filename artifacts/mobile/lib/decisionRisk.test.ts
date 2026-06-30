import test from "node:test";
import assert from "node:assert/strict";
import { buildDecisionRiskAlerts } from "./decisionRisk";

const forecast = [
  { date: "2026-07-01", balance: 900 },
  { date: "2026-07-02", balance: 650 },
  { date: "2026-07-03", balance: 150 },
  { date: "2026-07-04", balance: 300 },
];

test("flags planned decisions when the current forecast falls below the safety floor after their date", () => {
  const alerts = buildDecisionRiskAlerts([
    { id: "fireworks", name: "Fireworks", status: "planned", scenario: { type: "one_time_purchase", name: "Fireworks", amount: 500, date: "2026-07-02" } },
  ], forecast, 200, "2026-07-01");

  assert.equal(alerts[0]?.name, "Fireworks");
  assert.equal(alerts[0]?.lowestBalance, 150);
  assert.equal(alerts[0]?.shortfall, 50);
});

test("ignores completed, cancelled and past planned decisions", () => {
  const alerts = buildDecisionRiskAlerts([
    { id: "done", name: "Done", status: "completed", scenario: { type: "one_time_purchase", name: "Done", amount: 500, date: "2026-07-02" } },
    { id: "cancel", name: "Cancel", status: "cancelled", scenario: { type: "one_time_purchase", name: "Cancel", amount: 500, date: "2026-07-02" } },
    { id: "past", name: "Past", status: "planned", scenario: { type: "one_time_purchase", name: "Past", amount: 500, date: "2026-06-25" } },
  ], forecast, 200, "2026-07-01");

  assert.equal(alerts.length, 0);
});

test("returns no alert when forecast remains above the safety floor", () => {
  const alerts = buildDecisionRiskAlerts([
    { id: "safe", name: "Safe", status: "calendar", scenario: { type: "one_time_purchase", name: "Safe", amount: 50, date: "2026-07-02" } },
  ], forecast.map(day => ({ ...day, balance: day.balance + 500 })), 200, "2026-07-01");

  assert.equal(alerts.length, 0);
});
