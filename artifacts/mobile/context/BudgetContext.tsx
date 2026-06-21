import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";

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

export type DashboardFilter = "bills" | "debt" | "paid" | "unpaid" | null;

// ─── Context shape ─────────────────────────────────────────────────────────────

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
  selectedYear: number;
  setSelectedYear: (y: number) => void;
  dashboardFilter: DashboardFilter;
  setDashboardFilter: (f: DashboardFilter) => void;

  addBill: (bill: Omit<Bill, "id" | "created_at">) => Promise<void>;
  updateBill: (bill: Bill) => Promise<void>;
  deleteBill: (id: string) => Promise<void>;
  getBillById: (id: string) => Bill | undefined;

  getOverride: (billId: string, month: number, year: number) => MonthlyOverride | undefined;
  getAmount: (bill: Bill, month: number, year: number) => number;
  getPaidAmount: (billId: string, month: number, year: number) => number;
  setPaidAmount: (billId: string, month: number, year: number, amount: number) => Promise<void>;
  setCustomAmount: (billId: string, month: number, year: number, amount: number | undefined) => Promise<void>;
  getCustomDueDay: (billId: string, month: number, year: number) => number | undefined;
  setCustomDueDay: (billId: string, month: number, year: number, day: number | undefined) => Promise<void>;
  getMonthlyBills: (month: number, year: number) => Bill[];
  getBillOccurrencesInMonth: (bill: Bill, month: number, year: number) => number[];
  getBillMonthlyTotal: (bill: Bill, month: number, year: number) => number;

  runSnowball: (month: number, year: number, extraAmount: number) => SnowballAllocation[];
  saveExtraPayment: (month: number, year: number, amount: number, allocations: SnowballAllocation[]) => Promise<void>;
  getExtraPayment: (month: number, year: number) => ExtraPayment | undefined;
  deleteExtraPayment: (id: string) => Promise<void>;

  addTransaction: (tx: Omit<Transaction, "id">) => Promise<void>;
  updateTransaction: (tx: Transaction) => Promise<void>;
  deleteTransaction: (id: string) => Promise<void>;
  getTransactionsForMonth: (month: number, year: number) => Transaction[];

  addIncome: (item: Omit<IncomeItem, "id">) => Promise<void>;
  updateIncome: (item: IncomeItem) => Promise<void>;
  deleteIncome: (id: string) => Promise<void>;
  getMonthlyIncome: (month?: number, year?: number) => number;
  getIncomeOccurrencesInMonth: (month: number, year: number) => { income: IncomeItem; days: number[]; effectiveAmount: number }[];

  addGoal: (goal: Omit<Goal, "id" | "created_at">) => Promise<void>;
  updateGoal: (goal: Goal) => Promise<void>;
  deleteGoal: (id: string) => Promise<void>;
  checkGoalAffordability: (goal: Goal, month: number, year: number) => GoalAffordability;

  getCashFlow: (month: number, year: number) => CashFlow;
  getDailyBalances: (month: number, year: number) => DailyBalance[];

  addCategory: (name: string) => Promise<void>;
  updateCategory: (oldName: string, newName: string) => Promise<void>;
  deleteCategory: (name: string) => Promise<void>;

  updateSettings: (s: Partial<Settings>) => Promise<void>;
  importBills: (imported: Omit<Bill, "id" | "created_at">[]) => Promise<void>;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS: Settings = { paymentMethod: "snowball", starting_balance: 0 };

const DEFAULT_CATEGORIES = [
  "Housing", "Utilities", "Insurance", "Transportation", "Food",
  "Entertainment", "Health", "Education", "Savings", "Debt",
  "Shopping", "Rent", "Other",
];

function genId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

async function ensureSaved(
  operation: PromiseLike<{ error: { message: string } | null }>,
  action: string
): Promise<void> {
  const { error } = await operation;
  if (error) throw new Error(`${action}: ${error.message}`);
}

function reorderDebtPriorities(bills: Bill[]): Bill[] {
  // Assign priorities based on balance ascending: lowest balance = #1 (snowball order)
  const debtsSorted = bills
    .filter(b => b.is_debt)
    .sort((a, b) => a.balance - b.balance);
  const priorityMap = new Map(debtsSorted.map((b, i) => [b.id, i + 1]));
  return bills.map(b => b.is_debt ? { ...b, priority: priorityMap.get(b.id) ?? 1 } : b);
}

function isBillActiveForMonth(b: Bill, month: number, year: number): boolean {
  const date = new Date(year, month, 1);
  if (b.start_date) {
    const [sy, sm] = b.start_date.split("-").map(Number);
    if (date < new Date(sy, sm - 1, 1)) return false;
  }
  if (b.end_date) {
    const [ey, em] = b.end_date.split("-").map(Number);
    if (date > new Date(ey, em - 1, 1)) return false;
  }
  return true;
}

function getBillOccurrenceDays(b: Bill, month: number, year: number): number[] {
  if (!isBillActiveForMonth(b, month, year)) return [];
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  if (b.frequency === "weekly") {
    const days: number[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const dow = new Date(year, month, d).getDay();
      if (dow === (b.day_of_week ?? 0)) days.push(d);
    }
    return days;
  }
  const day = Math.min(b.due_day, daysInMonth);
  return day > 0 ? [day] : [];
}

function isIncomeActiveForMonth(i: IncomeItem, month: number, year: number): boolean {
  if (!i.start_date) return true;
  const [sy, sm] = i.start_date.split("-").map(Number);
  return new Date(year, month, 1) >= new Date(sy, sm - 1, 1);
}

function getIncomeOccurrenceDays(i: IncomeItem, month: number, year: number): number[] {
  if (!isIncomeActiveForMonth(i, month, year)) return [];
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  if (i.frequency === "monthly") {
    if (!i.next_payment_date) return [1];
    const [, , dd] = i.next_payment_date.split("-").map(Number);
    return [Math.min(dd, daysInMonth)];
  }
  const intervalDays = i.frequency === "biweekly" ? 14 : 7;
  if (!i.next_payment_date) return [];
  const [ny, nm, nd] = i.next_payment_date.split("-").map(Number);
  let cursor = new Date(ny, nm - 1, nd);
  const target = new Date(year, month, 1);
  while (cursor > target) cursor = new Date(cursor.getTime() - intervalDays * 86400000);
  while (cursor < target) cursor = new Date(cursor.getTime() + intervalDays * 86400000);
  const days: number[] = [];
  while (cursor.getMonth() === month && cursor.getFullYear() === year) {
    days.push(cursor.getDate());
    cursor = new Date(cursor.getTime() + intervalDays * 86400000);
  }
  return days;
}

function getEffectiveIncomeAmount(i: IncomeItem, month: number, year: number): number {
  if (!i.amount_history?.length) return i.amount;
  const target = new Date(year, month, 1);
  const sorted = [...i.amount_history].sort((a, b) => a.effective_from.localeCompare(b.effective_from));
  let effective = i.amount;
  for (const entry of sorted) {
    const [ey, em] = entry.effective_from.split("-").map(Number);
    if (new Date(ey, em - 1, 1) <= target) effective = entry.amount;
  }
  return effective;
}

function incomeToMonthly(amount: number, frequency: IncomeItem["frequency"]): number {
  if (frequency === "biweekly") return amount * 26 / 12;
  if (frequency === "weekly")   return amount * 52 / 12;
  return amount;
}

// ─── Context ───────────────────────────────────────────────────────────────────

const BudgetContext = createContext<BudgetContextType | undefined>(undefined);

// ─── Provider ──────────────────────────────────────────────────────────────────

export function BudgetProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();

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

  const loaded = useRef(false);
  const overridesRef = useRef<MonthlyOverride[]>([]);
  useEffect(() => { overridesRef.current = overrides; }, [overrides]);

  // ── Load from Supabase when user changes ────────────────────────────────────
  useEffect(() => {
    if (!user) {
      setBills([]); setOverrides([]); setTransactions([]); setIncomes([]);
      setGoals([]); setExtraPayments([]); setCategories([]); setSettings(DEFAULT_SETTINGS);
      loaded.current = false;
      setLoading(false);
      return;
    }
    loaded.current = false;
    setLoading(true);
    (async () => {
      try {
        const uid = user.id;
        const results = await Promise.all([
          supabase.from("bills").select("*").eq("user_id", uid),
          supabase.from("monthly_overrides").select("*").eq("user_id", uid),
          supabase.from("transactions").select("*").eq("user_id", uid),
          supabase.from("incomes").select("*").eq("user_id", uid),
          supabase.from("goals").select("*").eq("user_id", uid),
          supabase.from("extra_payments").select("*").eq("user_id", uid),
          supabase.from("settings").select("*").eq("user_id", uid).maybeSingle(),
          supabase.from("categories").select("name").eq("user_id", uid),
        ]);
        const failed = results.find(result => result.error);
        if (failed?.error) throw new Error(`Load budget data: ${failed.error.message}`);
        const [
          { data: bData },
          { data: oData },
          { data: tData },
          { data: iData },
          { data: gData },
          { data: epData },
          { data: sData },
          { data: cData },
        ] = results;

        setBills(reorderDebtPriorities((bData ?? []).map((b: any) => ({
          ...b,
          frequency:   (b.frequency ?? "monthly") as "monthly" | "weekly",
          day_of_week: b.day_of_week ?? 0,
          amount:       Number(b.amount),
          balance:      Number(b.balance),
          interest_rate: Number(b.interest_rate),
        }))));
        setOverrides((oData ?? []).map((o: any) => ({
          ...o,
          paid_amount:   Number(o.paid_amount),
          custom_amount: o.custom_amount !== null ? Number(o.custom_amount) : undefined,
          custom_due_day: o.custom_due_day !== null ? Number(o.custom_due_day) : undefined,
        })));
        setTransactions((tData ?? []).map((t: any) => ({ ...t, amount: Number(t.amount) })));
        setIncomes((iData ?? []).map((i: any) => ({
          ...i,
          amount:         Number(i.amount),
          amount_history: i.amount_history ?? [],
        })));
        setGoals((gData ?? []).map((g: any) => ({
          ...g,
          target_amount:  Number(g.target_amount),
          current_amount: Number(g.current_amount),
        })));
        setExtraPayments((epData ?? []).map((ep: any) => ({
          ...ep,
          amount:      Number(ep.amount),
          allocations: ep.allocations ?? [],
        })));
        if (sData) {
          setSettings({
            paymentMethod:        sData.payment_method as Settings["paymentMethod"],
            starting_balance:     Number(sData.starting_balance),
            starting_balance_date: sData.starting_balance_date ?? undefined,
          });
        }
        const cats = (cData ?? []).map((c: any) => c.name as string);
        setCategories(cats.length > 0 ? cats : DEFAULT_CATEGORIES);
      } finally {
        loaded.current = true;
        setLoading(false);
      }
    })();
  }, [user]);

  // ─── Bills ────────────────────────────────────────────────────────────────────

  const addBill = useCallback(async (bill: Omit<Bill, "id" | "created_at">) => {
    if (!user) return;
    const nb: Bill = { ...bill, id: genId(), created_at: new Date().toISOString() };
    await ensureSaved(supabase.from("bills").insert({ ...nb, user_id: user.id }), "Add bill");
    setBills(prev => reorderDebtPriorities([...prev, nb]));
  }, [user]);

  const updateBill = useCallback(async (bill: Bill) => {
    if (!user) return;
    const existing = bills.find(b => b.id === bill.id);
    if (existing && existing.amount !== bill.amount) {
      const now = new Date();
      const curMonth = now.getMonth();
      const curYear  = now.getFullYear();
      const currentOverrides = overridesRef.current.filter(o => o.bill_id === bill.id);
      const dbUpdates: Promise<any>[] = [];

      const nextOverrides = currentOverrides.map(o => {
        const isStrictlyPast = o.year < curYear || (o.year === curYear && o.month < curMonth);
        if (isStrictlyPast && o.custom_amount === undefined) {
          dbUpdates.push(
            supabase.from("monthly_overrides")
              .update({ custom_amount: existing.amount })
              .eq("id", o.id).eq("user_id", user.id) as unknown as Promise<any>
          );
          return { ...o, custom_amount: existing.amount };
        } else if (!isStrictlyPast && o.custom_amount !== undefined) {
          dbUpdates.push(
            supabase.from("monthly_overrides")
              .update({ custom_amount: null })
              .eq("id", o.id).eq("user_id", user.id) as unknown as Promise<any>
          );
          return { ...o, custom_amount: undefined };
        }
        return o;
      });

      const changedIds = new Set(nextOverrides.filter((o, i) => o !== currentOverrides[i]).map(o => o.id));
      if (changedIds.size > 0) {
        setOverrides(prev =>
          prev.map(o => {
            const changed = nextOverrides.find(n => n.id === o.id);
            return changed && changedIds.has(o.id) ? changed : o;
          })
        );
      }
      await Promise.all(dbUpdates);
    }
    await ensureSaved(supabase.from("bills").update({ ...bill }).eq("id", bill.id).eq("user_id", user.id), "Update bill");
    setBills(prev => reorderDebtPriorities(prev.map(b => b.id === bill.id ? bill : b)));
  }, [user, bills]);

  const deleteBill = useCallback(async (id: string) => {
    if (!user) return;
    const results = await Promise.all([
      supabase.from("bills").delete().eq("id", id).eq("user_id", user.id),
      supabase.from("monthly_overrides").delete().eq("bill_id", id).eq("user_id", user.id),
    ]);
    const failed = results.find(result => result.error);
    if (failed?.error) throw new Error(`Delete bill: ${failed.error.message}`);
    setBills(prev => reorderDebtPriorities(prev.filter(b => b.id !== id)));
    setOverrides(prev => prev.filter(o => o.bill_id !== id));
  }, [user]);

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
    async (billId: string, month: number, year: number, patch: Partial<Omit<MonthlyOverride, "id" | "bill_id" | "month" | "year">>) => {
      if (!user) return;
      const existing = overridesRef.current.find(o => o.bill_id === billId && o.month === month && o.year === year);
      if (existing) {
        const updated = { ...existing, ...patch };
        await ensureSaved(
          supabase.from("monthly_overrides").update({ ...updated }).eq("id", existing.id).eq("user_id", user.id),
          "Update monthly bill"
        );
        setOverrides(prev => prev.map(o => o.id === existing.id ? updated : o));
      } else {
        const no: MonthlyOverride = { id: genId(), bill_id: billId, month, year, paid_amount: 0, ...patch };
        await ensureSaved(supabase.from("monthly_overrides").insert({ ...no, user_id: user.id }), "Create monthly bill");
        setOverrides(prev => [...prev, no]);
      }
    },
    [user]
  );

  const setPaidAmount = useCallback(
    async (billId: string, month: number, year: number, amount: number) => {
      const prevPaid = overridesRef.current.find(o => o.bill_id === billId && o.month === month && o.year === year)?.paid_amount ?? 0;
      await upsertOverride(billId, month, year, { paid_amount: Math.max(0, amount) });
      const delta = amount - prevPaid;
      if (delta !== 0 && user) {
        const bill = bills.find(b => b.id === billId);
        if (bill?.is_debt) {
          const nextBalance = Math.max(0, bill.balance - delta);
          await ensureSaved(
            supabase.from("bills").update({ balance: nextBalance }).eq("id", billId).eq("user_id", user.id),
            "Update debt balance"
          );
          setBills(prev => reorderDebtPriorities(
            prev.map(b => b.id === billId ? { ...b, balance: nextBalance } : b)
          ));
        }
      }
    },
    [upsertOverride, bills, user]
  );

  const setCustomAmount = useCallback(
    async (billId: string, month: number, year: number, amount: number | undefined) =>
      upsertOverride(billId, month, year, { custom_amount: amount }),
    [upsertOverride]
  );

  const getCustomDueDay = useCallback(
    (billId: string, month: number, year: number): number | undefined =>
      overrides.find(o => o.bill_id === billId && o.month === month && o.year === year)?.custom_due_day,
    [overrides]
  );

  const setCustomDueDay = useCallback(
    async (billId: string, month: number, year: number, day: number | undefined) =>
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

  const saveExtraPayment = useCallback(async (month: number, year: number, amount: number, allocations: SnowballAllocation[]) => {
    if (!user) return;
    const existing = extraPayments.find(ep => ep.month === month && ep.year === year);
    if (existing) {
      await ensureSaved(
        supabase.from("extra_payments").update({ amount, allocations }).eq("id", existing.id).eq("user_id", user.id),
        "Update extra payment"
      );
      setExtraPayments(prev => prev.map(ep => ep.id === existing.id ? { ...ep, amount, allocations } : ep));
    } else {
      const next: ExtraPayment = { id: genId(), month, year, amount, allocations };
      await ensureSaved(supabase.from("extra_payments").insert({ ...next, user_id: user.id }), "Add extra payment");
      setExtraPayments(prev => [...prev, next]);
    }
  }, [user, extraPayments]);

  const getExtraPayment = useCallback(
    (month: number, year: number) => extraPayments.find(ep => ep.month === month && ep.year === year),
    [extraPayments]
  );

  const deleteExtraPayment = useCallback(async (id: string) => {
    if (!user) return;
    await ensureSaved(supabase.from("extra_payments").delete().eq("id", id).eq("user_id", user.id), "Delete extra payment");
    setExtraPayments(prev => prev.filter(ep => ep.id !== id));
  }, [user]);

  // ─── Transactions ─────────────────────────────────────────────────────────────

  const addTransaction = useCallback(async (tx: Omit<Transaction, "id">) => {
    if (!user) return;
    const nt: Transaction = { ...tx, id: genId() };
    await ensureSaved(supabase.from("transactions").insert({ ...nt, user_id: user.id }), "Add transaction");
    setTransactions(prev => [...prev, nt]);
  }, [user]);

  const updateTransaction = useCallback(async (tx: Transaction) => {
    if (!user) return;
    await ensureSaved(supabase.from("transactions").update({ ...tx }).eq("id", tx.id).eq("user_id", user.id), "Update transaction");
    setTransactions(prev => prev.map(t => t.id === tx.id ? tx : t));
  }, [user]);

  const deleteTransaction = useCallback(async (id: string) => {
    if (!user) return;
    await ensureSaved(supabase.from("transactions").delete().eq("id", id).eq("user_id", user.id), "Delete transaction");
    setTransactions(prev => prev.filter(t => t.id !== id));
  }, [user]);

  const getTransactionsForMonth = useCallback(
    (month: number, year: number) =>
      transactions.filter(t => {
        const [ty, tm] = t.date.split("-").map(Number);
        return ty === year && tm === month + 1;
      }),
    [transactions]
  );

  // ─── Income ───────────────────────────────────────────────────────────────────

  const addIncome = useCallback(async (item: Omit<IncomeItem, "id">) => {
    if (!user) return;
    const ni: IncomeItem = { ...item, id: genId() };
    await ensureSaved(supabase.from("incomes").insert({ ...ni, amount_history: ni.amount_history ?? [], user_id: user.id }), "Add income");
    setIncomes(prev => [...prev, ni]);
  }, [user]);

  const updateIncome = useCallback(async (item: IncomeItem) => {
    if (!user) return;
    await ensureSaved(supabase.from("incomes").update({ ...item, amount_history: item.amount_history ?? [] }).eq("id", item.id).eq("user_id", user.id), "Update income");
    setIncomes(prev => prev.map(i => i.id === item.id ? item : i));
  }, [user]);

  const deleteIncome = useCallback(async (id: string) => {
    if (!user) return;
    await ensureSaved(supabase.from("incomes").delete().eq("id", id).eq("user_id", user.id), "Delete income");
    setIncomes(prev => prev.filter(i => i.id !== id));
  }, [user]);

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

  const addGoal = useCallback(async (goal: Omit<Goal, "id" | "created_at">) => {
    if (!user) return;
    const ng: Goal = { ...goal, id: genId(), created_at: new Date().toISOString() };
    await ensureSaved(supabase.from("goals").insert({ ...ng, user_id: user.id }), "Add goal");
    setGoals(prev => [...prev, ng]);
  }, [user]);

  const updateGoal = useCallback(async (goal: Goal) => {
    if (!user) return;
    await ensureSaved(supabase.from("goals").update({ ...goal }).eq("id", goal.id).eq("user_id", user.id), "Update goal");
    setGoals(prev => prev.map(g => g.id === goal.id ? goal : g));
  }, [user]);

  const deleteGoal = useCallback(async (id: string) => {
    if (!user) return;
    await ensureSaved(supabase.from("goals").delete().eq("id", id).eq("user_id", user.id), "Delete goal");
    setGoals(prev => prev.filter(g => g.id !== id));
  }, [user]);

  const checkGoalAffordability = useCallback(
    (goal: Goal, month: number, year: number): GoalAffordability => {
      const monthNet = (m: number, y: number): number => {
        const inc = incomes.reduce((s, i) => s + getIncomeOccurrenceDays(i, m, y).length * getEffectiveIncomeAmount(i, m, y), 0);
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
      .reduce((s, i) => s + getIncomeOccurrenceDays(i, month, year).length * getEffectiveIncomeAmount(i, month, year), 0);
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
      const inc = incomes.reduce((s, i) => s + getIncomeOccurrenceDays(i, m, y).length * getEffectiveIncomeAmount(i, m, y), 0);
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
        if (d.getFullYear() === y && d.getMonth() === m) return s + Math.max(0, g.target_amount - g.current_amount);
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
      const remaining = Math.max(0, g.target_amount - g.current_amount);
      if (remaining > 0) goalsByDay[day].push({ id: g.id, name: g.name, amount: remaining });
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

  const addCategory = useCallback(async (name: string) => {
    if (!user) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    if (categories.includes(trimmed)) return;
    await ensureSaved(supabase.from("categories").insert({ user_id: user.id, name: trimmed }), "Add category");
    setCategories(prev => [...prev, trimmed]);
  }, [user, categories]);

  const updateCategory = useCallback(async (oldName: string, newName: string) => {
    if (!user) return;
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName) return;
    const affectedBills = bills.filter(b => b.category === oldName);
    const affectedTransactions = transactions.filter(t => t.category === oldName);
    const results = await Promise.all([
      supabase.from("categories").update({ name: trimmed }).eq("user_id", user.id).eq("name", oldName),
      ...affectedBills.map(b => supabase.from("bills").update({ category: trimmed }).eq("id", b.id).eq("user_id", user.id)),
      ...affectedTransactions.map(t => supabase.from("transactions").update({ category: trimmed }).eq("id", t.id).eq("user_id", user.id)),
    ]);
    const failed = results.find(result => result.error);
    if (failed?.error) throw new Error(`Rename category: ${failed.error.message}`);
    setCategories(prev => prev.map(c => c === oldName ? trimmed : c));
    setBills(prev => prev.map(b => b.category === oldName ? { ...b, category: trimmed } : b));
    setTransactions(prev => prev.map(t => t.category === oldName ? { ...t, category: trimmed } : t));
  }, [user, bills, transactions]);

  const deleteCategory = useCallback(async (name: string) => {
    if (!user) return;
    const affectedBills = bills.filter(b => b.category === name);
    const affectedTransactions = transactions.filter(t => t.category === name);
    const results = await Promise.all([
      supabase.from("categories").delete().eq("user_id", user.id).eq("name", name),
      ...affectedBills.map(b => supabase.from("bills").update({ category: "Other" }).eq("id", b.id).eq("user_id", user.id)),
      ...affectedTransactions.map(t => supabase.from("transactions").update({ category: "Other" }).eq("id", t.id).eq("user_id", user.id)),
    ]);
    const failed = results.find(result => result.error);
    if (failed?.error) throw new Error(`Delete category: ${failed.error.message}`);
    setCategories(prev => prev.filter(c => c !== name));
    setBills(prev => prev.map(b => b.category === name ? { ...b, category: "Other" } : b));
    setTransactions(prev => prev.map(t => t.category === name ? { ...t, category: "Other" } : t));
  }, [user, bills, transactions]);

  // ─── Settings ─────────────────────────────────────────────────────────────────

  const updateSettings = useCallback(async (s: Partial<Settings>) => {
    if (!user) return;
    const next = { ...settings, ...s };
    await ensureSaved(supabase.from("settings").upsert({
      user_id:               user.id,
      payment_method:        next.paymentMethod,
      starting_balance:      next.starting_balance,
      starting_balance_date: next.starting_balance_date ?? null,
    }), "Update settings");
    setSettings(next);
  }, [user, settings]);

  const importBills = useCallback(async (imported: Omit<Bill, "id" | "created_at">[]) => {
    if (!user) return;
    const newBills = imported.map(b => ({
      ...b,
      frequency:   (b.frequency ?? "monthly") as "monthly" | "weekly",
      day_of_week: b.day_of_week ?? 0,
      id:          genId(),
      created_at:  new Date().toISOString(),
    }));
    await ensureSaved(supabase.from("bills").insert(newBills.map(b => ({ ...b, user_id: user.id }))), "Import bills");
    setBills(prev => reorderDebtPriorities([...prev, ...newBills]));
  }, [user]);

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
