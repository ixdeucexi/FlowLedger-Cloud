import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { DailyBalance, DecisionRecord, Goal, GoalExpense, Transaction } from "@/context/BudgetContext";
import { useColors } from "@/hooks/useColors";
import { scenarioDates } from "@/lib/decisions";

const DAY_NAMES = ["S", "M", "T", "W", "T", "F", "S"];

interface CalendarViewProps {
  month: number;
  year: number;
  transactions: Transaction[];
  selectedDate: string | null;
  onDayPress: (date: string) => void;
  dailyBalances?: DailyBalance[];
  goals?: Goal[];
  decisions?: DecisionRecord[];
  safetyFloor?: number;
}

function fmt(n: number) {
  const abs = Math.abs(n);
  if (abs >= 1000) return abs.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return abs.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function chipPalette(kind: "income" | "bill" | "expense" | "goal" | "plan" | "risk") {
  if (kind === "income") return { bg: "rgba(34,197,94,0.22)", border: "#22c55e", text: "#bbf7d0" };
  if (kind === "bill") return { bg: "rgba(245,158,11,0.22)", border: "#f59e0b", text: "#fde68a" };
  if (kind === "goal") return { bg: "rgba(139,92,246,0.24)", border: "#8b5cf6", text: "#ddd6fe" };
  if (kind === "plan") return { bg: "rgba(59,130,246,0.22)", border: "#3b82f6", text: "#bfdbfe" };
  if (kind === "risk") return { bg: "rgba(239,68,68,0.20)", border: "#ef4444", text: "#fecaca" };
  return { bg: "rgba(244,114,182,0.20)", border: "#fb7185", text: "#fecdd3" };
}

export function CalendarView({
  month,
  year,
  transactions,
  selectedDate,
  onDayPress,
  dailyBalances,
  goals = [],
  decisions = [],
  safetyFloor = 200,
}: CalendarViewProps) {
  const c = useColors();

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  const txByDay: Record<number, Transaction[]> = {};
  transactions.forEach(tx => {
    const [txYear, txMonth, txDay] = tx.date.split("-").map(Number);
    if (txMonth - 1 === month && txYear === year) {
      if (!txByDay[txDay]) txByDay[txDay] = [];
      txByDay[txDay].push(tx);
    }
  });

  const balanceByDay: Record<number, DailyBalance> = {};
  dailyBalances?.forEach(db => { balanceByDay[db.day] = db; });

  const goalsByDay: Record<number, GoalExpense[]> = {};
  goals.forEach(goal => {
    if (!goal.target_date) return;
    const [targetYear, targetMonth, targetDay] = goal.target_date.split("T")[0].split("-").map(Number);
    if (targetYear !== year || targetMonth - 1 !== month || !Number.isFinite(targetDay)) return;
    const target = Number(goal.target_amount) || 0;
    const saved = Math.max(0, Number(goal.current_amount) || 0);
    const remaining = goal.calendar_marker_only ? target : Math.max(0, target - saved);
    if (remaining <= 0 && !goal.calendar_marker_only) return;
    if (!goalsByDay[targetDay]) goalsByDay[targetDay] = [];
    goalsByDay[targetDay].push({ id: goal.id, name: goal.name, amount: remaining });
  });

  const decisionsByDay: Record<number, number> = {};
  const monthPrefix = `${year}-${String(month + 1).padStart(2, "0")}`;
  const monthEnd = `${monthPrefix}-${String(daysInMonth).padStart(2, "0")}`;
  decisions
    .filter(decision => decision.status === "planned" || decision.status === "calendar")
    .forEach(decision => {
      scenarioDates(decision.scenario, monthEnd).filter(date => date.startsWith(monthPrefix)).forEach(date => {
        const day = Number(date.slice(8, 10));
        decisionsByDay[day] = (decisionsByDay[day] ?? 0) + Math.abs(decision.scenario.amount);
      });
    });

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i += 1) cells.push(null);
  for (let d = 1; d <= daysInMonth; d += 1) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const dateStr = (day: number) =>
    `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  return (
    <View style={styles.container}>
      <View style={[styles.dayNames, { borderBottomColor: c.border }]}>
        {DAY_NAMES.map((d, index) => (
          <Text key={`${d}-${index}`} style={[styles.dayName, { color: c.mutedForeground }]}>{d}</Text>
        ))}
      </View>

      <View style={styles.grid}>
        {cells.map((day, i) => {
          if (!day) return <View key={`empty-${i}`} style={[styles.cell, styles.emptyCell, { borderColor: c.border }]} />;
          const ds = dateStr(day);
          const isToday = ds === todayStr;
          const isSelected = ds === selectedDate;
          const db = balanceByDay[day];
          const dayTxs = txByDay[day] ?? [];
          const calendarGoals = [...(db?.goalExpenses ?? [])];
          (goalsByDay[day] ?? []).forEach(goal => {
            if (!calendarGoals.some(existing => existing.id === goal.id)) calendarGoals.push(goal);
          });
          const decisionAmount = decisionsByDay[day] ?? 0;
          const isLowRiskDay = Boolean(db && db.balance < safetyFloor);
          const chips: { label: string; kind: "income" | "bill" | "expense" | "goal" | "plan" | "risk" }[] = [];

          if (db && db.scheduledIncome > 0) chips.push({ label: `Payday $${fmt(db.scheduledIncome)}`, kind: "income" });
          dayTxs.filter(tx => tx.amount > 0).slice(0, 1).forEach(tx => chips.push({ label: `${tx.note || tx.category} +$${fmt(tx.amount)}`, kind: "income" }));
          if (db && db.bills > 0) chips.push({ label: `Bills $${fmt(db.bills)}`, kind: "bill" });
          dayTxs.filter(tx => tx.amount < 0).slice(0, 2).forEach(tx => chips.push({ label: `${tx.note || tx.category} -$${fmt(tx.amount)}`, kind: "expense" }));
          calendarGoals.slice(0, 2).forEach(goal => chips.push({ label: `★ ${goal.name}`, kind: "goal" }));
          if (decisionAmount > 0) chips.push({ label: `Plan $${fmt(decisionAmount)}`, kind: "plan" });
          if (isLowRiskDay) chips.push({ label: db && db.balance < 0 ? "Negative balance" : "Low balance", kind: "risk" });

          const visibleChips = chips.slice(0, 3);
          const hiddenCount = chips.length - visibleChips.length;

          return (
            <Pressable
              key={ds}
              onPress={() => onDayPress(ds)}
              style={({ pressed }) => [
                styles.cell,
                {
                  borderColor: c.border,
                  backgroundColor: isSelected ? c.card : isToday ? c.primary + "08" : "transparent",
                  opacity: pressed ? 0.75 : 1,
                  shadowColor: isSelected ? c.primary : "transparent",
                  shadowOpacity: isSelected ? 0.25 : 0,
                  shadowRadius: isSelected ? 8 : 0,
                },
                isSelected ? { borderWidth: 1.5, borderRadius: 14 } : null,
              ]}
            >
              <View style={styles.dayTopRow}>
                <View style={isToday ? [styles.todayCircle, { backgroundColor: isSelected ? c.foreground : c.primary }] : undefined}>
                  <Text
                    style={[
                      styles.dayNum,
                      {
                        color: isToday ? c.primaryForeground : isSelected ? c.primary : c.foreground,
                        fontFamily: isToday || isSelected ? "Inter_700Bold" : "Inter_500Medium",
                      },
                    ]}
                  >
                    {day}
                  </Text>
                </View>
                {db ? (
                  <Text
                    style={[styles.balanceText, { color: db.balance >= safetyFloor ? c.success : db.balance < 0 ? c.destructive : c.warning }]}
                    numberOfLines={1}
                  >
                    ${fmt(db.balance)}
                  </Text>
                ) : null}
              </View>

              <View style={styles.eventStack}>
                {visibleChips.map((chip, index) => {
                  const palette = chipPalette(chip.kind);
                  return (
                    <View key={`${chip.label}-${index}`} style={[styles.eventChip, { backgroundColor: palette.bg, borderLeftColor: palette.border }]}>
                      <Text style={[styles.eventChipText, { color: palette.text }]} numberOfLines={1}>{chip.label}</Text>
                    </View>
                  );
                })}
                {hiddenCount > 0 ? <Text style={[styles.moreText, { color: c.mutedForeground }]}>+{hiddenCount} more</Text> : null}
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: 10 },
  dayNames: { flexDirection: "row", borderBottomWidth: 1, paddingBottom: 6, marginBottom: 0 },
  dayName: { flex: 1, textAlign: "center", fontSize: 12, fontFamily: "Inter_600SemiBold" },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: {
    width: "14.285714%",
    minHeight: 96,
    paddingTop: 5,
    paddingHorizontal: 3,
    paddingBottom: 4,
    borderTopWidth: 1,
    borderRightWidth: 0.5,
    borderLeftWidth: 0.5,
  },
  emptyCell: { opacity: 0.35 },
  dayTopRow: { alignItems: "center", gap: 1 },
  todayCircle: { minWidth: 22, height: 22, borderRadius: 7, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  dayNum: { fontSize: 14 },
  balanceText: { fontSize: 8, fontFamily: "Inter_700Bold" },
  eventStack: { marginTop: 5, gap: 3 },
  eventChip: { borderLeftWidth: 3, borderRadius: 5, minHeight: 18, paddingHorizontal: 3, paddingVertical: 2 },
  eventChipText: { fontSize: 8, fontFamily: "Inter_700Bold" },
  moreText: { fontSize: 8, fontFamily: "Inter_600SemiBold", textAlign: "center" },
});
