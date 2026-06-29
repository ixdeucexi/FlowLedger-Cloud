import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
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
import { useBudget } from "@/context/BudgetContext";
import { useColors } from "@/hooks/useColors";
import { askFlo, loadFloMemory, updateFloMemory, type FloFacts } from "@/lib/flo";
import {
  FLO_CONNECTION_ERROR_MESSAGE,
  buildFloDecisionScenario,
  floResponseCards,
  reduceFloChat,
  sanitizeFloSummary,
  type FloResponseCard,
  type FloChatState,
} from "@/lib/floPolicy";
import { summarizeMonthlyBills } from "@/lib/monthlySummary";
import { evaluateDecision, type DecisionResult, type DecisionScenario } from "@/lib/decisions";
import { buildDecisionHistory, type DecisionHistoryItem } from "@/lib/decisionHistory";
import { buildCategoryPlan } from "@/lib/categoryPlanning";

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
  const { bills, transactions, decisions, settings, forecastConfidence, getDailyBalances, getMonthlyIncome, getCashFlow, getMonthlyBills, getBillMonthlyTotal, getPaidAmount, saveDecision, getTransactionsForMonth, categories } = useBudget();
  const [chat, dispatch] = useReducer(reduceFloChat, initialChat);
  const [cardsByMessageId, setCardsByMessageId] = useState<Record<string, FloResponseCard[]>>({});
  const [decisionByMessageId, setDecisionByMessageId] = useState<Record<string, { scenario: DecisionScenario; result: DecisionResult }>>({});
  const [decisionSaveState, setDecisionSaveState] = useState<Record<string, "saving" | "saved" | "failed">>({});
  const [input, setInput] = useState("");
  const [summary, setSummary] = useState("");
  const [sampleIndex, setSampleIndex] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const now = new Date();
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

  const categoryPlan = useMemo(() => {
    const month = now.getMonth();
    const year = now.getFullYear();
    const budgetKey = `flowledger-category-budgets-${year}-${String(month + 1).padStart(2, "0")}`;
    let categoryBudgets: Record<string, number> = {};
    if (Platform.OS === "web") {
      try {
        const raw = globalThis.localStorage?.getItem(budgetKey);
        const parsed = raw ? JSON.parse(raw) as Record<string, unknown> : {};
        Object.entries(parsed).forEach(([category, amount]) => {
          const value = Number(amount);
          if (category && Number.isFinite(value) && value >= 0) categoryBudgets[category] = value;
        });
      } catch {
        categoryBudgets = {};
      }
    }
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
        status: row.status,
        percentUsed: row.percentUsed,
        topTransaction: topTransaction ? {
          name: topTransaction.note?.trim() || row.category,
          amount: topTransaction.amount,
          date: topTransaction.date,
        } : undefined,
      };
    });
  }, [categories, getMonthlyBills, getBillMonthlyTotal, getTransactionsForMonth, now]);

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
    };
  }, [baseline, today, settings.safety_floor, getMonthlyIncome, getCashFlow, getMonthlyBills, getBillMonthlyTotal, getPaidAmount, transactions, upcoming, decisions, forecastConfidence.level, categoryPlan]);

  const decisionHistory = useMemo(
    () => buildDecisionHistory(decisions.filter(decision => decisionStillHasSource(decision, transactions)), today, now.toISOString()),
    [decisions, transactions, today],
  );

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
            <HistoryStat label="Upcoming" value={decisionHistory.upcoming.length} color={colors.primary} />
            <HistoryStat label="Completed" value={decisionHistory.completed.length} color={colors.success} />
            <HistoryStat label="Changed" value={decisionHistory.changed.length} color={colors.warning} />
          </View>
          {decisionHistory.upcoming.length + decisionHistory.completed.length + decisionHistory.changed.length === 0 ? (
            <Text style={[styles.historyEmpty, { color: colors.mutedForeground }]}>Ask Flo if you can afford something, then save it to start tracking decisions here.</Text>
          ) : (
            <View style={styles.historySections}>
              <DecisionHistorySection title="Upcoming planned" items={decisionHistory.upcoming.slice(0, 4)} colors={colors} />
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
          </View>
        ))}

        {chat.sending && (
          <View style={[styles.bubble, styles.floBubble, styles.loadingBubble, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={{ color: colors.mutedForeground }}>Flo is thinking…</Text>
          </View>
        )}
      </ScrollView>

      <View style={[styles.composerArea, { backgroundColor: colors.background, borderColor: colors.border, paddingBottom: composerBottom }]}>
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

function DecisionHistorySection({ title, items, colors }: { title: string; items: DecisionHistoryItem[]; colors: ReturnType<typeof useColors> }) {
  if (!items.length) return null;
  return (
    <View style={styles.historySection}>
      <Text style={[styles.historySectionTitle, { color: colors.mutedForeground }]}>{title}</Text>
      {items.map(item => (
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
          </View>
        </View>
      ))}
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
