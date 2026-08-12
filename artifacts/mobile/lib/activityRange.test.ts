import assert from "node:assert/strict";
import test from "node:test";

import { dateIsInActivityRange, resolveActivityDateRange, summarizeActivityRange, summarizeActivitySnapshot } from "./activityRange";

const today = new Date(2026, 7, 5, 12);

test("resolves every common Activity period using local calendar dates", () => {
  assert.deepEqual(resolveActivityDateRange("today", today), {
    id: "today", label: "Today", startDate: "2026-08-05", endDate: "2026-08-05",
  });
  assert.deepEqual(resolveActivityDateRange("last_month", today), {
    id: "last_month", label: "Last Month", startDate: "2026-07-01", endDate: "2026-07-31",
  });
  assert.equal(resolveActivityDateRange("last_90_days", today).startDate, "2026-05-08");
});

test("supports all time and inclusive custom ranges", () => {
  const allTime = resolveActivityDateRange("all_time", today);
  assert.equal(dateIsInActivityRange("2019-01-01", allTime), true);
  const custom = resolveActivityDateRange("custom", today, "2025-12-30", "2026-01-02");
  assert.equal(dateIsInActivityRange("2026-01-02", custom), true);
  assert.equal(dateIsInActivityRange("2026-01-03", custom), false);
});

test("range totals exclude pending rows and transfers", () => {
  assert.deepEqual(summarizeActivityRange([
    { amount: 1200 },
    { amount: -200 },
    { amount: -50, source: "transfer" },
    { amount: -75, pending: true },
  ]), { income: 1200, out: 200, net: 1000, transactions: 3 });
});

test("the unfiltered monthly snapshot uses the full plan instead of one visible bill", () => {
  const visibleRows = [{ amount: -150, source: "bill_payment" }];
  const plannedMonth = { income: 4000, out: 1350, net: 2650 };

  assert.deepEqual(summarizeActivitySnapshot(visibleRows, plannedMonth), {
    income: 4000,
    out: 1350,
    net: 2650,
    transactions: 1,
  });
  assert.deepEqual(summarizeActivitySnapshot(visibleRows), {
    income: 0,
    out: 150,
    net: -150,
    transactions: 1,
  });
});
