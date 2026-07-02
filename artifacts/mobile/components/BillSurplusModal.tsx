import { Feather } from "@expo/vector-icons";
import React from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { DatePickerField } from "@/components/DatePickerField";
import { FloLogo } from "@/components/FloLogo";
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
  const itemLabel = itemType === "debt" ? "debt payment" : "bill";
  return (
    <Modal visible={visible} transparent animationType="fade" presentationStyle="overFullScreen" statusBarTranslucent onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]} onPress={() => {}}>
          <View style={styles.floWrap}>
            <FloLogo size={74} />
          </View>
          <Text style={[styles.eyebrow, { color: c.primary }]}>Flo can help</Text>
          <Text style={[styles.message, { color: c.foreground }]}>
            Hey, I see {billName} was paid under the planned {itemLabel}. You have ${difference.toFixed(2)} available.
          </Text>
          <Text style={[styles.sub, { color: c.mutedForeground }]}>
            I can add it to {targetDebt ?? "your snowball"} for you, or you can keep it available.
          </Text>
          <View style={[styles.breakdown, { backgroundColor: c.background, borderColor: c.border }]}>
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
  overlay: { flex: 1, justifyContent: "center", padding: 20, backgroundColor: "rgba(0,0,0,0.68)" },
  card: { borderRadius: 28, borderWidth: 1, padding: 20, paddingTop: 24, paddingBottom: 22, shadowColor: "#2563eb", shadowOpacity: 0.28, shadowRadius: 26, shadowOffset: { width: 0, height: 14 }, elevation: 12 },
  floWrap: { alignItems: "center" },
  eyebrow: { fontSize: 11, fontFamily: "Inter_800ExtraBold", letterSpacing: 1.1, textTransform: "uppercase", textAlign: "center", marginTop: 12 },
  message: { fontSize: 19, fontFamily: "Inter_700Bold", lineHeight: 26, textAlign: "center", marginTop: 10 },
  sub: { fontSize: 13, lineHeight: 19, textAlign: "center", marginTop: 7 },
  breakdown: { borderRadius: 16, borderWidth: 1, padding: 14, gap: 9, marginTop: 16 }, row: { flexDirection: "row", justifyContent: "space-between" }, rowLabel: { fontSize: 13 }, rowValue: { fontSize: 13, fontFamily: "Inter_700Bold" },
  dateHelp: { fontSize: 11, lineHeight: 16, marginTop: 5 },
  note: { fontSize: 12, lineHeight: 17, textAlign: "center", marginTop: 12 }, primary: { height: 50, borderRadius: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, marginTop: 16 }, primaryText: { fontSize: 14, fontFamily: "Inter_700Bold" }, secondary: { height: 48, borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center", marginTop: 10 }, secondaryText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});

