import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeRestorableRoute,
  prefetchRestorableRoute,
  restorableRouteCanApply,
  restorableRoutePrefetchIsCurrent,
} from "./navigationMemory";

test("normalizes tab routes without retaining action parameters", () => {
  assert.equal(normalizeRestorableRoute("/(tabs)/bills?add=1"), "/bills");
  assert.equal(normalizeRestorableRoute("/"), "/(tabs)");
});

test("retains allow-listed page presentation parameters", () => {
  assert.equal(
    normalizeRestorableRoute("/transactions?range=last_90_days&category=Food&activityId=private"),
    "/transactions?range=last_90_days&category=Food",
  );
  assert.equal(normalizeRestorableRoute("/more?section=security"), "/more?section=security");
});

test("rejects blocked, unknown, and privileged restoration targets", () => {
  assert.equal(normalizeRestorableRoute("/login"), null);
  assert.equal(normalizeRestorableRoute("/somewhere-else"), null);
  assert.equal(normalizeRestorableRoute("/more?section=admin"), "/more");
});

test("treats the How FlowLedger works guide as a transient route", () => {
  assert.equal(normalizeRestorableRoute("/how-flowledger-works?section=stability"), "/(tabs)");
  assert.equal(normalizeRestorableRoute("/(tabs)/how-flowledger-works?protectedDays=42"), "/(tabs)");
});

test("prefetched routes cannot apply before core privacy readiness or across a scope change", () => {
  const entry = prefetchRestorableRoute(null, "user-a:household-a", async () => "/transactions");
  const canApply = (overrides: Partial<Parameters<typeof restorableRouteCanApply>[0]> = {}) =>
    restorableRouteCanApply({
      cancelled: false,
      applyReady: true,
      expectedScopeKey: "user-a:household-a",
      currentScopeKey: "user-a:household-a",
      entry,
      currentEntry: entry,
      ...overrides,
    });

  assert.equal(canApply(), true);
  assert.equal(canApply({ applyReady: false }), false);
  assert.equal(canApply({ cancelled: true }), false);
  assert.equal(canApply({ currentScopeKey: "user-b:household-b" }), false);
  assert.equal(canApply({ currentScopeKey: null }), false);
  assert.equal(canApply({ currentEntry: null }), false);
});

test("route prefetch reuses only the current user and household scope", async () => {
  let reads = 0;
  const first = prefetchRestorableRoute(null, "user-a:household-a", async () => {
    reads += 1;
    return "/transactions";
  });
  const reused = prefetchRestorableRoute(first, "user-a:household-a", async () => {
    reads += 1;
    return "/bills";
  });
  const replacement = prefetchRestorableRoute(reused, "user-b:household-b", async () => {
    reads += 1;
    return "/monthly";
  });

  assert.equal(reused, first);
  assert.equal(await reused.promise, "/transactions");
  assert.equal(await replacement.promise, "/monthly");
  assert.equal(reads, 2);
  assert.equal(restorableRoutePrefetchIsCurrent(first, "user-b:household-b"), false);
  assert.equal(restorableRoutePrefetchIsCurrent(replacement, "user-b:household-b"), true);
});
