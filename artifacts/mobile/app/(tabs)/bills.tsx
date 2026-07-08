import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AddBillModal } from "@/components/AddBillModal";
import { CommandPlusButton } from "@/components/CommandPlusButton";
import { EmptyState } from "@/components/EmptyState";
import { PremiumBackdrop } from "@/components/PremiumBackdrop";
import { SnowballPreviewModal } from "@/components/SnowballPreviewModal";
import colors from "@/constants/colors";
import type { Bill } from "@/context/BudgetContext";
import { useBudget } from "@/context/BudgetContext";
import { useColors } from "@/hooks/useColors";
import type { SnowballProjectionResult } from "@/lib/snowball";
import { sortDebtsLeastToGreatest } from "@/lib/debtOrder";
import { buildPaycheckPlan, makeDateKey } from "@/lib/paycheckPlanning";
import { DECISION_HUB_SETTINGS_EVENT, readDecisionHubSettings, type DecisionHubSettings } from "@/lib/decisionHubSettings";
import { isAlgorithmEnabled } from "@/lib/algorithmCatalog";

const CAT_COLORS: Record<string, string> = {
  Housing: "#0f9b8e", Utilities: "#f0b429", Insurance: "#6366f1",
  Transportation: "#ec4899", Food: "#f97316", Entertainment: "#8b5cf6",
  Health: "#ef4444", Education: "#3b82f6", Savings: "#22c55e", Debt: "#e11d48", Other: "#94a3b8",
};

type Tab    = "bills" | "debt";
type Filter = "all" | "recurring" | "one-time";
type SortMode = "priority" | "balance" | "interest";
const MONTH_FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export default function BillsScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const {
    bills, addBill, updateBill, deleteBill, deleteBillMistake,
    dashboardFilter, setDashboardFilter,
    settings, updateSettings,
    previewDebtSnowball, applyDebtSnowballPayment, removeDebtSnowballPayment, getExtraPayment,
    getMonthlyBills, getBillOccurrencesInMonth, getBillMonthlyTotal, getPaidAmount,
    getDailyBalances, getIncomeOccurrencesInMonth,
  } = useBudget();

  const [activeTab, setActiveTab]       = useState<Tab>("bills");
  const [modalVisible, setModalVisible] = useState(false);
  const [editBill, setEditBill]         = useState<Bill | null>(null);
  const [filter, setFilter]             = useState<Filter>("all");
  const [sortMode, setSortMode]         = useState<SortMode>("balance");
  const [snowballApplied, setSnowballApplied] = useState(false);
  const [snowballModalVisible, setSnowballModalVisible] = useState(false);
  const [snowballAmount, setSnowballAmount] = useState("");
  const [snowballPreview, setSnowballPreview] = useState<SnowballProjectionResult | null>(null);
  const [decisionHubSettings, setDecisionHubSettings] = useState<DecisionHubSettings>(() => readDecisionHubSettings());
  const [dismissedBillPromptKey, setDismissedBillPromptKey] = useState<string | null>(null);

  useEffect(() => {
    if (dashboardFilter === "debt") {
      setActiveTab("debt");
      setDashboardFilter(null);
    }
  }, [dashboardFilter]);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const refresh = () => setDecisionHubSettings(readDecisionHubSettings());
    globalThis.addEventListener?.(DECISION_HUB_SETTINGS_EVENT, refresh);
    return () => globalThis.removeEventListener?.(DECISION_HUB_SETTINGS_EVENT, refresh);
  }, []);

  const webTopPad = Platform.OS === "web" ? 4 : 0;

  // ── Bills data ──────────────────────────────────────────────────
  const now          = new Date();
  const currentMonth = now.getMonth();
  const currentYear  = now.getFullYear();
  const currentDay   = now.getDate();
  const billOccurrenceDays = useCallback(
    (bill: Bill) => getBillOccurrencesInMonth(bill, currentMonth, currentYear),
    [currentMonth, currentYear, getBillOccurrencesInMonth],
  );
  const firstOccurrenceDay = useCallback(
    (bill: Bill) => billOccurrenceDays(bill)[0] ?? bill.due_day,
    [billOccurrenceDays],
  );
  const visibleBills = bills.filter(b => billOccurrenceDays(b).length > 0);
  const nonDebtBills = visibleBills.filter(b => !b.is_debt);
  const filteredBills = nonDebtBills
    .filter(b => {
      if (filter === "recurring") return b.is_recurring;
      if (filter === "one-time")  return !b.is_recurring;
      return true;
    })
    .sort((a, b) => firstOccurrenceDay(a) - firstOccurrenceDay(b) || a.name.localeCompare(b.name));

  const totalAmount = nonDebtBills
    .filter(b => b.is_recurring)
    .reduce((s, b) => s + getBillMonthlyTotal(b, currentMonth, currentYear), 0);
  const totalCount  = nonDebtBills.length;
  const formatBillDueText = useCallback((bill: Bill) => {
    const days = billOccurrenceDays(bill);
    if (!days.length) return "No date this month";
    if (days.length === 1) return `Due ${MONTH_FULL[currentMonth]} ${days[0]}, ${currentYear}`;
    return `${days.length} payments in ${MONTH_FULL[currentMonth]}`;
  }, [billOccurrenceDays, currentMonth, currentYear]);
  const frequencyText = useCallback((bill: Bill) => {
    if (!bill.is_recurring) return "one-time";
    if (bill.frequency === "weekly") return "/week";
    if (bill.frequency === "biweekly") return "biweekly";
    return "/month";
  }, []);

  // ── Debt data ───────────────────────────────────────────────────
  const baseSnowballPreview = useMemo(
    () => previewDebtSnowball(currentMonth, currentYear),
    [previewDebtSnowball, currentMonth, currentYear, bills],
  );
  const safeSnowballAmount = baseSnowballPreview.safeMaximum;
  const existingSnowball = getExtraPayment(currentMonth, currentYear);

  const debts = (() => {
    const debtBills = visibleBills.filter(b => b.is_debt);
    if (sortMode === "balance") return sortDebtsLeastToGreatest(debtBills);
    return debtBills.slice().sort((a, b) => {
      if (sortMode === "priority") return a.priority - b.priority;
      return b.interest_rate - a.interest_rate;
    });
  })();

  const totalDebt        = debts.reduce((s, b) => s + b.balance, 0);
  const totalMinPayments = debts
    .filter(debt => debt.balance > 0.009)
    .reduce((sum, debt) => sum + debt.amount + Number(debt.snowball_minimum_boost ?? 0), 0);
  const highestAPR       = debts.length ? Math.max(...debts.map(b => b.interest_rate)) : 0;
  const activeDebts = debts.filter(debt => debt.balance > 0.009);
  const snowballTarget = sortDebtsLeastToGreatest(activeDebts)[0] ?? null;
  const avalancheTarget = activeDebts.slice().sort((a, b) => b.interest_rate - a.interest_rate || a.balance - b.balance || a.name.localeCompare(b.name))[0] ?? null;
  const cashFlowTarget = activeDebts.slice().sort((a, b) => {
    const aMin = Math.max(0.01, a.amount + Number(a.snowball_minimum_boost ?? 0));
    const bMin = Math.max(0.01, b.amount + Number(b.snowball_minimum_boost ?? 0));
    return (a.balance / aMin) - (b.balance / bMin) || bMin - aMin || a.balance - b.balance || a.name.localeCompare(b.name);
  })[0] ?? null;
  const activeDebtTarget = settings.paymentMethod === "avalanche" ? avalancheTarget ?? snowballTarget : snowballTarget;
  const activeDebtMinimum = activeDebtTarget ? activeDebtTarget.amount + Number(activeDebtTarget.snowball_minimum_boost ?? 0) : 0;
  const activeDebtMonths = activeDebtTarget && activeDebtMinimum > 0 ? Math.ceil(activeDebtTarget.balance / activeDebtMinimum) : 0;
  const snowballOrder = sortDebtsLeastToGreatest(activeDebts);
  const nextSnowballTarget = activeDebtTarget
    ? snowballOrder.find(debt => debt.id !== activeDebtTarget.id) ?? null
    : null;
  const nextTargetRolledMinimum = nextSnowballTarget && activeDebtTarget
    ? nextSnowballTarget.amount + Number(nextSnowballTarget.snowball_minimum_boost ?? 0) + activeDebtMinimum
    : 0;
  const debtRoomExplanation = safeSnowballAmount > 0
    ? `FlowLedger says you can add this much to debt and still keep your ${settings.forecast_horizon_months}-month forecast above your $${settings.safety_floor.toFixed(0)} cushion.`
    : `Keep extra cash available for now. Your ${settings.forecast_horizon_months}-month forecast needs to stay above your $${settings.safety_floor.toFixed(0)} cushion first.`;
  const debtAlgoCopy = activeDebtTarget
    ? safeSnowballAmount > 0
      ? `Next best move: put today's extra payoff money toward ${activeDebtTarget.name}.`
      : `Hold extra payments until your Safe Cushion opens up, then target ${activeDebtTarget.name}.`
    : "Add debts to unlock payoff guidance.";

  const priorityColors = ["#22c55e", "#f0b429", "#ef4444", "#8b5cf6", "#ec4899"];
  const todayIso = `${currentYear}-${String(currentMonth + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const paycheckPlan = useMemo(() => {
    const horizon = Math.max(2, Math.min(settings.forecast_horizon_months, 6));
    const incomeEvents: { id?: string; name: string; amount: number; date: string }[] = [];
    const billEvents: { id?: string; name: string; amount: number; dueDate: string }[] = [];
    const balanceEvents: { date: string; balance: number }[] = [];
    for (let i = 0; i < horizon; i += 1) {
      const absoluteMonth = currentMonth + i;
      const month = absoluteMonth % 12;
      const year = currentYear + Math.floor(absoluteMonth / 12);
      getIncomeOccurrencesInMonth(month, year).forEach(({ income, days, effectiveAmount }) => {
        days.forEach(day => incomeEvents.push({ id: income.id, name: income.name, amount: effectiveAmount, date: makeDateKey(year, month, day) }));
      });
      getMonthlyBills(month, year).forEach(bill => {
        const occurrences = getBillOccurrencesInMonth(bill, month, year);
        if (!occurrences.length) return;
        const perOccurrence = getBillMonthlyTotal(bill, month, year) / occurrences.length;
        let paidRemaining = getPaidAmount(bill.id, month, year);
        occurrences.forEach(day => {
          const appliedPaid = Math.min(perOccurrence, Math.max(0, paidRemaining));
          paidRemaining = Math.max(0, paidRemaining - perOccurrence);
          const remaining = Math.max(0, perOccurrence - appliedPaid);
          if (remaining > 0.005) billEvents.push({ id: bill.id, name: bill.name, amount: remaining, dueDate: makeDateKey(year, month, day) });
        });
      });
      getDailyBalances(month, year).forEach(day => balanceEvents.push({ date: makeDateKey(year, month, day.day), balance: day.balance }));
    }
    return buildPaycheckPlan(incomeEvents, billEvents, balanceEvents, settings.safety_floor, todayIso);
  }, [currentMonth, currentYear, getBillMonthlyTotal, getBillOccurrencesInMonth, getDailyBalances, getIncomeOccurrencesInMonth, getMonthlyBills, getPaidAmount, settings.forecast_horizon_months, settings.safety_floor, todayIso]);
  const billOptimizationPrompt = useMemo(() => {
    if ((!isAlgorithmEnabled(decisionHubSettings, "billPriority") && !isAlgorithmEnabled(decisionHubSettings, "paydaySplit")) || !paycheckPlan.nextPaycheck || !paycheckPlan.billsDue.length) return null;
    const bill = [...paycheckPlan.billsDue].sort((left, right) => right.amount - left.amount)[0];
    const saferDate = new Date(`${paycheckPlan.nextPaycheck.date}T12:00:00`);
    saferDate.setDate(saferDate.getDate() + 1);
    const key = `${bill.id ?? bill.name}-${bill.dueDate}-${paycheckPlan.nextPaycheck.date}`;
    if (dismissedBillPromptKey === key) return null;
    return { bill, saferDate, key };
  }, [decisionHubSettings, dismissedBillPromptKey, paycheckPlan]);
  const billPrioritySummary = useMemo(() => {
    if (!isAlgorithmEnabled(decisionHubSettings, "billPriority")) return null;
    const unpaid = nonDebtBills
      .map(bill => {
        const monthlyTotal = getBillMonthlyTotal(bill, currentMonth, currentYear);
        const remaining = Math.max(0, monthlyTotal - getPaidAmount(bill.id, currentMonth, currentYear));
        const daysUntilDue = firstOccurrenceDay(bill) - currentDay;
        const urgency = daysUntilDue <= 0 ? 40 : daysUntilDue <= 3 ? 30 : daysUntilDue <= 7 ? 18 : 6;
        const score = urgency + Math.min(25, remaining / 40);
        return { bill, remaining, daysUntilDue, score };
      })
      .filter(item => item.remaining > 0.005)
      .sort((left, right) => right.score - left.score || left.bill.due_day - right.bill.due_day);
    const target = unpaid[0];
    if (!target) return null;
    const dueText = target.daysUntilDue <= 0
      ? "due now"
      : target.daysUntilDue === 1
        ? "due tomorrow"
        : `due in ${target.daysUntilDue} days`;
    return {
      bill: target.bill,
      amount: target.remaining,
      dueText,
      count: unpaid.length,
    };
  }, [currentDay, currentMonth, currentYear, decisionHubSettings, firstOccurrenceDay, getBillMonthlyTotal, getPaidAmount, nonDebtBills]);

  // ── Handlers ────────────────────────────────────────────────────
  const handleSave = useCallback((data: Omit<Bill, "id" | "created_at"> | Bill) => {
    if ("id" in data) return updateBill(data as Bill);
    return addBill(data);
  }, [addBill, updateBill]);

  const handleApplySnowball = () => {
    if (safeSnowballAmount <= 0) {
      Alert.alert("Safety Floor Protected", `There is no extra amount available without moving the ${settings.forecast_horizon_months}-month forecast below $${settings.safety_floor.toFixed(0)}.`);
      return;
    }
    const starting = existingSnowball?.amount ?? safeSnowballAmount;
    setSnowballAmount(starting.toFixed(2));
    setSnowballPreview(previewDebtSnowball(currentMonth, currentYear, starting));
    setSnowballModalVisible(true);
  };

  const handleSnowballAmountChange = (value: string) => {
    setSnowballAmount(value);
    const amount = Number.parseFloat(value);
    setSnowballPreview(previewDebtSnowball(currentMonth, currentYear, Number.isFinite(amount) ? amount : 0));
  };

  const handleConfirmSnowball = async () => {
    if (!snowballPreview) return;
    await applyDebtSnowballPayment(snowballPreview);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setSnowballApplied(true);
    setSnowballModalVisible(false);
    Alert.alert("Payment Recorded", `$${snowballPreview.selectedExtra.toFixed(2)} was applied to your snowball.`);
  };

  const handleRemoveSnowball = async () => {
    await removeDebtSnowballPayment(currentMonth, currentYear);
    setSnowballModalVisible(false);
    setSnowballApplied(false);
  };

  // ── Subtitle ─────────────────────────────────────────────────────
  const subtitle = activeTab === "bills"
    ? `${totalCount} bill${totalCount !== 1 ? "s" : ""} · $${totalAmount.toFixed(0)}/mo recurring`
    : `${debts.length} debt${debts.length !== 1 ? "s" : ""} · $${totalDebt.toLocaleString(undefined, { maximumFractionDigits: 0 })} total`;
  const listBottomPadding = insets.bottom + (Platform.OS === "web" ? 128 : 118);

  return (
    <View style={[styles.screen, { backgroundColor: c.background }]}>
      <PremiumBackdrop variant={activeTab === "debt" ? "purple" : "blue"} />
      <ScrollView
        showsVerticalScrollIndicator
        contentContainerStyle={{ paddingBottom: listBottomPadding }}
        scrollIndicatorInsets={{ bottom: listBottomPadding }}
      >
      {/* ── Header ── */}
      <View style={[styles.header, { paddingTop: insets.top + 12 + webTopPad }]}>
        <View>
          <Text style={[styles.title, { color: c.foreground }]}>Bills</Text>
          <Text style={[styles.subtitle, { color: c.mutedForeground }]}>{subtitle}</Text>
        </View>
        <CommandPlusButton
          onPress={() => { setEditBill(null); setModalVisible(true); }}
          accessibilityLabel={activeTab === "debt" ? "Add debt" : "Add bill"}
        />
      </View>

      {/* ── Bills / Debt segment toggle ── */}
      {activeTab === "bills" && billOptimizationPrompt ? (
        <Pressable
          onPress={() => router.push({ pathname: "/(tabs)/flo", params: { prompt: `Move ${billOptimizationPrompt.bill.name} to after payday` } } as any)}
          style={({ pressed }) => [
            styles.billPromptCard,
            { backgroundColor: c.warning + "12", borderColor: c.warning + "70", opacity: pressed ? 0.82 : 1 },
          ]}
        >
          <Feather name="zap" size={17} color={c.warning} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.billPromptTitle, { color: c.foreground }]}>{billOptimizationPrompt.bill.name} hits before payday</Text>
            <Text style={[styles.billPromptText, { color: c.mutedForeground }]}>
              Safer after {billOptimizationPrompt.saferDate.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}. Tap to ask Flo.
            </Text>
            <View style={styles.billPromptActions}>
              <Pressable
                onPress={() => router.push({ pathname: "/(tabs)/flo", params: { prompt: `Move ${billOptimizationPrompt.bill.name} to after payday` } } as any)}
                style={({ pressed }) => [styles.billPromptAction, { backgroundColor: c.primary + "18", opacity: pressed ? 0.75 : 1 }]}
              >
                <Text style={[styles.billPromptActionText, { color: c.primary }]}>Preview move</Text>
              </Pressable>
              <Pressable
                onPress={() => setDismissedBillPromptKey(billOptimizationPrompt.key)}
                style={({ pressed }) => [styles.billPromptAction, { backgroundColor: c.muted, opacity: pressed ? 0.75 : 1 }]}
              >
                <Text style={[styles.billPromptActionText, { color: c.mutedForeground }]}>Keep as-is</Text>
              </Pressable>
            </View>
          </View>
          <Feather name="chevron-right" size={16} color={c.mutedForeground} />
        </Pressable>
      ) : null}

      <View style={[styles.segmentWrap, { paddingHorizontal: 16, marginBottom: 12 }]}>
        <View style={[styles.segment, { backgroundColor: c.muted }]}>
          {(["bills", "debt"] as Tab[]).map(t => (
            <Pressable
              key={t}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setActiveTab(t); }}
              style={[styles.segmentBtn, { backgroundColor: activeTab === t ? c.primary : "transparent" }]}
            >
              <Feather
                name={t === "bills" ? "file-text" : "credit-card"}
                size={13}
                color={activeTab === t ? c.primaryForeground : c.mutedForeground}
              />
              <Text style={[styles.segmentText, { color: activeTab === t ? c.primaryForeground : c.mutedForeground }]}>
                {t === "bills" ? "Bills" : "Debt"}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {/* ════════════════════ BILLS VIEW ════════════════════ */}
      {activeTab === "bills" && (
        <>
          {billPrioritySummary ? (
            <Pressable
              onPress={() => router.push({ pathname: "/(tabs)/flo", params: { prompt: "Which bill should I pay first?" } } as any)}
              style={({ pressed }) => [
                styles.billPromptCard,
                { backgroundColor: c.card, borderColor: c.primary + "45", opacity: pressed ? 0.84 : 1 },
              ]}
            >
              <Feather name="file-text" size={17} color={c.primary} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.billPromptTitle, { color: c.foreground }]}>Bill Priority: {billPrioritySummary.bill.name}</Text>
                <Text style={[styles.billPromptText, { color: c.mutedForeground }]}>
                  ${billPrioritySummary.amount.toFixed(0)} left · {billPrioritySummary.dueText}. Tap to ask Flo why.
                </Text>
              </View>
              <Feather name="chevron-right" size={16} color={c.mutedForeground} />
            </Pressable>
          ) : null}

          <View style={styles.filterRow}>
            {(["all", "recurring", "one-time"] as Filter[]).map(f => (
              <Pressable
                key={f}
                onPress={() => setFilter(f)}
                style={[styles.filterChip, { backgroundColor: filter === f ? c.primary : c.card, borderRadius: colors.radius }]}
              >
                <Text style={[styles.filterText, { color: filter === f ? c.primaryForeground : c.mutedForeground }]}>
                  {f === "all" ? "All" : f === "recurring" ? "Recurring" : "One-Time"}
                </Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.list}>
            {filteredBills.length === 0 ? (
              <EmptyState icon="file-text" title="No Bills" message="Tap + to add your first bill." actionLabel="Add Bill" onAction={() => { setEditBill(null); setModalVisible(true); }} />
            ) : filteredBills.map(item => {
              const catColor = CAT_COLORS[item.category] ?? c.primary;
              const beforePayday = paycheckPlan.billsDue.some(bill => bill.id === item.id);
              return (
                <Pressable
                  key={item.id}
                  onPress={() => { setEditBill(item); setModalVisible(true); }}
                  style={({ pressed }) => [styles.card, { backgroundColor: c.card, borderRadius: colors.radius, opacity: pressed ? 0.88 : 1 }]}
                >
                  <View style={[styles.catBar, { backgroundColor: catColor }]} />
                  <View style={styles.cardBody}>
                    <View style={styles.cardTop}>
                      <View style={styles.cardLeft}>
                        <Text style={[styles.billName, { color: c.foreground }]}>{item.name}</Text>
                        <View style={styles.metaRow}>
                          <View style={[styles.tag, { backgroundColor: catColor + "18" }]}>
                            <Text style={[styles.tagText, { color: catColor }]}>{item.category}</Text>
                          </View>
                          <Text style={[styles.metaText, { color: c.mutedForeground }]}>{formatBillDueText(item)}</Text>
                          {beforePayday ? (
                            <View style={[styles.tag, { backgroundColor: c.warning + "18" }]}>
                              <Text style={[styles.tagText, { color: c.warning }]}>Before payday</Text>
                            </View>
                          ) : null}
                          {!item.is_recurring && (
                            <View style={[styles.tag, { backgroundColor: c.muted }]}>
                              <Text style={[styles.tagText, { color: c.mutedForeground }]}>One-time</Text>
                            </View>
                          )}
                        </View>
                      </View>
                      <View style={styles.cardRight}>
                        <Text style={[styles.amount, { color: c.foreground }]}>${item.amount.toFixed(2)}</Text>
                        <Text style={[styles.amountSub, { color: c.mutedForeground }]}>{frequencyText(item)}</Text>
                      </View>
                    </View>
                  </View>
                  <View style={styles.editHint}>
                    <Feather name="edit-2" size={13} color={c.mutedForeground} />
                  </View>
                </Pressable>
              );
            })}
          </View>
        </>
      )}

      {/* ════════════════════ DEBT VIEW ════════════════════ */}
      {activeTab === "debt" && (
        <View style={styles.list}>
            <>
          {/* Safe Snowball Banner */}
          {debts.length > 0 && (
            <View style={[styles.extraBanner, { backgroundColor: safeSnowballAmount > 0 ? c.success + "15" : c.muted, marginHorizontal: 0, borderRadius: colors.radius }]}>
              <View style={styles.extraTopRow}>
                <View style={styles.extraLeft}>
                  <Feather name="shield" size={20} color={safeSnowballAmount > 0 ? c.success : c.mutedForeground} />
                  <View>
                    <Text style={[styles.extraLabel, { color: c.mutedForeground }]}>Extra You Can Send Now</Text>
                    <Text style={[styles.extraValue, { color: safeSnowballAmount > 0 ? c.success : c.mutedForeground }]}>
                      ${safeSnowballAmount.toFixed(2)}
                    </Text>
                  </View>
                </View>
                <Pressable
                  onPress={handleApplySnowball}
                  style={({ pressed }) => [
                    styles.applyBtn,
                    { backgroundColor: safeSnowballAmount > 0 ? c.primary : c.muted, opacity: pressed ? 0.8 : 1 }
                  ]}
                >
                  <Feather name="zap" size={13} color={safeSnowballAmount > 0 ? c.primaryForeground : c.mutedForeground} />
                  <Text style={[styles.applyBtnText, { color: safeSnowballAmount > 0 ? c.primaryForeground : c.mutedForeground }]}>
                    Apply to {settings.paymentMethod === "snowball" ? "Snowball" : "Avalanche"}
                  </Text>
                </Pressable>
              </View>
              <Text style={[styles.cappedNote, { color: c.mutedForeground }]}>
                {debtRoomExplanation}
              </Text>
            </View>
          )}

          {debts.length > 0 && (
            <View style={[styles.statsRow, { marginHorizontal: 0, gap: 10 }]}>
              {[
                { label: "Total Debt", value: `$${totalDebt.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, color: c.destructive, icon: "trending-down" as const },
                { label: "Min/Month",  value: `$${totalMinPayments.toFixed(0)}`,                                        color: c.warning,     icon: "calendar"     as const },
                { label: "Highest APR",value: `${highestAPR}%`,                                                         color: c.primary,     icon: "percent"      as const },
              ].map(s => (
                <View key={s.label} style={[styles.statCard, { backgroundColor: c.card, borderRadius: colors.radius }]}>
                  <Feather name={s.icon} size={14} color={s.color} />
                  <Text style={[styles.statValue, { color: s.color }]}>{s.value}</Text>
                  <Text style={[styles.statLabel, { color: c.mutedForeground }]}>{s.label}</Text>
                </View>
              ))}
            </View>
          )}

          {debts.length > 0 && (
            <View style={[styles.debtAlgoCard, { backgroundColor: c.card, borderColor: c.border, marginHorizontal: 0, borderRadius: colors.radius }]}>
              <View style={styles.debtAlgoHeader}>
                <View style={[styles.dataIcon, { backgroundColor: c.primary + "18" }]}>
                  <Feather name="trending-down" size={17} color={c.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.debtAlgoEyebrow, { color: c.primary }]}>Debt Payoff Algo</Text>
                  <Text style={[styles.debtAlgoTitle, { color: c.foreground }]}>
                    {activeDebtTarget ? `${activeDebtTarget.name} is the move` : "No active target"}
                  </Text>
                </View>
                <View style={[styles.debtAlgoBadge, { backgroundColor: safeSnowballAmount > 0 ? c.success + "18" : c.warning + "18" }]}>
                  <Text style={[styles.debtAlgoBadgeText, { color: safeSnowballAmount > 0 ? c.success : c.warning }]}>
                    {safeSnowballAmount > 0 ? "Ready" : "Hold"}
                  </Text>
                </View>
              </View>
              <Text style={[styles.debtAlgoCopy, { color: c.mutedForeground }]}>{debtAlgoCopy}</Text>
              {settings.paymentMethod === "snowball" ? (
                <View style={[styles.snowballExplain, { backgroundColor: c.primary + "12", borderColor: c.primary + "25" }]}>
                  <Feather name="info" size={13} color={c.primary} />
                  <Text style={[styles.snowballExplainText, { color: c.foreground }]}>
                    Snowball pays every minimum, sends extra money to the smallest balance first, then rolls that paid-off debt's payment into the next smallest debt.
                  </Text>
                </View>
              ) : null}
              {activeDebtTarget && (
                <Text style={[styles.debtAlgoMeta, { color: c.mutedForeground }]}>
                  ${activeDebtTarget.balance.toFixed(0)} balance · ${activeDebtMinimum.toFixed(0)}/mo min{activeDebtMonths > 0 ? ` · ~${activeDebtMonths} mo at minimum` : ""}
                </Text>
              )}
              {activeDebtTarget && nextSnowballTarget ? (
                <View style={[styles.rolloverCard, { backgroundColor: c.success + "10", borderColor: c.success + "24" }]}>
                  <Feather name="repeat" size={13} color={c.success} />
                  <Text style={[styles.rolloverText, { color: c.foreground }]}>
                    After {activeDebtTarget.name} is paid off, its ${activeDebtMinimum.toFixed(0)}/mo rolls into {nextSnowballTarget.name}. New target payment: ${nextTargetRolledMinimum.toFixed(0)}/mo.
                  </Text>
                </View>
              ) : null}
              <View style={styles.debtAlgoCompareRow}>
                {[
                  { label: "Snowball", value: snowballTarget?.name ?? "None", color: c.success },
                  { label: "Avalanche", value: avalancheTarget?.name ?? "None", color: c.primary },
                  { label: "Cash-flow", value: cashFlowTarget ? `${cashFlowTarget.name} frees $${(cashFlowTarget.amount + Number(cashFlowTarget.snowball_minimum_boost ?? 0)).toFixed(0)}/mo` : "None", color: c.warning },
                ].map(item => (
                  <View key={item.label} style={[styles.debtAlgoChip, { backgroundColor: item.color + "12", borderColor: item.color + "28" }]}>
                    <Text style={[styles.debtAlgoChipLabel, { color: item.color }]}>{item.label}</Text>
                    <Text style={[styles.debtAlgoChipValue, { color: c.foreground }]} numberOfLines={2}>{item.value}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          <View style={[styles.methodRow, { marginHorizontal: 0, marginTop: 10 }]}>
            <View style={[styles.methodToggle, { backgroundColor: c.muted, borderRadius: 10 }]}>
              {(["snowball", "avalanche"] as const).map(m => (
                <Pressable
                  key={m}
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); updateSettings({ paymentMethod: m }); }}
                  style={[styles.methodBtn, { backgroundColor: settings.paymentMethod === m ? c.primary : "transparent", borderRadius: 8 }]}
                >
                  <Feather name={m === "snowball" ? "trending-down" : "percent"} size={12} color={settings.paymentMethod === m ? c.primaryForeground : c.mutedForeground} />
                  <Text style={[styles.methodBtnText, { color: settings.paymentMethod === m ? c.primaryForeground : c.mutedForeground }]}>
                    {m === "snowball" ? "Snowball" : "Avalanche"}
                  </Text>
                </Pressable>
              ))}
            </View>

            <View style={[styles.sortToggle, { backgroundColor: c.muted, borderRadius: 10 }]}>
              {(["priority", "balance", "interest"] as SortMode[]).map(s => (
                <Pressable
                  key={s}
                  onPress={() => setSortMode(s)}
                  style={[styles.sortBtn, { backgroundColor: sortMode === s ? c.card : "transparent", borderRadius: 8 }]}
                >
                  <Text style={[styles.sortBtnText, { color: sortMode === s ? c.foreground : c.mutedForeground }]}>
                    {s === "priority" ? "#" : s === "balance" ? "$" : "%"}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
            </>
          {debts.length === 0 ? (
            <EmptyState
              icon="credit-card"
              title="No Debts Tracked"
              message="Add credit cards, loans, or any debt to track payoff progress and get snowball/avalanche recommendations."
              actionLabel="Add Debt"
              onAction={() => { setEditBill(null); setModalVisible(true); }}
            />
          ) : debts.map(item => {
              const priorityColor = priorityColors[Math.min(item.priority - 1, priorityColors.length - 1)] ?? c.primary;
              const effectiveMinimum = item.amount + Number(item.snowball_minimum_boost ?? 0);
              const originalBalance = item.balance + item.amount * 12;
              const paidPct = originalBalance > 0 ? Math.min(((originalBalance - item.balance) / originalBalance) * 100, 100) : 0;
              const monthsToPayoff = item.balance > 0 && effectiveMinimum > 0
                ? Math.ceil(item.balance / effectiveMinimum)
                : 0;

              return (
                <Pressable
                  key={item.id}
                  onPress={() => { setEditBill(item); setModalVisible(true); }}
                  style={({ pressed }) => [styles.card, { backgroundColor: c.card, borderRadius: colors.radius, opacity: pressed ? 0.88 : 1 }]}
                >
                  <View style={[styles.priorityStrip, { backgroundColor: priorityColor }]}>
                    <Text style={styles.priorityNum}>#{item.priority}</Text>
                  </View>

                  <View style={styles.cardBody}>
                    <View style={styles.cardTop}>
                      <View style={styles.cardLeft}>
                        <Text style={[styles.debtName, { color: c.foreground }]}>{item.name}</Text>
                        <View style={styles.metaRow}>
                          {item.interest_rate > 0 && (
                            <View style={[styles.aprBadge, { backgroundColor: c.destructive + "20" }]}>
                              <Text style={[styles.aprText, { color: c.destructive }]}>{item.interest_rate}% APR</Text>
                            </View>
                          )}
                          <Text style={[styles.metaText, { color: c.mutedForeground }]}>{formatBillDueText(item)}</Text>
                          {monthsToPayoff > 0 && (
                            <Text style={[styles.metaText, { color: c.mutedForeground }]}>~{monthsToPayoff} mo left</Text>
                          )}
                        </View>
                      </View>
                      <View style={styles.cardRight}>
                        <Text style={[styles.balance, { color: c.destructive }]}>${item.balance.toLocaleString(undefined, { maximumFractionDigits: 0 })}</Text>
                        <Text style={[styles.minPay, { color: c.mutedForeground }]}>${effectiveMinimum.toFixed(2)}/mo min</Text>
                        {(item.snowball_minimum_boost ?? 0) > 0 && <Text style={[styles.metaText, { color: c.success }]}>Includes ${Number(item.snowball_minimum_boost).toFixed(2)} rolled over</Text>}
                      </View>
                    </View>

                    <View style={styles.progressSection}>
                      <View style={styles.progressHeader}>
                        <Text style={[styles.progressLabel, { color: c.mutedForeground }]}>Payoff progress</Text>
                        <Text style={[styles.progressPct, { color: paidPct > 0 ? c.success : c.mutedForeground }]}>{paidPct.toFixed(0)}%</Text>
                      </View>
                      <View style={[styles.progressBg, { backgroundColor: c.muted }]}>
                        <View style={[styles.progressFill, { width: `${paidPct}%` as any, backgroundColor: priorityColor }]} />
                      </View>
                    </View>

                    {settings.paymentMethod === "snowball" && (
                      <View style={[styles.strategyNote, { backgroundColor: priorityColor + "12" }]}>
                        <Feather name="zap" size={11} color={priorityColor} />
                        <Text style={[styles.strategyText, { color: c.mutedForeground }]}>
                          {item.priority === 1
                            ? "Target first — put all extra here"
                            : `Pay off #${item.priority - 1} first, then cascade here`}
                        </Text>
                      </View>
                    )}
                    {settings.paymentMethod === "avalanche" && item.interest_rate > 0 && (
                      <View style={[styles.strategyNote, { backgroundColor: c.primary + "12" }]}>
                        <Feather name="trending-up" size={11} color={c.primary} />
                        <Text style={[styles.strategyText, { color: c.mutedForeground }]}>
                          {item.priority === 1
                            ? "Highest interest — target this first"
                            : `Lower APR than priority #${item.priority - 1}`}
                        </Text>
                      </View>
                    )}
                  </View>

                  <View style={styles.editHint}>
                    <Feather name="edit-2" size={13} color={c.mutedForeground} />
                  </View>
                </Pressable>
              );
          })}
        </View>
      )}

      </ScrollView>

      <AddBillModal
        visible={modalVisible}
        onClose={() => { setModalVisible(false); setEditBill(null); }}
        onSave={handleSave}
        onDelete={deleteBill}
        onDeleteMistake={deleteBillMistake}
        editBill={editBill}
        forceDebt={activeTab === "debt"}
      />
      <SnowballPreviewModal
        visible={snowballModalVisible}
        preview={snowballPreview}
        amount={snowballAmount}
        existingPayment={!!existingSnowball}
        safetyFloor={settings.safety_floor}
        forecastHorizonMonths={settings.forecast_horizon_months}
        onAmountChange={handleSnowballAmountChange}
        onClose={() => setSnowballModalVisible(false)}
        onConfirm={handleConfirmSnowball}
        onRemove={handleRemoveSnowball}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen:   { flex: 1 },
  header:   { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingBottom: 14 },
  title:    { fontSize: 34, fontFamily: "Inter_800ExtraBold", letterSpacing: -1.1 },
  subtitle: { fontSize: 13, fontFamily: "Inter_500Medium", marginTop: 3, letterSpacing: 0.2 },
  addBtn:   { width: 52, height: 52, borderRadius: 18, alignItems: "center", justifyContent: "center", shadowColor: "#2563eb", shadowOpacity: 0.32, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 8 },
  billPromptCard: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 22, padding: 14, marginHorizontal: 16, marginBottom: 12 },
  billPromptTitle: { fontSize: 14, fontFamily: "Inter_800ExtraBold" },
  billPromptText: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17, marginTop: 2 },
  billPromptActions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  billPromptAction: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 999 },
  billPromptActionText: { fontSize: 11, fontFamily: "Inter_800ExtraBold" },

  // Segment toggle
  segmentWrap: {},
  segment:    { flexDirection: "row", borderRadius: 18, padding: 5, gap: 5, borderWidth: 1, borderColor: "rgba(148,163,184,0.10)" },
  segmentBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 11, borderRadius: 13 },
  segmentText:{ fontSize: 14, fontFamily: "Inter_600SemiBold" },

  // Bills filters
  filterRow:  { flexDirection: "row", gap: 8, paddingHorizontal: 16, marginBottom: 12 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 8 },
  filterText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },

  // Shared list / card
  list:     { paddingHorizontal: 16, paddingTop: 6 },
  card:     { flexDirection: "row", marginBottom: 12, borderWidth: 1, borderColor: "rgba(148,163,184,0.12)", shadowColor: "#000", shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.18, shadowRadius: 22, elevation: 5, overflow: "hidden" },
  cardBody: { flex: 1, padding: 14 },
  cardTop:  { flexDirection: "row", alignItems: "flex-start", marginBottom: 10 },
  cardLeft: { flex: 1 },
  cardRight:{ alignItems: "flex-end", marginLeft: 8 },
  metaRow:  { flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" },
  metaText: { fontSize: 11, fontFamily: "Inter_400Regular" },
  smartBillNote: { fontSize: 11, fontFamily: "Inter_400Regular", lineHeight: 16, marginTop: 2 },
  editHint: { padding: 14, justifyContent: "center" },

  // Bills-specific
  catBar:    { width: 4 },
  billName:  { fontSize: 17, fontFamily: "Inter_800ExtraBold", marginBottom: 7, letterSpacing: -0.2 },
  tag:       { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  tagText:   { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  amount:    { fontSize: 18, fontFamily: "Inter_700Bold" },
  amountSub: { fontSize: 10, fontFamily: "Inter_400Regular" },

  // Debt-specific
  debtScrollContent: { paddingTop: 0 },
  statsRow:       { flexDirection: "row" },
  statCard:       { flex: 1, alignItems: "center", paddingVertical: 12, gap: 4 },
  statValue:      { fontSize: 16, fontFamily: "Inter_700Bold" },
  statLabel:      { fontSize: 10, fontFamily: "Inter_500Medium", textTransform: "uppercase", letterSpacing: 0.4 },
  extraBanner:    { flexDirection: "column", padding: 16, marginBottom: 12, marginTop: 4, borderWidth: 1, borderColor: "rgba(34,197,94,0.16)" },
  extraTopRow:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  extraLeft:      { flexDirection: "row", alignItems: "center", gap: 10 },
  extraLabel:     { fontSize: 11, fontFamily: "Inter_500Medium", textTransform: "uppercase", letterSpacing: 0.5 },
  extraValue:     { fontSize: 20, fontFamily: "Inter_700Bold", marginTop: 2 },
  applyBtn:       { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10 },
  applyBtnText:   { fontSize: 13, fontFamily: "Inter_700Bold" },
  cappedNote:     { fontSize: 11, fontFamily: "Inter_500Medium", marginTop: 10, lineHeight: 15 },
  debtAlgoCard:   { borderWidth: 1, padding: 14, marginTop: 10, marginBottom: 2, gap: 10 },
  debtAlgoHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  dataIcon:       { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  debtAlgoEyebrow:{ fontSize: 10, fontFamily: "Inter_800ExtraBold", textTransform: "uppercase", letterSpacing: 0.8 },
  debtAlgoTitle:  { fontSize: 17, fontFamily: "Inter_800ExtraBold", marginTop: 2 },
  debtAlgoBadge:  { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 999 },
  debtAlgoBadgeText: { fontSize: 10, fontFamily: "Inter_800ExtraBold", textTransform: "uppercase", letterSpacing: 0.5 },
  debtAlgoCopy:   { fontSize: 13, fontFamily: "Inter_600SemiBold", lineHeight: 18 },
  debtAlgoMeta:   { fontSize: 11, fontFamily: "Inter_500Medium", marginTop: -4 },
  snowballExplain: { borderWidth: 1, borderRadius: 12, padding: 10, flexDirection: "row", gap: 8, alignItems: "flex-start" },
  snowballExplainText: { flex: 1, fontSize: 12, fontFamily: "Inter_600SemiBold", lineHeight: 17 },
  rolloverCard:   { marginTop: 2, borderWidth: 1, borderRadius: 14, padding: 10, flexDirection: "row", alignItems: "flex-start", gap: 8 },
  rolloverText:   { flex: 1, fontSize: 11, fontFamily: "Inter_600SemiBold", lineHeight: 16 },
  debtAlgoCompareRow: { flexDirection: "row", gap: 8 },
  debtAlgoChip:   { flex: 1, borderWidth: 1, borderRadius: 12, padding: 9, minHeight: 62 },
  debtAlgoChipLabel: { fontSize: 9, fontFamily: "Inter_800ExtraBold", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 4 },
  debtAlgoChipValue: { fontSize: 11, fontFamily: "Inter_700Bold", lineHeight: 14 },
  methodRow:      { flexDirection: "row", gap: 8, alignItems: "center", marginBottom: 6 },
  methodToggle:   { flex: 1, flexDirection: "row", padding: 4, gap: 4 },
  methodBtn:      { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: 9 },
  methodBtnText:  { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  sortToggle:     { flexDirection: "row", padding: 4, gap: 2 },
  sortBtn:        { paddingHorizontal: 12, paddingVertical: 9 },
  sortBtnText:    { fontSize: 13, fontFamily: "Inter_700Bold" },
  priorityStrip:  { width: 32, alignItems: "center", justifyContent: "center" },
  priorityNum:    { fontSize: 11, fontFamily: "Inter_700Bold", color: "#fff", transform: [{ rotate: "-90deg" }] },
  debtName:       { fontSize: 16, fontFamily: "Inter_700Bold", marginBottom: 6 },
  aprBadge:       { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 5 },
  aprText:        { fontSize: 11, fontFamily: "Inter_700Bold" },
  balance:        { fontSize: 20, fontFamily: "Inter_700Bold" },
  minPay:         { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  progressSection:{ marginBottom: 8 },
  progressHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 5 },
  progressLabel:  { fontSize: 11, fontFamily: "Inter_400Regular" },
  progressPct:    { fontSize: 11, fontFamily: "Inter_700Bold" },
  progressBg:     { height: 6, borderRadius: 3, overflow: "hidden" },
  progressFill:   { height: 6, borderRadius: 3 },
  strategyNote:   { flexDirection: "row", alignItems: "center", gap: 6, padding: 7, borderRadius: 6 },
  strategyText:   { flex: 1, fontSize: 11, fontFamily: "Inter_400Regular", lineHeight: 15 },
});
