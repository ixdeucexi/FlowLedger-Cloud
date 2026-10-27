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
  const save = source.slice(source.indexOf("  const saveChange ="), source.indexOf("  const cancelEditing ="));
  assert.match(save, /replaceSimulationChange\(draft.changes, editingId, change\)/);assert.match(save, /makeLocalDraft\(\)/);
  assert.match(source, /if \(editingId\) \{ setMessage\("Update or cancel this change first/);
  assert.match(source, /disabled=\{[^}]*Boolean\(editingId\)/);
  assert.match(source, /const selectType[^]*if \(editingChange\) return;/);
  assert.match(source, /scrollRef.current\?\.scrollTo/);
  for (const handler of ["selectScenario", "newDraft", "resetDraft"]) assert.match(source.slice(source.indexOf(`  const ${handler} =`)), /setEditingId\(null\)/);
  assert.match(source, /if \(!canEditHousehold && selectedId\)/);assert.match(source, /if \(!canEditHousehold \|\| demoMode\)/);
});

import { ModuleKind, transpileModule } from "typescript";

test("actual load/autosave effect ordering never writes A's draft into B or a changed loading policy", async () => {
  const source = readFileSync("app/plan-simulator.tsx", "utf8");
  const start = source.indexOf("  useEffect(() => {\n    let cancelled = false;\n    setLoading(true);");
  const script = transpileModule(source.slice(start, source.indexOf("  const baseline =", start)), { compilerOptions: { module: ModuleKind.CommonJS } }).outputText;
  const makeScope = (key: string, canPersistScenarios = false, keepsLocalDraft = true) => JSON.stringify([key, "household", canPersistScenarios, 6, false, keepsLocalDraft]);
  const a = { name: "User A private", horizonMonths: 6, changes: [changes[0]] };
  const b = { name: "User B private", horizonMonths: 6, changes: [changes[4]] };
  for (const transition of ["user", "persistence policy", "local permission policy"] as const) {
    const oldKey = "draft:user-A:household", key = transition === "user" ? "draft:user-B:household" : oldKey;
    const oldScope = makeScope(oldKey, transition === "local permission policy", transition !== "local permission policy");
    const scope = makeScope(key, transition !== "user", true);
    const writes: Array<{ key: string; value: string }> = [];
    const updates: any = {}; const effects: Array<() => void> = [];
    let resolve!: (value: string) => void;
    const pending = new Promise<string>(done => { resolve = done; });
    const bindings: Record<string, any> = {
      useEffect: (fn: () => void) => effects.push(fn), canPersistScenarios: transition !== "user", defaultHorizon: 6, demoMode: false, draftStorageKey: key, householdId: "household", keepsLocalDraft: true, loading: false, draft: a, loadedDraftScope: oldScope, draftLoadScope: scope, draftLoadScopeRef: { current: scope },
      setLoading: (value: boolean) => { updates.loading = value; }, setLoadedDraftScope: (value: string | null) => { updates.owner = value; }, setEditingId() {}, setEditorVersion() {}, setMessage() {}, setScenarios() {}, setSelectedId() {}, setDraft: (value: any) => { updates.draft = value; },
      loadPlanSimulations: async () => [], decodePlanSimulationChanges: (value: unknown) => value, isPlanSimulationHorizon: (value: number) => value === 6,
      AsyncStorage: { getItem: () => pending, setItem: async (key: string, value: string) => { writes.push({ key, value }); } },
    };
    const render = () => { effects.length = 0;new Function(...Object.keys(bindings), script)(...Object.values(bindings)); };
    render();effects[0]();effects[1]();
    assert.deepEqual(writes, [], `${transition}: same commit still has A draft/loading=false but must not save it`);
    resolve(JSON.stringify(b));await new Promise(done => setImmediate(done));
    assert.equal(updates.owner, scope);assert.deepEqual(updates.draft, b);assert.equal(updates.loading, false);
    Object.assign(bindings, { draft: updates.draft, loadedDraftScope: updates.owner, loading: updates.loading });
    render();effects[1]();
    assert.deepEqual(writes, [{ key, value: JSON.stringify(b) }], `${transition}: only B's loaded draft may be saved`);
  }
});

test("an old scoped load cannot publish a draft or owner after the identity changes before cleanup", async () => {
  const source = readFileSync("app/plan-simulator.tsx", "utf8");
  const start = source.indexOf("  useEffect(() => {\n    let cancelled = false;\n    setLoading(true);");
  const script = transpileModule(source.slice(start, source.indexOf("  const baseline =", start)), { compilerOptions: { module: ModuleKind.CommonJS } }).outputText;
  const owners: unknown[] = [], drafts: any[] = [], effects: Array<() => void> = [];
  let resolve!: (value: string) => void;
  const pending = new Promise<string>(done => { resolve = done; });
  const current = { current: "A" };
  const bindings: Record<string, any> = { useEffect: (fn: () => void) => effects.push(fn), canPersistScenarios: false, defaultHorizon: 6, demoMode: false, draftStorageKey: "A", householdId: "household", keepsLocalDraft: true, loading: true, draft: {}, loadedDraftScope: null, draftLoadScope: "A", draftLoadScopeRef: current, setLoading() {}, setLoadedDraftScope: (owner: unknown) => owners.push(owner), setEditingId() {}, setEditorVersion() {}, setMessage() {}, setScenarios() {}, setSelectedId() {}, setDraft: (value: any) => drafts.push(value), loadPlanSimulations: async () => [], decodePlanSimulationChanges: (value: unknown) => value, isPlanSimulationHorizon: () => true, AsyncStorage: { getItem: () => pending, setItem() { throw new Error("Must not save"); } } };
  new Function(...Object.keys(bindings), script)(...Object.values(bindings));effects[0]();current.current = "B";
  resolve(JSON.stringify({ name: "Private A", horizonMonths: 6, changes }));await new Promise(done => setImmediate(done));
  assert.deepEqual(owners, [null]);assert.equal(drafts.length, 1);assert.equal(drafts[0].name, "Untitled scenario");
});

test("matching malformed or failed loads settle into a recoverable local draft without saving previous-owner data", async () => {
  const source = readFileSync("app/plan-simulator.tsx", "utf8");
  const start = source.indexOf("  useEffect(() => {\n    let cancelled = false;\n    setLoading(true);");
  const script = transpileModule(source.slice(start, source.indexOf("  const baseline =", start)), { compilerOptions: { module: ModuleKind.CommonJS } }).outputText;
  for (const failure of ["malformed JSON", "storage rejection", "saved scenario rejection"]) {
    const effects: Array<() => void> = [], writes: Array<{ key: string; value: string }> = [];
    const updates: any = {};const scope = `B:${failure}`;
    const bindings: Record<string, any> = { useEffect: (fn: () => void) => effects.push(fn), canPersistScenarios: failure === "saved scenario rejection", defaultHorizon: 6, demoMode: false, draftStorageKey: "B", householdId: "household", keepsLocalDraft: true, loading: false, draft: { name: "Private A", horizonMonths: 6, changes }, loadedDraftScope: "A", draftLoadScope: scope, draftLoadScopeRef: { current: scope }, setLoading: (value: boolean) => { updates.loading = value; }, setLoadedDraftScope: (value: string | null) => { updates.owner = value; }, setEditingId() {}, setEditorVersion() {}, setMessage: (value: string) => { updates.error = value; }, setScenarios() {}, setSelectedId() {}, setDraft: (value: any) => { updates.draft = value; }, loadPlanSimulations: async () => { throw new Error("Unavailable saved scenarios"); }, decodePlanSimulationChanges: (value: unknown) => value, isPlanSimulationHorizon: () => true, AsyncStorage: { getItem: async () => { if (failure === "storage rejection") throw new Error("Unavailable device storage");return "{invalid"; }, setItem: async (key: string, value: string) => { writes.push({ key, value }); } } };
    const render = () => { effects.length = 0;new Function(...Object.keys(bindings), script)(...Object.values(bindings)); };
    render();effects[0]();effects[1]();assert.equal(writes.length, 0);
    await new Promise(done => setImmediate(done));
    assert.equal(updates.owner, scope);assert.equal(updates.loading, false);assert.ok(updates.error);assert.equal(updates.draft.name, "Untitled scenario");
    Object.assign(bindings, { draft: { ...updates.draft, name: "Recovered B draft" }, loading: updates.loading, loadedDraftScope: updates.owner });
    render();effects[1]();assert.equal(writes.length, 1);assert.equal(writes[0].key, "B");assert.equal(JSON.parse(writes[0].value).name, "Recovered B draft");assert.doesNotMatch(writes[0].value, /Private A/);
  }
});
