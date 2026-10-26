import type { Goal, ReviewAllocation, Transaction } from "./financialProjectionTypes";

export type BucketPurchaseIntent = {
  bucketId: string;
  transactionId: string;
  transaction?: Pick<Transaction, "amount" | "date" | "category" | "note" | "account_id">;
};

type PurchaseLike = {
  amount: number; source?: string | null; import_hash?: string | null; transfer_group_id?: string | null;
  linked_bill_id?: string | null; linked_income_id?: string | null; linked_plan_id?: string | null; linked_plan_type?: string | null;
  debt_applied_bill_id?: string | null; debt_applied_amount?: number | null; review_status?: string | null; review_resolution?: string | null;
  review_allocations?: readonly { type?: string | null; source?: string | null; targetId?: string | null; amount?: number | null }[] | null;
};

export function bucketPurchaseAllocation(transaction: PurchaseLike, bucketId?: string): number {
  if (transaction.linked_plan_type !== "goal" || !transaction.linked_plan_id
    || (bucketId && transaction.linked_plan_id !== bucketId)) return 0;
  return Math.round((transaction.review_allocations ?? []).reduce((sum, allocation) =>
    allocation.type === "planned_expense" && allocation.targetId === transaction.linked_plan_id
      && (allocation.source == null || allocation.source === "goal")
      ? sum + Math.max(0, Number(allocation.amount) || 0) : sum, 0) * 100) / 100;
}

export function isBucketLinkedManualPurchase(transaction: PurchaseLike): boolean {
  return (transaction.source == null || transaction.source === "manual")
    && !transaction.import_hash && !transaction.transfer_group_id && !transaction.linked_bill_id
    && !transaction.linked_income_id && !transaction.debt_applied_bill_id
    && !(Math.abs(transaction.debt_applied_amount ?? 0) > 0.005)
    && transaction.review_status === "matched" && transaction.review_resolution === "goal"
    && transaction.amount < 0 && bucketPurchaseAllocation(transaction) > 0;
}

export function bucketPurchaseCandidates(transactions: readonly Transaction[], kind: "bank" | "manual", search = ""): Transaction[] {
  const query = search.trim().toLocaleLowerCase();
  return transactions.filter(transaction => {
    const bank = transaction.source === "plaid" || transaction.source === "statement";
    return (kind === "bank" ? bank : !bank && (transaction.source == null || transaction.source === "manual") && !transaction.import_hash)
      && Number.isFinite(transaction.amount) && transaction.amount < 0 && !transaction.pending
      && !transaction.removed_at && !transaction.deleted_at && !transaction.transfer_group_id
      && transaction.category !== "Transfer" && !transaction.linked_bill_id && !transaction.linked_income_id
      && !transaction.linked_plan_id && !transaction.debt_applied_bill_id
      && !(Math.abs(transaction.debt_applied_amount ?? 0) > 0.005)
      && transaction.review_status !== "matched" && transaction.review_status !== "transfer"
      && !transaction.review_allocations?.some(allocation => allocation.type !== "category")
      && (!query || `${transaction.merchant_name ?? ""} ${transaction.note} ${transaction.category} ${transaction.date} ${Math.abs(transaction.amount).toFixed(2)}`.toLocaleLowerCase().includes(query));
  }).slice().sort((left, right) => right.date.localeCompare(left.date) || left.id.localeCompare(right.id));
}

export function bucketPurchaseHistory(transactions: readonly Transaction[], bucketId: string) {
  return transactions.filter(transaction => !transaction.deleted_at && !transaction.removed_at && !transaction.pending)
    .map(transaction => ({ transaction, allocated: bucketPurchaseAllocation(transaction, bucketId) }))
    .filter(purchase => purchase.allocated > 0)
    .sort((left, right) => right.transaction.date.localeCompare(left.transaction.date) || left.transaction.id.localeCompare(right.transaction.id));
}

export function bucketPurchaseTransaction(transaction: Transaction, goal: Pick<Goal, "id">): Transaction {
  const allocation: ReviewAllocation = { type: "planned_expense", source: "goal", targetId: goal.id,
    amount: Math.abs(transaction.amount), occurrenceDate: transaction.date, settlement: "partial" };
  return { ...transaction, linked_plan_type: "goal", linked_plan_id: goal.id,
    review_status: "matched", review_resolution: "goal", review_allocations: [allocation],
    matched_occurrence_date: transaction.date, match_reason: "confirmed_bucket_purchase", match_confidence: 1 };
}
