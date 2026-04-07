import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

export interface Bill {
  id: string;
  name: string;
  amount: number;
  category: string;
  priority: number;
}

export interface MonthlyEntry {
  id: string;
  billId: string;
  month: number;
  year: number;
  dueDay: number;
  paid: boolean;
  paidAmount: number;
}

export interface ExtraPayment {
  id: string;
  month: number;
  year: number;
  amount: number;
  appliedAt: string;
  allocations: { billId: string; amount: number }[];
}

interface BudgetContextType {
  bills: Bill[];
  monthlyEntries: MonthlyEntry[];
  extraPayments: ExtraPayment[];
  loading: boolean;
  addBill: (bill: Omit<Bill, "id">) => void;
  updateBill: (bill: Bill) => void;
  deleteBill: (id: string) => void;
  getEntriesForMonth: (month: number, year: number) => MonthlyEntry[];
  updateMonthlyEntry: (entry: MonthlyEntry) => void;
  togglePaid: (entryId: string) => void;
  ensureMonthlyEntries: (month: number, year: number) => void;
  addExtraPayment: (month: number, year: number, amount: number, method: "smallest" | "priority") => void;
  importBills: (imported: Omit<Bill, "id">[]) => void;
  getBillById: (id: string) => Bill | undefined;
  selectedYear: number;
  setSelectedYear: (year: number) => void;
}

const BudgetContext = createContext<BudgetContextType | undefined>(undefined);

const BILLS_KEY = "@budget_bills";
const ENTRIES_KEY = "@budget_entries";
const EXTRA_KEY = "@budget_extra";

function generateId(): string {
  return Date.now().toString() + Math.random().toString(36).substr(2, 9);
}

export function BudgetProvider({ children }: { children: React.ReactNode }) {
  const [bills, setBills] = useState<Bill[]>([]);
  const [monthlyEntries, setMonthlyEntries] = useState<MonthlyEntry[]>([]);
  const [extraPayments, setExtraPayments] = useState<ExtraPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [billsData, entriesData, extraData] = await Promise.all([
        AsyncStorage.getItem(BILLS_KEY),
        AsyncStorage.getItem(ENTRIES_KEY),
        AsyncStorage.getItem(EXTRA_KEY),
      ]);
      if (billsData) setBills(JSON.parse(billsData));
      if (entriesData) setMonthlyEntries(JSON.parse(entriesData));
      if (extraData) setExtraPayments(JSON.parse(extraData));
    } catch {
    } finally {
      setLoading(false);
    }
  };

  const saveBills = async (newBills: Bill[]) => {
    setBills(newBills);
    await AsyncStorage.setItem(BILLS_KEY, JSON.stringify(newBills));
  };

  const saveEntries = async (newEntries: MonthlyEntry[]) => {
    setMonthlyEntries(newEntries);
    await AsyncStorage.setItem(ENTRIES_KEY, JSON.stringify(newEntries));
  };

  const saveExtra = async (newExtra: ExtraPayment[]) => {
    setExtraPayments(newExtra);
    await AsyncStorage.setItem(EXTRA_KEY, JSON.stringify(newExtra));
  };

  const addBill = useCallback((bill: Omit<Bill, "id">) => {
    const newBill: Bill = { ...bill, id: generateId() };
    setBills(prev => {
      const updated = [...prev, newBill];
      AsyncStorage.setItem(BILLS_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const updateBill = useCallback((bill: Bill) => {
    setBills(prev => {
      const updated = prev.map(b => (b.id === bill.id ? bill : b));
      AsyncStorage.setItem(BILLS_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const deleteBill = useCallback((id: string) => {
    setBills(prev => {
      const updated = prev.filter(b => b.id !== id);
      AsyncStorage.setItem(BILLS_KEY, JSON.stringify(updated));
      return updated;
    });
    setMonthlyEntries(prev => {
      const updated = prev.filter(e => e.billId !== id);
      AsyncStorage.setItem(ENTRIES_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const getEntriesForMonth = useCallback(
    (month: number, year: number) => {
      return monthlyEntries.filter(e => e.month === month && e.year === year);
    },
    [monthlyEntries]
  );

  const getBillById = useCallback(
    (id: string) => {
      return bills.find(b => b.id === id);
    },
    [bills]
  );

  const ensureMonthlyEntries = useCallback(
    (month: number, year: number) => {
      setMonthlyEntries(prev => {
        const existing = prev.filter(e => e.month === month && e.year === year);
        const existingBillIds = new Set(existing.map(e => e.billId));
        const newEntries = bills
          .filter(b => !existingBillIds.has(b.id))
          .map(b => ({
            id: generateId(),
            billId: b.id,
            month,
            year,
            dueDay: 1,
            paid: false,
            paidAmount: 0,
          }));
        if (newEntries.length === 0) return prev;
        const updated = [...prev, ...newEntries];
        AsyncStorage.setItem(ENTRIES_KEY, JSON.stringify(updated));
        return updated;
      });
    },
    [bills]
  );

  const updateMonthlyEntry = useCallback((entry: MonthlyEntry) => {
    setMonthlyEntries(prev => {
      const updated = prev.map(e => (e.id === entry.id ? entry : e));
      AsyncStorage.setItem(ENTRIES_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const togglePaid = useCallback(
    (entryId: string) => {
      setMonthlyEntries(prev => {
        const updated = prev.map(e => {
          if (e.id !== entryId) return e;
          const bill = bills.find(b => b.id === e.billId);
          const newPaid = !e.paid;
          return {
            ...e,
            paid: newPaid,
            paidAmount: newPaid ? (bill?.amount ?? 0) : 0,
          };
        });
        AsyncStorage.setItem(ENTRIES_KEY, JSON.stringify(updated));
        return updated;
      });
    },
    [bills]
  );

  const addExtraPayment = useCallback(
    (month: number, year: number, amount: number, method: "smallest" | "priority") => {
      const entries = monthlyEntries.filter(e => e.month === month && e.year === year && !e.paid);
      const billsWithEntries = entries
        .map(e => {
          const bill = bills.find(b => b.id === e.billId);
          if (!bill) return null;
          return { entry: e, bill, remaining: bill.amount - e.paidAmount };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null && x.remaining > 0);

      if (method === "smallest") {
        billsWithEntries.sort((a, b) => a.remaining - b.remaining);
      } else {
        billsWithEntries.sort((a, b) => a.bill.priority - b.bill.priority);
      }

      let remaining = amount;
      const allocations: { billId: string; amount: number }[] = [];
      const updatedEntries = [...monthlyEntries];

      for (const item of billsWithEntries) {
        if (remaining <= 0) break;
        const payment = Math.min(remaining, item.remaining);
        remaining -= payment;
        allocations.push({ billId: item.bill.id, amount: payment });

        const idx = updatedEntries.findIndex(e => e.id === item.entry.id);
        if (idx !== -1) {
          const newPaidAmount = updatedEntries[idx].paidAmount + payment;
          const bill = bills.find(b => b.id === item.bill.id);
          updatedEntries[idx] = {
            ...updatedEntries[idx],
            paidAmount: newPaidAmount,
            paid: bill ? newPaidAmount >= bill.amount : false,
          };
        }
      }

      const extra: ExtraPayment = {
        id: generateId(),
        month,
        year,
        amount,
        appliedAt: new Date().toISOString(),
        allocations,
      };

      saveEntries(updatedEntries);
      saveExtra([...extraPayments, extra]);
    },
    [monthlyEntries, bills, extraPayments]
  );

  const importBills = useCallback((imported: Omit<Bill, "id">[]) => {
    const newBills = imported.map((b, i) => ({
      ...b,
      id: generateId() + i,
    }));
    setBills(prev => {
      const updated = [...prev, ...newBills];
      AsyncStorage.setItem(BILLS_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  return (
    <BudgetContext.Provider
      value={{
        bills,
        monthlyEntries,
        extraPayments,
        loading,
        addBill,
        updateBill,
        deleteBill,
        getEntriesForMonth,
        updateMonthlyEntry,
        togglePaid,
        ensureMonthlyEntries,
        addExtraPayment,
        importBills,
        getBillById,
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
