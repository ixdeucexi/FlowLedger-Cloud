import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { AddBillModal, type AddBillInitialValues } from "@/components/AddBillModal";
import { UnplannedChargeModal } from "@/components/UnplannedChargeModal";
import type { Bill, ReconcileTransactionInput, Transaction } from "@/context/BudgetContext";
import { useBudget } from "@/context/BudgetContext";
import { useColors } from "@/hooks/useColors";
import { buildCurrentMonthReviewQueue, buildForgottenBillDefaults, forgottenBillSettlement, matchedOccurrenceAllocations, occurrenceKey, rankReviewTargets, reviewQueueAfterSkips, type RankedReviewTarget, type ReviewTarget } from "@/lib/reviewCenter";

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

export function ReviewCenter() {
  const c = useColors();
  const {
    transactions, goals, decisions, categories, canEditHousehold,
    getMonthlyBills, getBillOccurrencesInMonth, getBillMonthlyTotal, getIncomeOccurrencesInMonth,
    addBill, deleteBillMistake, reconcileTransaction, undoTransactionReconciliation, refreshBankData,
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
  const [skippedIds, setSkippedIds] = useState<string[]>([]);
  const [lastCompleted, setLastCompleted] = useState<{ id: string; label: string } | null>(null);
  const [completedThisVisit, setCompletedThisVisit] = useState(0);
  const availableQueue = useMemo(() => reviewQueueAfterSkips(queue, skippedIds), [queue, skippedIds]);
  const current = availableQueue[0] ?? null;
  const forgottenBillDefaults = useMemo<AddBillInitialValues | undefined>(() => {
    if (!current) return undefined;
    const defaults = buildForgottenBillDefaults(current);
    return { ...defaults, category: categories.includes(defaults.category) ? defaults.category : "Other" };
  }, [categories, current]);
  const initialTotal = useRef(0);
  if (queue.length + completedThisVisit > initialTotal.current) initialTotal.current = queue.length + completedThisVisit;

  const targets = useMemo(() => {
    if (!current) return [];
    const [year, monthNumber] = current.date.split("-").map(Number);
    const month = monthNumber - 1;
    const candidates: ReviewTarget[] = [];
    const billMatches = matchedOccurrenceAllocations(transactions, "bill");
    const incomeMatches = matchedOccurrenceAllocations(transactions, "income");
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
      goals.filter(goal => goal.goal_type === "planned_expense" && goal.target_date?.startsWith(`${year}-${String(month + 1).padStart(2, "0")}`))
        .filter(goal => goal.current_amount + 0.005 < goal.target_amount)
        .forEach(goal => candidates.push({
          type: "goal", id: goal.id, name: goal.name, category: "Planned spending",
          plannedAmount: Math.max(0, goal.target_amount - goal.current_amount), occurrenceDate: goal.target_date.slice(0, 10),
        }));
      decisions.filter(decision => decision.status === "planned" || decision.status === "calendar")
        .forEach(decision => {
          const occurrenceDate = decision.calendar_date || (typeof decision.scenario?.date === "string" ? decision.scenario.date : "");
          const plannedAmount = Math.abs(Number(decision.scenario?.amount) || 0);
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
    return rankReviewTargets(current, candidates).slice(0, 8);
  }, [current, decisions, getBillMonthlyTotal, getBillOccurrencesInMonth, getIncomeOccurrencesInMonth, getMonthlyBills, goals, transactions]);

  const completeReview = async (input: ReconcileTransactionInput, notice?: string) => {
    if (!current || saving) throw new Error("This transaction is no longer available for review.");
    const reviewed = current;
    setSaving(true);
    try {
      await reconcileTransaction(input);
      setLastCompleted({ id: reviewed.id, label: notice || transactionName(reviewed) });
      setCompletedThisVisit(value => value + 1);
      setVariance(null);
      setSplitCategory(null);
      setUnplannedChargeVisible(false);
      setForgottenBillVisible(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } finally {
      setSaving(false);
    }
  };

  const finish = async (input: ReconcileTransactionInput, notice?: string) => {
    try {
      await completeReview(input, notice);
    } catch (error) {
      Alert.alert("Couldn’t finish this review", error instanceof Error ? error.message : "Please try again.");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
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
    const label = target.type === "income" ? `${target.name} received` : `${target.name} paid`;
    await finish({
      transactionId: current.id,
      resolution: target.type,
      targetId: target.id,
      occurrenceDate: target.occurrenceDate,
      plannedAmount: target.plannedAmount,
      settlement,
      extraCategory,
    }, difference > 0.005 ? `${label} · ${money(difference)} ${actual > target.plannedAmount ? "over" : "left"}` : label);
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

  const undoLast = async () => {
    if (!lastCompleted || saving) return;
    setSaving(true);
    try {
      await undoTransactionReconciliation(lastCompleted.id);
      setLastCompleted(null);
      setCompletedThisVisit(value => Math.max(0, value - 1));
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (error) {
      Alert.alert("Couldn’t undo review", error instanceof Error ? error.message : "Please try again.");
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

  return (
    <>
      <View style={[styles.hero, { backgroundColor: c.card, borderColor: c.primary + "44" }]}>
        <View style={[styles.heroIcon, { backgroundColor: c.primary + "18" }]}><Feather name="check-square" size={22} color={c.primary} /></View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.eyebrow, { color: c.primary }]}>PRO REVIEW CENTER</Text>
          <Text style={[styles.heroTitle, { color: c.foreground }]}>Match the bank to your plan</Text>
          <Text style={[styles.heroCopy, { color: c.mutedForeground }]}>Confirm each posted transaction once. FlowLedger updates the calendar and moves to the next item.</Text>
        </View>
      </View>

      {lastCompleted ? (
        <View style={[styles.undoCard, { backgroundColor: c.success + "12", borderColor: c.success + "44" }]}>
          <Feather name="check-circle" size={18} color={c.success} />
          <Text style={[styles.undoText, { color: c.foreground }]} numberOfLines={1}>{lastCompleted.label}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Undo last transaction review" disabled={saving} onPress={() => void undoLast()} hitSlop={8}><Text style={[styles.undoButton, { color: c.primary }]}>Undo</Text></Pressable>
        </View>
      ) : null}

      {!current && queue.length > 0 ? (
        <View style={[styles.emptyCard, { backgroundColor: c.card, borderColor: c.warning + "44" }]}>
          <Feather name="clock" size={30} color={c.warning} />
          <Text style={[styles.emptyTitle, { color: c.foreground }]}>Skipped for now</Text>
          <Text style={[styles.emptyText, { color: c.mutedForeground }]}>These transactions are still waiting. Nothing was marked reviewed or changed.</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Review skipped transactions" onPress={() => setSkippedIds([])} style={[styles.primaryButton, styles.reviewSkippedButton, { backgroundColor: c.primary }]}>
            <Text style={[styles.primaryButtonText, { color: c.primaryForeground }]}>Review skipped items</Text>
          </Pressable>
        </View>
      ) : !current ? (
        <View style={[styles.emptyCard, { backgroundColor: c.card, borderColor: c.success + "44" }]}>
          <Feather name="check-circle" size={32} color={c.success} />
          <Text style={[styles.emptyTitle, { color: c.foreground }]}>You’re caught up</Text>
          <Text style={[styles.emptyText, { color: c.mutedForeground }]}>New posted bank activity will appear here. Pending items stay out until the bank posts them.</Text>
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

          <Text style={[styles.sectionTitle, { color: c.foreground }]}>{current.amount < 0 ? "Choose the planned item" : "Choose the expected income"}</Text>
          <Text style={[styles.sectionCopy, { color: c.mutedForeground }]}>{targets.length ? "Matches compare the bank amount with your plan amount, date, and name." : "No planned item was found for this month. Categorize it below to finish."}</Text>
          {targets.map((target, index) => (
            <Pressable accessibilityRole="button" accessibilityLabel={`Match ${transactionName(current)} to ${target.name}`} key={`${target.type}-${target.id}-${target.occurrenceDate}`} disabled={saving} onPress={() => chooseTarget(target)} style={({ pressed }) => [styles.targetRow, { backgroundColor: c.muted, borderColor: index === 0 && target.score >= 48 ? c.success + "66" : c.border, opacity: saving ? 0.55 : pressed ? 0.8 : 1 }]}>
              <View style={[styles.targetIcon, { backgroundColor: (target.type === "income" ? c.success : target.isDebt ? c.warning : c.primary) + "18" }]}>
                <Feather name={target.type === "income" ? "trending-up" : target.type === "bill" ? "file-text" : "calendar"} size={17} color={target.type === "income" ? c.success : target.isDebt ? c.warning : c.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <View style={styles.targetHeading}><Text style={[styles.targetName, { color: c.foreground }]} numberOfLines={1}>{target.name}</Text>{index === 0 && target.score >= 48 ? <Text style={[styles.suggested, { color: c.success }]}>SUGGESTED</Text> : null}</View>
                <Text style={[styles.targetMeta, { color: c.mutedForeground }]}>{target.type === "income" ? "Expected" : "Plan"}: {money(target.plannedAmount)} · {target.type === "income" ? "Expected" : "Due"} {displayDate(target.occurrenceDate)}</Text>
                {target.reasons.length ? <Text style={[styles.targetReason, { color: c.success }]}>{target.reasons.slice(0, 2).join(" · ")}</Text> : null}
              </View>
              <Feather name="chevron-right" size={18} color={c.mutedForeground} />
            </Pressable>
          ))}

          <View style={[styles.divider, { borderTopColor: c.border }]} />
          <Text style={[styles.sectionTitle, { color: c.foreground }]}>Other options</Text>
          <Text style={[styles.sectionCopy, { color: c.mutedForeground }]}>Handle activity that was not part of the plan, or come back to it later.</Text>
          {current.amount < 0 ? <>
            <Pressable accessibilityRole="button" accessibilityLabel="Open forgotten expense options" disabled={saving} onPress={() => setUnplannedChargeVisible(true)} style={({ pressed }) => [styles.optionButton, { borderColor: c.border, backgroundColor: "transparent", opacity: saving ? 0.55 : pressed ? 0.75 : 1 }]}>
              <Feather name="shopping-bag" size={17} color={c.primary} />
              <View style={styles.optionCopy}>
                <Text style={[styles.optionTitle, { color: c.foreground }]}>Forgotten or one-time expense</Text>
                <Text style={[styles.optionDescription, { color: c.mutedForeground }]}>Handle an emergency swipe, one-time charge, or forgotten subscription.</Text>
              </View>
              <Feather name="chevron-right" size={17} color={c.mutedForeground} />
            </Pressable>
          </> : (
            <Pressable accessibilityRole="button" accessibilityLabel="Save as unplanned income" disabled={saving} onPress={() => void finish({ transactionId: current.id, resolution: "category", targetId: "Income" }, `${transactionName(current)} saved as unplanned income`)} style={({ pressed }) => [styles.optionButton, { borderColor: c.border, opacity: saving ? 0.55 : pressed ? 0.75 : 1 }]}>
              <Feather name="plus-circle" size={17} color={c.success} />
              <View style={styles.optionCopy}>
                <Text style={[styles.optionTitle, { color: c.foreground }]}>Unplanned income</Text>
                <Text style={[styles.optionDescription, { color: c.mutedForeground }]}>Keep this deposit without matching expected income.</Text>
              </View>
              <Feather name="chevron-right" size={17} color={c.mutedForeground} />
            </Pressable>
          )}
          <Pressable accessibilityRole="button" accessibilityLabel="Mark as a transfer between tracked accounts" disabled={saving} onPress={() => void finish({ transactionId: current.id, resolution: "transfer" }, `${transactionName(current)} marked as transfer`)} style={({ pressed }) => [styles.optionButton, { borderColor: c.border, marginTop: 10, opacity: saving ? 0.55 : pressed ? 0.75 : 1 }]}>
            <Feather name="repeat" size={17} color={c.primary} />
            <View style={styles.optionCopy}>
              <Text style={[styles.optionTitle, { color: c.foreground }]}>Transfer between my accounts</Text>
              <Text style={[styles.optionDescription, { color: c.mutedForeground }]}>Only use this when money moved between accounts you track. Transfers are excluded from cash flow.</Text>
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

      <Modal visible={!!variance} transparent animationType="fade" onRequestClose={() => { setVariance(null); setSplitCategory(null); }}>
        <Pressable style={styles.overlay} onPress={() => { setVariance(null); setSplitCategory(null); }}>
          <Pressable style={[styles.modalCard, { backgroundColor: c.card, borderColor: c.border }]} onPress={() => {}}>
            {variance ? <>
              <View style={[styles.modalIcon, { backgroundColor: c.primary + "18" }]}><Feather name="message-circle" size={24} color={c.primary} /></View>
              <Text style={[styles.modalEyebrow, { color: c.primary }]}>FLO CAN HELP</Text>
              <Text style={[styles.modalTitle, { color: c.foreground }]}>
                {variance.direction === "lower"
                  ? `Was ${money(variance.transaction.amount)} the full ${variance.target.type === "income" ? "deposit" : "payment"} for ${variance.target.name}?`
                  : `${variance.target.name} was ${money(Math.abs(variance.transaction.amount) - variance.target.plannedAmount)} over plan`}
              </Text>
              <View style={[styles.amountBox, { backgroundColor: c.muted }]}>
                <View style={styles.amountLine}><Text style={[styles.amountLabel, { color: c.mutedForeground }]}>Plan amount</Text><Text style={[styles.amountValue, { color: c.foreground }]}>{money(variance.target.plannedAmount)}</Text></View>
                <View style={styles.amountLine}><Text style={[styles.amountLabel, { color: c.mutedForeground }]}>Bank amount</Text><Text style={[styles.amountValue, { color: c.foreground }]}>{money(variance.transaction.amount)}</Text></View>
                <View style={styles.amountLine}><Text style={[styles.amountLabel, { color: variance.direction === "higher" ? c.destructive : c.success }]}>{variance.direction === "higher" ? "Over plan" : "Money left"}</Text><Text style={[styles.amountValue, { color: variance.direction === "higher" ? c.destructive : c.success }]}>{money(Math.abs(Math.abs(variance.transaction.amount) - variance.target.plannedAmount))}</Text></View>
              </View>

              {variance.direction === "lower" ? <>
                <Pressable disabled={saving} onPress={() => void resolveTarget(variance.target, "full")} style={[styles.primaryButton, { backgroundColor: c.primary }]}><Text style={[styles.primaryButtonText, { color: c.primaryForeground }]}>Yes, this was the full amount</Text></Pressable>
                <Pressable disabled={saving} onPress={() => void resolveTarget(variance.target, "partial")} style={[styles.secondaryButton, { borderColor: c.border }]}><Text style={[styles.secondaryButtonText, { color: c.foreground }]}>No, keep it partial</Text></Pressable>
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
              <Pressable disabled={saving} onPress={() => { setVariance(null); setSplitCategory(null); }} style={styles.cancelButton}><Text style={[styles.cancelText, { color: c.mutedForeground }]}>Not this item</Text></Pressable>
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
  eyebrow: { fontSize: 10, fontFamily: "Inter_800ExtraBold", letterSpacing: 1 },
  heroTitle: { fontSize: 20, fontFamily: "Inter_800ExtraBold", marginTop: 3 },
  heroCopy: { fontSize: 12, lineHeight: 18, fontFamily: "Inter_400Regular", marginTop: 5 },
  undoCard: { marginTop: 10, borderWidth: 1, borderRadius: 14, padding: 12, flexDirection: "row", alignItems: "center", gap: 9 },
  undoText: { flex: 1, fontSize: 12, fontFamily: "Inter_600SemiBold" }, undoButton: { fontSize: 12, fontFamily: "Inter_800ExtraBold" },
  emptyCard: { marginTop: 12, borderWidth: 1, borderRadius: 20, padding: 24, alignItems: "center", gap: 8 },
  emptyTitle: { fontSize: 19, fontFamily: "Inter_800ExtraBold", textAlign: "center" },
  emptyText: { fontSize: 13, lineHeight: 19, fontFamily: "Inter_400Regular", textAlign: "center" },
  reviewCard: { marginTop: 12, borderWidth: 1, borderRadius: 20, padding: 16 },
  progressRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  progressText: { fontSize: 11, fontFamily: "Inter_700Bold" },
  progressTrack: { height: 5, borderRadius: 3, overflow: "hidden", marginTop: 7 }, progressFill: { height: 5, borderRadius: 3 },
  transactionRow: { flexDirection: "row", alignItems: "center", gap: 11, paddingVertical: 18 },
  transactionIcon: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  transactionName: { fontSize: 17, fontFamily: "Inter_800ExtraBold" }, transactionMeta: { fontSize: 11, fontFamily: "Inter_500Medium", marginTop: 4 },
  transactionAmount: { fontSize: 17, fontFamily: "Inter_800ExtraBold" },
  sectionTitle: { fontSize: 14, fontFamily: "Inter_800ExtraBold", marginTop: 4 },
  sectionCopy: { fontSize: 11, lineHeight: 16, fontFamily: "Inter_400Regular", marginTop: 3, marginBottom: 10 },
  targetRow: { borderWidth: 1, borderRadius: 14, padding: 11, flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
  targetIcon: { width: 36, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  targetHeading: { flexDirection: "row", alignItems: "center", gap: 7 }, targetName: { flex: 1, fontSize: 13, fontFamily: "Inter_700Bold" },
  suggested: { fontSize: 8, fontFamily: "Inter_800ExtraBold", letterSpacing: 0.7 },
  targetMeta: { fontSize: 10, fontFamily: "Inter_500Medium", marginTop: 3 }, targetReason: { fontSize: 9, fontFamily: "Inter_700Bold", marginTop: 3 },
  divider: { borderTopWidth: 1, marginVertical: 12 }, categoryRow: { gap: 8, paddingVertical: 4 },
  optionButton: { minHeight: 58, borderWidth: 1, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 9, flexDirection: "row", alignItems: "center", gap: 10 },
  optionCopy: { flex: 1 }, optionTitle: { fontSize: 12, fontFamily: "Inter_800ExtraBold" }, optionDescription: { fontSize: 10, lineHeight: 14, fontFamily: "Inter_400Regular", marginTop: 2 },
  categoryPill: { minHeight: 36, paddingHorizontal: 12, borderRadius: 18, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  categoryText: { fontSize: 11, fontFamily: "Inter_700Bold" },
  skipButton: { minHeight: 42, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, marginTop: 4 },
  skipText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.72)", alignItems: "center", justifyContent: "center", padding: 20 },
  modalCard: { width: "100%", maxWidth: 500, maxHeight: "88%", borderWidth: 1, borderRadius: 24, padding: 20, alignItems: "stretch" },
  modalIcon: { width: 50, height: 50, borderRadius: 25, alignItems: "center", justifyContent: "center", alignSelf: "center" },
  modalEyebrow: { fontSize: 10, fontFamily: "Inter_800ExtraBold", letterSpacing: 1, textAlign: "center", marginTop: 9 },
  modalTitle: { fontSize: 22, lineHeight: 29, fontFamily: "Inter_700Bold", textAlign: "center", marginTop: 8 },
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
