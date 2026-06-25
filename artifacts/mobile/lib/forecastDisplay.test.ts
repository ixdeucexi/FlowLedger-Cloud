import assert from "node:assert/strict";
import test from "node:test";

import { debtPaymentStatusLabel, groupForecastEvents } from "./forecastDisplay";
import type { FinancialEvent } from "./forecast";

const event = (overrides: Partial<FinancialEvent> & Pick<FinancialEvent, "id" | "sourceType" | "sourceId" | "kind" | "date" | "amount" | "status">): FinancialEvent => ({
  ...overrides,
  name: overrides.name,
});

test("groups forecast events into plain-language sections", () => {
  const groups = groupForecastEvents([
    event({ id: "income", sourceType: "income", sourceId: "pay", kind: "scheduled_income", date: "2026-07-01", amount: 1000, status: "scheduled", name: "Paycheck" }),
    event({ id: "bill", sourceType: "bill", sourceId: "rent", kind: "bill", date: "2026-07-01", amount: -900, status: "planned", name: "Rent" }),
    event({ id: "extra", sourceType: "extra_payment", sourceId: "snowball", kind: "debt_payment", date: "2026-07-04", amount: -20, status: "scheduled", name: "Snowball payment to Camera" }),
    event({ id: "decision", sourceType: "decision", sourceId: "plan", kind: "transaction_expense", date: "2026-07-04", amount: -50, status: "planned", name: "Dinner" }),
  ]);

  assert.deepEqual(groups.map(group => group.title), ["Income", "Bills", "Debt payments", "Saved plans"]);
  assert.equal(groups[0].events[0].statusLabel, "scheduled");
  assert.equal(groups[2].events[0].label, "Snowball payment to Camera");
  assert.equal(groups[2].events[0].amountLabel, "-$20.00");
});

test("labels debt payments scheduled until the selected date arrives", () => {
  const today = new Date("2026-07-01T12:00:00");
  assert.equal(debtPaymentStatusLabel("2026-07-04", false, today), "scheduled");
  assert.equal(debtPaymentStatusLabel("2026-07-01", false, today), "applied");
  assert.equal(debtPaymentStatusLabel("2026-06-30", false, today), "applied");
  assert.equal(debtPaymentStatusLabel("2026-06-30", true, today), "scheduled");
});
