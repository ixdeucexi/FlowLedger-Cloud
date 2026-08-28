import {
  occurrenceKey,
  type ReviewAllocationLike,
  type ReviewTransactionLike,
} from "./reviewCenter";

export interface FinancialDateRecord {
  date: string;
}

export interface FinancialProjectionIndexes<
  TTransaction extends FinancialDateRecord,
  TForecastTransaction extends FinancialDateRecord,
  TVisibleTransaction extends FinancialDateRecord,
  TCommitment extends FinancialDateRecord,
> {
  transactionsByMonth: Map<string, TTransaction[]>;
  forecastTransactionsByMonth: Map<string, TForecastTransaction[]>;
  visibleTransactionsByDate: Map<string, TVisibleTransaction[]>;
  commitmentsByMonth: Map<string, TCommitment[]>;
}

function pushIndexed<K, T>(index: Map<K, T[]>, key: K, value: T) {
  const bucket = index.get(key);
  if (bucket) bucket.push(value);
  else index.set(key, [value]);
}

export function indexRecordsByMonth<T extends FinancialDateRecord>(
  records: readonly T[],
): Map<string, T[]> {
  const index = new Map<string, T[]>();
  records.forEach(record => pushIndexed(index, record.date.slice(0, 7), record));
  return index;
}

export function indexRecordsByDate<T extends FinancialDateRecord>(
  records: readonly T[],
): Map<string, T[]> {
  const index = new Map<string, T[]>();
  records.forEach(record => pushIndexed(index, record.date.slice(0, 10), record));
  return index;
}

export function buildFinancialProjectionIndexes<
  TTransaction extends FinancialDateRecord,
  TForecastTransaction extends FinancialDateRecord,
  TVisibleTransaction extends FinancialDateRecord,
  TCommitment extends FinancialDateRecord,
>(input: {
  transactions: readonly TTransaction[];
  forecastTransactions: readonly TForecastTransaction[];
  visibleTransactions: readonly TVisibleTransaction[];
  commitments: readonly TCommitment[];
}): FinancialProjectionIndexes<
  TTransaction,
  TForecastTransaction,
  TVisibleTransaction,
  TCommitment
> {
  return {
    transactionsByMonth: indexRecordsByMonth(input.transactions),
    forecastTransactionsByMonth: indexRecordsByMonth(input.forecastTransactions),
    visibleTransactionsByDate: indexRecordsByDate(input.visibleTransactions),
    commitmentsByMonth: indexRecordsByMonth(input.commitments),
  };
}

export interface MatchedFinancialAllocationIndexes {
  bill: Map<string, ReviewAllocationLike>;
  income: Map<string, ReviewAllocationLike>;
  snowball: Map<string, ReviewAllocationLike>;
  reviewedBillIdsByMonth: Map<string, Set<string>>;
  paidBillAmountByMonth: Map<string, number>;
}

/**
 * Builds every allocation lookup in one immutable-ledger pass while preserving
 * the canonical matchedOccurrenceAllocations merge and settlement semantics.
 */
export function buildMatchedFinancialAllocationIndexes(
  transactions: ReviewTransactionLike[],
): MatchedFinancialAllocationIndexes {
  const bill = new Map<string, ReviewAllocationLike>();
  const income = new Map<string, ReviewAllocationLike>();
  const snowball = new Map<string, ReviewAllocationLike>();
  const reviewedBillIdsByMonth = new Map<string, Set<string>>();
  const paidBillAmountByMonth = new Map<string, number>();

  const merge = (
    matches: Map<string, ReviewAllocationLike>,
    allocation: ReviewAllocationLike,
  ) => {
    if (!allocation.targetId || !allocation.occurrenceDate) return;
    const key = occurrenceKey(allocation.targetId, allocation.occurrenceDate);
    const existing = matches.get(key);
    const amount = Math.max(0, Number(allocation.amount) || 0);
    const planned = Math.max(
      amount,
      Number(allocation.plannedAmount ?? allocation.amount) || 0,
    );
    const allocationClosed = allocation.settlement === "exact"
      || allocation.settlement === "full";
    if (!existing) {
      matches.set(key, {
        ...allocation,
        amount,
        plannedAmount: allocationClosed ? amount : planned,
      });
      return;
    }
    const combinedAmount = Math.round(
      (Number(existing.amount || 0) + amount) * 100,
    ) / 100;
    const historicalPlanned = Math.max(
      Number(existing.plannedAmount || 0),
      planned,
    );
    const existingClosed = existing.settlement === "exact"
      || existing.settlement === "full";
    const explicitlyClosed = existingClosed || allocationClosed;
    matches.set(key, {
      ...allocation,
      amount: combinedAmount,
      plannedAmount: explicitlyClosed ? combinedAmount : historicalPlanned,
      settlement: explicitlyClosed
        ? (allocationClosed ? allocation.settlement : existing.settlement)
        : historicalPlanned > 0 && combinedAmount + 0.005 < historicalPlanned
          ? "partial"
          : allocation.settlement,
    });
  };

  transactions.forEach(transaction => {
    if (transaction.review_status !== "matched") return;
    (transaction.review_allocations ?? []).forEach(allocation => {
      if (allocation.type === "bill") merge(bill, allocation);
      else if (allocation.type === "income") merge(income, allocation);
      else if (
        allocation.type === "extra_principal"
        && transaction.review_resolution === "snowball"
      ) merge(snowball, allocation);
    });
  });

  bill.forEach(match => {
    if (!match.targetId || !match.occurrenceDate) return;
    const monthPrefix = match.occurrenceDate.slice(0, 7);
    const ids = reviewedBillIdsByMonth.get(monthPrefix) ?? new Set<string>();
    ids.add(match.targetId);
    reviewedBillIdsByMonth.set(monthPrefix, ids);
    paidBillAmountByMonth.set(monthPrefix,
      (paidBillAmountByMonth.get(monthPrefix) ?? 0)
      + Math.max(0, Number(match.amount) || 0));
  });

  return {
    bill,
    income,
    snowball,
    reviewedBillIdsByMonth,
    paidBillAmountByMonth,
  };
}

/**
 * Read-through cache for one immutable input revision. The caller owns cache
 * replacement when source inputs change, so cache hits never need to rebuild a
 * dependency merely to discover whether the value is still valid.
 */
export function getOrComputeRevisionValue<K, V>(
  cache: Map<K, V>,
  key: K,
  compute: () => V,
): V {
  if (cache.has(key)) return cache.get(key) as V;
  const value = compute();
  cache.set(key, value);
  return value;
}

export function startCancellableStageQueue<THandle>(input: {
  stages: readonly (() => void)[];
  schedule: (work: () => void, delay: number) => THandle;
  cancelScheduled: (handle: THandle) => void;
  shouldYield?: () => boolean;
  initialDelay?: number;
  yieldDelay?: number;
  onError: (error: unknown) => void;
}): () => void {
  let cancelled = false;
  let stageIndex = 0;
  let pending: THandle | null = null;
  const scheduleNext = (delay: number) => {
    pending = input.schedule(runStage, delay);
  };
  const runStage = () => {
    pending = null;
    if (cancelled) return;
    if (input.shouldYield?.()) {
      scheduleNext(input.yieldDelay ?? 16);
      return;
    }
    try {
      input.stages[stageIndex]?.();
      stageIndex += 1;
      if (stageIndex < input.stages.length && !cancelled) scheduleNext(0);
    } catch (error) {
      if (!cancelled) input.onError(error);
    }
  };
  scheduleNext(input.initialDelay ?? 0);
  return () => {
    if (cancelled) return;
    cancelled = true;
    if (pending !== null) input.cancelScheduled(pending);
    pending = null;
  };
}

export function authoritativeFreshnessTimestamp(input: {
  currentTimestamp: string | null;
  revisionBeforeRefresh: string;
  revisionAfterRefresh: string;
  authoritativeTimestamp: string;
}): string | null {
  return input.revisionBeforeRefresh === input.revisionAfterRefresh
    ? input.currentTimestamp
    : input.authoritativeTimestamp;
}

/** A month projection cache is also scoped to the household-local as-of month. */
export function financialProjectionMonthCacheKey(
  asOfMonth: string,
  month: number,
  year: number,
): string {
  return `${asOfMonth}:${year}-${month}`;
}

export interface FinancialProjectionMonth {
  month: number;
  year: number;
}

function parsedMonthSerial(date: string | null | undefined): number | null {
  const match = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(date ?? "");
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  return month >= 0 && month <= 11 ? year * 12 + month : null;
}

/**
 * Returns the canonical month prefix that must be warmed before a target
 * projection can be read without replaying years of carryover in one task.
 * An observed balance may replace older history only when it is from a month
 * strictly before today; a same-month observation still needs the canonical
 * opening/reconciliation history.
 */
export function financialProjectionPreparationMonths(input: {
  asOfDate: string;
  startingBalanceDate?: string | null;
  observedAnchorDate?: string | null;
  targetMonth: number;
  targetYear: number;
}): FinancialProjectionMonth[] {
  const asOfSerial = parsedMonthSerial(input.asOfDate);
  const targetSerial = input.targetYear * 12 + input.targetMonth;
  if (asOfSerial === null || input.targetMonth < 0 || input.targetMonth > 11) {
    return [{ month: input.targetMonth, year: input.targetYear }];
  }

  const observedSerial = parsedMonthSerial(input.observedAnchorDate);
  const configuredStartSerial = parsedMonthSerial(input.startingBalanceDate);
  let startSerial = configuredStartSerial ?? asOfSerial - 1;
  if (observedSerial !== null && observedSerial < asOfSerial) {
    startSerial = observedSerial + 1;
  }
  // Always prepare the current month even if a future plan start was entered.
  startSerial = Math.min(startSerial, asOfSerial);
  if (startSerial > targetSerial) startSerial = targetSerial;

  const months: FinancialProjectionMonth[] = [];
  for (let serial = startSerial; serial <= targetSerial; serial += 1) {
    months.push({
      month: ((serial % 12) + 12) % 12,
      year: Math.floor(serial / 12),
    });
  }
  return months;
}

function structuralFinancialEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => structuralFinancialEqual(value, right[index]));
  }
  if (!left || !right || typeof left !== "object" || typeof right !== "object") {
    return false;
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).filter(key => leftRecord[key] !== undefined);
  const rightKeys = Object.keys(rightRecord).filter(key => rightRecord[key] !== undefined);
  return leftKeys.length === rightKeys.length
    && leftKeys.every(key => (
      Object.prototype.hasOwnProperty.call(rightRecord, key)
      && structuralFinancialEqual(leftRecord[key], rightRecord[key])
    ));
}

function financialRowIdentity(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  for (const key of ["id", "plaid_transaction_id", "plaid_account_id"] as const) {
    if (typeof record[key] === "string" && record[key]) return `${key}:${record[key]}`;
  }
  return null;
}

/**
 * Reuses an immutable financial source when cache and live normalization carry
 * identical rows. This prevents the background authoritative refresh from
 * invalidating every provider index immediately after warm-cache reveal.
 */
export function reuseStructurallyEqualFinancialValue<T>(current: T, next: T): T {
  if (Object.is(current, next)) return current;
  if (Array.isArray(current) && Array.isArray(next) && current.length === next.length) {
    // JSON's native implementation is substantially faster for the common
    // cache-hydrate -> equivalent normalized live payload. It also deliberately
    // ignores undefined fields, matching the structural fallback below.
    try {
      if (JSON.stringify(current) === JSON.stringify(next)) return current;
    } catch {
      // Non-serializable mutation inputs fall through to the safe comparator.
    }
    const currentByIdentity = new Map<string, unknown>();
    let identityComparable = current.length > 0;
    current.forEach(value => {
      const identity = financialRowIdentity(value);
      if (!identity || currentByIdentity.has(identity)) identityComparable = false;
      else currentByIdentity.set(identity, value);
    });
    if (identityComparable) {
      const nextIdentities = new Set<string>();
      let validIdentitySet = true;
      let changed = false;
      const sharedRows = next.map((value, index) => {
        const identity = financialRowIdentity(value);
        if (
          !identity
          || nextIdentities.has(identity)
          || !currentByIdentity.has(identity)
        ) {
          validIdentitySet = false;
          return value;
        }
        nextIdentities.add(identity);
        const prior = currentByIdentity.get(identity);
        if (!structuralFinancialEqual(prior, value)) {
          changed = true;
          return value;
        }
        // Preserve the next array's ordering contract. Reordering is a real
        // collection change even though unchanged row objects remain shared.
        if (prior !== current[index]) changed = true;
        return prior;
      });
      if (validIdentitySet && nextIdentities.size === currentByIdentity.size) {
        return (changed ? sharedRows : current) as T;
      }
    }
  }
  return structuralFinancialEqual(current, next) ? current : next;
}
