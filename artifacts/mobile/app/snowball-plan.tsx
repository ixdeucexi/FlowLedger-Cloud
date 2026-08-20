import { Feather } from "@expo/vector-icons";
import * as Haptics from "@/lib/haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { DatePickerField } from "@/components/DatePickerField";
import { FloLogo } from "@/components/FloLogo";
import { PlanFeatureGate } from "@/components/PlanFeatureGate";
import { PremiumBackdrop } from "@/components/PremiumBackdrop";
import { useBudget } from "@/context/BudgetContext";
import { useColors } from "@/hooks/useColors";
import { useDesktopExperience } from "@/hooks/useDesktopExperience";
import { confirmAction } from "@/lib/confirmAction";
import {
  isSnowballPaymentTransaction,
  replacementSnowballSafeMaximum,
  requiredDebtPlanTotal,
  snowballTransactionEditDraft,
} from "@/lib/debtPaymentPlan";
import { isValidExtraPaymentPlan } from "@/lib/debtPlanDomain";
import { localDateString, MONTH_NAMES } from "@/lib/dateLabels";
import { matchedOccurrenceAllocations } from "@/lib/reviewCenter";
import {
  buildSnowballPlannerRows,
  buildSnowballTimeline,
  snowballPlanHistoryStatus,
} from "@/lib/snowballPlanner";

function money(value: number) {
  return `$${Math.max(0, Number(value) || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function moneyOrDash(value: number) {
  return value > 0.005 ? money(value) : "—";
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

function readableDate(value: string) {
  const parsed = new Date(`${value}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function readableMonth(value: string | null) {
  if (!value) return "Not projected yet";
  const parsed = new Date(`${value}-01T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return "Not projected yet";
  return parsed.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

function allocationLabel(kind: "required" | "rollover" | "extra") {
  if (kind === "rollover") return "ROLLOVER";
  if (kind === "extra") return "SAFE EXTRA";
  return "SCHEDULED";
}

function SnowballPlanScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isDesktop = useDesktopExperience();
  const twoColumn = isDesktop && width >= 1080;
  const params = useLocalSearchParams<{ paymentId?: string; suggested?: string; transactionId?: string }>();
  const {
    applyDebtSnowballPayment,
    bills,
    canEditHousehold,
    deleteTransaction,
    extraPayments,
    getBillOccurrencesInMonth,
    getDebtPlanForMonth,
    getDebtMonthSettlements,
    getRemainingDebtPlanForMonth,
    getExtraPayment,
    getMonthlyBills,
    previewDebtSnowball,
    removeDebtSnowballPayment,
    settings,
    transactions,
    updateTransaction,
  } = useBudget();
  const today = localDateString();
  const validExtraPayments = useMemo(
    () => extraPayments.filter(isValidExtraPaymentPlan),
    [extraPayments],
  );
  const firstUpcomingPlan = validExtraPayments
    .filter(payment => (payment.payment_date ?? "") >= today)
    .slice()
    .sort((left, right) => (left.payment_date ?? "").localeCompare(right.payment_date ?? ""))[0];
  const suggestedAmount = Math.max(0, Number.parseFloat(Array.isArray(params.suggested) ? params.suggested[0] : params.suggested ?? "") || 0);
  const transactionId = Array.isArray(params.transactionId) ? params.transactionId[0] : params.transactionId;
  const paymentId = Array.isArray(params.paymentId) ? params.paymentId[0] : params.paymentId;
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
  const hasResolvedTransactionEdit = Boolean(editTransaction && editDraft);
  const [paymentDate, setPaymentDate] = useState(today);
  const [extraAmount, setExtraAmount] = useState("");
  const [editingPaymentId, setEditingPaymentId] = useState<string | undefined>(paymentId);
  const [saving, setSaving] = useState(false);
  const hydratedTransactionRef = useRef<string | null>(null);
  const hydratedDefaultPlanRef = useRef(false);
  const editingPayment = editingPaymentId
    ? validExtraPayments.find(payment => payment.id === editingPaymentId)
    : undefined;

  useEffect(() => {
    if (hasResolvedTransactionEdit) {
      if (!editTransaction || !editDraft || hydratedTransactionRef.current === editTransaction.id) return;
      hydratedTransactionRef.current = editTransaction.id;
      setPaymentDate(editDraft.paymentDate);
      setExtraAmount(editDraft.amount.toFixed(2));
      return;
    }
    const defaultPlan = editingPayment ?? firstUpcomingPlan;
    if (defaultPlan && !hydratedDefaultPlanRef.current) {
      hydratedDefaultPlanRef.current = true;
      setEditingPaymentId(defaultPlan.id);
      setPaymentDate(defaultPlan.payment_date ?? today);
      setExtraAmount(defaultPlan.amount.toFixed(2));
    }
  }, [editDraft, editTransaction, editingPayment, firstUpcomingPlan, hasResolvedTransactionEdit, today]);

  const planDate = dateParts(paymentDate);
  const targetMonthPayment = hasResolvedTransactionEdit ? undefined : getExtraPayment(planDate.month, planDate.year);
  const existingPayment = hasResolvedTransactionEdit ? undefined : editingPayment ?? targetMonthPayment;
  const destinationConflict = Boolean(
    editingPayment
    && targetMonthPayment
    && targetMonthPayment.id !== editingPayment.id,
  );
  const requestedExtra = Math.max(0, Number.parseFloat(extraAmount) || 0);
  const preview = useMemo(() => previewDebtSnowball(
    planDate.month,
    planDate.year,
    requestedExtra,
    0,
    paymentDate,
    existingPayment?.id,
  ), [existingPayment?.id, paymentDate, planDate.month, planDate.year, previewDebtSnowball, requestedExtra]);
  const monthDebts = getMonthlyBills(planDate.month, planDate.year).filter(debt => debt.is_debt);
  const fullDatedPlan = getDebtPlanForMonth(planDate.month, planDate.year);
  const remainingDatedPlan = getRemainingDebtPlanForMonth(planDate.month, planDate.year);
  const debtMonthSettlements = getDebtMonthSettlements(planDate.month, planDate.year);
  const plannerRows = buildSnowballPlannerRows(
    monthDebts.map(debt => ({
      id: debt.id,
      name: debt.name,
      balance: debt.balance,
      minimum: requiredDebtPlanTotal(debt, getBillOccurrencesInMonth(debt, planDate.month, planDate.year).length),
      apr: debt.interest_rate,
      dueDay: debt.due_day,
      included: debt.include_in_snowball !== false,
    })),
    "snowball",
    remainingDatedPlan,
    fullDatedPlan,
    debtMonthSettlements,
  );
  const timeline = buildSnowballTimeline(remainingDatedPlan?.allocations ?? []);
  const target = editDraft
    ? monthDebts.find(debt => debt.id === editDraft.debtId) ?? bills.find(debt => debt.id === editDraft.debtId && debt.is_debt)
    : plannerRows.find(row => row.settlement.status !== "settled") ?? null;
  const scheduledForecast = (remainingDatedPlan?.allocations ?? [])
    .filter(allocation => allocation.kind !== "extra")
    .reduce((total, allocation) => total + allocation.amount, 0);
  const safeMaximum = editDraft
    ? replacementSnowballSafeMaximum(preview.safeMaximum, editDraft.amount)
    : preview.safeMaximum;
  const editTargetCapacity = editDraft && target
    ? Math.max(0, Number(target.balance) + Number(editTransaction?.debt_applied_amount ?? editDraft.amount))
    : Number.POSITIVE_INFINITY;
  const draftExtra = editTransaction ? Math.min(requestedExtra, editTargetCapacity) : preview.selectedExtra;
  const totalPlanned = scheduledForecast + draftExtra;
  const valid = canEditHousehold
    && requestedExtra > 0.005
    && requestedExtra <= safeMaximum + 0.005
    && requestedExtra <= editTargetCapacity + 0.005
    && !destinationConflict
    && (editTransaction ? Boolean(target) : preview.allocations.length > 0);
  const monthLabel = `${MONTH_NAMES[planDate.month]} ${planDate.year}`;
  const strategyName = "Snowball";
  const totalDebt = plannerRows.reduce((sum, row) => sum + row.balance, 0);
  const snowballMatches = useMemo(
    () => matchedOccurrenceAllocations(transactions, "extra_principal", "snowball"),
    [transactions],
  );
  const scheduledPlans = useMemo(() => validExtraPayments
    .slice()
    .sort((left, right) => (right.payment_date ?? "").localeCompare(left.payment_date ?? "")),
  [validExtraPayments]);
  const displayedAllocations = editTransaction && target
    ? [{
        billId: target.id,
        billName: target.name,
        payment: Math.min(requestedExtra, editTargetCapacity),
        paidOff: requestedExtra >= editTargetCapacity - 0.005,
      }]
    : preview.allocations;

  const openForecastAmountEditor = (debtId: string, fallbackDay: number) => {
    const debt = monthDebts.find(item => item.id === debtId) ?? bills.find(item => item.id === debtId);
    const occurrenceDay = debt
      ? getBillOccurrencesInMonth(debt, planDate.month, planDate.year)[0]
      : undefined;
    const daysInMonth = new Date(planDate.year, planDate.month + 1, 0).getDate();
    const day = Math.min(daysInMonth, Math.max(1, occurrenceDay ?? fallbackDay));
    router.push({
      pathname: "/planned-debt-payment",
      params: {
        billId: debtId,
        date: `${planDate.year}-${String(planDate.month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      },
    } as never);
  };

  const closePlanner = () => {
    if (router.canGoBack()) router.back();
    else router.replace({ pathname: "/(tabs)/bills", params: { view: "debt" } } as never);
  };

  const choosePlan = (id: string, date: string, amount: number) => {
    setEditingPaymentId(id);
    setPaymentDate(date);
    setExtraAmount(amount.toFixed(2));
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
          source: editTransaction.source,
          debt_applied_bill_id: editTransaction.debt_applied_bill_id,
          debt_applied_amount: editTransaction.debt_applied_amount,
        });
      } else {
        await applyDebtSnowballPayment(preview, undefined, existingPayment?.id);
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.dismissTo({
        pathname: "/(tabs)/monthly",
        params: { openDate: paymentDate, openDateAt: String(Date.now()) },
      } as never);
    } catch (error) {
      Alert.alert("Couldn’t save the extra payment", error instanceof Error ? error.message : "Try again.");
    } finally {
      setSaving(false);
    }
  };

  const removePlan = () => {
    if ((!existingPayment && !editTransaction) || saving || !canEditHousehold) return;
    confirmAction({
      title: "Remove saved extra payment?",
      message: "This removes the saved extra payment and updates any amount previously applied to debt balances. Required debt payments stay unchanged.",
      confirmText: "Remove plan",
      destructive: true,
      onConfirm: async () => {
        setSaving(true);
        try {
          if (editTransaction) await deleteTransaction(editTransaction.id);
          else if (existingPayment) await removeDebtSnowballPayment(existingPayment.month, existingPayment.year);
          setExtraAmount("");
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } catch (error) {
          Alert.alert("Couldn’t remove the extra payment", error instanceof Error ? error.message : "Try again.");
        } finally {
          setSaving(false);
        }
      },
    });
  };

  return (
    <View style={[styles.screen, { backgroundColor: c.background }]}>
      <PremiumBackdrop variant="purple" />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          isDesktop && styles.desktopContent,
          { paddingTop: insets.top + (isDesktop ? 24 : 12), paddingBottom: insets.bottom + 44 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go back"
            onPress={closePlanner}
            style={({ pressed }) => [
              styles.back,
              { backgroundColor: c.card, borderColor: c.border, opacity: pressed ? 0.72 : 1 },
            ]}
          >
            <Feather name="chevron-left" size={22} color={c.foreground} />
          </Pressable>
          <View style={styles.headerCopy}>
            <Text style={[styles.eyebrow, { color: c.primary }]}>DEBT PAYOFF PLAN</Text>
            <Text style={[styles.title, isDesktop && styles.desktopTitle, { color: c.foreground }]}>Debt Payoff Planner</Text>
            {isDesktop ? <Text style={[styles.headerSubtitle, { color: c.mutedForeground }]}>See the full payoff order, preview safe extra money, and follow the exact schedule used by Forecast.</Text> : null}
          </View>
          {isDesktop ? (
            <View style={[styles.forecastBadge, { backgroundColor: c.muted + "55", borderColor: c.border }]}>
              <View style={[styles.liveDot, { backgroundColor: c.mutedForeground }]} />
              <Text style={[styles.forecastBadgeText, { color: c.mutedForeground }]}>USES FORECAST SCHEDULE</Text>
            </View>
          ) : null}
        </View>

        <PlanFeatureGate feature="debt_payoff" compact>
          <View style={[styles.hero, isDesktop && styles.heroDesktop, { backgroundColor: c.card, borderColor: c.primary + "55" }]}>
            <View pointerEvents="none" style={[styles.heroGlow, { backgroundColor: c.primary + "24" }]} />
            <View style={styles.heroTop}>
              <View style={[styles.heroLogo, { backgroundColor: c.primary + "13" }]}>
                <FloLogo size={isDesktop ? 64 : 52} />
              </View>
              <View style={styles.heroCopyWrap}>
                <Text style={[styles.heroLabel, { color: c.primary }]}>CURRENT TARGET</Text>
                <Text style={[styles.heroTitle, isDesktop && styles.heroTitleDesktop, { color: c.foreground }]}>{target?.name ?? "No active target"}</Text>
                <Text style={[styles.heroCopy, { color: c.mutedForeground }]}>Your required payments stay intact. When one debt closes, unused money moves to the next debt on the same date.</Text>
              </View>
              <View style={[styles.strategyPill, { backgroundColor: c.primary + "18" }]}>
                <Feather name="trending-down" size={14} color={c.primary} />
                <Text style={[styles.strategyPillText, { color: c.primary }]}>{strategyName}</Text>
              </View>
            </View>
            <View style={[styles.metrics, !isDesktop && styles.metricsMobile]}>
              <View style={[styles.metric, !isDesktop && styles.metricMobile, { backgroundColor: c.background + "99", borderColor: c.border }]}>
                <Text style={[styles.metricLabel, { color: c.mutedForeground }]}>ACTIVE DEBT</Text>
                <Text style={[styles.metricValue, { color: c.foreground }]}>{money(totalDebt)}</Text>
                <Text style={[styles.metricDetail, { color: c.mutedForeground }]}>{plannerRows.length} {plannerRows.length === 1 ? "debt" : "debts"} in plan</Text>
              </View>
              <View style={[styles.metric, !isDesktop && styles.metricMobile, { backgroundColor: c.background + "99", borderColor: c.border }]}>
                <Text style={[styles.metricLabel, { color: c.mutedForeground }]}>MONTH PLAN PREVIEW</Text>
                <Text style={[styles.metricValue, { color: c.success }]}>{money(totalPlanned)}</Text>
                <Text style={[styles.metricDetail, { color: c.mutedForeground }]}>{money(scheduledForecast)} scheduled + {money(draftExtra)} extra</Text>
              </View>
              <View style={[styles.metric, !isDesktop && styles.metricMobile, { backgroundColor: c.background + "99", borderColor: c.border }]}>
                <Text style={[styles.metricLabel, { color: c.mutedForeground }]}>PROJECTED PAYOFF</Text>
                <Text style={[styles.metricValue, { color: c.primary }]}>{readableMonth(preview.debtFreeDate)}</Text>
                <Text style={[styles.metricDetail, { color: c.mutedForeground }]}>{draftExtra > 0 ? `Includes ${money(draftExtra)} extra` : "Current plan"}</Text>
              </View>
            </View>
          </View>

          {suggestedAmount > 0 ? (
            <View style={[styles.suggestion, { backgroundColor: c.success + "12", borderColor: c.success + "45" }]}>
              <Feather name="gift" size={18} color={c.success} />
              <View style={styles.flexOne}>
                <Text style={[styles.suggestionTitle, { color: c.foreground }]}>Flo found {money(suggestedAmount)} of possible extra money</Text>
                <Text style={[styles.smallCopy, { color: c.mutedForeground }]}>Preview the paycheck increase before adding it to Forecast.</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Preview the ${money(suggestedAmount)} suggestion`}
                onPress={() => setExtraAmount(suggestedAmount.toFixed(2))}
                style={({ pressed }) => [styles.useSuggestion, { backgroundColor: c.success + "20", opacity: pressed ? 0.72 : 1 }]}
              >
                <Text style={[styles.useSuggestionText, { color: c.success }]}>Use suggestion</Text>
              </Pressable>
            </View>
          ) : null}

          <View style={[styles.workspace, twoColumn && styles.workspaceDesktop]}>
            <View style={[styles.primaryColumn, twoColumn && styles.primaryColumnDesktop]}>
              <View style={[styles.sectionCard, { backgroundColor: c.card, borderColor: c.border }]}>
                <View style={styles.sectionHeader}>
                  <View style={styles.flexOne}>
                    <Text style={[styles.sectionEyebrow, { color: c.primary }]}>PAYOFF ORDER</Text>
                    <Text style={[styles.sectionTitle, { color: c.foreground }]}>Your debt ladder</Text>
                    <Text style={[styles.sectionCopy, { color: c.mutedForeground }]}>The ladder shows the full selected-month plan. The timeline shows what remains in Forecast.</Text>
                  </View>
                  <View style={[styles.countBadge, { backgroundColor: c.primary + "18" }]}>
                    <Text style={[styles.countBadgeText, { color: c.primary }]}>{plannerRows.length} ACTIVE</Text>
                  </View>
                </View>

                {plannerRows.length ? plannerRows.map((row, index) => (
                  <View key={row.id} style={styles.ladderItem}>
                    <View style={styles.ladderRail}>
                      <View style={[styles.rankBubble, { backgroundColor: row.id === target?.id ? c.primary : c.background, borderColor: row.id === target?.id ? c.primary : c.border }]}>
                        {row.paidOffThisMonth || row.settlement.status === "settled"
                          ? <Feather name="check" size={16} color={row.id === target?.id ? c.primaryForeground : c.success} />
                          : <Text style={[styles.rankText, { color: row.id === target?.id ? c.primaryForeground : c.mutedForeground }]}>#{row.rank}</Text>}
                      </View>
                      {index < plannerRows.length - 1 ? <View style={[styles.railLine, { backgroundColor: c.border }]} /> : null}
                    </View>
                    <View style={[styles.debtCard, { backgroundColor: c.background + "88", borderColor: row.id === target?.id ? c.primary + "66" : c.border }]}>
                      <View style={styles.debtHeader}>
                        <View style={styles.flexOne}>
                          <View style={styles.inlineBadges}>
                            {row.id === target?.id ? <Text style={[styles.targetBadge, { color: c.primary }]}>TARGET NOW</Text> : null}
                            {row.settlement.status === "settled" ? <Text style={[styles.paidBadge, { color: c.success }]}>PAID THIS MONTH</Text> : null}
                            {row.settlement.status === "partial" ? <Text style={[styles.paidBadge, { color: c.warning }]}>PARTIALLY PAID</Text> : null}
                            {row.settlement.plannedDebtAmount === 0 ? <Text style={[styles.paidBadge, { color: c.warning }]}>SKIPPED IN FORECAST</Text> : null}
                            {(row.settlement.plannedDebtAmount ?? 0) > 0 ? <Text style={[styles.paidBadge, { color: c.primary }]}>CUSTOM FORECAST</Text> : null}
                            {row.paidOffThisMonth ? <Text style={[styles.paidBadge, { color: c.success }]}>PAYS OFF THIS MONTH</Text> : null}
                          </View>
                          <Text style={[styles.debtName, { color: c.foreground }]}>{row.name}</Text>
                        </View>
                        <Text style={[styles.debtBalance, { color: row.paidOffThisMonth ? c.success : c.foreground }]}>{money(row.balance)}</Text>
                      </View>
                      <View style={styles.debtStats}>
                        <View style={styles.debtStat}>
                          <Text style={[styles.debtStatLabel, { color: c.mutedForeground }]}>{row.settlement.status === "settled" ? "PAID THIS MONTH" : row.settlement.status === "partial" ? "PAID TO DATE" : "REQUIRED MINIMUM"}</Text>
                          <Text style={[styles.debtStatValue, { color: row.settlement.status === "settled" ? c.success : c.foreground }]}>{moneyOrDash(row.settlement.status === "scheduled" ? row.settlement.configuredObligation : row.settlement.paidAmount)}</Text>
                        </View>
                        <View style={styles.debtStat}>
                          <Text style={[styles.debtStatLabel, { color: c.mutedForeground }]}>{row.settlement.status === "settled" ? "REMAINING REQUIRED" : row.settlement.status === "partial" ? "REMAINING SCHEDULED" : "PLANNED TO DEBT"}</Text>
                          <Text style={[styles.debtStatValue, { color: c.primary }]}>{moneyOrDash(row.plannedToDebt)}</Text>
                        </View>
                        <View style={styles.debtStat}>
                          <Text style={[styles.debtStatLabel, { color: c.mutedForeground }]}>EST. MONTH-END</Text>
                          <Text style={[styles.debtStatValue, { color: row.balanceAfter <= 0.009 ? c.success : c.foreground }]}>{money(row.balanceAfter)}</Text>
                        </View>
                      </View>
                      {row.plannedToDebt <= 0.005 ? (
                        <Text style={[styles.sourceOutflow, { color: c.mutedForeground }]}>{row.settlement.status === "settled" ? `Required payment settled for ${monthLabel}.` : row.settlement.status === "partial" ? "Payment activity is recorded; no additional scheduled allocation is available." : "No required allocation is scheduled for this debt this month."}</Text>
                      ) : null}
                      {row.forecastPayment > 0.009 ? (
                        <Text style={[styles.sourceOutflow, { color: c.mutedForeground }]}>Forecast source outflow: {money(row.forecastPayment)}</Text>
                      ) : null}
                      {row.settlement.plannedDebtAmount !== undefined ? (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Edit ${row.name} Forecast amount`}
                          accessibilityState={{ disabled: !canEditHousehold }}
                          disabled={!canEditHousehold}
                          onPress={() => openForecastAmountEditor(row.id, row.dueDay)}
                          style={({ pressed }) => [styles.forecastEditAction, { borderColor: c.primary + "55", opacity: !canEditHousehold ? 0.45 : pressed ? 0.72 : 1 }]}
                        >
                          <Feather name="edit-3" size={14} color={c.primary} />
                          <Text style={[styles.forecastEditText, { color: c.primary }]}>{row.settlement.plannedDebtAmount === 0 ? "Restore or edit Forecast amount" : "Edit Forecast amount"}</Text>
                        </Pressable>
                      ) : null}
                      {row.rolloverSent > 0.009 ? (
                        <View style={[styles.rolloverCallout, { backgroundColor: c.success + "12", borderColor: c.success + "38" }]}>
                          <Feather name="corner-down-right" size={15} color={c.success} />
                          <View style={styles.flexOne}>
                            {row.rolloverEvents.map(event => (
                              <Text key={event.date} style={[styles.rolloverText, { color: c.foreground }]}><Text style={{ color: c.success }}>{money(event.amount)}</Text> continues to {event.targets.join(", ")} on {readableDate(event.date)}.</Text>
                            ))}
                          </View>
                        </View>
                      ) : row.rolloverReceived > 0.009 || row.extraReceived > 0.009 ? (
                        <View style={[styles.rolloverCallout, { backgroundColor: c.primary + "10", borderColor: c.primary + "35" }]}>
                          <Feather name="arrow-down-left" size={15} color={c.primary} />
                          <Text style={[styles.rolloverText, { color: c.foreground }]}>
                            {row.rolloverReceived > 0.009 ? `${money(row.rolloverReceived)} rollover` : ""}
                            {row.rolloverReceived > 0.009 && row.extraReceived > 0.009 ? " + " : ""}
                            {row.extraReceived > 0.009 ? `${money(row.extraReceived)} extra` : ""} lands here this month.
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  </View>
                )) : (
                  <View style={[styles.emptyCard, { backgroundColor: c.background + "88", borderColor: c.border }]}>
                    <Feather name="check-circle" size={24} color={c.success} />
                    <View style={styles.flexOne}>
                      <Text style={[styles.emptyTitle, { color: c.foreground }]}>No active payoff target</Text>
                      <Text style={[styles.smallCopy, { color: c.mutedForeground }]}>Add a debt or include one in the payoff plan to build your ladder.</Text>
                    </View>
                  </View>
                )}
              </View>

              <View style={[styles.sectionCard, { backgroundColor: c.card, borderColor: c.border }]}>
                <View style={styles.sectionHeader}>
                  <View style={styles.flexOne}>
                    <Text style={[styles.sectionEyebrow, { color: c.primary }]}>FORECAST SCHEDULE</Text>
                    <Text style={[styles.sectionTitle, { color: c.foreground }]}>{monthLabel} payment timeline</Text>
                    <Text style={[styles.sectionCopy, { color: c.mutedForeground }]}>Payoffs and rollovers remain on the original payment date.</Text>
                  </View>
                  <Feather name="calendar" size={20} color={c.primary} />
                </View>
                {timeline.length ? timeline.map((group, groupIndex) => (
                  <View key={group.date} style={styles.timelineGroup}>
                    <View style={styles.timelineRail}>
                      <View style={[styles.timelineDot, { backgroundColor: c.primary }]} />
                      {groupIndex < timeline.length - 1 ? <View style={[styles.timelineLine, { backgroundColor: c.border }]} /> : null}
                    </View>
                    <View style={styles.timelineBody}>
                      <View style={styles.timelineHeader}>
                        <Text style={[styles.timelineDate, { color: c.foreground }]}>{readableDate(group.date)}</Text>
                        <Text style={[styles.timelineTotal, { color: c.foreground }]}>{money(group.total)} planned</Text>
                      </View>
                      {group.allocations.map(allocation => (
                        <View key={allocation.id} style={[styles.timelineAllocation, { borderTopColor: c.border }]}>
                          <View style={[styles.kindBadge, { backgroundColor: allocation.kind === "rollover" ? c.success + "18" : allocation.kind === "extra" ? c.primary + "18" : c.background }]}>
                            <Text style={[styles.kindBadgeText, { color: allocation.kind === "rollover" ? c.success : allocation.kind === "extra" ? c.primary : c.mutedForeground }]}>{allocationLabel(allocation.kind)}</Text>
                          </View>
                          <View style={styles.flexOne}>
                            <Text style={[styles.allocationName, { color: c.foreground }]}>{allocation.targetBillName}</Text>
                            <Text style={[styles.allocationDetail, { color: c.mutedForeground }]}>
                              {allocation.kind === "rollover" && allocation.sourceBillName
                                ? `Unused payment from ${allocation.sourceBillName}`
                                : allocation.kind === "extra"
                                  ? "Separate safe extra payment"
                                  : allocation.paidOff
                                    ? "Scheduled payment closes this balance"
                                    : "Scheduled creditor payment"}
                            </Text>
                          </View>
                          <Text style={[styles.allocationAmount, { color: allocation.kind === "rollover" ? c.success : c.foreground }]}>{money(allocation.amount)}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                )) : (
                  <View style={[styles.timelineEmpty, { backgroundColor: c.background + "88" }]}>
                    <Text style={[styles.smallCopy, { color: c.mutedForeground }]}>No scheduled debt payments are available for this month.</Text>
                  </View>
                )}
              </View>
            </View>

            <View style={[styles.sideColumn, twoColumn && styles.sideColumnDesktop]}>
              <View style={[styles.plannerCard, { backgroundColor: c.card, borderColor: c.primary + "55" }]}>
                <View style={styles.sectionHeader}>
                  <View style={styles.flexOne}>
                    <Text style={[styles.sectionEyebrow, { color: c.primary }]}>SAFE EXTRA SIMULATOR</Text>
                    <Text style={[styles.sectionTitle, { color: c.foreground }]}>{existingPayment || editTransaction ? "Adjust your extra payment" : "Try an extra payment"}</Text>
                    <Text style={[styles.sectionCopy, { color: c.mutedForeground }]}>Nothing changes until you add the plan to Forecast.</Text>
                  </View>
                  <View style={[styles.shieldIcon, { backgroundColor: c.success + "18" }]}>
                    <Feather name="shield" size={19} color={c.success} />
                  </View>
                </View>

                <View style={[styles.safeMaximum, { backgroundColor: c.success + "10", borderColor: c.success + "38" }]}>
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
                    onChangeText={setExtraAmount}
                    keyboardType="decimal-pad"
                    placeholder="0.00"
                    placeholderTextColor={c.mutedForeground}
                    style={[styles.input, { color: c.foreground }]}
                  />
                </View>
                {requestedExtra > safeMaximum ? <Text style={[styles.error, { color: c.destructive }]}>Lower this to {money(safeMaximum)} or less to protect your safety floor.</Text> : null}
                {editTransaction && requestedExtra > editTargetCapacity ? <Text style={[styles.error, { color: c.destructive }]}>{target?.name ?? "This debt"} has {money(editTargetCapacity)} available for this payment.</Text> : null}
                {destinationConflict ? <Text style={[styles.error, { color: c.destructive }]}>That month already has a payoff plan. Edit that plan instead.</Text> : null}
                {safeMaximum > 0 && requestedExtra <= 0 ? (
                  <Pressable accessibilityRole="button" onPress={() => setExtraAmount(safeMaximum.toFixed(2))} style={styles.safeLink}>
                    <Text style={[styles.safeLinkText, { color: c.primary }]}>Preview maximum safe extra</Text>
                  </Pressable>
                ) : null}

                <DatePickerField
                  label="PAYMENT DATE"
                  value={paymentDate}
                  onChange={setPaymentDate}
                  minDate={today}
                  maxDate={maximumPlanDate(today, settings.forecast_horizon_months)}
                />

                <View style={styles.payoffDateLine}>
                  <Text style={[styles.payoffDateLabel, { color: c.mutedForeground }]}>PROJECTED PAYOFF</Text>
                  <Text style={[styles.payoffDateValue, { color: c.primary }]}>{readableMonth(preview.debtFreeDate)}</Text>
                </View>

                {displayedAllocations.length > 0 ? (
                  <View style={styles.allocations}>
                    <Text style={[styles.fieldLabel, { color: c.mutedForeground }]}>THIS EXTRA GOES TO</Text>
                    {displayedAllocations.map(allocation => (
                      <View key={allocation.billId} style={[styles.previewAllocation, { borderTopColor: c.border }]}>
                        <Feather name={allocation.paidOff ? "check-circle" : "arrow-right-circle"} size={16} color={allocation.paidOff ? c.success : c.primary} />
                        <Text style={[styles.previewAllocationName, { color: c.foreground }]}>{allocation.billName}</Text>
                        <Text style={[styles.previewAllocationAmount, { color: c.primary }]}>{money(allocation.payment)}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}

                <View style={styles.actions}>
                  {existingPayment || editTransaction ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ disabled: saving || !canEditHousehold }}
                      disabled={saving || !canEditHousehold}
                      onPress={removePlan}
                      style={({ pressed }) => [styles.removeButton, { borderColor: c.destructive, opacity: pressed || saving || !canEditHousehold ? 0.7 : 1 }]}
                    >
                      <Feather name="trash-2" size={15} color={c.destructive} />
                      <Text style={[styles.removeText, { color: c.destructive }]}>Remove</Text>
                    </Pressable>
                  ) : null}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={editTransaction ? "Update snowball payment" : existingPayment ? "Update extra payment in Forecast" : "Add extra payment to Forecast"}
                    accessibilityState={{ disabled: !valid || saving }}
                    disabled={!valid || saving}
                    onPress={savePlan}
                    style={({ pressed }) => [styles.saveButton, { backgroundColor: valid ? c.primary : c.muted, opacity: pressed || saving ? 0.72 : 1 }]}
                  >
                    <Feather name="calendar" size={16} color={valid ? c.primaryForeground : c.mutedForeground} />
                    <Text style={[styles.saveText, { color: valid ? c.primaryForeground : c.mutedForeground }]}>
                      {saving ? "Saving…" : editTransaction ? "Save payment changes" : existingPayment ? "Save plan changes" : "Save plan"}
                    </Text>
                  </Pressable>
                </View>
              </View>

            </View>
          </View>
          {scheduledPlans.length > 0 ? (
            <View style={[styles.sectionCard, { backgroundColor: c.card, borderColor: c.border }]}>
              <Text style={[styles.sectionEyebrow, { color: c.primary }]}>SAVED PLANS</Text>
              <Text style={[styles.sectionTitle, { color: c.foreground }]}>Extra payment history</Text>
              <Text style={[styles.sectionCopy, { color: c.mutedForeground }]}>Open a scheduled plan to review or change it.</Text>
              {scheduledPlans.map(plan => {
                const date = plan.payment_date ?? `${plan.year}-${String(plan.month + 1).padStart(2, "0")}-01`;
                const future = date >= today;
                const status = snowballPlanHistoryStatus(plan, snowballMatches, today);
                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ disabled: !future }}
                    disabled={!future}
                    key={plan.id}
                    onPress={() => choosePlan(plan.id, date, plan.amount)}
                    style={({ pressed }) => [styles.planRow, { borderTopColor: c.border, opacity: future ? pressed ? 0.72 : 1 : 0.55 }]}
                  >
                    <View style={[styles.planIcon, { backgroundColor: c.primary + "18" }]}>
                      <Feather name={status === "Applied" ? "check" : status === "Scheduled" ? "calendar" : "clock"} size={15} color={status === "Applied" ? c.success : c.primary} />
                    </View>
                    <View style={styles.flexOne}>
                      <Text style={[styles.planAmount, { color: c.foreground }]}>{money(plan.amount)} extra</Text>
                      <Text style={[styles.smallCopy, { color: c.mutedForeground }]}>{readableDate(date)} · {status}</Text>
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
  return <SnowballPlanScreen />;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { width: "100%", paddingHorizontal: 20, gap: 16 },
  desktopContent: { maxWidth: 1360, alignSelf: "center", paddingHorizontal: 34, gap: 20 },
  flexOne: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", gap: 12 },
  headerCopy: { flex: 1 },
  back: { width: 44, height: 44, borderRadius: 14, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  eyebrow: { fontSize: 10, fontFamily: "Inter_800ExtraBold", letterSpacing: 1.2 },
  title: { fontSize: 29, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.8 },
  desktopTitle: { fontSize: 40, letterSpacing: -1.2 },
  headerSubtitle: { fontSize: 13, lineHeight: 19, marginTop: 3, maxWidth: 720 },
  forecastBadge: { minHeight: 34, borderRadius: 999, borderWidth: 1, flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 12 },
  forecastBadgeMobile: { minHeight: 30, paddingHorizontal: 9 },
  liveDot: { width: 7, height: 7, borderRadius: 99 },
  forecastBadgeText: { fontSize: 9, fontFamily: "Inter_800ExtraBold", letterSpacing: 0.8 },
  hero: { borderWidth: 1, borderRadius: 24, padding: 17, overflow: "hidden" },
  heroDesktop: { padding: 24, borderRadius: 28 },
  heroGlow: { position: "absolute", width: 270, height: 270, borderRadius: 999, top: -150, right: -80 },
  heroTop: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 14 },
  heroLogo: { width: 72, height: 72, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  heroCopyWrap: { flex: 1 },
  heroLabel: { fontSize: 10, fontFamily: "Inter_800ExtraBold", letterSpacing: 1 },
  heroTitle: { fontSize: 24, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.5, marginTop: 2 },
  heroTitleDesktop: { fontSize: 31 },
  heroCopy: { fontSize: 13, lineHeight: 19, marginTop: 5, maxWidth: 760 },
  strategyPill: { minHeight: 36, borderRadius: 999, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 7 },
  strategyPillText: { fontSize: 11, fontFamily: "Inter_800ExtraBold" },
  metrics: { flexDirection: "row", gap: 12, marginTop: 20 },
  metricsMobile: { flexWrap: "wrap" },
  metric: { flex: 1, minWidth: 180, borderWidth: 1, borderRadius: 17, padding: 14 },
  metricMobile: { minWidth: 140 },
  metricLabel: { fontSize: 9, fontFamily: "Inter_800ExtraBold", letterSpacing: 0.8 },
  metricValue: { fontSize: 21, fontFamily: "Inter_800ExtraBold", marginTop: 4 },
  metricDetail: { fontSize: 11, fontFamily: "Inter_500Medium", marginTop: 3 },
  suggestion: { flexDirection: "row", alignItems: "center", gap: 11, borderWidth: 1, borderRadius: 18, padding: 14 },
  suggestionTitle: { fontSize: 14, fontFamily: "Inter_700Bold" },
  smallCopy: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  useSuggestion: { minHeight: 44, borderRadius: 12, paddingHorizontal: 14, alignItems: "center", justifyContent: "center" },
  useSuggestionText: { fontSize: 12, fontFamily: "Inter_800ExtraBold" },
  workspace: { gap: 16, flexDirection: "column-reverse" },
  workspaceDesktop: { flexDirection: "row", alignItems: "flex-start", gap: 20 },
  primaryColumn: { gap: 16 },
  primaryColumnDesktop: { flex: 1.14 },
  sideColumn: { gap: 16 },
  sideColumnDesktop: { flex: 0.86 },
  sectionCard: { borderWidth: 1, borderRadius: 23, padding: 17 },
  sectionHeader: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  sectionEyebrow: { fontSize: 9, fontFamily: "Inter_800ExtraBold", letterSpacing: 1 },
  sectionTitle: { fontSize: 20, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.35, marginTop: 3 },
  sectionCopy: { fontSize: 12, lineHeight: 17, marginTop: 4 },
  countBadge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 7 },
  countBadgeText: { fontSize: 9, fontFamily: "Inter_800ExtraBold", letterSpacing: 0.6 },
  ladderItem: { flexDirection: "row", alignItems: "stretch", marginTop: 14 },
  ladderRail: { width: 38, alignItems: "center" },
  rankBubble: { width: 32, height: 32, borderRadius: 11, borderWidth: 1, alignItems: "center", justifyContent: "center", zIndex: 1 },
  rankText: { fontSize: 10, fontFamily: "Inter_800ExtraBold" },
  railLine: { width: 2, flex: 1, minHeight: 20 },
  debtCard: { flex: 1, borderWidth: 1, borderRadius: 18, padding: 14, marginLeft: 5 },
  debtHeader: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  inlineBadges: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  targetBadge: { fontSize: 9, fontFamily: "Inter_800ExtraBold", letterSpacing: 0.7 },
  paidBadge: { fontSize: 9, fontFamily: "Inter_800ExtraBold", letterSpacing: 0.6 },
  debtName: { fontSize: 17, fontFamily: "Inter_800ExtraBold", marginTop: 3 },
  debtBalance: { fontSize: 18, fontFamily: "Inter_800ExtraBold" },
  debtStats: { flexDirection: "row", gap: 9, marginTop: 13 },
  debtStat: { flex: 1 },
  debtStatLabel: { fontSize: 8, fontFamily: "Inter_800ExtraBold", letterSpacing: 0.65 },
  debtStatValue: { fontSize: 13, fontFamily: "Inter_700Bold", marginTop: 3 },
  sourceOutflow: { fontSize: 10, lineHeight: 15, fontFamily: "Inter_600SemiBold", marginTop: 10 },
  forecastEditAction: { alignSelf: "flex-start", minHeight: 44, borderWidth: 1, borderRadius: 12, flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 11, marginTop: 10 },
  forecastEditText: { fontSize: 11, fontFamily: "Inter_700Bold" },
  rolloverCallout: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 12, padding: 10, marginTop: 12 },
  rolloverText: { flex: 1, fontSize: 11, lineHeight: 16, fontFamily: "Inter_600SemiBold" },
  emptyCard: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: 16, padding: 16, marginTop: 14 },
  emptyTitle: { fontSize: 16, fontFamily: "Inter_800ExtraBold" },
  timelineGroup: { flexDirection: "row", alignItems: "stretch", marginTop: 16 },
  timelineRail: { width: 24, alignItems: "center" },
  timelineDot: { width: 10, height: 10, borderRadius: 99, marginTop: 6 },
  timelineLine: { width: 2, flex: 1, marginTop: 3 },
  timelineBody: { flex: 1, paddingLeft: 8 },
  timelineHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  timelineDate: { fontSize: 14, fontFamily: "Inter_800ExtraBold" },
  timelineTotal: { fontSize: 12, fontFamily: "Inter_700Bold" },
  timelineAllocation: { flexDirection: "row", alignItems: "center", gap: 9, borderTopWidth: 1, paddingVertical: 10, marginTop: 8 },
  kindBadge: { borderRadius: 8, paddingHorizontal: 7, paddingVertical: 5 },
  kindBadgeText: { fontSize: 9, fontFamily: "Inter_800ExtraBold", letterSpacing: 0.45 },
  allocationName: { fontSize: 13, fontFamily: "Inter_700Bold" },
  allocationDetail: { fontSize: 10, lineHeight: 14, marginTop: 2 },
  allocationAmount: { fontSize: 13, fontFamily: "Inter_800ExtraBold" },
  timelineEmpty: { borderRadius: 14, padding: 14, marginTop: 14 },
  plannerCard: { borderWidth: 1, borderRadius: 23, padding: 17 },
  shieldIcon: { width: 42, height: 42, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  safeMaximum: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, borderWidth: 1, borderRadius: 16, padding: 13, marginTop: 16 },
  cardLabel: { fontSize: 9, fontFamily: "Inter_800ExtraBold", letterSpacing: 0.8 },
  safeAmount: { fontSize: 26, fontFamily: "Inter_800ExtraBold", marginTop: 2 },
  monthBadge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 7 },
  monthBadgeText: { fontSize: 10, fontFamily: "Inter_700Bold" },
  fieldLabel: { fontSize: 9, fontFamily: "Inter_800ExtraBold", letterSpacing: 0.8, marginTop: 16, marginBottom: 7 },
  inputWrap: { width: "100%", maxWidth: "100%", alignSelf: "stretch", overflow: "hidden", flexDirection: "row", alignItems: "center", borderRadius: 14, borderWidth: 1.5 },
  dollar: { flexShrink: 0, fontSize: 21, paddingLeft: 14 },
  input: { flex: 1, flexBasis: 0, flexShrink: 1, minWidth: 0, height: 54, paddingLeft: 3, paddingRight: 14, fontSize: 21, fontFamily: "Inter_700Bold", outlineStyle: "none" as never },
  error: { fontSize: 11, lineHeight: 16, marginTop: 6 },
  safeLink: { alignSelf: "flex-start", paddingVertical: 9 },
  safeLinkText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  payoffDateLine: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 16 },
  payoffDateLabel: { fontSize: 9, fontFamily: "Inter_800ExtraBold", letterSpacing: 0.7 },
  payoffDateValue: { fontSize: 14, fontFamily: "Inter_800ExtraBold" },
  allocations: { marginTop: 1 },
  previewAllocation: { flexDirection: "row", alignItems: "center", gap: 8, borderTopWidth: 1, paddingVertical: 10 },
  previewAllocationName: { flex: 1, fontSize: 12, fontFamily: "Inter_600SemiBold" },
  previewAllocationAmount: { fontSize: 12, fontFamily: "Inter_800ExtraBold" },
  actions: { flexDirection: "row", gap: 10, marginTop: 16 },
  removeButton: { minWidth: 94, height: 52, borderRadius: 14, borderWidth: 1, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center" },
  removeText: { fontSize: 13, fontFamily: "Inter_700Bold" },
  saveButton: { flex: 1, height: 52, borderRadius: 14, flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center" },
  saveText: { fontSize: 14, fontFamily: "Inter_800ExtraBold" },
  planRow: { flexDirection: "row", alignItems: "center", gap: 10, borderTopWidth: 1, paddingVertical: 12, marginTop: 9 },
  planIcon: { width: 36, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  planAmount: { fontSize: 14, fontFamily: "Inter_700Bold" },
});
