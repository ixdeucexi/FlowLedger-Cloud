import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import { useSegments } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { DashboardFinancialSnapshotContextProvider } from "@/context/DashboardFinancialSnapshotContext";
import {
  allocateSnowballExtra,
  monthlyDebtAmount,
  orderDebts,
  projectDatedSnowballMonth,
  remainingDatedDebtAllocations,
  simulateSnowballPayoff,
  type DatedDebtSettlement,
  type DatedSnowballDebtInput,
  type DatedSnowballMonthPlanResult,
  type SnowballDebtInput,
  type SnowballProjectionResult,
} from "@/lib/snowball";
import { requiredDebtPlanTotal, snowballRolloverPlanTotal, upsertSnowballPlanById } from "@/lib/debtPaymentPlan";
import {
  advanceDebtProjectionWithCommitments,
  applyDebtSourceCommitments,
  authoritativeDebtPaidAmountForMonth,
  automaticDebtRolloverForMonth,
  debtPlanPaymentBreakdown,
  effectiveDebtOccurrenceAmount,
  exactDebtPlanTotal,
  isValidExtraPaymentPlan,
  plannedDebtAmountError,
  remainingDebtAllocationsAfterReviewedPayments,
  resolveDebtOccurrenceSettlement,
  summarizeDebtOccurrenceSettlements,
  type DebtSourceCommitment,
  type DebtMonthSettlement,
} from "@/lib/debtPlanDomain";
import { anchorForecastToBankBalance, forecastBalances, suppressDebtBillPlanDuplicates, type FinancialEvent } from "@/lib/forecast";
import { diagnosticErrorCode } from "@/lib/diagnosticPolicy";
import {
  billEditableDbPatch,
  billEditablePatch,
  normalizedBillEditableFields,
  type BillEditableBaseline,
  type BillEditableField,
} from "@/lib/billEditPersistence";
import {
  activeVersionedPatch,
  assertFinancialMutationScope,
  classifyTransactionRestoreState,
  enqueueMutationByKey,
  enqueueMutationByKeys,
  isAlreadyReviewedError,
  monthlyOverridePatchDbPayload,
  reconciledTransactionMatchesIntent,
  rollbackVersionedPatch,
  runRecoverableFinancialMutation,
  runSingleFlight,
  type FinancialMutationScope,
} from "@/lib/financialMutationRecovery";
import { assertFinancialMutationOnline, knownNetworkStatus, subscribeNetworkStatus } from "@/lib/networkStatus";
import { decisionDbPayload } from "@/lib/decisionPersistence";
import { recordDiagnostic } from "@/lib/diagnostics";
import { isDevDemoMode } from "@/lib/demoMode";
import { applyBillDateMovesToOccurrenceDays, getBillOccurrenceDays, getEffectiveIncomeAmount, getIncomeOccurrenceDays, getLatestRecordedIncomeAmount, isBillActiveForMonth, isIncomeActiveForMonth, moveSettledBillOverrideDate, resolveFinalizedBillOccurrenceDays, resolveIncomeMatchOccurrenceDate } from "@/lib/schedule";
import { accountUpdatesOperatingAnchor, bankBalanceAdjustment, connectedCheckingObservedAnchor, evaluateForecastConfidence, historicalMonthOpeningBalance, operatingAccountAnchor, type AccountSnapshot, type AccountType, type ForecastConfidence, type ImportedTransactionRow } from "@/lib/accounts";
import { loadAllDailyCheckingCloses, localDateInTimeZone, overlayCompletedDailyCheckingCloses, shouldApplyDailyCheckingCloseLoad, type DailyBalanceSource, type DailyCheckingCloseLoadStatus, type DailyCheckingCloseSnapshot } from "@/lib/dailyCheckingClose";
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
  verifyCurrentHouseholdMembership,
  writeStoredActiveHouseholdId,
  type HouseholdActivity,
  type HouseholdInviteRole,
  type HouseholdMember,
  type HouseholdMembership,
  type HouseholdRole,
} from "@/lib/households";
import { canEditHouseholdPlan, canManageHouseholdMembers } from "@/lib/householdPermissions";
import { isActiveTransaction, isConfirmedBillMatch, isDeletedTransaction, plaidTransactionAccountKind } from "@/lib/billMatching";
import { countReviewQueue, occurrenceKey } from "@/lib/reviewCenter";
import { normalizePlanningTools } from "@/lib/planningMode";
import { canonicalDebtPaymentMethod } from "@/lib/debtOrder";
import { localDateString } from "@/lib/dateLabels";
import { spendingBucketSummary, validateCreateSpendingBucketMatch } from "@/lib/spendingBuckets";
import { hasBucketRemainderFunding, latestBucketRemainderAvailableDate, removeBucketRemainderFundingSource, resizeSnowballFundingSources } from "@/lib/snowballFunding";
import { canonicalConnectedAccounts, pendingPlaidActivityWithBalanceHolds } from "@/lib/plaidActivity";
import { normalizeBillImportance, type BillImportance } from "@/lib/billImportance";
import { isBillEligibleForUpcomingPlan } from "@/lib/billEligibility";
import { buildTransactionLedger, remainingPlannedAmount, selectFlowLedgerTransactions } from "@/lib/ledgerEngine";
import { debtSourceCommitmentsForDebts, type PendingPlanMatch } from "@/lib/pendingPlanMatches";
import { householdResolutionIsCurrent, loadResolvedHouseholdSelection, PWA_RESUME_STALE_MS, scopedRequestIsCurrent, shouldRefreshPlanOnResume, shouldReleaseBudgetLoading, shouldShowBudgetLoadError } from "@/lib/resumePolicy";
import {
  householdResolutionChangesCommittedScope,
  ownsLegacyPersonalRows,
} from "@/lib/householdDataScope";
import { dateIdKeysetFilter, loadAllDateIdKeysetRows } from "@/lib/pagedQuery";
import { debtSyncRefreshPlan, replaceRowsById, rowsExactlyMatchRequestedIds } from "@/lib/debtSyncResult";
import { goalAffordabilityFromProjectedBalance } from "@/lib/goalAffordability";
import { updateManualAccountWithAnchorAtomically } from "@/lib/atomicFinancialMutations";
import {
  budgetPlanCacheCanHydrateBeforeMembership,
  clearBudgetPlanCachesForUser,
  readBudgetPlanCache,
  writeBudgetPlanCache,
  type BudgetPlanCacheRecord,
} from "@/lib/budgetPlanCache";
import {
  normalizedSettingsFields,
  settingsDbPatch,
  type SettingsField,
  type SettingsPatch,
} from "@/lib/settingsPersistence";
import {
  buildCanonicalPlanSimulationBaseline,
  type PlanSimulationBaseline,
  type PlanSimulationHorizon,
} from "@/lib/planSimulator";
import {
  hasCategoryBudgetCache,
  loadCategoryBudgetsExact,
  readCategoryBudgetCache,
  subscribeCategoryBudgets,
  type CategoryBudgetScope,
} from "@/lib/categoryBudgetStore";
import {
  buildDashboardFinancialSnapshot,
  dashboardFinancialSnapshotKey,
  selectRecentDashboardActivity,
  sumPostedDashboardIncome,
  type DashboardFinancialSnapshotIdentity,
  type DashboardFinancialSnapshotState,
} from "@/lib/dashboardFinancialSnapshot";
import { dashboardDecisionForecastMonthLimit } from "@/lib/dashboardFinancialModel";
import {
  dashboardSnapshotAfterBuildError,
  selectDashboardFinancialSnapshotForRender,
} from "@/lib/dashboardSnapshotSelection";
import {
  millisecondsUntilHouseholdDateChanges,
  subscribeHouseholdDateResumeEvents,
} from "@/lib/householdDateEpoch";
import {
  buildMatchedFinancialAllocationIndexes,
  authoritativeFreshnessTimestamp,
  financialProjectionPreparationMonths,
  financialProjectionMonthCacheKey,
  getOrComputeRevisionValue,
  indexRecordsByMonth,
  reuseStructurallyEqualFinancialValue,
  startCancellableStageQueue,
} from "@/lib/financialProjectionCache";

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
  frequency: "monthly" | "quarterly" | "biweekly" | "weekly";
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
  planned_debt_amount?: number;
  required_debt_amount?: number;
  custom_due_day?: number;
  paid_amount: number;
  actual_amount?: number;
  paid_date?: string;
}

type MonthlyOverridePatch = Partial<Omit<MonthlyOverride, "id" | "bill_id" | "month" | "year">>;

interface MonthlyOverrideWriteIntent {
  key: string;
  token: string;
  stableId: string;
  billId: string;
  month: number;
  year: number;
  patch: MonthlyOverridePatch;
  userId: string;
  householdId?: string;
  budgetId?: string | null;
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
  move_reason?: "manual" | "automatic";
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
  review_resolution?: "bill" | "income" | "goal" | "decision" | "snowball" | "manual" | "category" | "transfer";
  review_allocations?: ReviewAllocation[];
  reviewed_at?: string;
  reviewed_by?: string;
  user_edited_at?: string;
  linked_income_id?: string;
  linked_plan_id?: string;
  linked_plan_type?: "goal" | "decision" | "snowball" | "transaction";
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
  source?: "goal" | "decision" | "transaction";
  name?: string;
  category?: string | null;
  amount: number;
  plannedAmount?: number;
  occurrenceDate?: string;
  settlement?: "exact" | "full" | "partial" | "split" | "extra_principal" | "regular";
}

export interface ReconcileTransactionInput {
  transactionId: string;
  resolution: "bill" | "income" | "goal" | "decision" | "snowball" | "manual" | "category" | "transfer";
  targetId?: string;
  occurrenceDate?: string;
  plannedAmount?: number;
  settlement?: "exact" | "full" | "partial" | "split" | "extra_principal";
  extraCategory?: string;
}

export interface CreateSpendingBucketForTransactionInput {
  transactionId: string;
  name: string;
  targetAmount: number;
  targetDate: string;
}

export interface CreateSpendingBucketForTransactionResult {
  goalId: string;
  settlement: "exact" | "partial";
  appliedAmount: number;
  remainingAmount: number;
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
  display_name?: string;
  official_name?: string;
  mask?: string;
  persistent_account_id?: string;
  account_type?: string;
  account_subtype?: string;
  current_balance: number;
  current_balance_available?: boolean;
  available_balance?: number;
  minimum_payment_amount?: number;
  next_payment_due_date?: string;
  last_statement_balance?: number;
  last_statement_issue_date?: string;
  is_overdue?: boolean;
  purchase_apr?: number;
  liability_last_synced_at?: string;
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
  type: "manual" | "bill_surplus" | "bucket_remainder";
  amount: number;
  billId?: string;
  billName?: string;
  reviewTransactionId?: string;
  bucketId?: string;
  bucketName?: string;
  availableDate?: string;
  pendingBalanceApply?: boolean;
}

export interface CloseSpendingBucketRouteInput {
  bucketId: string;
  expectedSpent: number;
  expectedRemainder: number;
  preview: SnowballProjectionResult;
  sources: SnowballFundingSource[];
  existingPaymentId?: string;
}

export interface CloseSpendingBucketRouteResult {
  spent: number;
  routed: number;
  paymentId: string;
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
  balanceSource: DailyBalanceSource;
  balanceDate: string;
  balanceObservedAt?: string;
  balanceUnavailableReason?: "history_loading" | "history_error" | "close_not_recorded";
  projectedInflow?: number;
  projectedOutflow?: number;
  events?: FinancialEvent[];
  projectionEvents?: FinancialEvent[];
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
  pendingPlanMatches: PendingPlanMatch[];
  incomes: IncomeItem[];
  goals: Goal[];
  extraPayments: ExtraPayment[];
  categories: string[];
  settings: Settings;
  accounts: Account[];
  connectedBankAccounts: ConnectedBankAccount[];
  /** Every retained Plaid account identity used to classify historical activity. */
  transactionAccountIdentities: ConnectedBankAccount[];
  householdTimeZone: string;
  decisions: DecisionRecord[];
  households: HouseholdMembership[];
  householdMembers: HouseholdMember[];
  householdActivity: HouseholdActivity[];
  householdDetailsReady: boolean;
  categoriesReady: boolean;
  activeHousehold: HouseholdMembership | null;
  householdRole: HouseholdRole | null;
  canEditHousehold: boolean;
  forecastConfidence: ForecastConfidence;
  loading: boolean;
  /** True after an exact-scope cached or live core has committed for use. */
  startupCoreReady: boolean;
  loadError: string | null;
  dataUpdatedAt: string | null;
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
  refreshHouseholdsForPrivacy: () => Promise<void>;
  refreshHouseholdActivity: () => Promise<void>;
  switchHousehold: (householdId: string) => Promise<void>;
  createHouseholdInvite: (role?: HouseholdInviteRole) => Promise<string>;
  acceptHouseholdInvite: (code: string) => Promise<void>;
  updateHouseholdMemberRole: (memberUserId: string, role: HouseholdInviteRole) => Promise<void>;
  removeHouseholdMember: (memberUserId: string) => Promise<void>;
  leaveActiveHousehold: () => Promise<void>;

  addBill: (bill: Omit<Bill, "id" | "created_at">) => Promise<string>;
  updateBill: (
    bill: Bill,
    editableFields: readonly BillEditableField[],
    baseline?: BillEditableBaseline,
  ) => Promise<void>;
  stopFutureBill: (id: string) => Promise<void>;
  deleteBill: (id: string) => Promise<void>;
  deleteBillMistake: (id: string) => Promise<void>;
  getBillById: (id: string) => Bill | undefined;

  getOverride: (billId: string, month: number, year: number) => MonthlyOverride | undefined;
  getAmount: (bill: Bill, month: number, year: number) => number;
  getPaidAmount: (billId: string, month: number, year: number) => number;
  setPaidAmount: (billId: string, month: number, year: number, amount: number) => Promise<void>;
  setCustomAmount: (billId: string, month: number, year: number, amount: number | undefined) => Promise<void>;
  setPlannedDebtAmount: (billId: string, month: number, year: number, amount: number | undefined) => Promise<void>;
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
  getDebtMonthSettlements: (month: number, year: number) => Map<string, DebtMonthSettlement>;
  getDebtSourceCommitment: (billId: string, occurrenceDate: string) => DebtSourceCommitment | undefined;
  getDebtPlanForMonth: (month: number, year: number) => DatedSnowballMonthPlanResult | null;
  getRemainingDebtPlanForMonth: (month: number, year: number) => DatedSnowballMonthPlanResult | null;

  runSnowball: (month: number, year: number, extraAmount: number) => SnowballAllocation[];
  previewDebtSnowball: (month: number, year: number, extraAmount?: number, additionalSafeCredit?: number, paymentDateOverride?: string, editingPaymentId?: string) => SnowballProjectionResult;
  applyDebtSnowballPayment: (preview: SnowballProjectionResult, sources?: SnowballFundingSource[], existingPaymentId?: string) => Promise<void>;
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
  matchPendingTransactionToBill: (pendingPlaidTransactionId: string, billId: string, occurrenceDate: string, plannedAmount: number) => Promise<void>;
  matchPendingTransactionToManual: (pendingPlaidTransactionId: string, manualTransactionId: string) => Promise<void>;
  removePendingPlanMatch: (matchId: string) => Promise<void>;
  reconcileTransaction: (input: ReconcileTransactionInput) => Promise<void>;
  createSpendingBucketForTransaction: (input: CreateSpendingBucketForTransactionInput) => Promise<CreateSpendingBucketForTransactionResult>;
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
  closeSpendingBucketAndRouteRemainder: (input: CloseSpendingBucketRouteInput) => Promise<CloseSpendingBucketRouteResult>;
  reopenSpendingBucket: (id: string, remainingAllocations?: SnowballAllocation[]) => Promise<void>;
  archiveSpendingBucket: (id: string) => Promise<void>;
  restoreArchivedSpendingBucket: (id: string) => Promise<void>;
  deleteGoal: (id: string) => Promise<void>;
  checkGoalAffordability: (goal: Goal, month: number, year: number) => GoalAffordability;

  getCashFlow: (month: number, year: number) => CashFlow;
  getDailyBalances: (month: number, year: number) => DailyBalance[];
  getCalendarDailyBalances: (month: number, year: number) => DailyBalance[];
  getPlanSimulationBaseline: (horizonMonths: PlanSimulationHorizon, startDate?: string) => PlanSimulationBaseline;

  addCategory: (name: string) => Promise<void>;
  updateCategory: (oldName: string, newName: string) => Promise<void>;
  deleteCategory: (name: string) => Promise<void>;

  updateSettings: (s: Partial<Settings>) => Promise<void>;
  importBills: (imported: Omit<Bill, "id" | "created_at">[]) => Promise<void>;
  addAccount: (account: Omit<Account, "id" | "created_at" | "last_reconciled_at">) => Promise<void>;
  updateAccount: (account: Account) => Promise<void>;
  updateConnectedBankAccountDisplayName: (accountId: string, displayName: string | null) => Promise<void>;
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

function normalizeSettingsRow(row: any, fallback: Settings = DEFAULT_SETTINGS): Settings {
  return {
    zeroBasedBudgetEnabled: row?.zero_based_budget_enabled ?? fallback.zeroBasedBudgetEnabled,
    debtPayoffEnabled: row?.debt_payoff_enabled ?? fallback.debtPayoffEnabled,
    paymentMethod: canonicalDebtPaymentMethod(row?.payment_method ?? fallback.paymentMethod),
    starting_balance: Number(row?.starting_balance ?? fallback.starting_balance),
    starting_balance_date: row?.starting_balance_date ?? undefined,
    calendar_start_date: row?.calendar_start_date ?? undefined,
    safety_floor: Number(row?.safety_floor ?? fallback.safety_floor),
    forecast_horizon_months: Number(row?.forecast_horizon_months ?? fallback.forecast_horizon_months),
    onboarding_completed: row?.onboarding_completed ?? fallback.onboarding_completed,
  };
}

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

function parseCategoryMutationResult(
  value: unknown,
  fallbackName: string,
): { categoryName: string; categories: string[] } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The saved category could not be verified.");
  }
  const record = value as { categoryName?: unknown; categories?: unknown };
  const categoryName = normalizeCategoryInput(
    typeof record.categoryName === "string" ? record.categoryName : fallbackName,
  );
  if (!categoryName) throw new Error("The saved category name is invalid.");
  const persisted = Array.isArray(record.categories)
    ? record.categories.filter((item): item is string => typeof item === "string")
    : [];
  return { categoryName, categories: fallbackCategoryList(persisted) };
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
  // Assign priorities by ascending debt balance: smallest debt = #1 (snowball order)
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
        move_reason: item.move_reason === "automatic" ? "automatic" : "manual",
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
    move_reason: row.move_reason === "automatic" ? "automatic" : "manual",
    created_at: String(row.created_at ?? new Date().toISOString()),
    updated_at: row.updated_at ? String(row.updated_at) : undefined,
  };
}

function billDateMoveDbPayload(move: Pick<BillDateMove, "bill_id" | "from_date" | "to_date">, userId: string, scope?: HouseholdMembership | null) {
  return {
    user_id: userId,
    bill_id: move.bill_id,
    from_date: move.from_date.slice(0, 10),
    to_date: move.to_date.slice(0, 10),
    move_reason: "manual",
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
    ? ownsLegacyPersonalRows(scope)
      ? remoteBase.or(`household_id.eq.${scope.householdId},and(household_id.is.null,user_id.eq.${uid})`)
      : remoteBase.eq("household_id", scope.householdId)
    : remoteBase.eq("user_id", uid);
  const remote = await remoteQuery.order("from_date");

  if (remote.error) {
    return stored;
  }

  // Once the server responds, it is authoritative. Re-uploading stale local
  // rows would recreate dates that were deliberately reset or deleted.
  const remoteMoves = (remote.data ?? []).map(normalizeBillDateMoveRow);
  writeStoredBillDateMoves(uid, remoteMoves, scope?.householdId);
  return remoteMoves;
}

const markSnowballSourcesPending = (sources: SnowballFundingSource[]) =>
  sources.map(source => ({ ...source, pendingBalanceApply: true }));

const hasPendingSnowballBalanceApply = (payment: Pick<ExtraPayment, "sources">) =>
  (payment.sources ?? []).some(source => source.pendingBalanceApply);

const remainingSnowballAllocationAmount = (
  plannedAmount: number,
  match: ReviewAllocation | undefined,
) => {
  if (!match) return Math.max(0, Number(plannedAmount) || 0);
  if (match.settlement !== "partial") return 0;
  return Math.max(0, Number(match.plannedAmount ?? plannedAmount) - Number(match.amount || 0));
};

function normalizeGoalRow(goal: any): Goal {
  return {
    ...goal,
    target_amount: Number(goal.target_amount),
    current_amount: Number(goal.current_amount),
    goal_type: goal.goal_type ?? (Number(goal.current_amount) < 0 ? "planned_expense" : "savings"),
  };
}

function normalizeExtraPaymentRow(payment: any): ExtraPayment {
  return {
    ...payment,
    amount: Number(payment.amount),
    allocations: payment.allocations ?? [],
    payment_date: payment.payment_date ?? undefined,
    sources: payment.sources ?? [{ type: "manual", amount: Number(payment.amount) }],
  };
}

function normalizeBillRow(bill: any): Bill {
  return {
    ...bill,
    frequency: (bill.frequency ?? "monthly") as "monthly" | "quarterly" | "biweekly" | "weekly",
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
  const paidDate = demoDate(year, month, Math.max(1, Math.min(today.getDate(), 21)));
  const nextMonth = (month + 1) % 12;
  const nextMonthYear = month === 11 ? year + 1 : year;
  const bills: Bill[] = reorderDebtPriorities([
    { id: "demo-rent", name: "Rent", amount: 1450, category: "Housing", priority: 1, is_debt: false, balance: 0, interest_rate: 0, due_day: 1, is_recurring: true, frequency: "monthly", created_at: now, start_date: startDate, last_reviewed_at: now },
    { id: "demo-utilities", name: "Utilities", amount: 185, category: "Utilities", priority: 2, is_debt: false, balance: 0, interest_rate: 0, due_day: 10, is_recurring: true, frequency: "monthly", created_at: now, start_date: startDate, last_reviewed_at: now },
    { id: "demo-card", name: "Harbor Card", amount: 75, category: "Debt", priority: 1, is_debt: true, balance: 940, interest_rate: 18.9, due_day: 15, is_recurring: true, frequency: "monthly", created_at: now, start_date: startDate, include_in_snowball: true, last_reviewed_at: now },
    { id: "demo-auto", name: "Auto Loan", amount: 310, category: "Debt", priority: 2, is_debt: true, balance: 6200, interest_rate: 6.2, due_day: 28, is_recurring: true, frequency: "monthly", created_at: now, start_date: startDate, include_in_snowball: true, last_reviewed_at: now },
  ]);
  const overrides: MonthlyOverride[] = [
    { id: "demo-override-rent", bill_id: "demo-rent", month, year, paid_amount: 1450, actual_amount: 1450, paid_date: paidDate },
    { id: "demo-override-utilities", bill_id: "demo-utilities", month, year, paid_amount: 185, actual_amount: 185, paid_date: paidDate },
    { id: "demo-override-card", bill_id: "demo-card", month, year, paid_amount: 75, actual_amount: 75, paid_date: paidDate },
  ];
  const incomes: IncomeItem[] = [
    { id: "demo-paycheck", name: "Paycheck", amount: 2300, frequency: "biweekly", start_date: startDate, next_payment_date: demoDate(year, month, 29), amount_history: [], last_reviewed_at: now },
  ];
  const transactions: Transaction[] = [
    { id: "demo-market", date: demoDate(year, month, Math.max(1, today.getDate() - 3)), amount: -86.42, category: "Food", note: "Neighborhood Market" },
    { id: "demo-fuel", date: demoDate(year, month, Math.max(1, today.getDate() - 2)), amount: -44.17, category: "Transportation", note: "Fuel" },
    { id: "demo-pay", date: demoDate(year, month, Math.max(1, today.getDate() - 1)), amount: 2300, category: "Income", note: "Paycheck" },
  ];
  const goals: Goal[] = [
    { id: "demo-emergency", name: "Emergency Fund", target_amount: 5000, current_amount: 1800, target_date: `${year + 1}-06-30`, created_at: now, goal_type: "savings" },
    { id: "demo-holiday", name: "Holiday Gifts", target_amount: 1200, current_amount: 350, target_date: `${year}-12-15`, created_at: now, goal_type: "planned_expense", calendar_marker_only: false },
  ];
  const accounts: Account[] = [
    { id: "demo-checking", name: "Harbor Checking", account_type: "checking", current_balance: 3240, balance_as_of: localDateString(today), last_reconciled_at: now, is_active: true, created_at: now },
    { id: "demo-savings", name: "Rainy Day Savings", account_type: "savings", current_balance: 1800, balance_as_of: localDateString(today), last_reconciled_at: now, is_active: true, created_at: now },
  ];
  const decisions: DecisionRecord[] = [
    {
      id: "demo-decision-vacation", name: "Weekend getaway", decision_type: "one_time_purchase",
      scenario: { name: "Weekend getaway", type: "one_time_purchase", amount: 450, date: demoDate(nextMonthYear, nextMonth, 10) },
      result: { verdict: "safe", lowestBalance: 1180, lowestBalanceDate: demoDate(nextMonthYear, nextMonth, 12), monthlyCashFlowChange: 0, saferAmount: 450, explanation: "This stays above your safety floor through the next payday.", affectedDates: [demoDate(nextMonthYear, nextMonth, 10)] },
      status: "calendar", calendar_date: demoDate(nextMonthYear, nextMonth, 10), created_at: now,
    },
  ];
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    starting_balance: 3240,
    starting_balance_date: localDateString(today),
    calendar_start_date: startDate,
    onboarding_completed: true,
  };
  return { bills, overrides, billDateMoves: [] as BillDateMove[], transactions, incomes, goals, extraPayments: [] as ExtraPayment[], categories: DEFAULT_CATEGORIES, accounts, decisions, settings };
}

export function normalizeTransactionRow(transaction: any): Transaction {
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

function accountAwareTransactionCollections(
  rows: any[],
  accountIdentities: readonly ConnectedBankAccount[],
): { active: Transaction[]; deleted: Transaction[]; unknownPlaid: Transaction[] } {
  const collections = splitTransactionRows(rows);
  const active = selectFlowLedgerTransactions(collections.active, accountIdentities);
  const deleted = selectFlowLedgerTransactions(collections.deleted, accountIdentities);
  return {
    active: active.included,
    deleted: deleted.included,
    unknownPlaid: [...active.unknownPlaid, ...deleted.unknownPlaid],
  };
}

function checkingPendingBankRows(
  rows: PendingBankTransaction[],
  accountIdentities: readonly ConnectedBankAccount[],
): { included: PendingBankTransaction[]; unknownCount: number } {
  const included: PendingBankTransaction[] = [];
  let unknownCount = 0;
  rows.forEach(row => {
    const kind = plaidTransactionAccountKind({ source: "plaid", plaid_account_id: row.plaid_account_id }, accountIdentities);
    if (kind === "checking") included.push(row);
    else if (kind === "unknown") unknownCount += 1;
  });
  return { included, unknownCount };
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

function normalizePendingPlanMatchRow(row: any): PendingPlanMatch {
  return {
    id: String(row.id),
    pending_plaid_transaction_id: String(row.pending_plaid_transaction_id),
    pending_account_id: row.pending_account_id || undefined,
    target_type: row.target_type === "manual" ? "manual" : "bill",
    target_id: String(row.target_id),
    target_name: String(row.target_name || "Planned bill"),
    occurrence_date: String(row.occurrence_date).slice(0, 10),
    planned_amount: Number(row.planned_amount),
    pending_amount: Number(row.pending_amount),
    pending_transaction_date: String(row.pending_transaction_date).slice(0, 10),
    status: row.status,
    posted_transaction_id: row.posted_transaction_id || undefined,
    posted_plaid_transaction_id: row.posted_plaid_transaction_id || undefined,
    posted_amount: row.posted_amount == null ? undefined : Number(row.posted_amount),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function normalizeConnectedBankRows(rows: any[]): ConnectedBankAccount[] {
  return rows.map(account => {
    const currentBalance = Number(account.current_balance);
    const currentBalanceAvailable = account.current_balance != null && Number.isFinite(currentBalance);
    return {
      ...account,
      // Existing account presentation expects a number, but forecasting must
      // distinguish an unavailable Plaid balance from a verified zero.
      current_balance: currentBalanceAvailable ? currentBalance : 0,
      current_balance_available: currentBalanceAvailable,
      available_balance: account.available_balance == null ? undefined : Number(account.available_balance),
      minimum_payment_amount: account.minimum_payment_amount == null ? undefined : Number(account.minimum_payment_amount),
      last_statement_balance: account.last_statement_balance == null ? undefined : Number(account.last_statement_balance),
      purchase_apr: account.purchase_apr == null ? undefined : Number(account.purchase_apr),
      is_active: account.is_active !== false,
    };
  });
}

function normalizeDailyCheckingCloseRows(rows: any[]): DailyCheckingCloseSnapshot[] {
  return rows.flatMap(row => {
    const checkingBalance = Number(row.checking_balance);
    const accountCount = Number(row.account_count);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(row.balance_date ?? ""))) return [];
    if (!Number.isFinite(checkingBalance) || !Number.isFinite(accountCount) || accountCount < 1) return [];
    return [{
      balance_date: String(row.balance_date),
      checking_balance: checkingBalance,
      observed_at: String(row.observed_at),
      account_count: accountCount,
      source: "plaid_sync" as const,
    }];
  });
}

function normalizeAccountRow(account: any): Account {
  return {
    ...account,
    current_balance: Number(account.current_balance || 0),
    last_reconciled_at: account.last_reconciled_at ?? undefined,
    is_active: account.is_active !== false,
  };
}

function normalizeMonthlyOverrideRow(override: any): MonthlyOverride {
  return {
    ...override,
    paid_amount: Number(override.paid_amount),
    custom_amount: override.custom_amount !== null ? Number(override.custom_amount) : undefined,
    planned_debt_amount: override.planned_debt_amount !== null && override.planned_debt_amount !== undefined
      ? Number(override.planned_debt_amount)
      : undefined,
    required_debt_amount: override.required_debt_amount !== null && override.required_debt_amount !== undefined
      ? Number(override.required_debt_amount)
      : undefined,
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

function safeLocalDateInTimeZone(date: Date, timeZone: string): string {
  try {
    return localDateInTimeZone(date, timeZone);
  } catch {
    return localDateInTimeZone(date, "UTC");
  }
}

function useRevisionedState<T>(
  initialValue: T | (() => T),
) {
  const [state, setState] = useState(() => ({
    value: typeof initialValue === "function"
      ? (initialValue as () => T)()
      : initialValue,
    revision: 0,
  }));
  const setValue = useCallback((next: React.SetStateAction<T>) => {
    setState(current => {
      const value = typeof next === "function"
        ? (next as (previous: T) => T)(current.value)
        : next;
      const committedValue = reuseStructurallyEqualFinancialValue(
        current.value,
        value,
      );
      return Object.is(committedValue, current.value)
        ? current
        : { value: committedValue, revision: current.revision + 1 };
    });
  }, []);
  return [state.value, setValue, state.revision] as const;
}

// ─── Context ───────────────────────────────────────────────────────────────────

const BudgetContext = createContext<BudgetContextType | undefined>(undefined);

// ─── Provider ──────────────────────────────────────────────────────────────────

export function BudgetProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const userScopeIdRef = useRef<string | null>(userId);
  userScopeIdRef.current = userId;
  const financialDataUserIdRef = useRef<string | null>(userId);
  const demoMode = isDevDemoMode();

  const [bills,         setBills,         billsRevision] = useRevisionedState<Bill[]>([]);
  const [overrides,     setOverrides,     overridesRevision] = useRevisionedState<MonthlyOverride[]>([]);
  const [billDateMoves, setBillDateMoves, billDateMovesRevision] = useRevisionedState<BillDateMove[]>([]);
  const [transactions,  setTransactions,  transactionsRevision] = useRevisionedState<Transaction[]>([]);
  const demoManualMatchTargets = useRef(new Map<string, Transaction>());
  const demoManualBankRestore = useRef(new Map<string, Pick<Transaction, "note" | "debt_applied_amount" | "debt_applied_bill_id" | "user_edited_at">>());
  const [deletedTransactions, setDeletedTransactions, deletedTransactionsRevision] = useRevisionedState<Transaction[]>([]);
  const [pendingBankTransactions, setPendingBankTransactions, pendingBankTransactionsRevision] = useRevisionedState<PendingBankTransaction[]>([]);
  const [pendingPlanMatches, setPendingPlanMatches, pendingPlanMatchesRevision] = useRevisionedState<PendingPlanMatch[]>([]);
  const [incomes,       setIncomes,       incomesRevision] = useRevisionedState<IncomeItem[]>([]);
  const [goals,         setGoals,         goalsRevision] = useRevisionedState<Goal[]>([]);
  const [extraPayments, setExtraPayments, extraPaymentsRevision] = useRevisionedState<ExtraPayment[]>([]);
  const [categories,    setCategories,    categoriesRevision] = useRevisionedState<string[]>(DEFAULT_CATEGORIES);
  const [accounts,      setAccounts,      accountsRevision] = useRevisionedState<Account[]>([]);
  const [connectedBankAccounts, setConnectedBankAccounts, connectedBankAccountsRevision] = useRevisionedState<ConnectedBankAccount[]>([]);
  const [dailyCheckingCloses, setDailyCheckingCloses] = useState<DailyCheckingCloseSnapshot[]>([]);
  const [dailyCheckingCloseLoad, setDailyCheckingCloseLoad] = useState<{
    scopeKey: string | null;
    status: DailyCheckingCloseLoadStatus;
  }>({ scopeKey: null, status: "loading" });
  const [householdTimeZone, setHouseholdTimeZone, householdTimeZoneRevision] = useRevisionedState("UTC");
  const [transactionAccountIdentities, setTransactionAccountIdentities, transactionAccountIdentitiesRevision] = useRevisionedState<ConnectedBankAccount[]>([]);
  const [decisions,     setDecisions,     decisionsRevision] = useRevisionedState<DecisionRecord[]>([]);
  const [households,    setHouseholds]    = useState<HouseholdMembership[]>([]);
  const [householdMembers, setHouseholdMembers] = useState<HouseholdMember[]>([]);
  const [householdActivity, setHouseholdActivity] = useState<HouseholdActivity[]>([]);
  const [householdDetailsReadyScopeKey, setHouseholdDetailsReadyScopeKey] = useState<string | null>(null);
  const [categoriesReadyScopeKey, setCategoriesReadyScopeKey] = useState<string | null>(null);
  const [activeHouseholdId, setActiveHouseholdId] = useState<string | null>(null);
  const [settings,      setSettings,      settingsRevision] = useRevisionedState<Settings>(DEFAULT_SETTINGS);
  const [loading,       setLoading]       = useState(true);
  const [startupCoreReadyScopeKey, setStartupCoreReadyScopeKey] = useState<string | null>(null);
  const [loadError,     setLoadError]     = useState<string | null>(null);
  const [dataUpdatedAt, setDataUpdatedAt] = useState<string | null>(null);
  const [loadRetryNonce, setLoadRetryNonce] = useState(0);
  const [selectedYear,  setSelectedYear]  = useState(new Date().getFullYear());
  const [dashboardFilter, setDashboardFilter] = useState<DashboardFilter>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  const loaded = useRef(false);
  const overridesRef = useRef<MonthlyOverride[]>([]);
  const billDateMovesRef = useRef<BillDateMove[]>([]);
  const accountsRef = useRef<Account[]>([]);
  const authoritativeAccountsByIdRef = useRef(new Map<string, Account>());
  const settingsRef = useRef<Settings>(DEFAULT_SETTINGS);
  // UI state may include queued optimistic edits. CAS baselines must instead
  // come from the last row returned by the database for each household scope.
  const authoritativeSettingsByScopeRef = useRef(new Map<string, Settings>());
  const connectedBankAccountsRef = useRef<ConnectedBankAccount[]>([]);
  const transactionAccountIdentitiesRef = useRef<ConnectedBankAccount[]>([]);
  const householdsRef = useRef<HouseholdMembership[]>([]);
  const retrySaveRef = useRef<null | (() => Promise<void>)>(null);
  const retrySavePromiseRef = useRef<Promise<void> | null>(null);
  const saveStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveOperationSequenceRef = useRef(0);
  const saveLifecycleGenerationRef = useRef(0);
  const saveGenerationByOperationRef = useRef(new Map<number, number>());
  const activeSaveOperationsRef = useRef(new Set<number>());
  const failedSaveOperationRef = useRef<number | null>(null);
  const failedSaveOperationsRef = useRef(new Map<number, { message: string; retry: () => Promise<void> }>());
  const retryingSaveFailureRef = useRef<number | null>(null);
  const retryParentByOperationRef = useRef(new Map<number, number>());
  const billOverrideRetryIdsRef = useRef(new Map<string, Map<string, string>>());
  const billEditFieldTokensRef = useRef(new Map<string, Map<BillEditableField, string>>());
  const billWriteQueuesRef = useRef(new Map<string, Promise<unknown>>());
  const monthlyOverrideStableIdsRef = useRef(new Map<string, string>());
  const monthlyOverrideFieldTokensRef = useRef(new Map<string, Map<string, string>>());
  const monthlyOverrideAppliedFieldTokensRef = useRef(new Map<string, Map<string, string>>());
  const monthlyOverrideWriteQueuesRef = useRef(new Map<string, Promise<unknown>>());
  const accountEditTokensRef = useRef(new Map<string, string>());
  const accountWriteQueuesRef = useRef(new Map<string, Promise<unknown>>());
  const settingsFieldTokensRef = useRef(new Map<string, Map<SettingsField, string>>());
  const settingsWriteQueuesRef = useRef(new Map<string, Promise<unknown>>());
  const transactionEditTokensRef = useRef(new Map<string, string>());
  const transactionWriteQueuesRef = useRef(new Map<string, Promise<unknown>>());
  const householdScopeRef = useRef<HouseholdMembership | null>(null);
  const loadRequestRef = useRef(0);
  const bankRefreshRequestRef = useRef(0);
  const dailyCheckingCloseRequestRef = useRef(0);
  const householdResolutionRequestRef = useRef(0);
  const householdDetailsRequestRef = useRef(0);
  const householdActivityRequestRef = useRef(0);
  const postCoreSecondaryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const postCoreDebtTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const planCacheWriteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const authoritativeFreshnessTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dashboardDataRevisionRef = useRef("none");
  const pendingAuthoritativeFreshnessRef = useRef<{
    beforeRevision: string;
    requestId: number;
    updatedAt: string;
  } | null>(null);
  const startupCoreReadyScopeKeyRef = useRef<string | null>(null);
  const scopeTransitionPendingRef = useRef<string | null>(null);
  const userTransitionPendingRef = useRef(false);
  const scopeCoreLoadWaitersRef = useRef(new Map<string, Set<{
    resolve: () => void;
    reject: (error: Error) => void;
  }>>());
  const plaidSyncPromiseRef = useRef<Promise<void> | null>(null);
  const lastPlaidSyncAtRef = useRef(0);
  const lastPlanRefreshAtRef = useRef(0);
  const backgroundRefreshPendingRef = useRef(false);
  useEffect(() => { overridesRef.current = overrides; }, [overrides]);
  useEffect(() => { billDateMovesRef.current = billDateMoves; }, [billDateMoves]);
  useEffect(() => { accountsRef.current = accounts; }, [accounts]);
  useEffect(() => { settingsRef.current = settings; }, [settings]);
  useEffect(() => { connectedBankAccountsRef.current = connectedBankAccounts; }, [connectedBankAccounts]);
  useEffect(() => { transactionAccountIdentitiesRef.current = transactionAccountIdentities; }, [transactionAccountIdentities]);
  useEffect(() => { householdsRef.current = households; }, [households]);
  useEffect(() => () => {
    if (postCoreSecondaryTimerRef.current) clearTimeout(postCoreSecondaryTimerRef.current);
    if (postCoreDebtTimerRef.current) clearTimeout(postCoreDebtTimerRef.current);
    if (planCacheWriteTimerRef.current) clearTimeout(planCacheWriteTimerRef.current);
    if (authoritativeFreshnessTimerRef.current) {
      clearTimeout(authoritativeFreshnessTimerRef.current);
    }
  }, []);

  const updateStartupCoreReadyScopeKey = useCallback((scopeKey: string | null) => {
    startupCoreReadyScopeKeyRef.current = scopeKey;
    setStartupCoreReadyScopeKey(scopeKey);
  }, []);

  const clearScopedFinancialData = useCallback(() => {
    if (postCoreSecondaryTimerRef.current) {
      clearTimeout(postCoreSecondaryTimerRef.current);
      postCoreSecondaryTimerRef.current = null;
    }
    if (postCoreDebtTimerRef.current) {
      clearTimeout(postCoreDebtTimerRef.current);
      postCoreDebtTimerRef.current = null;
    }
    householdDetailsRequestRef.current += 1;
    householdActivityRequestRef.current += 1;
    setHouseholdDetailsReadyScopeKey(null);
    setCategoriesReadyScopeKey(null);
    updateStartupCoreReadyScopeKey(null);
    scopeCoreLoadWaitersRef.current.forEach(waiters => {
      waiters.forEach(waiter => waiter.reject(new Error("The active household changed.")));
    });
    scopeCoreLoadWaitersRef.current.clear();
    setBills([]);
    setOverrides([]);
    overridesRef.current = [];
    setBillDateMoves([]);
    billDateMovesRef.current = [];
    setTransactions([]);
    setDeletedTransactions([]);
    setPendingBankTransactions([]);
    setPendingPlanMatches([]);
    setIncomes([]);
    setGoals([]);
    setExtraPayments([]);
    setCategories(DEFAULT_CATEGORIES);
    setAccounts([]);
    accountsRef.current = [];
    authoritativeAccountsByIdRef.current.clear();
    setConnectedBankAccounts([]);
    connectedBankAccountsRef.current = [];
    dailyCheckingCloseRequestRef.current += 1;
    setDailyCheckingCloses([]);
    setDailyCheckingCloseLoad({ scopeKey: null, status: "loading" });
    setHouseholdTimeZone("UTC");
    setTransactionAccountIdentities([]);
    transactionAccountIdentitiesRef.current = [];
    setDecisions([]);
    setSettings(DEFAULT_SETTINGS);
    settingsRef.current = DEFAULT_SETTINGS;
    authoritativeSettingsByScopeRef.current.clear();
    setDataUpdatedAt(null);
    pendingAuthoritativeFreshnessRef.current = null;
    if (authoritativeFreshnessTimerRef.current) {
      clearTimeout(authoritativeFreshnessTimerRef.current);
      authoritativeFreshnessTimerRef.current = null;
    }
  }, [updateStartupCoreReadyScopeKey]);

  const resetSaveLifecycle = useCallback(() => {
    saveLifecycleGenerationRef.current += 1;
    saveGenerationByOperationRef.current.clear();
    activeSaveOperationsRef.current.clear();
    retryParentByOperationRef.current.clear();
    billOverrideRetryIdsRef.current.clear();
    billEditFieldTokensRef.current.clear();
    billWriteQueuesRef.current.clear();
    monthlyOverrideStableIdsRef.current.clear();
    monthlyOverrideFieldTokensRef.current.clear();
    monthlyOverrideAppliedFieldTokensRef.current.clear();
    monthlyOverrideWriteQueuesRef.current.clear();
    accountEditTokensRef.current.clear();
    accountWriteQueuesRef.current.clear();
    authoritativeAccountsByIdRef.current.clear();
    settingsFieldTokensRef.current.clear();
    settingsWriteQueuesRef.current.clear();
    authoritativeSettingsByScopeRef.current.clear();
    transactionEditTokensRef.current.clear();
    transactionWriteQueuesRef.current.clear();
    failedSaveOperationRef.current = null;
    failedSaveOperationsRef.current.clear();
    retryingSaveFailureRef.current = null;
    retrySaveRef.current = null;
    retrySavePromiseRef.current = null;
    if (saveStatusTimerRef.current) clearTimeout(saveStatusTimerRef.current);
    setSaveError(null);
    setSaveStatus("idle");
  }, []);

  const activeHousehold = useMemo(
    () => households.find(household => household.householdId === activeHouseholdId) ?? null,
    [households, activeHouseholdId],
  );
  const householdRole = activeHousehold?.role ?? null;
  const canEditHousehold = canEditHouseholdPlan(activeHousehold?.role);
  const secondaryDataScopeKey = userId && activeHousehold?.householdId
    ? `${userId}:${activeHousehold.householdId}`
    : null;
  const householdDetailsReady = demoMode || Boolean(
    secondaryDataScopeKey && householdDetailsReadyScopeKey === secondaryDataScopeKey,
  );
  const categoriesReady = demoMode || Boolean(
    secondaryDataScopeKey && categoriesReadyScopeKey === secondaryDataScopeKey,
  );
  const startupCoreReady = demoMode || Boolean(
    secondaryDataScopeKey && startupCoreReadyScopeKey === secondaryDataScopeKey,
  );
  const replaceActiveHouseholdScope = useCallback((next: HouseholdMembership | null) => {
    if (householdScopeRef.current?.householdId !== next?.householdId) resetSaveLifecycle();
    householdScopeRef.current = next;
    setActiveHouseholdId(next?.householdId ?? null);
  }, [resetSaveLifecycle]);

  const hydrateBudgetPlanCache = useCallback((
    cache: BudgetPlanCacheRecord,
    authoritativeHousehold?: HouseholdMembership,
    authoritativeHouseholds?: HouseholdMembership[],
  ) => {
    const nextHousehold = authoritativeHousehold ?? cache.household;
    if (
      cache.userId !== financialDataUserIdRef.current
      || cache.household.householdId !== nextHousehold.householdId
    ) return false;

    const cachedAccounts = cache.data.accounts
      .filter((account: any) => account?.account_type !== "credit_card")
      .map(normalizeAccountRow);
    const cachedIdentities = normalizeConnectedBankRows(cache.data.transactionAccountIdentities);
    const cachedTransactions = [
      ...cache.data.transactions,
      ...cache.data.deletedTransactions,
    ].map(normalizeTransactionRow);
    const transactionCollections = accountAwareTransactionCollections(
      cachedTransactions,
      cachedIdentities,
    );
    const cachedSettings = {
      ...DEFAULT_SETTINGS,
      ...cache.data.settings,
      paymentMethod: canonicalDebtPaymentMethod(
        (cache.data.settings as Partial<Settings>).paymentMethod,
      ),
    } as Settings;

    const nextHouseholds = authoritativeHouseholds ?? cache.households;
    householdsRef.current = nextHouseholds;
    setHouseholds(nextHouseholds);
    replaceActiveHouseholdScope(nextHousehold);
    setBills(reorderDebtPriorities(cache.data.bills.map(normalizeBillRow)));
    const cachedOverrides = cache.data.overrides.map(normalizeMonthlyOverrideRow);
    setOverrides(cachedOverrides);
    overridesRef.current = cachedOverrides;
    const cachedMoves = cache.data.billDateMoves.map(normalizeBillDateMoveRow);
    setBillDateMoves(cachedMoves);
    billDateMovesRef.current = cachedMoves;
    setTransactions(transactionCollections.active);
    setDeletedTransactions(transactionCollections.deleted);
    setPendingBankTransactions(normalizePendingBankRows(cache.data.pendingBankTransactions));
    setPendingPlanMatches(cache.data.pendingPlanMatches.map(normalizePendingPlanMatchRow));
    setIncomes(cache.data.incomes.map((income: any) => ({
      ...income,
      amount: Number(income.amount),
      amount_history: Array.isArray(income.amount_history) ? income.amount_history : [],
    })));
    setGoals(cache.data.goals.map(normalizeGoalRow));
    setExtraPayments(cache.data.extraPayments.map(normalizeExtraPaymentRow).filter(isValidExtraPaymentPlan));
    setCategories(fallbackCategoryList(cache.data.categories));
    setCategoriesReadyScopeKey(`${cache.userId}:${nextHousehold.householdId}`);
    setAccounts(cachedAccounts);
    accountsRef.current = cachedAccounts;
    authoritativeAccountsByIdRef.current = new Map(
      cachedAccounts.map(account => [account.id, account]),
    );
    const canonicalBankAccounts = canonicalConnectedAccounts(
      normalizeConnectedBankRows(cache.data.connectedBankAccounts),
    );
    setConnectedBankAccounts(canonicalBankAccounts);
    connectedBankAccountsRef.current = canonicalBankAccounts;
    setTransactionAccountIdentities(cachedIdentities);
    transactionAccountIdentitiesRef.current = cachedIdentities;
    const cachedCloses = normalizeDailyCheckingCloseRows(cache.data.dailyCheckingCloses);
    setDailyCheckingCloses(cachedCloses);
    setDailyCheckingCloseLoad({
      scopeKey: `${cache.userId}:${nextHousehold.householdId}`,
      status: "ready",
    });
    setHouseholdTimeZone(cache.data.householdTimeZone || "UTC");
    setDecisions(cache.data.decisions.map((decision: any) => ({
      ...decision,
      calendar_date: decision.calendar_date ?? undefined,
      applied_change: decision.applied_change ?? undefined,
    })));
    setSettings(cachedSettings);
    settingsRef.current = cachedSettings;
    authoritativeSettingsByScopeRef.current.set(
      `${cache.userId}:${nextHousehold.householdId}`,
      cachedSettings,
    );
    // Exact-scope cache hydration is the fast/offline startup contract. The
    // authoritative discovery guard prevents this same scope from being
    // falsely cleared while its background refresh is still in flight.
    updateStartupCoreReadyScopeKey(`${cache.userId}:${nextHousehold.householdId}`);
    setDataUpdatedAt(cache.dataUpdatedAt);
    lastPlanRefreshAtRef.current = Date.parse(cache.dataUpdatedAt) || 0;
    loaded.current = true;
    setLoadError(null);
    setLoading(false);
    return true;
  }, [replaceActiveHouseholdScope, updateStartupCoreReadyScopeKey]);

  useEffect(() => {
    if (householdScopeRef.current?.householdId === activeHousehold?.householdId) {
      householdScopeRef.current = activeHousehold;
    }
  }, [activeHousehold]);

  useEffect(() => {
    if (
      demoMode
      || !userId
      || !activeHousehold
      || !dataUpdatedAt
      || !loaded.current
      || !categoriesReady
    ) return;
    if (planCacheWriteTimerRef.current) clearTimeout(planCacheWriteTimerRef.current);
    const cache: BudgetPlanCacheRecord = {
      version: 1,
      userId,
      household: activeHousehold,
      households,
      savedAt: new Date().toISOString(),
      dataUpdatedAt,
      data: {
        bills,
        overrides,
        billDateMoves,
        transactions,
        deletedTransactions,
        pendingBankTransactions,
        pendingPlanMatches,
        incomes,
        goals,
        extraPayments,
        categories,
        accounts,
        connectedBankAccounts,
        dailyCheckingCloses,
        householdTimeZone,
        transactionAccountIdentities,
        decisions,
        settings: settings as unknown as Record<string, unknown>,
      },
    };
    planCacheWriteTimerRef.current = setTimeout(() => {
      planCacheWriteTimerRef.current = null;
      void writeBudgetPlanCache(cache).then(written => {
        if (!written) console.warn("Verified plan cache could not be updated.");
      });
    }, 250);
    return () => {
      if (planCacheWriteTimerRef.current) {
        clearTimeout(planCacheWriteTimerRef.current);
        planCacheWriteTimerRef.current = null;
      }
    };
  }, [
    accounts,
    activeHousehold,
    billDateMoves,
    bills,
    categories,
    categoriesReady,
    connectedBankAccounts,
    dailyCheckingCloses,
    dataUpdatedAt,
    decisions,
    deletedTransactions,
    demoMode,
    extraPayments,
    goals,
    householdTimeZone,
    households,
    incomes,
    overrides,
    pendingBankTransactions,
    pendingPlanMatches,
    settings,
    transactionAccountIdentities,
    transactions,
    userId,
  ]);

  const assertCanEditHousehold = useCallback((action = "change this household plan") => {
    if (!canEditHouseholdPlan(householdScopeRef.current?.role)) {
      throw new Error(`View-only household access cannot ${action}.`);
    }
    if (!demoMode) assertFinancialMutationOnline();
  }, [demoMode]);

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
    if (ownsLegacyPersonalRows(scope)) {
      return query.or(`household_id.eq.${scope.householdId},and(household_id.is.null,user_id.eq.${uid})`);
    }
    return query.eq("household_id", scope.householdId);
  }, []);

  const loadAllTransactions = useCallback((uid: string) => loadAllDateIdKeysetRows<any>((cursor, pageSize) => {
    let query = applyHouseholdSelect(
      supabase.from("transactions")
        .select("*")
        .order("date", { ascending: false })
        .order("id", { ascending: false })
        .limit(pageSize),
      uid,
    );
    if (cursor) query = query.or(dateIdKeysetFilter(cursor));
    return query;
  }, 1_000), [applyHouseholdSelect]);

  const loadDailyCheckingCloses = useCallback((scope?: HouseholdMembership | null) => {
    if (!scope?.householdId) return Promise.resolve({ data: [], error: null });
    return loadAllDailyCheckingCloses(async (from, to) => {
      const result = await supabase
        .from("household_daily_checking_closes")
        .select("balance_date,checking_balance,observed_at,account_count,source")
        .eq("household_id", scope.householdId)
        .order("balance_date", { ascending: false })
        .range(from, to);
      return result as any;
    });
  }, []);

  const refreshDailyCheckingCloses = useCallback((
    scope: HouseholdMembership | null | undefined,
    isCurrent: () => boolean,
  ) => {
    const requestGeneration = ++dailyCheckingCloseRequestRef.current;
    const scopeKey = scope?.householdId
      ? `${financialDataUserIdRef.current ?? "signed-out"}:${scope.householdId}`
      : null;
    setDailyCheckingCloseLoad(current => (
      current.scopeKey === scopeKey && current.status === "ready"
        ? current
        : { scopeKey, status: "loading" }
    ));
    // Recorded closes are display-only. Start them beside the financial load,
    // but never make startup/resume or data freshness wait for paged history.
    void loadDailyCheckingCloses(scope).then(result => {
      if (result.error) {
        console.warn("Daily checking history deferred", result.error.message);
        if (shouldApplyDailyCheckingCloseLoad(
          requestGeneration,
          dailyCheckingCloseRequestRef.current,
          isCurrent(),
        )) {
          setDailyCheckingCloseLoad(current => (
            current.scopeKey === scopeKey && current.status === "ready"
              ? current
              : { scopeKey, status: "error" }
          ));
        }
        return;
      }
      if (!shouldApplyDailyCheckingCloseLoad(
        requestGeneration,
        dailyCheckingCloseRequestRef.current,
        isCurrent(),
      )) return;
      setDailyCheckingCloses(normalizeDailyCheckingCloseRows(result.data ?? []));
      setDailyCheckingCloseLoad({ scopeKey, status: "ready" });
    }).catch(error => {
      // Retain the last successful same-scope history. After a scope clear,
      // past balances stay unavailable until a guarded history load succeeds.
      console.warn("Daily checking history deferred", error);
      if (shouldApplyDailyCheckingCloseLoad(
        requestGeneration,
        dailyCheckingCloseRequestRef.current,
        isCurrent(),
      )) {
        setDailyCheckingCloseLoad(current => (
          current.scopeKey === scopeKey && current.status === "ready"
            ? current
            : { scopeKey, status: "error" }
        ));
      }
    });
  }, [loadDailyCheckingCloses]);

  const deleteRowIdempotently = useCallback(async (
    table: "bills" | "extra_payments" | "incomes" | "goals" | "decisions",
    id: string,
    action: string,
  ) => {
    if (!user) throw new Error(`Sign in to ${action.toLowerCase()}.`);
    const scope = householdScopeRef.current;
    const deleted = await supabase.from(table).delete().eq("id", id).select("id").maybeSingle();
    if (deleted.error) throw new Error(`${action}: ${deleted.error.message}`);
    if (deleted.data) return;

    // A zero-row DELETE is valid after a committed response was lost, but it
    // can also mean RLS rejected a stale editor role. Verify live membership
    // and authoritative absence before showing the retry as saved.
    if (scope && !ownsLegacyPersonalRows(scope)) {
      const memberships = await loadHouseholdMemberships(user.id);
      const current = memberships.find(membership => membership.householdId === scope.householdId);
      if (!canEditHouseholdPlan(current?.role)) {
        throw new Error(`${action}: your access to this household changed. Refresh before trying again.`);
      }
    }
    const remaining = await applyHouseholdSelect(supabase.from(table).select("id"), user.id)
      .eq("id", id)
      .maybeSingle();
    if (remaining.error) throw new Error(`Verify ${action.toLowerCase()}: ${remaining.error.message}`);
    if (remaining.data) throw new Error(`${action}: the item still exists. Refresh and try again.`);
  }, [applyHouseholdSelect, user]);

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

  const waitForScopeCoreLoad = useCallback((householdId: string) => {
    if (
      loaded.current
      && scopeTransitionPendingRef.current !== householdId
      && householdScopeRef.current?.householdId === householdId
    ) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const waiters = scopeCoreLoadWaitersRef.current.get(householdId) ?? new Set();
      waiters.add({ resolve, reject });
      scopeCoreLoadWaitersRef.current.set(householdId, waiters);
    });
  }, []);

  const settleScopeCoreLoad = useCallback((householdId: string, error?: Error) => {
    const waiters = scopeCoreLoadWaitersRef.current.get(householdId);
    if (!waiters) return;
    scopeCoreLoadWaitersRef.current.delete(householdId);
    waiters.forEach(waiter => {
      if (error) waiter.reject(error);
      else waiter.resolve();
    });
  }, []);

  const refreshHouseholdDetails = useCallback(async (scope?: HouseholdMembership | null) => {
    const requestId = ++householdDetailsRequestRef.current;
    const requestUserId = financialDataUserIdRef.current;
    const readyScopeKey = requestUserId && scope?.householdId
      ? `${requestUserId}:${scope.householdId}`
      : null;
    if (!scope) {
      setHouseholdMembers([]);
      setHouseholdActivity([]);
      setHouseholdDetailsReadyScopeKey(null);
      return;
    }
    const [members, activity] = await Promise.all([
      loadHouseholdMembers(scope.householdId),
      loadHouseholdActivity(scope.householdId, 12),
    ]);
    if (!scopedRequestIsCurrent({
      requestId,
      currentRequestId: householdDetailsRequestRef.current,
      householdId: scope.householdId,
      currentHouseholdId: householdScopeRef.current?.householdId,
    }) || requestUserId !== financialDataUserIdRef.current) return;
    setHouseholdMembers(members);
    setHouseholdActivity(activity);
    setHouseholdDetailsReadyScopeKey(readyScopeKey);
  }, []);

  const resolveHouseholds = useCallback(async (uid: string, loadDetails = true) => {
    const resolutionRequestId = ++householdResolutionRequestRef.current;
    const resolution = await loadResolvedHouseholdSelection({
      loadHouseholds: () => loadHouseholdMemberships(uid),
      readStoredHouseholdId: () => readStoredActiveHouseholdId(uid),
      readRemoteHouseholdId: () => loadRemoteActiveHouseholdId(uid),
    });
    if (
      !householdResolutionIsCurrent({
        requestId: resolutionRequestId,
        currentRequestId: householdResolutionRequestRef.current,
        requestUserId: uid,
        currentUserId: financialDataUserIdRef.current,
      })
      || uid !== userScopeIdRef.current
    ) {
      throw new Error("Household resolution was superseded by a newer session or request");
    }
    const memberships = resolution.households;
    const next = resolution.activeHousehold;
    const nextHouseholdId = next?.householdId ?? null;
    // Compare at commit time. The exact cached scope may have hydrated while
    // household discovery was in flight; treating the pre-request null as the
    // current scope clears readiness and creates a page -> loader flash.
    const committedHouseholdId = householdScopeRef.current?.householdId ?? null;
    const scopeChanged = householdResolutionChangesCommittedScope(
      committedHouseholdId,
      nextHouseholdId,
    );
    if (scopeChanged) {
      bankRefreshRequestRef.current += 1;
      clearScopedFinancialData();
      setHouseholdMembers([]);
      setHouseholdActivity([]);
      loaded.current = false;
      scopeTransitionPendingRef.current = committedHouseholdId && nextHouseholdId
        ? nextHouseholdId
        : null;
      setLoading(nextHouseholdId !== null);
    }
    // Commit only after membership, household, budget, and selection reads all
    // completed successfully. When the authoritative selection changes, old
    // financial arrays are cleared in the same render before the new label can
    // be exposed; the new scope stays loading until its core query commits.
    householdsRef.current = memberships;
    setHouseholds(memberships);
    if (!next) {
      replaceActiveHouseholdScope(null);
      setHouseholdMembers([]);
      setHouseholdActivity([]);
      return null;
    }
    const remoteActive = resolution.remoteHouseholdId;
    replaceActiveHouseholdScope(next);
    if (remoteActive !== next.householdId) {
      // Local selection is authoritative on this device. Syncing that preference
      // to another device is useful, but it is not part of loading financial data.
      void saveActiveHouseholdId(uid, next.householdId).catch(error => {
        console.warn("Active household preference sync deferred", error);
      });
    } else {
      void writeStoredActiveHouseholdId(uid, next.householdId);
    }
    if (loadDetails) {
      void refreshHouseholdDetails(next).catch(error => {
        console.warn("Household details refresh skipped", error);
      });
    }
    return next;
  }, [clearScopedFinancialData, refreshHouseholdDetails, replaceActiveHouseholdScope]);

  const markSaveStarted = useCallback(() => {
    const operationId = ++saveOperationSequenceRef.current;
    activeSaveOperationsRef.current.add(operationId);
    saveGenerationByOperationRef.current.set(operationId, saveLifecycleGenerationRef.current);
    const retryParent = retryingSaveFailureRef.current;
    if (retryParent !== null) {
      retryParentByOperationRef.current.set(operationId, retryParent);
      retryingSaveFailureRef.current = null;
    }
    if (saveStatusTimerRef.current) clearTimeout(saveStatusTimerRef.current);
    if (failedSaveOperationRef.current === null) {
      setSaveError(null);
      setSaveStatus("saving");
    }
    return operationId;
  }, []);

  const markSaveCompleted = useCallback((operationId?: number) => {
    const operationGeneration = operationId === undefined
      ? saveLifecycleGenerationRef.current
      : saveGenerationByOperationRef.current.get(operationId);
    if (operationId !== undefined) saveGenerationByOperationRef.current.delete(operationId);
    if (operationGeneration !== saveLifecycleGenerationRef.current) {
      clearScopedFinancialData();
      return;
    }
    if (operationId !== undefined) activeSaveOperationsRef.current.delete(operationId);
    const retryParent = operationId === undefined
      ? undefined
      : retryParentByOperationRef.current.get(operationId);
    if (operationId !== undefined) retryParentByOperationRef.current.delete(operationId);
    if (retryParent !== undefined && failedSaveOperationRef.current === retryParent) {
      failedSaveOperationsRef.current.delete(retryParent);
      const nextFailure = failedSaveOperationsRef.current.entries().next().value as
        | [number, { message: string; retry: () => Promise<void> }]
        | undefined;
      if (nextFailure) {
        failedSaveOperationRef.current = nextFailure[0];
        retrySaveRef.current = nextFailure[1].retry;
        setSaveError(nextFailure[1].message);
        setSaveStatus("failed");
        return;
      }
      failedSaveOperationRef.current = null;
      retrySaveRef.current = null;
      setSaveError(null);
    }
    // An unrelated completion must never hide a still-actionable failure.
    if (failedSaveOperationRef.current !== null) {
      setSaveStatus("failed");
      return;
    }
    if (activeSaveOperationsRef.current.size > 0) {
      setSaveStatus("saving");
      return;
    }
    retrySaveRef.current = null;
    setSaveError(null);
    setSaveStatus("saved");
    setDataUpdatedAt(new Date().toISOString());
    if (saveStatusTimerRef.current) clearTimeout(saveStatusTimerRef.current);
    saveStatusTimerRef.current = setTimeout(() => setSaveStatus("idle"), 1400);
  }, [clearScopedFinancialData]);

  const markSaveFailed = useCallback((error: unknown, retry: () => Promise<void>, operationId?: number) => {
    const operationGeneration = operationId === undefined
      ? saveLifecycleGenerationRef.current
      : saveGenerationByOperationRef.current.get(operationId);
    if (operationId !== undefined) saveGenerationByOperationRef.current.delete(operationId);
    if (operationGeneration !== saveLifecycleGenerationRef.current) {
      clearScopedFinancialData();
      return;
    }
    if (saveStatusTimerRef.current) clearTimeout(saveStatusTimerRef.current);
    if (operationId !== undefined) activeSaveOperationsRef.current.delete(operationId);
    const retryParent = operationId === undefined
      ? undefined
      : retryParentByOperationRef.current.get(operationId);
    if (operationId !== undefined) retryParentByOperationRef.current.delete(operationId);
    const failureId = retryParent ?? operationId ?? ++saveOperationSequenceRef.current;
    const message = error instanceof Error ? error.message : "Your change could not be saved.";
    failedSaveOperationsRef.current.set(failureId, { message, retry });
    if (failedSaveOperationRef.current === null || failedSaveOperationRef.current === failureId) {
      failedSaveOperationRef.current = failureId;
      retrySaveRef.current = retry;
      setSaveError(message);
    }
    setSaveStatus("failed");
    void recordDiagnostic(user?.id, {
      eventType: "save_failure", operation: "amount_save", platform: diagnosticPlatform(),
      errorCode: diagnosticErrorCode(error),
    }).catch(() => undefined);
  }, [clearScopedFinancialData, user]);

  const runTrackedFinancialMutation = useCallback(<T,>(
    operation: () => Promise<T>,
    retry: () => Promise<unknown>,
  ) => {
    let operationId: number | undefined;
    const operationScope: FinancialMutationScope = {
      userId: userScopeIdRef.current,
      householdId: householdScopeRef.current?.householdId ?? null,
      generation: saveLifecycleGenerationRef.current,
    };
    const currentScope = (): FinancialMutationScope => ({
      userId: userScopeIdRef.current,
      householdId: householdScopeRef.current?.householdId ?? null,
      generation: saveLifecycleGenerationRef.current,
    });
    const guardedOperation = async () => {
      assertFinancialMutationScope(operationScope, currentScope());
      try {
        return await operation();
      } finally {
        try {
          assertFinancialMutationScope(operationScope, currentScope());
        } catch {
          // A sign-out invalidates in-flight writes. Some operations optimistically
          // update state after the network response, so clear any stale household
          // values that could otherwise land after the auth scope was removed.
          clearScopedFinancialData();
        }
      }
    };
    const guardedRetry = async () => {
      assertFinancialMutationScope(operationScope, currentScope());
      await retry();
    };
    return runRecoverableFinancialMutation(guardedOperation, guardedRetry, {
      onStarted: () => { operationId = markSaveStarted(); },
      onCompleted: () => markSaveCompleted(operationId),
      onFailed: (error, nextRetry) => markSaveFailed(error, nextRetry, operationId),
    });
  }, [clearScopedFinancialData, markSaveCompleted, markSaveFailed, markSaveStarted]);

  const retryLastSave = useCallback(async () => {
    await runSingleFlight(retrySavePromiseRef, async () => {
      const retry = retrySaveRef.current;
      const failureId = failedSaveOperationRef.current;
      if (!retry || failureId === null) return;
      retryingSaveFailureRef.current = failureId;
      try {
        await retry();
      } catch {
        // The retried mutation refreshes the failure banner and keeps the latest retry callback.
      } finally {
        if (retryingSaveFailureRef.current === failureId) retryingSaveFailureRef.current = null;
      }
    });
  }, []);

  const clearSaveError = useCallback(() => {
    failedSaveOperationRef.current = null;
    failedSaveOperationsRef.current.clear();
    retryingSaveFailureRef.current = null;
    retrySaveRef.current = null;
    setSaveError(null);
    setSaveStatus(activeSaveOperationsRef.current.size > 0 ? "saving" : "idle");
  }, []);

  useLayoutEffect(() => {
    if (financialDataUserIdRef.current === userId) return;
    const priorUserId = financialDataUserIdRef.current;
    if (priorUserId) void clearBudgetPlanCachesForUser(priorUserId);
    financialDataUserIdRef.current = userId;
    householdResolutionRequestRef.current += 1;
    loadRequestRef.current += 1;
    bankRefreshRequestRef.current += 1;
    backgroundRefreshPendingRef.current = false;
    scopeTransitionPendingRef.current = null;
    userTransitionPendingRef.current = Boolean(priorUserId && userId);
    resetSaveLifecycle();
    clearScopedFinancialData();
    setHouseholds([]);
    setHouseholdMembers([]);
    setHouseholdActivity([]);
    replaceActiveHouseholdScope(null);
    queryClient.removeQueries({ queryKey: ["budget-core"] });
    loaded.current = false;
    setLoadError(null);
    setLoading(Boolean(userId));
  }, [clearScopedFinancialData, queryClient, replaceActiveHouseholdScope, resetSaveLifecycle, userId]);

  const retryBudgetLoad = useCallback(() => {
    setLoadError(null);
    void queryClient.invalidateQueries({ queryKey: ["budget-core"] });
    setLoadRetryNonce(value => value + 1);
  }, [queryClient]);

  const refreshPlanInBackground = useCallback(() => {
    if (!userId || demoMode || loadError || !loaded.current || backgroundRefreshPendingRef.current) return;
    const online = knownNetworkStatus() === true;
    if (!shouldRefreshPlanOnResume({
      lastRefreshAt: lastPlanRefreshAtRef.current,
      online,
      staleAfterMs: Platform.OS === "web" ? PWA_RESUME_STALE_MS : undefined,
    })) return;
    backgroundRefreshPendingRef.current = true;
    void queryClient.invalidateQueries({ queryKey: ["budget-core", userId] });
    setLoadRetryNonce(value => value + 1);
  }, [demoMode, loadError, queryClient, userId]);

  const refreshHouseholds = useCallback(async () => {
    if (!userId || demoMode) return;
    const priorHouseholdId = householdScopeRef.current?.householdId ?? null;
    loadRequestRef.current += 1;
    bankRefreshRequestRef.current += 1;
    const next = await resolveHouseholds(userId);
    if (priorHouseholdId === (next?.householdId ?? null) || !next) return;
    await queryClient.cancelQueries({ queryKey: ["budget-core", userId] });
    queryClient.removeQueries({ queryKey: ["budget-core", userId] });
    const coreReady = waitForScopeCoreLoad(next.householdId);
    setLoadRetryNonce(value => value + 1);
    await coreReady;
  }, [userId, demoMode, queryClient, resolveHouseholds, waitForScopeCoreLoad]);

  const refreshHouseholdsForPrivacy = useCallback(async () => {
    if (!userId || demoMode) return;
    const priorScope = householdScopeRef.current;
    if (!priorScope) {
      clearScopedFinancialData();
      queryClient.removeQueries({ queryKey: ["budget-core", userId] });
      const next = await withLoadTimeout(resolveHouseholds(userId), 8000, "Restore household access");
      if (next) {
        const coreReady = waitForScopeCoreLoad(next.householdId);
        setLoadRetryNonce(value => value + 1);
        await coreReady;
      }
      return;
    }
    // A personal household cannot revoke its sole owner's membership. Avoid a
    // redundant foreground network round trip so returning to the app is
    // immediate; the normal background plan refresh still checks live data.
    if (ownsLegacyPersonalRows(priorScope)) return;
    const stillAuthorized = await withLoadTimeout(
      verifyCurrentHouseholdMembership(userId, priorScope.householdId),
      8000,
      "Verify household access",
    );
    if (!stillAuthorized) {
      loadRequestRef.current += 1;
      bankRefreshRequestRef.current += 1;
      resetSaveLifecycle();
      clearScopedFinancialData();
      queryClient.removeQueries({ queryKey: ["budget-core", userId] });
      const next = await withLoadTimeout(resolveHouseholds(userId), 8000, "Restore household access");
      if (next) {
        const coreReady = waitForScopeCoreLoad(next.householdId);
        setLoadRetryNonce(value => value + 1);
        await coreReady;
      } else {
        loaded.current = false;
        setLoading(false);
      }
      return;
    }
    // The membership row is the only security decision needed on a quick
    // resume. The ordinary stale-plan refresh updates household metadata and
    // financial data without blocking the already-rendered screen.
  }, [clearScopedFinancialData, demoMode, queryClient, resetSaveLifecycle, resolveHouseholds, userId, waitForScopeCoreLoad]);

  const refreshHouseholdActivity = useCallback(async () => {
    const requestId = ++householdActivityRequestRef.current;
    if (!activeHousehold) {
      setHouseholdActivity([]);
      return;
    }
    const activity = await loadHouseholdActivity(activeHousehold.householdId, 12);
    if (!scopedRequestIsCurrent({
      requestId,
      currentRequestId: householdActivityRequestRef.current,
      householdId: activeHousehold.householdId,
      currentHouseholdId: householdScopeRef.current?.householdId,
    })) return;
    setHouseholdActivity(activity);
  }, [activeHousehold]);

  useEffect(() => {
    if (loading || !user || demoMode || !activeHousehold || activeHousehold.role === "viewer") return;
    const detectedTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    if (detectedTimeZone === "UTC") return;
    void (async () => {
      const { data } = await supabase
        .from("household_settings")
        .select("time_zone")
        .eq("household_id", activeHousehold.householdId)
        .maybeSingle();
      if (data?.time_zone !== "UTC") return;
      const update = await supabase
        .from("household_settings")
        .update({ time_zone: detectedTimeZone, updated_at: new Date().toISOString() })
        .eq("household_id", activeHousehold.householdId);
      if (!update.error && householdScopeRef.current?.householdId === activeHousehold.householdId) {
        setHouseholdTimeZone(detectedTimeZone);
      }
    })();
  }, [loading, user, demoMode, activeHousehold]);

  const switchHousehold = useCallback(async (householdId: string) => {
    if (!user || demoMode) return;
    if (activeSaveOperationsRef.current.size > 0) {
      throw new Error("Wait for your current change to finish saving before switching households.");
    }
    const next = households.find(household => household.householdId === householdId);
    if (!next) return;
    // Invalidate both load channels before clearing or awaiting cancellation so
    // an old household response cannot repopulate state during the switch.
    householdResolutionRequestRef.current += 1;
    loadRequestRef.current += 1;
    bankRefreshRequestRef.current += 1;
    setLoading(true);
    setLoadError(null);
    clearScopedFinancialData();
    await queryClient.cancelQueries({ queryKey: ["budget-core", user.id] });
    queryClient.removeQueries({ queryKey: ["budget-core", user.id] });
    replaceActiveHouseholdScope(next);
    await saveActiveHouseholdId(user.id, next.householdId);
    await refreshHouseholdDetails(next);
    setLoadRetryNonce(value => value + 1);
  }, [user, demoMode, households, clearScopedFinancialData, queryClient, refreshHouseholdDetails, replaceActiveHouseholdScope]);

  const createHouseholdInvite = useCallback(async (role: HouseholdInviteRole = "editor") => {
    if (!activeHousehold) throw new Error("Choose a household first.");
    if (!canManageHouseholdMembers(activeHousehold.role)) throw new Error("Only household owners or managers can invite people.");
    return createHouseholdInviteCode(activeHousehold.householdId, role);
  }, [activeHousehold]);

  const acceptHouseholdInvite = useCallback(async (code: string) => {
    if (!user) throw new Error("Sign in before joining a household.");
    if (activeSaveOperationsRef.current.size > 0) {
      throw new Error("Wait for your current change to finish saving before joining another household.");
    }
    const householdId = await acceptHouseholdInviteCode(code);
    resetSaveLifecycle();
    clearScopedFinancialData();
    replaceActiveHouseholdScope(null);
    await queryClient.cancelQueries({ queryKey: ["budget-core", user.id] });
    queryClient.removeQueries({ queryKey: ["budget-core", user.id] });
    await saveActiveHouseholdId(user.id, householdId);
    await resolveHouseholds(user.id);
    setLoadRetryNonce(value => value + 1);
  }, [user, clearScopedFinancialData, queryClient, replaceActiveHouseholdScope, resetSaveLifecycle, resolveHouseholds]);

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
    if (activeSaveOperationsRef.current.size > 0) {
      throw new Error("Wait for your current change to finish saving before leaving this household.");
    }
    const householdId = activeHousehold.householdId;
    resetSaveLifecycle();
    await leaveHouseholdRecord(householdId);
    clearScopedFinancialData();
    replaceActiveHouseholdScope(null);
    await queryClient.cancelQueries({ queryKey: ["budget-core", user.id] });
    queryClient.removeQueries({ queryKey: ["budget-core", user.id] });
    const next = await resolveHouseholds(user.id);
    if (next) await saveActiveHouseholdId(user.id, next.householdId);
    setLoadRetryNonce(value => value + 1);
  }, [user, activeHousehold, clearScopedFinancialData, queryClient, replaceActiveHouseholdScope, resetSaveLifecycle, resolveHouseholds]);

  // ── Load from Supabase when user changes ────────────────────────────────────
  useEffect(() => {
    const requestId = ++loadRequestRef.current;
    bankRefreshRequestRef.current += 1;
    if (demoMode) {
      setLoadError(null);
      const demo = createDemoBudgetData();
      const demoHousehold: HouseholdMembership = {
        householdId: "local",
        budgetId: "local",
        name: "Harbor Household",
        isPersonal: true,
        role: "owner",
      };
      setHouseholds([demoHousehold]);
      replaceActiveHouseholdScope(demoHousehold);
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
      setExtraPayments(demo.extraPayments.filter(isValidExtraPaymentPlan));
      setCategories(demo.categories);
      setAccounts(demo.accounts);
      setConnectedBankAccounts([]);
      setDailyCheckingCloses([]);
      setHouseholdTimeZone("UTC");
      setTransactionAccountIdentities([]);
      transactionAccountIdentitiesRef.current = [];
      setDecisions(demo.decisions);
      setSettings({
        ...demo.settings,
        paymentMethod: canonicalDebtPaymentMethod(demo.settings.paymentMethod),
      });
      setDataUpdatedAt(new Date().toISOString());
      loaded.current = true;
      setLoading(false);
      return;
    }
    if (!userId) {
      setLoadError(null);
      setBills([]); setOverrides([]); setBillDateMoves([]); setTransactions([]); setDeletedTransactions([]); setPendingBankTransactions([]); setIncomes([]);
      setGoals([]); setExtraPayments([]); setCategories(DEFAULT_CATEGORIES); setAccounts([]); setConnectedBankAccounts([]); setDailyCheckingCloses([]); setHouseholdTimeZone("UTC"); setTransactionAccountIdentities([]); setDecisions([]); setSettings(DEFAULT_SETTINGS);
      setDailyCheckingCloseLoad({ scopeKey: null, status: "loading" });
      setHouseholdDetailsReadyScopeKey(null);
      setCategoriesReadyScopeKey(null);
      updateStartupCoreReadyScopeKey(null);
      transactionAccountIdentitiesRef.current = [];
      setHouseholds([]); setHouseholdMembers([]); setHouseholdActivity([]); replaceActiveHouseholdScope(null);
      billDateMovesRef.current = [];
      setDataUpdatedAt(null);
      loaded.current = false;
      setLoading(false);
      return;
    }
    let backgroundRefresh = backgroundRefreshPendingRef.current && loaded.current;
    if (!backgroundRefresh) {
      backgroundRefreshPendingRef.current = false;
      loaded.current = false;
      setLoading(true);
    }
    setLoadError(null);
    (async () => {
      const loadStarted = Date.now();
      let loadSucceeded = false;
      let resolvedScopeId: string | null = null;
      let blockingScopeTransition = false;
      const blockingUserTransition = userTransitionPendingRef.current;
      try {
        const uid = userId;
        const cachedPlanRequest = readStoredActiveHouseholdId(uid).then(storedHouseholdId => (
          storedHouseholdId
            ? readBudgetPlanCache(uid, storedHouseholdId)
            : null
        ));
        const scopeRequest = withLoadTimeout(
          resolveHouseholds(uid, false),
          8000,
          "Load households",
        ).then(
          value => ({ ok: true as const, value }),
          error => ({ ok: false as const, error }),
        );
        const cachedPlan = await cachedPlanRequest;
        let cacheHydrated = false;
        if (
          requestId === loadRequestRef.current
          && cachedPlan
          && budgetPlanCacheCanHydrateBeforeMembership(cachedPlan)
        ) {
          cacheHydrated = hydrateBudgetPlanCache(cachedPlan);
          if (cacheHydrated) backgroundRefresh = true;
        }
        const resolvedScope = await scopeRequest;
        if (!resolvedScope.ok) throw resolvedScope.error;
        const scope = resolvedScope.value;
        if (requestId !== loadRequestRef.current) return;
        if (
          !cacheHydrated
          && cachedPlan
          && scope
          && cachedPlan.household.householdId === scope.householdId
        ) {
          cacheHydrated = hydrateBudgetPlanCache(
            cachedPlan,
            scope,
            householdsRef.current,
          );
          if (cacheHydrated) backgroundRefresh = true;
        }
        resolvedScopeId = scope?.householdId ?? null;
        blockingScopeTransition = Boolean(
          resolvedScopeId
          && scopeTransitionPendingRef.current === resolvedScopeId,
        );
        refreshDailyCheckingCloses(scope, () => (
          requestId === loadRequestRef.current
          && scope?.householdId === householdScopeRef.current?.householdId
        ));
        // Version the positional result cache when its shape changes. This
        // prevents an in-memory pre-update array from shifting Decisions into
        // the removed daily-close slot during a web hot reload.
        const coreQueryKey = ["budget-core", uid, scope?.householdId ?? "personal", scope?.budgetId ?? "default", "core-v4"] as const;
        const coreLoad = await withLoadTimeout(
          queryClient.fetchQuery({
            queryKey: coreQueryKey,
            staleTime: 15_000,
            gcTime: 5 * 60_000,
            queryFn: async () => {
              const [results, storedBillDateMoves] = await Promise.all([
                Promise.all([
                  applyHouseholdSelect(supabase.from("bills").select("*"), uid),
                  applyHouseholdSelect(supabase.from("monthly_overrides").select("*"), uid),
                  loadAllTransactions(uid),
                  applyHouseholdSelect(
                    supabase.from("plaid_transactions")
                      .select("plaid_transaction_id,transaction_date,amount,name,merchant_name,category,plaid_account_id")
                      .eq("pending", true)
                      .is("removed_at", null)
                      .order("transaction_date", { ascending: false })
                      .limit(100),
                    uid,
                  ),
                  applyHouseholdSelect(
                    supabase.from("pending_plan_matches")
                      .select("*")
                      .in("status", ["active", "ready_review"]),
                    uid,
                  ),
                  applyHouseholdSelect(supabase.from("incomes").select("*"), uid),
                  applyHouseholdSelect(supabase.from("goals").select("*"), uid),
                  applyHouseholdSelect(supabase.from("extra_payments").select("*"), uid),
                  loadScopedSettings(uid, scope),
                  applyHouseholdSelect(supabase.from("accounts").select("*"), uid).order("created_at"),
                  applyHouseholdSelect(
                    supabase.from("plaid_accounts")
                      .select("id,plaid_account_id,name,display_name,official_name,mask,persistent_account_id,account_type,account_subtype,current_balance,available_balance,minimum_payment_amount,next_payment_due_date,last_statement_balance,last_statement_issue_date,is_overdue,purchase_apr,liability_last_synced_at,is_active,updated_at")
                      .order("name"),
                    uid,
                  ),
                  applyHouseholdSelect(supabase.from("decisions").select("*"), uid).order("created_at", { ascending: false }),
                ]),
                loadBillDateMoves(uid, scope),
              ]);
              return { results, storedBillDateMoves };
            },
          }),
          12000,
          "Load budget data",
        );
        const { results, storedBillDateMoves } = coreLoad;
        const failed = results.find(result => result.error);
        if (failed?.error) throw new Error(`Load budget data: ${failed.error.message}`);
        const [
          { data: bData },
          { data: oData },
          { data: tData },
          { data: pendingData },
          { data: pendingPlanData },
          { data: iData },
          { data: gData },
          { data: epData },
          { data: sData },
          { data: aData },
          { data: connectedAccountData },
          { data: dData },
        ] = results;

        if (requestId !== loadRequestRef.current) return;

        const queryUpdatedAt = queryClient.getQueryState(coreQueryKey)?.dataUpdatedAt;
        const freshnessAttempt = {
          beforeRevision: dashboardDataRevisionRef.current,
          requestId,
          updatedAt: new Date(queryUpdatedAt || Date.now()).toISOString(),
        };
        pendingAuthoritativeFreshnessRef.current = freshnessAttempt;
        if (authoritativeFreshnessTimerRef.current) {
          clearTimeout(authoritativeFreshnessTimerRef.current);
        }
        authoritativeFreshnessTimerRef.current = setTimeout(() => {
          if (pendingAuthoritativeFreshnessRef.current === freshnessAttempt) {
            // Identical cache -> live content keeps the cached freshness stamp
            // and causes no post-cover provider render.
            pendingAuthoritativeFreshnessRef.current = null;
          }
          authoritativeFreshnessTimerRef.current = null;
        }, 250);

        setBills(reorderDebtPriorities((bData ?? []).map(normalizeBillRow)));
        setOverrides((oData ?? []).map(normalizeMonthlyOverrideRow));
        setBillDateMoves(storedBillDateMoves);
        billDateMovesRef.current = storedBillDateMoves;
        const loadedTimeZone = String(sData?.time_zone || "UTC");
        const rawConnectedAccounts = normalizeConnectedBankRows(connectedAccountData ?? []);
        const transactionCollections = accountAwareTransactionCollections(tData ?? [], rawConnectedAccounts);
        setTransactions(transactionCollections.active);
        setDeletedTransactions(transactionCollections.deleted);
        setTransactionAccountIdentities(rawConnectedAccounts);
        transactionAccountIdentitiesRef.current = rawConnectedAccounts;
        const canonicalBankAccounts = canonicalConnectedAccounts(rawConnectedAccounts);
        setConnectedBankAccounts(canonicalBankAccounts);
        const pendingRows = checkingPendingBankRows(normalizePendingBankRows(pendingData ?? []), rawConnectedAccounts);
        setPendingBankTransactions(pendingPlaidActivityWithBalanceHolds(
          pendingRows.included,
          rawConnectedAccounts,
          localDateInTimeZone(new Date(), loadedTimeZone),
        ));
        if (transactionCollections.unknownPlaid.length > 0 || pendingRows.unknownCount > 0) {
          void recordDiagnostic(userId, {
            eventType: "unhandled_error", operation: "app_error", platform: diagnosticPlatform(),
            errorCode: "unknown_plaid_account",
          }).catch(() => undefined);
        }
        setPendingPlanMatches((pendingPlanData ?? []).map(normalizePendingPlanMatchRow));
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
        })).filter(isValidExtraPaymentPlan));
        const loadedAccounts = (aData ?? []).filter((a: any) => a.account_type !== "credit_card").map((a: any) => ({
          ...a,
          current_balance: Number(a.current_balance),
          last_reconciled_at: a.last_reconciled_at ?? undefined,
          is_active: a.is_active !== false,
        }));
        accountsRef.current = loadedAccounts;
        authoritativeAccountsByIdRef.current = new Map(
          loadedAccounts.map((account: Account) => [account.id, account]),
        );
        setAccounts(loadedAccounts);
        setDecisions((dData ?? []).map((d: any) => ({ ...d, calendar_date: d.calendar_date ?? undefined, applied_change: d.applied_change ?? undefined })));
        if (sData) {
          setHouseholdTimeZone(loadedTimeZone);
          const nextStartingBalance = Number(sData.starting_balance);
          const nextStartingBalanceDate = sData.starting_balance_date ?? undefined;
          const nextSettings: Settings = {
            ...normalizePlanningTools(sData),
            paymentMethod:        canonicalDebtPaymentMethod(sData.payment_method),
            starting_balance:     nextStartingBalance,
            starting_balance_date: nextStartingBalanceDate,
            calendar_start_date: sData.calendar_start_date ?? (nextStartingBalanceDate ? `${nextStartingBalanceDate.slice(0, 7)}-01` : undefined),
            safety_floor:         Number(sData.safety_floor ?? 200),
            forecast_horizon_months: Math.min(24, Math.max(1, Number(sData.forecast_horizon_months ?? 6))),
            onboarding_completed: Boolean(sData.onboarding_completed),
          };
          settingsRef.current = nextSettings;
          if (scope?.householdId) {
            authoritativeSettingsByScopeRef.current.set(`${uid}:${scope.householdId}`, nextSettings);
          }
          setSettings(nextSettings);
        }
        updateStartupCoreReadyScopeKey(
          scope?.householdId ? `${uid}:${scope.householdId}` : null,
        );
        setLoadError(null);
        loadSucceeded = true;
        if (blockingUserTransition) userTransitionPendingRef.current = false;
        if (resolvedScopeId) {
          if (scopeTransitionPendingRef.current === resolvedScopeId) {
            scopeTransitionPendingRef.current = null;
          }
          settleScopeCoreLoad(resolvedScopeId);
        }

        // Household members/activity and custom category labels do not affect
        // the financial core. Start them after the loading barrier can release
        // so their requests and JSON work cannot delay the first real screen.
        if (postCoreSecondaryTimerRef.current) clearTimeout(postCoreSecondaryTimerRef.current);
        postCoreSecondaryTimerRef.current = setTimeout(() => {
          postCoreSecondaryTimerRef.current = null;
          if (
            requestId !== loadRequestRef.current
            || scope?.householdId !== householdScopeRef.current?.householdId
          ) return;
          void refreshHouseholdDetails(scope).catch(error => {
            console.warn("Household details refresh skipped", error);
          });
          void Promise.resolve(
            applyHouseholdSelect(supabase.from("categories").select("name"), uid),
          ).then(categoryResult => {
            if (
              requestId !== loadRequestRef.current
              || scope?.householdId !== householdScopeRef.current?.householdId
            ) return;
            if (categoryResult.error) {
              console.warn("Custom categories skipped", categoryResult.error.message);
              return;
            }
            const cats = (categoryResult.data ?? []).map((category: any) => category.name as string);
            setCategories(cats.length > 0 ? fallbackCategoryList(cats) : DEFAULT_CATEGORIES);
            setCategoriesReadyScopeKey(scope?.householdId ? `${uid}:${scope.householdId}` : null);
          }).catch(error => {
            if (
              requestId === loadRequestRef.current
              && scope?.householdId === householdScopeRef.current?.householdId
            ) console.warn("Custom categories skipped", error);
          });
        }, 300);

        // Scheduled debt maintenance is important but is not required to render
        // the saved plan. Give the first screen time to paint, then refetch the
        // large ledger only when the RPC reports a real persisted change.
        if (scope?.role !== "viewer") {
          if (postCoreDebtTimerRef.current) clearTimeout(postCoreDebtTimerRef.current);
          postCoreDebtTimerRef.current = setTimeout(() => {
            postCoreDebtTimerRef.current = null;
            if (
              requestId !== loadRequestRef.current
              || scope?.householdId !== householdScopeRef.current?.householdId
            ) return;
            void (async () => {
              const synced = await supabase.rpc("sync_due_debt_transactions", {
                p_as_of_date: localDateInTimeZone(new Date(), loadedTimeZone),
                p_household_id: scope?.householdId ?? null,
              });
              const requestIsCurrent = () => (
                requestId === loadRequestRef.current
                && scope?.householdId === householdScopeRef.current?.householdId
              );
              if (!requestIsCurrent()) return;

              const refreshPlan = debtSyncRefreshPlan(synced.error ? undefined : synced.data);
              const refreshAllDebtRows = async () => {
                const [billRows, transactionRows] = await Promise.all([
                  applyHouseholdSelect(supabase.from("bills").select("*"), uid),
                  loadAllTransactions(uid),
                ]);
                if (billRows.error || transactionRows.error || !requestIsCurrent()) {
                  if (billRows.error || transactionRows.error) {
                    console.warn(
                      "Scheduled debt full refresh skipped",
                      billRows.error?.message ?? transactionRows.error?.message,
                    );
                  }
                  return;
                }
                setBills(reorderDebtPriorities((billRows.data ?? []).map(normalizeBillRow)));
                const refreshedCollections = accountAwareTransactionCollections(
                  transactionRows.data ?? [],
                  transactionAccountIdentitiesRef.current,
                );
                setTransactions(refreshedCollections.active);
                setDeletedTransactions(refreshedCollections.deleted);
              };

              if (synced.error) {
                console.warn("Scheduled debt sync result unavailable", synced.error.message);
                await refreshAllDebtRows();
                return;
              }
              if (refreshPlan.mode === "none") return;
              if (refreshPlan.mode === "full") {
                await refreshAllDebtRows();
                return;
              }

              const emptyRows = Promise.resolve({ data: [] as any[], error: null });
              const [billRows, transactionRows] = await Promise.all([
                refreshPlan.billIds.length > 0
                  ? applyHouseholdSelect(supabase.from("bills").select("*"), uid)
                    .in("id", refreshPlan.billIds)
                  : emptyRows,
                refreshPlan.transactionIds.length > 0
                  ? applyHouseholdSelect(supabase.from("transactions").select("*"), uid)
                    .in("id", refreshPlan.transactionIds)
                  : emptyRows,
              ]);
              const exactRowsLoaded = (
                !billRows.error
                && !transactionRows.error
                && rowsExactlyMatchRequestedIds(billRows.data ?? [], refreshPlan.billIds)
                && rowsExactlyMatchRequestedIds(transactionRows.data ?? [], refreshPlan.transactionIds)
              );
              if (!requestIsCurrent()) return;
              if (!exactRowsLoaded) {
                await refreshAllDebtRows();
                return;
              }

              const refreshedBills = (billRows.data ?? []).map(normalizeBillRow);
              setBills(current => reorderDebtPriorities(
                replaceRowsById(current, refreshPlan.billIds, refreshedBills),
              ));
              const refreshedCollections = accountAwareTransactionCollections(
                transactionRows.data ?? [],
                transactionAccountIdentitiesRef.current,
              );
              setTransactions(current => replaceRowsById(
                current,
                refreshPlan.transactionIds,
                refreshedCollections.active,
              ).sort((left, right) => right.date.localeCompare(left.date)));
              setDeletedTransactions(current => replaceRowsById(
                current,
                refreshPlan.transactionIds,
                refreshedCollections.deleted,
              ).sort((left, right) => String(right.deleted_at ?? "").localeCompare(String(left.deleted_at ?? ""))));
            })().catch(error => console.warn("Scheduled debt sync skipped", error));
          }, 900);
        }
      } catch (error) {
        console.warn("Budget load failed or timed out", error);
        const loadFailure = error instanceof Error
          ? error
          : new Error("FlowLedger could not load your plan.");
        if (requestId === loadRequestRef.current) {
          if (resolvedScopeId) settleScopeCoreLoad(resolvedScopeId, loadFailure);
          if (shouldShowBudgetLoadError({
            backgroundRefresh,
            blockingScopeTransition,
            blockingUserTransition,
            usableCoreReady: Boolean(
              userId
              && householdScopeRef.current?.householdId
              && startupCoreReadyScopeKeyRef.current
                === `${userId}:${householdScopeRef.current.householdId}`
            ),
          })) {
            setLoadError(loadFailure.message);
          }
        }
      } finally {
        if (backgroundRefresh) backgroundRefreshPendingRef.current = false;
        if (requestId === loadRequestRef.current) {
          if (loadSucceeded) {
            loaded.current = true;
            lastPlanRefreshAtRef.current = Date.now();
          }
          if (shouldReleaseBudgetLoading({
            backgroundRefresh,
            blockingScopeTransition,
            blockingUserTransition,
            loadSucceeded,
          })) {
            // A changed household cannot reveal its label over the previous
            // plan. Keep the loading/privacy barrier on a failed transition;
            // retryBudgetLoad will settle it only after the new core commits.
            setLoading(false);
          }
        }
        void recordDiagnostic(userId, {
          eventType: "performance", operation: "data_load", platform: diagnosticPlatform(),
          durationMs: Date.now() - loadStarted,
        }).catch(() => undefined);
      }
    })();
  }, [userId, demoMode, loadRetryNonce, resolveHouseholds, hydrateBudgetPlanCache, applyHouseholdSelect, loadAllTransactions, refreshDailyCheckingCloses, refreshHouseholdDetails, loadScopedSettings, queryClient, replaceActiveHouseholdScope, settleScopeCoreLoad, updateStartupCoreReadyScopeKey]);

  const loadBankData = useCallback(async () => {
    if (!user || demoMode) return;
    const requestId = ++bankRefreshRequestRef.current;
    const uid = user.id;
    if (uid !== userScopeIdRef.current) return;
    const scope = householdScopeRef.current;
    refreshDailyCheckingCloses(scope, () => (
      requestId === bankRefreshRequestRef.current
      && scope?.householdId === householdScopeRef.current?.householdId
    ));
    const [billResult, transactionResult, pendingResult, pendingPlanResult, accountResult, connectedAccountResult, settingsResult] = await Promise.all([
      applyHouseholdSelect(supabase.from("bills").select("*"), uid),
      loadAllTransactions(uid),
      applyHouseholdSelect(
        supabase.from("plaid_transactions")
          .select("plaid_transaction_id,transaction_date,amount,name,merchant_name,category,plaid_account_id")
          .eq("pending", true)
          .is("removed_at", null)
          .order("transaction_date", { ascending: false })
          .limit(100),
        uid,
      ),
      applyHouseholdSelect(
        supabase.from("pending_plan_matches")
          .select("*")
          .in("status", ["active", "ready_review"]),
        uid,
      ),
      applyHouseholdSelect(supabase.from("accounts").select("*"), uid).order("created_at"),
      applyHouseholdSelect(
        supabase.from("plaid_accounts")
          .select("id,plaid_account_id,name,display_name,official_name,mask,persistent_account_id,account_type,account_subtype,current_balance,available_balance,minimum_payment_amount,next_payment_due_date,last_statement_balance,last_statement_issue_date,is_overdue,purchase_apr,liability_last_synced_at,is_active,updated_at")
          .order("name"),
        uid,
      ),
      loadScopedSettings(uid, scope),
    ]);
    if (
      requestId !== bankRefreshRequestRef.current
      || uid !== userScopeIdRef.current
      || scope?.householdId !== householdScopeRef.current?.householdId
    ) return;
    if (!billResult.error) {
      setBills(reorderDebtPriorities((billResult.data ?? []).map(normalizeBillRow)));
    }
    if (!pendingPlanResult.error) {
      setPendingPlanMatches((pendingPlanResult.data ?? []).map(normalizePendingPlanMatchRow));
    }
    if (!accountResult.error) {
      const nextAccounts = (accountResult.data ?? []).filter((a: any) => a.account_type !== "credit_card").map((a: any) => ({
        ...a,
        current_balance: Number(a.current_balance),
        last_reconciled_at: a.last_reconciled_at ?? undefined,
        is_active: a.is_active !== false,
      }));
      accountsRef.current = nextAccounts;
      authoritativeAccountsByIdRef.current = new Map(
        nextAccounts.map((account: Account) => [account.id, account]),
      );
      setAccounts(nextAccounts);
    }
    const rawConnectedAccounts = !connectedAccountResult.error
      ? normalizeConnectedBankRows(connectedAccountResult.data ?? [])
      : transactionAccountIdentitiesRef.current;
    if (!transactionResult.error) {
      const transactionCollections = accountAwareTransactionCollections(transactionResult.data ?? [], rawConnectedAccounts);
      setTransactions(transactionCollections.active);
      setDeletedTransactions(transactionCollections.deleted);
      if (transactionCollections.unknownPlaid.length > 0) {
        void recordDiagnostic(user.id, {
          eventType: "unhandled_error", operation: "app_error", platform: diagnosticPlatform(),
          errorCode: "unknown_plaid_account",
        }).catch(() => undefined);
      }
    }
    if (!connectedAccountResult.error) {
      setTransactionAccountIdentities(rawConnectedAccounts);
      transactionAccountIdentitiesRef.current = rawConnectedAccounts;
      const canonicalBankAccounts = canonicalConnectedAccounts(rawConnectedAccounts);
      setConnectedBankAccounts(canonicalBankAccounts);
      if (!pendingResult.error) {
        const pendingRows = checkingPendingBankRows(normalizePendingBankRows(pendingResult.data ?? []), rawConnectedAccounts);
        const refreshTimeZone = !settingsResult.error && settingsResult.data
          ? String(settingsResult.data.time_zone || "UTC")
          : householdTimeZone;
        setPendingBankTransactions(pendingPlaidActivityWithBalanceHolds(
          pendingRows.included,
          rawConnectedAccounts,
          localDateInTimeZone(new Date(), refreshTimeZone),
        ));
        if (pendingRows.unknownCount > 0) {
          void recordDiagnostic(user.id, {
            eventType: "unhandled_error", operation: "app_error", platform: diagnosticPlatform(),
            errorCode: "unknown_plaid_account",
          }).catch(() => undefined);
        }
      }
    }
    if (!settingsResult.error && settingsResult.data) {
      const sData = settingsResult.data;
      setHouseholdTimeZone(String(sData.time_zone || "UTC"));
      const nextStartingBalance = Number(sData.starting_balance);
      const nextStartingBalanceDate = sData.starting_balance_date ?? undefined;
      const serverSettings: Settings = {
        ...normalizePlanningTools(sData),
        paymentMethod:        canonicalDebtPaymentMethod(sData.payment_method),
        starting_balance:     nextStartingBalance,
        starting_balance_date: nextStartingBalanceDate,
        calendar_start_date: sData.calendar_start_date ?? (nextStartingBalanceDate ? `${nextStartingBalanceDate.slice(0, 7)}-01` : undefined),
        safety_floor:         Number(sData.safety_floor ?? 200),
        forecast_horizon_months: Math.min(24, Math.max(1, Number(sData.forecast_horizon_months ?? 6))),
        onboarding_completed: Boolean(sData.onboarding_completed),
      };
      const scopeKey = scope?.householdId ? `${uid}:${scope.householdId}` : null;
      if (scopeKey) authoritativeSettingsByScopeRef.current.set(scopeKey, serverSettings);
      const currentTokens = scopeKey ? settingsFieldTokensRef.current.get(scopeKey) : undefined;
      const mergedSettings = { ...settingsRef.current };
      normalizedSettingsFields(Object.keys(serverSettings)).forEach(field => {
        if (!currentTokens?.has(field)) {
          (mergedSettings as unknown as Record<string, unknown>)[field] = serverSettings[field];
        }
      });
      settingsRef.current = mergedSettings;
      setSettings(mergedSettings);
    }
    const bankDataResults = [billResult, transactionResult, pendingResult, pendingPlanResult, accountResult, connectedAccountResult, settingsResult];
    if (bankDataResults.every(result => !result.error)) setDataUpdatedAt(new Date().toISOString());
  }, [user, demoMode, applyHouseholdSelect, householdTimeZone, loadAllTransactions, loadScopedSettings]);

  const refreshBankData = useCallback(async () => {
    if (!user || demoMode || Platform.OS !== "web" || !loaded.current) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    if (plaidSyncPromiseRef.current) return plaidSyncPromiseRef.current;

    const now = Date.now();
    const fiveMinutes = 5 * 60 * 1000;
    if (now - lastPlaidSyncAtRef.current < fiveMinutes) {
      await loadBankData();
      return;
    }
    lastPlaidSyncAtRef.current = now;
    const requestUserId = user.id;

    const request = (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const accessToken = data.session?.access_token;
        if (
          !accessToken
          || data.session?.user.id !== requestUserId
          || requestUserId !== userScopeIdRef.current
        ) return;
        const scope = householdScopeRef.current ?? await resolveHouseholds(requestUserId);
        if (requestUserId !== userScopeIdRef.current) return;
        const householdId = scope?.householdId;
        const response = await apiFetch("/api/plaid/sync", {
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
        if (requestUserId === userScopeIdRef.current) await loadBankData();
      }
    })();
    plaidSyncPromiseRef.current = request;
    try {
      await request;
    } finally {
      plaidSyncPromiseRef.current = null;
    }
  }, [user, demoMode, loadBankData, resolveHouseholds]);

  const refreshPlanAfterReconnect = useCallback(() => {
    if (!userId || demoMode || loadError || !loaded.current || backgroundRefreshPendingRef.current) return;
    backgroundRefreshPendingRef.current = true;
    void queryClient.invalidateQueries({ queryKey: ["budget-core", userId] });
    setLoadRetryNonce(value => value + 1);
  }, [demoMode, loadError, queryClient, userId]);

  useEffect(() => {
    if (!userId || demoMode || loading || !loaded.current) return;
    if (Platform.OS !== "web" || typeof document === "undefined" || typeof window === "undefined") {
      let resumeTimer: ReturnType<typeof setTimeout> | null = null;
      let wasOffline = knownNetworkStatus() === false;
      const unsubscribeNetwork = subscribeNetworkStatus(status => {
        if (status === false) {
          wasOffline = true;
          return;
        }
        if (status === true && wasOffline) {
          wasOffline = false;
          if (resumeTimer) clearTimeout(resumeTimer);
          resumeTimer = setTimeout(refreshPlanAfterReconnect, 250);
        }
      });
      const subscription = AppState.addEventListener("change", state => {
        if (resumeTimer) clearTimeout(resumeTimer);
        resumeTimer = null;
        if (state === "active") {
          // Let the cached screen become interactive before starting a stale
          // plan refresh. The refresh never replaces the visible page with a
          // loading state.
          resumeTimer = setTimeout(refreshPlanInBackground, 750);
        }
      });
      return () => {
        if (resumeTimer) clearTimeout(resumeTimer);
        unsubscribeNetwork();
        subscription.remove();
      };
    }

    let resumeTimer: ReturnType<typeof setTimeout> | null = null;
    const runResumeRefresh = () => {
      if (document.visibilityState === "hidden") return;
      refreshPlanInBackground();
    };
    const scheduleResumeRefresh = () => {
      if (document.visibilityState === "hidden") return;
      if (resumeTimer) clearTimeout(resumeTimer);
      resumeTimer = setTimeout(runResumeRefresh, 750);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") scheduleResumeRefresh();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pageshow", scheduleResumeRefresh);
    window.addEventListener("online", scheduleResumeRefresh);
    return () => {
      if (resumeTimer) clearTimeout(resumeTimer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pageshow", scheduleResumeRefresh);
      window.removeEventListener("online", scheduleResumeRefresh);
    };
  }, [userId, demoMode, loading, refreshPlanAfterReconnect, refreshPlanInBackground]);

  const createMonthlyOverrideWriteIntent = useCallback((
    billId: string,
    month: number,
    year: number,
    patch: MonthlyOverridePatch,
    preferredId?: string,
  ): MonthlyOverrideWriteIntent => {
    if (!user) throw new Error("Sign in to update a monthly bill");
    const key = `${billId}:${year}-${month}`;
    const token = genId();
    let fieldTokens = monthlyOverrideFieldTokensRef.current.get(key);
    if (!fieldTokens) {
      fieldTokens = new Map<string, string>();
      monthlyOverrideFieldTokensRef.current.set(key, fieldTokens);
    }
    Object.keys(patch).forEach(field => fieldTokens?.set(field, token));

    const existing = overridesRef.current.find(override =>
      override.bill_id === billId && override.month === month && override.year === year
    );
    let stableId = existing?.id ?? monthlyOverrideStableIdsRef.current.get(key) ?? preferredId;
    if (!stableId) stableId = genId();
    monthlyOverrideStableIdsRef.current.set(key, stableId);
    const scope = householdScopeRef.current;
    return {
      key,
      token,
      stableId,
      billId,
      month,
      year,
      patch,
      userId: user.id,
      householdId: scope?.householdId,
      budgetId: scope?.budgetId,
    };
  }, [user]);

  const persistMonthlyOverrideWriteIntent = useCallback((intent: MonthlyOverrideWriteIntent): Promise<void> =>
    enqueueMutationByKey(monthlyOverrideWriteQueuesRef.current, intent.key, async () => {
      const fieldTokens = monthlyOverrideFieldTokensRef.current.get(intent.key) ?? new Map<string, string>();
      const effectivePatch = activeVersionedPatch(intent.patch, intent.token, fieldTokens) as MonthlyOverridePatch;
      const fields = Object.keys(effectivePatch);
      if (fields.length === 0) return;

      const findOccurrence = () => overridesRef.current.find(override =>
        override.bill_id === intent.billId
          && override.month === intent.month
          && override.year === intent.year
      );
      const existing = findOccurrence();
      const updated: MonthlyOverride = existing
        ? { ...existing, ...effectivePatch }
        : {
            id: intent.stableId,
            bill_id: intent.billId,
            month: intent.month,
            year: intent.year,
            paid_amount: 0,
            ...effectivePatch,
          };
      let appliedFieldTokens = monthlyOverrideAppliedFieldTokensRef.current.get(intent.key);
      if (!appliedFieldTokens) {
        appliedFieldTokens = new Map<string, string>();
        monthlyOverrideAppliedFieldTokensRef.current.set(intent.key, appliedFieldTokens);
      }
      const previousAppliedTokens = new Map(appliedFieldTokens);
      fields.forEach(field => appliedFieldTokens?.set(field, intent.token));
      monthlyOverrideStableIdsRef.current.set(intent.key, updated.id);
      const optimistic = existing
        ? overridesRef.current.map(override => override.id === existing.id ? updated : override)
        : [...overridesRef.current, updated];
      overridesRef.current = optimistic;
      setOverrides(optimistic);
      if (demoMode) return;

      try {
        const dbPatch = monthlyOverridePatchDbPayload(effectivePatch);
        let savedResult = existing
          ? await supabase.from("monthly_overrides")
              .update(dbPatch)
              .eq("id", existing.id)
              .select("*")
              .single()
          : await supabase.from("monthly_overrides")
              .upsert({
                id: intent.stableId,
                user_id: intent.userId,
                bill_id: intent.billId,
                month: intent.month,
                year: intent.year,
                ...dbPatch,
                ...(intent.householdId
                  ? { household_id: intent.householdId, budget_id: intent.budgetId ?? null }
                  : {}),
              }, { onConflict: "id" })
              .select("*")
              .single();

        if (!existing && savedResult.error?.code === "23505") {
          let occurrenceQuery = supabase.from("monthly_overrides")
            .select("*")
            .eq("bill_id", intent.billId)
            .eq("month", intent.month)
            .eq("year", intent.year);
          occurrenceQuery = intent.householdId
            ? occurrenceQuery.eq("household_id", intent.householdId)
            : occurrenceQuery.eq("user_id", intent.userId);
          const authoritative = await occurrenceQuery.order("id").limit(1).maybeSingle();
          if (authoritative.error) throw new Error(`Find monthly bill after concurrent create: ${authoritative.error.message}`);
          if (!authoritative.data) throw new Error("The monthly bill changed while it was saving. Refresh and try again.");
          savedResult = await supabase.from("monthly_overrides")
            .update(dbPatch)
            .eq("id", authoritative.data.id)
            .select("*")
            .single();
        }
        if (savedResult.error || !savedResult.data) {
          throw new Error(`${existing ? "Update" : "Create"} monthly bill: ${savedResult.error?.message ?? "no row was saved"}`);
        }

        const saved = normalizeMonthlyOverrideRow(savedResult.data);
        const current = findOccurrence();
        const merged: MonthlyOverride = current
          ? { ...current, id: saved.id, bill_id: saved.bill_id, month: saved.month, year: saved.year }
          : saved;
        if (current) {
          for (const field of [
            "custom_amount",
            "planned_debt_amount",
            "required_debt_amount",
            "custom_due_day",
            "paid_amount",
            "actual_amount",
            "paid_date",
          ] as const) {
            const stillOwnedByIntent = fields.includes(field) && appliedFieldTokens.get(field) === intent.token;
            const unchangedSinceOptimistic = Object.is(current[field], updated[field]);
            if (stillOwnedByIntent || unchangedSinceOptimistic) merged[field] = saved[field] as never;
          }
        }
        monthlyOverrideStableIdsRef.current.set(intent.key, saved.id);
        const authoritativeOverrides = current
          ? overridesRef.current.map(override =>
              override.bill_id === intent.billId && override.month === intent.month && override.year === intent.year
                ? merged
                : override
            )
          : [...overridesRef.current, merged];
        overridesRef.current = authoritativeOverrides;
        setOverrides(authoritativeOverrides);
      } catch (error) {
        const current = findOccurrence();
        if (current?.id === updated.id) {
          const rolledBack = rollbackVersionedPatch(
            current,
            existing,
            updated,
            fields,
            intent.token,
            appliedFieldTokens,
          ) as MonthlyOverride;
          const changed = fields.some(field =>
            !Object.is(current[field as keyof MonthlyOverride], rolledBack[field as keyof MonthlyOverride])
          );
          if (changed) {
            const isBlankNewOverride = !existing
              && (rolledBack.paid_amount ?? 0) <= 0.005
              && rolledBack.custom_amount === undefined
              && rolledBack.planned_debt_amount === undefined
              && rolledBack.required_debt_amount === undefined
              && rolledBack.custom_due_day === undefined
              && rolledBack.actual_amount === undefined
              && rolledBack.paid_date === undefined;
            const next = isBlankNewOverride
              ? overridesRef.current.filter(override => override.id !== updated.id)
              : overridesRef.current.map(override => override.id === updated.id ? rolledBack : override);
            overridesRef.current = next;
            setOverrides(next);
          }
          fields.forEach(field => {
            if (appliedFieldTokens?.get(field) !== intent.token) return;
            const previousToken = previousAppliedTokens.get(field);
            if (previousToken) appliedFieldTokens?.set(field, previousToken);
            else appliedFieldTokens?.delete(field);
          });
        }
        throw error;
      }
    }), [demoMode]);

  // ─── Bills ────────────────────────────────────────────────────────────────────

  const addBill = useCallback(async (bill: Omit<Bill, "id" | "created_at">) => {
    if (!user) throw new Error("Sign in to add a bill");
    assertCanEditHousehold("add a bill");
    const nb: Bill = { ...bill, id: genId(), created_at: new Date().toISOString() };
    if (demoMode) {
      setBills(prev => reorderDebtPriorities([...prev, nb]));
      return nb.id;
    }
    const persist: () => Promise<string> = () => runTrackedFinancialMutation(async () => {
      // The client id is deliberately stable across retries. Upsert makes a
      // lost successful response safe to retry without creating a second bill.
      await ensureSaved(
        supabase.from("bills").upsert(scopedPayload({ ...nb, user_id: user.id }), { onConflict: "id" }),
        "Add bill",
      );
      setBills(prev => reorderDebtPriorities([...prev.filter(item => item.id !== nb.id), nb]));
      const hasRollover = nb.is_debt && nb.include_in_snowball !== false && (
        nb.balance <= 0.009 ||
        bills.some(existing =>
          existing.is_debt && existing.include_in_snowball !== false &&
          (existing.balance <= 0.009 || Number(existing.snowball_minimum_boost ?? 0) > 0.009)
        )
      );
      if (hasRollover) await recalculateAndRefreshDebtMinimums();
      return nb.id;
    }, persist);
    return persist();
  }, [user, bills, demoMode, scopedPayload, assertCanEditHousehold, recalculateAndRefreshDebtMinimums, runTrackedFinancialMutation]);

  const updateBill = useCallback(async (
    bill: Bill,
    requestedEditableFields: readonly BillEditableField[],
    baseline?: BillEditableBaseline,
  ) => {
    if (!user) return;
    assertCanEditHousehold("update a bill");
    const existing = bills.find(b => b.id === bill.id);
    if (!existing) return;
    const editableFields = normalizedBillEditableFields(requestedEditableFields);
    if (editableFields.length === 0) return;
    const submittedPatch = billEditablePatch(bill, editableFields) as Partial<Bill>;
    const reviewedBill: Bill = { ...existing, ...submittedPatch, last_reviewed_at: new Date().toISOString() };
    const editToken = genId();
    let billFieldTokens = billEditFieldTokensRef.current.get(bill.id);
    if (!billFieldTokens) {
      billFieldTokens = new Map<BillEditableField, string>();
      billEditFieldTokensRef.current.set(bill.id, billFieldTokens);
    }
    editableFields.forEach(field => billFieldTokens?.set(field, editToken));
    const now = new Date();
    const curMonth = now.getMonth();
    const curYear  = now.getFullYear();
    let retryOverrideIds = billOverrideRetryIdsRef.current.get(bill.id);
    if (!retryOverrideIds) {
      retryOverrideIds = new Map<string, string>();
      billOverrideRetryIdsRef.current.set(bill.id, retryOverrideIds);
    }
    const overrideIntents: MonthlyOverrideWriteIntent[] = [];
    if (existing.amount !== reviewedBill.amount || existing.due_day !== reviewedBill.due_day) {
      const currentOverrides = overridesRef.current.filter(o => o.bill_id === bill.id);
      const overridesByMonth = new Map(currentOverrides.map(o => [`${o.year}-${o.month}`, o]));
      const monthsToPreserve = pastActiveMonthsForBill(existing, curMonth, curYear);

      currentOverrides.forEach(o => {
        const isStrictlyPast = o.year < curYear || (o.year === curYear && o.month < curMonth);
        if (isStrictlyPast) {
          const patch: MonthlyOverridePatch = {};
          if (existing.amount !== reviewedBill.amount && o.custom_amount === undefined) patch.custom_amount = existing.amount;
          if (existing.due_day !== reviewedBill.due_day && o.custom_due_day === undefined) patch.custom_due_day = existing.due_day;
          if (Object.keys(patch).length > 0) {
            overrideIntents.push(createMonthlyOverrideWriteIntent(bill.id, o.month, o.year, patch, o.id));
          }
        } else if (
          ((existing.amount !== reviewedBill.amount && o.custom_amount !== undefined) ||
           (existing.due_day !== reviewedBill.due_day && o.custom_due_day !== undefined))
        ) {
          const resetPatch: MonthlyOverridePatch = {
            ...(existing.amount !== reviewedBill.amount ? { custom_amount: undefined } : {}),
            ...(existing.due_day !== reviewedBill.due_day ? { custom_due_day: undefined } : {}),
          };
          overrideIntents.push(createMonthlyOverrideWriteIntent(bill.id, o.month, o.year, resetPatch, o.id));
        }
      });

      monthsToPreserve.forEach(({ year, month }) => {
        const key = `${year}-${month}`;
        if (overridesByMonth.has(key)) return;
        let stableId = retryOverrideIds?.get(key);
        if (!stableId) {
          stableId = genId();
          retryOverrideIds?.set(key, stableId);
        }
        const patch: MonthlyOverridePatch = {
          ...(existing.amount !== reviewedBill.amount ? { custom_amount: existing.amount } : {}),
          ...(existing.due_day !== reviewedBill.due_day ? { custom_due_day: existing.due_day } : {}),
        };
        overrideIntents.push(createMonthlyOverrideWriteIntent(bill.id, month, year, patch, stableId));
      });
    }

    setBills(prev => reorderDebtPriorities(prev.map(item => item.id === bill.id
      ? { ...item, ...submittedPatch, last_reviewed_at: reviewedBill.last_reviewed_at }
      : item)));
    if (demoMode) {
      await Promise.all(overrideIntents.map(persistMonthlyOverrideWriteIntent));
      return;
    }

    const persist: () => Promise<void> = () => runTrackedFinancialMutation(
      () => enqueueMutationByKey(billWriteQueuesRef.current, bill.id, () =>
        enqueueMutationByKeys(
          monthlyOverrideWriteQueuesRef.current,
          overrideIntents.map(intent => intent.key),
          async () => {
        const currentBillFieldTokens = billEditFieldTokensRef.current.get(bill.id)
          ?? new Map<BillEditableField, string>();
        const activeEditableFields = editableFields.filter(field =>
          currentBillFieldTokens.get(field) === editToken
        );
        if (activeEditableFields.length === 0) return;
        try {
          const expectedBillPatch = billEditableDbPatch(
            { ...existing, ...(baseline ?? {}) },
            activeEditableFields,
          );
          const persistedBillPatch = billEditableDbPatch(reviewedBill, activeEditableFields);
          const activeOverrideIntents = overrideIntents.map(intent => {
            const fieldTokens = monthlyOverrideFieldTokensRef.current.get(intent.key) ?? new Map<string, string>();
            const patch = activeVersionedPatch(intent.patch, intent.token, fieldTokens) as MonthlyOverridePatch;
            return {
              intent,
              patch,
              snapshot: overridesRef.current.find(override =>
                override.bill_id === intent.billId
                  && override.month === intent.month
                  && override.year === intent.year
              ),
            };
          }).filter(entry => Object.keys(entry.patch).length > 0);
          const savedResult = await supabase.rpc("update_bill_with_override_intents", {
            p_bill_id: bill.id,
            p_expected: expectedBillPatch,
            p_patch: persistedBillPatch,
            p_overrides: activeOverrideIntents.map(({ intent, patch, snapshot }) => ({
              id: intent.stableId,
              month: intent.month,
              year: intent.year,
              patch: monthlyOverridePatchDbPayload(patch),
              expected: monthlyOverridePatchDbPayload(Object.fromEntries(
                Object.keys(patch).map(field => [
                  field,
                  snapshot?.[field as keyof MonthlyOverride],
                ]),
              )),
            })),
          });
          if (savedResult.error || !savedResult.data) {
            throw new Error(`Update bill: ${savedResult.error?.message ?? "no row was saved"}`);
          }
          const response = savedResult.data as {
            bill?: unknown;
            overrides?: unknown[];
            debt_minimums?: Array<{ id?: unknown; snowball_minimum_boost?: unknown }>;
          };
          if (!response.bill) throw new Error("Update bill: the saved bill was not returned");
          const savedBill = normalizeBillRow(response.bill);
          const savedOverrides = (Array.isArray(response.overrides) ? response.overrides : [])
            .map(normalizeMonthlyOverrideRow);
          if (savedOverrides.length > 0) {
            let nextOverrides = overridesRef.current;
            savedOverrides.forEach(saved => {
              const entry = activeOverrideIntents.find(({ intent }) =>
                intent.billId === saved.bill_id
                  && intent.month === saved.month
                  && intent.year === saved.year
              );
              const current = nextOverrides.find(override =>
                override.bill_id === saved.bill_id
                  && override.month === saved.month
                  && override.year === saved.year
              );
              let merged = current ? { ...current, id: saved.id } : saved;
              if (current && entry) {
                const fieldTokens = monthlyOverrideFieldTokensRef.current.get(entry.intent.key) ?? new Map<string, string>();
                for (const field of [
                  "custom_amount",
                  "planned_debt_amount",
                  "required_debt_amount",
                  "custom_due_day",
                  "paid_amount",
                  "actual_amount",
                  "paid_date",
                ] as const) {
                  const ownsField = Object.prototype.hasOwnProperty.call(entry.patch, field)
                    && fieldTokens.get(field) === entry.intent.token;
                  const unchangedDuringRequest = Object.is(current[field], entry.snapshot?.[field]);
                  if (ownsField || unchangedDuringRequest) {
                    (merged as unknown as Record<string, unknown>)[field] = saved[field];
                  }
                }
              }
              monthlyOverrideStableIdsRef.current.set(
                `${saved.bill_id}:${saved.year}-${saved.month}`,
                saved.id,
              );
              nextOverrides = current
                ? nextOverrides.map(override =>
                    override.bill_id === saved.bill_id
                      && override.month === saved.month
                      && override.year === saved.year
                      ? merged
                      : override
                  )
                : [...nextOverrides, merged];
            });
            overridesRef.current = nextOverrides;
            setOverrides(nextOverrides);
          }
          const minimumBoosts = new Map(
            (Array.isArray(response.debt_minimums) ? response.debt_minimums : [])
              .filter(row => typeof row.id === "string")
              .map(row => [String(row.id), Number(row.snowball_minimum_boost ?? 0)]),
          );
          const stillOwnedFields = activeEditableFields.filter(field =>
            currentBillFieldTokens.get(field) === editToken
          );
          const savedPatch = billEditablePatch(savedBill, stillOwnedFields) as Partial<Bill>;
          setBills(prev => reorderDebtPriorities(prev.map(item => {
            const withMinimum = minimumBoosts.has(item.id)
              ? { ...item, snowball_minimum_boost: minimumBoosts.get(item.id) }
              : item;
            return item.id === bill.id && stillOwnedFields.length > 0
              ? { ...withMinimum, ...savedPatch, last_reviewed_at: savedBill.last_reviewed_at }
              : withMinimum;
          })));
          stillOwnedFields.forEach(field => {
            if (currentBillFieldTokens.get(field) === editToken) currentBillFieldTokens.delete(field);
          });
          if (stillOwnedFields.length === activeEditableFields.length) {
            billOverrideRetryIdsRef.current.delete(bill.id);
          }
        } catch (error) {
          setBills(prev => reorderDebtPriorities(prev.map(item => {
            if (item.id !== existing.id) return item;
            const rollbackPatch: Partial<Bill> = {};
            activeEditableFields.forEach(field => {
              if (currentBillFieldTokens.get(field) === editToken
                  && Object.is(item[field], reviewedBill[field])) {
                (rollbackPatch as Record<string, unknown>)[field] = existing[field];
              }
            });
            if (Object.is(item.last_reviewed_at, reviewedBill.last_reviewed_at)) {
              rollbackPatch.last_reviewed_at = existing.last_reviewed_at;
            }
            return { ...item, ...rollbackPatch };
          })));
          throw error;
        }
          }
        ),
      ),
      persist,
    );
    await persist();
  }, [
    user,
    bills,
    demoMode,
    assertCanEditHousehold,
    createMonthlyOverrideWriteIntent,
    persistMonthlyOverrideWriteIntent,
    runTrackedFinancialMutation,
  ]);

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
    const persist: () => Promise<void> = () => runTrackedFinancialMutation(async () => {
      if (shouldEndForwardOnly && deletedBill) {
        const endedBill = { ...deletedBill, end_date: forwardEndDate };
        await ensureSaved(
          supabase.from("bills").update({ end_date: forwardEndDate, last_reviewed_at: new Date().toISOString() }).eq("id", id).select("id").single(),
          "Stop future bill"
        );
        setBills(prev => reorderDebtPriorities(prev.map(b => b.id === id ? endedBill : b)));
      } else {
        await deleteRowIdempotently("bills", id, "Delete bill");
        await ensureSaved(supabase.from("monthly_overrides").delete().eq("bill_id", id), "Delete bill overrides");
        setBills(prev => reorderDebtPriorities(prev.filter(b => b.id !== id)));
        setOverrides(prev => prev.filter(o => o.bill_id !== id));
      }
      if (deletedBill?.is_debt) await recalculateAndRefreshDebtMinimums();
    }, persist);
    await persist();
  }, [user, bills, demoMode, assertCanEditHousehold, deleteRowIdempotently, recalculateAndRefreshDebtMinimums, runTrackedFinancialMutation]);

  const deleteBill = useCallback(async (id: string) => {
    if (!user) return;
    assertCanEditHousehold("delete a bill");
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

    const persist: () => Promise<void> = () => runTrackedFinancialMutation(async () => {
      const rpcDelete = await supabase.rpc("delete_bill_completely", { p_bill_id: id, p_household_id: householdId });
      if (rpcDelete.error) throw new Error(`Delete bill: ${rpcDelete.error.message}`);
      if (!rpcDelete.error && rpcDelete.data !== true) {
        // A delete may have committed even when its response was interrupted.
        // Absence is therefore the authoritative idempotent success state.
        const remaining = await applyHouseholdSelect(supabase.from("bills").select("id"), user.id)
          .eq("id", id)
          .maybeSingle();
        if (remaining.error) throw new Error(`Verify bill deletion: ${remaining.error.message}`);
        if (remaining.data) throw new Error("Delete bill: this household role cannot delete it.");
      }

      removeLocalBillData();
    }, persist);
    await persist();
  }, [user, bills, demoMode, assertCanEditHousehold, applyHouseholdSelect, runTrackedFinancialMutation]);

  const deleteBillMistake = deleteBill;

  const getBillById = useCallback((id: string) => bills.find(b => b.id === id), [bills]);

  // ─── Overrides ────────────────────────────────────────────────────────────────

  const overridesByBillMonth = useMemo(() => {
    const index = new Map<string, MonthlyOverride>();
    overrides.forEach(override => {
      index.set(`${override.bill_id}:${override.year}-${override.month}`, override);
    });
    return index;
  }, [overrides]);

  const getOverride = useCallback(
    (billId: string, month: number, year: number) =>
      overridesByBillMonth.get(`${billId}:${year}-${month}`),
    [overridesByBillMonth]
  );

  const matchedAllocationIndexes = useMemo(
    () => buildMatchedFinancialAllocationIndexes(transactions),
    [transactions],
  );
  const reviewedBillSettlements =
    matchedAllocationIndexes.reviewedBillSettlements;
  const reviewedBillOccurrences =
    matchedAllocationIndexes.reviewedBillOccurrences;
  const debtSourceCommitments = useMemo(() => debtSourceCommitmentsForDebts(
    pendingPlanMatches,
    pendingBankTransactions,
    transactions,
    bills,
  ), [bills, pendingBankTransactions, pendingPlanMatches, transactions]);
  const debtSourceCommitmentsByOccurrence = useMemo(() => new Map(
    debtSourceCommitments.map(commitment => [
      `${commitment.sourceBillId}:${commitment.date}`,
      commitment,
    ]),
  ), [debtSourceCommitments]);
  const getDebtSourceCommitment = useCallback(
    (billId: string, occurrenceDate: string) =>
      debtSourceCommitmentsByOccurrence.get(`${billId}:${occurrenceDate}`),
    [debtSourceCommitmentsByOccurrence],
  );

  const getAmount = useCallback(
    (bill: Bill, month: number, year: number): number => {
      const o = overridesByBillMonth.get(`${bill.id}:${year}-${month}`);
      if (bill.is_debt && o?.planned_debt_amount !== undefined) {
        return effectiveDebtOccurrenceAmount(0, 0, o.planned_debt_amount);
      }
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
    [overridesByBillMonth, reviewedBillSettlements]
  );

  const getPaidAmount = useCallback(
    (billId: string, month: number, year: number): number =>
      overridesByBillMonth.get(`${billId}:${year}-${month}`)?.paid_amount ?? 0,
    [overridesByBillMonth]
  );

  const upsertOverride = useCallback(
    async (billId: string, month: number, year: number, patch: MonthlyOverridePatch) => {
      if (!user) return;
      assertCanEditHousehold("update a monthly bill");
      const intent = createMonthlyOverrideWriteIntent(billId, month, year, patch);
      if (demoMode) {
        await persistMonthlyOverrideWriteIntent(intent);
        return;
      }
      const saveStarted = Date.now();
      const persist: () => Promise<void> = () => runTrackedFinancialMutation(async () => {
        await persistMonthlyOverrideWriteIntent(intent);
        void recordDiagnostic(intent.userId, {
          eventType: "performance", operation: "amount_save", platform: diagnosticPlatform(),
          durationMs: Date.now() - saveStarted,
        }).catch(() => undefined);
      }, persist);
      await persist();
    },
    [
      user,
      demoMode,
      assertCanEditHousehold,
      createMonthlyOverrideWriteIntent,
      persistMonthlyOverrideWriteIntent,
      runTrackedFinancialMutation,
    ]
  );

  const setPaidAmount = useCallback(
    async (billId: string, month: number, year: number, amount: number) => {
      const prevPaid = overridesRef.current.find(o => o.bill_id === billId && o.month === month && o.year === year)?.paid_amount ?? 0;
      const cleanAmount = Math.max(0, amount);
      const patch = cleanAmount <= 0.005
        ? { paid_amount: 0, actual_amount: undefined, paid_date: undefined }
        : { paid_amount: cleanAmount };
      const delta = cleanAmount - prevPaid;
      const bill = bills.find(b => b.id === billId);
      const nextBalance = bill?.is_debt ? Math.max(0, bill.balance - delta) : undefined;
      if (demoMode) {
        await upsertOverride(billId, month, year, patch);
        if (bill?.is_debt && nextBalance !== undefined && delta !== 0) {
          setBills(prev => reorderDebtPriorities(
            prev.map(b => b.id === billId ? { ...b, balance: nextBalance } : b)
          ));
        }
        return;
      }
      if (!user) return;
      if (bill?.is_debt && Math.abs(delta) > 0.005) {
        // The override and principal balance are two different rows. Until the
        // database exposes one transactional RPC for both, do not claim this
        // direct edit saved after only one of those writes. Review Center's
        // debt-payment workflow is already atomic and remains available.
        throw new Error(
          "Record or match this debt payment in Activity so the payment and debt balance save together. No change was applied.",
        );
      }
      await upsertOverride(billId, month, year, patch);
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
      overridesByBillMonth.get(`${billId}:${year}-${month}`)?.custom_due_day,
    [overridesByBillMonth]
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

  const setPlannedDebtAmount = useCallback(
    async (billId: string, month: number, year: number, amount: number | undefined) => {
      const bill = bills.find(item => item.id === billId);
      if (!bill?.is_debt) throw new Error("Only debt payments can have a Forecast amount.");
      const monthPrefix = `${year}-${String(month + 1).padStart(2, "0")}`;
      const pendingFloor = debtSourceCommitments
        .filter(commitment => commitment.state === "pending"
          && commitment.sourceBillId === billId
          && commitment.date.startsWith(monthPrefix))
        .reduce((maximum, commitment) => Math.max(maximum, commitment.amount), 0);
      const validationError = amount === undefined ? undefined : plannedDebtAmountError(amount, pendingFloor);
      if (validationError) {
        throw new Error(validationError);
      }
      await upsertOverride(billId, month, year, {
        planned_debt_amount: amount === undefined ? undefined : roundMoney(amount),
      });
    },
    [bills, debtSourceCommitments, upsertOverride],
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
      ? { ...existing, to_date: cleanTo, move_reason: "manual" }
      : { id: genId(), bill_id: billId, from_date: cleanFrom, to_date: cleanTo, move_reason: "manual", created_at: new Date().toISOString() };
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
    const saveOperationId = markSaveStarted();
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
      markSaveCompleted(saveOperationId);
    } catch (error) {
      const current = billDateMovesRef.current.find(move => move.bill_id === billId && move.from_date === cleanFrom);
      if (current?.to_date === cleanTo) {
        billDateMovesRef.current = previous;
        setBillDateMoves(previous);
        overridesRef.current = previousOverrides;
        setOverrides(previousOverrides);
        writeStoredBillDateMoves(user.id, previous, householdScopeRef.current?.householdId);
      }
      markSaveFailed(error, () => moveBillOccurrence(billId, fromDate, toDate), saveOperationId);
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
    const saveOperationId = markSaveStarted();
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
      markSaveCompleted(saveOperationId);
    } catch (error) {
      billDateMovesRef.current = previous;
      setBillDateMoves(previous);
      overridesRef.current = previousOverrides;
      setOverrides(previousOverrides);
      writeStoredBillDateMoves(user.id, previous, householdScopeRef.current?.householdId);
      markSaveFailed(error, () => removeBillOccurrenceMove(id), saveOperationId);
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
      const o = overridesByBillMonth.get(`${bill.id}:${year}-${month}`);
      if (o?.custom_due_day !== undefined && (bill.frequency === "monthly" || bill.frequency === "quarterly")) {
        occ = [Math.min(o.custom_due_day, daysInMonth)];
      }
      return applyBillDateMovesToOccurrences(bill, month, year, occ);
    },
    [overridesByBillMonth, applyBillDateMovesToOccurrences]
  );

  const getBillMonthlyTotal = useCallback((bill: Bill, month: number, year: number): number => {
    const occurrences = getBillOccurrencesInMonth(bill, month, year);
    if (occurrences.length === 0) return 0;
    return getAmount(bill, month, year) * occurrences.length;
  }, [getAmount, getBillOccurrencesInMonth]);

  const getBillEffectiveMonthlyTotal = useCallback((bill: Bill, month: number, year: number): number => {
    const override = overridesByBillMonth.get(`${bill.id}:${year}-${month}`);
    return override?.actual_amount !== undefined
      ? Math.max(0, override.actual_amount)
      : getBillMonthlyTotal(bill, month, year);
  }, [overridesByBillMonth, getBillMonthlyTotal]);

  const monthlyBillsCache = useMemo(
    () => new Map<string, Bill[]>(),
    [bills, getBillOccurrencesInMonth],
  );
  const getMonthlyBills = useCallback(
    (month: number, year: number): Bill[] => {
      const key = `${year}-${month}`;
      const cached = monthlyBillsCache.get(key);
      if (cached) return cached;
      const result = bills.filter(b =>
        (b.is_recurring || b.is_debt)
        && (isBillActiveForMonth(b, month, year)
          || getBillOccurrencesInMonth(b, month, year).length > 0));
      monthlyBillsCache.set(key, result);
      return result;
    },
    [bills, getBillOccurrencesInMonth, monthlyBillsCache]
  );

  const debtMonthSettlementsCache = useMemo(
    () => new Map<string, Map<string, DebtMonthSettlement>>(),
    [getBillOccurrencesInMonth, getMonthlyBills, overridesByBillMonth, reviewedBillOccurrences],
  );

  const getDebtMonthSettlements = useCallback((month: number, year: number) => {
    const cacheKey = `${year}-${month}`;
    const cached = debtMonthSettlementsCache.get(cacheKey);
    if (cached) return cached;
    const result = new Map<string, DebtMonthSettlement>();
    getMonthlyBills(month, year).filter(bill => bill.is_debt).forEach(bill => {
      const override = overridesByBillMonth.get(`${bill.id}:${year}-${month}`);
      const occurrenceDates = getBillOccurrencesInMonth(bill, month, year).map(day =>
        `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      );
      const reviewedForMonth = occurrenceDates.map(date =>
        reviewedBillOccurrences.get(occurrenceKey(bill.id, date)),
      );
      const hasReviewedOccurrence = reviewedForMonth.some(Boolean);
      const rawSnapshotTotal = override?.required_debt_amount;
      const snapshotTotal = rawSnapshotTotal !== undefined && Number.isFinite(rawSnapshotTotal)
        ? Math.max(0, rawSnapshotTotal)
        : undefined;
      const snapshotParts = occurrenceDates.map((_, index) => {
        if (snapshotTotal === undefined || occurrenceDates.length === 0) return undefined;
        const allocatedBefore = Math.round((snapshotTotal / occurrenceDates.length) * index * 100) / 100;
        const allocatedThrough = index === occurrenceDates.length - 1
          ? snapshotTotal
          : Math.round((snapshotTotal / occurrenceDates.length) * (index + 1) * 100) / 100;
        return Math.max(0, allocatedThrough - allocatedBefore);
      });
      const fallbackPaidByDate = new Map<string, number>();
      if (!hasReviewedOccurrence && occurrenceDates.length > 0) {
        let paidRemaining = Math.max(0, Number(override?.actual_amount ?? override?.paid_amount) || 0);
        const paidDate = override?.paid_date?.slice(0, 10);
        const orderedDates = [
          ...(paidDate && occurrenceDates.includes(paidDate) ? [paidDate] : []),
          ...occurrenceDates.filter(date => date !== paidDate),
        ];
        orderedDates.forEach(date => {
          const index = occurrenceDates.indexOf(date);
          const required = snapshotParts[index] ?? Math.max(0, Number(bill.amount) || 0);
          const applied = Math.min(required, paidRemaining);
          fallbackPaidByDate.set(date, applied);
          paidRemaining = Math.max(0, paidRemaining - applied);
        });
        if (paidRemaining > 0.005) {
          const extraDate = paidDate && occurrenceDates.includes(paidDate)
            ? paidDate
            : orderedDates[orderedDates.length - 1];
          if (extraDate) {
            fallbackPaidByDate.set(
              extraDate,
              (fallbackPaidByDate.get(extraDate) ?? 0) + paidRemaining,
            );
          }
        }
      }
      const occurrenceSettlements = occurrenceDates.map((date, index) => resolveDebtOccurrenceSettlement({
        occurrenceDate: date,
        configuredObligation: bill.amount,
        reviewed: reviewedForMonth[index],
        paidAmount: fallbackPaidByDate.get(date) ?? 0,
        requiredAmountSnapshot: snapshotParts[index],
      }));
      result.set(bill.id, summarizeDebtOccurrenceSettlements(
        occurrenceSettlements,
        override?.planned_debt_amount,
      ));
    });
    debtMonthSettlementsCache.set(cacheKey, result);
    return result;
  }, [debtMonthSettlementsCache, getBillOccurrencesInMonth, getMonthlyBills, overridesByBillMonth, reviewedBillOccurrences]);

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

  const saveExtraPayment = useCallback(async (month: number, year: number, amount: number, allocations: SnowballAllocation[], paymentDate?: string, sources?: SnowballFundingSource[]) => {
    if (!isValidExtraPaymentPlan({ amount, allocations })) {
      throw new Error("Extra payment plans require a positive amount with matching debt allocations.");
    }
    if (!user) return;
    assertCanEditHousehold("save an extra debt payment");
    const existing = extraPayments.find(ep => ep.month === month && ep.year === year);
    const payloadSources = sources ?? (existing
      ? resizeSnowballFundingSources(existing.sources, amount) as SnowballFundingSource[]
      : [{ type: "manual" as const, amount }]);
    const availableDate = latestBucketRemainderAvailableDate(payloadSources);
    if (availableDate && (!paymentDate || paymentDate < availableDate)) {
      throw new Error(`This payment includes bucket money that is not available until ${availableDate}.`);
    }
    const payload = { amount, allocations, payment_date: paymentDate, sources: payloadSources };
    if (demoMode) {
      if (existing) {
        setExtraPayments(prev => prev.map(ep => ep.id === existing.id ? { ...ep, ...payload } : ep));
      } else {
        setExtraPayments(prev => [...prev, { id: genId(), month, year, ...payload }]);
      }
      return;
    }
    const next: ExtraPayment = existing ? { ...existing, ...payload } : { id: genId(), month, year, ...payload };
    const persist: () => Promise<void> = () => runTrackedFinancialMutation(async () => {
      await ensureSaved(
        supabase.from("extra_payments").upsert(scopedPayload({ ...next, user_id: user.id }), { onConflict: "id" }),
        existing ? "Update extra payment" : "Add extra payment",
      );
      setExtraPayments(prev => upsertSnowballPlanById(prev, next));
    }, persist);
    await persist();
  }, [user, extraPayments, demoMode, scopedPayload, assertCanEditHousehold, runTrackedFinancialMutation]);

  const getExtraPayment = useCallback(
    (month: number, year: number) => extraPayments.find(ep => ep.month === month && ep.year === year && isValidExtraPaymentPlan(ep)),
    [extraPayments]
  );

  const debtSourceCommitmentsByMonth = useMemo(
    () => indexRecordsByMonth(debtSourceCommitments),
    [debtSourceCommitments],
  );
  const extraPaymentsByMonth = useMemo(() => new Map(
    extraPayments
      .filter(isValidExtraPaymentPlan)
      .map(payment => [`${payment.year}-${payment.month}`, payment] as const),
  ), [extraPayments]);

  interface DebtPlanProjectionCacheEntry {
    result: DatedSnowballMonthPlanResult;
    endingBalances: Map<string, number>;
    rolledPayment: number;
  }
  const debtPlanProjectionCache = useMemo(
    () => new Map<string, DebtPlanProjectionCacheEntry>(),
    [
      bills,
      debtSourceCommitmentsByMonth,
      extraPaymentsByMonth,
      getBillOccurrencesInMonth,
      getDebtMonthSettlements,
      overridesByBillMonth,
      settings.debtPayoffEnabled,
      settings.paymentMethod,
    ],
  );

  const getDebtPlanForMonth = useCallback((month: number, year: number): DatedSnowballMonthPlanResult | null => {
    if (!settings.debtPayoffEnabled) return null;
    const debtPlanAsOfMonth = safeLocalDateInTimeZone(
      new Date(),
      householdTimeZone,
    ).slice(0, 7);
    const [startYear, startMonthNumber] = debtPlanAsOfMonth.split("-").map(Number);
    const startMonth = startMonthNumber - 1;
    if (year < startYear || (year === startYear && month < startMonth)) return null;

    const requestedKey = financialProjectionMonthCacheKey(
      debtPlanAsOfMonth,
      month,
      year,
    );
    const cachedRequested = debtPlanProjectionCache.get(requestedKey);
    if (cachedRequested) return cachedRequested.result;

    const debtBills = bills.filter(bill => bill.is_debt);
    if (!debtBills.length) return null;
    const debtBillsById = new Map(debtBills.map(bill => [bill.id, bill]));

    let balances = new Map(debtBills.map(bill => [bill.id, Math.max(0, Number(bill.balance) || 0)]));
    // Persisted boosts are the already-freed snowball pool. Keep that money in
    // the forecast, but feed it to the allocator as rollover so it never becomes
    // part of a creditor's required minimum.
    let rolledPayment = snowballRolloverPlanTotal(debtBills);
    let result: DatedSnowballMonthPlanResult | null = null;
    let cursorMonth = startMonth;
    let cursorYear = startYear;
    let guard = 0;

    // Reuse the closest completed predecessor. A September read after August
    // no longer replays the complete August snowball projection.
    let priorMonth = month - 1;
    let priorYear = year;
    if (priorMonth < 0) { priorMonth = 11; priorYear -= 1; }
    while (
      priorYear > startYear
      || (priorYear === startYear && priorMonth >= startMonth)
    ) {
      const predecessor = debtPlanProjectionCache.get(financialProjectionMonthCacheKey(
        debtPlanAsOfMonth,
        priorMonth,
        priorYear,
      ));
      if (predecessor) {
        balances = new Map(predecessor.endingBalances);
        rolledPayment = predecessor.rolledPayment;
        cursorMonth = priorMonth + 1;
        cursorYear = priorYear;
        if (cursorMonth > 11) { cursorMonth = 0; cursorYear += 1; }
        break;
      }
      priorMonth -= 1;
      if (priorMonth < 0) { priorMonth = 11; priorYear -= 1; }
    }

    while ((cursorYear < year || (cursorYear === year && cursorMonth <= month)) && guard < 240) {
      const monthSettlements = getDebtMonthSettlements(cursorMonth, cursorYear);
      const cursorPrefix = `${cursorYear}-${String(cursorMonth + 1).padStart(2, "0")}`;
      const authoritativePaidByDebtId = new Map(debtBills.map(bill => [
        bill.id,
        authoritativeDebtPaidAmountForMonth(
          monthSettlements.get(bill.id)?.paidAmount ?? 0,
          debtSourceCommitments,
          bill.id,
          cursorPrefix,
        ),
      ]));
      const exactPlanDebtIds = new Set<string>();
      const debtsForMonth: DatedSnowballDebtInput[] = debtBills
        .filter(bill => isBillActiveForMonth(bill, cursorMonth, cursorYear))
        .map(bill => {
          const occurrenceCount = getBillOccurrencesInMonth(bill, cursorMonth, cursorYear).length;
          const currentRequiredAmount = requiredDebtPlanTotal(bill, occurrenceCount);
          const override = overridesByBillMonth.get(
            `${bill.id}:${cursorYear}-${cursorMonth}`,
          );
          const exactPlannedAmount = exactDebtPlanTotal({
            plannedDebtAmount: override?.planned_debt_amount,
            customAmount: override?.custom_amount,
            occurrenceCount,
          });
          if (exactPlannedAmount !== undefined) exactPlanDebtIds.add(bill.id);
          const settlement = monthSettlements.get(bill.id);
          const requiredObligation = settlement?.configuredObligation ?? currentRequiredAmount;
          const payment = debtPlanPaymentBreakdown(requiredObligation, exactPlannedAmount);
          const paidTowardExtra = Math.max(0, (authoritativePaidByDebtId.get(bill.id) ?? 0) - requiredObligation);
          let requiredCashRemaining = settlement?.status === "settled" ? 0 : payment.requiredPayment;
          const requiredPaymentsByDate = settlement?.occurrences?.length
            ? new Map(settlement.occurrences.map(occurrence => {
                const amount = Math.min(occurrence.configuredObligation, requiredCashRemaining);
                requiredCashRemaining = Math.max(0, requiredCashRemaining - amount);
                return [occurrence.occurrenceDate, amount] as const;
              }))
            : undefined;
          return {
            id: bill.id,
            name: bill.name,
            balance: balances.get(bill.id) ?? Math.max(0, Number(bill.balance) || 0),
            // `minimum` is always the original lender requirement. Current
            // Forecast edits are split into required cash and targeted extra.
            minimum: currentRequiredAmount,
            requiredPayment: settlement?.status === "settled" ? 0 : payment.requiredPayment,
            requiredPaymentsByDate,
            plannedExtraPayment: Math.max(0, payment.plannedExtraPayment - paidTowardExtra),
            apr: Number(bill.interest_rate) || 0,
            dueDay: bill.due_day,
            included: bill.include_in_snowball !== false,
          };
        });
      const paymentDatesByDebtId = new Map(debtsForMonth.map(debt => {
        const bill = debtBillsById.get(debt.id);
        const dates = bill
          ? getBillOccurrencesInMonth(bill, cursorMonth, cursorYear).map(day =>
            `${cursorYear}-${String(cursorMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`)
          : [];
        return [debt.id, dates] as const;
      }));
      const savedExtra = extraPaymentsByMonth.get(`${cursorYear}-${cursorMonth}`);
      const automaticTarget = orderDebts(
        debtsForMonth.filter(debt => debt.included && debt.balance > 0.009),
        settings.paymentMethod,
      )[0];
      // A reviewed, pending, or posted-review payment above the lender minimum
      // has already consumed that much of this month's automatic rollover.
      const rolloverAlreadyPaid = automaticTarget
        ? Math.max(
            0,
            (authoritativePaidByDebtId.get(automaticTarget.id) ?? 0)
              - (monthSettlements.get(automaticTarget.id)?.configuredObligation ?? automaticTarget.minimum),
          )
        : 0;
      const rolledPaymentForMonth = automaticDebtRolloverForMonth(
        rolledPayment,
        automaticTarget?.id,
        exactPlanDebtIds,
        rolloverAlreadyPaid,
      );
      result = projectDatedSnowballMonth({
        debts: debtsForMonth,
        method: settings.paymentMethod,
        month: cursorMonth,
        year: cursorYear,
        paymentDatesByDebtId,
        startingBalances: balances,
        rolledPayment: rolledPaymentForMonth,
        extraPayment: savedExtra ? {
          amount: savedExtra.amount,
          date: savedExtra.payment_date ?? `${cursorYear}-${String(cursorMonth + 1).padStart(2, "0")}-01`,
        } : undefined,
      });
      const allocationsAfterReviewedPayments = remainingDebtAllocationsAfterReviewedPayments(
        result.allocations,
        monthSettlements,
      );
      const advancePlan = {
        ...result,
        allocations: allocationsAfterReviewedPayments,
        plannedPayment: allocationsAfterReviewedPayments.reduce((sum, allocation) => sum + allocation.amount, 0),
      };
      const projected = advanceDebtProjectionWithCommitments(
        advancePlan,
        debtsForMonth,
        rolledPayment,
        debtSourceCommitmentsByMonth.get(cursorPrefix) ?? [],
        result.allocations,
      );
      balances = projected.balances;
      rolledPayment = projected.rolledPayment;
      debtPlanProjectionCache.set(financialProjectionMonthCacheKey(
        debtPlanAsOfMonth,
        cursorMonth,
        cursorYear,
      ), {
        result,
        endingBalances: new Map(balances),
        rolledPayment,
      });

      if (cursorYear === year && cursorMonth === month) break;
      cursorMonth += 1;
      if (cursorMonth > 11) {
        cursorMonth = 0;
        cursorYear += 1;
      }
      guard += 1;
    }

    return result;
  }, [bills, debtPlanProjectionCache, debtSourceCommitments, debtSourceCommitmentsByMonth, extraPaymentsByMonth, getBillOccurrencesInMonth, getDebtMonthSettlements, householdTimeZone, overridesByBillMonth, settings.paymentMethod, settings.debtPayoffEnabled]);

  const remainingDebtPlanCache = useMemo(
    () => new Map<string, DatedSnowballMonthPlanResult | null>(),
    [debtSourceCommitmentsByMonth, getDebtMonthSettlements, getDebtPlanForMonth, matchedAllocationIndexes],
  );

  const getRemainingDebtPlanForMonth = useCallback((month: number, year: number): DatedSnowballMonthPlanResult | null => {
    const cacheKey = financialProjectionMonthCacheKey(
      safeLocalDateInTimeZone(new Date(), householdTimeZone).slice(0, 7),
      month,
      year,
    );
    if (remainingDebtPlanCache.has(cacheKey)) {
      return remainingDebtPlanCache.get(cacheKey) ?? null;
    }
    const plan = getDebtPlanForMonth(month, year);
    if (!plan) {
      remainingDebtPlanCache.set(cacheKey, null);
      return null;
    }
    const billMatches = matchedAllocationIndexes.bill;
    const snowballMatches = matchedAllocationIndexes.snowball;
    const debtSettlements = getDebtMonthSettlements(month, year);
    const monthPrefix = `${year}-${String(month + 1).padStart(2, "0")}`;
    const reviewedBillIds = matchedAllocationIndexes.reviewedBillIdsByMonth.get(monthPrefix)
      ?? new Set<string>();
    const overridePaidRemaining = new Map(Array.from(debtSettlements)
      .filter(([billId, settlement]) => !reviewedBillIds.has(billId) && settlement.paidAmount > 0.005)
      .map(([billId, settlement]) => [billId, settlement.paidAmount]));
    const settlements: DatedDebtSettlement[] = [];
    const seen = new Set<string>();
    plan.allocations.forEach(allocation => {
      const sourceType = allocation.kind === "extra" ? "extra" : "bill";
      const billId = allocation.kind === "extra" ? allocation.targetBillId : allocation.sourceBillId;
      if (!billId) return;
      const key = `${sourceType}:${billId}:${allocation.date}`;
      if (seen.has(key)) return;
      seen.add(key);
      const match = sourceType === "extra"
        ? snowballMatches.get(occurrenceKey(billId, allocation.date))
        : billMatches.get(occurrenceKey(billId, allocation.date));
      if (match && Number(match.amount) > 0.005) {
        settlements.push({ sourceType, billId, date: allocation.date, amount: Number(match.amount) });
      } else if (sourceType === "bill") {
        const fallbackPaid = overridePaidRemaining.get(billId) ?? 0;
        if (fallbackPaid <= 0.005) return;
        const applied = Math.min(fallbackPaid, Math.max(allocation.sourceAmount, allocation.amount));
        settlements.push({ sourceType, billId, date: allocation.date, amount: applied });
        overridePaidRemaining.set(billId, Math.max(0, fallbackPaid - applied));
      }
    });
    const allocationsAfterSettlements = remainingDatedDebtAllocations(plan.allocations, settlements);
    const sourceCommitments = debtSourceCommitmentsByMonth.get(monthPrefix) ?? [];
    const allocations = applyDebtSourceCommitments(allocationsAfterSettlements, sourceCommitments);
    const result = {
      ...plan,
      allocations,
      plannedPayment: allocations.reduce((sum, allocation) => sum + allocation.amount, 0),
    };
    remainingDebtPlanCache.set(cacheKey, result);
    return result;
  }, [debtSourceCommitmentsByMonth, getDebtMonthSettlements, getDebtPlanForMonth, householdTimeZone, matchedAllocationIndexes, remainingDebtPlanCache]);

  const deleteExtraPayment = useCallback(async (id: string) => {
    if (!user) return;
    assertCanEditHousehold("delete an extra debt payment");
    const payment = extraPayments.find(item => item.id === id);
    if (hasBucketRemainderFunding(payment?.sources)) {
      throw new Error("Reopen the routed spending bucket before removing this Snowball payment.");
    }
    if (demoMode) {
      setExtraPayments(prev => prev.filter(ep => ep.id !== id));
      return;
    }
    const persist: () => Promise<void> = () => runTrackedFinancialMutation(async () => {
      await deleteRowIdempotently("extra_payments", id, "Delete extra payment");
      setExtraPayments(prev => prev.filter(ep => ep.id !== id));
    }, persist);
    await persist();
  }, [user, extraPayments, demoMode, assertCanEditHousehold, deleteRowIdempotently, runTrackedFinancialMutation]);

  const applyDebtSnowballPayment = useCallback(async (
    preview: SnowballProjectionResult,
    sources?: SnowballFundingSource[],
    existingPaymentId?: string,
  ) => {
    if (!isValidExtraPaymentPlan({ amount: preview.selectedExtra, allocations: preview.allocations })) {
      throw new Error("Extra payment plans require a positive amount with matching debt allocations.");
    }
    if (!user) return;
    if (!settings.debtPayoffEnabled) throw new Error("Turn on Debt Payoff Plan before applying an automatic debt payment.");
    assertCanEditHousehold("apply a debt snowball payment");
    const [year, monthNumber] = preview.paymentDate.split("-").map(Number);
    const month = monthNumber - 1;
    const existing = existingPaymentId
      ? extraPayments.find(ep => ep.id === existingPaymentId)
      : extraPayments.find(ep => ep.month === month && ep.year === year);
    const paymentId = existing?.id ?? genId();
    const resizedSources = sources ?? (existing
      ? resizeSnowballFundingSources(existing.sources, preview.selectedExtra) as SnowballFundingSource[]
      : [{ type: "manual" as const, amount: preview.selectedExtra }]);
    const availableDate = latestBucketRemainderAvailableDate(resizedSources);
    if (availableDate && preview.paymentDate < availableDate) {
      throw new Error(`This payment includes bucket money that is not available until ${availableDate}.`);
    }
    const payloadSources = markSnowballSourcesPending(resizedSources);

    if (demoMode) {
      const nextPayment: ExtraPayment = {
        id: paymentId, month, year,
        amount: preview.selectedExtra, allocations: preview.allocations,
        payment_date: preview.paymentDate, sources: payloadSources,
      };
      setExtraPayments(prev => upsertSnowballPlanById(prev, nextPayment));
      return;
    }

    const persist: () => Promise<void> = () => runTrackedFinancialMutation(async () => {
      const { data: savedPaymentId, error } = await supabase.rpc("apply_debt_snowball_payment", {
        // A retry sends the same payment id. The RPC locks and updates that row
        // (or the existing household/month row) instead of inserting twice.
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
      const refreshedOverrides = (overrideResult.data ?? []).map(normalizeMonthlyOverrideRow);

      setBills(reorderDebtPriorities((billsResult.data ?? []).map(normalizeBillRow)));
      setOverrides(prev => [...prev.filter(o => o.month !== month || o.year !== year), ...refreshedOverrides]);
      const nextPayment: ExtraPayment = {
        id: String(savedPaymentId ?? paymentId), month, year,
        amount: preview.selectedExtra, allocations: preview.allocations,
        payment_date: preview.paymentDate, sources: payloadSources,
      };
      setExtraPayments(prev => upsertSnowballPlanById(prev, nextPayment));
    }, persist);
    await persist();
  }, [user, extraPayments, demoMode, applyHouseholdSelect, assertCanEditHousehold, settings.debtPayoffEnabled, runTrackedFinancialMutation]);

  const removeDebtSnowballPayment = useCallback(async (month: number, year: number) => {
    const existing = extraPayments.find(ep => ep.month === month && ep.year === year);
    if (!existing || !user) return;
    assertCanEditHousehold("remove a debt snowball payment");
    if (hasBucketRemainderFunding(existing.sources)) {
      throw new Error("Reopen the routed spending bucket before removing this Snowball payment.");
    }
    if (demoMode) {
      setExtraPayments(prev => prev.filter(ep => ep.id !== existing.id));
      return;
    }
    if (hasPendingSnowballBalanceApply(existing)) {
      await deleteExtraPayment(existing.id);
      return;
    }
    const persist: () => Promise<void> = () => runTrackedFinancialMutation(async () => {
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
      const refreshedOverrides = (overrideResult.data ?? []).map(normalizeMonthlyOverrideRow);
      setBills(reorderDebtPriorities((billsResult.data ?? []).map(normalizeBillRow)));
      setOverrides(prev => [...prev.filter(o => o.month !== month || o.year !== year), ...refreshedOverrides]);
      setExtraPayments(prev => prev.filter(ep => ep.id !== existing.id));
    }, persist);
    await persist();
  }, [user, extraPayments, deleteExtraPayment, demoMode, applyHouseholdSelect, assertCanEditHousehold, runTrackedFinancialMutation]);

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
        payment.id,
      )
        // applyDebtSnowballPayment already retains its stable-id retry closure.
        .catch(() => undefined)
        .finally(() => repairingAppliedSnowballPlans.current.delete(payment.id));
    });
  }, [user, extraPayments, applyDebtSnowballPayment, demoMode]);

  const finalizeBillPayment = useCallback(async (billId: string, month: number, year: number, actualAmount: number, paidDate: string) => {
    assertCanEditHousehold("finalize a bill payment");
    const bill = bills.find(b => b.id === billId);
    if (!bill) throw new Error("Bill not found");
    const budgeted = getBillMonthlyTotal(bill, month, year);
    const actual = Math.max(0, Number(actualAmount) || 0);
    const requiredDebtAmount = bill.is_debt
      ? (getDebtMonthSettlements(month, year).get(bill.id)?.configuredObligation
        ?? requiredDebtPlanTotal(bill, getBillOccurrencesInMonth(bill, month, year).length))
      : undefined;
    await upsertOverride(billId, month, year, {
      actual_amount: actual,
      paid_amount: actual,
      paid_date: paidDate,
      ...(requiredDebtAmount !== undefined ? { required_debt_amount: requiredDebtAmount } : {}),
    });
    return { budgeted, actual, surplus: Math.max(0, budgeted - actual) };
  }, [bills, getBillMonthlyTotal, getBillOccurrencesInMonth, getDebtMonthSettlements, upsertOverride, assertCanEditHousehold]);

  // ─── Transactions ─────────────────────────────────────────────────────────────

  const refreshDebtRows = useCallback(async () => {
    if (!user) return;
    const [billRows, transactionRows] = await Promise.all([
      applyHouseholdSelect(supabase.from("bills").select("*"), user.id),
      loadAllTransactions(user.id),
    ]);
    if (billRows.error) throw new Error(`Refresh debts: ${billRows.error.message}`);
    if (transactionRows.error) throw new Error(`Refresh transactions: ${transactionRows.error.message}`);
    setBills(reorderDebtPriorities((billRows.data ?? []).map(normalizeBillRow)));
    const transactionCollections = accountAwareTransactionCollections(transactionRows.data ?? [], transactionAccountIdentitiesRef.current);
    setTransactions(transactionCollections.active);
    setDeletedTransactions(transactionCollections.deleted);
  }, [user, applyHouseholdSelect, loadAllTransactions]);

  const syncDebtTransactionsAndRefresh = useCallback(async () => {
    if (!user || demoMode) return;
    if (!canEditHousehold) return;
    const synced = await supabase.rpc("sync_due_debt_transactions", {
      p_as_of_date: localDateInTimeZone(new Date(), householdTimeZone),
      p_household_id: householdScopeRef.current?.householdId ?? null,
    });
    if (synced.error) {
      throw new Error(`Sync debt payments: ${synced.error.message}`);
    }
    await refreshDebtRows();
  }, [user, demoMode, canEditHousehold, householdTimeZone, refreshDebtRows]);

  useEffect(() => {
    if (!user || demoMode) return;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const now = new Date();
      const nextDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
      timer = setTimeout(() => {
        void syncDebtTransactionsAndRefresh()
          .catch(error => console.warn("Scheduled debt sync skipped", error instanceof Error ? error.message : error))
          .finally(schedule);
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
    const persist: () => Promise<string> = () => runTrackedFinancialMutation(async () => {
      await ensureSaved(
        supabase.from("transactions").upsert(scopedPayload({ ...nt, user_id: user.id }), { onConflict: "id" }),
        "Add transaction",
      );
      setTransactions(prev => [...prev.filter(item => item.id !== nt.id), nt]);
      if (nt.linked_bill_id || nt.debt_applied_bill_id) await syncDebtTransactionsAndRefresh();
      return nt.id;
    }, persist);
    return persist();
  }, [user, accounts, syncDebtTransactionsAndRefresh, demoMode, scopedPayload, assertCanEditHousehold, runTrackedFinancialMutation]);

  const updateTransaction = useCallback(async (tx: Transaction) => {
    if (!user) return;
    assertCanEditHousehold("update a transaction");
    const existing = transactions.find(item => item.id === tx.id);
    const editedTransaction: Transaction = { ...tx, user_edited_at: new Date().toISOString() };
    const applyOptimisticEdit = () => {
      setTransactions(prev => prev.map(item => item.id === tx.id ? editedTransaction : item));
    };
    applyOptimisticEdit();
    if (demoMode) return;
    const editToken = genId();
    transactionEditTokensRef.current.set(tx.id, editToken);
    const persist: () => Promise<void> = () => enqueueMutationByKey(transactionWriteQueuesRef.current, tx.id, () => runTrackedFinancialMutation(async () => {
      if (transactionEditTokensRef.current.get(tx.id) !== editToken) return;
      applyOptimisticEdit();
      try {
        const persisted = await supabase.from("transactions")
          .update({ ...editedTransaction })
          .eq("id", tx.id)
          .select("*")
          .single();
        if (persisted.error) throw new Error(`Update transaction: ${persisted.error.message}`);
        const savedTransaction = normalizeTransactionRow(persisted.data);
        if (editedTransaction.linked_bill_id || existing?.linked_bill_id || existing?.debt_applied_bill_id) {
          await syncDebtTransactionsAndRefresh();
        }
        if (transactionEditTokensRef.current.get(tx.id) === editToken) {
          setTransactions(prev => prev.map(item => item.id === tx.id ? savedTransaction : item));
          transactionEditTokensRef.current.delete(tx.id);
        }
      } catch (error) {
        if (existing) {
          setTransactions(prev => prev.map(item =>
            item.id === existing.id && item.user_edited_at === editedTransaction.user_edited_at ? existing : item
          ));
        }
        throw error;
      }
    }, persist));
    await persist();
  }, [user, transactions, syncDebtTransactionsAndRefresh, demoMode, assertCanEditHousehold, runTrackedFinancialMutation]);

  const refreshBillMatchData = useCallback(async () => {
    if (!user || demoMode) return;
    const [transactionRows, overrideRows, goalRows, decisionRows] = await Promise.all([
      loadAllTransactions(user.id),
      applyHouseholdSelect(supabase.from("monthly_overrides").select("*"), user.id),
      applyHouseholdSelect(supabase.from("goals").select("*"), user.id),
      applyHouseholdSelect(supabase.from("decisions").select("*"), user.id),
    ]);
    if (transactionRows.error) throw new Error(`Refresh matched transaction: ${transactionRows.error.message}`);
    if (overrideRows.error) throw new Error(`Refresh matched bill: ${overrideRows.error.message}`);
    if (goalRows.error) throw new Error(`Refresh planned expense: ${goalRows.error.message}`);
    if (decisionRows.error) throw new Error(`Refresh calendar plan: ${decisionRows.error.message}`);
    const transactionCollections = accountAwareTransactionCollections(transactionRows.data ?? [], transactionAccountIdentitiesRef.current);
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
  }, [user, demoMode, applyHouseholdSelect, loadAllTransactions]);

  const matchPendingTransactionToPlan = useCallback(async (
    pendingPlaidTransactionId: string,
    targetType: PendingPlanMatch["target_type"],
    targetId: string,
    occurrenceDate: string,
    plannedAmount: number,
  ) => {
    if (!user) throw new Error("Sign in to match a pending payment");
    assertCanEditHousehold("match a pending payment");
    const pending = pendingBankTransactions.find(item => item.plaid_transaction_id === pendingPlaidTransactionId);
    const target = targetType === "bill"
      ? bills.find(item => item.id === targetId)
      : transactions.find(item =>
        item.id === targetId
        && item.source !== "plaid"
        && item.amount < 0
        && !item.pending
        && !item.removed_at
        && !item.deleted_at);
    if (!pending || !target) throw new Error("Pending payment or matching Activity entry not found");
    if (pending.amount >= 0) throw new Error("Only pending money-out charges can be matched");
    if (targetType === "manual" && "date" in target && target.date.slice(0, 7) !== pending.transaction_date.slice(0, 7)) {
      throw new Error("The manual Activity entry must be in the same month as the pending charge");
    }

    const now = new Date().toISOString();
    const existing = pendingPlanMatches.find(item => item.pending_plaid_transaction_id === pendingPlaidTransactionId);
    const optimistic: PendingPlanMatch = {
      id: existing?.id ?? genId(),
      pending_plaid_transaction_id: pendingPlaidTransactionId,
      pending_account_id: pending.plaid_account_id,
      target_type: targetType,
      target_id: target.id,
      target_name: "name" in target
        ? target.name
        : target.note?.trim() || target.category || "Manual Activity",
      occurrence_date: occurrenceDate,
      planned_amount: roundMoney(Math.max(0, plannedAmount)),
      pending_amount: roundMoney(Math.abs(pending.amount)),
      pending_transaction_date: pending.transaction_date,
      status: "active",
      created_at: existing?.created_at ?? now,
      updated_at: now,
    };

    if (demoMode) {
      setPendingPlanMatches(previous => [
        ...previous.filter(item => item.pending_plaid_transaction_id !== pendingPlaidTransactionId),
        optimistic,
      ]);
      return;
    }

    const payload = scopedPayload({
      user_id: user.id,
      pending_plaid_transaction_id: optimistic.pending_plaid_transaction_id,
      pending_account_id: optimistic.pending_account_id ?? null,
      target_type: optimistic.target_type,
      target_id: optimistic.target_id,
      target_name: optimistic.target_name,
      occurrence_date: optimistic.occurrence_date,
      planned_amount: optimistic.planned_amount,
      pending_amount: optimistic.pending_amount,
      pending_transaction_date: optimistic.pending_transaction_date,
      status: "active",
      posted_transaction_id: null,
      posted_plaid_transaction_id: null,
      posted_amount: null,
      created_by: user.id,
      updated_at: now,
    });
    if (!payload.household_id) throw new Error("Choose a household before matching this payment");

    const saveOperationId = markSaveStarted();
    try {
      const result = await supabase
        .from("pending_plan_matches")
        .upsert(payload, { onConflict: "household_id,pending_plaid_transaction_id" })
        .select("*")
        .single();
      if (result.error) throw new Error(`Match pending payment: ${result.error.message}`);
      const saved = normalizePendingPlanMatchRow(result.data);
      setPendingPlanMatches(previous => [
        ...previous.filter(item => item.pending_plaid_transaction_id !== pendingPlaidTransactionId),
        saved,
      ]);
      markSaveCompleted(saveOperationId);
    } catch (error) {
      markSaveFailed(error, () => matchPendingTransactionToPlan(
        pendingPlaidTransactionId,
        targetType,
        targetId,
        occurrenceDate,
        plannedAmount,
      ), saveOperationId);
      throw error;
    }
  }, [
    user,
    assertCanEditHousehold,
    pendingBankTransactions,
    bills,
    transactions,
    pendingPlanMatches,
    demoMode,
    scopedPayload,
    markSaveStarted,
    markSaveCompleted,
    markSaveFailed,
  ]);

  const matchPendingTransactionToBill = useCallback((
    pendingPlaidTransactionId: string,
    billId: string,
    occurrenceDate: string,
    plannedAmount: number,
  ) => matchPendingTransactionToPlan(
    pendingPlaidTransactionId,
    "bill",
    billId,
    occurrenceDate,
    plannedAmount,
  ), [matchPendingTransactionToPlan]);

  const matchPendingTransactionToManual = useCallback((
    pendingPlaidTransactionId: string,
    manualTransactionId: string,
  ) => {
    const pending = pendingBankTransactions.find(item => item.plaid_transaction_id === pendingPlaidTransactionId);
    const manual = transactions.find(item => item.id === manualTransactionId);
    if (!pending || !manual) return Promise.reject(new Error("Pending payment or manual Activity entry not found"));
    return matchPendingTransactionToPlan(
      pendingPlaidTransactionId,
      "manual",
      manualTransactionId,
      manual.date,
      Math.abs(manual.amount),
    );
  }, [matchPendingTransactionToPlan, pendingBankTransactions, transactions]);

  const removePendingPlanMatch = useCallback(async (matchId: string) => {
    if (!user) throw new Error("Sign in to remove this pending match");
    assertCanEditHousehold("remove a pending match");
    const existing = pendingPlanMatches.find(item => item.id === matchId);
    if (!existing) return;

    if (demoMode) {
      setPendingPlanMatches(previous => previous.filter(item => item.id !== matchId));
      return;
    }

    const saveOperationId = markSaveStarted();
    try {
      const result = await supabase
        .from("pending_plan_matches")
        .update({ status: "cancelled", updated_at: new Date().toISOString() })
        .eq("id", matchId);
      if (result.error) throw new Error(`Remove pending match: ${result.error.message}`);
      setPendingPlanMatches(previous => previous.filter(item => item.id !== matchId));
      markSaveCompleted(saveOperationId);
    } catch (error) {
      markSaveFailed(error, () => removePendingPlanMatch(matchId), saveOperationId);
      throw error;
    }
  }, [user, assertCanEditHousehold, pendingPlanMatches, demoMode, markSaveStarted, markSaveCompleted, markSaveFailed]);

  const reconcileTransaction = useCallback(async (rawInput: ReconcileTransactionInput) => {
    if (!user) throw new Error("Sign in to review transactions");
    assertCanEditHousehold("review transactions");
    const transaction = transactions.find(item => item.id === rawInput.transactionId);
    if (!transaction) throw new Error("Transaction not found");
    const matchedIncome = rawInput.resolution === "income"
      ? incomes.find(income => income.id === rawInput.targetId)
      : undefined;
    const input = matchedIncome
      ? {
          ...rawInput,
          occurrenceDate: resolveIncomeMatchOccurrenceDate(
            matchedIncome,
            transaction.date,
            rawInput.occurrenceDate,
          ),
        }
      : rawInput;

    if (demoMode) {
      const manualTarget = input.resolution === "manual"
        ? transactions.find(item => item.id === input.targetId && item.source !== "plaid" && item.amount < 0)
        : undefined;
      const snowballPayment = input.resolution === "snowball"
        ? extraPayments.find(payment =>
          payment.payment_date === input.occurrenceDate
          && payment.allocations.some(allocation => allocation.billId === input.targetId))
        : undefined;
      const snowballDebt = input.resolution === "snowball"
        ? bills.find(bill => bill.id === input.targetId && bill.is_debt)
        : undefined;
      if (input.resolution === "snowball" && (!snowballPayment || !snowballDebt)) {
        throw new Error("Snowball payment not found");
      }
      if (input.resolution === "manual" && !manualTarget) {
        throw new Error("Manual calendar transaction not found");
      }
      const allocation: ReviewAllocation = {
        type: input.resolution === "bill" ? "bill"
          : input.resolution === "income" ? "income"
          : input.resolution === "goal" || input.resolution === "decision" || input.resolution === "manual" ? "planned_expense"
          : input.resolution === "snowball" ? "extra_principal"
          : input.resolution,
        targetId: input.targetId,
        source: input.resolution === "manual" ? "transaction" : undefined,
        name: input.resolution === "snowball" ? snowballDebt?.name
          : input.resolution === "manual" ? manualTarget?.note || manualTarget?.category
          : undefined,
        category: input.resolution === "category" ? input.targetId : undefined,
        amount: Math.abs(transaction.amount),
        plannedAmount: input.plannedAmount,
        occurrenceDate: input.occurrenceDate,
        settlement: input.settlement ?? "regular",
      };
      if (manualTarget) {
        demoManualMatchTargets.current.set(input.transactionId, manualTarget);
        demoManualBankRestore.current.set(input.transactionId, {
          note: transaction.note,
          debt_applied_amount: transaction.debt_applied_amount,
          debt_applied_bill_id: transaction.debt_applied_bill_id,
          user_edited_at: transaction.user_edited_at,
        });
      }
      setTransactions(previous => previous
        .filter(item => input.resolution !== "manual" || item.id !== input.targetId)
        .map(item => item.id === input.transactionId ? {
        ...item,
        category: input.resolution === "category" ? input.targetId ?? item.category
          : input.resolution === "transfer" ? "Transfer"
          : input.resolution === "income" ? "Income"
          : input.resolution === "manual" ? manualTarget?.category ?? item.category
          : item.category,
        note: input.resolution === "manual" && manualTarget?.note?.trim()
          ? manualTarget.note
          : item.note,
        debt_applied_amount: input.resolution === "manual"
          ? manualTarget?.debt_applied_amount
          : item.debt_applied_amount,
        debt_applied_bill_id: input.resolution === "manual"
          ? manualTarget?.debt_applied_bill_id
          : item.debt_applied_bill_id,
        linked_bill_id: input.resolution === "bill" ? input.targetId : undefined,
        linked_income_id: input.resolution === "income" ? input.targetId : undefined,
        linked_plan_id: input.resolution === "goal" || input.resolution === "decision" ? input.targetId
          : input.resolution === "snowball" ? snowballPayment?.id
          : input.resolution === "manual" ? manualTarget?.id
          : undefined,
        linked_plan_type: input.resolution === "manual" ? "transaction"
          : input.resolution === "goal" || input.resolution === "decision" || input.resolution === "snowball" ? input.resolution
          : undefined,
        matched_occurrence_date: input.occurrenceDate,
        match_confidence: input.resolution === "category" || input.resolution === "transfer" ? undefined : 1,
        match_reason: input.resolution === "bill" ? "confirmed_bill_match"
          : input.resolution === "income" ? "confirmed_income_match"
          : input.resolution === "goal" || input.resolution === "decision" ? "confirmed_plan_match"
          : input.resolution === "snowball" ? "confirmed_snowball_match"
          : input.resolution === "manual" ? "confirmed_manual_match"
          : undefined,
        review_status: input.resolution === "category" ? "categorized" : input.resolution === "transfer" ? "transfer" : "matched",
        review_resolution: input.resolution,
        review_allocations: [allocation],
        reviewed_at: new Date().toISOString(),
        user_edited_at: input.resolution === "manual" ? new Date().toISOString() : item.user_edited_at,
      } : item));
      if (input.resolution === "snowball" && snowballDebt) {
        setBills(previous => reorderDebtPriorities(previous.map(bill =>
          bill.id === snowballDebt.id
            ? { ...bill, balance: roundMoney(Math.max(0, bill.balance - Math.abs(transaction.amount))) }
            : bill)));
      }
      return;
    }

    const saveOperationId = markSaveStarted();
    try {
      const result = input.resolution === "snowball"
        ? await supabase.rpc("reconcile_snowball_transaction", {
          p_transaction_id: input.transactionId,
          p_debt_id: input.targetId ?? null,
          p_occurrence_date: input.occurrenceDate ?? null,
          p_planned_amount: input.plannedAmount ?? null,
          p_settlement: input.settlement ?? null,
          p_extra_category: input.extraCategory ?? null,
        })
        : input.resolution === "manual"
        ? await supabase.rpc("reconcile_manual_transaction", {
          p_transaction_id: input.transactionId,
          p_manual_transaction_id: input.targetId ?? null,
          p_occurrence_date: input.occurrenceDate ?? null,
          p_planned_amount: input.plannedAmount ?? null,
          p_settlement: input.settlement ?? null,
        })
        : await supabase.rpc("reconcile_transaction", {
          p_transaction_id: input.transactionId,
          p_resolution: input.resolution,
          p_target_id: input.targetId ?? null,
          p_occurrence_date: input.occurrenceDate ?? null,
          p_planned_amount: input.plannedAmount ?? null,
          p_settlement: input.settlement ?? null,
          p_extra_category: input.extraCategory ?? null,
        });
      if (result.error) {
        let recovered = false;
        if (isAlreadyReviewedError(result.error)) {
          // Snowball/manual RPCs can commit before a response is interrupted.
          // Verify the stored decision is exactly the requested decision; a
          // conflicting second review must still fail visibly.
          const stored = await applyHouseholdSelect(supabase.from("transactions").select("*"), user.id)
            .eq("id", input.transactionId)
            .maybeSingle();
          if (stored.error) throw new Error(`Verify reviewed transaction: ${stored.error.message}`);
          if (stored.data) {
            const savedTransaction = normalizeTransactionRow(stored.data);
            recovered = reconciledTransactionMatchesIntent(savedTransaction, input);
            if (recovered) {
              setTransactions(previous => previous.map(item => item.id === savedTransaction.id ? savedTransaction : item));
            }
          }
        }
        if (!recovered) throw new Error(`Review transaction: ${result.error.message}`);
      }
      await refreshBillMatchData();
      if (input.resolution === "snowball") {
        await refreshDebtRows();
      } else if (input.resolution === "bill" && bills.some(bill => bill.id === input.targetId && bill.is_debt)) {
        await syncDebtTransactionsAndRefresh();
      }
      setPendingPlanMatches(previous => previous.filter(match => match.posted_transaction_id !== input.transactionId));
      markSaveCompleted(saveOperationId);
    } catch (error) {
      markSaveFailed(error, () => reconcileTransaction(input), saveOperationId);
      throw error;
    }
  }, [user, assertCanEditHousehold, transactions, incomes, bills, extraPayments, demoMode, applyHouseholdSelect, refreshBillMatchData, refreshDebtRows, syncDebtTransactionsAndRefresh, markSaveStarted, markSaveCompleted, markSaveFailed]);

  const createSpendingBucketForTransaction = useCallback(async (
    input: CreateSpendingBucketForTransactionInput,
  ): Promise<CreateSpendingBucketForTransactionResult> => {
    if (!user) throw new Error("Sign in to create a spending bucket");
    assertCanEditHousehold("create a spending bucket");
    const transaction = transactions.find(item => item.id === input.transactionId);
    if (!transaction
      || transaction.source !== "plaid"
      || transaction.pending
      || transaction.removed_at
      || transaction.deleted_at) {
      throw new Error("Posted bank transaction was not found.");
    }
    if (transaction.amount >= 0) throw new Error("Only money-out transactions can create a spending bucket.");
    const retryingMatchedGoal = transaction.review_status === "matched"
      && transaction.review_resolution === "goal"
      && transaction.linked_plan_type === "goal"
      && Boolean(transaction.linked_plan_id);
    if (transaction.review_status !== "needs_review" && !retryingMatchedGoal) {
      throw new Error("This transaction has already been reviewed.");
    }

    const valid = validateCreateSpendingBucketMatch({
      name: input.name,
      targetAmount: input.targetAmount,
      targetDate: input.targetDate,
      transactionAmount: transaction.amount,
    });
    if (demoMode && retryingMatchedGoal) {
      const existingGoal = goals.find(item => item.id === transaction.linked_plan_id);
      const existingAllocation = transaction.review_allocations?.find(allocation =>
        allocation.type === "planned_expense" && allocation.targetId === existingGoal?.id
      );
      if (existingGoal
        && existingGoal.goal_type === "planned_expense"
        && existingGoal.name.trim() === valid.name
        && Math.abs(existingGoal.target_amount - valid.targetAmount) < 0.005
        && existingGoal.target_date === valid.targetDate
        && existingAllocation
        && Math.abs(existingAllocation.amount - valid.transactionAmount) < 0.005
        && existingAllocation.settlement === valid.settlement) {
        return {
          goalId: existingGoal.id,
          settlement: valid.settlement,
          appliedAmount: valid.transactionAmount,
          remainingAmount: Math.max(0, existingGoal.target_amount - existingGoal.current_amount),
        };
      }
      throw new Error("This transaction has already been reviewed with different details.");
    }
    const goalId = genId();
    const now = new Date().toISOString();
    const goal: Goal = {
      id: goalId,
      name: valid.name,
      target_amount: valid.targetAmount,
      target_date: valid.targetDate,
      current_amount: valid.transactionAmount,
      created_at: now,
      goal_type: "planned_expense",
    };
    const allocation: ReviewAllocation = {
      type: "planned_expense",
      source: "goal",
      targetId: goalId,
      name: valid.name,
      amount: valid.transactionAmount,
      plannedAmount: valid.targetAmount,
      occurrenceDate: valid.targetDate,
      settlement: valid.settlement,
    };
    const matchedTransaction: Transaction = {
      ...transaction,
      linked_bill_id: undefined,
      linked_income_id: undefined,
      linked_plan_id: goalId,
      linked_plan_type: "goal",
      matched_occurrence_date: valid.targetDate,
      match_confidence: 1,
      match_reason: "confirmed_plan_match",
      review_status: "matched",
      review_resolution: "goal",
      review_allocations: [allocation],
      reviewed_at: now,
      reviewed_by: user.id,
    };
    const result: CreateSpendingBucketForTransactionResult = {
      goalId,
      settlement: valid.settlement,
      appliedAmount: valid.transactionAmount,
      remainingAmount: Math.max(0, valid.targetAmount - valid.transactionAmount),
    };

    if (demoMode) {
      // Both state changes are derived and validated before either is applied,
      // mirroring the all-or-nothing database RPC without an orphan bucket.
      setGoals(previous => [...previous, goal]);
      setTransactions(previous => previous.map(item => item.id === transaction.id ? matchedTransaction : item));
      setPendingPlanMatches(previous => previous.filter(match => match.posted_transaction_id !== transaction.id));
      return result;
    }

    const saveOperationId = markSaveStarted();
    try {
      const rpcResult = await supabase.rpc("create_spending_bucket_for_transaction", {
        p_transaction_id: transaction.id,
        p_goal_id: goalId,
        p_name: valid.name,
        p_target_amount: valid.targetAmount,
        p_target_date: valid.targetDate,
      });
      if (rpcResult.error) throw new Error(`Create spending bucket: ${rpcResult.error.message}`);
      const rpcPayload = rpcResult.data && typeof rpcResult.data === "object"
        ? rpcResult.data as { goal_id?: unknown; goal?: Record<string, unknown> }
        : undefined;
      const serverGoalId = typeof rpcPayload?.goal_id === "string" && rpcPayload.goal_id
        ? rpcPayload.goal_id
        : undefined;
      if (!serverGoalId) throw new Error("Create spending bucket: the saved bucket id was not returned");
      const returnedGoal = rpcPayload?.goal;
      const authoritativeGoal: Goal = returnedGoal ? {
        ...goal,
        ...returnedGoal,
        id: serverGoalId,
        name: String(returnedGoal.name ?? goal.name),
        target_amount: Number(returnedGoal.target_amount ?? goal.target_amount),
        target_date: String(returnedGoal.target_date ?? goal.target_date),
        current_amount: Number(returnedGoal.current_amount ?? goal.current_amount),
        created_at: String(returnedGoal.created_at ?? goal.created_at),
        goal_type: "planned_expense",
      } : { ...goal, id: serverGoalId };
      const authoritativeAllocation = { ...allocation, targetId: serverGoalId };
      const authoritativeMatchedTransaction = {
        ...matchedTransaction,
        linked_plan_id: serverGoalId,
        review_allocations: [authoritativeAllocation],
      };
      const authoritativeResult: CreateSpendingBucketForTransactionResult = {
        ...result,
        goalId: serverGoalId,
        remainingAmount: Math.max(0, authoritativeGoal.target_amount - authoritativeGoal.current_amount),
      };

      try {
        await refreshBillMatchData();
      } catch (refreshError) {
        // The atomic RPC has already committed. Keep the successful action
        // visible locally instead of inviting a duplicate retry.
        setGoals(previous => [
          ...previous.filter(item => item.id !== goalId && item.id !== serverGoalId),
          authoritativeGoal,
        ]);
        setTransactions(previous => previous.map(item => item.id === transaction.id ? authoritativeMatchedTransaction : item));
        console.warn("Spending bucket saved; plan refresh will retry", diagnosticErrorCode(refreshError));
        void recordDiagnostic(user.id, {
          eventType: "save_failure", operation: "reconciliation", platform: diagnosticPlatform(),
          errorCode: diagnosticErrorCode(refreshError),
        }).catch(() => undefined);
      }
      setPendingPlanMatches(previous => previous.filter(match => match.posted_transaction_id !== transaction.id));
      markSaveCompleted(saveOperationId);
      return authoritativeResult;
    } catch (error) {
      markSaveFailed(error, () => createSpendingBucketForTransaction(input).then(() => undefined), saveOperationId);
      throw error;
    }
  }, [user, assertCanEditHousehold, transactions, goals, demoMode, markSaveStarted, refreshBillMatchData, markSaveCompleted, markSaveFailed]);

  const undoTransactionReconciliation = useCallback(async (transactionId: string) => {
    if (!user) throw new Error("Sign in to undo this review");
    assertCanEditHousehold("undo a transaction review");
    const reviewedTransaction = transactions.find(item => item.id === transactionId);
    const wasDebtMatch = Boolean(reviewedTransaction?.linked_bill_id && bills.some(bill => bill.id === reviewedTransaction.linked_bill_id && bill.is_debt));
    const wasSnowballMatch = reviewedTransaction?.review_resolution === "snowball";
    const wasManualMatch = reviewedTransaction?.review_resolution === "manual";
    if (demoMode) {
      if (wasSnowballMatch) {
        const restoredByDebt = new Map<string, number>();
        reviewedTransaction?.review_allocations?.forEach(allocation => {
          if (allocation.type !== "extra_principal" || !allocation.targetId) return;
          restoredByDebt.set(
            allocation.targetId,
            roundMoney((restoredByDebt.get(allocation.targetId) ?? 0) + Math.max(0, allocation.amount)),
          );
        });
        setBills(previous => reorderDebtPriorities(previous.map(bill => {
          const restored = restoredByDebt.get(bill.id);
          return restored ? { ...bill, balance: roundMoney(bill.balance + restored) } : bill;
        })));
      }
      const restoredManualTarget = wasManualMatch ? demoManualMatchTargets.current.get(transactionId) : undefined;
      const restoredBank = wasManualMatch ? demoManualBankRestore.current.get(transactionId) : undefined;
      setTransactions(previous => {
        const restored = restoredManualTarget && !previous.some(item => item.id === restoredManualTarget.id)
          ? [...previous, restoredManualTarget]
          : previous;
        return restored.map(item => item.id === transactionId ? {
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
        note: restoredBank?.note ?? item.note,
        debt_applied_amount: wasManualMatch ? restoredBank?.debt_applied_amount : item.debt_applied_amount,
        debt_applied_bill_id: wasManualMatch ? restoredBank?.debt_applied_bill_id : item.debt_applied_bill_id,
        user_edited_at: wasManualMatch ? restoredBank?.user_edited_at : item.user_edited_at,
        } : item);
      });
      if (wasManualMatch) {
        demoManualMatchTargets.current.delete(transactionId);
        demoManualBankRestore.current.delete(transactionId);
      }
      return;
    }
    const saveOperationId = markSaveStarted();
    try {
      const result = await supabase.rpc(
        wasManualMatch ? "undo_manual_transaction_reconciliation" : "undo_transaction_reconciliation",
        { p_transaction_id: transactionId },
      );
      if (result.error) throw new Error(`Undo review: ${result.error.message}`);
      await refreshBillMatchData();
      if (wasSnowballMatch) await refreshDebtRows();
      else if (wasDebtMatch) await syncDebtTransactionsAndRefresh();
      markSaveCompleted(saveOperationId);
    } catch (error) {
      markSaveFailed(error, () => undoTransactionReconciliation(transactionId), saveOperationId);
      throw error;
    }
  }, [user, assertCanEditHousehold, transactions, bills, demoMode, refreshBillMatchData, refreshDebtRows, syncDebtTransactionsAndRefresh, markSaveStarted, markSaveCompleted, markSaveFailed]);

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
    const itemsToDelete = transactions.filter(transaction => idsToDelete.includes(transaction.id));
    if (itemsToDelete.some(transaction => transaction.debt_applied_bill_id || Number(transaction.debt_applied_amount ?? 0) > 0.005)) {
      throw new Error("Unmatch the debt payment before deleting this transfer so its balance stays correct.");
    }
    const deletedAt = new Date().toISOString();
    if (demoMode) {
      const archived = transactions
        .filter(transaction => idsToDelete.includes(transaction.id))
        .map(transaction => ({ ...transaction, deleted_at: deletedAt, deleted_by: user.id }));
      setTransactions(prev => prev.filter(transaction => !idsToDelete.includes(transaction.id)));
      setDeletedTransactions(prev => [...archived, ...prev.filter(transaction => !idsToDelete.includes(transaction.id))]);
      return;
    }
    const persist: () => Promise<void> = () => runTrackedFinancialMutation(async () => {
      const authoritativeResult = await supabase
        .from("transactions")
        .select("*")
        .eq("transfer_group_id", transferGroupId);
      if (authoritativeResult.error) throw new Error(`Verify transfer: ${authoritativeResult.error.message}`);
      const authoritative = (authoritativeResult.data ?? []).map(normalizeTransactionRow);
      const authoritativeIds = new Set(authoritative.map(transaction => transaction.id));
      if (authoritative.length !== idsToDelete.length || idsToDelete.some(transactionId => !authoritativeIds.has(transactionId))) {
        throw new Error("This transfer changed on another device. Refresh before deleting it.");
      }
      if (authoritative.some(transaction => transaction.debt_applied_bill_id || Number(transaction.debt_applied_amount ?? 0) > 0.005)) {
        throw new Error("Unmatch the debt payment before deleting this transfer so its balance stays correct.");
      }
      const { data, error } = await supabase
        .from("transactions")
        .update({
          deleted_at: deletedAt,
          deleted_by: user.id,
        })
        .eq("transfer_group_id", transferGroupId)
        .in("id", idsToDelete)
        .is("debt_applied_bill_id", null)
        .lte("debt_applied_amount", 0.005)
        .select("*");
      if (error) throw new Error(`Delete transfer: ${error.message}`);
      const archived = (data ?? []).map(normalizeTransactionRow);
      const archivedIds = new Set(archived.map(transaction => transaction.id));
      if (archived.length !== idsToDelete.length || idsToDelete.some(transactionId => !archivedIds.has(transactionId))) {
        throw new Error("Delete transfer did not save every transaction. Try again.");
      }
      setTransactions(prev => prev.filter(t => !idsToDelete.includes(t.id)));
      setDeletedTransactions(prev => [...archived, ...prev.filter(transaction => !idsToDelete.includes(transaction.id))]);
    }, persist);
    await persist();
  }, [user, transactions, demoMode, assertCanEditHousehold, runTrackedFinancialMutation]);

  const deleteTransaction = useCallback(async (id: string) => {
    if (!user) return;
    assertCanEditHousehold("delete a transaction");
    const existing = transactions.find(transaction => transaction.id === id);
    const groupId = existing?.transfer_group_id;
    if (groupId) {
      await deleteTransfer(groupId);
      return;
    }
    const deletedAt = new Date().toISOString();
    if (demoMode) {
      if (existing) {
        const archived = { ...existing, deleted_at: deletedAt, deleted_by: user.id };
        setDeletedTransactions(prev => [archived, ...prev.filter(transaction => transaction.id !== id)]);
      }
      setTransactions(prev => prev.filter(t => t.id !== id));
      return;
    }
    const shouldUndoReview = Boolean(existing && (existing.review_status === "matched" || isConfirmedBillMatch(existing)));
    const wasManualMatch = existing?.review_resolution === "manual";
    const wasSnowballMatch = existing?.review_resolution === "snowball";
    const wasDebtMatch = Boolean(existing?.linked_bill_id && bills.some(bill => bill.id === existing.linked_bill_id && bill.is_debt));
    const persist: () => Promise<void> = () => runTrackedFinancialMutation(async () => {
      if (shouldUndoReview) {
        const undoResult = await supabase.rpc(
          wasManualMatch ? "undo_manual_transaction_reconciliation" : "undo_transaction_reconciliation",
          { p_transaction_id: id },
        );
        if (undoResult.error) {
          const currentResult = await supabase.from("transactions").select("*").eq("id", id).maybeSingle();
          if (currentResult.error) throw new Error(`Verify transaction review: ${currentResult.error.message}`);
          const current = currentResult.data ? normalizeTransactionRow(currentResult.data) : undefined;
          if (!current || current.review_status === "matched" || isConfirmedBillMatch(current)) {
            throw new Error(`Undo review: ${undoResult.error.message}`);
          }
        }
      }
      const currentResult = await supabase.from("transactions").select("*").eq("id", id).maybeSingle();
      if (currentResult.error) throw new Error(`Verify transaction: ${currentResult.error.message}`);
      if (!currentResult.data) throw new Error("Transaction no longer exists.");
      const current = normalizeTransactionRow(currentResult.data);
      if (current.debt_applied_bill_id || Number(current.debt_applied_amount ?? 0) > 0.005) {
        throw new Error("Unmatch this debt payment before deleting it so the debt balance stays correct.");
      }
      const { data, error } = await supabase
        .from("transactions")
        .update({
          deleted_at: deletedAt,
          deleted_by: user.id,
        })
        .eq("id", id)
        .is("debt_applied_bill_id", null)
        .lte("debt_applied_amount", 0.005)
        .select("*")
        .single();
      if (error) throw new Error(`Delete transaction: ${error.message}`);
      const archived = normalizeTransactionRow(data);
      if (!archived.deleted_at) throw new Error("Delete transaction was not saved. Try again.");
      if (shouldUndoReview) {
        await refreshBillMatchData();
        if (wasSnowballMatch) await refreshDebtRows();
        else if (wasDebtMatch) await syncDebtTransactionsAndRefresh();
      }
      setTransactions(prev => prev.filter(t => t.id !== id));
      setDeletedTransactions(prev => [archived, ...prev.filter(transaction => transaction.id !== id)]);
    }, persist);
    await persist();
  }, [user, transactions, bills, demoMode, deleteTransfer, assertCanEditHousehold, runTrackedFinancialMutation, refreshBillMatchData, refreshDebtRows, syncDebtTransactionsAndRefresh]);

  const restoreDeletedTransaction = useCallback(async (id: string) => {
    if (!user) throw new Error("Sign in to restore a transaction");
    assertCanEditHousehold("restore a deleted transaction");
    const archived = deletedTransactions.find(transaction => transaction.id === id);
    if (!archived) throw new Error("Deleted transaction not found");
    const idsToRestore = archived.transfer_group_id
      ? deletedTransactions.filter(transaction => transaction.transfer_group_id === archived.transfer_group_id).map(transaction => transaction.id)
      : [id];
    const archivedItems = deletedTransactions.filter(transaction => idsToRestore.includes(transaction.id));
    if (archivedItems.some(transaction => transaction.debt_applied_bill_id || Number(transaction.debt_applied_amount ?? 0) > 0.005)) {
      throw new Error("This debt payment needs balance recovery before it can be restored.");
    }

    if (demoMode) {
      const restored = deletedTransactions
        .filter(transaction => idsToRestore.includes(transaction.id))
        .map(transaction => ({ ...transaction, deleted_at: undefined, deleted_by: undefined }));
      setDeletedTransactions(prev => prev.filter(transaction => !idsToRestore.includes(transaction.id)));
      setTransactions(prev => [...prev, ...restored.filter(isActiveTransaction)]);
      return;
    }

    const persist: () => Promise<void> = () => runTrackedFinancialMutation(async () => {
      const authoritativeResult = await supabase
        .from("transactions")
        .select("*")
        .in("id", idsToRestore);
      if (authoritativeResult.error) throw new Error(`Verify transaction restore: ${authoritativeResult.error.message}`);
      const authoritative = (authoritativeResult.data ?? []).map(normalizeTransactionRow);
      const restoreState = classifyTransactionRestoreState(authoritative, idsToRestore);
      if (restoreState === "conflict") {
        throw new Error("Deleted transactions changed on another device. Refresh before restoring them.");
      }
      if (authoritative.some(transaction => transaction.debt_applied_bill_id
        || Number(transaction.debt_applied_amount ?? 0) > 0.005)) {
        throw new Error("This debt payment needs balance recovery before it can be restored.");
      }
      let restored = authoritative;
      if (restoreState === "needs_restore") {
        const query = supabase
          .from("transactions")
          .update({ deleted_at: null, deleted_by: null })
          .in("id", idsToRestore)
          .is("debt_applied_bill_id", null)
          .lte("debt_applied_amount", 0.005);
        const { data, error } = await query.select("*");
        if (error) throw new Error(`Restore transaction: ${error.message}`);
        restored = (data ?? []).map(normalizeTransactionRow);
        const restoredIds = new Set(restored.map(transaction => transaction.id));
        if (restored.length !== idsToRestore.length || idsToRestore.some(transactionId => !restoredIds.has(transactionId))) {
          throw new Error("Restore did not save every transaction. Try again.");
        }
      }
      if (restored.some(transaction => transaction.linked_bill_id)) await syncDebtTransactionsAndRefresh();
      setDeletedTransactions(prev => prev.filter(transaction => !idsToRestore.includes(transaction.id)));
      setTransactions(prev => [
        ...prev.filter(transaction => !idsToRestore.includes(transaction.id)),
        ...restored.filter(isActiveTransaction),
      ]);
    }, persist);
    await persist();
  }, [user, deletedTransactions, demoMode, assertCanEditHousehold, runTrackedFinancialMutation, syncDebtTransactionsAndRefresh]);

  const transactionsByMonth = useMemo(
    () => indexRecordsByMonth(transactions),
    [transactions],
  );
  const getTransactionsForMonth = useCallback(
    (month: number, year: number) =>
      transactionsByMonth.get(
        `${year}-${String(month + 1).padStart(2, "0")}`,
      ) ?? [],
    [transactionsByMonth]
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
    const persist: () => Promise<string> = () => runTrackedFinancialMutation(async () => {
      await ensureSaved(
        supabase.from("incomes").upsert(scopedPayload({ ...ni, amount_history: ni.amount_history ?? [], user_id: user.id }), { onConflict: "id" }),
        "Add income",
      );
      setIncomes(prev => [...prev.filter(income => income.id !== ni.id), ni]);
      return ni.id;
    }, persist);
    return persist();
  }, [user, demoMode, scopedPayload, assertCanEditHousehold, runTrackedFinancialMutation]);

  const updateIncome = useCallback(async (item: IncomeItem) => {
    if (!user) return;
    assertCanEditHousehold("update income");
    const existing = incomes.find(income => income.id === item.id);
    const reviewedItem = { ...item, last_reviewed_at: new Date().toISOString() };
    setIncomes(prev => prev.map(i => i.id === item.id ? reviewedItem : i));
    if (demoMode) return;
    const saveOperationId = markSaveStarted();
    try {
    await ensureSaved(supabase.from("incomes").update({ ...reviewedItem, amount_history: item.amount_history ?? [] }).eq("id", item.id).select("id").single(), "Update income");
      markSaveCompleted(saveOperationId);
    } catch (error) {
      if (existing) setIncomes(prev => prev.map(income => income.id === existing.id && income === reviewedItem ? existing : income));
      markSaveFailed(error, () => updateIncome(item), saveOperationId);
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
    const persist: () => Promise<void> = () => runTrackedFinancialMutation(async () => {
      await deleteRowIdempotently("incomes", id, "Delete income");
      setIncomes(prev => prev.filter(i => i.id !== id));
    }, persist);
    await persist();
  }, [user, demoMode, assertCanEditHousehold, deleteRowIdempotently, runTrackedFinancialMutation]);

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
    const persist: () => Promise<string> = () => runTrackedFinancialMutation(async () => {
      await ensureSaved(
        supabase.from("goals").upsert(scopedPayload({ ...ng, user_id: user.id }), { onConflict: "id" }),
        "Add goal",
      );
      setGoals(prev => [...prev.filter(item => item.id !== ng.id), ng]);
      return ng.id;
    }, persist);
    return persist();
  }, [user, demoMode, scopedPayload, assertCanEditHousehold, runTrackedFinancialMutation]);

  const updateGoal = useCallback(async (goal: Goal) => {
    if (!user) return;
    assertCanEditHousehold("update a goal");
    const existing = goals.find(item => item.id === goal.id);
    setGoals(prev => prev.map(g => g.id === goal.id ? goal : g));
    if (demoMode) return;
    const saveOperationId = markSaveStarted();
    try {
    await ensureSaved(supabase.from("goals").update({ ...goal }).eq("id", goal.id).select("id").single(), "Update goal");
      markSaveCompleted(saveOperationId);
    } catch (error) {
      if (existing) setGoals(prev => prev.map(item => item.id === existing.id && item === goal ? existing : item));
      markSaveFailed(error, () => updateGoal(goal), saveOperationId);
      throw error;
    }
  }, [user, goals, demoMode, markSaveStarted, markSaveCompleted, markSaveFailed, assertCanEditHousehold]);

  const refreshBucketRoutingData = useCallback(async () => {
    if (!user || demoMode) return;
    const [goalRows, paymentRows] = await Promise.all([
      applyHouseholdSelect(supabase.from("goals").select("*"), user.id),
      applyHouseholdSelect(supabase.from("extra_payments").select("*"), user.id),
    ]);
    if (goalRows.error) throw new Error(`Refresh spending buckets: ${goalRows.error.message}`);
    if (paymentRows.error) throw new Error(`Refresh Snowball funding: ${paymentRows.error.message}`);
    setGoals((goalRows.data ?? []).map(normalizeGoalRow));
    setExtraPayments((paymentRows.data ?? []).map(normalizeExtraPaymentRow).filter(isValidExtraPaymentPlan));
  }, [user, demoMode, applyHouseholdSelect]);

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
    if (demoMode) {
      setGoals(prev => prev.map(item => item.id === id ? closedGoal : item));
      return { spent, released };
    }
    const persist: () => Promise<{ spent: number; released: number }> = () => runTrackedFinancialMutation(async () => {
      const { error } = await supabase.rpc("close_spending_bucket_keep_available", {
        p_bucket_id: id,
        p_expected_spent: spent,
        p_expected_remainder: released,
      });
      if (error) throw new Error(`Close spending bucket: ${error.message}`);
      try {
        await refreshBucketRoutingData();
      } catch {
        setGoals(prev => prev.map(item => item.id === id ? closedGoal : item));
      }
      return { spent, released };
    }, persist);
    return persist();
  }, [user, goals, demoMode, assertCanEditHousehold, refreshBucketRoutingData, runTrackedFinancialMutation]);

  const closeSpendingBucketAndRouteRemainder = useCallback(async (input: CloseSpendingBucketRouteInput) => {
    if (!user) throw new Error("Sign in to route a spending bucket remainder");
    assertCanEditHousehold("route a spending bucket remainder");
    if (!settings.debtPayoffEnabled) throw new Error("Turn on Debt Payoff Plan before routing this remainder.");
    const goal = goals.find(item => item.id === input.bucketId);
    if (!goal || goal.goal_type !== "planned_expense") throw new Error("Spending bucket not found");
    const summary = spendingBucketSummary(goal);
    const expectedSpent = Math.round(input.expectedSpent * 100) / 100;
    const expectedRemainder = Math.round(input.expectedRemainder * 100) / 100;
    if (Math.abs(summary.spent - expectedSpent) >= 0.005 || Math.abs(summary.remaining - expectedRemainder) >= 0.005) {
      throw new Error("This spending bucket changed. Refresh and try again.");
    }
    if (expectedRemainder <= 0 || !isValidExtraPaymentPlan({ amount: input.preview.selectedExtra, allocations: input.preview.allocations })) {
      throw new Error("A positive bucket remainder and valid Snowball preview are required.");
    }
    const bucketSources = input.sources.filter(source => source.type === "bucket_remainder" && source.bucketId === input.bucketId);
    if (bucketSources.length !== 1 || Math.abs(bucketSources[0].amount - expectedRemainder) >= 0.005) {
      throw new Error("Snowball funding must include this bucket remainder exactly once.");
    }
    const [year, monthNumber] = input.preview.paymentDate.split("-").map(Number);
    const month = monthNumber - 1;
    const paymentId = input.existingPaymentId ?? genId();
    const payloadSources = markSnowballSourcesPending(input.sources);
    const closedAt = new Date().toISOString();
    const closedGoal = { ...goal, closed_at: closedAt, closed_by: user.id };

    if (demoMode) {
      if (extraPayments.some(payment => payment.sources?.some(source => source.type === "bucket_remainder" && source.bucketId === input.bucketId))) {
        throw new Error("This bucket remainder is already routed to Snowball.");
      }
      const nextPayment: ExtraPayment = {
        id: paymentId,
        month,
        year,
        amount: input.preview.selectedExtra,
        allocations: input.preview.allocations,
        payment_date: input.preview.paymentDate,
        sources: payloadSources,
      };
      setGoals(previous => previous.map(item => item.id === input.bucketId ? closedGoal : item));
      setExtraPayments(previous => upsertSnowballPlanById(previous, nextPayment));
      return { spent: expectedSpent, routed: expectedRemainder, paymentId };
    }

    const persist: () => Promise<CloseSpendingBucketRouteResult> = () => runTrackedFinancialMutation(async () => {
    const { data, error } = await supabase.rpc("close_spending_bucket_and_route_remainder", {
      p_bucket_id: input.bucketId,
      p_expected_spent: expectedSpent,
      p_expected_remainder: expectedRemainder,
      // Keep the proposed payment id stable across an interrupted retry.
      p_payment_id: paymentId,
      p_month: month,
      p_year: year,
      p_payment_date: input.preview.paymentDate,
      p_plan_amount: input.preview.selectedExtra,
      p_allocations: input.preview.allocations,
    });
    if (error) throw new Error(`Route spending bucket remainder: ${error.message}`);
    const rpcPayload = data && typeof data === "object"
      ? data as { payment_id?: unknown; payment?: Record<string, unknown> }
      : undefined;
    const serverPaymentId = typeof rpcPayload?.payment_id === "string" && rpcPayload.payment_id
      ? rpcPayload.payment_id
      : undefined;
    if (!serverPaymentId) throw new Error("Route spending bucket remainder: the saved Snowball payment id was not returned");
    const serverPayment = rpcPayload?.payment
      ? normalizeExtraPaymentRow({ ...rpcPayload.payment, id: serverPaymentId })
      : undefined;
    try {
      await refreshBucketRoutingData();
    } catch {
      setGoals(previous => previous.map(item => item.id === input.bucketId ? closedGoal : item));
      setExtraPayments(previous => upsertSnowballPlanById(previous, serverPayment ?? {
        id: serverPaymentId, month, year, amount: input.preview.selectedExtra,
        allocations: input.preview.allocations, payment_date: input.preview.paymentDate, sources: payloadSources,
      }));
    }
    return { spent: expectedSpent, routed: expectedRemainder, paymentId: serverPaymentId };
    }, persist);
    return persist();
  }, [user, goals, settings.debtPayoffEnabled, demoMode, extraPayments, assertCanEditHousehold, refreshBucketRoutingData, runTrackedFinancialMutation]);

  const reopenSpendingBucket = useCallback(async (id: string, remainingAllocations?: SnowballAllocation[]) => {
    if (!user) throw new Error("Sign in to reopen a spending bucket");
    assertCanEditHousehold("reopen a spending bucket");
    const goal = goals.find(item => item.id === id);
    if (!goal || goal.goal_type !== "planned_expense") throw new Error("Spending bucket not found");
    const expectedRemainder = spendingBucketSummary(goal).released;
    const routedPayment = extraPayments.find(payment => payment.sources?.some(source => source.type === "bucket_remainder" && source.bucketId === id));
    const routedPaymentWasReconciled = routedPayment ? transactions.some(transaction =>
      transaction.review_status === "matched"
      && transaction.review_resolution === "snowball"
      && transaction.linked_plan_id === routedPayment.id
      && transaction.matched_occurrence_date === routedPayment.payment_date
      && (transaction.review_allocations ?? []).some(allocation => allocation.type === "extra_principal" && allocation.amount > 0.005)
    ) : false;
    if (routedPaymentWasReconciled) {
      throw new Error("This bucket remainder has already been paid through Snowball and cannot be reopened.");
    }
    const remainingSources = removeBucketRemainderFundingSource(routedPayment?.sources, id) as SnowballFundingSource[];
    const remainingAmount = Math.round(remainingSources.reduce((sum, source) => sum + Math.max(0, Number(source.amount) || 0), 0) * 100) / 100;
    if (routedPayment && remainingAmount > 0) {
      const allocationAmount = Math.round((remainingAllocations ?? []).reduce((sum, allocation) => sum + Math.max(0, Number(allocation.payment) || 0), 0) * 100) / 100;
      if (Math.abs(allocationAmount - remainingAmount) >= 0.005) {
        throw new Error("Updated Snowball allocations are required before reopening this bucket.");
      }
    }
    const reopenedGoal = { ...goal, closed_at: undefined, closed_by: undefined };
    if (demoMode) {
      setGoals(prev => prev.map(item => item.id === id ? reopenedGoal : item));
      if (routedPayment) {
        setExtraPayments(previous => remainingAmount <= 0
          ? previous.filter(payment => payment.id !== routedPayment.id)
          : previous.map(payment => payment.id === routedPayment.id ? {
            ...payment,
            amount: remainingAmount,
            allocations: remainingAllocations ?? [],
            sources: remainingSources,
          } : payment));
      }
      return;
    }
    const persist: () => Promise<void> = () => runTrackedFinancialMutation(async () => {
      const { error } = await supabase.rpc("reopen_spending_bucket_and_unroute_remainder", {
        p_bucket_id: id,
        p_expected_remainder: expectedRemainder,
        p_allocations: remainingAmount > 0 ? remainingAllocations : null,
      });
      if (error) throw new Error(`Reopen spending bucket: ${error.message}`);
      try {
        await refreshBucketRoutingData();
      } catch {
        setGoals(prev => prev.map(item => item.id === id ? reopenedGoal : item));
        if (routedPayment) {
          setExtraPayments(previous => remainingAmount <= 0
            ? previous.filter(payment => payment.id !== routedPayment.id)
            : previous.map(payment => payment.id === routedPayment.id ? {
              ...payment, amount: remainingAmount, allocations: remainingAllocations ?? [], sources: remainingSources,
            } : payment));
        }
      }
    }, persist);
    await persist();
  }, [user, goals, extraPayments, transactions, demoMode, assertCanEditHousehold, refreshBucketRoutingData, runTrackedFinancialMutation]);

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
    const persist: () => Promise<void> = () => runTrackedFinancialMutation(async () => {
      try {
      await ensureSaved(
        supabase.from("goals").update({ archived_at: archivedAt, archived_by: user.id }).eq("id", id).select("id").single(),
        "Archive spending bucket",
      );
      } catch (error) {
        setGoals(previous => previous.map(item => item.id === id ? goal : item));
        throw error;
      }
    }, persist);
    await persist();
  }, [user, goals, demoMode, assertCanEditHousehold, runTrackedFinancialMutation]);

  const restoreArchivedSpendingBucket = useCallback(async (id: string) => {
    if (!user) throw new Error("Sign in to restore a spending bucket");
    assertCanEditHousehold("restore a spending bucket");
    const goal = goals.find(item => item.id === id);
    if (!goal || goal.goal_type !== "planned_expense") throw new Error("Spending bucket not found");
    const restoredGoal = { ...goal, archived_at: undefined, archived_by: undefined };
    setGoals(previous => previous.map(item => item.id === id ? restoredGoal : item));
    if (demoMode) return;
    const persist: () => Promise<void> = () => runTrackedFinancialMutation(async () => {
      try {
      await ensureSaved(
        supabase.from("goals").update({ archived_at: null, archived_by: null }).eq("id", id).select("id").single(),
        "Restore spending bucket",
      );
      } catch (error) {
        setGoals(previous => previous.map(item => item.id === id ? goal : item));
        throw error;
      }
    }, persist);
    await persist();
  }, [user, goals, demoMode, assertCanEditHousehold, runTrackedFinancialMutation]);

  const deleteGoal = useCallback(async (id: string) => {
    if (!user) return;
    assertCanEditHousehold("delete a goal");
    if (demoMode) {
      setGoals(prev => prev.filter(g => g.id !== id));
      return;
    }
    const persist: () => Promise<void> = () => runTrackedFinancialMutation(async () => {
      await deleteRowIdempotently("goals", id, "Delete goal");
      setGoals(prev => prev.filter(g => g.id !== id));
    }, persist);
    await persist();
  }, [user, demoMode, assertCanEditHousehold, deleteRowIdempotently, runTrackedFinancialMutation]);

  // ─── Cash Flow ────────────────────────────────────────────────────────────────

  const transactionLedger = useMemo(
    () => buildTransactionLedger(
      [...transactions, ...deletedTransactions],
      transactions,
      transactionAccountIdentities,
    ),
    [transactions, deletedTransactions, transactionAccountIdentities],
  );
  const forecastTransactionsByMonth = transactionLedger.cashTransactionsByMonth;
  const visibleCheckingTransactionsByDate =
    transactionLedger.visibleCheckingTransactionsByDate;
  const visibleTransactionIds = useMemo(
    () => new Set(transactionLedger.visibleTransactions.map(transaction => transaction.id)),
    [transactionLedger.visibleTransactions],
  );

  const buildCashFlow = useCallback((month: number, year: number): CashFlow => {
    const billMatches = matchedAllocationIndexes.bill;
    const incomeMatches = matchedAllocationIndexes.income;
    const snowballMatches = matchedAllocationIndexes.snowball;
    const monthlyIncome = incomes
      .filter(i => isIncomeActiveForMonth(i, month, year))
      .reduce((sum, income) => {
        const amount = getEffectiveIncomeAmount(income, month, year);
        return sum + getIncomeOccurrenceDays(income, month, year).reduce((occurrenceSum, day) => {
          const date = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const match = incomeMatches.get(occurrenceKey(income.id, date));
          const remaining = remainingPlannedAmount(amount, match);
          return occurrenceSum + remaining;
        }, 0);
      }, 0);
    const activeBills = getMonthlyBills(month, year).filter(isBillEligibleForUpcomingPlan);
    const debtPlan = getRemainingDebtPlanForMonth(month, year);
    const totalBillsDue = activeBills.reduce((sum, bill) => {
      if (bill.is_debt && debtPlan) return sum;
      const occurrences = getBillOccurrencesInMonth(bill, month, year);
      const amount = occurrences.length > 0 ? getBillMonthlyTotal(bill, month, year) / occurrences.length : 0;
      return sum + occurrences.reduce((occurrenceSum, day) => {
        const date = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        const match = billMatches.get(occurrenceKey(bill.id, date));
        const remaining = remainingPlannedAmount(amount, match);
        return occurrenceSum + remaining;
      }, 0);
    }, debtPlan?.plannedPayment ?? 0);
    const monthPrefix = `${year}-${String(month + 1).padStart(2, "0")}`;
    const totalPaid = matchedAllocationIndexes.paidBillAmountByMonth.get(monthPrefix) ?? 0;
    const monthTxs = forecastTransactionsByMonth.get(monthPrefix) ?? [];
    const netTransactions = monthTxs.reduce((s, t) => s + t.amount, 0);
    const snowballPayment = extraPayments.find(ep => ep.month === month && ep.year === year);
    const snowballPaymentDate = snowballPayment?.payment_date ?? `${year}-${String(month + 1).padStart(2, "0")}-01`;
    const snowballExtra = debtPlan ? 0 : snowballPayment?.allocations.reduce((sum, allocation) => sum + remainingSnowballAllocationAmount(
      allocation.payment,
      snowballMatches.get(occurrenceKey(allocation.billId, snowballPaymentDate)),
    ), 0) ?? 0;
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
  }, [incomes, transactions, forecastTransactionsByMonth, connectedBankAccounts, extraPayments, decisions, goals, matchedAllocationIndexes, getBillMonthlyTotal, getBillOccurrencesInMonth, getMonthlyBills, getRemainingDebtPlanForMonth]);

  const cashFlowComputationCache = useMemo(
    () => new Map<string, CashFlow>(),
    [buildCashFlow],
  );
  const getCashFlow = useCallback(
    (month: number, year: number): CashFlow => getOrComputeRevisionValue(
      cashFlowComputationCache,
      financialProjectionMonthCacheKey(
        safeLocalDateInTimeZone(new Date(), householdTimeZone),
        month,
        year,
      ),
      () => buildCashFlow(month, year),
    ),
    [buildCashFlow, cashFlowComputationCache, householdTimeZone],
  );

  // ─── Daily Balances ───────────────────────────────────────────────────────────

  const balanceComputationCache = useMemo(() => ({
    monthNet: new Map<string, number>(),
    carryover: new Map<string, number>(),
    bankAnchoredCarryover: new Set<string>(),
    daily: new Map<string, DailyBalance[]>(),
  }), [bills, transactions, deletedTransactions, incomes, goals, decisions, overrides, billDateMoves, extraPayments, connectedBankAccounts, householdTimeZone, accounts, getBillEffectiveMonthlyTotal, getRemainingDebtPlanForMonth, pendingBankTransactions, pendingPlanMatches, settings.starting_balance, settings.starting_balance_date, forecastTransactionsByMonth, transactionAccountIdentities, visibleCheckingTransactionsByDate, visibleTransactionIds]);

  const buildDailyBalances = useCallback((month: number, year: number): DailyBalance[] => {
    const projectionAsOfDate = safeLocalDateInTimeZone(
      new Date(),
      householdTimeZone,
    );
    const requestedDebtPlan = getRemainingDebtPlanForMonth(month, year);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const connectedBankAnchor = connectedCheckingObservedAnchor(connectedBankAccounts, householdTimeZone);
    const bankAnchor = connectedBankAnchor ?? operatingAccountAnchor(accounts.map(toAccountSnapshot));
    const computeMonthNet = (m: number, y: number, startExclusive?: string): number => {
      const key = financialProjectionMonthCacheKey(projectionAsOfDate, m, y);
      const cached = startExclusive ? undefined : balanceComputationCache.monthNet.get(key);
      if (cached !== undefined) return cached;
      const monthPrefix = `${y}-${String(m + 1).padStart(2, "0")}`;
      const planStartDate = settings.starting_balance_date;
      const includeDate = (date: string) =>
        (!planStartDate || !planStartDate.startsWith(monthPrefix) || date >= planStartDate)
        && (!startExclusive || date > startExclusive);
      const billMatches = matchedAllocationIndexes.bill;
      const incomeMatches = matchedAllocationIndexes.income;
      const snowballMatches = matchedAllocationIndexes.snowball;
      const inc = incomes.reduce((sum, income) => {
        const amount = getEffectiveIncomeAmount(income, m, y);
        return sum + getIncomeOccurrenceDays(income, m, y).reduce((occurrenceSum, day) => {
          const date = `${monthPrefix}-${String(day).padStart(2, "0")}`;
          if (!includeDate(date)) return occurrenceSum;
          const match = incomeMatches.get(occurrenceKey(income.id, date));
          return occurrenceSum + remainingPlannedAmount(amount, match);
        }, 0);
      }, 0);
      const debtPlan = getRemainingDebtPlanForMonth(m, y);
      const bil = bills.filter(b => (b.is_recurring || b.is_debt) && isBillEligibleForUpcomingPlan(b)).reduce((s, b) => {
        const occ = getBillOccurrencesInMonth(b, m, y);
        if (occ.length === 0) return s;
        const hasReviewedOccurrence = matchedAllocationIndexes.reviewedBillIdsByMonth
          .get(monthPrefix)?.has(b.id) ?? false;
        if (b.is_debt && debtPlan) return s;
        const total = hasReviewedOccurrence
          ? getBillMonthlyTotal(b, m, y)
          : getBillEffectiveMonthlyTotal(b, m, y);
        if (total <= 0.005) return s;
        const dates = occ.map(day => `${monthPrefix}-${String(day).padStart(2, "0")}`);
        const amountPerOccurrence = total / dates.length;
        return s + dates.filter(includeDate).reduce((occurrenceSum, date) => {
          const match = billMatches.get(occurrenceKey(b.id, date));
          return occurrenceSum + remainingPlannedAmount(amountPerOccurrence, match);
        }, 0);
      }, 0);
      const tx = (forecastTransactionsByMonth.get(monthPrefix) ?? [])
        .filter(t => includeDate(t.date))
        .reduce((s, t) => s + t.amount, 0);
      const goalDeductions = goals.reduce((s, g) => {
        if (g.goal_type !== "planned_expense") return s;
        if (!g.target_date) return s;
        const targetDate = parseGoalTargetDate(g.target_date);
        const date = targetDate ? `${targetDate.year}-${String(targetDate.month + 1).padStart(2, "0")}-${String(targetDate.day).padStart(2, "0")}` : "";
        if (targetDate?.year === y && targetDate.month === m && includeDate(date)) return s + getGoalRemainingAmount(g);
        return s;
      }, 0);
      const snowball = debtPlan
        ? debtPlan.allocations.filter(allocation => includeDate(allocation.date)).reduce((sum, allocation) => sum + allocation.amount, 0)
        : (() => {
          const monthlyExtra = extraPayments.find(ep => ep.month === m && ep.year === y);
          const monthlyExtraDate = monthlyExtra?.payment_date ?? `${monthPrefix}-01`;
          return monthlyExtra && includeDate(monthlyExtraDate)
            ? monthlyExtra.allocations.reduce((sum, allocation) => sum + remainingSnowballAllocationAmount(
              allocation.payment,
              snowballMatches.get(occurrenceKey(allocation.billId, monthlyExtraDate)),
            ), 0)
            : 0;
        })();
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
      const key = financialProjectionMonthCacheKey(
        projectionAsOfDate,
        toMonth,
        toYear,
      );
      const cached = balanceComputationCache.carryover.get(key);
      if (cached !== undefined) return cached;
      const previousMonth = toMonth === 0 ? 11 : toMonth - 1;
      const previousYear = toMonth === 0 ? toYear - 1 : toYear;
      const previousKey = financialProjectionMonthCacheKey(
        projectionAsOfDate,
        previousMonth,
        previousYear,
      );
      if (bankAnchor) {
        const [bankYear, bankMonth] = bankAnchor.date.split("-").map(Number);
        const bankMonthIndex = bankMonth - 1;
        if (toYear > bankYear || (toYear === bankYear && toMonth > bankMonthIndex)) {
          const previousOpening = balanceComputationCache.carryover.get(previousKey);
          if (
            previousOpening !== undefined
            && balanceComputationCache.bankAnchoredCarryover.has(previousKey)
          ) {
            const running = previousOpening
              + computeMonthNet(previousMonth, previousYear);
            balanceComputationCache.carryover.set(key, running);
            balanceComputationCache.bankAnchoredCarryover.add(key);
            return running;
          }
          let running = bankAnchor.balance + computeMonthNet(bankMonthIndex, bankYear, bankAnchor.date);
          let m = bankMonthIndex + 1;
          let y = bankYear;
          if (m > 11) { m = 0; y += 1; }
          balanceComputationCache.carryover.set(
            financialProjectionMonthCacheKey(projectionAsOfDate, m, y),
            running,
          );
          balanceComputationCache.bankAnchoredCarryover.add(
            financialProjectionMonthCacheKey(projectionAsOfDate, m, y),
          );
          while (!(y === toYear && m === toMonth)) {
            running += computeMonthNet(m, y);
            m += 1;
            if (m > 11) { m = 0; y += 1; }
            balanceComputationCache.carryover.set(
              financialProjectionMonthCacheKey(projectionAsOfDate, m, y),
              running,
            );
            balanceComputationCache.bankAnchoredCarryover.add(
              financialProjectionMonthCacheKey(projectionAsOfDate, m, y),
            );
          }
          balanceComputationCache.carryover.set(key, running);
          return running;
        }
      }
      const previousOpening = balanceComputationCache.carryover.get(previousKey);
      if (previousOpening !== undefined) {
        const running = previousOpening + computeMonthNet(previousMonth, previousYear);
        balanceComputationCache.carryover.set(key, running);
        return running;
      }
      let anchorM: number, anchorY: number;
      if (settings.starting_balance_date) {
        const [sbY, sbM] = settings.starting_balance_date.split("-").map(Number);
        anchorY = sbY; anchorM = sbM - 1;
      } else {
        const [asOfYear, asOfMonthNumber] = projectionAsOfDate.split("-").map(Number);
        anchorM = asOfMonthNumber - 2;
        anchorY = asOfYear;
        if (anchorM < 0) { anchorM = 11; anchorY -= 1; }
      }
      if (toYear < anchorY || (toYear === anchorY && toMonth < anchorM)) return 0;
      if (toYear === anchorY && toMonth === anchorM) {
        balanceComputationCache.carryover.set(key, settings.starting_balance);
        return settings.starting_balance;
      }
      let running = settings.starting_balance;
      let m = anchorM, y = anchorY;
      while (!(y === toYear && m === toMonth)) {
        running += computeMonthNet(m, y);
        m += 1; if (m > 11) { m = 0; y += 1; }
        balanceComputationCache.carryover.set(
          financialProjectionMonthCacheKey(projectionAsOfDate, m, y),
          running,
        );
      }
      balanceComputationCache.carryover.set(key, running);
      return running;
    };
    const carryover = computeCarryover(month, year);
    const financialEvents: FinancialEvent[] = [];
    const billMatches = matchedAllocationIndexes.bill;
    const incomeMatches = matchedAllocationIndexes.income;
    const snowballMatches = matchedAllocationIndexes.snowball;
    const incomeByDay: Record<number, number> = {};
    incomes.forEach(i => {
      const occ = getIncomeOccurrenceDays(i, month, year);
      const amt = getEffectiveIncomeAmount(i, month, year);
      occ.forEach(d => {
        const date = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        const match = incomeMatches.get(occurrenceKey(i.id, date));
        const scheduledAmount = remainingPlannedAmount(amt, match);
        if (scheduledAmount <= 0.005) return;
        incomeByDay[d] = (incomeByDay[d] ?? 0) + scheduledAmount;
        financialEvents.push({
          id: `income:${i.id}:${year}-${month + 1}-${d}`,
          sourceType: "income", sourceId: i.id,
          date,
          kind: "scheduled_income", amount: scheduledAmount, status: "scheduled", name: i.name,
          configuredOccurrenceAmount: amt,
          settledOccurrenceAmount: Math.abs(Number(match?.amount) || 0),
        });
      });
    });
    const monthTxs = forecastTransactionsByMonth.get(
      `${year}-${String(month + 1).padStart(2, "0")}`,
    ) ?? [];
    monthTxs.forEach(t => {
      const isBankActivity = t.source === "plaid" || t.source === "statement" || Boolean(t.import_hash);
      financialEvents.push({
        id: `transaction:${t.id}`, sourceType: "transaction", sourceId: t.id, date: t.date,
        kind: t.amount >= 0 ? "transaction_income" : "transaction_expense",
        amount: t.amount,
        status: !isBankActivity && t.amount > 0 && t.date >= projectionAsOfDate ? "scheduled" : "actual",
        name: t.note || t.category,
      });
    });
    const billsByDay: Record<number, number> = {};
    const debtPlan = requestedDebtPlan;
    bills.filter(b => (b.is_recurring || b.is_debt) && isBillEligibleForUpcomingPlan(b)).forEach(b => {
      let occ = getBillOccurrencesInMonth(b, month, year);
      if (occ.length === 0) return;
      const o = overrides.find(o => o.bill_id === b.id && o.month === month && o.year === year);
      const hasReviewedOccurrence = matchedAllocationIndexes.reviewedBillIdsByMonth
        .get(`${year}-${String(month + 1).padStart(2, "0")}`)?.has(b.id) ?? false;
      if (b.is_debt && debtPlan) return;
      const total = hasReviewedOccurrence
        ? getBillMonthlyTotal(b, month, year)
        : getBillEffectiveMonthlyTotal(b, month, year);
      if (total <= 0.005) return;
      if (o?.actual_amount !== undefined && !hasReviewedOccurrence) {
        const finalizedOccurrences = resolveFinalizedBillOccurrenceDays(occ, o.paid_date, month, year);
        const finalizedAmount = finalizedOccurrences.length > 0 ? total / finalizedOccurrences.length : 0;
        finalizedOccurrences.forEach(d => {
          const date = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
          const match = billMatches.get(occurrenceKey(b.id, date));
          const remaining = remainingPlannedAmount(finalizedAmount, match);
          if (remaining <= 0.005) return;
          billsByDay[d] = (billsByDay[d] ?? 0) + remaining;
          financialEvents.push({
            id: `bill:${b.id}:${year}-${month + 1}-${d}`, sourceType: "bill", sourceId: b.id,
            date,
            kind: "bill", amount: -remaining, status: match ? "planned" : "finalized", name: b.name,
            configuredOccurrenceAmount: finalizedAmount,
            settledOccurrenceAmount: Math.abs(Number(match?.amount) || 0),
          });
        });
        return;
      }
      const amt = occ.length > 0 ? total / occ.length : 0;
      occ.forEach(d => {
        const date = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        const match = billMatches.get(occurrenceKey(b.id, date));
        const remaining = remainingPlannedAmount(amt, match);
        if (remaining <= 0.005) return;
        billsByDay[d] = (billsByDay[d] ?? 0) + remaining;
        financialEvents.push({
          id: `bill:${b.id}:${year}-${month + 1}-${d}`, sourceType: "bill", sourceId: b.id,
          date,
          kind: "bill", amount: -remaining, status: "planned", name: b.name,
          configuredOccurrenceAmount: amt,
          settledOccurrenceAmount: Math.abs(Number(match?.amount) || 0),
        });
      });
    });
    const debtExtrasByDay: Record<number, number> = {};
    if (debtPlan) {
      const savedExtra = getExtraPayment(month, year);
      debtPlan.allocations.forEach(allocation => {
        const day = Number(allocation.date.split("-")[2]);
        if (!Number.isFinite(day) || day < 1 || day > daysInMonth || allocation.amount <= 0.005) return;
        debtExtrasByDay[day] = (debtExtrasByDay[day] ?? 0) + allocation.amount;
        const canonicalSourceId = allocation.sourceBillId ?? allocation.targetBillId;
        const sourceCommitment = allocation.kind === "extra" ? undefined : getDebtSourceCommitment(canonicalSourceId, allocation.date);
        financialEvents.push({
          id: allocation.id,
          sourceType: "extra_payment",
          sourceId: allocation.kind === "extra" ? savedExtra?.id ?? allocation.targetBillId : canonicalSourceId,
          date: allocation.date,
          kind: "debt_payment",
          amount: -allocation.amount,
          status: sourceCommitment?.state === "pending" ? "pending" : allocation.date > projectionAsOfDate ? "scheduled" : "planned",
          name: `${allocation.targetBillName} debt payment`,
          debtPlanSource: allocation.kind === "extra" ? "saved_extra" : "canonical",
          debtPlanAllocationKind: allocation.kind,
          debtTargetBillId: allocation.targetBillId,
        });
      });
    } else extraPayments.filter(ep => ep.month === month && ep.year === year).forEach(ep => {
      const paymentDate = ep.payment_date ?? `${year}-${String(month + 1).padStart(2, "0")}-01`;
      const day = Number(paymentDate.split("-")[2]);
      if (!Number.isFinite(day) || day < 1 || day > daysInMonth) return;
      const pending = hasPendingSnowballBalanceApply(ep) || paymentDate > projectionAsOfDate;
      const remainingAllocations = ep.allocations
        .map(allocation => ({
          ...allocation,
          remaining: remainingSnowballAllocationAmount(
            allocation.payment,
            snowballMatches.get(occurrenceKey(allocation.billId, paymentDate)),
          ),
        }))
        .filter(allocation => allocation.remaining > 0.005);
      const remainingAmount = remainingAllocations.reduce((sum, allocation) => sum + allocation.remaining, 0);
      if (remainingAmount <= 0.005) return;
      const targetNames = Array.from(new Set(remainingAllocations
        .map(allocation => allocation.billName || bills.find(bill => bill.id === allocation.billId)?.name)
        .filter(Boolean))).join(", ");
      debtExtrasByDay[day] = (debtExtrasByDay[day] ?? 0) + remainingAmount;
      financialEvents.push({
        id: `extra:${ep.id}:${year}-${month + 1}-${day}`, sourceType: "extra_payment", sourceId: ep.id,
        date: paymentDate,
        kind: "debt_payment", amount: -remainingAmount, status: pending ? "scheduled" : "applied", name: targetNames ? `${targetNames} debt payment` : "Snowball debt payment",
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
    // Bank anchoring may remove an unresolved plan dated before the bank's
    // latest balance so it does not reduce cash twice. Keep the canonical,
    // de-duplicated plan separately for calendar visibility: an overdue debt
    // remainder still belongs on its original date even when its cash impact
    // is excluded from the anchored projection.
    const displayEvents = suppressDebtBillPlanDuplicates(financialEvents);
    let balanceEvents = [...displayEvents];
    if (connectedBankAnchor?.date.startsWith(currentMonthPrefix)) {
      const settledTransactionEventIds = new Set(monthTxs
        .filter(transaction => transaction.source === "plaid" || transaction.source === "statement" || Boolean(transaction.import_hash))
        .map(transaction => `transaction:${transaction.id}`));
      const anchored = anchorForecastToBankBalance(
        balanceEvents,
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
      const adjustment = bankBalanceAdjustment(openingBalance, bankAnchor.balance, bankAnchor.date, balanceEvents);
      if (Math.abs(adjustment) >= 0.005) {
        balanceEvents.push({
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
    displayEvents.forEach(event => {
      if (event.sourceType === "transaction" && !visibleTransactionIds.has(event.sourceId)) return;
      const bucket = visibleEventsByDate.get(event.date);
      if (bucket) bucket.push(event);
      else visibleEventsByDate.set(event.date, [event]);
    });
    const result: DailyBalance[] = [];
    for (let day = 1; day <= daysInMonth; day++) {
      const dayDate = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const dayTxs = visibleCheckingTransactionsByDate.get(dayDate) ?? [];
      const scheduledIncome = incomeByDay[day] ?? 0;
      const txIncome     = dayTxs.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
      const incomeToday  = scheduledIncome + txIncome;
      const decisionNet = plannedDecisionByDay[day] ?? 0;
      const expenseToday = dayTxs.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0) + (debtExtrasByDay[day] ?? 0) + Math.max(0, -decisionNet);
      const billsToday   = billsByDay[day] ?? 0;
      const dayGoals     = goalsByDay[day] ?? [];
      const forecastDay = forecast.days[day - 1];
      const visibleEvents = visibleEventsByDate.get(forecastDay.date) ?? [];
      const projectedInflow = forecastDay.events.reduce((sum, event) => sum + Math.max(0, event.amount), 0);
      const projectedOutflow = forecastDay.events.reduce((sum, event) => sum + Math.max(0, -event.amount), 0);
      result.push({
        day, income: incomeToday, scheduledIncome, expense: expenseToday, bills: billsToday,
        goalExpenses: dayGoals, net: forecastDay.net, balance: forecastDay.balance,
        balanceSource: "projected",
        balanceDate: forecastDay.date,
        projectedInflow, projectedOutflow, events: visibleEvents,
        projectionEvents: forecastDay.events.map(event => ({ ...event })),
      });
    }
    return result;
  }, [bills, transactions, deletedTransactions, forecastTransactionsByMonth, transactionLedger, incomes, goals, decisions, overrides, billDateMoves, extraPayments, connectedBankAccounts, householdTimeZone, accounts, getBillEffectiveMonthlyTotal, getBillMonthlyTotal, getBillOccurrencesInMonth, getDebtSourceCommitment, getExtraPayment, getRemainingDebtPlanForMonth, matchedAllocationIndexes, pendingBankTransactions, pendingPlanMatches, settings.starting_balance, settings.starting_balance_date, balanceComputationCache, user, visibleCheckingTransactionsByDate, visibleTransactionIds]);

  const getDailyBalances = useCallback(
    (month: number, year: number): DailyBalance[] => getOrComputeRevisionValue(
      balanceComputationCache.daily,
      financialProjectionMonthCacheKey(
        safeLocalDateInTimeZone(new Date(), householdTimeZone),
        month,
        year,
      ),
      () => buildDailyBalances(month, year),
    ),
    [balanceComputationCache.daily, buildDailyBalances, householdTimeZone],
  );

  const getCalendarDailyBalances = useCallback((month: number, year: number): DailyBalance[] => {
    if (demoMode) return getDailyBalances(month, year);
    let householdLocalToday: string;
    try {
      householdLocalToday = localDateInTimeZone(new Date(), householdTimeZone);
    } catch {
      householdLocalToday = localDateInTimeZone(new Date(), "UTC");
    }
    const closeScopeKey = activeHousehold?.householdId && userId
      ? `${userId}:${activeHousehold.householdId}`
      : null;
    const closeScopeMatches = Boolean(
      closeScopeKey && dailyCheckingCloseLoad.scopeKey === closeScopeKey,
    );
    return overlayCompletedDailyCheckingCloses(
      getDailyBalances(month, year),
      month,
      year,
      closeScopeMatches ? dailyCheckingCloses : [],
      householdLocalToday,
      closeScopeMatches ? dailyCheckingCloseLoad.status : "loading",
    );
  }, [activeHousehold?.householdId, dailyCheckingCloseLoad, dailyCheckingCloses, demoMode, getDailyBalances, householdTimeZone, userId]);

  const forecastConfidence = useMemo(() => {
    const planningBills = bills.filter(bill => (bill.is_recurring || bill.is_debt) && isBillEligibleForUpcomingPlan(bill));
    const base = evaluateForecastConfidence(accounts.map(toAccountSnapshot), incomes.length > 0, planningBills.length > 0);
    const cutoff = Date.now() - 60 * 86_400_000;
    const staleRecurring = [...planningBills, ...incomes]
      .some(item => !item.last_reviewed_at || new Date(item.last_reviewed_at).getTime() < cutoff);
    if (!staleRecurring) return base;
    const reasons = [...base.reasons.filter(reason => reason !== "Accounts and recurring cash flow are current"), "Review recurring income and bills older than 60 days"];
    return { level: base.level === "high" ? "medium" : base.level, label: base.level === "high" ? "Medium" : base.label, reasons } as ForecastConfidence;
  }, [accounts, incomes, bills]);
  const checkGoalAffordability = useCallback(
    (goal: Goal, month: number, year: number): GoalAffordability => {
      // Use the same projected ledger as Forecast. Calendar-only actual-close
      // overlays are intentionally excluded because they do not project future
      // cash. The preview goal has not been saved yet, so apply it once here.
      const projectedSeries = getDailyBalances(month, year);
      const projectedBalance = projectedSeries.at(-1)?.balance ?? settings.starting_balance;
      const needed = getGoalRemainingAmount(goal);
      return goalAffordabilityFromProjectedBalance(projectedBalance, needed, settings.safety_floor);
    },
    [getDailyBalances, settings.safety_floor, settings.starting_balance],
  );

  const getPlanSimulationBaseline = useCallback((
    horizonMonths: PlanSimulationHorizon,
    startDate = localDateString(),
  ): PlanSimulationBaseline => buildCanonicalPlanSimulationBaseline({
    startDate,
    horizonMonths,
    getDailyBalances,
  }), [getDailyBalances]);

  const previewDebtSnowball = useCallback((month: number, year: number, requestedExtra?: number, additionalSafeCredit = 0, paymentDateOverride?: string, editingPaymentId?: string): SnowballProjectionResult => {
    const existing = extraPayments.find(ep => ep.month === month && ep.year === year && isValidExtraPaymentPlan(ep));
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
        minimum: requiredDebtPlanTotal(
          b,
          Math.max(1, getBillOccurrencesInMonth(b, month, year).length),
        ),
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
    const existingRolledPayment = snowballRolloverPlanTotal(
      bills.filter(bill => bill.is_debt),
    );
    const initialRolledPayment = current.payoffOrder.reduce((sum, name) => {
      const debt = debtInputs.find(item => item.name === name);
      return sum + Math.max(0, debt?.minimum ?? 0);
    }, existingRolledPayment);
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
    const scope = householdScopeRef.current;
    if (!scope) throw new Error("Choose a household before adding a category.");
    const persist: () => Promise<void> = () => runTrackedFinancialMutation(async () => {
      const result = await supabase.rpc("add_household_category", {
        p_household_id: scope.householdId,
        p_budget_id: scope.budgetId,
        p_name: trimmed,
      });
      if (result.error) throw new Error(`Add category: ${result.error.message}`);
      const saved = parseCategoryMutationResult(result.data, trimmed);
      setCategories(saved.categories);
    }, persist);
    await persist();
  }, [user, categories, demoMode, assertCanEditHousehold, runTrackedFinancialMutation]);

  const updateCategory = useCallback(async (oldName: string, newName: string) => {
    if (!user) return;
    assertCanEditHousehold("update a category");
    const trimmed = normalizeCategoryInput(newName);
    if (!trimmed || categoryMatches(trimmed, oldName)) return;
    const canonicalExisting = categories.find(category => !categoryMatches(category, oldName) && categoryMatches(category, trimmed));
    const targetName = canonicalExisting ?? trimmed;
    if (demoMode) {
      setCategories(prev => fallbackCategoryList(prev.map(c => categoryMatches(c, oldName) ? targetName : c)));
      setBills(prev => prev.map(b => categoryMatches(b.category, oldName) ? { ...b, category: targetName } : b));
      setTransactions(prev => prev.map(t => categoryMatches(t.category, oldName) ? { ...t, category: targetName } : t));
      return;
    }
    const scope = householdScopeRef.current;
    if (!scope) throw new Error("Choose a household before renaming a category.");
    const persist: () => Promise<void> = () => runTrackedFinancialMutation(async () => {
      const result = await supabase.rpc("rename_household_category", {
        p_household_id: scope.householdId,
        p_budget_id: scope.budgetId,
        p_old_name: oldName,
        p_new_name: targetName,
      });
      if (result.error) throw new Error(`Rename category: ${result.error.message}`);
      const saved = parseCategoryMutationResult(result.data, targetName);
      setCategories(saved.categories);
      setBills(prev => prev.map(b => categoryMatches(b.category, oldName) ? { ...b, category: saved.categoryName } : b));
      setTransactions(prev => prev.map(t => categoryMatches(t.category, oldName) ? { ...t, category: saved.categoryName } : t));
    }, persist);
    await persist();
  }, [user, categories, demoMode, assertCanEditHousehold, runTrackedFinancialMutation]);

  const deleteCategory = useCallback(async (name: string) => {
    if (!user) return;
    assertCanEditHousehold("delete a category");
    const cleanName = normalizeCategoryInput(name);
    if (!cleanName || categoryMatches(cleanName, "Other")) return;
    if (demoMode) {
      setCategories(prev => fallbackCategoryList(prev.filter(c => !categoryMatches(c, cleanName))));
      setBills(prev => prev.map(b => categoryMatches(b.category, cleanName) ? { ...b, category: "Other" } : b));
      setTransactions(prev => prev.map(t => categoryMatches(t.category, cleanName) ? { ...t, category: "Other" } : t));
      return;
    }
    const scope = householdScopeRef.current;
    if (!scope) throw new Error("Choose a household before deleting a category.");
    const persist: () => Promise<void> = () => runTrackedFinancialMutation(async () => {
      const result = await supabase.rpc("delete_household_category", {
        p_household_id: scope.householdId,
        p_budget_id: scope.budgetId,
        p_name: cleanName,
      });
      if (result.error) throw new Error(`Delete category: ${result.error.message}`);
      const saved = parseCategoryMutationResult(result.data, "Other");
      setCategories(saved.categories);
      setBills(prev => prev.map(b => categoryMatches(b.category, cleanName) ? { ...b, category: saved.categoryName } : b));
      setTransactions(prev => prev.map(t => categoryMatches(t.category, cleanName) ? { ...t, category: saved.categoryName } : t));
    }, persist);
    await persist();
  }, [user, demoMode, assertCanEditHousehold, runTrackedFinancialMutation]);

  // ─── Settings ─────────────────────────────────────────────────────────────────

  const updateSettings = useCallback(async (s: Partial<Settings>) => {
    if (!user) return;
    assertCanEditHousehold("update household settings");
    const scope = householdScopeRef.current;
    if (!scope) throw new Error("Choose a household before updating settings.");
    const scopeKey = `${user.id}:${scope.householdId}`;
    const authoritativeAtIntent = authoritativeSettingsByScopeRef.current.get(scopeKey)
      ?? settingsRef.current;
    if (!authoritativeSettingsByScopeRef.current.has(scopeKey)) {
      authoritativeSettingsByScopeRef.current.set(scopeKey, authoritativeAtIntent);
    }
    const patch: SettingsPatch = {
      ...s,
      ...(Object.prototype.hasOwnProperty.call(s, "paymentMethod")
        ? { paymentMethod: canonicalDebtPaymentMethod(s.paymentMethod) }
        : {}),
    };
    const fields = normalizedSettingsFields(Object.keys(patch));
    if (fields.length === 0) return;
    const token = genId();
    let fieldTokens = settingsFieldTokensRef.current.get(scopeKey);
    if (!fieldTokens) {
      fieldTokens = new Map<SettingsField, string>();
      settingsFieldTokensRef.current.set(scopeKey, fieldTokens);
    }
    fields.forEach(field => fieldTokens?.set(field, token));
    const previous = settingsRef.current;
    const optimistic = { ...previous, ...patch } as Settings;
    settingsRef.current = optimistic;
    setSettings(optimistic);
    if (demoMode) return;
    const saveStarted = Date.now();
    const persist: () => Promise<void> = () => runTrackedFinancialMutation(
      () => enqueueMutationByKey(settingsWriteQueuesRef.current, scopeKey, async () => {
        const currentTokens = settingsFieldTokensRef.current.get(scopeKey) ?? new Map<SettingsField, string>();
        const effectivePatch = activeVersionedPatch(patch, token, currentTokens) as SettingsPatch;
        const effectiveFields = normalizedSettingsFields(Object.keys(effectivePatch));
        if (effectiveFields.length === 0) return;
        const expectedSettings = authoritativeSettingsByScopeRef.current.get(scopeKey)
          ?? authoritativeAtIntent;
        try {
          const result = await supabase.rpc("update_household_settings_patch", {
            p_household_id: scope.householdId,
            p_budget_id: scope.budgetId,
            p_expected: settingsDbPatch(expectedSettings, effectiveFields),
            p_patch: settingsDbPatch(effectivePatch, effectiveFields),
          });
          if (result.error || !result.data) {
            throw new Error(`Update household settings: ${result.error?.message ?? "no row was saved"}`);
          }
          const response = result.data as {
            settings?: unknown;
            debt_minimums?: Array<{ id?: unknown; snowball_minimum_boost?: unknown }>;
          };
          if (!response.settings) throw new Error("Update household settings: no settings were returned");
          const saved = normalizeSettingsRow(response.settings, expectedSettings);
          authoritativeSettingsByScopeRef.current.set(scopeKey, saved);
          const current = settingsRef.current;
          const merged = { ...current };
          effectiveFields.forEach(field => {
            if (currentTokens.get(field) === token) {
              if (Object.is(current[field], optimistic[field])) {
                (merged as unknown as Record<string, unknown>)[field] = saved[field];
              }
              currentTokens.delete(field);
            }
          });
          settingsRef.current = merged;
          setSettings(merged);
          const minimumBoosts = new Map(
            (Array.isArray(response.debt_minimums) ? response.debt_minimums : [])
              .filter(row => typeof row.id === "string")
              .map(row => [String(row.id), Number(row.snowball_minimum_boost ?? 0)]),
          );
          if (minimumBoosts.size > 0) {
            setBills(currentBills => reorderDebtPriorities(currentBills.map(bill =>
              minimumBoosts.has(bill.id)
                ? { ...bill, snowball_minimum_boost: minimumBoosts.get(bill.id) }
                : bill
            )));
          }
          void recordDiagnostic(user.id, {
            eventType: "performance", operation: "settings_save", platform: diagnosticPlatform(),
            durationMs: Date.now() - saveStarted,
          }).catch(() => undefined);
        } catch (error) {
          const rolledBack = rollbackVersionedPatch(
            settingsRef.current,
            expectedSettings,
            optimistic,
            effectiveFields,
            token,
            currentTokens,
          ) as Settings;
          settingsRef.current = rolledBack;
          setSettings(rolledBack);
          throw error;
        }
      }),
      persist,
    );
    await persist();
  }, [user, demoMode, assertCanEditHousehold, runTrackedFinancialMutation]);

  const addAccount = useCallback(async (input: Omit<Account, "id" | "created_at" | "last_reconciled_at">) => {
    if (!user) return;
    assertCanEditHousehold("add an account");
    const now = new Date().toISOString();
    const account: Account = { ...input, id: genId(), created_at: now, last_reconciled_at: now };
    const openingBalanceId = genId();
    const scope = householdScopeRef.current;
    if (!scope) throw new Error("Choose a household before adding an account.");
    const scopeKey = `${user.id}:${scope.householdId}`;
    const authoritativeAtIntent = authoritativeSettingsByScopeRef.current.get(scopeKey)
      ?? settingsRef.current;
    if (!authoritativeSettingsByScopeRef.current.has(scopeKey)) {
      authoritativeSettingsByScopeRef.current.set(scopeKey, authoritativeAtIntent);
    }
    const nextAccounts = [...accountsRef.current.filter(item => item.id !== account.id), account];
    const updatesOperatingAnchor = accountUpdatesOperatingAnchor(toAccountSnapshot(account));
    const accountAnchor = updatesOperatingAnchor
      ? operatingAccountAnchor(nextAccounts.map(toAccountSnapshot))
      : null;
    if (updatesOperatingAnchor && !accountAnchor) {
      throw new Error(
        "Use the same balance date for every active checking and cash account before adding this account.",
      );
    }
    const anchorPatch: SettingsPatch = accountAnchor ? {
      starting_balance: accountAnchor.balance,
      starting_balance_date: accountAnchor.date,
      calendar_start_date: settingsRef.current.calendar_start_date ?? `${accountAnchor.date.slice(0, 7)}-01`,
    } : {};
    const anchorFields = normalizedSettingsFields(Object.keys(anchorPatch));
    const anchorToken = genId();
    let anchorTokens = settingsFieldTokensRef.current.get(scopeKey);
    if (!anchorTokens) {
      anchorTokens = new Map<SettingsField, string>();
      settingsFieldTokensRef.current.set(scopeKey, anchorTokens);
    }
    anchorFields.forEach(field => anchorTokens?.set(field, anchorToken));
    const previousSettings = settingsRef.current;
    const optimisticSettings = { ...previousSettings, ...anchorPatch } as Settings;
    settingsRef.current = optimisticSettings;
    setSettings(optimisticSettings);
    if (demoMode) {
      accountsRef.current = nextAccounts;
      setAccounts(nextAccounts);
      return;
    }
    const persist: () => Promise<void> = () => runTrackedFinancialMutation(
      () => enqueueMutationByKey(settingsWriteQueuesRef.current, scopeKey, async () => {
        const expectedSettings = authoritativeSettingsByScopeRef.current.get(scopeKey)
          ?? authoritativeAtIntent;
        try {
          const result = await supabase.rpc("add_manual_account_with_anchor", {
            p_household_id: scope.householdId,
            p_budget_id: scope.budgetId,
            p_account: account,
            p_balance_id: openingBalanceId,
          });
          if (result.error || !result.data) {
            throw new Error(`Add account: ${result.error?.message ?? "no account was saved"}`);
          }
          const response = result.data as { account?: unknown; settings?: unknown };
          if (!response.account) throw new Error("Add account: the saved account was not returned");
          const savedAccount = normalizeAccountRow(response.account);
          const savedSettings = response.settings
            ? normalizeSettingsRow(response.settings, expectedSettings)
            : expectedSettings;
          authoritativeSettingsByScopeRef.current.set(scopeKey, savedSettings);
          authoritativeAccountsByIdRef.current.set(savedAccount.id, savedAccount);
          const next = [...accountsRef.current.filter(item => item.id !== savedAccount.id), savedAccount];
          accountsRef.current = next;
          setAccounts(next);
          const currentSettings = settingsRef.current;
          const mergedSettings = { ...currentSettings };
          anchorFields.forEach(field => {
            if (anchorTokens?.get(field) === anchorToken) {
              if (Object.is(currentSettings[field], optimisticSettings[field])) {
                (mergedSettings as unknown as Record<string, unknown>)[field] = savedSettings[field];
              }
              anchorTokens?.delete(field);
            }
          });
          settingsRef.current = mergedSettings;
          setSettings(mergedSettings);
        } catch (error) {
          const currentTokens = anchorTokens ?? new Map<SettingsField, string>();
          const rolledBack = rollbackVersionedPatch(
            settingsRef.current,
            expectedSettings,
            optimisticSettings,
            anchorFields,
            anchorToken,
            currentTokens,
          ) as Settings;
          settingsRef.current = rolledBack;
          setSettings(rolledBack);
          throw error;
        }
      }),
      persist,
    );
    await persist();
  }, [user, demoMode, assertCanEditHousehold, runTrackedFinancialMutation]);

  const saveManualAccountChange = useCallback(async (
    intendedAccount: Account,
    recordBalance: boolean,
    diagnosticOperation: "account_save" | "reconciliation",
  ) => {
    if (!user) return;
    assertCanEditHousehold("update an account");
    const previousAccount = accountsRef.current.find(item => item.id === intendedAccount.id);
    if (!previousAccount) throw new Error("Account not found. Refresh and try again.");
    const scope = householdScopeRef.current;
    if (!scope) throw new Error("Choose a household before updating an account.");
    const budgetId = scope.budgetId;
    if (!budgetId) throw new Error("The active household budget is unavailable. Refresh and try again.");
    const scopeKey = `${user.id}:${scope.householdId}`;
    const authoritativeAccountAtIntent = authoritativeAccountsByIdRef.current.get(intendedAccount.id)
      ?? previousAccount;
    if (!authoritativeAccountsByIdRef.current.has(intendedAccount.id)) {
      authoritativeAccountsByIdRef.current.set(intendedAccount.id, authoritativeAccountAtIntent);
    }
    const authoritativeSettingsAtIntent = authoritativeSettingsByScopeRef.current.get(scopeKey)
      ?? settingsRef.current;
    if (!authoritativeSettingsByScopeRef.current.has(scopeKey)) {
      authoritativeSettingsByScopeRef.current.set(scopeKey, authoritativeSettingsAtIntent);
    }

    const nextAccounts = accountsRef.current.map(item => (
      item.id === intendedAccount.id ? intendedAccount : item
    ));
    const previousOperating = accountUpdatesOperatingAnchor(toAccountSnapshot(previousAccount));
    const intendedOperating = accountUpdatesOperatingAnchor(toAccountSnapshot(intendedAccount));
    const touchesOperatingAnchor = previousOperating || intendedOperating;
    const coherentAnchor = touchesOperatingAnchor
      ? operatingAccountAnchor(nextAccounts.map(toAccountSnapshot))
      : null;
    // Mixed observations are honest account history, but not a new aggregate
    // observation. Keep Forecast on the last coherent settings anchor until
    // every active operating account later aligns to one date.
    const anchorPatch: SettingsPatch = coherentAnchor ? {
      starting_balance: coherentAnchor.balance,
      starting_balance_date: coherentAnchor.date,
      calendar_start_date: settingsRef.current.calendar_start_date
        ?? `${coherentAnchor.date.slice(0, 7)}-01`,
    } : {};
    const anchorFields = normalizedSettingsFields(Object.keys(anchorPatch));
    const previousSettings = settingsRef.current;
    const optimisticSettings = { ...previousSettings, ...anchorPatch } as Settings;
    accountsRef.current = nextAccounts;
    setAccounts(nextAccounts);
    settingsRef.current = optimisticSettings;
    setSettings(optimisticSettings);
    if (demoMode) return;

    const mutationId = genId();
    const balanceHistoryId = genId();
    const editToken = genId();
    const anchorToken = genId();
    accountEditTokensRef.current.set(intendedAccount.id, editToken);
    let anchorTokens = settingsFieldTokensRef.current.get(scopeKey);
    if (!anchorTokens) {
      anchorTokens = new Map<SettingsField, string>();
      settingsFieldTokensRef.current.set(scopeKey, anchorTokens);
    }
    anchorFields.forEach(field => anchorTokens?.set(field, anchorToken));

    const persist: () => Promise<void> = () => runTrackedFinancialMutation(
      () => enqueueMutationByKey(settingsWriteQueuesRef.current, scopeKey, () => (
        enqueueMutationByKey(accountWriteQueuesRef.current, intendedAccount.id, async () => {
          if (accountEditTokensRef.current.get(intendedAccount.id) !== editToken) return;
          const expectedAccount = authoritativeAccountsByIdRef.current.get(intendedAccount.id)
            ?? authoritativeAccountAtIntent;
          const expectedSettings = authoritativeSettingsByScopeRef.current.get(scopeKey)
            ?? authoritativeSettingsAtIntent;
          try {
            const result = await updateManualAccountWithAnchorAtomically({
              householdId: scope.householdId,
              budgetId,
              expectedAccount,
              account: intendedAccount,
              mutationId,
              balanceId: balanceHistoryId,
              recordBalance,
            });
            const savedAccount = normalizeAccountRow(result.account);
            const savedSettings = normalizeSettingsRow(result.settings, expectedSettings);
            authoritativeAccountsByIdRef.current.set(savedAccount.id, savedAccount);
            authoritativeSettingsByScopeRef.current.set(scopeKey, savedSettings);

            if (accountEditTokensRef.current.get(savedAccount.id) === editToken) {
              const committedAccounts = accountsRef.current.map(item => (
                item.id === savedAccount.id ? savedAccount : item
              ));
              accountsRef.current = committedAccounts;
              setAccounts(committedAccounts);
              accountEditTokensRef.current.delete(savedAccount.id);
            }
            const currentSettings = settingsRef.current;
            const mergedSettings = { ...currentSettings };
            anchorFields.forEach(field => {
              if (anchorTokens?.get(field) === anchorToken) {
                if (Object.is(currentSettings[field], optimisticSettings[field])) {
                  (mergedSettings as unknown as Record<string, unknown>)[field] = savedSettings[field];
                }
                anchorTokens?.delete(field);
              }
            });
            settingsRef.current = mergedSettings;
            setSettings(mergedSettings);
            void recordDiagnostic(user.id, {
              eventType: "performance",
              operation: diagnosticOperation,
              platform: diagnosticPlatform(),
            }).catch(() => undefined);
          } catch (error) {
            if (accountEditTokensRef.current.get(intendedAccount.id) === editToken) {
              const rollbackAccount = authoritativeAccountsByIdRef.current.get(intendedAccount.id)
                ?? previousAccount;
              const rolledBackAccounts = accountsRef.current.map(item => (
                item.id === rollbackAccount.id ? rollbackAccount : item
              ));
              accountsRef.current = rolledBackAccounts;
              setAccounts(rolledBackAccounts);
            }
            const rolledBackSettings = rollbackVersionedPatch(
              settingsRef.current,
              expectedSettings,
              optimisticSettings,
              anchorFields,
              anchorToken,
              anchorTokens ?? new Map<SettingsField, string>(),
            ) as Settings;
            settingsRef.current = rolledBackSettings;
            setSettings(rolledBackSettings);
            void recordDiagnostic(user.id, {
              eventType: "save_failure",
              operation: diagnosticOperation,
              platform: diagnosticPlatform(),
              errorCode: diagnosticErrorCode(error),
            }).catch(() => undefined);
            throw error;
          }
        })
      )),
      persist,
    );
    await persist();
  }, [user, demoMode, assertCanEditHousehold, runTrackedFinancialMutation]);

  const updateAccount = useCallback(async (account: Account) => {
    if (!user) return;
    const previous = accountsRef.current.find(item => item.id === account.id);
    if (!previous) throw new Error("Account not found. Refresh and try again.");
    const balanceChanged = (
      Math.abs(Number(previous.current_balance) - Number(account.current_balance)) >= 0.005
      || previous.balance_as_of !== account.balance_as_of
    );
    const intendedAccount = balanceChanged
      ? { ...account, last_reconciled_at: new Date().toISOString() }
      : account;
    await saveManualAccountChange(intendedAccount, balanceChanged, "account_save");
  }, [saveManualAccountChange, user]);

  const updateConnectedBankAccountDisplayName = useCallback(async (accountId: string, displayName: string | null) => {
    if (!user) return;
    assertCanEditHousehold("rename a savings account");
    const previous = connectedBankAccounts.find(account => account.id === accountId);
    if (!previous || previous.account_subtype !== "savings") throw new Error("Savings account not found.");
    const normalized = displayName === null ? undefined : displayName.trim().replace(/\s+/g, " ");
    if (displayName !== null && (!normalized || normalized.length > 80)) {
      throw new Error(normalized ? "Keep the account name under 80 characters." : "Enter an account name.");
    }

    setConnectedBankAccounts(current => current.map(account =>
      account.id === accountId ? { ...account, display_name: normalized } : account,
    ));
    const saveOperationId = markSaveStarted();
    try {
      const { data } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;
      if (!accessToken) throw new Error("Sign in again before renaming this account.");
      if (!activeHouseholdId) throw new Error("Choose a household before renaming this account.");
      const response = await apiFetch("/api/plaid/account-nickname", {
        method: "PATCH",
        credentials: "include",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "X-FlowLedger-Household-Id": activeHouseholdId,
        },
        body: JSON.stringify({ accountId, displayName: normalized ?? null }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { message?: string };
        throw new Error(payload.message || "Could not update the account name.");
      }
      markSaveCompleted(saveOperationId);
    } catch (error) {
      setConnectedBankAccounts(current => current.map(account =>
        account.id === accountId ? { ...account, display_name: previous.display_name } : account,
      ));
      markSaveFailed(error, () => updateConnectedBankAccountDisplayName(accountId, displayName), saveOperationId);
      throw error;
    }
  }, [activeHouseholdId, assertCanEditHousehold, connectedBankAccounts, markSaveCompleted, markSaveFailed, markSaveStarted, user]);

  const reconcileAccount = useCallback(async (accountId: string, balance: number, asOfDate: string) => {
    if (!user) return;
    const account = accountsRef.current.find(item => item.id === accountId);
    if (!account) throw new Error("Account not found. Refresh and try again.");
    await saveManualAccountChange({
      ...account,
      current_balance: balance,
      balance_as_of: asOfDate,
      last_reconciled_at: new Date().toISOString(),
    }, true, "reconciliation");
  }, [saveManualAccountChange, user]);

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
    let prepared: { fresh: ImportedTransactionRow[]; records: Record<string, unknown>[] } | null = null;
    const persist: () => Promise<{ imported: number; duplicates: number }> = () => runTrackedFinancialMutation(async () => {
      if (!prepared) {
        const hashes = rows.map(row => row.importHash);
        const existingResult = await applyHouseholdSelect(supabase.from("transactions").select("import_hash"), user.id).in("import_hash", hashes);
        if (existingResult.error) throw new Error(`Check statement duplicates: ${existingResult.error.message}`);
        const existing = new Set((existingResult.data ?? []).map((row: any) => row.import_hash));
        const seen = new Set<string>();
        const fresh = rows.filter(row => !existing.has(row.importHash) && !seen.has(row.importHash) && !!seen.add(row.importHash));
        prepared = {
          fresh,
          records: fresh.map(row => ({
            ...scopedPayload({ id: genId(), user_id: user.id, account_id: accountId, import_hash: row.importHash }),
            date: row.date, amount: row.amount, category: "Other", note: row.description, source: "statement",
          })),
        };
      }
      if (prepared.records.length) {
        await ensureSaved(supabase.from("transactions").upsert(prepared.records, { onConflict: "id" }), "Import statement");
        const savedRecords = prepared.records.map(({ user_id: _userId, ...record }) => record as unknown as Transaction);
        const savedIds = new Set(savedRecords.map(record => record.id));
        setTransactions(previous => [...previous.filter(record => !savedIds.has(record.id)), ...savedRecords]);
      }
      void recordDiagnostic(user.id, { eventType: "performance", operation: "statement_import", platform: diagnosticPlatform() }).catch(() => undefined);
      return { imported: prepared.fresh.length, duplicates: rows.length - prepared.fresh.length };
    }, persist);
    return persist();
  }, [user, demoMode, transactions, scopedPayload, applyHouseholdSelect, assertCanEditHousehold, runTrackedFinancialMutation]);

  const saveDecision = useCallback(async (scenario: DecisionScenario, result: DecisionResult, status: DecisionRecord["status"] = "saved") => {
    if (!user) throw new Error("Sign in to save a decision");
    assertCanEditHousehold("save a decision");
    const decision: DecisionRecord = { id: genId(), name: scenario.name, decision_type: scenario.type, scenario, result, status, calendar_date: status === "calendar" || status === "planned" ? scenario.date : undefined, next_due_date: status === "planned" ? scenario.date : undefined, created_at: new Date().toISOString() };
    if (demoMode) {
      setDecisions(previous => [decision, ...previous]);
      return decision;
    }
    const persist: () => Promise<DecisionRecord> = () => runTrackedFinancialMutation(async () => {
      await ensureSaved(
        supabase.from("decisions").upsert(scopedPayload({ id: decision.id, user_id: user.id, created_at: decision.created_at, ...decisionDbPayload(decision) }), { onConflict: "id" }),
        "Save decision",
      );
      setDecisions(previous => [decision, ...previous.filter(item => item.id !== decision.id)]);
      return decision;
    }, persist);
    return persist();
  }, [user, demoMode, scopedPayload, assertCanEditHousehold, runTrackedFinancialMutation]);

  const updateDecision = useCallback(async (decision: DecisionRecord) => {
    if (!user) return;
    assertCanEditHousehold("update a decision");
    if (demoMode) {
      setDecisions(previous => previous.map(item => item.id === decision.id ? decision : item));
      return;
    }
    const persist: () => Promise<void> = () => runTrackedFinancialMutation(async () => {
      await ensureSaved(supabase.from("decisions").update({ ...decisionDbPayload(decision), updated_at: new Date().toISOString() }).eq("id", decision.id).select("id").single(), "Update decision");
      setDecisions(previous => previous.map(item => item.id === decision.id ? decision : item));
    }, persist);
    await persist();
  }, [user, demoMode, assertCanEditHousehold, runTrackedFinancialMutation]);

  const deleteDecision = useCallback(async (id: string) => {
    if (!user) return;
    assertCanEditHousehold("delete a decision");
    if (demoMode) { setDecisions(previous => previous.filter(item => item.id !== id)); return; }
    const persist: () => Promise<void> = () => runTrackedFinancialMutation(async () => {
      await deleteRowIdempotently("decisions", id, "Delete decision");
      setDecisions(previous => previous.filter(item => item.id !== id));
    }, persist);
    await persist();
  }, [user, demoMode, assertCanEditHousehold, deleteRowIdempotently, runTrackedFinancialMutation]);

  const importBills = useCallback(async (imported: Omit<Bill, "id" | "created_at">[]) => {
    if (!user) return;
    assertCanEditHousehold("import bills");
    const newBills = imported.map(b => ({
      ...b,
      frequency:   (["monthly", "quarterly", "biweekly", "weekly"].includes(String(b.frequency)) ? b.frequency : "monthly") as "monthly" | "quarterly" | "biweekly" | "weekly",
      day_of_week: b.day_of_week ?? 0,
      next_payment_date: b.next_payment_date ?? undefined,
      id:          genId(),
      created_at:  new Date().toISOString(),
    }));
    if (demoMode) {
      setBills(prev => reorderDebtPriorities([...prev, ...newBills]));
      return;
    }
    const persist: () => Promise<void> = () => runTrackedFinancialMutation(async () => {
      await ensureSaved(
        supabase.from("bills").upsert(newBills.map(b => scopedPayload({ ...b, user_id: user.id })), { onConflict: "id" }),
        "Import bills",
      );
      const importedIds = new Set(newBills.map(bill => bill.id));
      setBills(prev => reorderDebtPriorities([...prev.filter(bill => !importedIds.has(bill.id)), ...newBills]));
    }, persist);
    await persist();
  }, [user, demoMode, scopedPayload, assertCanEditHousehold, runTrackedFinancialMutation]);

  // ─── Provider value ───────────────────────────────────────────────────────────

  const dashboardDataRevision = `${secondaryDataScopeKey ?? "none"}:${[
    billsRevision,
    overridesRevision,
    billDateMovesRevision,
    transactionsRevision,
    deletedTransactionsRevision,
    pendingBankTransactionsRevision,
    pendingPlanMatchesRevision,
    incomesRevision,
    goalsRevision,
    extraPaymentsRevision,
    categoriesRevision,
    accountsRevision,
    connectedBankAccountsRevision,
    householdTimeZoneRevision,
    transactionAccountIdentitiesRevision,
    decisionsRevision,
    settingsRevision,
  ].join(".")}`;
  useLayoutEffect(() => {
    dashboardDataRevisionRef.current = dashboardDataRevision;
    const pendingFreshness = pendingAuthoritativeFreshnessRef.current;
    if (
      pendingFreshness
      && pendingFreshness.requestId === loadRequestRef.current
      && pendingFreshness.beforeRevision !== dashboardDataRevision
    ) {
      pendingAuthoritativeFreshnessRef.current = null;
      if (authoritativeFreshnessTimerRef.current) {
        clearTimeout(authoritativeFreshnessTimerRef.current);
        authoritativeFreshnessTimerRef.current = null;
      }
      setDataUpdatedAt(current => authoritativeFreshnessTimestamp({
        currentTimestamp: current,
        revisionBeforeRefresh: pendingFreshness.beforeRevision,
        revisionAfterRefresh: dashboardDataRevision,
        authoritativeTimestamp: pendingFreshness.updatedAt,
      }));
    }
  }, [dashboardDataRevision]);
  const budgetContextValue: BudgetContextType = {
      bills, overrides, billDateMoves, transactions, deletedTransactions, pendingBankTransactions, pendingPlanMatches, incomes, goals, extraPayments, categories, settings, accounts, connectedBankAccounts, transactionAccountIdentities, householdTimeZone, decisions,
      households, householdMembers, householdActivity, householdDetailsReady, categoriesReady, activeHousehold, householdRole, canEditHousehold,
      refreshHouseholds, refreshHouseholdsForPrivacy, refreshHouseholdActivity, switchHousehold, createHouseholdInvite, acceptHouseholdInvite,
      updateHouseholdMemberRole, removeHouseholdMember, leaveActiveHousehold,
      forecastConfidence, loading, startupCoreReady, loadError, dataUpdatedAt, retryBudgetLoad, refreshBankData, demoMode,
      saveStatus, saveError, retryLastSave, clearSaveError,
      dashboardFilter, setDashboardFilter,
      addBill, updateBill, stopFutureBill, deleteBill, deleteBillMistake, getBillById,
      getOverride, getAmount, getPaidAmount, setPaidAmount, setCustomAmount, setPlannedDebtAmount, getCustomDueDay, setCustomDueDay,
      moveBillOccurrence, removeBillOccurrenceMove, getBillDateMoveForOccurrence, getBillDateMovesForMonth,
      getMonthlyBills, getBillOccurrencesInMonth, getBillMonthlyTotal, getBillEffectiveMonthlyTotal, getDebtMonthSettlements, getDebtSourceCommitment, getDebtPlanForMonth, getRemainingDebtPlanForMonth,
      runSnowball, previewDebtSnowball, applyDebtSnowballPayment, saveExtraPayment, getExtraPayment, deleteExtraPayment, removeDebtSnowballPayment, finalizeBillPayment,
      addTransaction, updateTransaction, deleteTransaction, restoreDeletedTransaction, deleteTransfer, matchTransactionToBill, unmatchTransactionFromBill, matchPendingTransactionToBill, matchPendingTransactionToManual, removePendingPlanMatch, reconcileTransaction, createSpendingBucketForTransaction, undoTransactionReconciliation, removeReviewSurplusFunding, getTransactionsForMonth,
      addIncome, updateIncome, deleteIncome, getMonthlyIncome, getIncomeOccurrencesInMonth,
      addGoal, updateGoal, closeSpendingBucket, closeSpendingBucketAndRouteRemainder, reopenSpendingBucket, archiveSpendingBucket, restoreArchivedSpendingBucket, deleteGoal, checkGoalAffordability,
      getCashFlow, getDailyBalances, getCalendarDailyBalances, getPlanSimulationBaseline,
      addCategory, updateCategory, deleteCategory,
      updateSettings, importBills,
      addAccount, updateAccount, updateConnectedBankAccountDisplayName, reconcileAccount, archiveAccount, importStatementTransactions,
      saveDecision, updateDecision, deleteDecision,
      selectedYear, setSelectedYear,
  };

  return (
    <BudgetContext.Provider value={budgetContextValue}>
      <DashboardFinancialSnapshotController
        budget={budgetContextValue}
        dataRevision={dashboardDataRevision}
        userId={userId}
      >
        {children}
      </DashboardFinancialSnapshotController>
    </BudgetContext.Provider>
  );
}

function DashboardFinancialSnapshotController({
  budget,
  children,
  dataRevision,
  userId,
}: {
  budget: BudgetContextType;
  children: React.ReactNode;
  dataRevision: string;
  userId: string | null;
}) {
  const {
    accounts,
    activeHousehold,
    bills,
    categories,
    connectedBankAccounts,
    forecastConfidence,
    getBillMonthlyTotal,
    getBillOccurrencesInMonth,
    getCashFlow,
    getDailyBalances,
    getDebtMonthSettlements,
    getMonthlyBills,
    getMonthlyIncome,
    getPaidAmount,
    getRemainingDebtPlanForMonth,
    getTransactionsForMonth,
    goals,
    householdTimeZone,
    incomes,
    pendingBankTransactions,
    pendingPlanMatches,
    settings,
    startupCoreReady,
    transactions,
  } = budget;
  const [computedSnapshot, setComputedSnapshot] =
    useState<DashboardFinancialSnapshotState | null>(null);
  const [buildFailure, setBuildFailure] = useState<{
    attempt: number;
    message: string;
    targetKey: string;
  } | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [mountedDashboardContentKeys, setMountedDashboardContentKeys] = useState<
    ReadonlyMap<string, number>
  >(() => new Map());
  const [householdDateEpoch, setHouseholdDateEpoch] = useState(0);
  const retryDelayRef = useRef(2000);
  const cancelBuildRef = useRef<(() => void) | null>(null);
  const segments = useSegments();
  // Expo Router omits the index segment for the Dashboard route.
  const dashboardRouteDemanded = segments[0] === "(tabs)"
    && segments.length === 1;
  const dashboardSnapshotDemanded = dashboardRouteDemanded;
  useLayoutEffect(() => {
    if (!dashboardRouteDemanded) cancelBuildRef.current?.();
  }, [dashboardRouteDemanded]);
  useEffect(() => {
    let active = true;
    let midnightTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleMidnight = () => {
      if (!active) return;
      const delay = millisecondsUntilHouseholdDateChanges(
        new Date(),
        householdTimeZone,
      );
      midnightTimer = setTimeout(() => {
        if (!active) return;
        setHouseholdDateEpoch(current => current + 1);
        scheduleMidnight();
      }, delay + 25);
    };
    const refreshVisibleDate = () => {
      if (active) setHouseholdDateEpoch(current => current + 1);
    };
    const appStateSubscription = AppState.addEventListener("change", state => {
      if (state === "active") refreshVisibleDate();
    });
    const unsubscribeWebResume = Platform.OS === "web"
      && typeof document !== "undefined"
      && typeof window !== "undefined"
      ? subscribeHouseholdDateResumeEvents({
          documentTarget: document,
          windowTarget: window,
          onRefresh: refreshVisibleDate,
        })
      : null;
    scheduleMidnight();
    return () => {
      active = false;
      if (midnightTimer) clearTimeout(midnightTimer);
      appStateSubscription.remove();
      unsubscribeWebResume?.();
    };
  }, [householdTimeZone]);
  const asOfDate = useMemo(
    () => safeLocalDateInTimeZone(new Date(), householdTimeZone),
    [householdDateEpoch, householdTimeZone],
  );
  const [asOfYear, asOfMonthNumber, asOfDay] = asOfDate.split("-").map(Number);
  const asOfMonth = asOfMonthNumber - 1;
  const secondaryScopeKey = userId && activeHousehold?.householdId
    ? `${userId}:${activeHousehold.householdId}`
    : null;
  const budgetScopeRevision = activeHousehold?.budgetId ?? "";
  const categoryBudgetScope = useMemo<CategoryBudgetScope>(() => ({
    userId,
    householdId: activeHousehold?.householdId,
    budgetId: activeHousehold?.budgetId,
  }), [activeHousehold?.budgetId, activeHousehold?.householdId, userId]);
  const categoryBudgetKey = secondaryScopeKey
    ? `${secondaryScopeKey}:${budgetScopeRevision.length}:${budgetScopeRevision}:${asOfYear}-${asOfMonth}`
    : null;
  const cachedCategoryBudgets = useMemo(
    () => categoryBudgetKey
      ? readCategoryBudgetCache(asOfMonth, asOfYear, categoryBudgetScope)
      : {},
    [asOfMonth, asOfYear, categoryBudgetKey, categoryBudgetScope],
  );
  const cachedCategoryBudgetsExact = Boolean(
    categoryBudgetKey
    && hasCategoryBudgetCache(asOfMonth, asOfYear, categoryBudgetScope)
  );
  const [loadedCategoryBudgets, setLoadedCategoryBudgets] = useState<{
    error: string | null;
    exact: boolean;
    key: string | null;
    value: Record<string, number>;
  }>({ error: null, exact: false, key: null, value: {} });
  const categoryBudgets = loadedCategoryBudgets.key === categoryBudgetKey
    ? loadedCategoryBudgets.value
    : cachedCategoryBudgets;
  const categoryBudgetsExact = loadedCategoryBudgets.key === categoryBudgetKey
    ? loadedCategoryBudgets.exact
    : cachedCategoryBudgetsExact;
  const categoryBudgetsError = loadedCategoryBudgets.key === categoryBudgetKey
    ? loadedCategoryBudgets.error
    : null;

  useEffect(() => {
    if (!categoryBudgetKey) {
      setLoadedCategoryBudgets({ error: null, exact: false, key: null, value: {} });
      return;
    }
    let cancelled = false;
    let remoteTimer: ReturnType<typeof setTimeout> | null = null;
    const readExactCache = () => {
      if (cancelled) return;
      setLoadedCategoryBudgets({
        error: null,
        exact: hasCategoryBudgetCache(asOfMonth, asOfYear, categoryBudgetScope),
        key: categoryBudgetKey,
        value: readCategoryBudgetCache(asOfMonth, asOfYear, categoryBudgetScope),
      });
    };
    readExactCache();
    const unsubscribe = subscribeCategoryBudgets(readExactCache);

    if (startupCoreReady && userId && dashboardSnapshotDemanded) {
      const remoteDelay = hasCategoryBudgetCache(
        asOfMonth,
        asOfYear,
        categoryBudgetScope,
      ) ? 3000 : 0;
      remoteTimer = setTimeout(() => {
        void loadCategoryBudgetsExact(
          categoryBudgetScope,
          asOfMonth,
          asOfYear,
        ).then(result => {
          if (!cancelled) {
            setLoadedCategoryBudgets({
              error: result.exact ? null : result.error,
              exact: result.exact,
              key: categoryBudgetKey,
              value: result.value,
            });
          }
        }).catch(error => {
          if (!cancelled) {
            setLoadedCategoryBudgets({
              error: error instanceof Error
                ? error.message
                : "Category plan unavailable.",
              exact: false,
              key: categoryBudgetKey,
              value: readCategoryBudgetCache(
                asOfMonth,
                asOfYear,
                categoryBudgetScope,
              ),
            });
          }
        });
      }, remoteDelay);
    }

    return () => {
      cancelled = true;
      if (remoteTimer) clearTimeout(remoteTimer);
      unsubscribe();
    };
  }, [
    asOfMonth,
    asOfYear,
    categoryBudgetKey,
    categoryBudgetScope,
    dashboardSnapshotDemanded,
    retryNonce,
    startupCoreReady,
    userId,
  ]);

  const categoryBudgetRevision = useMemo(
    () => JSON.stringify(
      Object.entries(categoryBudgets)
        .sort(([left], [right]) => left.localeCompare(right)),
    ),
    [categoryBudgets],
  );
  const identity = useMemo<DashboardFinancialSnapshotIdentity | null>(
    () => userId && activeHousehold?.householdId
      ? {
          userId,
          householdId: activeHousehold.householdId,
          budgetId: activeHousehold.budgetId ?? null,
          dataRevision,
          planInputRevision: `${budgetScopeRevision.length}:${budgetScopeRevision}:${asOfYear}:${asOfDate}:${categoryBudgetRevision}`,
        }
      : null,
    [
      activeHousehold?.budgetId,
      activeHousehold?.householdId,
      asOfDate,
      budgetScopeRevision,
      categoryBudgetRevision,
      dataRevision,
      asOfYear,
      userId,
    ],
  );
  const snapshotKey = identity ? dashboardFinancialSnapshotKey(identity) : null;
  const dashboardFinancialSnapshot = useMemo(
    () => selectDashboardFinancialSnapshotForRender({
      identity,
      startupCoreReady,
      computed: computedSnapshot,
    }),
    [computedSnapshot, identity, snapshotKey, startupCoreReady],
  );

  useEffect(() => {
    retryDelayRef.current = 2000;
    setBuildFailure(current => (
      current?.targetKey === snapshotKey ? current : null
    ));
  }, [snapshotKey]);

  useEffect(() => {
    if (!buildFailure || buildFailure.targetKey !== snapshotKey) return;
    const delay = retryDelayRef.current;
    retryDelayRef.current = Math.min(delay * 2, 60_000);
    const retryTimer = setTimeout(() => {
      setComputedSnapshot(current => (
        current?.status === "error" && current.key === buildFailure.targetKey
          ? null
          : current
      ));
      setRetryNonce(current => current + 1);
    }, delay);
    return () => clearTimeout(retryTimer);
  }, [buildFailure, snapshotKey]);

  useEffect(() => {
    cancelBuildRef.current?.();
    cancelBuildRef.current = null;
    if (
      !identity
      || !snapshotKey
      || !startupCoreReady
      || !dashboardSnapshotDemanded
    ) return;
    if (!categoryBudgetsExact) {
      if (categoryBudgetsError && computedSnapshot?.key !== snapshotKey) {
        const message = "Category plan is not ready. Check your connection and retry.";
        setComputedSnapshot(current => dashboardSnapshotAfterBuildError(
          current,
          identity,
          message,
        ));
        setBuildFailure(current => ({
          attempt: current?.targetKey === snapshotKey
            ? current.attempt + 1
            : 1,
          message,
          targetKey: snapshotKey,
        }));
      }
      return;
    }
    if (computedSnapshot?.key === snapshotKey) return;

    const nextMonth = (asOfMonth + 1) % 12;
    const nextMonthYear = asOfYear + Math.floor((asOfMonth + 1) / 12);
    const lastForecastOffset = dashboardDecisionForecastMonthLimit(
      settings.forecast_horizon_months,
    ) - 1;
    const finalForecastMonth = (asOfMonth + lastForecastOffset) % 12;
    const finalForecastMonthYear = asOfYear
      + Math.floor((asOfMonth + lastForecastOffset) / 12);
    let preparedCashFlow: CashFlow | undefined;
    let preparedCurrentMonthBalances: DailyBalance[] | undefined;
    let preparedReviewCenterCount: number | undefined;
    let preparedPostedIncome: number | undefined;
    let preparedRecentActivity: ReturnType<
      typeof selectRecentDashboardActivity
    > | undefined;
    const connectedBankAnchor = connectedCheckingObservedAnchor(
      connectedBankAccounts,
      householdTimeZone,
    );
    const observedAnchor = connectedBankAnchor
      ?? operatingAccountAnchor(accounts.map(toAccountSnapshot));
    const projectionMonths = financialProjectionPreparationMonths({
      asOfDate,
      startingBalanceDate: settings.starting_balance_date,
      observedAnchorDate: observedAnchor?.date,
      targetMonth: finalForecastMonth,
      targetYear: finalForecastMonthYear,
    });
    const stages: Array<() => void> = [
      () => {
        preparedCashFlow = getCashFlow(asOfMonth, asOfYear);
      },
      ...projectionMonths.map(({ month, year }) => () => {
        const balances = getDailyBalances(month, year);
        if (month === asOfMonth && year === asOfYear) {
          preparedCurrentMonthBalances = balances;
        }
      }),
      () => { getRemainingDebtPlanForMonth(asOfMonth, asOfYear); },
      () => { getRemainingDebtPlanForMonth(nextMonth, nextMonthYear); },
      () => {
        preparedReviewCenterCount = countReviewQueue(transactions, asOfDate);
      },
      () => {
        preparedPostedIncome = sumPostedDashboardIncome(
          getTransactionsForMonth(asOfMonth, asOfYear),
          connectedBankAccounts,
        );
      },
      () => {
        preparedRecentActivity = selectRecentDashboardActivity(
          getTransactionsForMonth(asOfMonth, asOfYear),
        );
      },
      () => {
        const ready = buildDashboardFinancialSnapshot(identity, {
          now: new Date(asOfYear, asOfMonth, asOfDay, 12),
          selectedYear: asOfYear,
          settings,
          forecastConfidence,
          accounts,
          connectedBankAccounts,
          pendingBankTransactions,
          pendingPlanMatches,
          categories,
          categoryBudgets,
          goals,
          incomes,
          getMonthlyBills,
          getMonthlyIncome,
          getTransactionsForMonth,
          getDailyBalances,
          getBillMonthlyTotal,
          getPaidAmount,
          getBillOccurrencesInMonth,
          getDebtMonthSettlements,
          allBills: bills,
          allTransactions: transactions,
          preparedCashFlow,
          preparedCurrentMonthBalances,
          reviewCenterCount: preparedReviewCenterCount ?? 0,
          postedIncome: preparedPostedIncome ?? 0,
          recentActivity: preparedRecentActivity,
          getCashFlow,
          getRemainingDebtPlanForMonth,
        });
        retryDelayRef.current = 2000;
        setBuildFailure(null);
        setComputedSnapshot(ready);
      },
    ];
    const cancel = startCancellableStageQueue({
      stages,
      schedule: (work, delay) => setTimeout(work, delay),
      cancelScheduled: handle => clearTimeout(handle),
      shouldYield: () => {
        const scheduling = typeof navigator !== "undefined"
          ? (navigator as Navigator & {
              scheduling?: { isInputPending?: () => boolean };
            }).scheduling
          : undefined;
        return scheduling?.isInputPending?.() ?? false;
      },
      onError: error => {
        const message = error instanceof Error
          ? error.message
          : "Dashboard data is not ready.";
        setComputedSnapshot(current => dashboardSnapshotAfterBuildError(
          current,
          identity,
          message,
        ));
        setBuildFailure(current => ({
          attempt: current?.targetKey === snapshotKey
            ? current.attempt + 1
            : 1,
          message,
          targetKey: snapshotKey,
        }));
      },
    });
    cancelBuildRef.current = cancel;
    // Let the O(1) Dashboard shell paint and accept a rapid second-tab touch
    // before beginning any financial projection work.
    return cancel;
  }, [
    accounts,
    asOfDate,
    asOfDay,
    asOfMonth,
    asOfYear,
    bills,
    categories,
    categoryBudgets,
    categoryBudgetsError,
    categoryBudgetsExact,
    computedSnapshot?.key,
    connectedBankAccounts,
    dashboardSnapshotDemanded,
    forecastConfidence,
    getBillMonthlyTotal,
    getBillOccurrencesInMonth,
    getCashFlow,
    getDailyBalances,
    getDebtMonthSettlements,
    getMonthlyBills,
    getMonthlyIncome,
    getPaidAmount,
    getRemainingDebtPlanForMonth,
    getTransactionsForMonth,
    goals,
    identity,
    incomes,
    pendingBankTransactions,
    pendingPlanMatches,
    retryNonce,
    settings,
    snapshotKey,
    startupCoreReady,
    transactions,
  ]);

  const retryDashboardFinancialSnapshot = useCallback(() => {
    retryDelayRef.current = 2000;
    setBuildFailure(null);
    setComputedSnapshot(current => current?.status === "error" ? null : current);
    setRetryNonce(current => current + 1);
  }, []);
  const acknowledgeDashboardSnapshotContentMounted = useCallback(
    (contentKey: string) => {
      setMountedDashboardContentKeys(current => {
        const next = new Map(current);
        next.set(contentKey, (next.get(contentKey) ?? 0) + 1);
        return next;
      });
      let released = false;
      return () => {
        if (released) return;
        released = true;
        setMountedDashboardContentKeys(current => {
          const next = new Map(current);
          const remaining = (next.get(contentKey) ?? 1) - 1;
          if (remaining > 0) next.set(contentKey, remaining);
          else next.delete(contentKey);
          return next;
        });
      };
    },
    [],
  );
  const dashboardSnapshotContentMountedForKey = Boolean(
    snapshotKey && (mountedDashboardContentKeys.get(snapshotKey) ?? 0) > 0,
  );
  const exactSnapshotReady = computedSnapshot?.key === snapshotKey
    && computedSnapshot.status === "ready";
  const exactSnapshotError = computedSnapshot?.key === snapshotKey
    && computedSnapshot.status === "error";
  const dashboardSnapshotStartupSettled = !dashboardSnapshotDemanded
    || (
      (exactSnapshotReady || exactSnapshotError)
      && dashboardSnapshotContentMountedForKey
    );
  const contextValue = useMemo(() => ({
    dashboardFinancialSnapshot,
    dashboardSnapshotTargetKey: snapshotKey,
    dashboardSnapshotDemanded,
    dashboardSnapshotContentMountedForKey,
    dashboardSnapshotStartupSettled,
    acknowledgeDashboardSnapshotContentMounted,
    retryDashboardFinancialSnapshot,
  }), [
    dashboardFinancialSnapshot,
    snapshotKey,
    dashboardSnapshotDemanded,
    dashboardSnapshotContentMountedForKey,
    dashboardSnapshotStartupSettled,
    acknowledgeDashboardSnapshotContentMounted,
    retryDashboardFinancialSnapshot,
  ]);

  return (
    <DashboardFinancialSnapshotContextProvider value={contextValue}>
      {children}
    </DashboardFinancialSnapshotContextProvider>
  );
}

export function useBudget() {
  const ctx = useContext(BudgetContext);
  if (!ctx) throw new Error("useBudget must be used within BudgetProvider");
  return ctx;
}
