export interface SpendingBucketAmounts {
  target_amount: number;
  current_amount: number;
  closed_at?: string | null;
}

export interface SpendingBucketSummary {
  planned: number;
  spent: number;
  remaining: number;
  released: number;
  closed: boolean;
}

export interface SpendingBucketMatch {
  settlement: "exact" | "partial" | "split";
  applied: number;
  extra: number;
}

export function spendingBucketSummary(bucket: SpendingBucketAmounts): SpendingBucketSummary {
  const planned = Math.max(0, Number(bucket.target_amount) || 0);
  const spent = Math.max(0, Number(bucket.current_amount) || 0);
  const unused = Math.max(0, planned - spent);
  const closed = Boolean(bucket.closed_at);
  return {
    planned,
    spent,
    remaining: closed ? 0 : unused,
    released: closed ? unused : 0,
    closed,
  };
}

export function isOpenSpendingBucket(bucket: SpendingBucketAmounts): boolean {
  const summary = spendingBucketSummary(bucket);
  return !summary.closed && summary.remaining > 0.005;
}

export function spendingBucketMatch(expenseAmount: number, remainingAmount: number): SpendingBucketMatch {
  const expense = Math.round(Math.max(0, Math.abs(Number(expenseAmount) || 0)) * 100) / 100;
  const remaining = Math.round(Math.max(0, Number(remainingAmount) || 0) * 100) / 100;
  if (Math.abs(expense - remaining) < 0.005) {
    return { settlement: "exact", applied: expense, extra: 0 };
  }
  if (expense < remaining) {
    return { settlement: "partial", applied: expense, extra: 0 };
  }
  return {
    settlement: "split",
    applied: remaining,
    extra: Math.round(Math.max(0, expense - remaining) * 100) / 100,
  };
}
