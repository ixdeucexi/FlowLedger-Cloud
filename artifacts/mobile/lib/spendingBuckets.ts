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

export interface SpendingBucketCandidate extends SpendingBucketAmounts {
  goal_type: "savings" | "planned_expense";
  archived_at?: string | null;
}

export interface CreateSpendingBucketMatchInput {
  name: string;
  targetAmount: number;
  targetDate: string;
  transactionAmount: number;
}

export interface ValidSpendingBucketMatch {
  name: string;
  targetAmount: number;
  targetDate: string;
  transactionAmount: number;
  settlement: "exact" | "partial";
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

export function isEligibleSpendingBucketMatch(bucket: SpendingBucketCandidate): boolean {
  return bucket.goal_type === "planned_expense" && !bucket.archived_at && isOpenSpendingBucket(bucket);
}

export function bucketEffectiveRouteDate(today: string, targetDate: string): string {
  const normalizedToday = today.slice(0, 10);
  const normalizedTarget = targetDate.slice(0, 10);
  if (!validIsoDate(normalizedToday)) throw new Error("Choose a valid current date.");
  if (!validIsoDate(normalizedTarget)) throw new Error("Choose a valid bucket target date.");
  return normalizedTarget > normalizedToday ? normalizedTarget : normalizedToday;
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

function validIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

export function validateCreateSpendingBucketMatch(
  input: CreateSpendingBucketMatchInput,
): ValidSpendingBucketMatch {
  const name = input.name.trim();
  if (!name) throw new Error("Enter a name for this spending bucket.");
  if (name.length > 120) throw new Error("Keep the spending bucket name to 120 characters or fewer.");
  if (!validIsoDate(input.targetDate)) throw new Error("Choose a valid target date.");

  const transactionAmount = Math.round(Math.abs(Number(input.transactionAmount)) * 100) / 100;
  const targetAmount = Math.round(Number(input.targetAmount) * 100) / 100;
  if (!Number.isFinite(transactionAmount) || transactionAmount <= 0) {
    throw new Error("This transaction does not have a valid money-out amount.");
  }
  if (!Number.isFinite(targetAmount) || targetAmount <= 0) {
    throw new Error("Enter a positive spending bucket amount.");
  }
  if (targetAmount + 0.005 < transactionAmount) {
    throw new Error(`Bucket amount must be at least $${transactionAmount.toFixed(2)} to include this transaction.`);
  }

  return {
    name,
    targetAmount,
    targetDate: input.targetDate,
    transactionAmount,
    settlement: Math.abs(targetAmount - transactionAmount) < 0.005 ? "exact" : "partial",
  };
}
