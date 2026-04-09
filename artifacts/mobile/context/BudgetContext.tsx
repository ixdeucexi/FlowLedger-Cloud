import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

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

export interface IncomeItem {
  id: string;
  name: string;
  amount: number;
  frequency: "monthly" | "biweekly" | "weekly";
  start_date?: string;
  next_payment_date?: string;
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
  carryover_balances: boolean;
}

export interface CashFlow {
  monthlyIncome: number;
  totalBillsDue: number;
  totalPaid: number;
  netTransactions: number;
  goalAllocations: number;
  remaining: number;
}

export interface DailyBalance {
  day: number;
  income: number;
  expense: number;
  bills: number;
  net: number;
  balance: number;
}

export type DashboardFilter = null | "paid" | "unpaid" | "debts";

const DEFAULT_CATEGORIES = [
  "Housing", "Utilities", "Insurance", "Transportation",
  "Food", "Entertainment", "Health", "Education",
  "Savings", "Debt", "Shopping", "Rent", "Other",
];

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

  getMonthlyBills: (month: number, year: number) => Bill[];
  getWeeklyBillDays: (bill: Bill, month: number, year: number) => number[];
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

const BILLS_KEY = "@budget_bills_v3";
const OVERRIDES_KEY = "@budget_overrides_v1";
const TRANSACTIONS_KEY = "@budget_transactions_v2";
const INCOMES_KEY = "@budget_incomes_v1";
const GOALS_KEY = "@budget_goals_v1";
const SETTINGS_KEY = "@budget_settings_v4";
const CATEGORIES_KEY = "@budget_categories_v1";
const EXTRA_PAYMENTS_KEY = "@budget_extra_payments_v1";

const DEFAULT_SETTINGS: Settings = {
  paymentMethod: "snowball",
  carryover_balances: false,
};

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

function incomeToMonthly(amount: number, frequency: IncomeItem["frequency"]): number {
  if (frequency === "weekly") return amount * 4.33;
  if (frequency === "biweekly") return amount * 2.17;
  return amount;
}

function isIncomeActiveForMonth(income: IncomeItem, month: number, year: number): boolean {
  if (!income.start_date) return true;
  const [sy, sm] = income.start_date.split("-").map(Number);
  return year > sy || (year === sy && month >= sm - 1);
}

function reorderDebtPriorities(allBills: Bill[]): Bill[] {
  const nonDebts = allBills.filter(b => !b.is_debt);
  const debts = allBills
    .filter(b => b.is_debt)
    .sort((a, b) => a.balance - b.balance)
    .map((b, i) => ({ ...b, priority: i + 1 }));
  return [...nonDebts, ...debts];
}

const SEED_BILLS: Bill[] = [
  { id: "s1", name: "Rent", amount: 1200, category: "Housing", priority: 99, is_debt: false, balance: 0, interest_rate: 0, due_day: 1, is_recurring: true, frequency: "monthly", created_at: new Date().toISOString() },
  { id: "s2", name: "Electric", amount: 95, category: "Utilities", priority: 99, is_debt: false, balance: 0, interest_rate: 0, due_day: 10, is_recurring: true, frequency: "monthly", created_at: new Date().toISOString() },
  { id: "s3", name: "Internet", amount: 60, category: "Utilities", priority: 99, is_debt: false, balance: 0, interest_rate: 0, due_day: 15, is_recurring: true, frequency: "monthly", created_at: new Date().toISOString() },
  { id: "s4", name: "Car Loan", amount: 350, category: "Debt", priority: 2, is_debt: true, balance: 4200, interest_rate: 6.5, due_day: 20, is_recurring: true, frequency: "monthly", created_at: new Date().toISOString() },
  { id: "s5", name: "Credit Card", amount: 120, category: "Debt", priority: 3, is_debt: true, balance: 1850, interest_rate: 22.9, due_day: 25, is_recurring: true, frequency: "monthly", created_at: new Date().toISOString() },
  { id: "s6", name: "Medical Bill", amount: 75, category: "Debt", priority: 1, is_debt: true, balance: 650, interest_rate: 0, due_day: 5, is_recurring: true, frequency: "monthly", created_at: new Date().toISOString() },
  { id: "s7", name: "Groceries", amount: 400, category: "Food", priority: 99, is_debt: false, balance: 0, interest_rate: 0, due_day: 1, is_recurring: true, frequency: "monthly", created_at: new Date().toISOString() },
  { id: "s8", name: "Insurance", amount: 180, category: "Insurance", priority: 99, is_debt: false, balance: 0, interest_rate: 0, due_day: 8, is_recurring: true, frequency: "monthly", created_at: new Date().toISOString() },
];

const SEED_INCOMES: IncomeItem[] = [
  { id: "i1", name: "Primary Job", amount: 4500, frequency: "monthly" },
];

export function BudgetProvider({ children }: { children: React.ReactNode }) {
  const [bills, setBills] = useState<Bill[]>([]);
  const [overrides, setOverrides] = useState<MonthlyOverride[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [incomes, setIncomes] = useState<IncomeItem[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [extraPayments, setExtraPayments] = useState<ExtraPayment[]>([]);
  const [categories, setCategories] = useState<string[]>(DEFAULT_CATEGORIES);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [dashboardFilter, setDashboardFilter] = useState<DashboardFilter>(null);

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

        let loadedBills: Bill[] = bd ? JSON.parse(bd) : reorderDebtPriorities(SEED_BILLS);
        // migrate missing frequency field
        loadedBills = loadedBills.map(b => ({ frequency: "monthly", ...b }));
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
      const withNew = [...prev, nb];
      const reordered = reorderDebtPriorities(withNew);
      AsyncStorage.setItem(BILLS_KEY, JSON.stringify(reordered));
      return reordered;
    });
  }, []);

  const updateBill = useCallback((bill: Bill) => {
    setBills(prev => {
      const replaced = prev.map(b => b.id === bill.id ? bill : b);
      const reordered = reorderDebtPriorities(replaced);
      AsyncStorage.setItem(BILLS_KEY, JSON.stringify(reordered));
      return reordered;
    });
  }, []);

  const deleteBill = useCallback((id: string) => {
    setBills(prev => {
      const filtered = prev.filter(b => b.id !== id);
      const reordered = reorderDebtPriorities(filtered);
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
        let updated: MonthlyOverride[];
        if (idx !== -1) {
          updated = prev.map((o, i) => i === idx ? { ...o, ...patch } : o);
        } else {
          updated = [...prev, { id: genId(), bill_id: billId, month, year, paid_amount: 0, ...patch }];
        }
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
          const updated = prev.map(b => b.id === billId ? { ...b, balance: Math.max(0, b.balance - delta) } : b);
          const reordered = reorderDebtPriorities(updated);
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

  // ─── Weekly Bill Helpers ───────────────────────────────────────────────────────

  const getWeeklyBillDays = useCallback((bill: Bill, month: number, year: number): number[] => {
    if (bill.frequency !== "weekly") return [bill.due_day];
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const days: number[] = [];
    let d = bill.due_day;
    while (d <= daysInMonth) {
      if (d >= 1) days.push(d);
      d += 7;
    }
    return days;
  }, []);

  const getBillMonthlyTotal = useCallback((bill: Bill, month: number, year: number): number => {
    const perOccurrence = getAmount(bill, month, year);
    if (bill.frequency === "weekly") {
      return perOccurrence * getWeeklyBillDays(bill, month, year).length;
    }
    return perOccurrence;
  }, [getAmount, getWeeklyBillDays]);

  const getMonthlyBills = useCallback(
    (_month: number, _year: number): Bill[] => bills.filter(b => b.is_recurring),
    [bills]
  );

  // ─── Snowball ─────────────────────────────────────────────────────────────────

  const runSnowball = useCallback(
    (month: number, year: number, extraAmount: number): SnowballAllocation[] => {
      const debtBills = bills.filter(b => b.is_debt && b.balance > 0).map(b => ({ ...b }));

      if (settings.paymentMethod === "snowball") {
        debtBills.sort((a, b) => a.balance - b.balance);
      } else {
        debtBills.sort((a, b) => b.interest_rate - a.interest_rate);
      }

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
        const balanceAfter = Math.max(0, balanceBefore - payment);
        const paidOff = balanceAfter === 0;

        allocations.push({ billId: debt.id, billName: debt.name, payment, balanceBefore, balanceAfter, paidOff });

        const bidx = updatedBills.findIndex(b => b.id === debt.id);
        if (bidx !== -1) updatedBills[bidx] = { ...updatedBills[bidx], balance: balanceAfter };
        upsertOverride(debt.id, month, year, { paid_amount: alreadyPaid + payment });

        if (paidOff) {
          cascadePool = Math.max(0, available - payment) + debt.amount;
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
      let updated: ExtraPayment[];
      if (existing !== -1) {
        updated = prev.map((ep, i) => i === existing ? { ...ep, amount, allocations } : ep);
      } else {
        updated = [...prev, { id: genId(), month, year, amount, allocations }];
      }
      AsyncStorage.setItem(EXTRA_PAYMENTS_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const getExtraPayment = useCallback((month: number, year: number) =>
    extraPayments.find(ep => ep.month === month && ep.year === year),
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
    const nt: Transaction = { ...tx, id: genId() };
    setTransactions(prev => {
      const u = [...prev, nt];
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
    const ni: IncomeItem = { ...item, id: genId() };
    setIncomes(prev => {
      const u = [...prev, ni];
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
        .reduce((s, i) => s + incomeToMonthly(i.amount, i.frequency), 0),
    [incomes]
  );

  // ─── Goals ────────────────────────────────────────────────────────────────────

  const addGoal = useCallback((goal: Omit<Goal, "id" | "created_at">) => {
    const ng: Goal = { ...goal, id: genId(), created_at: new Date().toISOString() };
    setGoals(prev => {
      const u = [...prev, ng];
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
      const monthlyIncome = incomes
        .filter(i => isIncomeActiveForMonth(i, month, year))
        .reduce((s, i) => s + incomeToMonthly(i.amount, i.frequency), 0);
      const totalBillsDue = bills.filter(b => b.is_recurring).reduce((s, b) => {
        const o = overrides.find(o => o.bill_id === b.id && o.month === month && o.year === year);
        return s + (o?.custom_amount !== undefined ? o.custom_amount : b.amount);
      }, 0);
      const txThisMonth = transactions.filter(t => {
        const [ty, tm] = t.date.split("-").map(Number);
        return ty === year && tm === month + 1;
      });
      const netTx = txThisMonth.reduce((s, t) => s + t.amount, 0);
      const projectedBalance = monthlyIncome - totalBillsDue + netTx;
      const needed = Math.max(0, goal.target_amount - goal.current_amount);
      const canAfford = projectedBalance >= needed;
      return { projectedBalance, canAfford, shortfall: canAfford ? 0 : needed - projectedBalance };
    },
    [bills, incomes, transactions, overrides]
  );

  // ─── Cash Flow ────────────────────────────────────────────────────────────────

  const getCashFlow = useCallback((month: number, year: number): CashFlow => {
    const monthlyIncome = incomes
      .filter(i => isIncomeActiveForMonth(i, month, year))
      .reduce((s, i) => s + incomeToMonthly(i.amount, i.frequency), 0);
    const monthBills = bills.filter(b => b.is_recurring);
    const totalBillsDue = monthBills.reduce((s, b) => {
      const o = overrides.find(o => o.bill_id === b.id && o.month === month && o.year === year);
      return s + (o?.custom_amount !== undefined ? o.custom_amount : b.amount);
    }, 0);
    const totalPaid = monthBills.reduce((s, b) => {
      const o = overrides.find(o => o.bill_id === b.id && o.month === month && o.year === year);
      return s + (o?.paid_amount ?? 0);
    }, 0);
    const txThisMonth = transactions.filter(t => {
      const [ty, tm] = t.date.split("-").map(Number);
      return ty === year && tm === month + 1;
    });
    const netTransactions = txThisMonth.reduce((s, t) => s + t.amount, 0);
    const remaining = monthlyIncome - totalBillsDue + netTransactions;
    return { monthlyIncome, totalBillsDue, totalPaid, netTransactions, goalAllocations: 0, remaining };
  }, [bills, incomes, transactions, overrides]);

  // ─── Daily Balances ───────────────────────────────────────────────────────────

  const getDailyBalances = useCallback((month: number, year: number): DailyBalance[] => {
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    // Carryover: previous month's net (income - bills + transactions)
    const prevMonth = month === 0 ? 11 : month - 1;
    const prevYear = month === 0 ? year - 1 : year;
    const prevMonthlyIncome = incomes
      .filter(i => isIncomeActiveForMonth(i, prevMonth, prevYear))
      .reduce((s, i) => s + incomeToMonthly(i.amount, i.frequency), 0);
    const prevBills = bills.filter(b => b.is_recurring);
    const prevTotalBills = prevBills.reduce((s, b) => {
      const o = overrides.find(o => o.bill_id === b.id && o.month === prevMonth && o.year === prevYear);
      return s + (o?.custom_amount !== undefined ? o.custom_amount : b.amount);
    }, 0);
    const prevTxs = transactions.filter(t => {
      const [ty, tm] = t.date.split("-").map(Number);
      return ty === prevYear && tm === prevMonth + 1;
    });
    const prevNetTx = prevTxs.reduce((s, t) => s + t.amount, 0);
    const carryover = prevMonthlyIncome + prevNetTx - prevTotalBills;

    // Current month income available from day 1
    const monthlyIncome = incomes
      .filter(i => isIncomeActiveForMonth(i, month, year))
      .reduce((s, i) => s + incomeToMonthly(i.amount, i.frequency), 0);

    // Transactions for this month
    const monthTxs = transactions.filter(t => {
      const [ty, tm] = t.date.split("-").map(Number);
      return ty === year && tm === month + 1;
    });

    const recurringBills = bills.filter(b => b.is_recurring);
    let runningBalance = carryover + monthlyIncome;
    const result: DailyBalance[] = [];

    for (let day = 1; day <= daysInMonth; day++) {
      const dayTxs = monthTxs.filter(t => {
        const [, , td] = t.date.split("-").map(Number);
        return td === day;
      });

      const incomeToday = dayTxs.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
      const expenseToday = dayTxs.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);

      // Bills due this day (any occurrence — supports weekly)
      const billsToday = recurringBills.reduce((s, b) => {
        const dueDays = b.frequency === "weekly"
          ? (() => {
              const days: number[] = [];
              let d = b.due_day;
              while (d <= daysInMonth) { if (d >= 1) days.push(d); d += 7; }
              return days;
            })()
          : [b.due_day];
        if (!dueDays.includes(day)) return s;
        const o = overrides.find(o => o.bill_id === b.id && o.month === month && o.year === year);
        return s + (o?.custom_amount !== undefined ? o.custom_amount : b.amount);
      }, 0);

      const net = incomeToday - expenseToday - billsToday;
      runningBalance += net;

      result.push({ day, income: incomeToday, expense: expenseToday, bills: billsToday, net, balance: runningBalance });
    }

    return result;
  }, [bills, transactions, incomes, overrides]);

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
    // Update bills and transactions using this category
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
    // Reassign bills and transactions to "Other"
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
      const nb = imported.map(b => ({ frequency: "monthly" as const, ...b, id: genId(), created_at: new Date().toISOString() }));
      const withNew = [...prev, ...nb];
      const reordered = reorderDebtPriorities(withNew);
      AsyncStorage.setItem(BILLS_KEY, JSON.stringify(reordered));
      return reordered;
    });
  }, []);

  return (
    <BudgetContext.Provider value={{
      bills, overrides, transactions, incomes, goals, extraPayments, categories, settings, loading,
      dashboardFilter, setDashboardFilter,
      addBill, updateBill, deleteBill, getBillById,
      getOverride, getAmount, getPaidAmount, setPaidAmount, setCustomAmount,
      getMonthlyBills, getWeeklyBillDays, getBillMonthlyTotal, runSnowball,
      saveExtraPayment, getExtraPayment, deleteExtraPayment,
      addTransaction, updateTransaction, deleteTransaction, getTransactionsForMonth,
      addIncome, updateIncome, deleteIncome, getMonthlyIncome,
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
