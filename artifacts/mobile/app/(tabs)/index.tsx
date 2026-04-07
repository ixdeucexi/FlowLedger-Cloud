import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useMemo } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { DonutChart, MiniChart } from "@/components/MiniChart";
import colors from "@/constants/colors";
import type { DashboardFilter } from "@/context/BudgetContext";
import { useBudget } from "@/context/BudgetContext";
import { useColors } from "@/hooks/useColors";

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MONTH_FULL = ["January","February","March","April","May","June","July","August","September","October","November","December"];

const CAT_COLORS: Record<string, string> = {
  Housing: "#0f9b8e", Utilities: "#f0b429", Insurance: "#6366f1",
  Transportation: "#ec4899", Food: "#f97316", Entertainment: "#8b5cf6",
  Health: "#ef4444", Education: "#3b82f6", Savings: "#22c55e", Debt: "#e11d48", Other: "#94a3b8",
};

interface ClickableStatCard {
  title: string;
  value: string;
  icon: React.ComponentProps<typeof Feather>["name"];
  iconColor: string;
  subtitle?: string;
  filter: DashboardFilter;
  routeTo: "bills" | "monthly";
}

export default function DashboardScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { bills, getAmount, getPaidAmount, transactions, settings, selectedYear, setDashboardFilter } = useBudget();

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
      if (paid >= amt) paidCount++;
    });

    const txThisMonth = transactions.filter(t => {
      const d = new Date(t.date);
      return d.getMonth() === currentMonth && d.getFullYear() === selectedYear;
    });
    const txExpense = txThisMonth.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);

    const totalDebt = bills.filter(b => b.is_debt).reduce((s, b) => s + b.balance, 0);
    const remaining = totalDue - totalPaid;
    const unpaidCount = monthBills.length - paidCount;

    return { totalDue, totalPaid, remaining, paidCount, unpaidCount, billCount: monthBills.length, txExpense, totalDebt };
  }, [bills, getAmount, getPaidAmount, transactions, currentMonth, selectedYear]);

  const monthlyBarData = useMemo(() =>
    MONTH_NAMES.map((label, i) => {
      const value = bills.filter(b => b.is_recurring).reduce((s, b) => s + getAmount(b, i, selectedYear), 0);
      return { label, value };
    }), [bills, getAmount, selectedYear]);

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

  const navigate = (filter: DashboardFilter, tab: "bills" | "monthly") => {
    setDashboardFilter(filter);
    router.push(`/(tabs)/${tab === "bills" ? "bills" : "monthly"}`);
  };

  const statCards: ClickableStatCard[] = [
    { title: "Total Bills", value: `$${stats.totalDue.toFixed(0)}`, icon: "file-text", iconColor: c.primary, subtitle: `${stats.billCount} bills this month`, filter: null, routeTo: "bills" },
    { title: "Paid", value: `$${stats.totalPaid.toFixed(0)}`, icon: "check-circle", iconColor: c.success, subtitle: `${stats.paidCount} of ${stats.billCount} paid`, filter: "paid", routeTo: "monthly" },
    { title: "Remaining", value: `$${stats.remaining.toFixed(0)}`, icon: "alert-circle", iconColor: stats.remaining > 0 ? c.warning : c.success, subtitle: `${stats.unpaidCount} unpaid`, filter: "unpaid", routeTo: "monthly" },
    { title: "Total Debt", value: `$${stats.totalDebt.toFixed(0)}`, icon: "credit-card", iconColor: c.destructive, subtitle: `${bills.filter(b => b.is_debt).length} debts`, filter: "debts", routeTo: "bills" },
  ];

  const webTopPad = Platform.OS === "web" ? 67 : 0;

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: c.background }]}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 + webTopPad, paddingBottom: insets.bottom + 100 }]}
      showsVerticalScrollIndicator={false}
    >
      <Text style={[styles.heading, { color: c.foreground }]}>Dashboard</Text>
      <Text style={[styles.subheading, { color: c.mutedForeground }]}>{MONTH_FULL[currentMonth]} {selectedYear}</Text>

      <View style={styles.statsGrid}>
        {statCards.map((card, i) => (
          <Pressable
            key={card.title}
            onPress={() => navigate(card.filter, card.routeTo)}
            style={({ pressed }) => [
              styles.statCard,
              { backgroundColor: c.card, borderRadius: colors.radius, opacity: pressed ? 0.82 : 1 },
            ]}
          >
            <View style={[styles.statIcon, { backgroundColor: card.iconColor + "20" }]}>
              <Feather name={card.icon} size={16} color={card.iconColor} />
            </View>
            <Text style={[styles.statTitle, { color: c.mutedForeground }]}>{card.title}</Text>
            <Text style={[styles.statValue, { color: c.foreground }]} numberOfLines={1}>{card.value}</Text>
            {card.subtitle ? <Text style={[styles.statSub, { color: c.mutedForeground }]}>{card.subtitle}</Text> : null}
            <View style={[styles.tapHint, { backgroundColor: card.iconColor + "15" }]}>
              <Feather name="chevron-right" size={11} color={card.iconColor} />
            </View>
          </Pressable>
        ))}
      </View>

      {settings.monthly_income > 0 && (
        <View style={[styles.incomeCard, { backgroundColor: c.card, borderRadius: colors.radius }]}>
          {[
            { label: "Monthly Income", val: `$${settings.monthly_income.toFixed(0)}`, color: c.success },
            { label: "After Bills", val: `$${Math.max(0, settings.monthly_income - stats.totalDue).toFixed(0)}`, color: c.foreground },
            ...(stats.txExpense > 0 ? [{ label: "Spent (Transactions)", val: `-$${stats.txExpense.toFixed(0)}`, color: c.destructive }] : []),
          ].map((row, i, arr) => (
            <React.Fragment key={row.label}>
              <View style={styles.incomeRow}>
                <Text style={[styles.incomeLabel, { color: c.mutedForeground }]}>{row.label}</Text>
                <Text style={[styles.incomeValue, { color: row.color }]}>{row.val}</Text>
              </View>
              {i < arr.length - 1 && <View style={[styles.sep, { backgroundColor: c.border }]} />}
            </React.Fragment>
          ))}
        </View>
      )}

      {stats.totalDue > 0 && (
        <View style={{ marginBottom: 16 }}>
          <View style={styles.progressHeader}>
            <Text style={[styles.progressLabel, { color: c.mutedForeground }]}>Monthly Progress</Text>
            <Text style={[styles.progressPct, { color: c.primary }]}>
              {Math.round((stats.totalPaid / stats.totalDue) * 100)}%
            </Text>
          </View>
          <View style={[styles.progressBg, { backgroundColor: c.muted }]}>
            <View style={[styles.progressFill, { width: `${Math.min((stats.totalPaid / stats.totalDue) * 100, 100)}%` as any, backgroundColor: c.primary }]} />
          </View>
        </View>
      )}

      <MiniChart data={monthlyBarData} title="Monthly Expenses" height={130} />
      {categoryData.length > 0 && <DonutChart segments={categoryData} title="By Category" size={90} />}
      {debtPayoffData.length > 0 && <MiniChart data={debtPayoffData} title="Debt Payoff Projection" height={120} />}
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
  statIcon: { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center", marginBottom: 10 },
  statTitle: { fontSize: 11, fontFamily: "Inter_500Medium", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 4 },
  statValue: { fontSize: 22, fontFamily: "Inter_700Bold" },
  statSub: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 3 },
  tapHint: { position: "absolute", top: 12, right: 12, width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  incomeCard: { padding: 16, marginBottom: 16, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 3, elevation: 2 },
  incomeRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 5 },
  incomeLabel: { fontSize: 13, fontFamily: "Inter_500Medium" },
  incomeValue: { fontSize: 14, fontFamily: "Inter_700Bold" },
  sep: { height: 1, marginVertical: 2 },
  progressHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  progressLabel: { fontSize: 12, fontFamily: "Inter_500Medium" },
  progressPct: { fontSize: 12, fontFamily: "Inter_700Bold" },
  progressBg: { height: 6, borderRadius: 3, overflow: "hidden" },
  progressFill: { height: 6, borderRadius: 3 },
});
