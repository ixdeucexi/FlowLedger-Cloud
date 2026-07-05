import assert from "node:assert/strict";
import test from "node:test";

import { LEARNING_TOUR_STEPS } from "./learningTourCatalog";

test("learning tour teaches the main FlowLedger surfaces in order", () => {
  assert.deepEqual(
    LEARNING_TOUR_STEPS.map(step => step.route),
    ["index", "monthly", "bills", "transactions", "flo", "more"],
  );
  assert.ok(LEARNING_TOUR_STEPS.every(step => step.floSays.includes("I ")));
  assert.ok(LEARNING_TOUR_STEPS.every(step => step.tryThis.length > 20));
});
