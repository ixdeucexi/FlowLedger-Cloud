import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Platform } from "react-native";

import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import {
  allocateSnowballExtra,
  effectiveDebtMinimum,
  orderDebts,
  simulateSnowballPayoff,
  type SnowballDebtInput,
  type SnowballProjectionResult,
} from "@/lib/snowball";
import { forecastBalances, type FinancialEvent } from "@/lib/forecast";
import { diagnosticErrorCode } from "@/lib/diagnosticPolicy";
import { recordDiagnostic } from "@/lib/diagnostics";
import { isDevDemoMode } from "@/lib/demoMode";
import { getBillOccurrenceDays, getEffectiveIncomeAmount, getIncomeOccurrenceDays, isBillActiveForMonth, isIncomeActiveForMonth } from "@/lib/schedule";
import { evaluateForecastConfidence, openingBalanceForReconciledDay, totalForecastBalance, type AccountSnapshot, type AccountType, type ForecastConfidence, type ImportedTransactionRow } from "@/lib/accounts";
import { scenarioDates, type DecisionResult, type DecisionScenario, type DecisionType } from "@/lib/decisions";

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
  include_in_snowball?: boolean;
  snowball_minimum_boost?: number;
  last_reviewed_at?: string;
}

export interface MonthlyOverride {
  id: string;
  bill_id: string;
  month: number;
  year: number;
  custom_amount?: number;
  custom_due_day?: number;
  paid_amount: number;
  actual_amount?: number;
  paid_date?: string;
}

export interface Transaction {
  id: string;
  date: string;
  amount: number;
  category: string;
  note: string;
  linked_bill_id?: string;
  account_id?: string;
  import_hash?: string;
  debt_applied_amount?: number;
  debt_applied_bill_id?: string;
}

export interface Account {
  id: string;
  name: string;
  account_type: AccountType;
  current_balance: number;
  balance_as_of: string;
  last_reconciled_at?: string;
  is_active: boolean;
  created_at: string;
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
  last_reviewed_at?: string;
}

export interface Goal {
  id: string;
  name: string;
  target_amount: number;
  target_date: string;
  current_amount: number;
  created_at: string;
  goal_type: "savings" | "planned_expense";
  calendar_marker_only?: boolean;
}

export interface DecisionRecord {
  id: string; name: string; decision_type: DecisionType; scenario: DecisionScenario; result: DecisionResult;
  status: "saved" | "planned" | "completed" | "cancelled" | "reversed" | "calendar" | "applied";
  calendar_date?: string; applied_change?: Record<string, unknown>; actual_amount?: number; remind_at?: string; next_due_date?: string; completed_at?: string; created_at: string;
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
  paymentDate?: string;
}

export interface SnowballFundingSource {
  type: "manual" | "bill_surplus";
  amount: number;
  billId?: string;
  billName?: string;
  pendingBalanceApply?: boolean;
}

export interface ExtraPayment {
  id: string;
  month: number;
  year: number;
  amount: number;
  allocations: SnowballAllocation[];
  payment_date?: string;
  sources?: SnowballFundingSource[];
}

export interface Settings {
  paymentMethod: "snowball" | "avalanche";
  starting_balance: number;
  starting_balance_date?: string;
  safety_floor: number;
  forecast_horizon_months: number;
  onboarding_completed: boolean;
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
  events?: FinancialEvent[];
}

export type DashboardFilter = "bills" | "debt" | "paid" | "unpaid" | null;
export type SaveStatus = "idle" | "saving" | "saved" | "failed";

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
  accounts: Account[];
  decisions: DecisionRecord[];
  forecastConfidence: ForecastConfidence;
  loading: boolean;
  selectedYear: number;
  setSelectedYear: (y: number) => void;
  dashboardFilter: DashboardFilter;
  setDashboardFilter: (f: DashboardFilter) => void;
  saveStatus: SaveStatus;
  saveError: string | null;
  retryLastSave: () => Promise<void>;
  clearSaveError: () => void;

  addBill: (bill: Omit<Bill, "id" | "created_at">) => Promise<string>;
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
  getBillEffectiveMonthlyTotal: (bill: Bill, month: number, year: number) => number;

  runSnowball: (month: number, year: number, extraAmount: number) => SnowballAllocation[];
  previewDebtSnowball: (month: number, year: number, extraAmount?: number, additionalSafeCredit?: number, paymentDateOverride?: string) => SnowballProjectionResult;
  applyDebtSnowballPayment: (preview: SnowballProjectionResult, sources?: SnowballFundingSource[]) => Promise<void>;
  saveExtraPayment: (month: number, year: number, amount: number, allocations: SnowballAllocation[], paymentDate?: string, sources?: SnowballFundingSource[]) => Promise<void>;
  removeDebtSnowballPayment: (month: number, year: number) => Promise<void>;
  finalizeBillPayment: (billId: string, month: number, year: number, actualAmount: number, paidDate: string) => Promise<{ budgeted: number; actual: number; surplus: number }>;
  getExtraPayment: (month: number, year: number) => ExtraPayment | undefined;
  deleteExtraPayment: (id: string) => Promise<void>;

  addTransaction: (tx: Omit<Transaction, "id">) => Promise<string>;
  updateTransaction: (tx: Transaction) => Promise<void>;
  deleteTransaction: (id: string) => Promise<void>;
  getTransactionsForMonth: (month: number, year: number) => Transaction[];

  addIncome: (item: Omit<IncomeItem, "id">) => Promise<string>;
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
  addAccount: (account: Omit<Account, "id" | "created_at" | "last_reconciled_at">) => Promise<void>;
  updateAccount: (account: Account) => Promise<void>;
  reconcileAccount: (accountId: string, balance: number, asOfDate: string) => Promise<void>;
  archiveAccount: (accountId: string) => Promise<void>;
  importStatementTransactions: (accountId: string, rows: ImportedTransactionRow[]) => Promise<{ imported: number; duplicates: number }>;
  saveDecision: (scenario: DecisionScenario, result: DecisionResult, status?: DecisionRecord["status"]) => Promise<DecisionRecord>;
  updateDecision: (decision: DecisionRecord) => Promise<void>;
  deleteDecision: (id: string) => Promise<void>;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS: Settings = {
  paymentMethod: "snowball",
  starting_balance: 0,
  safety_floor: 200,
  forecast_horizon_months: 6,
  onboarding_completed: false,
};

function toAccountSnapshot(account: Account): AccountSnapshot {
  return {
    id: account.id, name: account.name, type: account.account_type,
    currentBalance: account.current_balance, balanceAsOf: account.balance_as_of,
    lastReconciledAt: account.last_reconciled_at, active: account.is_active,
  };
}

const DEFAULT_CATEGORIES = [
  "Housing", "Utilities", "Insurance", "Transportation", "Food",
  "Entertainment", "Health", "Education", "Savings", "Debt",
  "Shopping", "Rent", "Other",
];

const diagnosticPlatform = (): "web" | "ios" | "android" | "unknown" =>
  Platform.OS === "web" || Platform.OS === "ios" || Platform.OS === "android" ? Platform.OS : "unknown";

function genId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function parseGoalTargetDate(targetDate: string): { year: number; month: number; day: number } | null {
  const datePart = targetDate.split("T")[0];
  const [year, month, day] = datePart.split("-").map(Number);
  if (![year, month, day].every(Number.isFinite) || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month: month - 1, day };
}

function getGoalRemainingAmount(goal: Pick<Goal, "target_amount" | "current_amount">): number {
  const target = Number(goal.target_amount) || 0;
  const saved = Math.max(0, Number(goal.current_amount) || 0);
  return Math.max(0, target - saved);
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
  const activeDebts = bills
    .filter(b => b.is_debt && b.balance > 0.009)
    .sort((a, b) => a.balance - b.balance);
  const closedDebts = bills
    .filter(b => b.is_debt && b.balance <= 0.009)
    .sort((a, b) => a.name.localeCompare(b.name));
  const debtsSorted = [...activeDebts, ...closedDebts];
  const priorityMap = new Map(debtsSorted.map((b, i) => [b.id, i + 1]));
  return bills.map(b => b.is_debt ? { ...b, priority: priorityMap.get(b.id) ?? 1 } : b);
}

function localDateString(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

const markSnowballSourcesPending = (sources: SnowballFundingSource[]) =>
  sources.map(source => ({ ...source, pendingBalanceApply: true }));

const clearSnowballSourcesPending = (sources: SnowballFundingSource[]) =>
  sources.map(({ pendingBalanceApply: _pending, ...source }) => source);

const hasPendingSnowballBalanceApply = (payment: Pick<ExtraPayment, "sources">) =>
  (payment.sources ?? []).some(source => source.pendingBalanceApply);

function normalizeBillRow(bill: any): Bill {
  return {
    ...bill,
    frequency: (bill.frequency ?? "monthly") as "monthly" | "weekly",
    day_of_week: bill.day_of_week ?? 0,
    amount: Number(bill.amount),
    balance: Number(bill.balance),
    interest_rate: Number(bill.interest_rate),
    include_in_snowball: bill.include_in_snowball !== false,
    snowball_minimum_boost: Number(bill.snowball_minimum_boost ?? 0),
  };
}

function demoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(Math.min(day, new Date(year, month + 1, 0).getDate())).padStart(2, "0")}`;
}

function createDemoBudgetData(today = new Date()) {
  const year = today.getFullYear();
  const month = today.getMonth();
  const now = new Date().toISOString();
  const startDate = demoDate(year, month, 1);
  const paidDate = demoDate(year, month, 4);
  const nextMonth = (month + 1) % 12;
  const nextMonthYear = month === 11 ? year + 1 : year;
  const bills: Bill[] = reorderDebtPriorities([
    { id: "demo-rent", name: "Rent", amount: 1200, category: "Housing", priority: 1, is_debt: false, balance: 0, interest_rate: 0, due_day: 1, is_recurring: true, frequency: "monthly", created_at: now, start_date: startDate, last_reviewed_at: now },
    { id: "demo-utilities", name: "Utilities", amount: 370, category: "Utilities", priority: 2, is_debt: false, balance: 0, interest_rate: 0, due_day: 4, is_recurring: true, frequency: "monthly", created_at: now, start_date: startDate, last_reviewed_at: now },
    { id: "demo-groceries", name: "Groceries", amount: 125, category: "Food", priority: 3, is_debt: false, balance: 0, interest_rate: 0, due_day: 1, day_of_week: 5, is_recurring: true, frequency: "weekly", created_at: now, start_date: startDate, last_reviewed_at: now },
    { id: "demo-car-insurance", name: "Car Insurance", amount: 150, category: "Insurance", priority: 4, is_debt: false, balance: 0, interest_rate: 0, due_day: 15, is_recurring: true, frequency: "monthly", created_at: now, start_date: startDate, last_reviewed_at: now },
    { id: "demo-camera", name: "Camera", amount: 38.27, category: "Debt", priority: 1, is_debt: true, balance: 143.64, interest_rate: 0, due_day: 11, is_recurring: true, frequency: "monthly", created_at: now, start_date: startDate, include_in_snowball: true, last_reviewed_at: now },
    { id: "demo-concert", name: "Concert", amount: 35.41, category: "Debt", priority: 2, is_debt: true, balance: 389.44, interest_rate: 0, due_day: 29, is_recurring: true, frequency: "monthly", created_at: now, start_date: startDate, include_in_snowball: true, last_reviewed_at: now },
    { id: "demo-card", name: "Capital One", amount: 29, category: "Debt", priority: 3, is_debt: true, balance: 471, interest_rate: 25, due_day: 15, is_recurring: true, frequency: "monthly", created_at: now, start_date: startDate, include_in_snowball: true, last_reviewed_at: now },
    { id: "demo-auto", name: "Auto Loan", amount: 285, category: "Debt", priority: 4, is_debt: true, balance: 3286, interest_rate: 7.2, due_day: 20, is_recurring: true, frequency: "monthly", created_at: now, start_date: startDate, include_in_snowball: true, last_reviewed_at: now },
  ]);
  const overrides: MonthlyOverride[] = [
    { id: "demo-override-utilities", bill_id: "demo-utilities", month, year, paid_amount: 350, actual_amount: 350, paid_date: paidDate },
  ];
  const incomes: IncomeItem[] = [
    { id: "demo-paycheck", name: "Paycheck", amount: 2308, frequency: "biweekly", start_date: startDate, next_payment_date: demoDate(year, month, 5), amount_history: [], last_reviewed_at: now },
    { id: "demo-side-income", name: "Side income", amount: 400, frequency: "monthly", start_date: startDate, next_payment_date: demoDate(year, month, 20), amount_history: [], last_reviewed_at: now },
  ];
  const transactions: Transaction[] = [
    { id: "demo-coffee", date: demoDate(year, month, Math.min(8, today.getDate())), amount: -6.75, category: "Food", note: "Coffee" },
    { id: "demo-gas", date: demoDate(year, month, Math.min(10, today.getDate())), amount: -42.18, category: "Transportation", note: "Gas" },
    { id: "demo-other-income", date: demoDate(year, month, 18), amount: 75, category: "Other", note: "Marketplace sale" },
  ];
  const goals: Goal[] = [
    { id: "demo-emergency", name: "Emergency Fund", target_amount: 1000, current_amount: 350, target_date: demoDate(nextMonthYear, nextMonth, 15), created_at: now, goal_type: "savings" },
    { id: "demo-christmas", name: "Christmas", target_amount: 2000, current_amount: 0, target_date: `${year}-12-24`, created_at: now, goal_type: "planned_expense", calendar_marker_only: false },
  ];
  const accounts: Account[] = [
    { id: "demo-checking", name: "Demo Checking", account_type: "checking", current_balance: 2496, balance_as_of: localDateString(today), last_reconciled_at: now, is_active: true, created_at: now },
    { id: "demo-savings", name: "Demo Savings", account_type: "savings", current_balance: 650, balance_as_of: localDateString(today), last_reconciled_at: now, is_active: true, created_at: now },
  ];
  const decisions: DecisionRecord[] = [
    {
      id: "demo-decision-vacation", name: "Weekend trip", decision_type: "one_time_purchase",
      scenario: { name: "Weekend trip", type: "one_time_purchase", amount: 450, date: demoDate(nextMonthYear, nextMonth, 10) },
      result: { verdict: "caution", lowestBalance: 610, lowestBalanceDate: demoDate(nextMonthYear, nextMonth, 12), monthlyCashFlowChange: 0, saferAmount: 450, explanation: "This stays above the safety floor but tightens the next pay period.", affectedDates: [demoDate(nextMonthYear, nextMonth, 10)] },
      status: "calendar", calendar_date: demoDate(nextMonthYear, nextMonth, 10), created_at: now,
    },
  ];
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    starting_balance: 2496,
    starting_balance_date: localDateString(today),
    onboarding_completed: true,
  };
  return { bills, overrides, transactions, incomes, goals, extraPayments: [] as ExtraPayment[], categories: DEFAULT_CATEGORIES, accounts, decisions, settings };
}

function normalizeTransactionRow(transaction: any): Transaction {
  return {
    ...transaction,
    amount: Number(transaction.amount),
    debt_applied_amount: Number(transaction.debt_applied_amount ?? 0),
    debt_applied_bill_id: transaction.debt_applied_bill_id ?? undefined,
  };
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
  const demoMode = isDevDemoMode();

  const [bills,         setBills]         = useState<Bill[]>([]);
  const [overrides,     setOverrides]     = useState<MonthlyOverride[]>([]);
  const [transactions,  setTransactions]  = useState<Transaction[]>([]);
  const [incomes,       setIncomes]       = useState<IncomeItem[]>([]);
  const [goals,         setGoals]         = useState<Goal[]>([]);
  const [extraPayments, setExtraPayments] = useState<ExtraPayment[]>([]);
  const [categories,    setCategories]    = useState<string[]>([]);
  const [accounts,      setAccounts]      = useState<Account[]>([]);
  const [decisions,     setDecisions]     = useState<DecisionRecord[]>([]);
  const [settings,      setSettings]      = useState<Settings>(DEFAULT_SETTINGS);
  const [loading,       setLoading]       = useState(true);
  const [selectedYear,  setSelectedYear]  = useState(new Date().getFullYear());
  const [dashboardFilter, setDashboardFilter] = useState<DashboardFilter>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  const loaded = useRef(false);
  const overridesRef = useRef<MonthlyOverride[]>([]);
  const retrySaveRef = useRef<null | (() => Promise<void>)>(null);
  const saveStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { overridesRef.current = overrides; }, [overrides]);

  const markSaveStarted = useCallback(() => {
    if (saveStatusTimerRef.current) clearTimeout(saveStatusTimerRef.current);
    setSaveError(null);
    setSaveStatus("saving");
  }, []);

  const markSaveCompleted = useCallback(() => {
    retrySaveRef.current = null;
    setSaveError(null);
    setSaveStatus("saved");
    if (saveStatusTimerRef.current) clearTimeout(saveStatusTimerRef.current);
    saveStatusTimerRef.current = setTimeout(() => setSaveStatus("idle"), 1400);
  }, []);

  const markSaveFailed = useCallback((error: unknown, retry: () => Promise<void>) => {
    retrySaveRef.current = retry;
    setSaveError(error instanceof Error ? error.message : "Your change could not be saved.");
    setSaveStatus("failed");
    void recordDiagnostic(user?.id, {
      eventType: "save_failure", operation: "amount_save", platform: diagnosticPlatform(),
      errorCode: diagnosticErrorCode(error),
    }).catch(() => undefined);
  }, [user]);

  const retryLastSave = useCallback(async () => {
    const retry = retrySaveRef.current;
    if (!retry) return;
    try {
      await retry();
    } catch {
      // The retried mutation refreshes the failure banner and keeps the latest retry callback.
    }
  }, []);

  const clearSaveError = useCallback(() => {
    retrySaveRef.current = null;
    setSaveError(null);
    setSaveStatus("idle");
  }, []);

  // ── Load from Supabase when user changes ────────────────────────────────────
  useEffect(() => {
    if (demoMode) {
      const demo = createDemoBudgetData();
      setBills(demo.bills);
      setOverrides(demo.overrides);
      overridesRef.current = demo.overrides;
      setTransactions(demo.transactions);
      setIncomes(demo.incomes);
      setGoals(demo.goals);
      setExtraPayments(demo.extraPayments);
      setCategories(demo.categories);
      setAccounts(demo.accounts);
      setDecisions(demo.decisions);
      setSettings(demo.settings);
      loaded.current = true;
      setLoading(false);
      return;
    }
    if (!user) {
      setBills([]); setOverrides([]); setTransactions([]); setIncomes([]);
      setGoals([]); setExtraPayments([]); setCategories([]); setAccounts([]); setDecisions([]); setSettings(DEFAULT_SETTINGS);
      loaded.current = false;
      setLoading(false);
      return;
    }
    loaded.current = false;
    setLoading(true);
    (async () => {
      const loadStarted = Date.now();
      try {
        const uid = user.id;
        const dueDebtSync = await supabase.rpc("sync_due_debt_transactions", { p_as_of_date: localDateString() });
        if (dueDebtSync.error) throw new Error(`Sync scheduled debt payments: ${dueDebtSync.error.message}`);
        const results = await Promise.all([
          supabase.from("bills").select("*").eq("user_id", uid),
          supabase.from("monthly_overrides").select("*").eq("user_id", uid),
          supabase.from("transactions").select("*").eq("user_id", uid),
          supabase.from("incomes").select("*").eq("user_id", uid),
          supabase.from("goals").select("*").eq("user_id", uid),
          supabase.from("extra_payments").select("*").eq("user_id", uid),
          supabase.from("settings").select("*").eq("user_id", uid).maybeSingle(),
          supabase.from("categories").select("name").eq("user_id", uid),
          supabase.from("accounts").select("*").eq("user_id", uid).order("created_at"),
          supabase.from("decisions").select("*").eq("user_id", uid).order("created_at", { ascending: false }),
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
          { data: aData },
          { data: dData },
        ] = results;

        setBills(reorderDebtPriorities((bData ?? []).map(normalizeBillRow)));
        setOverrides((oData ?? []).map((o: any) => ({
          ...o,
          paid_amount:   Number(o.paid_amount),
          custom_amount: o.custom_amount !== null ? Number(o.custom_amount) : undefined,
          custom_due_day: o.custom_due_day !== null ? Number(o.custom_due_day) : undefined,
          actual_amount: o.actual_amount !== null ? Number(o.actual_amount) : undefined,
          paid_date: o.paid_date ?? undefined,
        })));
        setTransactions((tData ?? []).map(normalizeTransactionRow));
        setIncomes((iData ?? []).map((i: any) => ({
          ...i,
          amount:         Number(i.amount),
          amount_history: i.amount_history ?? [],
        })));
        setGoals((gData ?? []).map((g: any) => ({
          ...g,
          target_amount:  Number(g.target_amount),
          current_amount: Number(g.current_amount),
          goal_type: g.goal_type ?? (Number(g.current_amount) < 0 ? "planned_expense" : "savings"),
        })));
        setExtraPayments((epData ?? []).map((ep: any) => ({
          ...ep,
          amount:      Number(ep.amount),
          allocations: ep.allocations ?? [],
          payment_date: ep.payment_date ?? undefined,
          sources: ep.sources ?? [{ type: "manual", amount: Number(ep.amount) }],
        })));
        setAccounts((aData ?? []).filter((a: any) => a.account_type !== "credit_card").map((a: any) => ({
          ...a,
          current_balance: Number(a.current_balance),
          last_reconciled_at: a.last_reconciled_at ?? undefined,
          is_active: a.is_active !== false,
        })));
        setDecisions((dData ?? []).map((d: any) => ({ ...d, calendar_date: d.calendar_date ?? undefined, applied_change: d.applied_change ?? undefined })));
        if (sData) {
          setSettings({
            paymentMethod:        sData.payment_method as Settings["paymentMethod"],
            starting_balance:     Number(sData.starting_balance),
            starting_balance_date: sData.starting_balance_date ?? undefined,
            safety_floor:         Number(sData.safety_floor ?? 200),
            forecast_horizon_months: Math.min(24, Math.max(1, Number(sData.forecast_horizon_months ?? 6))),
            onboarding_completed: Boolean(sData.onboarding_completed),
          });
        }
        const cats = (cData ?? []).map((c: any) => c.name as string);
        setCategories(cats.length > 0 ? cats : DEFAULT_CATEGORIES);
      } finally {
        loaded.current = true;
        setLoading(false);
        void recordDiagnostic(user.id, {
          eventType: "performance", operation: "data_load", platform: diagnosticPlatform(),
          durationMs: Date.now() - loadStarted,
        }).catch(() => undefined);
      }
    })();
  }, [user]);

  // ─── Bills ────────────────────────────────────────────────────────────────────

  const addBill = useCallback(async (bill: Omit<Bill, "id" | "created_at">) => {
    if (!user) throw new Error("Sign in to add a bill");
    const nb: Bill = { ...bill, id: genId(), created_at: new Date().toISOString() };
    if (demoMode) {
      setBills(prev => reorderDebtPriorities([...prev, nb]));
      return nb.id;
    }
    await ensureSaved(supabase.from("bills").insert({ ...nb, user_id: user.id }), "Add bill");
    setBills(prev => reorderDebtPriorities([...prev, nb]));
    return nb.id;
  }, [user, demoMode]);

  const updateBill = useCallback(async (bill: Bill) => {
    if (!user) return;
    const existing = bills.find(b => b.id === bill.id);
    if (!existing) return;
    const previousOverrides = overridesRef.current;
    const reviewedBill = { ...bill, last_reviewed_at: new Date().toISOString() };
    setBills(prev => reorderDebtPriorities(prev.map(item => item.id === bill.id ? reviewedBill : item)));
    if (demoMode) return;
    markSaveStarted();
    try {
    if (existing.amount !== bill.amount) {
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
        const optimisticOverrides = overridesRef.current.map(o => {
            const changed = nextOverrides.find(n => n.id === o.id);
            return changed && changedIds.has(o.id) ? changed : o;
          });
        overridesRef.current = optimisticOverrides;
        setOverrides(optimisticOverrides);
      }
      const results = await Promise.all(dbUpdates);
      const failed = results.find(result => result?.error);
      if (failed?.error) throw new Error(`Update monthly bill: ${failed.error.message}`);
    }
      await ensureSaved(supabase.from("bills").update({ ...reviewedBill }).eq("id", bill.id).eq("user_id", user.id), "Update bill");
      if (bill.is_debt && (existing.balance !== bill.balance || existing.amount !== bill.amount || existing.include_in_snowball !== bill.include_in_snowball)) {
        const rollover = await supabase.rpc("recalculate_debt_minimum_boosts");
        if (rollover.error) throw new Error(`Roll debt minimum: ${rollover.error.message}`);
        const refreshed = await supabase.from("bills").select("*").eq("user_id", user.id);
        if (refreshed.error) throw new Error(`Refresh debts: ${refreshed.error.message}`);
        setBills(reorderDebtPriorities((refreshed.data ?? []).map(normalizeBillRow)));
      }
    markSaveCompleted();
    } catch (error) {
      setBills(prev => reorderDebtPriorities(prev.map(item => {
        const stillFailedEdit = item.id === existing.id && Object.entries(bill).every(([key, value]) => item[key as keyof Bill] === value);
        return stillFailedEdit ? existing : item;
      })));
      overridesRef.current = previousOverrides;
      setOverrides(previousOverrides);
      markSaveFailed(error, () => updateBill(bill));
      throw error;
    }
  }, [user, bills, demoMode, markSaveStarted, markSaveCompleted, markSaveFailed]);

  const deleteBill = useCallback(async (id: string) => {
    if (!user) return;
    const deletedBill = bills.find(bill => bill.id === id);
    if (demoMode) {
      setBills(prev => reorderDebtPriorities(prev.filter(b => b.id !== id)));
      setOverrides(prev => prev.filter(o => o.bill_id !== id));
      return;
    }
    const results = await Promise.all([
      supabase.from("bills").delete().eq("id", id).eq("user_id", user.id),
      supabase.from("monthly_overrides").delete().eq("bill_id", id).eq("user_id", user.id),
    ]);
    const failed = results.find(result => result.error);
    if (failed?.error) throw new Error(`Delete bill: ${failed.error.message}`);
    setBills(prev => reorderDebtPriorities(prev.filter(b => b.id !== id)));
    setOverrides(prev => prev.filter(o => o.bill_id !== id));
    if (deletedBill?.is_debt) {
      const rollover = await supabase.rpc("recalculate_debt_minimum_boosts");
      if (rollover.error) throw new Error(`Recalculate debt minimum: ${rollover.error.message}`);
      const refreshed = await supabase.from("bills").select("*").eq("user_id", user.id);
      if (refreshed.error) throw new Error(`Refresh debts: ${refreshed.error.message}`);
      setBills(reorderDebtPriorities((refreshed.data ?? []).map(normalizeBillRow)));
    }
  }, [user, bills, demoMode]);

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
      const base = o?.custom_amount !== undefined ? o.custom_amount : bill.amount;
      return bill.is_debt ? effectiveDebtMinimum(base, Number(bill.snowball_minimum_boost ?? 0)) : base;
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
      const updated: MonthlyOverride = existing
        ? { ...existing, ...patch }
        : { id: genId(), bill_id: billId, month, year, paid_amount: 0, ...patch };
      const optimisticOverrides = existing
        ? overridesRef.current.map(o => o.id === existing.id ? updated : o)
        : [...overridesRef.current, updated];

      overridesRef.current = optimisticOverrides;
      setOverrides(optimisticOverrides);
      if (demoMode) return;
      const saveStarted = Date.now();
      markSaveStarted();

      try {
        if (existing) {
          await ensureSaved(
            supabase.from("monthly_overrides").update({ ...updated }).eq("id", existing.id).eq("user_id", user.id),
            "Update monthly bill"
          );
        } else {
          await ensureSaved(supabase.from("monthly_overrides").insert({ ...updated, user_id: user.id }), "Create monthly bill");
        }
        markSaveCompleted();
        void recordDiagnostic(user.id, {
          eventType: "performance", operation: "amount_save", platform: diagnosticPlatform(),
          durationMs: Date.now() - saveStarted,
        }).catch(() => undefined);
      } catch (error) {
        const current = overridesRef.current.find(o => o.id === updated.id);
        const isStillThisEdit = current && Object.entries(patch).every(
          ([key, value]) => current[key as keyof MonthlyOverride] === value
        );
        if (isStillThisEdit) {
          const rolledBack = existing
            ? overridesRef.current.map(o => o.id === existing.id ? existing : o)
            : overridesRef.current.filter(o => o.id !== updated.id);
          overridesRef.current = rolledBack;
          setOverrides(rolledBack);
        }
        markSaveFailed(error, () => upsertOverride(billId, month, year, patch));
        throw error;
      }
    },
    [user, demoMode, markSaveStarted, markSaveCompleted, markSaveFailed]
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
          if (demoMode) {
            setBills(prev => reorderDebtPriorities(
              prev.map(b => b.id === billId ? { ...b, balance: nextBalance } : b)
            ));
            return;
          }
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
    [upsertOverride, bills, user, demoMode]
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

  const getBillEffectiveMonthlyTotal = useCallback((bill: Bill, month: number, year: number): number => {
    const override = overrides.find(o => o.bill_id === bill.id && o.month === month && o.year === year);
    return override?.actual_amount !== undefined
      ? Math.max(0, override.actual_amount)
      : getBillMonthlyTotal(bill, month, year);
  }, [overrides, getBillMonthlyTotal]);

  const getMonthlyBills = useCallback(
    (month: number, year: number): Bill[] =>
      bills.filter(b => (b.is_recurring || b.is_debt) && isBillActiveForMonth(b, month, year)),
    [bills]
  );

  // ─── Snowball / Avalanche ─────────────────────────────────────────────────────

  const runSnowball = useCallback(
    (month: number, year: number, extraAmount: number): SnowballAllocation[] => {
      const debts = bills.filter(b => b.is_debt && b.balance > 0).map(b => ({
        id: b.id, name: b.name, balance: b.balance, minimum: getBillMonthlyTotal(b, month, year),
        apr: b.interest_rate, dueDay: b.due_day, included: b.include_in_snowball !== false,
      }));
      const target = orderDebts(debts.filter(d => d.included), settings.paymentMethod)[0];
      const today = new Date();
      const requestedDay = target?.dueDay ?? 1;
      const day = today.getFullYear() === year && today.getMonth() === month && requestedDay < today.getDate()
        ? today.getDate()
        : requestedDay;
      const paymentDate = `${year}-${String(month + 1).padStart(2, "0")}-${String(Math.min(new Date(year, month + 1, 0).getDate(), day)).padStart(2, "0")}`;
      return allocateSnowballExtra(debts, extraAmount, settings.paymentMethod, paymentDate).allocations;
    },
    [bills, settings.paymentMethod, getBillMonthlyTotal]
  );

  const saveExtraPayment = useCallback(async (month: number, year: number, amount: number, allocations: SnowballAllocation[], paymentDate?: string, sources: SnowballFundingSource[] = [{ type: "manual", amount }]) => {
    if (!user) return;
    const existing = extraPayments.find(ep => ep.month === month && ep.year === year);
    const payload = { amount, allocations, payment_date: paymentDate, sources };
    if (demoMode) {
      if (existing) {
        setExtraPayments(prev => prev.map(ep => ep.id === existing.id ? { ...ep, ...payload } : ep));
      } else {
        setExtraPayments(prev => [...prev, { id: genId(), month, year, ...payload }]);
      }
      return;
    }
    if (existing) {
      await ensureSaved(
        supabase.from("extra_payments").update(payload).eq("id", existing.id).eq("user_id", user.id),
        "Update extra payment"
      );
      setExtraPayments(prev => prev.map(ep => ep.id === existing.id ? { ...ep, ...payload } : ep));
    } else {
      const next: ExtraPayment = { id: genId(), month, year, ...payload };
      await ensureSaved(supabase.from("extra_payments").insert({ ...next, user_id: user.id }), "Add extra payment");
      setExtraPayments(prev => [...prev, next]);
    }
  }, [user, extraPayments, demoMode]);

  const getExtraPayment = useCallback(
    (month: number, year: number) => extraPayments.find(ep => ep.month === month && ep.year === year),
    [extraPayments]
  );

  const deleteExtraPayment = useCallback(async (id: string) => {
    if (!user) return;
    if (demoMode) {
      setExtraPayments(prev => prev.filter(ep => ep.id !== id));
      return;
    }
    await ensureSaved(supabase.from("extra_payments").delete().eq("id", id).eq("user_id", user.id), "Delete extra payment");
    setExtraPayments(prev => prev.filter(ep => ep.id !== id));
  }, [user, demoMode]);

  const applyDebtSnowballPayment = useCallback(async (
    preview: SnowballProjectionResult,
    sources: SnowballFundingSource[] = [{ type: "manual", amount: preview.selectedExtra }],
  ) => {
    if (!user) return;
    const [year, monthNumber] = preview.paymentDate.split("-").map(Number);
    const month = monthNumber - 1;
    const existing = extraPayments.find(ep => ep.month === month && ep.year === year);
    const paymentId = existing?.id ?? genId();
    const isFuturePayment = preview.paymentDate > localDateString();
    const payloadSources = isFuturePayment
      ? markSnowballSourcesPending(sources)
      : clearSnowballSourcesPending(sources);

    if (demoMode) {
      const nextPayment: ExtraPayment = {
        id: paymentId, month, year,
        amount: preview.selectedExtra, allocations: preview.allocations,
        payment_date: preview.paymentDate, sources: payloadSources,
      };
      setExtraPayments(prev => existing
        ? prev.map(ep => ep.id === existing.id ? nextPayment : ep)
        : [...prev, nextPayment]);
      if (!isFuturePayment) {
        setBills(prev => reorderDebtPriorities(prev.map(bill => {
          const allocation = preview.allocations.find(item => item.billId === bill.id);
          return allocation ? { ...bill, balance: Math.max(0, bill.balance - allocation.payment) } : bill;
        })));
        setOverrides(prev => {
          const next = [...prev];
          preview.allocations.forEach(allocation => {
            const existingOverride = next.find(o => o.bill_id === allocation.billId && o.month === month && o.year === year);
            if (existingOverride) existingOverride.paid_amount = Math.max(0, existingOverride.paid_amount + allocation.payment);
            else next.push({ id: genId(), bill_id: allocation.billId, month, year, paid_amount: allocation.payment });
          });
          overridesRef.current = next;
          return next;
        });
      }
      return;
    }

    if (isFuturePayment) {
      await saveExtraPayment(month, year, preview.selectedExtra, preview.allocations, preview.paymentDate, payloadSources);
      return;
    }

    const { data: savedPaymentId, error } = await supabase.rpc("apply_debt_snowball_payment", {
      p_payment_id: paymentId,
      p_month: month,
      p_year: year,
      p_amount: preview.selectedExtra,
      p_payment_date: preview.paymentDate,
      p_allocations: preview.allocations,
      p_sources: payloadSources,
    });
    if (error) throw new Error(`Apply debt snowball: ${error.message}`);
    const rollover = await supabase.rpc("recalculate_debt_minimum_boosts");
    if (rollover.error) throw new Error(`Roll debt minimum: ${rollover.error.message}`);

    const [overrideResult, billsResult] = await Promise.all([
      supabase.from("monthly_overrides").select("*").eq("user_id", user.id).eq("month", month).eq("year", year),
      supabase.from("bills").select("*").eq("user_id", user.id),
    ]);
    if (overrideResult.error) throw new Error(`Refresh monthly bills: ${overrideResult.error.message}`);
    if (billsResult.error) throw new Error(`Refresh debts: ${billsResult.error.message}`);
    const refreshedOverrides = (overrideResult.data ?? []).map((o: any) => ({
      ...o,
      paid_amount: Number(o.paid_amount),
      custom_amount: o.custom_amount !== null ? Number(o.custom_amount) : undefined,
      custom_due_day: o.custom_due_day !== null ? Number(o.custom_due_day) : undefined,
      actual_amount: o.actual_amount !== null ? Number(o.actual_amount) : undefined,
      paid_date: o.paid_date ?? undefined,
    }));

    setBills(reorderDebtPriorities((billsResult.data ?? []).map(normalizeBillRow)));
    setOverrides(prev => [...prev.filter(o => o.month !== month || o.year !== year), ...refreshedOverrides]);
    const nextPayment: ExtraPayment = {
      id: String(savedPaymentId ?? paymentId), month, year,
      amount: preview.selectedExtra, allocations: preview.allocations,
      payment_date: preview.paymentDate, sources: payloadSources,
    };
    setExtraPayments(prev => existing
      ? prev.map(ep => ep.id === existing.id ? nextPayment : ep)
      : [...prev, nextPayment]);
  }, [user, extraPayments, saveExtraPayment, demoMode]);

  const removeDebtSnowballPayment = useCallback(async (month: number, year: number) => {
    const existing = extraPayments.find(ep => ep.month === month && ep.year === year);
    if (!existing || !user) return;
    if (demoMode) {
      const pending = hasPendingSnowballBalanceApply(existing) && (existing.payment_date ?? "") > localDateString();
      setExtraPayments(prev => prev.filter(ep => ep.id !== existing.id));
      if (!pending) {
        setBills(prev => reorderDebtPriorities(prev.map(bill => {
          const allocation = existing.allocations.find(item => item.billId === bill.id);
          return allocation ? { ...bill, balance: bill.balance + allocation.payment } : bill;
        })));
        setOverrides(prev => {
          const next = prev.map(override => {
            const allocation = existing.allocations.find(item => item.billId === override.bill_id && override.month === month && override.year === year);
            return allocation ? { ...override, paid_amount: Math.max(0, override.paid_amount - allocation.payment) } : override;
          });
          overridesRef.current = next;
          return next;
        });
      }
      return;
    }
    if (hasPendingSnowballBalanceApply(existing) && (existing.payment_date ?? "") > localDateString()) {
      await deleteExtraPayment(existing.id);
      return;
    }
    const { error } = await supabase.rpc("remove_debt_snowball_payment", { p_month: month, p_year: year });
    if (error) throw new Error(`Remove debt snowball: ${error.message}`);
    const rollover = await supabase.rpc("recalculate_debt_minimum_boosts");
    if (rollover.error) throw new Error(`Restore debt minimum: ${rollover.error.message}`);
    const [overrideResult, billsResult] = await Promise.all([
      supabase.from("monthly_overrides").select("*").eq("user_id", user.id).eq("month", month).eq("year", year),
      supabase.from("bills").select("*").eq("user_id", user.id),
    ]);
    if (overrideResult.error) throw new Error(`Refresh monthly bills: ${overrideResult.error.message}`);
    if (billsResult.error) throw new Error(`Refresh debts: ${billsResult.error.message}`);
    const refreshedOverrides = (overrideResult.data ?? []).map((o: any) => ({
      ...o,
      paid_amount: Number(o.paid_amount),
      custom_amount: o.custom_amount !== null ? Number(o.custom_amount) : undefined,
      custom_due_day: o.custom_due_day !== null ? Number(o.custom_due_day) : undefined,
      actual_amount: o.actual_amount !== null ? Number(o.actual_amount) : undefined,
      paid_date: o.paid_date ?? undefined,
    }));
    setBills(reorderDebtPriorities((billsResult.data ?? []).map(normalizeBillRow)));
    setOverrides(prev => [...prev.filter(o => o.month !== month || o.year !== year), ...refreshedOverrides]);
    setExtraPayments(prev => prev.filter(ep => ep.id !== existing.id));
  }, [user, extraPayments, deleteExtraPayment, demoMode]);

  const syncingDueSnowballPayments = useRef(new Set<string>());
  useEffect(() => {
    if (!user || demoMode) return;
    const today = localDateString();
    const duePayments = extraPayments.filter(payment =>
      hasPendingSnowballBalanceApply(payment) &&
      (payment.payment_date ?? "") <= today &&
      payment.allocations.length > 0 &&
      !syncingDueSnowballPayments.current.has(payment.id)
    );
    duePayments.forEach(payment => {
      syncingDueSnowballPayments.current.add(payment.id);
      const preview: SnowballProjectionResult = {
        safeMaximum: payment.amount,
        selectedExtra: payment.amount,
        paymentDate: payment.payment_date ?? `${payment.year}-${String(payment.month + 1).padStart(2, "0")}-01`,
        allocations: payment.allocations.map(allocation => ({
          ...allocation,
          paymentDate: allocation.paymentDate ?? payment.payment_date ?? `${payment.year}-${String(payment.month + 1).padStart(2, "0")}-01`,
        })),
        months: [],
        payoffOrder: [],
        debtFreeDate: null,
        lowestSixMonthBalance: 0,
      };
      void applyDebtSnowballPayment(preview, clearSnowballSourcesPending(payment.sources ?? [{ type: "manual", amount: payment.amount }]))
        .finally(() => syncingDueSnowballPayments.current.delete(payment.id));
    });
  }, [user, extraPayments, applyDebtSnowballPayment, demoMode]);

  const repairingFutureSnowballPayments = useRef(new Set<string>());
  useEffect(() => {
    if (!user || demoMode) return;
    const today = localDateString();
    const futureAppliedPayments = extraPayments.filter(payment =>
      !hasPendingSnowballBalanceApply(payment) &&
      (payment.payment_date ?? "") > today &&
      payment.allocations.length > 0 &&
      !repairingFutureSnowballPayments.current.has(payment.id)
    );
    futureAppliedPayments.forEach(payment => {
      repairingFutureSnowballPayments.current.add(payment.id);
      void (async () => {
        for (const allocation of payment.allocations) {
          const bill = bills.find(item => item.id === allocation.billId);
          if (!bill?.is_debt) continue;
          const nextBalance = Math.max(0, bill.balance + allocation.payment);
          await ensureSaved(
            supabase.from("bills").update({ balance: nextBalance }).eq("id", allocation.billId).eq("user_id", user.id),
            "Defer future snowball balance"
          );
          const override = overrides.find(item => item.bill_id === allocation.billId && item.month === payment.month && item.year === payment.year);
          if (override) {
            await ensureSaved(
              supabase.from("monthly_overrides")
                .update({ paid_amount: Math.max(0, override.paid_amount - allocation.payment) })
                .eq("id", override.id)
                .eq("user_id", user.id),
              "Defer future snowball paid amount"
            );
          }
        }
        await saveExtraPayment(
          payment.month,
          payment.year,
          payment.amount,
          payment.allocations,
          payment.payment_date,
          markSnowballSourcesPending(payment.sources ?? [{ type: "manual", amount: payment.amount }]),
        );
        const [billRows, overrideRows] = await Promise.all([
          supabase.from("bills").select("*").eq("user_id", user.id),
          supabase.from("monthly_overrides").select("*").eq("user_id", user.id).eq("month", payment.month).eq("year", payment.year),
        ]);
        if (billRows.error) throw new Error(`Refresh deferred debts: ${billRows.error.message}`);
        if (overrideRows.error) throw new Error(`Refresh deferred overrides: ${overrideRows.error.message}`);
        setBills(reorderDebtPriorities((billRows.data ?? []).map(normalizeBillRow)));
        setOverrides(prev => [
          ...prev.filter(item => item.month !== payment.month || item.year !== payment.year),
          ...(overrideRows.data ?? []).map((o: any) => ({
            ...o,
            paid_amount: Number(o.paid_amount),
            custom_amount: o.custom_amount !== null ? Number(o.custom_amount) : undefined,
            custom_due_day: o.custom_due_day !== null ? Number(o.custom_due_day) : undefined,
            actual_amount: o.actual_amount !== null ? Number(o.actual_amount) : undefined,
            paid_date: o.paid_date ?? undefined,
          })),
        ]);
      })()
        .catch(error => markSaveFailed(error, async () => undefined))
        .finally(() => repairingFutureSnowballPayments.current.delete(payment.id));
    });
  }, [user, extraPayments, bills, overrides, saveExtraPayment, markSaveFailed, demoMode]);

  const finalizeBillPayment = useCallback(async (billId: string, month: number, year: number, actualAmount: number, paidDate: string) => {
    const bill = bills.find(b => b.id === billId);
    if (!bill) throw new Error("Bill not found");
    const budgeted = getBillMonthlyTotal(bill, month, year);
    const actual = Math.max(0, Number(actualAmount) || 0);
    await upsertOverride(billId, month, year, { actual_amount: actual, paid_amount: actual, paid_date: paidDate });
    return { budgeted, actual, surplus: Math.max(0, budgeted - actual) };
  }, [bills, getBillMonthlyTotal, upsertOverride]);

  // ─── Transactions ─────────────────────────────────────────────────────────────

  const syncDebtTransactionsAndRefresh = useCallback(async () => {
    if (!user || demoMode) return;
    const synced = await supabase.rpc("sync_due_debt_transactions", { p_as_of_date: localDateString() });
    if (synced.error) throw new Error(`Sync scheduled debt payments: ${synced.error.message}`);
    const [billRows, transactionRows] = await Promise.all([
      supabase.from("bills").select("*").eq("user_id", user.id),
      supabase.from("transactions").select("*").eq("user_id", user.id),
    ]);
    if (billRows.error) throw new Error(`Refresh debts: ${billRows.error.message}`);
    if (transactionRows.error) throw new Error(`Refresh transactions: ${transactionRows.error.message}`);
    setBills(reorderDebtPriorities((billRows.data ?? []).map(normalizeBillRow)));
    setTransactions((transactionRows.data ?? []).map(normalizeTransactionRow));
  }, [user, demoMode]);

  useEffect(() => {
    if (!user || demoMode) return;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const now = new Date();
      const nextDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
      timer = setTimeout(() => {
        void syncDebtTransactionsAndRefresh().finally(schedule);
      }, nextDay.getTime() - now.getTime());
    };
    schedule();
    return () => clearTimeout(timer);
  }, [user, syncDebtTransactionsAndRefresh, demoMode]);

  const addTransaction = useCallback(async (tx: Omit<Transaction, "id">) => {
    if (!user) throw new Error("Sign in to add a transaction");
    const nt: Transaction = { ...tx, id: genId() };
    if (demoMode) {
      setTransactions(prev => [...prev, nt]);
      return nt.id;
    }
    await ensureSaved(supabase.from("transactions").insert({ ...nt, user_id: user.id }), "Add transaction");
    setTransactions(prev => [...prev, nt]);
    if (nt.linked_bill_id) await syncDebtTransactionsAndRefresh();
    return nt.id;
  }, [user, syncDebtTransactionsAndRefresh, demoMode]);

  const updateTransaction = useCallback(async (tx: Transaction) => {
    if (!user) return;
    const existing = transactions.find(item => item.id === tx.id);
    setTransactions(prev => prev.map(t => t.id === tx.id ? tx : t));
    if (demoMode) return;
    markSaveStarted();
    try {
      await ensureSaved(supabase.from("transactions").update({ ...tx }).eq("id", tx.id).eq("user_id", user.id), "Update transaction");
      if (tx.linked_bill_id || existing?.linked_bill_id || existing?.debt_applied_bill_id) await syncDebtTransactionsAndRefresh();
      markSaveCompleted();
    } catch (error) {
      if (existing) setTransactions(prev => prev.map(item => item.id === existing.id && item === tx ? existing : item));
      markSaveFailed(error, () => updateTransaction(tx));
      throw error;
    }
  }, [user, transactions, syncDebtTransactionsAndRefresh, demoMode, markSaveStarted, markSaveCompleted, markSaveFailed]);

  const deleteTransaction = useCallback(async (id: string) => {
    if (!user) return;
    if (demoMode) {
      setTransactions(prev => prev.filter(t => t.id !== id));
      return;
    }
    await ensureSaved(supabase.from("transactions").delete().eq("id", id).eq("user_id", user.id), "Delete transaction");
    setTransactions(prev => prev.filter(t => t.id !== id));
    if (transactions.find(transaction => transaction.id === id)?.debt_applied_bill_id) await syncDebtTransactionsAndRefresh();
  }, [user, transactions, syncDebtTransactionsAndRefresh, demoMode]);

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
    if (!user) throw new Error("Sign in to add income");
    const ni: IncomeItem = { ...item, id: genId() };
    if (demoMode) {
      setIncomes(prev => [...prev, ni]);
      return ni.id;
    }
    await ensureSaved(supabase.from("incomes").insert({ ...ni, amount_history: ni.amount_history ?? [], user_id: user.id }), "Add income");
    setIncomes(prev => [...prev, ni]);
    return ni.id;
  }, [user, demoMode]);

  const updateIncome = useCallback(async (item: IncomeItem) => {
    if (!user) return;
    const existing = incomes.find(income => income.id === item.id);
    const reviewedItem = { ...item, last_reviewed_at: new Date().toISOString() };
    setIncomes(prev => prev.map(i => i.id === item.id ? reviewedItem : i));
    if (demoMode) return;
    markSaveStarted();
    try {
      await ensureSaved(supabase.from("incomes").update({ ...reviewedItem, amount_history: item.amount_history ?? [] }).eq("id", item.id).eq("user_id", user.id), "Update income");
      markSaveCompleted();
    } catch (error) {
      if (existing) setIncomes(prev => prev.map(income => income.id === existing.id && income === item ? existing : income));
      markSaveFailed(error, () => updateIncome(item));
      throw error;
    }
  }, [user, incomes, demoMode, markSaveStarted, markSaveCompleted, markSaveFailed]);

  const deleteIncome = useCallback(async (id: string) => {
    if (!user) return;
    if (demoMode) {
      setIncomes(prev => prev.filter(i => i.id !== id));
      return;
    }
    await ensureSaved(supabase.from("incomes").delete().eq("id", id).eq("user_id", user.id), "Delete income");
    setIncomes(prev => prev.filter(i => i.id !== id));
  }, [user, demoMode]);

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
    if (demoMode) {
      setGoals(prev => [...prev, ng]);
      return;
    }
    await ensureSaved(supabase.from("goals").insert({ ...ng, user_id: user.id }), "Add goal");
    setGoals(prev => [...prev, ng]);
  }, [user, demoMode]);

  const updateGoal = useCallback(async (goal: Goal) => {
    if (!user) return;
    const existing = goals.find(item => item.id === goal.id);
    setGoals(prev => prev.map(g => g.id === goal.id ? goal : g));
    if (demoMode) return;
    markSaveStarted();
    try {
      await ensureSaved(supabase.from("goals").update({ ...goal }).eq("id", goal.id).eq("user_id", user.id), "Update goal");
      markSaveCompleted();
    } catch (error) {
      if (existing) setGoals(prev => prev.map(item => item.id === existing.id && item === goal ? existing : item));
      markSaveFailed(error, () => updateGoal(goal));
      throw error;
    }
  }, [user, goals, demoMode, markSaveStarted, markSaveCompleted, markSaveFailed]);

  const deleteGoal = useCallback(async (id: string) => {
    if (!user) return;
    if (demoMode) {
      setGoals(prev => prev.filter(g => g.id !== id));
      return;
    }
    await ensureSaved(supabase.from("goals").delete().eq("id", id).eq("user_id", user.id), "Delete goal");
    setGoals(prev => prev.filter(g => g.id !== id));
  }, [user, demoMode]);

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
          const needed = getGoalRemainingAmount(goal);
          return { projectedBalance: 0, canAfford: needed === 0, shortfall: needed };
        }
      } else {
        const now = new Date();
        anchorM = now.getMonth() - 1; anchorY = now.getFullYear();
        if (anchorM < 0) { anchorM = 11; anchorY -= 1; }
        seed = settings.starting_balance;
        if (year < anchorY || (year === anchorY && month < anchorM)) {
          const needed = getGoalRemainingAmount(goal);
          const available = seed - settings.safety_floor;
          return { projectedBalance: seed, canAfford: available >= needed, shortfall: Math.max(0, needed - available) };
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
      const needed = getGoalRemainingAmount(goal);
      const available = projectedBalance - settings.safety_floor;
      const canAfford = available >= needed;
      return { projectedBalance, canAfford, shortfall: canAfford ? 0 : needed - available };
    },
    [bills, incomes, transactions, overrides, settings]
  );

  // ─── Cash Flow ────────────────────────────────────────────────────────────────

  const getCashFlow = useCallback((month: number, year: number): CashFlow => {
    const monthlyIncome = incomes
      .filter(i => isIncomeActiveForMonth(i, month, year))
      .reduce((s, i) => s + getIncomeOccurrenceDays(i, month, year).length * getEffectiveIncomeAmount(i, month, year), 0);
    const activeBills = bills.filter(b => (b.is_recurring || b.is_debt) && isBillActiveForMonth(b, month, year));
    const totalBillsDue = activeBills.reduce((s, b) => s + getBillEffectiveMonthlyTotal(b, month, year), 0);
    const totalPaid = activeBills.reduce((s, b) =>
      s + (overrides.find(o => o.bill_id === b.id && o.month === month && o.year === year)?.paid_amount ?? 0), 0);
    const monthTxs = transactions.filter(t => { const [ty, tm] = t.date.split("-").map(Number); return ty === year && tm === month + 1; });
    const netTransactions = monthTxs.reduce((s, t) => s + t.amount, 0);
    const snowballExtra = extraPayments.find(ep => ep.month === month && ep.year === year)?.amount ?? 0;
    const monthPrefix = `${year}-${String(month + 1).padStart(2, "0")}`;
    const monthEnd = `${monthPrefix}-${String(new Date(year, month + 1, 0).getDate()).padStart(2, "0")}`;
    const plannedDecisionNet = decisions
      .filter(d => d.status === "planned" || d.status === "calendar")
      .reduce((sum, d) => {
        const occurrences = scenarioDates(d.scenario, monthEnd).filter(date => date.startsWith(monthPrefix)).length;
        const signedAmount = d.scenario.type === "income_change" ? Math.abs(d.scenario.amount) : -Math.abs(d.scenario.amount);
        return sum + occurrences * signedAmount;
      }, 0);
    return { monthlyIncome, totalBillsDue, totalPaid, netTransactions, goalAllocations: 0, remaining: monthlyIncome - totalBillsDue - snowballExtra + netTransactions + plannedDecisionNet };
  }, [bills, incomes, transactions, overrides, extraPayments, decisions, getBillEffectiveMonthlyTotal]);

  // ─── Daily Balances ───────────────────────────────────────────────────────────

  const balanceComputationCache = useMemo(() => ({
    monthNet: new Map<string, number>(),
    carryover: new Map<string, number>(),
    daily: new Map<string, DailyBalance[]>(),
  }), [bills, transactions, incomes, goals, decisions, overrides, extraPayments, getBillEffectiveMonthlyTotal, settings.starting_balance, settings.starting_balance_date]);

  const getDailyBalances = useCallback((month: number, year: number): DailyBalance[] => {
    const dailyKey = `${year}-${month}`;
    const cachedDaily = balanceComputationCache.daily.get(dailyKey);
    if (cachedDaily) return cachedDaily;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const computeMonthNet = (m: number, y: number): number => {
      const key = `${y}-${m}`;
      const cached = balanceComputationCache.monthNet.get(key);
      if (cached !== undefined) return cached;
      const monthPrefix = `${y}-${String(m + 1).padStart(2, "0")}`;
      const reconciliationDate = settings.starting_balance_date;
      const includeDate = (date: string) => !reconciliationDate || !date.startsWith(monthPrefix) || date > reconciliationDate;
      const inc = incomes.reduce((sum, income) => {
        const amount = getEffectiveIncomeAmount(income, m, y);
        const count = getIncomeOccurrenceDays(income, m, y)
          .filter(day => includeDate(`${monthPrefix}-${String(day).padStart(2, "0")}`)).length;
        return sum + count * amount;
      }, 0);
      const bil = bills.filter(b => b.is_recurring || b.is_debt).reduce((s, b) => {
        const occ = getBillOccurrenceDays(b, m, y);
        if (occ.length === 0) return s;
        const override = overrides.find(item => item.bill_id === b.id && item.month === m && item.year === y);
        const dates = override?.actual_amount !== undefined && override.paid_date
          ? [override.paid_date]
          : occ.map(day => `${monthPrefix}-${String(day).padStart(2, "0")}`);
        const amountPerOccurrence = getBillEffectiveMonthlyTotal(b, m, y) / dates.length;
        return s + dates.filter(includeDate).length * amountPerOccurrence;
      }, 0);
      const tx = transactions
        .filter(t => t.date.startsWith(monthPrefix) && includeDate(t.date))
        .reduce((s, t) => s + t.amount, 0);
      const goalDeductions = goals.reduce((s, g) => {
        if (g.goal_type !== "planned_expense") return s;
        if (!g.target_date) return s;
        const targetDate = parseGoalTargetDate(g.target_date);
        const date = targetDate ? `${targetDate.year}-${String(targetDate.month + 1).padStart(2, "0")}-${String(targetDate.day).padStart(2, "0")}` : "";
        if (targetDate?.year === y && targetDate.month === m && includeDate(date)) return s + getGoalRemainingAmount(g);
        return s;
      }, 0);
      const monthlyExtra = extraPayments.find(ep => ep.month === m && ep.year === y);
      const snowball = monthlyExtra && includeDate(monthlyExtra.payment_date ?? `${monthPrefix}-01`) ? monthlyExtra.amount : 0;
      const monthEnd = `${y}-${String(m + 1).padStart(2, "0")}-${String(new Date(y, m + 1, 0).getDate()).padStart(2, "0")}`;
      const decisionNet = decisions.filter(d => d.status === "planned" || d.status === "calendar").reduce((sum, d) => {
        const count = scenarioDates(d.scenario, monthEnd).filter(date => date.startsWith(monthPrefix) && includeDate(date)).length;
        const signed = d.scenario.type === "income_change" ? d.scenario.amount : -Math.abs(d.scenario.amount);
        return sum + count * signed;
      }, 0);
      const net = inc + tx - bil - goalDeductions - snowball + decisionNet;
      balanceComputationCache.monthNet.set(key, net);
      return net;
    };
    const computeCarryover = (toMonth: number, toYear: number): number => {
      const key = `${toYear}-${toMonth}`;
      const cached = balanceComputationCache.carryover.get(key);
      if (cached !== undefined) return cached;
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
      balanceComputationCache.carryover.set(key, running);
      return running;
    };
    const carryover = computeCarryover(month, year);
    const financialEvents: FinancialEvent[] = [];
    const incomeByDay: Record<number, number> = {};
    incomes.forEach(i => {
      const occ = getIncomeOccurrenceDays(i, month, year);
      const amt = getEffectiveIncomeAmount(i, month, year);
      occ.forEach(d => {
        incomeByDay[d] = (incomeByDay[d] ?? 0) + amt;
        financialEvents.push({
          id: `income:${i.id}:${year}-${month + 1}-${d}`,
          sourceType: "income", sourceId: i.id,
          date: `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
          kind: "scheduled_income", amount: amt, status: "scheduled", name: i.name,
        });
      });
    });
    const monthTxs = transactions.filter(t => { const [ty, tm] = t.date.split("-").map(Number); return ty === year && tm === month + 1; });
    monthTxs.forEach(t => financialEvents.push({
      id: `transaction:${t.id}`, sourceType: "transaction", sourceId: t.id, date: t.date,
      kind: t.amount >= 0 ? "transaction_income" : "transaction_expense",
      amount: t.amount, status: "actual", name: t.note || t.category,
    }));
    const billsByDay: Record<number, number> = {};
    bills.filter(b => b.is_recurring || b.is_debt).forEach(b => {
      let occ = getBillOccurrenceDays(b, month, year);
      if (occ.length === 0) return;
      const o = overrides.find(o => o.bill_id === b.id && o.month === month && o.year === year);
      const total = getBillEffectiveMonthlyTotal(b, month, year);
      const amt = occ.length > 0 ? total / occ.length : 0;
      if (o?.actual_amount !== undefined && o.paid_date) {
        const [paidYear, paidMonth, paidDay] = o.paid_date.split("-").map(Number);
        if (paidYear === year && paidMonth === month + 1) {
          billsByDay[paidDay] = (billsByDay[paidDay] ?? 0) + total;
          financialEvents.push({
            id: `bill:${b.id}:${year}-${month + 1}-${paidDay}`, sourceType: "bill", sourceId: b.id,
            date: `${year}-${String(month + 1).padStart(2, "0")}-${String(paidDay).padStart(2, "0")}`,
            kind: "bill", amount: -total, status: "finalized", name: b.name,
          });
          return;
        }
      }
      if (o?.custom_due_day !== undefined && b.frequency === "monthly") {
        occ = [Math.min(o.custom_due_day, daysInMonth)];
      }
      occ.forEach(d => {
        billsByDay[d] = (billsByDay[d] ?? 0) + amt;
        financialEvents.push({
          id: `bill:${b.id}:${year}-${month + 1}-${d}`, sourceType: "bill", sourceId: b.id,
          date: `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
          kind: "bill", amount: -amt, status: "planned", name: b.name,
        });
      });
    });
    const debtExtrasByDay: Record<number, number> = {};
    extraPayments.filter(ep => ep.month === month && ep.year === year).forEach(ep => {
      const paymentDate = ep.payment_date ?? `${year}-${String(month + 1).padStart(2, "0")}-01`;
      const day = Number(paymentDate.split("-")[2]);
      if (!Number.isFinite(day) || day < 1 || day > daysInMonth) return;
      const pending = hasPendingSnowballBalanceApply(ep) || paymentDate > localDateString();
      const targetNames = Array.from(new Set(ep.allocations
        .map(allocation => allocation.billName || bills.find(bill => bill.id === allocation.billId)?.name)
        .filter(Boolean))).join(", ");
      debtExtrasByDay[day] = (debtExtrasByDay[day] ?? 0) + ep.amount;
      financialEvents.push({
        id: `extra:${ep.id}:${year}-${month + 1}-${day}`, sourceType: "extra_payment", sourceId: ep.id,
        date: paymentDate,
        kind: "debt_payment", amount: -ep.amount, status: pending ? "scheduled" : "applied", name: targetNames ? `${targetNames} debt payment` : "Snowball debt payment",
      });
    });
    const goalsByDay: Record<number, GoalExpense[]> = {};
    goals.forEach(g => {
      if (g.goal_type !== "planned_expense") return;
      if (!g.target_date) return;
      const targetDate = parseGoalTargetDate(g.target_date);
      if (!targetDate || targetDate.year !== year || targetDate.month !== month) return;
      const day = targetDate.day;
      if (!goalsByDay[day]) goalsByDay[day] = [];
      const remaining = getGoalRemainingAmount(g);
      if (remaining > 0) {
        goalsByDay[day].push({ id: g.id, name: g.name, amount: remaining });
        financialEvents.push({
          id: `goal:${g.id}:${year}-${month + 1}-${day}`, sourceType: "goal", sourceId: g.id,
          date: `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
          kind: "goal", amount: -remaining, status: "planned", name: g.name,
        });
      }
    });
    const plannedDecisionByDay: Record<number, number> = {};
    const rangeEnd = `${year}-${String(month + 1).padStart(2, "0")}-${String(daysInMonth).padStart(2, "0")}`;
    decisions.filter(d => d.status === "planned" || d.status === "calendar").forEach(decision => {
      scenarioDates(decision.scenario, rangeEnd).filter(date => date.startsWith(`${year}-${String(month + 1).padStart(2, "0")}`)).forEach(date => {
        const day = Number(date.slice(8, 10));
        const signed = decision.scenario.type === "income_change" ? decision.scenario.amount : -Math.abs(decision.scenario.amount);
        plannedDecisionByDay[day] = (plannedDecisionByDay[day] ?? 0) + signed;
        financialEvents.push({ id: `decision:${decision.id}:${date}`, sourceType: "decision", sourceId: decision.id, date, kind: signed >= 0 ? "scheduled_income" : "transaction_expense", amount: signed, status: "planned", name: decision.name });
      });
    });
    const currentMonthPrefix = `${year}-${String(month + 1).padStart(2, "0")}`;
    const openingBalance = settings.starting_balance_date?.startsWith(currentMonthPrefix)
      ? openingBalanceForReconciledDay(settings.starting_balance, settings.starting_balance_date, financialEvents)
      : carryover;
    const forecastStarted = Date.now();
    const forecast = forecastBalances({
      openingBalance,
      startDate: `${year}-${String(month + 1).padStart(2, "0")}-01`,
      endDate: `${year}-${String(month + 1).padStart(2, "0")}-${String(daysInMonth).padStart(2, "0")}`,
      events: financialEvents,
    });
    const forecastDuration = Date.now() - forecastStarted;
    if (forecastDuration >= 50) {
      void recordDiagnostic(user?.id, {
        eventType: "performance", operation: "forecast", platform: diagnosticPlatform(), durationMs: forecastDuration,
      }).catch(() => undefined);
    }
    const result: DailyBalance[] = [];
    for (let day = 1; day <= daysInMonth; day++) {
      const dayTxs = monthTxs.filter(t => { const [, , td] = t.date.split("-").map(Number); return td === day; });
      const scheduledIncome = incomeByDay[day] ?? 0;
      const txIncome     = dayTxs.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
      const incomeToday  = scheduledIncome + txIncome;
      const decisionNet = plannedDecisionByDay[day] ?? 0;
      const expenseToday = dayTxs.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0) + (debtExtrasByDay[day] ?? 0) + Math.max(0, -decisionNet);
      const billsToday   = billsByDay[day] ?? 0;
      const dayGoals     = goalsByDay[day] ?? [];
      const goalTotal    = dayGoals.reduce((s, ge) => s + ge.amount, 0);
      const forecastDay = forecast.days[day - 1];
      result.push({
        day, income: incomeToday, scheduledIncome, expense: expenseToday, bills: billsToday,
        goalExpenses: dayGoals, net: forecastDay.net, balance: forecastDay.balance, events: forecastDay.events,
      });
    }
    balanceComputationCache.daily.set(dailyKey, result);
    return result;
  }, [bills, transactions, incomes, goals, decisions, overrides, extraPayments, getBillEffectiveMonthlyTotal, settings.starting_balance, settings.starting_balance_date, balanceComputationCache, user]);

  const previewDebtSnowball = useCallback((month: number, year: number, requestedExtra?: number, additionalSafeCredit = 0, paymentDateOverride?: string): SnowballProjectionResult => {
    const debtInputs: SnowballDebtInput[] = bills
      .filter(b => b.is_debt && b.balance > 0)
      .map(b => ({
        id: b.id,
        name: b.name,
        balance: Number(b.balance),
        minimum: getBillMonthlyTotal(b, month, year),
        apr: Number(b.interest_rate),
        dueDay: b.due_day,
        included: b.include_in_snowball !== false,
      }));
    const included = debtInputs.filter(d => d.included);
    const target = orderDebts(included, settings.paymentMethod)[0];
    const existing = extraPayments.find(ep => ep.month === month && ep.year === year);
    const today = new Date();
    const requestedDay = target?.dueDay ?? 1;
    const dueDay = today.getFullYear() === year && today.getMonth() === month && requestedDay < today.getDate()
      ? today.getDate()
      : requestedDay;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const defaultPaymentDate = `${year}-${String(month + 1).padStart(2, "0")}-${String(Math.min(daysInMonth, dueDay)).padStart(2, "0")}`;
    const validOverride = paymentDateOverride?.startsWith(`${year}-${String(month + 1).padStart(2, "0")}-`);
    const paymentDate = validOverride ? paymentDateOverride! : defaultPaymentDate;

    const getWindowMinimum = (startMonth: number, startYear: number) => {
      let minimum = Infinity;
      for (let offset = 0; offset < settings.forecast_horizon_months; offset++) {
        const absolute = startYear * 12 + startMonth + offset;
        const m = absolute % 12;
        const y = Math.floor(absolute / 12);
        getDailyBalances(m, y).forEach(day => { minimum = Math.min(minimum, day.balance); });
      }
      return Number.isFinite(minimum) ? minimum : 0;
    };

    const baselineMinimum = getWindowMinimum(month, year);
    const existingAmount = existing?.amount ?? 0;
    const totalIncluded = included.reduce((sum, debt) => sum + debt.balance, 0);
    const safeMaximum = Math.max(0, Math.min(totalIncluded, baselineMinimum + existingAmount + Math.max(0, additionalSafeCredit) - settings.safety_floor));
    const selectedExtra = Math.max(0, Math.min(requestedExtra ?? safeMaximum, safeMaximum));
    const current = allocateSnowballExtra(debtInputs, selectedExtra, settings.paymentMethod, paymentDate);
    let cumulativeProjectedDelta = selectedExtra - existingAmount;
    const simulated = simulateSnowballPayoff({
      debts: debtInputs,
      method: settings.paymentMethod,
      startMonth: month,
      startYear: year,
      firstMonthBalances: current.balances,
      firstPayoffOrder: current.payoffOrder,
      getExtraForMonth: (_offset, futureMonth, futureYear, remainingDebt) => {
        const futureBaseline = getWindowMinimum(futureMonth, futureYear);
        const extra = Math.max(0, Math.min(remainingDebt, futureBaseline - cumulativeProjectedDelta - settings.safety_floor));
        cumulativeProjectedDelta += extra;
        return { extra, lowestBalance: futureBaseline - cumulativeProjectedDelta };
      },
    });
    const currentLowest = baselineMinimum - (selectedExtra - existingAmount);
    const endingDebt = Array.from(current.balances.values()).reduce((sum, balance) => sum + balance, 0);
    const currentMonthProjection = {
      month,
      year,
      targetName: target?.name ?? null,
      minimumPayments: debtInputs.reduce((sum, debt) => sum + debt.minimum, 0),
      extraPayment: selectedExtra,
      rolledPayment: 0,
      interest: 0,
      endingDebt,
      lowestAccountBalance: currentLowest,
    };
    return {
      safeMaximum,
      selectedExtra,
      paymentDate,
      allocations: current.allocations,
      months: [currentMonthProjection, ...simulated.months],
      payoffOrder: simulated.payoffOrder,
      debtFreeDate: endingDebt <= 0.009 ? `${year}-${String(month + 1).padStart(2, "0")}` : simulated.debtFreeDate,
      lowestSixMonthBalance: Math.min(currentLowest, ...simulated.months.slice(0, 5).map(item => item.lowestAccountBalance)),
    };
  }, [bills, settings.paymentMethod, settings.safety_floor, settings.forecast_horizon_months, extraPayments, getBillMonthlyTotal, getDailyBalances]);

  // ─── Categories ───────────────────────────────────────────────────────────────

  const addCategory = useCallback(async (name: string) => {
    if (!user) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    if (categories.includes(trimmed)) return;
    if (demoMode) {
      setCategories(prev => [...prev, trimmed]);
      return;
    }
    await ensureSaved(supabase.from("categories").insert({ user_id: user.id, name: trimmed }), "Add category");
    setCategories(prev => [...prev, trimmed]);
  }, [user, categories, demoMode]);

  const updateCategory = useCallback(async (oldName: string, newName: string) => {
    if (!user) return;
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName) return;
    const affectedBills = bills.filter(b => b.category === oldName);
    const affectedTransactions = transactions.filter(t => t.category === oldName);
    if (demoMode) {
      setCategories(prev => prev.map(c => c === oldName ? trimmed : c));
      setBills(prev => prev.map(b => b.category === oldName ? { ...b, category: trimmed } : b));
      setTransactions(prev => prev.map(t => t.category === oldName ? { ...t, category: trimmed } : t));
      return;
    }
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
  }, [user, bills, transactions, demoMode]);

  const deleteCategory = useCallback(async (name: string) => {
    if (!user) return;
    const affectedBills = bills.filter(b => b.category === name);
    const affectedTransactions = transactions.filter(t => t.category === name);
    if (demoMode) {
      setCategories(prev => prev.filter(c => c !== name));
      setBills(prev => prev.map(b => b.category === name ? { ...b, category: "Other" } : b));
      setTransactions(prev => prev.map(t => t.category === name ? { ...t, category: "Other" } : t));
      return;
    }
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
  }, [user, bills, transactions, demoMode]);

  // ─── Settings ─────────────────────────────────────────────────────────────────

  const updateSettings = useCallback(async (s: Partial<Settings>) => {
    if (!user) return;
    const next = { ...settings, ...s };
    setSettings(next);
    if (demoMode) return;
    const saveStarted = Date.now();
    markSaveStarted();
    try {
      await ensureSaved(supabase.from("settings").upsert({
        user_id:               user.id,
        payment_method:        next.paymentMethod,
        starting_balance:      next.starting_balance,
        starting_balance_date: next.starting_balance_date ?? null,
        safety_floor:          next.safety_floor,
        forecast_horizon_months: next.forecast_horizon_months,
        onboarding_completed:   next.onboarding_completed,
      }), "Update settings");
      markSaveCompleted();
      void recordDiagnostic(user.id, {
        eventType: "performance", operation: "settings_save", platform: diagnosticPlatform(),
        durationMs: Date.now() - saveStarted,
      }).catch(() => undefined);
    } catch (error) {
      setSettings(current => Object.entries(s).every(([key, value]) => current[key as keyof Settings] === value) ? settings : current);
      markSaveFailed(error, () => updateSettings(s));
      throw error;
    }
  }, [user, settings, demoMode, markSaveStarted, markSaveCompleted, markSaveFailed]);

  const persistAccountAnchor = useCallback(async (nextAccounts: Account[], asOfDate: string) => {
    if (!user) return;
    const nextBalance = totalForecastBalance(nextAccounts.map(toAccountSnapshot));
    const nextSettings = { ...settings, starting_balance: nextBalance, starting_balance_date: asOfDate };
    setSettings(nextSettings);
    if (demoMode) return;
    await ensureSaved(supabase.from("settings").upsert({
      user_id: user.id,
      payment_method: nextSettings.paymentMethod,
      starting_balance: nextBalance,
      starting_balance_date: asOfDate,
      safety_floor: nextSettings.safety_floor,
      forecast_horizon_months: nextSettings.forecast_horizon_months,
      onboarding_completed: nextSettings.onboarding_completed,
    }), "Update forecast balance");
  }, [user, settings, demoMode]);

  const addAccount = useCallback(async (input: Omit<Account, "id" | "created_at" | "last_reconciled_at">) => {
    if (!user) return;
    const now = new Date().toISOString();
    const account: Account = { ...input, id: genId(), created_at: now, last_reconciled_at: now };
    if (demoMode) {
      const next = [...accounts, account];
      setAccounts(next);
      await persistAccountAnchor(next, account.balance_as_of);
      return;
    }
    markSaveStarted();
    try {
      await ensureSaved(supabase.from("accounts").insert({ ...account, user_id: user.id }), "Add account");
      await ensureSaved(supabase.from("account_balances").insert({
        id: genId(), account_id: account.id, user_id: user.id, balance: account.current_balance,
        as_of_date: account.balance_as_of, source: "manual",
      }), "Save opening balance");
      const next = [...accounts, account];
      setAccounts(next);
      await persistAccountAnchor(next, account.balance_as_of);
      markSaveCompleted();
    } catch (error) {
      markSaveFailed(error, () => addAccount(input));
      throw error;
    }
  }, [user, accounts, persistAccountAnchor, demoMode, markSaveStarted, markSaveCompleted, markSaveFailed]);

  const updateAccount = useCallback(async (account: Account) => {
    if (!user) return;
    const previous = accounts.find(item => item.id === account.id);
    const next = accounts.map(item => item.id === account.id ? account : item);
    setAccounts(next);
    if (demoMode) {
      await persistAccountAnchor(next, account.balance_as_of);
      return;
    }
    markSaveStarted();
    try {
      await ensureSaved(supabase.from("accounts").update({
        name: account.name, account_type: account.account_type, is_active: account.is_active,
      }).eq("id", account.id).eq("user_id", user.id), "Update account");
      await persistAccountAnchor(next, account.balance_as_of);
      markSaveCompleted();
    } catch (error) {
      if (previous) setAccounts(current => current.map(item => item.id === previous.id ? previous : item));
      markSaveFailed(error, () => updateAccount(account));
      throw error;
    }
  }, [user, accounts, persistAccountAnchor, demoMode, markSaveStarted, markSaveCompleted, markSaveFailed]);

  const reconcileAccount = useCallback(async (accountId: string, balance: number, asOfDate: string) => {
    if (!user) return;
    const reconciledAt = new Date().toISOString();
    const next = accounts.map(account => account.id === accountId ? {
      ...account, current_balance: balance, balance_as_of: asOfDate, last_reconciled_at: reconciledAt,
    } : account);
    setAccounts(next);
    if (demoMode) {
      await persistAccountAnchor(next, asOfDate);
      return;
    }
    markSaveStarted();
    try {
      await ensureSaved(supabase.from("accounts").update({
        current_balance: balance, balance_as_of: asOfDate, last_reconciled_at: reconciledAt,
      }).eq("id", accountId).eq("user_id", user.id), "Reconcile account");
      await ensureSaved(supabase.from("account_balances").insert({
        id: genId(), account_id: accountId, user_id: user.id, balance, as_of_date: asOfDate, source: "reconciliation",
      }), "Save reconciliation");
      await persistAccountAnchor(next, asOfDate);
      markSaveCompleted();
      void recordDiagnostic(user.id, { eventType: "performance", operation: "reconciliation", platform: diagnosticPlatform() }).catch(() => undefined);
    } catch (error) {
      setAccounts(accounts);
      markSaveFailed(error, () => reconcileAccount(accountId, balance, asOfDate));
      throw error;
    }
  }, [user, accounts, persistAccountAnchor, demoMode, markSaveStarted, markSaveCompleted, markSaveFailed]);

  const archiveAccount = useCallback(async (accountId: string) => {
    const account = accounts.find(item => item.id === accountId);
    if (!account) return;
    await updateAccount({ ...account, is_active: false });
  }, [accounts, updateAccount]);

  const importStatementTransactions = useCallback(async (accountId: string, rows: ImportedTransactionRow[]) => {
    if (!user || !rows.length) return { imported: 0, duplicates: 0 };
    if (demoMode) {
      const existing = new Set(transactions.map(transaction => transaction.import_hash).filter(Boolean));
      const seen = new Set<string>();
      const fresh = rows.filter(row => !existing.has(row.importHash) && !seen.has(row.importHash) && !!seen.add(row.importHash));
      const records = fresh.map(row => ({
        id: genId(), account_id: accountId, import_hash: row.importHash,
        date: row.date, amount: row.amount, category: "Other", note: row.description,
      }));
      setTransactions(previous => [...previous, ...records]);
      return { imported: fresh.length, duplicates: rows.length - fresh.length };
    }
    const hashes = rows.map(row => row.importHash);
    const existingResult = await supabase.from("transactions").select("import_hash").eq("user_id", user.id).in("import_hash", hashes);
    if (existingResult.error) throw new Error(`Check statement duplicates: ${existingResult.error.message}`);
    const existing = new Set((existingResult.data ?? []).map((row: any) => row.import_hash));
    const seen = new Set<string>();
    const fresh = rows.filter(row => !existing.has(row.importHash) && !seen.has(row.importHash) && !!seen.add(row.importHash));
    if (fresh.length) {
      const records = fresh.map(row => ({
        id: genId(), user_id: user.id, account_id: accountId, import_hash: row.importHash,
        date: row.date, amount: row.amount, category: "Other", note: row.description,
      }));
      await ensureSaved(supabase.from("transactions").insert(records), "Import statement");
      setTransactions(previous => [...previous, ...records.map(({ user_id: _userId, ...record }) => record)]);
    }
    void recordDiagnostic(user.id, { eventType: "performance", operation: "statement_import", platform: diagnosticPlatform() }).catch(() => undefined);
    return { imported: fresh.length, duplicates: rows.length - fresh.length };
  }, [user, demoMode, transactions]);

  const saveDecision = useCallback(async (scenario: DecisionScenario, result: DecisionResult, status: DecisionRecord["status"] = "saved") => {
    if (!user) throw new Error("Sign in to save a decision");
    const decision: DecisionRecord = { id: genId(), name: scenario.name, decision_type: scenario.type, scenario, result, status, calendar_date: status === "calendar" || status === "planned" ? scenario.date : undefined, next_due_date: status === "planned" ? scenario.date : undefined, created_at: new Date().toISOString() };
    if (demoMode) {
      setDecisions(previous => [decision, ...previous]);
      return decision;
    }
    await ensureSaved(supabase.from("decisions").insert({ ...decision, calendar_date: decision.calendar_date ?? null, user_id: user.id }), "Save decision");
    setDecisions(previous => [decision, ...previous]); return decision;
  }, [user, demoMode]);

  const updateDecision = useCallback(async (decision: DecisionRecord) => {
    if (!user) return;
    if (demoMode) {
      setDecisions(previous => previous.map(item => item.id === decision.id ? decision : item));
      return;
    }
    await ensureSaved(supabase.from("decisions").update({ name: decision.name, scenario: decision.scenario, result: decision.result, status: decision.status, calendar_date: decision.calendar_date ?? null, applied_change: decision.applied_change ?? null, updated_at: new Date().toISOString() }).eq("id", decision.id).eq("user_id", user.id), "Update decision");
    setDecisions(previous => previous.map(item => item.id === decision.id ? decision : item));
  }, [user, demoMode]);

  const deleteDecision = useCallback(async (id: string) => {
    if (!user) return;
    if (demoMode) { setDecisions(previous => previous.filter(item => item.id !== id)); return; }
    await ensureSaved(supabase.from("decisions").delete().eq("id", id).eq("user_id", user.id), "Delete decision"); setDecisions(previous => previous.filter(item => item.id !== id));
  }, [user, demoMode]);

  const forecastConfidence = useMemo(() => {
    const base = evaluateForecastConfidence(accounts.map(toAccountSnapshot), incomes.length > 0, bills.some(bill => bill.is_recurring || bill.is_debt));
    const cutoff = Date.now() - 60 * 86_400_000;
    const staleRecurring = [...bills.filter(bill => bill.is_recurring || bill.is_debt), ...incomes]
      .some(item => !item.last_reviewed_at || new Date(item.last_reviewed_at).getTime() < cutoff);
    if (!staleRecurring) return base;
    const reasons = [...base.reasons.filter(reason => reason !== "Accounts and recurring cash flow are current"), "Review recurring income and bills older than 60 days"];
    return { level: base.level === "high" ? "medium" : base.level, label: base.level === "high" ? "Medium" : base.label, reasons } as ForecastConfidence;
  }, [accounts, incomes, bills]);

  const importBills = useCallback(async (imported: Omit<Bill, "id" | "created_at">[]) => {
    if (!user) return;
    const newBills = imported.map(b => ({
      ...b,
      frequency:   (b.frequency ?? "monthly") as "monthly" | "weekly",
      day_of_week: b.day_of_week ?? 0,
      id:          genId(),
      created_at:  new Date().toISOString(),
    }));
    if (demoMode) {
      setBills(prev => reorderDebtPriorities([...prev, ...newBills]));
      return;
    }
    await ensureSaved(supabase.from("bills").insert(newBills.map(b => ({ ...b, user_id: user.id }))), "Import bills");
    setBills(prev => reorderDebtPriorities([...prev, ...newBills]));
  }, [user, demoMode]);

  // ─── Provider value ───────────────────────────────────────────────────────────

  return (
    <BudgetContext.Provider value={{
      bills, overrides, transactions, incomes, goals, extraPayments, categories, settings, accounts, decisions, forecastConfidence, loading,
      saveStatus, saveError, retryLastSave, clearSaveError,
      dashboardFilter, setDashboardFilter,
      addBill, updateBill, deleteBill, getBillById,
      getOverride, getAmount, getPaidAmount, setPaidAmount, setCustomAmount, getCustomDueDay, setCustomDueDay,
      getMonthlyBills, getBillOccurrencesInMonth, getBillMonthlyTotal, getBillEffectiveMonthlyTotal,
      runSnowball, previewDebtSnowball, applyDebtSnowballPayment, saveExtraPayment, getExtraPayment, deleteExtraPayment, removeDebtSnowballPayment, finalizeBillPayment,
      addTransaction, updateTransaction, deleteTransaction, getTransactionsForMonth,
      addIncome, updateIncome, deleteIncome, getMonthlyIncome, getIncomeOccurrencesInMonth,
      addGoal, updateGoal, deleteGoal, checkGoalAffordability,
      getCashFlow, getDailyBalances,
      addCategory, updateCategory, deleteCategory,
      updateSettings, importBills,
      addAccount, updateAccount, reconcileAccount, archiveAccount, importStatementTransactions,
      saveDecision, updateDecision, deleteDecision,
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
