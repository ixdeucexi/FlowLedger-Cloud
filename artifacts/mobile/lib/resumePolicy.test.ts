import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  chooseRestoredHousehold,
  householdResolutionIsCurrent,
  loadResolvedHouseholdSelection,
  PLAN_RESUME_STALE_MS,
  PWA_RESUME_STALE_MS,
  scopedRequestIsCurrent,
  shouldRefreshPlanOnResume,
  shouldReleaseBudgetLoading,
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

test("a transient discovery failure preserves the cached owner scope and financial data", async () => {
  const cached = {
    activeHouseholdId: "personal",
    bills: [{ id: "mortgage", amount: 1_200 }],
    memberships: households,
  };
  let committed = cached;
  let preferenceReads = 0;
  const refresh = async () => {
    const resolved = await loadResolvedHouseholdSelection<(typeof households)[number]>({
      loadHouseholds: async () => {
        throw new Error("temporary network failure");
      },
      readStoredHouseholdId: async () => {
        preferenceReads += 1;
        return "personal";
      },
      readRemoteHouseholdId: async () => {
        preferenceReads += 1;
        return "personal";
      },
    });
    committed = {
      activeHouseholdId: resolved.activeHousehold?.householdId ?? "",
      bills: [],
      memberships: resolved.households,
    };
  };

  await assert.rejects(refresh, /temporary network failure/);
  assert.strictEqual(committed, cached);
  assert.equal(preferenceReads, 2);
});

test("a successfully resolved empty membership set clears scope and absorbs preference failures", async () => {
  let preferenceReads = 0;
  const resolved = await loadResolvedHouseholdSelection({
    loadHouseholds: async () => [],
    readStoredHouseholdId: async () => {
      preferenceReads += 1;
      throw new Error("local preference unavailable");
    },
    readRemoteHouseholdId: async () => {
      preferenceReads += 1;
      throw new Error("remote preference unavailable");
    },
  });
  assert.deepEqual(resolved, {
    households: [],
    activeHousehold: null,
    remoteHouseholdId: null,
  });
  await Promise.resolve();
  assert.equal(preferenceReads, 2);
});

test("household and preference reads overlap but selection waits for discovery", async () => {
  let finishDiscovery!: () => void;
  const discoveryGate = new Promise<void>(resolve => { finishDiscovery = resolve; });
  const events: string[] = [];
  const pending = loadResolvedHouseholdSelection({
    loadHouseholds: async () => {
      events.push("discovery-started");
      await discoveryGate;
      events.push("discovery-finished");
      return households;
    },
    readStoredHouseholdId: async () => {
      events.push("stored-read");
      return "family";
    },
    readRemoteHouseholdId: async () => {
      events.push("remote-read");
      return "personal";
    },
  });
  await Promise.resolve();
  assert.deepEqual(events, ["discovery-started", "stored-read", "remote-read"]);
  finishDiscovery();
  const resolved = await pending;
  assert.equal(resolved.activeHousehold?.householdId, "family");
  assert.deepEqual(events, ["discovery-started", "stored-read", "remote-read", "discovery-finished"]);
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

test("failed user or household transitions keep the privacy barrier until retry succeeds", () => {
  assert.equal(shouldReleaseBudgetLoading({
    backgroundRefresh: true,
    blockingScopeTransition: true,
    blockingUserTransition: false,
    loadSucceeded: false,
  }), false);
  assert.equal(shouldReleaseBudgetLoading({
    backgroundRefresh: true,
    blockingScopeTransition: true,
    blockingUserTransition: false,
    loadSucceeded: true,
  }), true);
  assert.equal(shouldReleaseBudgetLoading({
    backgroundRefresh: false,
    blockingScopeTransition: false,
    blockingUserTransition: true,
    loadSucceeded: false,
  }), false);
  assert.equal(shouldReleaseBudgetLoading({
    backgroundRefresh: false,
    blockingScopeTransition: false,
    blockingUserTransition: false,
    loadSucceeded: false,
  }), true);
});

test("late household detail responses cannot cross a scope generation", () => {
  assert.equal(scopedRequestIsCurrent({
    requestId: 3,
    currentRequestId: 3,
    householdId: "B",
    currentHouseholdId: "B",
  }), true);
  assert.equal(scopedRequestIsCurrent({
    requestId: 2,
    currentRequestId: 3,
    householdId: "A",
    currentHouseholdId: "B",
  }), false);
  assert.equal(scopedRequestIsCurrent({
    requestId: 3,
    currentRequestId: 3,
    householdId: "A",
    currentHouseholdId: "B",
  }), false);
});

test("a deferred prior-user household resolution cannot commit after A changes to B", async () => {
  let currentUserId = "user-a";
  let currentRequestId = 0;
  let finishA!: () => void;
  const aGate = new Promise<void>(resolve => { finishA = resolve; });
  const committed: string[] = [];

  const resolveFor = async (requestUserId: string, gate: Promise<void>) => {
    const requestId = ++currentRequestId;
    await gate;
    if (householdResolutionIsCurrent({
      requestId,
      currentRequestId,
      requestUserId,
      currentUserId,
    })) committed.push(requestUserId);
  };

  const delayedA = resolveFor("user-a", aGate);
  currentUserId = "user-b";
  currentRequestId += 1; // The synchronous user transition invalidates A.
  await resolveFor("user-b", Promise.resolve());
  finishA();
  await delayedA;
  assert.deepEqual(committed, ["user-b"]);
});

test("household discovery fails before any background scope or plan commit", () => {
  const householdsSource = readFileSync("lib/households.ts", "utf8");
  const context = readFileSync("context/BudgetContext.tsx", "utf8");
  const membershipStart = householdsSource.indexOf("export async function loadHouseholdMemberships");
  const membershipEnd = householdsSource.indexOf("export async function loadHouseholdInvites", membershipStart);
  const membershipLoad = householdsSource.slice(membershipStart, membershipEnd);
  assert.match(membershipLoad, /memberships\.error[\s\S]+HouseholdDiscoveryError\("memberships"\)/);
  assert.match(membershipLoad, /households\.error[\s\S]+HouseholdDiscoveryError\("households"\)/);
  assert.match(membershipLoad, /budgets\.error[\s\S]+HouseholdDiscoveryError\("budgets"\)/);
  assert.match(membershipLoad, /householdById\.size !== householdIds\.length[\s\S]+HouseholdDiscoveryError\("incomplete"\)/);
  assert.doesNotMatch(membershipLoad, /if \((?:memberships|households|budgets)\.error\) (?:\{\s*)?return \[\]/);

  const resolveStart = context.indexOf("const resolveHouseholds");
  const resolveEnd = context.indexOf("const markSaveStarted", resolveStart);
  const resolution = context.slice(resolveStart, resolveEnd);
  assert.ok(resolution.indexOf("loadResolvedHouseholdSelection") < resolution.indexOf("setHouseholds(memberships)"));
  assert.ok(resolution.indexOf("householdResolutionIsCurrent") < resolution.indexOf("setHouseholds(memberships)"));
  assert.match(resolution, /currentUserId: financialDataUserIdRef\.current/);
  assert.match(resolution, /uid !== userScopeIdRef\.current/);
  assert.match(resolution, /Commit only after membership, household, budget, and selection reads all/);
  assert.match(context, /financialDataUserIdRef\.current = userId;[\s\S]+householdResolutionRequestRef\.current \+= 1/);

  const loadStart = context.indexOf("// ── Load from Supabase");
  const loadEnd = context.indexOf("const loadBankData", loadStart);
  const backgroundLoad = context.slice(loadStart, loadEnd);
  assert.match(backgroundLoad, /shouldReleaseBudgetLoading\(\{/);
  assert.match(backgroundLoad, /blockingScopeTransition/);
  assert.match(backgroundLoad, /blockingUserTransition/);
  assert.doesNotMatch(
    backgroundLoad.match(/\} catch \(error\) \{[\s\S]*?\} finally \{/)?.[0] ?? "",
    /clearScopedFinancialData|replaceActiveHouseholdScope\(null\)/,
  );
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
