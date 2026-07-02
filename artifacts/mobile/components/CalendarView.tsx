import React from "react";
import { Feather } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { DailyBalance, DecisionRecord, Goal, GoalExpense, Transaction } from "@/context/BudgetContext";
import { scenarioDates } from "@/lib/decisions";

const DAY_NAMES = ["S", "M", "T", "W", "T", "F", "S"];
const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];

const CALENDAR = {
  surface: "#2f3043",
  cell: "#303144",
  adjacentCell: "#292a3b",
  selectedCell: "#383a52",
  line: "rgba(226,232,240,0.20)",
  text: "#f8fafc",
  muted: "#cbd5e1",
  faded: "#8b91a7",
  selected: "rgba(226,232,240,0.42)",
  today: "#0f172a",
  green: "#6ee7b7",
  amber: "#facc15",
  red: "#fb7185",
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
  onPreviousMonth?: () => void;
  onNextMonth?: () => void;
  onAddPress?: () => void;
}

function fmt(n: number) {
  const abs = Math.abs(n);
  if (abs >= 1000) return abs.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return abs.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function chipPalette(kind: ChipKind) {
  if (kind === "income") return { bg: "#064e3b", border: "#34d399", text: "#d1fae5" };
  if (kind === "bill") return { bg: "#451a03", border: "#f59e0b", text: "#fef3c7" };
  if (kind === "goal") return { bg: "#312e81", border: "#a78bfa", text: "#ede9fe" };
  if (kind === "plan") return { bg: "#1e3a8a", border: "#60a5fa", text: "#dbeafe" };
  if (kind === "risk") return { bg: "#7f1d1d", border: "#fb7185", text: "#fee2e2" };
  return { bg: "#831843", border: "#f472b6", text: "#fce7f3" };
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
  onPreviousMonth,
  onNextMonth,
  onAddPress,
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

  const previousMonthDays = new Date(year, month, 0).getDate();
  const cells: { day: number; current: boolean }[] = [];
  for (let i = 0; i < firstDay; i += 1) cells.push({ day: previousMonthDays - firstDay + i + 1, current: false });
  for (let d = 1; d <= daysInMonth; d += 1) cells.push({ day: d, current: true });
  let nextDay = 1;
  while (cells.length < 42) {
    cells.push({ day: nextDay, current: false });
    nextDay += 1;
  }

  const dateStr = (day: number) =>
    `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  return (
    <View style={styles.container}>
      <View style={styles.calendarHeader}>
        <Text style={styles.monthTitle}>{MONTH_NAMES[month]}</Text>
        <View style={styles.headerActions}>
          <Pressable onPress={onPreviousMonth} disabled={!onPreviousMonth} hitSlop={12} style={({ pressed }) => [styles.headerIcon, { opacity: pressed ? 0.55 : 1 }]}>
            <Feather name="chevron-left" size={24} color={CALENDAR.muted} />
          </Pressable>
          <Pressable onPress={onNextMonth} disabled={!onNextMonth} hitSlop={12} style={({ pressed }) => [styles.headerIcon, { opacity: pressed ? 0.55 : 1 }]}>
            <Feather name="chevron-right" size={24} color={CALENDAR.muted} />
          </Pressable>
          <Pressable onPress={onAddPress} disabled={!onAddPress} style={({ pressed }) => [styles.addButton, { opacity: pressed ? 0.78 : 1 }]}>
            <Feather name="plus" size={26} color="#101326" />
          </Pressable>
        </View>
      </View>

      <View style={styles.dayNames}>
        {DAY_NAMES.map((d, index) => (
          <Text key={`${d}-${index}`} style={styles.dayName}>{d}</Text>
        ))}
      </View>

      <View style={styles.grid}>
        {cells.map((cell, i) => {
          const { day, current } = cell;
          const ds = dateStr(day);
          const isToday = current && ds === todayStr;
          const isSelected = current && ds === selectedDate;
          const db = current ? balanceByDay[day] : undefined;
          const dayTxs = current ? txByDay[day] ?? [] : [];
          const billEvents = (db?.events ?? [])
            .filter(event => event.amount < 0 && (event.sourceType === "bill" || event.kind === "bill"))
            .slice(0, 3);
          const calendarGoals = [...(db?.goalExpenses ?? [])];
          (goalsByDay[day] ?? []).forEach(goal => {
            if (!calendarGoals.some(existing => existing.id === goal.id)) calendarGoals.push(goal);
          });

          const decisionAmount = current ? decisionsByDay[day] ?? 0 : 0;
          const isLowRiskDay = Boolean(db && db.balance < safetyFloor);
          const chips: { label: string; kind: ChipKind }[] = [];

          if (db && db.scheduledIncome > 0) chips.push({ label: "Payday", kind: "income" });
          dayTxs.filter(tx => tx.amount > 0).slice(0, 1).forEach(tx => chips.push({ label: `${tx.note || tx.category} +$${fmt(tx.amount)}`, kind: "income" }));
          if (billEvents.length > 0) billEvents.forEach(event => chips.push({ label: event.name || `Bill $${fmt(Math.abs(event.amount))}`, kind: "bill" }));
          else if (db && db.bills > 0) chips.push({ label: `Bills $${fmt(db.bills)}`, kind: "bill" });
          dayTxs.filter(tx => tx.amount < 0).slice(0, 2).forEach(tx => chips.push({ label: `${tx.note || tx.category} -$${fmt(tx.amount)}`, kind: "expense" }));
          calendarGoals.slice(0, 2).forEach(goal => chips.push({ label: goal.name, kind: "goal" }));
          if (decisionAmount > 0) chips.push({ label: `Plan $${fmt(decisionAmount)}`, kind: "plan" });
          if (isLowRiskDay) chips.push({ label: db && db.balance < 0 ? "Negative" : "Low balance", kind: "risk" });

          const visibleChips = chips.slice(0, 2);
          const hiddenCount = chips.length - visibleChips.length;

          return (
            <Pressable
              key={`${current ? "current" : "adjacent"}-${i}-${day}`}
              disabled={!current}
              onPress={() => onDayPress(ds)}
              style={({ pressed }) => [
                styles.cell,
                !current ? styles.adjacentCell : null,
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
                        color: !current ? CALENDAR.faded : isToday ? "#ffffff" : CALENDAR.text,
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
  container: { flex: 1, backgroundColor: CALENDAR.surface, borderRadius: 18, overflow: "hidden" },
  calendarHeader: { minHeight: 72, paddingHorizontal: 18, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  monthTitle: { color: CALENDAR.text, fontSize: 21, fontFamily: "Inter_800ExtraBold" },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 12 },
  headerIcon: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  addButton: { width: 76, height: 46, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: "#c7c5ff" },
  dayNames: { flexDirection: "row", borderTopWidth: 1, borderBottomWidth: 1, borderTopColor: CALENDAR.line, borderBottomColor: CALENDAR.line, paddingTop: 6, paddingBottom: 6 },
  dayName: { flex: 1, textAlign: "center", fontSize: 12, fontFamily: "Inter_600SemiBold", color: CALENDAR.muted },
  grid: { flex: 1, flexDirection: "row", flexWrap: "wrap", backgroundColor: CALENDAR.surface },
  cell: {
    width: "14.285714%",
    height: "16.666667%",
    paddingTop: 5,
    paddingHorizontal: 2,
    paddingBottom: 4,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderRightColor: CALENDAR.line,
    borderBottomColor: CALENDAR.line,
    backgroundColor: CALENDAR.cell,
  },
  adjacentCell: { backgroundColor: CALENDAR.adjacentCell },
  selectedCell: { backgroundColor: CALENDAR.selectedCell, borderColor: CALENDAR.selected, borderWidth: 1 },
  dayTopRow: { alignItems: "center", gap: 2 },
  todayCircle: { minWidth: 22, height: 22, borderRadius: 7, alignItems: "center", justifyContent: "center", paddingHorizontal: 6, backgroundColor: CALENDAR.today },
  dayNum: { fontSize: 14, lineHeight: 18 },
  balanceText: { fontSize: 8, fontFamily: "Inter_700Bold" },
  eventStack: { marginTop: 8, gap: 3 },
  eventChip: { borderLeftWidth: 3, borderRadius: 4, minHeight: 17, paddingHorizontal: 3, paddingVertical: 2 },
  eventChipText: { fontSize: 8, lineHeight: 10, fontFamily: "Inter_800ExtraBold" },
  moreText: { fontSize: 8, fontFamily: "Inter_600SemiBold", textAlign: "center", color: CALENDAR.faded },
});
