export type ActivityRangeId =
  | "today"
  | "this_week"
  | "this_month"
  | "last_month"
  | "last_30_days"
  | "last_90_days"
  | "last_3_months"
  | "last_6_months"
  | "this_year"
  | "last_year"
  | "custom"
  | "all_time";

export type ActivityDateRange = {
  id: ActivityRangeId;
  label: string;
  startDate?: string;
  endDate?: string;
};

export const ACTIVITY_DATE_RANGE_OPTIONS: ReadonlyArray<{ id: ActivityRangeId; label: string }> = [
  { id: "today", label: "Today" },
  { id: "this_week", label: "This Week" },
  { id: "this_month", label: "This Month" },
  { id: "last_month", label: "Last Month" },
  { id: "last_30_days", label: "Last 30 Days" },
  { id: "last_90_days", label: "Last 90 Days" },
  { id: "last_3_months", label: "Last 3 Months" },
  { id: "last_6_months", label: "Last 6 Months" },
  { id: "this_year", label: "This Year" },
  { id: "last_year", label: "Last Year" },
  { id: "custom", label: "Custom Range" },
  { id: "all_time", label: "All Time" },
] as const;

function localDate(year: number, month: number, day: number) {
  return new Date(year, month, day, 12);
}

export function dateOnly(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function addDays(value: Date, amount: number) {
  const next = localDate(value.getFullYear(), value.getMonth(), value.getDate());
  next.setDate(next.getDate() + amount);
  return next;
}

function startOfMonth(value: Date, offset = 0) {
  return localDate(value.getFullYear(), value.getMonth() + offset, 1);
}

function endOfMonth(value: Date, offset = 0) {
  return localDate(value.getFullYear(), value.getMonth() + offset + 1, 0);
}

function validDateOnly(value?: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = localDate(year, month - 1, day);
  return parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day ? value : undefined;
}

export function resolveActivityDateRange(
  id: ActivityRangeId,
  today = new Date(),
  customStart?: string,
  customEnd?: string,
): ActivityDateRange {
  const current = localDate(today.getFullYear(), today.getMonth(), today.getDate());
  const label = ACTIVITY_DATE_RANGE_OPTIONS.find(option => option.id === id)?.label ?? "This Month";
  if (id === "all_time") return { id, label };
  if (id === "custom") {
    const startDate = validDateOnly(customStart);
    const endDate = validDateOnly(customEnd);
    return {
      id,
      label: startDate && endDate ? `${startDate} – ${endDate}` : label,
      ...(startDate ? { startDate } : {}),
      ...(endDate ? { endDate } : {}),
    };
  }
  if (id === "today") return { id, label, startDate: dateOnly(current), endDate: dateOnly(current) };
  if (id === "this_week") {
    const start = addDays(current, -current.getDay());
    return { id, label, startDate: dateOnly(start), endDate: dateOnly(addDays(start, 6)) };
  }
  if (id === "this_month") return { id, label, startDate: dateOnly(startOfMonth(current)), endDate: dateOnly(endOfMonth(current)) };
  if (id === "last_month") return { id, label, startDate: dateOnly(startOfMonth(current, -1)), endDate: dateOnly(endOfMonth(current, -1)) };
  if (id === "last_30_days") return { id, label, startDate: dateOnly(addDays(current, -29)), endDate: dateOnly(current) };
  if (id === "last_90_days") return { id, label, startDate: dateOnly(addDays(current, -89)), endDate: dateOnly(current) };
  if (id === "last_3_months") return { id, label, startDate: dateOnly(startOfMonth(current, -2)), endDate: dateOnly(current) };
  if (id === "last_6_months") return { id, label, startDate: dateOnly(startOfMonth(current, -5)), endDate: dateOnly(current) };
  if (id === "this_year") return { id, label, startDate: `${current.getFullYear()}-01-01`, endDate: `${current.getFullYear()}-12-31` };
  return { id, label, startDate: `${current.getFullYear() - 1}-01-01`, endDate: `${current.getFullYear() - 1}-12-31` };
}

export function dateIsInActivityRange(date: string, range: ActivityDateRange) {
  const day = date.slice(0, 10);
  return (!range.startDate || day >= range.startDate) && (!range.endDate || day <= range.endDate);
}

export function isActivityRangeId(value: unknown): value is ActivityRangeId {
  return ACTIVITY_DATE_RANGE_OPTIONS.some(option => option.id === value);
}

export function summarizeActivityRange(
  rows: Array<{ amount: number; pending?: boolean; source?: string }>,
) {
  let income = 0;
  let out = 0;
  let transactions = 0;
  for (const row of rows) {
    if (row.pending) continue;
    transactions += 1;
    if (row.source === "transfer") continue;
    if (row.amount > 0) income += row.amount;
    if (row.amount < 0) out += Math.abs(row.amount);
  }
  return { income, out, net: income - out, transactions };
}

export function summarizeActivitySnapshot(
  visibleRows: Array<{ amount: number; pending?: boolean; source?: string }>,
  plannedMonth?: { income: number; out: number; net: number },
) {
  const visible = summarizeActivityRange(visibleRows);
  if (!plannedMonth) return visible;
  return {
    ...visible,
    income: plannedMonth.income,
    out: plannedMonth.out,
    net: plannedMonth.net,
  };
}
