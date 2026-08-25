export type FinancialMutationRetry = () => Promise<void>;

export interface FinancialMutationControls {
  onStarted: () => void;
  onCompleted: () => void;
  onFailed: (error: unknown, retry: FinancialMutationRetry) => void;
}

export interface FinancialMutationScope {
  userId: string | null;
  householdId: string | null;
  generation: number;
}

export function financialMutationScopeMatches(
  expected: FinancialMutationScope,
  current: FinancialMutationScope,
): boolean {
  return expected.userId === current.userId
    && expected.householdId === current.householdId
    && expected.generation === current.generation;
}

/**
 * A retry is an instruction for one exact user and household. Once either the
 * auth/household scope or the save lifecycle changes, executing that retry
 * would risk applying an old intent to newly rendered data.
 */
export function assertFinancialMutationScope(
  expected: FinancialMutationScope,
  current: FinancialMutationScope,
): void {
  if (!financialMutationScopeMatches(expected, current)) {
    throw new Error("This change belongs to a previous household. Refresh and try it again there.");
  }
}

export interface SingleFlightHolder<T> {
  current: Promise<T> | null;
}

/** Serializes mutations that replace the same logical row. */
export function enqueueMutationByKey<T>(
  queues: Map<string, Promise<unknown>>,
  key: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  queues.set(key, current);
  void current.then(
    () => { if (queues.get(key) === current) queues.delete(key); },
    () => { if (queues.get(key) === current) queues.delete(key); },
  );
  return current;
}

/** Acquires multiple logical-row queues in stable order for one atomic RPC. */
export function enqueueMutationByKeys<T>(
  queues: Map<string, Promise<unknown>>,
  keys: readonly string[],
  operation: () => Promise<T>,
): Promise<T> {
  const ordered = [...new Set(keys)].sort();
  if (ordered.length === 0) return Promise.resolve().then(operation);
  const previous = ordered.map(key => queues.get(key) ?? Promise.resolve());
  const current = Promise.all(previous.map(promise => promise.catch(() => undefined)))
    .then(operation);
  ordered.forEach(key => queues.set(key, current));
  void current.then(
    () => ordered.forEach(key => { if (queues.get(key) === current) queues.delete(key); }),
    () => ordered.forEach(key => { if (queues.get(key) === current) queues.delete(key); }),
  );
  return current;
}

/**
 * Removes fields superseded by a newer user intent before a queued write runs.
 * Explicit `undefined` values are retained because they represent clearing a
 * nullable override column.
 */
export function activeVersionedPatch<T extends object>(
  patch: T,
  token: string,
  currentTokens: ReadonlyMap<string, string>,
): Partial<T> {
  return Object.fromEntries(
    Object.entries(patch).filter(([field]) => currentTokens.get(field) === token),
  ) as Partial<T>;
}

/**
 * Rolls back only fields that still belong to the failed intent and still hold
 * its optimistic value. A newer edit to the same or another field is preserved.
 */
export function rollbackVersionedPatch<T extends object>(
  current: T,
  previous: T | undefined,
  optimistic: T,
  fields: readonly string[],
  token: string,
  appliedTokens: ReadonlyMap<string, string>,
): T {
  const next = { ...current } as T;
  for (const field of fields) {
    if (appliedTokens.get(field) !== token) continue;
    const key = field as keyof T;
    if (!Object.is(current[key], optimistic[key])) continue;
    if (previous && Object.prototype.hasOwnProperty.call(previous, field)) {
      next[key] = previous[key];
    } else {
      delete next[key];
    }
  }
  return next;
}

/**
 * Builds the sparse database patch for one monthly occurrence. Omitted fields
 * stay omitted so a concurrent reconciliation keeps ownership of its paid
 * columns; explicit `undefined` still means clear the nullable column.
 */
export function monthlyOverridePatchDbPayload<T extends object>(
  patch: T,
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(patch).map(([field, value]) => [
    field,
    field === "paid_amount" ? value ?? 0 : value ?? null,
  ]));
}

/** Coalesces repeated taps while the same retry is still in flight. */
export function runSingleFlight<T>(
  holder: SingleFlightHolder<T>,
  operation: () => Promise<T>,
): Promise<T> {
  if (holder.current) return holder.current;
  const inFlight = Promise.resolve().then(operation);
  const tracked = inFlight.finally(() => {
    if (holder.current === tracked) holder.current = null;
  });
  holder.current = tracked;
  return tracked;
}

export type TransactionRestoreState = "needs_restore" | "already_restored" | "conflict";

export function classifyTransactionRestoreState(
  rows: ReadonlyArray<{ id: string; deleted_at?: string | null }>,
  expectedIds: readonly string[],
): TransactionRestoreState {
  const expected = new Set(expectedIds);
  if (rows.length !== expected.size
    || rows.some(row => !expected.has(row.id))
    || expectedIds.some(id => !rows.some(row => row.id === id))) {
    return "conflict";
  }
  if (rows.every(row => !!row.deleted_at)) return "needs_restore";
  if (rows.every(row => !row.deleted_at)) return "already_restored";
  return "conflict";
}

/**
 * Gives every user-triggered financial write the same visible lifecycle.
 * The caller owns the retry closure so it can capture stable client ids and
 * send the exact same request after an interrupted response.
 */
export async function runRecoverableFinancialMutation<T>(
  operation: () => Promise<T>,
  retry: () => Promise<unknown>,
  controls: FinancialMutationControls,
): Promise<T> {
  controls.onStarted();
  try {
    const result = await operation();
    controls.onCompleted();
    return result;
  } catch (error) {
    controls.onFailed(error, async () => { await retry(); });
    throw error;
  }
}

export type ReconciliationResolution =
  | "bill"
  | "income"
  | "goal"
  | "decision"
  | "category"
  | "transfer"
  | "snowball"
  | "manual";

export interface ReconciliationRetryIntent {
  transactionId: string;
  resolution: ReconciliationResolution;
  targetId?: string;
  occurrenceDate?: string;
  plannedAmount?: number;
  settlement?: string;
  extraCategory?: string;
}

interface StoredReviewAllocation {
  type?: string;
  source?: string;
  targetId?: string | null;
  category?: string | null;
  amount?: number;
  plannedAmount?: number;
  occurrenceDate?: string;
  settlement?: string;
}

export interface StoredReconciledTransaction {
  id: string;
  category?: string;
  review_status?: string;
  review_resolution?: string;
  linked_bill_id?: string;
  linked_income_id?: string;
  linked_plan_id?: string;
  linked_plan_type?: string;
  matched_occurrence_date?: string;
  review_allocations?: StoredReviewAllocation[];
}

export function isAlreadyReviewedError(error: unknown): boolean {
  const message = error instanceof Error
    ? error.message
    : typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : String(error ?? "");
  return /already (?:been )?reviewed|review state changed/i.test(message);
}

function moneyMatches(left: number | undefined, right: number | undefined): boolean {
  if (left === undefined && right === undefined) return true;
  if (left === undefined || right === undefined) return false;
  return Math.abs(left - right) < 0.005;
}

function expectedAllocationType(resolution: ReconciliationResolution): string | undefined {
  if (resolution === "bill") return "bill";
  if (resolution === "income") return "income";
  if (["goal", "decision", "manual"].includes(resolution)) return "planned_expense";
  if (resolution === "snowball") return "extra_principal";
  if (resolution === "category") return "category";
  if (resolution === "transfer") return "transfer";
  return undefined;
}

/**
 * Confirms that an "already reviewed" response represents the same request,
 * rather than silently accepting a conflicting second decision. This is the
 * client recovery path when an RPC committed but its response was interrupted.
 */
export function reconciledTransactionMatchesIntent(
  transaction: StoredReconciledTransaction,
  intent: ReconciliationRetryIntent,
): boolean {
  const expectedStatus = intent.resolution === "category"
    ? "categorized"
    : intent.resolution === "transfer"
      ? "transfer"
      : "matched";
  if (transaction.id !== intent.transactionId
    || transaction.review_status !== expectedStatus
    || transaction.review_resolution !== intent.resolution) return false;

  if (intent.resolution === "bill" && transaction.linked_bill_id !== intent.targetId) return false;
  if (intent.resolution === "income" && transaction.linked_income_id !== intent.targetId) return false;
  if (["goal", "decision", "manual"].includes(intent.resolution)
    && transaction.linked_plan_id !== intent.targetId) return false;
  if (intent.resolution === "category" && transaction.category !== intent.targetId) return false;
  if (intent.occurrenceDate !== undefined
    && transaction.matched_occurrence_date !== intent.occurrenceDate) return false;
  if (intent.extraCategory !== undefined) {
    const storedExtraCategory = (transaction.review_allocations ?? [])
      .find(candidate => candidate.type === "category")?.category;
    if (storedExtraCategory !== intent.extraCategory) return false;
  }

  const expectedType = expectedAllocationType(intent.resolution);
  const allocation = (transaction.review_allocations ?? []).find(candidate => {
    if (expectedType && candidate.type !== expectedType) return false;
    if (intent.resolution === "category") return candidate.category === intent.targetId;
    if (intent.resolution === "transfer") return true;
    if (intent.targetId && candidate.targetId !== intent.targetId) return false;
    return true;
  });
  if (!allocation && !["category", "transfer"].includes(intent.resolution)) return false;
  if (allocation) {
    if (intent.occurrenceDate !== undefined && allocation.occurrenceDate !== intent.occurrenceDate) return false;
    if (intent.plannedAmount !== undefined && !moneyMatches(allocation.plannedAmount, intent.plannedAmount)) return false;
    if (intent.settlement !== undefined && allocation.settlement !== intent.settlement) return false;
  }
  return true;
}
