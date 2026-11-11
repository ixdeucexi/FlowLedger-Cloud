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
  currency_code?: string | null;
  id?: string | null;
  plaid_account_id?: string | null;
  persistent_account_id?: string | null;
  household_id?: string | null;
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
  /** Posted cash activity, including hidden posted bank history. Checking-only
   * by default; includeSavings also retains eligible savings-account cash. */
  cashTransactions: T[];
  /** Active rows that may be shown in Activity and calendar detail. */
  visibleTransactions: T[];
  /** Active cash rows used by day cards and summaries. Includes eligible savings
   * only for callers that explicitly request the full depository ledger. */
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

export type DepositoryTransactionAccountKind = "checking" | "savings" | "non_cash" | "unknown" | "not_plaid";
export interface DepositoryTransactionAccountClassification {
  accountKind: DepositoryTransactionAccountKind;
  /** Exact stored identity, also shared by retained reconnect rows when Plaid
   * supplies the same persistent identity. Never inferred from a name or mask. */
  accountIdentity: string | null;
}

/** Classify both provider IDs (posted rows) and internal row IDs (pending rows).
 * Retained inactive accounts still describe historical money movement. An alias
 * claimed by different accounts, or inconsistent metadata for one identity,
 * fails closed instead of depending on the order of the account list. */
export function createDepositoryTransactionAccountClassifier(
  connectedAccounts: readonly LedgerConnectedAccountLike[],
): (transaction: Pick<LedgerTransactionLike, "source" | "plaid_account_id">) => DepositoryTransactionAccountClassification {
  const byAlias = new Map<string, Set<string>>();
  const kindsByIdentity = new Map<string, Set<Exclude<DepositoryTransactionAccountKind, "not_plaid">>>();
  const metadataByIdentity = new Map<string, Set<string>>();
  for (const account of connectedAccounts) {
    const rowId = account.id || null;
    const providerId = account.plaid_account_id || null;
    if (!rowId && !providerId) continue;
    const persistent = account.persistent_account_id?.trim();
    const identity = JSON.stringify([account.household_id || null,
      persistent ? "persistent" : rowId ? "row" : "provider", persistent || rowId || providerId]);
    const type = String(account.account_type || "").trim().toLowerCase();
    const subtype = String(account.account_subtype || "").trim().toLowerCase();
    const unsupportedCurrency = account.currency_code != null && account.currency_code.trim().toUpperCase() !== "USD";
    const kind = unsupportedCurrency ? "non_cash" : type === "depository" && (subtype === "checking" || subtype === "savings")
      ? subtype : ["depository", "credit", "loan", "investment", "brokerage", "other"].includes(type) ? "non_cash" : "unknown";
    const kinds = kindsByIdentity.get(identity) ?? new Set();
    kinds.add(kind); kindsByIdentity.set(identity, kinds);
    const metadata = metadataByIdentity.get(identity) ?? new Set();
    metadata.add(JSON.stringify([type, subtype, unsupportedCurrency])); metadataByIdentity.set(identity, metadata);
    for (const alias of [rowId, providerId]) {
      if (!alias) continue;
      const claims = byAlias.get(alias) ?? new Set();
      claims.add(identity); byAlias.set(alias, claims);
    }
  }
  return transaction => {
    if (transaction.source !== "plaid") return { accountKind: "not_plaid", accountIdentity: null };
    const claims = transaction.plaid_account_id ? byAlias.get(transaction.plaid_account_id) : undefined;
    if (claims?.size !== 1) return { accountKind: "unknown", accountIdentity: null };
    const identity = claims.values().next().value!;
    const kinds = kindsByIdentity.get(identity)!;
    if (kinds.size !== 1 || kinds.has("unknown") || metadataByIdentity.get(identity)!.size !== 1) {
      return { accountKind: "unknown", accountIdentity: null };
    }
    return { accountKind: kinds.values().next().value!, accountIdentity: identity };
  };
}

export function createDepositoryTransactionAccountKindClassifier(
  connectedAccounts: readonly LedgerConnectedAccountLike[],
): (transaction: Pick<LedgerTransactionLike, "source" | "plaid_account_id">) => DepositoryTransactionAccountKind {
  const classify = createDepositoryTransactionAccountClassifier(connectedAccounts);
  return transaction => classify(transaction).accountKind;
}

/** Account-aware Activity and account forecasts retain savings alongside
 * checking, while credit, loans, and unresolved bank identities stay excluded. */
export function selectDepositoryTransactions<T extends LedgerTransactionLike>(
  transactions: readonly T[],
  connectedAccounts: readonly LedgerConnectedAccountLike[],
): AccountAwareTransactionSelection<T> {
  const classify = createDepositoryTransactionAccountKindClassifier(connectedAccounts);
  return transactions.reduce<AccountAwareTransactionSelection<T>>((result, transaction) => {
    const kind = classify(transaction);
    if (kind === "checking" || kind === "savings" || kind === "not_plaid") result.included.push(transaction);
    else if (kind === "unknown") result.unknownPlaid.push(transaction);
    else result.excludedNonCash.push(transaction);
    return result;
  }, { included: [], excludedNonCash: [], unknownPlaid: [] });
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
  options?: { suppressedTransactionIds?: ReadonlySet<string>; includeSavings?: boolean },
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
  const classifyDepositoryKind = options?.includeSavings
    ? createDepositoryTransactionAccountKindClassifier(connectedAccounts)
    : null;
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
    // Callers may consolidate an explicitly linked provisional replacement.
    // Keep the original rows outside this view for review and settlement facts.
    if (options?.suppressedTransactionIds?.has(transaction.id)) return;
    const accountKind = classifyDepositoryKind?.(transaction) ?? classifyAccountKind(transaction);
    // Only the account eligibility changes. The existing ledger classifier
    // remains authoritative for visibility, posted history and cash timing.
    const classification = classifyCheckingLedgerTransaction(
      transaction,
      connectedAccounts,
      accountKind === "savings" ? "checking" : accountKind,
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
    const included = accountKind === "checking" || accountKind === "savings"
      || accountKind === "not_plaid";
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
