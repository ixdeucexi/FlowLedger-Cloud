import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import {
  Keyboard, Modal, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AddBillModal } from "@/components/AddBillModal";
import { GoalModal } from "@/components/GoalModal";
import { DonutChart, MiniChart } from "@/components/MiniChart";
import colors from "@/constants/colors";
import type { Bill, DashboardFilter, Goal } from "@/context/BudgetContext";
import { useBudget } from "@/context/BudgetContext";
import { useColors } from "@/hooks/useColors";

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MONTH_FULL  = ["January","February","March","April","May","June","July","August","September","October","November","December"];

const CAT_COLORS: Record<string, string> = {
  Housing: "#0f9b8e", Utilities: "#f0b429", Insurance: "#6366f1",
  Transportation: "#ec4899", Food: "#f97316", Entertainment: "#8b5cf6",
  Health: "#ef4444", Education: "#3b82f6", Savings: "#22c55e", Debt: "#e11d48", Other: "#94a3b8",
};

export default function DashboardScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const {
    bills, getPaidAmount, getBillMonthlyTotal, selectedYear, setDashboardFilter,
    goals, addGoal, updateGoal, deleteGoal, checkGoalAffordability,
    getCashFlow, getMonthlyIncome, addBill, addTransaction, getDailyBalances,
  } = useBudget();

  const [goalModalVisible, setGoalModalVisible]     = useState(false);
  const [editGoal, setEditGoal]                     = useState<Goal | null>(null);
  const [actionModalVisible, setActionModalVisible] = useState(false);
  const [addBillVisible, setAddBillVisible]         = useState(false);
  const [affordAmt, setAffordAmt]                   = useState("");
  const [addedAsExpense, setAddedAsExpense]          = useState(false);
  const [expenseNameModal, setExpenseNameModal]      = useState(false);
  const [expenseNameInput, setExpenseNameInput]      = useState("");

  const now          = new Date();
  const currentMonth = now.getMonth();
  const today        = now.getDate();

  // ── Afford date stepper ────────────────────────────────────────────────────
  const [affordDate, setAffordDate] = useState<Date>(
    () => new Date(now.getFullYear(), now.getMonth(), now.getDate())
  );
  const stepAffordDate = useCallback((delta: number) => {
    setAffordDate(prev => {
      const next = new Date(prev);
      next.setDate(next.getDate() + delta);
      return next;
    });
    setAddedAsExpense(false);
  }, []);
  const resetAffordDate = useCallback(() => {
    setAffordDate(new Date(now.getFullYear(), now.getMonth(), now.getDate()));
    setAddedAsExpense(false);
  }, [now.getFullYear(), now.getMonth(), now.getDate()]);
  const affordDateLabel = useMemo(() => {
    const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const diff = Math.round((affordDate.getTime() - base.getTime()) / 86_400_000);
    if (diff === 0)  return "Today";
    if (diff === 1)  return "Tomorrow";
    if (diff === -1) return "Yesterday";
    return affordDate.toLocaleDateString("en-US", {
      month: "short", day: "numeric",
      ...(affordDate.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
    });
  }, [affordDate, now]);

  const cashFlow     = useMemo(() => getCashFlow(currentMonth, selectedYear), [getCashFlow, currentMonth, selectedYear]);
  const monthlyIncome = getMonthlyIncome();

  const stats = useMemo(() => {
    const monthBills = bills.filter(b => b.is_recurring || b.is_debt);
    let totalDue = 0, totalPaid = 0, paidCount = 0;
    monthBills.forEach(b => {
      const amt  = getBillMonthlyTotal(b, currentMonth, selectedYear);
      const paid = getPaidAmount(b.id, currentMonth, selectedYear);
      totalDue  += amt;
      totalPaid += Math.min(paid, amt);
      if (paid >= amt && amt > 0) paidCount++;
    });
    const totalDebt  = bills.filter(b => b.is_debt).reduce((s, b) => s + b.balance, 0);
    const unpaidCount = monthBills.length - paidCount;
    return { totalDue, totalPaid, remaining: totalDue - totalPaid, paidCount, unpaidCount, billCount: monthBills.length, totalDebt };
  }, [bills, getBillMonthlyTotal, getPaidAmount, currentMonth, selectedYear]);

  const upcomingBills = useMemo(() => {
    const sevenDaysLater = today + 7;
    return bills
      .filter(b => (b.is_recurring || b.is_debt) && b.due_day >= today && b.due_day <= sevenDaysLater)
      .sort((a, b) => a.due_day - b.due_day)
      .slice(0, 5);
  }, [bills, today]);

  const monthlyBarData = useMemo(() =>
    MONTH_NAMES.map((label, i) => ({ label, value: bills.filter(b => b.is_recurring || b.is_debt).reduce((s, b) => s + getBillMonthlyTotal(b, i, selectedYear), 0) })),
    [bills, getBillMonthlyTotal, selectedYear]);

  const categoryData = useMemo(() => {
    const map: Record<string, number> = {};
    bills.forEach(b => { const cat = b.category || "Other"; map[cat] = (map[cat] || 0) + b.amount; });
    return Object.entries(map).map(([label, value]) => ({ label, value, color: CAT_COLORS[label] ?? "#94a3b8" })).sort((a, b) => b.value - a.value);
  }, [bills]);

  const debtPayoffData = useMemo(() => {
    const debts = bills.filter(b => b.is_debt && b.balance > 0);
    if (!debts.length) return [];
    const months: { label: string; value: number }[] = [];
    let rem = debts.reduce((s, b) => s + b.balance, 0);
    const monthly = debts.reduce((s, b) => s + b.amount, 0);
    for (let i = 0; i < 12 && rem > 0; i++) {
      rem = Math.max(0, rem - monthly);
      months.push({ label: MONTH_NAMES[(currentMonth + i) % 12], value: rem });
    }
    return months;
  }, [bills, currentMonth]);

  // ── Affordability check (real calendar projection) ──────────────────────────
  const RISKY_THRESHOLD = 200;
  const affordResult = useMemo(() => {
    const amt = parseFloat(affordAmt);
    if (!affordAmt.trim() || isNaN(amt) || amt <= 0) return null;

    const purchaseMonth = affordDate.getMonth();
    const purchaseYear  = affordDate.getFullYear();
    const purchaseDay   = affordDate.getDate();

    // Pull the full daily balance array for the purchase month (uses real income/bills/tx)
    const balances = getDailyBalances(purchaseMonth, purchaseYear);
    const dayEntry = balances.find(db => db.day === purchaseDay);
    if (!balances.length) return null;

    // If the date is beyond the last day computed, use the last day
    const effectiveEntry = dayEntry ?? balances[balances.length - 1];
    const balanceAtDay   = effectiveEntry.balance;
    const balanceAfter   = balanceAtDay - amt;

    // Lowest balance from purchase day forward (purchase reduces every subsequent day by flat amt)
    const fromDay = balances.filter(db => db.day >= (dayEntry?.day ?? effectiveEntry.day));
    let lowestBal = balanceAfter;
    let lowestDay = effectiveEntry.day;
    fromDay.forEach(db => {
      const adj = db.balance - amt;
      if (adj < lowestBal) { lowestBal = adj; lowestDay = db.day; }
    });

    const canAfford = balanceAfter >= 0;
    const isRisky   = canAfford && lowestBal < RISKY_THRESHOLD;
    const shortfall = canAfford ? 0 : Math.abs(balanceAfter);

    const lowestDateLabel = new Date(purchaseYear, purchaseMonth, lowestDay)
      .toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const affordDateStr = `${purchaseYear}-${String(purchaseMonth + 1).padStart(2, "0")}-${String(purchaseDay).padStart(2, "0")}`;

    return {
      canAfford, isRisky, shortfall,
      balanceAtDay, balanceAfter,
      lowestBal, lowestDay, lowestDateLabel,
      purchaseMonth, purchaseYear, purchaseDay, affordDateStr, amt,
    };
  }, [affordAmt, affordDate, getDailyBalances]);

  const navigate = (filter: DashboardFilter, tab: string) => {
    setDashboardFilter(filter);
    router.push(`/(tabs)/${tab}` as any);
  };

  const openAction = (action: string) => {
    setActionModalVisible(false);
    setTimeout(() => {
      if (action === "bill")          setAddBillVisible(true);
      else if (action === "income")   router.push("/(tabs)/more" as any);
      else if (action === "expense")  router.push("/(tabs)/monthly" as any);
      else if (action === "debt")     router.push("/(tabs)/debt" as any);
      else if (action === "afford") {} // handled inline
    }, 250);
  };

  const webTopPad = Platform.OS === "web" ? 67 : 0;

  const statCards = [
    { title: "Total Bills",  value: `$${stats.totalDue.toFixed(0)}`,    icon: "file-text"    as const, col: c.primary,     sub: `${stats.billCount} bills`,               filter: null           as DashboardFilter, tab: "bills"   },
    { title: "Paid",         value: `$${stats.totalPaid.toFixed(0)}`,   icon: "check-circle" as const, col: c.success,     sub: `${stats.paidCount}/${stats.billCount} paid`, filter: "paid"      as DashboardFilter, tab: "monthly" },
    { title: "Unpaid",       value: `$${stats.remaining.toFixed(0)}`,   icon: "alert-circle" as const, col: stats.remaining > 0 ? c.warning : c.success, sub: `${stats.unpaidCount} unpaid`, filter: "unpaid" as DashboardFilter, tab: "monthly" },
    { title: "Total Debt",   value: `$${stats.totalDebt.toFixed(0)}`,   icon: "credit-card"  as const, col: c.destructive, sub: `${bills.filter(b => b.is_debt).length} debts`, filter: null      as DashboardFilter, tab: "debt"    },
  ];

  // Build breakdown string: Income − Bills [± Transactions] = Left
  const txSign    = cashFlow.netTransactions >= 0 ? "+" : "−";
  const txDisplay = cashFlow.netTransactions !== 0
    ? ` ${txSign} $${Math.abs(cashFlow.netTransactions).toFixed(0)} spent`
    : "";
  const breakdownText =
    `$${cashFlow.monthlyIncome.toFixed(0)} income − $${cashFlow.totalBillsDue.toFixed(0)} bills${txDisplay} = $${Math.abs(cashFlow.remaining).toFixed(0)} ${cashFlow.remaining >= 0 ? "left" : "short"}`;

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: c.background }]}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 + webTopPad, paddingBottom: insets.bottom + 100 }]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[styles.heading,    { color: c.foreground }]}>Dashboard</Text>
      <Text style={[styles.subheading, { color: c.mutedForeground }]}>{MONTH_FULL[currentMonth]} {selectedYear}</Text>

      {/* ── HERO: Available Cash ── */}
      <View style={[styles.heroCard, { backgroundColor: cashFlow.remaining >= 0 ? c.primary : c.destructive }]}>
        <Text style={styles.heroLabel}>Available Cash</Text>
        <Text style={styles.heroValue}>
          {cashFlow.remaining >= 0 ? "" : "−"}${Math.abs(cashFlow.remaining).toFixed(0)}
        </Text>
        <Text style={styles.heroBreakdown}>{breakdownText}</Text>

        {stats.totalDue > 0 && (
          <View style={styles.heroProgress}>
            <View style={[styles.heroProgressTrack, { backgroundColor: "rgba(255,255,255,0.25)" }]}>
              <View style={[styles.heroProgressFill, { width: `${Math.min((stats.totalPaid / stats.totalDue) * 100, 100)}%` as any }]} />
            </View>
            <Text style={styles.heroProgressLabel}>
              {Math.round((stats.totalPaid / stats.totalDue) * 100)}% of bills paid this month
            </Text>
          </View>
        )}
      </View>

      {/* ── WHAT CAN I DO? button ── */}
      <Pressable
        onPress={() => setActionModalVisible(true)}
        style={({ pressed }) => [styles.whatBtn, { backgroundColor: c.card, borderColor: c.border, borderRadius: colors.radius, opacity: pressed ? 0.85 : 1 }]}
      >
        <View style={[styles.whatBtnIcon, { backgroundColor: c.primary + "18" }]}>
          <Feather name="zap" size={18} color={c.primary} />
        </View>
        <Text style={[styles.whatBtnText, { color: c.foreground }]}>What can I do?</Text>
        <Feather name="chevron-right" size={18} color={c.mutedForeground} />
      </Pressable>

      {/* ── AFFORDABILITY CHECK ── */}
      <View style={[styles.affordCard, { backgroundColor: c.card, borderRadius: colors.radius }]}>
        {/* Header */}
        <View style={styles.affordHeader}>
          <View style={[styles.affordHeaderIcon, { backgroundColor: c.primary + "18" }]}>
            <Feather name="help-circle" size={16} color={c.primary} />
          </View>
          <Text style={[styles.affordTitle, { color: c.foreground }]}>Can I afford this?</Text>
        </View>

        {/* Amount row */}
        <View style={styles.affordAmtRow}>
          <Text style={[styles.affordDollar, { color: c.mutedForeground }]}>$</Text>
          <TextInput
            style={[styles.affordInput, { backgroundColor: c.muted, color: c.foreground, borderRadius: 10 }]}
            placeholder="0.00"
            placeholderTextColor={c.mutedForeground}
            keyboardType="decimal-pad"
            returnKeyType="done"
            onSubmitEditing={Keyboard.dismiss}
            value={affordAmt}
            onChangeText={v => { setAffordAmt(v); setAddedAsExpense(false); }}
          />
          {affordAmt.trim().length > 0 && (
            <Pressable onPress={() => { setAffordAmt(""); setAddedAsExpense(false); }} style={[styles.affordClear, { backgroundColor: c.muted }]}>
              <Feather name="x" size={14} color={c.mutedForeground} />
            </Pressable>
          )}
        </View>

        {/* Date stepper */}
        <View style={[styles.affordDateRow, { backgroundColor: c.muted, borderRadius: 10 }]}>
          <Pressable onPress={() => stepAffordDate(-1)} style={styles.affordDateArrow} hitSlop={8}>
            <Feather name="chevron-left" size={18} color={c.mutedForeground} />
          </Pressable>
          <Pressable onPress={resetAffordDate} style={styles.affordDateCenter}>
            <Feather name="calendar" size={12} color={c.primary} />
            <Text style={[styles.affordDateLabel, { color: c.foreground }]}>{affordDateLabel}</Text>
          </Pressable>
          <Pressable onPress={() => stepAffordDate(1)} style={styles.affordDateArrow} hitSlop={8}>
            <Feather name="chevron-right" size={18} color={c.mutedForeground} />
          </Pressable>
        </View>

        {/* Result */}
        {affordResult && (() => {
          const { canAfford, isRisky, shortfall, balanceAtDay, balanceAfter, lowestBal, lowestDateLabel } = affordResult;
          const state   = !canAfford ? "red" : isRisky ? "yellow" : "green";
          const bgColor = state === "green" ? c.success + "15" : state === "yellow" ? "#f0b42918" : c.destructive + "15";
          const mainCol = state === "green" ? c.success  : state === "yellow" ? "#f0b429"   : c.destructive;
          const icon    = state === "green" ? "check-circle" as const : state === "yellow" ? "alert-triangle" as const : "x-circle" as const;
          const headline =
            state === "green"  ? "You CAN afford this." :
            state === "yellow" ? "You can afford this, but it will be tight." :
                                 "You CANNOT afford this.";

          return (
            <View style={{ marginTop: 12 }}>
              {/* Main verdict */}
              <View style={[styles.affordVerdict, { backgroundColor: bgColor, borderRadius: 12 }]}>
                <Feather name={icon} size={22} color={mainCol} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.affordVerdictTitle, { color: mainCol }]}>{headline}</Text>

                  {state === "green" && (
                    <Text style={[styles.affordVerdictSub, { color: c.mutedForeground }]}>
                      Balance after purchase:{" "}
                      <Text style={{ color: c.success, fontFamily: "Inter_700Bold" }}>
                        ${balanceAfter.toFixed(2)}
                      </Text>
                    </Text>
                  )}
                  {state === "yellow" && (
                    <Text style={[styles.affordVerdictSub, { color: c.mutedForeground }]}>
                      You may run low before your next income.{"\n"}
                      Balance after purchase:{" "}
                      <Text style={{ color: "#f0b429", fontFamily: "Inter_700Bold" }}>
                        ${balanceAfter.toFixed(2)}
                      </Text>
                    </Text>
                  )}
                  {state === "red" && (
                    <Text style={[styles.affordVerdictSub, { color: c.mutedForeground }]}>
                      Shortfall:{" "}
                      <Text style={{ color: c.destructive, fontFamily: "Inter_700Bold" }}>
                        ${shortfall.toFixed(2)}
                      </Text>
                      {"\n"}
                      Your projected balance on{" "}
                      {affordDateLabel.toLowerCase()} is only{" "}
                      <Text style={{ fontFamily: "Inter_700Bold" }}>
                        ${balanceAtDay.toFixed(2)}
                      </Text>
                    </Text>
                  )}
                </View>
              </View>

              {/* "What happens next" insight */}
              <View style={[styles.affordInsight, { backgroundColor: c.muted, borderRadius: 10 }]}>
                <Feather name="trending-down" size={13} color={lowestBal < 0 ? c.destructive : lowestBal < RISKY_THRESHOLD ? "#f0b429" : c.mutedForeground} />
                <Text style={[styles.affordInsightText, { color: c.mutedForeground }]}>
                  Your lowest balance after this will be{" "}
                  <Text style={{ color: lowestBal < 0 ? c.destructive : lowestBal < RISKY_THRESHOLD ? "#f0b429" : c.foreground, fontFamily: "Inter_700Bold" }}>
                    {lowestBal < 0 ? "-" : ""}${Math.abs(lowestBal).toFixed(2)}
                  </Text>
                  {" "}on {lowestDateLabel}.
                </Text>
              </View>

              {/* Quick action */}
              <View style={styles.affordActions}>
                {addedAsExpense ? (
                  <View style={[styles.affordActionDone, { backgroundColor: c.success + "18", borderRadius: 10 }]}>
                    <Feather name="check" size={14} color={c.success} />
                    <Text style={[styles.affordActionDoneText, { color: c.success }]}>Added as expense</Text>
                  </View>
                ) : (
                  <Pressable
                    onPress={() => { setExpenseNameInput(""); setExpenseNameModal(true); }}
                    style={({ pressed }) => [styles.affordActionBtn, { backgroundColor: c.primary + "18", opacity: pressed ? 0.75 : 1 }]}
                  >
                    <Feather name="plus-circle" size={14} color={c.primary} />
                    <Text style={[styles.affordActionBtnText, { color: c.primary }]}>Add as Expense</Text>
                  </Pressable>
                )}
              </View>
            </View>
          );
        })()}
      </View>

      {/* ── Upcoming Bills ── */}
      {upcomingBills.length > 0 && (
        <>
          <Text style={[styles.sectionTitle, { color: c.foreground }]}>Upcoming Bills (7 days)</Text>
          <View style={[styles.upcomingCard, { backgroundColor: c.card, borderRadius: colors.radius }]}>
            {upcomingBills.map((bill, i) => {
              const catColor = CAT_COLORS[bill.category] ?? c.primary;
              const daysLeft = bill.due_day - today;
              return (
                <Pressable
                  key={bill.id}
                  onPress={() => { setDashboardFilter("unpaid"); router.push("/(tabs)/monthly" as any); }}
                  style={({ pressed }) => [styles.upcomingRow, { borderTopWidth: i > 0 ? 1 : 0, borderTopColor: c.border, opacity: pressed ? 0.75 : 1 }]}
                >
                  <View style={[styles.upcomingDot, { backgroundColor: catColor + "20" }]}>
                    <Feather name="calendar" size={13} color={catColor} />
                  </View>
                  <View style={styles.upcomingInfo}>
                    <Text style={[styles.upcomingName, { color: c.foreground }]}>{bill.name}</Text>
                    <Text style={[styles.upcomingDate, { color: c.mutedForeground }]}>
                      Due {daysLeft === 0 ? "today" : daysLeft === 1 ? "tomorrow" : `in ${daysLeft} days`}
                    </Text>
                  </View>
                  <Text style={[styles.upcomingAmt, { color: c.foreground }]}>${bill.amount.toFixed(0)}</Text>
                  <Feather name="chevron-right" size={13} color={c.mutedForeground} style={{ marginLeft: 4 }} />
                </Pressable>
              );
            })}
          </View>
        </>
      )}

      {/* ── Stat Cards (moved lower) ── */}
      <Text style={[styles.sectionTitle, { color: c.foreground }]}>This Month</Text>
      <View style={styles.statsGrid}>
        {statCards.map(card => (
          <Pressable
            key={card.title}
            onPress={() => navigate(card.filter, card.tab)}
            style={({ pressed }) => [styles.statCard, { backgroundColor: c.card, borderRadius: colors.radius, opacity: pressed ? 0.82 : 1 }]}
          >
            <View style={[styles.statIcon, { backgroundColor: card.col + "20" }]}>
              <Feather name={card.icon} size={15} color={card.col} />
            </View>
            <Text style={[styles.statTitle, { color: c.mutedForeground }]}>{card.title}</Text>
            <Text style={[styles.statValue, { color: c.foreground }]} numberOfLines={1}>{card.value}</Text>
            <Text style={[styles.statSub, { color: c.mutedForeground }]}>{card.sub}</Text>
            <View style={[styles.tapBadge, { backgroundColor: card.col + "18" }]}>
              <Feather name="chevron-right" size={10} color={card.col} />
            </View>
          </Pressable>
        ))}
      </View>

      {/* ── Charts ── */}
      <MiniChart data={monthlyBarData} title="Monthly Expenses" height={130} />
      {categoryData.length > 0 && <DonutChart segments={categoryData} title="By Category" size={90} />}
      {debtPayoffData.length > 0 && <MiniChart data={debtPayoffData} title="Debt Payoff Projection" height={120} />}

      {/* ── Financial Goals ── */}
      <View style={styles.goalsHeader}>
        <Text style={[styles.sectionTitle, { color: c.foreground, marginBottom: 0 }]}>Financial Goals</Text>
        <Pressable
          onPress={() => { setEditGoal(null); setGoalModalVisible(true); }}
          style={({ pressed }) => [styles.addGoalBtn, { backgroundColor: c.primary + "20", opacity: pressed ? 0.7 : 1 }]}
        >
          <Feather name="plus" size={16} color={c.primary} />
          <Text style={[styles.addGoalText, { color: c.primary }]}>Add Goal</Text>
        </Pressable>
      </View>

      {goals.length === 0 ? (
        <View style={[styles.goalsEmpty, { backgroundColor: c.card, borderRadius: colors.radius }]}>
          <Feather name="target" size={28} color={c.mutedForeground} />
          <Text style={[styles.goalsEmptyText, { color: c.mutedForeground }]}>
            Set a financial goal — Christmas fund, vacation, emergency fund...
          </Text>
          <Pressable
            onPress={() => { setEditGoal(null); setGoalModalVisible(true); }}
            style={[styles.goalsEmptyBtn, { backgroundColor: c.primary }]}
          >
            <Text style={[styles.goalsEmptyBtnText, { color: c.primaryForeground }]}>Create First Goal</Text>
          </Pressable>
        </View>
      ) : (
        goals.map(goal => {
          const pct = goal.target_amount > 0 ? Math.min(goal.current_amount / goal.target_amount, 1) : 0;
          const rawDate   = goal.target_date ?? "";
          const targetDate = rawDate.includes("T") ? new Date(rawDate) : new Date(rawDate + "T12:00:00");
          const goalMonth = targetDate.getMonth();
          const goalYear  = targetDate.getFullYear();
          const afford    = checkGoalAffordability(goal, goalMonth, goalYear);
          const needed    = Math.max(0, goal.target_amount - goal.current_amount);
          return (
            <Pressable
              key={goal.id}
              onPress={() => { setEditGoal(goal); setGoalModalVisible(true); }}
              style={[styles.goalCard, { backgroundColor: c.card, borderRadius: colors.radius }]}
            >
              <View style={styles.goalTop}>
                <View style={styles.goalLeft}>
                  <Text style={[styles.goalName, { color: c.foreground }]}>{goal.name}</Text>
                  <Text style={[styles.goalDate, { color: c.mutedForeground }]}>
                    Target: {targetDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </Text>
                </View>
                <View style={styles.goalRight}>
                  <Text style={[styles.goalAmount, { color: c.foreground }]}>${goal.current_amount.toFixed(0)}</Text>
                  <Text style={[styles.goalTarget, { color: c.mutedForeground }]}>of ${goal.target_amount.toFixed(0)}</Text>
                </View>
              </View>
              <View style={[styles.goalProgress, { backgroundColor: c.muted }]}>
                <View style={[styles.goalProgressFill, { width: `${pct * 100}%` as any, backgroundColor: pct >= 1 ? c.success : c.primary }]} />
              </View>
              <View style={[styles.affordBox, { backgroundColor: afford.canAfford ? c.success + "18" : c.destructive + "18", borderRadius: 8 }]}>
                <Feather name={afford.canAfford ? "check-circle" : "alert-circle"} size={14} color={afford.canAfford ? c.success : c.destructive} />
                <View style={styles.affordText}>
                  <Text style={[styles.affordBoxTitle, { color: afford.canAfford ? c.success : c.destructive }]}>
                    {afford.canAfford ? "You can afford this" : "You cannot afford this"}
                  </Text>
                  {needed > 0 && (
                    <Text style={[styles.affordSub, { color: c.mutedForeground }]}>
                      {afford.canAfford
                        ? `Projected $${afford.projectedBalance.toLocaleString("en-US", { maximumFractionDigits: 0 })} ≥ $${needed.toLocaleString("en-US", { maximumFractionDigits: 0 })} needed`
                        : `$${afford.shortfall.toLocaleString("en-US", { maximumFractionDigits: 0 })} short · projected $${afford.projectedBalance.toLocaleString("en-US", { maximumFractionDigits: 0 })}`}
                    </Text>
                  )}
                </View>
              </View>
            </Pressable>
          );
        })
      )}

      {/* ── "What can I do?" modal ── */}
      <Modal
        visible={actionModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setActionModalVisible(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setActionModalVisible(false)}>
          <Pressable style={[styles.actionSheet, { backgroundColor: c.card }]} onPress={() => {}}>
            <View style={[styles.sheetHandle, { backgroundColor: c.muted }]} />
            <Text style={[styles.sheetTitle, { color: c.foreground }]}>What can I do?</Text>
            <Text style={[styles.sheetSub, { color: c.mutedForeground }]}>
              You have{" "}
              <Text style={{ color: cashFlow.remaining >= 0 ? c.success : c.destructive, fontFamily: "Inter_700Bold" }}>
                ${Math.abs(cashFlow.remaining).toFixed(0)}
              </Text>
              {cashFlow.remaining >= 0 ? " available" : " short"} this month
            </Text>

            {[
              { id: "bill",    icon: "file-text"   as const, label: "Add a Bill",       sub: "Track a new recurring expense",       col: c.primary     },
              { id: "income",  icon: "trending-up" as const, label: "Add Income",        sub: "Log a salary, freelance, or other",    col: c.success     },
              { id: "expense", icon: "shopping-bag"as const, label: "Add a Transaction", sub: "Record a one-time expense or income",  col: c.warning     },
              { id: "debt",    icon: "credit-card" as const, label: "Pay Down Debt",     sub: "Go to snowball / avalanche planner",   col: c.destructive },
            ].map(item => (
              <Pressable
                key={item.id}
                onPress={() => openAction(item.id)}
                style={({ pressed }) => [styles.actionRow, { borderColor: c.border, opacity: pressed ? 0.75 : 1 }]}
              >
                <View style={[styles.actionIcon, { backgroundColor: item.col + "18" }]}>
                  <Feather name={item.icon} size={20} color={item.col} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.actionLabel, { color: c.foreground }]}>{item.label}</Text>
                  <Text style={[styles.actionSub,   { color: c.mutedForeground }]}>{item.sub}</Text>
                </View>
                <Feather name="chevron-right" size={16} color={c.mutedForeground} />
              </Pressable>
            ))}

            <Pressable
              onPress={() => setActionModalVisible(false)}
              style={[styles.sheetCancel, { backgroundColor: c.muted, borderRadius: colors.radius }]}
            >
              <Text style={[styles.sheetCancelText, { color: c.mutedForeground }]}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <AddBillModal
        visible={addBillVisible}
        onClose={() => setAddBillVisible(false)}
        onSave={(data) => { addBill(data as Omit<Bill, "id" | "created_at">); }}
        onDelete={() => {}}
        editBill={null}
      />

      <GoalModal
        visible={goalModalVisible}
        onClose={() => { setGoalModalVisible(false); setEditGoal(null); }}
        onSave={(data) => {
          if ("id" in data) updateGoal(data as Goal);
          else addGoal(data);
        }}
        onDelete={deleteGoal}
        editGoal={editGoal}
      />

      {/* ── Expense name popup ── */}
      <Modal visible={expenseNameModal} transparent animationType="fade" onRequestClose={() => setExpenseNameModal(false)}>
        <Pressable style={styles.expenseOverlay} onPress={() => setExpenseNameModal(false)}>
          <Pressable style={[styles.expenseSheet, { backgroundColor: c.card }]} onPress={() => {}}>
            <Text style={[styles.expenseSheetTitle, { color: c.foreground }]}>Name this expense</Text>
            <Text style={[styles.expenseSheetSub, { color: c.mutedForeground }]}>
              ${affordResult?.amt.toFixed(2)} on {affordDateLabel}
            </Text>
            <TextInput
              style={[styles.expenseNameInput, { backgroundColor: c.muted, color: c.foreground }]}
              placeholder="e.g. Dinner out, New shoes…"
              placeholderTextColor={c.mutedForeground}
              autoFocus
              returnKeyType="done"
              value={expenseNameInput}
              onChangeText={setExpenseNameInput}
              onSubmitEditing={() => {
                if (!affordResult) return;
                addTransaction({
                  amount: -Math.abs(affordResult.amt),
                  category: "Other",
                  note: expenseNameInput.trim() || "Expense",
                  date: affordResult.affordDateStr,
                });
                setExpenseNameModal(false);
                setAddedAsExpense(true);
              }}
            />
            <View style={styles.expenseBtns}>
              <Pressable
                onPress={() => setExpenseNameModal(false)}
                style={[styles.expenseBtn, { backgroundColor: c.muted }]}
              >
                <Text style={[styles.expenseBtnText, { color: c.mutedForeground }]}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  if (!affordResult) return;
                  addTransaction({
                    amount: -Math.abs(affordResult.amt),
                    category: "Other",
                    note: expenseNameInput.trim() || "Expense",
                    date: affordResult.affordDateStr,
                  });
                  setExpenseNameModal(false);
                  setAddedAsExpense(true);
                }}
                style={[styles.expenseBtn, { backgroundColor: c.primary }]}
              >
                <Text style={[styles.expenseBtnText, { color: "#fff" }]}>Add Expense</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen:  { flex: 1 },
  content: { paddingHorizontal: 16 },
  heading:    { fontSize: 28, fontFamily: "Inter_700Bold" },
  subheading: { fontSize: 14, fontFamily: "Inter_400Regular", marginTop: 4, marginBottom: 20 },

  // Hero
  heroCard:         { borderRadius: 20, padding: 22, marginBottom: 14, shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.18, shadowRadius: 8, elevation: 6 },
  heroLabel:        { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "rgba(255,255,255,0.8)", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 4 },
  heroValue:        { fontSize: 46, fontFamily: "Inter_700Bold", color: "#fff", lineHeight: 52 },
  heroBreakdown:    { fontSize: 12, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.75)", marginTop: 6, lineHeight: 17 },
  heroProgress:     { marginTop: 16 },
  heroProgressTrack:{ height: 6, borderRadius: 3, overflow: "hidden" },
  heroProgressFill: { height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.9)" },
  heroProgressLabel:{ fontSize: 11, fontFamily: "Inter_500Medium", color: "rgba(255,255,255,0.75)", marginTop: 5 },

  // What can I do? button
  whatBtn:     { flexDirection: "row", alignItems: "center", gap: 12, padding: 16, marginBottom: 14, borderWidth: 1, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 3, elevation: 2 },
  whatBtnIcon: { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  whatBtnText: { flex: 1, fontSize: 16, fontFamily: "Inter_700Bold" },

  // Affordability card
  affordCard:           { padding: 16, marginBottom: 14, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 3, elevation: 2 },
  affordHeader:         { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 14 },
  affordHeaderIcon:     { width: 32, height: 32, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  affordTitle:          { fontSize: 16, fontFamily: "Inter_700Bold" },
  affordAmtRow:         { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10 },
  affordDollar:         { fontSize: 16, fontFamily: "Inter_500Medium", paddingLeft: 4 },
  affordInput:          { flex: 1, height: 44, paddingHorizontal: 14, fontSize: 16, fontFamily: "Inter_500Medium" },
  affordClear:          { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  affordDateRow:        { flexDirection: "row", alignItems: "center", height: 44 },
  affordDateArrow:      { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  affordDateCenter:     { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  affordDateLabel:      { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  affordVerdict:        { flexDirection: "row", alignItems: "flex-start", gap: 12, padding: 14, marginBottom: 10 },
  affordVerdictTitle:   { fontSize: 15, fontFamily: "Inter_700Bold", marginBottom: 4 },
  affordVerdictSub:     { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  affordInsight:        { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 12, marginBottom: 10 },
  affordInsightText:    { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  affordActions:        { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  affordActionBtn:      { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10 },
  affordActionBtnText:  { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  affordActionDone:     { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 9 },
  affordActionDoneText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },

  // Upcoming
  sectionTitle:  { fontSize: 18, fontFamily: "Inter_700Bold", marginBottom: 10, marginTop: 4 },
  upcomingCard:  { marginBottom: 16, overflow: "hidden" },
  upcomingRow:   { flexDirection: "row", alignItems: "center", padding: 12, gap: 10 },
  upcomingDot:   { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  upcomingInfo:  { flex: 1 },
  upcomingName:  { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  upcomingDate:  { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
  upcomingAmt:   { fontSize: 15, fontFamily: "Inter_700Bold" },

  // Stat cards
  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 16 },
  statCard:  { width: "48%", padding: 14, shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 4, elevation: 3, position: "relative" },
  statIcon:  { width: 30, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  statTitle: { fontSize: 10, fontFamily: "Inter_500Medium", textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 2 },
  statValue: { fontSize: 22, fontFamily: "Inter_700Bold" },
  statSub:   { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  tapBadge:  { position: "absolute", top: 10, right: 10, width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center" },

  // Goals
  goalsHeader:        { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10, marginTop: 8 },
  addGoalBtn:         { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20 },
  addGoalText:        { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  goalsEmpty:         { padding: 24, alignItems: "center", marginBottom: 16 },
  goalsEmptyText:     { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 10, marginBottom: 16, lineHeight: 20 },
  goalsEmptyBtn:      { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10 },
  goalsEmptyBtnText:  { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  goalCard:           { marginBottom: 12, padding: 14, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 3, elevation: 2 },
  goalTop:            { flexDirection: "row", alignItems: "flex-start", marginBottom: 10 },
  goalLeft:           { flex: 1 },
  goalRight:          { alignItems: "flex-end" },
  goalName:           { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  goalDate:           { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  goalAmount:         { fontSize: 16, fontFamily: "Inter_700Bold" },
  goalTarget:         { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 1 },
  goalProgress:       { height: 6, borderRadius: 3, overflow: "hidden", marginBottom: 10 },
  goalProgressFill:   { height: 6, borderRadius: 3 },
  affordBox:          { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 10 },
  affordText:         { flex: 1 },
  affordBoxTitle:     { fontSize: 13, fontFamily: "Inter_700Bold" },
  affordSub:          { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },

  // Expense name popup
  expenseOverlay:     { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "center", alignItems: "center", padding: 32 },
  expenseSheet:       { width: "100%", borderRadius: 20, padding: 24, shadowColor: "#000", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.25, shadowRadius: 16, elevation: 12 },
  expenseSheetTitle:  { fontSize: 18, fontFamily: "Inter_700Bold", marginBottom: 4 },
  expenseSheetSub:    { fontSize: 13, fontFamily: "Inter_400Regular", marginBottom: 18 },
  expenseNameInput:   { height: 50, borderRadius: 12, paddingHorizontal: 16, fontSize: 16, fontFamily: "Inter_500Medium", marginBottom: 20 },
  expenseBtns:        { flexDirection: "row", gap: 10 },
  expenseBtn:         { flex: 1, paddingVertical: 13, borderRadius: 12, alignItems: "center" },
  expenseBtnText:     { fontSize: 15, fontFamily: "Inter_600SemiBold" },

  // Action sheet modal
  modalOverlay:    { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.5)" },
  actionSheet:     { borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 12, paddingBottom: 36, paddingHorizontal: 20 },
  sheetHandle:     { width: 40, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 16 },
  sheetTitle:      { fontSize: 20, fontFamily: "Inter_700Bold", marginBottom: 4 },
  sheetSub:        { fontSize: 13, fontFamily: "Inter_400Regular", marginBottom: 16 },
  actionRow:       { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 14, borderTopWidth: 1 },
  actionIcon:      { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  actionLabel:     { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  actionSub:       { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  sheetCancel:     { marginTop: 14, paddingVertical: 14, alignItems: "center" },
  sheetCancelText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
