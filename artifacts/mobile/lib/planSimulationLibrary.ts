import { decodePlanSimulationChanges, isPlanSimulationHorizon, planSimulationStorageKey, safePlanSimulationName, type PlanSimulationChange, type PlanSimulationHorizon } from "./planSimulator";

export type ScenarioDraft = { name: string; horizonMonths: PlanSimulationHorizon; changes: PlanSimulationChange[]; invalidDefinition?: boolean };
export type DeviceScenario = ScenarioDraft & { id: string; version: number; createdAt: string; updatedAt: string };
export type DeviceScenarioLibrary = { schemaVersion: 1; revision: number; legacyImported: boolean; scenarios: DeviceScenario[] };
export type ScenarioWorkingDraft = { schemaVersion: 1; selectedKey: string | null; draft: ScenarioDraft };
export type ScenarioLockManager = { request<T>(name: string, callback: () => Promise<T>): Promise<T> };
export type ScenarioStorage = { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<unknown> };
export const DEVICE_SCENARIO_LIMIT = 30;
const MAX_BYTES = 2_000_000;
const queues = new WeakMap<ScenarioStorage, Map<string, Promise<unknown>>>();

export function scenarioDeviceKeys(userId: string, householdId: string, demoMode = false) {
  const legacy = planSimulationStorageKey(userId, householdId);
  const mode = demoMode ? "demo" : "real";
  return { library: `flowledger-plan-simulator-library-v1:${userId}:${householdId}:${mode}`, working: `${legacy}:working-v2:${mode}`, legacy: demoMode ? null : legacy };
}
export function emptyScenarioLibrary(): DeviceScenarioLibrary { return { schemaVersion: 1, revision: 0, legacyImported: false, scenarios: [] }; }
function exact(value: object, keys: string[]) { return Object.keys(value).sort().join("|") === keys.sort().join("|"); }
export function decodeScenarioDraft(value: unknown, working = false): ScenarioDraft | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (!exact(row, row.invalidDefinition === undefined ? ["name", "horizonMonths", "changes"] : ["name", "horizonMonths", "changes", "invalidDefinition"])) return null;
  const name = typeof row.name === "string" ? working && row.name.length <= 256 ? row.name : safePlanSimulationName(row.name) : null;
  const changes = decodePlanSimulationChanges(row.changes);
  return name !== null && isPlanSimulationHorizon(row.horizonMonths) && changes && (row.invalidDefinition === undefined || typeof row.invalidDefinition === "boolean") ? { name, horizonMonths: row.horizonMonths, changes, ...(row.invalidDefinition === undefined ? {} : { invalidDefinition: row.invalidDefinition }) } : null;
}
export function scenarioDraftFingerprint(draft: ScenarioDraft) { return JSON.stringify([draft.name, draft.horizonMonths, draft.changes, Boolean(draft.invalidDefinition)]); }
export function decodeScenarioLibrary(raw: string): DeviceScenarioLibrary | null {
  if (new TextEncoder().encode(raw).byteLength > MAX_BYTES) return null;
  let value: any;try { value = JSON.parse(raw); } catch { return null; }
  if (!value || !exact(value, ["schemaVersion", "revision", "legacyImported", "scenarios"]) || value.schemaVersion !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 0 || typeof value.legacyImported !== "boolean" || !Array.isArray(value.scenarios) || value.scenarios.length > DEVICE_SCENARIO_LIMIT) return null;
  const scenarios: DeviceScenario[] = [];
  for (const row of value.scenarios) {
    if (!row || !exact(row, ["id", "version", "createdAt", "updatedAt", "name", "horizonMonths", "changes"])) return null;
    const draft = decodeScenarioDraft({ name: row.name, horizonMonths: row.horizonMonths, changes: row.changes });
    if (!draft || typeof row.id !== "string" || !row.id.startsWith("device-") || row.id.length > 160 || !Number.isSafeInteger(row.version) || row.version < 1 || ![row.createdAt, row.updatedAt].every(date => typeof date === "string" && Number.isFinite(Date.parse(date)))) return null;
    scenarios.push({ ...draft, id: row.id, version: row.version, createdAt: row.createdAt, updatedAt: row.updatedAt });
  }
  if (new Set(scenarios.map(row => row.id)).size !== scenarios.length) return null;
  return { ...value, scenarios };
}
export function decodeScenarioWorking(raw: string | null): ScenarioWorkingDraft | null {
  if (!raw || new TextEncoder().encode(raw).byteLength > 70_000) return null;
  let row: any;try { row = JSON.parse(raw); } catch { return null; }
  const draft = decodeScenarioDraft(row?.draft, true);
  return row && exact(row, ["schemaVersion", "selectedKey", "draft"]) && row.schemaVersion === 1 && (row.selectedKey === null || typeof row.selectedKey === "string" && row.selectedKey.length <= 200) && draft ? { schemaVersion: 1, selectedKey: row.selectedKey, draft } : null;
}
async function queued<T>(storage: ScenarioStorage, key: string, action: () => Promise<T>): Promise<T> {
  let map = queues.get(storage);if (!map) { map = new Map();queues.set(storage, map); }
  const previous = map.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(action);map.set(key, next);
  try { return await next; } finally { if (map.get(key) === next) map.delete(key); }
}
export async function persistScenarioLibrary(storage: ScenarioStorage, key: string, previous: DeviceScenarioLibrary, next: DeviceScenarioLibrary, isCurrent: () => boolean, lockManager?: ScenarioLockManager) {
  const raw = JSON.stringify(next);
  if (!decodeScenarioLibrary(raw)) throw new Error(`Keep up to ${DEVICE_SCENARIO_LIMIT} valid scenarios on this device. No saved scenarios were trimmed.`);
  const manager = lockManager ?? (typeof navigator !== "undefined" ? navigator.locks : undefined);
  const transaction = async () => {
    if (!isCurrent()) throw new Error("Your simulator account or household changed. Reopen the scenario before saving.");
    const existing = await storage.getItem(key);
    if (!isCurrent()) throw new Error("Your simulator account or household changed. Reopen the scenario before saving.");
    const stored = existing === null ? emptyScenarioLibrary() : decodeScenarioLibrary(existing);
    if (!stored || stored.revision !== previous.revision) throw new Error("This device library changed elsewhere. Use Reload saved scenarios, then save your working changes again.");
    await storage.setItem(key, raw);
    if (await storage.getItem(key) !== raw) throw new Error("This device could not verify the saved library. Your working changes are still open; use Reload saved scenarios to check it.");
  };
  return queued(storage, key, () => manager ? manager.request(`flowledger-scenario-library:${key}`, transaction) : transaction());
}
export function persistScenarioWorking(storage: ScenarioStorage, key: string, working: ScenarioWorkingDraft, isCurrent: () => boolean) {
  const raw = JSON.stringify(working);
  if (!decodeScenarioWorking(raw)) return Promise.reject(new Error("The working draft could not be saved on this device."));
  return queued(storage, key, async () => { if (isCurrent()) await storage.setItem(key, raw); });
}
export async function loadScenarioDeviceState(storage: ScenarioStorage, keys: ReturnType<typeof scenarioDeviceKeys>, isCurrent: () => boolean, now: string, newId: () => string) {
  await Promise.all([queues.get(storage)?.get(keys.library), queues.get(storage)?.get(keys.working)]);
  const [rawLibrary, rawWorking] = await Promise.all([storage.getItem(keys.library), storage.getItem(keys.working)]);
  let library = rawLibrary === null ? emptyScenarioLibrary() : decodeScenarioLibrary(rawLibrary);
  if (!library) throw new Error("This device library could not be read. Stored data was kept. Try loading it again.");
  let working = decodeScenarioWorking(rawWorking);
  if (rawWorking && !working) throw new Error("This device’s working draft could not be read. Stored data was kept. Try loading it again.");
  if (!rawLibrary && keys.legacy && isCurrent()) {
    const old = await storage.getItem(keys.legacy);
    let draft: ScenarioDraft | null = null;try { draft = old ? decodeScenarioDraft(JSON.parse(old)) : null; } catch { /* Keep the untouched legacy backup. */ }
    if (draft && !draft.invalidDefinition) {
      const saved: DeviceScenario = { name: draft.name, horizonMonths: draft.horizonMonths, changes: draft.changes, id: newId(), version: 1, createdAt: now, updatedAt: now };
      const migrated: DeviceScenarioLibrary = { schemaVersion: 1, revision: 1, legacyImported: true, scenarios: [saved] };
      await persistScenarioLibrary(storage, keys.library, library, migrated, isCurrent);
      library = migrated;
      working ??= { schemaVersion: 1, selectedKey: `device:${saved.id}`, draft };
      await persistScenarioWorking(storage, keys.working, working, isCurrent);
      // The old key remains an untouched backup. Presence of the verified new
      // library makes migration one-time, including interrupted working writes.
    }
  }
  if (!working && library.legacyImported && library.scenarios[0]) {
    const saved = library.scenarios[0];working = { schemaVersion: 1, selectedKey: `device:${saved.id}`, draft: { name: saved.name, horizonMonths: saved.horizonMonths, changes: saved.changes } };
  }
  return { library, working };
}
export function putDeviceScenario(library: DeviceScenarioLibrary, draft: ScenarioDraft, now: string, id: string, updateId?: string): { library: DeviceScenarioLibrary; saved: DeviceScenario } {
  const valid = decodeScenarioDraft(draft);
  if (!valid || valid.invalidDefinition) throw new Error("Reset unsupported changes and use a name between 1 and 80 characters before saving.");
  const existing = updateId ? library.scenarios.find(row => row.id === updateId) : null;
  if (library.scenarios.some(row => row.id !== updateId && row.name.toLocaleLowerCase() === valid.name.toLocaleLowerCase())) throw new Error("Use a different name for this saved scenario, or update the existing option.");
  if (updateId && !existing) throw new Error("This saved scenario is no longer available. Save it as a new option.");
  const saved: DeviceScenario = { name: valid.name, horizonMonths: valid.horizonMonths, changes: valid.changes, id: existing?.id ?? id, version: (existing?.version ?? 0) + 1, createdAt: existing?.createdAt ?? now, updatedAt: now };
  return { saved, library: { ...library, revision: library.revision + 1, scenarios: [saved, ...library.scenarios.filter(row => row.id !== saved.id)] } };
}
export function deleteDeviceScenario(library: DeviceScenarioLibrary, id: string): DeviceScenarioLibrary { return { ...library, revision: library.revision + 1, scenarios: library.scenarios.filter(row => row.id !== id) }; }
