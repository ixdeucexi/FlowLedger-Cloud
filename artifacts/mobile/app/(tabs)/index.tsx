import { Feather } from "@expo/vector-icons";
import React, { useMemo } from "react";
import { Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { DonutChart, MiniChart } from "@/components/MiniChart";
import { StatCard } from "@/components/StatCard";
import { useBudget } from "@/context/BudgetContext";
import { useColors } from "@/hooks/useColors";

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export default function DashboardScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { bills, monthlyEntries, selectedYear } = useBudget();
  const currentMonth = new Date().getMonth();

  const stats = useMemo(() => {
    const currentEntries = monthlyEntries.filter(
      e => e.month === currentMonth && e.year === selectedYear
    );
    const totalMonthly = currentEntries.reduce((sum, e) => {
      const bill = bills.find(b => b.id === e.billId);
      return sum + (bill?.amount ?? 0);
    }, 0);
    const totalPaid = currentEntries.reduce((sum, e) => sum + e.paidAmount, 0);
    const totalRemaining = totalMonthly - totalPaid;
    const paidCount = currentEntries.filter(e => e.paid).length;
    const totalBills = bills.length;

    return { totalMonthly, totalPaid, totalRemaining, paidCount, totalBills, currentEntries };
  }, [bills, monthlyEntries, currentMonth, selectedYear]);

  const monthlyData = useMemo(() => {
    return MONTH_NAMES.map((label, i) => {
      const entries = monthlyEntries.filter(e => e.month === i && e.year === selectedYear);
      const total = entries.reduce((sum, e) => {
        const bill = bills.find(b => b.id === e.billId);
        return sum + (bill?.amount ?? 0);
      }, 0);
      return { label, value: total };
    });
  }, [bills, monthlyEntries, selectedYear]);

  const categoryData = useMemo(() => {
    const catMap: Record<string, number> = {};
    bills.forEach(b => {
      const cat = b.category || "Other";
      catMap[cat] = (catMap[cat] || 0) + b.amount;
    });
    const catColors: Record<string, string> = {
      Housing: "#0f9b8e",
      Utilities: "#f0b429",
      Insurance: "#6366f1",
      Transportation: "#ec4899",
      Food: "#f97316",
      Entertainment: "#8b5cf6",
      Health: "#ef4444",
      Education: "#3b82f6",
      Savings: "#22c55e",
      Debt: "#e11d48",
      Other: "#94a3b8",
    };
    return Object.entries(catMap)
      .map(([label, value]) => ({
        label,
        value,
        color: catColors[label] ?? c.primary,
      }))
      .sort((a, b) => b.value - a.value);
  }, [bills, c.primary]);

  const webTopPad = Platform.OS === "web" ? 67 : 0;

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: c.background }]}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + 16 + webTopPad, paddingBottom: insets.bottom + 100 },
      ]}
      showsVerticalScrollIndicator={false}
    >
      <Text style={[styles.greeting, { color: c.foreground }]}>
        Budget Overview
      </Text>
      <Text style={[styles.subtitle, { color: c.mutedForeground }]}>
        {MONTH_NAMES[currentMonth]} {selectedYear}
      </Text>

      <View style={styles.statsRow}>
        <StatCard
          title="Total Bills"
          value={`$${stats.totalMonthly.toFixed(0)}`}
          icon="dollar-sign"
          color={c.primary}
          subtitle={`${stats.totalBills} bills`}
        />
        <StatCard
          title="Paid"
          value={`$${stats.totalPaid.toFixed(0)}`}
          icon="check-circle"
          color={(c as any).success ?? "#2ecc71"}
          subtitle={`${stats.paidCount} of ${stats.currentEntries.length}`}
        />
      </View>
      <View style={styles.statsRow}>
        <StatCard
          title="Remaining"
          value={`$${stats.totalRemaining.toFixed(0)}`}
          icon="alert-circle"
          color={stats.totalRemaining > 0 ? (c as any).warning ?? "#f0b429" : (c as any).success ?? "#2ecc71"}
        />
        <StatCard
          title="Progress"
          value={
            stats.totalMonthly > 0
              ? `${Math.round((stats.totalPaid / stats.totalMonthly) * 100)}%`
              : "0%"
          }
          icon="trending-up"
          color="#6366f1"
        />
      </View>

      {stats.totalMonthly > 0 ? (
        <View style={styles.progressBarContainer}>
          <View style={[styles.progressBarBg, { backgroundColor: c.muted }]}>
            <View
              style={[
                styles.progressBarFill,
                {
                  backgroundColor: c.primary,
                  width: `${Math.min((stats.totalPaid / stats.totalMonthly) * 100, 100)}%` as any,
                },
              ]}
            />
          </View>
        </View>
      ) : null}

      <MiniChart data={monthlyData} title="Monthly Expenses" height={130} />

      {categoryData.length > 0 ? (
        <DonutChart segments={categoryData} title="By Category" size={90} />
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
  },
  greeting: {
    fontSize: 26,
    fontFamily: "Inter_700Bold",
  },
  subtitle: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    marginTop: 4,
    marginBottom: 20,
  },
  statsRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 12,
  },
  progressBarContainer: {
    marginBottom: 16,
  },
  progressBarBg: {
    height: 6,
    borderRadius: 3,
    overflow: "hidden",
  },
  progressBarFill: {
    height: 6,
    borderRadius: 3,
  },
});
