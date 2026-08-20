import { Feather } from "@expo/vector-icons";
import React from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { DatePickerField } from "@/components/DatePickerField";
import { FloLogo } from "@/components/FloLogo";
import { useColors } from "@/hooks/useColors";
import { useBackDismiss } from "@/hooks/useBackDismiss";

interface Props {
  visible: boolean;
  billName: string;
  itemType?: "bill" | "debt" | "bucket";
  budgeted: number;
  actual: number;
  targetDebt?: string;
  snowballSafe: boolean;
  snowballEnabled?: boolean;
  safetyFloor?: number;
  forecastHorizonMonths?: number;
  paymentDate: string;
  paymentDateValid: boolean;
  paymentDateMin: string;
  paymentDateMax: string;
  routeMode: "next" | "date";
  nextPaymentDate?: string;
  nextPaymentAmount?: number;
  saving?: boolean;
  onRouteModeChange: (mode: "next" | "date") => void;
  onPaymentDateChange: (date: string) => void;
  onKeep: () => void;
  onSnowball: () => void;
  onClose: () => void;
}

function shortDate(value?: string) {
  if (!value) return "No upcoming payment";
  const parsed = new Date(`${value}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function BillSurplusModal({ visible, billName, itemType = "bill", budgeted, actual, targetDebt, snowballSafe, snowballEnabled = true, safetyFloor = 200, forecastHorizonMonths = 6, paymentDate, paymentDateValid, paymentDateMin, paymentDateMax, routeMode, nextPaymentDate, nextPaymentAmount, saving = false, onRouteModeChange, onPaymentDateChange, onKeep, onSnowball, onClose }: Props) {
  const c = useColors();
  const requestClose = () => {
    if (!saving) onClose();
  };
  useBackDismiss(visible, requestClose);
  const difference = Math.max(0, budgeted - actual);
  const itemLabel = itemType === "debt" ? "debt payment" : itemType === "bucket" ? "spending bucket" : "bill";
  const message = itemType === "bucket"
    ? `${billName} has $${difference.toFixed(2)} left. Close the bucket and choose where that remainder goes.`
    : `Hey, I see ${billName} was paid under the planned ${itemLabel}. You have $${difference.toFixed(2)} available.`;
  return (
    <Modal visible={visible} transparent animationType="fade" presentationStyle="overFullScreen" statusBarTranslucent onRequestClose={requestClose}>
      <Pressable style={styles.overlay} onPress={requestClose}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Pressable style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]} onPress={(event) => event.stopPropagation()}>
          <View style={styles.floWrap}>
            <FloLogo size={74} />
          </View>
          <Text style={[styles.eyebrow, { color: c.primary }]}>Flo can help</Text>
          <Text style={[styles.message, { color: c.foreground }]}>
            {message}
          </Text>
          <Text style={[styles.sub, { color: c.mutedForeground }]}>
            {snowballEnabled ? `I can add it to ${targetDebt ?? "your snowball"} for you, or you can keep it available.` : "Your current planning mode keeps this difference available in your cash flow."}
          </Text>
          <View style={[styles.breakdown, { backgroundColor: c.background, borderColor: c.border }]}>
            <View style={styles.row}><Text style={[styles.rowLabel, { color: c.mutedForeground }]}>Budgeted</Text><Text style={[styles.rowValue, { color: c.foreground }]}>${budgeted.toFixed(2)}</Text></View>
            <View style={styles.row}><Text style={[styles.rowLabel, { color: c.mutedForeground }]}>Actual</Text><Text style={[styles.rowValue, { color: c.foreground }]}>${actual.toFixed(2)}</Text></View>
            <View style={styles.row}><Text style={[styles.rowLabel, { color: c.success }]}>Available</Text><Text style={[styles.rowValue, { color: c.success }]}>${difference.toFixed(2)}</Text></View>
          </View>
          {snowballEnabled && <Text style={[styles.routeLabel, { color: c.foreground }]}>When should Flo add it?</Text>}
          {snowballEnabled && <View style={styles.routeChoices}>
            <Pressable
              accessibilityRole="radio"
              accessibilityLabel={nextPaymentDate ? `Add to next planned payment on ${shortDate(nextPaymentDate)}` : "No next planned payment is available"}
              accessibilityState={{ checked: routeMode === "next", disabled: !nextPaymentDate }}
              disabled={!nextPaymentDate}
              onPress={() => onRouteModeChange("next")}
              style={({ pressed }) => [styles.routeChoice, {
                backgroundColor: routeMode === "next" ? c.primary + "22" : c.background,
                borderColor: routeMode === "next" ? c.primary : c.border,
                opacity: !nextPaymentDate ? 0.48 : pressed ? 0.78 : 1,
              }]}
            >
              <Feather name="calendar" size={17} color={routeMode === "next" ? c.primary : c.mutedForeground} />
              <Text style={[styles.routeChoiceTitle, { color: routeMode === "next" ? c.primary : c.foreground }]}>Next payment</Text>
              <Text style={[styles.routeChoiceMeta, { color: c.mutedForeground }]}>{shortDate(nextPaymentDate)}</Text>
              {nextPaymentAmount !== undefined ? <Text style={[styles.routeChoiceMeta, { color: c.mutedForeground }]}>{`Planned $${nextPaymentAmount.toFixed(2)}`}</Text> : null}
            </Pressable>
            <Pressable
              accessibilityRole="radio"
              accessibilityLabel="Pick a payment date"
              accessibilityState={{ checked: routeMode === "date" }}
              onPress={() => onRouteModeChange("date")}
              style={({ pressed }) => [styles.routeChoice, {
                backgroundColor: routeMode === "date" ? c.primary + "22" : c.background,
                borderColor: routeMode === "date" ? c.primary : c.border,
                opacity: pressed ? 0.78 : 1,
              }]}
            >
              <Feather name="edit-3" size={17} color={routeMode === "date" ? c.primary : c.mutedForeground} />
              <Text style={[styles.routeChoiceTitle, { color: routeMode === "date" ? c.primary : c.foreground }]}>Pick a date</Text>
              <Text style={[styles.routeChoiceMeta, { color: c.mutedForeground }]}>Choose this month</Text>
            </Pressable>
          </View>}
          {snowballEnabled && routeMode === "date" && <DatePickerField
            label="Apply leftover on"
            value={paymentDate}
            onChange={onPaymentDateChange}
            placeholder="Choose payment date"
            minDate={paymentDateMin}
            maxDate={paymentDateMax}
          />}
          {snowballEnabled && <Text style={[styles.dateHelp, { color: c.mutedForeground }]}>
            {routeMode === "next" && nextPaymentDate
              ? `Combines with ${targetDebt ?? "the debt"} on ${shortDate(nextPaymentDate)} so Forecast shows one payment.`
              : "Adds the debt payment to your calendar on the date you choose."}
          </Text>}
          {snowballEnabled && !targetDebt && <Text style={[styles.note, { color: c.mutedForeground }]}>No snowball debt selected.</Text>}
          {snowballEnabled && routeMode === "next" && targetDebt && !nextPaymentDate && <Text style={[styles.note, { color: c.warning }]}>No later planned payment was found. Pick a date instead.</Text>}
          {snowballEnabled && routeMode === "date" && targetDebt && !paymentDateValid && <Text style={[styles.note, { color: c.warning }]}>Choose a valid date in this {itemType === "bucket" ? "Snowball" : "bill"} month.</Text>}
          {snowballEnabled && targetDebt && paymentDateValid && !snowballSafe && <Text style={[styles.note, { color: c.warning }]}>Keep this money available to preserve your ${safetyFloor.toFixed(0)} floor across {forecastHorizonMonths} months.</Text>}
          {snowballEnabled && <Pressable disabled={saving || !targetDebt || !snowballSafe} onPress={onSnowball} style={[styles.primary, { backgroundColor: targetDebt && snowballSafe ? c.primary : c.muted, opacity: saving ? 0.55 : 1 }]}>
            <Feather name="zap" size={16} color={targetDebt && snowballSafe ? c.primaryForeground : c.mutedForeground} />
            <Text style={[styles.primaryText, { color: targetDebt && snowballSafe ? c.primaryForeground : c.mutedForeground }]}>
              {routeMode === "next" && nextPaymentDate
                ? `Add $${difference.toFixed(2)} to next payment`
                : `Add $${difference.toFixed(2)} to ${targetDebt ?? "Snowball"}`}
            </Text>
          </Pressable>}
          <Pressable disabled={saving} onPress={onKeep} style={[styles.secondary, { borderColor: c.border, opacity: saving ? 0.55 : 1 }]}><Text style={[styles.secondaryText, { color: c.foreground }]}>{itemType === "bucket" ? `Close bucket · keep $${difference.toFixed(2)} available` : `No, keep $${difference.toFixed(2)} available`}</Text></Pressable>
        </Pressable>
        </ScrollView>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.68)" },
  scrollContent: { flexGrow: 1, justifyContent: "center", padding: 20 },
  card: { width: "100%", maxWidth: 430, alignSelf: "center", borderRadius: 28, borderWidth: 1, padding: 20, paddingTop: 24, paddingBottom: 22, shadowColor: "#2563eb", shadowOpacity: 0.28, shadowRadius: 26, shadowOffset: { width: 0, height: 14 }, elevation: 12 },
  floWrap: { alignItems: "center" },
  eyebrow: { fontSize: 11, fontFamily: "Inter_800ExtraBold", letterSpacing: 1.1, textTransform: "uppercase", textAlign: "center", marginTop: 12 },
  message: { fontSize: 19, fontFamily: "Inter_700Bold", lineHeight: 26, textAlign: "center", marginTop: 10 },
  sub: { fontSize: 13, lineHeight: 19, textAlign: "center", marginTop: 7 },
  breakdown: { borderRadius: 16, borderWidth: 1, padding: 14, gap: 9, marginTop: 16 }, row: { flexDirection: "row", justifyContent: "space-between" }, rowLabel: { fontSize: 13 }, rowValue: { fontSize: 13, fontFamily: "Inter_700Bold" },
  routeLabel: { fontSize: 13, fontFamily: "Inter_700Bold", marginTop: 17, marginBottom: 8 },
  routeChoices: { flexDirection: "row", gap: 10 },
  routeChoice: { flex: 1, minHeight: 82, borderRadius: 14, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 11, justifyContent: "center" },
  routeChoiceTitle: { fontSize: 13, fontFamily: "Inter_700Bold", marginTop: 5 },
  routeChoiceMeta: { fontSize: 10, lineHeight: 14, marginTop: 2 },
  dateHelp: { fontSize: 11, lineHeight: 16, marginTop: 5 },
  note: { fontSize: 12, lineHeight: 17, textAlign: "center", marginTop: 12 }, primary: { height: 50, borderRadius: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, marginTop: 16 }, primaryText: { fontSize: 14, fontFamily: "Inter_700Bold" }, secondary: { height: 48, borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center", marginTop: 10 }, secondaryText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});

