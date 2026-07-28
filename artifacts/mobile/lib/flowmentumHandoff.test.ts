import assert from "node:assert/strict";
import test from "node:test";

import {
  FLOWMENTUM_PROTECTED_DAYS,
  flowmentumPreviewStorageKey,
  flowmentumSeenStorageKey,
  isFlowmentumHandoffEligible,
  shouldShowFlowmentumHandoff,
} from "./flowmentumHandoff";

const ready = {
  protectedDays: 180,
  stage: "standing",
  status: "safe" as const,
  riskDays: 0,
  forecastConfidence: "high" as const,
};

test("Flowmentum handoff starts at 180 protected days with a healthy trusted plan", () => {
  assert.equal(FLOWMENTUM_PROTECTED_DAYS, 180);
  assert.equal(isFlowmentumHandoffEligible(ready), true);
  assert.equal(isFlowmentumHandoffEligible({ ...ready, protectedDays: 179 }), false);
  assert.equal(isFlowmentumHandoffEligible({ ...ready, stage: "freedom" }), false);
  assert.equal(isFlowmentumHandoffEligible({ ...ready, status: "watch" }), false);
  assert.equal(isFlowmentumHandoffEligible({ ...ready, riskDays: 1 }), false);
  assert.equal(isFlowmentumHandoffEligible({ ...ready, forecastConfidence: "medium" }), false);
});

test("Flowmentum stays hidden before eligibility and after dismissal", () => {
  assert.equal(shouldShowFlowmentumHandoff({ eligible: false, seen: false }), false);
  assert.equal(shouldShowFlowmentumHandoff({ eligible: true, seen: true }), false);
  assert.equal(shouldShowFlowmentumHandoff({ eligible: true, seen: false }), true);
  assert.equal(shouldShowFlowmentumHandoff({ eligible: false, seen: false, adminPreview: true }), true);
});

test("Flowmentum alert state is isolated by user and household", () => {
  assert.equal(
    flowmentumSeenStorageKey("user-1", "household-1"),
    "flowledger-flowmentum-seen-v2-user-1-household-1",
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
