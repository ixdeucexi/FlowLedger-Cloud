import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { JsxEmit, ModuleKind, transpileModule } from "typescript";
import * as simulator from "./planSimulator";
import * as library from "./planSimulationLibrary";

const source = readFileSync("app/plan-simulator.tsx", "utf8");
const draft = { name: "Option A", horizonMonths: 3 as const, changes: [{ id: "change-a", type: "spending_once" as const, name: "Trip", amount: 123.45, date: "2026-11-01" }] };
const cloudRow = { id: "cloud-a", householdId: "home", ...draft, schemaVersion: 1, version: 1, createdBy: "actor", updatedBy: "actor", createdAt: "2026-10-30", updatedAt: "2026-10-30" };
function section(start: string, end: string) {
  const at = source.indexOf(start);
  assert.notEqual(at, -1, start);
  return transpileModule(source.slice(at, source.indexOf(end, at)), { compilerOptions: { module: ModuleKind.CommonJS, jsx: JsxEmit.React } }).outputText;
}
function handler(name: string, end: string, bindings: Record<string, any>) {
  return new Function(...Object.keys(bindings), `${section(`  const ${name} =`, end)};return ${name};`)(...Object.values(bindings));
}
function workspaceBindings() {
  const owner = { key: "pro", epoch: 0 }, writes: string[] = [], publications: string[] = [], messages: string[] = [];
  let confirm: (() => Promise<void>) | undefined;
  const device = library.putDeviceScenario(library.emptyScenarioLibrary(), draft, "2026-10-30", "device-a");
  const bindings: Record<string, any> = {
    useCallback: (fn: any) => fn, mountedRef: { current: true }, user: { id: "actor" }, scenarioAccessOwner: owner, scenarioAccessRef: { current: owner }, canSaveDevice: true,
    canEditHousehold: true, canPersistScenarios: true, demoMode: false, householdId: "home", draftLoadScope: "A:0", draftLoadScopeRef: { current: "A:0" }, loadedDraftScope: "A:0",
    editorOpen: false, saving: false, mutationRef: { current: null }, deviceReady: true, deviceKeys: { library: "A-library" }, deviceLibrary: device.library, draft,
    selectedDevice: null, selectedScenario: null, selectedId: null, scenarios: [], AsyncStorage: {}, nextLocalId: () => "new", putDeviceScenario: library.putDeviceScenario, deleteDeviceScenario: library.deleteDeviceScenario,
    safePlanSimulationName: simulator.safePlanSimulationName, saveDevice: async () => { writes.push("private-fallback");return true; },
    persistScenarioLibrary: async (_store: unknown, _key: string, _before: unknown, _after: unknown, current: () => boolean) => { if (current()) writes.push("device"); },
    createPlanSimulation: async (value: any) => { assert.equal(value.requestScope.userId, "actor");assert.equal(value.requestScope.isCurrent(), true);writes.push("cloud-create");return cloudRow; },
    updatePlanSimulation: async (value: any) => { assert.equal(value.requestScope.isCurrent(), true);writes.push("cloud-update");return cloudRow; },
    deletePlanSimulation: async (_row: unknown, request: any) => { assert.equal(request.userId, "actor");assert.equal(request.isCurrent(), true);writes.push("cloud-delete"); },
    confirmAction: (value: any) => { confirm = value.onConfirm; }, setSaving() {}, setMessage: (message: string) => messages.push(message),
    setScenarios: () => publications.push("cloud"), setDeviceLibrary: () => publications.push("device"), setSelectedId: () => publications.push("selection"), setDraft: () => publications.push("draft"), setComparisonKeys() {},
  };
  return { bindings, writes, publications, messages, device, confirm: () => confirm };
}

test("Free has one usable working simulator; founder/pro and preview cloud rights remain distinct", () => {
  const script = section("export default function PlanSimulatorScreen()", "const styles =");
  for (const profile of [
    { name: "free", tier: "free", found: false, features: ["plan_simulator"], expected: [false, false, false] },
    { name: "founder", tier: "free", found: true, features: ["plan_simulator", "saved_scenarios", "scenario_comparison"], expected: [true, true, false] },
    { name: "pro", tier: "pro", found: false, features: ["plan_simulator", "saved_scenarios", "scenario_comparison", "cloud_scenarios"], expected: [true, true, true] },
    { name: "admin-preview-only", tier: "free", found: false, features: ["plan_simulator", "saved_scenarios", "scenario_comparison", "cloud_scenarios"], expected: [true, true, false] },
  ]) {
    const exports: any = {};
    new Function("exports", "useMembership", "React", "PlanSimulatorWorkspace", "LockedPlanSimulator", "AppLoadingIntro", script)(exports, () => ({ actualPlan: { tier: profile.tier }, loading: false, hasFoundingAccess: profile.found, isFeatureLocked: (id: string) => !profile.features.includes(id) }), { createElement: (type: string, props: any) => ({ type, props }) }, "workspace", "locked", "loading");
    const result = exports.default();assert.equal(result.type, "workspace", profile.name);
    assert.deepEqual([result.props.canSaveDevice, result.props.canCompareSaved, result.props.canPersistScenarios], profile.expected, profile.name);
  }
  assert.match(source, /!canCompareSaved \? <ResultsPanel/);
  assert.match(source, /<PlanFeatureGate feature="scenario_comparison" compact><SavedScenarioComparison/);
});

test("Free cannot save or update a named option through retained direct handlers; saved data is intact", async () => {
  for (const name of ["saveDevice", "saveDraft"] as const) {
    const f = workspaceBindings();f.bindings.canSaveDevice = false;f.bindings.selectedScenario = cloudRow;
    const before = JSON.stringify(f.bindings.deviceLibrary);
    const action = handler(name, name === "saveDevice" ? "  const saveDraft =" : "  const saveHouseholdCopy =", f.bindings);
    assert.equal(await action(true), false);assert.deepEqual(f.writes, []);assert.deepEqual(f.publications, []);assert.equal(JSON.stringify(f.bindings.deviceLibrary), before);assert.match(f.messages.join(" "), /Pro feature/);
  }
});

test("capability A→B→A and unmount invalidate old premium callbacks before any write", async () => {
  for (const actionName of ["saveDevice", "saveDraft", "saveHouseholdCopy"] as const) for (const mode of ["downgrade", "aba", "unmount"] as const) {
    const f = workspaceBindings();f.bindings.selectedScenario = cloudRow;
    const action = handler(actionName, actionName === "saveDevice" ? "  const saveDraft =" : actionName === "saveDraft" ? "  const saveHouseholdCopy =" : "  const reloadLibraries =", f.bindings);
    if (mode === "unmount") f.bindings.mountedRef.current = false;
    else f.bindings.scenarioAccessRef.current = { key: mode === "aba" ? "pro" : "free", epoch: mode === "aba" ? 2 : 1 };
    await action(true);assert.deepEqual(f.writes, [], `${actionName}/${mode}`);assert.deepEqual(f.publications, []);
  }
});

test("founders and Pro viewers can save private named copies; viewer cannot create or update household rows", async () => {
  const f = workspaceBindings();f.bindings.canPersistScenarios = false;f.bindings.draft = { ...draft, name: "New private option" };
  assert.equal(await handler("saveDevice", "  const saveDraft =", f.bindings)(true), true);assert.deepEqual(f.writes, ["device"]);
  const viewer = workspaceBindings();viewer.bindings.canEditHousehold = false;viewer.bindings.selectedScenario = cloudRow;
  await handler("saveHouseholdCopy", "  const reloadLibraries =", viewer.bindings)();assert.deepEqual(viewer.writes, []);
  await handler("saveDraft", "  const saveHouseholdCopy =", viewer.bindings)();assert.deepEqual(viewer.writes, ["private-fallback"]);
});

test("downgraded editors can delete old cloud/device definitions while viewer and stale confirmations cannot", async () => {
  for (const kind of ["cloud", "device"]) {
    const f = workspaceBindings();f.bindings.canSaveDevice = false;f.bindings.canPersistScenarios = false;
    if (kind === "cloud") f.bindings.selectedScenario = cloudRow;else f.bindings.selectedDevice = f.device.saved;
    handler("removeScenario", "  const exportDraft =", f.bindings)();assert.ok(f.confirm());await f.confirm()!();assert.deepEqual(f.writes, [kind === "cloud" ? "cloud-delete" : "device"]);
  }
  const viewer = workspaceBindings();viewer.bindings.selectedScenario = cloudRow;viewer.bindings.canEditHousehold = false;
  handler("removeScenario", "  const exportDraft =", viewer.bindings)();assert.equal(viewer.confirm(), undefined);
  const stale = workspaceBindings();stale.bindings.selectedScenario = cloudRow;handler("removeScenario", "  const exportDraft =", stale.bindings)();stale.bindings.scenarioAccessRef.current = { key: "pro", epoch: 2 };await stale.confirm()!();assert.deepEqual(stale.writes, []);
});

test("a capability change cancels old publication without resetting or deleting the current working draft", () => {
  const start = source.indexOf("  useEffect(() => {\n    // A permission change");
  const script = transpileModule(source.slice(start, source.indexOf("  useEffect(() => {\n    let cancelled", start)), { compilerOptions: { module: ModuleKind.CommonJS } }).outputText;
  let effect!: () => void;const mutation = { current: {} as object | null }, calls: unknown[] = [];
  new Function("useEffect", "mutationRef", "setSaving", "canCompareSaved", "setComparisonKeys", "setComparisonHorizon", "scenarioAccessOwner", script)((fn: () => void) => { effect = fn; }, mutation, (value: boolean) => calls.push(value), false, (value: unknown) => calls.push(value), (value: unknown) => calls.push(value), {});
  effect();assert.equal(mutation.current, null);assert.deepEqual(calls, [false, ["", ""], null]);
});

function persistenceFixture(uid = "actor", afterSession?: () => void) {
  const calls: Array<[string, unknown]> = [], headers: string[] = [];
  const row = { id: cloudRow.id, household_id: cloudRow.householdId, name: draft.name, horizon_months: draft.horizonMonths, changes: draft.changes, schema_version: 1, version: 1 };
  let operation = "select";
  const query: any = new Proxy({}, { get(_target, key) {
    if (key === "then") return (resolve: (value: unknown) => void) => resolve({ data: operation === "delete" ? { id: row.id } : operation === "list" ? [row] : row, error: null });
    return (...args: unknown[]) => { calls.push([String(key), args]);if (key === "insert" || key === "update" || key === "delete") operation = String(key);if (key === "order") operation = "list";if (key === "setHeader") headers.push(String(args[1]));return query; };
  } });
  const supabase = { auth: { getSession: async () => { afterSession?.();return { data: { session: { user: { id: uid }, access_token: "token-" + uid } }, error: null }; } }, from: (table: string) => { calls.push(["from", table]);return query; } };
  const exports: any = {}, js = transpileModule(readFileSync("lib/planSimulationPersistence.ts", "utf8"), { compilerOptions: { module: ModuleKind.CommonJS } }).outputText;
  new Function("exports", "require", js)(exports, (name: string) => name === "./supabase" ? { supabase } : simulator);
  return { exports, calls, headers };
}

test("scenario reads/writes/deletes verify SDK identity and current scope before dispatch", async () => {
  for (const method of ["load", "create", "update", "delete"]) for (const mode of ["other-user", "changed-scope"] as const) {
    let current = true;const f = persistenceFixture(mode === "other-user" ? "other" : "actor", () => { if (mode === "changed-scope") current = false; });
    const scope = { userId: "actor", isCurrent: () => current };
    const request = method === "load" ? f.exports.loadPlanSimulations("home", scope) : method === "create" ? f.exports.createPlanSimulation({ householdId: "home", requestScope: scope, ...draft }) : method === "update" ? f.exports.updatePlanSimulation({ scenario: cloudRow, requestScope: scope, ...draft }) : f.exports.deletePlanSimulation(cloudRow, scope);
    await assert.rejects(request, /changed/);assert.deepEqual(f.calls, []);
  }
});

test("all scenario requests pin their verified token, and downgrade read/delete need no client Pro claim", async () => {
  const f = persistenceFixture();const scope = { userId: "actor", isCurrent: () => true };
  await f.exports.loadPlanSimulations("home", scope);await f.exports.createPlanSimulation({ householdId: "home", requestScope: scope, ...draft });await f.exports.updatePlanSimulation({ scenario: cloudRow, requestScope: scope, ...draft });await f.exports.deletePlanSimulation(cloudRow, scope);
  assert.deepEqual(f.headers, Array(4).fill("Bearer token-actor"));assert.equal(f.calls.filter(([name]) => name === "from").length, 4);
});

function exporterFixture(platform: string, changeScopeDuringWrite = false) {
  let current = true;const calls: string[] = [];
  const fileSystem = { cacheDirectory: "cache/", EncodingType: { UTF8: "utf8" }, writeAsStringAsync: async (_uri: string, raw: string) => { calls.push("write");assert.equal(JSON.parse(raw).changes[0].amount, 123.45);if (changeScopeDuringWrite) current = false; }, deleteAsync: async () => { calls.push("delete"); } };
  const sharing = { isAvailableAsync: async () => true, shareAsync: async () => { calls.push("share"); } };
  const exports: any = {}, js = transpileModule(readFileSync("lib/planSimulationExport.ts", "utf8"), { compilerOptions: { module: ModuleKind.CommonJS } }).outputText;
  new Function("exports", "require", js)(exports, (name: string) => name === "react-native" ? { Platform: { OS: platform } } : name === "./planSimulationLibrary" ? library : name === "expo-file-system/legacy" ? fileSystem : name === "expo-sharing" ? sharing : {});
  return { exports, calls, current: () => current };
}

test("Free exports preserve exact what-if values and contain no current account balances", async () => {
  const f = exporterFixture("android");const value = f.exports.scenarioExportDocument(draft);const parsed = JSON.parse(value.content);
  assert.equal(value.filename, "FlowLedger-Option-A.json");assert.equal(parsed.changes[0].amount, 123.45);assert.equal(parsed.kind, "flowledger-plan-scenario");assert.deepEqual(Object.keys(parsed), ["kind", "schemaVersion", "name", "horizonMonths", "changes"]);
  assert.equal(await f.exports.exportPlanScenario(draft, f.current), true);assert.deepEqual(f.calls, ["write", "share", "delete"]);
});

test("native exports cancel sharing after a scope change and clean their temporary file", async () => {
  const f = exporterFixture("android", true);assert.equal(await f.exports.exportPlanScenario(draft, f.current), false);assert.deepEqual(f.calls, ["write", "delete"]);
  const before = exporterFixture("android");assert.equal(await before.exports.exportPlanScenario(draft, () => false), false);assert.deepEqual(before.calls, []);
});

test("browser scenario download preserves actual values and releases the private Blob URL", async () => {
  const exports: any = {}, callbacks: Array<() => void> = [], calls: string[] = [];
  let blob!: Blob;
  const link: any = { click() { assert.equal(this.href, "blob:scenario");assert.equal(this.download, "FlowLedger-Option-A.json");calls.push("click"); }, remove() { calls.push("remove"); } };
  const js = transpileModule(readFileSync("lib/planSimulationExport.ts", "utf8"), { compilerOptions: { module: ModuleKind.CommonJS } }).outputText;
  new Function("exports", "require", "document", "URL", "Blob", "setTimeout", js)(exports, (name: string) => name === "react-native" ? { Platform: { OS: "web" } } : library, { createElement: () => link, body: { appendChild() { calls.push("append"); } } }, { createObjectURL(value: Blob) { blob = value;return "blob:scenario"; }, revokeObjectURL(value: string) { assert.equal(value, "blob:scenario");calls.push("revoke"); } }, Blob, (fn: () => void) => callbacks.push(fn));
  assert.equal(await exports.exportPlanScenario(draft, () => true), true);
  assert.equal(JSON.parse(await blob.text()).changes[0].amount, 123.45);
  assert.deepEqual(calls, ["append", "click", "remove"]);callbacks[0]();assert.equal(calls.at(-1), "revoke");
});
