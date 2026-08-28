import {
  classifyCheckingLedgerTransaction,
  createPlaidTransactionAccountKindClassifier,
} from "./billMatching";

export interface LedgerAllocationLike {
  amount?: number | null;
  plannedAmount?: number | null;
  settlement?: string | null;
}

export interface LedgerTransactionLike {
  id: string;
  date: string;
  amount: number;
  source?: string | null;
  import_hash?: string | null;
  plaid_transaction_id?: string | null;
  plaid_account_id?: string | null;
  removed_at?: string | null;
  deleted_at?: string | null;
  pending?: boolean | null;
  review_status?: string | null;
  review_allocations?: LedgerAllocationLike[] | null;
}

export interface LedgerConnectedAccountLike {
  id?: string | null;
  plaid_account_id?: string | null;
  account_type?: string | null;
  account_subtype?: string | null;
  is_active?: boolean | null;
}

export interface LedgerIssue {
  code: "duplicate_transaction_id" | "duplicate_plaid_transaction_id" | "allocation_mismatch" | "unknown_plaid_account";
  transactionId: string;
  detail: string;
}

export interface TransactionLedgerSnapshot<T extends LedgerTransactionLike> {
  /** Posted checking activity that changes cash, including hidden posted bank history. */
  cashTransactions: T[];
  /** Active rows that may be shown in Activity and calendar detail. */
  visibleTransactions: T[];
  /** Active checking rows used by day cards and activity summaries. */
  visibleCheckingTransactions: T[];
  cashTransactionsByMonth: ReadonlyMap<string, T[]>;
  visibleCheckingTransactionsByDate: ReadonlyMap<string, T[]>;
  cashByDate: ReadonlyMap<string, number>;
  issues: LedgerIssue[];
}

const CENT_TOLERANCE = 0.005;

export interface AccountAwareTransactionSelection<T> {
  included: T[];
  excludedNonCash: T[];
  unknownPlaid: T[];
}

/** Shared Activity/Review selector. Plaid rows appear only when their retained
 * account identity is checking; non-Plaid imports keep their existing behavior. */
export function selectFlowLedgerTransactions<T extends LedgerTransactionLike>(
  transactions: readonly T[],
  connectedAccounts: readonly LedgerConnectedAccountLike[],
): AccountAwareTransactionSelection<T> {
  const classifyAccountKind = createPlaidTransactionAccountKindClassifier(
    connectedAccounts,
  );
  return transactions.reduce<AccountAwareTransactionSelection<T>>((result, transaction) => {
    const kind = classifyAccountKind(transaction);
    if (kind === "checking" || kind === "not_plaid") result.included.push(transaction);
    else if (kind === "unknown") result.unknownPlaid.push(transaction);
    else result.excludedNonCash.push(transaction);
    return result;
  }, { included: [], excludedNonCash: [], unknownPlaid: [] });
}

function allocationTotal(transaction: LedgerTransactionLike): number {
  return (transaction.review_allocations ?? []).reduce(
    (sum, allocation) => sum + Math.abs(Number(allocation.amount) || 0),
    0,
  );
}

/**
 * Creates the one authoritative transaction view used by forecasts and summaries.
 *
 * The same row can be hidden from the UI and still remain in cash history when it
 * is a posted bank transaction. Pending and removed bank rows never change cash.
 */
export function buildTransactionLedger<T extends LedgerTransactionLike>(
  allTransactions: readonly T[],
  visibleTransactions: readonly T[],
  connectedAccounts: readonly LedgerConnectedAccountLike[],
): TransactionLedgerSnapshot<T> {
  const issues: LedgerIssue[] = [];
  const uniqueById = new Map<string, T>();
  const plaidIds = new Map<string, string>();

  allTransactions.forEach(transaction => {
    if (uniqueById.has(transaction.id)) {
      issues.push({
        code: "duplicate_transaction_id",
        transactionId: transaction.id,
        detail: "The same transaction row appeared more than once.",
      });
      return;
    }
    uniqueById.set(transaction.id, transaction);

    if (transaction.plaid_transaction_id && !transaction.removed_at && transaction.pending !== true) {
      const first = plaidIds.get(transaction.plaid_transaction_id);
      if (first) {
        issues.push({
          code: "duplicate_plaid_transaction_id",
          transactionId: transaction.id,
          detail: `Posted bank ID also appears on ${first}.`,
        });
      } else {
        plaidIds.set(transaction.plaid_transaction_id, transaction.id);
      }
    }

    const allocations = transaction.review_allocations ?? [];
    if (
      allocations.length > 0
      && transaction.review_status !== "needs_review"
      && Math.abs(allocationTotal(transaction) - Math.abs(Number(transaction.amount) || 0)) >= CENT_TOLERANCE
    ) {
      issues.push({
        code: "allocation_mismatch",
        transactionId: transaction.id,
        detail: "Review allocations do not equal the bank transaction amount.",
      });
    }
  });

  const visibleIds = new Set<string>();
  visibleTransactions.forEach(transaction => visibleIds.add(transaction.id));
  const classifyAccountKind = createPlaidTransactionAccountKindClassifier(
    connectedAccounts,
  );
  const cashTransactions: T[] = [];
  const visible: T[] = [];
  const visibleChecking: T[] = [];
  const cashTransactionsByMonth = new Map<string, T[]>();
  const visibleCheckingTransactionsByDate = new Map<string, T[]>();
  const cashByDate = new Map<string, number>();
  const pushIndexed = (
    index: Map<string, T[]>,
    key: string,
    transaction: T,
  ) => {
    const bucket = index.get(key);
    if (bucket) bucket.push(transaction);
    else index.set(key, [transaction]);
  };
  uniqueById.forEach(transaction => {
    const classification = classifyCheckingLedgerTransaction(
      transaction,
      connectedAccounts,
      classifyAccountKind(transaction),
    );
    if (classification.accountKind === "unknown") {
      issues.push({
        code: "unknown_plaid_account",
        transactionId: transaction.id,
        detail: "Plaid transaction account identity is unavailable; cash impact was excluded.",
      });
    }
    if (classification.checkingForecast) {
      cashTransactions.push(transaction);
      pushIndexed(
        cashTransactionsByMonth,
        transaction.date.slice(0, 7),
        transaction,
      );
      cashByDate.set(
        transaction.date,
        (cashByDate.get(transaction.date) ?? 0) + Number(transaction.amount || 0),
      );
    }
    const included = classification.accountKind === "checking"
      || classification.accountKind === "not_plaid";
    if (!included || !classification.active || !visibleIds.has(transaction.id)) return;
    visible.push(transaction);
    if (classification.checkingBalance) {
      visibleChecking.push(transaction);
      pushIndexed(
        visibleCheckingTransactionsByDate,
        transaction.date.slice(0, 10),
        transaction,
      );
    }
  });

  return {
    cashTransactions,
    visibleTransactions: visible,
    visibleCheckingTransactions: visibleChecking,
    cashTransactionsByMonth,
    visibleCheckingTransactionsByDate,
    cashByDate,
    issues,
  };
}

/**
 * A settled full/exact match replaces its plan. A partial match leaves only the
 * unpaid part. This helper keeps bills, income, and snowball plans consistent.
 */
export function remainingPlannedAmount(
  plannedAmount: number,
  match?: LedgerAllocationLike | null,
): number {
  const planned = Math.max(0, Number(match?.plannedAmount ?? plannedAmount) || 0);
  if (!match) return planned;
  if (match.settlement !== "partial") return 0;
  return Math.max(0, planned - Math.abs(Number(match.amount) || 0));
}
