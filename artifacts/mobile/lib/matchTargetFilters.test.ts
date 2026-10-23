import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { transpileModule } from "typescript";
import { activityTargetsForKind, reviewTargetsForKind, selectedMatchTargetKind, type MatchTargetKind } from "./matchTargetFilters";

const targets = [
  { id: "manual-debt", type: "manual", isDebt: true, plannedAmount: 50, occurrenceDate: "2026-10-22", score: 100 },
  { id: "card", type: "bill", isDebt: true, plannedAmount: 50, occurrenceDate: "2026-10-22", score: 90 },
  { id: "gifts", type: "goal", plannedAmount: 200, occurrenceDate: "2026-12-25", score: 80 },
  { id: "extra", type: "snowball", isDebt: true, plannedAmount: 25, occurrenceDate: "2026-10-23", score: 70 },
  { id: "rent", type: "bill", isDebt: false, plannedAmount: 1000, occurrenceDate: "2026-11-01", score: 60 },
  { id: "trip", type: "decision", plannedAmount: 300, occurrenceDate: "2026-10-27", score: 50 },
  { id: "pay", type: "income", plannedAmount: 1500, occurrenceDate: "2026-10-30", score: 40 },
];

test("posted review filters separate buckets, calendar plans, bills, debts and recorded manual debt payments", () => {
  const expected: Record<MatchTargetKind, string[]> = {
    bill: ["rent"], debt: ["card", "extra"], manual: ["manual-debt"], bucket: ["gifts"], decision: ["trip"],
  };
  assert.deepEqual(reviewTargetsForKind(targets, null), []);
  for (const kind of Object.keys(expected) as MatchTargetKind[]) {
    const result = reviewTargetsForKind(targets, kind);
    assert.deepEqual(result.map(target => target.id), expected[kind]);
    for (const target of result) assert.equal(target, targets.find(original => original.id === target.id), "do not alter reconciliation payload or ranking");
  }
});

test("a long bucket list and its high-ranked suggestions stay hidden outside the Buckets filter", () => {
  const buckets = Array.from({ length: 40 }, (_, index) => ({ ...targets[2], id: `bucket-${index}`, score: 100 - index }));
  const ranked = [...buckets, targets[4]];
  assert.deepEqual(reviewTargetsForKind(ranked, null), []);
  assert.deepEqual(reviewTargetsForKind(ranked, "bill"), [targets[4]]);
  assert.deepEqual(reviewTargetsForKind(ranked, "bucket"), buckets);
  assert.deepEqual(reviewTargetsForKind(ranked, "manual"), []);
});

test("regular Activity filters retain ranked target objects and use current debt identity", () => {
  const options = [
    { billId: "manual-card", targetType: "manual", plannedAmount: 50 },
    { billId: "gifts", targetType: "bucket", plannedAmount: 200 },
    { billId: "card", targetType: "bill", plannedAmount: 50 },
    { billId: "rent", targetType: "bill", plannedAmount: 1000 },
    { billId: "removed", targetType: "bill", plannedAmount: 100 },
  ];
  const bills = [{ id: "card", is_debt: true }, { id: "rent", is_debt: false }];
  assert.deepEqual(activityTargetsForKind(options, null, bills), []);
  for (const [kind, index] of [["manual", 0], ["bucket", 1], ["debt", 2], ["bill", 3]] as const) {
    assert.deepEqual(activityTargetsForKind(options, kind, bills), [options[index]]);
    assert.equal(activityTargetsForKind(options, kind, bills)[0], options[index]);
  }
  assert.deepEqual(activityTargetsForKind(options, "debt", [{ id: "card", is_debt: false }]), []);
});

test("selection cannot leak across users, households or current transactions", () => {
  const selection = { scope: "user-a:home-a:posted-a", kind: "bucket" as const };
  assert.equal(selectedMatchTargetKind(null, selection.scope), null);
  assert.equal(selectedMatchTargetKind(selection, selection.scope), "bucket");
  for (const scope of ["user-b:home-a:posted-a", "user-a:home-b:posted-a", "user-a:home-a:posted-b"]) {
    assert.equal(selectedMatchTargetKind(selection, scope), null);
  }
});

test("Activity opening another transaction or closing clears its selected match type without saving", () => {
  const source = readFileSync("app/(tabs)/transactions.tsx", "utf8");
  const start = source.indexOf("  const setMatchTx = useCallback");
  const end = source.indexOf("  const matchTargetScope", start);
  assert.ok(start >= 0 && end > start);
  const javascript = transpileModule(source.slice(start, end), {}).outputText;
  let selected: unknown = { scope: "old", kind: "bucket" };
  let transaction: unknown;
  const set = new Function("useCallback", "setMatchTargetSelection", "setMatchTxState", `${javascript}; return setMatchTx;`)(
    (callback: unknown) => callback, (value: unknown) => { selected = value; }, (value: unknown) => { transaction = value; },
  );
  for (const value of [{ id: "a" }, null, { id: "b" }]) {
    selected = { scope: "old", kind: "debt" };
    set(value);
    assert.equal(selected, null);
    assert.equal(transaction, value);
  }
});
