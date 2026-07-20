import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import type { DailyBalance, DecisionRecord, Goal, GoalExpense, Transaction } from "@/context/BudgetContext";
import { useColors } from "@/hooks/useColors";
import { isConfirmedBillMatch } from "@/lib/billMatching";
import { allocationLabel, groupPlannedExpenseAllocations } from "@/lib/reviewCenter";
import { scenarioDates } from "@/lib/decisions";

const DAY_NAMES = ["S", "M", "T", "W", "T", "F", "S"];

const CALENDAR = {
  surface: "rgba(4,8,22,0.70)",
  cell: "rgba(8,13,30,0.42)",
  selectedCell: "rgba(124,58,237,0.22)",
  line: "rgba(168,85,247,0.16)",
  text: "#f8fafc",
  muted: "#a7b0c3",
  faded: "#64748b",
  selected: "#a855f7",
  today: "#7c3aed",
  green: "#22c55e",
  amber: "#fbbf24",
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
  startDate?: string;
}

function fmt(n: number) {
  const abs = Math.abs(n);
  if (abs >= 1000) return abs.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return abs.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtBalance(n: number) {
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function chipPalette(kind: ChipKind, isDark: boolean) {
  if (!isDark) {
    if (kind === "income") return { bg: "#dcfce7", border: "#22c55e", text: "#166534" };
    if (kind === "bill") return { bg: "#fef3c7", border: "#f59e0b", text: "#92400e" };
    if (kind === "goal") return { bg: "#f3e8ff", border: "#a855f7", text: "#6b21a8" };
    if (kind === "plan") return { bg: "#dbeafe", border: "#3b82f6", text: "#1d4ed8" };
    if (kind === "risk") return { bg: "#ffe4e6", border: "#fb7185", text: "#be123c" };
    return { bg: "#ede9fe", border: "#8b5cf6", text: "#5b21b6" };
  }
  if (kind === "income") return { bg: "rgba(34,197,94,0.18)", border: "rgba(34,197,94,0.78)", text: "#bbf7d0" };
  if (kind === "bill") return { bg: "rgba(245,158,11,0.18)", border: "rgba(245,158,11,0.82)", text: "#fde68a" };
  if (kind === "goal") return { bg: "rgba(168,85,247,0.20)", border: "rgba(168,85,247,0.82)", text: "#e9d5ff" };
  if (kind === "plan") return { bg: "rgba(59,130,246,0.20)", border: "rgba(96,165,250,0.86)", text: "#bfdbfe" };
  if (kind === "risk") return { bg: "rgba(244,63,94,0.20)", border: "rgba(251,113,133,0.90)", text: "#fecdd3" };
  return { bg: "rgba(139,92,246,0.20)", border: "rgba(167,139,250,0.80)", text: "#ddd6fe" };
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
  startDate,
}: CalendarViewProps) {
  const c = useColors();
  const calendarTheme = c.isDark
    ? {
        surface: CALENDAR.surface,
        cell: CALENDAR.cell,
        selectedCell: CALENDAR.selectedCell,
        selectedBorder: "rgba(216,180,254,0.75)",
        todayCell: "rgba(30,41,59,0.72)",
        line: CALENDAR.line,
        text: CALENDAR.text,
        muted: CALENDAR.muted,
        faded: CALENDAR.faded,
        today: CALENDAR.today,
        green: CALENDAR.green,
        amber: CALENDAR.amber,
        red: CALENDAR.red,
        shadow: "#7c3aed",
      }
    : {
        surface: "rgba(255,255,255,0.90)",
        cell: "rgba(255,255,255,0.86)",
        selectedCell: "rgba(37,99,235,0.10)",
        selectedBorder: "rgba(37,99,235,0.42)",
        todayCell: "rgba(239,246,255,0.98)",
        line: "rgba(15,23,42,0.10)",
        text: c.foreground,
        muted: c.mutedForeground,
        faded: "#94a3b8",
        today: c.primary,
        green: c.success,
        amber: c.warning,
        red: c.destructive,
        shadow: "#93c5fd",
      };
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
  const hasSixRows = cells.length / 7 > 5;

  const dateStr = (day: number) =>
    `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: calendarTheme.surface,
          borderColor: c.isDark ? "rgba(168,85,247,0.22)" : "rgba(15,23,42,0.10)",
          shadowColor: calendarTheme.shadow,
        },
      ]}
    >
      <View style={[styles.dayNames, { borderBottomColor: calendarTheme.line }]}>
        {DAY_NAMES.map((d, index) => (
          <Text key={`${d}-${index}`} style={[styles.dayName, { color: calendarTheme.muted }]}>{d}</Text>
        ))}
      </View>

      <ScrollView
        scrollEnabled={hasSixRows}
        showsVerticalScrollIndicator={hasSixRows}
        nestedScrollEnabled
        style={hasSixRows ? styles.gridScroll : undefined}
        contentContainerStyle={hasSixRows ? styles.gridScrollContent : undefined}
      >
      <View style={[styles.grid, { backgroundColor: calendarTheme.surface }]}>
        {cells.map((day, i) => {
          if (!day) return <View key={`empty-${i}`} style={[styles.cellOuter, styles.emptyCell, { borderColor: calendarTheme.line }]} />;
          const ds = dateStr(day);
          const isBeforeStart = Boolean(startDate && ds < startDate);
          const isToday = ds === todayStr;
          const isSelected = ds === selectedDate;
          const db = isBeforeStart ? undefined : balanceByDay[day];
          const dayTxs = isBeforeStart ? [] : (txByDay[day] ?? []);
          const plannedExpenseGroups = groupPlannedExpenseAllocations(dayTxs);
          const groupedPlannedExpenseTransactionIds = new Set(plannedExpenseGroups.flatMap(group => group.transactionIds));
          const ungroupedDayTxs = dayTxs.filter(transaction => !groupedPlannedExpenseTransactionIds.has(transaction.id));
          const billEvents = (db?.events ?? [])
            .filter(event => event.amount < 0 && (event.sourceType === "bill" || event.kind === "bill"))
            .slice(0, 3);
          const calendarGoals = [...(db?.goalExpenses ?? [])];
          (isBeforeStart ? [] : (goalsByDay[day] ?? [])).forEach(goal => {
            if (!calendarGoals.some(existing => existing.id === goal.id)) calendarGoals.push(goal);
          });
          const groupedPlannedExpenseIds = new Set(plannedExpenseGroups.map(group => group.targetId));
          const ungroupedCalendarGoals = calendarGoals.filter(goal => !groupedPlannedExpenseIds.has(goal.id));

          const decisionAmount = isBeforeStart ? 0 : (decisionsByDay[day] ?? 0);
          const isLowRiskDay = Boolean(db && db.balance < safetyFloor);
          const chips: { label: string; kind: ChipKind }[] = [];

          if (db && db.scheduledIncome > 0) chips.push({ label: "Payday", kind: "income" });
          ungroupedDayTxs.filter(tx => tx.amount > 0 && tx.review_status !== "transfer").slice(0, 1).forEach(tx => chips.push({ label: `${allocationLabel(tx) || tx.note || tx.category} +$${fmt(tx.amount)}`, kind: "income" }));
          if (billEvents.length > 0) billEvents.forEach(event => chips.push({ label: event.name || `Bill $${fmt(Math.abs(event.amount))}`, kind: "bill" }));
          else if (db && db.bills > 0) chips.push({ label: `Bills $${fmt(db.bills)}`, kind: "bill" });
          plannedExpenseGroups.slice(0, 2).forEach(group => chips.push({ label: group.name, kind: "expense" }));
          ungroupedDayTxs.filter(tx => tx.amount < 0 && tx.review_status !== "transfer").slice(0, 2).forEach(tx => chips.push({
            label: `${allocationLabel(tx) || tx.note || tx.category} -$${fmt(tx.amount)}`,
            kind: isConfirmedBillMatch(tx) ? "bill" : "expense",
          }));
          ungroupedCalendarGoals.slice(0, 2).forEach(goal => chips.push({ label: goal.name, kind: "goal" }));
          if (decisionAmount > 0) chips.push({ label: `Plan $${fmt(decisionAmount)}`, kind: "plan" });
          const bankAdjustment = db?.events?.find(event => event.sourceType === "reconciliation");
          if (bankAdjustment) chips.push({ label: "Bank balance synced", kind: "plan" });
          if (isLowRiskDay) chips.push({ label: db && db.balance < 0 ? "Negative" : "Low balance", kind: "risk" });

          const visibleChips = chips.slice(0, 3);
          const hiddenCount = chips.length - visibleChips.length;

          return (
            <Pressable
              key={ds}
              disabled={isBeforeStart}
              onPress={() => onDayPress(ds)}
              accessibilityRole="button"
              accessibilityLabel={`${ds}. ${db ? `Projected closing balance ${fmtBalance(db.balance)}.` : "No forecast available."}`}
              accessibilityState={{ disabled: isBeforeStart, selected: isSelected }}
              style={({ pressed }) => [
                styles.cellOuter,
                { borderColor: calendarTheme.line },
                { opacity: isBeforeStart ? 0.58 : pressed ? 0.72 : 1 },
              ]}
            >
              <View
                style={[
                  styles.cellInner,
                  { backgroundColor: calendarTheme.cell },
                  isToday ? { backgroundColor: calendarTheme.todayCell } : null,
                  isSelected
                    ? {
                        backgroundColor: calendarTheme.selectedCell,
                        borderWidth: 1,
                        borderColor: calendarTheme.selectedBorder,
                        shadowColor: c.primary,
                        shadowOffset: { width: 0, height: 0 },
                        shadowOpacity: c.isDark ? 0.42 : 0.14,
                        shadowRadius: 14,
                      }
                    : null,
                ]}
              >
                <View style={styles.dayTopRow}>
                  <View style={isToday ? [styles.todayCircle, { backgroundColor: calendarTheme.today }] : undefined}>
                    <Text
                      style={[
                        styles.dayNum,
                        {
                          color: isToday ? "#ffffff" : calendarTheme.text,
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
                        { color: db.balance >= safetyFloor ? calendarTheme.green : db.balance < 0 ? calendarTheme.red : calendarTheme.amber },
                      ]}
                      numberOfLines={1}
                    >
                      {fmtBalance(db.balance)}
                    </Text>
                  ) : null}
                </View>

                <View style={styles.eventStack}>
                  {visibleChips.map((chip, index) => {
                    const palette = chipPalette(chip.kind, c.isDark);
                    return (
                      <View key={`${chip.label}-${index}`} style={[styles.eventChip, { backgroundColor: palette.bg, borderColor: palette.border }]}>
                        <Text style={[styles.eventChipText, { color: palette.text }]} numberOfLines={1}>{chip.label}</Text>
                      </View>
                    );
                  })}
                  {hiddenCount > 0 ? <Text style={[styles.moreText, { color: calendarTheme.faded }]}>+{hiddenCount} more</Text> : null}
                </View>
              </View>
            </Pressable>
          );
        })}
      </View>
      </ScrollView>
      <View style={styles.legendRow}>
        {[
          { label: "Income", color: CALENDAR.green },
          { label: "Bills", color: "#f59e0b" },
          { label: "Spending", color: "#8b5cf6" },
          { label: "Plans", color: "#3b82f6" },
          { label: "Risk", color: calendarTheme.red },
        ].map(item => (
          <View key={item.label} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: item.color }]} />
            <Text style={[styles.legendText, { color: calendarTheme.muted }]}>{item.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 10,
    backgroundColor: CALENDAR.surface,
    borderRadius: 26,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(168,85,247,0.22)",
    padding: 7,
    shadowColor: "#7c3aed",
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.18,
    shadowRadius: 26,
  },
  dayNames: {
    flexDirection: "row",
    paddingTop: 2,
    paddingBottom: 7,
    borderBottomWidth: 1,
    borderBottomColor: CALENDAR.line,
  },
  dayName: { flex: 1, textAlign: "center", fontSize: 11, fontFamily: "Inter_800ExtraBold", color: CALENDAR.muted, letterSpacing: 1.1 },
  gridScroll: { maxHeight: 530 },
  gridScrollContent: { paddingBottom: 6 },
  grid: { flexDirection: "row", flexWrap: "wrap", backgroundColor: CALENDAR.surface },
  cellOuter: {
    width: "14.285714%",
    minHeight: 84,
    padding: 0,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: CALENDAR.line,
  },
  cellInner: {
    flex: 1,
    borderRadius: 0,
    backgroundColor: CALENDAR.cell,
    borderWidth: 0,
    paddingTop: 4,
    paddingHorizontal: 4,
    paddingBottom: 4,
  },
  selectedCell: {
    backgroundColor: "rgba(124,58,237,0.24)",
    borderWidth: 1,
    borderColor: "rgba(216,180,254,0.75)",
    shadowColor: "#8b5cf6",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.42,
    shadowRadius: 14,
  },
  todayCell: { backgroundColor: "rgba(30,41,59,0.72)" },
  emptyCell: { opacity: 0.35 },
  dayTopRow: { alignItems: "center", gap: 1, minHeight: 27 },
  todayCircle: { minWidth: 22, height: 22, borderRadius: 7, alignItems: "center", justifyContent: "center", paddingHorizontal: 6, backgroundColor: CALENDAR.today },
  dayNum: { fontSize: 15 },
  balanceText: { flexShrink: 1, fontSize: 9, fontFamily: "Inter_800ExtraBold" },
  eventStack: { marginTop: 4, gap: 2 },
  eventChip: {
    minHeight: 16,
    justifyContent: "center",
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
    borderWidth: 1,
    borderLeftWidth: 4,
    overflow: "hidden",
  },
  eventChipText: { flex: 1, fontSize: 8, fontFamily: "Inter_800ExtraBold", lineHeight: 11 },
  moreText: { fontSize: 8, fontFamily: "Inter_600SemiBold", textAlign: "center", color: CALENDAR.faded },
  legendRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    columnGap: 10,
    rowGap: 5,
    paddingTop: 7,
    paddingHorizontal: 6,
    paddingBottom: 4,
  },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5, minHeight: 18 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { color: CALENDAR.muted, fontSize: 10, fontFamily: "Inter_700Bold" },
});
