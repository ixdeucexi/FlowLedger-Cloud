import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AddTransactionModal } from "@/components/AddTransactionModal";
import {
  AddBillModal,
  type AddBillInitialValues,
} from "@/components/AddBillModal";
import { BillSurplusModal } from "@/components/BillSurplusModal";
import {
  DebtPaymentAppliedModal,
  type DebtPaymentAppliedDetail,
} from "@/components/DebtPaymentAppliedModal";
import { DesktopActivityPage } from "@/components/desktop/DesktopActivityPage";
import { DataFreshnessLabel } from "@/components/DataFreshnessLabel";
import { EmptyState } from "@/components/EmptyState";
import { FullPaymentPromptModal } from "@/components/FullPaymentPromptModal";
import { GoalModal } from "@/components/GoalModal";
import { PremiumBackdrop } from "@/components/PremiumBackdrop";
import { PlanViewSelector } from "@/components/PlanViewSelector";
import { SnowballPreviewModal } from "@/components/SnowballPreviewModal";
import { UnplannedChargeModal } from "@/components/UnplannedChargeModal";
import colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import type {
  Bill,
  ExtraPayment,
  PendingBankTransaction,
  SnowballFundingSource,
  Transaction,
} from "@/context/BudgetContext";
import { useBudget } from "@/context/BudgetContext";
import { useMembership } from "@/context/MembershipContext";
import { useColors } from "@/hooks/useColors";
import { useBackDismiss } from "@/hooks/useBackDismiss";
import { useDesktopExperience } from "@/hooks/useDesktopExperience";
import { nextPlannedDebtPayment } from "@/lib/billSurplusRouting";
import { isBillEligibleForUpcomingPlan } from "@/lib/billEligibility";
import { connectedCheckingObservedAnchor } from "@/lib/accounts";
import { adjacentBillMatchCandidates } from "@/lib/billMatchCandidates";
import {
  DESKTOP_MODAL_HANDLE,
  DESKTOP_MODAL_MATCH,
  DESKTOP_MODAL_OVERLAY,
  DESKTOP_MODAL_REGULAR,
} from "@/lib/desktopModal";
import { debtPaymentStatusLabel } from "@/lib/forecastDisplay";
import {
  canMatchExpenseToBill,
  confirmedBillMatchId,
  confirmedBillMatchOccurrenceDate,
  isCashFlowTransaction,
  isCheckingBalanceTransaction,
  isConfirmedBillMatch,
  isMatchedPaymentLowerThanPlanned,
  manualActivityMatchCandidates,
  rankBillMatches,
} from "@/lib/billMatching";
import {
  activityAmountOutsidePlannedBill,
  summarizeActivityMonth,
} from "@/lib/monthlySummary";
import { isValidDateInMonth } from "@/lib/schedule";
import { selectFlowLedgerTransactions } from "@/lib/ledgerEngine";
import type { SnowballProjectionResult } from "@/lib/snowball";
import {
  hasBucketRemainderFunding,
  latestBucketRemainderAvailableDate,
  resizeSnowballFundingSources,
} from "@/lib/snowballFunding";
import {
  isEligibleSpendingBucketMatch,
  spendingBucketMatch,
  spendingBucketSummary,
} from "@/lib/spendingBuckets";
import {
  buildForgottenBillDefaults,
  buildReviewQueue,
  forgottenBillSettlement,
  matchedOccurrenceAllocations,
  occurrenceKey,
  transactionDisplayName,
} from "@/lib/reviewCenter";
import {
  activePendingPlanMatches,
  pendingMatchStatusLabel,
  unmatchedPendingTransactions,
} from "@/lib/pendingPlanMatches";
import { transactionDebt } from "@/lib/transactionDebt";
import {
  readInterfacePreferences,
  updateInterfacePreferences,
} from "@/lib/interfacePreferences";
import {
  ACTIVITY_DATE_RANGE_OPTIONS,
  activityRunningBalancesFromDatedAnchor,
  activityTransactionUsesCheckingLedger,
  dateOnly,
  dateIsInActivityRange,
  isActivityRangeId,
  resolveActivityDateRange,
  summarizeActivityRange,
  summarizeActivitySnapshot,
  type ActivityRangeId,
} from "@/lib/activityRange";
import { exportActivityCsv } from "@/lib/activityCsv";
import { CategoryBudgetScreen } from "./category-budget";

// ── Types ─────────────────────────────────────────────────────────────────────

type ActivitySource =
  | "transaction"
  | "bank_transaction"
  | "bill_payment"
  | "income"
  | "extra_payment"
  | "transfer";
type TypeFilter = "all" | "expense" | "income";
type SourceFilter = "all" | ActivitySource;
type SortOrder = "asc" | "desc";
const MODAL_HANDOFF_DELAY_MS = 350;
type MatchedPaymentPrompt = {
  transaction: Transaction;
  bill: Bill;
  budgeted: number;
  actual: number;
  occurrenceDate: string;
  month: number;
  year: number;
};

interface ActivityItem {
  id: string;
  date: string;
  amount: number;
  label: string;
  category: string;
  source: ActivitySource;
  editable: boolean;
  rawTx?: Transaction;
  extraPayment?: ExtraPayment;
  detail?: string; // human-readable explanation shown in detail sheet
  pending?: boolean;
  rawPending?: PendingBankTransaction;
  pendingMatchLabel?: string;
  debtName?: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MONTH_NAMES_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function formatActivityMoney(value: number) {
  return Math.abs(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function activityItemCountsInCashFlow(
  item: ActivityItem,
  connectedAccounts: Parameters<typeof isCheckingBalanceTransaction>[1],
) {
  if (item.source === "transfer") return false;
  if (item.rawTx && !isCashFlowTransaction(item.rawTx)) return false;
  if (
    item.rawTx &&
    item.rawTx.amount > 0 &&
    !isCheckingBalanceTransaction(item.rawTx, connectedAccounts)
  )
    return false;
  return true;
}

const SOURCE_META: Record<
  ActivitySource,
  {
    label: string;
    icon: React.ComponentProps<typeof Feather>["name"];
    color: string;
    description: string;
  }
> = {
  transaction: {
    label: "Manual",
    icon: "edit-3",
    color: "#6366f1",
    description: "Manually recorded transaction",
  },
  bank_transaction: {
    label: "Bank",
    icon: "credit-card",
    color: "#0f9b8e",
    description: "Imported securely from your connected bank",
  },
  bill_payment: {
    label: "Bill",
    icon: "file-text",
    color: "#f0b429",
    description: "Bill marked as paid in Monthly view",
  },
  income: {
    label: "Income",
    icon: "trending-up",
    color: "#22c55e",
    description: "Scheduled income occurrence",
  },
  extra_payment: {
    label: "Debt plan",
    icon: "zap",
    color: "#3b82f6",
    description: "Planned extra payment toward debt",
  },
  transfer: {
    label: "Transfer",
    icon: "repeat",
    color: "#64748b",
    description: "Reviewed movement between your accounts",
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return `${MONTH_NAMES_LONG[m - 1]} ${d}, ${y}`;
}

function formatDateLong(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return `${MONTH_NAMES_LONG[m - 1]} ${d}, ${y}`;
}

function activityMonthLabel(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  return `${MONTH_NAMES_LONG[month - 1]} ${year}`;
}

function todayIsoDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function nextDebtNameAfterPayment(
  debts: Bill[],
  debt: Bill,
  balanceAfter?: number,
) {
  if (balanceAfter === undefined || balanceAfter > 0.005) return undefined;
  return debts
    .filter(
      (item) =>
        item.is_debt && item.id !== debt.id && Number(item.balance) > 0.005,
    )
    .sort(
      (left, right) =>
        Number(left.balance) - Number(right.balance) ||
        left.name.localeCompare(right.name),
    )[0]?.name;
}

function groupByMonth(
  items: ActivityItem[],
): { title: string; data: ActivityItem[] }[] {
  const map = new Map<string, ActivityItem[]>();
  for (const item of items) {
    const [y, m] = item.date.split("-");
    const key = `${MONTH_NAMES_LONG[parseInt(m, 10) - 1]} ${y}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(item);
  }
  return Array.from(map.entries()).map(([title, data]) => ({ title, data }));
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function TransactionsScreen() {
  const { settings } = useBudget();
  return settings.zeroBasedBudgetEnabled ? (
    <CategoryBudgetScreen embedded />
  ) : (
    <ActivityScreen />
  );
}

export function ActivityScreen() {
  const c = useColors();
  const isDesktop = useDesktopExperience();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const params = useLocalSearchParams<{
    editDebtPaymentId?: string;
    editDebtPaymentAt?: string;
    pendingId?: string;
    pendingAt?: string;
    activityId?: string;
    activityAt?: string;
    activityDate?: string;
    search?: string;
    category?: string;
    range?: string;
    add?: string;
  }>();
  const { isFeatureLocked, bypassFeature } = useMembership();
  const {
    transactions,
    pendingBankTransactions,
    pendingPlanMatches,
    addTransaction,
    updateTransaction,
    deleteTransaction,
    deleteTransfer,
    bills,
    incomes,
    goals,
    overrides,
    extraPayments,
    categories,
    settings,
    accounts,
    connectedBankAccounts,
    transactionAccountIdentities,
    householdTimeZone,
    getIncomeOccurrencesInMonth,
    getMonthlyBills,
    getBillOccurrencesInMonth,
    getBillMonthlyTotal,
    getBillEffectiveMonthlyTotal,
    getPaidAmount,
    getRemainingDebtPlanForMonth,
    matchTransactionToBill,
    unmatchTransactionFromBill,
    matchPendingTransactionToBill,
    matchPendingTransactionToManual,
    removePendingPlanMatch,
    reconcileTransaction,
    undoTransactionReconciliation,
    removeReviewSurplusFunding,
    getExtraPayment,
    previewDebtSnowball,
    applyDebtSnowballPayment,
    removeDebtSnowballPayment,
    createSpendingBucketForTransaction,
    addGoal,
    addBill,
    deleteBillMistake,
    activeHousehold,
    demoMode,
  } = useBudget();

  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editTx, setEditTx] = useState<Transaction | null>(null);
  const [debtPaymentNotice, setDebtPaymentNotice] =
    useState<DebtPaymentAppliedDetail | null>(null);
  const [detailItem, setDetailItem] = useState<ActivityItem | null>(null);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [rangeFilter, setRangeFilter] = useState<ActivityRangeId>("this_month");
  const [customStartDate, setCustomStartDate] = useState("");
  const [customEndDate, setCustomEndDate] = useState("");
  const [search, setSearch] = useState("");
  const activityPreferenceReadyRef = useRef(false);
  const [filterModalVisible, setFilterModalVisible] = useState(false);

  useEffect(() => {
    if (!user || !activeHousehold || demoMode) return;
    activityPreferenceReadyRef.current = false;
    let active = true;
    void readInterfacePreferences(user.id, activeHousehold.householdId).then(
      (preferences) => {
        if (!active) return;
        const saved = preferences.activity;
        if (saved) {
          if (isActivityRangeId(saved.range)) setRangeFilter(saved.range);
          else if (saved.range && /^\d{4}-\d{2}$/.test(saved.range)) {
            setRangeFilter("custom");
            const [year, month] = saved.range.split("-").map(Number);
            setCustomStartDate(`${saved.range}-01`);
            setCustomEndDate(
              `${saved.range}-${String(new Date(year, month, 0).getDate()).padStart(2, "0")}`,
            );
          }
          if (saved.startDate) setCustomStartDate(saved.startDate);
          if (saved.endDate) setCustomEndDate(saved.endDate);
          if (saved.search) setSearch(saved.search);
          if (saved.category) setCategoryFilter(saved.category);
          if (
            saved.type === "all" ||
            saved.type === "expense" ||
            saved.type === "income"
          )
            setTypeFilter(saved.type);
          if (
            saved.account === "all" ||
            Object.hasOwn(SOURCE_META, saved.account ?? "")
          )
            setSourceFilter(saved.account as SourceFilter);
          if (saved.sort === "asc" || saved.sort === "desc")
            setSortOrder(saved.sort);
        }
        if (
          params.activityDate &&
          /^\d{4}-\d{2}-\d{2}$/.test(params.activityDate)
        ) {
          setRangeFilter("custom");
          setCustomStartDate(params.activityDate);
          setCustomEndDate(params.activityDate);
        } else if (params.range && isActivityRangeId(params.range)) {
          setRangeFilter(params.range);
        }
        if (params.search) setSearch(params.search);
        if (params.category) setCategoryFilter(params.category);
        activityPreferenceReadyRef.current = true;
      },
    );
    return () => {
      active = false;
    };
  }, [
    activeHousehold?.householdId,
    params.activityAt,
    params.activityDate,
    params.category,
    params.range,
    params.search,
    user?.id,
  ]);

  const addRequestRef = useRef("");
  useEffect(() => {
    const requested = Array.isArray(params.add) ? params.add[0] : params.add;
    if (requested !== "1") return;
    const token = `${requested}:${Date.now()}`;
    if (addRequestRef.current === token) return;
    addRequestRef.current = token;
    setEditTx(null);
    setEditModalVisible(true);
    router.setParams({ add: "" } as never);
  }, [params.add, router]);

  useEffect(() => {
    if (!user || !activeHousehold || !activityPreferenceReadyRef.current)
      return;
    const timer = setTimeout(() => {
      void updateInterfacePreferences(user.id, activeHousehold.householdId, {
        activity: {
          range: rangeFilter,
          startDate: customStartDate,
          endDate: customEndDate,
          search,
          account: sourceFilter,
          category: categoryFilter,
          type: typeFilter,
          sort: sortOrder,
        },
      });
    }, 180);
    return () => clearTimeout(timer);
  }, [
    activeHousehold?.householdId,
    categoryFilter,
    customEndDate,
    customStartDate,
    rangeFilter,
    search,
    sortOrder,
    sourceFilter,
    typeFilter,
    user?.id,
  ]);
  const [weeklySummaryVisible, setWeeklySummaryVisible] = useState(false);
  const [matchTx, setMatchTx] = useState<Transaction | null>(null);
  const [unplannedChargeTx, setUnplannedChargeTx] =
    useState<Transaction | null>(null);
  const [forgottenBillVisible, setForgottenBillVisible] = useState(false);
  const [pendingMatchTx, setPendingMatchTx] =
    useState<PendingBankTransaction | null>(null);
  const [savingMatch, setSavingMatch] = useState(false);
  const [fullPaymentPrompt, setFullPaymentPrompt] =
    useState<MatchedPaymentPrompt | null>(null);
  const [queuedFullPaymentPrompt, setQueuedFullPaymentPrompt] =
    useState<MatchedPaymentPrompt | null>(null);
  const [surplusPrompt, setSurplusPrompt] =
    useState<MatchedPaymentPrompt | null>(null);
  const [queuedSurplusPrompt, setQueuedSurplusPrompt] =
    useState<MatchedPaymentPrompt | null>(null);
  const [surplusPaymentDate, setSurplusPaymentDate] = useState(todayIsoDate());
  const [surplusRouteMode, setSurplusRouteMode] = useState<"next" | "date">(
    "next",
  );
  const [editExtraPayment, setEditExtraPayment] = useState<ExtraPayment | null>(
    null,
  );
  const [editExtraAmount, setEditExtraAmount] = useState("");
  const [editExtraDate, setEditExtraDate] = useState("");
  const [editExtraPreview, setEditExtraPreview] =
    useState<SnowballProjectionResult | null>(null);
  const [savingExtraPayment, setSavingExtraPayment] = useState(false);
  const [pendingBucketDraft, setPendingBucketDraft] = useState<{
    transactionId?: string;
    name: string;
    amount: number;
    date: string;
  } | null>(null);
  const handledExtraPaymentRouteRef = useRef("");
  const handledPendingRouteRef = useRef("");
  const handledActivityRouteRef = useRef("");
  useBackDismiss(!!detailItem, () => setDetailItem(null));
  useBackDismiss(filterModalVisible, () => setFilterModalVisible(false));
  useBackDismiss(weeklySummaryVisible, () => setWeeklySummaryVisible(false));
  useBackDismiss(!!matchTx, () => setMatchTx(null));
  useBackDismiss(!!pendingMatchTx, () => setPendingMatchTx(null));

  useEffect(() => {
    if (matchTx || fullPaymentPrompt || !queuedFullPaymentPrompt) return;
    const timer = setTimeout(() => {
      setFullPaymentPrompt(queuedFullPaymentPrompt);
      setQueuedFullPaymentPrompt(null);
    }, MODAL_HANDOFF_DELAY_MS);
    return () => clearTimeout(timer);
  }, [fullPaymentPrompt, matchTx, queuedFullPaymentPrompt]);

  useEffect(() => {
    if (fullPaymentPrompt || surplusPrompt || !queuedSurplusPrompt) return;
    const timer = setTimeout(() => {
      setSurplusPrompt(queuedSurplusPrompt);
      setQueuedSurplusPrompt(null);
    }, MODAL_HANDOFF_DELAY_MS);
    return () => clearTimeout(timer);
  }, [fullPaymentPrompt, queuedSurplusPrompt, surplusPrompt]);

  const webTopPad = Platform.OS === "web" ? 4 : 0;
  const activityTopInset =
    Platform.OS === "android" ? Math.max(insets.top, 28) : insets.top;
  const listBottomPadding = insets.bottom + (Platform.OS === "web" ? 128 : 118);
  const activeDateRange = useMemo(
    () =>
      resolveActivityDateRange(
        rangeFilter,
        new Date(),
        customStartDate,
        customEndDate,
      ),
    [customEndDate, customStartDate, rangeFilter],
  );
  const currentActivityMonth = todayIsoDate().slice(0, 7);
  const monthFilter =
    activeDateRange.startDate?.slice(0, 7) ?? currentActivityMonth;
  // BudgetContext already loads the complete, account-aware transaction ledger
  // with keyset paging. Re-querying its first 100 rows here delayed Activity,
  // duplicated network/JSON work, and made totals look artificially partial.
  const activityTransactions = useMemo(() => {
    return selectFlowLedgerTransactions(
      transactions,
      transactionAccountIdentities,
    ).included;
  }, [transactionAccountIdentities, transactions]);

  const activityAccountIdentityById = useMemo(() => {
    const byId = new Map<string, (typeof transactionAccountIdentities)[number]>();
    [...transactionAccountIdentities]
      .sort(
        (left, right) => Number(left.is_active) - Number(right.is_active),
      )
      .forEach((account) => {
        byId.set(account.id, account);
        if (account.plaid_account_id)
          byId.set(account.plaid_account_id, account);
      });
    return byId;
  }, [transactionAccountIdentities]);

  const historyHasMore = false;

  // ── Build unified activity feed ───────────────────────────────────────────
  const allActivity = useMemo((): ActivityItem[] => {
    const items: ActivityItem[] = [];
    const today = new Date();
    const currentMonth = today.getMonth();
    const currentYear = today.getFullYear();
    const snowballMatches = matchedOccurrenceAllocations(
      activityTransactions,
      "extra_principal",
      "snowball",
    );
    const confirmedBillMatchKeys = new Set(
      activityTransactions
        .filter(isConfirmedBillMatch)
        .flatMap((transaction) => {
          const billId = confirmedBillMatchId(transaction);
          if (!billId) return [];
          const [year, month] = (
            confirmedBillMatchOccurrenceDate(transaction) ?? transaction.date
          )
            .split("-")
            .map(Number);
          return [`${billId}:${year}:${month - 1}`];
        }),
    );

    // Pending Plaid rows are previews only. They stay outside the authoritative
    // transaction list so forecasts, reports, matching, and totals cannot count them.
    const livePendingMatches = activePendingPlanMatches(
      pendingPlanMatches,
      pendingBankTransactions,
    );
    for (const pending of pendingBankTransactions) {
      const pendingMatch = livePendingMatches.find(
        (match) =>
          match.pending_plaid_transaction_id === pending.plaid_transaction_id,
      );
      items.push({
        id: `pending-${pending.plaid_transaction_id}`,
        date: pending.transaction_date,
        amount: pending.amount,
        label: pending.merchant_name || pending.name,
        category: pending.category || "Other",
        source: "bank_transaction",
        editable: false,
        pending: true,
        rawPending: pending,
        pendingMatchLabel: pendingMatch
          ? pendingMatchStatusLabel(pendingMatch)
          : undefined,
        detail: pendingMatch
          ? `${pendingMatchStatusLabel(pendingMatch)} for ${pendingMatch.target_name}. It is not paid or counted until the bank posts it.`
          : "Pending at your bank. FlowLedger is showing this as a preview and will not count it until it posts.",
      });
    }

    // 1. Manual and bank transactions. Confirmed matches are presented as
    // the actual bill payment instead of a second, separate expense.
    for (const tx of activityTransactions) {
      const matchedBillId = confirmedBillMatchId(tx);
      const matchedBill = matchedBillId
        ? bills.find((bill) => bill.id === matchedBillId)
        : undefined;
      const confirmedMatch = Boolean(matchedBill && isConfirmedBillMatch(tx));
      const matchedIncome = tx.linked_income_id
        ? incomes.find((income) => income.id === tx.linked_income_id)
        : undefined;
      const selectedDebt = transactionDebt(tx, bills);
      const allocationDetail = (tx.review_allocations ?? [])
        .map((allocation) => {
          if (
            allocation.type === "bill" ||
            allocation.type === "income" ||
            allocation.type === "planned_expense"
          )
            return `${allocation.name ?? allocation.type} $${allocation.amount.toFixed(2)}`;
          if (allocation.type === "extra_principal")
            return `Extra principal $${allocation.amount.toFixed(2)}`;
          if (allocation.type === "category")
            return `${allocation.category ?? "Other"} $${allocation.amount.toFixed(2)}`;
          return `Transfer $${allocation.amount.toFixed(2)}`;
        })
        .join(" · ");
      const source: ActivitySource = confirmedMatch
        ? "bill_payment"
        : matchedIncome
          ? "income"
          : tx.review_status === "transfer"
            ? "transfer"
            : tx.source === "plaid"
              ? "bank_transaction"
              : "transaction";
      items.push({
        id: `tx-${tx.id}`,
        date: tx.date,
        amount: tx.amount,
        label: transactionDisplayName(
          tx,
          confirmedMatch ? matchedBill!.name : matchedIncome?.name,
        ),
        category: confirmedMatch
          ? matchedBill!.category
          : matchedIncome
            ? "Income"
            : tx.category,
        source,
        editable: true,
        rawTx: tx,
        debtName: selectedDebt?.name,
        detail:
          allocationDetail ||
          (tx.note ? `${tx.note} · ${tx.category}` : tx.category),
      });
    }

    // 2. Bill payments — overrides where paid_amount > 0
    for (const override of overrides) {
      const bill = bills.find((b) => b.id === override.bill_id);
      if (!bill) continue;
      if (
        confirmedBillMatchKeys.has(
          `${override.bill_id}:${override.year}:${override.month}`,
        )
      )
        continue;
      const extraApplied = extraPayments
        .filter(
          (ep) => ep.month === override.month && ep.year === override.year,
        )
        .flatMap((ep) => ep.allocations)
        .filter((allocation) => allocation.billId === override.bill_id)
        .reduce((sum, allocation) => sum + allocation.payment, 0);
      const regularPaid = Math.max(0, override.paid_amount - extraApplied);
      if (regularPaid <= 0) continue;
      const dueDay = override.custom_due_day ?? bill.due_day;
      const daysInMonth = new Date(
        override.year,
        override.month + 1,
        0,
      ).getDate();
      const day = Math.min(dueDay, daysInMonth);
      const date =
        override.paid_date ??
        `${override.year}-${String(override.month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      items.push({
        id: `bill-${override.id}`,
        date,
        amount: -regularPaid,
        label: bill.name,
        category: bill.category,
        source: "bill_payment",
        editable: false,
        detail: `${regularPaid.toFixed(2)} paid on ${MONTH_NAMES_LONG[override.month]} ${day}, ${override.year}`,
      });
    }

    // 3. Income occurrences — past 24 months plus every occurrence in the current month.
    // Matched deposits replace their planned occurrence instead of being added twice.
    const incomeOccurrenceMatches = matchedOccurrenceAllocations(
      activityTransactions,
      "income",
    );
    for (let i = 24; i >= 0; i--) {
      const totalMonths = currentYear * 12 + currentMonth - i;
      const m = totalMonths % 12;
      const y = Math.floor(totalMonths / 12);
      const occurrences = getIncomeOccurrencesInMonth(m, y);
      for (const { income, days, effectiveAmount } of occurrences) {
        for (const day of days) {
          const date = `${y}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const match = incomeOccurrenceMatches.get(
            occurrenceKey(income.id, date),
          );
          const remaining = !match
            ? effectiveAmount
            : match.settlement === "partial"
              ? Math.max(
                  0,
                  Number(match.plannedAmount ?? effectiveAmount) -
                    Number(match.amount || 0),
                )
              : 0;
          if (remaining <= 0.005) continue;
          items.push({
            id: `income-${income.id}-${date}`,
            date,
            amount: remaining,
            label: income.name,
            category: "Income",
            source: "income",
            editable: false,
            detail: `${income.frequency.charAt(0).toUpperCase() + income.frequency.slice(1)} income — $${remaining.toFixed(2)} on ${formatDateLong(date)}`,
          });
        }
      }
    }

    // 4. Extra debt payments
    for (const ep of extraPayments) {
      const date =
        ep.payment_date ??
        `${ep.year}-${String(ep.month + 1).padStart(2, "0")}-01`;
      const remainingAllocations = ep.allocations
        .map((allocation) => {
          const match = snowballMatches.get(
            occurrenceKey(allocation.billId, date),
          );
          const remaining = !match
            ? allocation.payment
            : match.settlement === "partial"
              ? Math.max(
                  0,
                  Number(match.plannedAmount ?? allocation.payment) -
                    Number(match.amount || 0),
                )
              : 0;
          return { ...allocation, payment: remaining };
        })
        .filter((allocation) => allocation.payment > 0.005);
      const remainingAmount = remainingAllocations.reduce(
        (sum, allocation) => sum + allocation.payment,
        0,
      );
      if (remainingAmount <= 0.005) continue;
      const names = remainingAllocations.map((a) => a.billName).join(", ");
      const funding = (ep.sources ?? [])
        .map((source) =>
          source.type === "bill_surplus"
            ? `${source.billName ?? "bill"} surplus`
            : source.type === "bucket_remainder"
              ? `${source.bucketName ?? "Spending"} bucket remainder`
              : "manual safe extra",
        )
        .join(", ");
      const status = debtPaymentStatusLabel(
        date,
        (ep.sources ?? []).some((source) => source.pendingBalanceApply),
      );
      items.push({
        id: `extra-${ep.id}`,
        date,
        amount: -remainingAmount,
        label: names || "Extra debt payment",
        category: "Debt",
        source: "extra_payment",
        editable: true,
        extraPayment: ep,
        detail: `$${remainingAmount.toFixed(2)} ${status} ${status === "scheduled" ? "for" : "to"} ${names || "debt accounts"} on ${formatDateLong(date)}${funding ? ` · Funded by ${funding}` : ""}`,
      });
    }

    return items;
  }, [
    activityTransactions,
    pendingBankTransactions,
    pendingPlanMatches,
    overrides,
    bills,
    incomes,
    extraPayments,
    getIncomeOccurrencesInMonth,
  ]);

  useEffect(() => {
    const pendingId = params.pendingId;
    if (!pendingId) return;
    const requestKey = `${pendingId}:${params.pendingAt ?? ""}`;
    if (handledPendingRouteRef.current === requestKey) return;
    const pendingItem = allActivity.find(
      (item) => item.rawPending?.plaid_transaction_id === pendingId,
    );
    if (!pendingItem) return;
    handledPendingRouteRef.current = requestKey;
    setDetailItem(pendingItem);
  }, [allActivity, params.pendingAt, params.pendingId]);

  // ── Filter & sort ─────────────────────────────────────────────────────────
  const categoryOptions = useMemo(
    () =>
      Array.from(new Set(allActivity.map((t) => t.category))).sort((a, b) =>
        a.localeCompare(b),
      ),
    [allActivity],
  );

  const activeFilterCount = [
    rangeFilter !== "this_month",
    typeFilter !== "all",
    sourceFilter !== "all",
    categoryFilter !== "all",
    sortOrder !== "desc",
  ].filter(Boolean).length;

  const hasActiveFilters = activeFilterCount > 0 || search.trim().length > 0;

  const clearFilterSelections = () => {
    setRangeFilter("this_month");
    setCustomStartDate("");
    setCustomEndDate("");
    setTypeFilter("all");
    setSourceFilter("all");
    setCategoryFilter("all");
    setSortOrder("desc");
  };

  const clearFilters = () => {
    clearFilterSelections();
    setSearch("");
  };

  const filtered = useMemo(() => {
    const today = todayIsoDate();
    let list = allActivity.filter(
      (item) =>
        dateIsInActivityRange(item.date, activeDateRange) &&
        (item.pending || item.date <= today),
    );
    if (typeFilter === "expense") list = list.filter((t) => t.amount < 0);
    if (typeFilter === "income") list = list.filter((t) => t.amount > 0);
    if (sourceFilter !== "all")
      list = list.filter((t) => t.source === sourceFilter);
    if (categoryFilter !== "all")
      list = list.filter((t) => t.category === categoryFilter);

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (t) =>
          t.label.toLowerCase().includes(q) ||
          t.category.toLowerCase().includes(q) ||
          SOURCE_META[t.source].label.toLowerCase().includes(q),
      );
    }
    list.sort((a, b) =>
      sortOrder === "asc"
        ? a.date.localeCompare(b.date)
        : b.date.localeCompare(a.date),
    );
    return list;
  }, [
    allActivity,
    activeDateRange,
    typeFilter,
    sourceFilter,
    categoryFilter,
    search,
    sortOrder,
  ]);

  const sections = useMemo(() => groupByMonth(filtered), [filtered]);

  const runningBalanceById = useMemo(() => {
    const today = todayIsoDate();
    if (historyHasMore)
      return new Map<string, number>();
    const hasConnectedChecking = connectedBankAccounts.some(
      (account) => account.is_active && account.account_subtype === "checking",
    );
    const manualChecking = accounts.filter(
      (account) => account.is_active && account.account_type === "checking",
    );
    const manualObservationDates = Array.from(
      new Set(manualChecking.map((account) => account.balance_as_of)),
    );
    const manualAnchor =
      manualChecking.length > 0 && manualObservationDates.length === 1
        ? {
            balance: manualChecking.reduce(
              (sum, account) => sum + account.current_balance,
              0,
            ),
            date: manualObservationDates[0],
          }
        : null;
    const balanceAnchor = hasConnectedChecking
      ? connectedCheckingObservedAnchor(
          connectedBankAccounts,
          householdTimeZone,
        )
      : manualAnchor;
    if (
      !balanceAnchor ||
      (activeDateRange.startDate &&
        activeDateRange.startDate > balanceAnchor.date) ||
      (activeDateRange.endDate && activeDateRange.endDate < today)
    )
      return new Map<string, number>();
    const authoritativeCheckingLedger = activityTransactions
      .filter(
        (transaction) =>
          transaction.date <= today &&
          activityTransactionUsesCheckingLedger(
            transaction,
            accounts,
            isCheckingBalanceTransaction(
              transaction,
              transactionAccountIdentities,
            ),
          ),
      )
      .map((transaction) => ({
        id: `tx-${transaction.id}`,
        date: transaction.date,
        amount: transaction.amount,
      }));
    return activityRunningBalancesFromDatedAnchor(
      balanceAnchor,
      authoritativeCheckingLedger,
    );
  }, [
    accounts,
    activeDateRange.endDate,
    activeDateRange.startDate,
    activityTransactions,
    connectedBankAccounts,
    historyHasMore,
    householdTimeZone,
    transactionAccountIdentities,
  ]);

  const exportVisibleActivity = useCallback(() => {
    const exported = exportActivityCsv(
      filtered.map((item) => ({
        date: item.date,
        description: item.label,
        category: item.category,
        account: item.rawTx?.account_id
          ? accounts.find((account) => account.id === item.rawTx?.account_id)
              ?.name
          : item.rawTx?.plaid_account_id
            ? (activityAccountIdentityById.get(
                item.rawTx.plaid_account_id,
              )?.display_name ??
              activityAccountIdentityById.get(item.rawTx.plaid_account_id)
                ?.name)
            : undefined,
        amount: item.amount,
        type: SOURCE_META[item.source].label,
        appliedDebt: item.debtName,
        note: item.rawTx?.note,
        runningBalance: runningBalanceById.get(item.id),
      })),
    );
    if (!exported)
      Alert.alert(
        "CSV export",
        "CSV export is available in the website and installed web app.",
      );
  }, [accounts, activityAccountIdentityById, filtered, runningBalanceById]);

  const activityReviewCount = useMemo(
    () => buildReviewQueue(transactions, todayIsoDate()).length,
    [transactions],
  );
  const unmatchedPendingActivity = useMemo(
    () =>
      unmatchedPendingTransactions(
        pendingPlanMatches,
        pendingBankTransactions,
      ).filter((transaction) => Number(transaction.amount) < -0.005),
    [pendingBankTransactions, pendingPlanMatches],
  );
  const pendingActivityCount = unmatchedPendingActivity.length;

  // ── Summary stats ─────────────────────────────────────────────────────────
  const monthSummaryBasis = useMemo(() => {
    const [year, monthNumber] = monthFilter.split("-").map(Number);
    const monthIndex = monthNumber - 1;
    const debtPlan = getRemainingDebtPlanForMonth(monthIndex, year);
    const plannedBillEntries = getMonthlyBills(monthIndex, year)
      .filter(isBillEligibleForUpcomingPlan)
      .filter((bill) => !bill.is_debt || !debtPlan)
      .flatMap((bill) => {
        const occurrenceDays = getBillOccurrencesInMonth(
          bill,
          monthIndex,
          year,
        );
        const monthlyTotal = getBillEffectiveMonthlyTotal(
          bill,
          monthIndex,
          year,
        );
        if (occurrenceDays.length === 0 || monthlyTotal <= 0.005) return [];
        const amountPerOccurrence = monthlyTotal / occurrenceDays.length;
        return occurrenceDays.map((day) => ({
          date: `${monthFilter}-${String(day).padStart(2, "0")}`,
          amount: -amountPerOccurrence,
        }));
      });
    const plannedDebtEntries =
      debtPlan?.allocations.map((allocation) => ({
        date: allocation.date,
        amount: -allocation.amount,
      })) ?? [];
    const paidDebtEntries = debtPlan
      ? getMonthlyBills(monthIndex, year)
          .filter((bill) => bill.is_debt)
          .flatMap((bill) => {
            const paid = getPaidAmount(bill.id, monthIndex, year);
            if (paid <= 0.005) return [];
            const override = overrides.find(
              (item) =>
                item.bill_id === bill.id &&
                item.month === monthIndex &&
                item.year === year,
            );
            const fallbackDay =
              getBillOccurrencesInMonth(bill, monthIndex, year)[0] ??
              bill.due_day;
            return [
              {
                date:
                  override?.paid_date ??
                  `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(fallbackDay).padStart(2, "0")}`,
                amount: -paid,
              },
            ];
          })
      : [];
    const summary = summarizeActivityMonth(
      [
        ...allActivity.map((item) => ({
          date: item.date,
          amount: item.rawTx
            ? activityAmountOutsidePlannedBill(
                item.amount,
                isConfirmedBillMatch(item.rawTx),
                item.rawTx.review_allocations,
              )
            : item.amount,
          pending: item.pending,
          excludeFromCashFlow:
            (item.source === "bill_payment" && !item.rawTx) ||
            item.source === "transfer" ||
            Boolean(item.rawTx && !isCashFlowTransaction(item.rawTx)) ||
            Boolean(
              item.rawTx &&
              item.rawTx.amount > 0 &&
              !isCheckingBalanceTransaction(
                item.rawTx,
                transactionAccountIdentities,
              ),
            ),
        })),
        ...plannedBillEntries,
        ...plannedDebtEntries,
        ...paidDebtEntries,
      ],
      year,
      monthIndex,
    );
    return {
      title: activityMonthLabel(monthFilter),
      ...summary,
      weeks: summary.weeks.map((week) => ({
        ...week,
        label:
          week.startDay === week.endDay
            ? `${MONTH_NAMES_LONG[monthIndex]} ${week.startDay}`
            : `${MONTH_NAMES_LONG[monthIndex]} ${week.startDay}–${week.endDay}`,
      })),
    };
  }, [
    allActivity,
    getBillEffectiveMonthlyTotal,
    getBillOccurrencesInMonth,
    getMonthlyBills,
    getPaidAmount,
    getRemainingDebtPlanForMonth,
    monthFilter,
    overrides,
    transactionAccountIdentities,
  ]);

  const usesCompletePlannedSummary =
    (rangeFilter === "this_month" || rangeFilter === "last_month") &&
    typeFilter === "all" &&
    sourceFilter === "all" &&
    categoryFilter === "all" &&
    search.trim().length === 0;
  const activitySummaryIsPartial =
    historyHasMore && !usesCompletePlannedSummary;
  const feedOrderLabel =
    sortOrder === "asc"
      ? historyHasMore
        ? "oldest loaded first"
        : "oldest first"
      : "newest first";

  const activitySummary = useMemo(() => {
    const cashRows = filtered.map((item) => ({
      date: item.date,
      amount: item.amount,
      pending: item.pending,
      source: activityItemCountsInCashFlow(item, transactionAccountIdentities)
        ? item.source
        : "transfer",
    }));
    const summary = summarizeActivitySnapshot(
      cashRows,
      usesCompletePlannedSummary ? monthSummaryBasis : undefined,
    );
    const weekRows = new Map<string, typeof cashRows>();
    cashRows.forEach((item) => {
      const [year, month, day] = item.date.slice(0, 10).split("-").map(Number);
      const date = new Date(year, month - 1, day, 12);
      date.setDate(date.getDate() - date.getDay());
      const key = dateOnly(date);
      weekRows.set(key, [...(weekRows.get(key) ?? []), item]);
    });
    return {
      title: activeDateRange.label,
      ...summary,
      latestWeeksOnly: !usesCompletePlannedSummary && weekRows.size > 12,
      weeks:
        usesCompletePlannedSummary
          ? monthSummaryBasis.weeks
          : Array.from(weekRows.entries())
              .sort(([left], [right]) => right.localeCompare(left))
              .slice(0, 12)
              .map(([start, rows]) => {
                const startDate = new Date(`${start}T12:00:00`);
                const endDate = new Date(startDate);
                endDate.setDate(endDate.getDate() + 6);
                const weekSummary = summarizeActivityRange(rows);
                return {
                  startDay: startDate.getDate(),
                  endDay: endDate.getDate(),
                  label: `${startDate.toLocaleDateString(undefined, { month: "short", day: "numeric" })}–${endDate.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`,
                  ...weekSummary,
                  total: weekSummary.net,
                };
              }),
    };
  }, [
    activeDateRange.label,
    filtered,
    monthSummaryBasis,
    rangeFilter,
    transactionAccountIdentities,
    usesCompletePlannedSummary,
  ]);

  const reviewAttentionTitle = `${activityReviewCount} ${activityReviewCount === 1 ? "item is" : "items are"} ready to review`;
  const reviewAttentionBody =
    "Confirm posted activity so your plan stays accurate.";
  const pendingAttentionTitle = `${pendingActivityCount} bank ${pendingActivityCount === 1 ? "payment is" : "payments are"} ready to match`;
  const pendingAttentionBody =
    "Choose the bill or Activity entry it is expected to cover. It stays uncounted until it posts.";
  const openFirstUnmatchedPending = () => {
    const pending = unmatchedPendingActivity[0];
    if (!pending) return;
    if (isFeatureLocked("transaction_matching")) {
      Alert.alert(
        "Pending matching is planned for Pro",
        "Pending charges stay visible during Founding Free. Connecting them to bills or manual Activity will arrive with Pro.",
      );
      return;
    }
    setPendingMatchTx(pending);
  };

  const quickChips = [
    {
      key: "all",
      label: "All",
      active: typeFilter === "all" && sourceFilter === "all",
      onPress: () => {
        setTypeFilter("all");
        setSourceFilter("all");
      },
    },
    {
      key: "in",
      label: "Inflows",
      active: typeFilter === "income" && sourceFilter === "all",
      onPress: () => {
        setTypeFilter("income");
        setSourceFilter("all");
      },
    },
    {
      key: "out",
      label: "Outflows",
      active: typeFilter === "expense" && sourceFilter === "all",
      onPress: () => {
        setTypeFilter("expense");
        setSourceFilter("all");
      },
    },
    {
      key: "bills",
      label: "Bills",
      active: sourceFilter === "bill_payment",
      onPress: () => {
        setTypeFilter("all");
        setSourceFilter("bill_payment");
      },
    },
    {
      key: "manual",
      label: "Manual",
      active: sourceFilter === "transaction",
      onPress: () => {
        setTypeFilter("all");
        setSourceFilter("transaction");
      },
    },
    {
      key: "bank",
      label: "Bank",
      active: sourceFilter === "bank_transaction",
      onPress: () => {
        setTypeFilter("all");
        setSourceFilter("bank_transaction");
      },
    },
    {
      key: "debt",
      label: "Debt pay",
      active: sourceFilter === "extra_payment",
      onPress: () => {
        setTypeFilter("all");
        setSourceFilter("extra_payment");
      },
    },
  ];

  const showTransactionDebtNotice = (
    tx: Omit<Transaction, "id"> | Transaction,
  ) => {
    const linkedDebtId = tx.linked_bill_id ?? tx.debt_applied_bill_id;
    if (!linkedDebtId) return;
    const debt = bills.find((item) => item.id === linkedDebtId);
    if (!debt?.is_debt) return;
    const amount = Math.abs(Number(tx.debt_applied_amount ?? tx.amount) || 0);
    if (amount <= 0.005 || Number(tx.amount) > 0) return;
    const scheduled = tx.date > todayIsoDate();
    const balanceBefore = Math.max(0, Number(debt.balance) || 0);
    const balanceAfter = scheduled
      ? undefined
      : Math.max(0, balanceBefore - amount);
    setDebtPaymentNotice({
      debtName: debt.name,
      amount,
      paymentDate: tx.date,
      scheduled,
      balanceBefore,
      balanceAfter,
      rolledToDebtName: nextDebtNameAfterPayment(bills, debt, balanceAfter),
    });
  };

  const handleSave = async (data: Omit<Transaction, "id"> | Transaction) => {
    if ("id" in data) await updateTransaction(data as Transaction);
    else await addTransaction(data);
    showTransactionDebtNotice(data);
  };

  const handleDelete = async (id: string) => {
    await deleteTransaction(id);
    setEditModalVisible(false);
    setEditTx(null);
  };

  const handleDeleteTransfer = async (transferGroupId: string) => {
    await deleteTransfer(transferGroupId);
    setEditModalVisible(false);
    setEditTx(null);
  };

  const billMatchOptions = useMemo(() => {
    if (!matchTx) return [];
    const candidates = adjacentBillMatchCandidates(
      matchTx.date,
      getMonthlyBills,
      getBillOccurrencesInMonth,
      getBillMonthlyTotal,
    );
    return rankBillMatches(
      {
        date: matchTx.date,
        amount: matchTx.amount,
        description: matchTx.merchant_name || matchTx.note || matchTx.category,
        category: matchTx.category,
      },
      candidates,
    );
  }, [
    matchTx,
    getMonthlyBills,
    getBillOccurrencesInMonth,
    getBillMonthlyTotal,
  ]);
  const pendingBillMatchOptions = useMemo(() => {
    if (!pendingMatchTx || pendingMatchTx.amount >= 0) return [];
    const candidates = adjacentBillMatchCandidates(
      pendingMatchTx.transaction_date,
      getMonthlyBills,
      getBillOccurrencesInMonth,
      getBillMonthlyTotal,
    );
    return rankBillMatches(
      {
        date: pendingMatchTx.transaction_date,
        amount: pendingMatchTx.amount,
        description:
          pendingMatchTx.merchant_name ||
          pendingMatchTx.name ||
          pendingMatchTx.category,
        category: pendingMatchTx.category,
      },
      candidates,
    );
  }, [
    pendingMatchTx,
    getMonthlyBills,
    getBillOccurrencesInMonth,
    getBillMonthlyTotal,
  ]);
  const selectedPendingPlanMatch = useMemo(
    () =>
      pendingMatchTx
        ? activePendingPlanMatches(
            pendingPlanMatches,
            pendingBankTransactions,
          ).find(
            (match) =>
              match.pending_plaid_transaction_id ===
              pendingMatchTx.plaid_transaction_id,
          )
        : undefined,
    [pendingBankTransactions, pendingMatchTx, pendingPlanMatches],
  );
  const manualMatchOptions = useMemo(() => {
    if (!matchTx || matchTx.source !== "plaid" || matchTx.amount >= 0)
      return [];
    const candidates = manualActivityMatchCandidates(
      transactions,
      matchTx.date,
      matchTx.id,
    );
    return rankBillMatches(
      {
        date: matchTx.date,
        amount: matchTx.amount,
        description: matchTx.merchant_name || matchTx.note || matchTx.category,
        category: matchTx.category,
      },
      candidates,
    );
  }, [matchTx, transactions]);
  const pendingManualMatchOptions = useMemo(() => {
    if (!pendingMatchTx || pendingMatchTx.amount >= 0) return [];
    return rankBillMatches(
      {
        date: pendingMatchTx.transaction_date,
        amount: pendingMatchTx.amount,
        description:
          pendingMatchTx.merchant_name ||
          pendingMatchTx.name ||
          pendingMatchTx.category,
        category: pendingMatchTx.category,
      },
      manualActivityMatchCandidates(
        transactions,
        pendingMatchTx.transaction_date,
      ),
    );
  }, [pendingMatchTx, transactions]);
  const pendingMatchOptions = useMemo(
    () =>
      [
        ...pendingBillMatchOptions.map((option) => ({
          ...option,
          targetType: "bill" as const,
        })),
        ...pendingManualMatchOptions.map((option) => ({
          ...option,
          targetType: "manual" as const,
        })),
      ].sort(
        (left, right) =>
          right.score - left.score ||
          (left.daysApart ?? 999) - (right.daysApart ?? 999),
      ),
    [pendingBillMatchOptions, pendingManualMatchOptions],
  );
  const bucketMatchOptions = useMemo(() => {
    if (!matchTx || matchTx.amount >= 0) return [];
    const candidates = goals
      .filter(isEligibleSpendingBucketMatch)
      .map((goal) => ({
        billId: goal.id,
        name: goal.name,
        category: "Planned spending",
        plannedAmount: spendingBucketSummary(goal).remaining,
        occurrenceDates: [goal.target_date.slice(0, 10)],
      }));
    return rankBillMatches(
      {
        date: matchTx.date,
        amount: matchTx.amount,
        description: matchTx.merchant_name || matchTx.note || matchTx.category,
        category: matchTx.category,
      },
      candidates,
    );
  }, [goals, matchTx]);
  const combinedMatchOptions = useMemo(
    () =>
      [
        ...billMatchOptions.map((option) => ({
          ...option,
          targetType: "bill" as const,
        })),
        ...bucketMatchOptions.map((option) => ({
          ...option,
          targetType: "bucket" as const,
        })),
        ...manualMatchOptions.map((option) => ({
          ...option,
          targetType: "manual" as const,
        })),
      ].sort(
        (left, right) =>
          right.score - left.score ||
          (left.daysApart ?? 999) - (right.daysApart ?? 999),
      ),
    [billMatchOptions, bucketMatchOptions, manualMatchOptions],
  );
  const matchedBillIdForModal = matchTx ? confirmedBillMatchId(matchTx) : null;
  const matchedBillForModal = matchedBillIdForModal
    ? bills.find((bill) => bill.id === matchedBillIdForModal)
    : undefined;
  const matchedManualAllocation =
    matchTx?.review_resolution === "manual"
      ? matchTx.review_allocations?.find(
          (allocation) =>
            allocation.type === "planned_expense" &&
            allocation.source === "transaction",
        )
      : undefined;
  const matchedBucketAllocation =
    matchTx?.review_resolution === "goal"
      ? matchTx.review_allocations?.find(
          (allocation) =>
            allocation.type === "planned_expense" &&
            allocation.source === "goal",
        )
      : undefined;
  const matchedTargetName =
    matchedBillForModal?.name ??
    matchedManualAllocation?.name ??
    matchedBucketAllocation?.name;
  const matchingBankActivity = matchTx?.source === "plaid";
  const forgottenBillDefaults = useMemo<
    AddBillInitialValues | undefined
  >(() => {
    if (!unplannedChargeTx) return undefined;
    const defaults = buildForgottenBillDefaults(unplannedChargeTx);
    return {
      ...defaults,
      category: categories.includes(defaults.category)
        ? defaults.category
        : "Other",
    };
  }, [categories, unplannedChargeTx]);

  const surplusSnowballOffer = useMemo(() => {
    if (!surplusPrompt || !settings.debtPayoffEnabled) return null;
    const surplus = Math.max(0, surplusPrompt.budgeted - surplusPrompt.actual);
    const existing = getExtraPayment(surplusPrompt.month, surplusPrompt.year);
    const previousSource =
      existing?.sources?.find(
        (source) =>
          source.type === "bill_surplus" &&
          source.billId === surplusPrompt.bill.id,
      )?.amount ?? 0;
    const total = Math.max(
      0,
      (existing?.amount ?? 0) - previousSource + surplus,
    );
    const targetPreview = previewDebtSnowball(
      surplusPrompt.month,
      surplusPrompt.year,
      total,
      surplus - previousSource,
    );
    const targetDebtId = targetPreview.allocations[0]?.billId;
    const nextPayment = nextPlannedDebtPayment(
      getRemainingDebtPlanForMonth(surplusPrompt.month, surplusPrompt.year)
        ?.allocations ?? [],
      targetDebtId,
      surplusPrompt.transaction.date,
    );
    const selectedPaymentDate =
      surplusRouteMode === "next"
        ? (nextPayment?.date ?? "")
        : surplusPaymentDate;
    const dateValid = isValidDateInMonth(
      selectedPaymentDate,
      surplusPrompt.month,
      surplusPrompt.year,
    );
    const preview = previewDebtSnowball(
      surplusPrompt.month,
      surplusPrompt.year,
      total,
      surplus - previousSource,
      dateValid ? selectedPaymentDate : undefined,
    );
    return {
      preview,
      targetDebt:
        preview.months[0]?.targetName ?? preview.allocations[0]?.billName,
      dateValid,
      nextPayment,
      paymentDate: selectedPaymentDate,
      safe: dateValid && preview.selectedExtra + 0.005 >= total,
    };
  }, [
    getExtraPayment,
    getRemainingDebtPlanForMonth,
    previewDebtSnowball,
    settings.debtPayoffEnabled,
    surplusPaymentDate,
    surplusPrompt,
    surplusRouteMode,
  ]);
  const surplusMonth = surplusPrompt?.month ?? new Date().getMonth();
  const surplusYear = surplusPrompt?.year ?? new Date().getFullYear();
  const surplusMonthText = String(surplusMonth + 1).padStart(2, "0");
  const surplusMonthLastDay = String(
    new Date(surplusYear, surplusMonth + 1, 0).getDate(),
  ).padStart(2, "0");

  const handleMatchBill = async (billId: string) => {
    if (!matchTx || savingMatch) return;
    const transaction = matchTx;
    const bill = bills.find((item) => item.id === billId);
    const option = billMatchOptions.find((item) => item.billId === billId);
    const [year, monthNumber] = transaction.date.split("-").map(Number);
    const actual = Math.abs(transaction.amount);
    const occurrenceDate = option?.nearestOccurrenceDate ?? transaction.date;
    const nextFullPaymentPrompt =
      bill &&
      option &&
      isMatchedPaymentLowerThanPlanned(transaction.amount, option.plannedAmount)
        ? {
            transaction,
            bill,
            budgeted: option.plannedAmount,
            actual,
            occurrenceDate,
            month: monthNumber - 1,
            year,
          }
        : null;
    setSavingMatch(true);
    try {
      await matchTransactionToBill(
        transaction.id,
        billId,
        occurrenceDate,
        option?.plannedAmount,
      );
      setQueuedFullPaymentPrompt(nextFullPaymentPrompt);
      setMatchTx(null);
    } catch (error) {
      Alert.alert(
        "Could not match bill",
        error instanceof Error ? error.message : "Please try again.",
      );
    } finally {
      setSavingMatch(false);
    }
  };

  const handleMatchPendingBill = async (billId: string) => {
    if (!pendingMatchTx || savingMatch) return;
    const option = pendingBillMatchOptions.find(
      (item) => item.billId === billId,
    );
    if (!option) return;
    setSavingMatch(true);
    try {
      await matchPendingTransactionToBill(
        pendingMatchTx.plaid_transaction_id,
        billId,
        option.nearestOccurrenceDate ?? pendingMatchTx.transaction_date,
        option.plannedAmount,
      );
      setPendingMatchTx(null);
      setDetailItem(null);
      Alert.alert(
        "Payment pending",
        `${option.name} will not show overdue while this bank charge is pending. Confirm it after it posts.`,
      );
    } catch (error) {
      Alert.alert(
        "Could not match pending payment",
        error instanceof Error ? error.message : "Please try again.",
      );
    } finally {
      setSavingMatch(false);
    }
  };

  const handleMatchPendingManual = async (transactionId: string) => {
    if (!pendingMatchTx || savingMatch) return;
    const option = pendingManualMatchOptions.find(
      (item) => item.billId === transactionId,
    );
    if (!option) return;
    setSavingMatch(true);
    try {
      await matchPendingTransactionToManual(
        pendingMatchTx.plaid_transaction_id,
        transactionId,
      );
      setPendingMatchTx(null);
      setDetailItem(null);
      Alert.alert(
        "Payment pending",
        `${option.name} is linked to this pending charge. It will be replaced by the bank-backed Activity entry after the charge posts and you confirm it.`,
      );
    } catch (error) {
      Alert.alert(
        "Could not match pending payment",
        error instanceof Error ? error.message : "Please try again.",
      );
    } finally {
      setSavingMatch(false);
    }
  };

  const handleRemovePendingMatch = async () => {
    if (!selectedPendingPlanMatch || savingMatch) return;
    setSavingMatch(true);
    try {
      await removePendingPlanMatch(selectedPendingPlanMatch.id);
      setPendingMatchTx(null);
    } catch (error) {
      Alert.alert(
        "Could not remove pending match",
        error instanceof Error ? error.message : "Please try again.",
      );
    } finally {
      setSavingMatch(false);
    }
  };

  const handleMatchManual = async (transactionId: string) => {
    if (!matchTx || savingMatch) return;
    const option = manualMatchOptions.find(
      (item) => item.billId === transactionId,
    );
    if (!option) return;
    const actual = Math.abs(matchTx.amount);
    setSavingMatch(true);
    try {
      await reconcileTransaction({
        transactionId: matchTx.id,
        resolution: "manual",
        targetId: transactionId,
        // The posted bank date becomes the calendar date once it replaces
        // the manually planned item.
        occurrenceDate: matchTx.date,
        plannedAmount: option.plannedAmount,
        settlement:
          Math.abs(actual - option.plannedAmount) < 0.005 ? "exact" : "full",
      });
      setMatchTx(null);
    } catch (error) {
      Alert.alert(
        "Could not match transaction",
        error instanceof Error ? error.message : "Please try again.",
      );
    } finally {
      setSavingMatch(false);
    }
  };

  const handleMatchBucket = async (goalId: string) => {
    if (!matchTx || savingMatch) return;
    const option = bucketMatchOptions.find((item) => item.billId === goalId);
    if (!option) return;
    const actual = Math.abs(matchTx.amount);
    const match = spendingBucketMatch(actual, option.plannedAmount);
    setSavingMatch(true);
    try {
      await reconcileTransaction({
        transactionId: matchTx.id,
        resolution: "goal",
        targetId: goalId,
        occurrenceDate: option.nearestOccurrenceDate ?? matchTx.date,
        plannedAmount: option.plannedAmount,
        settlement: match.settlement,
        extraCategory:
          match.extra > 0.005 ? matchTx.category || "Other" : undefined,
      });
      setMatchTx(null);
    } catch (error) {
      Alert.alert(
        "Could not update bucket",
        error instanceof Error ? error.message : "Please try again.",
      );
    } finally {
      setSavingMatch(false);
    }
  };

  const saveOneTimeCharge = async (category: string) => {
    if (!unplannedChargeTx || savingMatch) return;
    const transaction = unplannedChargeTx;
    setSavingMatch(true);
    try {
      await reconcileTransaction({
        transactionId: transaction.id,
        resolution: "category",
        targetId: category,
      });
      setUnplannedChargeTx(null);
    } catch (error) {
      Alert.alert(
        "Could not save one-time charge",
        error instanceof Error ? error.message : "Please try again.",
      );
    } finally {
      setSavingMatch(false);
    }
  };

  const saveForgottenBill = async (
    data: Omit<Bill, "id" | "created_at"> | Bill,
  ) => {
    if (!unplannedChargeTx)
      throw new Error("This bank charge is no longer available.");
    const transaction = unplannedChargeTx;
    const billData = data as Omit<Bill, "id" | "created_at">;
    const billId = await addBill(billData);
    try {
      await reconcileTransaction({
        transactionId: transaction.id,
        resolution: "bill",
        targetId: billId,
        occurrenceDate: transaction.date,
        plannedAmount: billData.amount,
        settlement: forgottenBillSettlement(
          transaction.amount,
          billData.amount,
        ),
      });
      setForgottenBillVisible(false);
      setUnplannedChargeTx(null);
    } catch (error) {
      try {
        await deleteBillMistake(billId);
      } catch {
        // Preserve the reconciliation error; the new bill remains removable from Bills.
      }
      throw error;
    }
  };

  const confirmMatchedFullPayment = async () => {
    if (!fullPaymentPrompt || savingMatch) return;
    const prompt = fullPaymentPrompt;
    setSavingMatch(true);
    try {
      await reconcileTransaction({
        transactionId: prompt.transaction.id,
        resolution: "bill",
        targetId: prompt.bill.id,
        occurrenceDate: prompt.occurrenceDate,
        plannedAmount: prompt.budgeted,
        settlement: "full",
      });
      setSurplusPaymentDate(prompt.transaction.date);
      setSurplusRouteMode("next");
      setQueuedSurplusPrompt(prompt);
      setFullPaymentPrompt(null);
    } catch (error) {
      Alert.alert(
        "Could not close bill",
        error instanceof Error ? error.message : "Please try again.",
      );
    } finally {
      setSavingMatch(false);
    }
  };

  const keepMatchedSurplusAvailable = async () => {
    if (!surplusPrompt) return;
    try {
      if (!settings.debtPayoffEnabled) {
        setSurplusPrompt(null);
        return;
      }
      const existing = getExtraPayment(surplusPrompt.month, surplusPrompt.year);
      const sources = (existing?.sources ?? []).filter(
        (source) =>
          !(
            source.type === "bill_surplus" &&
            source.billId === surplusPrompt.bill.id
          ),
      );
      if ((existing?.sources?.length ?? 0) !== sources.length) {
        const total = sources.reduce((sum, source) => sum + source.amount, 0);
        if (total > 0.005) {
          await applyDebtSnowballPayment(
            previewDebtSnowball(surplusPrompt.month, surplusPrompt.year, total),
            sources,
          );
        } else {
          await removeDebtSnowballPayment(
            surplusPrompt.month,
            surplusPrompt.year,
          );
        }
      }
      setSurplusPrompt(null);
    } catch (error) {
      Alert.alert(
        "Could not finish bill",
        error instanceof Error ? error.message : "Please try again.",
      );
    }
  };

  const addMatchedSurplusToSnowball = async () => {
    if (
      !surplusPrompt ||
      !surplusSnowballOffer?.safe ||
      !surplusSnowballOffer.preview.allocations.length
    )
      return;
    const surplus = surplusPrompt.budgeted - surplusPrompt.actual;
    const existing = getExtraPayment(surplusPrompt.month, surplusPrompt.year);
    const otherSources = (
      existing?.sources ?? [
        { type: "manual" as const, amount: existing?.amount ?? 0 },
      ]
    ).filter(
      (source) =>
        !(
          source.type === "bill_surplus" &&
          source.billId === surplusPrompt.bill.id
        ),
    );
    const sources = [
      ...otherSources,
      {
        type: "bill_surplus" as const,
        amount: surplus,
        billId: surplusPrompt.bill.id,
        billName: surplusPrompt.bill.name,
        reviewTransactionId: surplusPrompt.transaction.id,
      },
    ].filter((source) => source.amount > 0.005);
    try {
      await applyDebtSnowballPayment(surplusSnowballOffer.preview, sources);
      setSurplusPrompt(null);
    } catch (error) {
      Alert.alert(
        "Could not route extra money",
        error instanceof Error
          ? error.message
          : "The matched payment is safe; please try the snowball again.",
      );
    }
  };

  const handleUnmatchBill = async () => {
    if (!matchTx || savingMatch) return;
    setSavingMatch(true);
    try {
      if (
        matchTx.review_status === "matched" &&
        (matchTx.review_resolution === "bill" ||
          matchTx.review_resolution === "manual" ||
          matchTx.review_resolution === "goal")
      ) {
        if (matchTx.review_resolution === "bill")
          await removeReviewSurplusFunding(matchTx.id);
        await undoTransactionReconciliation(matchTx.id);
      } else {
        await unmatchTransactionFromBill(matchTx.id);
      }
      setMatchTx(null);
    } catch (error) {
      Alert.alert(
        "Could not undo match",
        error instanceof Error ? error.message : "Please try again.",
      );
    } finally {
      setSavingMatch(false);
    }
  };

  const openExtraPaymentEditor = useCallback(
    (payment: ExtraPayment) => {
      const paymentDate =
        payment.payment_date ??
        `${payment.year}-${String(payment.month + 1).padStart(2, "0")}-01`;
      setEditExtraPayment(payment);
      setEditExtraAmount(payment.amount.toFixed(2));
      setEditExtraDate(paymentDate);
      setEditExtraPreview(
        previewDebtSnowball(
          payment.month,
          payment.year,
          payment.amount,
          0,
          paymentDate,
          payment.id,
        ),
      );
    },
    [previewDebtSnowball],
  );

  const editExtraDateLimits = useMemo(() => {
    if (!editExtraPayment) return { min: undefined, max: undefined };
    const monthStart = `${editExtraPayment.year}-${String(editExtraPayment.month + 1).padStart(2, "0")}-01`;
    const monthEnd = `${editExtraPayment.year}-${String(editExtraPayment.month + 1).padStart(2, "0")}-${String(new Date(editExtraPayment.year, editExtraPayment.month + 1, 0).getDate()).padStart(2, "0")}`;
    const bucketAvailableDate = latestBucketRemainderAvailableDate(editExtraPayment.sources);
    return {
      min:
        bucketAvailableDate && bucketAvailableDate > monthStart
          ? bucketAvailableDate
          : monthStart,
      max: monthEnd,
      bucketAvailableDate,
    };
  }, [editExtraPayment]);

  const updateExtraPaymentAmount = useCallback(
    (value: string) => {
      setEditExtraAmount(value);
      if (!editExtraPayment) return;
      const amount = Number.parseFloat(value);
      setEditExtraPreview(
        Number.isFinite(amount) && amount > 0
          ? previewDebtSnowball(
              editExtraPayment.month,
              editExtraPayment.year,
              amount,
              0,
              editExtraDate,
              editExtraPayment.id,
            )
          : null,
      );
    },
    [editExtraDate, editExtraPayment, previewDebtSnowball],
  );

  const updateExtraPaymentDate = useCallback(
    (value: string) => {
      setEditExtraDate(value);
      if (!editExtraPayment) return;
      const amount = Number.parseFloat(editExtraAmount);
      setEditExtraPreview(
        Number.isFinite(amount) && amount > 0
          ? previewDebtSnowball(
              editExtraPayment.month,
              editExtraPayment.year,
              amount,
              0,
              value,
              editExtraPayment.id,
            )
          : null,
      );
    },
    [editExtraAmount, editExtraPayment, previewDebtSnowball],
  );

  const saveEditedExtraPayment = useCallback(async () => {
    if (!editExtraPayment || !editExtraPreview || savingExtraPayment) return;
    if (
      (editExtraDateLimits.min && editExtraDate < editExtraDateLimits.min) ||
      (editExtraDateLimits.max && editExtraDate > editExtraDateLimits.max)
    ) {
      Alert.alert(
        "Choose a valid payment date",
        editExtraDateLimits.bucketAvailableDate
          ? `This payment includes bucket money that is not available until ${editExtraDateLimits.bucketAvailableDate}.`
          : "Choose any day within this Snowball payment’s month.",
      );
      return;
    }
    const amount = Number.parseFloat(editExtraAmount);
    if (
      !Number.isFinite(amount) ||
      amount <= 0 ||
      Math.abs(editExtraPreview.selectedExtra - amount) > 0.005
    ) {
      Alert.alert(
        "Check the payment amount",
        "Use an amount that stays within the safe maximum shown above.",
      );
      return;
    }
    setSavingExtraPayment(true);
    try {
      const resizedSources = resizeSnowballFundingSources(
        editExtraPayment.sources,
        amount,
      ) as SnowballFundingSource[];
      await applyDebtSnowballPayment(editExtraPreview, resizedSources);
      setEditExtraPayment(null);
      setEditExtraPreview(null);
    } catch (error) {
      Alert.alert(
        "Could not update payment",
        error instanceof Error ? error.message : "Please try again.",
      );
    } finally {
      setSavingExtraPayment(false);
    }
  }, [
    applyDebtSnowballPayment,
    editExtraAmount,
    editExtraDate,
    editExtraDateLimits,
    editExtraPayment,
    editExtraPreview,
    savingExtraPayment,
  ]);

  const removeEditedExtraPayment = useCallback(async () => {
    if (!editExtraPayment || savingExtraPayment) return;
    if (hasBucketRemainderFunding(editExtraPayment.sources)) {
      Alert.alert(
        "Reopen bucket first",
        "Reopen the routed spending bucket before removing this Snowball payment.",
      );
      return;
    }
    setSavingExtraPayment(true);
    try {
      await removeDebtSnowballPayment(
        editExtraPayment.month,
        editExtraPayment.year,
      );
      setEditExtraPayment(null);
      setEditExtraPreview(null);
    } catch (error) {
      Alert.alert(
        "Could not remove payment",
        error instanceof Error ? error.message : "Please try again.",
      );
      throw error;
    } finally {
      setSavingExtraPayment(false);
    }
  }, [editExtraPayment, removeDebtSnowballPayment, savingExtraPayment]);

  useEffect(() => {
    const routeId = Array.isArray(params.editDebtPaymentId)
      ? params.editDebtPaymentId[0]
      : params.editDebtPaymentId;
    if (!routeId) return;
    const routeToken = `${routeId}:${Array.isArray(params.editDebtPaymentAt) ? params.editDebtPaymentAt[0] : (params.editDebtPaymentAt ?? "")}`;
    if (handledExtraPaymentRouteRef.current === routeToken) return;
    const payment = extraPayments.find((item) => item.id === routeId);
    if (!payment) return;
    handledExtraPaymentRouteRef.current = routeToken;
    openExtraPaymentEditor(payment);
  }, [
    extraPayments,
    openExtraPaymentEditor,
    params.editDebtPaymentAt,
    params.editDebtPaymentId,
  ]);

  const openItem = (item: ActivityItem) => {
    if (item.extraPayment) {
      openExtraPaymentEditor(item.extraPayment);
      return;
    }
    if (
      item.rawTx?.source === "plaid" &&
      item.rawTx.amount > 0 &&
      item.rawTx.review_status === "needs_review"
    ) {
      const openIncomeReview = () =>
        router.push({
          pathname: "/(tabs)/more",
          params: {
            section: "review",
            reviewFilter: "income",
            reviewTransactionId: item.rawTx?.id,
          },
        } as any);
      if (isFeatureLocked("transaction_matching")) {
        Alert.alert(
          "Income matching is planned for Pro",
          "Posted deposits stay available in Activity during Founding Free. Matching them to planned paydays will arrive with Pro.",
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Admin bypass",
              onPress: () => {
                bypassFeature("transaction_matching");
                openIncomeReview();
              },
            },
          ],
        );
        return;
      }
      openIncomeReview();
      return;
    }
    if (item.rawTx && canMatchExpenseToBill(item.rawTx)) {
      if (
        item.rawTx.source === "plaid" &&
        isFeatureLocked("transaction_matching")
      ) {
        Alert.alert(
          "Bill matching is locked in this preview",
          "Basic plan preview keeps imported transaction matching locked. This test does not change your real household plan.",
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Admin bypass",
              onPress: () => {
                bypassFeature("transaction_matching");
                setMatchTx(item.rawTx ?? null);
              },
            },
          ],
        );
        return;
      }
      setMatchTx(item.rawTx);
      return;
    }
    if (item.editable && item.rawTx) {
      setEditTx(item.rawTx);
      setEditModalVisible(true);
    } else {
      setDetailItem(item);
    }
  };

  useEffect(() => {
    const activityId = Array.isArray(params.activityId)
      ? params.activityId[0]
      : params.activityId;
    if (!activityId) return;
    const routeToken = `${activityId}:${Array.isArray(params.activityAt) ? params.activityAt[0] : (params.activityAt ?? "")}`;
    if (handledActivityRouteRef.current === routeToken) return;
    const activityItem = allActivity.find(
      (item) => item.rawTx?.id === activityId,
    );
    if (!activityItem) return;
    handledActivityRouteRef.current = routeToken;
    openItem(activityItem);
  }, [allActivity, params.activityAt, params.activityId]);

  // ── Detail sheet for auto-generated entries ───────────────────────────────
  const renderWeeklySummarySheet = () => (
    <Modal
      visible={weeklySummaryVisible}
      transparent
      animationType="fade"
      onRequestClose={() => setWeeklySummaryVisible(false)}
    >
      <Pressable
        style={styles.summaryOverlay}
        onPress={() => setWeeklySummaryVisible(false)}
      >
        <Pressable
          style={[
            styles.summarySheet,
            { backgroundColor: c.card, borderColor: c.border },
          ]}
          accessibilityViewIsModal
          onPress={(event) => event.stopPropagation()}
        >
          <View style={styles.summarySheetHeader}>
            <View>
              <Text
                style={[styles.activityHeroLabel, { color: c.mutedForeground }]}
              >
                Weekly breakdown
              </Text>
              <Text style={[styles.summarySheetTitle, { color: c.foreground }]}>
                {activitySummaryIsPartial
                  ? "Loaded activity"
                  : activitySummary.title}
              </Text>
              {activitySummaryIsPartial ? (
                <Text
                  style={[
                    styles.summarySheetScopeNote,
                    { color: c.mutedForeground },
                  ]}
                >
                  Weekly totals reflect loaded results only.
                </Text>
              ) : null}
              {activitySummary.latestWeeksOnly ? (
                <Text
                  style={[
                    styles.summarySheetScopeNote,
                    { color: c.mutedForeground },
                  ]}
                >
                  Showing the latest 12 weeks.
                </Text>
              ) : null}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close weekly summary"
              onPress={() => setWeeklySummaryVisible(false)}
              style={styles.modalCloseButton}
            >
              <Feather name="x" size={22} color={c.mutedForeground} />
            </Pressable>
          </View>

          <ScrollView
            style={styles.summarySheetScroll}
            contentContainerStyle={styles.summarySheetScrollContent}
            showsVerticalScrollIndicator={false}
          >
            <View style={[styles.summaryTotalRow, { borderColor: c.border }]}>
              <View>
                <Text
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.68}
                  style={[
                    styles.summaryTinyLabel,
                    { color: c.mutedForeground },
                  ]}
                >
                  Net flow
                </Text>
                <Text
                  style={[
                    styles.summaryLargeNet,
                    {
                      color:
                        activitySummary.net >= 0 ? c.success : c.destructive,
                    },
                  ]}
                >
                  {activitySummary.net >= 0 ? "+" : "−"}$
                  {formatActivityMoney(activitySummary.net)}
                </Text>
              </View>
              <View style={styles.summaryTotalRight}>
                <Text
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.72}
                  style={[styles.summaryMiniValue, { color: c.success }]}
                >
                  +${formatActivityMoney(activitySummary.income)} in
                </Text>
                <Text
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.72}
                  style={[styles.summaryMiniValue, { color: c.destructive }]}
                >
                  −${formatActivityMoney(activitySummary.out)} out
                </Text>
              </View>
            </View>

            <View style={styles.summaryWeekList}>
              {activitySummary.weeks.map((week) => (
                <View
                  key={week.label}
                  style={[
                    styles.summaryWeekCard,
                    { backgroundColor: c.background, borderColor: c.border },
                  ]}
                >
                  <View style={styles.summaryWeekMiddle}>
                    <Text
                      style={[styles.summaryWeekLabel, { color: c.foreground }]}
                    >
                      {week.label}
                    </Text>
                  </View>
                  <Text
                    style={[
                      styles.summaryWeekValue,
                      { color: week.total >= 0 ? c.success : c.destructive },
                    ]}
                  >
                    {week.total >= 0 ? "+" : "−"}$
                    {formatActivityMoney(week.total)}
                  </Text>
                </View>
              ))}
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close weekly summary"
              onPress={() => setWeeklySummaryVisible(false)}
              style={({ pressed }) => [
                styles.sheetClose,
                { backgroundColor: c.primary, opacity: pressed ? 0.85 : 1 },
              ]}
            >
              <Text
                style={[styles.sheetCloseText, { color: c.primaryForeground }]}
              >
                Done
              </Text>
            </Pressable>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );

  const renderDetailSheet = () => {
    if (!detailItem) return null;
    const meta = SOURCE_META[detailItem.source];
    const isExpense = detailItem.amount < 0;

    return (
      <Modal
        visible={!!detailItem}
        transparent
        animationType={isDesktop ? "fade" : "slide"}
        onRequestClose={() => setDetailItem(null)}
      >
        <Pressable
          style={[styles.sheetOverlay, isDesktop && DESKTOP_MODAL_OVERLAY]}
          onPress={() => setDetailItem(null)}
        >
          <Pressable
            style={[
              styles.sheet,
              { backgroundColor: c.background },
              isDesktop && DESKTOP_MODAL_REGULAR,
            ]}
            accessibilityViewIsModal
            onPress={(event) => event.stopPropagation()}
          >
            {/* Handle */}
            <View
              style={[
                styles.sheetHandle,
                { backgroundColor: c.border },
                isDesktop && DESKTOP_MODAL_HANDLE,
              ]}
            />

            <ScrollView
              showsVerticalScrollIndicator={isDesktop}
              contentContainerStyle={styles.sheetScrollContent}
            >
              {/* Icon + title */}
              <View style={styles.sheetHeader}>
                <View
                  style={[
                    styles.sheetIconWrap,
                    { backgroundColor: meta.color + "20" },
                  ]}
                >
                  <Feather name={meta.icon} size={26} color={meta.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text
                    style={[styles.sheetName, { color: c.foreground }]}
                    numberOfLines={2}
                  >
                    {detailItem.label}
                  </Text>
                  <View
                    style={[
                      styles.sourcePill,
                      { backgroundColor: meta.color + "18" },
                    ]}
                  >
                    <Text
                      style={[styles.sourcePillText, { color: meta.color }]}
                    >
                      {meta.label}
                    </Text>
                  </View>
                </View>
              </View>

              {/* Amount hero */}
              <View
                style={[
                  styles.sheetAmtBox,
                  { backgroundColor: c.card, borderRadius: colors.radius },
                ]}
              >
                <Text
                  style={[
                    styles.sheetAmt,
                    { color: isExpense ? c.destructive : c.success },
                  ]}
                >
                  {isExpense ? "−" : "+"}$
                  {Math.abs(detailItem.amount).toFixed(2)}
                </Text>
                <Text
                  style={[styles.sheetAmtLabel, { color: c.mutedForeground }]}
                >
                  {isExpense ? "Expense" : "Income"}
                </Text>
              </View>

              {/* Detail rows */}
              {[
                {
                  icon: "calendar" as const,
                  label: "Date",
                  value: formatDateLong(detailItem.date),
                },
                {
                  icon: "tag" as const,
                  label: "Category",
                  value: detailItem.category,
                },
                {
                  icon: "info" as const,
                  label: "Source",
                  value: meta.description,
                },
                ...(detailItem.debtName
                  ? [
                      {
                        icon: "credit-card" as const,
                        label: "Applied toward debt",
                        value: detailItem.debtName,
                      },
                    ]
                  : []),
                ...(detailItem.detail
                  ? [
                      {
                        icon: "file-text" as const,
                        label: "Details",
                        value: detailItem.detail,
                      },
                    ]
                  : []),
              ].map((row) => (
                <View
                  key={row.label}
                  style={[styles.sheetRow, { borderBottomColor: c.border }]}
                >
                  <View
                    style={[styles.sheetRowIcon, { backgroundColor: c.muted }]}
                  >
                    <Feather
                      name={row.icon}
                      size={14}
                      color={c.mutedForeground}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[
                        styles.sheetRowLabel,
                        { color: c.mutedForeground },
                      ]}
                    >
                      {row.label}
                    </Text>
                    <Text
                      style={[styles.sheetRowValue, { color: c.foreground }]}
                    >
                      {row.value}
                    </Text>
                  </View>
                </View>
              ))}

              {/* Source note */}
              <View
                style={[
                  styles.sheetNote,
                  { backgroundColor: c.muted, borderRadius: colors.radius },
                ]}
              >
                <Feather name="lock" size={13} color={c.mutedForeground} />
                <Text
                  style={[styles.sheetNoteText, { color: c.mutedForeground }]}
                >
                  {detailItem.source === "bill_payment"
                    ? "Edit this entry by adjusting the paid amount in Monthly view."
                    : detailItem.pending
                      ? isExpense
                        ? "This is a bank preview. A temporary match can connect it to a bill or manual Activity entry, but the bank charge is not counted until it posts."
                        : "This is a bank deposit preview. It is not counted until it posts."
                      : detailItem.source === "income"
                        ? "Edit this entry by updating your income in More → Income Sources."
                        : "Edit this entry from the Bills → Debt tab."}
                </Text>
              </View>

              {detailItem.pending && isExpense ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Match pending ${detailItem.label} to a bill or manual Activity entry`}
                  onPress={() => {
                    if (!detailItem.rawPending) return;
                    if (isFeatureLocked("transaction_matching")) {
                      Alert.alert(
                        "Pending matching is planned for Pro",
                        "Pending charges stay visible during Founding Free. Connecting them to bills or manual Activity will arrive with Pro.",
                      );
                      return;
                    }
                    const pending = detailItem.rawPending;
                    setDetailItem(null);
                    setTimeout(
                      () => setPendingMatchTx(pending),
                      MODAL_HANDOFF_DELAY_MS,
                    );
                  }}
                  style={({ pressed }) => [
                    styles.pendingMatchButton,
                    {
                      borderColor: colors.brand.blue + "70",
                      backgroundColor: colors.brand.blue + "16",
                      opacity: pressed ? 0.8 : 1,
                    },
                  ]}
                >
                  <Feather name="link-2" size={17} color={colors.brand.blue} />
                  <View style={styles.pendingBucketButtonCopy}>
                    <Text
                      style={[
                        styles.pendingBucketButtonTitle,
                        { color: c.foreground },
                      ]}
                    >
                      Match to bill or manual Activity
                    </Text>
                    <Text
                      style={[
                        styles.pendingBucketButtonBody,
                        { color: c.mutedForeground },
                      ]}
                    >
                      Avoid duplicate Activity and false overdue warnings
                    </Text>
                  </View>
                  <Feather
                    name="chevron-right"
                    size={18}
                    color={colors.brand.blue}
                  />
                </Pressable>
              ) : null}

              {detailItem.pending && isExpense ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Set aside ${Math.abs(detailItem.amount).toFixed(2)} dollars for ${detailItem.label}`}
                  onPress={() => {
                    const draft = {
                      name: detailItem.label,
                      amount: Math.abs(detailItem.amount),
                      date:
                        detailItem.date < todayIsoDate()
                          ? todayIsoDate()
                          : detailItem.date,
                    };
                    setDetailItem(null);
                    setTimeout(
                      () => setPendingBucketDraft(draft),
                      MODAL_HANDOFF_DELAY_MS,
                    );
                  }}
                  style={({ pressed }) => [
                    styles.pendingBucketButton,
                    { backgroundColor: c.primary, opacity: pressed ? 0.82 : 1 },
                  ]}
                >
                  <Feather
                    name="calendar"
                    size={17}
                    color={c.primaryForeground}
                  />
                  <View style={styles.pendingBucketButtonCopy}>
                    <Text
                      style={[
                        styles.pendingBucketButtonTitle,
                        { color: c.primaryForeground },
                      ]}
                    >
                      Set aside for this charge
                    </Text>
                    <Text
                      style={[
                        styles.pendingBucketButtonBody,
                        { color: c.primaryForeground },
                      ]}
                    >
                      Create a ${Math.abs(detailItem.amount).toFixed(2)}{" "}
                      spending bucket
                    </Text>
                  </View>
                  <Feather
                    name="chevron-right"
                    size={18}
                    color={c.primaryForeground}
                  />
                </Pressable>
              ) : null}

              <Pressable
                onPress={() => setDetailItem(null)}
                style={({ pressed }) => [
                  styles.sheetClose,
                  { backgroundColor: c.primary, opacity: pressed ? 0.85 : 1 },
                ]}
              >
                <Text
                  style={[
                    styles.sheetCloseText,
                    { color: c.primaryForeground },
                  ]}
                >
                  Done
                </Text>
              </Pressable>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    );
  };

  const renderListHeader = () => (
    <>
      <View
        style={[
          styles.header,
          { paddingTop: activityTopInset + 12 + webTopPad },
        ]}
      >
        <View style={styles.headerCopy}>
          <Text style={[styles.headerEyebrow, { color: c.primary }]}>
            MONEY MOVEMENT
          </Text>
          <PlanViewSelector textStyle={styles.title} />
          <Text style={[styles.subtitle, { color: c.mutedForeground }]}>
            {activeDateRange.label} · {feedOrderLabel}
          </Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Export visible activity as CSV"
            onPress={exportVisibleActivity}
            style={({ pressed }) => [
              styles.exportButton,
              {
                backgroundColor: c.card,
                borderColor: c.border,
                opacity: pressed ? 0.78 : 1,
              },
            ]}
          >
            <Feather name="download" size={18} color={c.foreground} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add activity"
            onPress={() => {
              setEditTx(null);
              setEditModalVisible(true);
            }}
            style={({ pressed }) => [
              styles.addActivityButton,
              {
                backgroundColor: c.primary,
                opacity: pressed ? 0.78 : 1,
              },
            ]}
          >
            <Feather name="plus" size={22} color={c.primaryForeground} />
          </Pressable>
        </View>
      </View>
      <DataFreshnessLabel inset compact />

      {activityReviewCount > 0 || pendingActivityCount > 0 ? (
        <View style={styles.attentionStack}>
          {activityReviewCount > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${reviewAttentionTitle}. ${reviewAttentionBody}`}
              accessibilityHint="Opens Review Center"
              onPress={() =>
                router.push({
                  pathname: "/(tabs)/more",
                  params: { section: "review" },
                } as any)
              }
              style={[
                styles.attentionCard,
                {
                  borderColor: c.warning + "55",
                  backgroundColor: c.warning + "12",
                },
              ]}
            >
              <View
                style={[
                  styles.attentionIcon,
                  { backgroundColor: c.warning + "1F" },
                ]}
              >
                <Feather name="alert-circle" size={21} color={c.warning} />
              </View>
              <View style={styles.attentionCopy}>
                <Text style={[styles.attentionEyebrow, { color: c.warning }]}>
                  REVIEW POSTED ACTIVITY
                </Text>
                <Text style={[styles.attentionTitle, { color: c.foreground }]}>
                  {reviewAttentionTitle}
                </Text>
                <Text
                  style={[styles.attentionBody, { color: c.mutedForeground }]}
                >
                  {reviewAttentionBody}
                </Text>
              </View>
              <Feather name="chevron-right" size={20} color={c.warning} />
            </Pressable>
          ) : null}

          {pendingActivityCount > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${pendingAttentionTitle}. ${pendingAttentionBody}`}
              accessibilityHint="Opens pending match options"
              onPress={openFirstUnmatchedPending}
              style={[
                styles.attentionCard,
                {
                  borderColor: c.warning + "55",
                  backgroundColor: c.warning + "12",
                },
              ]}
            >
              <View
                style={[
                  styles.attentionIcon,
                  { backgroundColor: c.warning + "1F" },
                ]}
              >
                <Feather name="clock" size={21} color={c.warning} />
              </View>
              <View style={styles.attentionCopy}>
                <Text style={[styles.attentionEyebrow, { color: c.warning }]}>
                  MATCH PENDING
                </Text>
                <Text style={[styles.attentionTitle, { color: c.foreground }]}>
                  {pendingAttentionTitle}
                </Text>
                <Text
                  style={[styles.attentionBody, { color: c.mutedForeground }]}
                >
                  {pendingAttentionBody}
                </Text>
              </View>
              <Feather name="chevron-right" size={20} color={c.warning} />
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${activitySummaryIsPartial ? "Loaded activity" : activitySummary.title} net flow ${activitySummary.net < 0 ? "negative " : ""}${formatActivityMoney(activitySummary.net)} dollars. Inflows ${formatActivityMoney(activitySummary.income)} dollars. Outflows ${formatActivityMoney(activitySummary.out)} dollars.`}
        accessibilityHint="Opens the weekly breakdown"
        onPress={() => setWeeklySummaryVisible(true)}
        style={({ pressed }) => [
          styles.monthlySummaryCard,
          {
            backgroundColor: c.card,
            borderColor: c.border,
            opacity: pressed ? 0.88 : 1,
          },
        ]}
      >
        <View style={styles.monthlySummaryHeader}>
          <View style={styles.activityHeroHeading}>
            <Text style={[styles.activityHeroLabel, { color: c.primary }]}>
              NET FLOW
            </Text>
            <Text style={[styles.monthlySummaryTitle, { color: c.foreground }]}>
              {activitySummaryIsPartial
                ? "Loaded activity"
                : activitySummary.title}
            </Text>
          </View>
          <View
            style={[
              styles.activityHeroBadge,
              {
                backgroundColor:
                  activitySummary.net >= 0
                    ? c.success + "18"
                    : c.destructive + "18",
              },
            ]}
          >
            <Text
              style={[
                styles.activityHeroBadgeText,
                { color: activitySummary.net >= 0 ? c.success : c.destructive },
              ]}
            >
              {activitySummary.net >= 0 ? "Positive flow" : "Outflows higher"}
            </Text>
          </View>
        </View>
        <Text
          style={[
            styles.activityNetValue,
            { color: activitySummary.net >= 0 ? c.success : c.destructive },
          ]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.64}
        >
          {activitySummary.net > 0 ? "+" : activitySummary.net < 0 ? "−" : ""}$
          {formatActivityMoney(activitySummary.net)}
        </Text>
        <View style={styles.monthlySummaryStats}>
          <View
            style={[
              styles.monthlySummaryStat,
              {
                backgroundColor: c.isDark
                  ? "rgba(15,23,42,0.42)"
                  : "rgba(248,250,252,0.96)",
                borderColor: c.isDark
                  ? "rgba(148,163,184,0.10)"
                  : "rgba(15,23,42,0.08)",
              },
            ]}
          >
            <Text
              style={[styles.monthlySummaryValue, { color: c.success }]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.7}
            >
              ${formatActivityMoney(activitySummary.income)}
            </Text>
            <Text
              style={[styles.monthlySummaryLabel, { color: c.mutedForeground }]}
            >
              Inflows
            </Text>
          </View>
          <View
            style={[
              styles.monthlySummaryStat,
              {
                backgroundColor: c.isDark
                  ? "rgba(15,23,42,0.42)"
                  : "rgba(248,250,252,0.96)",
                borderColor: c.isDark
                  ? "rgba(148,163,184,0.10)"
                  : "rgba(15,23,42,0.08)",
              },
            ]}
          >
            <Text
              style={[styles.monthlySummaryValue, { color: c.destructive }]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.7}
            >
              ${formatActivityMoney(activitySummary.out)}
            </Text>
            <Text
              style={[styles.monthlySummaryLabel, { color: c.mutedForeground }]}
            >
              Outflows
            </Text>
          </View>
        </View>
        {activitySummaryIsPartial ? (
          <Text style={[styles.loadedTotalsNote, { color: c.mutedForeground }]}>
            Totals reflect loaded activity. Load more to expand this view.
          </Text>
        ) : null}
        <View style={[styles.weekSummaryTrigger, { borderTopColor: c.border }]}>
          <View style={styles.weekSummaryCopy}>
            <Text style={[styles.weekSummaryTitle, { color: c.foreground }]}>
              Weekly breakdown
            </Text>
            <Text
              style={[styles.weekSummarySub, { color: c.mutedForeground }]}
              numberOfLines={1}
            >
              See weekly net by date range.
            </Text>
          </View>
          <Feather name="chevron-right" size={18} color={c.mutedForeground} />
        </View>
      </Pressable>

      <View style={styles.recentActivityHeader}>
        <View style={styles.recentActivityCopy}>
          <Text style={[styles.recentActivityTitle, { color: c.foreground }]}>
            Recent Activity
          </Text>
          <Text
            style={[
              styles.recentActivitySubtitle,
              { color: c.mutedForeground },
            ]}
          >
            {filtered.length} {historyHasMore ? "loaded" : "shown"} ·{" "}
            {feedOrderLabel}
          </Text>
        </View>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.quickFilterRow}
        accessibilityRole="tablist"
      >
        {quickChips.slice(0, 3).map((chip) => (
          <Pressable
            key={chip.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: chip.active }}
            aria-selected={chip.active}
            accessibilityLabel={`Show ${chip.label.toLowerCase()} activity`}
            onPress={chip.onPress}
            style={({ pressed }) => [
              styles.quickFilterChip,
              {
                backgroundColor: chip.active ? c.primary : c.card,
                borderColor: chip.active ? c.primary : c.border,
                opacity: pressed ? 0.78 : 1,
              },
            ]}
          >
            <Text
              style={[
                styles.quickFilterText,
                {
                  color: chip.active ? c.primaryForeground : c.mutedForeground,
                },
              ]}
            >
              {chip.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      <View style={[styles.searchWrap, { marginBottom: 8 }]}>
        <View
          style={[
            styles.searchBox,
            { backgroundColor: c.card, borderColor: c.border },
          ]}
        >
          <Feather name="search" size={15} color={c.mutedForeground} />
          <TextInput
            accessibilityLabel="Search activity by name or category"
            style={[styles.searchInput, { color: c.foreground }]}
            placeholder="Search by name or category…"
            placeholderTextColor={c.mutedForeground}
            value={search}
            onChangeText={setSearch}
            returnKeyType="search"
          />
          {search.length > 0 && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear activity search"
              onPress={() => setSearch("")}
              style={styles.clearSearchButton}
            >
              <Feather name="x" size={14} color={c.mutedForeground} />
            </Pressable>
          )}
        </View>
        <Pressable
          nativeID="guided-tour-transactions"
          accessibilityRole="button"
          accessibilityLabel="Filter activity"
          accessibilityState={{ selected: activeFilterCount > 0 }}
          onPress={() => setFilterModalVisible(true)}
          style={({ pressed }) => [
            styles.filterIconButton,
            {
              backgroundColor: activeFilterCount > 0 ? c.primary : c.card,
              borderColor: activeFilterCount > 0 ? c.primary : c.border,
              opacity: pressed ? 0.8 : 1,
            },
          ]}
        >
          <Feather
            name="filter"
            size={20}
            color={activeFilterCount > 0 ? c.primaryForeground : c.foreground}
          />
          {activeFilterCount > 0 && (
            <View
              style={[styles.filterCount, { backgroundColor: c.destructive }]}
            >
              <Text style={styles.filterCountText}>{activeFilterCount}</Text>
            </View>
          )}
        </Pressable>
      </View>
    </>
  );

  return (
    <View style={[styles.screen, { backgroundColor: c.background }]}>
      {!isDesktop ? <PremiumBackdrop variant="green" /> : null}
      {isDesktop ? (
        <DesktopActivityPage
          rows={filtered.map((item) => ({
            id: item.id,
            date: item.date,
            amount: item.amount,
            label: item.label,
            category: item.category,
            source: item.source,
            editable: item.editable,
            pending: item.pending,
            detail: item.detail,
            note: item.rawTx?.note,
            debtName: item.debtName,
            runningBalance: runningBalanceById.get(item.id),
            countsInCashFlow: activityItemCountsInCashFlow(
              item,
              transactionAccountIdentities,
            ),
            accountName: item.rawTx?.account_id
              ? accounts.find(
                  (account) => account.id === item.rawTx?.account_id,
                )?.name
              : item.rawTx?.plaid_account_id
                ? (activityAccountIdentityById.get(
                    item.rawTx.plaid_account_id,
                  )?.display_name ??
                  activityAccountIdentityById.get(item.rawTx.plaid_account_id)
                    ?.name)
                : undefined,
          }))}
          summary={activitySummary}
          summaryIsPartial={activitySummaryIsPartial}
          dateRangeLabel={activeDateRange.label}
          onDateRangePress={() => setFilterModalVisible(true)}
          search={search}
          onSearchChange={setSearch}
          categoryFilter={categoryFilter}
          onCategoryPress={() => {
            const values = ["all", ...categoryOptions];
            setCategoryFilter(
              values[(values.indexOf(categoryFilter) + 1) % values.length],
            );
          }}
          typeFilter={typeFilter}
          onTypePress={() =>
            setTypeFilter(
              typeFilter === "all"
                ? "income"
                : typeFilter === "income"
                  ? "expense"
                  : "all",
            )
          }
          hasActiveFilters={hasActiveFilters}
          onResetFilters={clearFilters}
          hasMore={historyHasMore}
          loadingMore={false}
          loadError={null}
          onLoadMore={() => undefined}
          onAdd={() => {
            setEditTx(null);
            setEditModalVisible(true);
          }}
          onOpen={(id) => {
            const item = allActivity.find((activity) => activity.id === id);
            if (item) openItem(item);
          }}
        />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[
            styles.list,
            { paddingBottom: listBottomPadding },
          ]}
          scrollIndicatorInsets={{ bottom: listBottomPadding }}
          stickySectionHeadersEnabled
          ListHeaderComponent={renderListHeader()}
          ListEmptyComponent={
            <EmptyState
              icon="repeat"
              title="No Activity"
              message={
                hasActiveFilters
                  ? historyHasMore
                    ? "No matches in loaded activity. Load more or change your filters."
                    : "Nothing matches your filters."
                  : "Mark bills paid or add income sources to see your activity here."
              }
              actionLabel={hasActiveFilters ? "Clear filters" : "Add Activity"}
              onAction={
                hasActiveFilters
                  ? clearFilters
                  : () => {
                      setEditTx(null);
                      setEditModalVisible(true);
                    }
              }
            />
          }
          renderSectionHeader={({ section: { title } }) => (
            <View
              style={[styles.sectionHeader, { backgroundColor: c.background }]}
            >
              <Text style={[styles.sectionTitle, { color: c.foreground }]}>
                {title}
              </Text>
            </View>
          )}
          renderItem={({ item, index, section }) => {
            const isLast = index === section.data.length - 1;
            const isExpense = item.amount < 0;
            const sourceMeta = SOURCE_META[item.source];
            const needsIncomeReview =
              item.rawTx?.source === "plaid" &&
              item.rawTx.amount > 0 &&
              item.rawTx.review_status === "needs_review";
            const statusLabel = item.pending
              ? item.pendingMatchLabel
                ? "Payment pending"
                : isExpense
                  ? "Match pending"
                  : "Deposit pending"
              : needsIncomeReview
                ? "Needs review"
                : item.debtName
                  ? `Applied to ${item.debtName}`
                  : null;
            const statusColor =
              item.pending || needsIncomeReview ? c.warning : c.primary;
            const runningBalance = runningBalanceById.get(item.id);

            return (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${item.label}, ${isExpense ? "outflow" : "inflow"} ${formatActivityMoney(item.amount)} dollars, ${sourceMeta.label}, ${item.category}, ${formatDate(item.date)}${statusLabel ? `, ${statusLabel}` : ""}${runningBalance == null ? "" : `, balance ${formatActivityMoney(runningBalance)} dollars`}`}
                accessibilityHint="Opens activity details"
                onPress={() => openItem(item)}
                style={({ pressed }) => [
                  styles.txRow,
                  {
                    backgroundColor: c.card,
                    borderRadius: colors.radius,
                    opacity: pressed ? 0.85 : 1,
                    marginBottom: isLast ? 10 : 7,
                  },
                ]}
              >
                <View
                  style={[
                    styles.rowAccent,
                    { backgroundColor: sourceMeta.color },
                  ]}
                />
                {/* Source icon */}
                <View
                  style={[
                    styles.sourceIcon,
                    { backgroundColor: sourceMeta.color + "20" },
                  ]}
                >
                  <Feather
                    name={sourceMeta.icon}
                    size={19}
                    color={sourceMeta.color}
                  />
                </View>

                {/* Middle */}
                <View style={styles.txMid}>
                  <Text
                    style={[styles.txNote, { color: c.foreground }]}
                    numberOfLines={1}
                  >
                    {item.label}
                  </Text>
                  <Text
                    style={[styles.txMetaLine, { color: c.mutedForeground }]}
                    numberOfLines={1}
                  >
                    {sourceMeta.label} · {item.category} ·{" "}
                    {formatDate(item.date)}
                  </Text>
                  {statusLabel ? (
                    <View
                      style={[
                        styles.txStatus,
                        { backgroundColor: statusColor + "18" },
                      ]}
                    >
                      <Text
                        style={[styles.txStatusText, { color: statusColor }]}
                        numberOfLines={1}
                      >
                        {statusLabel}
                      </Text>
                    </View>
                  ) : null}
                </View>

                {/* Amount + action hint */}
                <View style={styles.txRight}>
                  <Text
                    style={[
                      styles.txAmount,
                      { color: isExpense ? c.destructive : c.success },
                    ]}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.72}
                  >
                    {isExpense ? "−" : "+"}${formatActivityMoney(item.amount)}
                  </Text>
                  {runningBalance != null ? (
                    <Text
                      style={[styles.txBalance, { color: c.mutedForeground }]}
                      numberOfLines={1}
                    >
                      Balance ${formatActivityMoney(runningBalance)}
                    </Text>
                  ) : null}
                  <Feather
                    name={
                      needsIncomeReview || !item.editable
                        ? "chevron-right"
                        : "edit-2"
                    }
                    size={12}
                    color={c.mutedForeground}
                    style={{ marginTop: 3 }}
                  />
                </View>
              </Pressable>
            );
          }}
        />
      )}

      {/* ── Filter sheet ── */}
      <Modal
        visible={!!pendingMatchTx}
        transparent
        animationType={isDesktop ? "fade" : "slide"}
        onRequestClose={() => setPendingMatchTx(null)}
      >
        <Pressable
          style={[styles.matchOverlay, isDesktop && DESKTOP_MODAL_OVERLAY]}
          onPress={() => setPendingMatchTx(null)}
        >
          <Pressable
            style={[
              styles.matchSheet,
              { backgroundColor: c.background },
              isDesktop && DESKTOP_MODAL_MATCH,
            ]}
            accessibilityViewIsModal
            onPress={(event) => event.stopPropagation()}
          >
            <View
              style={[
                styles.filterHandle,
                { backgroundColor: c.border },
                isDesktop && DESKTOP_MODAL_HANDLE,
              ]}
            />
            <View style={styles.matchHeader}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.matchEyebrow, { color: c.warning }]}>
                  PENDING BANK PAYMENT
                </Text>
                <Text
                  style={[styles.matchTitle, { color: c.foreground }]}
                  numberOfLines={2}
                >
                  {pendingMatchTx?.merchant_name ||
                    pendingMatchTx?.name ||
                    "Pending payment"}
                </Text>
                <Text style={[styles.matchAmount, { color: c.destructive }]}>
                  −${Math.abs(pendingMatchTx?.amount ?? 0).toFixed(2)} ·{" "}
                  {pendingMatchTx
                    ? formatDate(pendingMatchTx.transaction_date)
                    : ""}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close pending bill matching"
                onPress={() => setPendingMatchTx(null)}
                style={styles.modalCloseButton}
              >
                <Feather name="x" size={22} color={c.mutedForeground} />
              </Pressable>
            </View>

            {selectedPendingPlanMatch ? (
              <View style={styles.matchBody}>
                <View
                  style={[
                    styles.matchedCard,
                    {
                      backgroundColor: colors.brand.blue + "16",
                      borderColor: colors.brand.blue + "55",
                    },
                  ]}
                >
                  <Feather name="clock" size={22} color={colors.brand.blue} />
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[styles.matchRowTitle, { color: c.foreground }]}
                    >
                      Payment pending for {selectedPendingPlanMatch.target_name}
                    </Text>
                    <Text
                      style={[
                        styles.matchRowMeta,
                        { color: c.mutedForeground },
                      ]}
                    >
                      {selectedPendingPlanMatch.target_type === "manual"
                        ? "The manual entry stays in your plan until this posts. FlowLedger will then ask you to replace it with the bank-backed entry."
                        : "Not paid or counted yet. FlowLedger will ask you to confirm when it posts."}
                    </Text>
                  </View>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove pending match to ${selectedPendingPlanMatch.target_name}`}
                  disabled={savingMatch}
                  onPress={() => void handleRemovePendingMatch()}
                  style={[
                    styles.unmatchButton,
                    {
                      borderColor: c.destructive,
                      opacity: savingMatch ? 0.55 : 1,
                    },
                  ]}
                >
                  <Text
                    style={[styles.unmatchButtonText, { color: c.destructive }]}
                  >
                    {savingMatch ? "Updating…" : "Remove pending match"}
                  </Text>
                </Pressable>
              </View>
            ) : (
              <>
                <Text style={[styles.matchIntro, { color: c.mutedForeground }]}>
                  Choose the bill or manual Activity entry this pending payment
                  is expected to cover.
                </Text>
                <ScrollView
                  style={[
                    styles.matchList,
                    isDesktop && styles.desktopMatchList,
                  ]}
                  showsVerticalScrollIndicator={isDesktop}
                >
                  {pendingMatchOptions.length > 0 ? (
                    pendingMatchOptions.map((option, index) => (
                      <Pressable
                        key={`${option.targetType}-${option.billId}-${option.nearestOccurrenceDate}`}
                        accessibilityRole="button"
                        accessibilityLabel={`Temporarily match pending payment to ${option.name}`}
                        disabled={savingMatch}
                        onPress={() =>
                          void (option.targetType === "manual"
                            ? handleMatchPendingManual(option.billId)
                            : handleMatchPendingBill(option.billId))
                        }
                        style={({ pressed }) => [
                          styles.matchRow,
                          {
                            backgroundColor: c.card,
                            borderColor:
                              index === 0 && option.score >= 48
                                ? c.success + "66"
                                : c.border,
                            opacity: savingMatch ? 0.55 : pressed ? 0.82 : 1,
                          },
                        ]}
                      >
                        <View
                          style={[
                            styles.matchIcon,
                            {
                              backgroundColor:
                                (index === 0 && option.score >= 48
                                  ? c.success
                                  : colors.brand.blue) + "18",
                            },
                          ]}
                        >
                          <Feather
                            name={
                              option.targetType === "manual"
                                ? "edit-3"
                                : "file-text"
                            }
                            size={17}
                            color={
                              index === 0 && option.score >= 48
                                ? c.success
                                : colors.brand.blue
                            }
                          />
                        </View>
                        <View style={{ flex: 1 }}>
                          <View style={styles.matchRowHeading}>
                            <Text
                              style={[
                                styles.matchRowTitle,
                                { color: c.foreground },
                              ]}
                              numberOfLines={1}
                            >
                              {option.name}
                            </Text>
                            {index === 0 && option.score >= 48 ? (
                              <View
                                style={[
                                  styles.suggestedBadge,
                                  { backgroundColor: c.success + "20" },
                                ]}
                              >
                                <Text
                                  style={[
                                    styles.suggestedBadgeText,
                                    { color: c.success },
                                  ]}
                                >
                                  Suggested
                                </Text>
                              </View>
                            ) : null}
                          </View>
                          <Text
                            style={[
                              styles.matchRowMeta,
                              { color: c.mutedForeground },
                            ]}
                          >
                            {option.targetType === "manual"
                              ? "Manual Activity"
                              : "Planned bill"}{" "}
                            · ${option.plannedAmount.toFixed(2)} ·{" "}
                            {option.daysApart === 0
                              ? "same day"
                              : option.daysApart === 1
                                ? "1 day away"
                                : `${option.daysApart ?? 0} days away`}
                          </Text>
                          {option.reasons.length > 0 ? (
                            <Text
                              style={[styles.matchReason, { color: c.success }]}
                            >
                              {option.reasons.slice(0, 2).join(" · ")}
                            </Text>
                          ) : null}
                        </View>
                        <Feather
                          name="chevron-right"
                          size={17}
                          color={c.mutedForeground}
                        />
                      </Pressable>
                    ))
                  ) : (
                    <View
                      style={[
                        styles.noMatchCard,
                        { backgroundColor: c.card, borderColor: c.border },
                      ]}
                    >
                      <Text
                        style={[styles.matchRowTitle, { color: c.foreground }]}
                      >
                        No planned or manual match found
                      </Text>
                      <Text
                        style={[
                          styles.matchRowMeta,
                          { color: c.mutedForeground },
                        ]}
                      >
                        Add a bill or manual Activity entry first, then return
                        to this pending charge.
                      </Text>
                    </View>
                  )}
                </ScrollView>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={!!matchTx}
        transparent
        animationType={isDesktop ? "fade" : "slide"}
        onRequestClose={() => setMatchTx(null)}
      >
        <Pressable
          style={[styles.matchOverlay, isDesktop && DESKTOP_MODAL_OVERLAY]}
          onPress={() => setMatchTx(null)}
        >
          <Pressable
            style={[
              styles.matchSheet,
              { backgroundColor: c.background },
              isDesktop && DESKTOP_MODAL_MATCH,
            ]}
            accessibilityViewIsModal
            onPress={(event) => event.stopPropagation()}
          >
            <View
              style={[
                styles.filterHandle,
                { backgroundColor: c.border },
                isDesktop && DESKTOP_MODAL_HANDLE,
              ]}
            />
            <View style={styles.matchHeader}>
              <View style={{ flex: 1 }}>
                <Text
                  style={[styles.matchEyebrow, { color: c.mutedForeground }]}
                >
                  {matchingBankActivity ? "BANK ACTIVITY" : "MANUAL EXPENSE"}
                </Text>
                <Text
                  style={[styles.matchTitle, { color: c.foreground }]}
                  numberOfLines={2}
                >
                  {matchTx?.merchant_name ||
                    matchTx?.note ||
                    "Imported transaction"}
                </Text>
                <Text style={[styles.matchAmount, { color: c.destructive }]}>
                  −${Math.abs(matchTx?.amount ?? 0).toFixed(2)} ·{" "}
                  {matchTx ? formatDate(matchTx.date) : ""}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close bill matching"
                onPress={() => setMatchTx(null)}
                style={styles.modalCloseButton}
              >
                <Feather name="x" size={22} color={c.mutedForeground} />
              </Pressable>
            </View>

            {matchedTargetName ? (
              <View style={styles.matchBody}>
                <View
                  style={[
                    styles.matchedCard,
                    {
                      backgroundColor: c.success + "16",
                      borderColor: c.success + "55",
                    },
                  ]}
                >
                  <Feather name="check-circle" size={22} color={c.success} />
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[styles.matchRowTitle, { color: c.foreground }]}
                    >
                      Matched to {matchedTargetName}
                    </Text>
                    <Text
                      style={[
                        styles.matchRowMeta,
                        { color: c.mutedForeground },
                      ]}
                    >
                      Replaces the planned item.
                    </Text>
                  </View>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Undo match to ${matchedTargetName}`}
                  disabled={savingMatch}
                  onPress={() => void handleUnmatchBill()}
                  style={[
                    styles.unmatchButton,
                    {
                      borderColor: c.destructive,
                      opacity: savingMatch ? 0.55 : 1,
                    },
                  ]}
                >
                  <Text
                    style={[styles.unmatchButtonText, { color: c.destructive }]}
                  >
                    {savingMatch ? "Updating…" : "Undo match"}
                  </Text>
                </Pressable>
              </View>
            ) : (
              <>
                <Text style={[styles.matchIntro, { color: c.mutedForeground }]}>
                  Choose what this payment covered.
                </Text>
                <ScrollView
                  style={[
                    styles.matchList,
                    isDesktop && styles.desktopMatchList,
                  ]}
                  showsVerticalScrollIndicator={isDesktop}
                >
                  {combinedMatchOptions.length > 0 ? (
                    combinedMatchOptions.map((option, index) => (
                      <Pressable
                        key={`${option.targetType}-${option.billId}`}
                        accessibilityRole="button"
                        accessibilityLabel={`Match transaction to ${option.name}, planned ${option.plannedAmount.toFixed(2)}`}
                        disabled={savingMatch}
                        onPress={() =>
                          void (option.targetType === "manual"
                            ? handleMatchManual(option.billId)
                            : option.targetType === "bucket"
                              ? handleMatchBucket(option.billId)
                              : handleMatchBill(option.billId))
                        }
                        style={({ pressed }) => [
                          styles.matchRow,
                          {
                            backgroundColor: c.card,
                            borderColor:
                              index === 0 && option.score >= 48
                                ? c.success + "66"
                                : c.border,
                            opacity: savingMatch ? 0.55 : pressed ? 0.82 : 1,
                          },
                        ]}
                      >
                        <View
                          style={[
                            styles.matchIcon,
                            {
                              backgroundColor:
                                (index === 0 && option.score >= 48
                                  ? c.success
                                  : c.primary) + "18",
                            },
                          ]}
                        >
                          <Feather
                            name={
                              option.targetType === "manual"
                                ? "edit-3"
                                : option.targetType === "bucket"
                                  ? "archive"
                                  : "file-text"
                            }
                            size={17}
                            color={
                              index === 0 && option.score >= 48
                                ? c.success
                                : c.primary
                            }
                          />
                        </View>
                        <View style={{ flex: 1 }}>
                          <View style={styles.matchRowHeading}>
                            <Text
                              style={[
                                styles.matchRowTitle,
                                { color: c.foreground },
                              ]}
                              numberOfLines={1}
                            >
                              {option.name}
                            </Text>
                            {index === 0 && option.score >= 48 && (
                              <View
                                style={[
                                  styles.suggestedBadge,
                                  { backgroundColor: c.success + "20" },
                                ]}
                              >
                                <Text
                                  style={[
                                    styles.suggestedBadgeText,
                                    { color: c.success },
                                  ]}
                                >
                                  Suggested
                                </Text>
                              </View>
                            )}
                          </View>
                          <Text
                            style={[
                              styles.matchRowMeta,
                              { color: c.mutedForeground },
                            ]}
                          >
                            {option.targetType === "manual"
                              ? "Manual Activity"
                              : option.targetType === "bucket"
                                ? "Spending bucket"
                                : "Bill"}{" "}
                            · ${option.plannedAmount.toFixed(2)}
                            {option.targetType === "bucket"
                              ? " left"
                              : ""} ·{" "}
                            {option.daysApart === 0
                              ? "same day"
                              : option.daysApart === 1
                                ? "1 day away"
                                : option.daysApart !== null
                                  ? `${option.daysApart} days away`
                                  : option.category}
                          </Text>
                          {option.reasons.length > 0 && (
                            <Text
                              style={[styles.matchReason, { color: c.success }]}
                            >
                              {option.reasons.slice(0, 2).join(" · ")}
                            </Text>
                          )}
                        </View>
                        <Feather
                          name="chevron-right"
                          size={17}
                          color={c.mutedForeground}
                        />
                      </Pressable>
                    ))
                  ) : (
                    <View
                      style={[
                        styles.noMatchCard,
                        { backgroundColor: c.card, borderColor: c.border },
                      ]}
                    >
                      <Text
                        style={[styles.matchRowTitle, { color: c.foreground }]}
                      >
                        Nothing available to match
                      </Text>
                      <Text
                        style={[
                          styles.matchRowMeta,
                          { color: c.mutedForeground },
                        ]}
                      >
                        Add a bill, manual plan, or spending bucket, then return
                        here.
                      </Text>
                    </View>
                  )}
                </ScrollView>
              </>
            )}

            {matchingBankActivity &&
            !matchedTargetName &&
            matchTx?.amount < 0 &&
            matchTx.review_status === "needs_review" ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Create bucket and add transaction"
                disabled={savingMatch}
                onPress={() => {
                  const transaction = matchTx;
                  if (!transaction) return;
                  setMatchTx(null);
                  setTimeout(
                    () =>
                      setPendingBucketDraft({
                        transactionId: transaction.id,
                        name:
                          transaction.merchant_name?.trim() ||
                          transaction.note?.trim() ||
                          transaction.category ||
                          "Spending",
                        amount: Math.abs(transaction.amount),
                        date: transaction.date,
                      }),
                    MODAL_HANDOFF_DELAY_MS,
                  );
                }}
                style={({ pressed }) => [
                  styles.oneTimeButton,
                  {
                    backgroundColor: c.primary + "12",
                    borderColor: c.primary + "55",
                    opacity: savingMatch ? 0.55 : pressed ? 0.78 : 1,
                  },
                ]}
              >
                <View
                  style={[
                    styles.matchIcon,
                    { backgroundColor: c.primary + "18" },
                  ]}
                >
                  <Feather name="archive" size={17} color={c.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.matchRowTitle, { color: c.foreground }]}>
                    Create bucket and add transaction
                  </Text>
                  <Text
                    style={[styles.matchRowMeta, { color: c.mutedForeground }]}
                  >
                    Start with this purchase and optionally leave money for
                    more.
                  </Text>
                </View>
                <Feather name="chevron-right" size={17} color={c.primary} />
              </Pressable>
            ) : null}

            {matchingBankActivity && !matchedTargetName ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Save this as a one-time charge"
                disabled={savingMatch}
                onPress={() => {
                  const transaction = matchTx;
                  setMatchTx(null);
                  setUnplannedChargeTx(transaction);
                }}
                style={({ pressed }) => [
                  styles.oneTimeButton,
                  {
                    backgroundColor: c.primary + "12",
                    borderColor: c.primary + "55",
                    opacity: savingMatch ? 0.55 : pressed ? 0.78 : 1,
                  },
                ]}
              >
                <View
                  style={[
                    styles.matchIcon,
                    { backgroundColor: c.primary + "18" },
                  ]}
                >
                  <Feather name="shopping-bag" size={17} color={c.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.matchRowTitle, { color: c.foreground }]}>
                    One-time charge
                  </Text>
                  <Text
                    style={[styles.matchRowMeta, { color: c.mutedForeground }]}
                  >
                    Categorize it without creating a bill.
                  </Text>
                </View>
                <Feather name="chevron-right" size={17} color={c.primary} />
              </Pressable>
            ) : null}

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                matchingBankActivity
                  ? "Edit imported transaction details"
                  : "Edit manual transaction details"
              }
              onPress={() => {
                const transaction = matchTx;
                setMatchTx(null);
                if (transaction) {
                  setEditTx(transaction);
                  setEditModalVisible(true);
                }
              }}
              style={[styles.editImportedButton, { backgroundColor: c.muted }]}
            >
              <Feather name="edit-2" size={14} color={c.mutedForeground} />
              <Text style={[styles.editImportedText, { color: c.foreground }]}>
                {matchingBankActivity
                  ? "Edit imported transaction details"
                  : "Edit manual transaction details"}
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <UnplannedChargeModal
        visible={Boolean(unplannedChargeTx) && !forgottenBillVisible}
        transaction={unplannedChargeTx}
        categories={categories}
        saving={savingMatch}
        onClose={() => setUnplannedChargeTx(null)}
        onSaveOneTime={(category) => void saveOneTimeCharge(category)}
        onCreateBill={() => setForgottenBillVisible(true)}
      />

      <AddBillModal
        visible={forgottenBillVisible && Boolean(unplannedChargeTx)}
        onClose={() => setForgottenBillVisible(false)}
        onSave={saveForgottenBill}
        initialValues={forgottenBillDefaults}
        title="Add forgotten bill"
        saveLabel="Save bill and match payment"
      />

      <FullPaymentPromptModal
        visible={!!fullPaymentPrompt}
        prompt={
          fullPaymentPrompt
            ? {
                billName: fullPaymentPrompt.bill.name,
                budgeted: fullPaymentPrompt.budgeted,
                actual: fullPaymentPrompt.actual,
              }
            : null
        }
        onClose={() => setFullPaymentPrompt(null)}
        onKeepPartial={() => setFullPaymentPrompt(null)}
        onFullPayment={() => void confirmMatchedFullPayment()}
      />

      <BillSurplusModal
        visible={!!surplusPrompt}
        billName={surplusPrompt?.bill.name ?? "Bill"}
        itemType={surplusPrompt?.bill.is_debt ? "debt" : "bill"}
        budgeted={surplusPrompt?.budgeted ?? 0}
        actual={surplusPrompt?.actual ?? 0}
        targetDebt={surplusSnowballOffer?.targetDebt}
        snowballSafe={surplusSnowballOffer?.safe ?? false}
        snowballEnabled={settings.debtPayoffEnabled}
        safetyFloor={settings.safety_floor}
        forecastHorizonMonths={settings.forecast_horizon_months}
        paymentDate={surplusPaymentDate}
        paymentDateValid={surplusSnowballOffer?.dateValid ?? false}
        paymentDateMin={`${surplusYear}-${surplusMonthText}-01`}
        paymentDateMax={`${surplusYear}-${surplusMonthText}-${surplusMonthLastDay}`}
        routeMode={surplusRouteMode}
        nextPaymentDate={surplusSnowballOffer?.nextPayment?.date}
        nextPaymentAmount={surplusSnowballOffer?.nextPayment?.amount}
        onRouteModeChange={setSurplusRouteMode}
        onPaymentDateChange={setSurplusPaymentDate}
        onKeep={() => void keepMatchedSurplusAvailable()}
        onSnowball={() => void addMatchedSurplusToSnowball()}
        onClose={() => setSurplusPrompt(null)}
      />

      <Modal
        visible={filterModalVisible}
        transparent
        animationType={isDesktop ? "fade" : "slide"}
        onRequestClose={() => setFilterModalVisible(false)}
      >
        <Pressable
          style={[styles.filterOverlay, isDesktop && DESKTOP_MODAL_OVERLAY]}
          onPress={() => setFilterModalVisible(false)}
        >
          <Pressable
            style={[
              styles.filterSheet,
              { backgroundColor: c.background },
              isDesktop && DESKTOP_MODAL_REGULAR,
            ]}
            accessibilityViewIsModal
            onPress={(event) => event.stopPropagation()}
          >
            <View
              style={[
                styles.filterHandle,
                { backgroundColor: c.border },
                isDesktop && DESKTOP_MODAL_HANDLE,
              ]}
            />
            <View style={styles.filterSheetHeader}>
              <View>
                <Text
                  style={[styles.filterSheetTitle, { color: c.foreground }]}
                >
                  Filter activity
                </Text>
                <Text
                  style={[styles.filterSheetSub, { color: c.mutedForeground }]}
                >
                  Choose any combination
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close filters"
                onPress={() => setFilterModalVisible(false)}
                style={styles.modalCloseButton}
              >
                <Feather name="x" size={21} color={c.mutedForeground} />
              </Pressable>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={isDesktop}
              style={styles.filterSheetScroll}
            >
              <Text
                style={[
                  styles.filterGroupLabel,
                  { color: c.mutedForeground, marginTop: 2 },
                ]}
              >
                QUICK FILTERS
              </Text>
              <View style={styles.filterOptionGrid}>
                {quickChips.map((chip) => (
                  <Pressable
                    key={chip.key}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: chip.active }}
                    aria-checked={chip.active}
                    accessibilityLabel={`${chip.label} quick filter`}
                    onPress={chip.onPress}
                    style={({ pressed }) => [
                      styles.filterChip,
                      {
                        backgroundColor: chip.active ? c.primary : c.card,
                        borderColor: chip.active ? c.primary : c.border,
                        opacity: pressed ? 0.82 : 1,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.filterText,
                        {
                          color: chip.active
                            ? c.primaryForeground
                            : c.foreground,
                        },
                      ]}
                    >
                      {chip.label}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Text
                style={[styles.filterGroupLabel, { color: c.mutedForeground }]}
              >
                AMOUNT
              </Text>
              <View style={styles.filterOptionGrid}>
                {[
                  { id: "all" as TypeFilter, label: "All amounts" },
                  { id: "expense" as TypeFilter, label: "Expenses" },
                  { id: "income" as TypeFilter, label: "Income" },
                ].map((option) => (
                  <Pressable
                    key={option.id}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: typeFilter === option.id }}
                    aria-checked={typeFilter === option.id}
                    onPress={() => setTypeFilter(option.id)}
                    style={[
                      styles.filterChip,
                      {
                        backgroundColor:
                          typeFilter === option.id ? c.primary : c.card,
                        borderColor:
                          typeFilter === option.id ? c.primary : c.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.filterText,
                        {
                          color:
                            typeFilter === option.id
                              ? c.primaryForeground
                              : c.foreground,
                        },
                      ]}
                    >
                      {option.label}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Text
                style={[styles.filterGroupLabel, { color: c.mutedForeground }]}
              >
                SOURCE
              </Text>
              <View style={styles.filterOptionGrid}>
                {[
                  { id: "all" as SourceFilter, label: "All sources" },
                  { id: "transaction" as SourceFilter, label: "Manual" },
                  { id: "bill_payment" as SourceFilter, label: "Bills" },
                  { id: "income" as SourceFilter, label: "Scheduled income" },
                  {
                    id: "extra_payment" as SourceFilter,
                    label: "Debt payments",
                  },
                ].map((option) => (
                  <Pressable
                    key={option.id}
                    accessibilityRole="radio"
                    accessibilityState={{
                      checked: sourceFilter === option.id,
                    }}
                    aria-checked={sourceFilter === option.id}
                    onPress={() => setSourceFilter(option.id)}
                    style={[
                      styles.filterChip,
                      {
                        backgroundColor:
                          sourceFilter === option.id ? c.primary : c.card,
                        borderColor:
                          sourceFilter === option.id ? c.primary : c.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.filterText,
                        {
                          color:
                            sourceFilter === option.id
                              ? c.primaryForeground
                              : c.foreground,
                        },
                      ]}
                    >
                      {option.label}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Text
                style={[styles.filterGroupLabel, { color: c.mutedForeground }]}
              >
                DATE RANGE
              </Text>
              <View style={styles.filterOptionGrid}>
                {ACTIVITY_DATE_RANGE_OPTIONS.map((option) => (
                  <Pressable
                    key={option.id}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: rangeFilter === option.id }}
                    aria-checked={rangeFilter === option.id}
                    onPress={() => setRangeFilter(option.id)}
                    style={[
                      styles.filterChip,
                      {
                        backgroundColor:
                          rangeFilter === option.id ? c.primary : c.card,
                        borderColor:
                          rangeFilter === option.id ? c.primary : c.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.filterText,
                        {
                          color:
                            rangeFilter === option.id
                              ? c.primaryForeground
                              : c.foreground,
                        },
                      ]}
                    >
                      {option.label}
                    </Text>
                  </Pressable>
                ))}
              </View>

              {rangeFilter === "custom" ? (
                <View style={styles.customDateRow}>
                  <View style={styles.customDateField}>
                    <Text
                      style={[
                        styles.customDateLabel,
                        { color: c.mutedForeground },
                      ]}
                    >
                      Start (YYYY-MM-DD)
                    </Text>
                    <TextInput
                      accessibilityLabel="Custom Activity start date"
                      value={customStartDate}
                      onChangeText={setCustomStartDate}
                      placeholder="2026-01-01"
                      placeholderTextColor={c.mutedForeground}
                      style={[
                        styles.customDateInput,
                        {
                          color: c.foreground,
                          backgroundColor: c.card,
                          borderColor: c.border,
                        },
                      ]}
                    />
                  </View>
                  <View style={styles.customDateField}>
                    <Text
                      style={[
                        styles.customDateLabel,
                        { color: c.mutedForeground },
                      ]}
                    >
                      End (YYYY-MM-DD)
                    </Text>
                    <TextInput
                      accessibilityLabel="Custom Activity end date"
                      value={customEndDate}
                      onChangeText={setCustomEndDate}
                      placeholder="2026-12-31"
                      placeholderTextColor={c.mutedForeground}
                      style={[
                        styles.customDateInput,
                        {
                          color: c.foreground,
                          backgroundColor: c.card,
                          borderColor: c.border,
                        },
                      ]}
                    />
                  </View>
                </View>
              ) : null}

              {categoryOptions.length > 0 && (
                <>
                  <Text
                    style={[
                      styles.filterGroupLabel,
                      { color: c.mutedForeground },
                    ]}
                  >
                    CATEGORY
                  </Text>
                  <View style={styles.filterOptionGrid}>
                    {["all", ...categoryOptions].map((category) => (
                      <Pressable
                        key={category}
                        accessibilityRole="radio"
                        accessibilityState={{
                          checked: categoryFilter === category,
                        }}
                        aria-checked={categoryFilter === category}
                        onPress={() => setCategoryFilter(category)}
                        style={[
                          styles.filterChip,
                          {
                            backgroundColor:
                              categoryFilter === category ? c.primary : c.card,
                            borderColor:
                              categoryFilter === category
                                ? c.primary
                                : c.border,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.filterText,
                            {
                              color:
                                categoryFilter === category
                                  ? c.primaryForeground
                                  : c.foreground,
                            },
                          ]}
                        >
                          {category === "all" ? "All categories" : category}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </>
              )}

              <Text
                style={[styles.filterGroupLabel, { color: c.mutedForeground }]}
              >
                SORT
              </Text>
              <View style={styles.filterOptionGrid}>
                {[
                  {
                    id: "desc" as SortOrder,
                    label: "Newest first",
                    icon: "arrow-down" as const,
                  },
                  {
                    id: "asc" as SortOrder,
                    label: "Oldest first",
                    icon: "arrow-up" as const,
                  },
                ].map((option) => (
                  <Pressable
                    key={option.id}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: sortOrder === option.id }}
                    aria-checked={sortOrder === option.id}
                    onPress={() => setSortOrder(option.id)}
                    style={[
                      styles.filterChip,
                      {
                        backgroundColor:
                          sortOrder === option.id ? c.primary : c.card,
                        borderColor:
                          sortOrder === option.id ? c.primary : c.border,
                      },
                    ]}
                  >
                    <Feather
                      name={option.icon}
                      size={13}
                      color={
                        sortOrder === option.id
                          ? c.primaryForeground
                          : c.foreground
                      }
                    />
                    <Text
                      style={[
                        styles.filterText,
                        {
                          color:
                            sortOrder === option.id
                              ? c.primaryForeground
                              : c.foreground,
                        },
                      ]}
                    >
                      {option.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>

            <View style={styles.filterActions}>
              <Pressable
                onPress={clearFilterSelections}
                style={[
                  styles.filterActionButton,
                  { backgroundColor: c.card, borderColor: c.border },
                ]}
              >
                <Text
                  style={[
                    styles.filterActionText,
                    { color: c.mutedForeground },
                  ]}
                >
                  Clear
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setFilterModalVisible(false)}
                style={[
                  styles.filterActionButton,
                  { backgroundColor: c.primary, borderColor: c.primary },
                ]}
              >
                <Text
                  style={[
                    styles.filterActionText,
                    { color: c.primaryForeground },
                  ]}
                >
                  Show {filtered.length} results
                </Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
      {/* ── Edit modal (manual transactions) ── */}
      <AddTransactionModal
        visible={editModalVisible}
        onClose={() => {
          setEditModalVisible(false);
          setEditTx(null);
        }}
        onSave={handleSave}
        onDelete={handleDelete}
        onDeleteTransfer={handleDeleteTransfer}
        editTx={editTx}
      />
      <DebtPaymentAppliedModal
        visible={!!debtPaymentNotice}
        detail={debtPaymentNotice}
        onClose={() => setDebtPaymentNotice(null)}
      />
      <SnowballPreviewModal
        visible={!!editExtraPayment}
        method="snowball"
        preview={editExtraPreview}
        amount={editExtraAmount}
        existingPayment
        paymentDate={editExtraDate}
        paymentDateMin={editExtraDateLimits.min}
        paymentDateMax={editExtraDateLimits.max}
        paymentDateMinimumReason={
          editExtraDateLimits.bucketAvailableDate
            ? `Includes bucket money available ${editExtraDateLimits.bucketAvailableDate}. Reopen the bucket before removing that source.`
            : undefined
        }
        safetyFloor={settings.safety_floor}
        forecastHorizonMonths={settings.forecast_horizon_months}
        onAmountChange={updateExtraPaymentAmount}
        onPaymentDateChange={updateExtraPaymentDate}
        onClose={() => {
          setEditExtraPayment(null);
          setEditExtraPreview(null);
        }}
        onConfirm={() => {
          void saveEditedExtraPayment();
        }}
        onRemove={removeEditedExtraPayment}
      />
      <GoalModal
        visible={Boolean(pendingBucketDraft)}
        onClose={() => setPendingBucketDraft(null)}
        onSave={async (goal) => {
          if ("id" in goal) return;
          if (pendingBucketDraft?.transactionId) {
            const result = await createSpendingBucketForTransaction({
              transactionId: pendingBucketDraft.transactionId,
              name: goal.name,
              targetAmount: goal.target_amount,
              targetDate: goal.target_date,
            });
            Alert.alert(
              "Bucket created and transaction added",
              result.remainingAmount > 0.005
                ? `$${result.remainingAmount.toFixed(2)} remains in ${goal.name} for future purchases.`
                : `${goal.name} now includes this posted transaction.`,
            );
          } else {
            await addGoal(goal);
            Alert.alert(
              "Money set aside",
              `Your ${goal.name} bucket is ready. Match the charge to it after the bank posts it.`,
            );
          }
        }}
        initialMode="budget"
        initialName={pendingBucketDraft?.name ?? ""}
        initialTargetAmount={pendingBucketDraft?.amount}
        initialTargetDate={pendingBucketDraft?.date}
        title={
          pendingBucketDraft?.transactionId
            ? "Create bucket and add transaction"
            : undefined
        }
        saveLabel={
          pendingBucketDraft?.transactionId
            ? "Create bucket and add transaction"
            : undefined
        }
        lockedMode="budget"
        minimumTargetAmount={
          pendingBucketDraft?.transactionId
            ? pendingBucketDraft.amount
            : undefined
        }
        minimumTargetDate={
          pendingBucketDraft?.transactionId
            ? pendingBucketDraft.date
            : undefined
        }
        hint={
          pendingBucketDraft?.transactionId
            ? "This purchase has already posted. It will be added to the new bucket now; any amount left stays available for future purchases."
            : undefined
        }
        skipAffordabilityCheck={Boolean(pendingBucketDraft?.transactionId)}
      />

      {/* ── Detail sheet (auto-generated entries) ── */}
      {renderWeeklySummarySheet()}
      {renderDetailSheet()}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 18,
    paddingBottom: 10,
  },
  headerCopy: { flex: 1, minWidth: 0, paddingRight: 8 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  headerEyebrow: {
    fontSize: 10,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: 1.35,
    marginBottom: 3,
  },
  exportButton: {
    width: 44,
    height: 44,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  addActivityButton: {
    width: 44,
    height: 44,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#7c3aed",
    shadowOffset: { width: 0, height: 7 },
    shadowOpacity: 0.24,
    shadowRadius: 12,
    elevation: 4,
  },
  title: {
    fontSize: 30,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: -0.9,
  },
  subtitle: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    marginTop: 2,
    lineHeight: 17,
    letterSpacing: 0.1,
  },
  attentionCard: {
    minHeight: 86,
    marginHorizontal: 16,
    marginBottom: 11,
    borderWidth: 1,
    borderRadius: 20,
    padding: 13,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  attentionStack: {
    gap: 10,
  },
  attentionIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  attentionCopy: { flex: 1, minWidth: 0 },
  attentionEyebrow: {
    fontSize: 9,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: 0.8,
    marginBottom: 3,
  },
  attentionTitle: {
    fontSize: 14,
    fontFamily: "Inter_800ExtraBold",
    lineHeight: 19,
  },
  attentionBody: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    lineHeight: 16,
    marginTop: 2,
  },
  reviewAlertButton: {
    width: 54,
    height: 54,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.13,
    shadowRadius: 14,
    elevation: 3,
  },
  reviewAlertBadge: {
    position: "absolute",
    top: -6,
    right: -6,
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#020617",
  },
  reviewAlertBadgeText: {
    color: "#fff",
    fontSize: 11,
    fontFamily: "Inter_800ExtraBold",
  },
  pendingNotice: {
    marginHorizontal: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 13,
    paddingVertical: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  pendingNoticeCopy: { flex: 1 },
  pendingNoticeTitle: { fontSize: 13, fontFamily: "Inter_800ExtraBold" },
  pendingNoticeBody: {
    fontSize: 11,
    lineHeight: 16,
    fontFamily: "Inter_500Medium",
    marginTop: 2,
  },

  activityHeroLabel: {
    fontSize: 9,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  activityHeroHeading: { flex: 1, minWidth: 0 },
  activityHeroBadge: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
  },
  activityHeroBadgeText: { fontSize: 10, fontFamily: "Inter_800ExtraBold" },
  monthlySummaryCard: {
    marginHorizontal: 16,
    marginBottom: 17,
    borderWidth: 1,
    borderRadius: 26,
    padding: 17,
  },
  monthlySummaryHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 8,
  },
  monthlySummaryTitle: {
    fontSize: 15,
    fontFamily: "Inter_800ExtraBold",
    marginTop: 2,
  },
  activityNetValue: {
    fontSize: 39,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: -1.5,
    marginBottom: 15,
  },
  monthlySummaryStats: { flexDirection: "row", gap: 10, marginBottom: 12 },
  monthlySummaryStat: {
    flex: 1,
    minWidth: 0,
    borderRadius: 16,
    backgroundColor: "rgba(15,23,42,0.42)",
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  monthlySummaryValue: { fontSize: 16, fontFamily: "Inter_800ExtraBold" },
  monthlySummaryLabel: {
    fontSize: 10,
    fontFamily: "Inter_700Bold",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 2,
  },
  loadedTotalsNote: {
    fontSize: 10,
    fontFamily: "Inter_500Medium",
    lineHeight: 15,
    marginBottom: 11,
  },
  weekSummaryTrigger: {
    borderTopWidth: 1,
    paddingTop: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  weekSummaryCopy: { flex: 1, minWidth: 0 },
  weekSummaryTitle: { fontSize: 13, fontFamily: "Inter_800ExtraBold" },
  weekSummarySub: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    marginTop: 2,
    lineHeight: 15,
  },
  recentActivityHeader: {
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  recentActivityCopy: { flex: 1, minWidth: 0 },
  recentActivityTitle: {
    fontSize: 20,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: -0.35,
  },
  recentActivitySubtitle: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    lineHeight: 16,
    marginTop: 2,
  },
  quickFilterRow: {
    paddingHorizontal: 16,
    paddingBottom: 10,
    gap: 8,
  },
  quickFilterChip: {
    minHeight: 44,
    minWidth: 78,
    paddingHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  quickFilterText: { fontSize: 12, fontFamily: "Inter_700Bold" },

  summaryOverlay: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 16,
    backgroundColor: "rgba(2,6,23,0.72)",
  },
  summarySheet: {
    width: "100%",
    maxWidth: 520,
    maxHeight: "92%",
    alignSelf: "center",
    borderWidth: 1,
    borderRadius: 24,
    padding: 16,
    shadowColor: "#7c3aed",
    shadowOpacity: 0.22,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },
  summarySheetHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 14,
  },
  modalCloseButton: {
    width: 44,
    height: 44,
    marginTop: -8,
    marginRight: -8,
    alignItems: "center",
    justifyContent: "center",
  },
  summarySheetScroll: { flexGrow: 0 },
  summarySheetScrollContent: { paddingBottom: 2 },
  summarySheetTitle: {
    fontSize: 24,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: -0.7,
    marginTop: 3,
  },
  summarySheetScopeNote: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    lineHeight: 16,
    marginTop: 3,
  },
  summaryTotalRow: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 14,
    alignItems: "stretch",
    gap: 10,
    marginBottom: 14,
  },
  summaryTinyLabel: {
    fontSize: 10,
    fontFamily: "Inter_800ExtraBold",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  summaryLargeNet: {
    fontSize: 30,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: -0.8,
    marginTop: 2,
  },
  summaryTotalRight: {
    width: "100%",
    minWidth: 0,
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10,
  },
  summaryMiniValue: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    fontFamily: "Inter_800ExtraBold",
  },
  summaryWeekList: { gap: 8 },
  summaryWeekCard: {
    minHeight: 52,
    borderWidth: 1,
    borderRadius: 15,
    paddingHorizontal: 14,
    paddingVertical: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  summaryWeekMiddle: { flex: 1 },
  summaryWeekLabel: {
    fontSize: 13,
    fontFamily: "Inter_700Bold",
    lineHeight: 18,
  },
  summaryWeekValue: { fontSize: 15, fontFamily: "Inter_800ExtraBold" },

  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
  },
  searchBox: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 13,
    paddingVertical: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    padding: 0,
  },
  clearSearchButton: {
    width: 44,
    height: 44,
    marginVertical: -10,
    marginRight: -12,
    alignItems: "center",
    justifyContent: "center",
  },
  filterIconButton: {
    width: 44,
    height: 44,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  filterCount: {
    position: "absolute",
    top: -5,
    right: -5,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  filterCountText: { color: "#fff", fontSize: 10, fontFamily: "Inter_700Bold" },

  filterOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  filterSheet: {
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 32,
    maxHeight: "88%",
  },
  filterHandle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 16,
  },
  filterSheetHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  filterSheetTitle: { fontSize: 20, fontFamily: "Inter_700Bold" },
  filterSheetSub: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    marginTop: 3,
  },
  filterSheetScroll: { flexGrow: 0 },
  filterGroupLabel: {
    fontSize: 10,
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.7,
    marginTop: 12,
    marginBottom: 8,
  },
  filterOptionGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  customDateRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 10,
  },
  customDateField: { flex: 1, minWidth: 150 },
  customDateLabel: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    marginBottom: 5,
  },
  customDateInput: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 14,
  },
  filterChip: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderWidth: 1,
    borderRadius: 10,
  },
  filterText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  filterActions: { flexDirection: "row", gap: 10, marginTop: 18 },
  filterActionButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  filterActionText: { fontSize: 14, fontFamily: "Inter_700Bold" },

  matchOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.62)",
  },
  matchSheet: {
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 28,
    maxHeight: "88%",
  },
  matchHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 14,
  },
  matchEyebrow: {
    fontSize: 9,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: 1.1,
    marginBottom: 4,
  },
  matchTitle: {
    fontSize: 20,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: -0.3,
  },
  matchAmount: { fontSize: 13, fontFamily: "Inter_700Bold", marginTop: 5 },
  matchIntro: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    lineHeight: 18,
    marginBottom: 12,
  },
  matchList: { flexGrow: 0, maxHeight: 420 },
  desktopMatchList: { maxHeight: 360 },
  matchBody: { gap: 12 },
  matchRow: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 12,
    marginBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  matchIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  matchRowHeading: { flexDirection: "row", alignItems: "center", gap: 7 },
  matchRowTitle: { flexShrink: 1, fontSize: 14, fontFamily: "Inter_700Bold" },
  matchRowMeta: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    lineHeight: 16,
    marginTop: 2,
  },
  matchReason: {
    fontSize: 10,
    fontFamily: "Inter_700Bold",
    marginTop: 3,
    textTransform: "capitalize",
  },
  suggestedBadge: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
  },
  suggestedBadgeText: {
    fontSize: 9,
    fontFamily: "Inter_800ExtraBold",
    textTransform: "uppercase",
  },
  matchedCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 11,
  },
  noMatchCard: { borderWidth: 1, borderRadius: 16, padding: 15 },
  unmatchButton: {
    minHeight: 46,
    borderWidth: 1,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  unmatchButtonText: { fontSize: 14, fontFamily: "Inter_700Bold" },
  oneTimeButton: {
    minHeight: 62,
    borderWidth: 1,
    borderRadius: 16,
    padding: 11,
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  editImportedButton: {
    minHeight: 46,
    borderRadius: 13,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    marginTop: 12,
  },
  editImportedText: { fontSize: 13, fontFamily: "Inter_700Bold" },

  list: {},
  sectionHeader: { paddingHorizontal: 16, paddingTop: 13, paddingBottom: 7 },
  sectionTitle: {
    fontSize: 12,
    fontFamily: "Inter_800ExtraBold",
    textTransform: "uppercase",
    letterSpacing: 0.7,
  },

  txRow: {
    minHeight: 78,
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 16,
    paddingHorizontal: 13,
    paddingVertical: 12,
    gap: 12,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.10)",
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  rowAccent: { position: "absolute", left: 0, top: 0, bottom: 0, width: 3 },
  sourceIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  txMid: { flex: 1, minWidth: 0 },
  txNote: { fontSize: 14, fontFamily: "Inter_800ExtraBold", marginBottom: 4 },
  txMetaLine: { fontSize: 10, fontFamily: "Inter_500Medium", lineHeight: 15 },
  txStatus: {
    alignSelf: "flex-start",
    maxWidth: "100%",
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    marginTop: 5,
  },
  txStatusText: { flexShrink: 1, fontSize: 9, fontFamily: "Inter_700Bold" },
  txMeta: {
    flexDirection: "row",
    gap: 5,
    alignItems: "center",
    flexWrap: "wrap",
  },
  sourceBadge: { paddingHorizontal: 5, paddingVertical: 2, borderRadius: 5 },
  sourceBadgeText: { fontSize: 9, fontFamily: "Inter_700Bold" },
  catBadge: { paddingHorizontal: 5, paddingVertical: 2, borderRadius: 5 },
  catBadgeText: { fontSize: 9, fontFamily: "Inter_600SemiBold" },
  debtBadge: {
    maxWidth: 180,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  debtBadgeText: { flexShrink: 1, fontSize: 9, fontFamily: "Inter_700Bold" },
  txDate: { fontSize: 9, fontFamily: "Inter_400Regular" },
  txRight: {
    maxWidth: "39%",
    minWidth: 0,
    flexShrink: 1,
    alignItems: "flex-end",
  },
  txAmount: { fontSize: 15, fontFamily: "Inter_800ExtraBold" },
  txBalance: { fontSize: 9, fontFamily: "Inter_500Medium", marginTop: 3 },

  // Detail bottom sheet
  sheetOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  sheet: {
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: 20,
    paddingBottom: 36,
    paddingTop: 12,
  },
  sheetScrollContent: { paddingBottom: 2 },
  sheetHandle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 18,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 14,
    marginBottom: 18,
  },
  sheetIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetName: {
    fontSize: 20,
    fontFamily: "Inter_700Bold",
    marginBottom: 6,
    lineHeight: 26,
  },
  sourcePill: {
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  sourcePillText: { fontSize: 11, fontFamily: "Inter_700Bold" },
  sheetAmtBox: { alignItems: "center", paddingVertical: 20, marginBottom: 16 },
  sheetAmt: { fontSize: 40, fontFamily: "Inter_700Bold" },
  sheetAmtLabel: { fontSize: 13, fontFamily: "Inter_500Medium", marginTop: 4 },
  sheetRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sheetRowIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  sheetRowLabel: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    marginBottom: 2,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  sheetRowValue: { fontSize: 14, fontFamily: "Inter_400Regular" },
  sheetNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 12,
    marginTop: 16,
    marginBottom: 4,
  },
  sheetNoteText: {
    flex: 1,
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    lineHeight: 17,
  },
  pendingBucketButton: {
    minHeight: 62,
    borderRadius: colors.radius,
    paddingHorizontal: 15,
    paddingVertical: 11,
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
  },
  pendingMatchButton: {
    minHeight: 62,
    borderWidth: 1,
    borderRadius: colors.radius,
    paddingHorizontal: 15,
    paddingVertical: 11,
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
  },
  pendingBucketButtonCopy: { flex: 1 },
  pendingBucketButtonTitle: { fontSize: 14, fontFamily: "Inter_800ExtraBold" },
  pendingBucketButtonBody: {
    fontSize: 11,
    lineHeight: 15,
    fontFamily: "Inter_500Medium",
    marginTop: 2,
    opacity: 0.82,
  },
  sheetClose: {
    height: 50,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 14,
  },
  sheetCloseText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
