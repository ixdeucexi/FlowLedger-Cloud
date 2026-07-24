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
  review_resolution?: string;
  review_allocations?: ReviewAllocationLike[];
  user_edited_at?: string;
  pending?: boolean;
  removed_at?: string;
}

export interface PlannedExpenseAllocationGroup {
  key: string;
  targetId: string;
  source: "goal" | "decision";
  name: string;
  occurrenceDate: string;
  plannedAmount: number;
  spentAmount: number;
  settlement: ReviewAllocationLike["settlement"];
  transactionIds: string[];
}

export interface ForgottenBillDefaults {
  name: string;
  amount: number;
  category: string;
  dueDay: number;
  nextPaymentDate: string;
  startDate: string;
  isRecurring: true;
  frequency: "monthly";
}

export type ReviewTargetType = "bill" | "income" | "goal" | "decision" | "snowball";

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

export function buildForgottenBillDefaults(transaction: Pick<ReviewTransactionLike, "amount" | "date" | "note" | "merchant_name" | "category">): ForgottenBillDefaults {
  const parsedDay = Number(transaction.date.slice(8, 10));
  return {
    name: transaction.merchant_name?.trim() || transaction.note?.trim() || transaction.category || "New bill",
    amount: Math.abs(transaction.amount),
    category: transaction.category && transaction.category !== "Income" ? transaction.category : "Other",
    dueDay: Number.isFinite(parsedDay) && parsedDay > 0 ? parsedDay : 1,
    nextPaymentDate: transaction.date,
    startDate: transaction.date,
    isRecurring: true,
    frequency: "monthly",
  };
}

export function forgottenBillSettlement(actualAmount: number, plannedAmount: number): "exact" | "full" {
  return Math.abs(Math.abs(actualAmount) - Math.abs(plannedAmount)) < 0.005 ? "exact" : "full";
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

export function reviewQueueAfterSkips<T extends Pick<ReviewTransactionLike, "id">>(queue: T[], skippedIds: string[]): T[] {
  if (skippedIds.length === 0) return queue;
  const skipped = new Set(skippedIds);
  return queue.filter(transaction => !skipped.has(transaction.id));
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

export function reviewSettlementSummary(transaction: Pick<ReviewTransactionLike, "amount" | "review_allocations">): { amount: number; paid: number; remaining: number } {
  const paid = Math.round(Math.abs(Number(transaction.amount) || 0) * 100) / 100;
  const allocations = (transaction.review_allocations ?? []).filter(allocation => allocation.type !== "transfer");
  if (allocations.length === 0) return { amount: paid, paid, remaining: 0 };

  const amount = Math.round(allocations.reduce((sum, allocation) => {
    const planned = allocation.plannedAmount ?? allocation.amount;
    return sum + Math.max(0, Number(planned) || 0);
  }, 0) * 100) / 100;
  const remaining = Math.round(allocations.reduce((sum, allocation) => {
    if (allocation.settlement !== "partial") return sum;
    return sum + Math.max(0, Number(allocation.plannedAmount ?? allocation.amount) - Number(allocation.amount || 0));
  }, 0) * 100) / 100;

  return { amount: amount || paid, paid, remaining };
}

export function occurrenceKey(targetId: string, occurrenceDate: string): string {
  return `${targetId}:${occurrenceDate.slice(0, 10)}`;
}

export function groupPlannedExpenseAllocations(
  transactions: ReviewTransactionLike[],
): PlannedExpenseAllocationGroup[] {
  const groups = new Map<string, PlannedExpenseAllocationGroup>();

  transactions.forEach(transaction => {
    if (transaction.review_status !== "matched") return;
    (transaction.review_allocations ?? []).forEach(allocation => {
      const source = allocation.source
        ?? (transaction.review_resolution === "goal" || transaction.review_resolution === "decision"
          ? transaction.review_resolution
          : undefined);
      if (allocation.type !== "planned_expense" || !allocation.targetId || !source) return;
      const occurrenceDate = allocation.occurrenceDate?.slice(0, 10) || transaction.date.slice(0, 10);
      const key = `${source}:${allocation.targetId}:${occurrenceDate}`;
      const existing = groups.get(key);
      const spentAmount = Math.max(0, Number(allocation.amount) || 0);
      const plannedAmount = Math.max(0, Number(allocation.plannedAmount ?? allocation.amount) || 0);

      if (!existing) {
        groups.set(key, {
          key,
          targetId: allocation.targetId,
          source,
          name: allocation.name || transaction.note || "Planned spending",
          occurrenceDate,
          plannedAmount,
          spentAmount,
          settlement: allocation.settlement,
          transactionIds: [transaction.id],
        });
        return;
      }

      existing.plannedAmount = Math.max(existing.plannedAmount, plannedAmount);
      existing.spentAmount = Math.round((existing.spentAmount + spentAmount) * 100) / 100;
      if (allocation.settlement && allocation.settlement !== "partial") existing.settlement = allocation.settlement;
      if (!existing.transactionIds.includes(transaction.id)) existing.transactionIds.push(transaction.id);
    });
  });

  return Array.from(groups.values()).sort((left, right) =>
    left.occurrenceDate.localeCompare(right.occurrenceDate) || left.name.localeCompare(right.name));
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
  type: "bill" | "income" | "extra_principal",
  resolution?: string,
): Map<string, ReviewAllocationLike> {
  const matches = new Map<string, ReviewAllocationLike>();
  transactions.forEach(transaction => {
    if (transaction.review_status !== "matched") return;
    if (resolution && transaction.review_resolution !== resolution) return;
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

export function groupReviewTargets(targets: RankedReviewTarget[]) {
  return {
    setAside: targets.filter(target => target.type === "goal" || target.type === "decision"),
    bills: targets.filter(target => target.type === "bill" || target.type === "snowball"),
    income: targets.filter(target => target.type === "income"),
  };
}

export type ReviewedBillMonthSettlement = {
  status: "partial" | "settled";
  actualAmount: number;
};

export function reviewedBillMonthSettlements(
  transactions: ReviewTransactionLike[],
): Map<string, ReviewedBillMonthSettlement> {
  const settlements = new Map<string, ReviewedBillMonthSettlement>();

  matchedOccurrenceAllocations(transactions, "bill").forEach(allocation => {
    if (!allocation.targetId || !allocation.occurrenceDate) return;
    const key = `${allocation.targetId}:${allocation.occurrenceDate.slice(0, 7)}`;
    const existing = settlements.get(key);
    settlements.set(key, {
      status: existing?.status === "partial" || allocation.settlement === "partial" ? "partial" : "settled",
      actualAmount: Math.round(((existing?.actualAmount ?? 0) + Math.max(0, Number(allocation.amount) || 0)) * 100) / 100,
    });
  });

  return settlements;
}

export function reviewedBillMonthSettlement(
  transactions: ReviewTransactionLike[],
  billId: string,
  monthPrefix: string,
): { status: "none" | ReviewedBillMonthSettlement["status"]; actualAmount: number } {
  return reviewedBillMonthSettlements(transactions).get(`${billId}:${monthPrefix}`)
    ?? { status: "none", actualAmount: 0 };
}

export function allocationLabel(transaction: ReviewTransactionLike): string | null {
  if (transaction.user_edited_at && transaction.note.trim()) return transaction.note.trim();
  const allocations = transaction.review_allocations ?? [];
  if (allocations.length === 0) return null;
  return allocations.map(allocation => {
    const label = allocation.name || allocation.category || (allocation.type === "transfer" ? "Transfer" : "Reviewed");
    return allocations.length > 1 ? `${label} $${allocation.amount.toFixed(2)}` : label;
  }).join(" + ");
}

export function transactionDisplayName(transaction: ReviewTransactionLike, plannedLabel?: string): string {
  if (transaction.user_edited_at && transaction.note.trim()) return transaction.note.trim();
  return plannedLabel || transaction.merchant_name?.trim() || transaction.note.trim() || transaction.category || "Transaction";
}

export function transactionCategoryParts(transaction: ReviewTransactionLike): { category: string; amount: number; label: string }[] {
  if (transaction.amount >= 0 || transaction.review_status === "transfer" || transaction.review_status === "needs_review") return [];
  if (transaction.user_edited_at && transaction.review_resolution === "category") {
    const category = transaction.category || "Other";
    return [{ category, amount: transaction.amount, label: transaction.note.trim() || category }];
  }
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
