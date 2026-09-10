import { orderDebts } from "../../../artifacts/mobile/lib/snowball.ts";
import { applyBillDateMovesToOccurrenceDays, getBillOccurrenceDays, isBillActiveForMonth, type ScheduledBill, type ScheduledBillDateMove } from "../../../artifacts/mobile/lib/schedule.ts";
import { isDateOnly, money } from "./contract.ts";

export function currentFloMonth(now: string, timezone: unknown): { year: number; month: number; date: string } | null {
  if (typeof timezone !== "string" || !timezone.trim() || timezone.length > 80) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(now));
    const part = (type: string) => parts.find(value => value.type === type)?.value;
    const date = `${part("year")}-${part("month")}-${part("day")}`;
    return isDateOnly(date) ? { year: Number(part("year")), month: Number(part("month")) - 1, date } : null;
  } catch { return null; }
}

export type RecordedSnowballResult = { state: "target" | "no_debts" | "all_excluded" | "none_current" | "paid_off" | "unavailable"; targetId?: string; reason?: string };

// This is the canonical ordering of currently recorded balances, NOT a new
// dated payoff projection. Month selection comes from the caller's timezone.
export function recordedSnowballTarget(records: Array<Record<string, unknown>>, month: { year: number; month: number } | null, complete: boolean, occurrenceChanges: Array<{ bill_id: string; [key: string]: unknown }>): RecordedSnowballResult {
  if (!month) return { state: "unavailable", reason: "month_unknown" };
  if (!complete) return { state: "unavailable", reason: "incomplete_records" };
  const debts = records.filter(row => row.is_debt === true);
  if (!debts.length) return { state: "no_debts" };
  const included = debts.filter(row => row.include_in_snowball !== false);
  if (!included.length) return { state: "all_excluded" };
  if (included.some(row => [row.start_date, row.end_date].some(value => value != null && value !== "" && !isDateOnly(value)))) return { state: "unavailable", reason: "invalid_schedule" };
  const activeInMonth = (row: Record<string, unknown>) => isBillActiveForMonth(row as unknown as ScheduledBill, month.month, month.year);
  // Active-month debts remain eligible in the app even when an occurrence was
  // moved out. Only inactive debts need occurrence-based inclusion checked.
  const inactiveIds = new Set(included.filter(row => !activeInMonth(row)).map(row => String(row.id)));
  if (occurrenceChanges.some(row => inactiveIds.has(row.bill_id) && row.custom_due_day != null)) return { state: "unavailable", reason: "inactive_override_eligibility_unresolved" };
  const moves = occurrenceChanges.filter(row => typeof row.from_date === "string" && typeof row.to_date === "string") as unknown as ScheduledBillDateMove[];
  const active = included.filter(row => activeInMonth(row) || applyBillDateMovesToOccurrenceDays(String(row.id), month.month, month.year, getBillOccurrenceDays(row as unknown as ScheduledBill, month.month, month.year), moves).length > 0);
  if (!active.length) return { state: "none_current" };
  if (active.some(row => money(row.balance) === null)) return { state: "unavailable", reason: "missing_balance" };
  const positive = active.filter(row => money(row.balance)! > 0.009);
  if (!positive.length) return { state: "paid_off" };
  if (positive.some(row => typeof row.id !== "string" || !row.id || typeof row.name !== "string" || !row.name.trim())) return { state: "unavailable", reason: "missing_ordering_fields" };
  const target = orderDebts(positive.map(row => ({ id: String(row.id), name: String(row.name), balance: money(row.balance)!, apr: money(row.interest_rate) === null ? 0 : Number(row.interest_rate), minimum: 0, dueDay: 1, included: true })), "snowball")[0];
  const tied = positive.filter(row => money(row.balance) === target.balance);
  if (tied.length > 1 && tied.some(row => money(row.interest_rate) === null)) return { state: "unavailable", reason: "missing_tiebreak_apr" };
  return { state: "target", targetId: target.id };
}
