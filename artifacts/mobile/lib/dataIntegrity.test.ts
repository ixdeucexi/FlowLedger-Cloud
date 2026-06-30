import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildDataIntegrityIssues } from "./dataIntegrity";

describe("buildDataIntegrityIssues", () => {
  it("flags missing setup data without reading private values", () => {
    const issues = buildDataIntegrityIssues({
      accounts: [],
      bills: [],
      incomes: [],
      transactions: [],
      now: new Date("2026-06-30T12:00:00Z"),
    });

    assert.ok(issues.map(issue => issue.title).includes("No active account"));
    assert.ok(issues.map(issue => issue.title).includes("No income source"));
  });

  it("flags stale accounts, duplicate bills, and unlinked transactions", () => {
    const issues = buildDataIntegrityIssues({
      accounts: [{
        id: "a1",
        name: "Checking",
        account_type: "checking",
        current_balance: 100,
        balance_as_of: "2026-05-01",
        is_active: true,
        created_at: "2026-01-01T00:00:00Z",
      }],
      bills: [
        { id: "b1", name: "Utility", amount: 100, category: "Utilities", priority: 1, is_debt: false, balance: 0, interest_rate: 0, due_day: 4, is_recurring: true, frequency: "monthly", created_at: "2026-01-01T00:00:00Z" },
        { id: "b2", name: "Utility", amount: 100, category: "Utilities", priority: 2, is_debt: false, balance: 0, interest_rate: 0, due_day: 4, is_recurring: true, frequency: "monthly", created_at: "2026-01-01T00:00:00Z" },
      ],
      incomes: [{ id: "i1", name: "Paycheck", amount: 1000, frequency: "monthly", start_date: "2026-01-01", next_payment_date: "2026-06-30", amount_history: [] }],
      transactions: [{ id: "t1", date: "2026-06-30", amount: -10, category: "Food", note: "Lunch" }],
      now: new Date("2026-06-30T12:00:00Z"),
    });

    assert.equal(issues.some(issue => issue.title.includes("need review")), true);
    assert.equal(issues.some(issue => issue.title.includes("without an account")), true);
    assert.equal(issues.some(issue => issue.title === "Possible duplicate recurring bills"), true);
  });
});
