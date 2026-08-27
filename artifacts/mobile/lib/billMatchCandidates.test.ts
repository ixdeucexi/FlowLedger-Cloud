import assert from "node:assert/strict";
import test from "node:test";

import { adjacentBillMatchCandidates } from "./billMatchCandidates";

const bill = { id: "card", name: "Card", category: "Debt", amount: 75 };

test("an August posting can match the July month-end occurrence", () => {
  const candidates = adjacentBillMatchCandidates(
    "2026-08-01",
    () => [bill],
    (_bill, month) => month === 6 ? [31] : month === 7 ? [31] : [],
    (_bill, month) => month === 6 ? 80 : 90,
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
    (_bill, month) => month === 6 ? 75 : 375,
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
