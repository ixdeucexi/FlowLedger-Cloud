export interface ReviewAllocationLike {
  type: "bill" | "income" | "planned_expense" | "category" | "transfer" | "extra_principal";
  amount: number;
  targetId?: string | null;
  source?: "goal" | "decision";
  name?: string;
  category?: string | null;
  occurrenceDate?: string;
  plannedAmount?: number;
  settlement?: "exact" | "full" | "partial" | "split" | "extra_principal" | "regular";
}

export interface ReviewTransactionLike {
  id: string;
  amount: number;
  date: string;
  note: string;
  category: string;
  merchant_name?: string;
  source?: string;
  review_status?: string;
  review_allocations?: ReviewAllocationLike[];
  pending?: boolean;
  removed_at?: string;
}

export type ReviewTargetType = "bill" | "income" | "goal" | "decision";

export interface ReviewTarget {
  type: ReviewTargetType;
  id: string;
  name: string;
  category: string;
  plannedAmount: number;
  occurrenceDate: string;
  isDebt?: boolean;
}

export interface RankedReviewTarget extends ReviewTarget {
  score: number;
  daysApart: number;
  amountDifference: number;
  reasons: string[];
}

function parseIsoDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  if (![year, month, day].every(Number.isFinite)) return null;
  return Date.UTC(year, month - 1, day);
}

const GENERIC_BANK_TOKENS = new Set([
  "bank", "card", "debit", "electronic", "online", "payment", "pmt", "posted", "purchase", "transaction", "withdrawal",
]);

function normalizedTokens(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(token => token.length > 2 && !GENERIC_BANK_TOKENS.has(token));
}

export function buildCurrentMonthReviewQueue<T extends ReviewTransactionLike>(transactions: T[], todayIso: string): T[] {
  const monthPrefix = todayIso.slice(0, 7);
  return transactions
    .filter(transaction => !transaction.removed_at && transaction.pending !== true)
    .filter(transaction => transaction.source === "plaid")
    .filter(transaction => transaction.date.startsWith(monthPrefix))
    .filter(transaction => transaction.review_status === "needs_review")
    .sort((left, right) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id));
}

export function rankReviewTargets(transaction: Pick<ReviewTransactionLike, "amount" | "date" | "note" | "merchant_name" | "category">, targets: ReviewTarget[]): RankedReviewTarget[] {
  const actual = Math.abs(transaction.amount);
  const txDate = parseIsoDate(transaction.date);
  const descriptionTokens = new Set(normalizedTokens(transaction.merchant_name || transaction.note || transaction.category || ""));

  return targets.map(target => {
    const amountDifference = Math.abs(actual - target.plannedAmount);
    const amountRatio = target.plannedAmount > 0 ? amountDifference / target.plannedAmount : 1;
    const targetDate = parseIsoDate(target.occurrenceDate);
    const daysApart = txDate !== null && targetDate !== null ? Math.round(Math.abs(txDate - targetDate) / 86_400_000) : 99;
    const targetTokens = normalizedTokens(`${target.name} ${target.category}`);
    const tokenMatches = targetTokens.filter(token => descriptionTokens.has(token)).length;
    const reasons: string[] = [];
    let score = 0;

    if (amountDifference < 0.005) { score += 56; reasons.push("Exact amount"); }
    else if (amountRatio <= 0.05) { score += 45; reasons.push("Amount is very close"); }
    else if (amountRatio <= 0.2) { score += 28; reasons.push("Amount is close"); }
    else if (amountRatio <= 0.5) score += 10;

    if (daysApart === 0) { score += 30; reasons.push("Same date"); }
    else if (daysApart <= 2) { score += 24; reasons.push(`${daysApart} day${daysApart === 1 ? "" : "s"} from plan`); }
    else if (daysApart <= 7) { score += 14; reasons.push(`${daysApart} days from plan`); }
    else if (daysApart <= 14) score += 5;

    if (tokenMatches >= 2) { score += 30; reasons.push("Name strongly matches"); }
    else if (tokenMatches === 1) { score += 14; reasons.push("Name matches"); }
    if ((transaction.amount > 0) === (target.type === "income")) score += 4;

    return { ...target, score, daysApart, amountDifference, reasons };
  }).sort((left, right) => right.score - left.score || left.daysApart - right.daysApart || left.amountDifference - right.amountDifference);
}

export function allocationTotal(allocations: ReviewAllocationLike[] | undefined): number {
  return Math.round((allocations ?? []).reduce((sum, allocation) => sum + Math.max(0, Number(allocation.amount) || 0), 0) * 100) / 100;
}

export function allocationAmount(transaction: ReviewTransactionLike, type: ReviewAllocationLike["type"]): number {
  return Math.round((transaction.review_allocations ?? [])
    .filter(allocation => allocation.type === type)
    .reduce((sum, allocation) => sum + Math.max(0, allocation.amount), 0) * 100) / 100;
}

export function occurrenceKey(targetId: string, occurrenceDate: string): string {
  return `${targetId}:${occurrenceDate.slice(0, 10)}`;
}

export function matchedOccurrenceKeys(
  transactions: ReviewTransactionLike[],
  type: "bill" | "income",
): Set<string> {
  const keys = new Set<string>();
  transactions.forEach(transaction => {
    if (transaction.review_status !== "matched") return;
    (transaction.review_allocations ?? []).forEach(allocation => {
      if (allocation.type !== type || !allocation.targetId || !allocation.occurrenceDate) return;
      keys.add(occurrenceKey(allocation.targetId, allocation.occurrenceDate));
    });
  });
  return keys;
}

export function matchedOccurrenceAllocations(
  transactions: ReviewTransactionLike[],
  type: "bill" | "income",
): Map<string, ReviewAllocationLike> {
  const matches = new Map<string, ReviewAllocationLike>();
  transactions.forEach(transaction => {
    if (transaction.review_status !== "matched") return;
    (transaction.review_allocations ?? []).forEach(allocation => {
      if (allocation.type !== type || !allocation.targetId || !allocation.occurrenceDate) return;
      const key = occurrenceKey(allocation.targetId, allocation.occurrenceDate);
      const existing = matches.get(key);
      if (!existing) {
        matches.set(key, { ...allocation });
        return;
      }
      const amount = Number(existing.amount || 0) + Number(allocation.amount || 0);
      const plannedAmount = Math.max(Number(existing.plannedAmount || 0), Number(allocation.plannedAmount || 0));
      matches.set(key, {
        ...allocation,
        amount,
        plannedAmount,
        settlement: plannedAmount > 0 && amount + 0.005 < plannedAmount ? "partial" : allocation.settlement,
      });
    });
  });
  return matches;
}

export function allocationLabel(transaction: ReviewTransactionLike): string | null {
  const allocations = transaction.review_allocations ?? [];
  if (allocations.length === 0) return null;
  return allocations.map(allocation => {
    const label = allocation.name || allocation.category || (allocation.type === "transfer" ? "Transfer" : "Reviewed");
    return allocations.length > 1 ? `${label} $${allocation.amount.toFixed(2)}` : label;
  }).join(" + ");
}

export function transactionCategoryParts(transaction: ReviewTransactionLike): { category: string; amount: number; label: string }[] {
  if (transaction.amount >= 0 || transaction.review_status === "transfer") return [];
  const allocations = transaction.review_allocations ?? [];
  if (allocations.length === 0) {
    return [{ category: transaction.category || "Other", amount: transaction.amount, label: transaction.note || transaction.category || "Transaction" }];
  }
  return allocations.flatMap(allocation => {
    if (allocation.type === "income" || allocation.type === "transfer") return [];
    const category = allocation.type === "extra_principal" ? "Debt" : allocation.category || transaction.category || "Other";
    return [{ category, amount: -Math.abs(allocation.amount), label: allocation.name || allocation.category || transaction.note || category }];
  });
}

export function reviewAllocationsAreBalanced(transaction: Pick<ReviewTransactionLike, "amount" | "review_allocations">): boolean {
  return Math.abs(allocationTotal(transaction.review_allocations) - Math.abs(transaction.amount)) < 0.005;
}
