import { Feather } from "@expo/vector-icons";
import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import {
  formatZeroBudgetMonth,
  zeroBudgetLabDailyBalances,
  type ZeroBudgetLabState,
} from "@/lib/zeroBudgetLab";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
interface ZeroBudgetLabMonthlyProps {
  state: ZeroBudgetLabState;
  bottomInset: number;
}

export function ZeroBudgetLabMonthly({
  state,
  bottomInset,
}: ZeroBudgetLabMonthlyProps) {
  const c = useColors();
  const [year, month] = state.selectedMonth.split("-").map(Number);
  const firstDay = new Date(year, month - 1, 1).getDay();
  const days = zeroBudgetLabDailyBalances(state);
  const cells = [...Array.from({ length: firstDay }, () => null), ...days];
  while (cells.length % 7) cells.push(null);

  return (
    <ScrollView
      contentContainerStyle={[
        styles.content,
        { paddingBottom: bottomInset + 112 },
      ]}
    >
      <View
        style={[
          styles.monthHeader,
          { backgroundColor: c.card, borderColor: c.border },
        ]}
      >
        <View style={[styles.icon, { backgroundColor: c.primary + "18" }]}>
          <Feather name="calendar" size={20} color={c.primary} />
        </View>
        <View>
          <Text style={[styles.title, { color: c.foreground }]}>
            {formatZeroBudgetMonth(state.selectedMonth)}
          </Text>
          <Text style={[styles.subtitle, { color: c.mutedForeground }]}>
            Sample proposed daily balances
          </Text>
        </View>
      </View>
      <View
        style={[
          styles.calendar,
          { backgroundColor: c.card, borderColor: c.border },
        ]}
      >
        <View style={styles.weekRow}>
          {WEEKDAYS.map((day, index) => (
            <Text key={`${day}-${index}`} style={styles.weekday}>
              {day}
            </Text>
          ))}
        </View>
        <View style={styles.grid}>
          {cells.map((day, index) => (
            <View
              key={day ? day.day : `empty-${index}`}
              style={[styles.dayCell, { borderColor: c.border }]}
            >
              {day ? (
                <>
                  <Text style={[styles.dayNumber, { color: c.foreground }]}>
                    {day.day}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.dayBalance,
                      {
                        color:
                          day.balance === undefined
                            ? c.mutedForeground
                            : c.success,
                      },
                    ]}
                  >
                    {day.balance === undefined
                      ? ""
                      : `$${Math.round(day.balance).toLocaleString("en-US")}`}
                  </Text>
                  {day.labels.slice(0, 2).map((label) => {
                    const tone =
                      label === "Payday"
                        ? c.success
                        : label.includes("pending")
                          ? c.warning
                          : c.primary;
                    return (
                      <View
                        key={label}
                        style={[
                          styles.event,
                          {
                            backgroundColor: tone + "1C",
                            borderColor: tone + "55",
                          },
                        ]}
                      >
                        <Text
                          numberOfLines={1}
                          style={[styles.eventText, { color: tone }]}
                        >
                          {label}
                        </Text>
                      </View>
                    );
                  })}
                </>
              ) : null}
            </View>
          ))}
        </View>
      </View>
      <View
        style={[
          styles.note,
          { backgroundColor: c.primary + "12", borderColor: c.primary + "35" },
        ]}
      >
        <Feather name="info" size={17} color={c.primary} />
        <Text style={[styles.noteText, { color: c.mutedForeground }]}>
          Dashboard shows the sample bank balance. Monthly shows what may remain
          after dated bills and income. Assigning money alone does not create a
          calendar withdrawal.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 14 },
  monthHeader: {
    borderWidth: 1,
    borderRadius: 21,
    minHeight: 72,
    padding: 13,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  icon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 19, fontFamily: "Inter_800ExtraBold" },
  subtitle: { fontSize: 10, fontFamily: "Inter_500Medium", marginTop: 3 },
  calendar: {
    borderWidth: 1,
    borderRadius: 22,
    overflow: "hidden",
    padding: 8,
  },
  weekRow: { flexDirection: "row", minHeight: 30, alignItems: "center" },
  weekday: {
    width: "14.2857%",
    textAlign: "center",
    color: "#94a3b8",
    fontSize: 10,
    fontFamily: "Inter_800ExtraBold",
  },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  dayCell: {
    width: "14.2857%",
    minHeight: 86,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    padding: 4,
  },
  dayNumber: {
    fontSize: 13,
    fontFamily: "Inter_800ExtraBold",
    textAlign: "center",
  },
  dayBalance: {
    fontSize: 8,
    fontFamily: "Inter_800ExtraBold",
    textAlign: "center",
    marginTop: 3,
  },
  event: {
    borderWidth: 1,
    borderRadius: 5,
    paddingHorizontal: 3,
    paddingVertical: 2,
    marginTop: 3,
  },
  eventText: { fontSize: 6, fontFamily: "Inter_700Bold" },
  note: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 13,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  noteText: {
    flex: 1,
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    lineHeight: 16,
  },
});
