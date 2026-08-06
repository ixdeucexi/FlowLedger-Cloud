export type ActivityCsvRow = {
  date: string;
  description: string;
  category: string;
  account?: string;
  amount: number;
  type: string;
  appliedDebt?: string;
  note?: string;
  runningBalance?: number;
};

function escapeCsv(value: unknown) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

export function activityCsvContent(rows: ActivityCsvRow[]) {
  return [
    ["Date", "Description", "Category", "Account", "Amount", "Type", "Applied Debt", "Note", "Running Balance"]
      .map(escapeCsv)
      .join(","),
    ...rows.map(row => [
      row.date,
      row.description,
      row.category,
      row.account ?? "",
      row.amount,
      row.type,
      row.appliedDebt ?? "",
      row.note ?? "",
      row.runningBalance ?? "",
    ].map(escapeCsv).join(",")),
  ].join("\n");
}

export function exportActivityCsv(rows: ActivityCsvRow[], filename = `flowledger-activity-${Date.now()}.csv`) {
  if (typeof document === "undefined") return false;
  const url = URL.createObjectURL(new Blob([activityCsvContent(rows)], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  return true;
}
