import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  emitNotificationPreferencesChanged,
  normalizeNotificationPreferences,
  NotificationPreferenceRequestGate,
  subscribeNotificationPreferencesChanged,
} from "./notificationPreferences";

test("legacy preferences gain weekly tips without changing saved opt-outs", () => {
  const saved = { pending_transactions: false, posted_transactions: true, overdue_bills: false, feedback_updates: true, admin_feedback: false };
  assert.deepEqual(normalizeNotificationPreferences(saved), { ...saved, account_tips: true });
  assert.equal(normalizeNotificationPreferences({ ...saved, account_tips: false }).account_tips, false);
  assert.deepEqual(saved, { pending_transactions: false, posted_transactions: true, overdue_bills: false, feedback_updates: true, admin_feedback: false });
});

test("malformed preferences cannot be mistaken for consent", () => {
  for (const value of [null, undefined, [], "true", { account_tips: "false" }, { account_tips: null }]) {
    assert.throws(() => normalizeNotificationPreferences(value), /Could not load/);
  }
});

test("saved preference events carry the user scope and unsubscribe cleanly", () => {
  const received: string[] = [];
  const unsubscribe = subscribeNotificationPreferencesChanged(change => {
    if (change.userId === "user-a") received.push(String(change.preferences.account_tips));
  });
  const preferences = { ...DEFAULT_NOTIFICATION_PREFERENCES, account_tips: false };
  emitNotificationPreferencesChanged({ userId: "user-b", preferences });
  emitNotificationPreferencesChanged({ userId: "user-a", preferences });
  unsubscribe();
  emitNotificationPreferencesChanged({ userId: "user-a", preferences: DEFAULT_NOTIFICATION_PREFERENCES });
  assert.deepEqual(received, ["false"]);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
}

test("credential refresh during a successful save releases its busy state and cannot restore stale choices", async () => {
  const gate = new NotificationPreferenceRequestGate();
  let busy = true;
  let preferences = DEFAULT_NOTIFICATION_PREFERENCES;
  const write = deferred<typeof preferences>();
  const isCurrentSave = gate.beginSave();
  const save = write.promise.then(saved => {
    if (!isCurrentSave()) return;
    gate.invalidateReads();
    preferences = saved;
  }).finally(() => { if (isCurrentSave()) busy = false; });
  // A same-user token refresh starts another GET while PATCH is in flight.
  const read = deferred<typeof preferences>();
  const isCurrentRead = gate.beginRead();
  const refresh = read.promise.then(loaded => { if (isCurrentRead()) preferences = loaded; });
  write.resolve({ ...DEFAULT_NOTIFICATION_PREFERENCES, account_tips: false });
  await save;
  assert.equal(busy, false);
  read.resolve(DEFAULT_NOTIFICATION_PREFERENCES);
  await refresh;
  assert.equal(preferences.account_tips, false);
});

test("credential refresh during a failed save releases controls and preserves the refreshed choices", async () => {
  const gate = new NotificationPreferenceRequestGate();
  let busy = true;
  let errorMessage = "";
  let preferences = DEFAULT_NOTIFICATION_PREFERENCES;
  const write = deferred<typeof preferences>();
  const isCurrentSave = gate.beginSave();
  const save = write.promise.catch(error => {
    if (isCurrentSave()) errorMessage = error.message;
  }).finally(() => { if (isCurrentSave()) busy = false; });
  const read = deferred<typeof preferences>();
  const isCurrentRead = gate.beginRead();
  const refresh = read.promise.then(loaded => { if (isCurrentRead()) preferences = loaded; });
  read.resolve({ ...DEFAULT_NOTIFICATION_PREFERENCES, posted_transactions: false });
  await refresh;
  write.reject(new Error("Save temporarily unavailable"));
  await save;
  assert.equal(busy, false);
  assert.equal(errorMessage, "Save temporarily unavailable");
  assert.equal(preferences.posted_transactions, false);
});

test("old-scope saves cannot clear a new account's busy state after returning to the same household", async () => {
  const gate = new NotificationPreferenceRequestGate();
  let busy = true;
  const oldWrite = deferred<void>();
  const isOldSave = gate.beginSave();
  const oldSave = oldWrite.promise.finally(() => { if (isOldSave()) busy = false; });
  gate.invalidate(); // account A -> B
  gate.invalidate(); // account B -> A again
  const newWrite = deferred<void>();
  const isNewSave = gate.beginSave();
  const newSave = newWrite.promise.finally(() => { if (isNewSave()) busy = false; });
  oldWrite.resolve();
  await oldSave;
  assert.equal(busy, true);
  newWrite.resolve();
  await newSave;
  assert.equal(busy, false);
});
