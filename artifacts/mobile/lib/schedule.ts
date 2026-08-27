export interface ScheduledBill {
  frequency: "monthly" | "quarterly" | "biweekly" | "weekly";
  due_day: number;
  day_of_week?: number;
  next_payment_date?: string;
  start_date?: string;
  end_date?: string;
}

export interface ScheduledIncome {
  amount: number;
  frequency: "monthly" | "biweekly" | "weekly";
  start_date?: string;
  next_payment_date?: string;
  amount_history?: { effective_from: string; amount: number }[];
  excluded_dates?: string[];
}

export interface ScheduledBillDateMove {
  bill_id: string;
  from_date: string;
  to_date: string;
  created_at?: string;
  updated_at?: string;
}

export interface SettledBillOverride {
  bill_id: string;
  month: number;
  year: number;
  paid_amount: number;
  actual_amount?: number;
  paid_date?: string;
}

const DAY_MS = 86_400_000;

type CalendarDateParts = { year: number; month: number; day: number };

function parseCalendarDate(value: string | undefined): CalendarDateParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? "").slice(0, 10));
  if (!match) return null;
  const parts = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  const parsed = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  if (
    parsed.getUTCFullYear() !== parts.year
    || parsed.getUTCMonth() !== parts.month - 1
    || parsed.getUTCDate() !== parts.day
  ) return null;
  return parts;
}

function calendarDayNumber(parts: CalendarDateParts) {
  return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / DAY_MS);
}

function calendarDateFromDayNumber(dayNumber: number) {
  const date = new Date(dayNumber * DAY_MS);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function firstOccurrenceOnOrAfter(anchorDay: number, targetDay: number, intervalDays: number) {
  return anchorDay + Math.ceil((targetDay - anchorDay) / intervalDays) * intervalDays;
}

function moveFreshness(move: ScheduledBillDateMove): number {
  const parsed = Date.parse(move.updated_at ?? move.created_at ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

export function isValidDateInMonth(date: string, month: number, year: number): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return false;
  const parsedYear = Number(match[1]);
  const parsedMonth = Number(match[2]);
  const day = Number(match[3]);
  return parsedYear === year && parsedMonth === month + 1 && day >= 1 && day <= new Date(year, month + 1, 0).getDate();
}

export function resolveFinalizedBillOccurrenceDays(
  occurrences: number[],
  paidDate: string | undefined,
  month: number,
  year: number,
): number[] {
  if (occurrences.length !== 1 || !paidDate || !isValidDateInMonth(paidDate, month, year)) return [...occurrences];
  return [Number(paidDate.slice(8, 10))];
}

export function moveSettledBillOverrideDate<T extends SettledBillOverride>(
  overrides: T[],
  billId: string,
  occurrenceDate: string,
  previousDate: string,
  nextDate: string,
): T[] {
  const [year, month] = occurrenceDate.slice(0, 10).split("-").map(Number);
  if (![year, month].every(Number.isFinite)) return overrides;

  return overrides.map(override => {
    const isOccurrence = override.bill_id === billId && override.year === year && override.month === month - 1;
    const isSettled = override.actual_amount !== undefined || override.paid_amount > 0.005;
    if (!isOccurrence || !isSettled || override.paid_date?.slice(0, 10) !== previousDate.slice(0, 10)) return override;
    return { ...override, paid_date: nextDate.slice(0, 10) };
  });
}

export function isBillActiveForMonth(bill: ScheduledBill, month: number, year: number): boolean {
  const date = new Date(year, month, 1);
  if (bill.start_date) {
    const [startYear, startMonth] = bill.start_date.split("-").map(Number);
    if (date < new Date(startYear, startMonth - 1, 1)) return false;
  }
  if (bill.end_date) {
    const [endYear, endMonth] = bill.end_date.split("-").map(Number);
    if (date > new Date(endYear, endMonth - 1, 1)) return false;
  }
  return true;
}

export function getBillOccurrenceDays(bill: ScheduledBill, month: number, year: number): number[] {
  if (!isBillActiveForMonth(bill, month, year)) return [];
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const withinActiveDates = (day: number) => {
    const occurrence = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return (!bill.start_date || occurrence >= bill.start_date.slice(0, 10))
      && (!bill.end_date || occurrence <= bill.end_date.slice(0, 10));
  };
  if (bill.frequency === "weekly") {
    const days: number[] = [];
    const dayOfWeek = bill.day_of_week ?? dateDayOfWeek(bill.next_payment_date ?? bill.start_date) ?? 0;
    for (let day = 1; day <= daysInMonth; day++) {
      if (new Date(Date.UTC(year, month, day)).getUTCDay() === dayOfWeek && withinActiveDates(day)) days.push(day);
    }
    return days;
  }
  if (bill.frequency === "biweekly") {
    return occurrenceDaysFromAnchor(bill.next_payment_date ?? bill.start_date, bill.due_day, month, year, 14)
      .filter(withinActiveDates);
  }
  if (bill.frequency === "quarterly") {
    const anchor = bill.next_payment_date ?? bill.start_date;
    const match = anchor ? /^(\d{4})-(\d{2})-(\d{2})/.exec(anchor) : null;
    if (!match) return [];
    const anchorMonthIndex = Number(match[1]) * 12 + Number(match[2]) - 1;
    const requestedMonthIndex = year * 12 + month;
    if (requestedMonthIndex < anchorMonthIndex || (requestedMonthIndex - anchorMonthIndex) % 3 !== 0) return [];
    const day = Math.min(bill.due_day || Number(match[3]), daysInMonth);
    return day > 0 && withinActiveDates(day) ? [day] : [];
  }
  const day = Math.min(bill.due_day, daysInMonth);
  return day > 0 && withinActiveDates(day) ? [day] : [];
}

export function applyBillDateMovesToOccurrenceDays(
  billId: string,
  month: number,
  year: number,
  occurrences: number[],
  moves: ScheduledBillDateMove[] = [],
): number[] {
  const monthPrefix = `${year}-${String(month + 1).padStart(2, "0")}`;
  const dateFromDay = (day: number) => `${monthPrefix}-${String(day).padStart(2, "0")}`;
  const activeMovesByOriginalDate = new Map<string, ScheduledBillDateMove>();
  moves
    .filter(move => move.bill_id === billId)
    .forEach(move => {
      const existing = activeMovesByOriginalDate.get(move.from_date);
      if (!existing || moveFreshness(move) >= moveFreshness(existing)) {
        activeMovesByOriginalDate.set(move.from_date, move);
      }
    });
  const activeMoves = Array.from(activeMovesByOriginalDate.values());
  const kept = occurrences.filter(day => !activeMoves.some(move =>
    move.bill_id === billId && move.from_date === dateFromDay(day)
  ));
  const movedIn = activeMoves
    .filter(move => move.to_date.startsWith(monthPrefix))
    .map(move => Number(move.to_date.slice(8, 10)))
    .filter(day => Number.isFinite(day));
  return Array.from(new Set([...kept, ...movedIn])).sort((a, b) => a - b);
}

export function isIncomeActiveForMonth(income: ScheduledIncome, month: number, year: number): boolean {
  if (!income.start_date) return true;
  const [startYear, startMonth] = income.start_date.split("-").map(Number);
  return new Date(year, month, 1) >= new Date(startYear, startMonth - 1, 1);
}

export function getIncomeOccurrenceDays(income: ScheduledIncome, month: number, year: number): number[] {
  if (!isIncomeActiveForMonth(income, month, year)) return [];
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const excludedDates = new Set(normalizeIncomeExcludedDates(income.excluded_dates));
  const isIncluded = (day: number) => {
    const occurrence = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return !excludedDates.has(occurrence);
  };
  const onOrAfterStart = (day: number) => {
    if (!income.start_date) return true;
    const occurrence = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return occurrence >= income.start_date.slice(0, 10);
  };
  if (income.frequency === "monthly") {
    const anchorDate = income.next_payment_date || income.start_date;
    if (!anchorDate) return isIncluded(1) ? [1] : [];
    const [, , day] = anchorDate.split("-").map(Number);
    const occurrenceDay = Math.min(Math.max(day || 1, 1), daysInMonth);
    return onOrAfterStart(occurrenceDay) && isIncluded(occurrenceDay) ? [occurrenceDay] : [];
  }
  const intervalDays = income.frequency === "biweekly" ? 14 : 7;
  if (!income.next_payment_date) return [];
  const anchor = parseCalendarDate(income.next_payment_date);
  if (!anchor) return [];
  const monthStart = calendarDayNumber({ year, month: month + 1, day: 1 });
  const nextMonthStart = calendarDayNumber(
    month === 11
      ? { year: year + 1, month: 1, day: 1 }
      : { year, month: month + 2, day: 1 },
  );
  let cursor = firstOccurrenceOnOrAfter(calendarDayNumber(anchor), monthStart, intervalDays);
  const days: number[] = [];
  while (cursor < nextMonthStart) {
    days.push(new Date(cursor * DAY_MS).getUTCDate());
    cursor += intervalDays;
  }
  return days.filter(day => onOrAfterStart(day) && isIncluded(day));
}

export function getUpcomingIncomeOccurrenceDates(
  income: ScheduledIncome,
  fromDate: string,
  count = 4,
): string[] {
  if (income.frequency === "monthly" || !income.next_payment_date) return [];
  const anchor = parseCalendarDate(income.next_payment_date);
  const from = parseCalendarDate(fromDate);
  if (!anchor || !from || !Number.isSafeInteger(count) || count < 1) return [];
  const intervalDays = income.frequency === "biweekly" ? 14 : 7;
  let cursor = firstOccurrenceOnOrAfter(
    calendarDayNumber(anchor),
    Math.max(calendarDayNumber(anchor), calendarDayNumber(from)),
    intervalDays,
  );
  return Array.from({ length: Math.min(count, 52) }, () => {
    const occurrence = calendarDateFromDayNumber(cursor);
    cursor += intervalDays;
    return occurrence;
  });
}

/**
 * A bank deposit can post a few days before or after its planned payday. Keep
 * the bank date as the cash date, but settle the nearest scheduled occurrence
 * so the forecast does not leave a second copy of the same paycheck behind.
 */
export function resolveIncomeMatchOccurrenceDate(
  income: ScheduledIncome,
  transactionDate: string,
  requestedOccurrenceDate?: string,
): string | undefined {
  const reference = /^\d{4}-\d{2}-\d{2}$/.test(transactionDate.slice(0, 10))
    ? transactionDate.slice(0, 10)
    : undefined;
  const requested = requestedOccurrenceDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedOccurrenceDate.slice(0, 10))
    ? requestedOccurrenceDate.slice(0, 10)
    : undefined;
  if (!reference) return requested;

  const candidates = getIncomeMatchOccurrenceDates(income, reference);

  if (requested && candidates.includes(requested)) return requested;
  return candidates[0] ?? requested ?? reference;
}

export function getIncomeMatchOccurrenceDates(
  income: ScheduledIncome,
  transactionDate: string,
  maxDistanceDays = 14,
): string[] {
  const reference = /^\d{4}-\d{2}-\d{2}$/.test(transactionDate.slice(0, 10))
    ? transactionDate.slice(0, 10)
    : undefined;
  if (!reference) return [];

  const referenceTime = Date.parse(`${reference}T00:00:00Z`);
  const [referenceYear, referenceMonth] = reference.split("-").map(Number);
  const maximumDistance = Number.isFinite(maxDistanceDays) ? Math.max(0, maxDistanceDays) : 14;
  const candidates: string[] = [];
  for (let offset = -1; offset <= 1; offset += 1) {
    const cursor = new Date(referenceYear, referenceMonth - 1 + offset, 1);
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    getIncomeOccurrenceDays(income, month, year).forEach(day => {
      candidates.push(`${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
    });
  }

  return candidates
    .map(date => ({ date, distance: Math.abs(Date.parse(`${date}T00:00:00Z`) - referenceTime) / 86_400_000 }))
    .filter(candidate => Number.isFinite(candidate.distance) && candidate.distance <= maximumDistance)
    .sort((left, right) => left.distance - right.distance || left.date.localeCompare(right.date))
    .map(candidate => candidate.date);
}

export function getBillMatchOccurrenceDates(
  bill: ScheduledBill & { id?: string },
  transactionDate: string,
  maxDistanceDays = 14,
  moves: ScheduledBillDateMove[] = [],
): string[] {
  const reference = parseCalendarDate(transactionDate);
  if (!reference) return [];
  const referenceDay = calendarDayNumber(reference);
  const maximumDistance = Number.isFinite(maxDistanceDays) ? Math.max(0, maxDistanceDays) : 14;
  const candidates: string[] = [];

  for (let offset = -1; offset <= 1; offset += 1) {
    const monthCursor = new Date(Date.UTC(reference.year, reference.month - 1 + offset, 1));
    const year = monthCursor.getUTCFullYear();
    const month = monthCursor.getUTCMonth();
    const originalDays = getBillOccurrenceDays(bill, month, year);
    const days = bill.id
      ? applyBillDateMovesToOccurrenceDays(bill.id, month, year, originalDays, moves)
      : originalDays;
    days.forEach((day) => {
      candidates.push(`${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
    });
  }

  return Array.from(new Set(candidates))
    .map((date) => {
      const parts = parseCalendarDate(date)!;
      return { date, distance: Math.abs(calendarDayNumber(parts) - referenceDay) };
    })
    .filter((candidate) => candidate.distance <= maximumDistance)
    .sort((left, right) => left.distance - right.distance || left.date.localeCompare(right.date))
    .map((candidate) => candidate.date);
}

export function normalizeIncomeExcludedDates(dates: unknown): string[] {
  if (!Array.isArray(dates)) return [];
  return Array.from(new Set(
    dates
      .filter((date): date is string => typeof date === "string")
      .map(date => date.slice(0, 10))
      .filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date)),
  )).sort();
}

function dateDayOfWeek(date?: string): number | null {
  const parts = parseCalendarDate(date);
  if (!parts) return null;
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
}

function occurrenceDaysFromAnchor(anchorDate: string | undefined, fallbackDay: number, month: number, year: number, intervalDays: number): number[] {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const fallback = Math.min(Math.max(1, fallbackDay || 1), daysInMonth);
  const anchor = anchorDate ?? `${year}-${String(month + 1).padStart(2, "0")}-${String(fallback).padStart(2, "0")}`;
  const anchorParts = parseCalendarDate(anchor);
  if (!anchorParts) return [fallback];
  const monthStart = calendarDayNumber({ year, month: month + 1, day: 1 });
  const nextMonthStart = calendarDayNumber(
    month === 11
      ? { year: year + 1, month: 1, day: 1 }
      : { year, month: month + 2, day: 1 },
  );
  let cursor = firstOccurrenceOnOrAfter(calendarDayNumber(anchorParts), monthStart, intervalDays);

  const days: number[] = [];
  while (cursor < nextMonthStart) {
    days.push(new Date(cursor * DAY_MS).getUTCDate());
    cursor += intervalDays;
  }
  return days;
}

export function getEffectiveIncomeAmount(income: ScheduledIncome, month: number, year: number): number {
  if (!income.amount_history?.length) return income.amount;
  const target = new Date(year, month, 1);
  const sorted = [...income.amount_history].sort((a, b) => a.effective_from.localeCompare(b.effective_from));
  let effective = income.amount;
  for (const entry of sorted) {
    const [entryYear, entryMonth] = entry.effective_from.split("-").map(Number);
    if (new Date(entryYear, entryMonth - 1, 1) <= target) effective = entry.amount;
  }
  return effective;
}

export function getLatestRecordedIncomeAmount(income: ScheduledIncome): number {
  if (!income.amount_history?.length) return income.amount;
  return [...income.amount_history]
    .sort((a, b) => a.effective_from.localeCompare(b.effective_from))
    .at(-1)?.amount ?? income.amount;
}

export function incomeAmountToMonthly(amount: number, frequency: ScheduledIncome["frequency"]): number {
  if (frequency === "biweekly") return amount * 26 / 12;
  if (frequency === "weekly") return amount * 52 / 12;
  return amount;
}

export type LatestIncomeChange = {
  currentAmount: number;
  difference: number;
  effectiveFrom: string;
  monthlyDifference: number;
  previousAmount: number;
};

export function getLatestIncomeChange(income: ScheduledIncome): LatestIncomeChange | null {
  if (!income.amount_history?.length) return null;
  const sorted = [...income.amount_history].sort((a, b) => a.effective_from.localeCompare(b.effective_from));
  const latest = sorted.at(-1);
  if (!latest) return null;
  const previousAmount = sorted.length > 1 ? sorted[sorted.length - 2].amount : income.amount;
  const difference = Math.round((latest.amount - previousAmount) * 100) / 100;
  return {
    currentAmount: latest.amount,
    difference,
    effectiveFrom: latest.effective_from,
    monthlyDifference: incomeAmountToMonthly(difference, income.frequency),
    previousAmount,
  };
}
