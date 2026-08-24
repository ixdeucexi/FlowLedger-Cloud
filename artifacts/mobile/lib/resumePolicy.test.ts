import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  chooseRestoredHousehold,
  PLAN_RESUME_STALE_MS,
  PWA_RESUME_STALE_MS,
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

test("keeps a restored PWA plan cached for five minutes", () => {
  const now = 1_000_000;
  assert.equal(
    shouldRefreshPlanOnResume({ lastRefreshAt: now - PWA_RESUME_STALE_MS + 1, now, staleAfterMs: PWA_RESUME_STALE_MS }),
    false,
  );
  assert.equal(
    shouldRefreshPlanOnResume({ lastRefreshAt: now - PWA_RESUME_STALE_MS, now, staleAfterMs: PWA_RESUME_STALE_MS }),
    true,
  );
});

test("the PWA coalesces return events and never refreshes a fresh cached plan", () => {
  const source = readFileSync("context/BudgetContext.tsx", "utf8");
  assert.match(source, /staleAfterMs: Platform\.OS === "web" \? PWA_RESUME_STALE_MS : undefined/);
  assert.match(source, /resumeTimer = setTimeout\(runResumeRefresh, 750\)/);
  assert.match(source, /window\.addEventListener\("pageshow", scheduleResumeRefresh\)/);
  assert.doesNotMatch(source, /window\.addEventListener\("focus"/);
  assert.doesNotMatch(source, /runResumeRefresh[\s\S]{0,180}refreshBankData/);
  assert.match(source, /if \(backgroundRefresh\) backgroundRefreshPendingRef\.current = false/);
  assert.match(source, /const userId = user\?\.id \?\? null/);
  assert.match(source, /\}, \[userId, demoMode, loadRetryNonce/);
  assert.match(source, /knownNetworkStatus\(\) === true/);
});

test("web auth relies on Supabase recovery while native resume checks are coalesced", () => {
  const source = readFileSync("context/AuthContext.tsx", "utf8");
  assert.match(source, /function sessionsMateriallyEqual/);
  assert.match(source, /setSession\(current => sessionsMateriallyEqual\(current, nextSession\) \? current : nextSession\)/);
  assert.match(source, /if \(resumeSessionPromise\) return resumeSessionPromise/);
  assert.match(source, /const appStateSubscription = Platform\.OS === "web"[\s\S]*?\? null[\s\S]*?: AppState\.addEventListener/);
  assert.doesNotMatch(source, /document\.addEventListener\("visibilitychange", refresh/);
  assert.doesNotMatch(source, /window\.addEventListener\("pageshow", refresh/);
});

test("admin feedback refresh uses one web lifecycle source with dedupe and a 30-second TTL", () => {
  const source = readFileSync("context/FeedbackBadgeContext.tsx", "utf8");
  assert.match(source, /const FEEDBACK_REFRESH_STALE_MS = 30_000/);
  assert.match(source, /if \(feedbackRefreshPromiseRef\.current\) return feedbackRefreshPromiseRef\.current/);
  assert.match(source, /now - lastFeedbackRefreshAtRef\.current < FEEDBACK_REFRESH_STALE_MS/);
  assert.match(source, /document\.addEventListener\("visibilitychange", handleVisibilityChange\)/);
  assert.doesNotMatch(source, /window\.addEventListener\("focus"/);
  assert.doesNotMatch(source, /window\.addEventListener\("pageshow"/);
});
