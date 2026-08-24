import assert from "node:assert/strict";
import test from "node:test";

import { notificationDestination, notificationHouseholdAction, notificationRoute } from "./nativeNotificationRoute";

test("native notification routing accepts only privacy-safe app destinations", () => {
  assert.equal(notificationRoute("/bills?attention=overdue"), "/bills?attention=overdue");
  assert.equal(notificationRoute("/transactions"), "/transactions");
  assert.equal(notificationRoute("/more?section=review"), "/more?section=review");
  assert.equal(notificationRoute("https://attacker.invalid"), null);
  assert.equal(notificationRoute("/delete-account"), null);
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
