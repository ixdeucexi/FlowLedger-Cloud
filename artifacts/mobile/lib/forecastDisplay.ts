import type { FinancialEvent, FinancialEventKind, FinancialEventStatus } from "./forecast";

export type ForecastEventGroupKey = "income" | "bills" | "transactions" | "goals" | "debt" | "plans";

export interface ForecastEventDisplay {
  event: FinancialEvent;
  label: string;
  statusLabel: string;
  amountLabel: string;
}

export interface ForecastEventGroup {
  key: ForecastEventGroupKey;
  title: string;
  events: ForecastEventDisplay[];
}

const GROUP_ORDER: ForecastEventGroupKey[] = ["income", "bills", "transactions", "goals", "debt", "plans"];

const GROUP_TITLES: Record<ForecastEventGroupKey, string> = {
  income: "Income",
  bills: "Bills",
  transactions: "Transactions",
  goals: "Goals & planned expenses",
  debt: "Debt payments",
  plans: "Saved plans",
};

const STATUS_LABELS: Record<FinancialEventStatus, string> = {
  planned: "planned",
  scheduled: "scheduled",
  pending: "PAYMENT PENDING",
  finalized: "finalized",
  actual: "actual",
  applied: "applied",
};

const KIND_LABELS: Record<FinancialEventKind, string> = {
  scheduled_income: "Income",
  transaction_income: "Transaction income",
  transaction_expense: "Transaction expense",
  bill: "Bill",
  goal: "Goal",
  debt_payment: "Debt payment",
  bank_adjustment: "Bank balance update",
};

const DEBT_STATUS_PRIORITY: Record<FinancialEventStatus, number> = {
  pending: 6,
  scheduled: 5,
  planned: 4,
  finalized: 3,
  actual: 2,
  applied: 1,
};

const cents = (value: number) => Math.round((Number(value) || 0) * 100) / 100;

function normalizedEventName(event: FinancialEvent): string {
  return (event.name ?? "").trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Removes display-only duplicate bill chips without changing the forecast's
 * cash math. Duplicate rows can arrive after a bill review is merged with a
 * saved occurrence, so the calendar should still show one obligation.
 */
export function dedupeSameDayBillEvents(events: FinancialEvent[] = []): FinancialEvent[] {
  const seenIdentity = new Set<string>();
  const seenSemantic = new Set<string>();
  return events.filter(event => {
    const isBill = event.sourceType === "bill" || event.kind === "bill";
    if (!isBill) return true;
    const name = normalizedEventName(event);
    const identityKey = `${event.date}:${event.sourceId}`;
    const semanticKey = name ? `${event.date}:${cents(event.amount)}:${name}` : "";
    if (seenIdentity.has(identityKey) || (semanticKey && seenSemantic.has(semanticKey))) return false;
    seenIdentity.add(identityKey);
    if (semanticKey) seenSemantic.add(semanticKey);
    return true;
  });
}

/** Combines same-debt, same-date canonical and saved-extra rows for display only. */
export function combineSameDayDebtPaymentEvents(events: FinancialEvent[] = []): FinancialEvent[] {
  const groups = new Map<string, { firstIndex: number; events: FinancialEvent[] }>();
  events.forEach((event, index) => {
    const isDebtPayment = event.kind === "debt_payment" || event.sourceType === "extra_payment";
    const key = isDebtPayment && event.debtTargetBillId
      ? `${event.date}:${event.debtTargetBillId}`
      : `event:${index}:${event.id}`;
    const group = groups.get(key) ?? { firstIndex: index, events: [] };
    group.events.push(event);
    groups.set(key, group);
  });

  return [...groups.entries()]
    .sort((left, right) => left[1].firstIndex - right[1].firstIndex)
    .map(([key, group]) => {
      if (group.events.length === 1) return group.events[0];
      const savedExtra = group.events.find(event => event.debtPlanSource === "saved_extra");
      const representative = savedExtra ?? group.events[0];
      const status = group.events.reduce((selected, event) =>
        DEBT_STATUS_PRIORITY[event.status] > DEBT_STATUS_PRIORITY[selected] ? event.status : selected,
      representative.status);
      return {
        ...representative,
        id: `combined:${key}`,
        amount: cents(group.events.reduce((total, event) => total + event.amount, 0)),
        status,
        debtPlanSource: savedExtra ? "saved_extra" : representative.debtPlanSource,
        sourceId: savedExtra?.sourceId ?? representative.sourceId,
      };
    });
}

function groupKeyForEvent(event: FinancialEvent): ForecastEventGroupKey {
  if (event.sourceType === "reconciliation") return "plans";
  if (event.sourceType === "decision") return "plans";
  if (event.kind === "debt_payment" || event.sourceType === "extra_payment" || Boolean(event.debtTargetBillId)) return "debt";
  if (event.sourceType === "income" || event.kind === "scheduled_income") return "income";
  if (event.sourceType === "bill" || event.kind === "bill") return "bills";
  if (event.sourceType === "goal" || event.kind === "goal") return "goals";
  return "transactions";
}

export function formatEventAmount(amount: number): string {
  const sign = amount >= 0 ? "+" : "-";
  return `${sign}$${Math.abs(amount).toFixed(2)}`;
}

export function formatCalendarBalance(amount: number): string {
  const value = Number(amount) || 0;
  const wholeDollars = Math.round(Math.abs(value));
  const sign = value < 0 && wholeDollars > 0 ? "-" : "";
  return `${sign}$${wholeDollars.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

export function formatForecastDateLabel(value?: string): string {
  if (!value) return "the tightest forecast date";
  const parsed = new Date(`${value.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return value.slice(0, 10);
  return parsed.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export function lowestForecastDate(
  getDailyBalances: (month: number, year: number) => Array<{ day: number; balance: number; balanceDate?: string }>,
  startMonth: number,
  startYear: number,
  horizonMonths: number,
): string | undefined {
  let lowest = Infinity;
  let lowestDate: string | undefined;
  for (let offset = 0; offset < Math.max(1, horizonMonths); offset += 1) {
    const absolute = startYear * 12 + startMonth + offset;
    const month = absolute % 12;
    const year = Math.floor(absolute / 12);
    getDailyBalances(month, year).forEach(day => {
      if (!Number.isFinite(day.balance) || day.balance >= lowest) return;
      lowest = day.balance;
      lowestDate = day.balanceDate ?? `${year}-${String(month + 1).padStart(2, "0")}-${String(day.day).padStart(2, "0")}`;
    });
  }
  return lowestDate;
}

export function formatEventStatus(status: FinancialEventStatus): string {
  return STATUS_LABELS[status] ?? status;
}

export function forecastItemTypeLabel(event: FinancialEvent): string {
  if (event.sourceType === "bill" && Boolean(event.debtTargetBillId)) return "Debt";
  if (event.kind === "debt_payment" || event.sourceType === "extra_payment" || Boolean(event.debtTargetBillId)) {
    return event.debtPlanAllocationKind === "required" ? "Debt" : "Snowball";
  }
  if (event.kind === "bill" || event.sourceType === "bill") return "Bill";
  if (event.kind === "scheduled_income" || event.kind === "transaction_income" || event.sourceType === "income") return "Income";
  if (event.kind === "goal" || event.sourceType === "goal") return "Goal";
  if (event.sourceType === "decision") return "Plan";
  return "Activity";
}

export function forecastItemBadgeLabel(event: FinancialEvent, statusLabel: string): string {
  const normalizedStatus = statusLabel.trim().toLowerCase();
  return normalizedStatus === "scheduled" || normalizedStatus === "planned"
    ? forecastItemTypeLabel(event)
    : statusLabel;
}

export function calendarVisibleForecastEvents(events: FinancialEvent[] = []): FinancialEvent[] {
  return dedupeSameDayBillEvents(combineSameDayDebtPaymentEvents(
    events.filter(event => event.sourceType !== "reconciliation" && event.kind !== "bank_adjustment"),
  ));
}

export function describeForecastEvent(event: FinancialEvent): ForecastEventDisplay {
  return {
    event,
    label: event.name || KIND_LABELS[event.kind] || event.sourceType,
    statusLabel: formatEventStatus(event.status),
    amountLabel: formatEventAmount(event.amount),
  };
}

export function plannedDebtEditorParams(event: FinancialEvent): { billId: string; date: string } | undefined {
  if (event.sourceType !== "extra_payment" || event.debtPlanSource !== "canonical" || !event.sourceId || !event.date) return undefined;
  return { billId: event.sourceId, date: event.date };
}

export function groupForecastEvents(events: FinancialEvent[] = []): ForecastEventGroup[] {
  const grouped = new Map<ForecastEventGroupKey, ForecastEventDisplay[]>();
  combineSameDayDebtPaymentEvents(events).forEach(event => {
    const key = groupKeyForEvent(event);
    grouped.set(key, [...(grouped.get(key) ?? []), describeForecastEvent(event)]);
  });
  return GROUP_ORDER
    .map(key => ({ key, title: GROUP_TITLES[key], events: grouped.get(key) ?? [] }))
    .filter(group => group.events.length > 0);
}

export function buildDayForecastFloPrompt(dateLabel: string, isoDate: string, projectedClose?: number, groups: ForecastEventGroup[] = []): string {
  const balanceText = projectedClose === undefined
    ? "I do not have a closing balance for that day."
    : `Closing balance is $${projectedClose.toFixed(2)}.`;
  const sourceText = groups.length
    ? groups
        .map(group => {
          const entries = group.events
            .slice(0, 6)
            .map(item => `${item.label} ${item.amountLabel} (${item.statusLabel})`)
            .join(", ");
          const more = group.events.length > 6 ? `, plus ${group.events.length - 6} more` : "";
          return `${group.title}: ${entries}${more}`;
        })
        .join("; ")
    : "No dated income, bills, transactions, goals, debt payments, or saved plans are on this day.";
  return `Review my FlowLedger calendar for ${dateLabel} (${isoDate}). ${balanceText} Day activity: ${sourceText}. Explain what is driving this day and what I should check before changing the plan.`;
}

export function debtPaymentStatusLabel(paymentDate: string, pendingBalanceApply?: boolean, today = new Date()): "scheduled" | "applied" {
  const localToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  return pendingBalanceApply || paymentDate > localToday ? "scheduled" : "applied";
}
