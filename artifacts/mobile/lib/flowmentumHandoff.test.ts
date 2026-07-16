import assert from "node:assert/strict";
import test from "node:test";

import {
  flowmentumPreviewStorageKey,
  flowmentumSeenStorageKey,
  isFlowmentumHandoffEligible,
} from "./flowmentumHandoff";

const ready = {
  protectedDays: 90,
  stage: "standing",
  status: "safe" as const,
  riskDays: 0,
  forecastConfidence: "high" as const,
};

test("Flowmentum handoff starts at 90 protected days with a healthy trusted plan", () => {
  assert.equal(isFlowmentumHandoffEligible(ready), true);
  assert.equal(isFlowmentumHandoffEligible({ ...ready, protectedDays: 89 }), false);
  assert.equal(isFlowmentumHandoffEligible({ ...ready, stage: "reserve" }), false);
  assert.equal(isFlowmentumHandoffEligible({ ...ready, status: "watch" }), false);
  assert.equal(isFlowmentumHandoffEligible({ ...ready, riskDays: 1 }), false);
  assert.equal(isFlowmentumHandoffEligible({ ...ready, forecastConfidence: "medium" }), false);
});

test("Flowmentum alert state is isolated by user and household", () => {
  assert.equal(
    flowmentumSeenStorageKey("user-1", "household-1"),
    "flowledger-flowmentum-seen-v1-user-1-household-1",
  );
  assert.notEqual(
    flowmentumSeenStorageKey("user-1", "household-1"),
    flowmentumSeenStorageKey("user-1", "household-2"),
  );
  assert.notEqual(
    flowmentumPreviewStorageKey("user-1", "household-1"),
    flowmentumSeenStorageKey("user-1", "household-1"),
  );
});
