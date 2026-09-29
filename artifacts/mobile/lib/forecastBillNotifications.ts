import { dateOnlyToLocalDate } from "./dateLabels";
import { lenderMinimumRequiredAmount, type DebtMonthSettlement } from "./debtPlanDomain";
import { calendarVisibleForecastEvents } from "./forecastDisplay";
import type { FinancialEvent } from "./forecast";
import type { Bill } from "./financialProjectionTypes";
import { isBillEligibleForDueNotification, type InAppNotification } from "./notificationCenter";

const currency = (value: number) => value.toLocaleString("en-US", { style: "currency", currency: "USD" });
const dayNumber = (date: string) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / 86_400_000;

/** Upcoming reminders are a view of the same remaining dated events as the
 * calendar, never a second monthly-payment allocator. Debt overdue is separate:
 * only the lender's exact occurrence requirement can become past due. */
export function buildForecastBillNotifications(input: {
  today: string;
  bills: readonly Bill[];
  getDailyBalances: (month: number, year: number) => ReadonlyArray<{ events?: FinancialEvent[] }>;
  getDebtMonthSettlements: (month: number, year: number) => ReadonlyMap<string, DebtMonthSettlement>;
  protectedOccurrences?: ReadonlySet<string>;
}): InAppNotification[] {
  if (!dateOnlyToLocalDate(input.today)) return [];
  const [year, monthNumber] = input.today.split("-").map(Number), month = monthNumber - 1;
  const monthStart = `${input.today.slice(0, 7)}-01`;
  const lastDate = new Date((dayNumber(input.today) + 7) * 86_400_000).toISOString().slice(0, 10);
  const billById = new Map(input.bills.filter(isBillEligibleForDueNotification).map(bill => [bill.id, bill]));
  const notifications = new Map<string, InAppNotification>();
  const add = (bill: Bill, date: string, amount: number, overdue: boolean) => {
    const parsed = dateOnlyToLocalDate(date);
    if (!parsed || !Number.isFinite(amount) || amount <= 0.005 || input.protectedOccurrences?.has(`${bill.id}:${date}`)) return;
    const daysAway = dayNumber(date) - dayNumber(input.today);
    const label = parsed.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    parsed.setHours(12);
    const id = `bill-${overdue ? "overdue" : "due"}:${bill.id}:${date}`;
    notifications.set(id, {
      id, type: "bill",
      title: overdue ? `${bill.name} is overdue` : `${bill.name} is due ${daysAway === 0 ? "today" : daysAway === 1 ? "tomorrow" : "soon"}`,
      body: overdue ? `${currency(amount)} remains from the ${label} payment.` : `${currency(amount)} is planned for ${label}.`,
      timestamp: parsed.toISOString(), route: "/(tabs)/bills", params: { view: bill.is_debt ? "debt" : "bills" },
      tone: overdue ? "risk" : daysAway <= 1 ? "watch" : "info",
    });
  };
  const months = [{ month, year }];
  if (lastDate.slice(0, 7) !== input.today.slice(0, 7)) months.push({ month: Number(lastDate.slice(5, 7)) - 1, year: Number(lastDate.slice(0, 4)) });
  const seenEvents = new Set<string>();
  months.forEach(({ month: eventMonth, year: eventYear }) => {
    input.getDailyBalances(eventMonth, eventYear).forEach(day => {
      const events = (day.events ?? []).filter(event => {
        if (seenEvents.has(event.id)) return false;
        seenEvents.add(event.id); return true;
      });
      calendarVisibleForecastEvents(events).forEach(event => {
        if (!["planned", "scheduled"].includes(event.status) || !Number.isFinite(event.amount) || event.amount >= -0.005) return;
        if (event.sourceType !== "bill" && event.kind !== "bill" && event.kind !== "debt_payment") return;
        // Rollover sourceId identifies the debt that freed money, not its recipient.
        const billId = event.debtTargetBillId ?? (event.sourceType === "bill" || event.kind === "bill" ? event.sourceId : undefined);
        const bill = billId ? billById.get(billId) : undefined;
        if (!bill) return;
        if (event.date >= input.today && event.date <= lastDate) add(bill, event.date, -event.amount, false);
        else if (!bill.is_debt && event.date >= monthStart && event.date < input.today) add(bill, event.date, -event.amount, true);
      });
    });
  });
  input.getDebtMonthSettlements(month, year).forEach((settlement, billId) => {
    const bill = billById.get(billId);
    if (!bill?.is_debt) return;
    settlement.occurrences?.forEach(occurrence => {
      if (occurrence.occurrenceDate < monthStart || occurrence.occurrenceDate >= input.today) return;
      const required = lenderMinimumRequiredAmount(occurrence.configuredObligation, bill.amount);
      const remaining = Math.round(Math.max(0, required - Math.max(0, occurrence.paidAmount)) * 100) / 100;
      add(bill, occurrence.occurrenceDate, remaining, true);
    });
  });
  return [...notifications.values()];
}
