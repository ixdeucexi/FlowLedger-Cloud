export interface ScheduledBill {
  frequency: "monthly" | "weekly";
  due_day: number;
  day_of_week?: number;
  start_date?: string;
  end_date?: string;
}

export interface ScheduledIncome {
  amount: number;
  frequency: "monthly" | "biweekly" | "weekly";
  start_date?: string;
  next_payment_date?: string;
  amount_history?: { effective_from: string; amount: number }[];
}

export function isValidDateInMonth(date: string, month: number, year: number): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return false;
  const parsedYear = Number(match[1]);
  const parsedMonth = Number(match[2]);
  const day = Number(match[3]);
  return parsedYear === year && parsedMonth === month + 1 && day >= 1 && day <= new Date(year, month + 1, 0).getDate();
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
  if (bill.frequency === "weekly") {
    const days: number[] = [];
    for (let day = 1; day <= daysInMonth; day++) {
      if (new Date(year, month, day).getDay() === (bill.day_of_week ?? 0)) days.push(day);
    }
    return days;
  }
  const day = Math.min(bill.due_day, daysInMonth);
  return day > 0 ? [day] : [];
}

export function isIncomeActiveForMonth(income: ScheduledIncome, month: number, year: number): boolean {
  if (!income.start_date) return true;
  const [startYear, startMonth] = income.start_date.split("-").map(Number);
  return new Date(year, month, 1) >= new Date(startYear, startMonth - 1, 1);
}

export function getIncomeOccurrenceDays(income: ScheduledIncome, month: number, year: number): number[] {
  if (!isIncomeActiveForMonth(income, month, year)) return [];
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  if (income.frequency === "monthly") {
    if (!income.next_payment_date) return [1];
    const [, , day] = income.next_payment_date.split("-").map(Number);
    return [Math.min(day, daysInMonth)];
  }
  const intervalDays = income.frequency === "biweekly" ? 14 : 7;
  if (!income.next_payment_date) return [];
  const [nextYear, nextMonth, nextDay] = income.next_payment_date.split("-").map(Number);
  let cursor = new Date(nextYear, nextMonth - 1, nextDay);
  const target = new Date(year, month, 1);
  while (cursor > target) cursor = new Date(cursor.getTime() - intervalDays * 86_400_000);
  while (cursor < target) cursor = new Date(cursor.getTime() + intervalDays * 86_400_000);
  const days: number[] = [];
  while (cursor.getMonth() === month && cursor.getFullYear() === year) {
    days.push(cursor.getDate());
    cursor = new Date(cursor.getTime() + intervalDays * 86_400_000);
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
