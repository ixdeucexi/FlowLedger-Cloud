import type { FinancialEvent } from "./forecast";

const EMPTY_CALENDAR_KEYS: ReadonlySet<string> = new Set();

export type CalendarForecastDay = {
  day: number;
  balance: number;
  events?: FinancialEvent[];
};

export type DesktopCalendarEventKind =
  | "income"
  | "bill"
  | "plan"
  | "spending"
  | "risk";

export type DesktopCalendarSummary = {
  income: number;
  expenses: number;
  net: number;
  incomeCount: number;
  expenseCount: number;
};

export type DesktopCalendarMonthSummary = DesktopCalendarSummary & {
  lowestBalance: number;
  lowestBalanceDate: string;
};

export type DesktopCalendarCell = {
  date: string;
  day: number;
  inCurrentMonth: boolean;
};

export function calendarEventKind(
  event: FinancialEvent,
  transferTransactionIds: ReadonlySet<string>,
  overdueBillOccurrenceKeys: ReadonlySet<string> = EMPTY_CALENDAR_KEYS,
): DesktopCalendarEventKind {
  const overdueBill =
    (event.sourceType === "bill" || event.kind === "bill") &&
    overdueBillOccurrenceKeys.has(`${event.sourceId}:${event.date.slice(0, 10)}`);
  if (overdueBill) return "risk";
  if (event.sourceType === "reconciliation") return "plan";
  if (
    event.sourceType === "transaction" &&
    transferTransactionIds.has(event.sourceId)
  ) {
    return "plan";
  }
  if (event.sourceType === "bill" || event.kind === "bill") return "bill";
  if (
    event.sourceType === "goal" ||
    event.sourceType === "decision" ||
    event.sourceType === "extra_payment" ||
    event.kind === "goal" ||
    event.kind === "debt_payment"
  ) {
    return "plan";
  }
  if (event.amount > 0) return "income";
  if (event.amount < 0) return "spending";
  return "plan";
}

export function uniqueCalendarEvents(days: CalendarForecastDay[]): FinancialEvent[] {
  const byId = new Map<string, FinancialEvent>();
  days.forEach((day) => {
    (day.events ?? []).forEach((event) => {
      if (!byId.has(event.id)) byId.set(event.id, event);
    });
  });
  return [...byId.values()];
}

export function summarizeCalendarEvents(
  events: FinancialEvent[],
  transferTransactionIds: ReadonlySet<string>,
): DesktopCalendarSummary {
  return events.reduce<DesktopCalendarSummary>(
    (summary, event) => {
      const isTransfer =
        event.sourceType === "transaction" &&
        transferTransactionIds.has(event.sourceId);
      if (event.sourceType === "reconciliation" || isTransfer) return summary;
      if (event.amount > 0) {
        summary.income += event.amount;
        summary.incomeCount += 1;
      } else if (event.amount < 0) {
        summary.expenses += Math.abs(event.amount);
        summary.expenseCount += 1;
      }
      summary.net = summary.income - summary.expenses;
      return summary;
    },
    { income: 0, expenses: 0, net: 0, incomeCount: 0, expenseCount: 0 },
  );
}

export function summarizeCalendarMonth(
  days: CalendarForecastDay[],
  year: number,
  month: number,
  transferTransactionIds: ReadonlySet<string>,
): DesktopCalendarMonthSummary {
  const summary = summarizeCalendarEvents(
    uniqueCalendarEvents(days),
    transferTransactionIds,
  );
  const lowest = days.reduce<CalendarForecastDay | null>((current, day) => {
    if (!current || day.balance < current.balance) return day;
    return current;
  }, null);
  return {
    ...summary,
    lowestBalance: lowest?.balance ?? 0,
    lowestBalanceDate: `${year}-${String(month + 1).padStart(2, "0")}-${String(lowest?.day ?? 1).padStart(2, "0")}`,
  };
}

function localIsoDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function desktopCalendarWeekDates(selectedDate: string): string[] {
  const [year, month, day] = selectedDate.split("-").map(Number);
  const selected = new Date(year, month - 1, day, 12);
  selected.setDate(selected.getDate() - selected.getDay());
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(selected);
    date.setDate(selected.getDate() + index);
    return localIsoDate(date);
  });
}

export function desktopCalendarCells(
  year: number,
  month: number,
): DesktopCalendarCell[] {
  const first = new Date(year, month, 1, 12);
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - first.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    return {
      date: localIsoDate(date),
      day: date.getDate(),
      inCurrentMonth:
        date.getFullYear() === year && date.getMonth() === month,
    };
  });
}
