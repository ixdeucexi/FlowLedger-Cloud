import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState, Platform } from "react-native";

import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import {
  allocateSnowballExtra,
  effectiveDebtMinimum,
  monthlyDebtAmount,
  orderDebts,
  projectSnowballMonth,
  simulateSnowballPayoff,
  type SnowballDebtInput,
  type SnowballProjectionResult,
} from "@/lib/snowball";
import { SNOWBALL_PLAN_SOURCE } from "@/lib/debtPaymentPlan";
import { anchorForecastToBankBalance, forecastBalances, type FinancialEvent } from "@/lib/forecast";
import { diagnosticErrorCode } from "@/lib/diagnosticPolicy";
import { decisionDbPayload } from "@/lib/decisionPersistence";
import { recordDiagnostic } from "@/lib/diagnostics";
import { isDevDemoMode } from "@/lib/demoMode";
import { applyBillDateMovesToOccurrenceDays, getBillOccurrenceDays, getEffectiveIncomeAmount, getIncomeOccurrenceDays, getLatestRecordedIncomeAmount, isBillActiveForMonth, isIncomeActiveForMonth, moveSettledBillOverrideDate, resolveFinalizedBillOccurrenceDays } from "@/lib/schedule";
import { bankBalanceAdjustment, connectedCheckingAnchor, evaluateForecastConfidence, historicalMonthOpeningBalance, operatingAccountAnchor, type AccountSnapshot, type AccountType, type ForecastConfidence, type ImportedTransactionRow } from "@/lib/accounts";
import { scenarioDates, type DecisionResult, type DecisionScenario, type DecisionType } from "@/lib/decisions";
import {
  acceptHouseholdInviteCode,
  createHouseholdInviteCode,
  loadHouseholdActivity,
  leaveHousehold as leaveHouseholdRecord,
  loadHouseholdMemberships,
  loadHouseholdMembers,
  loadRemoteActiveHouseholdId,
  removeHouseholdMember as removeHouseholdMemberRecord,
  readStoredActiveHouseholdId,
  saveActiveHouseholdId,
  updateHouseholdMemberRole as updateHouseholdMemberRoleRecord,
  writeStoredActiveHouseholdId,
  type HouseholdActivity,
  type HouseholdInviteRole,
  type HouseholdMember,
  type HouseholdMembership,
  type HouseholdRole,
} from "@/lib/households";
import { canEditHouseholdPlan, canManageHouseholdMembers } from "@/lib/householdPermissions";
import { isActiveTransaction, isCashFlowTransaction, isCheckingBalanceTransaction, isConfirmedBillMatch, isDeletedTransaction } from "@/lib/billMatching";
import { matchedOccurrenceAllocations, occurrenceKey, reviewedBillMonthSettlements } from "@/lib/reviewCenter";
import { normalizePlanningTools } from "@/lib/planningMode";
import { localDateString } from "@/lib/dateLabels";
import { spendingBucketSummary } from "@/lib/spendingBuckets";
import { canonicalConnectedAccounts, pendingPlaidActivityWithBalanceHolds } from "@/lib/plaidActivity";
import { normalizeBillImportance, type BillImportance } from "@/lib/billImportance";

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
  next_payment_date?: string;
  start_date?: string;
  end_date?: string;
  is_recurring: boolean;
  frequency: "monthly" | "biweekly" | "weekly";
  created_at: string;
  smart_priority?: BillImportance;
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

function billBaseAmountForMonth(bill: Bill, override?: MonthlyOverride): number {
  const customAmount = override?.custom_amount;
  if (customAmount === undefined || !Number.isFinite(customAmount)) return bill.amount;
  // Debt bills should never disappear because of a stale/blank $0 override.
  // Positive overrides still allow one-month debt payment changes from Monthly.
  if (bill.is_debt && customAmount <= 0.005) return bill.amount;
  return Math.max(0, customAmount);
}

export interface BillDateMove {
  id: string;
  bill_id: string;
  from_date: string;
  to_date: string;
  created_at: string;
  updated_at?: string;
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
  transfer_group_id?: string;
  debt_applied_amount?: number;
  debt_applied_bill_id?: string;
  source?: string;
  plaid_transaction_id?: string;
  plaid_account_id?: string;
  merchant_name?: string;
  pending?: boolean;
  removed_at?: string;
  deleted_at?: string;
  deleted_by?: string;
  match_confidence?: number;
  match_reason?: string;
  review_status?: "needs_review" | "matched" | "categorized" | "transfer" | "legacy_reviewed";
  review_resolution?: "bill" | "income" | "goal" | "decision" | "category" | "transfer";
  review_allocations?: ReviewAllocation[];
  reviewed_at?: string;
  reviewed_by?: string;
  user_edited_at?: string;
  linked_income_id?: string;
  linked_plan_id?: string;
  linked_plan_type?: "goal" | "decision";
  matched_occurrence_date?: string;
}

export interface PendingBankTransaction {
  plaid_transaction_id: string;
  transaction_date: string;
  amount: number;
  name: string;
  merchant_name?: string;
  category: string;
  plaid_account_id?: string;
}

export interface ReviewAllocation {
  type: "bill" | "income" | "planned_expense" | "category" | "transfer" | "extra_principal";
  targetId?: string | null;
  source?: "goal" | "decision";
  name?: string;
  category?: string | null;
  amount: number;
  plannedAmount?: number;
  occurrenceDate?: string;
  settlement?: "exact" | "full" | "partial" | "split" | "extra_principal" | "regular";
}

export interface ReconcileTransactionInput {
  transactionId: string;
  resolution: "bill" | "income" | "goal" | "decision" | "category" | "transfer";
  targetId?: string;
  occurrenceDate?: string;
  plannedAmount?: number;
  settlement?: "exact" | "full" | "partial" | "split" | "extra_principal";
  extraCategory?: string;
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

export interface ConnectedBankAccount {
  id: string;
  plaid_account_id?: string;
  name: string;
  official_name?: string;
  mask?: string;
  persistent_account_id?: string;
  account_type?: string;
  account_subtype?: string;
  current_balance: number;
  available_balance?: number;
  is_active: boolean;
  updated_at?: string;
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
  excluded_dates?: string[];
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
  closed_at?: string;
  closed_by?: string;
  archived_at?: string;
  archived_by?: string;
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
  reviewTransactionId?: string;
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
  zeroBasedBudgetEnabled: boolean;
  debtPayoffEnabled: boolean;
  paymentMethod: "snowball" | "avalanche";
  starting_balance: number;
  starting_balance_date?: string;
  calendar_start_date?: string;
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
  billDateMoves: BillDateMove[];
  transactions: Transaction[];
  deletedTransactions: Transaction[];
  pendingBankTransactions: PendingBankTransaction[];
  incomes: IncomeItem[];
  goals: Goal[];
  extraPayments: ExtraPayment[];
  categories: string[];
  settings: Settings;
  accounts: Account[];
  connectedBankAccounts: ConnectedBankAccount[];
  decisions: DecisionRecord[];
  households: HouseholdMembership[];
  householdMembers: HouseholdMember[];
  householdActivity: HouseholdActivity[];
  activeHousehold: HouseholdMembership | null;
  householdRole: HouseholdRole | null;
  canEditHousehold: boolean;
  forecastConfidence: ForecastConfidence;
  loading: boolean;
  loadError: string | null;
  retryBudgetLoad: () => void;
  refreshBankData: () => Promise<void>;
  demoMode: boolean;
  selectedYear: number;
  setSelectedYear: (y: number) => void;
  dashboardFilter: DashboardFilter;
  setDashboardFilter: (f: DashboardFilter) => void;
  saveStatus: SaveStatus;
  saveError: string | null;
  retryLastSave: () => Promise<void>;
  clearSaveError: () => void;
  refreshHouseholds: () => Promise<void>;
  refreshHouseholdActivity: () => Promise<void>;
  switchHousehold: (householdId: string) => Promise<void>;
  createHouseholdInvite: (role?: HouseholdInviteRole) => Promise<string>;
  acceptHouseholdInvite: (code: string) => Promise<void>;
  updateHouseholdMemberRole: (memberUserId: string, role: HouseholdInviteRole) => Promise<void>;
  removeHouseholdMember: (memberUserId: string) => Promise<void>;
  leaveActiveHousehold: () => Promise<void>;

  addBill: (bill: Omit<Bill, "id" | "created_at">) => Promise<string>;
  updateBill: (bill: Bill) => Promise<void>;
  stopFutureBill: (id: string) => Promise<void>;
  deleteBill: (id: string) => Promise<void>;
  deleteBillMistake: (id: string) => Promise<void>;
  getBillById: (id: string) => Bill | undefined;

  getOverride: (billId: string, month: number, year: number) => MonthlyOverride | undefined;
  getAmount: (bill: Bill, month: number, year: number) => number;
  getPaidAmount: (billId: string, month: number, year: number) => number;
  setPaidAmount: (billId: string, month: number, year: number, amount: number) => Promise<void>;
  setCustomAmount: (billId: string, month: number, year: number, amount: number | undefined) => Promise<void>;
  getCustomDueDay: (billId: string, month: number, year: number) => number | undefined;
  setCustomDueDay: (billId: string, month: number, year: number, day: number | undefined) => Promise<void>;
  moveBillOccurrence: (billId: string, fromDate: string, toDate: string) => Promise<void>;
  removeBillOccurrenceMove: (id: string) => Promise<void>;
  getBillDateMoveForOccurrence: (billId: string, fromDate: string) => BillDateMove | undefined;
  getBillDateMovesForMonth: (month: number, year: number) => BillDateMove[];
  getMonthlyBills: (month: number, year: number) => Bill[];
  getBillOccurrencesInMonth: (bill: Bill, month: number, year: number) => number[];
  getBillMonthlyTotal: (bill: Bill, month: number, year: number) => number;
  getBillEffectiveMonthlyTotal: (bill: Bill, month: number, year: number) => number;

  runSnowball: (month: number, year: number, extraAmount: number) => SnowballAllocation[];
  previewDebtSnowball: (month: number, year: number, extraAmount?: number, additionalSafeCredit?: number, paymentDateOverride?: string, editingPaymentId?: string) => SnowballProjectionResult;
  applyDebtSnowballPayment: (preview: SnowballProjectionResult, sources?: SnowballFundingSource[]) => Promise<void>;
  saveExtraPayment: (month: number, year: number, amount: number, allocations: SnowballAllocation[], paymentDate?: string, sources?: SnowballFundingSource[]) => Promise<void>;
  removeDebtSnowballPayment: (month: number, year: number) => Promise<void>;
  finalizeBillPayment: (billId: string, month: number, year: number, actualAmount: number, paidDate: string) => Promise<{ budgeted: number; actual: number; surplus: number }>;
  getExtraPayment: (month: number, year: number) => ExtraPayment | undefined;
  deleteExtraPayment: (id: string) => Promise<void>;

  addTransaction: (tx: Omit<Transaction, "id">) => Promise<string>;
  updateTransaction: (tx: Transaction) => Promise<void>;
  deleteTransaction: (id: string) => Promise<void>;
  restoreDeletedTransaction: (id: string) => Promise<void>;
  deleteTransfer: (transferGroupId: string) => Promise<void>;
  matchTransactionToBill: (transactionId: string, billId: string, occurrenceDate?: string, plannedAmount?: number) => Promise<void>;
  unmatchTransactionFromBill: (transactionId: string) => Promise<void>;
  reconcileTransaction: (input: ReconcileTransactionInput) => Promise<void>;
  undoTransactionReconciliation: (transactionId: string) => Promise<void>;
  removeReviewSurplusFunding: (transactionId: string) => Promise<void>;
  getTransactionsForMonth: (month: number, year: number) => Transaction[];

  addIncome: (item: Omit<IncomeItem, "id">) => Promise<string>;
  updateIncome: (item: IncomeItem) => Promise<void>;
  deleteIncome: (id: string) => Promise<void>;
  getMonthlyIncome: (month?: number, year?: number) => number;
  getIncomeOccurrencesInMonth: (month: number, year: number) => { income: IncomeItem; days: number[]; effectiveAmount: number }[];

  addGoal: (goal: Omit<Goal, "id" | "created_at">) => Promise<string>;
  updateGoal: (goal: Goal) => Promise<void>;
  closeSpendingBucket: (id: string) => Promise<{ spent: number; released: number }>;
  reopenSpendingBucket: (id: string) => Promise<void>;
  archiveSpendingBucket: (id: string) => Promise<void>;
  restoreArchivedSpendingBucket: (id: string) => Promise<void>;
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
  zeroBasedBudgetEnabled: false,
  debtPayoffEnabled: true,
  paymentMethod: "snowball",
  starting_balance: 0,
  calendar_start_date: undefined,
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

function normalizeCategoryInput(name: string): string {
  return String(name ?? "").trim().replace(/\s+/g, " ");
}

function categoryMatches(left: string, right: string): boolean {
  return normalizeCategoryInput(left).toLowerCase() === normalizeCategoryInput(right).toLowerCase();
}

function dedupeCategories(values: string[]): string[] {
  const next: string[] = [];
  const seen = new Set<string>();
  values.forEach(value => {
    const clean = normalizeCategoryInput(value);
    if (!clean) return;
    const key = clean.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    next.push(clean);
  });
  return next;
}

function fallbackCategoryList(values: string[]): string[] {
  return dedupeCategories([...DEFAULT_CATEGORIES, ...values]);
}

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

function getGoalRemainingAmount(goal: Pick<Goal, "target_amount" | "current_amount" | "closed_at">): number {
  return spendingBucketSummary(goal).remaining;
}

async function ensureSaved(
  operation: PromiseLike<{ error: { message: string } | null }>,
  action: string
): Promise<void> {
  const { error } = await operation;
  if (error) throw new Error(`${action}: ${error.message}`);
}

function monthlyOverrideDbPayload(override: MonthlyOverride) {
  return {
    ...override,
    custom_amount: override.custom_amount ?? null,
    custom_due_day: override.custom_due_day ?? null,
    actual_amount: override.actual_amount ?? null,
    paid_date: override.paid_date ?? null,
  };
}

function withLoadTimeout<T>(promise: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function endOfCurrentMonthYMD() {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;
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

function monthKey(year: number, month: number) {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

function dateFromParts(year: number, month: number, day: number) {
  return `${monthKey(year, month)}-${String(day).padStart(2, "0")}`;
}

function billStartMonth(bill: Pick<Bill, "start_date" | "created_at">): { year: number; month: number } {
  const parsed = parseYmd(bill.start_date || bill.created_at);
  if (parsed) return { year: parsed.year, month: parsed.month };
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() };
}

function pastActiveMonthsForBill(bill: Bill, beforeMonth: number, beforeYear: number): { year: number; month: number }[] {
  const start = billStartMonth(bill);
  const months: { year: number; month: number }[] = [];
  let cursor = new Date(start.year, start.month, 1);
  const stop = new Date(beforeYear, beforeMonth, 1);
  let guard = 0;
  while (cursor < stop && guard < 240) {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    if (isBillActiveForMonth(bill, month, year)) months.push({ year, month });
    cursor = new Date(year, month + 1, 1);
    guard += 1;
  }
  return months;
}

function parseYmd(date: string): { year: number; month: number; day: number } | null {
  const [year, month, day] = date.slice(0, 10).split("-").map(Number);
  if (![year, month, day].every(Number.isFinite)) return null;
  return { year, month: month - 1, day };
}

function billDateMoveStorageKey(userId?: string, householdId?: string | null) {
  return `flowledger-bill-date-moves-${userId ?? "local"}-${householdId ?? "personal"}`;
}

function readStoredBillDateMoves(userId?: string, householdId?: string | null): BillDateMove[] {
  if (Platform.OS !== "web") return [];
  try {
    const raw = globalThis.localStorage?.getItem(billDateMoveStorageKey(userId, householdId));
    const parsed = raw ? JSON.parse(raw) as Partial<BillDateMove>[] : [];
    return parsed
      .filter(item => item.bill_id && item.from_date && item.to_date)
      .map(item => ({
        id: String(item.id ?? genId()),
        bill_id: String(item.bill_id),
        from_date: String(item.from_date).slice(0, 10),
        to_date: String(item.to_date).slice(0, 10),
        created_at: String(item.created_at ?? new Date().toISOString()),
      }));
  } catch {
    return [];
  }
}

function writeStoredBillDateMoves(userId: string | undefined, moves: BillDateMove[], householdId?: string | null) {
  if (Platform.OS !== "web") return;
  globalThis.localStorage?.setItem(billDateMoveStorageKey(userId, householdId), JSON.stringify(moves));
}

function normalizeBillDateMoveRow(row: any): BillDateMove {
  return {
    id: String(row.id ?? genId()),
    bill_id: String(row.bill_id),
    from_date: String(row.from_date).slice(0, 10),
    to_date: String(row.to_date).slice(0, 10),
    created_at: String(row.created_at ?? new Date().toISOString()),
    updated_at: row.updated_at ? String(row.updated_at) : undefined,
  };
}

function billDateMoveKey(move: Pick<BillDateMove, "bill_id" | "from_date">) {
  return `${move.bill_id}::${move.from_date}`;
}

function billDateMoveFreshness(move: Pick<BillDateMove, "created_at" | "updated_at">) {
  const parsed = Date.parse(move.updated_at ?? move.created_at ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function mergeBillDateMoves(primary: BillDateMove[], fallback: BillDateMove[]) {
  const byKey = new Map<string, BillDateMove>();
  [...fallback, ...primary].forEach(move => {
    const key = billDateMoveKey(move);
    const existing = byKey.get(key);
    if (!existing || billDateMoveFreshness(move) >= billDateMoveFreshness(existing)) {
      byKey.set(key, move);
    }
  });
  return Array.from(byKey.values()).sort((a, b) => a.from_date.localeCompare(b.from_date) || a.to_date.localeCompare(b.to_date));
}

function billDateMoveDbPayload(move: Pick<BillDateMove, "bill_id" | "from_date" | "to_date">, userId: string, scope?: HouseholdMembership | null) {
  return {
    user_id: userId,
    bill_id: move.bill_id,
    from_date: move.from_date.slice(0, 10),
    to_date: move.to_date.slice(0, 10),
    updated_at: new Date().toISOString(),
    ...(scope ? { household_id: scope.householdId, budget_id: scope.budgetId } : {}),
  };
}

function billDateMoveConflictTarget(scope?: HouseholdMembership | null) {
  return scope?.householdId ? "household_id,bill_id,from_date" : "user_id,bill_id,from_date";
}

function isUuidLike(id: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}

async function upsertBillDateMoveRow(move: Pick<BillDateMove, "bill_id" | "from_date" | "to_date">, userId: string, scope?: HouseholdMembership | null) {
  const payload = billDateMoveDbPayload(move, userId, scope);
  const preferredConflict = billDateMoveConflictTarget(scope);
  const saved = await supabase
    .from("bill_date_moves")
    .upsert(payload, { onConflict: preferredConflict })
    .select("*")
    .single();
  if (!saved.error || preferredConflict === "user_id,bill_id,from_date") return saved;

  const message = saved.error.message.toLowerCase();
  const canFallback = message.includes("unique") || message.includes("constraint") || message.includes("schema cache") || message.includes("conflict");
  if (!canFallback) return saved;

  return supabase
    .from("bill_date_moves")
    .upsert(payload, { onConflict: "user_id,bill_id,from_date" })
    .select("*")
    .single();
}

async function loadBillDateMoves(uid: string, scope?: HouseholdMembership | null): Promise<BillDateMove[]> {
  const stored = readStoredBillDateMoves(uid, scope?.householdId);
  const remoteBase = supabase.from("bill_date_moves").select("*");
  const remoteQuery = scope
    ? scope.isPersonal
      ? remoteBase.or(`household_id.eq.${scope.householdId},and(household_id.is.null,user_id.eq.${uid})`)
      : remoteBase.eq("household_id", scope.householdId)
    : remoteBase.eq("user_id", uid);
  const remote = await remoteQuery.order("from_date");

  if (remote.error) {
    return stored;
  }

  let remoteMoves = (remote.data ?? []).map(normalizeBillDateMoveRow);
  const remoteKeys = new Set(remoteMoves.map(billDateMoveKey));
  const localOnly = stored.filter(move => !remoteKeys.has(billDateMoveKey(move)));

  if (localOnly.length > 0) {
    const synced = await Promise.all(localOnly.map(async move => {
      const saved = await upsertBillDateMoveRow(move, uid, scope);
      return saved.error ? move : normalizeBillDateMoveRow(saved.data);
    }));
    remoteMoves = mergeBillDateMoves(remoteMoves, synced);
  }

  const merged = mergeBillDateMoves(remoteMoves, stored);
  writeStoredBillDateMoves(uid, merged, scope?.householdId);
  return merged;
}

const markSnowballSourcesPending = (sources: SnowballFundingSource[]) =>
  sources.map(source => ({ ...source, pendingBalanceApply: true }));

const hasPendingSnowballBalanceApply = (payment: Pick<ExtraPayment, "sources">) =>
  (payment.sources ?? []).some(source => source.pendingBalanceApply);

function normalizeBillRow(bill: any): Bill {
  return {
    ...bill,
    frequency: (bill.frequency ?? "monthly") as "monthly" | "biweekly" | "weekly",
    day_of_week: bill.day_of_week ?? 0,
    next_payment_date: bill.next_payment_date ?? undefined,
    amount: Number(bill.amount),
    balance: Number(bill.balance),
    interest_rate: Number(bill.interest_rate),
    smart_priority: normalizeBillImportance(bill.smart_priority, Boolean(bill.is_debt)),
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
    calendar_start_date: startDate,
    onboarding_completed: true,
  };
  return { bills, overrides, billDateMoves: [] as BillDateMove[], transactions, incomes, goals, extraPayments: [] as ExtraPayment[], categories: DEFAULT_CATEGORIES, accounts, decisions, settings };
}

function normalizeTransactionRow(transaction: any): Transaction {
  return {
    ...transaction,
    amount: Number(transaction.amount),
    debt_applied_amount: Number(transaction.debt_applied_amount ?? 0),
    debt_applied_bill_id: transaction.debt_applied_bill_id ?? undefined,
    review_allocations: Array.isArray(transaction.review_allocations)
      ? transaction.review_allocations.map((allocation: any) => ({
          ...allocation,
          amount: Number(allocation.amount ?? 0),
          plannedAmount: allocation.plannedAmount === undefined ? undefined : Number(allocation.plannedAmount),
        }))
      : [],
    linked_income_id: transaction.linked_income_id ?? undefined,
    linked_plan_id: transaction.linked_plan_id ?? undefined,
    linked_plan_type: transaction.linked_plan_type ?? undefined,
    matched_occurrence_date: transaction.matched_occurrence_date ?? undefined,
  };
}

function splitTransactionRows(rows: any[]): { active: Transaction[]; deleted: Transaction[] } {
  const normalized = rows.map(normalizeTransactionRow);
  return {
    active: normalized.filter(isActiveTransaction),
    deleted: normalized.filter(isDeletedTransaction).sort((left, right) =>
      String(right.deleted_at ?? "").localeCompare(String(left.deleted_at ?? ""))),
  };
}

function normalizePendingBankRows(rows: any[]): PendingBankTransaction[] {
  return rows.map(row => ({
    plaid_transaction_id: String(row.plaid_transaction_id),
    transaction_date: String(row.transaction_date).slice(0, 10),
    amount: Number(row.amount),
    name: String(row.name || row.merchant_name || "Pending transaction"),
    merchant_name: row.merchant_name || undefined,
    category: String(row.category || "Other"),
    plaid_account_id: row.plaid_account_id || undefined,
  }));
}

function normalizeConnectedBankRows(rows: any[]): ConnectedBankAccount[] {
  return rows.map(account => ({
    ...account,
    current_balance: Number(account.current_balance || 0),
    available_balance: account.available_balance == null ? undefined : Number(account.available_balance),
    is_active: account.is_active !== false,
  }));
}

function normalizeMonthlyOverrideRow(override: any): MonthlyOverride {
  return {
    ...override,
    paid_amount: Number(override.paid_amount),
    custom_amount: override.custom_amount !== null ? Number(override.custom_amount) : undefined,
    custom_due_day: override.custom_due_day !== null ? Number(override.custom_due_day) : undefined,
    actual_amount: override.actual_amount !== null ? Number(override.actual_amount) : undefined,
    paid_date: override.paid_date ?? undefined,
  };
}

function roundMoney(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
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
  const [billDateMoves, setBillDateMoves] = useState<BillDateMove[]>([]);
  const [transactions,  setTransactions]  = useState<Transaction[]>([]);
  const [deletedTransactions, setDeletedTransactions] = useState<Transaction[]>([]);
  const [pendingBankTransactions, setPendingBankTransactions] = useState<PendingBankTransaction[]>([]);
  const [incomes,       setIncomes]       = useState<IncomeItem[]>([]);
  const [goals,         setGoals]         = useState<Goal[]>([]);
  const [extraPayments, setExtraPayments] = useState<ExtraPayment[]>([]);
  const [categories,    setCategories]    = useState<string[]>([]);
  const [accounts,      setAccounts]      = useState<Account[]>([]);
  const [connectedBankAccounts, setConnectedBankAccounts] = useState<ConnectedBankAccount[]>([]);
  const [decisions,     setDecisions]     = useState<DecisionRecord[]>([]);
  const [households,    setHouseholds]    = useState<HouseholdMembership[]>([]);
  const [householdMembers, setHouseholdMembers] = useState<HouseholdMember[]>([]);
  const [householdActivity, setHouseholdActivity] = useState<HouseholdActivity[]>([]);
  const [activeHouseholdId, setActiveHouseholdId] = useState<string | null>(null);
  const [settings,      setSettings]      = useState<Settings>(DEFAULT_SETTINGS);
  const [loading,       setLoading]       = useState(true);
  const [loadError,     setLoadError]     = useState<string | null>(null);
  const [loadRetryNonce, setLoadRetryNonce] = useState(0);
  const [selectedYear,  setSelectedYear]  = useState(new Date().getFullYear());
  const [dashboardFilter, setDashboardFilter] = useState<DashboardFilter>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  const loaded = useRef(false);
  const overridesRef = useRef<MonthlyOverride[]>([]);
  const billDateMovesRef = useRef<BillDateMove[]>([]);
  const accountsRef = useRef<Account[]>([]);
  const connectedBankAccountsRef = useRef<ConnectedBankAccount[]>([]);
  const retrySaveRef = useRef<null | (() => Promise<void>)>(null);
  const saveStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const householdScopeRef = useRef<HouseholdMembership | null>(null);
  const loadRequestRef = useRef(0);
  const bankRefreshRequestRef = useRef(0);
  const plaidSyncPromiseRef = useRef<Promise<void> | null>(null);
  const lastPlaidSyncAtRef = useRef(0);
  useEffect(() => { overridesRef.current = overrides; }, [overrides]);
  useEffect(() => { billDateMovesRef.current = billDateMoves; }, [billDateMoves]);
  useEffect(() => { accountsRef.current = accounts; }, [accounts]);
  useEffect(() => { connectedBankAccountsRef.current = connectedBankAccounts; }, [connectedBankAccounts]);

  const activeHousehold = useMemo(
    () => households.find(household => household.householdId === activeHouseholdId) ?? null,
    [households, activeHouseholdId],
  );
  const householdRole = activeHousehold?.role ?? null;
  const canEditHousehold = canEditHouseholdPlan(activeHousehold?.role);
  useEffect(() => { householdScopeRef.current = activeHousehold; }, [activeHousehold]);

  const assertCanEditHousehold = useCallback((action = "change this household plan") => {
    if (!canEditHousehold) {
      throw new Error(`View-only household access cannot ${action}.`);
    }
  }, [canEditHousehold]);

  const scopedPayload = useCallback(<T extends Record<string, unknown>>(payload: T): T & { household_id?: string; budget_id?: string | null } => {
    const scope = householdScopeRef.current;
    if (!scope) return payload;
    return {
      ...payload,
      household_id: scope.householdId,
      budget_id: scope.budgetId,
    };
  }, []);

  const applyHouseholdSelect = useCallback((query: any, uid: string) => {
    const scope = householdScopeRef.current;
    if (!scope) return query.eq("user_id", uid);
    if (scope.isPersonal) {
      return query.or(`household_id.eq.${scope.householdId},and(household_id.is.null,user_id.eq.${uid})`);
    }
    return query.eq("household_id", scope.householdId);
  }, []);

  const recalculateAndRefreshDebtMinimums = useCallback(async () => {
    if (!user) return;
    const rollover = await supabase.rpc("recalculate_debt_minimum_boosts", {
      p_household_id: householdScopeRef.current?.householdId ?? null,
    });
    if (rollover.error) throw new Error(`Recalculate debt minimum: ${rollover.error.message}`);

    const refreshed = await applyHouseholdSelect(supabase.from("bills").select("*"), user.id);
    if (refreshed.error) throw new Error(`Refresh debts: ${refreshed.error.message}`);
    setBills(reorderDebtPriorities((refreshed.data ?? []).map(normalizeBillRow)));
  }, [user, applyHouseholdSelect]);

  const loadScopedSettings = useCallback(async (uid: string, scope?: HouseholdMembership | null) => {
    if (scope) {
      const householdResult = await supabase
        .from("household_settings")
        .select("*")
        .eq("household_id", scope.householdId)
        .maybeSingle();
      if (!householdResult.error) return householdResult;
      const message = householdResult.error.message.toLowerCase();
      if (!message.includes("household_settings") && !message.includes("schema cache")) {
        return householdResult;
      }
    }
    return supabase.from("settings").select("*").eq("user_id", uid).maybeSingle();
  }, []);

  const refreshHouseholdDetails = useCallback(async (scope?: HouseholdMembership | null) => {
    if (!scope) {
      setHouseholdMembers([]);
      setHouseholdActivity([]);
      return;
    }
    const [members, activity] = await Promise.all([
      loadHouseholdMembers(scope.householdId),
      loadHouseholdActivity(scope.householdId, 12),
    ]);
    setHouseholdMembers(members);
    setHouseholdActivity(activity);
  }, []);

  const resolveHouseholds = useCallback(async (uid: string) => {
    const memberships = await loadHouseholdMemberships(uid);
    setHouseholds(memberships);
    if (memberships.length === 0) {
      setActiveHouseholdId(null);
      householdScopeRef.current = null;
      setHouseholdMembers([]);
      setHouseholdActivity([]);
      return null;
    }
    const remoteActive = await loadRemoteActiveHouseholdId(uid);
    const storedActive = await readStoredActiveHouseholdId(uid);
    const next =
      memberships.find(item => item.householdId === remoteActive) ??
      memberships.find(item => item.householdId === storedActive) ??
      memberships.find(item => item.isPersonal) ??
      memberships[0];
    setActiveHouseholdId(next.householdId);
    householdScopeRef.current = next;
    void writeStoredActiveHouseholdId(uid, next.householdId);
    void refreshHouseholdDetails(next);
    return next;
  }, [refreshHouseholdDetails]);

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

  const retryBudgetLoad = useCallback(() => {
    setLoadError(null);
    setLoadRetryNonce(value => value + 1);
  }, []);

  const refreshHouseholds = useCallback(async () => {
    if (!user || demoMode) return;
    await resolveHouseholds(user.id);
  }, [user, demoMode, resolveHouseholds]);

  const refreshHouseholdActivity = useCallback(async () => {
    if (!activeHousehold) {
      setHouseholdActivity([]);
      return;
    }
    const activity = await loadHouseholdActivity(activeHousehold.householdId, 12);
    setHouseholdActivity(activity);
  }, [activeHousehold]);

  const switchHousehold = useCallback(async (householdId: string) => {
    if (!user || demoMode) return;
    const next = households.find(household => household.householdId === householdId);
    if (!next) return;
    setActiveHouseholdId(next.householdId);
    householdScopeRef.current = next;
    await saveActiveHouseholdId(user.id, next.householdId);
    await refreshHouseholdDetails(next);
    setLoadRetryNonce(value => value + 1);
  }, [user, demoMode, households, refreshHouseholdDetails]);

  const createHouseholdInvite = useCallback(async (role: HouseholdInviteRole = "editor") => {
    if (!activeHousehold) throw new Error("Choose a household first.");
    if (!canManageHouseholdMembers(activeHousehold.role)) throw new Error("Only household owners or managers can invite people.");
    return createHouseholdInviteCode(activeHousehold.householdId, role);
  }, [activeHousehold]);

  const acceptHouseholdInvite = useCallback(async (code: string) => {
    if (!user) throw new Error("Sign in before joining a household.");
    const householdId = await acceptHouseholdInviteCode(code);
    await saveActiveHouseholdId(user.id, householdId);
    setActiveHouseholdId(householdId);
    await resolveHouseholds(user.id);
    setLoadRetryNonce(value => value + 1);
  }, [user, resolveHouseholds]);

  const updateHouseholdMemberRole = useCallback(async (memberUserId: string, role: HouseholdInviteRole) => {
    if (!activeHousehold) throw new Error("Choose a household first.");
    if (!canManageHouseholdMembers(activeHousehold.role)) throw new Error("Only household owners or managers can update member access.");
    await updateHouseholdMemberRoleRecord(activeHousehold.householdId, memberUserId, role);
    await refreshHouseholdDetails(activeHousehold);
  }, [activeHousehold, refreshHouseholdDetails]);

  const removeHouseholdMember = useCallback(async (memberUserId: string) => {
    if (!activeHousehold) throw new Error("Choose a household first.");
    if (!canManageHouseholdMembers(activeHousehold.role)) throw new Error("Only household owners or managers can remove members.");
    await removeHouseholdMemberRecord(activeHousehold.householdId, memberUserId);
    await refreshHouseholdDetails(activeHousehold);
  }, [activeHousehold, refreshHouseholdDetails]);

  const leaveActiveHousehold = useCallback(async () => {
    if (!user || !activeHousehold) throw new Error("Choose a household first.");
    if (activeHousehold.role === "owner") throw new Error("Transfer household ownership before leaving.");
    await leaveHouseholdRecord(activeHousehold.householdId);
    const next = await resolveHouseholds(user.id);
    if (next) await saveActiveHouseholdId(user.id, next.householdId);
    setLoadRetryNonce(value => value + 1);
  }, [user, activeHousehold, resolveHouseholds]);

  // ── Load from Supabase when user changes ────────────────────────────────────
  useEffect(() => {
    const requestId = ++loadRequestRef.current;
    bankRefreshRequestRef.current += 1;
    if (demoMode) {
      setLoadError(null);
      const demo = createDemoBudgetData();
      setBills(demo.bills);
      setOverrides(demo.overrides);
      overridesRef.current = demo.overrides;
      setBillDateMoves(demo.billDateMoves);
      billDateMovesRef.current = demo.billDateMoves;
      setTransactions(demo.transactions);
      setDeletedTransactions([]);
      setPendingBankTransactions([]);
      setIncomes(demo.incomes);
      setGoals(demo.goals);
      setExtraPayments(demo.extraPayments);
      setCategories(demo.categories);
      setAccounts(demo.accounts);
      setConnectedBankAccounts([]);
      setDecisions(demo.decisions);
      setSettings(demo.settings);
      loaded.current = true;
      setLoading(false);
      return;
    }
    if (!user) {
      setLoadError(null);
      setBills([]); setOverrides([]); setBillDateMoves([]); setTransactions([]); setDeletedTransactions([]); setPendingBankTransactions([]); setIncomes([]);
      setGoals([]); setExtraPayments([]); setCategories([]); setAccounts([]); setConnectedBankAccounts([]); setDecisions([]); setSettings(DEFAULT_SETTINGS);
      setHouseholds([]); setHouseholdMembers([]); setHouseholdActivity([]); setActiveHouseholdId(null); householdScopeRef.current = null;
      billDateMovesRef.current = [];
      loaded.current = false;
      setLoading(false);
      return;
    }
    loaded.current = false;
    setLoading(true);
    setLoadError(null);
    (async () => {
      const loadStarted = Date.now();
      try {
        const uid = user.id;
        const scope = await resolveHouseholds(uid);
        if (requestId !== loadRequestRef.current) return;
        if (scope?.role !== "viewer") {
          try {
            const { error } = await withLoadTimeout(
              supabase.rpc("sync_due_debt_transactions", {
                p_as_of_date: localDateString(),
                p_household_id: scope?.householdId ?? null,
              }),
              8000,
              "Sync scheduled debt payments",
            );
            if (error) console.warn("Scheduled debt sync skipped", error.message);
          } catch (error) {
            console.warn("Scheduled debt sync skipped", error);
          }
        }
        const results = await withLoadTimeout(
          Promise.all([
            applyHouseholdSelect(supabase.from("bills").select("*"), uid),
            applyHouseholdSelect(supabase.from("monthly_overrides").select("*"), uid),
            applyHouseholdSelect(supabase.from("transactions").select("*"), uid),
            applyHouseholdSelect(
              supabase.from("plaid_transactions")
                .select("plaid_transaction_id,transaction_date,amount,name,merchant_name,category,plaid_account_id")
                .eq("pending", true)
                .is("removed_at", null)
                .order("transaction_date", { ascending: false })
                .limit(100),
              uid,
            ),
            applyHouseholdSelect(supabase.from("incomes").select("*"), uid),
            applyHouseholdSelect(supabase.from("goals").select("*"), uid),
            applyHouseholdSelect(supabase.from("extra_payments").select("*"), uid),
            loadScopedSettings(uid, scope),
            applyHouseholdSelect(supabase.from("categories").select("name"), uid),
            applyHouseholdSelect(supabase.from("accounts").select("*"), uid).order("created_at"),
            applyHouseholdSelect(
              supabase.from("plaid_accounts")
                .select("id,name,official_name,mask,persistent_account_id,account_type,account_subtype,current_balance,available_balance,is_active,updated_at")
                .eq("is_active", true)
                .order("name"),
              uid,
            ),
            applyHouseholdSelect(supabase.from("decisions").select("*"), uid).order("created_at", { ascending: false }),
          ]),
          12000,
          "Load budget data",
        );
        const failed = results.find(result => result.error);
        if (failed?.error) throw new Error(`Load budget data: ${failed.error.message}`);
        const [
          { data: bData },
          { data: oData },
          { data: tData },
          { data: pendingData },
          { data: iData },
          { data: gData },
          { data: epData },
          { data: sData },
          { data: cData },
          { data: aData },
          { data: connectedAccountData },
          { data: dData },
        ] = results;

        const storedBillDateMoves = await withLoadTimeout(loadBillDateMoves(uid, scope), 8000, "Load moved bill dates");
        if (requestId !== loadRequestRef.current) return;

        setBills(reorderDebtPriorities((bData ?? []).map(normalizeBillRow)));
        setOverrides((oData ?? []).map(normalizeMonthlyOverrideRow));
        setBillDateMoves(storedBillDateMoves);
        billDateMovesRef.current = storedBillDateMoves;
        const transactionCollections = splitTransactionRows(tData ?? []);
        setTransactions(transactionCollections.active);
        setDeletedTransactions(transactionCollections.deleted);
        const rawConnectedAccounts = normalizeConnectedBankRows(connectedAccountData ?? []);
        const canonicalBankAccounts = canonicalConnectedAccounts(rawConnectedAccounts);
        setConnectedBankAccounts(canonicalBankAccounts);
        setPendingBankTransactions(pendingPlaidActivityWithBalanceHolds(normalizePendingBankRows(pendingData ?? []), rawConnectedAccounts, localDateString()));
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
        const loadedAccounts = (aData ?? []).filter((a: any) => a.account_type !== "credit_card").map((a: any) => ({
          ...a,
          current_balance: Number(a.current_balance),
          last_reconciled_at: a.last_reconciled_at ?? undefined,
          is_active: a.is_active !== false,
        }));
        setAccounts(loadedAccounts);
        setDecisions((dData ?? []).map((d: any) => ({ ...d, calendar_date: d.calendar_date ?? undefined, applied_change: d.applied_change ?? undefined })));
        if (sData) {
          const nextStartingBalance = Number(sData.starting_balance);
          const nextStartingBalanceDate = sData.starting_balance_date ?? undefined;
          setSettings({
            ...normalizePlanningTools(sData),
            paymentMethod:        sData.payment_method as Settings["paymentMethod"],
            starting_balance:     nextStartingBalance,
            starting_balance_date: nextStartingBalanceDate,
            calendar_start_date: sData.calendar_start_date ?? (nextStartingBalanceDate ? `${nextStartingBalanceDate.slice(0, 7)}-01` : undefined),
            safety_floor:         Number(sData.safety_floor ?? 200),
            forecast_horizon_months: Math.min(24, Math.max(1, Number(sData.forecast_horizon_months ?? 6))),
            onboarding_completed: Boolean(sData.onboarding_completed),
          });
        }
        const cats = (cData ?? []).map((c: any) => c.name as string);
        setCategories(cats.length > 0 ? fallbackCategoryList(cats) : DEFAULT_CATEGORIES);
        setLoadError(null);
      } catch (error) {
        console.warn("Budget load failed or timed out", error);
        if (requestId === loadRequestRef.current) {
          setLoadError(error instanceof Error ? error.message : "FlowLedger could not load your plan.");
        }
      } finally {
        if (requestId === loadRequestRef.current) {
          loaded.current = true;
          setLoading(false);
        }
        void recordDiagnostic(user.id, {
          eventType: "performance", operation: "data_load", platform: diagnosticPlatform(),
          durationMs: Date.now() - loadStarted,
        }).catch(() => undefined);
      }
    })();
  }, [user, demoMode, loadRetryNonce, resolveHouseholds, applyHouseholdSelect, loadScopedSettings]);

  const loadBankData = useCallback(async () => {
    if (!user || demoMode) return;
    const requestId = ++bankRefreshRequestRef.current;
    const uid = user.id;
    let loadedAccounts: Account[] | null = null;
    const scope = householdScopeRef.current;
    const [transactionResult, pendingResult, accountResult, connectedAccountResult, settingsResult] = await Promise.all([
      applyHouseholdSelect(supabase.from("transactions").select("*"), uid),
      applyHouseholdSelect(
        supabase.from("plaid_transactions")
          .select("plaid_transaction_id,transaction_date,amount,name,merchant_name,category,plaid_account_id")
          .eq("pending", true)
          .is("removed_at", null)
          .order("transaction_date", { ascending: false })
          .limit(100),
        uid,
      ),
      applyHouseholdSelect(supabase.from("accounts").select("*"), uid).order("created_at"),
      applyHouseholdSelect(
        supabase.from("plaid_accounts")
          .select("id,name,official_name,mask,persistent_account_id,account_type,account_subtype,current_balance,available_balance,is_active,updated_at")
          .eq("is_active", true)
          .order("name"),
        uid,
      ),
      loadScopedSettings(uid, scope),
    ]);
    if (requestId !== bankRefreshRequestRef.current || scope?.householdId !== householdScopeRef.current?.householdId) return;
    if (!transactionResult.error) {
      const transactionCollections = splitTransactionRows(transactionResult.data ?? []);
      setTransactions(transactionCollections.active);
      setDeletedTransactions(transactionCollections.deleted);
    }
    if (!accountResult.error) {
      const nextAccounts = (accountResult.data ?? []).filter((a: any) => a.account_type !== "credit_card").map((a: any) => ({
        ...a,
        current_balance: Number(a.current_balance),
        last_reconciled_at: a.last_reconciled_at ?? undefined,
        is_active: a.is_active !== false,
      }));
      loadedAccounts = nextAccounts;
      accountsRef.current = nextAccounts;
      setAccounts(nextAccounts);
    }
    if (!connectedAccountResult.error) {
      const rawConnectedAccounts = normalizeConnectedBankRows(connectedAccountResult.data ?? []);
      const canonicalBankAccounts = canonicalConnectedAccounts(rawConnectedAccounts);
      setConnectedBankAccounts(canonicalBankAccounts);
      if (!pendingResult.error) {
        setPendingBankTransactions(pendingPlaidActivityWithBalanceHolds(normalizePendingBankRows(pendingResult.data ?? []), rawConnectedAccounts, localDateString()));
      }
    }
    if (!settingsResult.error && settingsResult.data) {
      const sData = settingsResult.data;
      const nextStartingBalance = Number(sData.starting_balance);
      const nextStartingBalanceDate = sData.starting_balance_date ?? undefined;
        setSettings(prev => ({
          ...prev,
          ...normalizePlanningTools(sData),
        paymentMethod:        sData.payment_method as Settings["paymentMethod"],
        starting_balance:     nextStartingBalance,
        starting_balance_date: nextStartingBalanceDate,
        calendar_start_date: sData.calendar_start_date ?? (nextStartingBalanceDate ? `${nextStartingBalanceDate.slice(0, 7)}-01` : undefined),
        safety_floor:         Number(sData.safety_floor ?? 200),
        forecast_horizon_months: Math.min(24, Math.max(1, Number(sData.forecast_horizon_months ?? 6))),
        onboarding_completed: Boolean(sData.onboarding_completed),
      }));
    }
  }, [user, demoMode, applyHouseholdSelect, loadScopedSettings]);

  const refreshBankData = useCallback(async () => {
    if (!user || demoMode || Platform.OS !== "web") return;
    if (plaidSyncPromiseRef.current) return plaidSyncPromiseRef.current;

    const now = Date.now();
    const fiveMinutes = 5 * 60 * 1000;
    if (now - lastPlaidSyncAtRef.current < fiveMinutes) {
      await loadBankData();
      return;
    }
    lastPlaidSyncAtRef.current = now;

    const request = (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const accessToken = data.session?.access_token;
        if (!accessToken) return;
        const scope = householdScopeRef.current ?? await resolveHouseholds(user.id);
        const householdId = scope?.householdId;
        const response = await fetch("/api/plaid/sync", {
          method: "POST",
          credentials: "include",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            ...(householdId ? { "X-FlowLedger-Household-Id": householdId } : {}),
          },
        });
        // Basic households and users without a connection have nothing to sync.
        // Other failures are logged, while the last saved bank data still loads.
        if (!response.ok && ![403, 404].includes(response.status)) {
          console.warn("Automatic Plaid sync skipped", response.status);
        }
      } catch (error) {
        console.warn("Automatic Plaid sync skipped", error);
      } finally {
        await loadBankData();
      }
    })();
    plaidSyncPromiseRef.current = request;
    try {
      await request;
    } finally {
      plaidSyncPromiseRef.current = null;
    }
  }, [user, demoMode, loadBankData, resolveHouseholds]);

  useEffect(() => {
    if (!user || demoMode) return;
    void refreshBankData();
    const subscription = AppState.addEventListener("change", state => {
      if (state === "active") void refreshBankData();
    });
    if (Platform.OS !== "web" || typeof document === "undefined" || typeof window === "undefined") {
      return () => subscription.remove();
    }
    const refreshVisibleBankData = () => {
      if (document.visibilityState !== "hidden") void refreshBankData();
    };
    document.addEventListener("visibilitychange", refreshVisibleBankData);
    window.addEventListener("focus", refreshVisibleBankData);
    return () => {
      subscription.remove();
      document.removeEventListener("visibilitychange", refreshVisibleBankData);
      window.removeEventListener("focus", refreshVisibleBankData);
    };
  }, [user, demoMode, activeHouseholdId, refreshBankData]);

  // ─── Bills ────────────────────────────────────────────────────────────────────

  const addBill = useCallback(async (bill: Omit<Bill, "id" | "created_at">) => {
    if (!user) throw new Error("Sign in to add a bill");
    assertCanEditHousehold("add a bill");
    const nb: Bill = { ...bill, id: genId(), created_at: new Date().toISOString() };
    if (demoMode) {
      setBills(prev => reorderDebtPriorities([...prev, nb]));
      return nb.id;
    }
    await ensureSaved(supabase.from("bills").insert(scopedPayload({ ...nb, user_id: user.id })), "Add bill");
    setBills(prev => reorderDebtPriorities([...prev, nb]));
    const hasRollover = nb.is_debt && nb.include_in_snowball !== false && (
      nb.balance <= 0.009 ||
      bills.some(existing =>
        existing.is_debt && existing.include_in_snowball !== false &&
        (existing.balance <= 0.009 || Number(existing.snowball_minimum_boost ?? 0) > 0.009)
      )
    );
    if (hasRollover) await recalculateAndRefreshDebtMinimums();
    return nb.id;
  }, [user, bills, demoMode, scopedPayload, assertCanEditHousehold, recalculateAndRefreshDebtMinimums]);

  const updateBill = useCallback(async (bill: Bill) => {
    if (!user) return;
    assertCanEditHousehold("update a bill");
    const existing = bills.find(b => b.id === bill.id);
    if (!existing) return;
    const previousOverrides = overridesRef.current;
    const reviewedBill = { ...bill, last_reviewed_at: new Date().toISOString() };
    const now = new Date();
    const curMonth = now.getMonth();
    const curYear  = now.getFullYear();
    setBills(prev => reorderDebtPriorities(prev.map(item => item.id === bill.id ? reviewedBill : item)));
    if (demoMode) return;
    markSaveStarted();
    try {
    if (existing.amount !== bill.amount || existing.due_day !== bill.due_day) {
      const currentOverrides = overridesRef.current.filter(o => o.bill_id === bill.id);
      const overridesByMonth = new Map(currentOverrides.map(o => [`${o.year}-${o.month}`, o]));
      const monthsToPreserve = pastActiveMonthsForBill(existing, curMonth, curYear);
      const dbUpdates: Promise<any>[] = [];
      const insertedOverrides: MonthlyOverride[] = [];

      const nextOverrides = currentOverrides.map(o => {
        const isStrictlyPast = o.year < curYear || (o.year === curYear && o.month < curMonth);
        if (isStrictlyPast) {
          const patch: Partial<MonthlyOverride> = {};
          if (existing.amount !== bill.amount && o.custom_amount === undefined) patch.custom_amount = existing.amount;
          if (existing.due_day !== bill.due_day && o.custom_due_day === undefined) patch.custom_due_day = existing.due_day;
          if (Object.keys(patch).length > 0) {
            dbUpdates.push(
              supabase.from("monthly_overrides")
                .update({
                  ...(patch.custom_amount !== undefined ? { custom_amount: patch.custom_amount } : {}),
                  ...(patch.custom_due_day !== undefined ? { custom_due_day: patch.custom_due_day } : {}),
                })
                .eq("id", o.id) as unknown as Promise<any>
            );
            return { ...o, ...patch };
          }
        } else if (
          !isStrictlyPast &&
          ((existing.amount !== bill.amount && o.custom_amount !== undefined) ||
           (existing.due_day !== bill.due_day && o.custom_due_day !== undefined))
        ) {
          const resetPatch = {
            ...(existing.amount !== bill.amount ? { custom_amount: null } : {}),
            ...(existing.due_day !== bill.due_day ? { custom_due_day: null } : {}),
          };
          dbUpdates.push(
            supabase.from("monthly_overrides")
              .update(resetPatch)
              .eq("id", o.id) as unknown as Promise<any>
          );
          return {
            ...o,
            ...(existing.amount !== bill.amount ? { custom_amount: undefined } : {}),
            ...(existing.due_day !== bill.due_day ? { custom_due_day: undefined } : {}),
          };
        }
        return o;
      });

      monthsToPreserve.forEach(({ year, month }) => {
        const key = `${year}-${month}`;
        if (overridesByMonth.has(key)) return;
        const created: MonthlyOverride = {
          id: genId(),
          bill_id: bill.id,
          month,
          year,
          paid_amount: 0,
          ...(existing.amount !== bill.amount ? { custom_amount: existing.amount } : {}),
          ...(existing.due_day !== bill.due_day ? { custom_due_day: existing.due_day } : {}),
        };
        insertedOverrides.push(created);
        dbUpdates.push(
          supabase.from("monthly_overrides")
            .insert(scopedPayload({ ...monthlyOverrideDbPayload(created), user_id: user.id })) as unknown as Promise<any>
        );
      });

      const changedIds = new Set(nextOverrides.filter((o, i) => o !== currentOverrides[i]).map(o => o.id));
      if (changedIds.size > 0 || insertedOverrides.length > 0) {
        const optimisticOverrides = overridesRef.current.map(o => {
            const changed = nextOverrides.find(n => n.id === o.id);
            return changed && changedIds.has(o.id) ? changed : o;
          }).concat(insertedOverrides);
        overridesRef.current = optimisticOverrides;
        setOverrides(optimisticOverrides);
      }
      const results = await Promise.all(dbUpdates);
      const failed = results.find(result => result?.error);
      if (failed?.error) throw new Error(`Update monthly bill: ${failed.error.message}`);
    }
      await ensureSaved(supabase.from("bills").update({
        ...reviewedBill,
        day_of_week: reviewedBill.day_of_week ?? null,
        next_payment_date: reviewedBill.next_payment_date ?? null,
        start_date: reviewedBill.start_date ?? null,
        end_date: reviewedBill.end_date ?? null,
        smart_priority: reviewedBill.smart_priority ?? null,
        snowball_minimum_boost: reviewedBill.snowball_minimum_boost ?? 0,
      }).eq("id", bill.id), "Update bill");
      if ((bill.is_debt || existing.is_debt) && (existing.balance !== bill.balance || existing.amount !== bill.amount || existing.include_in_snowball !== bill.include_in_snowball)) {
        await recalculateAndRefreshDebtMinimums();
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
  }, [user, bills, demoMode, markSaveStarted, markSaveCompleted, markSaveFailed, scopedPayload, assertCanEditHousehold, recalculateAndRefreshDebtMinimums]);

  const stopFutureBill = useCallback(async (id: string) => {
    if (!user) return;
    assertCanEditHousehold("stop a future bill");
    const deletedBill = bills.find(bill => bill.id === id);
    const shouldEndForwardOnly = !!deletedBill && (deletedBill.is_recurring || deletedBill.is_debt);
    const forwardEndDate = endOfCurrentMonthYMD();
    if (demoMode) {
      if (shouldEndForwardOnly) {
        setBills(prev => reorderDebtPriorities(prev.map(b => b.id === id ? { ...b, end_date: forwardEndDate } : b)));
      } else {
        setBills(prev => reorderDebtPriorities(prev.filter(b => b.id !== id)));
        setOverrides(prev => prev.filter(o => o.bill_id !== id));
      }
      return;
    }
    if (shouldEndForwardOnly && deletedBill) {
      const endedBill = { ...deletedBill, end_date: forwardEndDate };
      await ensureSaved(
        supabase.from("bills").update({ end_date: forwardEndDate, last_reviewed_at: new Date().toISOString() }).eq("id", id),
        "Stop future bill"
      );
      setBills(prev => reorderDebtPriorities(prev.map(b => b.id === id ? endedBill : b)));
    } else {
      const results = await Promise.all([
        supabase.from("bills").delete().eq("id", id),
        supabase.from("monthly_overrides").delete().eq("bill_id", id),
      ]);
      const failed = results.find(result => result.error);
      if (failed?.error) throw new Error(`Delete bill: ${failed.error.message}`);
      setBills(prev => reorderDebtPriorities(prev.filter(b => b.id !== id)));
      setOverrides(prev => prev.filter(o => o.bill_id !== id));
    }
    if (deletedBill?.is_debt) {
      await recalculateAndRefreshDebtMinimums();
    }
  }, [user, bills, demoMode, assertCanEditHousehold, recalculateAndRefreshDebtMinimums]);

  const deleteBill = useCallback(async (id: string) => {
    if (!user) return;
    assertCanEditHousehold("delete a bill");
    const deletedBill = bills.find(bill => bill.id === id);
    const householdId = householdScopeRef.current?.householdId ?? null;
    const clearBillLinks = (transaction: Transaction): Transaction => {
      if (transaction.linked_bill_id !== id && transaction.debt_applied_bill_id !== id) return transaction;
      return {
        ...transaction,
        linked_bill_id: transaction.linked_bill_id === id ? undefined : transaction.linked_bill_id,
        debt_applied_bill_id: transaction.debt_applied_bill_id === id ? undefined : transaction.debt_applied_bill_id,
        debt_applied_amount: transaction.debt_applied_bill_id === id ? 0 : transaction.debt_applied_amount,
      };
    };
    const removeLocalBillData = () => {
      setBills(prev => reorderDebtPriorities(prev.filter(b => b.id !== id)));
      setOverrides(prev => prev.filter(o => o.bill_id !== id));
      const nextMoves = billDateMovesRef.current.filter(move => move.bill_id !== id);
      billDateMovesRef.current = nextMoves;
      setBillDateMoves(nextMoves);
      writeStoredBillDateMoves(user.id, nextMoves, householdScopeRef.current?.householdId);
      setTransactions(prev => prev.map(clearBillLinks));
    };

    if (demoMode) {
      removeLocalBillData();
      return;
    }

    const rpcDelete = await supabase.rpc("delete_bill_completely", { p_bill_id: id, p_household_id: householdId });
    const rpcMissing = !!rpcDelete.error && (
      rpcDelete.error.code === "PGRST202" ||
      /delete_bill_completely|schema cache|function/i.test(rpcDelete.error.message ?? "")
    );

    if (rpcDelete.error && !rpcMissing) throw new Error(`Delete bill: ${rpcDelete.error.message}`);
    if (!rpcDelete.error && rpcDelete.data !== true) {
      throw new Error("Delete bill: no matching bill was found, or this household role cannot delete it.");
    }

    if (rpcMissing) {
      const cleanupResults = await Promise.all([
        supabase.from("monthly_overrides").delete().eq("bill_id", id),
        supabase.from("bill_date_moves").delete().eq("bill_id", id),
        supabase.from("transactions").update({ linked_bill_id: null }).eq("linked_bill_id", id),
        supabase.from("transactions").update({ debt_applied_bill_id: null, debt_applied_amount: 0 }).eq("debt_applied_bill_id", id),
      ]);
      const cleanupFailed = cleanupResults.find(result => result.error);
      if (cleanupFailed?.error) throw new Error(`Delete bill cleanup: ${cleanupFailed.error.message}`);

      const deleted = await supabase.from("bills").delete().eq("id", id).select("id").maybeSingle();
      if (deleted.error) throw new Error(`Delete bill: ${deleted.error.message}`);
      if (!deleted.data) throw new Error("Delete bill: no matching bill was found, or this household role cannot delete it.");
    }

    removeLocalBillData();

    if (deletedBill?.is_debt) {
      await recalculateAndRefreshDebtMinimums();
    }
  }, [user, bills, demoMode, assertCanEditHousehold, recalculateAndRefreshDebtMinimums]);

  const deleteBillMistake = deleteBill;

  const getBillById = useCallback((id: string) => bills.find(b => b.id === id), [bills]);

  // ─── Overrides ────────────────────────────────────────────────────────────────

  const getOverride = useCallback(
    (billId: string, month: number, year: number) =>
      overrides.find(o => o.bill_id === billId && o.month === month && o.year === year),
    [overrides]
  );

  const reviewedBillSettlements = useMemo(
    () => reviewedBillMonthSettlements(transactions),
    [transactions],
  );

  const getAmount = useCallback(
    (bill: Bill, month: number, year: number): number => {
      const o = overrides.find(o => o.bill_id === bill.id && o.month === month && o.year === year);
      const base = billBaseAmountForMonth(bill, o);
      if (!bill.is_debt) return base;

      let settledAmount: number | undefined;
      if (bill.frequency === "monthly") {
        const settlementKey = `${bill.id}:${year}-${String(month + 1).padStart(2, "0")}`;
        const reviewedSettlement = reviewedBillSettlements.get(settlementKey);
        if (reviewedSettlement?.status === "settled") settledAmount = reviewedSettlement.actualAmount;
        else if (!reviewedSettlement && o?.actual_amount !== undefined && o.paid_date) settledAmount = o.actual_amount;
      }

      return monthlyDebtAmount(base, Number(bill.snowball_minimum_boost ?? 0), settledAmount);
    },
    [overrides, reviewedBillSettlements]
  );

  const getPaidAmount = useCallback(
    (billId: string, month: number, year: number): number =>
      overrides.find(o => o.bill_id === billId && o.month === month && o.year === year)?.paid_amount ?? 0,
    [overrides]
  );

  const upsertOverride = useCallback(
    async (billId: string, month: number, year: number, patch: Partial<Omit<MonthlyOverride, "id" | "bill_id" | "month" | "year">>) => {
      if (!user) return;
      assertCanEditHousehold("update a monthly bill");
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
            supabase.from("monthly_overrides").update(monthlyOverrideDbPayload(updated)).eq("id", existing.id),
            "Update monthly bill"
          );
        } else {
          await ensureSaved(supabase.from("monthly_overrides").insert(scopedPayload({ ...monthlyOverrideDbPayload(updated), user_id: user.id })), "Create monthly bill");
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
    [user, demoMode, markSaveStarted, markSaveCompleted, markSaveFailed, scopedPayload, assertCanEditHousehold]
  );

  const setPaidAmount = useCallback(
    async (billId: string, month: number, year: number, amount: number) => {
      const prevPaid = overridesRef.current.find(o => o.bill_id === billId && o.month === month && o.year === year)?.paid_amount ?? 0;
      const cleanAmount = Math.max(0, amount);
      await upsertOverride(billId, month, year, cleanAmount <= 0.005
        ? { paid_amount: 0, actual_amount: undefined, paid_date: undefined }
        : { paid_amount: cleanAmount }
      );
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
            supabase.from("bills").update({ balance: nextBalance }).eq("id", billId),
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
    async (billId: string, month: number, year: number, day: number | undefined) => {
      const existing = overridesRef.current.find(o => o.bill_id === billId && o.month === month && o.year === year);
      const bill = bills.find(item => item.id === billId);
      const patch: Partial<Omit<MonthlyOverride, "id" | "bill_id" | "month" | "year">> = { custom_due_day: day };
      if (bill && (existing?.actual_amount !== undefined || (existing?.paid_amount ?? 0) > 0.005)) {
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const effectiveDay = Math.min(daysInMonth, day ?? bill.due_day);
        patch.paid_date = dateFromParts(year, month, effectiveDay);
      }
      await upsertOverride(billId, month, year, patch);
    },
    [upsertOverride, bills]
  );

  // ─── Bill scheduling helpers ──────────────────────────────────────────────────

  const getBillDateMoveForOccurrence = useCallback(
    (billId: string, fromDate: string): BillDateMove | undefined =>
      billDateMoves.find(move => move.bill_id === billId && move.from_date === fromDate),
    [billDateMoves]
  );

  const getBillDateMovesForMonth = useCallback(
    (month: number, year: number): BillDateMove[] => {
      const key = monthKey(year, month);
      return billDateMoves.filter(move => move.from_date.startsWith(key) || move.to_date.startsWith(key));
    },
    [billDateMoves]
  );

  const moveBillOccurrence = useCallback(async (billId: string, fromDate: string, toDate: string) => {
    if (!user) return;
    assertCanEditHousehold("move a bill date");
    const cleanFrom = fromDate.slice(0, 10);
    const cleanTo = toDate.slice(0, 10);
    const previous = billDateMovesRef.current;
    const previousOverrides = overridesRef.current;
    const existing = billDateMovesRef.current.find(move => move.bill_id === billId && move.from_date === cleanFrom);
    const nextMove: BillDateMove = existing
      ? { ...existing, to_date: cleanTo }
      : { id: genId(), bill_id: billId, from_date: cleanFrom, to_date: cleanTo, created_at: new Date().toISOString() };
    const next = existing
      ? billDateMovesRef.current.map(move => move.id === existing.id ? nextMove : move)
      : [...billDateMovesRef.current, nextMove];
    billDateMovesRef.current = next;
    setBillDateMoves(next);
    const nextOverrides = moveSettledBillOverrideDate(
      overridesRef.current,
      billId,
      cleanFrom,
      existing?.to_date ?? cleanFrom,
      cleanTo,
    );
    overridesRef.current = nextOverrides;
    setOverrides(nextOverrides);
    writeStoredBillDateMoves(user.id, next, householdScopeRef.current?.householdId);
    if (demoMode) {
      markSaveCompleted();
      return;
    }
    markSaveStarted();
    try {
      const saved = await upsertBillDateMoveRow(nextMove, user.id, householdScopeRef.current);
      if (saved.error) throw new Error(`Move bill date: ${saved.error.message}`);
      const savedMove = normalizeBillDateMoveRow(saved.data);
      const finalMoves = billDateMovesRef.current.map(move =>
        move.bill_id === savedMove.bill_id && move.from_date === savedMove.from_date ? savedMove : move
      );
      billDateMovesRef.current = finalMoves;
      setBillDateMoves(finalMoves);
      writeStoredBillDateMoves(user.id, finalMoves, householdScopeRef.current?.householdId);
      markSaveCompleted();
    } catch (error) {
      const current = billDateMovesRef.current.find(move => move.bill_id === billId && move.from_date === cleanFrom);
      if (current?.to_date === cleanTo) {
        billDateMovesRef.current = previous;
        setBillDateMoves(previous);
        overridesRef.current = previousOverrides;
        setOverrides(previousOverrides);
        writeStoredBillDateMoves(user.id, previous, householdScopeRef.current?.householdId);
      }
      markSaveFailed(error, () => moveBillOccurrence(billId, fromDate, toDate));
      throw error;
    }
  }, [user, demoMode, markSaveStarted, markSaveCompleted, markSaveFailed, assertCanEditHousehold]);

  const removeBillOccurrenceMove = useCallback(async (id: string) => {
    if (!user) return;
    assertCanEditHousehold("restore a bill date");
    const previous = billDateMovesRef.current;
    const previousOverrides = overridesRef.current;
    const existing = previous.find(move => move.id === id);
    const next = billDateMovesRef.current.filter(move => move.id !== id);
    billDateMovesRef.current = next;
    setBillDateMoves(next);
    if (existing) {
      const nextOverrides = moveSettledBillOverrideDate(
        overridesRef.current,
        existing.bill_id,
        existing.from_date,
        existing.to_date,
        existing.from_date,
      );
      overridesRef.current = nextOverrides;
      setOverrides(nextOverrides);
    }
    writeStoredBillDateMoves(user.id, next, householdScopeRef.current?.householdId);
    if (demoMode || !existing) {
      markSaveCompleted();
      return;
    }
    markSaveStarted();
    try {
      let removeQuery = supabase.from("bill_date_moves").delete();
      if (isUuidLike(existing.id)) {
        removeQuery = removeQuery.eq("id", existing.id);
      } else if (householdScopeRef.current?.householdId) {
        removeQuery = removeQuery
          .eq("household_id", householdScopeRef.current.householdId)
          .eq("bill_id", existing.bill_id)
          .eq("from_date", existing.from_date);
      } else {
        removeQuery = removeQuery
          .eq("user_id", user.id)
          .eq("bill_id", existing.bill_id)
          .eq("from_date", existing.from_date);
      }
      const removed = await removeQuery;
      if (removed.error) throw new Error(`Restore bill date: ${removed.error.message}`);
      markSaveCompleted();
    } catch (error) {
      billDateMovesRef.current = previous;
      setBillDateMoves(previous);
      overridesRef.current = previousOverrides;
      setOverrides(previousOverrides);
      writeStoredBillDateMoves(user.id, previous, householdScopeRef.current?.householdId);
      markSaveFailed(error, () => removeBillOccurrenceMove(id));
      throw error;
    }
  }, [user, demoMode, markSaveStarted, markSaveCompleted, markSaveFailed, assertCanEditHousehold]);

  const applyBillDateMovesToOccurrences = useCallback((bill: Bill, month: number, year: number, occurrences: number[]): number[] =>
    applyBillDateMovesToOccurrenceDays(bill.id, month, year, occurrences, billDateMoves),
  [billDateMoves]);

  const getBillOccurrencesInMonth = useCallback(
    (bill: Bill, month: number, year: number): number[] => {
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      let occ = getBillOccurrenceDays(bill, month, year);
      const o = overrides.find(ov => ov.bill_id === bill.id && ov.month === month && ov.year === year);
      if (o?.custom_due_day !== undefined && bill.frequency === "monthly") {
        occ = [Math.min(o.custom_due_day, daysInMonth)];
      }
      return applyBillDateMovesToOccurrences(bill, month, year, occ);
    },
    [overrides, applyBillDateMovesToOccurrences]
  );

  const getBillMonthlyTotal = useCallback((bill: Bill, month: number, year: number): number => {
    const occurrences = getBillOccurrencesInMonth(bill, month, year);
    if (occurrences.length === 0) return 0;
    return getAmount(bill, month, year) * occurrences.length;
  }, [getAmount, getBillOccurrencesInMonth]);

  const getBillEffectiveMonthlyTotal = useCallback((bill: Bill, month: number, year: number): number => {
    const override = overrides.find(o => o.bill_id === bill.id && o.month === month && o.year === year);
    return override?.actual_amount !== undefined
      ? Math.max(0, override.actual_amount)
      : getBillMonthlyTotal(bill, month, year);
  }, [overrides, getBillMonthlyTotal]);

  const getMonthlyBills = useCallback(
    (month: number, year: number): Bill[] =>
      bills.filter(b => (b.is_recurring || b.is_debt) && (isBillActiveForMonth(b, month, year) || getBillOccurrencesInMonth(b, month, year).length > 0)),
    [bills, getBillOccurrencesInMonth]
  );

  // ─── Snowball / Avalanche ─────────────────────────────────────────────────────

  const runSnowball = useCallback(
    (month: number, year: number, extraAmount: number): SnowballAllocation[] => {
      if (!settings.debtPayoffEnabled) return [];
      const debts = bills.filter(b => b.is_debt && b.balance > 0 && isBillActiveForMonth(b, month, year)).map(b => ({
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
    [bills, settings.paymentMethod, settings.debtPayoffEnabled, getBillMonthlyTotal]
  );

  const saveExtraPayment = useCallback(async (month: number, year: number, amount: number, allocations: SnowballAllocation[], paymentDate?: string, sources: SnowballFundingSource[] = [{ type: "manual", amount }]) => {
    if (!user) return;
    assertCanEditHousehold("save an extra debt payment");
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
        supabase.from("extra_payments").update(payload).eq("id", existing.id),
        "Update extra payment"
      );
      setExtraPayments(prev => prev.map(ep => ep.id === existing.id ? { ...ep, ...payload } : ep));
    } else {
      const next: ExtraPayment = { id: genId(), month, year, ...payload };
      await ensureSaved(supabase.from("extra_payments").insert(scopedPayload({ ...next, user_id: user.id })), "Add extra payment");
      setExtraPayments(prev => [...prev, next]);
    }
  }, [user, extraPayments, demoMode, scopedPayload, assertCanEditHousehold]);

  const getExtraPayment = useCallback(
    (month: number, year: number) => extraPayments.find(ep => ep.month === month && ep.year === year),
    [extraPayments]
  );

  const getProjectedDebtSnowballMonth = useCallback((month: number, year: number) => {
    if (!settings.debtPayoffEnabled) return null;
    const now = new Date();
    const startMonth = now.getMonth();
    const startYear = now.getFullYear();
    if (year < startYear || (year === startYear && month < startMonth)) return null;

    const debtBills = bills.filter(bill => bill.is_debt);
    if (!debtBills.length) return null;

    let balances = new Map(debtBills.map(bill => [bill.id, Math.max(0, Number(bill.balance) || 0)]));
    let rolledPayment = 0;
    let result: ReturnType<typeof projectSnowballMonth> | null = null;
    let cursorMonth = startMonth;
    let cursorYear = startYear;
    let guard = 0;

    while ((cursorYear < year || (cursorYear === year && cursorMonth <= month)) && guard < 240) {
      const debtsForMonth: SnowballDebtInput[] = debtBills
        .filter(bill => isBillActiveForMonth(bill, cursorMonth, cursorYear))
        .map(bill => ({
          id: bill.id,
          name: bill.name,
          balance: balances.get(bill.id) ?? Math.max(0, Number(bill.balance) || 0),
          minimum: getBillMonthlyTotal(bill, cursorMonth, cursorYear),
          apr: Number(bill.interest_rate) || 0,
          dueDay: bill.due_day,
          included: bill.include_in_snowball !== false,
        }));
      const extra = extraPayments.find(payment => payment.month === cursorMonth && payment.year === cursorYear)?.amount ?? 0;
      result = projectSnowballMonth({
        debts: debtsForMonth,
        method: settings.paymentMethod,
        startingBalances: balances,
        rolledPayment,
        extraPayment: extra,
      });
      balances = result.balances;
      rolledPayment = result.rolledPayment;

      if (cursorYear === year && cursorMonth === month) break;
      cursorMonth += 1;
      if (cursorMonth > 11) {
        cursorMonth = 0;
        cursorYear += 1;
      }
      guard += 1;
    }

    return result;
  }, [bills, extraPayments, getBillMonthlyTotal, settings.paymentMethod, settings.debtPayoffEnabled]);

  const deleteExtraPayment = useCallback(async (id: string) => {
    if (!user) return;
    assertCanEditHousehold("delete an extra debt payment");
    if (demoMode) {
      setExtraPayments(prev => prev.filter(ep => ep.id !== id));
      return;
    }
    await ensureSaved(supabase.from("extra_payments").delete().eq("id", id), "Delete extra payment");
    setExtraPayments(prev => prev.filter(ep => ep.id !== id));
  }, [user, demoMode, assertCanEditHousehold]);

  const applyDebtSnowballPayment = useCallback(async (
    preview: SnowballProjectionResult,
    sources: SnowballFundingSource[] = [{ type: "manual", amount: preview.selectedExtra }],
  ) => {
    if (!user) return;
    if (!settings.debtPayoffEnabled) throw new Error("Turn on Debt Payoff Plan before applying an automatic debt payment.");
    assertCanEditHousehold("apply a debt snowball payment");
    const [year, monthNumber] = preview.paymentDate.split("-").map(Number);
    const month = monthNumber - 1;
    const existing = extraPayments.find(ep => ep.month === month && ep.year === year);
    const paymentId = existing?.id ?? genId();
    const payloadSources = markSnowballSourcesPending(sources);

    if (demoMode) {
      const nextPayment: ExtraPayment = {
        id: paymentId, month, year,
        amount: preview.selectedExtra, allocations: preview.allocations,
        payment_date: preview.paymentDate, sources: payloadSources,
      };
      setExtraPayments(prev => existing
        ? prev.map(ep => ep.id === existing.id ? nextPayment : ep)
        : [...prev, nextPayment]);
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
      p_household_id: householdScopeRef.current?.householdId ?? null,
      p_apply_now: false,
    });
    if (error) throw new Error(`Apply debt snowball: ${error.message}`);
    const rollover = await supabase.rpc("recalculate_debt_minimum_boosts", { p_household_id: householdScopeRef.current?.householdId ?? null });
    if (rollover.error) throw new Error(`Roll debt minimum: ${rollover.error.message}`);

    const [overrideResult, billsResult] = await Promise.all([
      applyHouseholdSelect(supabase.from("monthly_overrides").select("*"), user.id).eq("month", month).eq("year", year),
      applyHouseholdSelect(supabase.from("bills").select("*"), user.id),
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
  }, [user, extraPayments, demoMode, applyHouseholdSelect, assertCanEditHousehold, settings.debtPayoffEnabled]);

  const removeDebtSnowballPayment = useCallback(async (month: number, year: number) => {
    const existing = extraPayments.find(ep => ep.month === month && ep.year === year);
    if (!existing || !user) return;
    assertCanEditHousehold("remove a debt snowball payment");
    if (demoMode) {
      setExtraPayments(prev => prev.filter(ep => ep.id !== existing.id));
      return;
    }
    if (hasPendingSnowballBalanceApply(existing)) {
      await deleteExtraPayment(existing.id);
      return;
    }
    const { error } = await supabase.rpc("remove_debt_snowball_payment", { p_month: month, p_year: year, p_household_id: householdScopeRef.current?.householdId ?? null });
    if (error) throw new Error(`Remove debt snowball: ${error.message}`);
    const rollover = await supabase.rpc("recalculate_debt_minimum_boosts", { p_household_id: householdScopeRef.current?.householdId ?? null });
    if (rollover.error) throw new Error(`Restore debt minimum: ${rollover.error.message}`);
    const [overrideResult, billsResult] = await Promise.all([
      applyHouseholdSelect(supabase.from("monthly_overrides").select("*"), user.id).eq("month", month).eq("year", year),
      applyHouseholdSelect(supabase.from("bills").select("*"), user.id),
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
  }, [user, extraPayments, deleteExtraPayment, demoMode, applyHouseholdSelect, assertCanEditHousehold]);

  const repairingAppliedSnowballPlans = useRef(new Set<string>());
  useEffect(() => {
    if (!user || demoMode) return;
    const appliedPlans = extraPayments.filter(payment =>
      !hasPendingSnowballBalanceApply(payment) &&
      payment.allocations.length > 0 &&
      !repairingAppliedSnowballPlans.current.has(payment.id)
    );
    appliedPlans.forEach(payment => {
      repairingAppliedSnowballPlans.current.add(payment.id);
      const preview: SnowballProjectionResult = {
        safeMaximum: payment.amount,
        selectedExtra: payment.amount,
        paymentDate: payment.payment_date ?? `${payment.year}-${String(payment.month + 1).padStart(2, "0")}-01`,
        allocations: payment.allocations.map(allocation => ({
          ...allocation,
          paymentDate: allocation.paymentDate
            ?? payment.payment_date
            ?? `${payment.year}-${String(payment.month + 1).padStart(2, "0")}-01`,
        })),
        months: [],
        payoffOrder: [],
        debtFreeDate: null,
        lowestSixMonthBalance: 0,
      };
      void applyDebtSnowballPayment(
        preview,
        payment.sources ?? [{ type: "manual", amount: payment.amount }],
      )
        .catch(error => markSaveFailed(error, async () => undefined))
        .finally(() => repairingAppliedSnowballPlans.current.delete(payment.id));
    });
  }, [user, extraPayments, applyDebtSnowballPayment, markSaveFailed, demoMode]);

  const finalizeBillPayment = useCallback(async (billId: string, month: number, year: number, actualAmount: number, paidDate: string) => {
    assertCanEditHousehold("finalize a bill payment");
    const bill = bills.find(b => b.id === billId);
    if (!bill) throw new Error("Bill not found");
    const budgeted = getBillMonthlyTotal(bill, month, year);
    const actual = Math.max(0, Number(actualAmount) || 0);
    await upsertOverride(billId, month, year, { actual_amount: actual, paid_amount: actual, paid_date: paidDate });
    return { budgeted, actual, surplus: Math.max(0, budgeted - actual) };
  }, [bills, getBillMonthlyTotal, upsertOverride, assertCanEditHousehold]);

  // ─── Transactions ─────────────────────────────────────────────────────────────

  const refreshDebtRows = useCallback(async () => {
    if (!user) return;
    const [billRows, transactionRows] = await Promise.all([
      applyHouseholdSelect(supabase.from("bills").select("*"), user.id),
      applyHouseholdSelect(supabase.from("transactions").select("*"), user.id),
    ]);
    if (billRows.error) throw new Error(`Refresh debts: ${billRows.error.message}`);
    if (transactionRows.error) throw new Error(`Refresh transactions: ${transactionRows.error.message}`);
    setBills(reorderDebtPriorities((billRows.data ?? []).map(normalizeBillRow)));
    const transactionCollections = splitTransactionRows(transactionRows.data ?? []);
    setTransactions(transactionCollections.active);
    setDeletedTransactions(transactionCollections.deleted);
  }, [user, applyHouseholdSelect]);

  const syncDebtTransactionsClientSide = useCallback(async () => {
    if (!user || demoMode) return;
    const [billRows, transactionRows] = await Promise.all([
      applyHouseholdSelect(supabase.from("bills").select("*"), user.id),
      applyHouseholdSelect(supabase.from("transactions").select("*"), user.id),
    ]);
    if (billRows.error) throw new Error(`Sync debt payments: ${billRows.error.message}`);
    if (transactionRows.error) throw new Error(`Sync debt payments: ${transactionRows.error.message}`);

    const debtMap = new Map<string, Bill>();
    for (const bill of (billRows.data ?? []).map(normalizeBillRow)) {
      if (bill.is_debt) debtMap.set(bill.id, { ...bill });
    }

    const today = localDateString();
    const transactionsToCheck: Transaction[] = (transactionRows.data ?? [])
      .map(normalizeTransactionRow)
      .filter(isActiveTransaction)
      .filter((transaction: Transaction) => transaction.linked_bill_id || transaction.debt_applied_bill_id || Number(transaction.debt_applied_amount ?? 0) > 0)
      .sort((left: Transaction, right: Transaction) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id));

    const changedBills = new Map<string, Bill>();
    const changedTransactions: Array<{ id: string; debt_applied_amount: number; debt_applied_bill_id: string | null }> = [];

    for (const transaction of transactionsToCheck) {
      const previousDebtId = transaction.debt_applied_bill_id;
      const previousApplied = Math.max(0, Number(transaction.debt_applied_amount ?? 0) || 0);
      if (previousDebtId && previousApplied > 0.005) {
        const previousDebt = debtMap.get(previousDebtId);
        if (previousDebt) {
          previousDebt.balance = roundMoney(previousDebt.balance + previousApplied);
          changedBills.set(previousDebt.id, previousDebt);
        }
      }

      let nextDebtId: string | null = null;
      let nextApplied = 0;
      const targetDebt = transaction.linked_bill_id ? debtMap.get(transaction.linked_bill_id) : undefined;
      if (
        targetDebt
        && transaction.source !== SNOWBALL_PLAN_SOURCE
        && Number(transaction.amount) < -0.005
        && transaction.date <= today
      ) {
        const desiredPayment = roundMoney(Math.abs(Number(transaction.amount) || 0));
        nextApplied = roundMoney(Math.min(desiredPayment, Math.max(0, targetDebt.balance)));
        if (nextApplied > 0.005) {
          targetDebt.balance = roundMoney(Math.max(0, targetDebt.balance - nextApplied));
          nextDebtId = targetDebt.id;
          changedBills.set(targetDebt.id, targetDebt);
        }
      }

      if (
        (previousDebtId ?? null) !== nextDebtId ||
        Math.abs(previousApplied - nextApplied) > 0.005
      ) {
        changedTransactions.push({
          id: transaction.id,
          debt_applied_amount: nextApplied,
          debt_applied_bill_id: nextDebtId,
        });
      }
    }

    await Promise.all([
      ...Array.from(changedBills.values()).map(debt =>
        ensureSaved(
          supabase.from("bills").update({ balance: debt.balance }).eq("id", debt.id),
          `Apply debt payment to ${debt.name}`,
        )
      ),
      ...changedTransactions.map(transaction =>
        ensureSaved(
          supabase.from("transactions").update({
            debt_applied_amount: transaction.debt_applied_amount,
            debt_applied_bill_id: transaction.debt_applied_bill_id,
          }).eq("id", transaction.id),
          "Mark debt payment applied",
        )
      ),
    ]);

    const rollover = await supabase.rpc("recalculate_debt_minimum_boosts", { p_household_id: householdScopeRef.current?.householdId ?? null });
    if (rollover.error) console.warn("Debt minimum rollover skipped", rollover.error.message);
    await refreshDebtRows();
  }, [user, demoMode, applyHouseholdSelect, refreshDebtRows]);

  const restoreDebtApplicationsForTransactions = useCallback(async (items: Transaction[]) => {
    const appliedItems = items.filter(item => item.debt_applied_bill_id && Number(item.debt_applied_amount ?? 0) > 0.005);
    if (!user || demoMode || appliedItems.length === 0) return;

    const restores = new Map<string, number>();
    for (const item of appliedItems) {
      const debtId = item.debt_applied_bill_id;
      if (!debtId) continue;
      restores.set(debtId, roundMoney((restores.get(debtId) ?? 0) + Math.max(0, Number(item.debt_applied_amount ?? 0) || 0)));
    }

    await Promise.all(Array.from(restores.entries()).map(([debtId, amount]) => {
      const debt = bills.find(item => item.id === debtId);
      if (!debt) return Promise.resolve();
      const nextBalance = roundMoney(Math.max(0, Number(debt.balance) || 0) + amount);
      return ensureSaved(
        supabase.from("bills").update({ balance: nextBalance }).eq("id", debtId),
        `Restore debt payment for ${debt.name}`,
      );
    }));

    setBills(previous => reorderDebtPriorities(previous.map(bill => {
      const amount = restores.get(bill.id);
      if (!amount) return bill;
      return { ...bill, balance: roundMoney(Math.max(0, Number(bill.balance) || 0) + amount) };
    })));
  }, [user, demoMode, bills]);

  const syncDebtTransactionsAndRefresh = useCallback(async () => {
    if (!user || demoMode) return;
    if (!canEditHousehold) return;
    const synced = await supabase.rpc("sync_due_debt_transactions", {
      p_as_of_date: localDateString(),
      p_household_id: householdScopeRef.current?.householdId ?? null,
    });
    if (synced.error) {
      console.warn("Scheduled debt sync skipped", synced.error.message);
      await syncDebtTransactionsClientSide();
      return;
    }
    await refreshDebtRows();
  }, [user, demoMode, canEditHousehold, syncDebtTransactionsClientSide, refreshDebtRows]);

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
    assertCanEditHousehold("add a transaction");
    const defaultAccountId = accounts.find(account => account.is_active)?.id;
    const nt: Transaction = { ...tx, account_id: tx.account_id ?? defaultAccountId, id: genId() };
    if (demoMode) {
      setTransactions(prev => [...prev, nt]);
      return nt.id;
    }
    await ensureSaved(supabase.from("transactions").insert(scopedPayload({ ...nt, user_id: user.id })), "Add transaction");
    setTransactions(prev => [...prev, nt]);
    if (nt.linked_bill_id || nt.debt_applied_bill_id) await syncDebtTransactionsAndRefresh();
    return nt.id;
  }, [user, accounts, syncDebtTransactionsAndRefresh, demoMode, scopedPayload, assertCanEditHousehold]);

  const updateTransaction = useCallback(async (tx: Transaction) => {
    if (!user) return;
    assertCanEditHousehold("update a transaction");
    const existing = transactions.find(item => item.id === tx.id);
    const editedTransaction: Transaction = { ...tx, user_edited_at: new Date().toISOString() };
    setTransactions(prev => prev.map(t => t.id === tx.id ? editedTransaction : t));
    if (demoMode) return;
    markSaveStarted();
    try {
      const persisted = await supabase.from("transactions")
        .update({ ...editedTransaction })
        .eq("id", tx.id)
        .select("*")
        .single();
      if (persisted.error) throw new Error(`Update transaction: ${persisted.error.message}`);
      const savedTransaction = normalizeTransactionRow(persisted.data);
      setTransactions(prev => prev.map(item => item.id === tx.id ? savedTransaction : item));
      markSaveCompleted();
    } catch (error) {
      if (existing) setTransactions(prev => prev.map(item => item.id === existing.id ? existing : item));
      markSaveFailed(error, () => updateTransaction(editedTransaction));
      throw error;
    }
    if (editedTransaction.linked_bill_id || existing?.linked_bill_id || existing?.debt_applied_bill_id) {
      try {
        await syncDebtTransactionsAndRefresh();
      } catch (error) {
        console.warn("Transaction saved; debt sync will retry", diagnosticErrorCode(error));
        void recordDiagnostic(user.id, {
          eventType: "save_failure", operation: "reconciliation", platform: diagnosticPlatform(),
          errorCode: diagnosticErrorCode(error),
        }).catch(() => undefined);
      }
    }
  }, [user, transactions, syncDebtTransactionsAndRefresh, demoMode, markSaveStarted, markSaveCompleted, markSaveFailed, assertCanEditHousehold]);

  const refreshBillMatchData = useCallback(async () => {
    if (!user || demoMode) return;
    const [transactionRows, overrideRows, goalRows, decisionRows] = await Promise.all([
      applyHouseholdSelect(supabase.from("transactions").select("*"), user.id),
      applyHouseholdSelect(supabase.from("monthly_overrides").select("*"), user.id),
      applyHouseholdSelect(supabase.from("goals").select("*"), user.id),
      applyHouseholdSelect(supabase.from("decisions").select("*"), user.id),
    ]);
    if (transactionRows.error) throw new Error(`Refresh matched transaction: ${transactionRows.error.message}`);
    if (overrideRows.error) throw new Error(`Refresh matched bill: ${overrideRows.error.message}`);
    if (goalRows.error) throw new Error(`Refresh planned expense: ${goalRows.error.message}`);
    if (decisionRows.error) throw new Error(`Refresh calendar plan: ${decisionRows.error.message}`);
    const transactionCollections = splitTransactionRows(transactionRows.data ?? []);
    setTransactions(transactionCollections.active);
    setDeletedTransactions(transactionCollections.deleted);
    const nextOverrides = (overrideRows.data ?? []).map(normalizeMonthlyOverrideRow);
    overridesRef.current = nextOverrides;
    setOverrides(nextOverrides);
    setGoals((goalRows.data ?? []).map((goal: any) => ({
      ...goal,
      target_amount: Number(goal.target_amount),
      current_amount: Number(goal.current_amount),
      goal_type: goal.goal_type ?? (Number(goal.current_amount) < 0 ? "planned_expense" : "savings"),
    })));
    setDecisions((decisionRows.data ?? []).map((decision: any) => ({
      ...decision,
      scenario: decision.scenario ?? {},
      result: decision.result ?? {},
    })));
  }, [user, demoMode, applyHouseholdSelect]);

  const reconcileTransaction = useCallback(async (input: ReconcileTransactionInput) => {
    if (!user) throw new Error("Sign in to review transactions");
    assertCanEditHousehold("review transactions");
    const transaction = transactions.find(item => item.id === input.transactionId);
    if (!transaction) throw new Error("Transaction not found");

    if (demoMode) {
      const allocation: ReviewAllocation = {
        type: input.resolution === "bill" ? "bill"
          : input.resolution === "income" ? "income"
          : input.resolution === "goal" || input.resolution === "decision" ? "planned_expense"
          : input.resolution,
        targetId: input.targetId,
        category: input.resolution === "category" ? input.targetId : undefined,
        amount: Math.abs(transaction.amount),
        plannedAmount: input.plannedAmount,
        occurrenceDate: input.occurrenceDate,
        settlement: input.settlement ?? "regular",
      };
      setTransactions(previous => previous.map(item => item.id === input.transactionId ? {
        ...item,
        category: input.resolution === "category" ? input.targetId ?? item.category
          : input.resolution === "transfer" ? "Transfer"
          : input.resolution === "income" ? "Income"
          : item.category,
        linked_bill_id: input.resolution === "bill" ? input.targetId : undefined,
        linked_income_id: input.resolution === "income" ? input.targetId : undefined,
        linked_plan_id: input.resolution === "goal" || input.resolution === "decision" ? input.targetId : undefined,
        linked_plan_type: input.resolution === "goal" || input.resolution === "decision" ? input.resolution : undefined,
        matched_occurrence_date: input.occurrenceDate,
        match_confidence: input.resolution === "category" || input.resolution === "transfer" ? undefined : 1,
        match_reason: input.resolution === "bill" ? "confirmed_bill_match"
          : input.resolution === "income" ? "confirmed_income_match"
          : input.resolution === "goal" || input.resolution === "decision" ? "confirmed_plan_match"
          : undefined,
        review_status: input.resolution === "category" ? "categorized" : input.resolution === "transfer" ? "transfer" : "matched",
        review_resolution: input.resolution,
        review_allocations: [allocation],
        reviewed_at: new Date().toISOString(),
      } : item));
      return;
    }

    markSaveStarted();
    try {
      const result = await supabase.rpc("reconcile_transaction", {
        p_transaction_id: input.transactionId,
        p_resolution: input.resolution,
        p_target_id: input.targetId ?? null,
        p_occurrence_date: input.occurrenceDate ?? null,
        p_planned_amount: input.plannedAmount ?? null,
        p_settlement: input.settlement ?? null,
        p_extra_category: input.extraCategory ?? null,
      });
      if (result.error) throw new Error(`Review transaction: ${result.error.message}`);
      await refreshBillMatchData();
      if (input.resolution === "bill" && bills.some(bill => bill.id === input.targetId && bill.is_debt)) {
        await syncDebtTransactionsAndRefresh();
      }
      markSaveCompleted();
    } catch (error) {
      markSaveFailed(error, () => reconcileTransaction(input));
      throw error;
    }
  }, [user, assertCanEditHousehold, transactions, bills, demoMode, refreshBillMatchData, syncDebtTransactionsAndRefresh, markSaveStarted, markSaveCompleted, markSaveFailed]);

  const undoTransactionReconciliation = useCallback(async (transactionId: string) => {
    if (!user) throw new Error("Sign in to undo this review");
    assertCanEditHousehold("undo a transaction review");
    const reviewedTransaction = transactions.find(item => item.id === transactionId);
    const wasDebtMatch = Boolean(reviewedTransaction?.linked_bill_id && bills.some(bill => bill.id === reviewedTransaction.linked_bill_id && bill.is_debt));
    if (demoMode) {
      setTransactions(previous => previous.map(item => item.id === transactionId ? {
        ...item,
        linked_bill_id: undefined,
        linked_income_id: undefined,
        linked_plan_id: undefined,
        linked_plan_type: undefined,
        matched_occurrence_date: undefined,
        match_confidence: undefined,
        match_reason: undefined,
        review_status: item.source === "plaid" ? "needs_review" : "legacy_reviewed",
        review_resolution: undefined,
        review_allocations: [],
        reviewed_at: undefined,
      } : item));
      return;
    }
    markSaveStarted();
    try {
      const result = await supabase.rpc("undo_transaction_reconciliation", { p_transaction_id: transactionId });
      if (result.error) throw new Error(`Undo review: ${result.error.message}`);
      await refreshBillMatchData();
      if (wasDebtMatch) await syncDebtTransactionsAndRefresh();
      markSaveCompleted();
    } catch (error) {
      markSaveFailed(error, () => undoTransactionReconciliation(transactionId));
      throw error;
    }
  }, [user, assertCanEditHousehold, transactions, bills, demoMode, refreshBillMatchData, syncDebtTransactionsAndRefresh, markSaveStarted, markSaveCompleted, markSaveFailed]);

  const matchTransactionToBill = useCallback(async (transactionId: string, billId: string, occurrenceDate?: string, plannedAmount?: number) => {
    if (!user) throw new Error("Sign in to match a bill");
    assertCanEditHousehold("match a transaction to a bill");
    const transaction = transactions.find(item => item.id === transactionId);
    const bill = bills.find(item => item.id === billId);
    if (!transaction || !bill) throw new Error("Transaction or bill not found");
    if (transaction.amount >= 0) throw new Error("Only money-out transactions can be matched to bills");

    const actual = Math.abs(transaction.amount);
    const planned = plannedAmount ?? bill.amount;
    await reconcileTransaction({
      transactionId,
      resolution: "bill",
      targetId: billId,
      occurrenceDate: occurrenceDate ?? transaction.date,
      plannedAmount: planned,
      settlement: Math.abs(actual - planned) < 0.005 ? "exact" : actual < planned ? "partial" : "full",
    });
  }, [user, transactions, bills, reconcileTransaction, assertCanEditHousehold]);

  const unmatchTransactionFromBill = useCallback(async (transactionId: string) => {
    if (!user) throw new Error("Sign in to unmatch a bill");
    assertCanEditHousehold("unmatch a transaction from a bill");
    const transaction = transactions.find(item => item.id === transactionId);
    if (!transaction || !isConfirmedBillMatch(transaction)) throw new Error("This transaction is not matched to a bill");
    await undoTransactionReconciliation(transactionId);
  }, [user, transactions, bills, undoTransactionReconciliation, assertCanEditHousehold]);

  const deleteTransfer = useCallback(async (transferGroupId: string) => {
    if (!user) return;
    assertCanEditHousehold("delete a transfer");
    const idsToDelete = transactions
      .filter(transaction => transaction.transfer_group_id === transferGroupId)
      .map(transaction => transaction.id);
    if (idsToDelete.length === 0) return;
    const deletedAt = new Date().toISOString();
    if (demoMode) {
      const archived = transactions
        .filter(transaction => idsToDelete.includes(transaction.id))
        .map(transaction => ({ ...transaction, deleted_at: deletedAt, deleted_by: user.id }));
      setTransactions(prev => prev.filter(transaction => !idsToDelete.includes(transaction.id)));
      setDeletedTransactions(prev => [...archived, ...prev.filter(transaction => !idsToDelete.includes(transaction.id))]);
      return;
    }
    await restoreDebtApplicationsForTransactions(transactions.filter(transaction => idsToDelete.includes(transaction.id)));
    const { data, error } = await supabase
      .from("transactions")
      .update({ deleted_at: deletedAt, deleted_by: user.id })
      .eq("transfer_group_id", transferGroupId)
      .select("*");
    if (error) throw new Error(`Delete transfer: ${error.message}`);
    const archived = (data ?? []).map(normalizeTransactionRow);
    setTransactions(prev => prev.filter(t => !idsToDelete.includes(t.id)));
    setDeletedTransactions(prev => [...archived, ...prev.filter(transaction => !idsToDelete.includes(transaction.id))]);
    if (idsToDelete.some(txId => transactions.find(transaction => transaction.id === txId)?.debt_applied_bill_id)) await syncDebtTransactionsAndRefresh();
  }, [user, transactions, restoreDebtApplicationsForTransactions, syncDebtTransactionsAndRefresh, demoMode, assertCanEditHousehold]);

  const deleteTransaction = useCallback(async (id: string) => {
    if (!user) return;
    assertCanEditHousehold("delete a transaction");
    const existing = transactions.find(transaction => transaction.id === id);
    const groupId = existing?.transfer_group_id;
    if (groupId) {
      await deleteTransfer(groupId);
      return;
    }
    if (existing?.review_status === "matched") {
      await undoTransactionReconciliation(existing.id);
    } else if (existing && isConfirmedBillMatch(existing)) {
      await unmatchTransactionFromBill(existing.id);
    }
    const idsToDelete = [id];
    const deletedAt = new Date().toISOString();
    if (demoMode) {
      if (existing) {
        const archived = { ...existing, deleted_at: deletedAt, deleted_by: user.id };
        setDeletedTransactions(prev => [archived, ...prev.filter(transaction => transaction.id !== id)]);
      }
      setTransactions(prev => prev.filter(t => t.id !== id));
      return;
    }
    await restoreDebtApplicationsForTransactions(transactions.filter(transaction => idsToDelete.includes(transaction.id)));
    const { data, error } = await supabase
      .from("transactions")
      .update({ deleted_at: deletedAt, deleted_by: user.id })
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw new Error(`Delete transaction: ${error.message}`);
    const archived = normalizeTransactionRow(data);
    setTransactions(prev => prev.filter(t => t.id !== id));
    setDeletedTransactions(prev => [archived, ...prev.filter(transaction => transaction.id !== id)]);
    if (idsToDelete.some(txId => transactions.find(transaction => transaction.id === txId)?.debt_applied_bill_id)) await syncDebtTransactionsAndRefresh();
  }, [user, transactions, restoreDebtApplicationsForTransactions, syncDebtTransactionsAndRefresh, demoMode, deleteTransfer, unmatchTransactionFromBill, undoTransactionReconciliation, assertCanEditHousehold]);

  const restoreDeletedTransaction = useCallback(async (id: string) => {
    if (!user) throw new Error("Sign in to restore a transaction");
    assertCanEditHousehold("restore a deleted transaction");
    const archived = deletedTransactions.find(transaction => transaction.id === id);
    if (!archived) throw new Error("Deleted transaction not found");
    const idsToRestore = archived.transfer_group_id
      ? deletedTransactions.filter(transaction => transaction.transfer_group_id === archived.transfer_group_id).map(transaction => transaction.id)
      : [id];

    if (demoMode) {
      const restored = deletedTransactions
        .filter(transaction => idsToRestore.includes(transaction.id))
        .map(transaction => ({ ...transaction, deleted_at: undefined, deleted_by: undefined }));
      setDeletedTransactions(prev => prev.filter(transaction => !idsToRestore.includes(transaction.id)));
      setTransactions(prev => [...prev, ...restored.filter(isActiveTransaction)]);
      return;
    }

    const query = supabase
      .from("transactions")
      .update({ deleted_at: null, deleted_by: null })
      .in("id", idsToRestore);
    const { data, error } = await query.select("*");
    if (error) throw new Error(`Restore transaction: ${error.message}`);
    const restored = (data ?? []).map(normalizeTransactionRow);
    setDeletedTransactions(prev => prev.filter(transaction => !idsToRestore.includes(transaction.id)));
    setTransactions(prev => [
      ...prev.filter(transaction => !idsToRestore.includes(transaction.id)),
      ...restored.filter(isActiveTransaction),
    ]);
  }, [user, deletedTransactions, demoMode, assertCanEditHousehold]);

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
    assertCanEditHousehold("add income");
    const ni: IncomeItem = { ...item, id: genId() };
    if (demoMode) {
      setIncomes(prev => [...prev, ni]);
      return ni.id;
    }
    await ensureSaved(supabase.from("incomes").insert(scopedPayload({ ...ni, amount_history: ni.amount_history ?? [], user_id: user.id })), "Add income");
    setIncomes(prev => [...prev, ni]);
    return ni.id;
  }, [user, demoMode, scopedPayload, assertCanEditHousehold]);

  const updateIncome = useCallback(async (item: IncomeItem) => {
    if (!user) return;
    assertCanEditHousehold("update income");
    const existing = incomes.find(income => income.id === item.id);
    const reviewedItem = { ...item, last_reviewed_at: new Date().toISOString() };
    setIncomes(prev => prev.map(i => i.id === item.id ? reviewedItem : i));
    if (demoMode) return;
    markSaveStarted();
    try {
    await ensureSaved(supabase.from("incomes").update({ ...reviewedItem, amount_history: item.amount_history ?? [] }).eq("id", item.id), "Update income");
      markSaveCompleted();
    } catch (error) {
      if (existing) setIncomes(prev => prev.map(income => income.id === existing.id && income === item ? existing : income));
      markSaveFailed(error, () => updateIncome(item));
      throw error;
    }
  }, [user, incomes, demoMode, markSaveStarted, markSaveCompleted, markSaveFailed, assertCanEditHousehold]);

  const deleteIncome = useCallback(async (id: string) => {
    if (!user) return;
    assertCanEditHousehold("delete income");
    if (demoMode) {
      setIncomes(prev => prev.filter(i => i.id !== id));
      return;
    }
    await ensureSaved(supabase.from("incomes").delete().eq("id", id), "Delete income");
    setIncomes(prev => prev.filter(i => i.id !== id));
  }, [user, demoMode, assertCanEditHousehold]);

  const getMonthlyIncome = useCallback(
    (month?: number, year?: number) =>
      incomes
        .filter(i => month !== undefined && year !== undefined ? isIncomeActiveForMonth(i, month, year) : true)
        .reduce((s, i) => {
          if (month !== undefined && year !== undefined) {
            const amt = getEffectiveIncomeAmount(i, month, year);
            return s + getIncomeOccurrenceDays(i, month, year).length * amt;
          }
          return s + incomeToMonthly(getLatestRecordedIncomeAmount(i), i.frequency);
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
    if (!user) throw new Error("Sign in to add a goal");
    assertCanEditHousehold("add a goal");
    const ng: Goal = { ...goal, id: genId(), created_at: new Date().toISOString() };
    if (demoMode) {
      setGoals(prev => [...prev, ng]);
      return ng.id;
    }
    await ensureSaved(supabase.from("goals").insert(scopedPayload({ ...ng, user_id: user.id })), "Add goal");
    setGoals(prev => [...prev, ng]);
    return ng.id;
  }, [user, demoMode, scopedPayload, assertCanEditHousehold]);

  const updateGoal = useCallback(async (goal: Goal) => {
    if (!user) return;
    assertCanEditHousehold("update a goal");
    const existing = goals.find(item => item.id === goal.id);
    setGoals(prev => prev.map(g => g.id === goal.id ? goal : g));
    if (demoMode) return;
    markSaveStarted();
    try {
    await ensureSaved(supabase.from("goals").update({ ...goal }).eq("id", goal.id), "Update goal");
      markSaveCompleted();
    } catch (error) {
      if (existing) setGoals(prev => prev.map(item => item.id === existing.id && item === goal ? existing : item));
      markSaveFailed(error, () => updateGoal(goal));
      throw error;
    }
  }, [user, goals, demoMode, markSaveStarted, markSaveCompleted, markSaveFailed, assertCanEditHousehold]);

  const closeSpendingBucket = useCallback(async (id: string) => {
    if (!user) throw new Error("Sign in to close a spending bucket");
    assertCanEditHousehold("close a spending bucket");
    const goal = goals.find(item => item.id === id);
    if (!goal || goal.goal_type !== "planned_expense") throw new Error("Spending bucket not found");
    const summary = spendingBucketSummary(goal);
    const spent = summary.spent;
    const released = summary.closed ? summary.released : Math.max(0, summary.planned - summary.spent);
    if (goal.closed_at) return { spent, released };
    const closedAt = new Date().toISOString();
    const closedGoal = { ...goal, closed_at: closedAt, closed_by: user.id };
    setGoals(prev => prev.map(item => item.id === id ? closedGoal : item));
    if (demoMode) return { spent, released };
    try {
      await ensureSaved(
        supabase.from("goals").update({ closed_at: closedAt, closed_by: user.id }).eq("id", id),
        "Close spending bucket",
      );
      return { spent, released };
    } catch (error) {
      setGoals(prev => prev.map(item => item.id === id ? goal : item));
      throw error;
    }
  }, [user, goals, demoMode, assertCanEditHousehold]);

  const reopenSpendingBucket = useCallback(async (id: string) => {
    if (!user) throw new Error("Sign in to reopen a spending bucket");
    assertCanEditHousehold("reopen a spending bucket");
    const goal = goals.find(item => item.id === id);
    if (!goal || goal.goal_type !== "planned_expense") throw new Error("Spending bucket not found");
    const reopenedGoal = { ...goal, closed_at: undefined, closed_by: undefined };
    setGoals(prev => prev.map(item => item.id === id ? reopenedGoal : item));
    if (demoMode) return;
    try {
      await ensureSaved(
        supabase.from("goals").update({ closed_at: null, closed_by: null }).eq("id", id),
        "Reopen spending bucket",
      );
    } catch (error) {
      setGoals(prev => prev.map(item => item.id === id ? goal : item));
      throw error;
    }
  }, [user, goals, demoMode, assertCanEditHousehold]);

  const archiveSpendingBucket = useCallback(async (id: string) => {
    if (!user) throw new Error("Sign in to archive a spending bucket");
    assertCanEditHousehold("archive a spending bucket");
    const goal = goals.find(item => item.id === id);
    if (!goal || goal.goal_type !== "planned_expense") throw new Error("Spending bucket not found");
    if (!goal.closed_at) throw new Error("Close this spending bucket before archiving it");
    const archivedAt = new Date().toISOString();
    const archivedGoal = { ...goal, archived_at: archivedAt, archived_by: user.id };
    setGoals(previous => previous.map(item => item.id === id ? archivedGoal : item));
    if (demoMode) return;
    try {
      await ensureSaved(
        supabase.from("goals").update({ archived_at: archivedAt, archived_by: user.id }).eq("id", id),
        "Archive spending bucket",
      );
    } catch (error) {
      setGoals(previous => previous.map(item => item.id === id ? goal : item));
      throw error;
    }
  }, [user, goals, demoMode, assertCanEditHousehold]);

  const restoreArchivedSpendingBucket = useCallback(async (id: string) => {
    if (!user) throw new Error("Sign in to restore a spending bucket");
    assertCanEditHousehold("restore a spending bucket");
    const goal = goals.find(item => item.id === id);
    if (!goal || goal.goal_type !== "planned_expense") throw new Error("Spending bucket not found");
    const restoredGoal = { ...goal, archived_at: undefined, archived_by: undefined };
    setGoals(previous => previous.map(item => item.id === id ? restoredGoal : item));
    if (demoMode) return;
    try {
      await ensureSaved(
        supabase.from("goals").update({ archived_at: null, archived_by: null }).eq("id", id),
        "Restore spending bucket",
      );
    } catch (error) {
      setGoals(previous => previous.map(item => item.id === id ? goal : item));
      throw error;
    }
  }, [user, goals, demoMode, assertCanEditHousehold]);

  const deleteGoal = useCallback(async (id: string) => {
    if (!user) return;
    assertCanEditHousehold("delete a goal");
    if (demoMode) {
      setGoals(prev => prev.filter(g => g.id !== id));
      return;
    }
    await ensureSaved(supabase.from("goals").delete().eq("id", id), "Delete goal");
    setGoals(prev => prev.filter(g => g.id !== id));
  }, [user, demoMode, assertCanEditHousehold]);

  const checkGoalAffordability = useCallback(
    (goal: Goal, month: number, year: number): GoalAffordability => {
      const monthNet = (m: number, y: number): number => {
        const inc = incomes.reduce((s, i) => s + getIncomeOccurrenceDays(i, m, y).length * getEffectiveIncomeAmount(i, m, y), 0);
        const bil = bills.filter(b => b.is_recurring || b.is_debt).reduce((s, b) => {
          const occ = getBillOccurrencesInMonth(b, m, y);
          if (occ.length === 0) return s;
          return s + getBillEffectiveMonthlyTotal(b, m, y);
        }, 0);
        const tx = transactions
          .filter(t => { const [ty, tm] = t.date.split("-").map(Number); return ty === y && tm === m + 1; })
          .reduce((s, t) => s + t.amount, 0);
        const snowballExtra = extraPayments.find(ep => ep.month === m && ep.year === y)?.amount ?? 0;
        const monthPrefix = `${y}-${String(m + 1).padStart(2, "0")}`;
        const monthEnd = `${monthPrefix}-${String(new Date(y, m + 1, 0).getDate()).padStart(2, "0")}`;
        const plannedDecisionNet = decisions
          .filter(d => d.status === "planned" || d.status === "calendar")
          .reduce((sum, d) => {
            const occurrences = scenarioDates(d.scenario, monthEnd).filter(date => date.startsWith(monthPrefix)).length;
            const signedAmount = d.scenario.type === "income_change" ? Math.abs(d.scenario.amount) : -Math.abs(d.scenario.amount);
            return sum + occurrences * signedAmount;
          }, 0);
        return inc + tx - bil - snowballExtra + plannedDecisionNet;
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
    [bills, incomes, transactions, extraPayments, decisions, settings, getBillOccurrencesInMonth, getBillEffectiveMonthlyTotal]
  );

  // ─── Cash Flow ────────────────────────────────────────────────────────────────

  const getCashFlow = useCallback((month: number, year: number): CashFlow => {
    const billMatches = matchedOccurrenceAllocations(transactions, "bill");
    const incomeMatches = matchedOccurrenceAllocations(transactions, "income");
    const monthlyIncome = incomes
      .filter(i => isIncomeActiveForMonth(i, month, year))
      .reduce((sum, income) => {
        const amount = getEffectiveIncomeAmount(income, month, year);
        return sum + getIncomeOccurrenceDays(income, month, year).reduce((occurrenceSum, day) => {
          const date = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const match = incomeMatches.get(occurrenceKey(income.id, date));
          const remaining = match?.settlement === "partial"
            ? Math.max(0, Number(match.plannedAmount ?? amount) - Number(match.amount || 0))
            : match ? 0 : amount;
          return occurrenceSum + remaining;
        }, 0);
      }, 0);
    const activeBills = getMonthlyBills(month, year);
    const totalBillsDue = activeBills.reduce((sum, bill) => {
      const occurrences = getBillOccurrencesInMonth(bill, month, year);
      const amount = occurrences.length > 0 ? getBillMonthlyTotal(bill, month, year) / occurrences.length : 0;
      return sum + occurrences.reduce((occurrenceSum, day) => {
        const date = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        const match = billMatches.get(occurrenceKey(bill.id, date));
        const remaining = match?.settlement === "partial"
          ? Math.max(0, Number(match.plannedAmount ?? amount) - Number(match.amount || 0))
          : match ? 0 : amount;
        return occurrenceSum + remaining;
      }, 0);
    }, 0);
    const totalPaid = transactions.reduce((sum, transaction) => sum + (transaction.review_allocations ?? [])
      .filter(allocation => allocation.type === "bill" && allocation.occurrenceDate?.startsWith(`${year}-${String(month + 1).padStart(2, "0")}`))
      .reduce((allocationSum, allocation) => allocationSum + allocation.amount, 0), 0);
    const monthTxs = transactions.filter(t => {
      const [ty, tm] = t.date.split("-").map(Number);
      return ty === year && tm === month + 1 && isCheckingBalanceTransaction(t, connectedBankAccounts);
    });
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
    const goalAllocations = goals.reduce((sum, goal) => {
      if (goal.goal_type !== "planned_expense" || !goal.target_date) return sum;
      const target = parseGoalTargetDate(goal.target_date);
      return target?.year === year && target.month === month ? sum + getGoalRemainingAmount(goal) : sum;
    }, 0);
    return {
      monthlyIncome,
      totalBillsDue,
      totalPaid,
      netTransactions,
      goalAllocations,
      remaining: monthlyIncome - totalBillsDue - goalAllocations - snowballExtra + netTransactions + plannedDecisionNet,
    };
  }, [incomes, transactions, connectedBankAccounts, extraPayments, decisions, goals, getBillMonthlyTotal, getBillOccurrencesInMonth, getMonthlyBills]);

  // ─── Daily Balances ───────────────────────────────────────────────────────────

  const balanceComputationCache = useMemo(() => ({
    monthNet: new Map<string, number>(),
    carryover: new Map<string, number>(),
    daily: new Map<string, DailyBalance[]>(),
  }), [bills, transactions, incomes, goals, decisions, overrides, billDateMoves, extraPayments, connectedBankAccounts, accounts, getBillEffectiveMonthlyTotal, settings.starting_balance, settings.starting_balance_date]);

  const getDailyBalances = useCallback((month: number, year: number): DailyBalance[] => {
    const dailyKey = `${year}-${month}`;
    const cachedDaily = balanceComputationCache.daily.get(dailyKey);
    if (cachedDaily) return cachedDaily;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const connectedBankAnchor = connectedCheckingAnchor(connectedBankAccounts, localDateString());
    const bankAnchor = connectedBankAnchor ?? operatingAccountAnchor(accounts.map(toAccountSnapshot));
    const computeMonthNet = (m: number, y: number, startExclusive?: string): number => {
      const key = `${y}-${m}`;
      const cached = startExclusive ? undefined : balanceComputationCache.monthNet.get(key);
      if (cached !== undefined) return cached;
      const monthPrefix = `${y}-${String(m + 1).padStart(2, "0")}`;
      const planStartDate = settings.starting_balance_date;
      const includeDate = (date: string) =>
        (!planStartDate || !planStartDate.startsWith(monthPrefix) || date >= planStartDate)
        && (!startExclusive || date > startExclusive);
      const billMatches = matchedOccurrenceAllocations(transactions, "bill");
      const incomeMatches = matchedOccurrenceAllocations(transactions, "income");
      const inc = incomes.reduce((sum, income) => {
        const amount = getEffectiveIncomeAmount(income, m, y);
        return sum + getIncomeOccurrenceDays(income, m, y).reduce((occurrenceSum, day) => {
          const date = `${monthPrefix}-${String(day).padStart(2, "0")}`;
          if (!includeDate(date)) return occurrenceSum;
          const match = incomeMatches.get(occurrenceKey(income.id, date));
          if (!match) return occurrenceSum + amount;
          return occurrenceSum + (match.settlement === "partial" ? Math.max(0, Number(match.plannedAmount ?? amount) - Number(match.amount || 0)) : 0);
        }, 0);
      }, 0);
      const debtPlan = getProjectedDebtSnowballMonth(m, y);
      const projectedDebtScheduledPayments = new Map(
        debtPlan?.payments.map(payment => [payment.billId, payment.scheduledPayment]) ?? [],
      );
      const bil = bills.filter(b => b.is_recurring || b.is_debt).reduce((s, b) => {
        const occ = getBillOccurrencesInMonth(b, m, y);
        if (occ.length === 0) return s;
        const override = overrides.find(item => item.bill_id === b.id && item.month === m && item.year === y);
        const hasReviewedOccurrence = Array.from(billMatches.keys()).some(key => key.startsWith(`${b.id}:${monthPrefix}`));
        const projectedDebtTotal = b.is_debt && debtPlan && override?.actual_amount === undefined
          ? projectedDebtScheduledPayments.get(b.id) ?? 0
          : undefined;
        const total = hasReviewedOccurrence
          ? getBillMonthlyTotal(b, m, y)
          : projectedDebtTotal !== undefined ? projectedDebtTotal : getBillEffectiveMonthlyTotal(b, m, y);
        if (total <= 0.005) return s;
        const dates = occ.map(day => `${monthPrefix}-${String(day).padStart(2, "0")}`);
        const amountPerOccurrence = total / dates.length;
        return s + dates.filter(includeDate).reduce((occurrenceSum, date) => {
          const match = billMatches.get(occurrenceKey(b.id, date));
          if (!match) return occurrenceSum + amountPerOccurrence;
          return occurrenceSum + (match.settlement === "partial" ? Math.max(0, Number(match.plannedAmount ?? amountPerOccurrence) - Number(match.amount || 0)) : 0);
        }, 0);
      }, 0);
      const tx = transactions
        .filter(t => t.date.startsWith(monthPrefix) && includeDate(t.date) && isCheckingBalanceTransaction(t, connectedBankAccounts))
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
      if (!startExclusive) balanceComputationCache.monthNet.set(key, net);
      return net;
    };
    const computeCarryover = (toMonth: number, toYear: number): number => {
      const key = `${toYear}-${toMonth}`;
      const cached = balanceComputationCache.carryover.get(key);
      if (cached !== undefined) return cached;
      if (bankAnchor) {
        const [bankYear, bankMonth] = bankAnchor.date.split("-").map(Number);
        const bankMonthIndex = bankMonth - 1;
        if (toYear > bankYear || (toYear === bankYear && toMonth > bankMonthIndex)) {
          let running = bankAnchor.balance + computeMonthNet(bankMonthIndex, bankYear, bankAnchor.date);
          let m = bankMonthIndex + 1;
          let y = bankYear;
          if (m > 11) { m = 0; y += 1; }
          while (!(y === toYear && m === toMonth)) {
            running += computeMonthNet(m, y);
            m += 1;
            if (m > 11) { m = 0; y += 1; }
          }
          balanceComputationCache.carryover.set(key, running);
          return running;
        }
      }
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
    const billMatches = matchedOccurrenceAllocations(transactions, "bill");
    const incomeMatches = matchedOccurrenceAllocations(transactions, "income");
    const incomeByDay: Record<number, number> = {};
    incomes.forEach(i => {
      const occ = getIncomeOccurrenceDays(i, month, year);
      const amt = getEffectiveIncomeAmount(i, month, year);
      occ.forEach(d => {
        const date = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        const match = incomeMatches.get(occurrenceKey(i.id, date));
        const scheduledAmount = !match ? amt : match.settlement === "partial" ? Math.max(0, Number(match.plannedAmount ?? amt) - Number(match.amount || 0)) : 0;
        if (scheduledAmount <= 0.005) return;
        incomeByDay[d] = (incomeByDay[d] ?? 0) + scheduledAmount;
        financialEvents.push({
          id: `income:${i.id}:${year}-${month + 1}-${d}`,
          sourceType: "income", sourceId: i.id,
          date,
          kind: "scheduled_income", amount: scheduledAmount, status: "scheduled", name: i.name,
        });
      });
    });
    const monthTxs = transactions.filter(t => {
      const [ty, tm] = t.date.split("-").map(Number);
      return ty === year && tm === month + 1 && isCheckingBalanceTransaction(t, connectedBankAccounts);
    });
    monthTxs.forEach(t => {
      const isBankActivity = t.source === "plaid" || t.source === "statement" || Boolean(t.import_hash);
      financialEvents.push({
        id: `transaction:${t.id}`, sourceType: "transaction", sourceId: t.id, date: t.date,
        kind: t.amount >= 0 ? "transaction_income" : "transaction_expense",
        amount: t.amount,
        status: !isBankActivity && t.amount > 0 && t.date >= localDateString() ? "scheduled" : "actual",
        name: t.note || t.category,
      });
    });
    const billsByDay: Record<number, number> = {};
    const debtPlan = getProjectedDebtSnowballMonth(month, year);
    const projectedDebtScheduledPayments = new Map(
      debtPlan?.payments.map(payment => [payment.billId, payment.scheduledPayment]) ?? [],
    );
    bills.filter(b => b.is_recurring || b.is_debt).forEach(b => {
      let occ = getBillOccurrencesInMonth(b, month, year);
      if (occ.length === 0) return;
      const o = overrides.find(o => o.bill_id === b.id && o.month === month && o.year === year);
      const hasReviewedOccurrence = Array.from(billMatches.keys()).some(key => key.startsWith(`${b.id}:${year}-${String(month + 1).padStart(2, "0")}`));
      const projectedDebtTotal = b.is_debt && debtPlan && o?.actual_amount === undefined
        ? projectedDebtScheduledPayments.get(b.id) ?? 0
        : undefined;
      const total = hasReviewedOccurrence
        ? getBillMonthlyTotal(b, month, year)
        : projectedDebtTotal !== undefined ? projectedDebtTotal : getBillEffectiveMonthlyTotal(b, month, year);
      if (total <= 0.005) return;
      if (o?.actual_amount !== undefined && !hasReviewedOccurrence) {
        const finalizedOccurrences = resolveFinalizedBillOccurrenceDays(occ, o.paid_date, month, year);
        const finalizedAmount = finalizedOccurrences.length > 0 ? total / finalizedOccurrences.length : 0;
        finalizedOccurrences.forEach(d => {
          const date = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
          const match = billMatches.get(occurrenceKey(b.id, date));
          const remaining = match?.settlement === "partial" ? Math.max(0, Number(match.plannedAmount ?? finalizedAmount) - Number(match.amount || 0)) : match ? 0 : finalizedAmount;
          if (remaining <= 0.005) return;
          billsByDay[d] = (billsByDay[d] ?? 0) + remaining;
          financialEvents.push({
            id: `bill:${b.id}:${year}-${month + 1}-${d}`, sourceType: "bill", sourceId: b.id,
            date,
            kind: "bill", amount: -remaining, status: match ? "planned" : "finalized", name: b.name,
          });
        });
        return;
      }
      const amt = occ.length > 0 ? total / occ.length : 0;
      occ.forEach(d => {
        const date = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        const match = billMatches.get(occurrenceKey(b.id, date));
        const remaining = match?.settlement === "partial" ? Math.max(0, Number(match.plannedAmount ?? amt) - Number(match.amount || 0)) : match ? 0 : amt;
        if (remaining <= 0.005) return;
        billsByDay[d] = (billsByDay[d] ?? 0) + remaining;
        financialEvents.push({
          id: `bill:${b.id}:${year}-${month + 1}-${d}`, sourceType: "bill", sourceId: b.id,
          date,
          kind: "bill", amount: -remaining, status: "planned", name: b.name,
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
    let openingBalance = carryover;
    let balanceEvents = financialEvents;
    if (connectedBankAnchor?.date.startsWith(currentMonthPrefix)) {
      const settledTransactionEventIds = new Set(monthTxs
        .filter(transaction => transaction.source === "plaid" || transaction.source === "statement" || Boolean(transaction.import_hash))
        .map(transaction => `transaction:${transaction.id}`));
      const anchored = anchorForecastToBankBalance(
        financialEvents,
        connectedBankAnchor.balance,
        connectedBankAnchor.date,
        settledTransactionEventIds,
        historicalMonthOpeningBalance(
          openingBalance,
          settings.starting_balance_date,
          `${currentMonthPrefix}-01`,
        ),
      );
      openingBalance = anchored.openingBalance;
      balanceEvents = anchored.events;
    } else if (bankAnchor?.date.startsWith(currentMonthPrefix)) {
      const adjustment = bankBalanceAdjustment(openingBalance, bankAnchor.balance, bankAnchor.date, financialEvents);
      if (Math.abs(adjustment) >= 0.005) {
        financialEvents.push({
          id: `bank-adjustment:${bankAnchor.date}`,
          sourceType: "reconciliation",
          sourceId: bankAnchor.date,
          date: bankAnchor.date,
          kind: "bank_adjustment",
          amount: adjustment,
          status: "actual",
          name: "Bank balance update",
        });
      }
    }
    const forecastStarted = Date.now();
    const forecast = forecastBalances({
      openingBalance,
      startDate: `${year}-${String(month + 1).padStart(2, "0")}-01`,
      endDate: `${year}-${String(month + 1).padStart(2, "0")}-${String(daysInMonth).padStart(2, "0")}`,
      events: balanceEvents,
    });
    const forecastDuration = Date.now() - forecastStarted;
    if (forecastDuration >= 50) {
      void recordDiagnostic(user?.id, {
        eventType: "performance", operation: "forecast", platform: diagnosticPlatform(), durationMs: forecastDuration,
      }).catch(() => undefined);
    }
    const visibleEventsByDate = new Map<string, FinancialEvent[]>();
    financialEvents.forEach(event => visibleEventsByDate.set(event.date, [...(visibleEventsByDate.get(event.date) ?? []), event]));
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
      const visibleEvents = visibleEventsByDate.get(forecastDay.date) ?? [];
      result.push({
        day, income: incomeToday, scheduledIncome, expense: expenseToday, bills: billsToday,
        goalExpenses: dayGoals, net: forecastDay.net, balance: forecastDay.balance, events: visibleEvents,
      });
    }
    balanceComputationCache.daily.set(dailyKey, result);
    return result;
  }, [bills, transactions, incomes, goals, decisions, overrides, billDateMoves, extraPayments, connectedBankAccounts, accounts, getBillEffectiveMonthlyTotal, getBillMonthlyTotal, getBillOccurrencesInMonth, getProjectedDebtSnowballMonth, settings.starting_balance, settings.starting_balance_date, balanceComputationCache, user]);

  const previewDebtSnowball = useCallback((month: number, year: number, requestedExtra?: number, additionalSafeCredit = 0, paymentDateOverride?: string, editingPaymentId?: string): SnowballProjectionResult => {
    const existing = extraPayments.find(ep => ep.month === month && ep.year === year);
    const editingAppliedPayment = Boolean(
      existing
      && existing.id === editingPaymentId
      && !hasPendingSnowballBalanceApply(existing)
      && (existing.payment_date ?? "") <= localDateString(),
    );
    const restoredByDebtId = new Map<string, number>();
    if (editingAppliedPayment) {
      existing?.allocations.forEach(allocation => {
        restoredByDebtId.set(
          allocation.billId,
          (restoredByDebtId.get(allocation.billId) ?? 0) + Math.max(0, Number(allocation.payment) || 0),
        );
      });
    }
    const debtInputs: SnowballDebtInput[] = bills
      .filter(b => b.is_debt && Number(b.balance) + (restoredByDebtId.get(b.id) ?? 0) > 0 && isBillActiveForMonth(b, month, year))
      .map(b => ({
        id: b.id,
        name: b.name,
        balance: Number(b.balance) + (restoredByDebtId.get(b.id) ?? 0),
        minimum: effectiveDebtMinimum(b.amount, Number(b.snowball_minimum_boost ?? 0))
          * Math.max(1, getBillOccurrencesInMonth(b, month, year).length),
        apr: Number(b.interest_rate),
        dueDay: b.due_day,
        included: b.include_in_snowball !== false,
      }));
    const included = debtInputs.filter(d => d.included);
    const target = orderDebts(included, settings.paymentMethod)[0];
    const today = new Date();
    const requestedDay = target?.dueDay ?? 1;
    const dueDay = today.getFullYear() === year && today.getMonth() === month && requestedDay < today.getDate()
      ? today.getDate()
      : requestedDay;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const defaultPaymentDate = `${year}-${String(month + 1).padStart(2, "0")}-${String(Math.min(daysInMonth, dueDay)).padStart(2, "0")}`;
    const validOverride = paymentDateOverride?.startsWith(`${year}-${String(month + 1).padStart(2, "0")}-`);
    const paymentDate = validOverride ? paymentDateOverride! : defaultPaymentDate;

    if (!settings.debtPayoffEnabled) {
      return {
        safeMaximum: 0,
        selectedExtra: 0,
        paymentDate,
        allocations: [],
        months: [],
        payoffOrder: [],
        debtFreeDate: null,
        lowestSixMonthBalance: 0,
      };
    }

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
    const initialRolledPayment = current.payoffOrder.reduce((sum, name) => {
      const debt = debtInputs.find(item => item.name === name);
      return sum + Math.max(0, debt?.minimum ?? 0);
    }, 0);
    let cumulativeProjectedDelta = selectedExtra - existingAmount;
    const simulated = simulateSnowballPayoff({
      debts: debtInputs,
      method: settings.paymentMethod,
      startMonth: month,
      startYear: year,
      firstMonthBalances: current.balances,
      firstPayoffOrder: current.payoffOrder,
      initialRolledPayment,
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
      rolledPayment: initialRolledPayment,
      interest: 0,
      endingDebt,
      lowestAccountBalance: currentLowest,
      paidOffNames: current.payoffOrder,
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
  }, [bills, settings.paymentMethod, settings.debtPayoffEnabled, settings.safety_floor, settings.forecast_horizon_months, extraPayments, getBillOccurrencesInMonth, getDailyBalances]);

  const removeReviewSurplusFunding = useCallback(async (transactionId: string) => {
    const affectedPayments = extraPayments.filter(payment =>
      payment.sources?.some(source => source.reviewTransactionId === transactionId),
    );
    for (const payment of affectedPayments) {
      const sources = (payment.sources ?? [{ type: "manual" as const, amount: payment.amount }])
        .filter(source => source.reviewTransactionId !== transactionId);
      const remainingAmount = sources.reduce((sum, source) => sum + source.amount, 0);
      if (remainingAmount <= 0.005) {
        await removeDebtSnowballPayment(payment.month, payment.year);
        continue;
      }
      const preview = previewDebtSnowball(
        payment.month,
        payment.year,
        remainingAmount,
        0,
        payment.payment_date,
      );
      if (!preview.allocations.length || preview.selectedExtra + 0.005 < remainingAmount) {
        throw new Error("The linked payoff payment could not be safely recalculated.");
      }
      await applyDebtSnowballPayment(preview, sources);
    }
  }, [extraPayments, previewDebtSnowball, applyDebtSnowballPayment, removeDebtSnowballPayment]);

  // ─── Categories ───────────────────────────────────────────────────────────────

  const addCategory = useCallback(async (name: string) => {
    if (!user) return;
    assertCanEditHousehold("add a category");
    const trimmed = normalizeCategoryInput(name);
    if (!trimmed) return;
    if (categories.some(category => categoryMatches(category, trimmed))) return;
    if (demoMode) {
      setCategories(prev => fallbackCategoryList([...prev, trimmed]));
      return;
    }
    await ensureSaved(supabase.from("categories").insert(scopedPayload({ user_id: user.id, name: trimmed })), "Add category");
    setCategories(prev => fallbackCategoryList([...prev, trimmed]));
  }, [user, categories, demoMode, scopedPayload, assertCanEditHousehold]);

  const updateCategory = useCallback(async (oldName: string, newName: string) => {
    if (!user) return;
    assertCanEditHousehold("update a category");
    const trimmed = normalizeCategoryInput(newName);
    if (!trimmed || categoryMatches(trimmed, oldName)) return;
    const canonicalExisting = categories.find(category => !categoryMatches(category, oldName) && categoryMatches(category, trimmed));
    const targetName = canonicalExisting ?? trimmed;
    const affectedBills = bills.filter(b => categoryMatches(b.category, oldName));
    const affectedTransactions = transactions.filter(t => categoryMatches(t.category, oldName));
    if (demoMode) {
      setCategories(prev => fallbackCategoryList(prev.map(c => categoryMatches(c, oldName) ? targetName : c)));
      setBills(prev => prev.map(b => categoryMatches(b.category, oldName) ? { ...b, category: targetName } : b));
      setTransactions(prev => prev.map(t => categoryMatches(t.category, oldName) ? { ...t, category: targetName } : t));
      return;
    }
    const results = await Promise.all([
      canonicalExisting
        ? supabase.from("categories").delete().eq("name", oldName)
        : supabase.from("categories").update({ name: targetName }).eq("name", oldName),
      ...affectedBills.map(b => supabase.from("bills").update({ category: targetName }).eq("id", b.id)),
      ...affectedTransactions.map(t => supabase.from("transactions").update({ category: targetName }).eq("id", t.id)),
    ]);
    const failed = results.find(result => result.error);
    if (failed?.error) throw new Error(`Rename category: ${failed.error.message}`);
    setCategories(prev => fallbackCategoryList(prev.map(c => categoryMatches(c, oldName) ? targetName : c)));
    setBills(prev => prev.map(b => categoryMatches(b.category, oldName) ? { ...b, category: targetName } : b));
    setTransactions(prev => prev.map(t => categoryMatches(t.category, oldName) ? { ...t, category: targetName } : t));
  }, [user, bills, transactions, categories, demoMode, assertCanEditHousehold]);

  const deleteCategory = useCallback(async (name: string) => {
    if (!user) return;
    assertCanEditHousehold("delete a category");
    const cleanName = normalizeCategoryInput(name);
    if (!cleanName || categoryMatches(cleanName, "Other")) return;
    const affectedBills = bills.filter(b => categoryMatches(b.category, cleanName));
    const affectedTransactions = transactions.filter(t => categoryMatches(t.category, cleanName));
    if (demoMode) {
      setCategories(prev => fallbackCategoryList(prev.filter(c => !categoryMatches(c, cleanName))));
      setBills(prev => prev.map(b => categoryMatches(b.category, cleanName) ? { ...b, category: "Other" } : b));
      setTransactions(prev => prev.map(t => categoryMatches(t.category, cleanName) ? { ...t, category: "Other" } : t));
      return;
    }
    const results = await Promise.all([
      supabase.from("categories").delete().eq("name", cleanName),
      ...affectedBills.map(b => supabase.from("bills").update({ category: "Other" }).eq("id", b.id)),
      ...affectedTransactions.map(t => supabase.from("transactions").update({ category: "Other" }).eq("id", t.id)),
    ]);
    const failed = results.find(result => result.error);
    if (failed?.error) throw new Error(`Delete category: ${failed.error.message}`);
    setCategories(prev => fallbackCategoryList(prev.filter(c => !categoryMatches(c, cleanName))));
    setBills(prev => prev.map(b => categoryMatches(b.category, cleanName) ? { ...b, category: "Other" } : b));
    setTransactions(prev => prev.map(t => categoryMatches(t.category, cleanName) ? { ...t, category: "Other" } : t));
  }, [user, bills, transactions, demoMode, assertCanEditHousehold]);

  // ─── Settings ─────────────────────────────────────────────────────────────────

  const saveSettingsRecord = useCallback(async (next: Settings) => {
    if (!user) return;
    const scope = householdScopeRef.current;
    if (scope) {
      const householdResult = await supabase.from("household_settings").upsert({
        household_id: scope.householdId,
        budget_id: scope.budgetId,
        zero_based_budget_enabled: next.zeroBasedBudgetEnabled,
        debt_payoff_enabled: next.debtPayoffEnabled,
        payment_method: next.paymentMethod,
        starting_balance: next.starting_balance,
        starting_balance_date: next.starting_balance_date ?? null,
        calendar_start_date: next.calendar_start_date ?? null,
        safety_floor: next.safety_floor,
        forecast_horizon_months: next.forecast_horizon_months,
        onboarding_completed: next.onboarding_completed,
        updated_at: new Date().toISOString(),
      });
      if (!householdResult.error) return;
      const message = householdResult.error.message.toLowerCase();
      if (!message.includes("household_settings") && !message.includes("schema cache")) {
        throw new Error(`Update household settings: ${householdResult.error.message}`);
      }
    }

    await ensureSaved(supabase.from("settings").upsert({
      user_id:               user.id,
      zero_based_budget_enabled: next.zeroBasedBudgetEnabled,
      debt_payoff_enabled: next.debtPayoffEnabled,
      payment_method:        next.paymentMethod,
      starting_balance:      next.starting_balance,
      starting_balance_date: next.starting_balance_date ?? null,
      calendar_start_date: next.calendar_start_date ?? null,
      safety_floor:          next.safety_floor,
      forecast_horizon_months: next.forecast_horizon_months,
      onboarding_completed:   next.onboarding_completed,
    }), "Update settings");
  }, [user]);

  const updateSettings = useCallback(async (s: Partial<Settings>) => {
    if (!user) return;
    assertCanEditHousehold("update household settings");
    const next = { ...settings, ...s };
    setSettings(next);
    if (demoMode) return;
    const saveStarted = Date.now();
    let settingsSaved = false;
    markSaveStarted();
    try {
      await saveSettingsRecord(next);
      settingsSaved = true;
      if (s.paymentMethod && s.paymentMethod !== settings.paymentMethod) {
        await recalculateAndRefreshDebtMinimums();
      }
      markSaveCompleted();
      void recordDiagnostic(user.id, {
        eventType: "performance", operation: "settings_save", platform: diagnosticPlatform(),
        durationMs: Date.now() - saveStarted,
      }).catch(() => undefined);
    } catch (error) {
      if (!settingsSaved) {
        setSettings(current => Object.entries(s).every(([key, value]) => current[key as keyof Settings] === value) ? settings : current);
      }
      markSaveFailed(error, () => updateSettings(s));
      throw error;
    }
  }, [user, settings, demoMode, markSaveStarted, markSaveCompleted, markSaveFailed, saveSettingsRecord, assertCanEditHousehold, recalculateAndRefreshDebtMinimums]);

  const persistAccountAnchor = useCallback(async (nextAccounts: Account[]) => {
    if (!user) return;
    const accountAnchor = operatingAccountAnchor(nextAccounts.map(toAccountSnapshot));
    if (!accountAnchor) return;
    const nextSettings = {
      ...settings,
      starting_balance: accountAnchor.balance,
      starting_balance_date: accountAnchor.date,
      calendar_start_date: settings.calendar_start_date ?? `${accountAnchor.date.slice(0, 7)}-01`,
    };
    setSettings(nextSettings);
    if (demoMode) return;
    await saveSettingsRecord(nextSettings);
  }, [user, settings, demoMode, saveSettingsRecord]);

  const addAccount = useCallback(async (input: Omit<Account, "id" | "created_at" | "last_reconciled_at">) => {
    if (!user) return;
    assertCanEditHousehold("add an account");
    const now = new Date().toISOString();
    const account: Account = { ...input, id: genId(), created_at: now, last_reconciled_at: now };
    if (demoMode) {
      const next = [...accounts, account];
      setAccounts(next);
      await persistAccountAnchor(next);
      return;
    }
    markSaveStarted();
    try {
      await ensureSaved(supabase.from("accounts").insert(scopedPayload({ ...account, user_id: user.id })), "Add account");
      await ensureSaved(supabase.from("account_balances").insert({
        ...scopedPayload({ id: genId(), account_id: account.id, user_id: user.id, balance: account.current_balance }),
        as_of_date: account.balance_as_of, source: "manual",
      }), "Save opening balance");
      const next = [...accounts, account];
      setAccounts(next);
      await persistAccountAnchor(next);
      markSaveCompleted();
    } catch (error) {
      markSaveFailed(error, () => addAccount(input));
      throw error;
    }
  }, [user, accounts, persistAccountAnchor, demoMode, markSaveStarted, markSaveCompleted, markSaveFailed, scopedPayload, assertCanEditHousehold]);

  const updateAccount = useCallback(async (account: Account) => {
    if (!user) return;
    assertCanEditHousehold("update an account");
    const previous = accounts.find(item => item.id === account.id);
    const next = accounts.map(item => item.id === account.id ? account : item);
    setAccounts(next);
    if (demoMode) {
      await persistAccountAnchor(next);
      return;
    }
    markSaveStarted();
    try {
      await ensureSaved(supabase.from("accounts").update({
        name: account.name,
        account_type: account.account_type,
        current_balance: account.current_balance,
        balance_as_of: account.balance_as_of,
        is_active: account.is_active,
      }).eq("id", account.id), "Update account");
      try {
        await persistAccountAnchor(next);
      } catch (anchorError) {
        void recordDiagnostic(user.id, {
          eventType: "save_failure", operation: "account_save", platform: diagnosticPlatform(),
          errorCode: diagnosticErrorCode(anchorError),
        }).catch(() => undefined);
      }
      markSaveCompleted();
    } catch (error) {
      if (previous) setAccounts(current => current.map(item => item.id === previous.id ? previous : item));
      markSaveFailed(error, () => updateAccount(account));
      throw error;
    }
  }, [user, accounts, persistAccountAnchor, demoMode, markSaveStarted, markSaveCompleted, markSaveFailed, assertCanEditHousehold]);

  const reconcileAccount = useCallback(async (accountId: string, balance: number, asOfDate: string) => {
    if (!user) return;
    assertCanEditHousehold("reconcile an account");
    const reconciledAt = new Date().toISOString();
    const next = accounts.map(account => account.id === accountId ? {
      ...account, current_balance: balance, balance_as_of: asOfDate, last_reconciled_at: reconciledAt,
    } : account);
    setAccounts(next);
    if (demoMode) {
      await persistAccountAnchor(next);
      return;
    }
    markSaveStarted();
    try {
      await ensureSaved(supabase.from("accounts").update({
        current_balance: balance, balance_as_of: asOfDate, last_reconciled_at: reconciledAt,
      }).eq("id", accountId), "Reconcile account");
      const historyResult = await supabase.from("account_balances").insert({
        ...scopedPayload({ id: genId(), account_id: accountId, user_id: user.id, balance }),
        as_of_date: asOfDate, source: "reconciliation",
      });
      if (historyResult.error) {
        void recordDiagnostic(user.id, {
          eventType: "save_failure", operation: "reconciliation", platform: diagnosticPlatform(),
          errorCode: diagnosticErrorCode(historyResult.error),
        }).catch(() => undefined);
      }
      try {
        await persistAccountAnchor(next);
      } catch (anchorError) {
        void recordDiagnostic(user.id, {
          eventType: "save_failure", operation: "reconciliation", platform: diagnosticPlatform(),
          errorCode: diagnosticErrorCode(anchorError),
        }).catch(() => undefined);
      }
      markSaveCompleted();
      void recordDiagnostic(user.id, { eventType: "performance", operation: "reconciliation", platform: diagnosticPlatform() }).catch(() => undefined);
    } catch (error) {
      setAccounts(accounts);
      markSaveFailed(error, () => reconcileAccount(accountId, balance, asOfDate));
      throw error;
    }
  }, [user, accounts, persistAccountAnchor, demoMode, markSaveStarted, markSaveCompleted, markSaveFailed, scopedPayload, assertCanEditHousehold]);

  const archiveAccount = useCallback(async (accountId: string) => {
    const account = accounts.find(item => item.id === accountId);
    if (!account) return;
    await updateAccount({ ...account, is_active: false });
  }, [accounts, updateAccount]);

  const importStatementTransactions = useCallback(async (accountId: string, rows: ImportedTransactionRow[]) => {
    if (!user || !rows.length) return { imported: 0, duplicates: 0 };
    assertCanEditHousehold("import transactions");
    if (demoMode) {
      const existing = new Set(transactions.map(transaction => transaction.import_hash).filter(Boolean));
      const seen = new Set<string>();
      const fresh = rows.filter(row => !existing.has(row.importHash) && !seen.has(row.importHash) && !!seen.add(row.importHash));
      const records = fresh.map(row => ({
        id: genId(), account_id: accountId, import_hash: row.importHash,
        date: row.date, amount: row.amount, category: "Other", note: row.description, source: "statement",
      }));
      setTransactions(previous => [...previous, ...records]);
      return { imported: fresh.length, duplicates: rows.length - fresh.length };
    }
    const hashes = rows.map(row => row.importHash);
    const existingResult = await applyHouseholdSelect(supabase.from("transactions").select("import_hash"), user.id).in("import_hash", hashes);
    if (existingResult.error) throw new Error(`Check statement duplicates: ${existingResult.error.message}`);
    const existing = new Set((existingResult.data ?? []).map((row: any) => row.import_hash));
    const seen = new Set<string>();
    const fresh = rows.filter(row => !existing.has(row.importHash) && !seen.has(row.importHash) && !!seen.add(row.importHash));
    if (fresh.length) {
      const records = fresh.map(row => ({
        ...scopedPayload({ id: genId(), user_id: user.id, account_id: accountId, import_hash: row.importHash }),
        date: row.date, amount: row.amount, category: "Other", note: row.description, source: "statement",
      }));
      await ensureSaved(supabase.from("transactions").insert(records), "Import statement");
      setTransactions(previous => [...previous, ...records.map(({ user_id: _userId, ...record }) => record)]);
    }
    void recordDiagnostic(user.id, { eventType: "performance", operation: "statement_import", platform: diagnosticPlatform() }).catch(() => undefined);
    return { imported: fresh.length, duplicates: rows.length - fresh.length };
  }, [user, demoMode, transactions, scopedPayload, applyHouseholdSelect, assertCanEditHousehold]);

  const saveDecision = useCallback(async (scenario: DecisionScenario, result: DecisionResult, status: DecisionRecord["status"] = "saved") => {
    if (!user) throw new Error("Sign in to save a decision");
    assertCanEditHousehold("save a decision");
    const decision: DecisionRecord = { id: genId(), name: scenario.name, decision_type: scenario.type, scenario, result, status, calendar_date: status === "calendar" || status === "planned" ? scenario.date : undefined, next_due_date: status === "planned" ? scenario.date : undefined, created_at: new Date().toISOString() };
    if (demoMode) {
      setDecisions(previous => [decision, ...previous]);
      return decision;
    }
    await ensureSaved(supabase.from("decisions").insert(scopedPayload({ id: decision.id, user_id: user.id, created_at: decision.created_at, ...decisionDbPayload(decision) })), "Save decision");
    setDecisions(previous => [decision, ...previous]); return decision;
  }, [user, demoMode, scopedPayload, assertCanEditHousehold]);

  const updateDecision = useCallback(async (decision: DecisionRecord) => {
    if (!user) return;
    assertCanEditHousehold("update a decision");
    if (demoMode) {
      setDecisions(previous => previous.map(item => item.id === decision.id ? decision : item));
      return;
    }
    await ensureSaved(supabase.from("decisions").update({ ...decisionDbPayload(decision), updated_at: new Date().toISOString() }).eq("id", decision.id), "Update decision");
    setDecisions(previous => previous.map(item => item.id === decision.id ? decision : item));
  }, [user, demoMode, assertCanEditHousehold]);

  const deleteDecision = useCallback(async (id: string) => {
    if (!user) return;
    assertCanEditHousehold("delete a decision");
    if (demoMode) { setDecisions(previous => previous.filter(item => item.id !== id)); return; }
    await ensureSaved(supabase.from("decisions").delete().eq("id", id), "Delete decision"); setDecisions(previous => previous.filter(item => item.id !== id));
  }, [user, demoMode, assertCanEditHousehold]);

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
    assertCanEditHousehold("import bills");
    const newBills = imported.map(b => ({
      ...b,
      frequency:   (["monthly", "biweekly", "weekly"].includes(String(b.frequency)) ? b.frequency : "monthly") as "monthly" | "biweekly" | "weekly",
      day_of_week: b.day_of_week ?? 0,
      next_payment_date: b.next_payment_date ?? undefined,
      id:          genId(),
      created_at:  new Date().toISOString(),
    }));
    if (demoMode) {
      setBills(prev => reorderDebtPriorities([...prev, ...newBills]));
      return;
    }
    await ensureSaved(supabase.from("bills").insert(newBills.map(b => scopedPayload({ ...b, user_id: user.id }))), "Import bills");
    setBills(prev => reorderDebtPriorities([...prev, ...newBills]));
  }, [user, demoMode, scopedPayload, assertCanEditHousehold]);

  // ─── Provider value ───────────────────────────────────────────────────────────

  return (
    <BudgetContext.Provider value={{
      bills, overrides, billDateMoves, transactions, deletedTransactions, pendingBankTransactions, incomes, goals, extraPayments, categories, settings, accounts, connectedBankAccounts, decisions,
      households, householdMembers, householdActivity, activeHousehold, householdRole, canEditHousehold,
      refreshHouseholds, refreshHouseholdActivity, switchHousehold, createHouseholdInvite, acceptHouseholdInvite,
      updateHouseholdMemberRole, removeHouseholdMember, leaveActiveHousehold,
      forecastConfidence, loading, loadError, retryBudgetLoad, refreshBankData, demoMode,
      saveStatus, saveError, retryLastSave, clearSaveError,
      dashboardFilter, setDashboardFilter,
      addBill, updateBill, stopFutureBill, deleteBill, deleteBillMistake, getBillById,
      getOverride, getAmount, getPaidAmount, setPaidAmount, setCustomAmount, getCustomDueDay, setCustomDueDay,
      moveBillOccurrence, removeBillOccurrenceMove, getBillDateMoveForOccurrence, getBillDateMovesForMonth,
      getMonthlyBills, getBillOccurrencesInMonth, getBillMonthlyTotal, getBillEffectiveMonthlyTotal,
      runSnowball, previewDebtSnowball, applyDebtSnowballPayment, saveExtraPayment, getExtraPayment, deleteExtraPayment, removeDebtSnowballPayment, finalizeBillPayment,
      addTransaction, updateTransaction, deleteTransaction, restoreDeletedTransaction, deleteTransfer, matchTransactionToBill, unmatchTransactionFromBill, reconcileTransaction, undoTransactionReconciliation, removeReviewSurplusFunding, getTransactionsForMonth,
      addIncome, updateIncome, deleteIncome, getMonthlyIncome, getIncomeOccurrencesInMonth,
      addGoal, updateGoal, closeSpendingBucket, reopenSpendingBucket, archiveSpendingBucket, restoreArchivedSpendingBucket, deleteGoal, checkGoalAffordability,
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
