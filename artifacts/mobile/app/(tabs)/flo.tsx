import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Share,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { useMembership } from "@/context/MembershipContext";
import { useBudget } from "@/context/BudgetContext";
import { BasicFlo } from "@/components/BasicFlo";
import { DataFreshnessLabel } from "@/components/DataFreshnessLabel";
import { FloConversationBar } from "@/components/FloConversationBar";
import { FloGroundedAnswer } from "@/components/FloGroundedAnswer";
import { FloLogo } from "@/components/FloLogo";
import { PremiumBackdrop } from "@/components/PremiumBackdrop";
import { useColors } from "@/hooks/useColors";
import { useDesktopExperience } from "@/hooks/useDesktopExperience";
import { isCashFlowTransaction } from "@/lib/billMatching";
import { isBillEligibleForUpcomingPlan } from "@/lib/billEligibility";
import { type FloFacts } from "@/lib/flo";
import { createFloAiConsent, floAiConsentStorageKey, parseFloAiConsent } from "@/lib/floAiConsent";
import { humanizeFloText } from "@/lib/floLanguage";
import { exportFloHistoryText, floConversationForRequest, floProposalMatchesAuthoritative, isFloRequestGenerationCurrent, nextFloRequestGeneration, type FloReviewProposal } from "@/lib/floExperience";
import { DEFAULT_FLO_PREFERENCES, readFloPreferences, saveFloPreferences, type FloPreferences } from "@/lib/floPreferences";
import {
  createFloConversation,
  createFloId,
  confirmFloRecurringBillProposal,
  deleteAllFloConversations,
  deleteFloConversation,
  listAllFloMessages,
  listFloConversations,
  listFloMessages,
  readFloHouseholdMemory,
  readAuthoritativeFloProposal,
  renameFloConversation,
  searchFloConversationContent,
  streamFloChat,
  updateFloHouseholdMemory,
  type FloConversation,
  type FloSource,
} from "@/lib/floChat";
import {
  buildFloCategoryQuickPrompts,
  reduceFloChat,
  type FloChatState,
} from "@/lib/floPolicy";
import { isFloTimeoutCode, type FloVerifiedFallback } from "@/lib/floStream";
import { summarizeMonthlyBills } from "@/lib/monthlySummary";
import { buildDecisionHistory } from "@/lib/decisionHistory";
import { buildDecisionRiskAlerts } from "@/lib/decisionRisk";
import { buildCategoryPlan } from "@/lib/categoryPlanning";
import { categoryBudgetStorageKey, loadCategoryBudgets, readCategoryBudgetCache, subscribeCategoryBudgets } from "@/lib/categoryBudgetStore";
import { DEFAULT_DECISION_HUB_SETTINGS } from "@/lib/decisionHubSettings";
import { localDateString } from "@/lib/dateLabels";
import { buildPaycheckPlan, makeDateKey } from "@/lib/paycheckPlanning";
import { buildAlgorithmSuite } from "@/lib/algorithmSuite";
import { calendarVisibleForecastEvents, groupForecastEvents } from "@/lib/forecastDisplay";
import { loadOnboardingPreferences, readOnboardingPreferences } from "@/lib/onboardingPreferences";
import { buildSetupPersonalization } from "@/lib/onboardingPersonalization";

const sampleQuestions = [
  "Ask Flo anything…",
  "Which bills are due next?",
  "Which records did you use?",
  "What account data can I improve?",
  "How do I add income?",
];

const initialChat: FloChatState = { messages: [], sending: false };
const storeCaptureChat: FloChatState = {
  sending: false,
  messages: [
    {
      id: "store-capture-question",
      role: "user",
      text: "Can I afford an extra $100 toward Harbor Card?",
    },
    {
      id: "store-capture-answer",
      role: "flo",
      text: "Yes. Your plan stays positive through the next payday after reserving upcoming bills. Adding $100 to Harbor Card would leave $2,630 safe to spend this month.",
    },
  ],
};

function moneyValue(value: unknown): string {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount.toLocaleString(undefined, { style: "currency", currency: "USD" }) : "Unavailable";
}

export default function FloScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ prompt?: string; promptId?: string; sourceRoute?: string; entityType?: string; entityId?: string; date?: string; label?: string }>();
  const router = useRouter();
  const isDesktop = useDesktopExperience();
  const { user } = useAuth();
  const { isFeatureLocked, previewTier } = useMembership();
  const { activeHousehold, bills, billDateMoves, transactions, decisions, settings, forecastConfidence, retryBudgetLoad, getDailyBalances, getCashFlow, getMonthlyBills, getBillMonthlyTotal, getBillOccurrencesInMonth, getDebtMonthSettlements, getIncomeOccurrencesInMonth, getPaidAmount, getTransactionsForMonth, categories, incomes, goals, demoMode } = useBudget();
  const categoryBudgetScope = useMemo(() => ({
    userId: user?.id,
    householdId: activeHousehold?.householdId,
    budgetId: activeHousehold?.budgetId,
  }), [activeHousehold?.budgetId, activeHousehold?.householdId, user?.id]);
  const floProLocked = isFeatureLocked("flo_account_chat");
  const [chat, dispatch] = useReducer(reduceFloChat, demoMode ? storeCaptureChat : initialChat);
  const [categoryBudgets, setCategoryBudgets] = useState<Record<string, number>>({});
  const decisionHubSettings = DEFAULT_DECISION_HUB_SETTINGS;
  const [onboardingPreferences, setOnboardingPreferences] = useState(() => readOnboardingPreferences());
  const [input, setInput] = useState("");
  const [conversations, setConversations] = useState<FloConversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [olderMessageCursor, setOlderMessageCursor] = useState<string | null>(null);
  const [sourcesByMessageId, setSourcesByMessageId] = useState<Record<string, FloSource[]>>({});
  const [followUpsByMessageId, setFollowUpsByMessageId] = useState<Record<string, string[]>>({});
  const [proposalByMessageId, setProposalByMessageId] = useState<Record<string, FloReviewProposal | null>>({});
  const [confirmedProposalIds, setConfirmedProposalIds] = useState<Set<string>>(new Set());
  const [groundingByMessageId, setGroundingByMessageId] = useState<Record<string, { dataAsOf?: string | null; coverage?: string; partial?: boolean; caveat?: string }>>(
    demoMode
      ? { "store-capture-answer": { dataAsOf: "2026-08-25T01:30:00-05:00", coverage: "Complete for this question" } }
      : {},
  );
  const [floPreferences, setFloPreferences] = useState<FloPreferences>(DEFAULT_FLO_PREFERENCES);
  const [reviewProposal, setReviewProposal] = useState<FloReviewProposal | null>(null);
  const [proposalConfirmState, setProposalConfirmState] = useState<"idle" | "reviewing" | "confirming" | "failed">("idle");
  const [proposalConfirmError, setProposalConfirmError] = useState("");
  const [proposalReceipt, setProposalReceipt] = useState<{ previousAmount: number; newAmount: number; confirmedAt: string } | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);
  const [lastPrompt, setLastPrompt] = useState("");
  const [aiConsentAccepted, setAiConsentAccepted] = useState(false);
  const [aiConsentReady, setAiConsentReady] = useState(false);
  const [aiConsentPrompt, setAiConsentPrompt] = useState<string | null>(null);
  const [sampleIndex, setSampleIndex] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const handledPromptRef = useRef<string | null>(null);
  const streamAbortRef = useRef<AbortController | null>(null);
  const skipConversationLoadRef = useRef<string | null>(null);
  const retryRequestRef = useRef<{ text: string; userMessageId: string; assistantMessageId: string; conversationId: string | null } | null>(null);
  const requestGenerationRef = useRef(0);
  const floDataScopeKey = `${user?.id ?? "anonymous"}:${activeHousehold?.householdId ?? "none"}`;
  const floDataScopeKeyRef = useRef(floDataScopeKey);
  floDataScopeKeyRef.current = floDataScopeKey;
  const activeConversationIdRef = useRef(activeConversationId);
  activeConversationIdRef.current = activeConversationId;
  const now = useMemo(() => new Date(), []);
  const today = localDateString(now);

  useEffect(() => {
    let cancelled = false;
    setAiConsentReady(false);
    setAiConsentAccepted(false);
    setAiConsentPrompt(null);
    if (!user?.id) {
      setAiConsentReady(true);
      return () => { cancelled = true; };
    }
    void AsyncStorage.getItem(floAiConsentStorageKey(user.id))
      .then(value => {
        if (!cancelled) setAiConsentAccepted(parseFloAiConsent(value, user.id));
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setAiConsentReady(true);
      });
    return () => { cancelled = true; };
  }, [user?.id]);

  useEffect(() => {
    let cancelled = false;
    requestGenerationRef.current = nextFloRequestGeneration(requestGenerationRef.current);
    streamAbortRef.current?.abort();
    streamAbortRef.current = null;
    dispatch({ type: "hydrate", messages: demoMode ? storeCaptureChat.messages : [] });
    setSourcesByMessageId({});
    setFollowUpsByMessageId({});
    setProposalByMessageId({});
    setGroundingByMessageId(demoMode
      ? { "store-capture-answer": { dataAsOf: "2026-08-25T01:30:00-05:00", coverage: "Complete for this question" } }
      : {});
    setOlderMessageCursor(null);
    setChatError(null);
    if (demoMode || !user?.id || !activeHousehold?.householdId || floProLocked) {
      setConversations([]);
      setActiveConversationId(null);
      return () => { cancelled = true; };
    }
    void listFloConversations(activeHousehold.householdId).then(next => {
      if (cancelled) return;
      setConversations(next);
      setActiveConversationId(next[0]?.id ?? null);
    }).catch(() => {
      if (!cancelled) setChatError("Private Flo history is unavailable right now.");
    });
    return () => { cancelled = true; };
  }, [activeHousehold?.householdId, demoMode, floProLocked, user?.id]);

  useEffect(() => {
    let cancelled = false;
    if (demoMode || !user?.id || !activeHousehold?.householdId) return () => { cancelled = true; };
    void Promise.all([
      readFloPreferences(user.id, activeHousehold.householdId),
      readFloHouseholdMemory(activeHousehold.householdId, user.id).catch(() => ({ enabled: false, note: "" })),
    ]).then(([preferences, memory]) => {
      if (!cancelled) setFloPreferences({ ...preferences, rememberPreferences: memory.enabled, preferenceNote: memory.enabled ? memory.note : "" });
    });
    return () => { cancelled = true; };
  }, [activeHousehold?.householdId, demoMode, user?.id]);

  useEffect(() => {
    let cancelled = false;
    const requestGeneration = requestGenerationRef.current;
    const requestScopeKey = floDataScopeKey;
    const requestIsCurrent = () => (
      !cancelled
      && requestGeneration === requestGenerationRef.current
      && requestScopeKey === floDataScopeKeyRef.current
    );
    if (!activeConversationId || floProLocked) return () => { cancelled = true; };
    if (skipConversationLoadRef.current === activeConversationId) {
      skipConversationLoadRef.current = null;
      return () => { cancelled = true; };
    }
    void listFloMessages(activeConversationId).then(page => {
      if (!requestIsCurrent()) return;
      dispatch({ type: "hydrate", messages: page.messages.map(message => ({ id: message.id, role: message.role, text: message.text })) });
      setSourcesByMessageId(Object.fromEntries(page.messages.filter(message => message.sources.length).map(message => [message.id, message.sources])));
      setFollowUpsByMessageId(Object.fromEntries(page.messages.filter(message => message.followUps.length).map(message => [message.id, message.followUps])));
      void Promise.all(page.messages.filter(message => message.proposal?.kind === "recurring_bill_change").map(async message => {
        const authoritative = await readAuthoritativeFloProposal(message.proposal!.id);
        return floProposalMatchesAuthoritative(message.proposal!, authoritative) ? [message.id, authoritative] as const : null;
      })).then(rows => { if (requestIsCurrent()) setProposalByMessageId(Object.fromEntries(rows.filter((row): row is readonly [string, FloReviewProposal] => Boolean(row)))); }).catch(() => { if (requestIsCurrent()) setProposalByMessageId({}); });
      setGroundingByMessageId(Object.fromEntries(page.messages.filter(message => message.dataAsOf || message.partial || message.coverage || message.caveat).map(message => [message.id, { dataAsOf: message.dataAsOf, partial: message.partial, coverage: describeCoverage(message.coverage), caveat: message.caveat }])));
      setOlderMessageCursor(page.nextCursor);
    }).catch(() => {
      if (requestIsCurrent()) setChatError("This private chat could not be loaded.");
    });
    return () => { cancelled = true; };
  }, [activeConversationId, floDataScopeKey, floProLocked]);

  useEffect(() => {
    let cancelled = false;
    void loadOnboardingPreferences(user?.id).then(next => {
      if (!cancelled) setOnboardingPreferences(next);
    });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  useEffect(() => {
    const timer = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    return () => clearTimeout(timer);
  }, [chat.messages.length, chat.sending]);

  useEffect(() => {
    const timer = setInterval(() => setSampleIndex(index => (index + 1) % sampleQuestions.length), 2400);
    return () => clearInterval(timer);
  }, []);

  const baseline = useMemo(() => {
    const output: { date: string; balance: number }[] = [];
    for (let index = 0; index < settings.forecast_horizon_months; index += 1) {
      const month = (now.getMonth() + index) % 12;
      const year = now.getFullYear() + Math.floor((now.getMonth() + index) / 12);
      getDailyBalances(month, year).forEach(day => output.push({
        date: `${year}-${String(month + 1).padStart(2, "0")}-${String(day.day).padStart(2, "0")}`,
        balance: day.balance,
      }));
    }
    return output.filter(day => day.date >= today);
  }, [getDailyBalances, settings.forecast_horizon_months, today]);

  const upcoming = useMemo(() => bills
    .filter(bill => bill.is_recurring || bill.is_debt)
    .map(bill => {
      let date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(Math.min(bill.due_day, new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate())).padStart(2, "0")}`;
      if (date < today) {
        const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        date = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, "0")}-${String(Math.min(bill.due_day, new Date(nextMonth.getFullYear(), nextMonth.getMonth() + 1, 0).getDate())).padStart(2, "0")}`;
      }
      return { name: bill.name, amount: bill.amount, date };
    })
    .sort((left, right) => left.date.localeCompare(right.date))
    .slice(0, 5), [bills, today]);

  const categoryBudgetKey = useMemo(() => {
    const month = now.getMonth();
    const year = now.getFullYear();
    return categoryBudgetStorageKey(month, year, categoryBudgetScope);
  }, [categoryBudgetScope, today]);

  useEffect(() => {
    let cancelled = false;
    const month = now.getMonth();
    const year = now.getFullYear();
    const refreshCategoryBudgets = () => {
      setCategoryBudgets(readCategoryBudgetCache(month, year, categoryBudgetScope));
      void loadCategoryBudgets(categoryBudgetScope, month, year).then(next => {
        if (!cancelled) setCategoryBudgets(next);
      });
    };
    refreshCategoryBudgets();
    const unsubscribe = subscribeCategoryBudgets(refreshCategoryBudgets);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [categoryBudgetKey, categoryBudgetScope, now]);

  const categoryPlan = useMemo(() => {
    if (!settings.zeroBasedBudgetEnabled) return [];
    const month = now.getMonth();
    const year = now.getFullYear();
    const monthBills = getMonthlyBills(month, year)
      .filter(isBillEligibleForUpcomingPlan)
      .map(bill => ({
        category: bill.is_debt ? "Debt" : bill.category || "Other",
        amount: getBillMonthlyTotal(bill, month, year),
      }));
    const monthTransactions = getTransactionsForMonth(month, year)
      .filter(transaction => isCashFlowTransaction(transaction) && transaction.category !== "Income")
      .map(transaction => ({ category: transaction.category || "Other", amount: transaction.amount }));
    const rows = buildCategoryPlan(
      categories,
      monthBills,
      monthTransactions,
      Object.entries(categoryBudgets).map(([category, amount]) => ({ category, amount })),
    );
    const transactionDetails = getTransactionsForMonth(month, year)
      .filter(transaction => isCashFlowTransaction(transaction) && transaction.amount < 0 && transaction.category !== "Income");
    return rows.map(row => {
      const topTransaction = transactionDetails
        .filter(transaction => (transaction.category || "Other") === row.category)
        .sort((left, right) => Math.abs(right.amount) - Math.abs(left.amount))[0];
      return {
        category: row.category,
        budgeted: row.budgeted,
        spent: row.spent,
        remaining: row.remaining,
        status: row.status,
        percentUsed: row.percentUsed,
        topTransaction: topTransaction ? {
          name: topTransaction.note?.trim() || row.category,
          amount: topTransaction.amount,
          date: topTransaction.date,
        } : undefined,
      };
    });
  }, [categories, categoryBudgets, getMonthlyBills, getBillMonthlyTotal, getTransactionsForMonth, now, settings.zeroBasedBudgetEnabled]);

  const decisionHistory = useMemo(
    () => buildDecisionHistory(decisions.filter(decision => decisionStillHasSource(decision, transactions)), today, now.toISOString()),
    [decisions, transactions, today, now],
  );

  const decisionRiskAlerts = useMemo(
    () => buildDecisionRiskAlerts(decisions, baseline, settings.safety_floor, today),
    [decisions, baseline, settings.safety_floor, today],
  );
  const paycheckPlan = useMemo(() => {
    const horizon = Math.max(2, Math.min(settings.forecast_horizon_months, 6));
    const incomeEvents: { id?: string; name: string; amount: number; date: string }[] = [];
    const billEvents: { id?: string; name: string; amount: number; dueDate: string }[] = [];
    const balanceEvents: { date: string; balance: number }[] = [];

    for (let i = 0; i < horizon; i += 1) {
      const absoluteMonth = now.getMonth() + i;
      const month = absoluteMonth % 12;
      const year = now.getFullYear() + Math.floor(absoluteMonth / 12);
      const debtSettlements = getDebtMonthSettlements(month, year);

      getIncomeOccurrencesInMonth(month, year).forEach(({ income, days, effectiveAmount }) => {
        days.forEach(day => incomeEvents.push({
          id: income.id,
          name: income.name,
          amount: effectiveAmount,
          date: makeDateKey(year, month, day),
        }));
      });

      getMonthlyBills(month, year).filter(isBillEligibleForUpcomingPlan).forEach(bill => {
        const occurrences = getBillOccurrencesInMonth(bill, month, year);
        if (!occurrences.length) return;
        const debtSettlement = bill.is_debt ? debtSettlements.get(bill.id) : undefined;
        const monthlyTotal = debtSettlement?.configuredObligation
          ?? getBillMonthlyTotal(bill, month, year);
        const perOccurrence = monthlyTotal / occurrences.length;
        let paidRemaining = debtSettlement?.paidAmount ?? getPaidAmount(bill.id, month, year);
        const exactByDay = new Map(debtSettlement?.occurrences?.map(occurrence => [
          Number(occurrence.occurrenceDate.slice(8, 10)),
          occurrence,
        ]) ?? []);
        occurrences.forEach(day => {
          const exact = exactByDay.get(day);
          const required = exact?.configuredObligation ?? perOccurrence;
          const appliedPaid = exact
            ? Math.min(required, exact.paidAmount)
            : Math.min(required, Math.max(0, paidRemaining));
          if (!exact) paidRemaining = Math.max(0, paidRemaining - required);
          const remaining = Math.max(0, required - appliedPaid);
          if (remaining > 0.005) {
            billEvents.push({
              id: bill.id,
              name: bill.name,
              amount: remaining,
              dueDate: makeDateKey(year, month, day),
            });
          }
        });
      });

      getDailyBalances(month, year).forEach(day => {
        balanceEvents.push({ date: makeDateKey(year, month, day.day), balance: day.balance });
      });
    }

    return buildPaycheckPlan(incomeEvents, billEvents, balanceEvents, settings.safety_floor, today);
  }, [getBillMonthlyTotal, getBillOccurrencesInMonth, getDailyBalances, getDebtMonthSettlements, getIncomeOccurrencesInMonth, getMonthlyBills, getPaidAmount, now, settings.forecast_horizon_months, settings.safety_floor, today]);
  const facts = useMemo<FloFacts>(() => {
    const lowest = baseline.reduce(
      (best, day) => day.balance < best.balance ? day : best,
      baseline[0] ?? { date: today, balance: 0 },
    );
    const cashFlow = getCashFlow(now.getMonth(), now.getFullYear());
    const previousMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const previousCashFlow = getCashFlow(previousMonthDate.getMonth(), previousMonthDate.getFullYear());
    const month = now.getMonth();
    const year = now.getFullYear();
    const debtSettlements = getDebtMonthSettlements(month, year);
    const billSummary = summarizeMonthlyBills(
      getMonthlyBills(month, year).filter(isBillEligibleForUpcomingPlan),
      bill => bill.is_debt
        ? (debtSettlements.get(bill.id)?.configuredObligation
          ?? getBillMonthlyTotal(bill, month, year))
        : getBillMonthlyTotal(bill, month, year),
      bill => bill.is_debt
        ? (debtSettlements.get(bill.id)?.paidAmount
          ?? getPaidAmount(bill.id, month, year))
        : getPaidAmount(bill.id, month, year),
    );
    const currentMonth = today.slice(0, 7);
    const unallocatedExpenses = transactions.filter(transaction =>
      isCashFlowTransaction(transaction) && transaction.date.startsWith(currentMonth) && transaction.amount < 0 && !transaction.linked_bill_id
    );
    const todayForecastDay = getDailyBalances(month, year).find(day => day.day === now.getDate());
    const todayForecastGroups = groupForecastEvents(calendarVisibleForecastEvents(todayForecastDay?.events));
    const algorithmSuite = buildAlgorithmSuite({
      month,
      year,
      todayDay: now.getDate(),
      safetyFloor: settings.safety_floor,
      cashFlow,
      dailyBalances: getDailyBalances(month, year).map(day => ({
        day: day.day,
        income: day.income,
        bills: day.bills,
        expense: day.expense,
        net: day.net,
        balance: day.balance,
      })),
      bills: getMonthlyBills(month, year).map(bill => {
        const debtSettlement = bill.is_debt ? debtSettlements.get(bill.id) : undefined;
        return {
          id: bill.id,
          name: bill.name,
          amount: debtSettlement?.configuredObligation
            ?? getBillMonthlyTotal(bill, month, year),
          paidAmount: debtSettlement?.paidAmount
            ?? getPaidAmount(bill.id, month, year),
          occurrenceDays: getBillOccurrencesInMonth(bill, month, year),
          occurrenceSettlements: debtSettlement?.occurrences?.map(occurrence => ({
            day: Number(occurrence.occurrenceDate.slice(8, 10)),
            requiredAmount: occurrence.configuredObligation,
            paidAmount: occurrence.paidAmount,
          })),
          importance: bill.smart_priority,
          category: bill.category || "Other",
          due_day: bill.due_day,
          is_debt: bill.is_debt,
          is_recurring: bill.is_recurring,
          includeInSnowball: bill.include_in_snowball !== false,
          balance: bill.balance,
          interest_rate: bill.interest_rate,
        };
      }),
      transactions: getTransactionsForMonth(month, year).filter(isCashFlowTransaction).map(transaction => ({
        id: transaction.id,
        date: transaction.date,
        amount: transaction.amount,
        category: transaction.category || "Other",
        note: transaction.note,
      })),
      incomes: incomes.map(income => ({
        id: income.id,
        name: income.name,
        amount: income.amount,
        frequency: income.frequency,
      })),
      goals: goals.map(goal => ({
        id: goal.id,
        name: goal.name,
        target_amount: goal.target_amount,
        current_amount: goal.current_amount,
        target_date: goal.target_date,
        goal_type: goal.goal_type,
      })),
      categoryPlan,
      forecastConfidence,
      settings: decisionHubSettings,
    });
    return {
      balanceToday: baseline[0]?.balance ?? 0,
      lowestBalance: lowest.balance,
      lowestBalanceDate: lowest.date,
      safetyFloor: settings.safety_floor,
      monthlyIncome: cashFlow.monthlyIncome,
      monthlyBills: cashFlow.totalBillsDue,
      monthlyRemaining: cashFlow.remaining,
      billsLeftAmount: billSummary.remaining,
      billsLeftCount: billSummary.unpaidCount,
      billProgressPercent: billSummary.billProgressPercent,
      previousMonthIncome: previousCashFlow.monthlyIncome,
      previousMonthBills: previousCashFlow.totalBillsDue,
      previousMonthRemaining: previousCashFlow.remaining,
      unallocatedSpendingThisMonth: unallocatedExpenses.reduce((sum, transaction) => sum + Math.abs(transaction.amount), 0),
      unallocatedTransactionCount: unallocatedExpenses.length,
      upcoming,
      activePlans: decisions.filter(decision => decision.status === "planned" || decision.status === "calendar").length,
      forecastConfidence: forecastConfidence.level,
      sourceTypes: ["forecast", "bill", "transaction", "account", "debt", "goal", "decision"],
      todayForecast: {
        date: today,
        projectedClose: todayForecastDay?.balance ?? baseline[0]?.balance ?? 0,
        net: todayForecastDay?.net ?? 0,
        sources: todayForecastGroups.flatMap(group => group.events.map(item => ({
          group: group.title,
          label: item.label,
          amount: item.event.amount,
          status: item.statusLabel,
        }))),
      },
      categoryPlan,
      paycheckPlan,
      billDateMoves: billDateMoves.map(move => ({
        id: move.id,
        billId: move.bill_id,
        billName: bills.find(bill => bill.id === move.bill_id)?.name ?? "Bill",
        fromDate: move.from_date,
        toDate: move.to_date,
      })),
      debts: bills
        .filter(bill => bill.is_debt && bill.balance > 0)
        .map(bill => ({
          id: bill.id,
          name: bill.name,
          balance: bill.balance,
          minimumPayment: bill.amount,
          dueDay: bill.due_day,
        })),
      recurringBills: bills
        .filter(bill => bill.is_recurring && !bill.is_debt)
        .map(bill => ({
          id: bill.id,
          name: bill.name,
          amount: bill.amount,
          dueDay: bill.due_day,
          category: bill.category || "Other",
        })),
      stability: {
        stageLabel: algorithmSuite.stability.stageLabel,
        status: algorithmSuite.stability.status,
        protectedAmount: algorithmSuite.stability.protectedAmount,
        reserveTarget: algorithmSuite.stability.reserveTarget,
        reserveProgress: algorithmSuite.stability.reserveProgress,
        backupTarget: algorithmSuite.stability.backupTarget,
        backupProgress: algorithmSuite.stability.backupProgress,
        protectedDays: algorithmSuite.stability.protectedDays,
        safeUntilPayday: algorithmSuite.stability.safeUntilPayday,
        nextPaycheckLabel: algorithmSuite.stability.nextPaycheckLabel,
        headline: algorithmSuite.stability.headline,
        explanation: algorithmSuite.stability.explanation,
        nextAction: algorithmSuite.stability.nextAction,
      },
      flowScore: {
        score: algorithmSuite.flowScore.score,
        label: algorithmSuite.flowScore.label,
        topReason: algorithmSuite.flowScore.topReason,
        topAction: algorithmSuite.flowScore.topAction,
        positiveFactors: algorithmSuite.flowScore.positiveFactors,
        negativeFactors: algorithmSuite.flowScore.negativeFactors,
      },
      safeCushion: {
        amount: algorithmSuite.safeCushion.amount,
        label: algorithmSuite.safeCushion.label,
        status: algorithmSuite.safeCushion.status,
        lowestBalance: algorithmSuite.safeCushion.lowestBalance,
        lowestDay: algorithmSuite.safeCushion.lowestDay,
        safetyFloor: algorithmSuite.safeCushion.safetyFloor,
        reservedAmount: algorithmSuite.safeCushion.reservedAmount,
        topReason: algorithmSuite.safeCushion.topReason,
        topAction: algorithmSuite.safeCushion.topAction,
      },
      purchaseDecision: {
        safeNowLimit: algorithmSuite.purchaseDecision.safeNowLimit,
        action: algorithmSuite.purchaseDecision.action,
        detail: algorithmSuite.purchaseDecision.detail,
        nextMove: algorithmSuite.purchaseDecision.nextMove,
        bestDay: algorithmSuite.purchaseDecision.bestDay,
        confidence: algorithmSuite.purchaseDecision.confidence,
      },
      billPriority: {
        nextBill: algorithmSuite.billPriority.nextBill
          ? {
            name: algorithmSuite.billPriority.nextBill.name,
            amount: algorithmSuite.billPriority.nextBill.amount,
            dueDay: algorithmSuite.billPriority.nextBill.dueDay,
            reason: algorithmSuite.billPriority.nextBill.reason,
            urgency: algorithmSuite.billPriority.nextBill.urgency,
          }
          : null,
        summary: algorithmSuite.billPriority.summary,
        nextMove: algorithmSuite.billPriority.nextMove,
        bills: algorithmSuite.billPriority.bills.map(bill => ({
          name: bill.name,
          amount: bill.amount,
          dueDay: bill.dueDay,
          reason: bill.reason,
          urgency: bill.urgency,
        })),
      },
      paydaySplitAlgo: {
        bills: algorithmSuite.paydaySplit.bills,
        spending: algorithmSuite.paydaySplit.spending,
        savings: algorithmSuite.paydaySplit.savings,
        debt: algorithmSuite.paydaySplit.debt,
        goals: algorithmSuite.paydaySplit.goals,
        dollars: algorithmSuite.paydaySplit.dollars,
        summary: algorithmSuite.paydaySplit.summary,
        nextMove: algorithmSuite.paydaySplit.nextMove,
      },
      cashFlowGap: {
        startDay: algorithmSuite.cashFlowGap.startDay,
        endDay: algorithmSuite.cashFlowGap.endDay,
        lowestBalance: algorithmSuite.cashFlowGap.lowestBalance,
        detail: algorithmSuite.cashFlowGap.detail,
      },
      debtPayoff: settings.debtPayoffEnabled ? {
        nextDebtName: algorithmSuite.debtPayoff.nextDebtName,
        snowballBalance: algorithmSuite.debtPayoff.snowballBalance,
        avalancheName: algorithmSuite.debtPayoff.avalancheName,
        cashFlowReliefName: algorithmSuite.debtPayoff.cashFlowReliefName,
        cashFlowReliefAmount: algorithmSuite.debtPayoff.cashFlowReliefAmount,
        totalMonthlyMinimum: algorithmSuite.debtPayoff.totalMonthlyMinimum,
        currentRolloverExtra: algorithmSuite.debtPayoff.currentRolloverExtra,
        nextMove: algorithmSuite.debtPayoff.nextMove,
        status: algorithmSuite.debtPayoff.status,
        detail: algorithmSuite.debtPayoff.detail,
      } : undefined,
      spendingLimit: {
        daily: algorithmSuite.spendingLimit.daily,
        weekly: algorithmSuite.spendingLimit.weekly,
        status: algorithmSuite.spendingLimit.status,
        paceLabel: algorithmSuite.spendingLimit.paceLabel,
        remainingDays: algorithmSuite.spendingLimit.remainingDays,
        detail: algorithmSuite.spendingLimit.detail,
      },
      extraMoneyRouter: {
        amount: algorithmSuite.extraMoneyRouter.amount,
        recommendation: algorithmSuite.extraMoneyRouter.recommendation,
        targetLabel: algorithmSuite.extraMoneyRouter.targetLabel,
        detail: algorithmSuite.extraMoneyRouter.detail,
        nextMove: algorithmSuite.extraMoneyRouter.nextMove,
      },
      monthlyHealth: {
        score: algorithmSuite.monthlyHealth.score,
        grade: algorithmSuite.monthlyHealth.grade,
        summary: algorithmSuite.monthlyHealth.summary,
      },
      smartReminder: {
        reminders: algorithmSuite.smartReminder.reminders,
      },
      decisionHistory: {
        due: decisionHistory.due,
        upcoming: decisionHistory.upcoming,
        completed: decisionHistory.completed,
        changed: decisionHistory.changed,
        risky: decisionRiskAlerts.map(alert => ({
          name: alert.name,
          date: alert.date,
          plannedAmount: alert.plannedAmount,
          status: "upcoming",
          varianceLabel: `$${alert.shortfall.toFixed(2)} more room to add`,
        })),
      },
    };
  }, [baseline, today, settings.safety_floor, getCashFlow, getDailyBalances, getMonthlyBills, getBillMonthlyTotal, getBillOccurrencesInMonth, getDebtMonthSettlements, getPaidAmount, getTransactionsForMonth, transactions, upcoming, decisions, forecastConfidence, categoryPlan, paycheckPlan, billDateMoves, bills, decisionHistory, decisionRiskAlerts, now, incomes, goals, decisionHubSettings]);

  const setupPersonalization = useMemo(
    () => buildSetupPersonalization(onboardingPreferences),
    [onboardingPreferences],
  );
  const hasSetupAnswers = onboardingPreferences.help.length > 0 || onboardingPreferences.goals.length > 0 || Boolean(onboardingPreferences.savingsGoal);

  const quickPrompts = useMemo(() => {
    if (demoMode) return ["What's safe to spend?", "What bills are next?"];
    const categoryPrompts = buildFloCategoryQuickPrompts(categoryPlan);
    const planningPrompts = ["Which bills are due next?", "What account data can I improve?"];
    return Array.from(new Set([
      ...(hasSetupAnswers ? setupPersonalization.quickPrompts : []),
      ...(decisionHistory.due.length ? ["Which decisions need review?"] : []),
      ...(decisionRiskAlerts.length ? ["Are any planned decisions no longer safe?"] : []),
      ...(decisionHistory.upcoming.length ? ["Which planned decisions are coming up?"] : []),
      ...planningPrompts,
      ...categoryPrompts,
      "Which bills are due next?",
      "Which records did you use?",
    ])).slice(0, 2);
  }, [categoryPlan, decisionHistory, decisionRiskAlerts, demoMode, hasSetupAnswers, setupPersonalization]);

  const startNewConversation = () => {
    requestGenerationRef.current = nextFloRequestGeneration(requestGenerationRef.current);
    streamAbortRef.current?.abort();
    streamAbortRef.current = null;
    setActiveConversationId(null);
    setOlderMessageCursor(null);
    setSourcesByMessageId({});
    setFollowUpsByMessageId({});
    setProposalByMessageId({});
    setGroundingByMessageId({});
    setChatError(null);
    retryRequestRef.current = null;
    dispatch({ type: "hydrate", messages: [] });
  };

  const selectConversation = (conversationId: string) => {
    requestGenerationRef.current = nextFloRequestGeneration(requestGenerationRef.current);
    streamAbortRef.current?.abort();
    streamAbortRef.current = null;
    setChatError(null);
    retryRequestRef.current = null;
    setActiveConversationId(conversationId);
  };

  const renameConversation = async (conversationId: string, title: string) => {
    await renameFloConversation(conversationId, title);
    setConversations(previous => previous.map(conversation => conversation.id === conversationId ? { ...conversation, title: title.trim().slice(0, 80) } : conversation));
  };

  const removeConversation = async (conversationId: string) => {
    if (conversationId === activeConversationId) {
      requestGenerationRef.current = nextFloRequestGeneration(requestGenerationRef.current);
      streamAbortRef.current?.abort();
      streamAbortRef.current = null;
    }
    await deleteFloConversation(conversationId);
    const remaining = conversations.filter(conversation => conversation.id !== conversationId);
    setConversations(remaining);
    setActiveConversationId(remaining[0]?.id ?? null);
    if (!remaining.length) dispatch({ type: "hydrate", messages: [] });
  };

  const removeAllConversations = async () => {
    if (!activeHousehold?.householdId) throw new Error("An active household is required.");
    await deleteAllFloConversations(activeHousehold.householdId);
    requestGenerationRef.current = nextFloRequestGeneration(requestGenerationRef.current);
    streamAbortRef.current?.abort();
    streamAbortRef.current = null;
    setConversations([]);
    setActiveConversationId(null);
    setSourcesByMessageId({});
    setFollowUpsByMessageId({});
    setProposalByMessageId({});
    setGroundingByMessageId({});
    dispatch({ type: "hydrate", messages: demoMode ? storeCaptureChat.messages : [] });
  };

  const exportConversations = async () => {
    const sections: string[] = [];
    for (const conversation of conversations) {
      const messages = await listAllFloMessages(conversation.id);
      sections.push(`${conversation.title}\n${messages.map(message => `${message.role === "flo" ? "Flo" : "You"}: ${message.text}${message.caveat ? `\nCaveat: ${message.caveat}` : ""}`).join("\n\n")}`);
    }
    const content = `${exportFloHistoryText(activeHousehold?.name ?? "Personal household", [])}\n${sections.join("\n\n---\n\n")}`;
    await Share.share({ title: "FlowLedger Flo history", message: content });
  };

  const updatePreferences = (preferences: FloPreferences) => {
    setFloPreferences(preferences);
    if (user?.id && activeHousehold?.householdId) {
      void Promise.all([
        saveFloPreferences(user.id, activeHousehold.householdId, preferences),
        updateFloHouseholdMemory({ householdId: activeHousehold.householdId, userId: user.id, enabled: preferences.rememberPreferences, preferences: { note: preferences.preferenceNote.trim().slice(0, 240) } }),
      ]).catch(() => setChatError("Flo privacy preferences could not be saved."));
    }
  };

  const openProposalReview = (proposal: FloReviewProposal) => {
    if (proposal.kind !== "recurring_bill_change") return;
    setProposalConfirmState("reviewing");
    setProposalConfirmError("");
    setProposalReceipt(null);
    setReviewProposal(null);
    void readAuthoritativeFloProposal(proposal.id).then(authoritative => {
      if (!floProposalMatchesAuthoritative(proposal, authoritative) || authoritative.kind !== "recurring_bill_change") {
        throw new Error("proposal_review_mismatch");
      }
      setReviewProposal(authoritative);
      setProposalConfirmState("idle");
    }).catch(() => {
      setReviewProposal(null);
      setChatError("Flo could not verify this proposed change. Your plan was not changed.");
      setProposalConfirmState("failed");
    });
  };

  const confirmProposal = async () => {
    if (!reviewProposal || reviewProposal.kind !== "recurring_bill_change" || proposalConfirmState === "confirming") return;
    setProposalConfirmState("confirming");
    setProposalConfirmError("");
    try {
      const authoritative = await readAuthoritativeFloProposal(reviewProposal.id);
      if (!floProposalMatchesAuthoritative(reviewProposal, authoritative) || authoritative.status !== "review") throw new Error("proposal_review_mismatch");
      const receipt = await confirmFloRecurringBillProposal(reviewProposal.id);
      setProposalReceipt(receipt);
      setConfirmedProposalIds(previous => new Set(previous).add(reviewProposal.id));
      setProposalConfirmState("idle");
      retryBudgetLoad();
    } catch (error) {
      const code = error instanceof Error ? error.message.toLocaleLowerCase() : "";
      const message = code.includes("proposal_stale")
        ? "This bill changed since Flo prepared the review. Ask Flo to create a fresh change."
        : code.includes("proposal_expired") || code.includes("proposal_not_reviewable")
          ? "This review expired. Ask Flo to prepare it again."
          : code.includes("proposal_role_denied") || code.includes("proposal_access_denied")
            ? "Your household role cannot confirm this change."
            : code.includes("proposal_pro_required")
              ? "Confirming Flo changes is planned for Pro. Your plan was not changed."
              : "This change could not be confirmed. Your plan was not changed.";
      setProposalConfirmError(message);
      setProposalConfirmState("failed");
    }
  };

  const searchHistory = useCallback((query: string) => searchFloConversationContent(conversations.map(item => item.id), query), [conversations]);

  const loadOlderMessages = async () => {
    if (!activeConversationId || !olderMessageCursor) return;
    const requestConversationId = activeConversationId;
    const requestCursor = olderMessageCursor;
    const requestGeneration = requestGenerationRef.current;
    const requestScopeKey = floDataScopeKey;
    const requestIsCurrent = () => (
      requestGeneration === requestGenerationRef.current
      && requestScopeKey === floDataScopeKeyRef.current
      && requestConversationId === activeConversationIdRef.current
    );
    try {
      const page = await listFloMessages(requestConversationId, requestCursor);
      if (!requestIsCurrent()) return;
      dispatch({ type: "prepend", messages: page.messages.map(message => ({ id: message.id, role: message.role, text: message.text })) });
      setSourcesByMessageId(previous => ({ ...previous, ...Object.fromEntries(page.messages.filter(message => message.sources.length).map(message => [message.id, message.sources])) }));
      setFollowUpsByMessageId(previous => ({ ...previous, ...Object.fromEntries(page.messages.filter(message => message.followUps.length).map(message => [message.id, message.followUps])) }));
      setGroundingByMessageId(previous => ({ ...previous, ...Object.fromEntries(page.messages.filter(message => message.dataAsOf || message.partial || message.coverage || message.caveat).map(message => [message.id, { dataAsOf: message.dataAsOf, partial: message.partial, coverage: describeCoverage(message.coverage), caveat: message.caveat }])) }));
      const verifiedProposals = await Promise.all(page.messages.filter(message => message.proposal?.kind === "recurring_bill_change").map(async message => {
        const authoritative = await readAuthoritativeFloProposal(message.proposal!.id);
        return floProposalMatchesAuthoritative(message.proposal!, authoritative) ? [message.id, authoritative] as const : null;
      }));
      if (!requestIsCurrent()) return;
      setProposalByMessageId(previous => ({ ...previous, ...Object.fromEntries(verifiedProposals.filter((row): row is readonly [string, FloReviewProposal] => Boolean(row))) }));
      setOlderMessageCursor(page.nextCursor);
    } catch {
      if (requestIsCurrent()) setChatError("Older messages could not be loaded.");
    }
  };

  const stopStreaming = () => {
    streamAbortRef.current?.abort();
    streamAbortRef.current = null;
    dispatch({ type: "stop" });
    setChatError("Response stopped. You can retry the last question.");
  };

  const send = async (text = input, retry = false, consentOverride = false) => {
    const clean = text.trim();
    if (!clean || chat.sending || floProLocked || !user?.id || !activeHousehold?.householdId) return;
    if (!aiConsentReady) return;
    if (!aiConsentAccepted && !consentOverride) {
      setAiConsentPrompt(clean);
      return;
    }
    const requestGeneration = requestGenerationRef.current;
    const requestUserId = user.id;
    const requestHouseholdId = activeHousehold.householdId;
    const requestIsCurrent = () => isFloRequestGenerationCurrent(requestGeneration, requestGenerationRef.current);
    setInput("");
    setChatError(null);
    setLastPrompt(clean);
    const priorRequest = retry && retryRequestRef.current?.text === clean ? retryRequestRef.current : null;
    const userMessageId = priorRequest?.userMessageId ?? createFloId();
    const assistantMessageId = priorRequest?.assistantMessageId ?? createFloId();
    dispatch({ type: "submit", id: userMessageId, assistantId: assistantMessageId, text: clean });
    let conversationId = priorRequest?.conversationId ?? floConversationForRequest(floPreferences.historyEnabled, activeConversationId);
    retryRequestRef.current = { text: clean, userMessageId, assistantMessageId, conversationId };
    let reply = "";
    const verifiedFallback: { current: FloVerifiedFallback | null } = { current: null };
    const streamFailure: { current: { code: string; message: string } | null } = { current: null };
    try {
      if (!conversationId && floPreferences.historyEnabled) {
        const created = await createFloConversation(requestUserId, requestHouseholdId, clean);
        if (!requestIsCurrent()) return;
        conversationId = created.id;
        skipConversationLoadRef.current = created.id;
        setConversations(previous => [created, ...previous]);
        setActiveConversationId(created.id);
        retryRequestRef.current = { text: clean, userMessageId, assistantMessageId, conversationId: created.id };
      }
      const controller = new AbortController();
      streamAbortRef.current = controller;
      await streamFloChat({
        conversationId: conversationId ?? undefined,
        householdId: requestHouseholdId,
        userMessageId,
        assistantMessageId,
        text: clean,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        previewTier,
        context: {
          route: Array.isArray(params.sourceRoute) ? params.sourceRoute[0] : params.sourceRoute,
          entityType: Array.isArray(params.entityType) ? params.entityType[0] : params.entityType,
          entityId: Array.isArray(params.entityId) ? params.entityId[0] : params.entityId,
          date: Array.isArray(params.date) ? params.date[0] : params.date,
          label: Array.isArray(params.label) ? params.label[0] : params.label,
        },
        historyEnabled: floPreferences.historyEnabled,
        signal: controller.signal,
        onEvent: event => {
          if (!requestIsCurrent()) return;
          if (event.type === "meta") {
            setGroundingByMessageId(previous => ({ ...previous, [assistantMessageId]: { dataAsOf: event.dataAsOf, partial: event.partial, coverage: describeCoverage(event.coverage) } }));
          } else if (event.type === "status") {
            dispatch({ type: "status", id: assistantMessageId, text: event.message });
          } else if (event.type === "verified-fallback") {
            verifiedFallback.current = event.fallback;
          } else if (event.type === "text-delta") {
            reply += event.delta;
            dispatch({ type: "stream-delta", id: assistantMessageId, delta: event.delta });
          } else if (event.type === "sources") {
            setSourcesByMessageId(previous => ({ ...previous, [assistantMessageId]: event.sources }));
          } else if (event.type === "followups") {
            setFollowUpsByMessageId(previous => ({ ...previous, [assistantMessageId]: event.items }));
          } else if (event.type === "proposal" && event.proposal?.kind === "recurring_bill_change") {
            setProposalByMessageId(previous => ({ ...previous, [assistantMessageId]: event.proposal }));
          } else if (event.type === "error") {
            streamFailure.current = { code: event.code, message: event.message };
          } else if (event.type === "done") {
            reply = event.answer?.answer ?? event.text ?? reply;
            dispatch({ type: "replace", id: assistantMessageId, text: reply });
            if (event.answer) setGroundingByMessageId(previous => ({ ...previous, [assistantMessageId]: {
              ...previous[assistantMessageId],
              dataAsOf: event.answer?.dataAsOf ?? previous[assistantMessageId]?.dataAsOf,
              coverage: describeCoverage(event.answer?.coverage) ?? previous[assistantMessageId]?.coverage,
              partial: event.answer?.partial ?? previous[assistantMessageId]?.partial,
              caveat: event.answer?.caveat ?? undefined,
            } }));
          }
        },
      });
      if (!requestIsCurrent()) return;
      streamAbortRef.current = null;
      if (streamFailure.current) throw new Error(streamFailure.current.code);
      dispatch({ type: "stop" });
    } catch (error) {
      if (!requestIsCurrent()) return;
      streamAbortRef.current = null;
      const stopped = error instanceof Error && error.name === "AbortError";
      const cleanupFailed = error instanceof Error && error.message.includes("ephemeral_cleanup_failed");
      const timeout = isFloTimeoutCode(streamFailure.current?.code)
        || isFloTimeoutCode(error instanceof Error ? error.message : null);
      if (cleanupFailed) {
        dispatch({ type: "hydrate", messages: [] });
        setSourcesByMessageId({});
        setFollowUpsByMessageId({});
        setProposalByMessageId({});
    setGroundingByMessageId(demoMode
      ? { "store-capture-answer": { dataAsOf: "2026-08-25T01:30:00-05:00", coverage: "Complete for this question" } }
      : {});
        setChatError("Flo couldn't clear this no-history chat. Local content was cleared; please try again.");
        retryRequestRef.current = { text: clean, userMessageId, assistantMessageId, conversationId: null };
        return;
      }
      const recovery = verifiedFallback.current;
      if (recovery && !stopped) {
        reply = recovery.answer;
        dispatch({ type: "replace", id: assistantMessageId, text: reply });
        setSourcesByMessageId(previous => ({ ...previous, [assistantMessageId]: recovery.sources ?? [] }));
        setFollowUpsByMessageId(previous => ({ ...previous, [assistantMessageId]: recovery.followups ?? [] }));
        setProposalByMessageId(previous => ({ ...previous, [assistantMessageId]: null }));
        setGroundingByMessageId(previous => ({ ...previous, [assistantMessageId]: {
          dataAsOf: recovery.dataAsOf,
          partial: true,
          coverage: describeCoverage(recovery.coverage),
          caveat: recovery.caveat,
        } }));
        setChatError(null);
      } else {
        reply = stopped
          ? "Response stopped before Flo could verify an answer."
          : timeout
            ? "Flo needed more time to verify this answer. Nothing changed in your plan."
            : "I couldn't verify an answer from your account just now.";
        dispatch({ type: "replace", id: assistantMessageId, text: reply });
        setSourcesByMessageId(previous => ({ ...previous, [assistantMessageId]: [] }));
        setFollowUpsByMessageId(previous => ({ ...previous, [assistantMessageId]: [] }));
        setProposalByMessageId(previous => ({ ...previous, [assistantMessageId]: null }));
        setGroundingByMessageId(previous => ({ ...previous, [assistantMessageId]: { partial: true, coverage: "No verified account data" } }));
        setChatError(stopped
          ? "Response stopped. You can retry the last question."
          : timeout
            ? "That check took longer than expected. Tap Retry to ask again."
            : "Flo couldn't verify this answer. Retry to check your account again.");
      }
    }
    if (!requestIsCurrent()) return;
    if (!floPreferences.historyEnabled) retryRequestRef.current = { text: clean, userMessageId, assistantMessageId, conversationId: null };
  };

  const acceptAiConsent = async () => {
    if (!user?.id || !aiConsentPrompt) return;
    const prompt = aiConsentPrompt;
    try {
      await AsyncStorage.setItem(floAiConsentStorageKey(user.id), createFloAiConsent(user.id));
      setAiConsentAccepted(true);
      setAiConsentPrompt(null);
      await send(prompt, false, true);
    } catch {
      setChatError("Flo consent could not be saved. No account information was sent.");
    }
  };

  useEffect(() => {
    const prompt = Array.isArray(params.prompt) ? params.prompt[0] : params.prompt;
    const promptId = Array.isArray(params.promptId) ? params.promptId[0] : params.promptId;
    const cleanPrompt = typeof prompt === "string" ? prompt.trim() : "";
    const promptKey = `${promptId || "manual"}:${cleanPrompt}`;
    if (!aiConsentReady || !cleanPrompt || handledPromptRef.current === promptKey || chat.sending) return;
    handledPromptRef.current = promptKey;
    void send(cleanPrompt);
  }, [aiConsentReady, params.prompt, params.promptId, chat.sending]);

  const composerBottom = Platform.OS === "web" ? 88 : Math.max(insets.bottom, 8) + 54;

  if (floProLocked) {
    return <BasicFlo facts={facts} baseline={baseline} />;
  }

  return (
    <KeyboardAvoidingView
      style={[styles.screen, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <PremiumBackdrop variant="blue" />
      <LinearGradient
        colors={["rgba(37,99,235,0.72)", "rgba(8,51,68,0.78)", "rgba(2,6,23,0.78)"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={[styles.header, { paddingTop: Platform.OS === "web" ? 18 : insets.top + 12, borderColor: colors.border }]}
      >
        <FloLogo size={48} />
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: colors.foreground }]}>Ask Flo</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>{activeHousehold?.name ?? "Personal household"} · {floFreshnessSummary(groundingByMessageId)}</Text>
          <DataFreshnessLabel compact />
        </View>
        <Feather name="message-circle" size={24} color={colors.primaryForeground} />
      </LinearGradient>

      {isDesktop ? <View style={styles.desktopHistoryLayer}><FloConversationBar desktop conversations={conversations} activeId={activeConversationId} disabled={chat.sending} householdName={activeHousehold?.name ?? "Personal household"} preferences={floPreferences} onNew={startNewConversation} onSelect={selectConversation} onRename={renameConversation} onDelete={removeConversation} onDeleteAll={removeAllConversations} onExport={exportConversations} onSearchHistory={searchHistory} onPreferencesChange={updatePreferences} /></View> : <FloConversationBar conversations={conversations} activeId={activeConversationId} disabled={chat.sending} householdName={activeHousehold?.name ?? "Personal household"} preferences={floPreferences} onNew={startNewConversation} onSelect={selectConversation} onRename={renameConversation} onDelete={removeConversation} onDeleteAll={removeAllConversations} onExport={exportConversations} onSearchHistory={searchHistory} onPreferencesChange={updatePreferences} />}

      <ScrollView
        ref={scrollRef}
        style={[styles.conversation, isDesktop && styles.conversationDesktop]}
        contentContainerStyle={[styles.conversationContent, isDesktop && styles.conversationContentDesktop]}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
      >
        {olderMessageCursor ? (
          <Pressable accessibilityRole="button" onPress={() => void loadOlderMessages()} style={[styles.loadOlderButton, { backgroundColor: colors.muted }]}>
            <Text style={[styles.loadOlderText, { color: colors.mutedForeground }]}>Load older messages</Text>
          </Pressable>
        ) : null}
        <View style={[styles.bubble, styles.floBubble, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.bubbleText, { color: colors.foreground }]}>Hi, I&apos;m Flo. What would you like to know?</Text>
          <Text style={[styles.trustLine, { color: colors.mutedForeground }]}>AI explanations use verified records from this household. Flo cannot move money, and important plan changes always require your review and confirmation.</Text>
        </View>

        {chat.messages.map(message => (
          <View
            key={message.id}
            style={[
              styles.bubble,
              message.role === "user" ? styles.userBubble : styles.floBubble,
              message.role === "user"
                ? { backgroundColor: colors.primary }
                : { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View style={message.thinking ? styles.thinkingRow : undefined}>
              {message.thinking ? <ActivityIndicator size="small" color={colors.primary} /> : null}
              {message.role === "flo" && !message.thinking ? <FloGroundedAnswer text={humanizeFloText(message.text)} sources={sourcesByMessageId[message.id] ?? []} dataAsOf={groundingByMessageId[message.id]?.dataAsOf} coverage={groundingByMessageId[message.id]?.coverage} partial={groundingByMessageId[message.id]?.partial} caveat={groundingByMessageId[message.id]?.caveat} followUps={followUpsByMessageId[message.id]} proposal={proposalByMessageId[message.id]} proposalConfirmed={Boolean(proposalByMessageId[message.id]?.status === "confirmed" || (proposalByMessageId[message.id] && confirmedProposalIds.has(proposalByMessageId[message.id]!.id)))} onOpenSource={route => router.push(route as never)} onFollowUp={question => void send(question)} onReviewProposal={openProposalReview} /> : <Text style={[styles.bubbleText, { color: message.role === "user" ? colors.primaryForeground : colors.mutedForeground }]}>{message.text}</Text>}
            </View>
          </View>
        ))}
      </ScrollView>

      <Modal visible={Boolean(reviewProposal)} transparent animationType={isDesktop ? "fade" : "slide"} onRequestClose={() => proposalConfirmState !== "confirming" && setReviewProposal(null)}>
        <Pressable style={[styles.modalOverlay, isDesktop && styles.reviewOverlayDesktop]} onPress={() => proposalConfirmState !== "confirming" && setReviewProposal(null)}>
          <Pressable style={[styles.followSheet, isDesktop && styles.reviewDialogDesktop, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => undefined}>
            <View style={[styles.sheetHandle, { backgroundColor: colors.mutedForeground }]} />
            <View style={[styles.reviewProposalIcon, { backgroundColor: proposalReceipt ? colors.success + "18" : colors.primary + "18" }]}><Feather name={proposalReceipt ? "check" : "shield"} size={20} color={proposalReceipt ? colors.success : colors.primary} /></View>
            <Text style={[styles.followTitle, { color: colors.foreground }]}>{proposalReceipt ? "Change confirmed" : "Review bill change"}</Text>
            <Text style={[styles.followSub, { color: colors.mutedForeground }]}>{proposalReceipt ? "FlowLedger confirmed the database change and refreshed your plan." : reviewProposal?.summary}</Text>
            <View style={[styles.reviewImpact, { backgroundColor: colors.muted, borderColor: colors.border }]}>
              <Text style={[styles.reviewImpactLabel, { color: colors.mutedForeground }]}>PLANNED PAYMENT AMOUNT</Text>
              <Text style={[styles.reviewImpactText, { color: colors.foreground }]}>{moneyValue(proposalReceipt?.previousAmount ?? reviewProposal?.payload?.expectedAmount)} → {moneyValue(proposalReceipt?.newAmount ?? reviewProposal?.payload?.newAmount)}</Text>
            </View>
            {proposalConfirmError ? <Text accessibilityRole="alert" style={[styles.saveDecisionError, { color: colors.destructive }]}>{proposalConfirmError}</Text> : null}
            <Text style={[styles.reviewSafety, { color: colors.mutedForeground }]}>{proposalReceipt ? `Confirmed ${new Date(proposalReceipt.confirmedAt).toLocaleString()}` : "Nothing changes until you press Confirm change."}</Text>
            <View style={styles.followActions}>
              <Pressable accessibilityRole="button" disabled={proposalConfirmState === "confirming"} onPress={() => setReviewProposal(null)} style={[styles.followButton, { backgroundColor: colors.muted, opacity: proposalConfirmState === "confirming" ? 0.5 : 1 }]}><Text style={[styles.followButtonText, { color: colors.foreground }]}>{proposalReceipt ? "Done" : "Cancel"}</Text></Pressable>
              {!proposalReceipt ? <Pressable accessibilityRole="button" disabled={proposalConfirmState === "confirming"} onPress={() => void confirmProposal()} style={[styles.followButton, { backgroundColor: colors.primary, opacity: proposalConfirmState === "confirming" ? 0.6 : 1 }]}><Text style={styles.followPrimaryText}>{proposalConfirmState === "confirming" ? "Confirming..." : "Confirm change"}</Text></Pressable> : null}
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={Boolean(aiConsentPrompt)} transparent animationType="fade" onRequestClose={() => setAiConsentPrompt(null)}>
        <Pressable
          style={[
            styles.modalOverlay,
            {
              paddingTop: Math.max(insets.top, 16),
              paddingBottom: Math.max(insets.bottom, 16),
            },
          ]}
          onPress={() => setAiConsentPrompt(null)}
        >
          <Pressable accessibilityViewIsModal style={[styles.aiConsentCard, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => undefined}>
            <ScrollView
              bounces={false}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.aiConsentContent}
            >
              <View style={[styles.reviewProposalIcon, { backgroundColor: colors.primary + "18" }]}><Feather name="shield" size={21} color={colors.primary} /></View>
              <Text style={[styles.followTitle, { color: colors.foreground }]}>Use Flo with your account data?</Text>
              <Text style={[styles.aiConsentBody, { color: colors.mutedForeground }]}>Flo sends your question and only the relevant household records needed to answer it to OpenAI. FlowLedger does not send bank passwords or full account numbers. Chats are saved only when history is on.</Text>
              <Text style={[styles.reviewSafety, { color: colors.mutedForeground }]}>You can cancel and keep using FlowLedger without Flo.</Text>
              <View style={[styles.followActions, styles.aiConsentActions]}>
                <Pressable accessibilityRole="button" onPress={() => setAiConsentPrompt(null)} style={[styles.followButton, styles.aiConsentButton, { backgroundColor: colors.muted }]}><Text style={[styles.followButtonText, { color: colors.foreground }]}>Not now</Text></Pressable>
                <Pressable accessibilityRole="button" onPress={() => void acceptAiConsent()} style={[styles.followButton, styles.aiConsentButton, { backgroundColor: colors.primary }]}><Text style={styles.followPrimaryText}>Agree & ask Flo</Text></Pressable>
              </View>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      <View style={[styles.composerArea, isDesktop && styles.composerAreaDesktop, { backgroundColor: colors.background, borderColor: colors.border, paddingBottom: isDesktop ? 16 : composerBottom }]}>
        {chatError ? (
          <View style={styles.errorRow}>
            <Text style={[styles.chatError, { color: colors.mutedForeground }]}>{chatError}</Text>
            {lastPrompt && !chat.sending ? (
              <Pressable accessibilityRole="button" onPress={() => void send(lastPrompt, true)} style={[styles.retryButton, { backgroundColor: colors.primary + "18" }]}>
                <Feather name="rotate-ccw" size={13} color={colors.primary} />
                <Text style={[styles.retryText, { color: colors.primary }]}>Retry</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.quickPromptScroller}
          contentContainerStyle={styles.quickPromptContent}
          keyboardShouldPersistTaps="handled"
        >
          {quickPrompts.map(prompt => (
            <Pressable
              key={prompt}
              accessibilityRole="button"
              accessibilityLabel={`Ask Flo: ${prompt}`}
              disabled={chat.sending}
              onPress={() => void send(prompt)}
              style={({ pressed }) => [
                styles.quickPromptChip,
                {
                  backgroundColor: colors.primary + "14",
                  borderColor: colors.primary + "40",
                  opacity: pressed || chat.sending ? 0.65 : 1,
                },
              ]}
            >
              <Text style={[styles.quickPromptText, { color: colors.primary }]}>{prompt}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <View style={[styles.composer, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <TextInput
            nativeID="guided-tour-flo"
            accessibilityLabel="Ask Flo anything"
            value={input}
            onChangeText={setInput}
            onSubmitEditing={() => void send()}
            placeholder={sampleQuestions[sampleIndex]}
            placeholderTextColor={colors.mutedForeground}
            style={[styles.input, { color: colors.foreground }]}
            returnKeyType="send"
            multiline
            blurOnSubmit
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={chat.sending ? "Stop response" : "Send message"}
            onPress={chat.sending ? stopStreaming : () => void send()}
            disabled={!chat.sending && !input.trim()}
            style={[
              styles.send,
              { backgroundColor: chat.sending ? colors.destructive : colors.primary, opacity: !chat.sending && !input.trim() ? 0.45 : 1 },
            ]}
          >
            <Text style={styles.sendText}>{chat.sending ? "Stop" : "Send"}</Text>
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function describeCoverage(coverage?: Record<string, unknown>): string | undefined {
  if (!coverage) return undefined;
  if (coverage.complete === false) return "Partial account coverage";
  const tools = Number(coverage.tools);
  if (Number.isFinite(tools) && tools > 0) return `${tools} account source${tools === 1 ? "" : "s"} checked`;
  return coverage.complete === true ? "Complete for this question" : undefined;
}

function floFreshnessSummary(rows: Record<string, { dataAsOf?: string | null }>): string {
  const latest = Object.values(rows).map(row => row.dataAsOf).filter((value): value is string => Boolean(value)).sort().at(-1);
  if (!latest) return "account-aware answers";
  const date = new Date(latest);
  if (!Number.isFinite(date.getTime())) return "account-aware answers";
  return `data checked ${date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

function decisionStillHasSource(decision: { status: string; scenario: { type?: string }; applied_change?: Record<string, unknown> | null; actual_amount?: number | null }, transactions: { id: string }[]) {
  if (decision.status !== "completed" && decision.status !== "applied") return true;
  const applied = decision.applied_change ?? {};
  const hasActualAmount = decision.actual_amount !== undefined && decision.actual_amount !== null;
  const linkedTransactionId = typeof applied.id === "string"
    ? applied.id
    : typeof applied.transactionId === "string"
      ? applied.transactionId
      : null;
  const expectsTransaction = decision.scenario.type === "one_time_purchase"
    || decision.scenario.type === "savings_contribution"
    || decision.scenario.type === "recurring_bill"
    || applied.kind === "transaction"
    || applied.kind === "recurring";
  if (!expectsTransaction) return hasActualAmount || Object.keys(applied).length > 0;
  return !!linkedTransactionId && transactions.some(transaction => transaction.id === linkedTransactionId);
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    minHeight: 96,
    paddingHorizontal: 18,
    paddingBottom: 14,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
    gap: 12,
  },
  headerText: { flex: 1 },
  title: { fontSize: 27, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.5 },
  subtitle: { fontSize: 13, lineHeight: 18, marginTop: 3 },
  conversation: { flex: 1 },
  conversationContent: { paddingHorizontal: 18, paddingTop: 20, paddingBottom: 30, gap: 16 },
  desktopHistoryLayer: { position: "absolute", left: 0, top: 92, bottom: 0, width: 292, zIndex: 4 },
  conversationDesktop: { marginLeft: 292 },
  conversationContentDesktop: { width: "100%", maxWidth: 820, alignSelf: "center", paddingHorizontal: 28, paddingTop: 24 },
  loadOlderButton: { alignSelf: "center", minHeight: 36, borderRadius: 999, justifyContent: "center", paddingHorizontal: 14 },
  loadOlderText: { fontSize: 11, fontFamily: "Inter_700Bold" },
  modalOverlay: { flex: 1, backgroundColor: "rgba(2,6,23,0.68)", justifyContent: "flex-end" },
  aiConsentCard: { width: "100%", maxHeight: "100%", borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, overflow: "hidden" },
  aiConsentContent: { padding: 20, gap: 12 },
  aiConsentBody: { fontSize: 13, lineHeight: 20, fontFamily: "Inter_400Regular", textAlign: "center" },
  followSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, padding: 18, gap: 12 },
  sheetHandle: { alignSelf: "center", width: 48, height: 4, borderRadius: 999, opacity: 0.5, marginBottom: 4 },
  followTitle: { fontSize: 20, fontFamily: "Inter_700Bold", textAlign: "center" },
  followSub: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_400Regular", textAlign: "center" },
  actualInputWrap: { height: 52, borderRadius: 14, borderWidth: 1, flexDirection: "row", alignItems: "center", paddingHorizontal: 14 },
  actualPrefix: { fontSize: 17, fontFamily: "Inter_700Bold", marginRight: 8 },
  actualInput: { flex: 1, fontSize: 18, fontFamily: "Inter_700Bold" },
  followActions: { flexDirection: "row", gap: 10, marginTop: 4 },
  aiConsentActions: { flexWrap: "wrap" },
  aiConsentButton: { minWidth: 140 },
  followButton: { flex: 1, minHeight: 46, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  followButtonText: { fontSize: 14, fontFamily: "Inter_700Bold" },
  followPrimaryText: { color: "#fff", fontSize: 14, fontFamily: "Inter_700Bold" },
  bubble: { maxWidth: "90%", paddingHorizontal: 17, paddingVertical: 16, borderRadius: 20 },
  floBubble: { alignSelf: "flex-start", borderWidth: 1, borderTopLeftRadius: 6 },
  userBubble: { alignSelf: "flex-end", borderTopRightRadius: 6 },
  thinkingRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  bubbleText: { fontSize: 15, lineHeight: 23, fontFamily: "Inter_400Regular" },
  trustLine: { marginTop: 8, fontSize: 10, lineHeight: 15, fontFamily: "Inter_500Medium" },
  cardGrid: { marginTop: 10, gap: 8 },
  insightCard: { borderWidth: 1, borderRadius: 15, padding: 12 },
  insightTitle: { fontSize: 10, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.5 },
  insightValue: { fontSize: 18, fontFamily: "Inter_700Bold", marginTop: 3 },
  insightDetail: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2, lineHeight: 15 },
  sourceRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 9 },
  sourceChip: { minHeight: 28, maxWidth: 240, borderWidth: 1, borderRadius: 999, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 9 },
  sourceText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  decisionActions: { gap: 6, marginTop: 2 },
  saveDecisionButton: { minHeight: 42, borderRadius: 14, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8, paddingHorizontal: 12 },
  saveDecisionText: { color: "#fff", fontSize: 13, fontFamily: "Inter_700Bold" },
  saveDecisionHint: { fontSize: 11, lineHeight: 15, textAlign: "center" },
  saveDecisionError: { fontSize: 11, fontFamily: "Inter_600SemiBold", textAlign: "center" },
  reductionTargetCard: { borderWidth: 1, borderRadius: 12, padding: 10, gap: 2 },
  reductionTargetLabel: { fontSize: 10, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5 },
  reductionTargetName: { fontSize: 13, fontFamily: "Inter_800ExtraBold" },
  reductionTargetMeta: { fontSize: 11, fontFamily: "Inter_400Regular" },
  reductionActions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  reductionButton: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 8 },
  reductionButtonText: { fontSize: 11, fontFamily: "Inter_800ExtraBold" },
  composerArea: { borderTopWidth: 1, paddingHorizontal: 14, paddingTop: 12 },
  composerAreaDesktop: { marginLeft: 292, paddingHorizontal: 28, alignItems: "center" },
  errorRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  chatError: { flex: 1, fontSize: 11, lineHeight: 15, fontFamily: "Inter_500Medium" },
  retryButton: { minHeight: 34, borderRadius: 999, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 11 },
  retryText: { fontSize: 11, fontFamily: "Inter_800ExtraBold" },
  quickPromptScroller: { marginBottom: 10, maxHeight: 42 },
  quickPromptContent: { gap: 8, paddingRight: 12 },
  quickPromptChip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 9 },
  quickPromptText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  composer: {
    width: "100%",
    maxWidth: 820,
    minHeight: 62,
    maxHeight: 112,
    borderRadius: 22,
    borderWidth: 1,
    paddingLeft: 15,
    paddingRight: 7,
    paddingVertical: 6,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
  },
  input: { flex: 1, minHeight: 44, maxHeight: 96, paddingTop: 11, paddingBottom: 10, fontSize: 15 },
  send: { minWidth: 70, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", paddingHorizontal: 15 },
  sendText: { color: "#fff", fontSize: 15, fontFamily: "Inter_700Bold" },
  reviewOverlayDesktop: { justifyContent: "center", alignItems: "center", padding: 24 },
  reviewDialogDesktop: { width: "100%", maxWidth: 520, borderRadius: 24 },
  reviewProposalIcon: { alignSelf: "center", width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  reviewImpact: { borderWidth: 1, borderRadius: 13, padding: 11 },
  reviewImpactLabel: { fontSize: 9, letterSpacing: 0.8, fontFamily: "Inter_800ExtraBold" },
  reviewImpactText: { fontSize: 11, lineHeight: 16, marginTop: 4, fontFamily: "Inter_600SemiBold" },
  reviewSafety: { fontSize: 10, lineHeight: 15, textAlign: "center", fontFamily: "Inter_500Medium" },
});
