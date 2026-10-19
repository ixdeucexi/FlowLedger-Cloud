import assert from "node:assert/strict";
import test from "node:test";

import { buildSafetyStop } from "./safetyStop";

const baseline = [
  { date: "2026-07-01", balance: 600 },
  { date: "2026-07-02", balance: 500 },
  { date: "2026-07-03", balance: 350 },
];

test("does not warn when a scheduled item keeps the forecast above the safety floor", () => {
  const warning = buildSafetyStop({
    baseline,
    safetyFloor: 200,
    scenario: { type: "one_time_purchase", name: "Groceries", amount: 100, date: "2026-07-02" },
  });
  assert.equal(warning, null);
});

test("warns when a scheduled item would take the forecast below the safety floor", () => {
  const warning = buildSafetyStop({
    baseline,
    safetyFloor: 200,
    scenario: { type: "one_time_purchase", name: "Concert", amount: 250, date: "2026-07-02" },
  });
  assert.ok(warning);
  assert.equal(warning.itemName, "Concert");
  assert.equal(warning.lowestBalance, 100);
  assert.equal(warning.shortfall, 100);
  assert.equal(warning.lowestBalanceDate, "2026-07-03");
});


import { buildBucketSafetyStop } from "./safetyStop";

function bucketPreview(balances: { day: number; balance: number }[], amount = 100) {
  return buildBucketSafetyStop({ name: "Gifts", amount, targetDate: "2026-12-15", safetyFloor: 200, horizonMonths: 1, getDailyBalances: () => balances });
}

test("bucket target day and equal safety floor are safe; earlier dips do not count", () => {
  assert.equal(bucketPreview([{ day: 14, balance: 0 }, { day: 15, balance: 300 }, { day: 31, balance: 500 }]), null);
  assert.equal(bucketPreview([{ day: 15, balance: 400 }]), null);
});

test("bucket catches an exact target-day dip even when later income repairs month end", () => {
  const warning = bucketPreview([{ day: 15, balance: 250 }, { day: 31, balance: 1000 }]);
  assert.equal(warning?.lowestBalance, 150);
  assert.equal(warning?.lowestBalanceDate, "2026-12-15");
  assert.equal(warning?.shortfall, 50);
});

test("bucket reservation persists into following months across year boundary", () => {
  const calls: string[] = [];
  const warning = buildBucketSafetyStop({
    name: "Trip", amount: 100, targetDate: "2028-12-31", safetyFloor: 200, horizonMonths: 2,
    getDailyBalances: (month, year) => {
      calls.push(`${year}-${month}`);
      return month === 11 ? [{ day: 30, balance: 0 }, { day: 31, balance: 500 }] : [{ day: 1, balance: 250 }, { day: 31, balance: 1000 }];
    },
  });
  assert.deepEqual(calls, ["2028-11", "2029-0"]);
  assert.equal(warning?.lowestBalanceDate, "2029-01-01");
  assert.equal(warning?.lowestBalance, 150);
});

test("bucket includes leap day and uses default horizon when unset", () => {
  const calls: number[] = [];
  const warning = buildBucketSafetyStop({
    name: "Leap", amount: 100, targetDate: "2028-02-29", safetyFloor: 200, horizonMonths: 0,
    getDailyBalances: month => { calls.push(month); return [{ day: month === 1 ? 29 : 1, balance: 250 }]; },
  });
  assert.equal(calls.length, 6);
  assert.equal(warning?.lowestBalanceDate, "2028-02-29");
});

import { readFileSync } from "node:fs";
import { transpileModule, ModuleKind } from "typescript";

function goalSaveHarness(reject = false) {
  const source = readFileSync("components/GoalModal.tsx", "utf8");
  const body = source.slice(source.indexOf("  const saveGoal ="), source.indexOf("  const handleSave ="));
  const state = { busy: false, saving: false, pending: { name: "Exact payload" } as object | null, warning: {} as object | null, calls: [] as object[], closes: 0, errors: 0 };
  let finish!: () => void;
  const promise = new Promise<void>((resolve, rejectSave) => { finish = () => reject ? rejectSave(new Error("offline")) : resolve(); });
  const bindings = {
    savingRef: { get current() { return state.busy; }, set current(value: boolean) { state.busy = value; } },
    setSaving: (value: boolean) => { state.saving = value; },
    setPendingGoal: (value: object | null) => { state.pending = value; },
    setSafetyStop: (value: object | null) => { state.warning = value; },
    onSave: (payload: object) => { state.calls.push(payload); return promise; },
    onClose: () => { state.closes++; },
    Alert: { alert: () => { state.errors++; } },
  };
  const js = transpileModule(body, { compilerOptions: { module: ModuleKind.CommonJS } }).outputText;
  const save = new Function(...Object.keys(bindings), `${js}; return saveGoal;`)(...Object.values(bindings));
  return { state, save, finish };
}

test("bucket override saves exact validated payload once despite duplicate taps", async () => {
  const { state, save, finish } = goalSaveHarness();
  const payload = state.pending;
  const first = save(payload);
  await save(payload);
  assert.equal(state.calls.length, 1);
  assert.equal(state.calls[0], payload);
  assert.equal(state.closes, 0);
  finish(); await first;
  assert.equal(state.closes, 1);
  assert.equal(state.pending, null);
  assert.equal(state.warning, null);
  assert.equal(state.busy, false);
});

test("failed bucket override keeps pending payload and warning for retry", async () => {
  const { state, save, finish } = goalSaveHarness(true);
  const payload = state.pending;
  const first = save(payload); finish(); await first;
  assert.equal(state.closes, 0);
  assert.equal(state.pending, payload);
  assert.ok(state.warning);
  assert.equal(state.errors, 1);
  assert.equal(state.busy, false);
});

test("bucket warning lifecycle retains draft, resets on reopen, and owns one nested back listener", () => {
  const source = readFileSync("components/GoalModal.tsx", "utf8");
  const keepEditing = source.slice(source.indexOf("  const keepEditing"), source.indexOf("  const requestClose"));
  assert.match(keepEditing, /setPendingGoal\(null\)/);
  assert.match(keepEditing, /setSafetyStop\(null\)/);
  assert.doesNotMatch(keepEditing, /onSave|onClose|setName|setTarget/);
  assert.match(source, /if \(safetyStop\) keepEditing\(\)/);
  assert.match(source, /useBackDismiss\(visible, requestClose, true, Boolean\(safetyStop\)\)/);
  assert.match(source, /manageBackHistory=\{false\}/);
  assert.match(source, /useEffect\(\(\) => \{\s*setConfirmation\(null\);\s*setPendingGoal\(null\);\s*setSafetyStop\(null\);/);
  assert.match(source, /!skipAffordabilityCheck && !editGoal && goalMode === "budget"/);
  assert.doesNotMatch(source, /setTimeout|BucketAffordabilityModal/);
});
