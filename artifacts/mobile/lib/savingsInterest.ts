import type { FinancialEvent } from "./forecast";
import type { ForecastAccountRef } from "./accountForecasts";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;
const MAX_FORECAST_DAYS = 366 * 100;
const MAX_CASH_BALANCE = Number.MAX_SAFE_INTEGER / 100;

function dateOnly(value: string): Date {
  if (!DATE.test(value) || value.startsWith("0000-")) throw new Error("Choose a valid savings forecast date.");
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error("Choose a valid savings forecast date.");
  }
  return parsed;
}

function roundCredit(value: number): number {
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
  if (!Number.isFinite(rounded) || !Number.isSafeInteger(Math.round(rounded * 100))) {
    throw new Error("The savings interest estimate is outside the supported amount range.");
  }
  return rounded;
}

export function validateSavingsApy(value: unknown): number | null {
  if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) return null;
  const validType = typeof value === "number" || (typeof value === "string" && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()));
  const rate = validType ? Number(value) : Number.NaN;
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
    throw new Error("Enter an APY between 0% and 100%, or leave it blank.");
  }
  return rate;
}

/**
 * Estimate effective APY on posted projected cash plus uncredited accrual.
 * Only rounded month-end credits become forecast cash; residual fractions of
 * a cent remain in accrual. These events never become actual ledger entries.
 */
export function savingsInterestCredits(input: {
  openingPostedBalance: number;
  apy: number | null;
  asOfDate: string;
  endDate: string;
  events: readonly FinancialEvent[];
  accountRef: ForecastAccountRef;
}): FinancialEvent[] {
  const apy = validateSavingsApy(input.apy);
  const anchor = dateOnly(input.asOfDate);
  const end = dateOnly(input.endDate);
  const forecastDays = (end.getTime() - anchor.getTime()) / DAY_MS;
  if (forecastDays < 0) throw new Error("The savings forecast end date must be on or after its observed balance date.");
  if (forecastDays > MAX_FORECAST_DAYS) throw new Error("Choose a savings forecast within the next 100 years.");
  if (!Number.isFinite(input.openingPostedBalance)) throw new Error("A verified posted balance is required to estimate savings interest.");
  if (Math.abs(input.openingPostedBalance) > MAX_CASH_BALANCE) throw new Error("The savings interest estimate is outside the supported amount range.");

  let posted = input.openingPostedBalance;
  let accrued = 0;
  const byDate = new Map<string, number>();
  for (const event of input.events) {
    // A held pending debit changes available cash, not the bank's interest basis.
    // Existing virtual interest is ignored when recomputing an estimate.
    if (event.kind === "estimated_interest" || event.status === "pending") continue;
    dateOnly(event.date);
    if (!Number.isFinite(event.amount)) throw new Error("Savings cash events need valid amounts before interest can be estimated.");
    if (Math.abs(event.amount) > MAX_CASH_BALANCE) throw new Error("The savings interest estimate is outside the supported amount range.");
    if (event.date <= input.asOfDate || event.date > input.endDate) continue;
    const amount = (byDate.get(event.date) ?? 0) + event.amount;
    if (!Number.isFinite(amount)) throw new Error("The savings interest estimate is outside the supported amount range.");
    byDate.set(event.date, amount);
  }
  if (apy === null || apy === 0 || forecastDays === 0) return [];

  const credits: FinancialEvent[] = [];
  const cursor = new Date(anchor);
  cursor.setUTCDate(cursor.getUTCDate() + 1);
  let rateYear = 0;
  let dailyRate = 0;
  for (; cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const date = cursor.toISOString().slice(0, 10);
    posted += byDate.get(date) ?? 0;
    const year = cursor.getUTCFullYear();
    if (year !== rateYear) {
      const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
      dailyRate = Math.expm1(Math.log1p(apy / 100) / (leap ? 366 : 365));
      rateYear = year;
    }
    if (posted > 0) accrued += Math.max(0, posted + accrued) * dailyRate;
    if (!Number.isFinite(posted) || !Number.isFinite(accrued) || Math.abs(posted + accrued) > MAX_CASH_BALANCE) {
      throw new Error("The savings interest estimate is outside the supported amount range.");
    }
    const tomorrow = new Date(cursor);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    if (tomorrow.getUTCDate() !== 1) continue;
    const credit = roundCredit(accrued);
    if (credit <= 0) continue;
    posted += credit;
    accrued -= credit;
    credits.push({
      id: `estimated-interest:${input.accountRef}:${date}`,
      sourceType: "account",
      sourceId: input.accountRef,
      date,
      kind: "estimated_interest",
      amount: credit,
      status: "planned",
      name: "Estimated interest",
      accountRef: input.accountRef,
      estimated: true,
    });
  }
  return credits;
}
