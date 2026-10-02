import assert from "node:assert/strict";
import test from "node:test";
import golden from "./financialProjection.golden.json";
import { createFinancialProjection } from "./financialProjection";
import type { FinancialProjectionSnapshot } from "./financialProjectionTypes";

import {
  calendarBalanceIsVisible,
  loadAllDailyCheckingCloses,
  localDateInTimeZone,
  overlayCompletedDailyCheckingCloses,
  reuseDailyCheckingCloseLoadState,
  reuseDailyCheckingCloseSnapshots,
  shouldApplyDailyCheckingCloseLoad,
  type DailyCheckingCloseSnapshot,
} from "./dailyCheckingClose";

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

test("every date keeps its canonical projection when close history is loading, failed, or has no row", () => {
  for (const historyStatus of ["loading", "error", "ready"] as const) {
    const result = overlayCompletedDailyCheckingCloses(
      projected,
      7,
      2026,
      [],
      "2026-08-25",
      historyStatus,
    );
    assert.deepEqual(
      result.map(day => [day.day, day.balance, day.balanceSource, day.balanceUnavailableReason]),
      [
        [23, 910, "projected", undefined],
        [24, 920, "projected", undefined],
        [25, 930, "projected", undefined],
      ],
    );
    assert.equal(result.every(calendarBalanceIsVisible), true);
  }
});

test("a valid cached actual close wins even while live close history is loading or failed", () => {
  const snapshot: DailyCheckingCloseSnapshot = {
    balance_date: "2026-08-23",
    checking_balance: 812.34,
    observed_at: "2026-08-24T03:55:00Z",
    account_count: 1,
    source: "plaid_sync",
  };
  for (const historyStatus of ["loading", "error"] as const) {
    const result = overlayCompletedDailyCheckingCloses(
      projected,
      7,
      2026,
      [snapshot],
      "2026-08-25",
      historyStatus,
    );
    assert.deepEqual(result.map(day => [day.balance, day.balanceSource]), [
      [812.34, "actual_close"],
      [920, "projected"],
      [930, "projected"],
    ]);
  }
});

test("historical closes cannot add money to today's bank-anchored forecast after a refresh", () => {
  const snapshot = structuredClone(golden.cases[0].snapshot) as unknown as FinancialProjectionSnapshot;
  snapshot.settings.starting_balance = 2_492;
  snapshot.settings.starting_balance_date = "2026-10-01";
  snapshot.bills = [];
  snapshot.goals = [];
  snapshot.decisions = [];
  snapshot.incomes = [{
    id: "pay", name: "Paycheck", amount: 1_500, frequency: "monthly",
    start_date: "2026-10-03", next_payment_date: "2026-10-03",
  }];
  snapshot.connectedBankAccounts = [{
    id: "checking", name: "Checking", account_type: "depository",
    account_subtype: "checking", current_balance: 4_154.81,
    is_active: true, updated_at: "2026-10-02T12:00:00Z",
  }];
  const closes: DailyCheckingCloseSnapshot[] = [{
    balance_date: "2026-10-01",
    checking_balance: 4_154.81,
    observed_at: "2026-10-02T04:55:00Z",
    account_count: 1,
    source: "plaid_sync",
  }];
  const options = { now: new Date("2026-10-02T12:00:00Z"), timeZone: "America/Chicago" };
  const canonical = createFinancialProjection(snapshot, options).getDailyBalances(9, 2026);
  assert.equal(canonical[0].balance, 2_492);
  assert.equal(canonical[1].balance, 4_154.81);
  assert.equal(canonical[2].balance, 5_654.81);
  const result = overlayCompletedDailyCheckingCloses(canonical, 9, 2026, closes, "2026-10-02");

  assert.deepEqual(result.slice(0, 3).map(day => [day.day, day.balance, day.balanceSource]), [
    [1, 4_154.81, "actual_close"],
    [2, 4_154.81, "projected"],
    [3, 5_654.81, "projected"],
  ]);
  assert.deepEqual(result.slice(1).map(day => day.balance), canonical.slice(1).map(day => day.balance));

  // A later sync changes the live anchor, while the recorded October 1 close
  // remains fixed and must not offset that newly calculated forecast.
  snapshot.connectedBankAccounts[0].current_balance = 4_091.81;
  snapshot.connectedBankAccounts[0].updated_at = "2026-10-02T13:00:00Z";
  const refreshed = createFinancialProjection(snapshot, options).getDailyBalances(9, 2026);
  const refreshedCalendar = overlayCompletedDailyCheckingCloses(refreshed, 9, 2026, closes, "2026-10-02");
  assert.deepEqual(refreshedCalendar.slice(0, 3).map(day => [day.day, Math.round(day.balance * 100) / 100, day.balanceSource]), [
    [1, 4_154.81, "actual_close"],
    [2, 4_091.81, "projected"],
    [3, 5_591.81, "projected"],
  ]);
  assert.deepEqual(refreshedCalendar.slice(1).map(day => day.balance), refreshed.slice(1).map(day => day.balance));
  assert.equal(canonical[0].balance, 2_492);
  assert.equal(closes[0].checking_balance, 4_154.81);
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

test("equivalent close rows and status preserve state identity", () => {
  const current: DailyCheckingCloseSnapshot[] = [{
    balance_date: "2026-08-27",
    checking_balance: 123.45,
    observed_at: "2026-08-28T04:55:00Z",
    account_count: 2,
    source: "plaid_sync",
  }];
  const equivalent = current.map(row => ({ ...row }));
  assert.equal(reuseDailyCheckingCloseSnapshots(current, equivalent), current);

  const changed = equivalent.map(row => ({ ...row, checking_balance: 123.46 }));
  assert.equal(reuseDailyCheckingCloseSnapshots(current, changed), changed);

  const second: DailyCheckingCloseSnapshot = {
    ...current[0],
    balance_date: "2026-08-26",
    observed_at: "2026-08-27T04:55:00Z",
  };
  const twoRows = [current[0], second];
  const deleted = [current[0]];
  const reordered = [second, current[0]];
  assert.equal(reuseDailyCheckingCloseSnapshots(twoRows, deleted), deleted);
  assert.equal(reuseDailyCheckingCloseSnapshots(twoRows, reordered), reordered);

  const currentLoad = { scopeKey: "user-a:household-a", status: "ready" as const };
  assert.equal(
    reuseDailyCheckingCloseLoadState(currentLoad, { ...currentLoad }),
    currentLoad,
  );
  assert.deepEqual(
    reuseDailyCheckingCloseLoadState(currentLoad, { ...currentLoad, status: "error" }),
    { ...currentLoad, status: "error" },
  );
});
