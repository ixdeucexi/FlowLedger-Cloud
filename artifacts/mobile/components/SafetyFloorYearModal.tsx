import React, { useMemo, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useBackDismiss } from "@/hooks/useBackDismiss";
import { useColors } from "@/hooks/useColors";
import { summarizeSafetyFloorYear } from "@/lib/safetyFloorYear";
import type { DailyBalance } from "@/context/BudgetContext";

const money = (value: number) => value.toLocaleString(undefined, { style: "currency", currency: "USD" });
const monthName = (month: number) => new Date(2024, month, 1).toLocaleDateString(undefined, { month: "long" });

type Props = {
  today: string;
  ready: boolean;
  safetyFloor: number;
  startingBalanceDate?: string;
  getDays: (month: number, year: number) => DailyBalance[];
  onClose: () => void;
  onSelectDate: (date: string) => void;
};

/** Mounted only while open, and remounted for each household scope. */
export function SafetyFloorYearModal({ today, ready, safetyFloor, startingBalanceDate, getDays, onClose, onSelectDate }: Props) {
  const c = useColors();
  const currentYear = Number(today.slice(0, 4));
  const [chosenYear, setChosenYear] = useState(currentYear);
  const year = Math.max(currentYear, Math.min(currentYear + 1, chosenYear));
  const [expandedMonth, setExpandedMonth] = useState<number | null>(null);
  useBackDismiss(true, onClose);
  const months = useMemo(() => ready ? summarizeSafetyFloorYear({ year, today, safetyFloor, startingBalanceDate, getDays }) : [], [ready, year, today, safetyFloor, startingBalanceDate, getDays]);
  const totals = months.reduce((sum, month) => ({ recorded: sum.recorded + month.recorded, projected: sum.projected + month.projected, unavailable: sum.unavailable + month.unavailable, low: sum.low + month.days.length }), { recorded: 0, projected: 0, unavailable: 0, low: 0 });
  return <Modal visible transparent animationType="fade" onRequestClose={onClose}>
    <View style={styles.overlay}>
      <Pressable accessibilityLabel="Close safety floor days" style={StyleSheet.absoluteFill} onPress={onClose} />
      <View style={[styles.card, { backgroundColor: c.background }]}>
        <View style={styles.row}><Text accessibilityRole="header" style={[styles.title, { color: c.foreground }]}>Safety floor days</Text><Pressable accessibilityRole="button" accessibilityLabel="Close safety floor days" onPress={onClose}><Text style={{ color: c.primary, padding: 8 }}>Close</Text></Pressable></View>
        <Text style={[styles.copy, { color: c.mutedForeground }]}>{ready ? `Every available day below your ${money(safetyFloor)} floor. Projections follow your current plan and may change. Past days need a recorded checking close.` : "Your household’s safety floor days will appear when its plan is ready."}</Text>
        <View style={styles.row}>
          {[currentYear, currentYear + 1].map(option => <Pressable key={option} accessibilityRole="button" accessibilityState={{ selected: year === option }} onPress={() => { setChosenYear(option); setExpandedMonth(null); }} style={[styles.year, { borderColor: year === option ? c.primary : c.border }]}><Text style={{ color: c.foreground }}>{option}</Text></Pressable>)}
        </View>
        {!ready ? <View style={styles.loading}><ActivityIndicator /><Text style={{ color: c.mutedForeground }}>Loading your household’s plan…</Text></View> : <>
          <Text style={[styles.copy, { color: c.foreground }]}>{totals.low} under-floor days · {totals.recorded} recorded · {totals.projected} projected · {totals.unavailable} unavailable</Text>
          {totals.low === 0 ? <Text style={[styles.copy, { color: c.mutedForeground }]}>{totals.recorded + totals.projected === 0 ? "No daily balances are available for this year yet." : "No available days fall below your floor. Unavailable days are not included."}</Text> : null}
          <ScrollView style={styles.scroll} contentContainerStyle={{ paddingBottom: 16 }}>
            {months.map(month => <View key={month.month} style={[styles.month, { borderColor: c.border }]}>
              <Pressable accessibilityRole="button" accessibilityState={{ expanded: expandedMonth === month.month }} onPress={() => setExpandedMonth(expandedMonth === month.month ? null : month.month)} style={{ padding: 14 }}>
                <Text style={{ color: c.foreground, fontWeight: "600" }}>{monthName(month.month)} · {month.days.length} under floor</Text>
                <Text style={[styles.detail, { color: c.mutedForeground }]}>Lowest {month.lowestBalance === null ? "unavailable" : money(month.lowestBalance)} · {month.recorded} recorded · {month.projected} projected · {month.unavailable} unavailable</Text>
              </Pressable>
              {expandedMonth === month.month ? month.days.length ? month.days.map(day => <Pressable key={day.date} accessibilityRole="button" accessibilityLabel={`Open ${day.date}, ${day.source}, balance ${money(day.balance)}, ${money(day.shortfall)} below floor`} onPress={() => onSelectDate(day.date)} style={[styles.day, { borderColor: c.border }]}>
                <Text style={{ color: c.foreground }}>{new Date(`${day.date}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })} · {day.source === "recorded" ? "Recorded" : "Projected"}</Text>
                <Text style={{ color: c.destructive }}>{money(day.balance)} · {money(day.shortfall)} below</Text>
              </Pressable>) : <Text style={[styles.copy, { color: c.mutedForeground }]}>No under-floor days among available balances.</Text> : null}
            </View>)}
          </ScrollView>
        </>}
      </View>
    </View>
  </Modal>;
}
const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "center", alignItems: "center", padding: 16, backgroundColor: "rgba(0,0,0,0.65)" },
  card: { width: "100%", maxWidth: 700, maxHeight: "92%", padding: 18, borderRadius: 20 },
  title: { fontSize: 21, fontWeight: "700", flexShrink: 1 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  copy: { fontSize: 13, lineHeight: 19, marginVertical: 10 },
  year: { padding: 12, borderWidth: 1, borderRadius: 10, flex: 1, alignItems: "center" },
  loading: { padding: 24, gap: 12 }, scroll: { flexShrink: 1 },
  month: { borderWidth: 1, borderRadius: 12, marginTop: 8, overflow: "hidden" },
  detail: { fontSize: 12, marginTop: 5, lineHeight: 17 },
  day: { borderTopWidth: 1, padding: 14, gap: 6 },
});
