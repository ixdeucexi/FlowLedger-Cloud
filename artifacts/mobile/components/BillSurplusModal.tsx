import { Feather } from "@expo/vector-icons";
import React from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { DatePickerField } from "@/components/DatePickerField";
import { useColors } from "@/hooks/useColors";

interface Props {
  visible: boolean;
  billName: string;
  itemType?: "bill" | "debt";
  budgeted: number;
  actual: number;
  targetDebt?: string;
  snowballSafe: boolean;
  safetyFloor?: number;
  forecastHorizonMonths?: number;
  paymentDate: string;
  paymentDateValid: boolean;
  paymentDateMin: string;
  paymentDateMax: string;
  onPaymentDateChange: (date: string) => void;
  onKeep: () => void;
  onSnowball: () => void;
  onClose: () => void;
}

export function BillSurplusModal({ visible, billName, itemType = "bill", budgeted, actual, targetDebt, snowballSafe, safetyFloor = 200, forecastHorizonMonths = 6, paymentDate, paymentDateValid, paymentDateMin, paymentDateMax, onPaymentDateChange, onKeep, onSnowball, onClose }: Props) {
  const c = useColors();
  const difference = Math.max(0, budgeted - actual);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: c.background }]} onPress={() => {}}>
          <View style={[styles.handle, { backgroundColor: c.border }]} />
          <View style={styles.iconRow}>
            <View style={[styles.icon, { backgroundColor: c.primary + "18" }]}>
              <Text style={[styles.floIconText, { color: c.primary }]}>F</Text>
            </View>
          </View>
          <Text style={[styles.eyebrow, { color: c.primary }]}>Flo can help</Text>
          <Text style={[styles.title, { color: c.foreground }]}>Over-budgeted by ${difference.toFixed(2)}</Text>
          <Text style={[styles.sub, { color: c.mutedForeground }]}>
            Hey, I see {billName} was over-budgeted by ${difference.toFixed(2)}. I can add it to {targetDebt ?? "your snowball"} for you.
          </Text>
          <View style={[styles.breakdown, { backgroundColor: c.card }]}> 
            <View style={styles.row}><Text style={[styles.rowLabel, { color: c.mutedForeground }]}>Budgeted</Text><Text style={[styles.rowValue, { color: c.foreground }]}>${budgeted.toFixed(2)}</Text></View>
            <View style={styles.row}><Text style={[styles.rowLabel, { color: c.mutedForeground }]}>Actual</Text><Text style={[styles.rowValue, { color: c.foreground }]}>${actual.toFixed(2)}</Text></View>
            <View style={styles.row}><Text style={[styles.rowLabel, { color: c.success }]}>Available</Text><Text style={[styles.rowValue, { color: c.success }]}>${difference.toFixed(2)}</Text></View>
          </View>
          <DatePickerField
            label="Apply leftover on"
            value={paymentDate}
            onChange={onPaymentDateChange}
            placeholder="Choose payment date"
            minDate={paymentDateMin}
            maxDate={paymentDateMax}
          />
          <Text style={[styles.dateHelp, { color: c.mutedForeground }]}>This date will appear as the extra debt payment on your calendar.</Text>
          {!targetDebt && <Text style={[styles.note, { color: c.mutedForeground }]}>No debt is currently included in your snowball.</Text>}
          {targetDebt && !paymentDateValid && <Text style={[styles.note, { color: c.warning }]}>Choose a valid date in this bill&apos;s month.</Text>}
          {targetDebt && paymentDateValid && !snowballSafe && <Text style={[styles.note, { color: c.warning }]}>Keep this money available to preserve your ${safetyFloor.toFixed(0)} floor across {forecastHorizonMonths} months.</Text>}
          <Pressable disabled={!targetDebt || !snowballSafe} onPress={onSnowball} style={[styles.primary, { backgroundColor: targetDebt && snowballSafe ? c.primary : c.muted }]}> 
            <Feather name="zap" size={16} color={targetDebt && snowballSafe ? c.primaryForeground : c.mutedForeground} />
            <Text style={[styles.primaryText, { color: targetDebt && snowballSafe ? c.primaryForeground : c.mutedForeground }]}>Add ${difference.toFixed(2)} to {targetDebt ?? "Snowball"}</Text>
          </Pressable>
          <Pressable onPress={onKeep} style={[styles.secondary, { borderColor: c.border }]}><Text style={[styles.secondaryText, { color: c.foreground }]}>No, keep ${difference.toFixed(2)} available</Text></Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.55)" },
  sheet: { borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 20, paddingTop: 12, paddingBottom: 34 },
  handle: { width: 38, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 18 }, iconRow: { alignItems: "center" }, icon: { width: 50, height: 50, borderRadius: 25, alignItems: "center", justifyContent: "center" },
  floIconText: { fontSize: 20, fontFamily: "Inter_800ExtraBold" },
  eyebrow: { fontSize: 11, fontFamily: "Inter_800ExtraBold", letterSpacing: 1.1, textTransform: "uppercase", textAlign: "center", marginTop: 12 },
  title: { fontSize: 24, fontFamily: "Inter_700Bold", textAlign: "center", marginTop: 10 }, sub: { fontSize: 13, lineHeight: 18, textAlign: "center", marginTop: 5 },
  breakdown: { borderRadius: 12, padding: 14, gap: 9, marginTop: 16 }, row: { flexDirection: "row", justifyContent: "space-between" }, rowLabel: { fontSize: 13 }, rowValue: { fontSize: 13, fontFamily: "Inter_700Bold" },
  dateHelp: { fontSize: 11, lineHeight: 16, marginTop: 5 },
  note: { fontSize: 12, lineHeight: 17, textAlign: "center", marginTop: 12 }, primary: { height: 50, borderRadius: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, marginTop: 16 }, primaryText: { fontSize: 14, fontFamily: "Inter_700Bold" }, secondary: { height: 48, borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center", marginTop: 10 }, secondaryText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});

