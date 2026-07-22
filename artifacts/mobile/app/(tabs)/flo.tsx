import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { useMembership } from "@/context/MembershipContext";
import { useBudget, type DecisionRecord } from "@/context/BudgetContext";
import { BasicFlo } from "@/components/BasicFlo";
import { DatePickerField } from "@/components/DatePickerField";
import { FloConversationBar } from "@/components/FloConversationBar";
import { FloLogo } from "@/components/FloLogo";
import { FloSafetyStopModal } from "@/components/FloSafetyStopModal";
import { PremiumBackdrop } from "@/components/PremiumBackdrop";
import { useBackDismiss } from "@/hooks/useBackDismiss";
import { useColors } from "@/hooks/useColors";
import { isCashFlowTransaction } from "@/lib/billMatching";
import { loadFloMemory, updateFloMemory, type FloFacts } from "@/lib/flo";
import { humanizeFloText } from "@/lib/floLanguage";
import {
  createFloConversation,
  createFloId,
  deleteFloConversation,
  listFloConversations,
  listFloMessages,
  persistFloFallback,
  renameFloConversation,
  streamFloChat,
  type FloConversation,
  type FloSource,
} from "@/lib/floChat";
import {
  FLO_CONNECTION_ERROR_MESSAGE,
  buildDebtPaymentScenario,
  buildFloCategoryQuickPrompts,
  buildFloDecisionScenario,
  evaluateFloBillDateMove,
  evaluateFloBillMoveUndo,
  evaluateFloDebtPayment,
  evaluateFloRecurringBillChange,
  evaluateFloCategoryMove,
  floResponseCards,
  isFloPlanCreateCommand,
  localFloAnswer,
  reduceFloChat,
  sanitizeFloSummary,
  type FloCategoryMoveResult,
  type FloBillDateMoveResult,
  type FloBillMoveFact,
  type FloDebtPaymentResult,
  type FloRecurringBillChangeResult,
  type FloResponseCard,
  type FloChatState,
} from "@/lib/floPolicy";
import { summarizeMonthlyBills } from "@/lib/monthlySummary";
import { evaluateDecision, type DecisionResult, type DecisionScenario } from "@/lib/decisions";
import { buildDecisionHistory, type DecisionHistoryItem } from "@/lib/decisionHistory";
import { buildDecisionRiskAlerts } from "@/lib/decisionRisk";
import { applyCategoryBudgetMove, buildCategoryPlan } from "@/lib/categoryPlanning";
import { categoryBudgetStorageKey, loadCategoryBudgets, readCategoryBudgetCache, saveCategoryBudgets, subscribeCategoryBudgets } from "@/lib/categoryBudgetStore";
import { DEFAULT_DECISION_HUB_SETTINGS } from "@/lib/decisionHubSettings";
import { dateOnlyToLocalDate, localDateString } from "@/lib/dateLabels";
import { buildPaycheckPlan, makeDateKey } from "@/lib/paycheckPlanning";
import { buildAlgorithmSuite } from "@/lib/algorithmSuite";
import { groupForecastEvents } from "@/lib/forecastDisplay";
import { loadOnboardingPreferences, readOnboardingPreferences } from "@/lib/onboardingPreferences";
import { buildSetupPersonalization } from "@/lib/onboardingPersonalization";
import type { SafetyStopWarning } from "@/lib/safetyStop";

const sampleQuestions = [
  "Ask Flo anything…",
  "Can I afford $500?",
  "Which bills are due next?",
  "Why is my balance getting low?",
  "How do I add income?",
];

const initialChat: FloChatState = { messages: [], sending: false };

export default function FloScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ prompt?: string; promptId?: string }>();
  const { user } = useAuth();
  const { isFeatureLocked, previewTier } = useMembership();
  const { activeHousehold, bills, billDateMoves, transactions, decisions, settings, forecastConfidence, getDailyBalances, getMonthlyIncome, getCashFlow, getMonthlyBills, getBillMonthlyTotal, getBillOccurrencesInMonth, getIncomeOccurrencesInMonth, getPaidAmount, moveBillOccurrence, removeBillOccurrenceMove, saveDecision, updateDecision, updateBill, setCustomAmount, saveExtraPayment, getTransactionsForMonth, categories, incomes, goals } = useBudget();
  const categoryBudgetScope = useMemo(() => ({
    userId: user?.id,
    householdId: activeHousehold?.householdId,
    budgetId: activeHousehold?.budgetId,
  }), [activeHousehold?.budgetId, activeHousehold?.householdId, user?.id]);
  const floProLocked = isFeatureLocked("flo_account_chat");
  const [chat, dispatch] = useReducer(reduceFloChat, initialChat);
  const [cardsByMessageId, setCardsByMessageId] = useState<Record<string, FloResponseCard[]>>({});
  const [decisionByMessageId, setDecisionByMessageId] = useState<Record<string, { scenario: DecisionScenario; result: DecisionResult }>>({});
  const [decisionSaveState, setDecisionSaveState] = useState<Record<string, "idle" | "saving" | "saved" | "failed">>({});
  const [categoryMoveByMessageId, setCategoryMoveByMessageId] = useState<Record<string, FloCategoryMoveResult>>({});
  const [categoryMoveState, setCategoryMoveState] = useState<Record<string, "idle" | "saving" | "saved" | "failed">>({});
  const [billDateMoveByMessageId, setBillDateMoveByMessageId] = useState<Record<string, FloBillDateMoveResult>>({});
  const [billDateMoveState, setBillDateMoveState] = useState<Record<string, "idle" | "saving" | "saved" | "failed">>({});
  const [billMoveUndoByMessageId, setBillMoveUndoByMessageId] = useState<Record<string, FloBillMoveFact>>({});
  const [billMoveUndoState, setBillMoveUndoState] = useState<Record<string, "idle" | "saving" | "saved" | "failed">>({});
  const [debtPaymentByMessageId, setDebtPaymentByMessageId] = useState<Record<string, FloDebtPaymentResult>>({});
  const [debtPaymentState, setDebtPaymentState] = useState<Record<string, "idle" | "saving" | "saved" | "failed">>({});
  const [billChangeByMessageId, setBillChangeByMessageId] = useState<Record<string, FloRecurringBillChangeResult>>({});
  const [billChangeState, setBillChangeState] = useState<Record<string, "idle" | "saving" | "saved" | "failed">>({});
  const [categoryBudgets, setCategoryBudgets] = useState<Record<string, number>>({});
  const decisionHubSettings = DEFAULT_DECISION_HUB_SETTINGS;
  const [onboardingPreferences, setOnboardingPreferences] = useState(() => readOnboardingPreferences());
  const [input, setInput] = useState("");
  const [summary, setSummary] = useState("");
  const [conversations, setConversations] = useState<FloConversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [olderMessageCursor, setOlderMessageCursor] = useState<string | null>(null);
  const [sourcesByMessageId, setSourcesByMessageId] = useState<Record<string, FloSource[]>>({});
  const [chatError, setChatError] = useState<string | null>(null);
  const [lastPrompt, setLastPrompt] = useState("");
  const [sampleIndex, setSampleIndex] = useState(0);
  const [completePlan, setCompletePlan] = useState<DecisionRecord | null>(null);
  const [completeActual, setCompleteActual] = useState("");
  const [postponePlan, setPostponePlan] = useState<DecisionRecord | null>(null);
  const [postponeDate, setPostponeDate] = useState("");
  const [lowerPlan, setLowerPlan] = useState<DecisionRecord | null>(null);
  const [lowerAmount, setLowerAmount] = useState("");
  const [historyActionState, setHistoryActionState] = useState<Record<string, "saving" | "failed">>({});
  const [reducePlanByMessageId, setReducePlanByMessageId] = useState<Record<string, DecisionHistoryItem>>({});
  const [decisionSafetyStop, setDecisionSafetyStop] = useState<SafetyStopWarning | null>(null);
  const [pendingUnsafeDecisionMessageId, setPendingUnsafeDecisionMessageId] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const handledPromptRef = useRef<string | null>(null);
  const streamAbortRef = useRef<AbortController | null>(null);
  const skipConversationLoadRef = useRef<string | null>(null);
  const retryRequestRef = useRef<{ text: string; userMessageId: string; assistantMessageId: string; conversationId: string | null } | null>(null);
  const now = useMemo(() => new Date(), []);
  const today = localDateString(now);

  useBackDismiss(Boolean(completePlan), () => setCompletePlan(null));
  useBackDismiss(Boolean(postponePlan), () => setPostponePlan(null));
  useBackDismiss(Boolean(lowerPlan), () => setLowerPlan(null));

  useEffect(() => {
    if (user && !floProLocked) void loadFloMemory(user.id).then(setSummary);
  }, [floProLocked, user]);

  useEffect(() => {
    let cancelled = false;
    streamAbortRef.current?.abort();
    streamAbortRef.current = null;
    dispatch({ type: "hydrate", messages: [] });
    setSourcesByMessageId({});
    setOlderMessageCursor(null);
    setChatError(null);
    if (!user?.id || !activeHousehold?.householdId || floProLocked) {
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
  }, [activeHousehold?.householdId, floProLocked, user?.id]);

  useEffect(() => {
    let cancelled = false;
    if (!activeConversationId || floProLocked) return () => { cancelled = true; };
    if (skipConversationLoadRef.current === activeConversationId) {
      skipConversationLoadRef.current = null;
      return () => { cancelled = true; };
    }
    void listFloMessages(activeConversationId).then(page => {
      if (cancelled) return;
      dispatch({ type: "hydrate", messages: page.messages.map(message => ({ id: message.id, role: message.role, text: message.text })) });
      setSourcesByMessageId(Object.fromEntries(page.messages.filter(message => message.sources.length).map(message => [message.id, message.sources])));
      setOlderMessageCursor(page.nextCursor);
    }).catch(() => {
      if (!cancelled) setChatError("This private chat could not be loaded.");
    });
    return () => { cancelled = true; };
  }, [activeConversationId, floProLocked]);

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

  const readCategoryBudgetsFromStorage = (month = now.getMonth(), year = now.getFullYear()) =>
    readCategoryBudgetCache(month, year, categoryBudgetScope);

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

  const writeCategoryBudgets = (budgets: Record<string, number>) => {
    setCategoryBudgets(budgets);
    void saveCategoryBudgets(categoryBudgetScope, now.getMonth(), now.getFullYear(), budgets).catch(() => undefined);
  };

  const categoryPlan = useMemo(() => {
    if (!settings.zeroBasedBudgetEnabled) return [];
    const month = now.getMonth();
    const year = now.getFullYear();
    const monthBills = getMonthlyBills(month, year)
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

      getIncomeOccurrencesInMonth(month, year).forEach(({ income, days, effectiveAmount }) => {
        days.forEach(day => incomeEvents.push({
          id: income.id,
          name: income.name,
          amount: effectiveAmount,
          date: makeDateKey(year, month, day),
        }));
      });

      getMonthlyBills(month, year).forEach(bill => {
        const occurrences = getBillOccurrencesInMonth(bill, month, year);
        if (!occurrences.length) return;
        const monthlyTotal = getBillMonthlyTotal(bill, month, year);
        const perOccurrence = monthlyTotal / occurrences.length;
        let paidRemaining = getPaidAmount(bill.id, month, year);
        occurrences.forEach(day => {
          const appliedPaid = Math.min(perOccurrence, Math.max(0, paidRemaining));
          paidRemaining = Math.max(0, paidRemaining - perOccurrence);
          const remaining = Math.max(0, perOccurrence - appliedPaid);
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
  }, [getBillMonthlyTotal, getBillOccurrencesInMonth, getDailyBalances, getIncomeOccurrencesInMonth, getMonthlyBills, getPaidAmount, now, settings.forecast_horizon_months, settings.safety_floor, today]);
  const riskyDecisionItems = useMemo<DecisionHistoryItem[]>(() => decisionRiskAlerts.map(alert => ({
    id: alert.id,
    name: alert.name,
    date: alert.date,
    status: "upcoming",
    plannedAmount: alert.plannedAmount,
    amountLabel: `Planned $${alert.plannedAmount.toFixed(2)}`,
    varianceLabel: `$${alert.shortfall.toFixed(2)} below floor`,
  })), [decisionRiskAlerts]);

  const facts = useMemo<FloFacts>(() => {
    const lowest = baseline.reduce(
      (best, day) => day.balance < best.balance ? day : best,
      baseline[0] ?? { date: today, balance: 0 },
    );
    const cashFlow = getCashFlow(now.getMonth(), now.getFullYear());
    const previousMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const previousCashFlow = getCashFlow(previousMonthDate.getMonth(), previousMonthDate.getFullYear());
    const billSummary = summarizeMonthlyBills(
      getMonthlyBills(now.getMonth(), now.getFullYear()),
      bill => getBillMonthlyTotal(bill, now.getMonth(), now.getFullYear()),
      bill => getPaidAmount(bill.id, now.getMonth(), now.getFullYear()),
    );
    const currentMonth = today.slice(0, 7);
    const unallocatedExpenses = transactions.filter(transaction =>
      isCashFlowTransaction(transaction) && transaction.date.startsWith(currentMonth) && transaction.amount < 0 && !transaction.linked_bill_id
    );
    const month = now.getMonth();
    const year = now.getFullYear();
    const todayForecastDay = getDailyBalances(month, year).find(day => day.day === now.getDate());
    const todayForecastGroups = groupForecastEvents(todayForecastDay?.events ?? []);
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
      bills: getMonthlyBills(month, year).map(bill => ({
        id: bill.id,
        name: bill.name,
        amount: getBillMonthlyTotal(bill, month, year),
        paidAmount: getPaidAmount(bill.id, month, year),
        occurrenceDays: getBillOccurrencesInMonth(bill, month, year),
        importance: bill.smart_priority,
        category: bill.category || "Other",
        due_day: bill.due_day,
        is_debt: bill.is_debt,
        is_recurring: bill.is_recurring,
        includeInSnowball: bill.include_in_snowball !== false,
        balance: bill.balance,
        interest_rate: bill.interest_rate,
      })),
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
      monthlyIncome: getMonthlyIncome(),
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
          varianceLabel: `$${alert.shortfall.toFixed(2)} below floor`,
        })),
      },
    };
  }, [baseline, today, settings.safety_floor, getMonthlyIncome, getCashFlow, getDailyBalances, getMonthlyBills, getBillMonthlyTotal, getBillOccurrencesInMonth, getPaidAmount, getTransactionsForMonth, transactions, upcoming, decisions, forecastConfidence, categoryPlan, paycheckPlan, billDateMoves, bills, decisionHistory, decisionRiskAlerts, now, incomes, goals, decisionHubSettings]);

  const setupPersonalization = useMemo(
    () => buildSetupPersonalization(onboardingPreferences),
    [onboardingPreferences],
  );
  const hasSetupAnswers = onboardingPreferences.help.length > 0 || onboardingPreferences.goals.length > 0 || Boolean(onboardingPreferences.savingsGoal);

  const quickPrompts = useMemo(() => {
    const categoryPrompts = buildFloCategoryQuickPrompts(categoryPlan);
    const paycheckPrompts = ["What can I spend until payday?", "Which bill should I move?"];
    const gapPrompts = ["When is my lowest-balance stretch?"];
    return Array.from(new Set([
      ...(hasSetupAnswers ? setupPersonalization.quickPrompts : []),
      ...(decisionHistory.due.length ? ["Which decisions need review?"] : []),
      ...(decisionRiskAlerts.length ? ["Are any planned decisions no longer safe?"] : []),
      ...(decisionHistory.upcoming.length ? ["Which planned decisions are coming up?"] : []),
      ...paycheckPrompts,
      ...gapPrompts,
      ...categoryPrompts,
      "Can I afford $500?",
      "Which bills are due next?",
      "Why is my balance getting low?",
    ])).slice(0, 2);
  }, [categoryPlan, decisionHistory, decisionRiskAlerts, hasSetupAnswers, setupPersonalization]);

  const buildCalendarDayReply = (prompt: string) => {
    const date = prompt.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1];
    if (!date || !/\b(calendar|day|date|know|balance)\b/i.test(prompt)) return null;
    const [year, monthNumber, day] = date.split("-").map(Number);
    if (!year || !monthNumber || !day) return null;
    const month = monthNumber - 1;
    const dayBalance = getDailyBalances(month, year).find(item => item.day === day)?.balance ?? null;
    const incomesDue = getIncomeOccurrencesInMonth(month, year)
      .filter(({ days }) => days.includes(day))
      .map(({ income, effectiveAmount }) => `${income.name} +${formatMoney(effectiveAmount)}`);
    const billsDue: string[] = [];
    getMonthlyBills(month, year).forEach(bill => {
      const occurrences = getBillOccurrencesInMonth(bill, month, year);
      if (!occurrences.includes(day)) return;
      const monthlyTotal = getBillMonthlyTotal(bill, month, year);
      const perOccurrence = occurrences.length ? monthlyTotal / occurrences.length : monthlyTotal;
      let paidRemaining = getPaidAmount(bill.id, month, year);
      occurrences.forEach(occurrenceDay => {
        const appliedPaid = Math.min(perOccurrence, Math.max(0, paidRemaining));
        paidRemaining = Math.max(0, paidRemaining - perOccurrence);
        if (occurrenceDay === day) {
          const left = Math.max(0, perOccurrence - appliedPaid);
          billsDue.push(`${bill.name} ${left > 0.005 ? `${formatMoney(left)} left` : "paid"}`);
        }
      });
    });
    const dayTransactions = transactions
      .filter(transaction => transaction.date === date)
      .map(transaction => `${transaction.note?.trim() || transaction.category || "Transaction"} ${formatSignedMoney(transaction.amount)}`);
    const dayPlans = decisions
      .filter(decision => (decision.status === "planned" || decision.status === "calendar") && (decision.calendar_date || decision.scenario.date) === date)
      .map(decision => `${decision.name} ${formatMoney(decision.scenario.amount)}`);
    const parts = [
      `For ${formatDisplayDate(date)}, your projected close is ${dayBalance === null ? "not available yet" : formatMoney(dayBalance)}.`,
    ];
    if (incomesDue.length) parts.push(`Income: ${incomesDue.join(", ")}.`);
    if (billsDue.length) parts.push(`Bills due: ${billsDue.join(", ")}.`);
    if (dayTransactions.length) parts.push(`Transactions: ${dayTransactions.join(", ")}.`);
    if (dayPlans.length) parts.push(`Planned decisions: ${dayPlans.join(", ")}.`);
    if (!incomesDue.length && !billsDue.length && !dayTransactions.length && !dayPlans.length) {
      parts.push("I don't see any dated items on that day yet.");
    }
    if (dayBalance !== null) {
      const cushion = dayBalance - settings.safety_floor;
      parts.push(cushion >= 0
        ? `That leaves ${formatMoney(cushion)} above your safety floor.`
        : `That is ${formatMoney(Math.abs(cushion))} below your safety floor, so this day needs attention.`);
    }
    return parts.join(" ");
  };

  const startNewConversation = () => {
    streamAbortRef.current?.abort();
    streamAbortRef.current = null;
    setActiveConversationId(null);
    setOlderMessageCursor(null);
    setSourcesByMessageId({});
    setChatError(null);
    retryRequestRef.current = null;
    dispatch({ type: "hydrate", messages: [] });
  };

  const selectConversation = (conversationId: string) => {
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
    await deleteFloConversation(conversationId);
    const remaining = conversations.filter(conversation => conversation.id !== conversationId);
    setConversations(remaining);
    setActiveConversationId(remaining[0]?.id ?? null);
    if (!remaining.length) dispatch({ type: "hydrate", messages: [] });
  };

  const loadOlderMessages = async () => {
    if (!activeConversationId || !olderMessageCursor) return;
    const page = await listFloMessages(activeConversationId, olderMessageCursor);
    dispatch({ type: "prepend", messages: page.messages.map(message => ({ id: message.id, role: message.role, text: message.text })) });
    setSourcesByMessageId(previous => ({ ...previous, ...Object.fromEntries(page.messages.filter(message => message.sources.length).map(message => [message.id, message.sources])) }));
    setOlderMessageCursor(page.nextCursor);
  };

  const stopStreaming = () => {
    streamAbortRef.current?.abort();
    streamAbortRef.current = null;
    dispatch({ type: "stop" });
    setChatError("Response stopped. You can retry the last question.");
  };

  const send = async (text = input, retry = false) => {
    const clean = text.trim();
    if (!clean || chat.sending || floProLocked || !user?.id || !activeHousehold?.householdId) return;
    setInput("");
    setChatError(null);
    setLastPrompt(clean);
    const priorRequest = retry && retryRequestRef.current?.text === clean ? retryRequestRef.current : null;
    const userMessageId = priorRequest?.userMessageId ?? createFloId();
    const assistantMessageId = priorRequest?.assistantMessageId ?? createFloId();
    dispatch({ type: "submit", id: userMessageId, assistantId: assistantMessageId, text: clean });
    let conversationId = priorRequest?.conversationId ?? activeConversationId;
    retryRequestRef.current = { text: clean, userMessageId, assistantMessageId, conversationId };
    let reply = "";
    let streamError: string | null = null;
    try {
      if (!conversationId) {
        const created = await createFloConversation(user.id, activeHousehold.householdId, clean);
        conversationId = created.id;
        skipConversationLoadRef.current = created.id;
        setConversations(previous => [created, ...previous]);
        setActiveConversationId(created.id);
        retryRequestRef.current = { text: clean, userMessageId, assistantMessageId, conversationId: created.id };
      }
      const controller = new AbortController();
      streamAbortRef.current = controller;
      await streamFloChat({
        conversationId,
        householdId: activeHousehold.householdId,
        userMessageId,
        assistantMessageId,
        text: clean,
        facts,
        asOf: new Date().toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        previewTier,
        signal: controller.signal,
        onEvent: event => {
          if (event.type === "text-delta") {
            reply += event.delta;
            dispatch({ type: "stream-delta", id: assistantMessageId, delta: event.delta });
          } else if (event.type === "sources") {
            setSourcesByMessageId(previous => ({ ...previous, [assistantMessageId]: event.sources }));
          } else if (event.type === "error") {
            streamError = event.message;
          } else if (event.type === "done" && !reply && event.text) {
            reply = event.text;
            dispatch({ type: "stream-delta", id: assistantMessageId, delta: event.text });
          }
        },
      });
      streamAbortRef.current = null;
      if (streamError) throw new Error(streamError);
      dispatch({ type: "stop" });
    } catch (error) {
      streamAbortRef.current = null;
      if (reply) {
        dispatch({ type: "stop" });
        setChatError(error instanceof Error && error.name === "AbortError" ? "Response stopped. You can retry the last question." : "Flo's response was interrupted. Retry to continue.");
      } else {
        reply = buildCalendarDayReply(clean) ?? localFloAnswer(clean, facts, baseline) ?? FLO_CONNECTION_ERROR_MESSAGE;
        dispatch({ type: "reply", id: assistantMessageId, text: reply });
        setSourcesByMessageId(previous => ({ ...previous, [assistantMessageId]: [{ type: "deterministic", label: "FlowLedger calculation", asOf: new Date().toISOString() }] }));
        if (conversationId && reply !== FLO_CONNECTION_ERROR_MESSAGE) {
          void persistFloFallback({ id: assistantMessageId, conversationId, householdId: activeHousehold.householdId, userId: user.id, text: reply });
        }
        setChatError(reply === FLO_CONNECTION_ERROR_MESSAGE ? "Flo is offline. Basic deterministic answers remain available when the question matches your current snapshot." : "Flo was offline, so this answer used your deterministic FlowLedger calculation.");
      }
    }
    const replyId = assistantMessageId;
    const cards = floResponseCards(clean, facts, baseline);
    if (cards.length) setCardsByMessageId(previous => ({ ...previous, [replyId]: cards }));
    const debtPayment = evaluateFloDebtPayment(clean, facts, today);
    if (settings.debtPayoffEnabled && debtPayment?.allowed) {
      const result = evaluateDecision(baseline, buildDebtPaymentScenario(debtPayment), settings.safety_floor);
      if (result.verdict !== "unsafe") {
        setDebtPaymentByMessageId(previous => ({ ...previous, [replyId]: debtPayment }));
        setDebtPaymentState(previous => ({ ...previous, [replyId]: "idle" }));
      }
    }
    const billChange = evaluateFloRecurringBillChange(clean, facts, today);
    if (billChange?.allowed) {
      setBillChangeByMessageId(previous => ({ ...previous, [replyId]: billChange }));
      setBillChangeState(previous => ({ ...previous, [replyId]: "idle" }));
    }
    const scenario = buildFloDecisionScenario(clean, today);
    if (scenario) {
      const result = evaluateDecision(baseline, scenario, settings.safety_floor);
      setDecisionByMessageId(previous => ({ ...previous, [replyId]: { scenario, result } }));
      if (isFloPlanCreateCommand(clean)) {
        setDecisionSaveState(previous => ({ ...previous, [replyId]: "idle" as const }));
      }
    }
    const categoryMove = evaluateFloCategoryMove(clean, facts);
    if (categoryMove?.allowed) {
      setCategoryMoveByMessageId(previous => ({ ...previous, [replyId]: categoryMove }));
      setCategoryMoveState(previous => ({ ...previous, [replyId]: "idle" }));
    }
    const billDateMove = evaluateFloBillDateMove(clean, facts, today);
    if (billDateMove?.allowed) {
      setBillDateMoveByMessageId(previous => ({ ...previous, [replyId]: billDateMove }));
      setBillDateMoveState(previous => ({ ...previous, [replyId]: "idle" }));
    }
    const undoBillMove = evaluateFloBillMoveUndo(clean, facts);
    if (undoBillMove) {
      setBillMoveUndoByMessageId(previous => ({ ...previous, [replyId]: undoBillMove }));
      setBillMoveUndoState(previous => ({ ...previous, [replyId]: "idle" }));
    }
    const reductionTarget = pickReductionTarget(clean);
    if (reductionTarget) {
      setReducePlanByMessageId(previous => ({ ...previous, [replyId]: reductionTarget }));
    }
    if (user) {
      const nextSummary = `Recent topic: ${sanitizeFloSummary(clean).slice(0, 120)}`;
      setSummary(nextSummary);
      void updateFloMemory(user.id, clean);
    }
  };

  useEffect(() => {
    const prompt = Array.isArray(params.prompt) ? params.prompt[0] : params.prompt;
    const promptId = Array.isArray(params.promptId) ? params.promptId[0] : params.promptId;
    const cleanPrompt = typeof prompt === "string" ? prompt.trim() : "";
    const promptKey = `${promptId || "manual"}:${cleanPrompt}`;
    if (!cleanPrompt || handledPromptRef.current === promptKey || chat.sending) return;
    handledPromptRef.current = promptKey;
    void send(cleanPrompt);
  }, [params.prompt, params.promptId, chat.sending]);

  const addDecisionToCalendar = async (messageId: string, allowUnsafe = false) => {
    const decision = decisionByMessageId[messageId];
    if (!decision || decisionSaveState[messageId] === "saving" || decisionSaveState[messageId] === "saved") return;
    if (!allowUnsafe && decision.result.verdict === "unsafe") {
      setPendingUnsafeDecisionMessageId(messageId);
      setDecisionSafetyStop({
        itemName: decision.scenario.name || "this plan",
        amount: Math.abs(decision.scenario.amount),
        scheduledDate: decision.scenario.date,
        lowestBalance: decision.result.lowestBalance,
        lowestBalanceDate: decision.result.lowestBalanceDate,
        safetyFloor: settings.safety_floor,
        shortfall: Math.max(0, settings.safety_floor - decision.result.lowestBalance),
      });
      return;
    }
    setDecisionSaveState(previous => ({ ...previous, [messageId]: "saving" }));
    try {
      await saveDecision(decision.scenario, decision.result, "planned");
      setPendingUnsafeDecisionMessageId(null);
      setDecisionSafetyStop(null);
      setDecisionSaveState(previous => ({ ...previous, [messageId]: "saved" }));
    } catch {
      setDecisionSaveState(previous => ({ ...previous, [messageId]: "failed" }));
    }
  };

  const findDecision = (id: string) => decisions.find(decision => decision.id === id) ?? null;

  const openCompletePlan = (id: string) => {
    const decision = findDecision(id);
    if (!decision) return;
    setCompletePlan(decision);
    setCompleteActual(String(Math.abs(decision.actual_amount ?? decision.scenario.amount)));
  };

  const completeSelectedPlan = async () => {
    if (!completePlan) return;
    const actual = Math.abs(Number(completeActual));
    if (!Number.isFinite(actual)) return;
    setHistoryActionState(previous => ({ ...previous, [completePlan.id]: "saving" }));
    try {
      await updateDecision({
        ...completePlan,
        status: "completed",
        actual_amount: actual,
        completed_at: new Date().toISOString(),
        applied_change: { ...(completePlan.applied_change ?? {}), kind: "decision_follow_through", actualAmount: actual },
      });
      setCompletePlan(null);
      setCompleteActual("");
      setHistoryActionState(previous => {
        const next = { ...previous };
        delete next[completePlan.id];
        return next;
      });
    } catch {
      setHistoryActionState(previous => ({ ...previous, [completePlan.id]: "failed" }));
    }
  };

  const openPostponePlan = (id: string) => {
    const decision = findDecision(id);
    if (!decision) return;
    const currentDate = decision.next_due_date ?? decision.calendar_date ?? decision.scenario.date ?? today;
    setPostponePlan(decision);
    setPostponeDate(currentDate > today ? currentDate : today);
  };

  const openLowerPlan = (id: string) => {
    const decision = findDecision(id);
    if (!decision) return;
    setLowerPlan(decision);
    setLowerAmount(String(Math.abs(decision.scenario.amount)));
  };

  const saveLowerPlanAmount = async () => {
    if (!lowerPlan) return;
    const amount = Math.abs(Number(lowerAmount));
    if (!Number.isFinite(amount) || amount <= 0) return;
    setHistoryActionState(previous => ({ ...previous, [lowerPlan.id]: "saving" }));
    try {
      const scenario = { ...lowerPlan.scenario, amount };
      const scenarioDate = scenario.date ?? lowerPlan.calendar_date ?? today;
      const forecast = baseline.filter(day => day.date >= scenarioDate);
      const result = evaluateDecision(forecast.length ? forecast : [{ date: scenarioDate, balance: 0 }], scenario, settings.safety_floor);
      await updateDecision({
        ...lowerPlan,
        scenario,
        result,
        calendar_date: scenarioDate,
        next_due_date: scenarioDate,
        applied_change: { ...(lowerPlan.applied_change ?? {}), kind: "decision_amount_reduced", amount },
      });
      setLowerPlan(null);
      setLowerAmount("");
      setHistoryActionState(previous => {
        const next = { ...previous };
        delete next[lowerPlan.id];
        return next;
      });
    } catch {
      setHistoryActionState(previous => ({ ...previous, [lowerPlan.id]: "failed" }));
    }
  };

  const postponeSelectedPlan = async () => {
    if (!postponePlan || !postponeDate) return;
    setHistoryActionState(previous => ({ ...previous, [postponePlan.id]: "saving" }));
    try {
      const scenario = { ...postponePlan.scenario, date: postponeDate };
      await updateDecision({
        ...postponePlan,
        scenario,
        status: "planned",
        calendar_date: postponeDate,
        next_due_date: postponeDate,
        remind_at: `${postponeDate}T12:00:00.000Z`,
      });
      setPostponePlan(null);
      setPostponeDate("");
      setHistoryActionState(previous => {
        const next = { ...previous };
        delete next[postponePlan.id];
        return next;
      });
    } catch {
      setHistoryActionState(previous => ({ ...previous, [postponePlan.id]: "failed" }));
    }
  };

  const cancelPlan = async (id: string) => {
    const decision = findDecision(id);
    if (!decision || historyActionState[id] === "saving") return;
    setHistoryActionState(previous => ({ ...previous, [id]: "saving" }));
    try {
      await updateDecision({ ...decision, status: "cancelled" });
      setHistoryActionState(previous => {
        const next = { ...previous };
        delete next[id];
        return next;
      });
    } catch {
      setHistoryActionState(previous => ({ ...previous, [id]: "failed" }));
    }
  };

  const pickReductionTarget = (message: string): DecisionHistoryItem | null => {
    if (!/(reduce|lower|cut|postpone|planned spending|spending)/i.test(message) || !/(plan|planned|decision|spending)/i.test(message)) return null;
    const candidates = [
      ...riskyDecisionItems,
      ...decisionHistory.due,
      ...decisionHistory.upcoming,
    ];
    return candidates
      .filter(item => item.status === "upcoming" || item.status === "due" || item.status === "saved")
      .sort((left, right) => right.plannedAmount - left.plannedAmount || left.date.localeCompare(right.date))[0] ?? null;
  };

  const applyCategoryMoveFromFlo = (messageId: string) => {
    const move = categoryMoveByMessageId[messageId];
    if (!move || categoryMoveState[messageId] === "saving" || categoryMoveState[messageId] === "saved") return;
    setCategoryMoveState(previous => ({ ...previous, [messageId]: "saving" }));
    try {
      const currentBudgets = categoryBudgets;
      const rows = categoryPlan.map(row => ({
        category: row.category,
        budgeted: row.budgeted,
        spent: row.spent,
        remaining: row.remaining,
        status: row.status,
        percentUsed: row.percentUsed,
      }));
      const next = applyCategoryBudgetMove(currentBudgets, rows, move.from, move.to, move.amount);
      writeCategoryBudgets(next);
      setCategoryMoveState(previous => ({ ...previous, [messageId]: "saved" }));
    } catch {
      setCategoryMoveState(previous => ({ ...previous, [messageId]: "failed" }));
    }
  };

  const applyBillDateMoveFromFlo = async (messageId: string) => {
    const move = billDateMoveByMessageId[messageId];
    if (!move || billDateMoveState[messageId] === "saving" || billDateMoveState[messageId] === "saved") return;
    setBillDateMoveState(previous => ({ ...previous, [messageId]: "saving" }));
    try {
      await moveBillOccurrence(move.billId, move.fromDate, move.toDate);
      setBillDateMoveState(previous => ({ ...previous, [messageId]: "saved" }));
    } catch {
      setBillDateMoveState(previous => ({ ...previous, [messageId]: "failed" }));
    }
  };

  const undoBillMoveFromFlo = async (messageId: string) => {
    const move = billMoveUndoByMessageId[messageId];
    if (!move || billMoveUndoState[messageId] === "saving" || billMoveUndoState[messageId] === "saved") return;
    setBillMoveUndoState(previous => ({ ...previous, [messageId]: "saving" }));
    try {
      await removeBillOccurrenceMove(move.id);
      setBillMoveUndoState(previous => ({ ...previous, [messageId]: "saved" }));
    } catch {
      setBillMoveUndoState(previous => ({ ...previous, [messageId]: "failed" }));
    }
  };

  const applyDebtPaymentFromFlo = async (messageId: string) => {
    const payment = debtPaymentByMessageId[messageId];
    if (!payment || debtPaymentState[messageId] === "saving" || debtPaymentState[messageId] === "saved") return;
    setDebtPaymentState(previous => ({ ...previous, [messageId]: "saving" }));
    try {
      const [yearValue, monthValue] = payment.date.split("-").map(Number);
      await saveExtraPayment(
        monthValue - 1,
        yearValue,
        payment.amount,
        [{
          billId: payment.debtId,
          billName: payment.debtName,
          payment: payment.amount,
          balanceBefore: payment.balanceBefore,
          balanceAfter: payment.balanceAfter,
          paidOff: payment.balanceAfter <= 0.005,
          paymentDate: payment.date,
        }],
        payment.date,
        [{ type: "manual", amount: payment.amount, pendingBalanceApply: payment.date > today }],
      );
      setDebtPaymentState(previous => ({ ...previous, [messageId]: "saved" }));
    } catch {
      setDebtPaymentState(previous => ({ ...previous, [messageId]: "failed" }));
    }
  };

  const applyBillChangeFromFlo = async (messageId: string) => {
    const change = billChangeByMessageId[messageId];
    if (!change || billChangeState[messageId] === "saving" || billChangeState[messageId] === "saved") return;
    const bill = bills.find(item => item.id === change.billId);
    if (!bill) return;
    setBillChangeState(previous => ({ ...previous, [messageId]: "saving" }));
    try {
      if (change.preserveCurrentMonth) {
        await setCustomAmount(bill.id, now.getMonth(), now.getFullYear(), bill.amount);
      }
      await updateBill({ ...bill, amount: change.newAmount });
      setBillChangeState(previous => ({ ...previous, [messageId]: "saved" }));
    } catch {
      setBillChangeState(previous => ({ ...previous, [messageId]: "failed" }));
    }
  };

  const composerBottom = Platform.OS === "web" ? 88 : Math.max(insets.bottom, 8) + 54;

  if (floProLocked) {
    return <BasicFlo facts={facts} baseline={baseline} asOf={new Date().toISOString()} />;
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
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>Your private place to plan with Flo</Text>
        </View>
        <Feather name="message-circle" size={24} color={colors.primaryForeground} />
      </LinearGradient>

      <FloConversationBar
        conversations={conversations}
        activeId={activeConversationId}
        disabled={chat.sending}
        onNew={startNewConversation}
        onSelect={selectConversation}
        onRename={renameConversation}
        onDelete={removeConversation}
      />

      <ScrollView
        ref={scrollRef}
        style={styles.conversation}
        contentContainerStyle={styles.conversationContent}
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
              <Text style={[styles.bubbleText, { color: message.role === "user" ? colors.primaryForeground : message.thinking ? colors.mutedForeground : colors.foreground }]}>
                {message.role === "flo" ? humanizeFloText(message.text) : message.text}
              </Text>
            </View>
            {message.role === "flo" && cardsByMessageId[message.id]?.length ? (
              <View style={styles.cardGrid}>
                {cardsByMessageId[message.id].map(card => (
                  <View key={`${message.id}-${card.title}`} style={[styles.insightCard, { borderColor: toneColor(card.tone, colors), backgroundColor: toneColor(card.tone, colors) + "12" }]}>
                    <Text style={[styles.insightTitle, { color: colors.mutedForeground }]}>{card.title}</Text>
                    <Text style={[styles.insightValue, { color: toneColor(card.tone, colors) }]}>{card.value}</Text>
                    <Text style={[styles.insightDetail, { color: colors.mutedForeground }]}>{card.detail}</Text>
                  </View>
                ))}
              </View>
            ) : null}
            {message.role === "flo" && sourcesByMessageId[message.id]?.length ? (
              <View style={styles.sourceRow}>
                {sourcesByMessageId[message.id].map(source => (
                  <View key={`${message.id}-${source.type}-${source.label}`} style={[styles.sourceChip, { backgroundColor: colors.muted, borderColor: colors.border }]}>
                    <Feather name="database" size={11} color={colors.mutedForeground} />
                    <Text style={[styles.sourceText, { color: colors.mutedForeground }]}>{source.label}</Text>
                  </View>
                ))}
              </View>
            ) : null}
            {message.role === "flo" && decisionByMessageId[message.id] ? (
              <View style={styles.decisionActions}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Save this Flo plan to calendar"
                  disabled={decisionSaveState[message.id] === "saving" || decisionSaveState[message.id] === "saved"}
                  onPress={() => void addDecisionToCalendar(message.id)}
                  style={[
                    styles.saveDecisionButton,
                    { backgroundColor: colors.primary, opacity: decisionSaveState[message.id] === "saved" ? 0.7 : 1 },
                  ]}
                >
                  <Feather
                    name={decisionSaveState[message.id] === "saved" ? "check-circle" : "calendar"}
                    size={16}
                    color="#fff"
                  />
                  <Text style={styles.saveDecisionText}>
                    {decisionSaveState[message.id] === "saving"
                      ? "Saving..."
                      : decisionSaveState[message.id] === "saved"
                        ? `Saved for ${formatDisplayDate(decisionByMessageId[message.id].scenario.date)}`
                        : `Save this plan · ${formatDisplayDate(decisionByMessageId[message.id].scenario.date)}`}
                  </Text>
                </Pressable>
                <Text style={[styles.saveDecisionHint, { color: colors.mutedForeground }]}>
                  Saves to your calendar as a planned decision.
                </Text>
                {decisionSaveState[message.id] === "failed" ? (
                  <Text style={[styles.saveDecisionError, { color: colors.destructive }]}>Couldn&apos;t save this plan. Try again.</Text>
                ) : null}
              </View>
            ) : null}
            {message.role === "flo" && categoryMoveByMessageId[message.id] ? (
              <View style={styles.decisionActions}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Apply this category budget move"
                  disabled={categoryMoveState[message.id] === "saving" || categoryMoveState[message.id] === "saved"}
                  onPress={() => applyCategoryMoveFromFlo(message.id)}
                  style={[
                    styles.saveDecisionButton,
                    { backgroundColor: colors.success, opacity: categoryMoveState[message.id] === "saved" ? 0.7 : 1 },
                  ]}
                >
                  <Feather
                    name={categoryMoveState[message.id] === "saved" ? "check-circle" : "repeat"}
                    size={16}
                    color="#fff"
                  />
                  <Text style={styles.saveDecisionText}>
                    {categoryMoveState[message.id] === "saving"
                      ? "Applying..."
                      : categoryMoveState[message.id] === "saved"
                        ? "Move applied"
                        : `Apply $${categoryMoveByMessageId[message.id].amount.toFixed(2)} move`}
                  </Text>
                </Pressable>
                <Text style={[styles.saveDecisionHint, { color: colors.mutedForeground }]}>
                  Moves budget from {categoryMoveByMessageId[message.id].from} to {categoryMoveByMessageId[message.id].to} for this month.
                </Text>
                {categoryMoveState[message.id] === "failed" ? (
                  <Text style={[styles.saveDecisionError, { color: colors.destructive }]}>Couldn&apos;t apply this move. Try again.</Text>
                ) : null}
              </View>
            ) : null}
            {message.role === "flo" && billDateMoveByMessageId[message.id] ? (
              <View style={styles.decisionActions}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Apply this bill due date move"
                  disabled={billDateMoveState[message.id] === "saving" || billDateMoveState[message.id] === "saved"}
                  onPress={() => void applyBillDateMoveFromFlo(message.id)}
                  style={[
                    styles.saveDecisionButton,
                    { backgroundColor: colors.primary, opacity: billDateMoveState[message.id] === "saved" ? 0.7 : 1 },
                  ]}
                >
                  <Feather
                    name={billDateMoveState[message.id] === "saved" ? "check-circle" : "calendar"}
                    size={16}
                    color="#fff"
                  />
                  <Text style={styles.saveDecisionText}>
                    {billDateMoveState[message.id] === "saving"
                      ? "Applying..."
                      : billDateMoveState[message.id] === "saved"
                        ? "Due date moved"
                        : `Move ${billDateMoveByMessageId[message.id].billName}`}
                  </Text>
                </Pressable>
                <Text style={[styles.saveDecisionHint, { color: colors.mutedForeground }]}>
                  Moves this one bill occurrence from {formatDisplayDate(billDateMoveByMessageId[message.id].fromDate)} to {formatDisplayDate(billDateMoveByMessageId[message.id].toDate)}.
                </Text>
                {billDateMoveState[message.id] === "failed" ? (
                  <Text style={[styles.saveDecisionError, { color: colors.destructive }]}>Couldn&apos;t move this bill. Try again.</Text>
                ) : null}
              </View>
            ) : null}
            {message.role === "flo" && debtPaymentByMessageId[message.id] ? (
              <View style={styles.decisionActions}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Apply this extra debt payment"
                  disabled={debtPaymentState[message.id] === "saving" || debtPaymentState[message.id] === "saved"}
                  onPress={() => void applyDebtPaymentFromFlo(message.id)}
                  style={[
                    styles.saveDecisionButton,
                    { backgroundColor: colors.success, opacity: debtPaymentState[message.id] === "saved" ? 0.7 : 1 },
                  ]}
                >
                  <Feather
                    name={debtPaymentState[message.id] === "saved" ? "check-circle" : "zap"}
                    size={16}
                    color="#fff"
                  />
                  <Text style={styles.saveDecisionText}>
                    {debtPaymentState[message.id] === "saving"
                      ? "Applying..."
                      : debtPaymentState[message.id] === "saved"
                        ? "Debt payment scheduled"
                        : `Apply $${debtPaymentByMessageId[message.id].amount.toFixed(2)} to ${debtPaymentByMessageId[message.id].debtName}`}
                  </Text>
                </Pressable>
                <Text style={[styles.saveDecisionHint, { color: colors.mutedForeground }]}>
                  Adds an extra debt payment on {formatDisplayDate(debtPaymentByMessageId[message.id].date)} and updates the debt when that date arrives.
                </Text>
                {debtPaymentState[message.id] === "failed" ? (
                  <Text style={[styles.saveDecisionError, { color: colors.destructive }]}>Couldn&apos;t schedule this debt payment. Try again.</Text>
                ) : null}
              </View>
            ) : null}
            {message.role === "flo" && billChangeByMessageId[message.id] ? (
              <View style={styles.decisionActions}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Apply this recurring bill change"
                  disabled={billChangeState[message.id] === "saving" || billChangeState[message.id] === "saved"}
                  onPress={() => void applyBillChangeFromFlo(message.id)}
                  style={[
                    styles.saveDecisionButton,
                    { backgroundColor: colors.primary, opacity: billChangeState[message.id] === "saved" ? 0.7 : 1 },
                  ]}
                >
                  <Feather
                    name={billChangeState[message.id] === "saved" ? "check-circle" : "edit-3"}
                    size={16}
                    color="#fff"
                  />
                  <Text style={styles.saveDecisionText}>
                    {billChangeState[message.id] === "saving"
                      ? "Applying..."
                      : billChangeState[message.id] === "saved"
                        ? "Bill updated"
                        : `Update ${billChangeByMessageId[message.id].billName} to $${billChangeByMessageId[message.id].newAmount.toFixed(2)}`}
                  </Text>
                </Pressable>
                <Text style={[styles.saveDecisionHint, { color: colors.mutedForeground }]}>
                  Starts {formatDisplayDate(billChangeByMessageId[message.id].startDate)}{billChangeByMessageId[message.id].preserveCurrentMonth ? " and keeps this month unchanged." : "."}
                </Text>
                {billChangeState[message.id] === "failed" ? (
                  <Text style={[styles.saveDecisionError, { color: colors.destructive }]}>Couldn&apos;t update this bill. Try again.</Text>
                ) : null}
              </View>
            ) : null}
            {message.role === "flo" && billMoveUndoByMessageId[message.id] ? (
              <View style={styles.decisionActions}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Undo this bill move"
                  disabled={billMoveUndoState[message.id] === "saving" || billMoveUndoState[message.id] === "saved"}
                  onPress={() => void undoBillMoveFromFlo(message.id)}
                  style={[
                    styles.saveDecisionButton,
                    { backgroundColor: colors.warning, opacity: billMoveUndoState[message.id] === "saved" ? 0.7 : 1 },
                  ]}
                >
                  <Feather
                    name={billMoveUndoState[message.id] === "saved" ? "check-circle" : "rotate-ccw"}
                    size={16}
                    color="#fff"
                  />
                  <Text style={styles.saveDecisionText}>
                    {billMoveUndoState[message.id] === "saving"
                      ? "Restoring..."
                      : billMoveUndoState[message.id] === "saved"
                        ? "Move restored"
                        : `Undo ${billMoveUndoByMessageId[message.id].billName} move`}
                  </Text>
                </Pressable>
                <Text style={[styles.saveDecisionHint, { color: colors.mutedForeground }]}>
                  Restores this bill from {formatDisplayDate(billMoveUndoByMessageId[message.id].toDate)} back to {formatDisplayDate(billMoveUndoByMessageId[message.id].fromDate)}.
                </Text>
                {billMoveUndoState[message.id] === "failed" ? (
                  <Text style={[styles.saveDecisionError, { color: colors.destructive }]}>Couldn&apos;t restore this bill. Try again.</Text>
                ) : null}
              </View>
            ) : null}
            {message.role === "flo" && reducePlanByMessageId[message.id] ? (
              <View style={styles.decisionActions}>
                <View style={[styles.reductionTargetCard, { borderColor: colors.border, backgroundColor: colors.muted }]}>
                  <Text style={[styles.reductionTargetLabel, { color: colors.mutedForeground }]}>Recommended plan to adjust</Text>
                  <Text style={[styles.reductionTargetName, { color: colors.foreground }]} numberOfLines={1}>{reducePlanByMessageId[message.id].name}</Text>
                  <Text style={[styles.reductionTargetMeta, { color: colors.mutedForeground }]}>
                    {reducePlanByMessageId[message.id].amountLabel} · {formatDisplayDate(reducePlanByMessageId[message.id].date)}
                  </Text>
                </View>
                <View style={styles.reductionActions}>
                  <Pressable
                    onPress={() => openPostponePlan(reducePlanByMessageId[message.id].id)}
                    style={({ pressed }) => [styles.reductionButton, { backgroundColor: colors.primary + "18", opacity: pressed ? 0.75 : 1 }]}
                  >
                    <Text style={[styles.reductionButtonText, { color: colors.primary }]}>Postpone</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => openLowerPlan(reducePlanByMessageId[message.id].id)}
                    style={({ pressed }) => [styles.reductionButton, { backgroundColor: colors.warning + "18", opacity: pressed ? 0.75 : 1 }]}
                  >
                    <Text style={[styles.reductionButtonText, { color: colors.warning }]}>Lower amount</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => void cancelPlan(reducePlanByMessageId[message.id].id)}
                    style={({ pressed }) => [styles.reductionButton, { backgroundColor: colors.destructive + "14", opacity: pressed ? 0.75 : 1 }]}
                  >
                    <Text style={[styles.reductionButtonText, { color: colors.destructive }]}>
                      {historyActionState[reducePlanByMessageId[message.id].id] === "saving" ? "Saving" : "Cancel plan"}
                    </Text>
                  </Pressable>
                </View>
                <Text style={[styles.saveDecisionHint, { color: colors.mutedForeground }]}>
                  Each option updates the saved plan and recalculates the forecast.
                </Text>
              </View>
            ) : null}
          </View>
        ))}
      </ScrollView>

      <Modal visible={!!completePlan} transparent animationType="slide" onRequestClose={() => setCompletePlan(null)}>
        <Pressable style={styles.modalOverlay} onPress={() => setCompletePlan(null)}>
          <Pressable style={[styles.followSheet, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => {}}>
            <View style={[styles.sheetHandle, { backgroundColor: colors.mutedForeground }]} />
            <Text style={[styles.followTitle, { color: colors.foreground }]}>Mark completed</Text>
            <Text style={[styles.followSub, { color: colors.mutedForeground }]}>
              What was the actual amount for {completePlan?.name ?? "this plan"}?
            </Text>
            <View style={[styles.actualInputWrap, { backgroundColor: colors.muted, borderColor: colors.border }]}>
              <Text style={[styles.actualPrefix, { color: colors.mutedForeground }]}>$</Text>
              <TextInput
                value={completeActual}
                onChangeText={setCompleteActual}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor={colors.mutedForeground}
                style={[styles.actualInput, { color: colors.foreground }]}
              />
            </View>
            {completePlan && historyActionState[completePlan.id] === "failed" ? (
              <Text style={[styles.saveDecisionError, { color: colors.destructive }]}>Couldn&apos;t update this plan. Try again.</Text>
            ) : null}
            <View style={styles.followActions}>
              <Pressable onPress={() => setCompletePlan(null)} style={[styles.followButton, { backgroundColor: colors.muted }]}>
                <Text style={[styles.followButtonText, { color: colors.mutedForeground }]}>Cancel</Text>
              </Pressable>
              <Pressable onPress={() => void completeSelectedPlan()} style={[styles.followButton, { backgroundColor: colors.success }]}>
                <Text style={styles.followPrimaryText}>Save actual</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={!!postponePlan} transparent animationType="slide" onRequestClose={() => setPostponePlan(null)}>
        <Pressable style={styles.modalOverlay} onPress={() => setPostponePlan(null)}>
          <Pressable style={[styles.followSheet, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => {}}>
            <View style={[styles.sheetHandle, { backgroundColor: colors.mutedForeground }]} />
            <Text style={[styles.followTitle, { color: colors.foreground }]}>Postpone plan</Text>
            <Text style={[styles.followSub, { color: colors.mutedForeground }]}>
              Pick the new date for {postponePlan?.name ?? "this plan"}.
            </Text>
            <DatePickerField value={postponeDate} onChange={setPostponeDate} minDate={today} label="New planned date" />
            {postponePlan && historyActionState[postponePlan.id] === "failed" ? (
              <Text style={[styles.saveDecisionError, { color: colors.destructive }]}>Couldn&apos;t postpone this plan. Try again.</Text>
            ) : null}
            <View style={styles.followActions}>
              <Pressable onPress={() => setPostponePlan(null)} style={[styles.followButton, { backgroundColor: colors.muted }]}>
                <Text style={[styles.followButtonText, { color: colors.mutedForeground }]}>Cancel</Text>
              </Pressable>
              <Pressable onPress={() => void postponeSelectedPlan()} style={[styles.followButton, { backgroundColor: colors.primary }]}>
                <Text style={styles.followPrimaryText}>Save date</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={!!lowerPlan} transparent animationType="slide" onRequestClose={() => setLowerPlan(null)}>
        <Pressable style={styles.modalOverlay} onPress={() => setLowerPlan(null)}>
          <Pressable style={[styles.followSheet, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => {}}>
            <View style={[styles.sheetHandle, { backgroundColor: colors.mutedForeground }]} />
            <Text style={[styles.followTitle, { color: colors.foreground }]}>Lower planned amount</Text>
            <Text style={[styles.followSub, { color: colors.mutedForeground }]}>
              Enter the new amount for {lowerPlan?.name ?? "this plan"}. Flo will recalculate the forecast before saving.
            </Text>
            <View style={[styles.actualInputWrap, { backgroundColor: colors.muted, borderColor: colors.border }]}>
              <Text style={[styles.actualPrefix, { color: colors.mutedForeground }]}>$</Text>
              <TextInput
                value={lowerAmount}
                onChangeText={setLowerAmount}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor={colors.mutedForeground}
                style={[styles.actualInput, { color: colors.foreground }]}
              />
            </View>
            {lowerPlan && historyActionState[lowerPlan.id] === "failed" ? (
              <Text style={[styles.saveDecisionError, { color: colors.destructive }]}>Couldn&apos;t lower this plan. Try again.</Text>
            ) : null}
            <View style={styles.followActions}>
              <Pressable onPress={() => setLowerPlan(null)} style={[styles.followButton, { backgroundColor: colors.muted }]}>
                <Text style={[styles.followButtonText, { color: colors.mutedForeground }]}>Cancel</Text>
              </Pressable>
              <Pressable onPress={() => void saveLowerPlanAmount()} style={[styles.followButton, { backgroundColor: colors.warning }]}>
                <Text style={styles.followPrimaryText}>Save lower amount</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <FloSafetyStopModal
        visible={Boolean(decisionSafetyStop)}
        warning={decisionSafetyStop}
        onKeepEditing={() => {
          setDecisionSafetyStop(null);
          setPendingUnsafeDecisionMessageId(null);
        }}
        onScheduleAnyway={pendingUnsafeDecisionMessageId ? () => { void addDecisionToCalendar(pendingUnsafeDecisionMessageId, true); } : undefined}
      />

      <View style={[styles.composerArea, { backgroundColor: colors.background, borderColor: colors.border, paddingBottom: composerBottom }]}>
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

function formatDisplayDate(date: string): string {
  const parsed = dateOnlyToLocalDate(date);
  if (!parsed) return date;
  return parsed.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}

function formatMoney(amount: number): string {
  return `$${Math.abs(amount).toFixed(2)}`;
}

function formatSignedMoney(amount: number): string {
  const sign = amount < 0 ? "-" : "+";
  return `${sign}${formatMoney(amount)}`;
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

function toneColor(tone: FloResponseCard["tone"], colors: ReturnType<typeof useColors>) {
  if (tone === "safe") return colors.success;
  if (tone === "caution") return colors.warning;
  if (tone === "risk") return colors.destructive;
  return colors.primary;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    minHeight: 92,
    paddingHorizontal: 18,
    paddingBottom: 14,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
    gap: 12,
  },
  headerText: { flex: 1 },
  title: { fontSize: 25, fontFamily: "Inter_700Bold" },
  subtitle: { fontSize: 12, lineHeight: 17, marginTop: 3 },
  conversation: { flex: 1 },
  conversationContent: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 28, gap: 16 },
  loadOlderButton: { alignSelf: "center", minHeight: 36, borderRadius: 999, justifyContent: "center", paddingHorizontal: 14 },
  loadOlderText: { fontSize: 11, fontFamily: "Inter_700Bold" },
  historyCard: { borderWidth: 1, borderRadius: 20, padding: 14, gap: 12 },
  historyHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  historyIcon: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  historyTitle: { fontSize: 17, fontFamily: "Inter_700Bold" },
  historySub: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 1 },
  historyStats: { flexDirection: "row", gap: 8 },
  historyStat: { flex: 1, borderRadius: 12, backgroundColor: "rgba(148,163,184,0.10)", paddingVertical: 9, alignItems: "center" },
  historyStatValue: { fontSize: 17, fontFamily: "Inter_700Bold" },
  historyStatLabel: { color: "#94a3b8", fontSize: 10, fontFamily: "Inter_600SemiBold", marginTop: 2 },
  historyEmpty: { fontSize: 12, lineHeight: 17, fontFamily: "Inter_400Regular" },
  historySections: { gap: 10 },
  historySection: { gap: 7 },
  historySectionTitle: { fontSize: 10, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.7 },
  historyRow: { borderWidth: 1, borderRadius: 14, padding: 10, flexDirection: "row", gap: 9 },
  historyStatusDot: { width: 9, height: 9, borderRadius: 5, marginTop: 5 },
  historyRowBody: { flex: 1 },
  historyRowTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  historyRowName: { flex: 1, fontSize: 13, fontFamily: "Inter_700Bold" },
  historyDate: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  historyAmount: { fontSize: 11, lineHeight: 16, fontFamily: "Inter_400Regular", marginTop: 2 },
  historyVariance: { fontSize: 11, fontFamily: "Inter_700Bold", marginTop: 1 },
  historyActions: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 9 },
  historyActionButton: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 7 },
  historyActionText: { fontSize: 11, fontFamily: "Inter_700Bold" },
  modalOverlay: { flex: 1, backgroundColor: "rgba(2,6,23,0.68)", justifyContent: "flex-end" },
  followSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, padding: 18, gap: 12 },
  sheetHandle: { alignSelf: "center", width: 48, height: 4, borderRadius: 999, opacity: 0.5, marginBottom: 4 },
  followTitle: { fontSize: 20, fontFamily: "Inter_700Bold", textAlign: "center" },
  followSub: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_400Regular", textAlign: "center" },
  actualInputWrap: { height: 52, borderRadius: 14, borderWidth: 1, flexDirection: "row", alignItems: "center", paddingHorizontal: 14 },
  actualPrefix: { fontSize: 17, fontFamily: "Inter_700Bold", marginRight: 8 },
  actualInput: { flex: 1, fontSize: 18, fontFamily: "Inter_700Bold" },
  followActions: { flexDirection: "row", gap: 10, marginTop: 4 },
  followButton: { flex: 1, minHeight: 46, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  followButtonText: { fontSize: 14, fontFamily: "Inter_700Bold" },
  followPrimaryText: { color: "#fff", fontSize: 14, fontFamily: "Inter_700Bold" },
  bubble: { maxWidth: "90%", paddingHorizontal: 16, paddingVertical: 15, borderRadius: 18 },
  floBubble: { alignSelf: "flex-start", borderWidth: 1, borderTopLeftRadius: 6 },
  userBubble: { alignSelf: "flex-end", borderTopRightRadius: 6 },
  thinkingRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  bubbleText: { fontSize: 15, lineHeight: 23, fontFamily: "Inter_400Regular" },
  cardGrid: { marginTop: 10, gap: 8 },
  insightCard: { borderWidth: 1, borderRadius: 12, padding: 10 },
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
  errorRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  chatError: { flex: 1, fontSize: 11, lineHeight: 15, fontFamily: "Inter_500Medium" },
  retryButton: { minHeight: 34, borderRadius: 999, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 11 },
  retryText: { fontSize: 11, fontFamily: "Inter_800ExtraBold" },
  quickPromptScroller: { marginBottom: 10, maxHeight: 42 },
  quickPromptContent: { gap: 8, paddingRight: 12 },
  quickPromptChip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 9 },
  quickPromptText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  composer: {
    minHeight: 62,
    maxHeight: 112,
    borderRadius: 20,
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
});
