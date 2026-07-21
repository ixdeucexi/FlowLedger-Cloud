import { addDateOnlyDays } from "./dateLabels";

export interface PaycheckPlanIncome {
  id?: string;
  name: string;
  amount: number;
  date: string;
}

export interface PaycheckPlanBill {
  id?: string;
  name: string;
  amount: number;
  dueDate: string;
}

export interface PaycheckPlanDay {
  date: string;
  balance: number;
}

export interface PaycheckPlanResult {
  nextPaycheck: PaycheckPlanIncome | null;
  windowStart: string;
  windowEnd: string;
  billsDue: PaycheckPlanBill[];
  billsTotal: number;
  safeToSpend: number;
  lowestBalance: number;
  lowestBalanceDate: string;
  status: "safe" | "tight" | "risk" | "empty";
}

function dateOnly(value: string) {
  return value.slice(0, 10);
}

function formatDateKey(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function getPaycheckPlanStatus(lowestBalance: number, safeToSpend: number, safetyFloor: number): PaycheckPlanResult["status"] {
  if (lowestBalance < safetyFloor) return "risk";
  if (safeToSpend < 100) return "tight";
  return "safe";
}

export function buildPaycheckPlan(
  incomes: PaycheckPlanIncome[],
  bills: PaycheckPlanBill[],
  balances: PaycheckPlanDay[],
  safetyFloor: number,
  todayIso: string
): PaycheckPlanResult {
  const today = dateOnly(todayIso);
  const upcomingIncome = incomes
    .map(income => ({ ...income, date: dateOnly(income.date) }))
    .filter(income => income.date > today)
    .sort((a, b) => a.date.localeCompare(b.date) || b.amount - a.amount);

  const nextPaycheck = upcomingIncome[0] ?? null;
  const windowEnd = nextPaycheck ? addDateOnlyDays(nextPaycheck.date, -1) : today;
  const windowBalances = balances
    .map(day => ({ ...day, date: dateOnly(day.date) }))
    .filter(day => day.date >= today && day.date <= windowEnd)
    .sort((a, b) => a.date.localeCompare(b.date));

  const lowest = windowBalances.reduce<PaycheckPlanDay | null>((best, day) => {
    if (!best || day.balance < best.balance) return day;
    return best;
  }, null);

  const lowestBalance = lowest?.balance ?? balances.find(day => dateOnly(day.date) === today)?.balance ?? 0;
  const lowestBalanceDate = lowest?.date ?? today;
  const billsDue = bills
    .map(bill => ({ ...bill, dueDate: dateOnly(bill.dueDate), amount: Math.max(0, bill.amount) }))
    .filter(bill => bill.amount > 0 && bill.dueDate >= today && bill.dueDate <= windowEnd)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || b.amount - a.amount);
  const billsTotal = billsDue.reduce((sum, bill) => sum + bill.amount, 0);
  const safeToSpend = Math.max(0, lowestBalance - safetyFloor);

  return {
    nextPaycheck,
    windowStart: today,
    windowEnd,
    billsDue,
    billsTotal,
    safeToSpend,
    lowestBalance,
    lowestBalanceDate,
    status: nextPaycheck ? getPaycheckPlanStatus(lowestBalance, safeToSpend, safetyFloor) : "empty",
  };
}

export function makeDateKey(year: number, month: number, day: number) {
  return formatDateKey(year, month, day);
}
