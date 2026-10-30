import assert from "node:assert/strict";
import test from "node:test";
import {
  appendRecentChanges, createRecentChangesRequestGate, formatRecentChangeValue,
  parseRecentChangesPage, RECENT_CHANGE_ROUTES, recentChangesScopeKey, validRecentChangesCursor,
  type RecentChange, type RecentChangeEntity, type RecentChangeField,
} from "./recentChanges";

const scope = { userId: "11111111-1111-4111-8111-111111111111", householdId: "22222222-2222-4222-8222-222222222222", budgetId: "33333333-3333-4333-8333-333333333333" };
const id = "44444444-4444-4444-8444-444444444444";
const amount: RecentChangeField = { key: "amount", label: "Amount", kind: "money", before: 125, after: 145 };
function item(patch: Partial<RecentChange> = {}): RecentChange {
  return { id, sequence: 12, householdId: scope.householdId, budgetId: scope.budgetId, action: "updated", entityType: "income", entityId: "salary", label: "Salary", actorId: scope.userId, actorLabel: "You", source: "manual", createdAt: "2026-10-30T12:00:00Z", changes: [amount], canUndo: true, undoReason: null, undoneAt: null, route: RECENT_CHANGE_ROUTES.income, ...patch };
}
const page = (row = item(), nextCursor: string | null = null) => ({ items: [row], nextCursor });

test("recent changes validates the selected household and budget before exposing rows", () => {
  assert.deepEqual(parseRecentChangesPage(page(), scope).items, [item()]);
  assert.throws(() => parseRecentChangesPage(page(item({ householdId: scope.userId })), scope), /verified/);
  assert.throws(() => parseRecentChangesPage(page(item({ budgetId: scope.userId })), scope), /verified/);
  assert.equal(recentChangesScopeKey({ ...scope, userId: "" }), null);
  assert.equal(recentChangesScopeKey(null), null);
  assert.equal(recentChangesScopeKey(scope), Object.values(scope).join(":"));
});
test("every supported entity uses only its canonical in-app destination", () => {
  for (const entityType of Object.keys(RECENT_CHANGE_ROUTES) as RecentChangeEntity[]) {
    assert.equal(parseRecentChangesPage(page(item({ entityType, route: RECENT_CHANGE_ROUTES[entityType] })), scope).items[0].entityType, entityType);
  }
  for (const route of ["https://example.invalid", "/(tabs)/more?section=admin", "/(tabs)/bills?tab=debt", "javascript:alert(1)"]) {
    assert.throws(() => parseRecentChangesPage(page(item({ route })), scope), /verified/);
  }
  assert.throws(() => parseRecentChangesPage(page(item({ entityType: "__proto__" as RecentChangeEntity })), scope), /verified/);
});
test("invalid snapshots cannot enter the money diff or claim eligibility", () => {
  for (const patch of [{ changes: [{ ...amount, after: Infinity }] }, { changes: [{ ...amount, before: "125" }] }, { changes: [{ ...amount, after: { nested: 1 } }] }, { changes: [{ ...amount, kind: "unknown" }] }, { changes: [{ ...amount, label: "" }] }, { label: "x".repeat(241) }, { actorId: "someone" }, { source: "assistant" }, { createdAt: "not a date" }, { canUndo: true, undoneAt: "2026-10-30T12:00:00Z" }, { canUndo: true, undoReason: "Linked payment" }]) {
    assert.throws(() => parseRecentChangesPage(page({ ...item(), ...patch } as RecentChange), scope), /verified/);
  }
  const undone = item({ canUndo: false, undoneAt: "2026-10-30T12:00:00Z", undoReason: "Already undone" });
  assert.equal(parseRecentChangesPage(page(undone), scope).items[0].canUndo, false);
});
test("paging requires ordered unique IDs and a last-row cursor", () => {
  assert.equal(parseRecentChangesPage(page(item(), "12"), scope).nextCursor, "12");
  assert.throws(() => parseRecentChangesPage(page(item(), "11"), scope), /verified/);
  assert.throws(() => parseRecentChangesPage({ items: [], nextCursor: "12" }, scope), /verified/);
  assert.throws(() => parseRecentChangesPage({ items: [item(), item({ sequence: 11 })], nextCursor: null }, scope), /verified/);
  assert.throws(() => parseRecentChangesPage(page(item({ sequence: Number.MAX_SAFE_INTEGER + 1 })), scope), /verified/);
  assert.equal(parseRecentChangesPage(page(item({ sequence: Number.MAX_SAFE_INTEGER })), scope).items[0].sequence, Number.MAX_SAFE_INTEGER);
  assert.throws(() => parseRecentChangesPage(page(), scope, 0), /verified/);
  assert.equal(parseRecentChangesPage(page(), scope, 25, "13").items.length, 1);
  assert.throws(() => parseRecentChangesPage(page(), scope, 25, "12"), /verified/);
  assert.throws(() => parseRecentChangesPage(page(), scope, 25, "11"), /verified/);
  assert.throws(() => parseRecentChangesPage(page(), scope, 25, "not-a-cursor"), /verified/);
});
test("cursor validation retains bigint precision and rejects malformed pages", () => {
  for (const value of ["1", "9223372036854775807"]) assert.equal(validRecentChangesCursor(value), true);
  for (const value of ["0", "01", "-1", "1.5", "9223372036854775808", "1;select", 12, null]) assert.equal(validRecentChangesCursor(value), false);
});
test("formatted before and after preserve money signs, zero and absent fields", () => {
  assert.equal(formatRecentChangeValue(amount, -12.99), "-$12.99");
  assert.equal(formatRecentChangeValue(amount, 0), "$0.00");
  assert.equal(formatRecentChangeValue(amount, null), "Not set");
  assert.equal(formatRecentChangeValue({ ...amount, kind: "boolean" }, false), "No");
  assert.equal(formatRecentChangeValue({ ...amount, key: "interest_rate", kind: "number" }, 12.5), "12.5%");
  assert.equal(formatRecentChangeValue({ ...amount, kind: "text" }, "Previously linked"), "Previously linked");
});
test("page append deduplicates without replacing newer rows or mutating inputs", () => {
  const current = Object.freeze([Object.freeze(item())]);
  const next = Object.freeze([Object.freeze(item({ label: "Stale duplicate" })), Object.freeze(item({ id: scope.budgetId, sequence: 11 }))]);
  const result = appendRecentChanges(current, next);
  assert.equal(result.length, 2);
  assert.equal(result[0].label, "Salary");
  assert.equal(result[1].sequence, 11);
  assert.equal(current.length, 1);
});
test("request gate rejects old page and old household completions, including scope ABA", () => {
  const gate = createRecentChangesRequestGate();
  const key = recentChangesScopeKey(scope);
  gate.setScope(key);
  const first = gate.begin(), second = gate.begin();
  assert.equal(gate.isCurrent(first), false);
  assert.equal(gate.isCurrent(second), true);
  gate.setScope("another household");
  assert.equal(gate.isCurrent(second), false);
  gate.setScope(key);
  assert.equal(gate.isCurrent(second), false);
  const third = gate.begin();
  gate.invalidate();
  assert.equal(gate.isCurrent(third), false);
  gate.setScope(null);
  assert.equal(gate.isCurrent(gate.begin()), false);
});
