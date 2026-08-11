import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, TextInput, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText } from "@/components/AppText";
import { useBudget } from "@/context/BudgetContext";
import { useColors } from "@/hooks/useColors";
import { useDesktopExperience } from "@/hooks/useDesktopExperience";
import { confirmAction } from "@/lib/confirmAction";
import {
  isPlannedDebtOccurrenceDate,
  parsePlannedDebtAmount,
  parsePlannedDebtOccurrenceDate,
  plannedDebtAmountError,
} from "@/lib/debtPlanDomain";

function money(value: number) {
  return Math.max(0, Number(value) || 0).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default function PlannedDebtPaymentScreen() {
  const c = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const isDesktop = useDesktopExperience();
  const params = useLocalSearchParams<{ billId?: string | string[]; date?: string | string[] }>();
  const billId = Array.isArray(params.billId) ? params.billId[0] : params.billId;
  const occurrenceDate = Array.isArray(params.date) ? params.date[0] : params.date;
  const parsedRouteDate = parsePlannedDebtOccurrenceDate(occurrenceDate);
  const {
    bills,
    canEditHousehold,
    getAmount,
    getBillOccurrencesInMonth,
    getDebtSourceCommitment,
    getOverride,
    setPlannedDebtAmount,
  } = useBudget();
  const debt = bills.find(bill => bill.id === billId && bill.is_debt);
  const occurrenceDays = debt && parsedRouteDate
    ? getBillOccurrencesInMonth(debt, parsedRouteDate.month, parsedRouteDate.year)
    : [];
  const dateParts = isPlannedDebtOccurrenceDate(occurrenceDate, occurrenceDays) ? parsedRouteDate : undefined;
  const override = debt && dateParts ? getOverride(debt.id, dateParts.month, dateParts.year) : undefined;
  const sourceCommitment = debt && occurrenceDate
    ? getDebtSourceCommitment(debt.id, occurrenceDate)
    : undefined;
  const pendingCommitment = sourceCommitment?.state === "pending" ? sourceCommitment : undefined;
  const currentAmount = debt && dateParts
    ? pendingCommitment?.amount ?? getAmount(debt, dateParts.month, dateParts.year)
    : 0;
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const hydratedKeyRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!debt || !occurrenceDate) return;
    const key = `${debt.id}:${occurrenceDate}:${override?.planned_debt_amount ?? "auto"}:${pendingCommitment?.amount ?? "none"}`;
    if (hydratedKeyRef.current === key) return;
    hydratedKeyRef.current = key;
    setDraft(currentAmount.toFixed(2));
    setError(undefined);
  }, [currentAmount, debt, occurrenceDate, override?.planned_debt_amount, pendingCommitment?.amount]);

  const parsedDraft = parsePlannedDebtAmount(draft);
  const validationError = parsedDraft === undefined
    ? "Enter a valid amount with no more than two decimal places."
    : plannedDebtAmountError(parsedDraft, pendingCommitment?.amount ?? 0);
  const canSave = canEditHousehold && !saving && !validationError;
  const formattedDate = useMemo(() => {
    if (!occurrenceDate) return "this payment";
    const parsed = new Date(`${occurrenceDate}T12:00:00`);
    return Number.isNaN(parsed.getTime())
      ? occurrenceDate
      : parsed.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
  }, [occurrenceDate]);

  const close = () => {
    if (router.canGoBack()) router.back();
    else router.replace({
      pathname: "/(tabs)/monthly",
      params: dateParts && occurrenceDate ? { openDate: occurrenceDate, openDateAt: String(Date.now()) } : {},
    } as never);
  };

  const persist = async (amount: number | undefined) => {
    if (!debt || !dateParts || !canEditHousehold || saving) return;
    const nextError = amount === undefined
      ? undefined
      : plannedDebtAmountError(amount, pendingCommitment?.amount ?? 0);
    if (nextError) {
      setError(nextError);
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      await setPlannedDebtAmount(debt.id, dateParts.month, dateParts.year, amount);
      close();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "The planned payment could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const skip = () => {
    if (pendingCommitment) {
      setError(`A ${money(pendingCommitment.amount)} payment is already pending. It cannot be skipped until it posts or disappears.`);
      return;
    }
    confirmAction({
      title: "Skip this payment in Forecast?",
      message: "This removes the planned cash outflow from Forecast only. It does not cancel lender autopay or change the creditor minimum.",
      confirmText: "Skip in Forecast",
      destructive: true,
      onConfirm: () => persist(0),
    });
  };

  if (!debt || !dateParts || !occurrenceDate) {
    return (
      <View style={[styles.screen, styles.centered, { backgroundColor: c.background }]}>
        <AppText tone="title" style={[styles.missingTitle, { color: c.foreground }]}>Payment not found</AppText>
        <AppText style={[styles.missingCopy, { color: c.mutedForeground }]}>Return to Forecast and open the planned payment again.</AppText>
        <Pressable accessibilityRole="button" onPress={close} style={[styles.primaryButton, { backgroundColor: c.primary }]}>
          <AppText tone="button" style={[styles.primaryText, { color: c.primaryForeground }]}>Back to Forecast</AppText>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: c.background }]}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: Math.max(insets.top, 16), paddingBottom: Math.max(insets.bottom, 24) },
        ]}
      >
        <View style={[styles.shell, isDesktop && styles.desktopShell, isDesktop && { width: Math.min(720, width - 64) }]}>
          <View style={styles.header}>
            <Pressable accessibilityRole="button" accessibilityLabel="Back to Forecast" onPress={close} style={({ pressed }) => [styles.iconButton, { borderColor: c.border, opacity: pressed ? 0.7 : 1 }]}>
              <Feather name="arrow-left" size={20} color={c.foreground} />
            </Pressable>
            <View style={styles.headerCopy}>
              <AppText tone="label" style={[styles.eyebrow, { color: c.primary }]}>FORECAST PLAN</AppText>
              <AppText tone="title" style={[styles.title, { color: c.foreground }]}>Edit planned debt payment</AppText>
              <AppText style={[styles.subtitle, { color: c.mutedForeground }]}>{debt.name} · {formattedDate}</AppText>
            </View>
          </View>

          <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
            <View style={styles.factGrid}>
              <View style={[styles.fact, { backgroundColor: c.background, borderColor: c.border }]}>
                <AppText tone="label" style={[styles.factLabel, { color: c.mutedForeground }]}>CREDITOR MINIMUM</AppText>
                <AppText tone="number" style={[styles.factValue, { color: c.foreground }]}>{money(debt.amount)}</AppText>
              </View>
              <View style={[styles.fact, { backgroundColor: c.background, borderColor: c.border }]}>
                <AppText tone="label" style={[styles.factLabel, { color: c.mutedForeground }]}>CURRENT BALANCE</AppText>
                <AppText tone="number" style={[styles.factValue, { color: c.foreground }]}>{money(debt.balance)}</AppText>
              </View>
            </View>

            {pendingCommitment ? (
              <View style={[styles.pendingCallout, { backgroundColor: c.primary + "12", borderColor: c.primary + "42" }]}>
                <Feather name="clock" size={18} color={c.primary} />
                <View style={styles.flexOne}>
                  <AppText tone="label" style={[styles.pendingLabel, { color: c.primary }]}>PAYMENT PENDING</AppText>
                  <AppText style={[styles.pendingCopy, { color: c.foreground }]}>{money(pendingCommitment.amount)} is committed for this payment. Forecast counts that full cash amount once and will not roll any of it to another creditor.</AppText>
                </View>
              </View>
            ) : null}

            <AppText tone="label" style={[styles.fieldLabel, { color: c.mutedForeground }]}>PLANNED AMOUNT</AppText>
            <View style={[styles.inputWrap, { backgroundColor: c.background, borderColor: error || validationError ? c.destructive : c.border }]}>
              <AppText tone="number" style={[styles.dollar, { color: c.mutedForeground }]}>$</AppText>
              <TextInput
                accessibilityLabel="Planned amount"
                editable={canEditHousehold && !saving}
                inputMode="decimal"
                keyboardType="decimal-pad"
                selectTextOnFocus
                value={draft}
                onChangeText={value => {
                  setDraft(value);
                  setError(undefined);
                }}
                style={[styles.input, { color: c.foreground }]}
              />
            </View>
            {error || (draft ? validationError : undefined) ? <AppText style={[styles.error, { color: c.destructive }]}>{error ?? validationError}</AppText> : null}
            <AppText style={[styles.occurrenceCopy, { color: c.mutedForeground }]}>
              {debt.frequency === "weekly" || debt.frequency === "biweekly"
                ? `This exact amount applies to each ${debt.frequency} occurrence in this month.`
                : "This exact amount applies to this scheduled occurrence."}
            </AppText>

            <View style={[styles.infoCallout, { backgroundColor: c.background, borderColor: c.border }]}>
              <Feather name="info" size={17} color={c.mutedForeground} />
              <AppText style={[styles.infoCopy, { color: c.mutedForeground }]}>This changes Forecast only. It does not change your lender minimum or cancel autopay.</AppText>
            </View>

            {!canEditHousehold ? <AppText style={[styles.viewerCopy, { color: c.mutedForeground }]}>Only an owner or editor can change this household plan.</AppText> : null}

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Save planned debt payment"
              accessibilityState={{ disabled: !canSave }}
              disabled={!canSave}
              onPress={() => { if (parsedDraft !== undefined) void persist(parsedDraft); }}
              style={({ pressed }) => [styles.primaryButton, { backgroundColor: c.primary, opacity: !canSave ? 0.45 : pressed ? 0.78 : 1 }]}
            >
              <Feather name="check" size={18} color={c.primaryForeground} />
              <AppText tone="button" style={[styles.primaryText, { color: c.primaryForeground }]}>{saving ? "Saving…" : "Save planned amount"}</AppText>
            </Pressable>

            <View style={styles.secondaryActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Skip this debt payment in Forecast"
                accessibilityState={{ disabled: !canEditHousehold || saving || Boolean(pendingCommitment) }}
                disabled={!canEditHousehold || saving || Boolean(pendingCommitment)}
                onPress={skip}
                style={({ pressed }) => [styles.secondaryButton, { borderColor: c.destructive + "80", opacity: !canEditHousehold || saving || pendingCommitment ? 0.45 : pressed ? 0.7 : 1 }]}
              >
                <AppText tone="button" style={[styles.secondaryText, { color: c.destructive }]}>Skip in Forecast</AppText>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Reset to FlowLedger plan"
                accessibilityState={{ disabled: !canEditHousehold || saving || override?.planned_debt_amount === undefined }}
                disabled={!canEditHousehold || saving || override?.planned_debt_amount === undefined}
                onPress={() => { void persist(undefined); }}
                style={({ pressed }) => [styles.secondaryButton, { borderColor: c.border, opacity: !canEditHousehold || saving || override?.planned_debt_amount === undefined ? 0.45 : pressed ? 0.7 : 1 }]}
              >
                <AppText tone="button" style={[styles.secondaryText, { color: c.foreground }]}>Reset to FlowLedger plan</AppText>
              </Pressable>
            </View>
            {pendingCommitment && override?.planned_debt_amount !== undefined ? (
              <AppText style={[styles.resetCopy, { color: c.mutedForeground }]}>Reset removes your custom amount. The pending {money(pendingCommitment.amount)} cash commitment remains authoritative until it posts or disappears.</AppText>
            ) : null}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  centered: { alignItems: "center", justifyContent: "center", padding: 24 },
  scrollContent: { flexGrow: 1, alignItems: "center", paddingHorizontal: 16 },
  shell: { width: "100%", maxWidth: 620 },
  desktopShell: { paddingTop: 28 },
  header: { flexDirection: "row", alignItems: "flex-start", gap: 13, marginBottom: 18 },
  headerCopy: { flex: 1 },
  iconButton: { width: 44, height: 44, borderRadius: 14, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  eyebrow: { fontSize: 10 },
  title: { fontSize: 26, fontFamily: "Inter_800ExtraBold", marginTop: 3 },
  subtitle: { fontSize: 14, marginTop: 4 },
  card: { borderWidth: 1, borderRadius: 24, padding: 18 },
  factGrid: { flexDirection: "row", gap: 10 },
  fact: { flex: 1, minWidth: 0, borderWidth: 1, borderRadius: 16, padding: 13 },
  factLabel: { fontSize: 10 },
  factValue: { fontSize: 19, fontFamily: "Inter_800ExtraBold", marginTop: 5 },
  pendingCallout: { flexDirection: "row", alignItems: "flex-start", gap: 10, borderWidth: 1, borderRadius: 15, padding: 13, marginTop: 14 },
  pendingLabel: { fontSize: 10 },
  pendingCopy: { fontSize: 13, marginTop: 3 },
  flexOne: { flex: 1 },
  fieldLabel: { fontSize: 11, marginTop: 20, marginBottom: 8 },
  inputWrap: { height: 56, flexDirection: "row", alignItems: "center", borderWidth: 1.5, borderRadius: 15 },
  dollar: { fontSize: 22, paddingLeft: 14 },
  input: { flex: 1, height: 54, paddingHorizontal: 8, fontSize: 22, fontFamily: "Inter_700Bold", outlineStyle: "none" as never },
  error: { fontSize: 12, marginTop: 7 },
  occurrenceCopy: { fontSize: 12, marginTop: 7 },
  infoCallout: { flexDirection: "row", alignItems: "flex-start", gap: 9, borderWidth: 1, borderRadius: 14, padding: 12, marginTop: 15 },
  infoCopy: { flex: 1, fontSize: 13 },
  viewerCopy: { fontSize: 12, marginTop: 12 },
  primaryButton: { minHeight: 50, borderRadius: 15, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 16, marginTop: 18 },
  primaryText: { fontSize: 14, fontFamily: "Inter_800ExtraBold" },
  secondaryActions: { gap: 9, marginTop: 10 },
  secondaryButton: { minHeight: 46, borderRadius: 14, borderWidth: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 },
  secondaryText: { fontSize: 13, fontFamily: "Inter_700Bold", textAlign: "center" },
  resetCopy: { fontSize: 11, textAlign: "center", marginTop: 8 },
  missingTitle: { fontSize: 23, fontFamily: "Inter_800ExtraBold" },
  missingCopy: { fontSize: 14, textAlign: "center", marginTop: 8, maxWidth: 420 },
});
