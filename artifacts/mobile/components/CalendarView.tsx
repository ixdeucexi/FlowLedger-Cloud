import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { DailyBalance, Transaction } from "@/context/BudgetContext";
import { useColors } from "@/hooks/useColors";

const DAY_NAMES = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

interface CalendarViewProps {
  month: number;
  year: number;
  transactions: Transaction[];
  selectedDate: string | null;
  onDayPress: (date: string) => void;
  dailyBalances?: DailyBalance[];
}

function fmt(n: number, compact = true) {
  const abs = Math.abs(n);
  if (!compact) return abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function CalendarView({ month, year, transactions, selectedDate, onDayPress, dailyBalances }: CalendarViewProps) {
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

          const net = (dayData ? dayData.income - dayData.expense : 0) - (db ? db.bills : 0);
          const hasActivity = dayData || (db && db.bills > 0);

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
                    : "transparent",
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
          { color: c.success, label: "+ income" },
          { color: c.destructive, label: "- expense" },
          { color: c.warning, label: "↓ bill due" },
        ].map(l => (
          <View key={l.label} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: l.color }]} />
            <Text style={[styles.legendText, { color: c.mutedForeground }]}>{l.label}</Text>
          </View>
        ))}
        {dailyBalances && (
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: c.success }]} />
            <Text style={[styles.legendText, { color: c.mutedForeground }]}>balance</Text>
          </View>
        )}
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
  legendDot: { width: 6, height: 6, borderRadius: 3 },
  legendText: { fontSize: 10, fontFamily: "Inter_400Regular" },
});
