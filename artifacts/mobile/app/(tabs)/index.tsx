import React, { useMemo } from "react";
import { Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { DonutChart, MiniChart } from "@/components/MiniChart";
import { StatCard } from "@/components/StatCard";
import { useBudget } from "@/context/BudgetContext";
import { useColors } from "@/hooks/useColors";

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MONTH_FULL = ["January","February","March","April","May","June","July","August","September","October","November","December"];

export default function DashboardScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { bills, monthlyEntries, transactions, settings, selectedYear } = useBudget();
  const now = new Date();
  const currentMonth = now.getMonth();

  const stats = useMemo(() => {
    const entries = monthlyEntries.filter(e => e.month === currentMonth && e.year === selectedYear);
    const totalDue = entries.reduce((s, e) => {
      const b = bills.find(b => b.id === e.billId);
      return s + (b?.amount ?? 0);
    }, 0);
    const totalPaid = entries.reduce((s, e) => s + e.paid_amount, 0);
    const remaining = totalDue - totalPaid;
    const paidCount = entries.filter(e => e.paid).length;

    const txThisMonth = transactions.filter(t => {
      const d = new Date(t.date);
      return d.getMonth() === currentMonth && d.getFullYear() === selectedYear;
    });
    const txIncome = txThisMonth.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
    const txExpense = txThisMonth.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);

    const totalDebt = bills.filter(b => b.is_debt).reduce((s, b) => s + b.balance, 0);

    return { totalDue, totalPaid, remaining, paidCount, billCount: entries.length, txIncome, txExpense, totalDebt };
  }, [bills, monthlyEntries, transactions, currentMonth, selectedYear]);

  const monthlyBarData = useMemo(() =>
    MONTH_NAMES.map((label, i) => {
      const entries = monthlyEntries.filter(e => e.month === i && e.year === selectedYear);
      const value = entries.reduce((s, e) => {
        const b = bills.find(b => b.id === e.billId);
        return s + (b?.amount ?? 0);
      }, 0);
      return { label, value };
    }), [bills, monthlyEntries, selectedYear]);

  const catColors: Record<string, string> = {
    Housing: "#0f9b8e", Utilities: "#f0b429", Insurance: "#6366f1",
    Transportation: "#ec4899", Food: "#f97316", Entertainment: "#8b5cf6",
    Health: "#ef4444", Education: "#3b82f6", Savings: "#22c55e", Debt: "#e11d48", Other: "#94a3b8",
  };

  const categoryData = useMemo(() => {
    const map: Record<string, number> = {};
    bills.forEach(b => { const cat = b.category || "Other"; map[cat] = (map[cat] || 0) + b.amount; });
    return Object.entries(map).map(([label, value]) => ({ label, value, color: catColors[label] ?? c.primary })).sort((a, b) => b.value - a.value);
  }, [bills, c.primary]);

  const debtPayoffData = useMemo(() => {
    const debts = bills.filter(b => b.is_debt && b.balance > 0);
    if (debts.length === 0) return [];
    const months: { label: string; value: number }[] = [];
    let remaining = debts.reduce((s, b) => s + b.balance, 0);
    const monthlyPayments = debts.reduce((s, b) => s + b.amount, 0);
    for (let i = 0; i < 12; i++) {
      remaining = Math.max(0, remaining - monthlyPayments);
      months.push({ label: MONTH_NAMES[(currentMonth + i) % 12], value: remaining });
      if (remaining === 0) break;
    }
    return months;
  }, [bills, currentMonth]);

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
        <StatCard title="Total Bills" value={`$${stats.totalDue.toFixed(0)}`} icon="dollar-sign" color={c.primary} subtitle={`${stats.billCount} bills`} />
        <StatCard title="Paid" value={`$${stats.totalPaid.toFixed(0)}`} icon="check-circle" color={c.success} subtitle={`${stats.paidCount}/${stats.billCount}`} />
      </View>
      <View style={styles.statsGrid}>
        <StatCard title="Remaining" value={`$${stats.remaining.toFixed(0)}`} icon="alert-circle" color={stats.remaining > 0 ? c.warning : c.success} />
        <StatCard title="Total Debt" value={`$${stats.totalDebt.toFixed(0)}`} icon="credit-card" color={c.destructive} />
      </View>

      {settings.monthly_income > 0 && (
        <View style={[styles.incomeCard, { backgroundColor: c.card, borderRadius: c.radius }]}>
          <View style={styles.incomeRow}>
            <Text style={[styles.incomeLabel, { color: c.mutedForeground }]}>Monthly Income</Text>
            <Text style={[styles.incomeValue, { color: c.success }]}>${settings.monthly_income.toFixed(0)}</Text>
          </View>
          <View style={styles.incomeRow}>
            <Text style={[styles.incomeLabel, { color: c.mutedForeground }]}>After Bills</Text>
            <Text style={[styles.incomeValue, { color: c.foreground }]}>${Math.max(0, settings.monthly_income - stats.totalDue).toFixed(0)}</Text>
          </View>
          {stats.txExpense > 0 && (
            <View style={styles.incomeRow}>
              <Text style={[styles.incomeLabel, { color: c.mutedForeground }]}>Transactions</Text>
              <Text style={[styles.incomeValue, { color: c.destructive }]}>-${stats.txExpense.toFixed(0)}</Text>
            </View>
          )}
        </View>
      )}

      {stats.totalDue > 0 && (
        <View style={{ marginBottom: 16 }}>
          <Text style={[styles.progressLabel, { color: c.mutedForeground }]}>
            {Math.round((stats.totalPaid / stats.totalDue) * 100)}% Paid This Month
          </Text>
          <View style={[styles.progressBg, { backgroundColor: c.muted }]}>
            <View style={[styles.progressFill, { width: `${Math.min((stats.totalPaid / stats.totalDue) * 100, 100)}%` as any, backgroundColor: c.primary }]} />
          </View>
        </View>
      )}

      <MiniChart data={monthlyBarData} title="Monthly Expenses" height={130} />

      {categoryData.length > 0 && <DonutChart segments={categoryData} title="By Category" size={90} />}

      {debtPayoffData.length > 0 && (
        <MiniChart data={debtPayoffData} title="Debt Payoff Projection" height={120} />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: 16 },
  heading: { fontSize: 28, fontFamily: "Inter_700Bold" },
  subheading: { fontSize: 14, fontFamily: "Inter_400Regular", marginTop: 4, marginBottom: 20 },
  statsGrid: { flexDirection: "row", gap: 12, marginBottom: 12 },
  incomeCard: { padding: 14, marginBottom: 16, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 3, elevation: 2 },
  incomeRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 },
  incomeLabel: { fontSize: 13, fontFamily: "Inter_500Medium" },
  incomeValue: { fontSize: 15, fontFamily: "Inter_700Bold" },
  progressLabel: { fontSize: 12, fontFamily: "Inter_500Medium", marginBottom: 6 },
  progressBg: { height: 6, borderRadius: 3, overflow: "hidden" },
  progressFill: { height: 6, borderRadius: 3 },
});
