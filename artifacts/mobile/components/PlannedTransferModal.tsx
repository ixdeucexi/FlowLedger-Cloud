import Feather from "@expo/vector-icons/Feather";
import * as Crypto from "expo-crypto";
import React, { useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
} from "react-native";
import {
  PrivacyPressable as Pressable,
  PrivacyText as Text,
  PrivacyTextInput as TextInput,
  PrivacyView as View,
} from "@/components/privacy/PrivacyPrimitives";
import {
  AccountForecastPicker,
  accountForecastLabel,
} from "@/components/AccountForecastPicker";
import { DatePickerField } from "@/components/DatePickerField";
import { BillPaymentHistoryPanel } from "@/components/BillPaymentHistoryPanel";
import { useAuth } from "@/context/AuthContext";
import { useBudget, type Bill } from "@/context/BudgetContext";
import { useBackDismiss } from "@/hooks/useBackDismiss";
import { useColors } from "@/hooks/useColors";
import {
  resolveForecastAccountReference,
  type ForecastAccountRef,
} from "@/lib/accountForecasts";
import { safeLocalDateInTimeZone } from "@/lib/financialProjection";
import { parseMoneyInput } from "@/lib/moneyFormInput";
import { addDateOnlyDays } from "@/lib/dateLabels";
import {
  validPlannedTransferDate,
  type PlannedAccountTransfer,
  type PlannedTransferPatch,
} from "@/lib/plannedAccountTransfers";

const money = (value: number) =>
  value.toLocaleString("en-US", { style: "currency", currency: "USD" });

export interface PlannedTransferInitialValues {
  name?: string;
  amount?: number | string;
  fromAccountRef?: ForecastAccountRef | null;
  frequency?: "once" | "monthly";
  startDate?: string;
  endDate?: string | null;
}

/** Plans future cash movement only; never records or initiates a bank transfer. */
export function PlannedTransferModal({
  visible,
  onClose,
  transfer = null,
  initialToAccountRef,
  initialDate,
  initialValues,
  conversionBill = null,
  onSaved,
  onBackToBill,
  initialHistory = false,
  historyOnly = false,
}: {
  visible: boolean;
  onClose: () => void;
  transfer?: PlannedAccountTransfer | null;
  initialToAccountRef?: ForecastAccountRef | null;
  initialDate?: string;
  initialValues?: PlannedTransferInitialValues;
  conversionBill?: Bill | null;
  onSaved?: () => void;
  onBackToBill?: () => void;
  initialHistory?: boolean;
  historyOnly?: boolean;
}) {
  const c = useColors();
  const { user } = useAuth();
  const {
    activeHousehold,
    bills,
    canEditHousehold,
    accountForecastReady,
    forecastAccounts,
    householdTimeZone,
    plannedTransfersReady,
    savePlannedAccountTransfer,
    convertBillToPlannedTransfer,
  } = useBudget();
  const scope = `${user?.id ?? "demo"}:${activeHousehold?.householdId ?? "none"}:${activeHousehold?.budgetId ?? "none"}`;
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [fromRef, setFromRef] = useState<ForecastAccountRef | null>(null);
  const [toRef, setToRef] = useState<ForecastAccountRef | null>(null);
  const [frequency, setFrequency] = useState<"once" | "monthly">("monthly");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [paused, setPaused] = useState(false);
  const [expectedRevision, setExpectedRevision] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversionConfirmed, setConversionConfirmed] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(initialHistory || historyOnly);
  const openScopeRef = useRef<string | null>(visible ? scope : null);
  const scopeChanged = visible && openScopeRef.current !== null && openScopeRef.current !== scope;
  const conversion = Boolean(conversionBill);
  const sourceBillId = transfer?.source_bill_id ?? null;
  const historyAvailable = Boolean(sourceBillId && user?.id && !scopeChanged
    && transfer?.household_id === activeHousehold?.householdId
    && transfer?.budget_id === activeHousehold?.budgetId);
  const sourceBill = bills.find((bill: Bill & { household_id?: string; budget_id?: string }) => bill.id === sourceBillId
    && bill.household_id === activeHousehold?.householdId
    && bill.budget_id === activeHousehold?.budgetId);
  const showingHistory = historyOnly || historyOpen;
  const validationField = useRef<"name" | "amount" | "date" | "account" | null>(
    null,
  );
  const showValidationError = (
    field: "name" | "amount" | "date" | "account",
    message: string,
  ) => {
    validationField.current = field;
    setError(message);
  };
  const clearValidationError = (
    field: "name" | "amount" | "date" | "account",
  ) => {
    if (validationField.current === field) {
      validationField.current = null;
      setError(null);
    }
  };
  const savingRef = useRef<object | null>(null);
  const createId = useRef<string | null>(null);
  const access = useRef({ scope, visible, ready: false, canEdit: false });
  access.current = {
    scope,
    visible,
    ready: Boolean(
      activeHousehold && accountForecastReady && plannedTransfersReady,
    ),
    canEdit: canEditHousehold,
  };
  useEffect(() => {
    savingRef.current = null;
    if (!visible) { openScopeRef.current = null; return; }
    if (openScopeRef.current === null) openScopeRef.current = scope;
    if (openScopeRef.current !== scope) {
      setName(""); setAmount(""); setFromRef(null); setToRef(null);
      setHistoryOpen(false);
      setError("The household changed. Close this editor and open it again.");
      return;
    }
    createId.current =
      transfer?.id ?? `planned-transfer-${Crypto.randomUUID()}`;
    setName(transfer?.name ?? initialValues?.name ?? conversionBill?.name ?? "");
    setAmount(transfer ? String(transfer.amount) : String(initialValues?.amount ?? conversionBill?.amount ?? ""));
    setFromRef(transfer?.from_account_ref ?? initialValues?.fromAccountRef ?? resolveForecastAccountReference(conversionBill?.funding_account_ref, forecastAccounts));
    setToRef(transfer?.to_account_ref ?? initialToAccountRef ?? null);
    setFrequency(transfer?.frequency ?? (conversionBill ? (conversionBill.is_recurring ? "monthly" : "once") : initialValues?.frequency ?? "monthly"));
    setStartDate(
      transfer?.start_date ??
        (conversionBill ? "" : initialValues?.startDate) ??
        initialDate ??
        safeLocalDateInTimeZone(new Date(), householdTimeZone),
    );
    setEndDate(transfer?.end_date ?? initialValues?.endDate ?? "");
    setPaused(transfer?.status === "paused");
    setExpectedRevision(transfer?.revision ?? null);
    setSaving(false);
    setConversionConfirmed(false);
    setHistoryOpen(initialHistory || historyOnly);
    validationField.current = null;
    setError(null);
  }, [visible, transfer?.id, conversionBill?.id, scope, initialHistory, historyOnly]);
  useBackDismiss(visible && !saving, showingHistory && !historyOnly ? () => setHistoryOpen(false) : onClose);
  const locked =
    !access.current.ready ||
    !canEditHousehold ||
    saving ||
    Boolean(transfer?.deleted_at) ||
    scopeChanged;
  const parsed = parseMoneyInput(amount);
  const canonicalFrom = resolveForecastAccountReference(
    fromRef,
    forecastAccounts,
  );
  const canonicalTo = resolveForecastAccountReference(toRef, forecastAccounts);
  const from = forecastAccounts.find(
    (account) => account.ref === canonicalFrom,
  );
  const to = forecastAccounts.find((account) => account.ref === canonicalTo);
  const previewReady = Boolean(
    from &&
    to &&
    canonicalFrom !== canonicalTo &&
    parsed !== null &&
    parsed > 0,
  );
  const save = async () => {
    if (
      savingRef.current ||
      !access.current.visible ||
      access.current.scope !== scope
    )
      return;
    if (locked) {
      setError(
        "Wait for this household’s accounts and transfer plans to finish loading. An owner or editor can save changes.",
      );
      return;
    }
    const normalized = name.trim().replace(/\s+/g, " ");
    if (!normalized || normalized.length > 80) {
      showValidationError(
        "name",
        "Enter a transfer name using 80 characters or fewer.",
      );
      return;
    }
    if (parsed === null || parsed <= 0 || parsed > 1_000_000_000) {
      showValidationError(
        "amount",
        "Enter an amount greater than $0 with up to two decimal places.",
      );
      return;
    }
    if (
      !validPlannedTransferDate(startDate) ||
      (frequency === "monthly" &&
        endDate &&
        (!validPlannedTransferDate(endDate) || endDate < startDate))
    ) {
      showValidationError(
        "date",
        "Choose a valid first date and an end date on or after it.",
      );
      return;
    }
    if (conversion && startDate <= safeLocalDateInTimeZone(new Date(), householdTimeZone)) {
      showValidationError("date", "Choose a first transfer date after today. Your earlier bill history stays saved.");
      return;
    }
    if (!previewReady || !canonicalFrom || !canonicalTo) {
      showValidationError(
        "account",
        "Choose two different available cash accounts. Linked names for the same account cannot transfer to each other.",
      );
      return;
    }
    if (conversion && !conversionConfirmed) {
      setError("Confirm that future bill payments will become a transfer plan.");
      return;
    }
    const patch: PlannedTransferPatch = {
      name: normalized,
      amount: parsed,
      from_account_ref: canonicalFrom,
      to_account_ref: canonicalTo,
      frequency,
      start_date: startDate,
      end_date: frequency === "monthly" ? endDate || null : null,
      status: !conversion && paused ? "paused" : "active",
    };
    const startedScope = scope;
    const operation = {};
    savingRef.current = operation;
    setSaving(true);
    validationField.current = null;
    setError(null);
    try {
      if (conversionBill) await convertBillToPlannedTransfer(conversionBill, patch);
      else await savePlannedAccountTransfer(createId.current!, patch, expectedRevision);
      if (
        savingRef.current === operation &&
        access.current.scope === startedScope &&
        access.current.visible
      ) {
        if (onSaved) onSaved();
        else onClose();
      }
    } catch (caught) {
      if (
        savingRef.current === operation &&
        access.current.scope === startedScope &&
        access.current.visible
      )
        setError(
          caught instanceof Error
            ? caught.message
            : "This plan could not be saved. Try again.",
        );
    } finally {
      if (savingRef.current === operation) {
        savingRef.current = null;
        if (access.current.scope === startedScope) setSaving(false);
      }
    }
  };
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={saving ? undefined : onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.overlay}
      >
        <Pressable
          accessibilityLabel="Close planned transfer editor"
          disabled={saving}
          onPress={onClose}
          style={StyleSheet.absoluteFillObject}
        />
        <View
          style={[
            styles.sheet,
            { backgroundColor: c.background, borderColor: c.border },
          ]}
        >
          <View style={styles.heading}>
            <View style={styles.flex}>
              <Text style={[styles.title, { color: c.foreground }]}>
                {showingHistory ? "Earlier bill payments" : conversion ? "Change to transfer" : transfer ? "Edit transfer plan" : "Plan a transfer"}
              </Text>
              <Text style={[styles.help, { color: c.mutedForeground }]}>
                {showingHistory ? "Recorded payments from the original bill." : "Planned only. FlowLedger does not move money."}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close planned transfer editor"
              disabled={saving}
              onPress={onClose}
              style={styles.close}
            >
              <Feather name="x" size={22} color={c.mutedForeground} />
            </Pressable>
          </View>
          {onBackToBill ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Back to bill" disabled={saving} onPress={onBackToBill} style={styles.back}>
              <Feather name="arrow-left" size={18} color={c.primary} />
              <Text style={[styles.choiceText, { color: c.primary }]}>Back to bill</Text>
            </Pressable>
          ) : null}
          {showingHistory ? (
            <View style={styles.historyContent}>
              {!historyOnly ? <Pressable accessibilityRole="button" accessibilityLabel="Back to transfer" onPress={() => setHistoryOpen(false)} style={styles.back}>
                <Feather name="arrow-left" size={18} color={c.primary} />
                <Text style={[styles.choiceText, { color: c.primary }]}>Back to transfer</Text>
              </Pressable> : null}
              {historyAvailable && sourceBillId ? <BillPaymentHistoryPanel billId={sourceBillId} billName={sourceBill?.name ?? transfer?.name ?? "Earlier bill payments"} /> : (
                <Text accessibilityRole="alert" style={[styles.help, { color: c.mutedForeground }]}>Close this editor and reopen the transfer in its household to view earlier payments.</Text>
              )}
            </View>
          ) : <ScrollView
            keyboardShouldPersistTaps="handled"
            style={styles.scroll}
            contentContainerStyle={styles.form}
          >
            {historyAvailable ? <Pressable accessibilityRole="button" accessibilityLabel="Earlier bill payments" disabled={saving} onPress={() => setHistoryOpen(true)} style={[styles.historyLink, { borderColor: c.primary + "35", backgroundColor: c.primary + "0c" }]}>
              <Feather name="clock" size={18} color={c.primary} />
              <Text style={[styles.confirmText, { color: c.foreground }]}>Earlier bill payments</Text>
              <Feather name="chevron-right" size={18} color={c.primary} />
            </Pressable> : null}
            {!canEditHousehold ? (
              <Text style={[styles.help, { color: c.warning }]}>
                Only a household owner or editor can change transfer plans.
              </Text>
            ) : null}
            <Text style={[styles.label, { color: c.mutedForeground }]}>
              Name
            </Text>
            <TextInput
              accessibilityLabel="Transfer plan name"
              value={name}
              onChangeText={(value) => {
                setName(value);
                clearValidationError("name");
              }}
              editable={!locked}
              maxLength={80}
              placeholder="Monthly spending money"
              placeholderTextColor={c.mutedForeground}
              style={[
                styles.input,
                {
                  color: c.foreground,
                  borderColor: c.border,
                  backgroundColor: c.card,
                },
              ]}
            />
            <AccountForecastPicker
              label="From account"
              value={fromRef}
              onChange={(value) => {
                setFromRef(value);
                clearValidationError("account");
              }}
              allowUnassigned={false}
              disabled={locked}
            />
            <AccountForecastPicker
              label="To account"
              value={toRef}
              onChange={(value) => {
                setToRef(value);
                clearValidationError("account");
              }}
              allowUnassigned={false}
              disabled={locked}
            />
            <Text style={[styles.label, { color: c.mutedForeground }]}>
              Amount
            </Text>
            <TextInput
              accessibilityLabel="Transfer plan amount"
              value={amount}
              onChangeText={(value) => {
                setAmount(value);
                clearValidationError("amount");
              }}
              editable={!locked}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor={c.mutedForeground}
              style={[
                styles.input,
                {
                  color: c.foreground,
                  borderColor: c.border,
                  backgroundColor: c.card,
                },
              ]}
            />
            {conversion ? <Text style={[styles.help, { color: c.mutedForeground }]}>
              {frequency === "monthly" ? "Monthly transfer · keeps this bill’s frequency" : "One-time transfer · replaces this one-time bill"}
            </Text> : <View
              style={styles.frequency}
              accessibilityRole="radiogroup"
              accessibilityLabel="Transfer frequency"
            >
              {(["monthly", "once"] as const).map((choice) => (
                <Pressable
                  key={choice}
                  accessibilityRole="radio"
                  accessibilityState={{
                    checked: frequency === choice,
                    disabled: locked,
                  }}
                  aria-checked={frequency === choice}
                  disabled={locked}
                  onPress={() => {
                    setFrequency(choice);
                    clearValidationError("date");
                  }}
                  style={[
                    styles.choice,
                    {
                      borderColor: frequency === choice ? c.primary : c.border,
                      backgroundColor:
                        frequency === choice ? c.primary + "18" : c.card,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.choiceText,
                      {
                        color: frequency === choice ? c.primary : c.foreground,
                      },
                    ]}
                  >
                    {choice === "monthly" ? "Monthly" : "One time"}
                  </Text>
                </Pressable>
              ))}
            </View>}
            <DatePickerField
              label={
                conversion || frequency === "monthly"
                  ? "First transfer date"
                  : "Transfer date"
              }
              value={startDate}
              placeholder={conversion ? "Choose a future date…" : undefined}
              minDate={conversion ? addDateOnlyDays(safeLocalDateInTimeZone(new Date(), householdTimeZone), 1) : undefined}
              onChange={(value) => {
                setStartDate(value);
                clearValidationError("date");
              }}
              disabled={locked}
            />
            {conversion ? (
              <Text style={[styles.help, { color: c.mutedForeground }]}>
                Start on or before the next unpaid bill payment. Review earlier payments first.
              </Text>
            ) : null}
            {frequency === "monthly" ? (
              <>
                <Text style={[styles.help, { color: c.mutedForeground }]}>
                  Repeats on the same day each month. Shorter months use their
                  last day.
                </Text>
                <DatePickerField
                  label="Last date (optional)"
                  value={endDate}
                  onChange={(value) => {
                    setEndDate(value);
                    clearValidationError("date");
                  }}
                  minDate={startDate || undefined}
                  optional
                  disabled={locked}
                />
              </>
            ) : null}
            {!conversion ? <Pressable
              accessibilityRole="checkbox"
              accessibilityLabel="Pause this transfer plan"
              accessibilityState={{ checked: paused, disabled: locked }}
              aria-checked={paused}
              disabled={locked}
              onPress={() => setPaused((value) => !value)}
              style={styles.check}
            >
              <Feather
                name={paused ? "check-square" : "square"}
                size={20}
                color={c.primary}
              />
              <Text style={[styles.help, { color: c.foreground }]}>
                Pause this plan
              </Text>
            </Pressable> : null}
            {previewReady && from && to && parsed !== null ? (
              <View
                style={[
                  styles.preview,
                  { backgroundColor: c.card, borderColor: c.border },
                ]}
              >
                <Text style={[styles.label, { color: c.mutedForeground }]}>
                  Each planned transfer
                </Text>
                <View style={styles.previewRow}>
                  <Text
                    numberOfLines={2}
                    accessibilityLabel={accountForecastLabel(from)}
                    style={[styles.previewName, { color: c.foreground }]}
                  >
                    {accountForecastLabel(from)}
                  </Text>
                  <Text
                    sensitive
                    style={[styles.previewAmount, { color: c.foreground }]}
                  >
                    −{money(parsed)}
                  </Text>
                </View>
                <View style={styles.previewRow}>
                  <Text
                    numberOfLines={2}
                    accessibilityLabel={accountForecastLabel(to)}
                    style={[styles.previewName, { color: c.foreground }]}
                  >
                    {accountForecastLabel(to)}
                  </Text>
                  <Text
                    sensitive
                    style={[styles.previewAmount, { color: c.success }]}
                  >
                    +{money(parsed)}
                  </Text>
                </View>
                <Text style={[styles.help, { color: c.mutedForeground }]}>
                  This changes the forecast for these accounts. It does not
                  create Activity transactions.
                </Text>
              </View>
            ) : null}
            {transfer ? (
              <Text style={[styles.help, { color: c.mutedForeground }]}>
                Dates you have adjusted keep their original amount and accounts.
                Change those dates separately if needed.
              </Text>
            ) : null}
            {conversion ? (
              <View style={[styles.preview, { backgroundColor: c.primary + "0c", borderColor: c.primary + "35" }]}>
                <Text style={[styles.help, { color: c.foreground }]}>
                  Earlier bill payments and history stay saved. From the date you choose, this transfer replaces the bill’s future schedule.
                </Text>
                <Pressable accessibilityRole="checkbox" accessibilityLabel="Confirm changing future bill payments to a transfer" accessibilityState={{ checked: conversionConfirmed, disabled: locked }} aria-checked={conversionConfirmed} disabled={locked} onPress={() => { setConversionConfirmed(value => !value); setError(null); }} style={styles.check}>
                  <Feather name={conversionConfirmed ? "check-square" : "square"} size={20} color={c.primary} />
                  <Text style={[styles.confirmText, { color: c.foreground }]}>Change future payments to this transfer</Text>
                </Pressable>
              </View>
            ) : null}
            {error ? (
              <Text
                accessibilityRole="alert"
                style={[styles.help, { color: c.destructive }]}
              >
                {error}
              </Text>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={conversion ? "Change to transfer" : "Save transfer plan"}
              accessibilityState={{ disabled: locked }}
              disabled={locked}
              onPress={() => {
                void save();
              }}
              style={[
                styles.save,
                { backgroundColor: c.primary, opacity: locked ? 0.5 : 1 },
              ]}
            >
              <Text style={[styles.saveText, { color: c.primaryForeground }]}>
                {saving ? "Saving…" : conversion ? "Change to transfer" : "Save plan"}
              </Text>
            </Pressable>
          </ScrollView>}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,.65)",
    padding: 16,
  },
  sheet: {
    width: "100%",
    maxWidth: 540,
    maxHeight: "90%",
    borderWidth: 1,
    borderRadius: 24,
    padding: 18,
    gap: 12,
  },
  historyContent: { flexShrink: 1, minHeight: 0, gap: 8 },
  historyLink: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 12, minHeight: 48, padding: 12 },
  back: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 40 },
  confirmText: { flex: 1, minWidth: 0, fontSize: 13, lineHeight: 19 },
  heading: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  flex: { flex: 1, minWidth: 0, gap: 5 },
  title: { fontSize: 22, lineHeight: 28, fontFamily: "Inter_700Bold" },
  help: { fontSize: 12, lineHeight: 18 },
  label: { fontSize: 12, lineHeight: 18, fontFamily: "Inter_600SemiBold" },
  close: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  scroll: { flexGrow: 0 },
  form: { gap: 12, paddingBottom: 8 },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 13,
    fontSize: 15,
  },
  frequency: { flexDirection: "row", gap: 10 },
  choice: {
    flex: 1,
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    padding: 10,
  },
  choiceText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  check: { flexDirection: "row", alignItems: "center", minHeight: 44, gap: 9 },
  preview: { borderWidth: 1, borderRadius: 14, padding: 13, gap: 10 },
  previewRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  previewName: { flex: 1, minWidth: 0, fontSize: 13, lineHeight: 19 },
  previewAmount: { flexShrink: 0, fontSize: 15, fontFamily: "Inter_700Bold" },
  save: {
    minHeight: 48,
    padding: 12,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  saveText: { fontSize: 15, fontFamily: "Inter_700Bold" },
});
