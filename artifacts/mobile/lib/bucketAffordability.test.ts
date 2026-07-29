import assert from "node:assert/strict";
import test from "node:test";

import { buildBucketAffordabilitySummary } from "./bucketAffordability";

test("explains when a new spending bucket fits the forecast", () => {
  const summary = buildBucketAffordabilitySummary(
    "Weekend trip",
    300,
    "2026-08-15",
    200,
    { projectedBalance: 900, canAfford: true, shortfall: 0 },
  );

  assert.equal(summary.safe, true);
  assert.equal(summary.title, "Yes, this fits your plan.");
  assert.equal(summary.statusValue, "$600");
  assert.match(summary.message, /\$200 safety floor/);
});

test("explains how much room an unsafe spending bucket needs", () => {
  const summary = buildBucketAffordabilitySummary(
    "Emergency repair",
    900,
    "2026-08-15",
    200,
    { projectedBalance: 650, canAfford: false, shortfall: 450 },
  );

  assert.equal(summary.safe, false);
  assert.equal(summary.title, "This is not safe yet.");
  assert.equal(summary.statusValue, "$450");
  assert.match(summary.message, /free up \$450 first/);
});
