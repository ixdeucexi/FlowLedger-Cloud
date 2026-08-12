import assert from "node:assert/strict";
import test from "node:test";

import {
  calendarMonthKey,
  monthlyDebtCheckInStorageKey,
  needsMonthlyDebtCheckIn,
} from "./monthlyDebtCheckIn";

test("builds a household-scoped monthly debt check-in key", () => {
  assert.equal(calendarMonthKey(new Date(2026, 7, 10)), "2026-08");
  assert.equal(
    monthlyDebtCheckInStorageKey("user-1", "home-1", "2026-08"),
    "flowledger:monthly-debt-check-in:user-1:home-1:2026-08",
  );
});

test("asks for a check-in only when an active debt is stale this month", () => {
  const now = new Date(2026, 7, 10, 12);
  assert.equal(needsMonthlyDebtCheckIn([
    { is_debt: true, balance: 500, last_reviewed_at: "2026-07-31T23:59:59Z" },
  ], now), true);
  assert.equal(needsMonthlyDebtCheckIn([
    { is_debt: true, balance: 500, last_reviewed_at: "2026-08-02T12:00:00Z" },
  ], now), false);
  assert.equal(needsMonthlyDebtCheckIn([
    { is_debt: true, balance: 0, last_reviewed_at: "2026-01-01T12:00:00Z" },
    { is_debt: false, balance: 500 },
  ], now), false);
});
