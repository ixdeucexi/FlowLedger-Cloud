import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { Transaction } from "@/context/BudgetContext";
import { useColors } from "@/hooks/useColors";

const DAY_NAMES = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

interface CalendarViewProps {
  month: number;
  year: number;
  transactions: Transaction[];
  selectedDate: string | null;
  onDayPress: (date: string) => void;
}

function fmt(n: number) {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  if (n >= 100) return n.toFixed(0);
  return n.toFixed(0);
}

export function CalendarView({ month, year, transactions, selectedDate, onDayPress }: CalendarViewProps) {
  const c = useColors();

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  const txByDay: Record<number, { income: number; expense: number; count: number }> = {};
  transactions.forEach(tx => {
    const d = new Date(tx.date);
    if (d.getMonth() === month && d.getFullYear() === year) {
      const day = d.getDate();
      if (!txByDay[day]) txByDay[day] = { income: 0, expense: 0, count: 0 };
      if (tx.amount > 0) txByDay[day].income += tx.amount;
      else txByDay[day].expense += Math.abs(tx.amount);
      txByDay[day].count++;
    }
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
          const net = dayData ? dayData.income - dayData.expense : 0;

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
              {dayData ? (
                <View style={styles.amountsCol}>
                  {dayData.income > 0 && (
                    <Text style={[styles.amtText, { color: c.success }]} numberOfLines={1}>
                      +{fmt(dayData.income)}
                    </Text>
                  )}
                  {dayData.expense > 0 && (
                    <Text style={[styles.amtText, { color: c.destructive }]} numberOfLines={1}>
                      -{fmt(dayData.expense)}
                    </Text>
                  )}
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: 4 },
  dayNames: { flexDirection: "row", marginBottom: 2 },
  dayName: { flex: 1, textAlign: "center", fontSize: 10, fontFamily: "Inter_500Medium" },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: { width: "14.285714%", minHeight: 54, alignItems: "center", paddingTop: 4, paddingBottom: 4 },
  todayCircle: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  dayNum: { fontSize: 13 },
  amountsCol: { alignItems: "center", marginTop: 1 },
  amtText: { fontSize: 9, fontFamily: "Inter_600SemiBold" },
});
