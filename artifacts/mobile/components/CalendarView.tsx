import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { DailyBalance, DecisionRecord, Goal, GoalExpense, Transaction } from "@/context/BudgetContext";
import { scenarioDates } from "@/lib/decisions";

const DAY_NAMES = ["S", "M", "T", "W", "T", "F", "S"];

const CALENDAR = {
  surface: "#ffffff",
  line: "#d1d5db",
  text: "#111827",
  muted: "#6b7280",
  faded: "#9ca3af",
  selected: "#e5e7eb",
  today: "#111827",
  green: "#059669",
  amber: "#d97706",
  red: "#dc2626",
};

type ChipKind = "income" | "bill" | "expense" | "goal" | "plan" | "risk";

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

function chipPalette(kind: ChipKind) {
  if (kind === "income") return { bg: "#d1fae5", border: "#10b981", text: "#064e3b" };
  if (kind === "bill") return { bg: "#fef3c7", border: "#f59e0b", text: "#78350f" };
  if (kind === "goal") return { bg: "#ede9fe", border: "#8b5cf6", text: "#4c1d95" };
  if (kind === "plan") return { bg: "#dbeafe", border: "#3b82f6", text: "#1e3a8a" };
  if (kind === "risk") return { bg: "#fee2e2", border: "#ef4444", text: "#7f1d1d" };
  return { bg: "#fce7f3", border: "#ec4899", text: "#831843" };
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
      <View style={styles.dayNames}>
        {DAY_NAMES.map((d, index) => (
          <Text key={`${d}-${index}`} style={styles.dayName}>{d}</Text>
        ))}
      </View>

      <View style={styles.grid}>
        {cells.map((day, i) => {
          if (!day) return <View key={`empty-${i}`} style={[styles.cell, styles.emptyCell]} />;
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
          const chips: { label: string; kind: ChipKind }[] = [];

          if (db && db.scheduledIncome > 0) chips.push({ label: "Payday", kind: "income" });
          dayTxs.filter(tx => tx.amount > 0).slice(0, 1).forEach(tx => chips.push({ label: `${tx.note || tx.category} +$${fmt(tx.amount)}`, kind: "income" }));
          if (db && db.bills > 0) chips.push({ label: `Bills $${fmt(db.bills)}`, kind: "bill" });
          dayTxs.filter(tx => tx.amount < 0).slice(0, 2).forEach(tx => chips.push({ label: `${tx.note || tx.category} -$${fmt(tx.amount)}`, kind: "expense" }));
          calendarGoals.slice(0, 2).forEach(goal => chips.push({ label: goal.name, kind: "goal" }));
          if (decisionAmount > 0) chips.push({ label: `Plan $${fmt(decisionAmount)}`, kind: "plan" });
          if (isLowRiskDay) chips.push({ label: db && db.balance < 0 ? "Negative" : "Low balance", kind: "risk" });

          const visibleChips = chips.slice(0, 2);
          const hiddenCount = chips.length - visibleChips.length;

          return (
            <Pressable
              key={ds}
              onPress={() => onDayPress(ds)}
              style={({ pressed }) => [
                styles.cell,
                isSelected ? styles.selectedCell : null,
                { opacity: pressed ? 0.72 : 1 },
              ]}
            >
              <View style={styles.dayTopRow}>
                <View style={isToday ? styles.todayCircle : undefined}>
                  <Text
                    style={[
                      styles.dayNum,
                      {
                        color: isToday ? "#ffffff" : CALENDAR.text,
                        fontFamily: isToday || isSelected ? "Inter_700Bold" : "Inter_500Medium",
                      },
                    ]}
                  >
                    {day}
                  </Text>
                </View>
                {db ? (
                  <Text
                    style={[
                      styles.balanceText,
                      { color: db.balance >= safetyFloor ? CALENDAR.green : db.balance < 0 ? CALENDAR.red : CALENDAR.amber },
                    ]}
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
                {hiddenCount > 0 ? <Text style={styles.moreText}>+{hiddenCount} more</Text> : null}
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: 10, backgroundColor: CALENDAR.surface, borderRadius: 22, overflow: "hidden" },
  dayNames: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: CALENDAR.line, paddingTop: 12, paddingBottom: 8 },
  dayName: { flex: 1, textAlign: "center", fontSize: 12, fontFamily: "Inter_600SemiBold", color: CALENDAR.muted },
  grid: { flexDirection: "row", flexWrap: "wrap", backgroundColor: CALENDAR.surface },
  cell: {
    width: "14.285714%",
    minHeight: 104,
    paddingTop: 7,
    paddingHorizontal: 3,
    paddingBottom: 6,
    borderTopWidth: 1,
    borderTopColor: CALENDAR.line,
    backgroundColor: CALENDAR.surface,
  },
  selectedCell: { backgroundColor: "#f9fafb", borderColor: CALENDAR.selected, borderWidth: 1, borderRadius: 12 },
  emptyCell: { opacity: 0.35 },
  dayTopRow: { alignItems: "center", gap: 2 },
  todayCircle: { minWidth: 22, height: 22, borderRadius: 7, alignItems: "center", justifyContent: "center", paddingHorizontal: 6, backgroundColor: CALENDAR.today },
  dayNum: { fontSize: 14 },
  balanceText: { fontSize: 8, fontFamily: "Inter_700Bold" },
  eventStack: { marginTop: 9, gap: 4 },
  eventChip: { borderLeftWidth: 3, borderRadius: 4, minHeight: 18, paddingHorizontal: 3, paddingVertical: 2 },
  eventChipText: { fontSize: 8, fontFamily: "Inter_700Bold" },
  moreText: { fontSize: 8, fontFamily: "Inter_600SemiBold", textAlign: "center", color: CALENDAR.faded },
});
