import { resolveMatchedBillBudget, type BillMatchCandidate } from "./billMatching";

type MatchableBill = {
  id: string;
  name: string;
  category: string;
  amount: number;
};

function utcDay(date: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.slice(0, 10));
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) return null;
  return Math.floor(parsed.getTime() / 86_400_000);
}

/** Builds one candidate per bill from the month before, posting month, and
 * month after. The amount follows the occurrence nearest the bank posting. */
export function adjacentBillMatchCandidates<T extends MatchableBill>(
  transactionDate: string,
  getMonthlyBills: (month: number, year: number) => T[],
  getOccurrenceDays: (bill: T, month: number, year: number) => number[],
  getMonthlyTotal: (bill: T, month: number, year: number) => number,
): BillMatchCandidate[] {
  const [referenceYear, referenceMonth] = transactionDate.slice(0, 10).split("-").map(Number);
  if (!Number.isFinite(referenceYear) || !Number.isFinite(referenceMonth)) return [];
  const referenceDay = utcDay(transactionDate);
  if (referenceDay === null) return [];
  const byBill = new Map<string, {
    bill: T;
    occurrences: Array<{ date: string; plannedAmount: number }>;
  }>();

  for (let offset = -1; offset <= 1; offset += 1) {
    const cursor = new Date(Date.UTC(referenceYear, referenceMonth - 1 + offset, 1));
    const year = cursor.getUTCFullYear();
    const month = cursor.getUTCMonth();
    getMonthlyBills(month, year).forEach((bill) => {
      const days = getOccurrenceDays(bill, month, year);
      if (!days.length) return;
      const plannedAmount = resolveMatchedBillBudget(
        getMonthlyTotal(bill, month, year) / days.length,
        bill.amount,
      );
      const current = byBill.get(bill.id) ?? { bill, occurrences: [] };
      days.forEach((day) => current.occurrences.push({
        date: `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
        plannedAmount,
      }));
      byBill.set(bill.id, current);
    });
  }

  return Array.from(byBill.values()).flatMap(({ bill, occurrences }) => {
    const nearest = occurrences
      .map(occurrence => ({
        ...occurrence,
        distance: Math.abs(utcDay(occurrence.date)! - referenceDay),
      }))
      .sort((left, right) => left.distance - right.distance || left.date.localeCompare(right.date))[0];
    if (!nearest || nearest.distance > 14) return [];
    return [{
      billId: bill.id,
      name: bill.name,
      category: bill.category,
      plannedAmount: nearest.plannedAmount,
      occurrenceDates: occurrences.map(occurrence => occurrence.date),
    }];
  });
}
