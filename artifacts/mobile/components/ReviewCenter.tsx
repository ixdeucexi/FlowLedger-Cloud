import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { AddBillModal, type AddBillInitialValues } from "@/components/AddBillModal";
import { BillSurplusModal } from "@/components/BillSurplusModal";
import { FloLogo } from "@/components/FloLogo";
import { GoalModal } from "@/components/GoalModal";
import { UnplannedChargeModal } from "@/components/UnplannedChargeModal";
import type { Bill, Goal, ReconcileTransactionInput, Transaction } from "@/context/BudgetContext";
import { useBudget } from "@/context/BudgetContext";
import { useColors } from "@/hooks/useColors";
import { confirmAction } from "@/lib/confirmAction";
import { buildCurrentMonthReviewQueue, buildForgottenBillDefaults, forgottenBillSettlement, groupReviewTargets, matchedOccurrenceAllocations, occurrenceKey, rankReviewTargets, reviewQueueAfterSkips, type RankedReviewTarget, type ReviewTarget } from "@/lib/reviewCenter";
import { isOpenSpendingBucket, spendingBucketSummary } from "@/lib/spendingBuckets";

function todayIso() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function money(value: number) {
  return `$${Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function displayDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function transactionName(transaction: Transaction) {
  return transaction.merchant_name?.trim() || transaction.note?.trim() || transaction.category || "Bank transaction";
}

type VarianceChoice = { transaction: Transaction; target: RankedReviewTarget; direction: "lower" | "higher" };

type RoutedSurplus = {
  transactionId: string;
  billId: string;
  billName: string;
  amount: number;
  month: number;
  year: number;
  paymentDate: string;
};

type CompletedReviewAction = {
  input: ReconcileTransactionInput;
  label: string;
  routedSurplus?: RoutedSurplus;
};

type ReviewSurplusPrompt = {
  transaction: Transaction;
  target: RankedReviewTarget;
};

function isValidDateInMonth(value: string, month: number, year: number) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [dateYear, dateMonth, dateDay] = value.split("-").map(Number);
  return dateYear === year && dateMonth === month + 1 && dateDay >= 1 && dateDay <= new Date(year, month + 1, 0).getDate();
}

export function ReviewCenter() {
  const c = useColors();
  const {
    transactions, goals, decisions, extraPayments, categories, canEditHousehold, settings,
    getMonthlyBills, getBillOccurrencesInMonth, getBillMonthlyTotal, getIncomeOccurrencesInMonth,
    addBill, addGoal, updateGoal, deleteGoal, closeSpendingBucket, reopenSpendingBucket,
    archiveSpendingBucket, restoreArchivedSpendingBucket,
    deleteBillMistake, reconcileTransaction, undoTransactionReconciliation, refreshBankData,
    getExtraPayment, previewDebtSnowball, applyDebtSnowballPayment, removeReviewSurplusFunding,
  } = useBudget();
  useEffect(() => {
    void refreshBankData();
  }, [refreshBankData]);
  const queue = useMemo(() => buildCurrentMonthReviewQueue(transactions, todayIso()), [transactions]);
  const [saving, setSaving] = useState(false);
  const [variance, setVariance] = useState<VarianceChoice | null>(null);
  const [splitCategory, setSplitCategory] = useState<string | null>(null);
  const [unplannedChargeVisible, setUnplannedChargeVisible] = useState(false);
  const [forgottenBillVisible, setForgottenBillVisible] = useState(false);
  const [spendingBucketVisible, setSpendingBucketVisible] = useState(false);
  const [editingBucket, setEditingBucket] = useState<Goal | null>(null);
  const [bucketMessage, setBucketMessage] = useState<string | null>(null);
  const [showArchivedBuckets, setShowArchivedBuckets] = useState(false);
  const [skippedIds, setSkippedIds] = useState<string[]>([]);
  const [lastCompleted, setLastCompleted] = useState<CompletedReviewAction | null>(null);
  const [redoAction, setRedoAction] = useState<CompletedReviewAction | null>(null);
  const [surplusPrompt, setSurplusPrompt] = useState<ReviewSurplusPrompt | null>(null);
  const [surplusPaymentDate, setSurplusPaymentDate] = useState(todayIso());
  const [completedThisVisit, setCompletedThisVisit] = useState(0);
  const availableQueue = useMemo(() => reviewQueueAfterSkips(queue, skippedIds), [queue, skippedIds]);
  const current = availableQueue[0] ?? null;
  const forgottenBillDefaults = useMemo<AddBillInitialValues | undefined>(() => {
    if (!current) return undefined;
    const defaults = buildForgottenBillDefaults(current);
    return { ...defaults, category: categories.includes(defaults.category) ? defaults.category : "Other" };
  }, [categories, current]);
  const initialTotal = useRef(0);
  useEffect(() => {
    initialTotal.current = Math.max(initialTotal.current, queue.length + completedThisVisit);
  }, [completedThisVisit, queue.length]);

  const targets = useMemo(() => {
    if (!current) return [];
    const [year, monthNumber] = current.date.split("-").map(Number);
    const month = monthNumber - 1;
    const candidates: ReviewTarget[] = [];
    const billMatches = matchedOccurrenceAllocations(transactions, "bill");
    const incomeMatches = matchedOccurrenceAllocations(transactions, "income");
    const snowballMatches = matchedOccurrenceAllocations(transactions, "extra_principal", "snowball");
    if (current.amount < 0) {
      getMonthlyBills(month, year).forEach(bill => {
        const days = getBillOccurrencesInMonth(bill, month, year);
        const monthlyTotal = getBillMonthlyTotal(bill, month, year);
        const plannedAmount = days.length ? monthlyTotal / days.length : bill.amount;
        days.forEach(day => {
          const occurrenceDate = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const previous = billMatches.get(occurrenceKey(bill.id, occurrenceDate));
          const remaining = Math.max(0, plannedAmount - Number(previous?.amount || 0));
          if (remaining <= 0.005) return;
          candidates.push({ type: "bill", id: bill.id, name: bill.name, category: bill.category || "Other",
            plannedAmount: remaining, occurrenceDate, isDebt: bill.is_debt });
        });
      });
      extraPayments
        .filter(payment => payment.month === month && payment.year === year)
        .forEach(payment => {
          const occurrenceDate = payment.payment_date ?? `${year}-${String(month + 1).padStart(2, "0")}-01`;
          payment.allocations.forEach(allocation => {
            const previous = snowballMatches.get(occurrenceKey(allocation.billId, occurrenceDate));
            const remaining = !previous
              ? Math.max(0, allocation.payment)
              : previous.settlement === "partial"
                ? Math.max(0, Number(previous.plannedAmount ?? allocation.payment) - Number(previous.amount || 0))
                : 0;
            if (remaining <= 0.005) return;
            candidates.push({
              type: "snowball",
              id: allocation.billId,
              name: `${allocation.billName} snowball`,
              category: "Debt",
              plannedAmount: remaining,
              occurrenceDate,
              isDebt: true,
            });
          });
        });
      goals.filter(goal => goal.goal_type === "planned_expense" && isOpenSpendingBucket(goal) && goal.target_date?.startsWith(`${year}-${String(month + 1).padStart(2, "0")}`))
        .forEach(goal => candidates.push({
          type: "goal", id: goal.id, name: goal.name, category: "Planned spending",
          plannedAmount: Math.max(0, goal.target_amount - Math.max(0, goal.current_amount)), occurrenceDate: goal.target_date.slice(0, 10),
        }));
      decisions.filter(decision => decision.status === "planned" || decision.status === "calendar")
        .forEach(decision => {
          const occurrenceDate = decision.calendar_date || (typeof decision.scenario?.date === "string" ? decision.scenario.date : "");
          const plannedAmount = Math.max(0, Math.abs(Number(decision.scenario?.amount) || 0) - Math.abs(Number(decision.actual_amount) || 0));
          if (!occurrenceDate.startsWith(`${year}-${String(month + 1).padStart(2, "0")}`) || plannedAmount <= 0) return;
          candidates.push({ type: "decision", id: decision.id, name: decision.name, category: "Calendar plan", plannedAmount, occurrenceDate: occurrenceDate.slice(0, 10) });
        });
    } else {
      getIncomeOccurrencesInMonth(month, year).forEach(({ income, days, effectiveAmount }) => {
        days.forEach(day => {
          const occurrenceDate = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const previous = incomeMatches.get(occurrenceKey(income.id, occurrenceDate));
          const remaining = Math.max(0, effectiveAmount - Number(previous?.amount || 0));
          if (remaining <= 0.005) return;
          candidates.push({ type: "income", id: income.id, name: income.name, category: "Income", plannedAmount: remaining, occurrenceDate });
        });
      });
    }
    return rankReviewTargets(current, candidates);
  }, [current, decisions, extraPayments, getBillMonthlyTotal, getBillOccurrencesInMonth, getIncomeOccurrencesInMonth, getMonthlyBills, goals, transactions]);
  const groupedTargets = useMemo(() => groupReviewTargets(targets), [targets]);
  const spendingBuckets = useMemo(() => goals
    .filter(goal => goal.goal_type === "planned_expense" && !goal.archived_at)
    .sort((left, right) => Number(Boolean(left.closed_at)) - Number(Boolean(right.closed_at))
      || left.target_date.localeCompare(right.target_date)
      || left.name.localeCompare(right.name)), [goals]);
  const archivedBuckets = useMemo(() => goals
    .filter(goal => goal.goal_type === "planned_expense" && Boolean(goal.archived_at))
    .sort((left, right) => (right.archived_at ?? "").localeCompare(left.archived_at ?? "")), [goals]);

  const surplusSnowballOffer = useMemo(() => {
    if (!surplusPrompt || !settings.debtPayoffEnabled) return null;
    const [year, monthNumber] = surplusPrompt.transaction.date.split("-").map(Number);
    const month = monthNumber - 1;
    const surplus = Math.max(0, surplusPrompt.target.plannedAmount - Math.abs(surplusPrompt.transaction.amount));
    const existing = getExtraPayment(month, year);
    const previousSource = existing?.sources?.find(source => source.type === "bill_surplus" && source.reviewTransactionId === surplusPrompt.transaction.id)?.amount ?? 0;
    const total = Math.max(0, (existing?.amount ?? 0) - previousSource + surplus);
    const dateValid = isValidDateInMonth(surplusPaymentDate, month, year);
    const preview = previewDebtSnowball(month, year, total, surplus - previousSource, dateValid ? surplusPaymentDate : undefined);
    return {
      month,
      year,
      surplus,
      preview,
      targetDebt: preview.months[0]?.targetName ?? preview.allocations[0]?.billName,
      dateValid,
      safe: dateValid && preview.selectedExtra + 0.005 >= total,
    };
  }, [getExtraPayment, previewDebtSnowball, settings.debtPayoffEnabled, surplusPaymentDate, surplusPrompt]);

  const closeBucket = (goal: Goal) => {
    const { spent } = spendingBucketSummary(goal);
    const released = Math.max(0, Number(goal.target_amount) - spent);
    confirmAction({
      title: `Close ${goal.name}?`,
      message: `${money(spent)} was matched from ${money(goal.target_amount)} planned. ${released > 0.005 ? `${money(released)} will become available again.` : "There is no money left to release."}`,
      confirmText: "Close bucket",
      onConfirm: async () => {
        setSaving(true);
        setBucketMessage(null);
        try {
          const result = await closeSpendingBucket(goal.id);
          setBucketMessage(`${goal.name} closed · ${money(result.released)} released`);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } catch (error) {
          Alert.alert("Couldn’t close bucket", error instanceof Error ? error.message : "Please try again.");
        } finally {
          setSaving(false);
        }
      },
    });
  };

  const reopenBucket = async (goal: Goal) => {
    if (saving) return;
    setSaving(true);
    setBucketMessage(null);
    try {
      await reopenSpendingBucket(goal.id);
      setBucketMessage(`${goal.name} reopened`);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (error) {
      Alert.alert("Couldn’t reopen bucket", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const archiveBucket = (goal: Goal) => {
    if (!goal.closed_at || saving) return;
    confirmAction({
      title: `Archive ${goal.name}?`,
      message: "This removes the completed bucket from your active list. Its matched transactions and history stay saved.",
      confirmText: "Archive bucket",
      onConfirm: async () => {
        setSaving(true);
        setBucketMessage(null);
        try {
          await archiveSpendingBucket(goal.id);
          setBucketMessage(`${goal.name} archived`);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } catch (error) {
          Alert.alert("Couldn’t archive bucket", error instanceof Error ? error.message : "Please try again.");
        } finally {
          setSaving(false);
        }
      },
    });
  };

  const restoreBucket = async (goal: Goal) => {
    if (saving) return;
    setSaving(true);
    setBucketMessage(null);
    try {
      await restoreArchivedSpendingBucket(goal.id);
      setBucketMessage(`${goal.name} restored to completed buckets`);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (error) {
      Alert.alert("Couldn’t restore bucket", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const completeReview = async (input: ReconcileTransactionInput, notice?: string) => {
    if (!current || saving) throw new Error("This transaction is no longer available for review.");
    const reviewed = current;
    setSaving(true);
    try {
      await reconcileTransaction(input);
      const action = { input, label: notice || transactionName(reviewed) };
      setLastCompleted(action);
      setRedoAction(null);
      setCompletedThisVisit(value => value + 1);
      setVariance(null);
      setSplitCategory(null);
      setUnplannedChargeVisible(false);
      setForgottenBillVisible(false);
      setSpendingBucketVisible(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return action;
    } finally {
      setSaving(false);
    }
  };

  const finish = async (input: ReconcileTransactionInput, notice?: string) => {
    try {
      await completeReview(input, notice);
      return true;
    } catch (error) {
      Alert.alert("Couldn’t finish this review", error instanceof Error ? error.message : "Please try again.");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return false;
    }
  };

  const saveForgottenBill = async (data: Omit<Bill, "id" | "created_at"> | Bill) => {
    if (!current) throw new Error("This bank charge is no longer available.");
    const reviewed = current;
    const billData = data as Omit<Bill, "id" | "created_at">;
    const billId = await addBill(billData);
    try {
      await completeReview({
        transactionId: reviewed.id,
        resolution: "bill",
        targetId: billId,
        occurrenceDate: reviewed.date,
        plannedAmount: billData.amount,
        settlement: forgottenBillSettlement(reviewed.amount, billData.amount),
      }, `${billData.name} added as a bill and paid`);
    } catch (error) {
      try {
        await deleteBillMistake(billId);
      } catch {
        // Keep the original reconciliation error; the new bill remains removable from Bills.
      }
      throw error;
    }
  };

  const resolveTarget = async (target: RankedReviewTarget, settlement: ReconcileTransactionInput["settlement"], extraCategory?: string) => {
    if (!current) return;
    const actual = Math.abs(current.amount);
    const difference = Math.abs(actual - target.plannedAmount);
    const isBucket = target.type === "goal" || target.type === "decision";
    const label = target.type === "income" ? `${target.name} received`
      : target.type === "snowball" ? `${target.name} paid`
      : isBucket ? `${target.name} bucket updated`
      : `${target.name} paid`;
    const notice = isBucket
      ? settlement === "partial"
        ? `${target.name} bucket updated · ${money(difference)} still set aside`
        : difference > 0.005 && actual < target.plannedAmount
          ? `${target.name} bucket closed · ${money(difference)} released`
          : `${target.name} bucket closed`
      : difference > 0.005
        ? `${label} · ${money(difference)} ${actual > target.plannedAmount ? "over" : "left"}`
        : label;
    return finish({
      transactionId: current.id,
      resolution: target.type,
      targetId: target.id,
      occurrenceDate: target.occurrenceDate,
      plannedAmount: target.plannedAmount,
      settlement,
      extraCategory,
    }, notice);
  };

  const chooseTarget = (target: RankedReviewTarget) => {
    if (!current || saving) return;
    const actual = Math.abs(current.amount);
    if (Math.abs(actual - target.plannedAmount) < 0.005) {
      void resolveTarget(target, "exact");
      return;
    }
    setVariance({ transaction: current, target, direction: actual < target.plannedAmount ? "lower" : "higher" });
    setSplitCategory(null);
  };

  const applyRoutedSurplus = async (routed: RoutedSurplus) => {
    const existing = getExtraPayment(routed.month, routed.year);
    const previousSource = existing?.sources?.find(source => source.reviewTransactionId === routed.transactionId)?.amount ?? 0;
    const otherSources = (existing?.sources ?? (existing ? [{ type: "manual" as const, amount: existing.amount }] : []))
      .filter(source => source.reviewTransactionId !== routed.transactionId);
    const sources = [...otherSources, {
      type: "bill_surplus" as const,
      amount: routed.amount,
      billId: routed.billId,
      billName: routed.billName,
      reviewTransactionId: routed.transactionId,
    }].filter(source => source.amount > 0.005);
    const total = Math.max(0, (existing?.amount ?? 0) - previousSource + routed.amount);
    const preview = previewDebtSnowball(routed.month, routed.year, total, routed.amount - previousSource, routed.paymentDate);
    if (!preview.allocations.length || preview.selectedExtra + 0.005 < total) {
      throw new Error("That leftover is no longer safe to add to the payoff plan.");
    }
    await applyDebtSnowballPayment(preview, sources);
  };

  const undoLast = async () => {
    if (!lastCompleted || saving) return;
    const action = lastCompleted;
    setSaving(true);
    try {
      if (action.routedSurplus) await removeReviewSurplusFunding(action.input.transactionId);
      await undoTransactionReconciliation(action.input.transactionId);
      setLastCompleted(null);
      setRedoAction(action);
      setCompletedThisVisit(value => Math.max(0, value - 1));
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (error) {
      Alert.alert("Couldn’t undo review", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const redoLast = async () => {
    if (!redoAction || saving) return;
    const action = redoAction;
    setSaving(true);
    try {
      await reconcileTransaction(action.input);
      try {
        if (action.routedSurplus) await applyRoutedSurplus(action.routedSurplus);
      } catch (error) {
        await undoTransactionReconciliation(action.input.transactionId);
        throw error;
      }
      setLastCompleted(action);
      setRedoAction(null);
      setCompletedThisVisit(value => value + 1);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      Alert.alert("Couldn’t redo review", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const confirmLowerFullPayment = async () => {
    if (!variance || variance.direction !== "lower" || saving) return;
    const choice = variance;
    const completed = await resolveTarget(choice.target, "full");
    if (!completed || choice.target.type !== "bill") return;
    setSurplusPaymentDate(choice.transaction.date);
    setSurplusPrompt({ transaction: choice.transaction, target: choice.target });
  };

  const keepSurplusAvailable = () => {
    setSurplusPrompt(null);
  };

  const routeSurplusToPayoff = async () => {
    if (!surplusPrompt || !surplusSnowballOffer?.safe || !surplusSnowballOffer.preview.allocations.length || saving) return;
    const routed: RoutedSurplus = {
      transactionId: surplusPrompt.transaction.id,
      billId: surplusPrompt.target.id,
      billName: surplusPrompt.target.name,
      amount: surplusSnowballOffer.surplus,
      month: surplusSnowballOffer.month,
      year: surplusSnowballOffer.year,
      paymentDate: surplusPaymentDate,
    };
    setSaving(true);
    try {
      await applyRoutedSurplus(routed);
      setLastCompleted(previous => previous?.input.transactionId === routed.transactionId ? { ...previous, routedSurplus: routed, label: `${previous.label} · ${money(routed.amount)} sent to ${surplusSnowballOffer.targetDebt}` } : previous);
      setSurplusPrompt(null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      Alert.alert("Couldn’t route leftover", error instanceof Error ? error.message : "The bill is still matched. You can keep the leftover available or try again.");
    } finally {
      setSaving(false);
    }
  };

  const skipCurrent = () => {
    if (!current || saving) return;
    setSkippedIds(previous => previous.includes(current.id) ? previous : [...previous, current.id]);
    setVariance(null);
    setSplitCategory(null);
    setUnplannedChargeVisible(false);
    setForgottenBillVisible(false);
    setSpendingBucketVisible(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  if (!canEditHousehold) {
    return (
      <View style={[styles.emptyCard, { backgroundColor: c.card, borderColor: c.border }]}>
        <Feather name="eye" size={25} color={c.primary} />
        <Text style={[styles.emptyTitle, { color: c.foreground }]}>Review Center is read-only</Text>
        <Text style={[styles.emptyText, { color: c.mutedForeground }]}>A household editor can match and clear posted bank activity.</Text>
      </View>
    );
  }

  const total = Math.max(initialTotal.current, completedThisVisit + queue.length);
  const position = Math.min(total, completedThisVisit + skippedIds.length + 1);
  const renderTarget = (target: RankedReviewTarget, index: number) => current ? (
    <Pressable accessibilityRole="button" accessibilityLabel={`Match ${transactionName(current)} to ${target.name}`} key={`${target.type}-${target.id}-${target.occurrenceDate}`} disabled={saving} onPress={() => chooseTarget(target)} style={({ pressed }) => [styles.targetRow, { backgroundColor: c.muted, borderColor: index === 0 && target.score >= 48 ? c.success + "66" : c.border, opacity: saving ? 0.55 : pressed ? 0.8 : 1 }]}>
      <View style={[styles.targetIcon, { backgroundColor: (target.type === "income" ? c.success : target.isDebt ? c.warning : c.primary) + "18" }]}>
        <Feather name={target.type === "income" ? "trending-up" : target.type === "bill" ? "file-text" : target.type === "snowball" ? "target" : "shopping-bag"} size={17} color={target.type === "income" ? c.success : target.isDebt ? c.warning : c.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <View style={styles.targetHeading}><Text style={[styles.targetName, { color: c.foreground }]} numberOfLines={2}>{target.name}</Text>{index === 0 && target.score >= 48 ? <Text style={[styles.suggested, { color: c.success }]}>SUGGESTED</Text> : null}</View>
        <Text style={[styles.targetMeta, { color: c.mutedForeground }]}>
          {target.type === "income" ? "Expected income" : target.type === "bill" ? "Bill" : target.type === "snowball" ? "Snowball plan" : "Set-aside bucket"}: {money(target.plannedAmount)} · {displayDate(target.occurrenceDate)}
        </Text>
        {target.reasons.length ? <Text style={[styles.targetReason, { color: c.success }]}>{target.reasons.slice(0, 2).join(" · ")}</Text> : null}
      </View>
      <Feather name="chevron-right" size={18} color={c.mutedForeground} />
    </Pressable>
  ) : null;
  const surplusMonth = surplusSnowballOffer?.month ?? new Date().getMonth();
  const surplusYear = surplusSnowballOffer?.year ?? new Date().getFullYear();
  const surplusMonthText = String(surplusMonth + 1).padStart(2, "0");
  const surplusMonthLastDay = String(new Date(surplusYear, surplusMonth + 1, 0).getDate()).padStart(2, "0");

  return (
    <>
      <View style={[styles.hero, { backgroundColor: c.card, borderColor: c.primary + "44" }]}>
        <View style={[styles.heroIcon, { backgroundColor: c.primary + "18" }]}><Feather name="check-square" size={22} color={c.primary} /></View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.eyebrow, { color: c.primary }]}>PRO REVIEW CENTER</Text>
          <Text style={[styles.heroTitle, { color: c.foreground }]}>Match the bank to your plan</Text>
          <Text style={[styles.heroCopy, { color: c.mutedForeground }]}>Match each posted transaction once.</Text>
        </View>
      </View>

      {spendingBuckets.length || archivedBuckets.length ? (
        <View style={[styles.bucketManager, { backgroundColor: c.card, borderColor: c.border }]}>
          <View style={styles.bucketManagerHeader}>
            <View style={[styles.heroIcon, { backgroundColor: c.primary + "18" }]}><Feather name="shopping-bag" size={19} color={c.primary} /></View>
            <View style={styles.optionCopy}>
              <Text style={[styles.sectionTitle, styles.bucketManagerTitle, { color: c.foreground }]}>Spending buckets</Text>
              <Text style={[styles.sectionCopy, styles.bucketManagerCopy, { color: c.mutedForeground }]}>Edit, close, or archive a bucket.</Text>
            </View>
          </View>
          {bucketMessage ? <Text style={[styles.bucketMessage, { color: c.success, backgroundColor: c.success + "12" }]}>{bucketMessage}</Text> : null}
          {spendingBuckets.map((goal, index) => {
            const summary = spendingBucketSummary(goal);
            return (
              <View key={goal.id} style={[styles.bucketRow, index > 0 && { borderTopWidth: 1, borderTopColor: c.border }]}>
                <View style={styles.optionCopy}>
                  <View style={styles.bucketNameRow}>
                    <Text numberOfLines={1} style={[styles.optionTitle, { color: c.foreground }]}>{goal.name}</Text>
                    {goal.closed_at ? <Text style={[styles.closedBadge, { color: c.success, backgroundColor: c.success + "18" }]}>CLOSED</Text> : null}
                  </View>
                  <Text style={[styles.optionDescription, { color: c.mutedForeground }]}>Planned {money(summary.planned)} · Spent {money(summary.spent)} · {summary.closed ? `Released ${money(summary.released)}` : `${money(summary.remaining)} left`}</Text>
                </View>
                <View style={styles.bucketActions}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Edit ${goal.name} bucket`}
                    disabled={saving}
                    onPress={() => setEditingBucket(goal)}
                    style={({ pressed }) => [styles.bucketActionButton, { borderColor: c.border, opacity: saving ? 0.5 : pressed ? 0.72 : 1 }]}
                  >
                    <Feather name="edit-3" size={13} color={c.primary} />
                    <Text style={[styles.bucketActionText, { color: c.primary }]}>Edit</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${goal.closed_at ? "Reopen" : "Close"} ${goal.name} bucket`}
                    disabled={saving}
                    onPress={() => goal.closed_at ? void reopenBucket(goal) : closeBucket(goal)}
                    style={({ pressed }) => [styles.bucketActionButton, { borderColor: goal.closed_at ? c.success + "66" : c.warning + "66", opacity: saving ? 0.5 : pressed ? 0.72 : 1 }]}
                  >
                    <Feather name={goal.closed_at ? "rotate-ccw" : "check-circle"} size={13} color={goal.closed_at ? c.success : c.warning} />
                    <Text style={[styles.bucketActionText, { color: goal.closed_at ? c.success : c.warning }]}>{goal.closed_at ? "Reopen" : "Close"}</Text>
                  </Pressable>
                  {goal.closed_at ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Archive ${goal.name} bucket`}
                      disabled={saving}
                      onPress={() => archiveBucket(goal)}
                      style={({ pressed }) => [styles.bucketActionButton, { borderColor: c.border, opacity: saving ? 0.5 : pressed ? 0.72 : 1 }]}
                    >
                      <Feather name="archive" size={13} color={c.mutedForeground} />
                      <Text style={[styles.bucketActionText, { color: c.mutedForeground }]}>Archive</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            );
          })}
          {archivedBuckets.length ? (
            <View style={[styles.archivedSection, { borderTopColor: c.border }]}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${showArchivedBuckets ? "Hide" : "Show"} archived spending buckets`}
                onPress={() => setShowArchivedBuckets(previous => !previous)}
                style={styles.archivedToggle}
              >
                <Feather name="archive" size={14} color={c.mutedForeground} />
                <Text style={[styles.archivedToggleText, { color: c.mutedForeground }]}>Archived buckets ({archivedBuckets.length})</Text>
                <Feather name={showArchivedBuckets ? "chevron-up" : "chevron-down"} size={16} color={c.mutedForeground} />
              </Pressable>
              {showArchivedBuckets ? archivedBuckets.map(goal => (
                <View key={goal.id} style={[styles.archivedRow, { borderTopColor: c.border }]}>
                  <View style={styles.optionCopy}>
                    <Text numberOfLines={1} style={[styles.optionTitle, { color: c.foreground }]}>{goal.name}</Text>
                    <Text style={[styles.optionDescription, { color: c.mutedForeground }]}>Completed bucket · history preserved</Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Restore ${goal.name} bucket`}
                    disabled={saving}
                    onPress={() => void restoreBucket(goal)}
                    style={({ pressed }) => [styles.bucketActionButton, { borderColor: c.primary + "66", opacity: saving ? 0.5 : pressed ? 0.72 : 1 }]}
                  >
                    <Feather name="rotate-ccw" size={13} color={c.primary} />
                    <Text style={[styles.bucketActionText, { color: c.primary }]}>Restore</Text>
                  </Pressable>
                </View>
              )) : null}
            </View>
          ) : null}
        </View>
      ) : null}

      {lastCompleted ? (
        <View style={[styles.undoCard, { backgroundColor: c.success + "12", borderColor: c.success + "44" }]}>
          <Feather name="check-circle" size={18} color={c.success} />
          <Text style={[styles.undoText, { color: c.foreground }]} numberOfLines={1}>{lastCompleted.label}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Undo last transaction review" disabled={saving} onPress={() => void undoLast()} hitSlop={8}><Text style={[styles.undoButton, { color: c.primary }]}>Undo</Text></Pressable>
        </View>
      ) : null}

      {redoAction ? (
        <View style={[styles.undoCard, { backgroundColor: c.primary + "12", borderColor: c.primary + "44" }]}>
          <Feather name="rotate-ccw" size={18} color={c.primary} />
          <Text style={[styles.undoText, { color: c.foreground }]} numberOfLines={1}>{redoAction.label} undone</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Redo last transaction review" disabled={saving} onPress={() => void redoLast()} hitSlop={8}><Text style={[styles.undoButton, { color: c.primary }]}>Redo</Text></Pressable>
        </View>
      ) : null}

      {!current && queue.length > 0 ? (
        <View style={[styles.emptyCard, { backgroundColor: c.card, borderColor: c.warning + "44" }]}>
          <Feather name="clock" size={30} color={c.warning} />
          <Text style={[styles.emptyTitle, { color: c.foreground }]}>Skipped for now</Text>
          <Text style={[styles.emptyText, { color: c.mutedForeground }]}>Nothing was changed.</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Review skipped transactions" onPress={() => setSkippedIds([])} style={[styles.primaryButton, styles.reviewSkippedButton, { backgroundColor: c.primary }]}>
            <Text style={[styles.primaryButtonText, { color: c.primaryForeground }]}>Review skipped items</Text>
          </Pressable>
        </View>
      ) : !current ? (
        <View style={[styles.emptyCard, { backgroundColor: c.card, borderColor: c.success + "44" }]}>
          <Feather name="check-circle" size={32} color={c.success} />
          <Text style={[styles.emptyTitle, { color: c.foreground }]}>You’re caught up</Text>
          <Text style={[styles.emptyText, { color: c.mutedForeground }]}>New posted activity will appear here.</Text>
        </View>
      ) : (
        <View style={[styles.reviewCard, { backgroundColor: c.card, borderColor: c.border }]}>
          <View style={styles.progressRow}>
            <Text style={[styles.progressText, { color: c.primary }]}>{position} of {total}</Text>
            <Text style={[styles.progressText, { color: c.mutedForeground }]}>{queue.length} left{skippedIds.length ? ` · ${skippedIds.length} skipped` : ""}</Text>
          </View>
          <View style={[styles.progressTrack, { backgroundColor: c.muted }]}><View style={[styles.progressFill, { backgroundColor: c.primary, width: `${total ? Math.max(5, ((completedThisVisit + skippedIds.length) / total) * 100) : 100}%` }]} /></View>

          <View style={styles.transactionRow}>
            <View style={[styles.transactionIcon, { backgroundColor: current.amount < 0 ? c.destructive + "16" : c.success + "16" }]}>
              <Feather name={current.amount < 0 ? "arrow-up-right" : "arrow-down-left"} size={20} color={current.amount < 0 ? c.destructive : c.success} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.transactionName, { color: c.foreground }]} numberOfLines={2}>{transactionName(current)}</Text>
              <Text style={[styles.transactionMeta, { color: c.mutedForeground }]}>{displayDate(current.date)} · Posted</Text>
            </View>
            <Text style={[styles.transactionAmount, { color: current.amount < 0 ? c.destructive : c.success }]}>{current.amount < 0 ? "−" : "+"}{money(current.amount)}</Text>
          </View>

          {current.amount > 0 ? <>
            <Text style={[styles.sectionTitle, { color: c.foreground }]}>Expected income</Text>
            <Text style={[styles.sectionCopy, { color: c.mutedForeground }]}>{groupedTargets.income.length ? "Choose the income this deposit belongs to." : "No expected income was found for this month."}</Text>
            {groupedTargets.income.map(renderTarget)}
          </> : <>
            <Text style={[styles.sectionTitle, { color: c.foreground }]}>Money you set aside</Text>
            <Text style={[styles.sectionCopy, { color: c.mutedForeground }]}>{groupedTargets.setAside.length ? "Use the bucket you planned for this purchase. The bank charge replaces that planned amount, so it is counted once." : "No spending bucket was found for this month. Create one from + → Set Aside Money before the purchase posts."}</Text>
            {groupedTargets.setAside.map(renderTarget)}
            <Pressable accessibilityRole="button" accessibilityLabel="Create a spending bucket for this transaction" disabled={saving} onPress={() => setSpendingBucketVisible(true)} style={({ pressed }) => [styles.bucketButton, { borderColor: c.primary + "66", backgroundColor: c.primary + "10", opacity: saving ? 0.55 : pressed ? 0.76 : 1 }]}>
              <Feather name="plus-circle" size={18} color={c.primary} />
              <View style={styles.optionCopy}>
                <Text style={[styles.optionTitle, { color: c.foreground }]}>Create a spending bucket</Text>
                <Text style={[styles.optionDescription, { color: c.mutedForeground }]}>Set aside money for several purchases.</Text>
              </View>
              <Feather name="chevron-right" size={17} color={c.primary} />
            </Pressable>

            {groupedTargets.bills.length ? <>
              <Text style={[styles.subsectionTitle, { color: c.foreground }]}>Bills and debt</Text>
              <Text style={[styles.sectionCopy, { color: c.mutedForeground }]}>Choose the bill or debt this paid.</Text>
              {groupedTargets.bills.map(renderTarget)}
            </> : null}
          </>}

          <View style={[styles.divider, { borderTopColor: c.border }]} />
          <Text style={[styles.sectionTitle, { color: c.foreground }]}>Other options</Text>
          <Text style={[styles.sectionCopy, { color: c.mutedForeground }]}>Finish it another way or skip it.</Text>
          {current.amount < 0 ? <>
            <Pressable accessibilityRole="button" accessibilityLabel="Open forgotten expense options" disabled={saving} onPress={() => setUnplannedChargeVisible(true)} style={({ pressed }) => [styles.optionButton, { borderColor: c.border, backgroundColor: "transparent", opacity: saving ? 0.55 : pressed ? 0.75 : 1 }]}>
              <Feather name="shopping-bag" size={17} color={c.primary} />
              <View style={styles.optionCopy}>
                <Text style={[styles.optionTitle, { color: c.foreground }]}>Forgotten or one-time expense</Text>
                <Text style={[styles.optionDescription, { color: c.mutedForeground }]}>Categorize it or create a bill.</Text>
              </View>
              <Feather name="chevron-right" size={17} color={c.mutedForeground} />
            </Pressable>
          </> : (
            <Pressable accessibilityRole="button" accessibilityLabel="Save as unplanned income" disabled={saving} onPress={() => void finish({ transactionId: current.id, resolution: "category", targetId: "Income" }, `${transactionName(current)} saved as unplanned income`)} style={({ pressed }) => [styles.optionButton, { borderColor: c.border, opacity: saving ? 0.55 : pressed ? 0.75 : 1 }]}>
              <Feather name="plus-circle" size={17} color={c.success} />
              <View style={styles.optionCopy}>
                <Text style={[styles.optionTitle, { color: c.foreground }]}>Unplanned income</Text>
                <Text style={[styles.optionDescription, { color: c.mutedForeground }]}>Record it without a planned match.</Text>
              </View>
              <Feather name="chevron-right" size={17} color={c.mutedForeground} />
            </Pressable>
          )}
          <Pressable accessibilityRole="button" accessibilityLabel="Mark as a transfer between tracked accounts" disabled={saving} onPress={() => void finish({ transactionId: current.id, resolution: "transfer" }, `${transactionName(current)} marked as transfer`)} style={({ pressed }) => [styles.optionButton, { borderColor: c.border, marginTop: 10, opacity: saving ? 0.55 : pressed ? 0.75 : 1 }]}>
            <Feather name="repeat" size={17} color={c.primary} />
            <View style={styles.optionCopy}>
              <Text style={[styles.optionTitle, { color: c.foreground }]}>Transfer between my accounts</Text>
              <Text style={[styles.optionDescription, { color: c.mutedForeground }]}>Not counted as income or spending.</Text>
            </View>
            <Feather name="chevron-right" size={17} color={c.mutedForeground} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Skip this transaction for now" disabled={saving} onPress={skipCurrent} style={({ pressed }) => [styles.skipButton, { opacity: saving ? 0.55 : pressed ? 0.7 : 1 }]}>
            <Feather name="clock" size={16} color={c.mutedForeground} /><Text style={[styles.skipText, { color: c.mutedForeground }]}>Skip for now</Text>
          </Pressable>
        </View>
      )}

      <UnplannedChargeModal
        visible={unplannedChargeVisible && !!current}
        transaction={current}
        categories={categories}
        saving={saving}
        onClose={() => setUnplannedChargeVisible(false)}
        onSaveOneTime={category => {
          if (!current) return;
          void finish({ transactionId: current.id, resolution: "category", targetId: category }, `${transactionName(current)} saved as a one-time charge`);
        }}
        onCreateBill={() => {
          setUnplannedChargeVisible(false);
          setForgottenBillVisible(true);
        }}
      />

      <AddBillModal
        visible={forgottenBillVisible && !!current}
        onClose={() => setForgottenBillVisible(false)}
        onSave={saveForgottenBill}
        initialValues={forgottenBillDefaults}
        title="Add forgotten bill"
        saveLabel="Save bill and match payment"
      />

      <GoalModal
        visible={(spendingBucketVisible && !!current) || Boolean(editingBucket)}
        onClose={() => { setSpendingBucketVisible(false); setEditingBucket(null); }}
        onSave={async data => {
          if ("id" in data) await updateGoal(data as Goal);
          else await addGoal(data as Omit<Goal, "id" | "created_at">);
          setSpendingBucketVisible(false);
          setEditingBucket(null);
        }}
        onDelete={deleteGoal}
        editGoal={editingBucket}
        initialMode="budget"
        initialName={current ? `${transactionName(current)} spending` : ""}
        initialTargetAmount={current ? Math.abs(current.amount) : undefined}
        initialTargetDate={current?.date}
      />

      <BillSurplusModal
        visible={Boolean(surplusPrompt)}
        billName={surplusPrompt?.target.name ?? "this bill"}
        itemType={surplusPrompt?.target.isDebt ? "debt" : "bill"}
        budgeted={surplusPrompt?.target.plannedAmount ?? 0}
        actual={Math.abs(surplusPrompt?.transaction.amount ?? 0)}
        targetDebt={surplusSnowballOffer?.targetDebt}
        snowballSafe={Boolean(surplusSnowballOffer?.safe)}
        snowballEnabled={settings.debtPayoffEnabled}
        safetyFloor={settings.safety_floor}
        forecastHorizonMonths={settings.forecast_horizon_months}
        paymentDate={surplusPaymentDate}
        paymentDateValid={Boolean(surplusSnowballOffer?.dateValid)}
        paymentDateMin={`${surplusYear}-${surplusMonthText}-01`}
        paymentDateMax={`${surplusYear}-${surplusMonthText}-${surplusMonthLastDay}`}
        saving={saving}
        onPaymentDateChange={setSurplusPaymentDate}
        onKeep={keepSurplusAvailable}
        onSnowball={() => void routeSurplusToPayoff()}
        onClose={keepSurplusAvailable}
      />

      <Modal visible={!!variance} transparent animationType="fade" onRequestClose={() => { setVariance(null); setSplitCategory(null); }}>
        <Pressable style={styles.overlay} onPress={() => { setVariance(null); setSplitCategory(null); }}>
          <Pressable style={[styles.modalCard, { backgroundColor: c.card, borderColor: c.border }]} onPress={() => {}}>
            {variance ? <>
              <View style={styles.floModalLogo}><FloLogo size={74} /></View>
              <Text style={[styles.modalEyebrow, { color: c.primary }]}>FLO CAN HELP</Text>
              <Text style={[styles.modalTitle, { color: c.foreground }]}>
                {variance.direction === "lower"
                  ? variance.target.type === "goal" || variance.target.type === "decision"
                    ? `How should this purchase use ${variance.target.name}?`
                    : `Was ${money(variance.transaction.amount)} the full ${variance.target.type === "income" ? "deposit" : "payment"} for ${variance.target.name}?`
                  : `${variance.target.name} was ${money(Math.abs(variance.transaction.amount) - variance.target.plannedAmount)} over plan`}
              </Text>
              {variance.direction === "lower" && (variance.target.type === "goal" || variance.target.type === "decision") ? (
                <Text style={[styles.modalDescription, { color: c.mutedForeground }]}>Keep the rest set aside or close the bucket.</Text>
              ) : null}
              <View style={[styles.amountBox, { backgroundColor: c.muted }]}>
                <View style={styles.amountLine}><Text style={[styles.amountLabel, { color: c.mutedForeground }]}>{variance.target.type === "goal" || variance.target.type === "decision" ? "Bucket remaining" : "Plan amount"}</Text><Text style={[styles.amountValue, { color: c.foreground }]}>{money(variance.target.plannedAmount)}</Text></View>
                <View style={styles.amountLine}><Text style={[styles.amountLabel, { color: c.mutedForeground }]}>{variance.target.type === "goal" || variance.target.type === "decision" ? "This purchase" : "Bank amount"}</Text><Text style={[styles.amountValue, { color: c.foreground }]}>{money(variance.transaction.amount)}</Text></View>
                <View style={styles.amountLine}><Text style={[styles.amountLabel, { color: variance.direction === "higher" ? c.destructive : c.success }]}>{variance.direction === "higher" ? "Over plan" : variance.target.type === "goal" || variance.target.type === "decision" ? "Left in bucket" : "Money left"}</Text><Text style={[styles.amountValue, { color: variance.direction === "higher" ? c.destructive : c.success }]}>{money(Math.abs(Math.abs(variance.transaction.amount) - variance.target.plannedAmount))}</Text></View>
              </View>

              {variance.direction === "lower" ? variance.target.type === "goal" || variance.target.type === "decision" ? <>
                <Pressable disabled={saving} onPress={() => void resolveTarget(variance.target, "partial")} style={[styles.primaryButton, { backgroundColor: c.primary }]}><Text style={[styles.primaryButtonText, { color: c.primaryForeground }]}>Add {money(variance.transaction.amount)} to bucket</Text></Pressable>
                <Pressable disabled={saving} onPress={() => void resolveTarget(variance.target, "full")} style={[styles.secondaryButton, { borderColor: c.border }]}><Text style={[styles.secondaryButtonText, { color: c.foreground }]}>Close bucket · release {money(variance.target.plannedAmount - Math.abs(variance.transaction.amount))}</Text></Pressable>
              </> : <>
                <Pressable disabled={saving} onPress={() => variance.target.type === "bill" ? void confirmLowerFullPayment() : void resolveTarget(variance.target, "full")} style={[styles.primaryButton, { backgroundColor: c.primary }]}><Text style={[styles.primaryButtonText, { color: c.primaryForeground }]}>Yes, this was the full amount</Text></Pressable>
                <Pressable disabled={saving} onPress={() => void resolveTarget(variance.target, "partial")} style={[styles.secondaryButton, { borderColor: c.border }]}><Text style={[styles.secondaryButtonText, { color: c.foreground }]}>No, keep the rest open</Text></Pressable>
              </> : splitCategory ? <>
                <Text style={[styles.splitPrompt, { color: c.foreground }]}>Categorize the extra {money(Math.abs(variance.transaction.amount) - variance.target.plannedAmount)}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryRow}>
                  {categories.filter(category => category !== "Income").slice(0, 12).map(category => (
                    <Pressable key={category} onPress={() => setSplitCategory(category)} style={[styles.categoryPill, { backgroundColor: splitCategory === category ? c.primary + "20" : c.muted, borderColor: splitCategory === category ? c.primary : c.border }]}><Text style={[styles.categoryText, { color: splitCategory === category ? c.primary : c.foreground }]}>{category}</Text></Pressable>
                  ))}
                </ScrollView>
                <Pressable disabled={!splitCategory || saving} onPress={() => void resolveTarget(variance.target, "split", splitCategory)} style={[styles.primaryButton, { backgroundColor: c.primary, opacity: splitCategory && !saving ? 1 : 0.45 }]}><Text style={[styles.primaryButtonText, { color: c.primaryForeground }]}>Confirm split and mark paid</Text></Pressable>
              </> : <>
                <Pressable disabled={saving} onPress={() => void resolveTarget(variance.target, "full")} style={[styles.primaryButton, { backgroundColor: c.primary }]}><Text style={[styles.primaryButtonText, { color: c.primaryForeground }]}>Mark paid and use available money</Text></Pressable>
                {variance.target.type !== "income" ? <Pressable disabled={saving} onPress={() => setSplitCategory(categories.find(category => category !== "Income") ?? "Other")} style={[styles.secondaryButton, { borderColor: c.border }]}><Text style={[styles.secondaryButtonText, { color: c.foreground }]}>Split the extra into a category</Text></Pressable> : null}
                {variance.target.isDebt ? <Pressable disabled={saving} onPress={() => void resolveTarget(variance.target, "extra_principal")} style={[styles.secondaryButton, { borderColor: c.warning + "66" }]}><Text style={[styles.secondaryButtonText, { color: c.warning }]}>Apply extra to principal</Text></Pressable> : null}
              </>}
              <Pressable disabled={saving} onPress={() => {
                if (variance.direction === "lower" && (variance.target.type === "goal" || variance.target.type === "decision")) skipCurrent();
                else { setVariance(null); setSplitCategory(null); }
              }} style={styles.cancelButton}><Text style={[styles.cancelText, { color: c.mutedForeground }]}>{variance.direction === "lower" && (variance.target.type === "goal" || variance.target.type === "decision") ? "Skip this transaction for now" : "Not this item"}</Text></Pressable>
            </> : null}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  hero: { borderWidth: 1, borderRadius: 20, padding: 16, flexDirection: "row", gap: 12, alignItems: "flex-start" },
  heroIcon: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  eyebrow: { fontSize: 11, fontFamily: "Inter_800ExtraBold", letterSpacing: 1 },
  heroTitle: { fontSize: 20, fontFamily: "Inter_800ExtraBold", marginTop: 3 },
  heroCopy: { fontSize: 14, lineHeight: 21, fontFamily: "Inter_400Regular", marginTop: 5 },
  bucketManager: { marginTop: 12, borderWidth: 1, borderRadius: 20, padding: 14 },
  bucketManagerHeader: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  bucketManagerTitle: { marginTop: 0 },
  bucketManagerCopy: { marginBottom: 0 },
  bucketMessage: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, marginTop: 10, fontSize: 12, fontFamily: "Inter_700Bold" },
  bucketRow: { paddingVertical: 12, gap: 10 },
  bucketNameRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  closedBadge: { fontSize: 10, fontFamily: "Inter_800ExtraBold", letterSpacing: 0.6, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 3 },
  bucketActions: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  bucketActionButton: { minHeight: 36, borderWidth: 1, borderRadius: 12, paddingHorizontal: 11, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  bucketActionText: { fontSize: 12, fontFamily: "Inter_800ExtraBold" },
  archivedSection: { borderTopWidth: 1, marginTop: 4, paddingTop: 6 },
  archivedToggle: { minHeight: 42, flexDirection: "row", alignItems: "center", gap: 8 },
  archivedToggleText: { flex: 1, fontSize: 12, fontFamily: "Inter_700Bold" },
  archivedRow: { minHeight: 58, borderTopWidth: 1, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 10 },
  undoCard: { marginTop: 10, borderWidth: 1, borderRadius: 14, padding: 12, flexDirection: "row", alignItems: "center", gap: 9 },
  undoText: { flex: 1, fontSize: 14, fontFamily: "Inter_600SemiBold" }, undoButton: { fontSize: 14, fontFamily: "Inter_800ExtraBold" },
  emptyCard: { marginTop: 12, borderWidth: 1, borderRadius: 20, padding: 24, alignItems: "center", gap: 8 },
  emptyTitle: { fontSize: 19, fontFamily: "Inter_800ExtraBold", textAlign: "center" },
  emptyText: { fontSize: 14, lineHeight: 21, fontFamily: "Inter_400Regular", textAlign: "center" },
  reviewCard: { marginTop: 12, borderWidth: 1, borderRadius: 20, padding: 16 },
  progressRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  progressText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  progressTrack: { height: 5, borderRadius: 3, overflow: "hidden", marginTop: 7 }, progressFill: { height: 5, borderRadius: 3 },
  transactionRow: { flexDirection: "row", alignItems: "center", gap: 11, paddingVertical: 18 },
  transactionIcon: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  transactionName: { fontSize: 17, fontFamily: "Inter_800ExtraBold" }, transactionMeta: { fontSize: 12, fontFamily: "Inter_500Medium", marginTop: 4 },
  transactionAmount: { fontSize: 17, fontFamily: "Inter_800ExtraBold" },
  sectionTitle: { fontSize: 16, fontFamily: "Inter_800ExtraBold", marginTop: 4 },
  subsectionTitle: { fontSize: 15, fontFamily: "Inter_800ExtraBold", marginTop: 14 },
  sectionCopy: { fontSize: 13, lineHeight: 19, fontFamily: "Inter_400Regular", marginTop: 4, marginBottom: 10 },
  targetRow: { borderWidth: 1, borderRadius: 14, padding: 11, flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
  targetIcon: { width: 36, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  targetHeading: { flexDirection: "row", alignItems: "center", gap: 7 }, targetName: { flex: 1, fontSize: 14, lineHeight: 19, fontFamily: "Inter_700Bold" },
  suggested: { fontSize: 11, fontFamily: "Inter_800ExtraBold", letterSpacing: 0.7 },
  targetMeta: { fontSize: 12, lineHeight: 17, fontFamily: "Inter_500Medium", marginTop: 3 }, targetReason: { fontSize: 12, lineHeight: 17, fontFamily: "Inter_700Bold", marginTop: 3 },
  divider: { borderTopWidth: 1, marginVertical: 12 }, categoryRow: { gap: 8, paddingVertical: 4 },
  optionButton: { minHeight: 58, borderWidth: 1, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 9, flexDirection: "row", alignItems: "center", gap: 10 },
  bucketButton: { minHeight: 64, borderWidth: 1, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
  optionCopy: { flex: 1 }, optionTitle: { fontSize: 14, fontFamily: "Inter_800ExtraBold" }, optionDescription: { fontSize: 12, lineHeight: 18, fontFamily: "Inter_400Regular", marginTop: 2 },
  categoryPill: { minHeight: 36, paddingHorizontal: 12, borderRadius: 18, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  categoryText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  skipButton: { minHeight: 42, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, marginTop: 4 },
  skipText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.72)", alignItems: "center", justifyContent: "center", padding: 20 },
  modalCard: { width: "100%", maxWidth: 500, maxHeight: "88%", borderWidth: 1, borderRadius: 24, padding: 20, alignItems: "stretch" },
  floModalLogo: { alignItems: "center" },
  modalEyebrow: { fontSize: 11, fontFamily: "Inter_800ExtraBold", letterSpacing: 1, textAlign: "center", marginTop: 9 },
  modalTitle: { fontSize: 22, lineHeight: 29, fontFamily: "Inter_700Bold", textAlign: "center", marginTop: 8 },
  modalDescription: { fontSize: 13, lineHeight: 19, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 8 },
  amountBox: { borderRadius: 16, padding: 14, marginTop: 16, marginBottom: 12, gap: 9 },
  amountLine: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, amountLabel: { fontSize: 13, fontFamily: "Inter_500Medium" }, amountValue: { fontSize: 14, fontFamily: "Inter_800ExtraBold" },
  primaryButton: { minHeight: 52, borderRadius: 15, alignItems: "center", justifyContent: "center", paddingHorizontal: 14, marginTop: 8 },
  reviewSkippedButton: { width: "100%", marginTop: 8 },
  primaryButtonText: { fontSize: 13, fontFamily: "Inter_800ExtraBold", textAlign: "center" },
  secondaryButton: { minHeight: 48, borderRadius: 15, borderWidth: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 14, marginTop: 8 },
  secondaryButtonText: { fontSize: 13, fontFamily: "Inter_700Bold", textAlign: "center" },
  splitPrompt: { fontSize: 13, fontFamily: "Inter_700Bold", marginTop: 6, marginBottom: 5 },
  cancelButton: { minHeight: 42, alignItems: "center", justifyContent: "center", marginTop: 4 }, cancelText: { fontSize: 12, fontFamily: "Inter_700Bold" },
});
