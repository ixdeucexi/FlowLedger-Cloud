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
import { useAuth } from "@/context/AuthContext";
import { useBudget } from "@/context/BudgetContext";
import { useBackDismiss } from "@/hooks/useBackDismiss";
import { useColors } from "@/hooks/useColors";
import {
  resolveForecastAccountReference,
  type ForecastAccountRef,
} from "@/lib/accountForecasts";
import { safeLocalDateInTimeZone } from "@/lib/financialProjection";
import { parseMoneyInput } from "@/lib/moneyFormInput";
import {
  validPlannedTransferDate,
  type PlannedAccountTransfer,
  type PlannedTransferPatch,
} from "@/lib/plannedAccountTransfers";

const money = (value: number) =>
  value.toLocaleString("en-US", { style: "currency", currency: "USD" });

/** Plans future cash movement only; never records or initiates a bank transfer. */
export function PlannedTransferModal({
  visible,
  onClose,
  transfer = null,
  initialToAccountRef,
  initialDate,
}: {
  visible: boolean;
  onClose: () => void;
  transfer?: PlannedAccountTransfer | null;
  initialToAccountRef?: ForecastAccountRef | null;
  initialDate?: string;
}) {
  const c = useColors();
  const { user } = useAuth();
  const {
    activeHousehold,
    canEditHousehold,
    accountForecastReady,
    forecastAccounts,
    householdTimeZone,
    plannedTransfersReady,
    savePlannedAccountTransfer,
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
    if (!visible) return;
    createId.current =
      transfer?.id ?? `planned-transfer-${Crypto.randomUUID()}`;
    setName(transfer?.name ?? "");
    setAmount(transfer ? String(transfer.amount) : "");
    setFromRef(transfer?.from_account_ref ?? null);
    setToRef(transfer?.to_account_ref ?? initialToAccountRef ?? null);
    setFrequency(transfer?.frequency ?? "monthly");
    setStartDate(
      transfer?.start_date ??
        initialDate ??
        safeLocalDateInTimeZone(new Date(), householdTimeZone),
    );
    setEndDate(transfer?.end_date ?? "");
    setPaused(transfer?.status === "paused");
    setExpectedRevision(transfer?.revision ?? null);
    setSaving(false);
    validationField.current = null;
    setError(null);
  }, [visible, transfer?.id, scope]);
  useBackDismiss(visible && !saving, onClose);
  const locked =
    !access.current.ready ||
    !canEditHousehold ||
    saving ||
    Boolean(transfer?.deleted_at);
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
    if (!previewReady || !canonicalFrom || !canonicalTo) {
      showValidationError(
        "account",
        "Choose two different available cash accounts. Linked names for the same account cannot transfer to each other.",
      );
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
      status: paused ? "paused" : "active",
    };
    const startedScope = scope;
    const operation = {};
    savingRef.current = operation;
    setSaving(true);
    validationField.current = null;
    setError(null);
    try {
      await savePlannedAccountTransfer(
        createId.current!,
        patch,
        expectedRevision,
      );
      if (
        savingRef.current === operation &&
        access.current.scope === startedScope &&
        access.current.visible
      )
        onClose();
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
                {transfer ? "Edit transfer plan" : "Plan a transfer"}
              </Text>
              <Text style={[styles.help, { color: c.mutedForeground }]}>
                Planned only. FlowLedger does not move money.
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
          <ScrollView
            keyboardShouldPersistTaps="handled"
            style={styles.scroll}
            contentContainerStyle={styles.form}
          >
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
            <View
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
            </View>
            <DatePickerField
              label={
                frequency === "monthly"
                  ? "First transfer date"
                  : "Transfer date"
              }
              value={startDate}
              onChange={(value) => {
                setStartDate(value);
                clearValidationError("date");
              }}
              disabled={locked}
            />
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
            <Pressable
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
            </Pressable>
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
              accessibilityLabel="Save transfer plan"
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
                {saving ? "Saving…" : "Save plan"}
              </Text>
            </Pressable>
          </ScrollView>
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
