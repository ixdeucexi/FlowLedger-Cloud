import React, { useMemo, useState } from "react";
import { ActivityIndicator, Modal, ScrollView, StyleSheet } from "react-native";
import { PrivacyPressable as Pressable, PrivacyText as Text, PrivacyView as View } from "@/components/privacy/PrivacyPrimitives";
import { useBackDismiss } from "@/hooks/useBackDismiss";
import { useColors } from "@/hooks/useColors";
import { summarizeSafetyFloorYear } from "@/lib/safetyFloorYear";
import type { DailyBalance } from "@/context/BudgetContext";

const money = (value: number) => value.toLocaleString(undefined, { style: "currency", currency: "USD" });

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
  useBackDismiss(true, onClose);
  const months = useMemo(() => ready ? summarizeSafetyFloorYear({ year, today, safetyFloor, startingBalanceDate, getDays }) : [], [ready, year, today, safetyFloor, startingBalanceDate, getDays]);
  const days = months.flatMap(month => month.days);
  const unavailable = months.reduce((total, month) => total + month.unavailable, 0);
  return <Modal visible transparent animationType="fade" onRequestClose={onClose}>
    <View style={styles.overlay}>
      <Pressable accessibilityLabel="Close safety floor days" style={StyleSheet.absoluteFill} onPress={onClose} />
      <View style={[styles.card, { backgroundColor: c.background }]}>
        <View style={styles.row}><Text accessibilityRole="header" style={[styles.title, { color: c.foreground }]}>Safety floor days</Text><Pressable accessibilityRole="button" accessibilityLabel="Close safety floor days" onPress={onClose}><Text style={{ color: c.primary, padding: 8 }}>Close</Text></Pressable></View>
        <Text style={[styles.copy, { color: c.mutedForeground }]}>{ready ? `Days below your ${money(safetyFloor)} floor. Your current plan may change. Missing past balances are omitted.` : "Your household’s safety floor days will appear when its plan is ready."}</Text>
        <View style={styles.row}>
          {[currentYear, currentYear + 1].map(option => <Pressable key={option} accessibilityRole="button" accessibilityState={{ selected: year === option }} onPress={() => setChosenYear(option)} style={[styles.year, { borderColor: year === option ? c.primary : c.border }]}><Text style={{ color: c.foreground }}>{option}</Text></Pressable>)}
        </View>
        {!ready ? <View style={styles.loading}><ActivityIndicator /><Text style={{ color: c.mutedForeground }}>Loading your household’s plan…</Text></View> : <>
          {days.length === 0 ? <Text style={[styles.copy, { color: c.mutedForeground }]}>{months.every(month => month.recorded + month.projected === 0) ? "No daily balances are available for this year yet." : "No available days fall below your floor."}</Text> : null}
          {unavailable > 0 ? <Text style={[styles.copy, { color: c.mutedForeground }]}>Unavailable balances are not included.</Text> : null}
          <View style={[styles.row, { marginTop: 14 }]}><Text style={{ color: c.mutedForeground }}>Date</Text><Text style={{ color: c.mutedForeground }}>Balance</Text></View>
          <ScrollView style={styles.scroll} contentContainerStyle={{ paddingBottom: 16 }}>
            {days.map(day => <Pressable key={day.date} accessibilityRole="button" accessibilityLabel={`Open ${day.date}, balance ${money(day.balance)}`} onPress={() => onSelectDate(day.date)} style={[styles.day, styles.row, { borderColor: c.border }]}>
              <Text style={{ color: c.foreground }}>{new Date(`${day.date}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</Text>
              <Text style={{ color: c.destructive }}>{money(day.balance)}</Text>
            </Pressable>)}
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
  day: { borderTopWidth: 1, padding: 14, gap: 6 },
});
