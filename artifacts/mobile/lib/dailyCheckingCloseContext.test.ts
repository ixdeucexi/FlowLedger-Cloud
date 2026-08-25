import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const budgetContext = fs.readFileSync(path.resolve(root, "context/BudgetContext.tsx"), "utf8");
const monthly = fs.readFileSync(path.resolve(root, "app/(tabs)/monthly.tsx"), "utf8");
const desktop = fs.readFileSync(path.resolve(root, "components/desktop/DesktopCalendarPage.tsx"), "utf8");
const dashboard = fs.readFileSync(path.resolve(root, "app/(tabs)/index.tsx"), "utf8");
const flo = fs.readFileSync(path.resolve(root, "app/(tabs)/flo.tsx"), "utf8");
const simulator = fs.readFileSync(path.resolve(root, "app/plan-simulator.tsx"), "utf8");

test("core daily balances remain projected while only the calendar getter overlays actual closes", () => {
  const projectedGetter = budgetContext.slice(
    budgetContext.indexOf("const getDailyBalances = useCallback"),
    budgetContext.indexOf("const getCalendarDailyBalances = useCallback"),
  );
  const calendarGetter = budgetContext.slice(
    budgetContext.indexOf("const getCalendarDailyBalances = useCallback"),
    budgetContext.indexOf("const getPlanSimulationBaseline = useCallback"),
  );
  assert.match(projectedGetter, /balanceSource:\s*"projected"/);
  assert.doesNotMatch(projectedGetter, /overlayCompletedDailyCheckingCloses/);
  assert.match(calendarGetter, /overlayCompletedDailyCheckingCloses/);
  assert.match(calendarGetter, /getDailyBalances\(month, year\)/);
});

test("Snowball, simulation, Dashboard, and Flo remain on the projected financial getter", () => {
  assert.match(budgetContext, /buildCanonicalPlanSimulationBaseline\([\s\S]*getDailyBalances/);
  assert.match(budgetContext, /previewDebtSnowball[\s\S]*getDailyBalances/);
  for (const source of [dashboard, flo, simulator]) {
    assert.doesNotMatch(source, /getCalendarDailyBalances/);
  }
});

test("calendar display and selected-day detail use actual closes without changing risk math", () => {
  assert.match(monthly, /projectedDailyBalances[\s\S]*getDailyBalances/);
  assert.match(monthly, /dailyBalances[\s\S]*getCalendarDailyBalances/);
  assert.match(monthly, /const baseline = projectedDailyBalances/);
  assert.match(desktop, /summarizeCalendarMonth\(props\.projectedDailyBalances/);
  assert.match(desktop, /selectedDay[\s\S]*props\.dailyBalances/);
});

test("household switching clears daily closes and time zone before asynchronous replacement", () => {
  const switchBody = budgetContext.slice(
    budgetContext.indexOf("const switchHousehold = useCallback"),
    budgetContext.indexOf("const createHouseholdInvite = useCallback"),
  );
  assert.ok(switchBody.indexOf("clearScopedFinancialData();") < switchBody.indexOf("await "));
  assert.match(budgetContext, /setDailyCheckingCloses\(\[\]\);[\s\S]*setHouseholdTimeZone\("UTC"\)/);
});

test("daily-close loading is paged, independently bounded, and shares the existing parallel loads", () => {
  assert.match(budgetContext, /loadAllDailyCheckingCloses[\s\S]*\.range\(from, to\)/);
  assert.match(budgetContext, /loadDailyCheckingClosesSafely[\s\S]*withLoadTimeout\([\s\S]*1500[\s\S]*Daily checking history deferred/);
  const occurrences = budgetContext.match(/loadDailyCheckingClosesSafely\(scope\)/g) ?? [];
  assert.ok(occurrences.length >= 2);
  assert.match(budgetContext, /const failed = results\.find\(\(result, index\) => index !== 12 && result\.error\)/);
  assert.doesNotMatch(budgetContext, /\.limit\(400\)[\s\S]*household_daily_checking_closes/);
});
