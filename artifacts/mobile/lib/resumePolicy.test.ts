import assert from "node:assert/strict";
import test from "node:test";

import {
  chooseRestoredHousehold,
  PLAN_RESUME_STALE_MS,
  shouldRefreshPlanOnResume,
} from "./resumePolicy";

const households = [
  { householdId: "personal", isPersonal: true, name: "Personal" },
  { householdId: "family", isPersonal: false, name: "Family" },
];

test("restores the local device household before a stale remote preference", () => {
  assert.equal(chooseRestoredHousehold({
    households,
    storedHouseholdId: "family",
    remoteHouseholdId: "personal",
  })?.householdId, "family");
});

test("uses the remote household on a device without a local preference", () => {
  assert.equal(chooseRestoredHousehold({
    households,
    storedHouseholdId: null,
    remoteHouseholdId: "family",
  })?.householdId, "family");
});

test("falls back to the personal household when saved choices are unavailable", () => {
  assert.equal(chooseRestoredHousehold({
    households,
    storedHouseholdId: "removed",
    remoteHouseholdId: "missing",
  })?.householdId, "personal");
});

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
