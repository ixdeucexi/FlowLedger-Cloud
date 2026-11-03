import Feather from "@expo/vector-icons/Feather";
import React, { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from "react-native";
import {
  PrivacyPressable as Pressable,
  PrivacyText as Text,
  PrivacyView as View,
} from "@/components/privacy/PrivacyPrimitives";

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
export type DebtPaymentPauseStep = "dates" | "transfer";

interface Props {
  visible: boolean;
  bill: Bill;
  today: string;
  canEdit: boolean;
  redirectEnabled: boolean;
  openDateField: DebtPaymentPauseDateField;
  onOpenDateFieldChange: (field: DebtPaymentPauseDateField) => void;
  step: DebtPaymentPauseStep;
  onStepChange: (step: DebtPaymentPauseStep) => void;
  onSavingChange: (saving: boolean) => void;
  onClose: () => void;
  onSave: (input: DebtPaymentPauseInput) => Promise<void>;
}

function readableDate(value: string) {
  return (
    dateOnlyToLocalDate(value)?.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    }) ?? value
  );
}

/** One nested view in the bill editor's modal; the editor owns Back/history. */
export function DebtPaymentPauseModal({
  visible,
  bill,
  today,
  canEdit,
  redirectEnabled,
  openDateField,
  onOpenDateFieldChange,
  step,
  onStepChange,
  onSavingChange,
  onClose,
  onSave,
}: Props) {
  const c = useColors();
  const desktop = useDesktopExperience();
  const [startDate, setStartDate] = useState(today);
  const [resumeDate, setResumeDate] = useState(() => addDateOnlyMonths(today, 2));
  const [redirectPayment, setRedirectPayment] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const savingRef = useRef(false);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (!visible) return;
    setStartDate(today);
    setResumeDate(addDateOnlyMonths(today, 2));
    setRedirectPayment(null);
    setError("");
    // Opening starts a new draft; confirmed-row refreshes preserve this draft.
  }, [visible, bill.id]);

  useEffect(() => {
    if (!redirectEnabled) setRedirectPayment((value) => (value === true ? null : value));
  }, [redirectEnabled]);

  useEffect(() => {
    if (visible) scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [visible, step]);

  const unavailable = !canEdit
    ? "Only household editors can pause debt payments."
    : !bill.is_debt || bill.balance <= 0.009 || Boolean(bill.end_date)
      ? "Payment pauses are available for open debts with a balance."
      : "";
  const dateError =
    !isDebtPaymentPauseDate(startDate) || !isDebtPaymentPauseDate(resumeDate)
      ? "Choose valid start and resume dates."
      : startDate < today
        ? "The pause must start today or later."
        : resumeDate <= startDate
          ? "Payments must resume after the pause starts."
          : "";
  const close = () => {
    if (!savingRef.current) onClose();
  };
  const choosePayment = (move: boolean) => {
    if (savingRef.current || (move && !redirectEnabled)) return;
    setRedirectPayment(move);
    setError("");
  };
  // RN Web's PressResponder handles Enter for radio roles, but only handles
  // Space for button roles. Preserve native press behavior and add radio Space.
  const choiceKeyboardProps = (move: boolean) => Platform.OS === "web" ? {
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key !== " " && event.key !== "Spacebar") return;
      event.preventDefault();
      event.stopPropagation();
      choosePayment(move);
    },
  } : {};
  const validateDates = () => {
    if (unavailable || dateError) {
      setError(unavailable || dateError);
      return false;
    }
    try {
      const history = normalizeDebtPaymentPauses(bill.debt_payment_pauses);
      let draftId = "pause-draft";
      let draftIndex = 0;
      while (history.some((pause) => pause.id === draftId)) draftId = `pause-draft-${++draftIndex}`;
      normalizeDebtPaymentPauses([
        ...history,
        {
          id: draftId,
          start_date: startDate,
          resume_date: resumeDate,
          redirect_payment: redirectEnabled && redirectPayment === true,
        },
      ]);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Check the pause dates and try again.");
      return false;
    }
  };
  const continueToChoice = () => {
    if (savingRef.current || !validateDates()) return;
    setError("");
    onOpenDateFieldChange(null);
    onStepChange("transfer");
  };
  const backToDates = () => {
    if (savingRef.current) return;
    setError("");
    onStepChange("dates");
  };
  const save = async () => {
    if (savingRef.current || !validateDates()) return;
    if (
      step !== "transfer" ||
      redirectPayment === null ||
      (redirectPayment === true && !redirectEnabled)
    ) {
      setError("Choose whether to move this payment or keep it available.");
      return;
    }
    savingRef.current = true;
    setSaving(true);
    onSavingChange(true);
    setError("");
    try {
      await onSave({ startDate, resumeDate, redirectPayment });
      onClose();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Couldn’t save this pause. Please try again.",
      );
    } finally {
      savingRef.current = false;
      setSaving(false);
      onSavingChange(false);
    }
  };

  if (!visible) return null;
  const normalPayment = bill.amount.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  });
  const frequency =
    bill.frequency === "quarterly"
      ? "every 3 months"
      : bill.frequency === "biweekly"
        ? "every 2 weeks"
        : bill.frequency === "weekly"
          ? "each week"
          : "each month";
  const choosingTransfer = step === "transfer";
  const saveDisabled =
    saving ||
    Boolean(unavailable || dateError) ||
    redirectPayment === null ||
    (redirectPayment === true && !redirectEnabled);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={[styles.overlay, desktop && DESKTOP_MODAL_OVERLAY]}
    >
      <Pressable
        accessible={false}
        importantForAccessibility="no"
        disabled={saving}
        onPress={close}
        style={StyleSheet.absoluteFillObject}
      />
      <View
        accessibilityViewIsModal
        style={[
          styles.surface,
          { backgroundColor: c.background, borderColor: c.border },
          desktop && DESKTOP_MODAL_COMPACT,
        ]}
      >
        <View style={styles.header}>
          <View style={styles.flexOne}>
            <Text style={[styles.stepLabel, { color: c.primary }]}>
              STEP {choosingTransfer ? "2" : "1"} OF 2
            </Text>
            <Text accessibilityRole="header" style={[styles.title, { color: c.foreground }]}>
              Pause debt payments
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close debt payment pause"
            accessibilityState={{ disabled: saving }}
            disabled={saving}
            onPress={close}
            hitSlop={8}
            style={styles.close}
          >
            <Feather name="x" size={22} color={c.mutedForeground} />
          </Pressable>
        </View>
        <ScrollView
          ref={scrollRef}
          showsVerticalScrollIndicator={desktop}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.content}
        >
          <Text style={[styles.debtName, { color: c.foreground }]}>{bill.name}</Text>
          <View style={[styles.summary, { backgroundColor: c.muted }]}>
            <Text style={[styles.label, { color: c.mutedForeground }]}>
              Normal required payment
            </Text>
            <View style={styles.amountRow}>
              <Text
                sensitive
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.75}
                style={[styles.amount, { color: c.foreground }]}
              >
                {normalPayment}
              </Text>
              <Text style={[styles.copy, { color: c.mutedForeground }]}>{frequency}</Text>
            </View>
            {choosingTransfer && (
              <Text style={[styles.copy, { color: c.mutedForeground }]}>
                {readableDate(startDate)} → {readableDate(resumeDate)}
              </Text>
            )}
          </View>
          {choosingTransfer ? (
            <>
              <Text accessibilityRole="header" style={[styles.question, { color: c.foreground }]}>
                Would you like to move this payment to another debt?
              </Text>
              <Text style={[styles.copy, { color: c.mutedForeground }]}>
                Choose what happens to the money during this pause.
              </Text>
              <Pressable
                accessibilityRole="radio"
                accessibilityLabel="Yes, use payoff order"
                aria-checked={redirectPayment === true}
                accessibilityState={{
                  checked: redirectPayment === true,
                  disabled: saving || !redirectEnabled,
                }}
                disabled={saving || !redirectEnabled}
                onPress={() => choosePayment(true)}
                {...choiceKeyboardProps(true)}
                style={[
                  styles.choice,
                  {
                    borderColor: redirectPayment === true ? c.primary : c.border,
                    backgroundColor: redirectPayment === true ? c.primary + "12" : c.card,
                    opacity: saving || !redirectEnabled ? 0.55 : 1,
                  },
                ]}
              >
                <Feather
                  name={redirectPayment === true ? "check-circle" : "circle"}
                  size={20}
                  color={redirectPayment === true ? c.primary : c.mutedForeground}
                />
                <View style={styles.flexOne}>
                  <Text style={[styles.toggleLabel, { color: c.foreground }]}>
                    Yes, use payoff order
                  </Text>
                  <Text style={[styles.copy, { color: c.mutedForeground }]}>
                    Available payments go to your next eligible debts in payoff order. Unused money
                    stays available.
                  </Text>
                </View>
              </Pressable>
              {!redirectEnabled && (
                <Text style={[styles.copy, { color: c.mutedForeground }]}>
                  Turn on Debt Payoff Plan in Settings to move payments. You can still pause this
                  debt.
                </Text>
              )}
              <Pressable
                accessibilityRole="radio"
                accessibilityLabel="No, keep it available"
                aria-checked={redirectPayment === false}
                accessibilityState={{ checked: redirectPayment === false, disabled: saving }}
                disabled={saving}
                onPress={() => choosePayment(false)}
                {...choiceKeyboardProps(false)}
                style={[
                  styles.choice,
                  {
                    borderColor: redirectPayment === false ? c.primary : c.border,
                    backgroundColor: redirectPayment === false ? c.primary + "12" : c.card,
                    opacity: saving ? 0.55 : 1,
                  },
                ]}
              >
                <Feather
                  name={redirectPayment === false ? "check-circle" : "circle"}
                  size={20}
                  color={redirectPayment === false ? c.primary : c.mutedForeground}
                />
                <View style={styles.flexOne}>
                  <Text style={[styles.toggleLabel, { color: c.foreground }]}>
                    No, keep it available
                  </Text>
                  <Text style={[styles.copy, { color: c.mutedForeground }]}>
                    Keep the money in your cash plan without assigning it to another debt.
                  </Text>
                </View>
              </Pressable>
            </>
          ) : (
            <>
              <DatePickerField
                label="Pause starts"
                value={startDate}
                onChange={(value) => {
                  setStartDate(value);
                  setError("");
                }}
                minDate={today}
                disabled={saving}
                open={openDateField === "start"}
                onOpenChange={(open) => onOpenDateFieldChange(open ? "start" : null)}
              />
              <DatePickerField
                label="Payments resume"
                value={resumeDate}
                onChange={(value) => {
                  setResumeDate(value);
                  setError("");
                }}
                minDate={addDateOnlyDays(startDate, 1)}
                disabled={saving}
                open={openDateField === "resume"}
                onOpenChange={(open) => onOpenDateFieldChange(open ? "resume" : null)}
              />
              <Text style={[styles.copy, { color: c.mutedForeground }]}>
                Scheduled payments pause on {readableDate(startDate)} and resume automatically on{" "}
                {readableDate(resumeDate)}. Your debt stays open and keeps its payoff order.
              </Text>
              <Text style={[styles.copy, { color: c.mutedForeground }]}>
                Recorded and pending payments stay in your plan.
              </Text>
            </>
          )}
          <View
            style={[
              styles.notice,
              { borderColor: c.warning + "55", backgroundColor: c.warning + "10" },
            ]}
          >
            <Feather name="info" size={16} color={c.warning} />
            <Text style={[styles.copy, styles.flexOne, { color: c.foreground }]}>
              Changes your FlowLedger plan only; lender payments are not paused. Interest may
              continue and payoff may be later.
            </Text>
          </View>
          {Boolean(error || unavailable || dateError) && (
            <Text accessibilityRole="alert" style={[styles.error, { color: c.destructive }]}>
              {error || unavailable || dateError}
            </Text>
          )}
        </ScrollView>
        <View style={[styles.footer, { borderColor: c.border }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={choosingTransfer ? "Back" : "Cancel"}
            accessibilityState={{ disabled: saving }}
            disabled={saving}
            onPress={choosingTransfer ? backToDates : close}
            style={[styles.button, { borderColor: c.border, opacity: saving ? 0.55 : 1 }]}
          >
            <Text style={[styles.buttonText, { color: c.foreground }]}>
              {choosingTransfer ? "Back" : "Cancel"}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={choosingTransfer ? "Pause payments" : "Continue"}
            accessibilityState={{
              disabled: choosingTransfer
                ? saveDisabled
                : saving || Boolean(unavailable || dateError),
              busy: saving,
            }}
            disabled={choosingTransfer ? saveDisabled : saving || Boolean(unavailable || dateError)}
            onPress={choosingTransfer ? save : continueToChoice}
            style={[
              styles.button,
              {
                borderColor: c.primary,
                backgroundColor: c.primary,
                opacity: (
                  choosingTransfer ? saveDisabled : saving || Boolean(unavailable || dateError)
                )
                  ? 0.55
                  : 1,
              },
            ]}
          >
            <Text style={[styles.buttonText, { color: c.primaryForeground }]}>
              {saving ? "Saving…" : choosingTransfer ? "Pause payments" : "Continue"}
            </Text>
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.65)",
  },
  surface: {
    width: "100%",
    maxHeight: "94%",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 20,
    borderWidth: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 20,
    marginBottom: 14,
  },
  stepLabel: { fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 1, marginBottom: 5 },
  title: { fontSize: 20, fontFamily: "Inter_700Bold" },
  close: { width: 32, height: 36, alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: 20, paddingBottom: 20, gap: 12 },
  debtName: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  summary: { borderRadius: 12, padding: 14, gap: 7 },
  label: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  amountRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  amount: { flexShrink: 1, fontSize: 22, fontFamily: "Inter_700Bold" },
  copy: { fontSize: 12, lineHeight: 18, fontFamily: "Inter_400Regular" },
  question: { fontSize: 18, lineHeight: 24, fontFamily: "Inter_700Bold" },
  choice: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
  },
  toggleLabel: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_600SemiBold" },
  flexOne: { flex: 1, minWidth: 0 },
  notice: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  error: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_500Medium" },
  footer: { flexDirection: "row", gap: 10, padding: 16, borderTopWidth: 1 },
  button: {
    flex: 1,
    minHeight: 46,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  buttonText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
});
