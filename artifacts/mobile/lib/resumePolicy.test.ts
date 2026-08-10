import assert from "node:assert/strict";
import test from "node:test";

import {
  PLAN_RESUME_STALE_MS,
  shouldRefreshPlanOnResume,
} from "./resumePolicy";

test("refreshes a plan after the resume window expires", () => {
  const now = 1_000_000;
  assert.equal(
    shouldRefreshPlanOnResume({
      lastRefreshAt: now - PLAN_RESUME_STALE_MS,
      now,
    }),
    true,
  );
  assert.equal(
    shouldRefreshPlanOnResume({
      lastRefreshAt: now - PLAN_RESUME_STALE_MS + 1,
      now,
    }),
    false,
  );
});

test("does not refresh while offline", () => {
  assert.equal(
    shouldRefreshPlanOnResume({ lastRefreshAt: 0, now: 1_000, online: false }),
    false,
  );
});

test("treats a missing successful refresh as stale", () => {
  assert.equal(
    shouldRefreshPlanOnResume({ lastRefreshAt: 0, now: 1_000 }),
    true,
  );
});
