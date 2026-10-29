import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { transpileModule, ModuleKind, JsxEmit } from "typescript";
import { activityTargetsForKind, matchTargetKindLabels, reviewTargetsForKind, selectedMatchTargetKind, type MatchTargetKind } from "./matchTargetFilters";

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

test("a long bucket list stays hidden outside the Buckets filter", () => {
  const buckets = Array.from({ length: 40 }, (_, index) => ({ ...targets[2], id: `bucket-${index}`, score: 100 - index }));
  const ranked = [...buckets, targets[4]];
  assert.deepEqual(reviewTargetsForKind(ranked, null), []);
  assert.deepEqual(reviewTargetsForKind(ranked, "bill"), [targets[4]]);
  assert.deepEqual(reviewTargetsForKind(ranked, "bucket"), buckets);
  assert.deepEqual(reviewTargetsForKind(ranked, "manual"), []);
});

const reviewSource = () => readFileSync("components/ReviewCenter.tsx", "utf8");
const activitySource = () => readFileSync("app/(tabs)/transactions.tsx", "utf8");

function execute(source: string, bindings: Record<string, unknown>) {
  const js = transpileModule(source, {
    fileName: "posted-suggestion.tsx", compilerOptions: { module: ModuleKind.CommonJS, jsx: JsxEmit.React },
  }).outputText;
  return new Function(...Object.keys(bindings), js)(...Object.values(bindings));
}

function reviewSuggestion(ranked: typeof targets, kind: MatchTargetKind | null, amount = -50) {
  const declaration = reviewSource().match(/  const suggestion = [^\n]+;/)?.[0];
  assert.ok(declaration);
  return execute(`${declaration}\nreturn suggestion;`, {
    targets: ranked, targetKind: kind, filteredTargets: reviewTargetsForKind(ranked, kind), current: { amount },
  });
}

function activitySuggestion(options: any[], kind: MatchTargetKind | null) {
  const source = activitySource();
  const start = source.indexOf("  const matchSuggestion =");
  const end = source.indexOf("  const transactionName =", start);
  assert.ok(start >= 0 && end > start);
  return execute(`${source.slice(start, end)}\nreturn { suggestion: matchSuggestion, kind: matchSuggestionKind };`, {
    combinedMatchOptions: options, matchTargetKind: kind,
    filteredMatchOptions: activityTargetsForKind(options, kind, [{ id: "card", is_debt: true }]),
    bills: [{ id: "card", is_debt: true }],
  });
}

function suggestionCard(surface: "review" | "activity", candidate: any, saving = false, kind = "bill") {
  const s = surface === "review" ? reviewSource() : activitySource();
  const marker = surface === "review" ? "{suggestion && suggestion.score >= 78 ? (" : "{matchSuggestion ? (";
  const start = s.indexOf(marker);
  const filters = s.indexOf("<MatchTypeFilters", start);
  const end = s.lastIndexOf(") : null}", filters);
  assert.ok(start >= 0 && end > start && filters > end);
  const expression = s.slice(start + 1, end + ") : null".length);
  const calls: unknown[][] = [];
  const React = { createElement: (type: unknown, props: any, ...children: unknown[]) => ({ type, props: { ...props, children } }) };
  const card = execute(`const card = (${expression}); return card;`, {
    React, Pressable: "button", Text: "text", View: "view", FloLogo: "flo", styles: {}, c: {},
    suggestion: candidate, matchSuggestion: candidate, matchSuggestionKind: kind, matchTargetKindLabels,
    saving, savingMatch: saving,
    chooseTarget: (target: unknown) => calls.push(["review", target]),
    handleMatchBill: (id: string) => calls.push(["bill", id]),
    handleMatchManual: (id: string) => calls.push(["manual", id]),
    handleMatchBucket: (id: string) => calls.push(["bucket", id]),
  });
  return { card, calls };
}

test("posted review's best suggestion is independent of each display filter, including no selection and income", () => {
  const before = JSON.stringify(targets);
  for (const kind of [null, "bill", "debt", "manual", "bucket", "decision"] as const) {
    assert.equal(reviewSuggestion(targets, kind), targets[0]);
    assert.equal(reviewSuggestion(targets, kind, 50), targets[0]);
  }
  assert.equal(JSON.stringify(targets), before);
  assert.equal(reviewSuggestion([], null), undefined);
  assert.deepEqual(reviewTargetsForKind(targets, null), [], "the full list remains hidden until a type is chosen");
});

test("posted review keeps its original confidence cutoff and dispatches the exact target only on explicit use", () => {
  for (const type of ["bill", "manual", "goal", "snowball", "decision", "income"]) {
    const candidate = { ...targets[0], type, score: 78, name: "Saved display name", reasons: ["Exact amount"] };
    const { card, calls } = suggestionCard("review", candidate);
    assert.equal(calls.length, 0);
    assert.equal(card.props.disabled, false);
    assert.match(card.props.accessibilityLabel, /Saved display name/);
    card.props.onPress();
    assert.equal(calls.length, 1);
    assert.equal(calls[0][1], candidate, "preserve occurrence, amount, settlement and target identity");
    assert.equal(suggestionCard("review", candidate, true).card.props.disabled, true);
  }
  assert.equal(suggestionCard("review", { ...targets[0], score: 77.99 }).card, null);
  assert.equal(suggestionCard("review", undefined).card, null);
});

test("Activity's suggestion keeps its original cutoff, own target kind and ranked payload across filters", () => {
  const candidate = { billId: "card", targetType: "bill", plannedAmount: 50, occurrenceDate: "2026-10-22", score: 48 };
  for (const selectedKind of [null, "bill", "debt", "manual", "bucket"] as const) {
    const result = activitySuggestion([candidate], selectedKind);
    assert.equal(result.suggestion, candidate);
    assert.equal(result.kind, "debt", "label comes from the current debt, not the selected filter");
  }
  assert.equal(activitySuggestion([{ ...candidate, score: 47.99 }], null).suggestion, null);
  assert.equal(activitySuggestion([], null).suggestion, null);
  for (const targetType of ["manual", "bucket"]) {
    const result = activitySuggestion([{ ...candidate, targetType }], "bill");
    assert.equal(result.kind, targetType);
  }
});

test("Activity's visible suggestion invokes the existing handler only when used, and saving disables it", () => {
  for (const [kind, targetType] of [["bill", "bill"], ["debt", "bill"], ["manual", "manual"], ["bucket", "bucket"]]) {
    const candidate = { billId: `${kind}-exact-id`, targetType, name: "Saved name", plannedAmount: 50, nearestOccurrenceDate: "2026-10-22", reasons: ["Exact amount"], score: 48 };
    const { card, calls } = suggestionCard("activity", candidate, false, kind);
    assert.equal(calls.length, 0, "opening and rendering never matches automatically");
    assert.equal(card.props.disabled, false);
    assert.match(card.props.accessibilityLabel, /Saved name/);
    card.props.onPress();
    assert.deepEqual(calls, [[targetType, candidate.billId]]);
    assert.equal(suggestionCard("activity", candidate, true, kind).card.props.disabled, true);
  }
  assert.equal(suggestionCard("activity", null).card, null);
});

test("both posted matching surfaces put Suggested above filters without exposing the full unfiltered list", () => {
  const review = reviewSource(), activity = activitySource();
  for (const [source, marker] of [[review, "{suggestion && suggestion.score >= 78 ? ("], [activity, "{matchSuggestion ? ("]]) {
    const card = source.indexOf(marker), filters = source.indexOf("<MatchTypeFilters", card);
    assert.ok(card >= 0 && filters > card);
    assert.match(source.slice(card, filters), />Suggested<\/Text>/);
    assert.match(source.slice(filters), /Choose a type for other entries/);
  }
  assert.match(review, /filteredTargets\.map\(renderTarget\)/);
  assert.match(activity, /filteredMatchOptions\.map\(/);
  const card = activity.indexOf("{matchSuggestion ? (");
  const scroll = activity.lastIndexOf("<ScrollView", card);
  const filters = activity.indexOf("<MatchTypeFilters", card);
  const list = activity.indexOf("filteredMatchOptions.length", filters);
  assert.equal((activity.slice(scroll, list).match(/<ScrollView/g) ?? []).length, 1);
  assert.doesNotMatch(activity.slice(scroll, list), /<\/ScrollView>/);
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
