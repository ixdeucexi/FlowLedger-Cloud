import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { DailyBalance, Goal, GoalExpense, Transaction } from "@/context/BudgetContext";
import { useColors } from "@/hooks/useColors";

const DAY_NAMES = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

interface CalendarViewProps {
  month: number;
  year: number;
  transactions: Transaction[];
  selectedDate: string | null;
  onDayPress: (date: string) => void;
  dailyBalances?: DailyBalance[];
  goals?: Goal[];
  safetyFloor?: number;
}

function fmt(n: number, compact = true) {
  const abs = Math.abs(n);
  if (!compact) return abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function CalendarView({ month, year, transactions, selectedDate, onDayPress, dailyBalances, goals = [], safetyFloor = 200 }: CalendarViewProps) {
  const c = useColors();

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  const txByDay: Record<number, { income: number; expense: number; count: number }> = {};
  transactions.forEach(tx => {
    const [txYear, txMonth, txDay] = tx.date.split("-").map(Number);
    if (txMonth - 1 === month && txYear === year) {
      const day = txDay;
      if (!txByDay[day]) txByDay[day] = { income: 0, expense: 0, count: 0 };
      if (tx.amount > 0) txByDay[day].income += tx.amount;
      else txByDay[day].expense += Math.abs(tx.amount);
      txByDay[day].count++;
    }
  });

  const balanceByDay: Record<number, DailyBalance> = {};
  if (dailyBalances) {
    dailyBalances.forEach(db => { balanceByDay[db.day] = db; });
  }

  // Read goal dates directly so calendar markers never depend on projection cache state.
  const goalsByDay: Record<number, GoalExpense[]> = {};
  goals.forEach(goal => {
    if (!goal.target_date) return;
    const [targetYear, targetMonth, targetDay] = goal.target_date.split("T")[0].split("-").map(Number);
    if (targetYear !== year || targetMonth - 1 !== month || !Number.isFinite(targetDay)) return;
    const target = Number(goal.target_amount) || 0;
    const saved = Math.max(0, Number(goal.current_amount) || 0);
    const remaining = goal.calendar_marker_only ? 0 : Math.max(0, target - saved);
    if (remaining <= 0 && !goal.calendar_marker_only) return;
    if (!goalsByDay[targetDay]) goalsByDay[targetDay] = [];
    goalsByDay[targetDay].push({ id: goal.id, name: goal.name, amount: remaining });
  });

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const dateStr = (day: number) =>
    `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  return (
    <View style={styles.container}>
      <View style={styles.dayNames}>
        {DAY_NAMES.map(d => (
          <Text key={d} style={[styles.dayName, { color: c.mutedForeground }]}>{d}</Text>
        ))}
      </View>
      <View style={styles.grid}>
        {cells.map((day, i) => {
          if (!day) return <View key={`empty-${i}`} style={styles.cell} />;
          const ds = dateStr(day);
          const isToday = ds === todayStr;
          const isSelected = ds === selectedDate;
          const dayData = txByDay[day];
          const db = balanceByDay[day];

          const calendarGoals = [...(db?.goalExpenses ?? [])];
          (goalsByDay[day] ?? []).forEach(goal => {
            if (!calendarGoals.some(existing => existing.id === goal.id)) calendarGoals.push(goal);
          });
          const goalTotal = db ? db.goalExpenses.reduce((s, g) => s + g.amount, 0) : 0;
          const net = (dayData ? dayData.income - dayData.expense : 0) - (db ? db.bills : 0) - goalTotal;
          const hasActivity = dayData || calendarGoals.length > 0 || (db && (db.bills > 0 || db.scheduledIncome > 0));

          // Risk tint based on projected balance
          const riskBg = db
            ? db.balance < 0
              ? "rgba(239,68,68,0.13)"
              : db.balance < safetyFloor
              ? "rgba(245,158,11,0.11)"
              : "rgba(34,197,94,0.06)"
            : "transparent";

          return (
            <Pressable
              key={ds}
              onPress={() => onDayPress(ds)}
              style={({ pressed }) => [
                styles.cell,
                {
                  backgroundColor: isSelected
                    ? c.primary + "30"
                    : isToday
                    ? c.primary + "15"
                    : riskBg,
                  opacity: pressed ? 0.75 : 1,
                  borderRadius: 8,
                  borderWidth: isSelected ? 1.5 : 0,
                  borderColor: isSelected ? c.primary : "transparent",
                },
              ]}
            >
              <View style={isToday && !isSelected ? [styles.todayCircle, { backgroundColor: c.primary }] : undefined}>
                <Text style={[styles.dayNum, {
                  color: isToday && !isSelected ? c.primaryForeground : isSelected ? c.primary : c.foreground,
                  fontFamily: isToday || isSelected ? "Inter_700Bold" : "Inter_400Regular",
                }]}>
                  {day}
                </Text>
              </View>

              {hasActivity ? (
                <View style={styles.amountsCol}>
                  {db && db.scheduledIncome > 0 && (
                    <Text style={[styles.amtText, { color: c.success }]} numberOfLines={1}>
                      ↑{fmt(db.scheduledIncome)}
                    </Text>
                  )}
                  {dayData && dayData.income > 0 && (
                    <Text style={[styles.amtText, { color: c.success }]} numberOfLines={1}>
                      +{fmt(dayData.income)}
                    </Text>
                  )}
                  {dayData && dayData.expense > 0 && (
                    <Text style={[styles.amtText, { color: c.destructive }]} numberOfLines={1}>
                      -{fmt(dayData.expense)}
                    </Text>
                  )}
                  {db && db.bills > 0 && (
                    <Text style={[styles.amtText, { color: c.warning }]} numberOfLines={1}>
                      ↓{fmt(db.bills)}
                    </Text>
                  )}
                  {calendarGoals.length > 0 && (
                    <Text style={[styles.amtText, { color: "#8b5cf6" }]} numberOfLines={1}>
                      ★{fmt(calendarGoals.reduce((s, g) => s + g.amount, 0))}
                    </Text>
                  )}
                </View>
              ) : null}

              {db && (
                <Text
                  style={[styles.balanceText, { color: db.balance >= 0 ? c.success + "cc" : c.destructive + "cc" }]}
                  numberOfLines={1}
                >
                  ${fmt(db.balance)}
                </Text>
              )}
            </Pressable>
          );
        })}
      </View>

      <View style={[styles.legend, { borderTopColor: c.border }]}>
        {[
          { color: c.success,     label: "↑ pay day"  },
          { color: c.success,     label: "+ income"   },
          { color: c.destructive, label: "- expense"  },
          { color: c.warning,     label: "↓ bill due" },
          { color: "#8b5cf6",     label: "★ goal"     },
        ].map(l => (
          <View key={l.label} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: l.color }]} />
            <Text style={[styles.legendText, { color: c.mutedForeground }]}>{l.label}</Text>
          </View>
        ))}
        {dailyBalances && [
          { bg: "rgba(34,197,94,0.15)",   label: "safe" },
          { bg: "rgba(245,158,11,0.18)",  label: "low"  },
          { bg: "rgba(239,68,68,0.20)",   label: "neg"  },
        ].map(l => (
          <View key={l.label} style={styles.legendItem}>
            <View style={[styles.legendSwatch, { backgroundColor: l.bg }]} />
            <Text style={[styles.legendText, { color: c.mutedForeground }]}>{l.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: 4 },
  dayNames: { flexDirection: "row", marginBottom: 2 },
  dayName: { flex: 1, textAlign: "center", fontSize: 10, fontFamily: "Inter_500Medium" },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: { width: "14.285714%", minHeight: 72, alignItems: "center", paddingTop: 4, paddingBottom: 4 },
  todayCircle: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  dayNum: { fontSize: 13 },
  amountsCol: { alignItems: "center", marginTop: 1 },
  amtText: { fontSize: 8, fontFamily: "Inter_600SemiBold" },
  balanceText: { fontSize: 7, fontFamily: "Inter_700Bold", marginTop: 1 },
  legend: { flexDirection: "row", justifyContent: "center", gap: 12, paddingTop: 8, marginTop: 4, borderTopWidth: 1, flexWrap: "wrap" },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  legendDot:    { width: 6, height: 6, borderRadius: 3 },
  legendSwatch: { width: 12, height: 10, borderRadius: 3 },
  legendText:   { fontSize: 10, fontFamily: "Inter_400Regular" },
});
