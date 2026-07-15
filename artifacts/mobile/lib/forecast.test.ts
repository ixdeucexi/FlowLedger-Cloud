import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildFinancialEvents,
  evaluateAffordability,
  forecastBalances,
  type FinancialEvent,
} from "./forecast";

const event = (overrides: Partial<FinancialEvent> & Pick<FinancialEvent, "id" | "date" | "amount">): FinancialEvent => ({
  sourceType: "bill",
  sourceId: overrides.id,
  kind: overrides.amount >= 0 ? "scheduled_income" : "bill",
  status: "planned",
  ...overrides,
});

describe("forecastBalances", () => {
  it("preserves dated income, bills, transactions, goals and debt payments", () => {
    const result = forecastBalances({
      openingBalance: 500,
      startDate: "2026-06-01",
      endDate: "2026-06-05",
      events: [
        event({ id: "income-1", sourceType: "income", sourceId: "pay", date: "2026-06-01", amount: 1_000, kind: "scheduled_income" }),
        event({ id: "bill-1", date: "2026-06-02", amount: -300 }),
        event({ id: "tx-1", sourceType: "transaction", sourceId: "tx", date: "2026-06-03", amount: -25, kind: "transaction_expense", status: "actual" }),
        event({ id: "goal-1", sourceType: "goal", sourceId: "goal", date: "2026-06-04", amount: -200, kind: "goal" }),
        event({ id: "debt-1", sourceType: "extra_payment", sourceId: "extra", date: "2026-06-05", amount: -50, kind: "debt_payment", status: "finalized" }),
      ],
    });
    assert.deepEqual(result.days.map(day => day.balance), [1500, 1200, 1175, 975, 925]);
    assert.equal(result.endingBalance, 925);
    assert.equal(result.days[2].events[0].sourceId, "tx");
  });

  it("handles overlapping events and month/year boundaries without changing precision", () => {
    const result = forecastBalances({
      openingBalance: 10.005,
      startDate: "2026-12-31",
      endDate: "2027-01-01",
      events: [
        event({ id: "weekly-1", date: "2026-12-31", amount: -1.115 }),
        event({ id: "monthly-1", date: "2026-12-31", amount: -2.225 }),
      ],
    });
    assert.ok(Math.abs(result.days[0].balance - 6.665) < 1e-8);
    assert.ok(Math.abs(result.days[1].balance - 6.665) < 1e-8);
  });

  it("includes a reviewed reimbursement and moved paid bill on their actual day", () => {
    const result = forecastBalances({
      openingBalance: 1_206,
      startDate: "2026-07-09",
      endDate: "2026-07-09",
      events: [
        event({ id: "payday", sourceType: "income", sourceId: "john-pay", date: "2026-07-09", amount: 2_308, kind: "scheduled_income" }),
        event({ id: "reimbursement", sourceType: "transaction", sourceId: "danielle-payback", date: "2026-07-09", amount: 167, kind: "transaction_income", status: "actual" }),
        event({ id: "card-payment", sourceType: "bill", sourceId: "tia-card", date: "2026-07-09", amount: -77, kind: "bill", status: "finalized" }),
      ],
    });

    assert.equal(result.endingBalance, 3_604);
  });

  it("rejects malformed and duplicate source events without leaking them into totals", () => {
    const built = buildFinancialEvents([
      event({ id: "same", date: "2026-06-01", amount: -10 }),
      event({ id: "same", date: "2026-06-01", amount: -10 }),
      event({ id: "bad", date: "not-a-date", amount: -5 }),
    ]);
    assert.equal(built.events.length, 1);
    assert.deepEqual(built.diagnostics.map(item => item.code), ["duplicate_event", "invalid_event"]);
  });
});

describe("evaluateAffordability", () => {
  it("protects the default safety floor and reports the exact shortfall", () => {
    const result = evaluateAffordability({
      openingBalance: 500,
      startDate: "2026-06-01",
      endDate: "2026-06-30",
      events: [event({ id: "rent", date: "2026-06-20", amount: -250 })],
    }, 100, "2026-06-10", 200);
    assert.equal(result.canAfford, false);
    assert.equal(result.lowestBalance, 150);
    assert.equal(result.shortfall, 50);
    assert.equal(result.projectedBalance, 400);
  });
});
