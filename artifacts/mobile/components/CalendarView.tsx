import { Feather } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import colors from "@/constants/colors";
import type { Transaction } from "@/context/BudgetContext";
import { useColors } from "@/hooks/useColors";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface CalendarViewProps {
  month: number;
  year: number;
  transactions: Transaction[];
  onDayPress: (date: string) => void;
}

export function CalendarView({ month, year, transactions, onDayPress }: CalendarViewProps) {
  const c = useColors();

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  const txByDay: Record<number, { income: number; expense: number }> = {};
  transactions.forEach(tx => {
    const d = new Date(tx.date);
    if (d.getMonth() === month && d.getFullYear() === year) {
      const day = d.getDate();
      if (!txByDay[day]) txByDay[day] = { income: 0, expense: 0 };
      if (tx.amount > 0) txByDay[day].income += tx.amount;
      else txByDay[day].expense += Math.abs(tx.amount);
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
          const dayData = txByDay[day];
          return (
            <Pressable
              key={ds}
              onPress={() => onDayPress(ds)}
              style={({ pressed }) => [
                styles.cell,
                styles.dayCell,
                {
                  backgroundColor: isToday ? c.primary + "20" : "transparent",
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <View style={isToday ? [styles.todayCircle, { backgroundColor: c.primary }] : undefined}>
                <Text style={[styles.dayNum, { color: isToday ? c.primaryForeground : c.foreground }]}>{day}</Text>
              </View>
              {dayData ? (
                <View style={styles.dotRow}>
                  {dayData.income > 0 ? <View style={[styles.dot, { backgroundColor: c.success }]} /> : null}
                  {dayData.expense > 0 ? <View style={[styles.dot, { backgroundColor: c.destructive }]} /> : null}
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
  container: { marginBottom: 8 },
  dayNames: { flexDirection: "row", marginBottom: 4 },
  dayName: { flex: 1, textAlign: "center", fontSize: 11, fontFamily: "Inter_500Medium" },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: { width: "14.285714%", aspectRatio: 1, alignItems: "center", justifyContent: "center" },
  dayCell: { borderRadius: 8 },
  todayCircle: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  dayNum: { fontSize: 13, fontFamily: "Inter_500Medium" },
  dotRow: { flexDirection: "row", gap: 2, marginTop: 2 },
  dot: { width: 4, height: 4, borderRadius: 2 },
});
