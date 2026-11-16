import assert from "node:assert/strict";
import test from "node:test";

import { getAccountTipForWeek } from "./accountTips";
import {
  accountTipMarkerAction,
  accountTipNotificationAction,
  accountTipOverlayDestination,
  selectAccountTipOverlay,
  visibleAccountTipOverlay,
} from "./accountTipOverlay";
import { markNotificationRead, unreadNotificationCount, type InAppNotification } from "./notificationCenter";

const now = "2026-11-18T12:00:00Z";
const scope = { userId: "user-a", householdId: "home-a", ready: true, demoMode: false };
const notification: InAppNotification = {
  id: "tip:2026-11-16", type: "tip", title: "Untrusted title", body: "Untrusted body",
  timestamp: "2026-11-16T00:00:00Z", route: "/delete-account", tone: "info",
};

test("opening a bell tip selects catalog explanation without navigating; only its CTA has a destination", () => {
  const action = accountTipNotificationAction(notification, scope, now);
  assert.equal(action.kind, "overlay");
  if (action.kind !== "overlay") throw new Error("Expected overlay");
  const expected = getAccountTipForWeek("2026-11-16", now)!;
  assert.deepEqual(action.selection.tip, expected);
  assert.notEqual(action.selection.tip.title, notification.title);
  assert.notEqual(action.selection.tip.route, notification.route);
  assert.ok(action.selection.tip.explanation.length > 20);
  assert.ok(action.selection.tip.actionLabel.startsWith("Open "));
  const destination = accountTipOverlayDestination(action.selection, scope);
  assert.ok(destination?.route.startsWith("/(tabs)"));
  assert.equal(unreadNotificationCount([notification], markNotificationRead({ readIds: [], dismissedIds: [] }, action.selection.tip.id)), 0);
  // Closing clears the selection and cannot navigate or clear read history.
  assert.equal(accountTipOverlayDestination(null, scope), null);
});

test("normal notification navigation is unchanged and malformed tip ids never become links", () => {
  const bill: InAppNotification = { ...notification, type: "bill", id: "bill:1", route: "/bills" };
  assert.deepEqual(accountTipNotificationAction(bill, scope, now), { kind: "navigate", notification: bill });
  for (const id of ["tip:bad", "tip:2026-11-17", "tip:2026-11-23", "not-a-tip"]) {
    assert.deepEqual(accountTipNotificationAction({ ...notification, id }, scope, now), { kind: "ignore" });
  }
});

test("push markers wait for verified scope, consume only once, and permit a later intentional tap", () => {
  assert.equal(accountTipMarkerAction("2026-11-16", null, { ...scope, ready: false }, now).kind, "wait");
  const action = accountTipMarkerAction("2026-11-16", null, scope, now);
  assert.equal(action.kind, "consume");
  if (action.kind !== "consume") throw new Error("Expected consume");
  assert.equal(action.selection?.tip.id, notification.id);
  assert.equal(accountTipMarkerAction("2026-11-16", action.key, scope, now).kind, "wait");
  assert.equal(accountTipMarkerAction(undefined, action.key, scope, now).kind, "reset");
  assert.equal(accountTipMarkerAction("2026-11-16", null, scope, now).kind, "consume");
  const old = accountTipMarkerAction("2026-11-09", null, scope, now);
  assert.equal(old.kind === "consume" ? old.selection?.tip.week : null, "2026-11-09");
});

test("malformed, duplicated, and future push markers are consumed safely without an overlay", () => {
  for (const marker of ["bad", "2026-11-17", "2026-11-23", ["2026-11-16", "2026-11-09"], "/transactions"]) {
    const action = accountTipMarkerAction(marker, null, scope, now);
    assert.equal(action.kind, "consume");
    assert.equal(action.kind === "consume" ? action.selection : undefined, null);
  }
});

test("scope changes and sign-out hide old overlays and block old CTA handlers", () => {
  const selection = selectAccountTipOverlay("2026-11-16", scope, now)!;
  for (const changed of [{ ...scope, userId: null }, { ...scope, userId: "user-b" }, { ...scope, householdId: "home-b" }, { ...scope, ready: false }, { ...scope, demoMode: true }]) {
    assert.equal(visibleAccountTipOverlay(selection, changed), null);
    assert.equal(accountTipOverlayDestination(selection, changed), null);
  }
});
