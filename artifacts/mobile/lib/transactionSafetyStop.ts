import { createFinancialProjection } from "./financialProjection";
import type { FinancialProjectionSnapshot, Transaction } from "./financialProjectionTypes";
import type { SafetyStopWarning } from "./safetyStop";

/** Recompute a replacement with the existing engine: bank anchors, account scope,
 * matches and reservations must all see the same edited payload as persistence. */
export function previewTransactionSafetyStop(input: {
  snapshot: FinancialProjectionSnapshot;
  transaction: Omit<Transaction, "id"> | Transaction;
  existingId?: string;
  now: Date;
  timeZone: string;
}): SafetyStopWarning | null {
  const { snapshot, transaction, existingId, now, timeZone } = input;
  if (transaction.amount >= 0) return null;
  const previous = existingId ? snapshot.transactions.find(item => item.id === existingId) : undefined;
  const replacement = { ...transaction, id: existingId ?? "transaction-safety-preview", ...(existingId ? { user_edited_at: now.toISOString() } : {}) };
  const next = { ...snapshot, transactions: [...snapshot.transactions.filter(item => item.id !== existingId), replacement] };
  const start = previous && previous.date < transaction.date ? previous.date : transaction.date;
  const end = previous && previous.date > transaction.date ? previous.date : transaction.date;
  return previewProjectionChangeSafetyStop({ before: snapshot, after: next, start, end, transaction, now, timeZone });
}

export function previewProjectionChangeSafetyStop(input: {
  before: FinancialProjectionSnapshot; after: FinancialProjectionSnapshot;
  start: string; end?: string; transaction: Pick<Transaction, "amount" | "date" | "note" | "category">;
  now: Date; timeZone: string;
}): SafetyStopWarning | null {
  const { before: snapshot, transaction, start, now, timeZone } = input;
  const end = input.end ?? start;
  const before = createFinancialProjection(snapshot, { now, timeZone });
  const after = createFinancialProjection(input.after, { now, timeZone });
  const [year, month] = start.split("-").map(Number);
  const [endYear, endMonth] = end.split("-").map(Number);
  const count = (endYear - year) * 12 + endMonth - month + Math.max(1, snapshot.settings.forecast_horizon_months || 6);
  let lowest: { date: string; balance: number } | null = null;
  for (let index = 0; index < count; index++) {
    const target = new Date(year, month - 1 + index, 1, 12);
    const baseline = new Map(before.getDailyBalances(target.getMonth(), target.getFullYear()).map(day => [day.day, day.balance]));
    for (const day of after.getDailyBalances(target.getMonth(), target.getFullYear())) {
      const date = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, "0")}-${String(day.day).padStart(2, "0")}`;
      if (date < start || day.balance >= snapshot.settings.safety_floor || day.balance >= (baseline.get(day.day) ?? day.balance) - 0.005) continue;
      if (!lowest || day.balance < lowest.balance) lowest = { date, balance: day.balance };
    }
  }
  return lowest ? {
    itemName: transaction.note?.trim() || transaction.category || "this scheduled item",
    amount: Math.abs(transaction.amount), scheduledDate: transaction.date,
    lowestBalance: lowest.balance, lowestBalanceDate: lowest.date,
    safetyFloor: snapshot.settings.safety_floor, shortfall: snapshot.settings.safety_floor - lowest.balance,
  } : null;
}
