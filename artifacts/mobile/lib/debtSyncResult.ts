export interface DebtSyncResult {
  changed: boolean;
  changed_transaction_ids: string[];
  changed_bill_ids: string[];
}

export const MAX_PARTIAL_DEBT_SYNC_IDS = 100;
const MAX_DEBT_SYNC_ID_LENGTH = 256;

export type DebtSyncRefreshPlan =
  | { mode: "none"; transactionIds: []; billIds: [] }
  | { mode: "partial"; transactionIds: string[]; billIds: string[] }
  | { mode: "full"; transactionIds: []; billIds: [] };

const FULL_REFRESH: DebtSyncRefreshPlan = {
  mode: "full",
  transactionIds: [],
  billIds: [],
};

function unwrapJsonbResult(value: unknown): unknown {
  let candidate = value;
  if (typeof candidate === "string") {
    try {
      candidate = JSON.parse(candidate) as unknown;
    } catch {
      return undefined;
    }
  }
  if (Array.isArray(candidate)) {
    if (candidate.length !== 1) return undefined;
    candidate = candidate[0];
    if (typeof candidate === "string") {
      try {
        candidate = JSON.parse(candidate) as unknown;
      } catch {
        return undefined;
      }
    }
  }
  return candidate;
}

function validatedIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_PARTIAL_DEBT_SYNC_IDS) return null;
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const valueId of value) {
    if (
      typeof valueId !== "string"
      || valueId.length === 0
      || valueId.length > MAX_DEBT_SYNC_ID_LENGTH
      || valueId.trim() !== valueId
      || seen.has(valueId)
    ) return null;
    seen.add(valueId);
    ids.push(valueId);
  }
  return ids;
}

export function debtSyncRefreshPlan(value: unknown): DebtSyncRefreshPlan {
  const candidate = unwrapJsonbResult(value);
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return FULL_REFRESH;
  const result = candidate as {
    changed?: unknown;
    changed_transaction_ids?: unknown;
    changed_bill_ids?: unknown;
  };
  if (typeof result.changed !== "boolean") return FULL_REFRESH;

  const transactionIds = validatedIds(result.changed_transaction_ids);
  const billIds = validatedIds(result.changed_bill_ids);
  if (
    !transactionIds
    || !billIds
    || transactionIds.length + billIds.length > MAX_PARTIAL_DEBT_SYNC_IDS
  ) return FULL_REFRESH;
  if (!result.changed) {
    return transactionIds.length === 0 && billIds.length === 0
      ? { mode: "none", transactionIds: [], billIds: [] }
      : FULL_REFRESH;
  }
  if (transactionIds.length === 0 && billIds.length === 0) return FULL_REFRESH;
  return { mode: "partial", transactionIds, billIds };
}

export function debtSyncRequiresRefresh(value: unknown): boolean {
  return debtSyncRefreshPlan(value).mode !== "none";
}

export function rowsExactlyMatchRequestedIds<T extends { id: string }>(
  rows: readonly T[],
  requestedIds: readonly string[],
): boolean {
  if (rows.length !== requestedIds.length) return false;
  const expected = new Set(requestedIds);
  const found = new Set<string>();
  for (const row of rows) {
    if (!expected.has(row.id) || found.has(row.id)) return false;
    found.add(row.id);
  }
  return found.size === expected.size;
}

export function replaceRowsById<T extends { id: string }>(
  current: readonly T[],
  changedIds: readonly string[],
  replacements: readonly T[],
): T[] {
  const changed = new Set(changedIds);
  const replacementById = new Map(replacements.map(row => [row.id, row]));
  const applied = new Set<string>();
  const merged: T[] = [];

  current.forEach(row => {
    if (!changed.has(row.id)) {
      merged.push(row);
      return;
    }
    const replacement = replacementById.get(row.id);
    if (replacement && !applied.has(row.id)) {
      merged.push(replacement);
      applied.add(row.id);
    }
  });
  changedIds.forEach(id => {
    const replacement = replacementById.get(id);
    if (replacement && !applied.has(id)) {
      merged.push(replacement);
      applied.add(id);
    }
  });
  return merged;
}
