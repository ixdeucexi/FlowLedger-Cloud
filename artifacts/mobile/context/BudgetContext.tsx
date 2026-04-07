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

export interface MonthlyEntry {
  id: string;
  billId: string;
  month: number;
  year: number;
  paid_amount: number;
  paid: boolean;
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
}

export interface Settings {
  paymentMethod: "snowball" | "avalanche";
  monthly_income: number;
  starting_balance: number;
  show_recurring_only: boolean;
  carryover_balances: boolean;
}

interface BudgetContextType {
  bills: Bill[];
  monthlyEntries: MonthlyEntry[];
  transactions: Transaction[];
  settings: Settings;
  loading: boolean;

  addBill: (bill: Omit<Bill, "id" | "created_at">) => void;
  updateBill: (bill: Bill) => void;
  deleteBill: (id: string) => void;
  getBillById: (id: string) => Bill | undefined;

  getEntriesForMonth: (month: number, year: number) => MonthlyEntry[];
  ensureMonthlyEntries: (month: number, year: number) => void;
  togglePaid: (entryId: string) => void;
  updatePaidAmount: (entryId: string, amount: number) => void;

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

const BILLS_KEY = "@budget_bills_v2";
const ENTRIES_KEY = "@budget_entries_v2";
const TRANSACTIONS_KEY = "@budget_transactions_v2";
const SETTINGS_KEY = "@budget_settings_v2";

const DEFAULT_SETTINGS: Settings = {
  paymentMethod: "snowball",
  monthly_income: 0,
  starting_balance: 0,
  show_recurring_only: false,
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
  const [monthlyEntries, setMonthlyEntries] = useState<MonthlyEntry[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());

  useEffect(() => {
    (async () => {
      try {
        const [bd, ed, td, sd] = await Promise.all([
          AsyncStorage.getItem(BILLS_KEY),
          AsyncStorage.getItem(ENTRIES_KEY),
          AsyncStorage.getItem(TRANSACTIONS_KEY),
          AsyncStorage.getItem(SETTINGS_KEY),
        ]);
        const loadedBills: Bill[] = bd ? JSON.parse(bd) : SEED_BILLS;
        if (!bd) await AsyncStorage.setItem(BILLS_KEY, JSON.stringify(SEED_BILLS));
        setBills(loadedBills);
        if (ed) setMonthlyEntries(JSON.parse(ed));
        if (td) setTransactions(JSON.parse(td));
        if (sd) setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(sd) });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const saveBills = async (b: Bill[]) => {
    setBills(b);
    await AsyncStorage.setItem(BILLS_KEY, JSON.stringify(b));
  };

  const saveEntries = async (e: MonthlyEntry[]) => {
    setMonthlyEntries(e);
    await AsyncStorage.setItem(ENTRIES_KEY, JSON.stringify(e));
  };

  const saveTxs = async (t: Transaction[]) => {
    setTransactions(t);
    await AsyncStorage.setItem(TRANSACTIONS_KEY, JSON.stringify(t));
  };

  const addBill = useCallback((bill: Omit<Bill, "id" | "created_at">) => {
    const newBill: Bill = { ...bill, id: genId(), created_at: new Date().toISOString() };
    setBills(prev => {
      const u = [...prev, newBill];
      AsyncStorage.setItem(BILLS_KEY, JSON.stringify(u));
      return u;
    });
  }, []);

  const updateBill = useCallback((bill: Bill) => {
    setBills(prev => {
      const u = prev.map(b => (b.id === bill.id ? bill : b));
      AsyncStorage.setItem(BILLS_KEY, JSON.stringify(u));
      return u;
    });
  }, []);

  const deleteBill = useCallback((id: string) => {
    setBills(prev => {
      const u = prev.filter(b => b.id !== id);
      AsyncStorage.setItem(BILLS_KEY, JSON.stringify(u));
      return u;
    });
    setMonthlyEntries(prev => {
      const u = prev.filter(e => e.billId !== id);
      AsyncStorage.setItem(ENTRIES_KEY, JSON.stringify(u));
      return u;
    });
  }, []);

  const getBillById = useCallback((id: string) => bills.find(b => b.id === id), [bills]);

  const getEntriesForMonth = useCallback(
    (month: number, year: number) =>
      monthlyEntries.filter(e => e.month === month && e.year === year),
    [monthlyEntries]
  );

  const ensureMonthlyEntries = useCallback(
    (month: number, year: number) => {
      setMonthlyEntries(prev => {
        const existingBillIds = new Set(
          prev.filter(e => e.month === month && e.year === year).map(e => e.billId)
        );
        const visibleBills = bills.filter(b =>
          b.is_recurring
        );
        const newEntries = visibleBills
          .filter(b => !existingBillIds.has(b.id))
          .map(b => ({
            id: genId(),
            billId: b.id,
            month,
            year,
            paid_amount: 0,
            paid: false,
          }));
        if (newEntries.length === 0) return prev;
        const u = [...prev, ...newEntries];
        AsyncStorage.setItem(ENTRIES_KEY, JSON.stringify(u));
        return u;
      });
    },
    [bills]
  );

  const togglePaid = useCallback(
    (entryId: string) => {
      setMonthlyEntries(prev => {
        const u = prev.map(e => {
          if (e.id !== entryId) return e;
          const bill = bills.find(b => b.id === e.billId);
          const newPaid = !e.paid;
          return {
            ...e,
            paid: newPaid,
            paid_amount: newPaid ? (bill?.amount ?? 0) : 0,
          };
        });
        AsyncStorage.setItem(ENTRIES_KEY, JSON.stringify(u));
        return u;
      });
    },
    [bills]
  );

  const updatePaidAmount = useCallback((entryId: string, amount: number) => {
    setMonthlyEntries(prev => {
      const u = prev.map(e => {
        if (e.id !== entryId) return e;
        const bill = bills.find(b => b.id === e.billId);
        return {
          ...e,
          paid_amount: amount,
          paid: !!bill && amount >= bill.amount,
        };
      });
      AsyncStorage.setItem(ENTRIES_KEY, JSON.stringify(u));
      return u;
    });
  }, [bills]);

  const runSnowball = useCallback(
    (month: number, year: number, extraAmount: number): SnowballAllocation[] => {
      const entries = monthlyEntries.filter(e => e.month === month && e.year === year);
      const debtItems = bills
        .filter(b => b.is_debt && b.balance > 0)
        .map(b => {
          const entry = entries.find(e => e.billId === b.id);
          return {
            bill: { ...b },
            entry,
            remaining: b.balance - (entry?.paid_amount ?? 0),
          };
        })
        .filter(x => x.remaining > 0);

      if (settings.paymentMethod === "snowball") {
        debtItems.sort((a, b) => a.remaining - b.remaining);
      } else {
        debtItems.sort((a, b) => b.bill.interest_rate - a.bill.interest_rate);
      }

      const allocations: SnowballAllocation[] = [];
      let rollover = extraAmount;

      const updatedBills = [...bills];
      const updatedEntries = [...monthlyEntries];

      for (const item of debtItems) {
        if (rollover <= 0) break;
        const payment = Math.min(rollover, item.remaining);
        const balanceAfter = Math.max(0, item.bill.balance - payment);
        const paidOff = balanceAfter === 0;

        allocations.push({
          billId: item.bill.id,
          billName: item.bill.name,
          payment,
          balanceBefore: item.bill.balance,
          balanceAfter,
          paidOff,
        });

        const billIdx = updatedBills.findIndex(b => b.id === item.bill.id);
        if (billIdx !== -1) {
          updatedBills[billIdx] = { ...updatedBills[billIdx], balance: balanceAfter };
        }

        if (item.entry) {
          const entryIdx = updatedEntries.findIndex(e => e.id === item.entry!.id);
          if (entryIdx !== -1) {
            const newPaid = (updatedEntries[entryIdx].paid_amount ?? 0) + payment;
            const bill = updatedBills[billIdx];
            updatedEntries[entryIdx] = {
              ...updatedEntries[entryIdx],
              paid_amount: newPaid,
              paid: paidOff || (bill && newPaid >= bill.amount),
            };
          }
        }

        if (paidOff) {
          rollover -= payment;
        } else {
          rollover = 0;
        }
      }

      saveBills(updatedBills);
      saveEntries(updatedEntries);

      return allocations;
    },
    [bills, monthlyEntries, settings.paymentMethod]
  );

  const addTransaction = useCallback((tx: Omit<Transaction, "id">) => {
    const newTx: Transaction = { ...tx, id: genId() };
    setTransactions(prev => {
      const u = [...prev, newTx];
      AsyncStorage.setItem(TRANSACTIONS_KEY, JSON.stringify(u));
      return u;
    });
  }, []);

  const updateTransaction = useCallback((tx: Transaction) => {
    setTransactions(prev => {
      const u = prev.map(t => (t.id === tx.id ? tx : t));
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
        const d = new Date(t.date);
        return d.getMonth() === month && d.getFullYear() === year;
      }),
    [transactions]
  );

  const updateSettings = useCallback((s: Partial<Settings>) => {
    setSettings(prev => {
      const u = { ...prev, ...s };
      AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(u));
      return u;
    });
  }, []);

  const importBills = useCallback((imported: Omit<Bill, "id" | "created_at">[]) => {
    setBills(prev => {
      const newBills = imported.map(b => ({
        ...b,
        id: genId(),
        created_at: new Date().toISOString(),
      }));
      const u = [...prev, ...newBills];
      AsyncStorage.setItem(BILLS_KEY, JSON.stringify(u));
      return u;
    });
  }, []);

  return (
    <BudgetContext.Provider
      value={{
        bills,
        monthlyEntries,
        transactions,
        settings,
        loading,
        addBill,
        updateBill,
        deleteBill,
        getBillById,
        getEntriesForMonth,
        ensureMonthlyEntries,
        togglePaid,
        updatePaidAmount,
        runSnowball,
        addTransaction,
        updateTransaction,
        deleteTransaction,
        getTransactionsForMonth,
        updateSettings,
        importBills,
        selectedYear,
        setSelectedYear,
      }}
    >
      {children}
    </BudgetContext.Provider>
  );
}

export function useBudget() {
  const ctx = useContext(BudgetContext);
  if (!ctx) throw new Error("useBudget must be used within BudgetProvider");
  return ctx;
}
