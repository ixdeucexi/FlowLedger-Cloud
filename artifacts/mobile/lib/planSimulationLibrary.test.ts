import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { ModuleKind, transpileModule } from "typescript";
import { accountDeletionStorageKeyShouldBeRemoved } from "./accountDeletionPolicy";
import { planSimulationStoragePrefix } from "./planSimulator";
import { decodeScenarioDraft, decodeScenarioLibrary, decodeScenarioWorking, deleteDeviceScenario, emptyScenarioLibrary, loadScenarioDeviceState, persistScenarioLibrary, persistScenarioWorking, putDeviceScenario, scenarioDeviceKeys, scenarioDraftFingerprint, DEVICE_SCENARIO_LIMIT, type ScenarioDraft } from "./planSimulationLibrary";

function simulationAccessBindings() {
  const owner = { key: "allowed", epoch: 0 };
  return { mountedRef: { current: true }, scenarioAccessOwner: owner, scenarioAccessRef: { current: owner }, canSaveDevice: true, user: { id: "actor" } };
}

const now = "2026-10-27T20:00:00.000Z";
const draft: ScenarioDraft = { name: "Option A", horizonMonths: 3, changes: [{ id: "expense-a", type: "spending_once", name: "Trip", amount: 100, date: "2026-11-01" }] };
function storage() { const values = new Map<string, string>();const writes: Array<{ key: string; value: string }> = [];return { values, writes, async getItem(key: string) { return values.get(key) ?? null; }, async setItem(key: string, value: string) { writes.push({ key, value });values.set(key, value); } }; }
function saved(name = "Option A", id = "device-a") { return putDeviceScenario(emptyScenarioLibrary(), { ...draft, name }, now, id); }

test("named and working keys isolate users, households and demos; named options survive old signout cleanup but account deletion removes them", () => {
  const real = scenarioDeviceKeys("A", "home");
  const demo = scenarioDeviceKeys("A", "home", true);
  for (const other of [scenarioDeviceKeys("B", "home"), scenarioDeviceKeys("A", "other"), demo]) { assert.notEqual(real.library, other.library);assert.notEqual(real.working, other.working); }
  assert.ok(real.working.startsWith(planSimulationStoragePrefix("A")));assert.ok(!real.library.startsWith(planSimulationStoragePrefix("A")));assert.equal(demo.legacy, null);
  for (const key of [real.library, demo.library, real.working]) assert.equal(accountDeletionStorageKeyShouldBeRemoved(key, "A"), true);
});

test("Save as new, update/rename, duplicate and delete keep stored definitions separate from working edits", () => {
  const a = saved();const frozen = JSON.stringify(a.library);
  const edited = { ...draft, name: "Option A renamed", changes: [{ ...draft.changes[0], amount: 200 }] } as ScenarioDraft;
  assert.equal(JSON.stringify(a.library), frozen);
  const update = putDeviceScenario(a.library, edited, "2026-10-28T00:00:00Z", "ignored", a.saved.id);
  assert.equal(update.saved.id, a.saved.id);assert.equal(update.saved.version, 2);assert.equal(update.saved.createdAt, now);assert.equal(update.saved.name, "Option A renamed");
  const duplicate = putDeviceScenario(update.library, { ...edited, name: "Option B" }, now, "device-b");
  assert.equal(duplicate.library.scenarios.length, 2);assert.deepEqual(duplicate.library.scenarios.find(row => row.id === "device-a")!.changes, edited.changes);
  assert.throws(() => putDeviceScenario(duplicate.library, edited, now, "device-c"), /different name/);
  assert.throws(() => putDeviceScenario(duplicate.library, edited, now, "device-c", "gone"), /different name|no longer/);
  assert.deepEqual(deleteDeviceScenario(duplicate.library, "device-b").scenarios.map(row => row.id), ["device-a"]);
  assert.notEqual(scenarioDraftFingerprint(draft), scenarioDraftFingerprint(edited));assert.equal(JSON.stringify(a.library), frozen);
});

test("strict versioned storage rejects extra fields, projections, duplicate IDs, invalid dates/amounts and oversized libraries without trimming", () => {
  const lib = saved().library;assert.deepEqual(decodeScenarioLibrary(JSON.stringify(lib)), lib);
  for (const altered of [{ ...lib, schemaVersion: 2 }, { ...lib, result: {} }, { ...lib, scenarios: [lib.scenarios[0], lib.scenarios[0]] }, { ...lib, scenarios: [{ ...lib.scenarios[0], changes: [{ ...draft.changes[0], amount: Infinity }] }] }, { ...lib, scenarios: [{ ...lib.scenarios[0], updatedAt: "not a date" }] }, { ...lib, scenarios: Array.from({ length: DEVICE_SCENARIO_LIMIT + 1 }, (_, i) => ({ ...lib.scenarios[0], id: `device-${i}`, name: `Option ${i}` })) }]) assert.equal(decodeScenarioLibrary(JSON.stringify(altered)), null);
  assert.equal(decodeScenarioDraft({ ...draft, changes: [{ ...draft.changes[0], date: "2026-02-30" }] }), null);
  assert.equal(decodeScenarioDraft({ ...draft, name: "" }), null);
  const working = { schemaVersion: 1 as const, selectedKey: null, draft: { ...draft, name: "" } };assert.ok(decodeScenarioWorking(JSON.stringify(working)), "unfinished names may remain private working drafts");
  assert.equal(decodeScenarioWorking(JSON.stringify({ ...working, projections: [] })), null);
});

test("legacy draft imports once only after verified new library save and retains its original backup", async () => {
  const store = storage();const keys = scenarioDeviceKeys("A", "home");store.values.set(keys.legacy!, JSON.stringify({ ...draft, invalidDefinition: false }));
  let ids = 0;
  const first = await loadScenarioDeviceState(store, keys, () => true, now, () => `device-${++ids}`);
  assert.equal(first.library.scenarios.length, 1);assert.equal(first.working?.selectedKey, "device:device-1");assert.equal(first.library.legacyImported, true);assert.ok(store.values.get(keys.legacy!));
  const original = store.values.get(keys.legacy!);
  const second = await loadScenarioDeviceState(store, keys, () => true, now, () => `device-${++ids}`);
  assert.equal(second.library.scenarios.length, 1);assert.equal(ids, 1);assert.equal(store.values.get(keys.legacy!), original);
});

test("failed migration preserves the legacy draft; interrupted working write recovers without importing twice", async () => {
  const store = storage();const keys = scenarioDeviceKeys("A", "home");const old = JSON.stringify(draft);store.values.set(keys.legacy!, old);
  const write = store.setItem.bind(store);let failLibrary = true, failWorking = false;
  store.setItem = async (key, value) => { if (key === keys.library && failLibrary || key === keys.working && failWorking) throw new Error("Quota exceeded");return write(key, value); };
  await assert.rejects(loadScenarioDeviceState(store, keys, () => true, now, () => "device-a"), /Quota/);assert.equal(store.values.get(keys.legacy!), old);assert.equal(store.values.has(keys.library), false);
  failLibrary = false;failWorking = true;await assert.rejects(loadScenarioDeviceState(store, keys, () => true, now, () => "device-a"), /Quota/);assert.equal(store.values.get(keys.legacy!), old);
  failWorking = false;const recovered = await loadScenarioDeviceState(store, keys, () => true, now, () => { throw new Error("Do not import twice"); });assert.equal(recovered.library.scenarios.length, 1);assert.equal(recovered.working?.draft.name, draft.name);
});

test("quota and corrupt-library failures retain the old library and unsaved working changes; stale revisions fail explicitly", async () => {
  const store = storage();const keys = scenarioDeviceKeys("A", "home");const a = saved();await persistScenarioLibrary(store, keys.library, emptyScenarioLibrary(), a.library, () => true);
  const before = store.values.get(keys.library);const b = putDeviceScenario(a.library, { ...draft, name: "Option B" }, now, "device-b");
  store.setItem = async () => { throw new Error("Quota exceeded"); };await assert.rejects(persistScenarioLibrary(store, keys.library, a.library, b.library, () => true), /Quota/);assert.equal(store.values.get(keys.library), before);assert.equal(draft.name, "Option A");
  await assert.rejects(persistScenarioLibrary(store, keys.library, emptyScenarioLibrary(), b.library, () => true), /changed elsewhere/);
  store.values.set(keys.library, "{invalid");await assert.rejects(loadScenarioDeviceState(store, keys, () => true, now, () => "device-z"), /Stored data was kept/);assert.equal(store.values.get(keys.library), "{invalid");
});

test("key-bound queued working writes preserve order and skip obsolete A writes after A→B→A", async () => {
  const store = storage();const a = scenarioDeviceKeys("A", "home"), b = scenarioDeviceKeys("B", "home");const write = store.setItem.bind(store);
  let release!: () => void;const held = new Promise<void>(resolve => { release = resolve; });let started!: () => void;const began = new Promise<void>(resolve => { started = resolve; });
  store.setItem = async (key, value) => { if (JSON.parse(value).draft?.name === "Old A") { started();await held; }return write(key, value); };
  let epoch = 0;
  const working = (name: string) => ({ schemaVersion: 1 as const, selectedKey: null, draft: { ...draft, name } });
  const old = persistScenarioWorking(store, a.working, working("Old A"), () => epoch === 0);await began;
  const obsolete = persistScenarioWorking(store, a.working, working("Queued old A"), () => epoch === 0);
  epoch = 1;await persistScenarioWorking(store, b.working, working("B private"), () => epoch === 1);
  epoch = 2;const fresh = persistScenarioWorking(store, a.working, working("New A"), () => epoch === 2);release();await Promise.all([old, obsolete, fresh]);
  assert.equal(JSON.parse(store.values.get(a.working)!).draft.name, "New A");assert.equal(JSON.parse(store.values.get(b.working)!).draft.name, "B private");
  assert.ok(store.writes.every(row => row.key !== b.working || !row.value.includes("Old A")));assert.ok(!store.writes.some(row => row.value.includes("Queued old A")));
});

test("an obsolete library save never writes after a scope switch before its storage read settles", async () => {
  const store = storage();const keys = scenarioDeviceKeys("A", "home");let release!: () => void;const held = new Promise<void>(done => { release = done; });const read = store.getItem.bind(store);store.getItem = async key => { await held;return read(key); };
  let current = true;const saving = persistScenarioLibrary(store, keys.library, emptyScenarioLibrary(), saved().library, () => current);await new Promise(done => setImmediate(done));current = false;release();await assert.rejects(saving, /account or household changed/);assert.equal(store.writes.length, 0);
});

test("the actual workspace autosave effect requires the matching loaded epoch and device readiness", async () => {
  const source = readFileSync("app/plan-simulator.tsx", "utf8");const start = source.indexOf("  useEffect(() => {\n    if (!keepsLocalDraft");const script = transpileModule(source.slice(start, source.indexOf("  useEffect(() => { setComparisonKeys", start)), { compilerOptions: { module: ModuleKind.CommonJS } }).outputText;
  for (const condition of [{ loaded: "A:0", current: "B:1", ready: true }, { loaded: "A:0", current: "A:2", ready: true }, { loaded: "B:1", current: "B:1", ready: false }, { loaded: "B:1", current: "B:1", ready: true }]) {
    let effect!: () => void;const writes: any[] = [];
    const bindings = { ...simulationAccessBindings(), useEffect: (fn: () => void) => { effect = fn; }, keepsLocalDraft: true, deviceKeys: { working: "B" }, deviceReady: condition.ready, loading: false, loadedDraftScope: condition.loaded, draftLoadScope: condition.current, draftLoadScopeRef: { current: condition.current }, selectedId: null, draft, AsyncStorage: {}, persistScenarioWorking: async (_store: unknown, key: string, value: unknown) => { writes.push({ key, value }); }, setMessage() {} };
    new Function(...Object.keys(bindings), script)(...Object.values(bindings));effect();assert.equal(writes.length, condition.ready && condition.loaded === condition.current ? 1 : 0);
  }
});

test("actual save publication rejects an old A completion after A→B→A and cannot unlock the new operation", async () => {
  const source = readFileSync("app/plan-simulator.tsx", "utf8");const start = source.indexOf("  const saveDevice =");const script = transpileModule(source.slice(start, source.indexOf("  const saveDraft =", start)), { compilerOptions: { module: ModuleKind.CommonJS } }).outputText;
  let release!: () => void;const held = new Promise<void>(done => { release = done; });
  const current = { current: "A:0" }, mutation = { current: null as object | null };const publications: string[] = [];
  const bindings = { ...simulationAccessBindings(), useCallback: (fn: any) => fn, editorOpen: false, saving: false, mutationRef: mutation, deviceReady: true, deviceKeys: { library: "A-library" }, loadedDraftScope: "A:0", draftLoadScope: "A:0", draftLoadScopeRef: current, setMessage() {}, setSaving() {}, draft, deviceLibrary: emptyScenarioLibrary(), selectedDevice: null, putDeviceScenario, nextLocalId: () => "new", AsyncStorage: {}, persistScenarioLibrary: async (_storage: unknown, key: string) => { assert.equal(key, "A-library");await held; }, setDeviceLibrary: () => publications.push("library"), setSelectedId: () => publications.push("selection"), setDraft: () => publications.push("draft") };
  const save = new Function(...Object.keys(bindings), `${script};return saveDevice;`)(...Object.values(bindings));const pending = save(true);
  current.current = "B:1";current.current = "A:2";const newOperation = {};mutation.current = newOperation;release();assert.equal(await pending, false);assert.deepEqual(publications, []);assert.equal(mutation.current, newOperation);
});

test("actual monotonic scope identity distinguishes A→B→A and failed reloads", () => {
  const source = readFileSync("app/plan-simulator.tsx", "utf8");const start = source.indexOf("  const draftScopeKey =");const script = transpileModule(source.slice(start, source.indexOf("  const draftLoadScopeRef =", start)), { compilerOptions: { module: ModuleKind.CommonJS } }).outputText;
  let ref: any;const scopes: string[] = [];
  for (const [key, canPersistScenarios] of [["A", false], ["B", false], ["A", false], ["A", true]] as const) {
    const bindings = { ...simulationAccessBindings(), useRef: (initial: any) => ref ??= { current: initial }, deviceKeys: { library: key }, householdId: "home", budgetId: canPersistScenarios ? "other-budget" : "default-budget", canPersistScenarios, defaultHorizon: 6, demoMode: false, canEditHousehold: true };
    scopes.push(new Function(...Object.keys(bindings), `${script};return draftLoadScope;`)(...Object.values(bindings)));
  }
  assert.equal(new Set(scopes).size, 4);
});

test("actual delete completion cannot erase a fresh returned A selection after A→B→A", async () => {
  const source = readFileSync("app/plan-simulator.tsx", "utf8");const start = source.indexOf("  const removeScenario =");const script = transpileModule(source.slice(start, source.indexOf("  const exportDraft =", start)), { compilerOptions: { module: ModuleKind.CommonJS } }).outputText;
  const a = saved();let release!: () => void;const held = new Promise<void>(done => { release = done; });let confirm!: () => Promise<void>;
  const current = { current: "A:0" }, mutation = { current: null as object | null };const publications: string[] = [];
  const bindings = { ...simulationAccessBindings(), useCallback: (fn: any) => fn, saving: false, editorOpen: false, mutationRef: mutation, selectedDevice: a.saved, selectedScenario: null, canEditHousehold: true, canPersistScenarios: false, demoMode: false, draftLoadScope: "A:0", draftLoadScopeRef: current, selectedId: "device:device-a", deviceKeys: { library: "A-library" }, deviceLibrary: a.library, confirmAction: (request: { onConfirm: () => Promise<void> }) => { confirm = request.onConfirm; }, setSaving() {}, deleteDeviceScenario, AsyncStorage: {}, persistScenarioLibrary: async () => held, deletePlanSimulation: async () => { throw new Error("No cloud calls"); }, setDeviceLibrary: () => publications.push("library"), setScenarios: () => publications.push("household"), setSelectedId: () => publications.push("selection"), setComparisonKeys: () => publications.push("comparison"), setMessage() {} };
  const remove = new Function(...Object.keys(bindings), `${script};return removeScenario;`)(...Object.values(bindings));remove();const pending = confirm();current.current = "B:1";current.current = "A:2";const newOperation = {};mutation.current = newOperation;release();await pending;assert.deepEqual(publications, []);assert.equal(mutation.current, newOperation);
});

test("a dirty working draft defers saved-option switching until an explicit decision", () => {
  const source = readFileSync("app/plan-simulator.tsx", "utf8");const start = source.indexOf("  const requestSelection =");const script = transpileModule(source.slice(start, source.indexOf("  const makeLocalDraft =", start)), { compilerOptions: { module: ModuleKind.CommonJS } }).outputText;
  for (const dirty of [false, true]) {
    const applied: string[] = [], pending: string[] = [];
    const bindings = { ...simulationAccessBindings(), useCallback: (fn: any) => fn, saving: false, mutationRef: { current: null }, selectedId: "device:a", draftDirty: dirty, setPendingSwitch: (key: string) => pending.push(key), applySelection: (key: string) => applied.push(key) };
    const request = new Function(...Object.keys(bindings), `${script};return requestSelection;`)(...Object.values(bindings));request("device:b");assert.deepEqual(applied, dirty ? [] : ["device:b"]);assert.deepEqual(pending, dirty ? ["device:b"] : []);
  }
  assert.match(source, /if \(await saveDraft\(\)\) applySelection\(next\)/);
});

test("independent browser tabs serialize library revisions through the same scoped Web Lock", async () => {
  const backend = storage();const keys = scenarioDeviceKeys("A", "home");const a = saved();await persistScenarioLibrary(backend, keys.library, emptyScenarioLibrary(), a.library, () => true);
  const tab1 = { getItem: backend.getItem.bind(backend), setItem: backend.setItem.bind(backend) }, tab2 = { getItem: backend.getItem.bind(backend), setItem: backend.setItem.bind(backend) };
  let tail: Promise<unknown> = Promise.resolve();const lock = { request<T>(_name: string, action: () => Promise<T>): Promise<T> { const next = tail.catch(() => undefined).then(action);tail = next;return next; } };
  const workB = { ...draft, name: "Option B" }, workC = { ...draft, name: "Option C" };
  const b = putDeviceScenario(a.library, workB, now, "device-b"), c = putDeviceScenario(a.library, workC, now, "device-c");
  const results = await Promise.allSettled([persistScenarioLibrary(tab1, keys.library, a.library, b.library, () => true, lock), persistScenarioLibrary(tab2, keys.library, a.library, c.library, () => true, lock)]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);assert.equal(results.filter(result => result.status === "rejected").length, 1);
  const failed = results.find(result => result.status === "rejected") as PromiseRejectedResult;assert.match(String(failed.reason), /Reload saved scenarios/);
  const current = decodeScenarioLibrary(backend.values.get(keys.library)!)!;assert.equal(current.scenarios.length, 2);assert.ok(current.scenarios.some(row => row.id === "device-a"));assert.equal(workB.name, "Option B");assert.equal(workC.name, "Option C");
  const retry = putDeviceScenario(current, workC, now, "device-c");await persistScenarioLibrary(tab2, keys.library, current, retry.library, () => true, lock);assert.equal(decodeScenarioLibrary(backend.values.get(keys.library)!)!.scenarios.length, 3);
});

test("Reload saved scenarios refreshes libraries without replacing unsaved working values, including on failure", async () => {
  const source = readFileSync("app/plan-simulator.tsx", "utf8");const start = source.indexOf("  const reloadLibraries =");const script = transpileModule(source.slice(start, source.indexOf("  const removeScenario =", start)), { compilerOptions: { module: ModuleKind.CommonJS } }).outputText;
  for (const fail of [false, true]) {
    const publications: string[] = [], messages: string[] = [];const working = { ...draft, name: "Unsaved working C" };
    const bindings = { ...simulationAccessBindings(), useCallback: (fn: any) => fn, deviceKeys: { library: "A" }, editorOpen: false, mutationRef: { current: null }, draftLoadScope: "A:0", draftLoadScopeRef: { current: "A:0" }, setSaving() {}, AsyncStorage: {}, loadScenarioDeviceState: async () => { if (fail) throw new Error("Storage unavailable");return { library: saved().library, working: { draft: { ...draft, name: "Older persisted work" } } }; }, nextLocalId: () => "new", canPersistScenarios: false, demoMode: false, householdId: "home", scenarios: [], loadPlanSimulations: async () => [], setDeviceLibrary: () => publications.push("library"), setDeviceReady() {}, setScenarios() {}, setSelectedId() {}, setMessage: (message: string) => messages.push(message), setDraft: () => { throw new Error("Reload must not replace working values"); } };
    const reload = new Function(...Object.keys(bindings), `${script};return reloadLibraries;`)(...Object.values(bindings));await reload();assert.equal(working.name, "Unsaved working C");assert.equal(publications.length, fail ? 0 : 1);assert.match(messages.join(" "), fail ? /unavailable/ : /unsaved working values were kept/);
  }
});

test("a saved switch target deleted elsewhere cannot discard the current working draft", () => {
  const source = readFileSync("app/plan-simulator.tsx", "utf8");const start = source.indexOf("  const applySelection =");const script = transpileModule(source.slice(start, source.indexOf("  const requestSelection =", start)), { compilerOptions: { module: ModuleKind.CommonJS } }).outputText;
  const writes: string[] = [], messages: string[] = [];
  const bindings = { ...simulationAccessBindings(), useCallback: (fn: any) => fn, saving: false, mutationRef: { current: null }, savedOptions: [], defaultHorizon: 6, setPendingSwitch() {}, setMessage: (message: string) => messages.push(message), setEditorOpen() {}, setEditingId() {}, setEditorVersion() {}, setSelectedId: () => writes.push("selection"), setDraft: () => writes.push("draft") };
  const apply = new Function(...Object.keys(bindings), `${script};return applySelection;`)(...Object.values(bindings));apply("device:deleted");assert.deepEqual(writes, []);assert.match(messages.join(" "), /working changes were kept/);
});

for (const kind of ["device", "household"] as const) test(`a held ${kind} save locks every working mutation before publication`, async () => {
  const source = readFileSync("app/plan-simulator.tsx", "utf8");
  const functions = (start: string, end: string) => transpileModule(source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start))), { compilerOptions: { module: ModuleKind.CommonJS } }).outputText;
  let release!: () => void;const held = new Promise<void>(done => { release = done; });const mutation = { current: null as object | null };let working = structuredClone(draft);
  const row = { id: "cloud-a", householdId: "home", version: 1, ...draft };
  const bindings: Record<string, any> = { ...simulationAccessBindings(), useCallback: (fn: any) => fn, editorOpen: false, saving: false, mutationRef: mutation, deviceReady: true, deviceKeys: { library: "A-library" }, loadedDraftScope: "A:0", draftLoadScope: "A:0", draftLoadScopeRef: { current: "A:0" }, setMessage() {}, setSaving() {}, draft, deviceLibrary: emptyScenarioLibrary(), selectedDevice: null, selectedScenario: kind === "household" ? row : null, selectedId: kind === "household" ? "household:cloud-a" : null, putDeviceScenario, nextLocalId: () => "new", AsyncStorage: {}, persistScenarioLibrary: async () => held, updatePlanSimulation: async () => { await held;return { ...row, version: 2 }; }, setDeviceLibrary() {}, setSelectedId() {}, setScenarios() {}, setDraft: (value: any) => { working = typeof value === "function" ? value(working) : value; }, canEditHousehold: true, canPersistScenarios: kind === "household", demoMode: false, safePlanSimulationName: (name: string) => name, saveDevice: () => { throw new Error("Unexpected fallback"); }, makeLocalDraft: () => { throw new Error("Draft must stay locked"); }, setEditorOpen: () => { throw new Error("Cannot open editor while saving"); }, setEditingId: () => { throw new Error("Cannot change editor while saving"); }, setEditorVersion: () => { throw new Error("Cannot remount editor while saving"); }, editingId: null, defaultHorizon: 6, savedOptions: [], setPendingSwitch: () => { throw new Error("Cannot switch while saving"); }, applySelection: () => { throw new Error("Cannot switch while saving"); }, draftDirty: true, isPlanSimulationHorizon: () => true };
  const saveScript = kind === "device" ? functions("  const saveDevice =", "  const saveDraft =") : functions("  const saveDraft =", "  const saveHouseholdCopy =");
  const save = new Function(...Object.keys(bindings), `${saveScript};return ${kind === "device" ? "saveDevice" : "saveDraft"};`)(...Object.values(bindings));const pending = kind === "device" ? save(true) : save();
  assert.ok(mutation.current);
  const edits = new Function(...Object.keys(bindings), `${functions("  const updateDraftName =", "  const saveDevice =")};return {updateDraftName,updateDraftHorizon};`)(...Object.values(bindings));edits.updateDraftName("Unaccepted new name");edits.updateDraftHorizon("12");
  for (const [start, end, name, argument] of [["  const openEditor =", "  useOverlayActivity", "openEditor", null], ["  const removeChange =", "  const saveChange =", "removeChange", "expense-a"], ["  const resetDraft =", "  const updateDraftName =", "resetDraft", undefined], ["  const requestSelection =", "  const makeLocalDraft =", "requestSelection", "device:b"]]) {
    const action = new Function(...Object.keys(bindings), `${functions(start!, end!)};return ${name};`)(...Object.values(bindings));action(argument);
  }
  assert.deepEqual(working, draft);release();assert.equal(await pending, true);assert.deepEqual(working, draft);
  assert.match(source, /editable=\{!disabled\}/);assert.match(source, /disabled=\{saving\} label="Scenario name"/);assert.match(source, /Scenario horizon while saving/);assert.match(source, /<ChangeList[^>]*disabled=\{saving\}/);
});

test("the actual asynchronous loader rejects an A0 completion before cleanup after A→B→A2 and hydrates only B", async () => {
  const source = readFileSync("app/plan-simulator.tsx", "utf8");const start = source.indexOf("  useEffect(() => {\n    let cancelled = false;\n    const isCurrent =");const script = transpileModule(source.slice(start, source.indexOf("  useEffect(() => {\n    if (!keepsLocalDraft", start)), { compilerOptions: { module: ModuleKind.CommonJS } }).outputText;
  const run = (owner: string, ref: { current: string }) => {
    let effect!: () => void, resolveDevice!: (value: any) => void, resolveCloud!: (value: any) => void;const calls: Array<[string, any]> = [];
    const device = new Promise(done => { resolveDevice = done; }), cloud = new Promise(done => { resolveCloud = done; });
    const bindings: Record<string, any> = { ...simulationAccessBindings(), useEffect: (fn: () => void) => { effect = fn; }, draftLoadScope: owner, draftLoadScopeRef: ref, canPersistScenarios: true, demoMode: false, householdId: "home", deviceKeys: { library: owner }, defaultHorizon: 6, AsyncStorage: {}, loadPlanSimulations: () => cloud, loadScenarioDeviceState: () => device, nextLocalId: () => "new", emptyScenarioLibrary, mutationRef: { current: {} }, returnFocusRef: { current: {} } };
    for (const name of ["setLoading", "setLoadedDraftScope", "setDeviceReady", "setDeviceLibrary", "setPendingSwitch", "setComparisonKeys", "setComparisonHorizon", "setSaving", "setMobileView", "setEditorOpen", "setEditingId", "setEditorVersion", "setMessage", "setScenarios", "setSelectedId", "setDraft"]) bindings[name] = (value: any) => calls.push([name, value]);
    new Function(...Object.keys(bindings), script)(...Object.values(bindings));effect();calls.length = 0;return { calls, resolveDevice, resolveCloud };
  };
  const ref = { current: "A:0" };const old = run("A:0", ref);ref.current = "B:1";ref.current = "A:2";old.resolveDevice({ library: saved().library, working: { selectedKey: "device:device-a", draft } });old.resolveCloud([{ id: "old-cloud-a" }]);await new Promise(done => setImmediate(done));assert.deepEqual(old.calls, []);
  ref.current = "B:3";const b = run("B:3", ref);const local = saved("Private B", "device-b");b.resolveDevice({ library: local.library, working: { selectedKey: "device:device-b", draft: { ...draft, name: "Private B" } } });b.resolveCloud([]);await new Promise(done => setImmediate(done));
  assert.ok(b.calls.some(([name, value]) => name === "setDraft" && value.name === "Private B"));assert.ok(b.calls.some(([name, value]) => name === "setSelectedId" && value === "device:device-b"));assert.ok(b.calls.some(([name, value]) => name === "setLoadedDraftScope" && value === "B:3"));assert.ok(b.calls.some(([name, value]) => name === "setDeviceReady" && value === true));assert.ok(b.calls.some(([name, value]) => name === "setLoading" && value === false));
});

test("an actual failed or corrupt load never marks device data ready for autosave or publishes foreign draft data", async () => {
  const source = readFileSync("app/plan-simulator.tsx", "utf8");const start = source.indexOf("  useEffect(() => {\n    let cancelled = false;\n    const isCurrent =");const script = transpileModule(source.slice(start, source.indexOf("  useEffect(() => {\n    if (!keepsLocalDraft", start)), { compilerOptions: { module: ModuleKind.CommonJS } }).outputText;
  for (const message of ["Storage unavailable", "Stored data was kept: corrupt library"]) {
    let effect!: () => void;const calls: Array<[string, any]> = [];
    const bindings: Record<string, any> = { ...simulationAccessBindings(), useEffect: (fn: () => void) => { effect = fn; }, draftLoadScope: "B:1", draftLoadScopeRef: { current: "B:1" }, canPersistScenarios: false, demoMode: false, householdId: "home", deviceKeys: { library: "B" }, defaultHorizon: 6, AsyncStorage: {}, loadPlanSimulations: async () => [], loadScenarioDeviceState: async () => { throw new Error(message); }, nextLocalId: () => "new", emptyScenarioLibrary, mutationRef: { current: {} }, returnFocusRef: { current: {} } };
    for (const name of ["setLoading", "setLoadedDraftScope", "setDeviceReady", "setDeviceLibrary", "setPendingSwitch", "setComparisonKeys", "setComparisonHorizon", "setSaving", "setMobileView", "setEditorOpen", "setEditingId", "setEditorVersion", "setMessage", "setScenarios", "setSelectedId", "setDraft"]) bindings[name] = (value: any) => calls.push([name, value]);
    new Function(...Object.keys(bindings), script)(...Object.values(bindings));effect();await new Promise(done => setImmediate(done));assert.ok(!calls.some(([name, value]) => name === "setDeviceReady" && value === true));assert.ok(calls.some(([name, value]) => name === "setMessage" && value === message));assert.equal(calls.filter(([name]) => name === "setDraft").length, 1, "only the clean destination reset is published, never source data");
  }
});

test("the actual initial loader publishes each available source independently without enabling failed device autosave", async () => {
  const source = readFileSync("app/plan-simulator.tsx", "utf8");const start = source.indexOf("  useEffect(() => {\n    let cancelled = false;\n    const isCurrent =");const script = transpileModule(source.slice(start, source.indexOf("  useEffect(() => {\n    if (!keepsLocalDraft", start)), { compilerOptions: { module: ModuleKind.CommonJS } }).outputText;
  for (const failed of ["device", "household"] as const) {
    let effect!: () => void;const calls: Array<[string, any]> = [];const local = saved();const cloud = [{ id: "cloud-a", ...draft }];
    const bindings: Record<string, any> = { ...simulationAccessBindings(), useEffect: (fn: () => void) => { effect = fn; }, draftLoadScope: "A:0", draftLoadScopeRef: { current: "A:0" }, canPersistScenarios: true, demoMode: false, householdId: "home", deviceKeys: { library: "A" }, defaultHorizon: 6, AsyncStorage: {}, loadPlanSimulations: async () => { if (failed === "household") throw new Error("Household unavailable");return cloud; }, loadScenarioDeviceState: async () => { if (failed === "device") throw new Error("Device quota/corrupt read failure");return { library: local.library, working: { selectedKey: "device:device-a", draft } }; }, nextLocalId: () => "new", emptyScenarioLibrary, mutationRef: { current: null }, returnFocusRef: { current: null } };
    for (const name of ["setLoading", "setLoadedDraftScope", "setDeviceReady", "setDeviceLibrary", "setPendingSwitch", "setComparisonKeys", "setComparisonHorizon", "setSaving", "setMobileView", "setEditorOpen", "setEditingId", "setEditorVersion", "setMessage", "setScenarios", "setSelectedId", "setDraft"]) bindings[name] = (value: any) => calls.push([name, value]);
    new Function(...Object.keys(bindings), script)(...Object.values(bindings));effect();calls.length = 0;await new Promise(done => setImmediate(done));
    assert.deepEqual(calls.find(([name]) => name === "setScenarios")?.[1], failed === "device" ? cloud : []);
    assert.equal(calls.find(([name]) => name === "setDeviceReady")?.[1], failed !== "device");
    assert.equal(calls.filter(([name]) => name === "setDeviceLibrary").length, failed === "device" ? 0 : 1);
    assert.equal(calls.filter(([name]) => name === "setDraft").length, failed === "device" ? 0 : 1);
    assert.ok(calls.some(([name, value]) => name === "setMessage" && value.includes(failed === "device" ? "Device quota/corrupt" : "Household unavailable")));
  }
  assert.match(source, /disabled=\{saving \|\| \(!deviceReady && !householdWriteEligible\)\}/);
  assert.match(source, /label="Duplicate"[^\n]*disabled=\{\(!deviceReady && !householdWriteEligible\)/);
});

test("the actual reload independently recovers cloud or device libraries while preserving unsaved work", async () => {
  const source = readFileSync("app/plan-simulator.tsx", "utf8");const start = source.indexOf("  const reloadLibraries =");const script = transpileModule(source.slice(start, source.indexOf("  const removeScenario =", start)), { compilerOptions: { module: ModuleKind.CommonJS } }).outputText;
  for (const failed of ["device", "household"] as const) {
    const calls: Array<[string, any]> = [];const local = saved();const cloud = [{ id: "cloud-a", ...draft }];const working = { ...draft, name: "Keep unsaved work" };
    const bindings: Record<string, any> = { ...simulationAccessBindings(), useCallback: (fn: any) => fn, deviceKeys: { library: "A" }, editorOpen: false, mutationRef: { current: null }, draftLoadScope: "A:0", draftLoadScopeRef: { current: "A:0" }, setSaving() {}, AsyncStorage: {}, loadScenarioDeviceState: async () => { if (failed === "device") throw new Error("Device read failed");return { library: local.library, working: { draft: { ...draft, name: "Older stored work" } } }; }, nextLocalId: () => "new", canPersistScenarios: true, demoMode: false, householdId: "home", scenarios: [], loadPlanSimulations: async () => { if (failed === "household") throw new Error("Household read failed");return cloud; }, setDeviceLibrary: (value: unknown) => calls.push(["library", value]), setDeviceReady: (value: boolean) => calls.push(["ready", value]), setScenarios: (value: unknown) => calls.push(["cloud", value]), setSelectedId() {}, setMessage: (value: string) => calls.push(["message", value]), setDraft() { throw new Error("Reload must not replace working values"); } };
    const reload = new Function(...Object.keys(bindings), `${script};return reloadLibraries;`)(...Object.values(bindings));await reload();assert.equal(working.name, "Keep unsaved work");assert.deepEqual(calls.find(([name]) => name === "cloud")?.[1], failed === "device" ? cloud : []);assert.equal(calls.find(([name]) => name === "ready")?.[1], failed !== "device");assert.equal(calls.filter(([name]) => name === "library").length, failed === "device" ? 0 : 1);assert.ok(calls.some(([name, value]) => name === "message" && String(value).includes("unsaved working values were kept")));
  }
});
