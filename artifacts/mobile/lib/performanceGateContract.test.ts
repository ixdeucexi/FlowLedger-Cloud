import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("the canonical mobile test command keeps functional concurrency and runs the wall gate serially", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
    scripts?: Record<string, string>;
  };
  const testScript = packageJson.scripts?.test ?? "";
  const segments = testScript.split("&&").map(segment => segment.trim());
  const functionalSegment = segments.find(segment => segment.includes("*.test.js")) ?? "";

  assert.match(
    functionalSegment,
    /node --test \.test-dist\/\*\.test\.js/,
    "functional test files must retain Node's normal concurrent runner",
  );
  assert.doesNotMatch(
    functionalSegment,
    /--test-concurrency/,
    "the functional suite must retain concurrent file coverage",
  );
  assert.match(
    testScript,
    /&& node --test --test-concurrency=1 \.test-dist\/financialProjectionPerformance\.benchmark\.js$/,
    "the dedicated wall benchmark must run serially after every functional pass",
  );

  const benchmark = readFileSync(
    "lib/financialProjectionPerformance.benchmark.ts",
    "utf8",
  );
  assert.match(benchmark, /const PERFORMANCE_BUDGET_MS = 50;/);
  assert.match(benchmark, /const REPETITIONS = 5;/);
  assert.match(benchmark, /performance\.now\(\)/);
});

test("the provider benchmark reflects one month index and yielded Dashboard stages", () => {
  const provider = readFileSync("context/BudgetContext.tsx", "utf8");
  const monthIndexReads = provider.match(/indexRecordsByMonth\(transactions\)/g) ?? [];
  assert.equal(monthIndexReads.length, 1);
  assert.match(provider, /preparedReviewCenterCount = countReviewQueue\(transactions, asOfDate\)/);
  assert.match(provider, /startCancellableStageQueue\(\{\s*stages,/);

  const benchmark = readFileSync("lib/financialProjectionPerformance.benchmark.ts", "utf8");
  assert.match(benchmark, /combined-cold=.*\(diagnostic\)/);
  assert.equal((benchmark.match(/indexRecordsByMonth\(ledger\)/g) ?? []).length, 1);
});
