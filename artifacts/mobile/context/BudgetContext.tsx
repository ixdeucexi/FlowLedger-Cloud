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

export interface SnowballAllocation {
  billId: string;
  billName: string;
  payment: number;
  balanceBefore: number;
  balanceAfter: number;
  paidOff: boolean;
  cascadeFrom?: string;
}

export interface Settings {
  paymentMethod: "snowball" | "avalanche";
  monthly_income: number;
  carryover_balances: boolean;
}

export type DashboardFilter = null | "paid" | "unpaid" | "debts";

interface BudgetContextType {
  bills: Bill[];
  overrides: MonthlyOverride[];
  transactions: Transaction[];
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
  runSnowball: (month: number, year: number, extraAmount: number) => SnowballAllocation[];

  addTransaction: (tx: Omit<Transaction, "id">) => void;
  updateTransaction: (tx: Transaction) => void;
  deleteTransaction: (id: string) => void;
  getTransactionsForMonth: (month: number, year: number) => Transaction[];

  updateSettings: (s: Partial<Settings>) => void;
  importBills: (bills: Omit<Bill, "id" | "created_at">[]) => void;

  selectedYear: number;
  setSelectedYear: (y: number) => void;
}

const BudgetContext = createContext<BudgetContextType | undefined>(undefined);

const BILLS_KEY = "@budget_bills_v3";
const OVERRIDES_KEY = "@budget_overrides_v1";
const TRANSACTIONS_KEY = "@budget_transactions_v2";
const SETTINGS_KEY = "@budget_settings_v3";

const DEFAULT_SETTINGS: Settings = {
  paymentMethod: "snowball",
  monthly_income: 0,
  carryover_balances: false,
};

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

const SEED_BILLS: Bill[] = [
  { id: "s1", name: "Rent", amount: 1200, category: "Housing", priority: 1, is_debt: false, balance: 0, interest_rate: 0, due_day: 1, is_recurring: true, created_at: new Date().toISOString() },
  { id: "s2", name: "Electric", amount: 95, category: "Utilities", priority: 3, is_debt: false, balance: 0, interest_rate: 0, due_day: 10, is_recurring: true, created_at: new Date().toISOString() },
  { id: "s3", name: "Internet", amount: 60, category: "Utilities", priority: 4, is_debt: false, balance: 0, interest_rate: 0, due_day: 15, is_recurring: true, created_at: new Date().toISOString() },
  { id: "s4", name: "Car Loan", amount: 350, category: "Debt", priority: 2, is_debt: true, balance: 4200, interest_rate: 6.5, due_day: 20, is_recurring: true, created_at: new Date().toISOString() },
  { id: "s5", name: "Credit Card", amount: 120, category: "Debt", priority: 3, is_debt: true, balance: 1850, interest_rate: 22.9, due_day: 25, is_recurring: true, created_at: new Date().toISOString() },
  { id: "s6", name: "Medical Bill", amount: 75, category: "Debt", priority: 4, is_debt: true, balance: 650, interest_rate: 0, due_day: 5, is_recurring: true, created_at: new Date().toISOString() },
  { id: "s7", name: "Groceries", amount: 400, category: "Food", priority: 5, is_debt: false, balance: 0, interest_rate: 0, due_day: 1, is_recurring: true, created_at: new Date().toISOString() },
  { id: "s8", name: "Insurance", amount: 180, category: "Insurance", priority: 2, is_debt: false, balance: 0, interest_rate: 0, due_day: 8, is_recurring: true, created_at: new Date().toISOString() },
];

export function BudgetProvider({ children }: { children: React.ReactNode }) {
  const [bills, setBills] = useState<Bill[]>([]);
  const [overrides, setOverrides] = useState<MonthlyOverride[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [dashboardFilter, setDashboardFilter] = useState<DashboardFilter>(null);

  useEffect(() => {
    (async () => {
      try {
        const [bd, od, td, sd] = await Promise.all([
          AsyncStorage.getItem(BILLS_KEY),
          AsyncStorage.getItem(OVERRIDES_KEY),
          AsyncStorage.getItem(TRANSACTIONS_KEY),
          AsyncStorage.getItem(SETTINGS_KEY),
        ]);
        const loadedBills: Bill[] = bd ? JSON.parse(bd) : SEED_BILLS;
        if (!bd) await AsyncStorage.setItem(BILLS_KEY, JSON.stringify(SEED_BILLS));
        setBills(loadedBills);
        if (od) setOverrides(JSON.parse(od));
        if (td) setTransactions(JSON.parse(td));
        if (sd) setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(sd) });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const addBill = useCallback((bill: Omit<Bill, "id" | "created_at">) => {
    const nb: Bill = { ...bill, id: genId(), created_at: new Date().toISOString() };
    setBills(prev => { const u = [...prev, nb]; AsyncStorage.setItem(BILLS_KEY, JSON.stringify(u)); return u; });
  }, []);

  const updateBill = useCallback((bill: Bill) => {
    setBills(prev => { const u = prev.map(b => b.id === bill.id ? bill : b); AsyncStorage.setItem(BILLS_KEY, JSON.stringify(u)); return u; });
  }, []);

  const deleteBill = useCallback((id: string) => {
    setBills(prev => { const u = prev.filter(b => b.id !== id); AsyncStorage.setItem(BILLS_KEY, JSON.stringify(u)); return u; });
    setOverrides(prev => { const u = prev.filter(o => o.bill_id !== id); AsyncStorage.setItem(OVERRIDES_KEY, JSON.stringify(u)); return u; });
  }, []);

  const getBillById = useCallback((id: string) => bills.find(b => b.id === id), [bills]);

  const getOverride = useCallback(
    (billId: string, month: number, year: number): MonthlyOverride | undefined =>
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
    (billId: string, month: number, year: number): number => {
      const o = overrides.find(o => o.bill_id === billId && o.month === month && o.year === year);
      return o?.paid_amount ?? 0;
    },
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
          const newO: MonthlyOverride = { id: genId(), bill_id: billId, month, year, paid_amount: 0, ...patch };
          updated = [...prev, newO];
        }
        AsyncStorage.setItem(OVERRIDES_KEY, JSON.stringify(updated));
        return updated;
      });
    },
    []
  );

  const setPaidAmount = useCallback(
    (billId: string, month: number, year: number, amount: number) => {
      upsertOverride(billId, month, year, { paid_amount: amount });
      setBills(prev => {
        const bill = prev.find(b => b.id === billId);
        if (!bill?.is_debt) return prev;
        const o = overrides.find(o => o.bill_id === billId && o.month === month && o.year === year);
        const prevPaid = o?.paid_amount ?? 0;
        const delta = amount - prevPaid;
        if (delta === 0) return prev;
        const updated = prev.map(b => b.id === billId ? { ...b, balance: Math.max(0, b.balance - delta) } : b);
        AsyncStorage.setItem(BILLS_KEY, JSON.stringify(updated));
        return updated;
      });
    },
    [upsertOverride, overrides]
  );

  const setCustomAmount = useCallback(
    (billId: string, month: number, year: number, amount: number | undefined) => {
      upsertOverride(billId, month, year, { custom_amount: amount });
    },
    [upsertOverride]
  );

  const getMonthlyBills = useCallback(
    (month: number, year: number): Bill[] => bills.filter(b => b.is_recurring),
    [bills]
  );

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
      let freedPayments = 0;
      const updatedBills = [...bills];

      for (let i = 0; i < debtBills.length; i++) {
        const debt = debtBills[i];
        if (pool <= 0 && freedPayments <= 0) break;

        const available = pool + freedPayments;
        if (available <= 0) break;

        const alreadyPaid = getPaidAmount(debt.id, month, year);
        const amountDue = getAmount(debt, month, year);
        const remaining = Math.max(0, debt.balance - alreadyPaid);

        const payment = Math.min(available, remaining);
        if (payment <= 0) continue;

        const balanceBefore = debt.balance;
        const balanceAfter = Math.max(0, debt.balance - payment);
        const paidOff = balanceAfter === 0;

        allocations.push({
          billId: debt.id,
          billName: debt.name,
          payment,
          balanceBefore,
          balanceAfter,
          paidOff,
        });

        const billIdx = updatedBills.findIndex(b => b.id === debt.id);
        if (billIdx !== -1) updatedBills[billIdx] = { ...updatedBills[billIdx], balance: balanceAfter };
        debtBills[i] = { ...debt, balance: balanceAfter };

        if (paidOff) {
          pool = Math.max(0, pool - payment + (pool < payment ? 0 : 0));
          pool = Math.max(0, available - payment);
          freedPayments += amountDue;
        } else {
          pool = 0;
          freedPayments = 0;
        }

        upsertOverride(debt.id, month, year, { paid_amount: alreadyPaid + payment });
      }

      setBills(updatedBills);
      AsyncStorage.setItem(BILLS_KEY, JSON.stringify(updatedBills));

      return allocations;
    },
    [bills, settings.paymentMethod, overrides, getPaidAmount, getAmount, upsertOverride]
  );

  const addTransaction = useCallback((tx: Omit<Transaction, "id">) => {
    const nt: Transaction = { ...tx, id: genId() };
    setTransactions(prev => { const u = [...prev, nt]; AsyncStorage.setItem(TRANSACTIONS_KEY, JSON.stringify(u)); return u; });
  }, []);

  const updateTransaction = useCallback((tx: Transaction) => {
    setTransactions(prev => { const u = prev.map(t => t.id === tx.id ? tx : t); AsyncStorage.setItem(TRANSACTIONS_KEY, JSON.stringify(u)); return u; });
  }, []);

  const deleteTransaction = useCallback((id: string) => {
    setTransactions(prev => { const u = prev.filter(t => t.id !== id); AsyncStorage.setItem(TRANSACTIONS_KEY, JSON.stringify(u)); return u; });
  }, []);

  const getTransactionsForMonth = useCallback(
    (month: number, year: number) =>
      transactions.filter(t => { const d = new Date(t.date); return d.getMonth() === month && d.getFullYear() === year; }),
    [transactions]
  );

  const updateSettings = useCallback((s: Partial<Settings>) => {
    setSettings(prev => { const u = { ...prev, ...s }; AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(u)); return u; });
  }, []);

  const importBills = useCallback((imported: Omit<Bill, "id" | "created_at">[]) => {
    setBills(prev => {
      const nb = imported.map(b => ({ ...b, id: genId(), created_at: new Date().toISOString() }));
      const u = [...prev, ...nb];
      AsyncStorage.setItem(BILLS_KEY, JSON.stringify(u));
      return u;
    });
  }, []);

  return (
    <BudgetContext.Provider value={{
      bills, overrides, transactions, settings, loading,
      dashboardFilter, setDashboardFilter,
      addBill, updateBill, deleteBill, getBillById,
      getOverride, getAmount, getPaidAmount, setPaidAmount, setCustomAmount,
      getMonthlyBills, runSnowball,
      addTransaction, updateTransaction, deleteTransaction, getTransactionsForMonth,
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
