import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

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
  due_day: number;
  day_of_week?: number;
  start_date?: string;
  end_date?: string;
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
  effective_from: string;
  amount: number;
}

export interface IncomeItem {
  id: string;
  name: string;
  amount: number;
  frequency: "monthly" | "biweekly" | "weekly";
  start_date?: string;
  next_payment_date?: string;
  amount_history?: IncomeAmountEntry[];
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
  starting_balance: number;
  starting_balance_date?: string;
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

const DEFAULT_SETTINGS: Settings = {
  paymentMethod: "snowball",
  starting_balance: 0,
};

// ─── Pure helpers ──────────────────────────────────────────────────────────────

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

function incomeToMonthly(amount: number, frequency: IncomeItem["frequency"]): number {
  if (frequency === "weekly")   return amount * 4;
  if (frequency === "biweekly") return amount * 2;
  return amount;
}

function getEffectiveIncomeAmount(income: IncomeItem, month: number, year: number): number {
  if (!income.amount_history || income.amount_history.length === 0) return income.amount;
  const monthStr = `${year}-${String(month + 1).padStart(2, "0")}`;
  const sorted = [...income.amount_history].sort((a, b) => b.effective_from.localeCompare(a.effective_from));
  const match = sorted.find(h => h.effective_from <= monthStr);
  if (match) return match.amount;
  return sorted[sorted.length - 1].amount;
}

function isIncomeActiveForMonth(income: IncomeItem, month: number, year: number): boolean {
  if (!income.start_date) return true;
  const [sy, sm] = income.start_date.split("-").map(Number);
  return year > sy || (year === sy && month >= sm - 1);
}

function isBillActiveForMonth(bill: Bill, month: number, year: number): boolean {
  const monthStart = new Date(year, month, 1);
  const monthEnd   = new Date(year, month + 1, 0);
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

function getIncomeOccurrenceDays(income: IncomeItem, month: number, year: number): number[] {
  if (!isIncomeActiveForMonth(income, month, year)) return [];
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  if (income.frequency === "monthly") {
    if (income.start_date) {
      const [, , sd] = income.start_date.split("-").map(Number);
      return [Math.min(sd, daysInMonth)];
    }
    return [1];
  }
  const intervalDays = income.frequency === "biweekly" ? 14 : 7;
  let anchor: Date;
  if (income.start_date) {
    anchor = new Date(income.start_date + "T00:00:00");
  } else {
    anchor = new Date(year, month, 1);
  }
  const monthStart = new Date(year, month, 1);
  const monthEnd   = new Date(year, month + 1, 0);
  let current = new Date(anchor);
  if (current < monthStart) {
    const msPerInterval = intervalDays * 86400000;
    const diff = monthStart.getTime() - current.getTime();
    const steps = Math.floor(diff / msPerInterval);
    current = new Date(current.getTime() + steps * msPerInterval);
    if (current < monthStart) current = new Date(current.getTime() + msPerInterval);
  }
  const days: number[] = [];
  while (current <= monthEnd) {
    days.push(current.getDate());
    current = new Date(current.getTime() + intervalDays * 86400000);
  }
  return days;
}

function getBillOccurrenceDays(bill: Bill, month: number, year: number): number[] {
  if (!bill.is_recurring && !bill.is_debt) return [];
  if (!isBillActiveForMonth(bill, month, year)) return [];
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  if (bill.frequency === "weekly") {
    const dow = bill.day_of_week ?? 0;
    const firstDayOfMonth = new Date(year, month, 1).getDay();
    const firstOcc = (dow - firstDayOfMonth + 7) % 7 + 1;
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
  getIncomeOccurrencesInMonth: (month: number, year: number) => { income: IncomeItem; days: number[]; effectiveAmount?: number }[];

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

// ─── AsyncStorage keys ─────────────────────────────────────────────────────────

const KEYS = {
  bills:         "@budget_bills",
  overrides:     "@budget_overrides",
  transactions:  "@budget_transactions",
  incomes:       "@budget_incomes",
  goals:         "@budget_goals",
  extraPayments: "@budget_extra_payments",
  settings:      "@budget_settings",
  categories:    "@budget_categories",
};

const DEFAULT_CATEGORIES = [
  "Housing", "Utilities", "Insurance", "Transportation", "Food",
  "Entertainment", "Health", "Education", "Savings", "Debt",
  "Shopping", "Rent", "Other",
];

async function load<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

// ─── Provider ──────────────────────────────────────────────────────────────────

export function BudgetProvider({ children }: { children: React.ReactNode }) {
  const [bills,         setBills]         = useState<Bill[]>([]);
  const [overrides,     setOverrides]     = useState<MonthlyOverride[]>([]);
  const [transactions,  setTransactions]  = useState<Transaction[]>([]);
  const [incomes,       setIncomes]       = useState<IncomeItem[]>([]);
  const [goals,         setGoals]         = useState<Goal[]>([]);
  const [extraPayments, setExtraPayments] = useState<ExtraPayment[]>([]);
  const [categories,    setCategories]    = useState<string[]>([]);
  const [settings,      setSettings]      = useState<Settings>(DEFAULT_SETTINGS);
  const [loading,       setLoading]       = useState(true);
  const [selectedYear,  setSelectedYear]  = useState(new Date().getFullYear());
  const [dashboardFilter, setDashboardFilter] = useState<DashboardFilter>(null);

  // Track whether initial load is done so we don't overwrite on first render
  const loaded = useRef(false);

  // ── Load from AsyncStorage on mount ──────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const [b, o, t, i, g, ep, s, c] = await Promise.all([
          load<Bill[]>(KEYS.bills, []),
          load<MonthlyOverride[]>(KEYS.overrides, []),
          load<Transaction[]>(KEYS.transactions, []),
          load<IncomeItem[]>(KEYS.incomes, []),
          load<Goal[]>(KEYS.goals, []),
          load<ExtraPayment[]>(KEYS.extraPayments, []),
          load<Settings>(KEYS.settings, DEFAULT_SETTINGS),
          load<string[]>(KEYS.categories, DEFAULT_CATEGORIES),
        ]);
        setBills(reorderDebtPriorities(b.map(bill => ({
          ...bill,
          frequency: (bill.frequency ?? "monthly") as "monthly" | "weekly",
          day_of_week: bill.day_of_week ?? 0,
        }))));
        setOverrides(o);
        setTransactions(t);
        setIncomes(i);
        setGoals(g);
        setExtraPayments(ep);
        setSettings({ ...DEFAULT_SETTINGS, ...s });
        setCategories(c.length > 0 ? c : DEFAULT_CATEGORIES);
      } finally {
        loaded.current = true;
        setLoading(false);
      }
    })();
  }, []);

  // ── Persist to AsyncStorage whenever state changes (after initial load) ───────
  useEffect(() => { if (loaded.current) AsyncStorage.setItem(KEYS.bills,         JSON.stringify(bills)); },         [bills]);
  useEffect(() => { if (loaded.current) AsyncStorage.setItem(KEYS.overrides,     JSON.stringify(overrides)); },     [overrides]);
  useEffect(() => { if (loaded.current) AsyncStorage.setItem(KEYS.transactions,  JSON.stringify(transactions)); },  [transactions]);
  useEffect(() => { if (loaded.current) AsyncStorage.setItem(KEYS.incomes,       JSON.stringify(incomes)); },       [incomes]);
  useEffect(() => { if (loaded.current) AsyncStorage.setItem(KEYS.goals,         JSON.stringify(goals)); },         [goals]);
  useEffect(() => { if (loaded.current) AsyncStorage.setItem(KEYS.extraPayments, JSON.stringify(extraPayments)); }, [extraPayments]);
  useEffect(() => { if (loaded.current) AsyncStorage.setItem(KEYS.settings,      JSON.stringify(settings)); },      [settings]);
  useEffect(() => { if (loaded.current) AsyncStorage.setItem(KEYS.categories,    JSON.stringify(categories)); },    [categories]);

  // ─── Bills ────────────────────────────────────────────────────────────────────

  const addBill = useCallback((bill: Omit<Bill, "id" | "created_at">) => {
    const nb: Bill = { ...bill, id: genId(), created_at: new Date().toISOString() };
    setBills(prev => reorderDebtPriorities([...prev, nb]));
  }, []);

  const updateBill = useCallback((bill: Bill) => {
    setBills(prev => {
      const existing = prev.find(b => b.id === bill.id);
      if (existing && existing.amount !== bill.amount) {
        const now = new Date();
        const curMonth = now.getMonth();
        const curYear  = now.getFullYear();
        setOverrides(prevO => {
          let next = prevO.map(o => {
            if (o.bill_id !== bill.id) return o;
            const isPastOrCurrent = o.year < curYear || (o.year === curYear && o.month <= curMonth);
            if (isPastOrCurrent && o.custom_amount === undefined) return { ...o, custom_amount: existing.amount };
            return o;
          });
          const hasCurrentOverride = next.some(o => o.bill_id === bill.id && o.month === curMonth && o.year === curYear);
          if (!hasCurrentOverride) {
            next = [...next, { id: genId(), bill_id: bill.id, month: curMonth, year: curYear, custom_amount: existing.amount, paid_amount: 0 }];
          }
          return next;
        });
      }
      return reorderDebtPriorities(prev.map(b => b.id === bill.id ? bill : b));
    });
  }, []);

  const deleteBill = useCallback((id: string) => {
    setBills(prev => reorderDebtPriorities(prev.filter(b => b.id !== id)));
    setOverrides(prev => prev.filter(o => o.bill_id !== id));
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
        if (idx !== -1) {
          return prev.map((o, i) => i === idx ? { ...o, ...patch } : o);
        }
        return [...prev, { id: genId(), bill_id: billId, month, year, paid_amount: 0, ...patch }];
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
          return reorderDebtPriorities(
            prev.map(b => b.id === billId ? { ...b, balance: Math.max(0, b.balance - delta) } : b)
          );
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

  const getBillOccurrencesInMonth = useCallback(
    (bill: Bill, month: number, year: number): number[] => {
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      let occ = getBillOccurrenceDays(bill, month, year);
      if (occ.length === 0) return occ;
      const o = overrides.find(ov => ov.bill_id === bill.id && ov.month === month && ov.year === year);
      if (o?.custom_due_day !== undefined && bill.frequency === "monthly") {
        occ = [Math.min(o.custom_due_day, daysInMonth)];
      }
      return occ;
    },
    [overrides]
  );

  const getBillMonthlyTotal = useCallback((bill: Bill, month: number, year: number): number => {
    const occurrences = getBillOccurrenceDays(bill, month, year);
    if (occurrences.length === 0) return 0;
    return getAmount(bill, month, year) * occurrences.length;
  }, [getAmount]);

  const getMonthlyBills = useCallback(
    (month: number, year: number): Bill[] =>
      bills.filter(b => (b.is_recurring || b.is_debt) && isBillActiveForMonth(b, month, year)),
    [bills]
  );

  // ─── Snowball / Avalanche ─────────────────────────────────────────────────────

  const runSnowball = useCallback(
    (month: number, year: number, extraAmount: number): SnowballAllocation[] => {
      const debtBills = bills.filter(b => b.is_debt && b.balance > 0).map(b => ({ ...b }));
      debtBills.sort(settings.paymentMethod === "snowball"
        ? (a, b) => a.balance - b.balance
        : (a, b) => b.interest_rate - a.interest_rate);

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
          const nextDebt = debtBills.slice(i + 1).find(d => d.balance > payment);
          if (nextDebt) {
            const nidx = updatedBills.findIndex(b => b.id === nextDebt.id);
            if (nidx !== -1) updatedBills[nidx] = { ...updatedBills[nidx], amount: updatedBills[nidx].amount + debt.amount };
          }
          cascadePool = Math.max(0, available - payment);
          pool = 0;
        } else {
          pool = 0; cascadePool = 0;
        }
      }
      setBills(reorderDebtPriorities(updatedBills));
      return allocations;
    },
    [bills, settings.paymentMethod, overrides, upsertOverride]
  );

  const saveExtraPayment = useCallback((month: number, year: number, amount: number, allocations: SnowballAllocation[]) => {
    setExtraPayments(prev => {
      const existing = prev.find(ep => ep.month === month && ep.year === year);
      if (existing) return prev.map(ep => ep.month === month && ep.year === year ? { ...ep, amount, allocations } : ep);
      return [...prev, { id: genId(), month, year, amount, allocations }];
    });
  }, []);

  const getExtraPayment = useCallback(
    (month: number, year: number) => extraPayments.find(ep => ep.month === month && ep.year === year),
    [extraPayments]
  );

  const deleteExtraPayment = useCallback((id: string) => {
    setExtraPayments(prev => prev.filter(ep => ep.id !== id));
  }, []);

  // ─── Transactions ─────────────────────────────────────────────────────────────

  const addTransaction = useCallback((tx: Omit<Transaction, "id">) => {
    setTransactions(prev => [...prev, { ...tx, id: genId() }]);
  }, []);

  const updateTransaction = useCallback((tx: Transaction) => {
    setTransactions(prev => prev.map(t => t.id === tx.id ? tx : t));
  }, []);

  const deleteTransaction = useCallback((id: string) => {
    setTransactions(prev => prev.filter(t => t.id !== id));
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
    setIncomes(prev => [...prev, { ...item, id: genId() }]);
  }, []);

  const updateIncome = useCallback((item: IncomeItem) => {
    setIncomes(prev => prev.map(i => i.id === item.id ? item : i));
  }, []);

  const deleteIncome = useCallback((id: string) => {
    setIncomes(prev => prev.filter(i => i.id !== id));
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
    (month: number, year: number) =>
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
    setGoals(prev => [...prev, { ...goal, id: genId(), created_at: new Date().toISOString() }]);
  }, []);

  const updateGoal = useCallback((goal: Goal) => {
    setGoals(prev => prev.map(g => g.id === goal.id ? goal : g));
  }, []);

  const deleteGoal = useCallback((id: string) => {
    setGoals(prev => prev.filter(g => g.id !== id));
  }, []);

  const checkGoalAffordability = useCallback(
    (goal: Goal, month: number, year: number): GoalAffordability => {
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
      let anchorM: number, anchorY: number, seed: number;
      if (settings.starting_balance_date) {
        const [sbY, sbM] = settings.starting_balance_date.split("-").map(Number);
        anchorM = sbM - 1; anchorY = sbY; seed = settings.starting_balance;
        if (year < anchorY || (year === anchorY && month < anchorM)) {
          const needed = Math.max(0, goal.target_amount - goal.current_amount);
          return { projectedBalance: 0, canAfford: needed === 0, shortfall: needed };
        }
      } else {
        const now = new Date();
        anchorM = now.getMonth() - 1; anchorY = now.getFullYear();
        if (anchorM < 0) { anchorM = 11; anchorY -= 1; }
        seed = settings.starting_balance;
        if (year < anchorY || (year === anchorY && month < anchorM)) {
          const needed = Math.max(0, goal.target_amount - goal.current_amount);
          return { projectedBalance: seed, canAfford: seed >= needed, shortfall: Math.max(0, needed - seed) };
        }
      }
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
    const totalPaid = activeBills.reduce((s, b) =>
      s + (overrides.find(o => o.bill_id === b.id && o.month === month && o.year === year)?.paid_amount ?? 0), 0);
    const monthTxs = transactions.filter(t => { const [ty, tm] = t.date.split("-").map(Number); return ty === year && tm === month + 1; });
    const netTransactions = monthTxs.reduce((s, t) => s + t.amount, 0);
    return { monthlyIncome, totalBillsDue, totalPaid, netTransactions, goalAllocations: 0, remaining: monthlyIncome - totalBillsDue + netTransactions };
  }, [bills, incomes, transactions, overrides]);

  // ─── Daily Balances ───────────────────────────────────────────────────────────

  const getDailyBalances = useCallback((month: number, year: number): DailyBalance[] => {
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const computeMonthNet = (m: number, y: number): number => {
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
      const goalDeductions = goals.reduce((s, g) => {
        if (!g.target_date) return s;
        const raw = g.target_date.includes("T") ? g.target_date : g.target_date + "T12:00:00";
        const d = new Date(raw);
        if (d.getFullYear() === y && d.getMonth() === m) return s + g.target_amount;
        return s;
      }, 0);
      return inc + tx - bil - goalDeductions;
    };
    const computeCarryover = (toMonth: number, toYear: number): number => {
      let anchorM: number, anchorY: number;
      if (settings.starting_balance_date) {
        const [sbY, sbM] = settings.starting_balance_date.split("-").map(Number);
        anchorY = sbY; anchorM = sbM - 1;
      } else {
        const now = new Date();
        anchorM = now.getMonth() - 1; anchorY = now.getFullYear();
        if (anchorM < 0) { anchorM = 11; anchorY -= 1; }
      }
      if (toYear < anchorY || (toYear === anchorY && toMonth < anchorM)) return 0;
      if (toYear === anchorY && toMonth === anchorM) return settings.starting_balance;
      let running = settings.starting_balance;
      let m = anchorM, y = anchorY;
      while (!(y === toYear && m === toMonth)) {
        running += computeMonthNet(m, y);
        m += 1; if (m > 11) { m = 0; y += 1; }
      }
      return running;
    };
    const carryover = computeCarryover(month, year);
    const incomeByDay: Record<number, number> = {};
    incomes.forEach(i => {
      const occ = getIncomeOccurrenceDays(i, month, year);
      const amt = getEffectiveIncomeAmount(i, month, year);
      occ.forEach(d => { incomeByDay[d] = (incomeByDay[d] ?? 0) + amt; });
    });
    const monthTxs = transactions.filter(t => { const [ty, tm] = t.date.split("-").map(Number); return ty === year && tm === month + 1; });
    const billsByDay: Record<number, number> = {};
    bills.filter(b => b.is_recurring || b.is_debt).forEach(b => {
      let occ = getBillOccurrenceDays(b, month, year);
      if (occ.length === 0) return;
      const o = overrides.find(o => o.bill_id === b.id && o.month === month && o.year === year);
      const amt = o?.custom_amount !== undefined ? o.custom_amount : b.amount;
      if (o?.custom_due_day !== undefined && b.frequency === "monthly") {
        occ = [Math.min(o.custom_due_day, daysInMonth)];
      }
      occ.forEach(d => { billsByDay[d] = (billsByDay[d] ?? 0) + amt; });
    });
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
    setCategories(prev => prev.includes(trimmed) ? prev : [...prev, trimmed]);
  }, []);

  const updateCategory = useCallback((oldName: string, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName) return;
    setCategories(prev => prev.map(c => c === oldName ? trimmed : c));
    setBills(prev => prev.map(b => b.category === oldName ? { ...b, category: trimmed } : b));
    setTransactions(prev => prev.map(t => t.category === oldName ? { ...t, category: trimmed } : t));
  }, []);

  const deleteCategory = useCallback((name: string) => {
    setCategories(prev => prev.filter(c => c !== name));
    setBills(prev => prev.map(b => b.category === name ? { ...b, category: "Other" } : b));
    setTransactions(prev => prev.map(t => t.category === name ? { ...t, category: "Other" } : t));
  }, []);

  // ─── Settings ─────────────────────────────────────────────────────────────────

  const updateSettings = useCallback((s: Partial<Settings>) => {
    setSettings(prev => ({ ...prev, ...s }));
  }, []);

  const importBills = useCallback((imported: Omit<Bill, "id" | "created_at">[]) => {
    const newBills = imported.map(b => ({
      ...b,
      frequency: (b.frequency ?? "monthly") as "monthly" | "weekly",
      day_of_week: b.day_of_week ?? 0,
      id: genId(),
      created_at: new Date().toISOString(),
    }));
    setBills(prev => reorderDebtPriorities([...prev, ...newBills]));
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
