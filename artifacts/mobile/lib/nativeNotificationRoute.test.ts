import assert from "node:assert/strict";
import test from "node:test";

import { notificationDestination, notificationHouseholdAction, notificationRoute } from "./nativeNotificationRoute";

test("native notification routing accepts only privacy-safe app destinations", () => {
  assert.equal(notificationRoute("/bills?attention=overdue"), "/bills?attention=overdue");
  assert.equal(notificationRoute("/transactions"), "/transactions");
  assert.equal(notificationRoute("/more?section=review"), "/more?section=review");
  assert.equal(notificationRoute("/more?section=admin"), "/more?section=admin");
  assert.equal(notificationRoute("/more?section=help"), "/more?section=help");
  assert.equal(notificationRoute("/more?section=feedback"), "/more?section=help");
  assert.equal(notificationRoute("/(tabs)"), "/(tabs)");
  assert.equal(notificationRoute("https://attacker.invalid"), null);
  assert.equal(notificationRoute("/delete-account"), null);
});

test("native feedback replies preserve only a valid feedback identifier", () => {
  const route = "/more?section=help&feedback=123e4567-e89b-42d3-a456-426614174000";
  assert.deepEqual(notificationDestination({ route }), { route, householdId: null });
  for (const value of [
    "/more?section=help&feedback=not-an-id",
    `${route}&next=/delete-account`,
    "/more?section=admin&feedback=123e4567-e89b-42d3-a456-426614174000",
    "/more?section=help#feedback",
    "/more?section=help&section=admin",
    { toString: () => route },
  ]) assert.equal(notificationRoute(value), null);
});

test("household notification payloads switch only to a current membership", () => {
  const householdA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const householdB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  assert.deepEqual(notificationDestination({ route: "/transactions", householdId: householdA }), { route: "/transactions", householdId: householdA });
  assert.equal(notificationHouseholdAction(householdB, [householdA, householdB], householdA), "switch");
  assert.equal(notificationHouseholdAction(householdA, [householdA], householdA), "current");
  assert.equal(notificationHouseholdAction(householdB, [householdB], householdA), "reject");
  assert.equal(notificationDestination({ route: "/transactions", householdId: "not-a-household" }), null);
});
