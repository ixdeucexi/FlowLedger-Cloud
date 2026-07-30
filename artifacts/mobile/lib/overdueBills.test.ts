import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildOverdueBillOccurrences, groupOverdueBills } from "./overdueBills";

describe("overdue bill alerts", () => {
  it("does not call today's bill overdue", () => {
    const alerts = buildOverdueBillOccurrences([{
      billId: "rent",
      name: "Rent",
      occurrenceDays: [21],
      plannedTotal: 1_000,
      paidTotal: 0,
    }], 6, 2026, 21);

    assert.deepEqual(alerts, []);
  });

  it("allocates weekly payments in order and alerts only the missed occurrence", () => {
    const alerts = buildOverdueBillOccurrences([{
      billId: "weekly",
      name: "After school",
      occurrenceDays: [1, 8, 15, 22, 29],
      plannedTotal: 450,
      paidTotal: 180,
    }], 6, 2026, 21);

    assert.deepEqual(alerts, [{
      billId: "weekly",
      name: "After school",
      occurrenceDate: "2026-07-15",
      remainingAmount: 90,
      daysPastDue: 6,
    }]);
  });

  it("keeps partial money on the exact overdue occurrence", () => {
    const alerts = buildOverdueBillOccurrences([{
      billId: "insurance",
      name: "Insurance",
      occurrenceDays: [20],
      plannedTotal: 300,
      paidTotal: 287.52,
    }], 6, 2026, 21);

    assert.equal(alerts[0]?.remainingAmount, 12.48);
    assert.equal(alerts[0]?.occurrenceDate, "2026-07-20");
  });

  it("does not reopen a lower bill that the user already finalized", () => {
    const alerts = buildOverdueBillOccurrences([{
      billId: "insurance",
      name: "Insurance",
      occurrenceDays: [20],
      plannedTotal: 287.52,
      paidTotal: 287.52,
    }], 6, 2026, 21);

    assert.deepEqual(alerts, []);
  });

  it("groups multiple missed occurrences into one bill alert", () => {
    const grouped = groupOverdueBills(buildOverdueBillOccurrences([{
      billId: "weekly",
      name: "Weekly bill",
      occurrenceDays: [1, 8, 15, 22, 29],
      plannedTotal: 500,
      paidTotal: 100,
    }], 6, 2026, 21));

    assert.equal(grouped.length, 1);
    assert.equal(grouped[0]?.occurrenceCount, 2);
    assert.equal(grouped[0]?.remainingAmount, 200);
    assert.equal(grouped[0]?.firstOccurrenceDate, "2026-07-08");
  });
});
