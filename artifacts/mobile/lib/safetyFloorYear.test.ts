import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { summarizeSafetyFloorYear } from "./safetyFloorYear";
import type { DailyBalanceSource } from "./dailyCheckingClose";

type Day = { day: number; balance: number; balanceSource?: DailyBalanceSource };
const summarize = (days: Day[], overrides: Partial<Parameters<typeof summarizeSafetyFloorYear>[0]> = {}) => summarizeSafetyFloorYear({ year: 2028, today: "2028-02-15", safetyFloor: 100, getDays: month => month === 1 ? days : [], ...overrides });

test("strict floor comparisons preserve cents, zero and negative balances", () => {
  const months = summarize([{ day: 15, balance: 100 }, { day: 16, balance: 99.99 }, { day: 17, balance: 0 }, { day: 18, balance: -25 }, { day: 19, balance: 100.01 }]);
  assert.deepEqual(months[1].days.map(day => day.date), ["2028-02-16", "2028-02-17", "2028-02-18"]);
  assert.ok(Math.abs(months[1].days[0].shortfall - 0.01) < 1e-10);
  assert.equal(months[1].days[2].shortfall, 125);
  assert.equal(months[1].lowestBalance, -25);
});

test("history requires actual close; missing or synthetic history never counts safe or unsafe", () => {
  const feb = summarize([{ day: 1, balance: -999 }, { day: 2, balance: 50, balanceSource: "actual_close" }, { day: 3, balance: 500, balanceSource: "unavailable" }, { day: 15, balance: 50 }])[1];
  assert.equal(feb.recorded, 1); assert.equal(feb.projected, 1); assert.equal(feb.unavailable, 27);
  assert.deepEqual(feb.days.map(day => day.source), ["recorded", "projected"]);
  assert.equal(feb.lowestBalance, 50);
});

test("future starting balance anchor excludes earlier synthetic zeros but retains factual recorded history", () => {
  const feb = summarize([{ day: 2, balance: 60, balanceSource: "actual_close" }, { day: 15, balance: 0 }, { day: 19, balance: 0 }, { day: 20, balance: 80 }, { day: 21, balance: 150 }], { startingBalanceDate: "2028-02-20" })[1];
  assert.deepEqual(feb.days.map(day => day.date), ["2028-02-02", "2028-02-20"]);
  assert.equal(feb.projected, 2); assert.equal(feb.recorded, 1); assert.equal(feb.lowestBalance, 60);
});

test("coverage totals include leap day and every calendar date; missing rows stay unavailable", () => {
  const months = summarize([{ day: 29, balance: 50 }, { day: 28, balance: 75 }, { day: 99, balance: -500 }, { day: 16, balance: NaN }, { day: 17, balance: Infinity }]);
  assert.equal(months.reduce((n, m) => n + m.recorded + m.projected + m.unavailable, 0), 366);
  assert.equal(months[1].days[1].date, "2028-02-29");
  assert.equal(months[1].lowestBalance, 50);
  assert.equal(months[0].lowestBalance, null);
});

test("current and next local year only; annual work visits exactly twelve months", () => {
  let calls = 0;
  const getDays = () => { calls++; return []; };
  assert.deepEqual(summarize([], { year: 2027, getDays }), []);
  assert.deepEqual(summarize([], { year: 2030, getDays }), []);
  assert.equal(calls, 0);
  const next = summarize([], { year: 2029, getDays });
  assert.equal(calls, 12);
  assert.equal(next.reduce((n, m) => n + m.unavailable, 0), 365);
});

test("today uses projection even if a stale close is mislabeled; next year starts January 1", () => {
  const feb = summarize([{ day: 15, balance: 50, balanceSource: "actual_close" }])[1];
  assert.equal(feb.days[0].source, "projected");
  const next = summarize([], { year: 2029, getDays: month => month === 0 ? [{ day: 1, balance: 10 }] : [] });
  assert.equal(next[0].days[0].date, "2029-01-01");
});

test("annual UI is scoped, lazy, readiness gated and opens existing calendar details", () => {
  const monthly = readFileSync("app/(tabs)/monthly.tsx", "utf8");
  const modal = readFileSync("components/SafetyFloorYearModal.tsx", "utf8");
  const desktop = readFileSync("components/desktop/DesktopCalendarPage.tsx", "utf8");
  assert.match(monthly, /safetyYearOpenScope === safetyYearScope \? <SafetyFloorYearModal/);
  assert.match(monthly, /key=\{safetyYearScope\}/);
  assert.match(monthly, /ready=\{startupCoreReady\}/);
  assert.match(monthly, /getDays=\{getCalendarDailyBalances\}/);
  assert.match(monthly, /setSelectedYear\(year\);\s*setMonth\(monthNumber - 1\);\s*setSelectedDate\(date\)/);
  assert.match(monthly, /setSafetyYearOpenScope\(null\); \}, \[safetyYearScope\]/);
  assert.match(modal, /ready \? summarizeSafetyFloorYear/);
  assert.match(modal, /\[ready, year, today, safetyFloor, startingBalanceDate, getDays\]/);
  assert.match(desktop, /onPress=\{onOpenSafetyFloorDays\}/);
  assert.match(modal, /useBackDismiss\(true, onClose\)/);
});
