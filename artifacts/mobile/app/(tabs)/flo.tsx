import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
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
import { useBudget, type DecisionRecord } from "@/context/BudgetContext";
import { DatePickerField } from "@/components/DatePickerField";
import { useColors } from "@/hooks/useColors";
import { askFlo, loadFloMemory, updateFloMemory, type FloFacts } from "@/lib/flo";
import {
  FLO_CONNECTION_ERROR_MESSAGE,
  buildFloCategoryQuickPrompts,
  buildFloDecisionScenario,
  evaluateFloCategoryMove,
  floResponseCards,
  isFloPlanCreateCommand,
  reduceFloChat,
  sanitizeFloSummary,
  type FloCategoryMoveResult,
  type FloResponseCard,
  type FloChatState,
} from "@/lib/floPolicy";
import { summarizeMonthlyBills } from "@/lib/monthlySummary";
import { evaluateDecision, type DecisionResult, type DecisionScenario } from "@/lib/decisions";
import { buildDecisionHistory, type DecisionHistoryItem } from "@/lib/decisionHistory";
import { buildDecisionRiskAlerts } from "@/lib/decisionRisk";
import { applyCategoryBudgetMove, buildCategoryPlan, buildCategoryRolloverAdjustments } from "@/lib/categoryPlanning";
import { DECISION_HUB_SETTINGS_EVENT, readDecisionHubSettings, type DecisionHubSettings } from "@/lib/decisionHubSettings";
import { buildPaycheckPlan, makeDateKey } from "@/lib/paycheckPlanning";

const sampleQuestions = [
  "Ask Flo anything…",
  "Can I afford $500?",
  "What bills are due next?",
  "Why does my balance run low?",
  "How do I add income?",
];

const initialChat: FloChatState = { messages: [], sending: false };

export default function FloScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { bills, transactions, decisions, settings, forecastConfidence, getDailyBalances, getMonthlyIncome, getCashFlow, getMonthlyBills, getBillMonthlyTotal, getBillOccurrencesInMonth, getIncomeOccurrencesInMonth, getPaidAmount, saveDecision, updateDecision, getTransactionsForMonth, categories } = useBudget();
  const [chat, dispatch] = useReducer(reduceFloChat, initialChat);
  const [cardsByMessageId, setCardsByMessageId] = useState<Record<string, FloResponseCard[]>>({});
  const [decisionByMessageId, setDecisionByMessageId] = useState<Record<string, { scenario: DecisionScenario; result: DecisionResult }>>({});
  const [decisionSaveState, setDecisionSaveState] = useState<Record<string, "saving" | "saved" | "failed">>({});
  const [categoryMoveByMessageId, setCategoryMoveByMessageId] = useState<Record<string, FloCategoryMoveResult>>({});
  const [categoryMoveState, setCategoryMoveState] = useState<Record<string, "idle" | "saving" | "saved" | "failed">>({});
  const [categoryBudgets, setCategoryBudgets] = useState<Record<string, number>>({});
  const [decisionHubSettings, setDecisionHubSettings] = useState<DecisionHubSettings>(() => readDecisionHubSettings());
  const [input, setInput] = useState("");
  const [summary, setSummary] = useState("");
  const [sampleIndex, setSampleIndex] = useState(0);
  const [completePlan, setCompletePlan] = useState<DecisionRecord | null>(null);
  const [completeActual, setCompleteActual] = useState("");
  const [postponePlan, setPostponePlan] = useState<DecisionRecord | null>(null);
  const [postponeDate, setPostponeDate] = useState("");
  const [historyActionState, setHistoryActionState] = useState<Record<string, "saving" | "failed">>({});
  const scrollRef = useRef<ScrollView>(null);
  const now = useMemo(() => new Date(), []);
  const today = now.toISOString().slice(0, 10);

  useEffect(() => {
    if (user) void loadFloMemory(user.id).then(setSummary);
  }, [user]);

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
    return `flowledger-category-budgets-${year}-${String(month + 1).padStart(2, "0")}`;
  }, [today]);

  const readCategoryBudgetsFromStorage = (key = categoryBudgetKey) => {
    if (Platform.OS !== "web") return {};
    try {
      const raw = globalThis.localStorage?.getItem(key);
      const parsed = raw ? JSON.parse(raw) as Record<string, unknown> : {};
      const next: Record<string, number> = {};
      Object.entries(parsed).forEach(([category, amount]) => {
        const value = Number(amount);
        if (category && Number.isFinite(value) && value >= 0) next[category] = value;
      });
      return next;
    } catch {
      return {};
    }
  };

  useEffect(() => {
    setCategoryBudgets(readCategoryBudgetsFromStorage());
  }, [categoryBudgetKey]);

  useEffect(() => {
    const loadDecisionHubSettings = () => setDecisionHubSettings(readDecisionHubSettings());
    loadDecisionHubSettings();
    if (Platform.OS !== "web") return;
    globalThis.addEventListener?.(DECISION_HUB_SETTINGS_EVENT, loadDecisionHubSettings);
    return () => globalThis.removeEventListener?.(DECISION_HUB_SETTINGS_EVENT, loadDecisionHubSettings);
  }, []);

  const writeCategoryBudgets = (budgets: Record<string, number>) => {
    setCategoryBudgets(budgets);
    if (Platform.OS === "web") {
      globalThis.localStorage?.setItem(categoryBudgetKey, JSON.stringify(budgets));
      globalThis.dispatchEvent?.(new Event("flowledger-category-budgets-updated"));
    }
  };

  const categoryPlan = useMemo(() => {
    const month = now.getMonth();
    const year = now.getFullYear();
    const previousDate = new Date(year, month - 1, 1);
    const previousMonth = previousDate.getMonth();
    const previousYear = previousDate.getFullYear();
    const previousBudgetKey = `flowledger-category-budgets-${previousYear}-${String(previousMonth + 1).padStart(2, "0")}`;
    const previousBills = getMonthlyBills(previousMonth, previousYear)
      .filter(bill => !bill.is_debt)
      .map(bill => ({
        category: bill.category || "Other",
        amount: getBillMonthlyTotal(bill, previousMonth, previousYear),
      }));
    const previousTransactions = getTransactionsForMonth(previousMonth, previousYear)
      .filter(transaction => transaction.category !== "Debt" && transaction.category !== "Income")
      .map(transaction => ({ category: transaction.category || "Other", amount: transaction.amount }));
    const previousRows = buildCategoryPlan(
      categories.filter(category => category !== "Debt"),
      previousBills,
      previousTransactions,
      Object.entries(readCategoryBudgetsFromStorage(previousBudgetKey)).map(([category, amount]) => ({ category, amount })),
    );
    const rollovers = buildCategoryRolloverAdjustments(previousRows, decisionHubSettings.categoryRolloverEnabled);
    const monthBills = getMonthlyBills(month, year)
      .filter(bill => !bill.is_debt)
      .map(bill => ({
        category: bill.category || "Other",
        amount: getBillMonthlyTotal(bill, month, year),
      }));
    const monthTransactions = getTransactionsForMonth(month, year)
      .filter(transaction => transaction.category !== "Debt" && transaction.category !== "Income")
      .map(transaction => ({ category: transaction.category || "Other", amount: transaction.amount }));
    const rows = buildCategoryPlan(
      categories.filter(category => category !== "Debt"),
      monthBills,
      monthTransactions,
      Object.entries(categoryBudgets).map(([category, amount]) => ({ category, amount })),
      rollovers,
    );
    const transactionDetails = getTransactionsForMonth(month, year)
      .filter(transaction => transaction.amount < 0 && transaction.category !== "Debt" && transaction.category !== "Income");
    return rows.map(row => {
      const topTransaction = transactionDetails
        .filter(transaction => (transaction.category || "Other") === row.category)
        .sort((left, right) => Math.abs(right.amount) - Math.abs(left.amount))[0];
      return {
        category: row.category,
        budgeted: row.budgeted,
        spent: row.spent,
        remaining: row.remaining,
        rollover: row.rollover,
        status: row.status,
        percentUsed: row.percentUsed,
        topTransaction: topTransaction ? {
          name: topTransaction.note?.trim() || row.category,
          amount: topTransaction.amount,
          date: topTransaction.date,
        } : undefined,
      };
    });
  }, [categories, categoryBudgets, getMonthlyBills, getBillMonthlyTotal, getTransactionsForMonth, now, decisionHubSettings.categoryRolloverEnabled]);

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
      transaction.date.startsWith(currentMonth) && transaction.amount < 0 && !transaction.linked_bill_id
    );
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
      categoryPlan,
      paycheckPlan,
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
  }, [baseline, today, settings.safety_floor, getMonthlyIncome, getCashFlow, getMonthlyBills, getBillMonthlyTotal, getPaidAmount, transactions, upcoming, decisions, forecastConfidence.level, categoryPlan, paycheckPlan, decisionHistory, decisionRiskAlerts]);

  const quickPrompts = useMemo(() => {
    const categoryPrompts = buildFloCategoryQuickPrompts(categoryPlan);
    return [
      ...(decisionHistory.due.length ? ["What decisions need review?"] : []),
      ...(decisionRiskAlerts.length ? ["Are any planned decisions no longer safe?"] : []),
      ...(decisionHistory.upcoming.length ? ["What planned decisions are coming up?"] : []),
      "What can I spend until payday?",
      ...categoryPrompts,
      "Can I afford $500?",
      "What bills are due next?",
      "Why does my balance run low?",
    ].slice(0, 8);
  }, [categoryPlan, decisionHistory, decisionRiskAlerts]);

  const send = async (text = input) => {
    const clean = text.trim();
    if (!clean || chat.sending) return;
    setInput("");
    dispatch({ type: "submit", id: `u-${Date.now()}`, text: clean });
    let reply = FLO_CONNECTION_ERROR_MESSAGE;
    try {
      reply = await askFlo(clean, facts, summary, baseline);
    } catch {
      reply = FLO_CONNECTION_ERROR_MESSAGE;
    }
    const replyId = `f-${Date.now()}`;
    dispatch({ type: "reply", id: replyId, text: reply });
    const cards = floResponseCards(clean, facts, baseline);
    if (cards.length) setCardsByMessageId(previous => ({ ...previous, [replyId]: cards }));
    const scenario = buildFloDecisionScenario(clean, today);
    if (scenario) {
      const result = evaluateDecision(baseline, scenario, settings.safety_floor);
      setDecisionByMessageId(previous => ({ ...previous, [replyId]: { scenario, result } }));
      if (isFloPlanCreateCommand(clean)) {
        setDecisionSaveState(previous => ({ ...previous, [replyId]: "saving" }));
        try {
          await saveDecision(scenario, result, "planned");
          setDecisionSaveState(previous => ({ ...previous, [replyId]: "saved" }));
        } catch {
          setDecisionSaveState(previous => ({ ...previous, [replyId]: "failed" }));
        }
      }
    }
    const categoryMove = evaluateFloCategoryMove(clean, facts);
    if (categoryMove?.allowed) {
      setCategoryMoveByMessageId(previous => ({ ...previous, [replyId]: categoryMove }));
      setCategoryMoveState(previous => ({ ...previous, [replyId]: "idle" }));
    }
    if (user) {
      const nextSummary = `Recent topic: ${sanitizeFloSummary(clean).slice(0, 120)}`;
      setSummary(nextSummary);
      void updateFloMemory(user.id, clean);
    }
  };

  const addDecisionToCalendar = async (messageId: string) => {
    const decision = decisionByMessageId[messageId];
    if (!decision || decisionSaveState[messageId] === "saving" || decisionSaveState[messageId] === "saved") return;
    setDecisionSaveState(previous => ({ ...previous, [messageId]: "saving" }));
    try {
      await saveDecision(decision.scenario, decision.result, "planned");
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
        rollover: row.rollover ?? 0,
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

  const composerBottom = Platform.OS === "web" ? 88 : Math.max(insets.bottom, 8) + 54;

  return (
    <KeyboardAvoidingView
      style={[styles.screen, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <LinearGradient
        colors={["#172554", "#083344"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={[styles.header, { paddingTop: Platform.OS === "web" ? 18 : insets.top + 12, borderColor: colors.border }]}
      >
        <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
          <Text style={styles.avatarText}>F</Text>
        </View>
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: colors.foreground }]}>Ask Flo</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>Your FlowLedger assistant</Text>
        </View>
        <Feather name="message-circle" size={24} color={colors.primaryForeground} />
      </LinearGradient>

      <ScrollView
        ref={scrollRef}
        style={styles.conversation}
        contentContainerStyle={styles.conversationContent}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
      >
        <View style={[styles.historyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.historyHeader}>
            <View style={[styles.historyIcon, { backgroundColor: colors.primary + "18" }]}>
              <Feather name="clock" size={17} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.historyTitle, { color: colors.foreground }]}>Decision History</Text>
              <Text style={[styles.historySub, { color: colors.mutedForeground }]}>Planned decisions, follow-through, and actuals.</Text>
            </View>
          </View>
          <View style={styles.historyStats}>
            <HistoryStat label="Review" value={decisionHistory.due.length} color={colors.warning} />
            <HistoryStat label="Risky" value={decisionRiskAlerts.length} color={colors.destructive} />
            <HistoryStat label="Upcoming" value={decisionHistory.upcoming.length} color={colors.primary} />
            <HistoryStat label="Completed" value={decisionHistory.completed.length} color={colors.success} />
          </View>
          {decisionRiskAlerts.length + decisionHistory.due.length + decisionHistory.upcoming.length + decisionHistory.completed.length + decisionHistory.changed.length === 0 ? (
            <Text style={[styles.historyEmpty, { color: colors.mutedForeground }]}>Ask Flo if you can afford something, then save it to start tracking decisions here.</Text>
          ) : (
            <View style={styles.historySections}>
              <DecisionHistorySection title="No longer safe" items={riskyDecisionItems.slice(0, 4)} colors={colors} actionState={historyActionState} onComplete={openCompletePlan} onPostpone={openPostponePlan} onCancel={(id) => void cancelPlan(id)} />
              <DecisionHistorySection title="Needs review" items={decisionHistory.due.slice(0, 4)} colors={colors} actionState={historyActionState} onComplete={openCompletePlan} onPostpone={openPostponePlan} onCancel={(id) => void cancelPlan(id)} />
              <DecisionHistorySection title="Upcoming planned" items={decisionHistory.upcoming.slice(0, 4)} colors={colors} actionState={historyActionState} onComplete={openCompletePlan} onPostpone={openPostponePlan} onCancel={(id) => void cancelPlan(id)} />
              <DecisionHistorySection title="Completed" items={decisionHistory.completed.slice(0, 3)} colors={colors} />
              <DecisionHistorySection title="Postponed / Cancelled" items={decisionHistory.changed.slice(0, 3)} colors={colors} />
            </View>
          )}
        </View>

        <View style={[styles.bubble, styles.floBubble, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.bubbleText, { color: colors.foreground }]}>Hi, my name&apos;s Flo! Ask me something.</Text>
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
            <Text style={[styles.bubbleText, { color: message.role === "user" ? colors.primaryForeground : colors.foreground }]}>
              {message.text}
            </Text>
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
          </View>
        ))}

        {chat.sending && (
          <View style={[styles.bubble, styles.floBubble, styles.loadingBubble, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={{ color: colors.mutedForeground }}>Flo is thinking…</Text>
          </View>
        )}
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

      <View style={[styles.composerArea, { backgroundColor: colors.background, borderColor: colors.border, paddingBottom: composerBottom }]}>
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
            accessibilityLabel="Send message"
            onPress={() => void send()}
            disabled={!input.trim() || chat.sending}
            style={[
              styles.send,
              { backgroundColor: colors.primary, opacity: !input.trim() || chat.sending ? 0.45 : 1 },
            ]}
          >
            <Text style={styles.sendText}>Send</Text>
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function formatDisplayDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function HistoryStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={styles.historyStat}>
      <Text style={[styles.historyStatValue, { color }]}>{value}</Text>
      <Text style={styles.historyStatLabel}>{label}</Text>
    </View>
  );
}

function DecisionHistorySection({
  title,
  items,
  colors,
  actionState = {},
  onComplete,
  onPostpone,
  onCancel,
}: {
  title: string;
  items: DecisionHistoryItem[];
  colors: ReturnType<typeof useColors>;
  actionState?: Record<string, "saving" | "failed">;
  onComplete?: (id: string) => void;
  onPostpone?: (id: string) => void;
  onCancel?: (id: string) => void;
}) {
  if (!items.length) return null;
  return (
    <View style={styles.historySection}>
      <Text style={[styles.historySectionTitle, { color: colors.mutedForeground }]}>{title}</Text>
      {items.map(item => {
        const canFollowUp = (item.status === "due" || item.status === "upcoming" || item.status === "saved") && onComplete && onPostpone && onCancel;
        const busy = actionState[item.id] === "saving";
        return (
          <View key={item.id} style={[styles.historyRow, { borderColor: colors.border }]}>
            <View style={[styles.historyStatusDot, { backgroundColor: statusColor(item.status, colors) }]} />
            <View style={styles.historyRowBody}>
              <View style={styles.historyRowTop}>
                <Text numberOfLines={1} style={[styles.historyRowName, { color: colors.foreground }]}>{item.name}</Text>
                <Text style={[styles.historyDate, { color: colors.mutedForeground }]}>{formatDisplayDate(item.date)}</Text>
              </View>
              <Text style={[styles.historyAmount, { color: colors.mutedForeground }]}>{item.amountLabel}</Text>
              {item.varianceLabel ? (
                <Text style={[styles.historyVariance, { color: item.varianceLabel.startsWith("+") ? colors.warning : colors.success }]}>
                  {item.varianceLabel}
                </Text>
              ) : null}
              {canFollowUp ? (
                <View style={styles.historyActions}>
                  <Pressable disabled={busy} onPress={() => onComplete(item.id)} style={[styles.historyActionButton, { backgroundColor: colors.success + "18", opacity: busy ? 0.55 : 1 }]}>
                    <Text style={[styles.historyActionText, { color: colors.success }]}>Complete</Text>
                  </Pressable>
                  <Pressable disabled={busy} onPress={() => onPostpone(item.id)} style={[styles.historyActionButton, { backgroundColor: colors.primary + "18", opacity: busy ? 0.55 : 1 }]}>
                    <Text style={[styles.historyActionText, { color: colors.primary }]}>Postpone</Text>
                  </Pressable>
                  <Pressable disabled={busy} onPress={() => onCancel(item.id)} style={[styles.historyActionButton, { backgroundColor: colors.destructive + "14", opacity: busy ? 0.55 : 1 }]}>
                    <Text style={[styles.historyActionText, { color: colors.destructive }]}>{busy ? "Saving" : "Cancel"}</Text>
                  </Pressable>
                </View>
              ) : null}
              {actionState[item.id] === "failed" ? (
                <Text style={[styles.saveDecisionError, { color: colors.destructive, textAlign: "left" }]}>Couldn&apos;t update this decision. Try again.</Text>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

function statusColor(status: DecisionHistoryItem["status"], colors: ReturnType<typeof useColors>) {
  if (status === "completed") return colors.success;
  if (status === "cancelled") return colors.destructive;
  if (status === "postponed") return colors.warning;
  if (status === "due") return colors.warning;
  return colors.primary;
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
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#fff", fontSize: 23, fontFamily: "Inter_700Bold" },
  headerText: { flex: 1 },
  title: { fontSize: 25, fontFamily: "Inter_700Bold" },
  subtitle: { fontSize: 12, marginTop: 1 },
  conversation: { flex: 1 },
  conversationContent: { padding: 16, paddingBottom: 22, gap: 12 },
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
  bubble: { maxWidth: "88%", paddingHorizontal: 15, paddingVertical: 13, borderRadius: 18 },
  floBubble: { alignSelf: "flex-start", borderWidth: 1, borderTopLeftRadius: 6 },
  userBubble: { alignSelf: "flex-end", borderTopRightRadius: 6 },
  bubbleText: { fontSize: 15, lineHeight: 21 },
  cardGrid: { marginTop: 10, gap: 8 },
  insightCard: { borderWidth: 1, borderRadius: 12, padding: 10 },
  insightTitle: { fontSize: 10, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.5 },
  insightValue: { fontSize: 18, fontFamily: "Inter_700Bold", marginTop: 3 },
  insightDetail: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2, lineHeight: 15 },
  decisionActions: { gap: 6, marginTop: 2 },
  saveDecisionButton: { minHeight: 42, borderRadius: 14, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8, paddingHorizontal: 12 },
  saveDecisionText: { color: "#fff", fontSize: 13, fontFamily: "Inter_700Bold" },
  saveDecisionHint: { fontSize: 11, lineHeight: 15, textAlign: "center" },
  saveDecisionError: { fontSize: 11, fontFamily: "Inter_600SemiBold", textAlign: "center" },
  loadingBubble: { flexDirection: "row", alignItems: "center", gap: 9 },
  composerArea: { borderTopWidth: 1, paddingHorizontal: 12, paddingTop: 10 },
  quickPromptScroller: { marginBottom: 8, maxHeight: 38 },
  quickPromptContent: { gap: 8, paddingRight: 12 },
  quickPromptChip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  quickPromptText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  composer: {
    minHeight: 58,
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
