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
};

function groupKeyForEvent(event: FinancialEvent): ForecastEventGroupKey {
  if (event.sourceType === "decision") return "plans";
  if (event.kind === "debt_payment" || event.sourceType === "extra_payment") return "debt";
  if (event.sourceType === "income" || event.kind === "scheduled_income") return "income";
  if (event.sourceType === "bill" || event.kind === "bill") return "bills";
  if (event.sourceType === "goal" || event.kind === "goal") return "goals";
  return "transactions";
}

export function formatEventAmount(amount: number): string {
  const sign = amount >= 0 ? "+" : "-";
  return `${sign}$${Math.abs(amount).toFixed(2)}`;
}

export function formatEventStatus(status: FinancialEventStatus): string {
  return STATUS_LABELS[status] ?? status;
}

export function describeForecastEvent(event: FinancialEvent): ForecastEventDisplay {
  return {
    event,
    label: event.name || KIND_LABELS[event.kind] || event.sourceType,
    statusLabel: formatEventStatus(event.status),
    amountLabel: formatEventAmount(event.amount),
  };
}

export function groupForecastEvents(events: FinancialEvent[] = []): ForecastEventGroup[] {
  const grouped = new Map<ForecastEventGroupKey, ForecastEventDisplay[]>();
  events.forEach(event => {
    const key = groupKeyForEvent(event);
    grouped.set(key, [...(grouped.get(key) ?? []), describeForecastEvent(event)]);
  });
  return GROUP_ORDER
    .map(key => ({ key, title: GROUP_TITLES[key], events: grouped.get(key) ?? [] }))
    .filter(group => group.events.length > 0);
}

export function buildDayForecastFloPrompt(dateLabel: string, isoDate: string, projectedClose?: number, groups: ForecastEventGroup[] = []): string {
  const balanceText = projectedClose === undefined
    ? "I do not have a projected close for that day."
    : `Projected close is $${projectedClose.toFixed(2)}.`;
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
