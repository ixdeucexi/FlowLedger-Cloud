import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { DatePickerField } from "@/components/DatePickerField";
import { FloLogo } from "@/components/FloLogo";
import { PlanFeatureGate } from "@/components/PlanFeatureGate";
import { PremiumBackdrop } from "@/components/PremiumBackdrop";
import { BudgetProvider, useBudget } from "@/context/BudgetContext";
import { MembershipProvider } from "@/context/MembershipContext";
import { useColors } from "@/hooks/useColors";
import {
  buildDebtPaymentPlanSummary,
  isSnowballPaymentTransaction,
  replacementSnowballSafeMaximum,
  requiredDebtPlanTotal,
  snowballTransactionEditDraft,
} from "@/lib/debtPaymentPlan";
import { orderActiveDebtsForStrategy } from "@/lib/debtOrder";
import { localDateString, MONTH_NAMES } from "@/lib/dateLabels";

function money(value: number) {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function dateParts(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return { day, month: month - 1, year };
}

function maximumPlanDate(start: string, horizonMonths: number) {
  const { month, year } = dateParts(start);
  const end = new Date(year, month + Math.max(1, horizonMonths), 0, 12);
  return localDateString(end);
}

function SnowballPlanScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ suggested?: string; transactionId?: string }>();
  const {
    applyDebtSnowballPayment,
    bills,
    canEditHousehold,
    deleteTransaction,
    extraPayments,
    getBillOccurrencesInMonth,
    getExtraPayment,
    getMonthlyBills,
    previewDebtSnowball,
    removeDebtSnowballPayment,
    settings,
    transactions,
    updateTransaction,
  } = useBudget();
  const today = localDateString();
  const todayParts = dateParts(today);
  const firstUpcomingPlan = extraPayments
    .filter(payment => (payment.payment_date ?? "") >= today)
    .slice()
    .sort((left, right) => (left.payment_date ?? "").localeCompare(right.payment_date ?? ""))[0];
  const suggestedAmount = Math.max(0, Number.parseFloat(Array.isArray(params.suggested) ? params.suggested[0] : params.suggested ?? "") || 0);
  const transactionId = Array.isArray(params.transactionId) ? params.transactionId[0] : params.transactionId;
  const editTransaction = useMemo(
    () => transactionId
      ? transactions.find(transaction => transaction.id === transactionId && isSnowballPaymentTransaction(transaction))
      : undefined,
    [transactionId, transactions],
  );
  const editDraft = useMemo(
    () => editTransaction ? snowballTransactionEditDraft(editTransaction) : null,
    [editTransaction],
  );
  const [paymentDate, setPaymentDate] = useState(today);
  const [extraAmount, setExtraAmount] = useState(
    suggestedAmount > 0 ? suggestedAmount.toFixed(2) : "",
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const hydratedTransactionRef = useRef<string | null>(null);
  const hydratedDefaultPlanRef = useRef(false);

  useEffect(() => {
    if (transactionId) {
      if (!editTransaction || !editDraft || hydratedTransactionRef.current === editTransaction.id) return;
      hydratedTransactionRef.current = editTransaction.id;
      setPaymentDate(editDraft.paymentDate);
      setExtraAmount(editDraft.amount.toFixed(2));
      setSaved(false);
      return;
    }
    if (firstUpcomingPlan && !hydratedDefaultPlanRef.current) {
      hydratedDefaultPlanRef.current = true;
      setPaymentDate(firstUpcomingPlan.payment_date ?? today);
      setExtraAmount((firstUpcomingPlan.amount + suggestedAmount).toFixed(2));
    }
  }, [editDraft, editTransaction, firstUpcomingPlan, suggestedAmount, today, transactionId]);

  const planDate = dateParts(paymentDate);
  const existingPayment = transactionId ? undefined : getExtraPayment(planDate.month, planDate.year);
  const requestedExtra = Math.max(0, Number.parseFloat(extraAmount) || 0);
  const preview = previewDebtSnowball(
    planDate.month,
    planDate.year,
    requestedExtra,
    0,
    paymentDate,
    existingPayment?.id,
  );
  const monthDebts = getMonthlyBills(planDate.month, planDate.year)
    .filter(debt => debt.is_debt);
  const activeDebts = monthDebts
    .filter(debt => debt.is_debt && debt.balance > 0.009);
  const payoffOrder = orderActiveDebtsForStrategy(activeDebts, settings.paymentMethod);
  const editTarget = editDraft
    ? monthDebts.find(debt => debt.id === editDraft.debtId) ?? bills.find(debt => debt.id === editDraft.debtId && debt.is_debt)
    : undefined;
  const target = editTarget ?? payoffOrder[0] ?? null;
  const requiredMinimum = activeDebts.reduce(
    (total, debt) => total + requiredDebtPlanTotal(
      debt,
      getBillOccurrencesInMonth(debt, planDate.month, planDate.year).length,
    ),
    0,
  );
  const summary = buildDebtPaymentPlanSummary(requiredMinimum, requestedExtra);
  const safeMaximum = editDraft
    ? replacementSnowballSafeMaximum(preview.safeMaximum, editDraft.amount)
    : preview.safeMaximum;
  const editTargetCapacity = editDraft && target
    ? Math.max(0, Number(target.balance) + Number(editTransaction?.debt_applied_amount ?? editDraft.amount))
    : Number.POSITIVE_INFINITY;
  const valid = canEditHousehold
    && requestedExtra > 0.005
    && requestedExtra <= safeMaximum + 0.005
    && requestedExtra <= editTargetCapacity + 0.005
    && (editTransaction ? Boolean(target) : preview.allocations.length > 0);
  const monthLabel = `${MONTH_NAMES[planDate.month]} ${planDate.year}`;
  const scheduledPlans = useMemo(() => extraPayments
    .slice()
    .sort((left, right) => (right.payment_date ?? "").localeCompare(left.payment_date ?? "")),
  [extraPayments]);
  const displayedAllocations = editTransaction && target
    ? [{
        billId: target.id,
        billName: target.name,
        payment: Math.min(requestedExtra, editTargetCapacity),
        paidOff: requestedExtra >= editTargetCapacity - 0.005,
      }]
    : preview.allocations;

  const choosePlan = (date: string, amount: number) => {
    setPaymentDate(date);
    setExtraAmount(amount.toFixed(2));
    setSaved(false);
  };

  const savePlan = async () => {
    if (!valid || saving) return;
    setSaving(true);
    try {
      if (editTransaction && target) {
        await updateTransaction({
          ...editTransaction,
          amount: -requestedExtra,
          category: "Debt",
          date: paymentDate,
          linked_bill_id: target.id,
          note: `${target.name} snowball`,
        });
      } else {
        await applyDebtSnowballPayment(preview);
      }
      setSaved(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      Alert.alert("Couldn’t save the extra payment", error instanceof Error ? error.message : "Try again.");
    } finally {
      setSaving(false);
    }
  };

  const removePlan = async () => {
    if ((!existingPayment && !editTransaction) || saving) return;
    setSaving(true);
    try {
      if (editTransaction) await deleteTransaction(editTransaction.id);
      else await removeDebtSnowballPayment(planDate.month, planDate.year);
      setExtraAmount("");
      setSaved(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      Alert.alert("Couldn’t remove the extra payment", error instanceof Error ? error.message : "Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={[styles.screen, { backgroundColor: c.background }]}>
      <PremiumBackdrop variant="purple" />
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 36 }]}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => router.back()} style={[styles.back, { backgroundColor: c.card, borderColor: c.border }]}>
            <Feather name="chevron-left" size={22} color={c.foreground} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={[styles.eyebrow, { color: c.primary }]}>DEBT PAYOFF</Text>
            <Text style={[styles.title, { color: c.foreground }]}>Snowball Planner</Text>
          </View>
        </View>

        <PlanFeatureGate feature="debt_payoff" compact>
          <View style={[styles.hero, { backgroundColor: c.card, borderColor: c.border }]}>
            <FloLogo size={58} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.heroTitle, { color: c.foreground }]}>Plan extra. Keep the minimum.</Text>
              <Text style={[styles.heroCopy, { color: c.mutedForeground }]}>Your required payments stay unchanged. This adds a separate extra payment to Calendar.</Text>
            </View>
          </View>

          {target ? (
            <View style={[styles.targetCard, { backgroundColor: c.card, borderColor: c.primary + "55" }]}>
              <View style={[styles.targetIcon, { backgroundColor: c.primary + "18" }]}>
                <Feather name="trending-down" size={19} color={c.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.cardLabel, { color: c.primary }]}>CURRENT TARGET</Text>
                <Text style={[styles.targetName, { color: c.foreground }]}>{target.name}</Text>
                <Text style={[styles.smallCopy, { color: c.mutedForeground }]}>{money(target.balance)} balance · {settings.paymentMethod === "snowball" ? "smallest balance first" : "highest interest first"}</Text>
              </View>
            </View>
          ) : (
            <View style={[styles.emptyCard, { backgroundColor: c.card, borderColor: c.border }]}>
              <Text style={[styles.targetName, { color: c.foreground }]}>No active payoff target</Text>
              <Text style={[styles.smallCopy, { color: c.mutedForeground }]}>Add or include a debt before planning extra money.</Text>
            </View>
          )}

          {suggestedAmount > 0 ? (
            <View style={[styles.suggestion, { backgroundColor: c.success + "12", borderColor: c.success + "45" }]}>
              <Feather name="gift" size={18} color={c.success} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.suggestionTitle, { color: c.foreground }]}>Flo’s raise suggestion</Text>
                <Text style={[styles.smallCopy, { color: c.mutedForeground }]}>Use the {money(suggestedAmount)} paycheck increase as extra debt money.</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Add ${money(suggestedAmount)} raise difference`}
                onPress={() => setExtraAmount((requestedExtra + suggestedAmount).toFixed(2))}
                style={[styles.useSuggestion, { backgroundColor: c.success + "20" }]}
              >
                <Text style={[styles.useSuggestionText, { color: c.success }]}>{requestedExtra > 0 ? "Add" : "Use"}</Text>
              </Pressable>
            </View>
          ) : null}

          <View style={[styles.plannerCard, { backgroundColor: c.card, borderColor: c.border }]}>
            <View style={styles.safeRow}>
              <View>
                <Text style={[styles.cardLabel, { color: c.mutedForeground }]}>MAXIMUM SAFE EXTRA</Text>
                <Text style={[styles.safeAmount, { color: c.success }]}>{money(safeMaximum)}</Text>
              </View>
              <View style={[styles.monthBadge, { backgroundColor: c.primary + "18" }]}>
                <Text style={[styles.monthBadgeText, { color: c.primary }]}>{monthLabel}</Text>
              </View>
            </View>

            <Text style={[styles.fieldLabel, { color: c.mutedForeground }]}>EXTRA PAYMENT</Text>
            <View style={[styles.inputWrap, { backgroundColor: c.background, borderColor: requestedExtra > safeMaximum || requestedExtra > editTargetCapacity ? c.destructive : c.border }]}>
              <Text style={[styles.dollar, { color: c.foreground }]}>$</Text>
              <TextInput
                accessibilityLabel="Extra debt payment"
                value={extraAmount}
                onChangeText={value => { setExtraAmount(value); setSaved(false); }}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor={c.mutedForeground}
                style={[styles.input, { color: c.foreground }]}
              />
            </View>
            {requestedExtra > safeMaximum ? (
              <Text style={[styles.error, { color: c.destructive }]}>Lower this to {money(safeMaximum)} or less to protect your safety floor.</Text>
            ) : null}
            {editTransaction && requestedExtra > editTargetCapacity ? (
              <Text style={[styles.error, { color: c.destructive }]}>
                {target?.name ?? "This debt"} has {money(editTargetCapacity)} available for this payment.
              </Text>
            ) : null}
            {safeMaximum > 0 && requestedExtra <= 0 ? (
              <Pressable accessibilityRole="button" onPress={() => setExtraAmount(safeMaximum.toFixed(2))} style={styles.safeLink}>
                <Text style={[styles.safeLinkText, { color: c.primary }]}>Use maximum safe extra</Text>
              </Pressable>
            ) : null}

            <DatePickerField
              label="PAYMENT DATE"
              value={paymentDate}
              onChange={value => { setPaymentDate(value); setSaved(false); }}
              minDate={today}
              maxDate={maximumPlanDate(today, settings.forecast_horizon_months)}
            />

            <View style={[styles.equationCard, { backgroundColor: c.background, borderColor: c.border }]}>
              <View style={styles.equationRow}>
                <Text style={[styles.equationLabel, { color: c.mutedForeground }]}>Required minimums</Text>
                <Text style={[styles.equationValue, { color: c.foreground }]}>{money(summary.requiredMinimum)}</Text>
              </View>
              <View style={styles.equationRow}>
                <Text style={[styles.equationLabel, { color: c.mutedForeground }]}>Extra Snowball plan</Text>
                <Text style={[styles.equationValue, { color: c.primary }]}>+{money(summary.extraPayment)}</Text>
              </View>
              <View style={[styles.totalRow, { borderTopColor: c.border }]}>
                <Text style={[styles.totalLabel, { color: c.foreground }]}>Total debt planned</Text>
                <Text style={[styles.totalValue, { color: c.success }]}>{money(summary.totalPlanned)}</Text>
              </View>
              <Text style={[styles.minimumNote, { color: c.mutedForeground }]}>The extra payment does not replace or increase any required minimum.</Text>
            </View>

            {displayedAllocations.length > 0 ? (
              <View style={styles.allocations}>
                <Text style={[styles.fieldLabel, { color: c.mutedForeground }]}>WHERE THE EXTRA GOES</Text>
                {displayedAllocations.map(allocation => (
                  <View key={allocation.billId} style={[styles.allocationRow, { borderTopColor: c.border }]}>
                    <Feather name={allocation.paidOff ? "check-circle" : "arrow-right-circle"} size={16} color={allocation.paidOff ? c.success : c.primary} />
                    <Text style={[styles.allocationName, { color: c.foreground }]}>{allocation.billName}</Text>
                    <Text style={[styles.allocationAmount, { color: c.primary }]}>{money(allocation.payment)}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            {existingPayment ? (
              <Text style={[styles.existingNote, { color: c.warning }]}>Saving will update this month’s existing extra payment.</Text>
            ) : null}
            {saved ? (
              <View style={[styles.savedNotice, { backgroundColor: c.success + "16" }]}>
                <Feather name="check-circle" size={17} color={c.success} />
                <Text style={[styles.savedText, { color: c.success }]}>
                  {editTransaction ? "Snowball payment updated." : "Extra payment added to Calendar."}
                </Text>
              </View>
            ) : null}

            <View style={styles.actions}>
              {existingPayment || editTransaction ? (
                <Pressable accessibilityRole="button" disabled={saving} onPress={removePlan} style={[styles.removeButton, { borderColor: c.destructive }]}>
                  <Feather name="trash-2" size={15} color={c.destructive} />
                  <Text style={[styles.removeText, { color: c.destructive }]}>Remove</Text>
                </Pressable>
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={editTransaction ? "Update snowball payment" : existingPayment ? "Update extra payment on calendar" : "Add extra payment to calendar"}
                disabled={!valid || saving}
                onPress={savePlan}
                style={[styles.saveButton, { backgroundColor: valid ? c.primary : c.muted, opacity: saving ? 0.7 : 1 }]}
              >
                <Feather name="calendar" size={16} color={valid ? c.primaryForeground : c.mutedForeground} />
                <Text style={[styles.saveText, { color: valid ? c.primaryForeground : c.mutedForeground }]}>
                  {saving ? "Saving…" : editTransaction ? "Update snowball payment" : existingPayment ? "Update calendar plan" : "Add to Calendar"}
                </Text>
              </Pressable>
            </View>
            {saved ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => router.replace({ pathname: "/(tabs)/monthly", params: { openDate: paymentDate } } as never)}
                style={[styles.calendarLink, { borderColor: c.primary + "55" }]}
              >
                <Text style={[styles.calendarLinkText, { color: c.primary }]}>View Monthly</Text>
                <Feather name="arrow-right" size={15} color={c.primary} />
              </Pressable>
            ) : null}
          </View>

          {scheduledPlans.length > 0 ? (
            <View style={[styles.historyCard, { backgroundColor: c.card, borderColor: c.border }]}>
              <Text style={[styles.sectionTitle, { color: c.foreground }]}>Extra payment plans</Text>
              <Text style={[styles.smallCopy, { color: c.mutedForeground }]}>Tap a future plan to review or change it.</Text>
              {scheduledPlans.map(plan => {
                const date = plan.payment_date ?? `${plan.year}-${String(plan.month + 1).padStart(2, "0")}-01`;
                const future = date >= today;
                return (
                  <Pressable
                    accessibilityRole="button"
                    disabled={!future}
                    key={plan.id}
                    onPress={() => choosePlan(date, plan.amount)}
                    style={[styles.planRow, { borderTopColor: c.border, opacity: future ? 1 : 0.6 }]}
                  >
                    <View style={[styles.planIcon, { backgroundColor: c.primary + "18" }]}>
                      <Feather name={future ? "calendar" : "check"} size={15} color={future ? c.primary : c.success} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.planAmount, { color: c.foreground }]}>{money(plan.amount)} extra</Text>
                      <Text style={[styles.smallCopy, { color: c.mutedForeground }]}>{date} · {future ? "Planned" : "Applied"}</Text>
                    </View>
                    {future ? <Feather name="chevron-right" size={18} color={c.mutedForeground} /> : null}
                  </Pressable>
                );
              })}
            </View>
          ) : null}
        </PlanFeatureGate>
      </ScrollView>
    </View>
  );
}

export default function SnowballPlanRoute() {
  return (
    <BudgetProvider>
      <MembershipProvider>
        <SnowballPlanScreen />
      </MembershipProvider>
    </BudgetProvider>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: 20, gap: 14 },
  header: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 2 },
  back: { width: 44, height: 44, borderRadius: 14, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  eyebrow: { fontSize: 10, fontFamily: "Inter_800ExtraBold", letterSpacing: 1 },
  title: { fontSize: 29, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.8 },
  hero: { flexDirection: "row", alignItems: "center", gap: 14, borderWidth: 1, borderRadius: 22, padding: 16 },
  heroTitle: { fontSize: 18, fontFamily: "Inter_800ExtraBold" },
  heroCopy: { fontSize: 13, lineHeight: 18, marginTop: 3 },
  targetCard: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: 18, padding: 15 },
  targetIcon: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  cardLabel: { fontSize: 10, fontFamily: "Inter_800ExtraBold", letterSpacing: 0.8 },
  targetName: { fontSize: 18, fontFamily: "Inter_800ExtraBold", marginTop: 2 },
  smallCopy: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  emptyCard: { borderWidth: 1, borderRadius: 18, padding: 16 },
  suggestion: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 17, padding: 13 },
  suggestionTitle: { fontSize: 14, fontFamily: "Inter_700Bold" },
  useSuggestion: { minHeight: 38, borderRadius: 12, paddingHorizontal: 13, alignItems: "center", justifyContent: "center" },
  useSuggestionText: { fontSize: 12, fontFamily: "Inter_800ExtraBold" },
  plannerCard: { borderWidth: 1, borderRadius: 22, padding: 16 },
  safeRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  safeAmount: { fontSize: 27, fontFamily: "Inter_800ExtraBold", marginTop: 2 },
  monthBadge: { borderRadius: 999, paddingHorizontal: 11, paddingVertical: 7 },
  monthBadgeText: { fontSize: 11, fontFamily: "Inter_700Bold" },
  fieldLabel: { fontSize: 10, fontFamily: "Inter_800ExtraBold", letterSpacing: 0.8, marginTop: 16, marginBottom: 7 },
  inputWrap: { flexDirection: "row", alignItems: "center", borderRadius: 13, borderWidth: 1.5 },
  dollar: { fontSize: 21, paddingLeft: 14 },
  input: { flex: 1, height: 54, paddingHorizontal: 8, fontSize: 21, fontFamily: "Inter_700Bold" },
  error: { fontSize: 11, lineHeight: 16, marginTop: 6 },
  safeLink: { alignSelf: "flex-start", paddingVertical: 9 },
  safeLinkText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  equationCard: { borderWidth: 1, borderRadius: 16, padding: 13, marginTop: 16, gap: 9 },
  equationRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
  equationLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  equationValue: { fontSize: 14, fontFamily: "Inter_700Bold" },
  totalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12, borderTopWidth: 1, paddingTop: 10 },
  totalLabel: { fontSize: 14, fontFamily: "Inter_800ExtraBold" },
  totalValue: { fontSize: 18, fontFamily: "Inter_800ExtraBold" },
  minimumNote: { fontSize: 11, lineHeight: 16 },
  allocations: { marginTop: 2 },
  allocationRow: { flexDirection: "row", alignItems: "center", gap: 8, borderTopWidth: 1, paddingVertical: 10 },
  allocationName: { flex: 1, fontSize: 13, fontFamily: "Inter_600SemiBold" },
  allocationAmount: { fontSize: 13, fontFamily: "Inter_800ExtraBold" },
  existingNote: { fontSize: 11, fontFamily: "Inter_600SemiBold", marginTop: 10 },
  savedNotice: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 13, padding: 11, marginTop: 12 },
  savedText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  actions: { flexDirection: "row", gap: 10, marginTop: 16 },
  removeButton: { minWidth: 94, height: 52, borderRadius: 14, borderWidth: 1, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center" },
  removeText: { fontSize: 13, fontFamily: "Inter_700Bold" },
  saveButton: { flex: 1, height: 52, borderRadius: 14, flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center" },
  saveText: { fontSize: 14, fontFamily: "Inter_800ExtraBold" },
  calendarLink: { height: 46, borderRadius: 13, borderWidth: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, marginTop: 10 },
  calendarLinkText: { fontSize: 13, fontFamily: "Inter_700Bold" },
  historyCard: { borderWidth: 1, borderRadius: 22, padding: 16 },
  sectionTitle: { fontSize: 18, fontFamily: "Inter_800ExtraBold" },
  planRow: { flexDirection: "row", alignItems: "center", gap: 10, borderTopWidth: 1, paddingVertical: 12, marginTop: 9 },
  planIcon: { width: 36, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  planAmount: { fontSize: 14, fontFamily: "Inter_700Bold" },
});
