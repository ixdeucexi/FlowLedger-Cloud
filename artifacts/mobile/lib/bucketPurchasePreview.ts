import type { FinancialProjectionSnapshot, Goal, Transaction } from "./financialProjectionTypes";
import { safeLocalDateInTimeZone } from "./financialProjection";
import { bucketPurchaseAllocation, bucketPurchaseTransaction } from "./bucketPurchases";
import { previewProjectionChangeSafetyStop } from "./transactionSafetyStop";

export function previewBucketPurchase(input: {
  snapshot: FinancialProjectionSnapshot; bucketId: string; transaction: Omit<Transaction, "id"> | Transaction;
  now: Date; timeZone: string;
}) {
  const { snapshot, bucketId, transaction, now, timeZone } = input;
  const bucket = snapshot.goals.find(goal => goal.id === bucketId && goal.goal_type === "planned_expense");
  if (!bucket || transaction.amount >= 0) return null;
  const id = "id" in transaction ? transaction.id : "bucket-purchase-preview";
  const existing = snapshot.transactions.find(item => item.id === id);
  const oldAllocation = existing ? bucketPurchaseAllocation(existing, bucketId) : 0;
  const next = { ...snapshot,
    transactions: [...snapshot.transactions.filter(item => item.id !== id), bucketPurchaseTransaction({ ...transaction, id }, bucket)],
    goals: snapshot.goals.map(goal => goal.id === bucketId
      ? { ...goal, current_amount: Math.max(0, goal.current_amount - oldAllocation + Math.abs(transaction.amount)) } : goal),
  };
  return previewProjectionChangeSafetyStop({ before: snapshot, after: next, start: existing && existing.date < transaction.date ? existing.date : transaction.date, end: existing && existing.date > transaction.date ? existing.date : transaction.date, transaction, now, timeZone });
}

export function previewBucketBudget(input: { snapshot: FinancialProjectionSnapshot; goal: Goal; now: Date; timeZone: string }) {
  const { snapshot, goal, now, timeZone } = input;
  const existing = snapshot.goals.find(item => item.id === goal.id);
  if (!existing) return null;
  const start = [existing.target_date, goal.target_date, safeLocalDateInTimeZone(now, timeZone)].sort()[0];
  return previewProjectionChangeSafetyStop({ before: snapshot,
    after: { ...snapshot, goals: snapshot.goals.map(item => item.id === goal.id ? { ...goal, current_amount: item.current_amount } : item) },
    start, transaction: { amount: -Math.max(0, goal.target_amount - existing.target_amount), date: goal.target_date, note: goal.name, category: "Other" }, now, timeZone });
}
