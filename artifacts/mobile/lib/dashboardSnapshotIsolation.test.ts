import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("snapshot pending-to-ready publication is isolated from Budget consumers", () => {
  const budgetContext = readFileSync("context/BudgetContext.tsx", "utf8");
  const controllerStart = budgetContext.indexOf(
    "function DashboardFinancialSnapshotController",
  );
  const budgetProvider = budgetContext.slice(
    budgetContext.indexOf("export function BudgetProvider"),
    controllerStart,
  );
  const controller = budgetContext.slice(controllerStart);
  const broadValueStart = budgetProvider.indexOf(
    "const budgetContextValue: BudgetContextType",
  );
  const broadValue = budgetProvider.slice(
    broadValueStart,
    budgetProvider.indexOf("return (", broadValueStart),
  );

  assert.ok(controllerStart > 0);
  assert.doesNotMatch(
    budgetProvider,
    /useState<DashboardFinancialSnapshotState|setComputedSnapshot|setLoadedCategoryBudgets/,
  );
  assert.doesNotMatch(broadValue, /dashboardFinancialSnapshot/);
  assert.match(
    budgetProvider,
    /<DashboardFinancialSnapshotController[\s\S]*\{children\}[\s\S]*<\/DashboardFinancialSnapshotController>/,
  );
  assert.match(controller, /useState<DashboardFinancialSnapshotState/);
  assert.match(controller, /setComputedSnapshot\(ready\)/);
  assert.match(controller, /DashboardFinancialSnapshotContextProvider/);
});

test("the always-mounted tab layout counts review work without sorting the ledger", () => {
  const tabs = readFileSync("app/(tabs)/_layout.tsx", "utf8");
  assert.match(tabs, /countReviewQueue\(transactions, todayIsoDate\(\)\)/);
  assert.doesNotMatch(tabs, /buildReviewQueue\(transactions/);
});

test("Dashboard subscription lives in a context separate from useBudget", () => {
  const snapshotContext = readFileSync(
    "context/DashboardFinancialSnapshotContext.tsx",
    "utf8",
  );
  const budgetContext = readFileSync("context/BudgetContext.tsx", "utf8");

  assert.match(snapshotContext, /createContext</);
  assert.match(snapshotContext, /useDashboardFinancialSnapshot/);
  assert.doesNotMatch(snapshotContext, /useBudget/);
  assert.doesNotMatch(
    budgetContext.slice(
      budgetContext.indexOf("interface BudgetContextType"),
      budgetContext.indexOf("const BudgetContext"),
    ),
    /dashboardFinancialSnapshot/,
  );
});

test("Dashboard demand is route-authoritative and cancels projection work before leave paints", () => {
  const snapshotContext = readFileSync(
    "context/DashboardFinancialSnapshotContext.tsx",
    "utf8",
  );
  const budgetContext = readFileSync("context/BudgetContext.tsx", "utf8");
  const controller = budgetContext.slice(
    budgetContext.indexOf("function DashboardFinancialSnapshotController"),
  );
  const buildEffect = controller.slice(
    controller.indexOf("cancelBuildRef.current?.()"),
    controller.indexOf("const retryDashboardFinancialSnapshot"),
  );

  assert.doesNotMatch(snapshotContext, /useFocusEffect|registerDashboardSnapshotDemand/);
  assert.match(controller, /const dashboardRouteDemanded = segments\[0\] === "\(tabs\)"/);
  assert.match(controller, /const dashboardSnapshotDemanded = dashboardRouteDemanded;/);
  assert.match(
    controller,
    /useLayoutEffect\(\(\) => \{[\s\S]*!dashboardRouteDemanded[\s\S]*cancelBuildRef\.current\?\.\(\)/,
  );
  assert.match(buildEffect, /cancelBuildRef\.current\?\.\(\)/);
  assert.match(buildEffect, /!dashboardSnapshotDemanded/);
  assert.match(buildEffect, /dashboardSnapshotDemanded,/);
  assert.match(buildEffect, /startCancellableStageQueue/);
  assert.match(buildEffect, /cancelBuildRef\.current = cancel/);
});

test("Dashboard current period ignores Forecast's browsed year", () => {
  const budgetContext = readFileSync("context/BudgetContext.tsx", "utf8");
  const mobileDashboard = readFileSync("app/(tabs)/index.tsx", "utf8");
  const controller = budgetContext.slice(
    budgetContext.indexOf("function DashboardFinancialSnapshotController"),
  );

  assert.doesNotMatch(controller, /\bselectedYear\s*,/);
  assert.match(controller, /selectedYear: asOfYear/);
  assert.match(controller, /nextMonthYear = asOfYear \+ Math\.floor/);
  assert.match(controller, /finalForecastMonthYear = asOfYear/);
  assert.doesNotMatch(mobileDashboard, /\bselectedYear\b/);
  assert.match(
    mobileDashboard,
    /currentYear = Number\(dashboardModel\.todayIso\.slice\(0, 4\)\)/,
  );
});

test("progressive carryover preserves bank-anchor reconciliation precedence", () => {
  const budgetContext = readFileSync("context/BudgetContext.tsx", "utf8");
  const carryover = budgetContext.slice(
    budgetContext.indexOf("const computeCarryover"),
    budgetContext.indexOf("const carryover = computeCarryover"),
  );
  const bankFutureBranch = carryover.indexOf(
    "toYear > bankYear || (toYear === bankYear && toMonth > bankMonthIndex)",
  );
  const previousOpeningShortcut = carryover.indexOf(
    "const previousOpening = balanceComputationCache.carryover.get(previousKey)",
  );

  assert.ok(bankFutureBranch >= 0);
  assert.ok(previousOpeningShortcut > bankFutureBranch);
  assert.match(carryover, /bankAnchor\.balance \+ computeMonthNet\(bankMonthIndex, bankYear, bankAnchor\.date\)/);
});

test("a bfcache pageshow refreshes the household date without a visibility event", () => {
  const budgetContext = readFileSync("context/BudgetContext.tsx", "utf8");
  const controller = budgetContext.slice(
    budgetContext.indexOf("function DashboardFinancialSnapshotController"),
  );
  assert.match(controller, /subscribeHouseholdDateResumeEvents\(\{/);
  assert.match(controller, /onRefresh: refreshVisibleDate/);
  assert.match(controller, /unsubscribeWebResume\?\.\(\)/);
  assert.match(
    controller,
    /setHouseholdDateEpoch\(current => current \+ 1\)/,
  );
});

test("startup settles only after exact ready or error content commits", () => {
  const budgetContext = readFileSync("context/BudgetContext.tsx", "utf8");
  const controller = budgetContext.slice(
    budgetContext.indexOf("function DashboardFinancialSnapshotController"),
  );

  assert.match(
    controller,
    /exactSnapshotReady = computedSnapshot\?\.key === snapshotKey/,
  );
  assert.match(
    controller,
    /exactSnapshotError = computedSnapshot\?\.key === snapshotKey/,
  );
  assert.match(
    controller,
    /\(exactSnapshotReady \|\| exactSnapshotError\)[\s\S]{0,80}dashboardSnapshotContentMountedForKey/,
  );
  assert.doesNotMatch(
    controller,
    /dashboardSnapshotStartupSettled = !dashboardSnapshotDemanded\s*\|\| exactSnapshotError\s*\|\|/,
  );
});

test("Dashboard snapshot waits for an exact category plan and surfaces load failure", () => {
  const budgetContext = readFileSync("context/BudgetContext.tsx", "utf8");
  const controller = budgetContext.slice(
    budgetContext.indexOf("function DashboardFinancialSnapshotController"),
  );
  const buildEffect = controller.slice(
    controller.indexOf("cancelBuildRef.current?.()"),
    controller.indexOf("const retryDashboardFinancialSnapshot"),
  );

  assert.match(controller, /cachedCategoryBudgetsExact/);
  assert.match(controller, /remoteDelay = hasCategoryBudgetCache/);
  assert.match(controller, /loadCategoryBudgetsExact/);
  assert.match(buildEffect, /if \(!categoryBudgetsExact\)/);
  assert.match(buildEffect, /categoryBudgetsError/);
  assert.match(buildEffect, /dashboardSnapshotAfterBuildError/);
  assert.match(buildEffect, /categoryBudgetsExact,/);
  assert.match(buildEffect, /categoryBudgetsError,/);
});

test("always-mounted tab chrome counts review work without sorting the queue", () => {
  const tabLayout = readFileSync("app/(tabs)/_layout.tsx", "utf8");
  assert.match(tabLayout, /import \{ countReviewQueue \} from "@\/lib\/reviewCenter"/);
  assert.match(tabLayout, /countReviewQueue\(transactions, todayIsoDate\(\)\)/);
  assert.doesNotMatch(tabLayout, /buildReviewQueue\(/);
});
