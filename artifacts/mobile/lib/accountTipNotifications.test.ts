import assert from "node:assert/strict";
import test from "node:test";

import { buildAccountTipNotification, createAccountTipPreferenceLoader, type AccountTipPreferenceState, type WeeklyAccountTip } from "./accountTipNotifications";
import { DEFAULT_NOTIFICATION_PREFERENCES } from "./notificationPreferences";
import { dismissNotification, markAllNotificationsRead, markNotificationRead, unreadNotificationCount, visibleNotifications, type InAppNotification } from "./notificationCenter";

const tip: WeeklyAccountTip = {
  id: "tip:2026-11-16",
  title: "Review posted activity",
  body: "Match posted activity to keep your plan current.",
  route: "/more?section=review",
  timestamp: "2026-11-16T00:00:00.000Z",
};
const preference: AccountTipPreferenceState = { userId: "user-a", householdId: "home-a", enabled: true };
const scope = { userId: "user-a", householdId: "home-a", ready: true, demoMode: false, preference };

test("weekly tips fail closed for pending, failed, disabled, or mismatched preferences", () => {
  assert.equal(buildAccountTipNotification(tip, { ...scope, preference: null }), null);
  assert.equal(buildAccountTipNotification(tip, { ...scope, preference: { ...preference, enabled: false } }), null);
  assert.equal(buildAccountTipNotification(tip, { ...scope, preference: { ...preference, userId: "user-b" } }), null);
  assert.equal(buildAccountTipNotification(tip, { ...scope, preference: { ...preference, householdId: "home-b" } }), null);
});

test("tips require the exact account's committed budget and stay hidden for samples and signed-out users", () => {
  assert.equal(buildAccountTipNotification(tip, { ...scope, ready: false }), null);
  assert.equal(buildAccountTipNotification(tip, { ...scope, demoMode: true }), null);
  assert.equal(buildAccountTipNotification(tip, { ...scope, userId: null }), null);
  assert.equal(buildAccountTipNotification(tip, { ...scope, householdId: null }), null);
  assert.equal(buildAccountTipNotification(null, scope), null);
});

test("one stable weekly tip uses bell read and dismiss state without changing financial alerts", () => {
  const accountTip = buildAccountTipNotification(tip, scope)!;
  const financial: InAppNotification = { id: "bill:rent", type: "bill", title: "Rent due", body: "Review your bill.", timestamp: "2026-11-17T12:00:00.000Z", route: "/bills", tone: "watch" };
  const notifications = [financial, accountTip, buildAccountTipNotification({ ...tip }, scope)!];
  const initial = { readIds: [], dismissedIds: [] };
  assert.equal(accountTip.type, "tip");
  assert.equal(accountTip.tone, "info");
  assert.equal(accountTip.route, "/(tabs)/more");
  assert.deepEqual(accountTip.params, { section: "review" });
  assert.deepEqual(visibleNotifications(notifications, initial).map(item => item.id), [financial.id, tip.id]);
  assert.equal(unreadNotificationCount(notifications, initial), 2);
  const read = markNotificationRead(initial, tip.id);
  assert.equal(unreadNotificationCount(notifications, read), 1);
  const dismissed = dismissNotification(read, tip.id);
  assert.deepEqual(visibleNotifications(notifications, dismissed), [financial]);
  assert.equal(unreadNotificationCount(notifications, markAllNotificationsRead(initial, notifications)), 0);
});

test("opting out or changing households does not erase persisted read/dismiss history", () => {
  const accountTip = buildAccountTipNotification(tip, scope)!;
  const saved = dismissNotification(markNotificationRead({ readIds: [], dismissedIds: [] }, accountTip.id), accountTip.id);
  assert.equal(buildAccountTipNotification(tip, { ...scope, preference: { ...preference, enabled: false } }), null);
  assert.deepEqual(visibleNotifications([buildAccountTipNotification(tip, scope)!], saved), []);
  // A different household starts with its own scoped state, not the prior one.
  const otherScope = { ...scope, householdId: "home-b", preference: { ...preference, householdId: "home-b" } };
  assert.equal(unreadNotificationCount([buildAccountTipNotification(tip, otherScope)!], { readIds: [], dismissedIds: [] }), 1);
  const nextWeek = buildAccountTipNotification({ ...tip, id: "tip:2026-11-23", timestamp: "2026-11-23T00:00:00.000Z" }, scope)!;
  assert.equal(unreadNotificationCount([nextWeek], saved), 1);
});

test("a persisted opt-out beats a stale preference request and appears immediately in the bell", async () => {
  let current: AccountTipPreferenceState = null;
  const loader = createAccountTipPreferenceLoader("user-a", "home-a", value => { current = value; });
  let finish!: (value: { preferences: { account_tips: boolean } }) => void;
  const pending = loader.refresh(() => new Promise(resolve => { finish = resolve; }));
  assert.equal(buildAccountTipNotification(tip, { ...scope, preference: current }), null);
  loader.saved({ userId: "user-a", preferences: { ...DEFAULT_NOTIFICATION_PREFERENCES, account_tips: false } });
  finish({ preferences: { account_tips: true } });
  await pending;
  assert.deepEqual(current, { userId: "user-a", householdId: "home-a", enabled: false });
  assert.equal(buildAccountTipNotification(tip, { ...scope, preference: current }), null);
  loader.saved({ userId: "user-a", preferences: DEFAULT_NOTIFICATION_PREFERENCES });
  assert.equal(buildAccountTipNotification(tip, { ...scope, preference: current })?.id, tip.id);
  loader.stop();
});

test("preference failures and stale user or household requests never restore tips", async () => {
  const published: AccountTipPreferenceState[] = [];
  const loader = createAccountTipPreferenceLoader("user-a", "home-a", value => { published.push(value); });
  await loader.refresh(async () => { throw new Error("Offline"); });
  assert.equal(published.at(-1), null);
  loader.saved({ userId: "user-b", preferences: DEFAULT_NOTIFICATION_PREFERENCES });
  assert.equal(published.at(-1), null);
  let finish!: (value: { preferences: { account_tips: boolean } }) => void;
  const pending = loader.refresh(() => new Promise(resolve => { finish = resolve; }));
  loader.stop();
  const count = published.length;
  finish({ preferences: { account_tips: true } });
  await pending;
  loader.saved({ userId: "user-a", preferences: DEFAULT_NOTIFICATION_PREFERENCES });
  assert.equal(published.length, count);
});
