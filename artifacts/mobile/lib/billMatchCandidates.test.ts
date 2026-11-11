import assert from "node:assert/strict";
import test from "node:test";

import { adjacentBillMatchCandidates } from "./billMatchCandidates";
import { createFinancialProjection } from "./financialProjection";
import type { FinancialProjectionSnapshot } from "./financialProjectionTypes";
import golden from "./financialProjection.golden.json";
import { rankBillMatches } from "./billMatching";

const bill = { id: "card", name: "Card", category: "Debt", amount: 75 };

test("an August posting can match the July month-end occurrence", () => {
  const candidates = adjacentBillMatchCandidates(
    "2026-08-01",
    () => [bill],
    (_bill, month) => month === 6 ? [31] : month === 7 ? [31] : [],
    (_bill, date) => date.startsWith("2026-07") ? 80 : 90,
  );
  assert.deepEqual(candidates, [{
    billId: "card",
    name: "Card",
    category: "Debt",
    plannedAmount: 80,
    occurrenceDates: ["2026-07-31", "2026-08-31"],
  }]);
});

test("adjacent candidates remain correct across December and January", () => {
  const candidates = adjacentBillMatchCandidates(
    "2025-12-31",
    () => [bill],
    (_bill, month) => month === 11 || month === 0 ? [1] : [],
    () => 75,
  );
  assert.deepEqual(candidates[0]?.occurrenceDates, ["2025-12-01", "2026-01-01"]);
  assert.equal(candidates[0]?.plannedAmount, 75);
});

test("weekly candidates include occurrences on both sides of a month boundary", () => {
  const candidates = adjacentBillMatchCandidates(
    "2026-08-01",
    () => [bill],
    (_bill, month) => month === 6 ? [25] : month === 7 ? [1, 8, 15, 22, 29] : [],
    () => 75,
  );
  assert.deepEqual(candidates[0]?.occurrenceDates.slice(0, 3), [
    "2026-07-25",
    "2026-08-01",
    "2026-08-08",
  ]);
});

test("malformed posting dates fail closed", () => {
  assert.deepEqual(
    adjacentBillMatchCandidates("2026-02-31", () => [], () => [], () => 0),
    [],
  );
});

test("matching uses each edited occurrence's canonical amount rather than a monthly average", () => {
  for (const frequency of ["weekly", "biweekly"] as const) {
    for (const editedAmount of [25, 100]) {
      const snapshot = structuredClone(golden.cases[0].snapshot) as unknown as FinancialProjectionSnapshot;
      snapshot.bills = [{ ...snapshot.bills[0], id: "weekly", name: "Weekly bill", amount: 50, is_debt: false, frequency, due_day: 2, next_payment_date: "2026-10-02", start_date: "2026-10-02" }];
      snapshot.overrides = []; snapshot.transactions = []; snapshot.decisions = []; snapshot.billDateMoves = [{ id: "edited", bill_id: "weekly", from_date: "2026-10-16", to_date: "2026-10-16", custom_amount: editedAmount, created_at: "2026-10-01" }];
      const projection = createFinancialProjection(snapshot, { now: new Date("2026-10-01T12:00:00Z"), timeZone: "UTC" });
      const candidates = adjacentBillMatchCandidates("2026-10-16", projection.getMonthlyBills, projection.getBillOccurrencesInMonth, projection.getBillOccurrenceAmount);
      assert.equal(candidates[0]?.plannedAmount, editedAmount, `${frequency}:${editedAmount}`);
      const ranked = rankBillMatches({ date: "2026-10-16", amount: -editedAmount, description: "Weekly bill" }, candidates);
      assert.equal(ranked[0]?.amountDifference, 0); assert.ok(ranked[0]?.reasons.includes("exact amount"));
      const normal = adjacentBillMatchCandidates("2026-10-02", projection.getMonthlyBills, projection.getBillOccurrencesInMonth, projection.getBillOccurrenceAmount);
      assert.equal(normal[0]?.plannedAmount, 50);
    }
  }
});

test("matching preserves edited amounts moved across December and January", () => {
  const snapshot = structuredClone(golden.cases[0].snapshot) as unknown as FinancialProjectionSnapshot;
  snapshot.bills = [{ ...snapshot.bills[0], id: "moved", name: "Moved bill", amount: 50, is_debt: false, frequency: "monthly", due_day: 31, next_payment_date: "2026-12-31", start_date: "2026-12-31" }];
  snapshot.overrides = []; snapshot.transactions = []; snapshot.decisions = []; snapshot.billDateMoves = [{ id: "move", bill_id: "moved", from_date: "2026-12-31", to_date: "2027-01-02", custom_amount: 25, created_at: "2026-12-01" }];
  const projection = createFinancialProjection(snapshot, { now: new Date("2026-12-01T12:00:00Z"), timeZone: "UTC" });
  const candidate = adjacentBillMatchCandidates("2027-01-02", projection.getMonthlyBills, projection.getBillOccurrencesInMonth, projection.getBillOccurrenceAmount)[0];
  assert.equal(candidate.plannedAmount, 25); assert.ok(candidate.occurrenceDates.includes("2027-01-02"));
  assert.equal(candidate.occurrenceDates.includes("2026-12-31"), false);
});

test("bill candidates preserve reviewed partial budgets and omit closed occurrences", () => {
  const scheduled = { ...bill, frequency: "weekly" };
  for (const [plannedAmount, paid, settlement, remaining] of [
    [100, 80, "partial", 20], [100, 80, "full", 0], [100, 80, "exact", 0], [60, 25, "partial", 35],
  ] as const) {
    const candidates = adjacentBillMatchCandidates("2026-10-16", () => [scheduled], (_bill, month) => month === 9 ? [16] : [], () => 100, () => ({ plannedAmount, amount: paid, settlement }));
    if (remaining) assert.equal(candidates[0]?.plannedAmount, remaining);
    else assert.deepEqual(candidates, [], "full and exact settlements do not offer another payment");
  }
  const sibling = adjacentBillMatchCandidates("2026-10-16", () => [scheduled], (_bill, month) => month === 9 ? [16, 23] : [], () => 100,
    (_bill, date) => date === "2026-10-16" ? { plannedAmount: 100, amount: 80, settlement: "full" } : undefined);
  assert.deepEqual(sibling[0]?.occurrenceDates, ["2026-10-23"]);
  assert.equal(sibling[0]?.plannedAmount, 100, "an unpaid sibling keeps its own amount and date");
});
