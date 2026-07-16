export interface MonthlyBillSummary {
  totalDue: number;
  totalPaid: number;
  remaining: number;
  paidCount: number;
  unpaidCount: number;
  billCount: number;
  billProgressPercent: number;
}

export interface ActivitySummaryEntry {
  date: string;
  amount: number;
  pending?: boolean;
  excludeFromCashFlow?: boolean;
}

export interface ActivityWeekSummary {
  startDay: number;
  endDay: number;
  total: number;
}

export interface MonthlyActivitySummary {
  income: number;
  out: number;
  net: number;
  weeks: ActivityWeekSummary[];
}

export function summarizeActivityMonth(
  entries: ActivitySummaryEntry[],
  year: number,
  monthIndex: number,
): MonthlyActivitySummary {
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const monthPrefix = `${year}-${String(monthIndex + 1).padStart(2, "0")}-`;
  const monthEntries = entries.filter(entry => (
    !entry.pending
    && !entry.excludeFromCashFlow
    && entry.date.startsWith(monthPrefix)
  ));
  const income = monthEntries
    .filter(entry => entry.amount > 0)
    .reduce((sum, entry) => sum + entry.amount, 0);
  const out = monthEntries
    .filter(entry => entry.amount < 0)
    .reduce((sum, entry) => sum + Math.abs(entry.amount), 0);
  const weeks = [1, 8, 15, 22, 29]
    .filter(startDay => startDay <= daysInMonth)
    .map(startDay => {
      const endDay = Math.min(startDay + 6, daysInMonth);
      const total = monthEntries
        .filter(entry => {
          const day = Number(entry.date.slice(8, 10));
          return day >= startDay && day <= endDay;
        })
        .reduce((sum, entry) => sum + entry.amount, 0);
      return { startDay, endDay, total };
    });

  return { income, out, net: income - out, weeks };
}

export function summarizeMonthlyBills<T>(
  bills: T[],
  getMonthlyTotal: (bill: T) => number,
  getPaidAmount: (bill: T) => number,
): MonthlyBillSummary {
  const activeBills = bills
    .map(bill => ({
      bill,
      amount: Math.max(0, Number(getMonthlyTotal(bill)) || 0),
      paid: Math.max(0, Number(getPaidAmount(bill)) || 0),
    }))
    .filter(item => item.amount > 0);

  const totals = activeBills.reduce(
    (summary, item) => {
      const cappedPaid = Math.min(item.paid, item.amount);
      return {
        totalDue: summary.totalDue + item.amount,
        totalPaid: summary.totalPaid + cappedPaid,
        paidCount: summary.paidCount + (cappedPaid >= item.amount ? 1 : 0),
      };
    },
    { totalDue: 0, totalPaid: 0, paidCount: 0 },
  );

  const billCount = activeBills.length;
  const unpaidCount = billCount - totals.paidCount;
  const billProgressPercent = billCount > 0 ? Math.round((totals.paidCount / billCount) * 100) : 0;

  return {
    totalDue: totals.totalDue,
    totalPaid: totals.totalPaid,
    remaining: Math.max(0, totals.totalDue - totals.totalPaid),
    paidCount: totals.paidCount,
    unpaidCount,
    billCount,
    billProgressPercent,
  };
}
