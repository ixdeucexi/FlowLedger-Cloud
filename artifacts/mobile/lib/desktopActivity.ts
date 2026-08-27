export type DesktopActivitySummaryRow = {
  amount: number;
  pending?: boolean;
  source: string;
  countsInCashFlow: boolean;
};

export function countsInDisplayedCashFlow(row: DesktopActivitySummaryRow) {
  return row.countsInCashFlow && row.source !== "transfer";
}

export function summarizeDisplayedActivity(rows: DesktopActivitySummaryRow[]) {
  let income = 0;
  let out = 0;
  let transactions = 0;

  rows.forEach((row) => {
    if (row.pending) return;
    transactions += 1;
    if (!countsInDisplayedCashFlow(row)) return;
    if (row.amount >= 0) income += row.amount;
    else out += Math.abs(row.amount);
  });

  return { income, out, net: income - out, transactions };
}

export function groupDisplayedActivityByDate<T extends { date: string }>(
  rows: T[],
  groupByDate: boolean,
) {
  if (!groupByDate) return [{ date: "", rows }];

  const groups: Array<{ date: string; rows: T[] }> = [];
  rows.forEach((row) => {
    const date = row.date.slice(0, 10);
    const current = groups[groups.length - 1];
    if (current?.date === date) current.rows.push(row);
    else groups.push({ date, rows: [row] });
  });
  return groups;
}
