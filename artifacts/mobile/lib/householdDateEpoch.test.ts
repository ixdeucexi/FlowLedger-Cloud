import assert from "node:assert/strict";
import test from "node:test";

import {
  millisecondsUntilHouseholdDateChanges,
  subscribeHouseholdDateResumeEvents,
} from "./householdDateEpoch";

test("household date epoch reaches August-to-September midnight exactly", () => {
  assert.equal(
    millisecondsUntilHouseholdDateChanges(
      new Date("2026-08-31T23:59:30.000Z"),
      "UTC",
    ),
    30_000,
  );
});

test("a bfcache pageshow refreshes the date epoch without a visibility event", () => {
  class FakeTarget {
    visibilityState = "hidden";
    listeners = new Map<string, Set<() => void>>();
    addEventListener(type: string, listener: () => void) {
      const listeners = this.listeners.get(type) ?? new Set();
      listeners.add(listener);
      this.listeners.set(type, listeners);
    }
    removeEventListener(type: string, listener: () => void) {
      this.listeners.get(type)?.delete(listener);
    }
    dispatch(type: string) {
      this.listeners.get(type)?.forEach(listener => listener());
    }
  }
  const documentTarget = new FakeTarget();
  const windowTarget = new FakeTarget();
  let refreshes = 0;
  const unsubscribe = subscribeHouseholdDateResumeEvents({
    documentTarget,
    windowTarget,
    onRefresh: () => { refreshes += 1; },
  });

  windowTarget.dispatch("pageshow");
  assert.equal(refreshes, 1);
  unsubscribe();
  windowTarget.dispatch("pageshow");
  assert.equal(refreshes, 1);
});

test("household date epoch reaches December-to-January midnight exactly", () => {
  assert.equal(
    millisecondsUntilHouseholdDateChanges(
      new Date("2026-12-31T23:59:59.000Z"),
      "UTC",
    ),
    1_000,
  );
});

test("household date epoch follows Chicago local midnight during daylight time", () => {
  assert.equal(
    millisecondsUntilHouseholdDateChanges(
      new Date("2026-08-31T04:59:30.000Z"),
      "America/Chicago",
    ),
    30_000,
  );
});
