import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { useBudget } from "@/context/BudgetContext";
import { useBackDismiss } from "@/hooks/useBackDismiss";
import { useColors } from "@/hooks/useColors";
import { addDateOnlyDays, addDateOnlyMonths, localDateString } from "@/lib/dateLabels";
import { completeDecisionAtomically } from "@/lib/atomicFinancialMutations";
import { assertFinancialMutationOnline } from "@/lib/networkStatus";

function parsedMoney(value: string): number | null {
  const normalized = value.replace(/[$,\s]/g, "");
  if (!normalized) return null;
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount >= 0 && amount <= 1_000_000_000
    ? Math.round((amount + Number.EPSILON) * 100) / 100
    : null;
}

export function DecisionDueModal() {
  const c = useColors();
  const router = useRouter();
  const {
    decisions,
    goals,
    incomes,
    settings,
    accounts,
    demoMode,
    updateDecision,
    addTransaction,
    addBill,
    addIncome,
    updateIncome,
    updateGoal,
    previewDebtSnowball,
    applyDebtSnowballPayment,
    retryBudgetLoad,
  } = useBudget();
  const now = new Date();
  const today = localDateString(now);
  const [dismissedDueId, setDismissedDueId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mutationInFlightRef = useRef(false);
  const due = useMemo(
    () =>
      decisions.find(
        (decision) =>
          decision.id !== dismissedDueId &&
          (decision.status === "planned" || decision.status === "calendar") &&
          (decision.next_due_date ?? decision.scenario.date) <= today &&
          (!decision.remind_at || new Date(decision.remind_at) <= now),
      ),
    [decisions, dismissedDueId, today],
  );
  const [actual, setActual] = useState("");

  React.useEffect(() => {
    setActual(due ? String(Math.abs(due.scenario.amount)) : "");
  }, [due?.id]);

  const closeDue = () => {
    if (due && !busy) setDismissedDueId(due.id);
  };
  useBackDismiss(Boolean(due) && !busy, closeDue);
  if (!due) return null;

  const save = async (patch: Partial<typeof due>) => {
    if (mutationInFlightRef.current) return false;
    mutationInFlightRef.current = true;
    setBusy(true);
    try {
      await updateDecision({ ...due, ...patch });
      return true;
    } catch (error) {
      Alert.alert(
        "Couldn’t update plan",
        error instanceof Error ? error.message : "Please try again.",
      );
      return false;
    } finally {
      mutationInFlightRef.current = false;
      setBusy(false);
    }
  };

  const remind = () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    void save({ remind_at: tomorrow.toISOString() });
  };

  const postpone = () => {
    const date = addDateOnlyDays(due.scenario.date, 7);
    void save({
      scenario: { ...due.scenario, date },
      next_due_date: date,
      calendar_date: date,
      remind_at: undefined,
    });
  };

  const completeInDemo = async (amount: number) => {
    const scenario = due.scenario;
    let applied: Record<string, unknown> = {};
    if (scenario.type === "one_time_purchase") {
      applied = amount > 0
        ? {
            kind: "transaction",
            id: await addTransaction({ date: today, amount: -amount, category: "Other", note: scenario.name }),
          }
        : { kind: "no_spend" };
    } else if (scenario.type === "savings_contribution") {
      const goal = goals.find((item) => item.id === scenario.sourceId);
      if (!goal) throw new Error("Savings goal not found.");
      await updateGoal({
        ...goal,
        current_amount: Math.min(goal.target_amount, goal.current_amount + amount),
      });
      applied = {
        kind: "transaction",
        id: await addTransaction({ date: today, amount: -amount, category: "Savings", note: scenario.name }),
      };
    } else if (scenario.type === "recurring_bill") {
      const transactionId = await addTransaction({ date: today, amount: -amount, category: "Other", note: scenario.name });
      const nextDate = scenario.frequency === "weekly"
        ? addDateOnlyDays(today, 7)
        : scenario.frequency === "biweekly"
          ? addDateOnlyDays(today, 14)
          : addDateOnlyMonths(today, 1);
      const billId = await addBill({
        name: scenario.name,
        amount,
        category: "Other",
        priority: 1,
        is_debt: false,
        balance: 0,
        interest_rate: 0,
        due_day: Number(nextDate.slice(8, 10)),
        start_date: nextDate,
        next_payment_date: nextDate,
        is_recurring: true,
        frequency: scenario.frequency === "weekly" ? "weekly" : scenario.frequency === "biweekly" ? "biweekly" : "monthly",
      });
      applied = { kind: "recurring", transactionId, billId };
    } else if (scenario.type === "income_change") {
      const income = incomes.find((item) => item.id === scenario.sourceId);
      if (income) {
        await updateIncome({
          ...income,
          amount,
          amount_history: [
            ...(income.amount_history ?? []).filter((history) => history.effective_from !== today.slice(0, 7)),
            { effective_from: today.slice(0, 7), amount },
          ],
        });
        applied = { kind: "income_update", incomeId: income.id };
      } else {
        applied = {
          kind: "income",
          id: await addIncome({
            name: scenario.name,
            amount,
            frequency: scenario.frequency === "weekly" ? "weekly" : scenario.frequency === "biweekly" ? "biweekly" : "monthly",
            start_date: today,
            next_payment_date: scenario.frequency !== "monthly" ? today : undefined,
          }),
        };
      }
    } else if (scenario.type === "extra_debt_payment") {
      if (settings.debtPayoffEnabled) {
        const preview = previewDebtSnowball(now.getMonth(), now.getFullYear(), amount);
        if (!preview.allocations.length || Math.abs(preview.selectedExtra - amount) >= 0.005) {
          throw new Error("That amount is outside the current safe debt plan.");
        }
        await applyDebtSnowballPayment(preview);
        applied = { kind: "debt", month: now.getMonth(), year: now.getFullYear() };
      } else {
        applied = {
          kind: "transaction",
          id: await addTransaction({ date: today, amount: -amount, category: "Debt", note: scenario.name }),
        };
      }
    }
    await updateDecision({
      ...due,
      status: "completed",
      actual_amount: amount,
      completed_at: new Date().toISOString(),
      applied_change: applied,
      remind_at: undefined,
    });
  };

  const complete = async () => {
    if (mutationInFlightRef.current) return;
    const amount = parsedMoney(actual);
    if (amount === null) {
      Alert.alert("Check amount", "Enter a valid amount of zero or more.");
      return;
    }
    if (
      amount <= 0 &&
      [
        "savings_contribution",
        "recurring_bill",
        "income_change",
        "extra_debt_payment",
      ].includes(due.scenario.type)
    ) {
      Alert.alert("Check amount", "Enter an amount greater than zero.");
      return;
    }
    if (due.scenario.type === "savings_contribution") {
      const goal = goals.find((item) => item.id === due.scenario.sourceId);
      const remaining = goal
        ? Math.max(
            0,
            Math.round(
              (goal.target_amount - goal.current_amount + Number.EPSILON) * 100,
            ) / 100,
          )
        : 0;
      if (!goal || amount <= 0 || amount > remaining) {
        Alert.alert(
          "Check contribution",
          goal
            ? `Enter an amount up to $${remaining.toFixed(2)}.`
            : "That savings goal is no longer available.",
        );
        return;
      }
    }
    mutationInFlightRef.current = true;
    setBusy(true);
    let completed = false;
    try {
      if (demoMode) {
        await completeInDemo(amount);
      } else {
        assertFinancialMutationOnline();
        let debtPlan: Record<string, unknown> | null = null;
        if (due.scenario.type === "extra_debt_payment" && settings.debtPayoffEnabled) {
          const preview = previewDebtSnowball(now.getMonth(), now.getFullYear(), amount);
          if (!preview.allocations.length || Math.abs(preview.selectedExtra - amount) >= 0.005) {
            throw new Error("That amount is outside the current safe debt plan.");
          }
          debtPlan = {
            selectedExtra: preview.selectedExtra,
            paymentDate: preview.paymentDate,
            allocations: preview.allocations,
          };
        }
        await completeDecisionAtomically({
          decisionId: due.id,
          actualAmount: amount,
          completedDate: today,
          accountId: accounts.find((account) => account.is_active)?.id ?? null,
          debtPlan,
        });
        await retryBudgetLoad();
      }
      completed = true;
      setDismissedDueId(due.id);
    } catch (error) {
      Alert.alert("Couldn’t complete plan", error instanceof Error ? error.message : "Please try again.");
    } finally {
      mutationInFlightRef.current = false;
      setBusy(false);
    }

    if (!completed) return;
    const difference = Math.max(0, Math.abs(due.scenario.amount) - amount);
    if (difference > 0 && (due.scenario.type === "one_time_purchase" || due.scenario.type === "recurring_bill")) {
      const preview = previewDebtSnowball(now.getMonth(), now.getFullYear(), difference, difference);
      if (preview.allocations.length && preview.safeMaximum + 0.005 >= difference) {
        Alert.alert(
          "Under Plan",
          `You spent $${difference.toFixed(2)} less than planned. Add it to ${preview.allocations[0].billName}?`,
          [
            { text: "Keep Available" },
            { text: "Add to Debt", onPress: () => void applyDebtSnowballPayment(preview) },
          ],
        );
      }
    }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={closeDue}>
      <View style={s.overlay}>
        <View style={[s.sheet, { backgroundColor: c.card }]}>
          <View style={[s.icon, { backgroundColor: c.primary + "18" }]}>
            <Feather name="check-square" size={22} color={c.primary} />
          </View>
          <Text style={[s.title, { color: c.foreground }]}>What happened with {due.name}?</Text>
          <Text style={[s.sub, { color: c.mutedForeground }]}>Planned ${Math.abs(due.scenario.amount).toFixed(2)} for {due.scenario.date}</Text>
          <Text style={[s.label, { color: c.mutedForeground }]}>Actual amount</Text>
          <TextInput
            accessibilityLabel="Actual amount"
            value={actual}
            onChangeText={setActual}
            keyboardType="decimal-pad"
            editable={!busy}
            style={[s.input, { backgroundColor: c.muted, color: c.foreground }]}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Complete this plan"
            accessibilityState={{ disabled: busy, busy }}
            disabled={busy}
            onPress={() => void complete()}
            style={[s.primary, { backgroundColor: c.primary, opacity: busy ? 0.65 : 1 }]}
          >
            {busy ? <ActivityIndicator color={c.primaryForeground} /> : (
              <Text style={{ color: c.primaryForeground, fontFamily: "Inter_700Bold" }}>Completed</Text>
            )}
          </Pressable>
          <View style={s.row}>
            <Pressable
              disabled={busy}
              onPress={() => {
                const tomorrow = new Date();
                tomorrow.setDate(tomorrow.getDate() + 1);
                void save({ remind_at: tomorrow.toISOString() }).then(
                  (saved) => {
                    if (saved) router.push("/(tabs)/flo" as never);
                  },
                );
              }}
              style={[s.secondary, { backgroundColor: c.muted, opacity: busy ? 0.5 : 1 }]}
            >
              <Text style={{ color: c.foreground }}>Changed</Text>
            </Pressable>
            <Pressable disabled={busy} onPress={postpone} style={[s.secondary, { backgroundColor: c.muted, opacity: busy ? 0.5 : 1 }]}>
              <Text style={{ color: c.foreground }}>Postpone 7 days</Text>
            </Pressable>
          </View>
          <View style={s.row}>
            <Pressable disabled={busy} onPress={remind} style={[s.secondary, { backgroundColor: c.muted, opacity: busy ? 0.5 : 1 }]}>
              <Text style={{ color: c.foreground }}>Remind tomorrow</Text>
            </Pressable>
            <Pressable
              disabled={busy}
              onPress={() => void save({ status: "cancelled", remind_at: undefined })}
              style={[s.secondary, { backgroundColor: c.destructive + "15", opacity: busy ? 0.5 : 1 }]}
            >
              <Text style={{ color: c.destructive }}>Cancel plan</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,.6)" },
  sheet: { padding: 22, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  icon: { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center", marginBottom: 12 },
  title: { fontSize: 20, fontFamily: "Inter_700Bold" },
  sub: { fontSize: 13, marginTop: 4 },
  label: { fontSize: 11, textTransform: "uppercase", marginTop: 16, marginBottom: 6 },
  input: { height: 48, borderRadius: 10, paddingHorizontal: 14, fontSize: 17 },
  primary: { minHeight: 48, borderRadius: 10, alignItems: "center", justifyContent: "center", marginTop: 14 },
  row: { flexDirection: "row", gap: 8, marginTop: 8 },
  secondary: { flex: 1, minHeight: 44, borderRadius: 9, alignItems: "center", justifyContent: "center" },
});
