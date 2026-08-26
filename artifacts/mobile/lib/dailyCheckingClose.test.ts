import assert from "node:assert/strict";
import test from "node:test";

import { loadAllDailyCheckingCloses, localDateInTimeZone, overlayCompletedDailyCheckingCloses, shouldApplyDailyCheckingCloseLoad, type DailyCheckingCloseSnapshot } from "./dailyCheckingClose";

const projected = [
  { day: 23, balance: 910 },
  { day: 24, balance: 920 },
  { day: 25, balance: 930 },
];

test("completed household-local dates use the latest verified bank close", () => {
  const result = overlayCompletedDailyCheckingCloses(projected, 7, 2026, [
    { balance_date: "2026-08-23", checking_balance: 801, observed_at: "2026-08-23T20:00:00Z", account_count: 1, source: "plaid_sync" },
    { balance_date: "2026-08-23", checking_balance: 812.34, observed_at: "2026-08-24T03:55:00Z", account_count: 1, source: "plaid_sync" },
  ], "2026-08-24");

  assert.deepEqual(result.map(day => [day.day, day.balance, day.balanceSource]), [
    [23, 812.34, "actual_close"],
    [24, 920, "projected"],
    [25, 930, "projected"],
  ]);
  assert.equal(result[0].balanceObservedAt, "2026-08-24T03:55:00Z");
});

test("today and future remain projected even when a same-day snapshot exists", () => {
  const result = overlayCompletedDailyCheckingCloses(projected, 7, 2026, [
    { balance_date: "2026-08-24", checking_balance: 700, observed_at: "2026-08-24T17:00:00Z", account_count: 1, source: "plaid_sync" },
    { balance_date: "2026-08-25", checking_balance: 650, observed_at: "2026-08-25T17:00:00Z", account_count: 1, source: "plaid_sync" },
  ], "2026-08-24");

  assert.deepEqual(result.map(day => [day.balance, day.balanceSource]), [
    [910, "projected"],
    [920, "projected"],
    [930, "projected"],
  ]);
});

test("household time zone controls the completed-date boundary", () => {
  const instant = new Date("2026-08-25T02:30:00.000Z");
  assert.equal(localDateInTimeZone(instant, "America/Chicago"), "2026-08-24");
  assert.equal(localDateInTimeZone(instant, "Asia/Tokyo"), "2026-08-25");
});

test("calendar overlays never mutate the projected financial series", () => {
  const original = projected.map(day => ({ ...day }));
  const result = overlayCompletedDailyCheckingCloses(projected, 7, 2026, [
    { balance_date: "2026-08-23", checking_balance: 5, observed_at: "2026-08-24T01:00:00Z", account_count: 1, source: "plaid_sync" },
  ], "2026-08-24");
  assert.deepEqual(projected, original);
  assert.equal(projected[0].balance, 910);
  assert.equal(result[0].balance, 5);
});

test("snapshot loading pages through arbitrary history without a 400-row cutoff", async () => {
  const allRows: DailyCheckingCloseSnapshot[] = Array.from({ length: 450 }, (_, index) => ({
    balance_date: `2025-01-${String((index % 28) + 1).padStart(2, "0")}`,
    checking_balance: index,
    observed_at: new Date(Date.UTC(2025, 0, 1) + index * 1000).toISOString(),
    account_count: 1,
    source: "plaid_sync",
  }));
  const ranges: Array<[number, number]> = [];
  const result = await loadAllDailyCheckingCloses(async (from, to) => {
    ranges.push([from, to]);
    return { data: allRows.slice(from, to + 1), error: null };
  }, 200);
  assert.equal(result.error, null);
  assert.equal(result.data?.length, 450);
  assert.deepEqual(ranges, [[0, 199], [200, 399], [400, 599]]);
});

test("a newer close-history caller wins across startup and bank-refresh channels", () => {
  const startupGeneration = 1;
  const bankRefreshGeneration = 2;
  assert.equal(shouldApplyDailyCheckingCloseLoad(startupGeneration, bankRefreshGeneration, true), false);
  assert.equal(shouldApplyDailyCheckingCloseLoad(bankRefreshGeneration, bankRefreshGeneration, true), true);
  assert.equal(shouldApplyDailyCheckingCloseLoad(bankRefreshGeneration, bankRefreshGeneration, false), false);
});
