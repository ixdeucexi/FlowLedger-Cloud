import { createPlaidTransactionAccountKindClassifier, isActiveTransaction } from "./billMatching";
import type { LedgerConnectedAccountLike, LedgerTransactionLike } from "./ledgerEngine";
import type { PendingPlanMatch } from "./pendingPlanMatches";

type Scope = { household_id?: string | null; budget_id?: string | null };
type ReplacementTransaction = LedgerTransactionLike & Scope & {
  category?: string;
  transfer_group_id?: string | null;
  linked_plan_id?: string | null;
  linked_bill_id?: string | null;
};

function sameAvailableScope(...rows: Scope[]): boolean {
  return (["household_id", "budget_id"] as const).every(key =>
    new Set(rows.map(row => row[key]).filter(Boolean)).size <= 1);
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** An explicit pending link can identify one cash event before review finishes.
 * This suppresses only its duplicate manual representation in forecast/calendar
 * views. Raw transactions and manual debt-settlement facts stay untouched. */
export function pendingManualReplacementIds<T extends ReplacementTransaction>(
  transactions: readonly T[], matches: readonly (PendingPlanMatch & Scope)[], accounts: readonly LedgerConnectedAccountLike[],
  bills: readonly { id: string; is_debt?: boolean | null }[] = [],
): ReadonlySet<string> {
  const readyMatches = matches.filter(match => match.status === "ready_review" && match.target_type === "manual");
  if (!readyMatches.length) return new Set();
  const byId = new Map<string, T | null>();
  const byPlaidId = new Map<string, T | null>();
  for (const transaction of transactions) {
    byId.set(transaction.id, byId.has(transaction.id) ? null : transaction);
    if (transaction.plaid_transaction_id) byPlaidId.set(transaction.plaid_transaction_id,
      byPlaidId.has(transaction.plaid_transaction_id) ? null : transaction);
  }
  const classifyAccount = createPlaidTransactionAccountKindClassifier(accounts);
  const debtIds = new Set(bills.filter(bill => bill.is_debt).map(bill => bill.id));
  const accountAliases = new Map<string, string | null>();
  for (const account of accounts) {
    const identity = account.plaid_account_id || account.id;
    if (!identity) continue;
    for (const alias of [account.id, account.plaid_account_id]) {
      if (!alias) continue;
      accountAliases.set(alias, accountAliases.has(alias) && accountAliases.get(alias) !== identity ? null : identity);
    }
  }
  const pairs: Array<{ manual: string; posted: string }> = [];
  const bankByManual = new Map<string, Set<string>>();
  const manualByBank = new Map<string, Set<string>>();
  for (const match of readyMatches) {
    const manual = byId.get(match.target_id);
    const byPostedId = match.posted_transaction_id ? byId.get(match.posted_transaction_id) : undefined;
    const byPostedPlaid = match.posted_plaid_transaction_id ? byPlaidId.get(match.posted_plaid_transaction_id) : undefined;
    if ((match.posted_transaction_id && !byPostedId) || (match.posted_plaid_transaction_id && !byPostedPlaid)) continue;
    if (byPostedId && byPostedPlaid && byPostedId.id !== byPostedPlaid.id) continue;
    const posted = byPostedId || byPostedPlaid;
    if (!manual || !posted || manual.id === posted.id) continue;
    if (posted.plaid_transaction_id && byPlaidId.get(posted.plaid_transaction_id) !== posted) continue;
    if (!isActiveTransaction(manual) || !isActiveTransaction(posted)) continue;
    if (!Number.isFinite(manual.amount) || manual.amount >= 0 || !Number.isFinite(posted.amount) || posted.amount >= 0) continue;
    if (!Number.isFinite(match.planned_amount) || match.planned_amount <= 0 || Math.abs(Math.abs(manual.amount) - match.planned_amount) > 0.005) continue;
    if (!Number.isFinite(match.pending_amount) || match.pending_amount <= 0) continue;
    if (!validDate(manual.date) || !validDate(posted.date) || !validDate(match.pending_transaction_date) || manual.date !== match.occurrence_date || manual.date.slice(0, 7) !== match.pending_transaction_date.slice(0, 7)) continue;
    if (manual.source === "plaid" || manual.import_hash || manual.transfer_group_id || manual.linked_plan_id || manual.category === "Transfer" || manual.review_status === "matched" || manual.review_status === "transfer") continue;
    if (manual.linked_bill_id && ((manual.source != null && manual.source !== "manual") || !debtIds.has(manual.linked_bill_id))) continue;
    if (posted.source !== "plaid" || posted.review_status !== "needs_review" || classifyAccount(posted) !== "checking") continue;
    if (match.pending_account_id && match.pending_account_id !== posted.plaid_account_id) {
      const pendingAccount = accountAliases.get(match.pending_account_id);
      if (!pendingAccount || pendingAccount !== accountAliases.get(posted.plaid_account_id || "")) continue;
    }
    if (!sameAvailableScope(manual, posted, match)) continue;
    pairs.push({ manual: manual.id, posted: posted.id });
    const banks = bankByManual.get(manual.id) ?? new Set<string>(); banks.add(posted.id); bankByManual.set(manual.id, banks);
    const manuals = manualByBank.get(posted.id) ?? new Set<string>(); manuals.add(manual.id); manualByBank.set(posted.id, manuals);
  }
  return new Set(pairs.filter(pair => bankByManual.get(pair.manual)?.size === 1 && manualByBank.get(pair.posted)?.size === 1).map(pair => pair.manual));
}
