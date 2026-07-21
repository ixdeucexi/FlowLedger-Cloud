import { Feather } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { DatePickerField } from "@/components/DatePickerField";
import type { DebtMethod, SnowballProjectionResult } from "@/lib/snowball";
import { useColors } from "@/hooks/useColors";
import { useBackDismiss } from "@/hooks/useBackDismiss";
import { MONTH_NAMES } from "@/lib/dateLabels";

interface Props {
  visible: boolean;
  method: DebtMethod;
  preview: SnowballProjectionResult | null;
  amount: string;
  existingPayment?: boolean;
  paymentDate?: string;
  paymentDateMin?: string;
  paymentDateMax?: string;
  safetyFloor?: number;
  forecastHorizonMonths?: number;
  onAmountChange: (value: string) => void;
  onPaymentDateChange?: (value: string) => void;
  onClose: () => void;
  onConfirm: () => void;
  onRemove?: () => void;
}

export function SnowballPreviewModal({ visible, method, preview, amount, existingPayment, paymentDate, paymentDateMin, paymentDateMax, safetyFloor = 200, forecastHorizonMonths = 6, onAmountChange, onPaymentDateChange, onClose, onConfirm, onRemove }: Props) {
  const c = useColors();
  useBackDismiss(visible, onClose);
  const requested = Number.parseFloat(amount) || 0;
  const valid = !!preview && requested > 0 && requested <= preview.safeMaximum + 0.005 && preview.allocations.length > 0;
  const methodName = method === "avalanche" ? "Avalanche" : "Snowball";
  const [monthOffset, setMonthOffset] = useState(0);
  useEffect(() => { if (visible) setMonthOffset(0); }, [visible]);
  const visibleMonths = preview?.months.slice(monthOffset, monthOffset + forecastHorizonMonths) ?? [];
  const canMoveBack = monthOffset > 0;
  const canMoveForward = Boolean(preview && monthOffset + forecastHorizonMonths < preview.months.length);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: c.background }]} onPress={() => {}}>
          <View style={[styles.handle, { backgroundColor: c.border }]} />
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, { color: c.foreground }]}>{existingPayment ? `Edit ${methodName} Payment` : `${methodName} Preview`}</Text>
              <Text style={[styles.sub, { color: c.mutedForeground }]}>
                {existingPayment ? "Update the payment shown in Activity and Calendar." : "Nothing changes until you confirm."}
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={8}><Feather name="x" size={21} color={c.mutedForeground} /></Pressable>
          </View>

          {preview && (
            <ScrollView showsVerticalScrollIndicator contentContainerStyle={styles.scrollContent} style={styles.scroll}>
              <View style={[styles.safeCard, { backgroundColor: c.success + "15", borderColor: c.success + "40" }]}>
                <Feather name="shield" size={18} color={c.success} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.safeLabel, { color: c.mutedForeground }]}>MAXIMUM SAFE EXTRA</Text>
                  <Text style={[styles.safeValue, { color: c.success }]}>${preview.safeMaximum.toFixed(2)}</Text>
                  <Text style={[styles.safeNote, { color: c.mutedForeground }]}>Keeps the {forecastHorizonMonths}-month forecast at or above ${safetyFloor.toFixed(0)}</Text>
                </View>
              </View>

              <Text style={[styles.label, { color: c.mutedForeground }]}>EXTRA PAYMENT</Text>
              <View style={[styles.inputWrap, { backgroundColor: c.card, borderColor: requested > preview.safeMaximum ? c.destructive : c.border }]}>
                <Text style={[styles.dollar, { color: c.foreground }]}>$</Text>
                <TextInput value={amount} onChangeText={onAmountChange} keyboardType="decimal-pad" style={[styles.input, { color: c.foreground }]} />
              </View>
              {requested > preview.safeMaximum && (
                <Text style={[styles.error, { color: c.destructive }]}>That amount would move the projected balance below your ${safetyFloor.toFixed(0)} safety floor.</Text>
              )}

              {paymentDate && onPaymentDateChange ? (
                <DatePickerField
                  label="PAYMENT DATE"
                  value={paymentDate}
                  onChange={onPaymentDateChange}
                  minDate={paymentDateMin}
                  maxDate={paymentDateMax}
                />
              ) : null}

              <Text style={[styles.label, { color: c.mutedForeground }]}>THIS PAYMENT</Text>
              <View style={[styles.card, { backgroundColor: c.card }]}>
                {preview.allocations.map(item => (
                  <View key={item.billId} style={styles.row}>
                    <Feather name={item.paidOff ? "check-circle" : "arrow-right-circle"} size={15} color={item.paidOff ? c.success : c.primary} />
                    <Text style={[styles.rowName, { color: c.foreground }]}>{item.billName}</Text>
                    <Text style={[styles.rowValue, { color: c.foreground }]}>${item.payment.toFixed(2)}</Text>
                  </View>
                ))}
              </View>

              <View style={styles.monthHeader}>
                <Text style={[styles.label, styles.monthHeaderLabel, { color: c.mutedForeground }]}>PAYOFF FORECAST</Text>
                <View style={styles.monthNav}>
                  <Pressable disabled={!canMoveBack} onPress={() => setMonthOffset(value => Math.max(0, value - forecastHorizonMonths))} style={{ opacity: canMoveBack ? 1 : 0.35 }} accessibilityLabel="Show earlier payoff months">
                    <Feather name="chevron-left" size={20} color={c.primary} />
                  </Pressable>
                  <Text style={[styles.monthRange, { color: c.foreground }]}>{monthOffset + 1}–{monthOffset + visibleMonths.length}</Text>
                  <Pressable disabled={!canMoveForward} onPress={() => setMonthOffset(value => value + forecastHorizonMonths)} style={{ opacity: canMoveForward ? 1 : 0.35 }} accessibilityLabel="Show later payoff months">
                    <Feather name="chevron-right" size={20} color={c.primary} />
                  </Pressable>
                </View>
              </View>
              <View style={[styles.card, { backgroundColor: c.card }]}>
                {visibleMonths.map(item => (
                  <View key={`${item.year}-${item.month}`} style={styles.monthRow}>
                    <Text style={[styles.month, { color: c.foreground }]}>{MONTH_NAMES[item.month]} {item.year}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.monthTarget, { color: c.mutedForeground }]}>{item.targetName ?? `${methodName} complete`}</Text>
                      <Text style={[styles.monthBalance, { color: item.lowestAccountBalance >= safetyFloor ? c.success : c.destructive }]}>Lowest cash ${item.lowestAccountBalance.toFixed(0)}</Text>
                    </View>
                    <Text style={[styles.monthExtra, { color: c.primary }]}>+${item.extraPayment.toFixed(0)}</Text>
                  </View>
                ))}
              </View>

              <View style={[styles.payoffCard, { backgroundColor: c.primary + "12" }]}>
                <Feather name="flag" size={17} color={c.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.payoffTitle, { color: c.foreground }]}>Estimated debt-free date</Text>
                  <Text style={[styles.payoffValue, { color: c.primary }]}>{preview.debtFreeDate ?? "More than 30 years"}</Text>
                  <Text style={[styles.payoffOrder, { color: c.mutedForeground }]}>{preview.payoffOrder.join(" → ") || "No included debts"}</Text>
                </View>
              </View>
            </ScrollView>
          )}

          <View style={styles.actions}>
            {existingPayment && onRemove && (
              <Pressable onPress={onRemove} style={[styles.remove, { borderColor: c.destructive }]}>
                <Feather name="rotate-ccw" size={15} color={c.destructive} />
                <Text style={[styles.removeText, { color: c.destructive }]}>Remove</Text>
              </Pressable>
            )}
            <Pressable disabled={!valid} onPress={onConfirm} style={[styles.confirm, { backgroundColor: valid ? c.primary : c.muted }]}>
              <Text style={[styles.confirmText, { color: valid ? c.primaryForeground : c.mutedForeground }]}>{existingPayment ? "Update Payment" : "Confirm Payment"}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.58)" },
  sheet: { height: "92%", borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 20, paddingTop: 12 },
  handle: { width: 38, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 16 },
  header: { flexDirection: "row", alignItems: "flex-start", marginBottom: 12 },
  title: { fontSize: 21, fontFamily: "Inter_700Bold" }, sub: { fontSize: 12, marginTop: 3 },
  scroll: { flex: 1, minHeight: 0 }, scrollContent: { paddingBottom: 18 }, safeCard: { flexDirection: "row", gap: 12, padding: 14, borderWidth: 1, borderRadius: 14 },
  safeLabel: { fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 0.6 }, safeValue: { fontSize: 28, fontFamily: "Inter_700Bold" }, safeNote: { fontSize: 11 },
  label: { fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 0.7, marginTop: 16, marginBottom: 7 },
  monthHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 16, marginBottom: 7 },
  monthHeaderLabel: { marginTop: 0, marginBottom: 0 },
  monthNav: { flexDirection: "row", alignItems: "center", gap: 8 },
  monthRange: { minWidth: 34, textAlign: "center", fontSize: 11, fontFamily: "Inter_700Bold" },
  inputWrap: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 12 }, dollar: { fontSize: 20, paddingLeft: 14 }, input: { flex: 1, height: 50, paddingHorizontal: 8, fontSize: 20, fontFamily: "Inter_700Bold" },
  error: { fontSize: 11, marginTop: 5 }, card: { borderRadius: 12, padding: 12, gap: 10 }, row: { flexDirection: "row", alignItems: "center", gap: 8 }, rowName: { flex: 1, fontSize: 13, fontFamily: "Inter_600SemiBold" }, rowValue: { fontSize: 13, fontFamily: "Inter_700Bold" },
  monthRow: { flexDirection: "row", alignItems: "center", gap: 10 }, month: { width: 70, fontSize: 12, fontFamily: "Inter_700Bold" }, monthTarget: { fontSize: 11 }, monthBalance: { fontSize: 10, marginTop: 1 }, monthExtra: { fontSize: 13, fontFamily: "Inter_700Bold" },
  payoffCard: { flexDirection: "row", gap: 10, padding: 14, borderRadius: 12, marginTop: 16 }, payoffTitle: { fontSize: 12, fontFamily: "Inter_600SemiBold" }, payoffValue: { fontSize: 20, fontFamily: "Inter_700Bold", marginTop: 2 }, payoffOrder: { fontSize: 10, marginTop: 3 },
  actions: { flexDirection: "row", gap: 10, marginTop: 16 }, remove: { minWidth: 92, height: 50, paddingHorizontal: 13, gap: 6, flexDirection: "row", borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center" }, removeText: { fontSize: 13, fontFamily: "Inter_700Bold" }, confirm: { flex: 1, height: 50, borderRadius: 12, alignItems: "center", justifyContent: "center" }, confirmText: { fontSize: 15, fontFamily: "Inter_700Bold" },
});

