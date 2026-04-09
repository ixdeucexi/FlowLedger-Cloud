import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useMemo, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { DonutChart, MiniChart } from "@/components/MiniChart";
import { GoalModal } from "@/components/GoalModal";
import colors from "@/constants/colors";
import type { DashboardFilter, Goal } from "@/context/BudgetContext";
import { useBudget } from "@/context/BudgetContext";
import { useColors } from "@/hooks/useColors";

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MONTH_FULL = ["January","February","March","April","May","June","July","August","September","October","November","December"];

const CAT_COLORS: Record<string, string> = {
  Housing: "#0f9b8e", Utilities: "#f0b429", Insurance: "#6366f1",
  Transportation: "#ec4899", Food: "#f97316", Entertainment: "#8b5cf6",
  Health: "#ef4444", Education: "#3b82f6", Savings: "#22c55e", Debt: "#e11d48", Other: "#94a3b8",
};

export default function DashboardScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { bills, getAmount, getPaidAmount, transactions, selectedYear, setDashboardFilter,
    goals, addGoal, updateGoal, deleteGoal, getGoalMonthlyRequired, getGoalMonthsRemaining,
    getCashFlow, getMonthlyIncome } = useBudget();

  const [goalModalVisible, setGoalModalVisible] = useState(false);
  const [editGoal, setEditGoal] = useState<Goal | null>(null);

  const now = new Date();
  const currentMonth = now.getMonth();

  const stats = useMemo(() => {
    const monthBills = bills.filter(b => b.is_recurring);
    let totalDue = 0, totalPaid = 0, paidCount = 0;
    monthBills.forEach(b => {
      const amt = getAmount(b, currentMonth, selectedYear);
      const paid = getPaidAmount(b.id, currentMonth, selectedYear);
      totalDue += amt;
      totalPaid += Math.min(paid, amt);
      if (paid >= amt && amt > 0) paidCount++;
    });
    const totalDebt = bills.filter(b => b.is_debt).reduce((s, b) => s + b.balance, 0);
    const unpaidCount = monthBills.length - paidCount;
    return { totalDue, totalPaid, remaining: totalDue - totalPaid, paidCount, unpaidCount, billCount: monthBills.length, totalDebt };
  }, [bills, getAmount, getPaidAmount, currentMonth, selectedYear]);

  const cashFlow = useMemo(() => getCashFlow(currentMonth, selectedYear), [getCashFlow, currentMonth, selectedYear]);

  const monthlyBarData = useMemo(() =>
    MONTH_NAMES.map((label, i) => ({ label, value: bills.filter(b => b.is_recurring).reduce((s, b) => s + getAmount(b, i, selectedYear), 0) })),
    [bills, getAmount, selectedYear]);

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

  const navigate = (filter: DashboardFilter, tab: string) => {
    setDashboardFilter(filter);
    router.push(`/(tabs)/${tab}` as any);
  };

  const webTopPad = Platform.OS === "web" ? 67 : 0;
  const monthlyIncome = getMonthlyIncome();

  const statCards = [
    { title: "Total Bills", value: `$${stats.totalDue.toFixed(0)}`, icon: "file-text" as const, col: c.primary, sub: `${stats.billCount} bills`, filter: null as DashboardFilter, tab: "bills" },
    { title: "Paid", value: `$${stats.totalPaid.toFixed(0)}`, icon: "check-circle" as const, col: c.success, sub: `${stats.paidCount}/${stats.billCount} paid`, filter: "paid" as DashboardFilter, tab: "monthly" },
    { title: "Remaining", value: `$${stats.remaining.toFixed(0)}`, icon: "alert-circle" as const, col: stats.remaining > 0 ? c.warning : c.success, sub: `${stats.unpaidCount} unpaid`, filter: "unpaid" as DashboardFilter, tab: "monthly" },
    { title: "Total Debt", value: `$${stats.totalDebt.toFixed(0)}`, icon: "credit-card" as const, col: c.destructive, sub: `${bills.filter(b => b.is_debt).length} debts`, filter: "debts" as DashboardFilter, tab: "bills" },
  ];

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: c.background }]}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 + webTopPad, paddingBottom: insets.bottom + 100 }]}
      showsVerticalScrollIndicator={false}
    >
      <Text style={[styles.heading, { color: c.foreground }]}>Dashboard</Text>
      <Text style={[styles.subheading, { color: c.mutedForeground }]}>{MONTH_FULL[currentMonth]} {selectedYear}</Text>

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

      {stats.totalDue > 0 && (
        <View style={{ marginBottom: 16 }}>
          <View style={styles.progressHeader}>
            <Text style={[styles.progressLabel, { color: c.mutedForeground }]}>Monthly Progress</Text>
            <Text style={[styles.progressPct, { color: c.primary }]}>{Math.round((stats.totalPaid / stats.totalDue) * 100)}%</Text>
          </View>
          <View style={[styles.progressBg, { backgroundColor: c.muted }]}>
            <View style={[styles.progressFill, { width: `${Math.min((stats.totalPaid / stats.totalDue) * 100, 100)}%` as any, backgroundColor: c.primary }]} />
          </View>
        </View>
      )}

      {monthlyIncome > 0 && (
        <View style={[styles.cashFlowCard, { backgroundColor: c.card, borderRadius: colors.radius }]}>
          <Text style={[styles.cfTitle, { color: c.foreground }]}>Cash Flow — {MONTH_FULL[currentMonth]}</Text>
          <View style={[styles.cfRow, { borderBottomColor: c.border }]}>
            <View style={[styles.cfDot, { backgroundColor: c.success }]} />
            <Text style={[styles.cfLabel, { color: c.mutedForeground }]}>Monthly Income</Text>
            <Text style={[styles.cfValue, { color: c.success }]}>+${cashFlow.monthlyIncome.toFixed(0)}</Text>
          </View>
          <View style={[styles.cfRow, { borderBottomColor: c.border }]}>
            <View style={[styles.cfDot, { backgroundColor: c.destructive }]} />
            <Text style={[styles.cfLabel, { color: c.mutedForeground }]}>Bills Due</Text>
            <Text style={[styles.cfValue, { color: c.foreground }]}>-${cashFlow.totalBillsDue.toFixed(0)}</Text>
          </View>
          {cashFlow.netTransactions !== 0 && (
            <View style={[styles.cfRow, { borderBottomColor: c.border }]}>
              <View style={[styles.cfDot, { backgroundColor: cashFlow.netTransactions > 0 ? c.success : c.warning }]} />
              <Text style={[styles.cfLabel, { color: c.mutedForeground }]}>Transactions (net)</Text>
              <Text style={[styles.cfValue, { color: cashFlow.netTransactions > 0 ? c.success : c.warning }]}>
                {cashFlow.netTransactions > 0 ? "+" : ""}{cashFlow.netTransactions.toFixed(0)}
              </Text>
            </View>
          )}
          {cashFlow.goalAllocations > 0 && (
            <View style={[styles.cfRow, { borderBottomColor: c.border }]}>
              <View style={[styles.cfDot, { backgroundColor: "#6366f1" }]} />
              <Text style={[styles.cfLabel, { color: c.mutedForeground }]}>Goal Savings</Text>
              <Text style={[styles.cfValue, { color: "#6366f1" }]}>-${cashFlow.goalAllocations.toFixed(0)}</Text>
            </View>
          )}
          <View style={[styles.cfTotal, { borderTopColor: c.border }]}>
            <Text style={[styles.cfTotalLabel, { color: c.foreground }]}>Available Cash</Text>
            <Text style={[styles.cfTotalValue, { color: cashFlow.remaining >= 0 ? c.success : c.destructive }]}>
              {cashFlow.remaining >= 0 ? "+" : ""}${cashFlow.remaining.toFixed(0)}
            </Text>
          </View>
        </View>
      )}

      <MiniChart data={monthlyBarData} title="Monthly Expenses" height={130} />

      {categoryData.length > 0 && <DonutChart segments={categoryData} title="By Category" size={90} />}

      {debtPayoffData.length > 0 && <MiniChart data={debtPayoffData} title="Debt Payoff Projection" height={120} />}

      <View style={styles.goalsHeader}>
        <Text style={[styles.goalsTitle, { color: c.foreground }]}>Financial Goals</Text>
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
          const monthly = getGoalMonthlyRequired(goal);
          const months = getGoalMonthsRemaining(goal);
          const onTrack = monthlyIncome > 0 && cashFlow.remaining >= monthly;
          const targetDate = new Date(goal.target_date);
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
                    {targetDate.toLocaleDateString("en-US", { month: "short", year: "numeric" })} · {months}mo left
                  </Text>
                </View>
                <View style={styles.goalRight}>
                  <Text style={[styles.goalAmount, { color: c.foreground }]}>${goal.current_amount.toFixed(0)}</Text>
                  <Text style={[styles.goalTarget, { color: c.mutedForeground }]}>of ${goal.target_amount.toFixed(0)}</Text>
                </View>
              </View>
              <View style={[styles.goalProgress, { backgroundColor: c.muted }]}>
                <View style={[styles.goalProgressFill, { width: `${pct * 100}%` as any, backgroundColor: pct >= 1 ? c.success : "#6366f1" }]} />
              </View>
              <View style={styles.goalFooter}>
                <Text style={[styles.goalMonthly, { color: c.mutedForeground }]}>
                  Need <Text style={[styles.goalMonthlyVal, { color: c.primary }]}>${monthly.toFixed(0)}/mo</Text>
                </Text>
                <View style={[styles.goalStatus, { backgroundColor: (onTrack ? c.success : c.destructive) + "20" }]}>
                  <Feather name={onTrack ? "check-circle" : "alert-circle"} size={11} color={onTrack ? c.success : c.destructive} />
                  <Text style={[styles.goalStatusText, { color: onTrack ? c.success : c.destructive }]}>
                    {onTrack ? "On Track" : monthlyIncome > 0 ? "Behind" : "Set Income"}
                  </Text>
                </View>
              </View>
            </Pressable>
          );
        })
      )}

      <GoalModal
        visible={goalModalVisible}
        onClose={() => { setGoalModalVisible(false); setEditGoal(null); }}
        onSave={(data) => {
          if ("id" in data) updateGoal(data as Goal);
          else addGoal(data);
        }}
        editGoal={editGoal}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: 16 },
  heading: { fontSize: 28, fontFamily: "Inter_700Bold" },
  subheading: { fontSize: 14, fontFamily: "Inter_400Regular", marginTop: 4, marginBottom: 20 },
  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 16 },
  statCard: { width: "48%", padding: 14, shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 4, elevation: 3, position: "relative" },
  statIcon: { width: 30, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  statTitle: { fontSize: 10, fontFamily: "Inter_500Medium", textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 2 },
  statValue: { fontSize: 22, fontFamily: "Inter_700Bold" },
  statSub: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  tapBadge: { position: "absolute", top: 10, right: 10, width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  progressHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  progressLabel: { fontSize: 12, fontFamily: "Inter_500Medium" },
  progressPct: { fontSize: 12, fontFamily: "Inter_700Bold" },
  progressBg: { height: 6, borderRadius: 3, overflow: "hidden" },
  progressFill: { height: 6, borderRadius: 3 },
  cashFlowCard: { marginBottom: 16, padding: 16, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 3, elevation: 2 },
  cfTitle: { fontSize: 15, fontFamily: "Inter_700Bold", marginBottom: 12 },
  cfRow: { flexDirection: "row", alignItems: "center", paddingVertical: 7, borderBottomWidth: 1 },
  cfDot: { width: 8, height: 8, borderRadius: 4, marginRight: 10 },
  cfLabel: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular" },
  cfValue: { fontSize: 13, fontFamily: "Inter_700Bold" },
  cfTotal: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: 10, borderTopWidth: 1, marginTop: 4 },
  cfTotalLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  cfTotalValue: { fontSize: 18, fontFamily: "Inter_700Bold" },
  goalsHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10, marginTop: 8 },
  goalsTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  addGoalBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20 },
  addGoalText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  goalsEmpty: { padding: 24, alignItems: "center", marginBottom: 16 },
  goalsEmptyText: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 10, marginBottom: 16, lineHeight: 20 },
  goalsEmptyBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10 },
  goalsEmptyBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  goalCard: { marginBottom: 12, padding: 14, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 3, elevation: 2 },
  goalTop: { flexDirection: "row", alignItems: "flex-start", marginBottom: 10 },
  goalLeft: { flex: 1 },
  goalRight: { alignItems: "flex-end" },
  goalName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  goalDate: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  goalAmount: { fontSize: 16, fontFamily: "Inter_700Bold" },
  goalTarget: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 1 },
  goalProgress: { height: 6, borderRadius: 3, overflow: "hidden", marginBottom: 10 },
  goalProgressFill: { height: 6, borderRadius: 3 },
  goalFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  goalMonthly: { fontSize: 12, fontFamily: "Inter_400Regular" },
  goalMonthlyVal: { fontFamily: "Inter_700Bold" },
  goalStatus: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 20 },
  goalStatusText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
});
