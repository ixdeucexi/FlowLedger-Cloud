export type FinancialEventKind =
  | "scheduled_income"
  | "transaction_income"
  | "transaction_expense"
  | "bill"
  | "goal"
  | "debt_payment"
  | "bank_adjustment";

export type FinancialEventStatus = "planned" | "scheduled" | "finalized" | "actual" | "applied";

export interface FinancialEvent {
  id: string;
  sourceType: "income" | "transaction" | "bill" | "goal" | "extra_payment" | "decision" | "reconciliation";
  sourceId: string;
  date: string;
  kind: FinancialEventKind;
  /** Signed cash impact: income is positive; spending is negative. */
  amount: number;
  status: FinancialEventStatus;
  name?: string;
}

export interface ForecastSnapshot {
  openingBalance: number;
  startDate: string;
  endDate: string;
  events: FinancialEvent[];
}

export interface BankAnchoredForecast {
  openingBalance: number;
  events: FinancialEvent[];
}

/**
 * Builds the balance side of a connected-bank forecast.
 *
 * Before the bank's as-of date, only settled ledger events may move the balance.
 * On the as-of date, planned outflows remain in the calendar so today's number
 * shows what will be left if those payments post. Future events remain forecasts.
 */
export function anchorForecastToBankBalance(
  events: FinancialEvent[],
  bankBalance: number,
  anchorDate: string,
  settledEventIds: ReadonlySet<string>,
): BankAnchoredForecast {
  const balanceEvents = events.filter(event =>
    event.date > anchorDate
    || settledEventIds.has(event.id)
    || (event.date === anchorDate && event.amount < 0));
  const settledNetThroughAnchor = balanceEvents
    .filter(event => event.date <= anchorDate && settledEventIds.has(event.id))
    .reduce((sum, event) => sum + event.amount, 0);

  return {
    openingBalance: bankBalance - settledNetThroughAnchor,
    events: balanceEvents,
  };
}

export interface ForecastDiagnostic {
  code: "invalid_event" | "outside_range" | "duplicate_event";
  eventId: string;
}

export interface ForecastDay {
  date: string;
  events: FinancialEvent[];
  net: number;
  balance: number;
}

export interface ForecastResult {
  days: ForecastDay[];
  diagnostics: ForecastDiagnostic[];
  lowestBalance: number;
  lowestBalanceDate: string;
  endingBalance: number;
}

export interface AffordabilityResult {
  projectedBalance: number;
  lowestBalance: number;
  lowestBalanceDate: string;
  canAfford: boolean;
  shortfall: number;
  result: ForecastResult;
}

function parseDateOnly(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function buildFinancialEvents(events: FinancialEvent[]): {
  events: FinancialEvent[];
  diagnostics: ForecastDiagnostic[];
} {
  const diagnostics: ForecastDiagnostic[] = [];
  const seen = new Set<string>();
  const valid = events.filter(event => {
    if (!event.id || !event.sourceId || !parseDateOnly(event.date) || !Number.isFinite(event.amount)) {
      diagnostics.push({ code: "invalid_event", eventId: event.id || "unknown" });
      return false;
    }
    if (seen.has(event.id)) {
      diagnostics.push({ code: "duplicate_event", eventId: event.id });
      return false;
    }
    seen.add(event.id);
    return true;
  });
  return {
    events: valid
      .map(event => ({ ...event, amount: Number(event.amount) }))
      .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)),
    diagnostics,
  };
}

export function forecastBalances(snapshot: ForecastSnapshot): ForecastResult {
  const start = parseDateOnly(snapshot.startDate);
  const end = parseDateOnly(snapshot.endDate);
  if (!start || !end || end < start) throw new Error("Invalid forecast date range");

  const built = buildFinancialEvents(snapshot.events);
  const diagnostics = [...built.diagnostics];
  const eventsByDate = new Map<string, FinancialEvent[]>();
  built.events.forEach(event => {
    if (event.date < snapshot.startDate || event.date > snapshot.endDate) {
      diagnostics.push({ code: "outside_range", eventId: event.id });
      return;
    }
    eventsByDate.set(event.date, [...(eventsByDate.get(event.date) ?? []), event]);
  });

  const days: ForecastDay[] = [];
  let balance = Number(snapshot.openingBalance) || 0;
  let lowestBalance = balance;
  let lowestBalanceDate = snapshot.startDate;
  for (let cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const date = toDateOnly(cursor);
    const events = eventsByDate.get(date) ?? [];
    const net = events.reduce((sum, event) => sum + event.amount, 0);
    balance += net;
    if (balance < lowestBalance) {
      lowestBalance = balance;
      lowestBalanceDate = date;
    }
    days.push({ date, events, net, balance });
  }
  return {
    days,
    diagnostics,
    lowestBalance,
    lowestBalanceDate,
    endingBalance: balance,
  };
}

export function evaluateAffordability(
  snapshot: ForecastSnapshot,
  amount: number,
  date: string,
  safetyFloor = 0,
): AffordabilityResult {
  const expense = Math.max(0, amount);
  const result = forecastBalances({
    ...snapshot,
    events: [
      ...snapshot.events,
      {
        id: `decision:${date}:${expense}`,
        sourceType: "decision",
        sourceId: `decision:${date}`,
        date,
        kind: "transaction_expense",
        amount: -expense,
        status: "planned",
      },
    ],
  });
  const target = result.days.find(day => day.date === date);
  const shortfall = Math.max(0, safetyFloor - result.lowestBalance);
  return {
    projectedBalance: target?.balance ?? result.endingBalance,
    lowestBalance: result.lowestBalance,
    lowestBalanceDate: result.lowestBalanceDate,
    canAfford: shortfall <= 0.009,
    shortfall,
    result,
  };
}
