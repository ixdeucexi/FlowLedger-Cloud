import Feather from "@expo/vector-icons/Feather";
import React, { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Switch } from "react-native";
import { PrivacyPressable as Pressable, PrivacyText as Text, PrivacyView as View } from "@/components/privacy/PrivacyPrimitives";

import { DatePickerField } from "@/components/DatePickerField";
import type { Bill } from "@/context/BudgetContext";
import { useColors } from "@/hooks/useColors";
import { useDesktopExperience } from "@/hooks/useDesktopExperience";
import { addDateOnlyDays, addDateOnlyMonths, dateOnlyToLocalDate } from "@/lib/dateLabels";
import { isDebtPaymentPauseDate, normalizeDebtPaymentPauses } from "@/lib/debtPaymentPause";
import { DESKTOP_MODAL_COMPACT, DESKTOP_MODAL_OVERLAY } from "@/lib/desktopModal";

export type DebtPaymentPauseInput = {
  startDate: string;
  resumeDate: string;
  redirectPayment: boolean;
};

export type DebtPaymentPauseDateField = "start" | "resume" | null;

interface Props {
  visible: boolean;
  bill: Bill;
  today: string;
  canEdit: boolean;
  redirectEnabled: boolean;
  openDateField: DebtPaymentPauseDateField;
  onOpenDateFieldChange: (field: DebtPaymentPauseDateField) => void;
  onSavingChange: (saving: boolean) => void;
  onClose: () => void;
  onSave: (input: DebtPaymentPauseInput) => Promise<void>;
}

function readableDate(value: string) {
  return dateOnlyToLocalDate(value)?.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) ?? value;
}

/** One nested view in the bill editor's modal; the editor owns Back/history. */
export function DebtPaymentPauseModal({ visible, bill, today, canEdit, redirectEnabled, openDateField, onOpenDateFieldChange, onSavingChange, onClose, onSave }: Props) {
  const c = useColors();
  const desktop = useDesktopExperience();
  const [startDate, setStartDate] = useState(today);
  const [resumeDate, setResumeDate] = useState(() => addDateOnlyMonths(today, 2));
  const [redirectPayment, setRedirectPayment] = useState(redirectEnabled);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const savingRef = useRef(false);

  useEffect(() => {
    if (!visible) return;
    setStartDate(today);
    setResumeDate(addDateOnlyMonths(today, 2));
    setRedirectPayment(redirectEnabled);
    setError("");
    // Opening starts a new draft; confirmed-row refreshes preserve this draft.
  }, [visible, bill.id]);

  useEffect(() => {
    if (!redirectEnabled) setRedirectPayment(false);
  }, [redirectEnabled]);

  const unavailable = !canEdit
    ? "Only household editors can pause debt payments."
    : !bill.is_debt || bill.balance <= 0.009 || Boolean(bill.end_date)
      ? "Payment pauses are available for open debts with a balance."
      : "";
  const dateError = !isDebtPaymentPauseDate(startDate) || !isDebtPaymentPauseDate(resumeDate)
    ? "Choose valid start and resume dates."
    : startDate < today
      ? "The pause must start today or later."
      : resumeDate <= startDate
        ? "Payments must resume after the pause starts."
        : "";
  const close = () => { if (!savingRef.current) onClose(); };
  const save = async () => {
    if (savingRef.current) return;
    if (unavailable || dateError) { setError(unavailable || dateError); return; }
    try {
      const history = normalizeDebtPaymentPauses(bill.debt_payment_pauses);
      let draftId = "pause-draft";
      let draftIndex = 0;
      while (history.some(pause => pause.id === draftId)) draftId = `pause-draft-${++draftIndex}`;
      normalizeDebtPaymentPauses([...history, { id: draftId, start_date: startDate, resume_date: resumeDate, redirect_payment: redirectEnabled && redirectPayment }]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Check the pause dates and try again.");
      return;
    }
    savingRef.current = true;
    setSaving(true);
    onSavingChange(true);
    setError("");
    try {
      await onSave({ startDate, resumeDate, redirectPayment: redirectEnabled && redirectPayment });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn’t save this pause. Please try again.");
    } finally {
      savingRef.current = false;
      setSaving(false);
      onSavingChange(false);
    }
  };

  if (!visible) return null;
  const normalPayment = bill.amount.toLocaleString(undefined, { style: "currency", currency: "USD", minimumFractionDigits: 2 });
  const frequency = bill.frequency === "quarterly" ? "every 3 months" : bill.frequency === "biweekly" ? "every 2 weeks" : bill.frequency === "weekly" ? "each week" : "each month";

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={[styles.overlay, desktop && DESKTOP_MODAL_OVERLAY]}>
      <Pressable accessible={false} importantForAccessibility="no" disabled={saving} onPress={close} style={StyleSheet.absoluteFillObject} />
      <View accessibilityViewIsModal style={[styles.surface, { backgroundColor: c.background, borderColor: c.border }, desktop && DESKTOP_MODAL_COMPACT]}>
        <View style={styles.header}>
          <Text accessibilityRole="header" style={[styles.title, { color: c.foreground }]}>Pause debt payments</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Close debt payment pause" accessibilityState={{ disabled: saving }} disabled={saving} onPress={close} hitSlop={8} style={styles.close}>
            <Feather name="x" size={22} color={c.mutedForeground} />
          </Pressable>
        </View>
        <ScrollView showsVerticalScrollIndicator={desktop} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
          <Text style={[styles.debtName, { color: c.foreground }]}>{bill.name}</Text>
          <View style={[styles.summary, { backgroundColor: c.muted }]}>
            <Text style={[styles.label, { color: c.mutedForeground }]}>Normal required payment</Text>
            <View style={styles.amountRow}>
              <Text sensitive style={[styles.amount, { color: c.foreground }]}>{normalPayment}</Text>
              <Text style={[styles.copy, { color: c.mutedForeground }]}>{frequency}</Text>
            </View>
          </View>
          <DatePickerField label="Pause starts" value={startDate} onChange={value => { setStartDate(value); setError(""); }} minDate={today} disabled={saving} open={openDateField === "start"} onOpenChange={open => onOpenDateFieldChange(open ? "start" : null)} />
          <DatePickerField label="Payments resume" value={resumeDate} onChange={value => { setResumeDate(value); setError(""); }} minDate={addDateOnlyDays(startDate, 1)} disabled={saving} open={openDateField === "resume"} onOpenChange={open => onOpenDateFieldChange(open ? "resume" : null)} />
          <Text style={[styles.copy, styles.dateHelp, { color: c.mutedForeground }]}>Scheduled payments on or after {readableDate(startDate)} pause. Payments dated {readableDate(resumeDate)} or later resume automatically.</Text>
          <View style={[styles.toggleRow, { borderColor: c.border }]}>
            <View style={styles.flexOne}>
              <Text style={[styles.toggleLabel, { color: c.foreground }]}>Use this payment for other debts</Text>
              <Text style={[styles.copy, { color: c.mutedForeground }]}>{redirectEnabled ? "Follow your existing payoff order while this payment is paused." : "Turn on Debt Payoff Plan in Settings to redirect payments. You can still pause this debt."}</Text>
            </View>
            <Switch accessibilityLabel="Use this payment for other debts" accessibilityState={{ disabled: saving || !redirectEnabled }} disabled={saving || !redirectEnabled} value={redirectEnabled && redirectPayment} onValueChange={setRedirectPayment} trackColor={{ false: c.muted, true: c.primary }} thumbColor="#fff" />
          </View>
          <View style={[styles.summary, { backgroundColor: c.primary + "12" }]}>
            <Text style={[styles.toggleLabel, { color: c.foreground }]}>During this pause</Text>
            <View style={styles.amountRow}>
              <Text sensitive style={[styles.amount, { color: c.primary }]}>$0.00</Text>
              <Text style={[styles.copy, { color: c.mutedForeground }]}>new scheduled payments to this debt</Text>
            </View>
            <Text style={[styles.copy, { color: c.mutedForeground }]}>No new scheduled payment goes to this debt during these dates. Recorded and pending payments stay in your plan.</Text>
            <Text style={[styles.copy, { color: c.mutedForeground }]}>{redirectEnabled && redirectPayment ? "Available paused payments support other eligible debts in payoff order. Any unused money stays available in your plan." : "Paused payments stay available in your cash plan."}</Text>
          </View>
          <View style={[styles.notice, { borderColor: c.warning + "55", backgroundColor: c.warning + "10" }]}>
            <Feather name="info" size={16} color={c.warning} />
            <Text style={[styles.copy, styles.flexOne, { color: c.foreground }]}>Changes your FlowLedger plan only; lender payments are not paused. Interest may continue and payoff may be later.</Text>
          </View>
          {Boolean(error || unavailable || dateError) && <Text accessibilityRole="alert" style={[styles.error, { color: c.destructive }]}>{error || unavailable || dateError}</Text>}
        </ScrollView>
        <View style={[styles.footer, { borderColor: c.border }]}>
          <Pressable accessibilityRole="button" accessibilityLabel="Cancel" disabled={saving} onPress={close} style={[styles.button, { borderColor: c.border, opacity: saving ? 0.55 : 1 }]}>
            <Text style={[styles.buttonText, { color: c.foreground }]}>Cancel</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Pause payments" accessibilityState={{ disabled: saving || Boolean(unavailable || dateError), busy: saving }} disabled={saving || Boolean(unavailable || dateError)} onPress={save} style={[styles.button, { borderColor: c.primary, backgroundColor: c.primary, opacity: saving || Boolean(unavailable || dateError) ? 0.55 : 1 }]}>
            <Text style={[styles.buttonText, { color: c.primaryForeground }]}>{saving ? "Saving…" : "Pause payments"}</Text>
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.65)" },
  surface: { width: "100%", maxHeight: "94%", borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 20, borderWidth: 1 },
  header: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 20, marginBottom: 14 },
  title: { flex: 1, fontSize: 20, fontFamily: "Inter_700Bold" },
  close: { width: 32, height: 36, alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: 20, paddingBottom: 20, gap: 12 },
  debtName: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  summary: { borderRadius: 12, padding: 14, gap: 7 },
  label: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  amountRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  amount: { fontSize: 22, fontFamily: "Inter_700Bold" },
  copy: { fontSize: 12, lineHeight: 18, fontFamily: "Inter_400Regular" },
  dateHelp: { marginTop: -4 },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: 12, padding: 14 },
  toggleLabel: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_600SemiBold" },
  flexOne: { flex: 1, minWidth: 0 },
  notice: { flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 14, borderRadius: 12, borderWidth: 1 },
  error: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_500Medium" },
  footer: { flexDirection: "row", gap: 10, padding: 16, borderTopWidth: 1 },
  button: { flex: 1, minHeight: 46, paddingHorizontal: 8, borderWidth: 1, borderRadius: 12, justifyContent: "center", alignItems: "center" },
  buttonText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
});
