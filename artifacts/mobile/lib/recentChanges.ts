export type RecentChangeKind = "money" | "text" | "date" | "boolean" | "number";
export type RecentChangeValue = string | number | boolean | null;
export type RecentChangeEntity = "bill" | "debt" | "income" | "transaction" | "bucket" | "goal";

export interface RecentChangeField {
  key: string;
  label: string;
  kind: RecentChangeKind;
  before: RecentChangeValue;
  after: RecentChangeValue;
}
export interface RecentChange {
  id: string;
  sequence: number;
  householdId: string;
  budgetId: string;
  action: "created" | "updated" | "deleted";
  entityType: RecentChangeEntity;
  entityId: string;
  label: string;
  actorId: string | null;
  actorLabel: string;
  source: "flo" | "manual" | "system";
  createdAt: string;
  changes: RecentChangeField[];
  canUndo: boolean;
  undoReason: string | null;
  undoneAt: string | null;
  route: string;
}
export interface RecentChangesPage {
  items: RecentChange[];
  nextCursor: string | null;
}
export interface RecentChangesScope { userId: string; householdId: string; budgetId: string }

export const RECENT_CHANGE_ROUTES: Readonly<Record<RecentChangeEntity, string>> = {
  bill: "/(tabs)/bills",
  debt: "/(tabs)/bills?view=debt",
  income: "/(tabs)/more?section=money",
  transaction: "/(tabs)/transactions",
  bucket: "/(tabs)/more?section=buckets",
  goal: "/(tabs)/more?section=goals",
};
export const RECENT_CHANGE_DESTINATIONS: Readonly<Record<RecentChangeEntity, string>> = {
  bill: "Open Bills", debt: "Open Debt", income: "Open income settings",
  transaction: "Open Activity", bucket: "Open Buckets", goal: "Open savings goals",
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max: number): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= max;
const timestamp = (value: unknown): value is string => text(value, 80) && Number.isFinite(Date.parse(value));
const primitive = (value: unknown): value is RecentChangeValue => value === null || typeof value === "boolean" || (typeof value === "string" && value.length <= 3000) || (typeof value === "number" && Number.isFinite(value));
const kinds: readonly string[] = ["money", "text", "date", "boolean", "number"];

export function recentChangesScopeKey(scope: RecentChangesScope | null): string | null {
  return scope && uuid.test(scope.userId) && uuid.test(scope.householdId) && uuid.test(scope.budgetId)
    ? `${scope.userId}:${scope.householdId}:${scope.budgetId}` : null;
}
export function validRecentChangesCursor(value: unknown): value is string {
  return typeof value === "string" && /^[1-9][0-9]{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n;
}
function validField(value: unknown): value is RecentChangeField {
  if (!object(value) || !text(value.key, 100) || !text(value.label, 160) || !kinds.includes(String(value.kind)) || !primitive(value.before) || !primitive(value.after)) return false;
  const values = [value.before, value.after].filter(v => v !== null);
  if (value.kind === "money" || value.kind === "number") return values.every(v => typeof v === "number");
  if (value.kind === "boolean") return values.every(v => typeof v === "boolean");
  if (value.kind === "date") return values.every(v => typeof v === "string" && v.length <= 100);
  return true;
}

/** Fail closed on foreign scope, malformed money, unsafe routes or broken paging. */
export function parseRecentChangesPage(value: unknown, scope: RecentChangesScope, limit = 25, beforeCursor: string | null = null): RecentChangesPage {
  const invalid = () => new Error("Recent changes could not be verified. Refresh and try again.");
  if (!recentChangesScopeKey(scope) || !Number.isInteger(limit) || limit < 1 || limit > 50 || beforeCursor !== null && !validRecentChangesCursor(beforeCursor) || !object(value) || !Array.isArray(value.items) || value.items.length > limit || !(value.nextCursor === null || validRecentChangesCursor(value.nextCursor))) throw invalid();
  const items: RecentChange[] = [];
  const seen = new Set<string>();
  let previous = Number.POSITIVE_INFINITY;
  for (const candidate of value.items) {
    if (!object(candidate) || typeof candidate.id !== "string" || !uuid.test(candidate.id) || seen.has(candidate.id)
      || !Number.isSafeInteger(candidate.sequence) || Number(candidate.sequence) < 1 || Number(candidate.sequence) >= previous
      || beforeCursor !== null && BigInt(Number(candidate.sequence)) >= BigInt(beforeCursor)
      || candidate.householdId !== scope.householdId || candidate.budgetId !== scope.budgetId
      || !["created", "updated", "deleted"].includes(String(candidate.action))
      || !Object.hasOwn(RECENT_CHANGE_ROUTES, String(candidate.entityType))
      || candidate.route !== RECENT_CHANGE_ROUTES[candidate.entityType as RecentChangeEntity]
      || !text(candidate.entityId, 240) || !text(candidate.label, 240)
      || !(candidate.actorId === null || typeof candidate.actorId === "string" && uuid.test(candidate.actorId))
      || !text(candidate.actorLabel, 240) || !["flo", "manual", "system"].includes(String(candidate.source))
      || !timestamp(candidate.createdAt) || !Array.isArray(candidate.changes) || candidate.changes.length > 100 || !candidate.changes.every(validField)
      || typeof candidate.canUndo !== "boolean" || !(candidate.undoReason === null || text(candidate.undoReason, 1000))
      || !(candidate.undoneAt === null || timestamp(candidate.undoneAt))
      || candidate.canUndo && (candidate.undoneAt !== null || candidate.undoReason !== null)) throw invalid();
    seen.add(candidate.id);
    previous = Number(candidate.sequence);
    items.push(candidate as unknown as RecentChange);
  }
  if (value.nextCursor !== null && (!items.length || value.nextCursor !== String(items[items.length - 1].sequence))) throw invalid();
  return { items, nextCursor: value.nextCursor as string | null };
}

export function appendRecentChanges(current: readonly RecentChange[], next: readonly RecentChange[]): RecentChange[] {
  const items = new Map(current.map(item => [item.id, item]));
  for (const item of next) if (!items.has(item.id)) items.set(item.id, item);
  return [...items.values()].sort((a, b) => b.sequence - a.sequence);
}
export function formatRecentChangeValue(field: RecentChangeField, value: RecentChangeValue): string {
  if (value === null) return "Not set";
  if (field.kind === "money" && typeof value === "number") return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
  if (field.kind === "boolean") return value ? "Yes" : "No";
  if (field.kind === "date" && typeof value === "string") {
    const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value);
    if (Number.isFinite(date.getTime())) return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }
  if (field.key === "interest_rate" && typeof value === "number") return `${value}%`;
  return String(value);
}

/** Invalidate synchronously when a signed-in scope changes, even before effects. */
export function createRecentChangesRequestGate() {
  let scope: string | null = null, generation = 0;
  return {
    setScope(next: string | null) { if (scope !== next) { scope = next; generation += 1; } },
    begin() { return { scope, generation: ++generation }; },
    isCurrent(token: { scope: string | null; generation: number }) { return token.scope !== null && token.scope === scope && token.generation === generation; },
    invalidate() { generation += 1; },
  };
}
