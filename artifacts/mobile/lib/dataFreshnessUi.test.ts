import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("cached plan freshness comes from the successful query timestamp", () => {
  const context = readFileSync("context/BudgetContext.tsx", "utf8");

  assert.match(context, /getQueryState\(coreQueryKey\)\?\.dataUpdatedAt/);
  assert.match(context, /bankDataResults\.every\(result => !result\.error\)/);
  assert.doesNotMatch(context, /DataFreshnessLabel/);
});

test("financial workspaces show the shared exact freshness label", () => {
  const sources = [
    "app/(tabs)/index.tsx",
    "app/(tabs)/bills.tsx",
    "app/(tabs)/monthly.tsx",
    "app/(tabs)/transactions.tsx",
    "app/(tabs)/more.tsx",
    "app/(tabs)/category-budget.tsx",
    "app/snowball-plan.tsx",
    "app/plan-simulator.tsx",
    "app/(tabs)/flo.tsx",
  ];

  for (const source of sources) {
    assert.match(readFileSync(source, "utf8"), /DataFreshnessLabel/, source);
  }
  assert.doesNotMatch(readFileSync("components/BasicFlo.tsx", "utf8"), /new Date\(asOf\)/);
});
