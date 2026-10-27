import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { buildSimulationEditorChange, replaceSimulationChange, simulationEditorFields } from "./planSimulationEditor";
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
];

for (const [index, change] of changes.entries()) test(`${change.type} hydrates every field and updates in place without changing ID, order or count`, () => {
  const fields = simulationEditorFields(change, start);
  assert.deepEqual(buildSimulationEditorChange(fields, change.id, references, start, end), { change });
  const original = JSON.stringify(changes);
  const edited = { ...fields, date: "2026-12-04", newDate: "2026-12-10", name: "Changed name", amount: "333.45", frequency: "weekly", targetId: "incomeId" in change ? "i1" : "billId" in change ? "b1" : "debtId" in change ? "d1" : "" };
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

import { ModuleKind, transpileModule } from "typescript";

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
