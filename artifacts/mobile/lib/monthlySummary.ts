export interface MonthlyBillSummary {
  totalDue: number;
  totalPaid: number;
  remaining: number;
  paidCount: number;
  unpaidCount: number;
  billCount: number;
  billProgressPercent: number;
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
