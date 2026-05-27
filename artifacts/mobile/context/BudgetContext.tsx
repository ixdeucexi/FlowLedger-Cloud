import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface Bill {
  id: string;
  name: string;
  amount: number;
  category: string;
  priority: number;
  is_debt: boolean;
  balance: number;
  interest_rate: number;
  due_day: number;            // 1–31, used for monthly bills
  day_of_week?: number;       // 0=Sun … 6=Sat, used for weekly bills
  start_date?: string;        // YYYY-MM-DD, when scheduling begins (inclusive)
  end_date?: string;          // YYYY-MM-DD, when scheduling ends (inclusive); null = indefinite
  is_recurring: boolean;
  frequency: "monthly" | "weekly";
  created_at: string;
}

export interface MonthlyOverride {
  id: string;
  bill_id: string;
  month: number;
  year: number;
  custom_amount?: number;
  custom_due_day?: number;
  paid_amount: number;
}

export interface Transaction {
  id: string;
  date: string;
  amount: number;
  category: string;
  note: string;
  linked_bill_id?: string;
}

export interface IncomeAmountEntry {
  effective_from: string;  // "YYYY-MM" — month this amount takes effect (inclusive)
  amount: number;          // per-paycheck amount from this month forward
}

export interface IncomeItem {
  id: string;
  name: string;
  amount: number;                        // base / original per-paycheck amount
  frequency: "monthly" | "biweekly" | "weekly";
  start_date?: string;
  next_payment_date?: string;
  amount_history?: IncomeAmountEntry[];  // sorted by effective_from ascending
}

export interface Goal {
  id: string;
  name: string;
  target_amount: number;
  target_date: string;
  current_amount: number;
  created_at: string;
}

export interface GoalAffordability {
  projectedBalance: number;
  canAfford: boolean;
  shortfall: number;
}

export interface SnowballAllocation {
  billId: string;
  billName: string;
  payment: number;
  balanceBefore: number;
  balanceAfter: number;
  paidOff: boolean;
}

export interface ExtraPayment {
  id: string;
  month: number;
  year: number;
  amount: number;
  allocations: SnowballAllocation[];
}

export interface Settings {
  paymentMethod: "snowball" | "avalanche";
  starting_balance: number;        // user's real account balance on starting_balance_date
  starting_balance_date?: string;  // YYYY-MM-DD — the date the starting balance applies to
}

export interface CashFlow {
  monthlyIncome: number;
  totalBillsDue: number;
  totalPaid: number;
  netTransactions: number;
  goalAllocations: number;
  remaining: number;
}

export interface GoalExpense {
  id: string;
  name: string;
  amount: number;
}

export interface DailyBalance {
  day: number;
  income: number;
  scheduledIncome: number;
  expense: number;
  bills: number;
  goalExpenses: GoalExpense[];
  net: number;
  balance: number;
}

export type DashboardFilter = null | "paid" | "unpaid" | "debts";

// ─── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_CATEGORIES = [
  "Housing", "Utilities", "Insurance", "Transportation",
  "Food", "Entertainment", "Health", "Education",
  "Savings", "Debt", "Shopping", "Rent", "Other",
];

const DEFAULT_SETTINGS: Settings = {
  paymentMethod: "snowball",
  starting_balance: 0,
};

const BILLS_KEY = "@budget_bills_v3";
const OVERRIDES_KEY = "@budget_overrides_v1";
const TRANSACTIONS_KEY = "@budget_transactions_v2";
const INCOMES_KEY = "@budget_incomes_v1";
const GOALS_KEY = "@budget_goals_v1";
const SETTINGS_KEY = "@budget_settings_v4";
const CATEGORIES_KEY = "@budget_categories_v1";
const EXTRA_PAYMENTS_KEY = "@budget_extra_payments_v1";

const SEED_BILLS: Bill[] = [
  { id: "s1", name: "Rent",        amount: 1200, category: "Housing",   priority: 99, is_debt: false, balance: 0,    interest_rate: 0,    due_day: 1,  is_recurring: true, frequency: "monthly", created_at: new Date().toISOString() },
  { id: "s2", name: "Electric",    amount:   95, category: "Utilities",  priority: 99, is_debt: false, balance: 0,    interest_rate: 0,    due_day: 10, is_recurring: true, frequency: "monthly", created_at: new Date().toISOString() },
  { id: "s3", name: "Internet",    amount:   60, category: "Utilities",  priority: 99, is_debt: false, balance: 0,    interest_rate: 0,    due_day: 15, is_recurring: true, frequency: "monthly", created_at: new Date().toISOString() },
  { id: "s4", name: "Car Loan",    amount:  350, category: "Debt",       priority: 2,  is_debt: true,  balance: 4200, interest_rate: 6.5,  due_day: 20, is_recurring: true, frequency: "monthly", created_at: new Date().toISOString() },
  { id: "s5", name: "Credit Card", amount:  120, category: "Debt",       priority: 3,  is_debt: true,  balance: 1850, interest_rate: 22.9, due_day: 25, is_recurring: true, frequency: "monthly", created_at: new Date().toISOString() },
  { id: "s6", name: "Medical Bill",amount:   75, category: "Debt",       priority: 1,  is_debt: true,  balance: 650,  interest_rate: 0,    due_day: 5,  is_recurring: true, frequency: "monthly", created_at: new Date().toISOString() },
  { id: "s7", name: "Groceries",   amount:  400, category: "Food",       priority: 99, is_debt: false, balance: 0,    interest_rate: 0,    due_day: 1,  is_recurring: true, frequency: "monthly", created_at: new Date().toISOString() },
  { id: "s8", name: "Insurance",   amount:  180, category: "Insurance",  priority: 99, is_debt: false, balance: 0,    interest_rate: 0,    due_day: 8,  is_recurring: true, frequency: "monthly", created_at: new Date().toISOString() },
];

const SEED_INCOMES: IncomeItem[] = [
  { id: "i1", name: "Primary Job", amount: 4500, frequency: "monthly" },
];

// ─── Pure helpers (outside hooks, no closure overhead) ─────────────────────────

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

function incomeToMonthly(amount: number, frequency: IncomeItem["frequency"]): number {
  if (frequency === "weekly")   return amount * 4;   // 4 occurrences as a generic estimate
  if (frequency === "biweekly") return amount * 2;   // exactly 2 per month
  return amount;
}

/**
 * Returns the per-paycheck amount for a given month, respecting amount_history.
 * Falls back to income.amount when no history is recorded.
 */
function getEffectiveIncomeAmount(income: IncomeItem, month: number, year: number): number {
  if (!income.amount_history || income.amount_history.length === 0) return income.amount;
  const monthStr = `${year}-${String(month + 1).padStart(2, "0")}`;
  // Find the most recent entry whose effective_from is ≤ this month
  const sorted = [...income.amount_history].sort((a, b) => b.effective_from.localeCompare(a.effective_from));
  const match = sorted.find(h => h.effective_from <= monthStr);
  if (match) return match.amount;
  // Month is before all history entries — use the oldest recorded amount
  return sorted[sorted.length - 1].amount;
}

function isIncomeActiveForMonth(income: IncomeItem, month: number, year: number): boolean {
  if (!income.start_date) return true;
  const [sy, sm] = income.start_date.split("-").map(Number);
  return year > sy || (year === sy && month >= sm - 1);
}

/** Returns true when the bill schedule covers any day of the given month. */
function isBillActiveForMonth(bill: Bill, month: number, year: number): boolean {
  const monthStart = new Date(year, month, 1);
  const monthEnd   = new Date(year, month + 1, 0);   // last day
  if (bill.start_date) {
    const sd = new Date(bill.start_date + "T00:00:00");
    if (sd > monthEnd) return false;
  }
  if (bill.end_date) {
    const ed = new Date(bill.end_date + "T00:00:00");
    if (ed < monthStart) return false;
  }
  return true;
}

/**
 * Returns 1-indexed days within the given month when this income source pays out.
 * - monthly  → single occurrence (on the start_date's day-of-month if in the start month, otherwise day 1)
 * - biweekly → every 14 days anchored to start_date
 * - weekly   → every 7 days anchored to start_date
 */
function getIncomeOccurrenceDays(income: IncomeItem, month: number, year: number): number[] {
  if (!isIncomeActiveForMonth(income, month, year)) return [];

  const daysInMonth = new Date(year, month + 1, 0).getDate();

  if (income.frequency === "monthly") {
    // Always use start_date's day-of-month so income lands on the same date each month
    if (income.start_date) {
      const [, , sd] = income.start_date.split("-").map(Number);
      return [Math.min(sd, daysInMonth)];
    }
    return [1];
  }

  // Weekly / biweekly: anchor to start_date (or day 1 if unset) and step forward
  const intervalDays = income.frequency === "biweekly" ? 14 : 7;
  let anchor: Date;
  if (income.start_date) {
    anchor = new Date(income.start_date + "T00:00:00");
  } else {
    anchor = new Date(year, month, 1);
  }

  const monthStart = new Date(year, month, 1);
  const monthEnd   = new Date(year, month + 1, 0);

  // Fast-forward anchor to first occurrence on or after the month's start
  let current = new Date(anchor);
  if (current < monthStart) {
    const msPerInterval = intervalDays * 86400000;
    const diff = monthStart.getTime() - current.getTime();
    const steps = Math.floor(diff / msPerInterval);
    current = new Date(current.getTime() + steps * msPerInterval);
    // Advance one more step if still before monthStart
    if (current < monthStart) current = new Date(current.getTime() + msPerInterval);
  }

  const days: number[] = [];
  while (current <= monthEnd) {
    days.push(current.getDate());
    current = new Date(current.getTime() + intervalDays * 86400000);
  }
  return days;
}

/**
 * Returns the 1-indexed day numbers within the given month when the bill is due.
 * For monthly bills → [due_day].
 * For weekly bills → all weekdays matching day_of_week within the month.
 * Returns [] if bill is not active for that month.
 */
function getBillOccurrenceDays(bill: Bill, month: number, year: number): number[] {
  // Debt bills are always monthly obligations regardless of the is_recurring flag
  if (!bill.is_recurring && !bill.is_debt) return [];
  if (!isBillActiveForMonth(bill, month, year)) return [];
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  if (bill.frequency === "weekly") {
    const dow = bill.day_of_week ?? 0;
    const firstDayOfMonth = new Date(year, month, 1).getDay(); // 0=Sun
    const firstOcc = (dow - firstDayOfMonth + 7) % 7 + 1;     // 1-indexed
    const days: number[] = [];
    for (let d = firstOcc; d <= daysInMonth; d += 7) days.push(d);
    return days;
  } else {
    const d = Math.min(bill.due_day, daysInMonth);
    return d >= 1 ? [d] : [];
  }
}

function reorderDebtPriorities(allBills: Bill[]): Bill[] {
  const nonDebts = allBills.filter(b => !b.is_debt);
  const debts = allBills
    .filter(b => b.is_debt)
    .sort((a, b) => a.balance - b.balance)
    .map((b, i) => ({ ...b, priority: i + 1 }));
  return [...nonDebts, ...debts];
}

// ─── Context type ──────────────────────────────────────────────────────────────

interface BudgetContextType {
  bills: Bill[];
  overrides: MonthlyOverride[];
  transactions: Transaction[];
  incomes: IncomeItem[];
  goals: Goal[];
  extraPayments: ExtraPayment[];
  categories: string[];
  settings: Settings;
  loading: boolean;
  dashboardFilter: DashboardFilter;
  setDashboardFilter: (f: DashboardFilter) => void;

  addBill: (bill: Omit<Bill, "id" | "created_at">) => void;
  updateBill: (bill: Bill) => void;
  deleteBill: (id: string) => void;
  getBillById: (id: string) => Bill | undefined;

  getOverride: (billId: string, month: number, year: number) => MonthlyOverride | undefined;
  getAmount: (bill: Bill, month: number, year: number) => number;
  getPaidAmount: (billId: string, month: number, year: number) => number;
  setPaidAmount: (billId: string, month: number, year: number, amount: number) => void;
  setCustomAmount: (billId: string, month: number, year: number, amount: number | undefined) => void;
  getCustomDueDay: (billId: string, month: number, year: number) => number | undefined;
  setCustomDueDay: (billId: string, month: number, year: number, day: number | undefined) => void;

  getMonthlyBills: (month: number, year: number) => Bill[];
  getBillOccurrencesInMonth: (bill: Bill, month: number, year: number) => number[];
  getBillMonthlyTotal: (bill: Bill, month: number, year: number) => number;

  runSnowball: (month: number, year: number, extraAmount: number) => SnowballAllocation[];
  saveExtraPayment: (month: number, year: number, amount: number, allocations: SnowballAllocation[]) => void;
  getExtraPayment: (month: number, year: number) => ExtraPayment | undefined;
  deleteExtraPayment: (id: string) => void;

  addTransaction: (tx: Omit<Transaction, "id">) => void;
  updateTransaction: (tx: Transaction) => void;
  deleteTransaction: (id: string) => void;
  getTransactionsForMonth: (month: number, year: number) => Transaction[];

  addIncome: (item: Omit<IncomeItem, "id">) => void;
  updateIncome: (item: IncomeItem) => void;
  deleteIncome: (id: string) => void;
  getMonthlyIncome: (month?: number, year?: number) => number;
  getIncomeOccurrencesInMonth: (month: number, year: number) => { income: IncomeItem; days: number[] }[];

  addGoal: (goal: Omit<Goal, "id" | "created_at">) => void;
  updateGoal: (goal: Goal) => void;
  deleteGoal: (id: string) => void;
  checkGoalAffordability: (goal: Goal, month: number, year: number) => GoalAffordability;

  getCashFlow: (month: number, year: number) => CashFlow;
  getDailyBalances: (month: number, year: number) => DailyBalance[];

  addCategory: (name: string) => void;
  updateCategory: (oldName: string, newName: string) => void;
  deleteCategory: (name: string) => void;

  updateSettings: (s: Partial<Settings>) => void;
  importBills: (bills: Omit<Bill, "id" | "created_at">[]) => void;

  selectedYear: number;
  setSelectedYear: (y: number) => void;
}

const BudgetContext = createContext<BudgetContextType | undefined>(undefined);

// ─── Provider ──────────────────────────────────────────────────────────────────

export function BudgetProvider({ children }: { children: React.ReactNode }) {
  const [bills,         setBills]         = useState<Bill[]>([]);
  const [overrides,     setOverrides]     = useState<MonthlyOverride[]>([]);
  const [transactions,  setTransactions]  = useState<Transaction[]>([]);
  const [incomes,       setIncomes]       = useState<IncomeItem[]>([]);
  const [goals,         setGoals]         = useState<Goal[]>([]);
  const [extraPayments, setExtraPayments] = useState<ExtraPayment[]>([]);
  const [categories,    setCategories]    = useState<string[]>(DEFAULT_CATEGORIES);
  const [settings,      setSettings]      = useState<Settings>(DEFAULT_SETTINGS);
  const [loading,       setLoading]       = useState(true);
  const [selectedYear,  setSelectedYear]  = useState(new Date().getFullYear());
  const [dashboardFilter, setDashboardFilter] = useState<DashboardFilter>(null);

  // ── Load from AsyncStorage ────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const [bd, od, td, ind, gd, sd, cd, epd] = await Promise.all([
          AsyncStorage.getItem(BILLS_KEY),
          AsyncStorage.getItem(OVERRIDES_KEY),
          AsyncStorage.getItem(TRANSACTIONS_KEY),
          AsyncStorage.getItem(INCOMES_KEY),
          AsyncStorage.getItem(GOALS_KEY),
          AsyncStorage.getItem(SETTINGS_KEY),
          AsyncStorage.getItem(CATEGORIES_KEY),
          AsyncStorage.getItem(EXTRA_PAYMENTS_KEY),
        ]);

        let loadedBills: Bill[] = bd
          ? JSON.parse(bd)
          : reorderDebtPriorities(SEED_BILLS);
        // Migrate: fill in any missing fields with defaults
        loadedBills = loadedBills.map(b => ({ frequency: "monthly", day_of_week: 0, ...b }));
        // Migrate: debt bills must always be recurring (they are monthly obligations)
        loadedBills = loadedBills.map(b => b.is_debt && !b.is_recurring ? { ...b, is_recurring: true } : b);
        if (!bd) await AsyncStorage.setItem(BILLS_KEY, JSON.stringify(reorderDebtPriorities(SEED_BILLS)));

        const loadedIncomes: IncomeItem[] = ind ? JSON.parse(ind) : SEED_INCOMES;
        if (!ind) await AsyncStorage.setItem(INCOMES_KEY, JSON.stringify(SEED_INCOMES));

        setBills(loadedBills);
        if (od) setOverrides(JSON.parse(od));
        if (td) setTransactions(JSON.parse(td));
        setIncomes(loadedIncomes);
        if (gd) setGoals(JSON.parse(gd));
        if (sd) setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(sd) });
        if (cd) setCategories(JSON.parse(cd));
        if (epd) setExtraPayments(JSON.parse(epd));
      } catch (e) {
        console.error("[BudgetContext] load error:", e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // ─── Bills ────────────────────────────────────────────────────────────────────

  const addBill = useCallback((bill: Omit<Bill, "id" | "created_at">) => {
    const nb: Bill = { ...bill, id: genId(), created_at: new Date().toISOString() };
    setBills(prev => {
      const reordered = reorderDebtPriorities([...prev, nb]);
      AsyncStorage.setItem(BILLS_KEY, JSON.stringify(reordered));
      return reordered;
    });
  }, []);

  const updateBill = useCallback((bill: Bill) => {
    // When the amount changes, lock every past month that has a payment record
    // at the OLD amount so history is never retroactively altered.
    const existing = bills.find(b => b.id === bill.id);
    if (existing && existing.amount !== bill.amount) {
      const now      = new Date();
      const curMonth = now.getMonth();   // 0-indexed
      const curYear  = now.getFullYear();
      setOverrides(prev => {
        let changed = false;
        const next = prev.map(o => {
          if (o.bill_id !== bill.id) return o;
          const isPast =
            o.year < curYear ||
            (o.year === curYear && o.month < curMonth);
          if (isPast && o.custom_amount === undefined) {
            changed = true;
            return { ...o, custom_amount: existing.amount };
          }
          return o;
        });
        if (changed) AsyncStorage.setItem(OVERRIDES_KEY, JSON.stringify(next));
        return changed ? next : prev;
      });
    }
    setBills(prev => {
      const reordered = reorderDebtPriorities(prev.map(b => b.id === bill.id ? bill : b));
      AsyncStorage.setItem(BILLS_KEY, JSON.stringify(reordered));
      return reordered;
    });
  }, [bills]);

  const deleteBill = useCallback((id: string) => {
    setBills(prev => {
      const reordered = reorderDebtPriorities(prev.filter(b => b.id !== id));
      AsyncStorage.setItem(BILLS_KEY, JSON.stringify(reordered));
      return reordered;
    });
    setOverrides(prev => {
      const u = prev.filter(o => o.bill_id !== id);
      AsyncStorage.setItem(OVERRIDES_KEY, JSON.stringify(u));
      return u;
    });
  }, []);

  const getBillById = useCallback((id: string) => bills.find(b => b.id === id), [bills]);

  // ─── Overrides ────────────────────────────────────────────────────────────────

  const getOverride = useCallback(
    (billId: string, month: number, year: number) =>
      overrides.find(o => o.bill_id === billId && o.month === month && o.year === year),
    [overrides]
  );

  const getAmount = useCallback(
    (bill: Bill, month: number, year: number): number => {
      const o = overrides.find(o => o.bill_id === bill.id && o.month === month && o.year === year);
      return o?.custom_amount !== undefined ? o.custom_amount : bill.amount;
    },
    [overrides]
  );

  const getPaidAmount = useCallback(
    (billId: string, month: number, year: number): number =>
      overrides.find(o => o.bill_id === billId && o.month === month && o.year === year)?.paid_amount ?? 0,
    [overrides]
  );

  const upsertOverride = useCallback(
    (billId: string, month: number, year: number, patch: Partial<Omit<MonthlyOverride, "id" | "bill_id" | "month" | "year">>) => {
      setOverrides(prev => {
        const idx = prev.findIndex(o => o.bill_id === billId && o.month === month && o.year === year);
        const updated = idx !== -1
          ? prev.map((o, i) => i === idx ? { ...o, ...patch } : o)
          : [...prev, { id: genId(), bill_id: billId, month, year, paid_amount: 0, ...patch }];
        AsyncStorage.setItem(OVERRIDES_KEY, JSON.stringify(updated));
        return updated;
      });
    },
    []
  );

  const setPaidAmount = useCallback(
    (billId: string, month: number, year: number, amount: number) => {
      const prevPaid = overrides.find(o => o.bill_id === billId && o.month === month && o.year === year)?.paid_amount ?? 0;
      upsertOverride(billId, month, year, { paid_amount: Math.max(0, amount) });
      const delta = amount - prevPaid;
      if (delta !== 0) {
        setBills(prev => {
          const bill = prev.find(b => b.id === billId);
          if (!bill?.is_debt) return prev;
          const reordered = reorderDebtPriorities(
            prev.map(b => b.id === billId ? { ...b, balance: Math.max(0, b.balance - delta) } : b)
          );
          AsyncStorage.setItem(BILLS_KEY, JSON.stringify(reordered));
          return reordered;
        });
      }
    },
    [upsertOverride, overrides]
  );

  const setCustomAmount = useCallback(
    (billId: string, month: number, year: number, amount: number | undefined) =>
      upsertOverride(billId, month, year, { custom_amount: amount }),
    [upsertOverride]
  );

  const getCustomDueDay = useCallback(
    (billId: string, month: number, year: number): number | undefined =>
      overrides.find(o => o.bill_id === billId && o.month === month && o.year === year)?.custom_due_day,
    [overrides]
  );

  const setCustomDueDay = useCallback(
    (billId: string, month: number, year: number, day: number | undefined) =>
      upsertOverride(billId, month, year, { custom_due_day: day }),
    [upsertOverride]
  );

  // ─── Bill scheduling helpers ──────────────────────────────────────────────────

  /** Returns 1-indexed days in `month`/`year` when `bill` is due.
   *  Respects bill.start_date, bill.end_date, bill.day_of_week for weekly bills,
   *  AND honours any custom_due_day override stored for this month. */
  const getBillOccurrencesInMonth = useCallback(
    (bill: Bill, month: number, year: number): number[] => {
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      let occ = getBillOccurrenceDays(bill, month, year);
      if (occ.length === 0) return occ;
      const o = overrides.find(
        ov => ov.bill_id === bill.id && ov.month === month && ov.year === year
      );
      if (o?.custom_due_day !== undefined && bill.frequency === "monthly") {
        occ = [Math.min(o.custom_due_day, daysInMonth)];
      }
      return occ;
    },
    [overrides]
  );

  /** Total amount billed for the given month (per-occurrence amount × number of occurrences). */
  const getBillMonthlyTotal = useCallback((bill: Bill, month: number, year: number): number => {
    const occurrences = getBillOccurrenceDays(bill, month, year);
    if (occurrences.length === 0) return 0;
    const perOccurrence = getAmount(bill, month, year);
    return perOccurrence * occurrences.length;
  }, [getAmount]);

  /** All recurring bills (and all debt bills) that are active for the given month/year. */
  const getMonthlyBills = useCallback(
    (month: number, year: number): Bill[] =>
      bills.filter(b => (b.is_recurring || b.is_debt) && isBillActiveForMonth(b, month, year)),
    [bills]
  );

  // ─── Snowball / Avalanche ─────────────────────────────────────────────────────

  const runSnowball = useCallback(
    (month: number, year: number, extraAmount: number): SnowballAllocation[] => {
      const debtBills = bills
        .filter(b => b.is_debt && b.balance > 0)
        .map(b => ({ ...b }));

      debtBills.sort(settings.paymentMethod === "snowball"
        ? (a, b) => a.balance - b.balance
        : (a, b) => b.interest_rate - a.interest_rate
      );

      const allocations: SnowballAllocation[] = [];
      let pool = extraAmount;
      let cascadePool = 0;
      const updatedBills = [...bills];

      for (let i = 0; i < debtBills.length; i++) {
        const debt = debtBills[i];
        const available = pool + cascadePool;
        if (available <= 0) break;

        const alreadyPaid = overrides.find(o => o.bill_id === debt.id && o.month === month && o.year === year)?.paid_amount ?? 0;
        const remaining = Math.max(0, debt.balance - alreadyPaid);
        const payment = Math.min(available, remaining);
        if (payment <= 0) continue;

        const balanceBefore = debt.balance;
        const balanceAfter  = Math.max(0, balanceBefore - payment);
        const paidOff       = balanceAfter === 0;

        allocations.push({ billId: debt.id, billName: debt.name, payment, balanceBefore, balanceAfter, paidOff });

        const bidx = updatedBills.findIndex(b => b.id === debt.id);
        if (bidx !== -1) updatedBills[bidx] = { ...updatedBills[bidx], balance: balanceAfter };
        upsertOverride(debt.id, month, year, { paid_amount: alreadyPaid + payment });

        if (paidOff) {
          // Cascade: freed minimum rolls permanently into next debt's effective minimum
          const nextDebt = debtBills.slice(i + 1).find(d => d.balance > payment);
          if (nextDebt) {
            const nidx = updatedBills.findIndex(b => b.id === nextDebt.id);
            if (nidx !== -1) {
              updatedBills[nidx] = { ...updatedBills[nidx], amount: updatedBills[nidx].amount + debt.amount };
            }
          }
          cascadePool = Math.max(0, available - payment);
          pool = 0;
        } else {
          pool = 0;
          cascadePool = 0;
        }
      }

      const reordered = reorderDebtPriorities(updatedBills);
      setBills(reordered);
      AsyncStorage.setItem(BILLS_KEY, JSON.stringify(reordered));
      return allocations;
    },
    [bills, settings.paymentMethod, overrides, upsertOverride]
  );

  const saveExtraPayment = useCallback((month: number, year: number, amount: number, allocations: SnowballAllocation[]) => {
    setExtraPayments(prev => {
      const existing = prev.findIndex(ep => ep.month === month && ep.year === year);
      const updated = existing !== -1
        ? prev.map((ep, i) => i === existing ? { ...ep, amount, allocations } : ep)
        : [...prev, { id: genId(), month, year, amount, allocations }];
      AsyncStorage.setItem(EXTRA_PAYMENTS_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const getExtraPayment = useCallback(
    (month: number, year: number) => extraPayments.find(ep => ep.month === month && ep.year === year),
    [extraPayments]
  );

  const deleteExtraPayment = useCallback((id: string) => {
    setExtraPayments(prev => {
      const u = prev.filter(ep => ep.id !== id);
      AsyncStorage.setItem(EXTRA_PAYMENTS_KEY, JSON.stringify(u));
      return u;
    });
  }, []);

  // ─── Transactions ─────────────────────────────────────────────────────────────

  const addTransaction = useCallback((tx: Omit<Transaction, "id">) => {
    setTransactions(prev => {
      const u = [...prev, { ...tx, id: genId() }];
      AsyncStorage.setItem(TRANSACTIONS_KEY, JSON.stringify(u));
      return u;
    });
  }, []);

  const updateTransaction = useCallback((tx: Transaction) => {
    setTransactions(prev => {
      const u = prev.map(t => t.id === tx.id ? tx : t);
      AsyncStorage.setItem(TRANSACTIONS_KEY, JSON.stringify(u));
      return u;
    });
  }, []);

  const deleteTransaction = useCallback((id: string) => {
    setTransactions(prev => {
      const u = prev.filter(t => t.id !== id);
      AsyncStorage.setItem(TRANSACTIONS_KEY, JSON.stringify(u));
      return u;
    });
  }, []);

  const getTransactionsForMonth = useCallback(
    (month: number, year: number) =>
      transactions.filter(t => {
        const [ty, tm] = t.date.split("-").map(Number);
        return ty === year && tm === month + 1;
      }),
    [transactions]
  );

  // ─── Income ───────────────────────────────────────────────────────────────────

  const addIncome = useCallback((item: Omit<IncomeItem, "id">) => {
    setIncomes(prev => {
      const u = [...prev, { ...item, id: genId() }];
      AsyncStorage.setItem(INCOMES_KEY, JSON.stringify(u));
      return u;
    });
  }, []);

  const updateIncome = useCallback((item: IncomeItem) => {
    setIncomes(prev => {
      const u = prev.map(i => i.id === item.id ? item : i);
      AsyncStorage.setItem(INCOMES_KEY, JSON.stringify(u));
      return u;
    });
  }, []);

  const deleteIncome = useCallback((id: string) => {
    setIncomes(prev => {
      const u = prev.filter(i => i.id !== id);
      AsyncStorage.setItem(INCOMES_KEY, JSON.stringify(u));
      return u;
    });
  }, []);

  const getMonthlyIncome = useCallback(
    (month?: number, year?: number) =>
      incomes
        .filter(i => month !== undefined && year !== undefined ? isIncomeActiveForMonth(i, month, year) : true)
        .reduce((s, i) => {
          if (month !== undefined && year !== undefined) {
            const amt = getEffectiveIncomeAmount(i, month, year);
            return s + getIncomeOccurrenceDays(i, month, year).length * amt;
          }
          return s + incomeToMonthly(i.amount, i.frequency);
        }, 0),
    [incomes]
  );

  const getIncomeOccurrencesInMonth = useCallback(
    (month: number, year: number): { income: IncomeItem; days: number[]; effectiveAmount: number }[] =>
      incomes
        .filter(i => isIncomeActiveForMonth(i, month, year))
        .map(i => ({
          income: i,
          days: getIncomeOccurrenceDays(i, month, year),
          effectiveAmount: getEffectiveIncomeAmount(i, month, year),
        }))
        .filter(x => x.days.length > 0),
    [incomes]
  );

  // ─── Goals ────────────────────────────────────────────────────────────────────

  const addGoal = useCallback((goal: Omit<Goal, "id" | "created_at">) => {
    setGoals(prev => {
      const u = [...prev, { ...goal, id: genId(), created_at: new Date().toISOString() }];
      AsyncStorage.setItem(GOALS_KEY, JSON.stringify(u));
      return u;
    });
  }, []);

  const updateGoal = useCallback((goal: Goal) => {
    setGoals(prev => {
      const u = prev.map(g => g.id === goal.id ? goal : g);
      AsyncStorage.setItem(GOALS_KEY, JSON.stringify(u));
      return u;
    });
  }, []);

  const deleteGoal = useCallback((id: string) => {
    setGoals(prev => {
      const u = prev.filter(g => g.id !== id);
      AsyncStorage.setItem(GOALS_KEY, JSON.stringify(u));
      return u;
    });
  }, []);

  const checkGoalAffordability = useCallback(
    (goal: Goal, month: number, year: number): GoalAffordability => {
      // Net cash flow (income − bills + transactions) for a single month — same
      // formula used inside getDailyBalances so both stay in sync.
      const monthNet = (m: number, y: number): number => {
        const inc = incomes.reduce((s, i) => s + getIncomeOccurrenceDays(i, m, y).length * i.amount, 0);
        const bil = bills.filter(b => b.is_recurring || b.is_debt).reduce((s, b) => {
          const occ = getBillOccurrenceDays(b, m, y);
          if (occ.length === 0) return s;
          const o = overrides.find(o => o.bill_id === b.id && o.month === m && o.year === y);
          const amt = o?.custom_amount !== undefined ? o.custom_amount : b.amount;
          return s + amt * occ.length;
        }, 0);
        const tx = transactions
          .filter(t => { const [ty, tm] = t.date.split("-").map(Number); return ty === y && tm === m + 1; })
          .reduce((s, t) => s + t.amount, 0);
        return inc + tx - bil;
      };

      // Determine the anchor: the month whose balance we seed from, and the seed value.
      let anchorM: number, anchorY: number, seed: number;

      if (settings.starting_balance_date) {
        const [sbY, sbM] = settings.starting_balance_date.split("-").map(Number);
        anchorM = sbM - 1; // 0-indexed
        anchorY = sbY;
        seed = settings.starting_balance;
        // Target is before the anchor — nothing is tracked yet
        if (year < anchorY || (year === anchorY && month < anchorM)) {
          const needed = Math.max(0, goal.target_amount - goal.current_amount);
          return { projectedBalance: 0, canAfford: needed === 0, shortfall: needed };
        }
      } else {
        // No explicit anchor date — use last month as anchor (mirrors getDailyBalances)
        // so the current month chains from last month's ending balance.
        const now = new Date();
        anchorM = now.getMonth() - 1;
        anchorY = now.getFullYear();
        if (anchorM < 0) { anchorM = 11; anchorY -= 1; }
        seed = settings.starting_balance;
        // Target is before the anchor — nothing meaningful to project
        if (year < anchorY || (year === anchorY && month < anchorM)) {
          const needed = Math.max(0, goal.target_amount - goal.current_amount);
          return { projectedBalance: seed, canAfford: seed >= needed, shortfall: Math.max(0, needed - seed) };
        }
      }

      // Iterate month by month from anchor → target, accumulating the running balance.
      // This mirrors what the calendar shows when you page through each month.
      // Always chain forward — goal projections must mirror what the calendar shows.
      let balance = seed;
      let m = anchorM, y = anchorY;
      while (y < year || (y === year && m <= month)) {
        balance = (m === anchorM && y === anchorY) ? seed + monthNet(m, y) : balance + monthNet(m, y);
        if (m === month && y === year) break;
        m++; if (m > 11) { m = 0; y++; }
      }

      const projectedBalance = balance;
      const needed = Math.max(0, goal.target_amount - goal.current_amount);
      const canAfford = projectedBalance >= needed;
      return { projectedBalance, canAfford, shortfall: canAfford ? 0 : needed - projectedBalance };
    },
    [bills, incomes, transactions, overrides, settings]
  );

  // ─── Cash Flow ────────────────────────────────────────────────────────────────

  const getCashFlow = useCallback((month: number, year: number): CashFlow => {
    const monthlyIncome = incomes
      .filter(i => isIncomeActiveForMonth(i, month, year))
      .reduce((s, i) => s + getIncomeOccurrenceDays(i, month, year).length * i.amount, 0);
    const activeBills = bills.filter(b => (b.is_recurring || b.is_debt) && isBillActiveForMonth(b, month, year));
    const totalBillsDue = activeBills.reduce((s, b) => {
      const o = overrides.find(o => o.bill_id === b.id && o.month === month && o.year === year);
      const amt = o?.custom_amount !== undefined ? o.custom_amount : b.amount;
      return s + amt * getBillOccurrenceDays(b, month, year).length;
    }, 0);
    const totalPaid = activeBills.reduce((s, b) => s + (overrides.find(o => o.bill_id === b.id && o.month === month && o.year === year)?.paid_amount ?? 0), 0);
    const monthTxs = transactions.filter(t => { const [ty, tm] = t.date.split("-").map(Number); return ty === year && tm === month + 1; });
    const netTransactions = monthTxs.reduce((s, t) => s + t.amount, 0);
    return { monthlyIncome, totalBillsDue, totalPaid, netTransactions, goalAllocations: 0, remaining: monthlyIncome - totalBillsDue + netTransactions };
  }, [bills, incomes, transactions, overrides]);

  // ─── Daily Balances ───────────────────────────────────────────────────────────

  const getDailyBalances = useCallback((month: number, year: number): DailyBalance[] => {
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    // Helper: compute a month's ending balance (income − bills + transactions − goals)
    const computeMonthNet = (m: number, y: number): number => {
      const inc = incomes.reduce((s, i) => {
        const occ = getIncomeOccurrenceDays(i, m, y);
        return s + occ.length * i.amount;
      }, 0);
      const bil = bills.filter(b => b.is_recurring || b.is_debt).reduce((s, b) => {
        const occ = getBillOccurrenceDays(b, m, y);
        if (occ.length === 0) return s;
        const o = overrides.find(o => o.bill_id === b.id && o.month === m && o.year === y);
        const amt = o?.custom_amount !== undefined ? o.custom_amount : b.amount;
        return s + amt * occ.length;
      }, 0);
      const tx = transactions
        .filter(t => { const [ty, tm] = t.date.split("-").map(Number); return ty === y && tm === m + 1; })
        .reduce((s, t) => s + t.amount, 0);
      // Subtract goal amounts that are due in this month
      const goalDeductions = goals.reduce((s, g) => {
        if (!g.target_date) return s;
        const raw = g.target_date.includes("T") ? g.target_date : g.target_date + "T12:00:00";
        const d = new Date(raw);
        if (d.getFullYear() === y && d.getMonth() === m) return s + g.target_amount;
        return s;
      }, 0);
      return inc + tx - bil - goalDeductions;
    };

    // Compute the starting balance (carryover) for a given month.
    // Chains from the anchor month forward so the last day of month M becomes
    // the opening balance of month M+1 (basic financial continuity).
    const computeCarryover = (toMonth: number, toYear: number): number => {
      // ── Determine anchor month / year ────────────────────────────────────────
      let anchorM: number;
      let anchorY: number;
      if (settings.starting_balance_date) {
        const [sbY, sbM] = settings.starting_balance_date.split("-").map(Number);
        anchorY = sbY;
        anchorM = sbM - 1; // 0-indexed
      } else {
        // No explicit anchor date: use the previous calendar month so the
        // current month always chains forward from last month's ending balance
        // instead of re-seeding from starting_balance every time the month rolls over.
        const now = new Date();
        anchorM = now.getMonth() - 1;
        anchorY = now.getFullYear();
        if (anchorM < 0) { anchorM = 11; anchorY -= 1; }
      }

      // Months before the anchor always open at 0
      if (toYear < anchorY || (toYear === anchorY && toMonth < anchorM)) {
        return 0;
      }

      // The anchor month itself always opens at the user's starting_balance
      if (toYear === anchorY && toMonth === anchorM) {
        return settings.starting_balance;
      }

      // Months after the anchor — always chain forward so the last day of month M
      // becomes the opening balance of month M+1 (basic financial continuity).
      let running = settings.starting_balance;
      let m = anchorM;
      let y = anchorY;
      while (!(y === toYear && m === toMonth)) {
        running += computeMonthNet(m, y);
        m += 1;
        if (m > 11) { m = 0; y += 1; }
      }
      return running;
    };

    const carryover = computeCarryover(month, year);

    // Build income-by-day map using actual occurrence dates (respects start_date + amount_history)
    const incomeByDay: Record<number, number> = {};
    incomes.forEach(i => {
      const occ = getIncomeOccurrenceDays(i, month, year);
      const amt = getEffectiveIncomeAmount(i, month, year);
      occ.forEach(d => { incomeByDay[d] = (incomeByDay[d] ?? 0) + amt; });
    });

    // Transactions for this month indexed by day
    const monthTxs = transactions.filter(t => { const [ty, tm] = t.date.split("-").map(Number); return ty === year && tm === month + 1; });

    // Pre-compute bill occurrence map: { day → total bill amount }
    const billsByDay: Record<number, number> = {};
    bills.filter(b => b.is_recurring || b.is_debt).forEach(b => {
      let occ = getBillOccurrenceDays(b, month, year);
      if (occ.length === 0) return;
      const o = overrides.find(o => o.bill_id === b.id && o.month === month && o.year === year);
      const amt = o?.custom_amount !== undefined ? o.custom_amount : b.amount;
      // For monthly bills, honour a per-month custom due day if set
      if (o?.custom_due_day !== undefined && b.frequency === "monthly") {
        occ = [Math.min(o.custom_due_day, daysInMonth)];
      }
      occ.forEach(d => { billsByDay[d] = (billsByDay[d] ?? 0) + amt; });
    });

    // Build goals-by-day map: goals whose target_date falls in this month
    const goalsByDay: Record<number, GoalExpense[]> = {};
    goals.forEach(g => {
      if (!g.target_date) return;
      const raw = g.target_date.includes("T") ? g.target_date : g.target_date + "T12:00:00";
      const d = new Date(raw);
      if (d.getFullYear() !== year || d.getMonth() !== month) return;
      const day = d.getDate();
      if (!goalsByDay[day]) goalsByDay[day] = [];
      goalsByDay[day].push({ id: g.id, name: g.name, amount: g.target_amount });
    });

    // Start from carryover — income is added on its actual days, not day 1
    let runningBalance = carryover;
    const result: DailyBalance[] = [];

    for (let day = 1; day <= daysInMonth; day++) {
      const dayTxs = monthTxs.filter(t => { const [, , td] = t.date.split("-").map(Number); return td === day; });
      const scheduledIncome = incomeByDay[day] ?? 0;
      const txIncome     = dayTxs.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
      const incomeToday  = scheduledIncome + txIncome;
      const expenseToday = dayTxs.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
      const billsToday   = billsByDay[day] ?? 0;
      const dayGoals     = goalsByDay[day] ?? [];
      const goalTotal    = dayGoals.reduce((s, ge) => s + ge.amount, 0);
      const net = incomeToday - expenseToday - billsToday - goalTotal;
      runningBalance += net;
      result.push({ day, income: incomeToday, scheduledIncome, expense: expenseToday, bills: billsToday, goalExpenses: dayGoals, net, balance: runningBalance });
    }

    return result;
  }, [bills, transactions, incomes, goals, overrides, settings.starting_balance, settings.starting_balance_date]);

  // ─── Categories ───────────────────────────────────────────────────────────────

  const addCategory = useCallback((name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setCategories(prev => {
      if (prev.includes(trimmed)) return prev;
      const u = [...prev, trimmed];
      AsyncStorage.setItem(CATEGORIES_KEY, JSON.stringify(u));
      return u;
    });
  }, []);

  const updateCategory = useCallback((oldName: string, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName) return;
    setCategories(prev => {
      const u = prev.map(c => c === oldName ? trimmed : c);
      AsyncStorage.setItem(CATEGORIES_KEY, JSON.stringify(u));
      return u;
    });
    setBills(prev => {
      const u = prev.map(b => b.category === oldName ? { ...b, category: trimmed } : b);
      AsyncStorage.setItem(BILLS_KEY, JSON.stringify(u));
      return u;
    });
    setTransactions(prev => {
      const u = prev.map(t => t.category === oldName ? { ...t, category: trimmed } : t);
      AsyncStorage.setItem(TRANSACTIONS_KEY, JSON.stringify(u));
      return u;
    });
  }, []);

  const deleteCategory = useCallback((name: string) => {
    setCategories(prev => {
      const u = prev.filter(c => c !== name);
      AsyncStorage.setItem(CATEGORIES_KEY, JSON.stringify(u));
      return u;
    });
    setBills(prev => {
      const u = prev.map(b => b.category === name ? { ...b, category: "Other" } : b);
      AsyncStorage.setItem(BILLS_KEY, JSON.stringify(u));
      return u;
    });
    setTransactions(prev => {
      const u = prev.map(t => t.category === name ? { ...t, category: "Other" } : t);
      AsyncStorage.setItem(TRANSACTIONS_KEY, JSON.stringify(u));
      return u;
    });
  }, []);

  // ─── Settings ─────────────────────────────────────────────────────────────────

  const updateSettings = useCallback((s: Partial<Settings>) => {
    setSettings(prev => {
      const u = { ...prev, ...s };
      AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(u));
      return u;
    });
  }, []);

  const importBills = useCallback((imported: Omit<Bill, "id" | "created_at">[]) => {
    setBills(prev => {
      const nb = imported.map(b => ({ frequency: "monthly" as const, day_of_week: 0, ...b, id: genId(), created_at: new Date().toISOString() }));
      const reordered = reorderDebtPriorities([...prev, ...nb]);
      AsyncStorage.setItem(BILLS_KEY, JSON.stringify(reordered));
      return reordered;
    });
  }, []);

  // ─── Provider value ───────────────────────────────────────────────────────────

  return (
    <BudgetContext.Provider value={{
      bills, overrides, transactions, incomes, goals, extraPayments, categories, settings, loading,
      dashboardFilter, setDashboardFilter,
      addBill, updateBill, deleteBill, getBillById,
      getOverride, getAmount, getPaidAmount, setPaidAmount, setCustomAmount, getCustomDueDay, setCustomDueDay,
      getMonthlyBills, getBillOccurrencesInMonth, getBillMonthlyTotal,
      runSnowball, saveExtraPayment, getExtraPayment, deleteExtraPayment,
      addTransaction, updateTransaction, deleteTransaction, getTransactionsForMonth,
      addIncome, updateIncome, deleteIncome, getMonthlyIncome, getIncomeOccurrencesInMonth,
      addGoal, updateGoal, deleteGoal, checkGoalAffordability,
      getCashFlow, getDailyBalances,
      addCategory, updateCategory, deleteCategory,
      updateSettings, importBills,
      selectedYear, setSelectedYear,
    }}>
      {children}
    </BudgetContext.Provider>
  );
}

export function useBudget() {
  const ctx = useContext(BudgetContext);
  if (!ctx) throw new Error("useBudget must be used within BudgetProvider");
  return ctx;
}
