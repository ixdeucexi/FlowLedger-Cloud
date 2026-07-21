export interface OverdueBillInput {
  billId: string;
  name: string;
  occurrenceDays: number[];
  plannedTotal: number;
  paidTotal: number;
}

export interface OverdueBillOccurrence {
  billId: string;
  name: string;
  occurrenceDate: string;
  remainingAmount: number;
  daysPastDue: number;
}

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function buildOverdueBillOccurrences(
  bills: OverdueBillInput[],
  month: number,
  year: number,
  todayDay: number,
): OverdueBillOccurrence[] {
  const today = new Date(year, month, todayDay, 12);

  return bills.flatMap(bill => {
    const occurrences = Array.from(new Set(
      bill.occurrenceDays.filter(day => Number.isInteger(day) && day > 0),
    )).sort((left, right) => left - right);
    const plannedTotal = Math.max(0, Number(bill.plannedTotal) || 0);
    if (!occurrences.length || plannedTotal <= 0.005) return [];

    const occurrenceAmount = plannedTotal / occurrences.length;
    let paidRemaining = Math.max(0, Number(bill.paidTotal) || 0);

    return occurrences.flatMap(day => {
      const paidForOccurrence = Math.min(occurrenceAmount, paidRemaining);
      paidRemaining = Math.max(0, paidRemaining - paidForOccurrence);
      const remainingAmount = roundCurrency(Math.max(0, occurrenceAmount - paidForOccurrence));
      if (day >= todayDay || remainingAmount <= 0.005) return [];

      const occurrence = new Date(year, month, day, 12);
      return [{
        billId: bill.billId,
        name: bill.name,
        occurrenceDate: isoDate(year, month, day),
        remainingAmount,
        daysPastDue: Math.max(1, Math.round((today.getTime() - occurrence.getTime()) / 86_400_000)),
      }];
    });
  }).sort((left, right) =>
    left.occurrenceDate.localeCompare(right.occurrenceDate)
      || right.remainingAmount - left.remainingAmount
      || left.name.localeCompare(right.name)
  );
}

export function groupOverdueBills(occurrences: OverdueBillOccurrence[]) {
  const grouped = new Map<string, {
    billId: string;
    name: string;
    firstOccurrenceDate: string;
    remainingAmount: number;
    occurrenceCount: number;
    maxDaysPastDue: number;
  }>();

  occurrences.forEach(occurrence => {
    const existing = grouped.get(occurrence.billId);
    if (!existing) {
      grouped.set(occurrence.billId, {
        billId: occurrence.billId,
        name: occurrence.name,
        firstOccurrenceDate: occurrence.occurrenceDate,
        remainingAmount: occurrence.remainingAmount,
        occurrenceCount: 1,
        maxDaysPastDue: occurrence.daysPastDue,
      });
      return;
    }
    existing.remainingAmount = roundCurrency(existing.remainingAmount + occurrence.remainingAmount);
    existing.occurrenceCount += 1;
    existing.maxDaysPastDue = Math.max(existing.maxDaysPastDue, occurrence.daysPastDue);
  });

  return Array.from(grouped.values()).sort((left, right) =>
    left.firstOccurrenceDate.localeCompare(right.firstOccurrenceDate)
      || right.remainingAmount - left.remainingAmount
      || left.name.localeCompare(right.name)
  );
}
