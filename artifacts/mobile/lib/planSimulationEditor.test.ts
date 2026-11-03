import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { buildSimulationEditorChange, defaultSimulationResumeDate, replaceSimulationChange, selectSimulationEditorDebt, simulationDebtPaymentLabelAmount, simulationEditorFields, simulationEditorReferences } from "./planSimulationEditor";
import type { PlanSimulationChange, PlanSimulationReferences } from "./planSimulator";

const start = "2026-10-27", end = "2027-04-30";
const references: PlanSimulationReferences = {
  incomes: [{ id: "i1", name: "Pay 1", amount: 100 }, { id: "i2", name: "Pay 2", amount: 200 }],
  bills: [{ id: "b1", name: "Bill 1", amount: 50, frequency: "monthly", isDebt: false }, { id: "b2", name: "Bill 2", amount: 70, frequency: "monthly", isDebt: false }],
  debts: [{ id: "d1", name: "Debt 1", balance: 1000, minimum: 50, apr: 12, dueDay: 5, included: true }, { id: "d2", name: "Debt 2", balance: 2000, minimum: 70, apr: 15, dueDay: 10, included: true }],
  debtMethod: "snowball",
};
const changes: PlanSimulationChange[] = [
  { id: "1", type: "income_add", name: "New pay", amount: 120.25, frequency: "biweekly", startDate: "2026-11-02" },
  { id: "2", type: "income_edit", incomeId: "i2", amount: 250, effectiveDate: "2026-11-03" },
  { id: "3", type: "income_pause", incomeId: "i2", effectiveDate: "2026-11-04" },
  { id: "4", type: "income_once", name: "Refund", amount: 40, date: "2026-11-05" },
  { id: "5", type: "bill_add", name: "New bill", amount: 80, frequency: "quarterly", startDate: "2026-11-06" },
  { id: "6", type: "bill_edit", billId: "b2", amount: 90, effectiveDate: "2026-11-07" },
  { id: "7", type: "bill_pause", billId: "b2", effectiveDate: "2026-11-08" },
  { id: "8", type: "bill_move", billId: "b2", occurrenceDate: "2026-11-09", newDate: "2026-11-15" },
  { id: "9", type: "spending_once", name: "Trip", amount: 150, date: "2026-11-10" },
  { id: "10", type: "savings_once", name: "Buffer", amount: 170, date: "2026-11-11" },
  { id: "11", type: "debt_extra", amount: 190, date: "2026-11-12" },
  { id: "12", type: "debt_payoff", debtId: "d2", date: "2026-11-13" },
  { id: "13", type: "debt_edit", debtId: "d1", amount: 125.50, effectiveDate: "2026-11-14" },
  { id: "14", type: "debt_pause", debtId: "d1", effectiveDate: "2026-11-15", resumeDate: "2027-01-15" },
  { id: "15", type: "debt_add", name: "New car loan", balance: 15000.25, apr: 6.125, amount: 350, frequency: "monthly", startDate: "2026-11-16" },
];

for (const [index, change] of changes.entries()) test(`${change.type} hydrates every field and updates in place without changing ID, order or count`, () => {
  const fields = simulationEditorFields(change, start);
  assert.deepEqual(buildSimulationEditorChange(fields, change.id, references, start, end), { change });
  const original = JSON.stringify(changes);
  const edited = { ...fields, date: "2026-12-04", newDate: "2026-12-10", name: "Changed name", amount: "333.45", balance: "4444.55", apr: "8.125", resumeDate: "2027-02-04", frequency: "weekly", targetId: "incomeId" in change ? "i1" : "billId" in change ? "b1" : "debtId" in change ? "d1" : "" };
  const built = buildSimulationEditorChange(edited, change.id, references, start, end);
  assert.ok(built.change);
  const next = replaceSimulationChange(changes, change.id, built.change)!;
  assert.equal(next.length, changes.length);assert.deepEqual(next.map(row => row.id), changes.map(row => row.id));assert.equal(next[index].type, change.type);
  assert.equal(JSON.stringify(changes), original, "opening/editing/cancelling fields does not mutate the original draft");
  assert.deepEqual(next.filter((_, i) => i !== index), changes.filter((_, i) => i !== index));
  const result = next[index];
  if ("name" in result) assert.equal(result.name, "Changed name");
  if ("amount" in result) assert.equal(result.amount, 333.45);
  if ("frequency" in result) assert.equal(result.frequency, "weekly");
  if ("incomeId" in result) assert.equal(result.incomeId, "i1");
  if ("billId" in result) assert.equal(result.billId, "b1");
  if ("debtId" in result) assert.equal(result.debtId, "d1");
  if (result.type === "bill_move") assert.equal(result.newDate, "2026-12-10");
  if (result.type === "debt_pause") assert.equal(result.resumeDate, "2027-02-04");
  if (result.type === "debt_add") { assert.equal(result.balance, 4444.55);assert.equal(result.apr, 8.125); }
});

test("temporary debt pauses default to a clamped calendar month and allow resume beyond cash horizon", () => {
  assert.equal(defaultSimulationResumeDate("2026-10-31"), "2026-11-30");
  assert.equal(defaultSimulationResumeDate("2027-01-31"), "2027-02-28");
  assert.equal(defaultSimulationResumeDate("2028-01-31"), "2028-02-29");
  assert.equal(defaultSimulationResumeDate("2026-12-31"), "2027-01-31");
  const fields = simulationEditorFields(changes[13], start);
  assert.equal(fields.resumeDate, "2027-01-15");
  for (const resumeDate of [fields.date, "2026-11-01", "2027-02-30", "bad-date", ""]) assert.match(buildSimulationEditorChange({ ...fields, resumeDate }, "14", references, start, end).error!, /resume date after/);
  const beyond = buildSimulationEditorChange({ ...fields, date: end, resumeDate: "2028-05-01" }, "14", references, start, end);
  assert.deepEqual(beyond.change, { id: "14", type: "debt_pause", debtId: "d1", effectiveDate: end, resumeDate: "2028-05-01" });
});

test("new untouched debt selections start when the debt exists and preserve a matching default resume", () => {
  const startDate = "2026-10-31", endDate = "2027-01-31";
  const debt = { ...references.debts[0], id: "family", startDate: "2026-11-01", occurrences: [
    { date: "2026-10-31", configuredAmount: 90, settledAmount: 0, remainingAmount: 90 },
    { date: "2026-11-01", configuredAmount: 120, settledAmount: 0, remainingAmount: 120 },
  ] };
  const options = { startDate, endDate, dateCustomized: false, editingExisting: false };
  const pause = { ...simulationEditorFields(null, startDate), type: "debt_pause" as const };
  const original = JSON.stringify(pause);
  const selected = selectSimulationEditorDebt(pause, debt, options);
  assert.equal(selected.targetId, "family");assert.equal(selected.date, "2026-11-01");assert.equal(selected.resumeDate, "2026-12-01");
  assert.equal(JSON.stringify(pause), original);
  const edit = selectSimulationEditorDebt({ ...pause, type: "debt_edit" }, debt, options);
  assert.equal(edit.date, "2026-11-01");assert.equal(edit.amount, "120", "payment defaults use the resolved effective date");
  assert.equal(selectSimulationEditorDebt(selected, { ...debt, id: "later", startDate: "2026-11-15" }, options).date, "2026-11-15", "automatic defaults can follow another explicit debt selection");
  assert.equal(selectSimulationEditorDebt(selected, { ...debt, id: "active", startDate: "2026-10-01" }, options).date, startDate);
});

test("debt target defaults never replace customized dates, existing edits, custom resume dates or exceed the horizon", () => {
  const startDate = "2026-10-31", endDate = "2027-01-31";
  const debt = { ...references.debts[0], startDate: "2026-11-01" };
  const fields = { ...simulationEditorFields(null, startDate), type: "debt_pause" as const };
  const options = { startDate, endDate, dateCustomized: false, editingExisting: false };
  assert.equal(selectSimulationEditorDebt(fields, debt, { ...options, dateCustomized: true }).date, startDate, "an explicitly chosen date is preserved even if it equals the default");
  const customized = { ...fields, date: "2026-11-20", resumeDate: "2027-01-15" };
  const selected = selectSimulationEditorDebt(customized, debt, { ...options, dateCustomized: true });
  assert.equal(selected.date, customized.date);assert.equal(selected.resumeDate, customized.resumeDate);
  const existing = selectSimulationEditorDebt({ ...fields, type: "debt_edit", amount: "77" }, debt, { ...options, editingExisting: true });
  assert.equal(existing.date, startDate);assert.equal(existing.resumeDate, fields.resumeDate);assert.equal(existing.amount, "77");
  assert.equal(selectSimulationEditorDebt({ ...fields, resumeDate: "2026-12-15" }, debt, options).resumeDate, "2026-12-15");
  const outside = selectSimulationEditorDebt(fields, { ...debt, startDate: "2027-02-01" }, options);
  assert.equal(outside.date, startDate);assert.equal(outside.resumeDate, fields.resumeDate);
  assert.equal(selectSimulationEditorDebt({ ...fields, type: "debt_payoff" }, debt, options).date, startDate, "existing payoff date defaults are outside this change");
});

test("new debt fields validate money, APR and frequency without blocking a positive low payment", () => {
  const fields = simulationEditorFields(changes[14], start);
  for (const balance of ["0", "-10", "1.001", "1e3", "Infinity", "1000000001", ""]) assert.match(buildSimulationEditorChange({ ...fields, balance }, "15", references, start, end).error!, /debt balance/);
  for (const apr of ["-1", "1000.0001", "1.12345", "Infinity", "1e2", ""]) assert.match(buildSimulationEditorChange({ ...fields, apr }, "15", references, start, end).error!, /APR/);
  for (const apr of ["0", "1000", "6.1234"]) assert.ok(buildSimulationEditorChange({ ...fields, apr }, "15", references, start, end).change);
  assert.match(buildSimulationEditorChange({ ...fields, frequency: "daily" }, "15", references, start, end).error!, /frequency/);
  assert.ok(buildSimulationEditorChange({ ...fields, amount: "0.01" }, "15", references, start, end).change, "a valid payment below interest remains a scenario choice");
  const edit = simulationEditorFields(changes[12], start);
  assert.match(buildSimulationEditorChange({ ...edit, amount: "0" }, "13", references, start, end).error!, /Pause a debt/);
  assert.ok(buildSimulationEditorChange({ ...edit, amount: "0.01" }, "13", references, start, end).change);
});

test("type switching resets new debt fields and stale hidden values never enter another change", () => {
  const reset = { ...simulationEditorFields(null, start), type: "debt_pause" as const };
  assert.equal(reset.balance, "");assert.equal(reset.apr, "");assert.equal(reset.targetId, "");assert.equal(reset.resumeDate, "2026-11-27");
  const stale = { ...simulationEditorFields(changes[14], start), type: "debt_pause" as const, targetId: "d1" };
  assert.deepEqual(buildSimulationEditorChange(stale, "pause", references, start, end).change, { id: "pause", type: "debt_pause", debtId: "d1", effectiveDate: "2026-11-16", resumeDate: "2026-12-16" });
});

test("scenario-created debts are editor-only selectable targets with stable IDs and immutable baseline refs", () => {
  const original = JSON.stringify(references);
  const editor = simulationEditorReferences(references, changes);
  assert.equal(JSON.stringify(references), original);
  assert.equal(references.debts.length, 2);assert.equal(editor.debts.length, 3);
  const added = editor.debts.find(debt => debt.id === "simulation-debt:15")!;
  assert.equal(added.name, "New car loan");assert.equal(added.minimum, 350);assert.equal(added.apr, 6.125);
  const pause = { ...simulationEditorFields(null, start), type: "debt_pause" as const, targetId: added.id, date: "2026-11-16", resumeDate: "2026-12-16" };
  assert.ok(buildSimulationEditorChange(pause, "pause", editor, start, end).change);
  assert.match(buildSimulationEditorChange({ ...pause, date: "2026-11-15" }, "pause", editor, start, end).error!, /first payment date/);
  assert.match(buildSimulationEditorChange(pause, "pause", simulationEditorReferences(references, []), start, end).error!, /eligible open debt/);
});

test("payment editor uses exact open occurrence total without mutating settlement snapshots", () => {
  const debt = { ...references.debts[0], occurrences: [
    { date: "2026-12-05", configuredAmount: 175, settledAmount: 25, remainingAmount: 150 },
    { date: "2026-11-05", configuredAmount: 100, settledAmount: 100, remainingAmount: 0, immutable: true },
  ] };
  const before = JSON.stringify(debt);
  assert.equal(simulationDebtPaymentLabelAmount(debt, start), 175);
  assert.equal(simulationDebtPaymentLabelAmount(debt, "2027-01-01"), 50);
  assert.equal(JSON.stringify(debt), before);
  assert.equal(simulationDebtPaymentLabelAmount({ ...references.debts[0], occurrences: [{ date: "2026-11-05", configuredAmount: 100, settledAmount: 0, remainingAmount: 200 }] }, start), 100, "automatic extra-payment funding is separate from the regular payment field");
  assert.equal(simulationDebtPaymentLabelAmount({ ...references.debts[0], occurrences: [{ date: "2026-10-31", configuredAmount: 0, settledAmount: 0, remainingAmount: 200, regular: false }, { date: "2026-11-05", configuredAmount: 100, settledAmount: 0, remainingAmount: 100, regular: true }] }, start), 100, "a rollover-only date must not become the current regular payment");
  assert.equal(simulationDebtPaymentLabelAmount({ ...references.debts[0], occurrences: [{ date: "2026-10-31", configuredAmount: 0, settledAmount: 0, remainingAmount: 100, regular: true }] }, start), 0, "an explicit zero regular plan remains distinguishable from a rollover-only date");
});

test("a missing or no-longer-eligible saved target stays selected and requires explicit replacement", () => {
  for (const change of changes.filter(change => "incomeId" in change || "billId" in change || "debtId" in change)) {
    const fields = { ...simulationEditorFields(change, start), targetId: "gone" };
    assert.equal(simulationEditorFields({ ...change, ...("incomeId" in change ? { incomeId: "gone" } : "billId" in change ? { billId: "gone" } : { debtId: "gone" }) } as PlanSimulationChange, start).targetId, "gone");
    assert.match(buildSimulationEditorChange(fields, change.id, references, start, end).error!, /Choose/);
    assert.match(buildSimulationEditorChange({ ...fields, targetId: "" }, change.id, references, start, end).error!, /Choose/);
  }
  const payoff = simulationEditorFields(changes[11], start);
  for (const altered of [{ ...references.debts[1], balance: 0 }, { ...references.debts[1], endDate: "2026-10-01" }]) assert.match(buildSimulationEditorChange(payoff, "12", { ...references, debts: [references.debts[0], altered] }, start, end).error!, /eligible open debt/);
  assert.equal(simulationEditorFields(null, start).targetId, "", "new changes never silently choose the first live target");
});

test("editor rejects malformed money, unsupported frequency, impossible/out-of-horizon dates and both moved dates", () => {
  const fields = simulationEditorFields(changes[0], start);
  for (const amount of ["0", "-2", "2.345", "Infinity", "1e3", "1000000001", ""]) assert.ok(buildSimulationEditorChange({ ...fields, amount }, "1", references, start, end).error);
  for (const date of ["2026-02-30", "2026-10-26", "2027-05-01", "garbage"]) assert.ok(buildSimulationEditorChange({ ...fields, date }, "1", references, start, end).error);
  assert.ok(buildSimulationEditorChange({ ...fields, frequency: "quarterly" }, "1", references, start, end).error);
  const move = simulationEditorFields(changes[7], start);
  assert.ok(buildSimulationEditorChange({ ...move, newDate: "2027-05-01" }, "8", references, start, end).error);
  assert.ok(buildSimulationEditorChange({ ...move, date: "2026-10-26" }, "8", references, start, end).error);
  assert.ok(buildSimulationEditorChange({ ...fields, date: start }, "1", references, start, end).change);
  assert.ok(buildSimulationEditorChange({ ...fields, date: end }, "1", references, start, end).change);
});

test("editing cannot append a removed change, switch its type, change identity or bypass strict decoding", () => {
  assert.equal(replaceSimulationChange(changes, "gone", changes[0]), null);
  assert.equal(replaceSimulationChange(changes, "1", { ...changes[0], id: "other" }), null);
  assert.equal(replaceSimulationChange(changes, "1", { id: "1", type: "debt_extra", amount: 1, date: start }), null);
  assert.equal(replaceSimulationChange(changes, "1", { ...changes[0], unexpected: true } as unknown as PlanSimulationChange), null);
});

test("workspace retains local/viewer guards and prevents saving an uncommitted edit", () => {
  const source = readFileSync("app/plan-simulator.tsx", "utf8");
  const save = source.slice(source.indexOf("  const saveChange ="), source.indexOf("  const resetDraft ="));
  assert.match(save, /replaceSimulationChange\(draft.changes, editingId, change\)/);assert.match(save, /makeLocalDraft\(\)/);
  assert.match(source, /if \(editorOpen \|\| saving \|\| mutationRef.current\) \{ setMessage\("Update or cancel this change first/);
  assert.match(source, /disabled=\{[^}]*editorOpen/);
  assert.match(source, /const selectType[^]*if \(editingChange\) return;/);
  assert.match(source, /createSimulatorEditorHistory\(window, closeEditor\)/);
  assert.match(source, /onRequestClose=\{closeEditor\} onShow=\{focusEditor\}/);
  for (const handler of ["applySelection", "resetDraft"]) assert.match(source.slice(source.indexOf(`  const ${handler} =`)), /setEditingId\(null\)/);
  assert.match(source, /if \(!canEditHousehold && selectedScenario\)/);assert.match(source, /!canPersistScenarios \|\| !canEditHousehold \|\| demoMode/);
});

import { ModuleKind, ScriptTarget, transpileModule } from "typescript";

test("the library workspace retains matching loaded-owner autosave guards and recoverable load failures", () => {
  const source = readFileSync("app/plan-simulator.tsx", "utf8");
  assert.match(source, /!deviceReady \|\| loading \|\| loadedDraftScope !== draftLoadScope/);
  assert.match(source, /loadScenarioDeviceState\(AsyncStorage, deviceKeys, isCurrent/);
  assert.match(source, /setDeviceReady\(false\)/);assert.match(source, /Reload saved scenarios/);
  assert.match(source, /setLoadedDraftScope\(draftLoadScope\)/);
});

test("closing the focused editor discards only pending fields and returns focus without resetting the scenario", () => {
  const source = readFileSync("app/plan-simulator.tsx", "utf8");
  const start = source.indexOf("  const closeEditor =");
  const script = transpileModule(source.slice(start, source.indexOf("  const openEditor =", start)), { compilerOptions: { module: ModuleKind.CommonJS } }).outputText;
  const state: any = { open: true, id: "1", draft: changes };
  let focused = 0;
  const bindings = { useCallback: (fn: any) => fn, setEditorOpen: (value: boolean) => { state.open = value; }, setEditingId: (value: string | null) => { state.id = value; }, Platform: { OS: "web" }, returnFocusRef: { current: { focus: () => { focused++; } } }, requestAnimationFrame: (fn: () => void) => fn() };
  new Function(...Object.keys(bindings), `${script};closeEditor();`)(...Object.values(bindings));
  assert.equal(state.open, false);assert.equal(state.id, null);assert.equal(state.draft, changes);assert.equal(focused, 1);
  assert.equal((source.match(/<ChangeComposer\b/g) ?? []).length, 1, "one editor instance is shared across breakpoints");
  assert.match(source, /\{editorOpen \? <Modal/);assert.match(source, /keyboardShouldPersistTaps="handled"/);
});

test("the active editor owns Escape and removes keyboard and history listeners on close", () => {
  const source = readFileSync("app/plan-simulator.tsx", "utf8");
  const start = source.indexOf("  useOverlayActivity(editorOpen);");
  const script = transpileModule(source.slice(start, source.indexOf("  const selectedScenario =", start)), { compilerOptions: { module: ModuleKind.CommonJS } }).outputText;
  const effects: Array<() => (() => void) | void> = [];
  let keydown: ((event: any) => void) | null = null, closed = 0, disposed = 0, prevented = 0;
  const bindings = { useOverlayActivity() {}, useEffect: (fn: () => (() => void) | void) => effects.push(fn), editorOpen: true, Platform: { OS: "web" }, closeEditor: () => { closed++; }, createSimulatorEditorHistory: () => ({ dispose: () => { disposed++; } }), window: { addEventListener: (_type: string, fn: (event: any) => void, capture: boolean) => { assert.equal(capture, true);keydown = fn; }, removeEventListener: (_type: string, fn: (event: any) => void, capture: boolean) => { assert.equal(keydown, fn);assert.equal(capture, true);keydown = null; } } };
  new Function(...Object.keys(bindings), script)(...Object.values(bindings));const cleanup = effects[0]();
  const press = (key: string) => (keydown as unknown as (event: any) => void)({ key, preventDefault: () => { prevented++; }, stopPropagation() {} });
  press("Enter");assert.equal(closed, 0);press("Escape");assert.equal(closed, 1);assert.equal(prevented, 1);
  cleanup?.();assert.equal(keydown, null);assert.equal(disposed, 1);
});

test("simulator debt references snapshot dated settlements and source commitments without treating rollover targets as sources", () => {
  const source = readFileSync("app/plan-simulator.tsx", "utf8");
  const start = source.indexOf("  const buildReferences =");
  const script = transpileModule(source.slice(start, source.indexOf("  const references =", start)), { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } }).outputText;
  const bills = ["d1", "d2", "d3", "d4"].map(id => ({ id, name: id, amount: 100, balance: 1000, interest_rate: 12, is_debt: true, snowball_minimum_boost: 20, due_day: 5, frequency: "monthly" }));
  const event = (id: string, sourceId: string, target: string, amount: number, kind: "required" | "rollover" | "extra", date: string) => ({ id, sourceId, debtTargetBillId: target, sourceType: "extra_payment", debtPlanSource: kind === "extra" ? "saved_extra" : "canonical", debtPlanAllocationKind: kind, kind: "debt_payment", status: "scheduled", amount, date, name: id });
  const baseline = { startDate: "2026-10-27", endDate: "2026-11-30", openingBalance: 1000, days: [{ date: "2026-11-05", events: [event("required", "d1", "d2", -40, "required", "2026-11-05"), event("rollover", "d1", "d3", -20, "rollover", "2026-11-05"), event("saved", "saved-extra", "d1", -9, "extra", "2026-11-05")] }, { date: "2026-11-10", events: [event("pending", "d2", "d2", -80, "required", "2026-11-10")] }, { date: "2026-11-20", events: [event("rescheduled-required", "d1", "d1", -100, "required", "2026-11-20")] }, { date: "2026-11-25", events: [event("retained-planned", "d4", "d4", -100, "required", "2026-11-25")] }, { date: "2026-11-30", events: [event("global-pool", "d1", "d1", -200, "rollover", "2026-11-30")] }] };
  const before = JSON.stringify({ bills, baseline });
  const months: string[] = [];
  const bindings = {
    useCallback: (fn: unknown) => fn, bills, incomes: [], currentMonth: 9, currentYear: 2026,
    getBillEffectiveMonthlyTotal: () => 100, getBillMonthlyTotal: () => 120,
    getBillOccurrenceAmount: (bill: { id: string }) => bill.id === "d4" ? 200 : 120, getBillOccurrencesInMonth: (bill: { id: string }, month: number) => bill.id === "d1" && month === 10 ? [5] : bill.id === "d2" && month === 10 ? [10] : bill.id === "d3" && month === 9 ? [5] : [],
    getDebtMonthSettlements: (month: number, year: number) => {
      months.push(`${year}-${month}`);
      return month === 10 ? new Map([
        ["d1", { occurrences: [{ occurrenceDate: "2026-11-05", configuredObligation: 100, paidAmount: 30, remainingRequired: 70, status: "partial" }] }],
        ["d2", { plannedDebtAmount: 100, occurrences: [{ occurrenceDate: "2026-11-10", configuredObligation: 100, paidAmount: 0, remainingRequired: 100, status: "scheduled" }] }],
        ["d4", { occurrences: [{ occurrenceDate: "2026-11-25", configuredObligation: 100, paidAmount: 100, remainingRequired: 0, status: "settled" }] }],
      ]) : new Map([["d3", { occurrences: [{ occurrenceDate: "2026-10-05", configuredObligation: 100, paidAmount: 100, remainingRequired: 0, status: "settled" }] }]]);
    },
    getDebtSourceCommitment: (billId: string) => billId === "d2" ? { state: "pending", amount: 80 } : undefined,
    getExtraPayment: () => undefined,
    livePayoffPreview: null, settings: { paymentMethod: "snowball" },
  };
  const build = new Function(...Object.keys(bindings), `${script};return buildReferences;`)(...Object.values(bindings));
  const references = build(baseline);
  assert.deepEqual(months, ["2026-9", "2026-10"], "each month is read once, not once per debt");
  assert.deepEqual(references.debts[0].occurrences, [
    { date: "2026-11-05", configuredAmount: 120, requiredAmount: 100, settledAmount: 30, remainingAmount: 60, committedAmount: 0, commitmentState: undefined, immutable: false, regular: true },
    { date: "2026-11-20", configuredAmount: 120, requiredAmount: 100, settledAmount: 0, remainingAmount: 100, committedAmount: 0, commitmentState: undefined, immutable: false, regular: true },
    { date: "2026-11-30", configuredAmount: 0, requiredAmount: 100, settledAmount: 0, remainingAmount: 200, committedAmount: 0, commitmentState: undefined, immutable: false, regular: false },
  ]);
  assert.deepEqual(references.debts[1].occurrences, [{ date: "2026-11-10", configuredAmount: 120, requiredAmount: 100, settledAmount: 0, remainingAmount: 80, committedAmount: 80, commitmentState: "pending", immutable: true, regular: true, exactPlan: true }], "an explicit saved override stays exact even when it equals the base regular amount");
  assert.deepEqual(references.debts[2].occurrences, [{ date: "2026-10-05", configuredAmount: 120, requiredAmount: 100, settledAmount: 100, remainingAmount: 0, committedAmount: 0, commitmentState: undefined, immutable: true, regular: true }]);
  assert.deepEqual(references.debts[3].occurrences, [{ date: "2026-11-25", configuredAmount: 200, requiredAmount: 100, settledAmount: 100, remainingAmount: 100, committedAmount: 0, commitmentState: undefined, immutable: false, regular: true }], "a still-planned retained payment stays editable after its required minimum was paid");
  assert.equal(references.debts[3].occurrences[0].requiredAmount, 100, "the $200 exact plan does not become the historical lender requirement");
  assert.equal(references.debts[1].occurrences[0].settledAmount, 0, "a pending commitment is protected cash, not an invented reviewed payment");
  assert.equal(JSON.stringify({ bills, baseline }), before, "reference collection cannot edit real records or canonical events");
});

test("carried debt references retain actual origin settlements without inventing paid amounts from payoff caps", () => {
  const source = readFileSync("app/plan-simulator.tsx", "utf8");
  const start = source.indexOf("  const buildReferences =");
  const script = transpileModule(source.slice(start, source.indexOf("  const references =", start)), { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } }).outputText;
  const bills = ["unpaid", "partial", "protected", "retained", "event-locked"].map(id => ({ id, name: id, amount: 100, balance: 70, interest_rate: 0, is_debt: true, due_day: 15, frequency: "monthly" }));
  const baseline = { startDate: "2026-10-31", endDate: "2026-11-30", days: [{ date: "2026-10-31", events: bills.map(bill => ({ id: `debt-plan:2026-10-15:${bill.id}:${bill.id}:required:0`, sourceId: bill.id, date: "2026-10-31", amount: bill.id === "retained" ? -100 : -70, sourceType: "extra_payment", debtPlanSource: "canonical", debtPlanAllocationKind: "required", status: bill.id === "event-locked" ? "pending" : "scheduled" })) }] };
  const original = JSON.stringify({ bills, baseline });
  const bindings = {
    useCallback: (fn: unknown) => fn, bills, incomes: [], currentMonth: 9, currentYear: 2026,
    getBillEffectiveMonthlyTotal: () => 100, getBillMonthlyTotal: () => 100, getBillOccurrenceAmount: (bill: { id: string }) => bill.id === "retained" ? 200 : 100, getBillOccurrencesInMonth: () => [15],
    getDebtMonthSettlements: (month: number) => new Map(bills.map(bill => [bill.id, { occurrences: [{ occurrenceDate: `2026-${String(month + 1).padStart(2, "0")}-15`, configuredObligation: 100, paidAmount: month === 9 && bill.id === "partial" ? 30 : month === 9 && bill.id === "retained" ? 100 : 0, remainingRequired: month === 9 && bill.id === "partial" ? 70 : month === 9 && bill.id === "retained" ? 0 : 100, status: month === 9 && bill.id === "partial" ? "partial" : month === 9 && bill.id === "retained" ? "settled" : "scheduled" }] }])),
    getDebtSourceCommitment: (id: string, date: string) => id === "protected" && date === "2026-10-15" ? { state: "pending", amount: 70 } : undefined,
    getExtraPayment: () => undefined,
    livePayoffPreview: null, settings: { paymentMethod: "snowball" },
  };
  const build = new Function(...Object.keys(bindings), `${script};return buildReferences;`)(...Object.values(bindings));
  const refs = build(baseline);
  const anchor = (index: number) => refs.debts[index].occurrences.find((row: { date: string }) => row.date === "2026-10-31");
  assert.deepEqual(anchor(0), { date: "2026-10-31", configuredAmount: 0, requiredAmount: 100, settledAmount: 0, remainingAmount: 70, committedAmount: 0, commitmentState: undefined, immutable: false, regular: false, carried: true, carriedOccurrences: [{ date: "2026-10-15", configuredAmount: 100, settledAmount: 0 }] }, "an unpaid capped $70 source is not evidence that $30 was paid");
  const unpaidOrigin = refs.debts[0].occurrences.find((row: { date: string }) => row.date === "2026-10-15");
  assert.equal(unpaidOrigin.requiredAmount, 100, "a $70 payoff cap cannot lower the original $100 lender requirement");
  assert.equal(unpaidOrigin.settledAmount, 0);
  assert.deepEqual(anchor(1).carriedOccurrences, [{ date: "2026-10-15", configuredAmount: 100, settledAmount: 30 }], "the real $30 payment remains associated with the original occurrence");
  assert.equal(anchor(1).settledAmount, 0, "ordinary current-date settlement is separate from carried origin payments");
  assert.equal(anchor(2).immutable, true, "an origin-dated pending commitment protects the carried cash group");
  assert.deepEqual(anchor(2).carriedOccurrences, [], "pending origins cannot become an editable regular plan");
  const protectedOrigin = refs.debts[2].occurrences.find((row: { date: string }) => row.date === "2026-10-15");
  assert.equal(protectedOrigin.requiredAmount, 100);
  assert.equal(protectedOrigin.committedAmount, 70);
  assert.equal(protectedOrigin.commitmentState, "pending");
  assert.equal(protectedOrigin.settledAmount, 0, "the protected origin must not claim the bank commitment is already reviewed");
  assert.equal(refs.debts[1].occurrences.find((row: { date: string }) => row.date === "2026-10-15").settledAmount, 30);
  assert.equal(refs.debts[3].occurrences.find((row: { date: string }) => row.date === "2026-10-15").immutable, false, "a retained regular plan stays editable when its remaining cash was moved to the anchor date");
  assert.deepEqual(anchor(3).carriedOccurrences, [{ date: "2026-10-15", configuredAmount: 200, settledAmount: 100 }]);
  assert.equal(refs.debts[4].occurrences.find((row: { date: string }) => row.date === "2026-10-15").immutable, true, "the canonical pending status protects the original occurrence even when a commitment lookup is unavailable");
  assert.equal(anchor(4).immutable, true);assert.deepEqual(anchor(4).carriedOccurrences, []);
  assert.equal(JSON.stringify({ bills, baseline }), original);
});

test("weekly carry retains zero-allocated nominal cycles and separates a real same-day regular payment", () => {
  const source = readFileSync("app/plan-simulator.tsx", "utf8");
  const start = source.indexOf("  const buildReferences =");
  const script = transpileModule(source.slice(start, source.indexOf("  const references =", start)), { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } }).outputText;
  const bill = { id: "weekly", name: "Weekly", amount: 100, balance: 350, interest_rate: 0, is_debt: true, day_of_week: 5, frequency: "weekly" };
  let includePartialPayments = false;
  const bindings = {
    useCallback: (fn: unknown) => fn, bills: [bill], incomes: [], currentMonth: 9, currentYear: 2026,
    getBillEffectiveMonthlyTotal: () => 500, getBillMonthlyTotal: () => 500, getBillOccurrenceAmount: () => 100,
    getBillOccurrencesInMonth: (_bill: unknown, month: number) => month === 9 ? [2, 9, 16, 23, 30] : [6, 13, 20, 27],
    getDebtMonthSettlements: (month: number) => month === 9 && includePartialPayments ? new Map([[bill.id, { occurrences: [{ occurrenceDate: "2026-10-02", configuredObligation: 100, paidAmount: 80, remainingRequired: 20, status: "partial" }, { occurrenceDate: "2026-10-09", configuredObligation: 100, paidAmount: 30, remainingRequired: 70, status: "partial" }] }]]) : new Map(), getDebtSourceCommitment: () => undefined,
    getExtraPayment: () => undefined,
    livePayoffPreview: null, settings: { paymentMethod: "snowball" },
  };
  const build = new Function(...Object.keys(bindings), `${script};return buildReferences;`)(...Object.values(bindings));
  const baseline = (day: number) => ({ startDate: `2026-10-${day}`, endDate: "2026-11-30", days: [{ date: `2026-10-${day}`, events: [2, 9, 16, 23].map((origin, index) => ({ id: `debt-plan:2026-10-${String(origin).padStart(2, "0")}:weekly:weekly:required:${index}`, sourceId: bill.id, date: `2026-10-${day}`, amount: index === 3 ? -50 : -100, sourceType: "extra_payment", debtPlanSource: "canonical", debtPlanAllocationKind: "required", status: "scheduled" })) }] });
  const debt = build(baseline(31)).debts[0];
  const carry = debt.occurrences.find((row: { date: string }) => row.date === "2026-10-31");
  assert.equal(carry.regular, false);assert.equal(carry.configuredAmount, 0);assert.equal(carry.remainingAmount, 350);
  assert.deepEqual(carry.carriedOccurrences.map((row: { date: string; configuredAmount: number; settledAmount: number }) => [row.date, row.configuredAmount, row.settledAmount]), [2, 9, 16, 23, 30].map(day => [`2026-10-${String(day).padStart(2, "0")}`, 100, 0]), "the fifth nominal payment survives even when its original allocation was zero");
  assert.equal(debt.occurrences.filter((row: { date: string; regular: boolean }) => row.date.startsWith("2026-10") && row.regular).length, 5);
  assert.equal(simulationDebtPaymentLabelAmount(debt, "2026-10-31"), 100, "the payment field never displays an aggregate $500 carried obligation");
  const mixed = build(baseline(30)).debts[0];
  const mixedDay = mixed.occurrences.find((row: { date: string }) => row.date === "2026-10-30");
  assert.equal(mixedDay.regular, true);assert.equal(mixedDay.carried, true);assert.equal(mixedDay.configuredAmount, 100);
  assert.deepEqual(mixedDay.carriedOccurrences.map((row: { date: string }) => row.date), [2, 9, 16, 23].map(day => `2026-10-${String(day).padStart(2, "0")}`), "the real same-day regular payment is not folded into reserved overdue carry");
  assert.equal(simulationDebtPaymentLabelAmount(mixed, "2026-10-30"), 100);
  includePartialPayments = true;
  const partiallyPaid = build(baseline(31)).debts[0].occurrences.find((row: { date: string }) => row.date === "2026-10-31");
  assert.deepEqual(partiallyPaid.carriedOccurrences.map((row: { date: string; settledAmount: number }) => [row.date, row.settledAmount]), [2, 9, 16, 23, 30].map((day, index) => [`2026-10-${String(day).padStart(2, "0")}`, index === 0 ? 80 : index === 1 ? 30 : 0]), "each payment stays on its own occurrence instead of becoming a pooled settlement credit");
});

test("saved debt payment references preserve original dates across the full payoff horizon without extra settlement reads", () => {
  const source = readFileSync("app/plan-simulator.tsx", "utf8");
  const start = source.indexOf("  const buildReferences =");
  const script = transpileModule(source.slice(start, source.indexOf("  const references =", start)), { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } }).outputText;
  const saved = new Map<string, { amount: number; payment_date?: string }>([
    ["2026-10", { amount: 125, payment_date: "2026-10-10" }],
    ["2026-11", { amount: 200 }],
    ["2027-01", { amount: 100, payment_date: "2027-01-20" }],
    ["2027-02", { amount: 0 }], ["2027-03", { amount: -1 }], ["2027-04", { amount: Infinity }], ["2027-05", { amount: NaN }],
    ["2056-09", { amount: 300, payment_date: "2056-09-19" }],
    ["2056-10", { amount: 400, payment_date: "2056-10-20" }],
  ]);
  const calls: string[] = [], settlementCalls: string[] = [];
  const before = JSON.stringify([...saved]);
  const bindings = {
    useCallback: (fn: unknown) => fn, bills: [], incomes: [], currentMonth: 9, currentYear: 2026,
    getBillEffectiveMonthlyTotal: () => 0, getBillMonthlyTotal: () => 0, getBillOccurrenceAmount: () => 0, getBillOccurrencesInMonth: () => [],
    getDebtMonthSettlements: (month: number, year: number) => { settlementCalls.push(`${year}-${month}`);return new Map(); }, getDebtSourceCommitment: () => undefined,
    getExtraPayment: (month: number, year: number) => { const prefix = `${year}-${String(month + 1).padStart(2, "0")}`;calls.push(prefix);return saved.get(prefix); },
    livePayoffPreview: null, settings: { paymentMethod: "snowball" },
  };
  const build = new Function(...Object.keys(bindings), `${script};return buildReferences;`)(...Object.values(bindings));
  const result = build({ startDate: "2026-10-31", endDate: "2026-11-30", days: [] });
  assert.deepEqual(result.payoffSavedPaymentsByMonth, {
    "2026-10": { amount: 125, date: "2026-10-10" },
    "2026-11": { amount: 200, date: "2026-11-01" },
    "2027-01": { amount: 100, date: "2027-01-20" },
    "2056-09": { amount: 300, date: "2056-09-19" },
  }, "historical current-month principal and future dated plans retain their actual original dates");
  assert.equal(calls.length, 360);assert.equal(calls[0], "2026-10");assert.equal(calls.at(-1), "2056-09");
  assert.deepEqual(settlementCalls, ["2026-9", "2026-10"], "the payoff extension does not request distant debt settlements");
  assert.equal(JSON.stringify([...saved]), before, "snapshotting cannot mutate saved payment plans");
  assert.match(source.slice(source.indexOf("    payoffSavedPaymentsByMonth,"), source.indexOf("  const references =")), /getExtraPayment/);
});
