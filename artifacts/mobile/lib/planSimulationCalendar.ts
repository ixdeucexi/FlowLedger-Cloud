import { calendarEventKind, desktopCalendarCells, type DesktopCalendarEventKind } from "./desktopCalendar";
import type { FinancialEvent } from "./forecast";
import type { CanonicalPlanSimulationDay } from "./planSimulator";

const NO_TRANSFERS: ReadonlySet<string> = new Set();
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface SimulationCalendarCell {
  date: string;
  day: number;
  inCurrentMonth: boolean;
  scenario?: CanonicalPlanSimulationDay;
  current?: CanonicalPlanSimulationDay;
}

/** Index existing result rows only. Missing dates never become zero-balance days. */
export function simulationCalendarDays(days: readonly CanonicalPlanSimulationDay[], startDate: string, endDate: string) {
  return new Map(days.filter(day => DATE.test(day.date) && day.date >= startDate && day.date <= endDate)
    .map(day => [day.date, day] as const));
}

export function simulationCalendarMonths(days: ReadonlyMap<string, CanonicalPlanSimulationDay>): string[] {
  return [...new Set([...days.keys()].map(date => date.slice(0, 7)))].sort();
}

/** A saved option or shorter horizon may remove the previously selected month. */
export function simulationCalendarMonth(months: readonly string[], requested: string | null): string | null {
  if (!months.length) return null;
  if (!requested || requested < months[0]) return months[0];
  if (requested > months[months.length - 1]) return months[months.length - 1];
  return months.find(month => month >= requested) ?? months[0];
}

export function simulationCalendarCells(month: string, scenario: ReadonlyMap<string, CanonicalPlanSimulationDay>, current: ReadonlyMap<string, CanonicalPlanSimulationDay>): SimulationCalendarCell[] {
  const [year, monthNumber] = month.split("-").map(Number);
  return desktopCalendarCells(year, monthNumber - 1).map(cell => ({
    ...cell,
    ...(cell.inCurrentMonth ? { scenario: scenario.get(cell.date), current: current.get(cell.date) } : {}),
  }));
}

export function simulationCalendarSelectedDay(cells: readonly SimulationCalendarCell[], requested: string | null): SimulationCalendarCell | null {
  const available = (cell: SimulationCalendarCell) => Boolean(cell.inCurrentMonth && cell.scenario && Number.isFinite(cell.scenario.balance));
  return cells.find(cell => cell.date === requested && available(cell)) ?? cells.find(available) ?? null;
}

/** Presentation delta, rounded to cents; balances themselves remain untouched. */
export function simulationCalendarDifference(scenario?: CanonicalPlanSimulationDay, current?: CanonicalPlanSimulationDay): number | null {
  if (!scenario || !current || !Number.isFinite(scenario.balance) || !Number.isFinite(current.balance)) return null;
  const difference = Math.round((scenario.balance - current.balance) * 100);
  return difference === 0 ? 0 : difference / 100;
}

/** Simulator rows use decision sources even for new income and bill events. */
export function simulationCalendarEventKind(event: FinancialEvent): DesktopCalendarEventKind {
  if (event.kind === "debt_payment" || event.debtTargetBillId || event.sourceType === "extra_payment") return "debt";
  if (event.kind === "scheduled_income" || event.kind === "transaction_income") return "income";
  if (event.kind === "transaction_expense") return "spending";
  if (event.kind === "bill") return "bill";
  if (event.kind === "goal") return "plan";
  return calendarEventKind(event, NO_TRANSFERS);
}
