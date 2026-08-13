import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppText } from "@/components/AppText";
import { DatePickerField } from "@/components/DatePickerField";
import { PlanFeatureGate } from "@/components/PlanFeatureGate";
import { useAuth } from "@/context/AuthContext";
import { useBudget } from "@/context/BudgetContext";
import { useMembership } from "@/context/MembershipContext";
import { useColors } from "@/hooks/useColors";
import { useDesktopExperience } from "@/hooks/useDesktopExperience";
import { loadCategoryBudgets, readCategoryBudgetCache } from "@/lib/categoryBudgetStore";
import { buildDashboardFinancialModel } from "@/lib/dashboardFinancialModel";
import { effectiveDebtMinimum } from "@/lib/snowball";
import {
  decodePlanSimulationChanges,
  isPlanSimulationHorizon,
  planSimulationStorageKey,
  projectPlanSimulation,
  safePlanSimulationName,
  PLAN_SIMULATION_HORIZONS,
  type PlanSimulationChange,
  type PlanSimulationDefinition,
  type PlanSimulationHorizon,
  type PlanSimulationReferences,
  type PlanSimulationResult,
} from "@/lib/planSimulator";
import {
  createPlanSimulation,
  deletePlanSimulation,
  loadPlanSimulations,
  updatePlanSimulation,
} from "@/lib/planSimulationPersistence";

type ChangeKind = PlanSimulationChange["type"];
type DraftState = {
  name: string;
  horizonMonths: PlanSimulationHorizon;
  changes: PlanSimulationChange[];
  invalidDefinition?: boolean;
};

const CHANGE_OPTIONS: Array<{ type: ChangeKind; label: string; detail: string; icon: React.ComponentProps<typeof Feather>["name"] }> = [
  { type: "income_add", label: "Add income", detail: "Add recurring future income", icon: "plus-circle" },
  { type: "income_edit", label: "Edit income", detail: "Change future amounts", icon: "edit-3" },
  { type: "income_pause", label: "Pause income", detail: "Pause future deposits", icon: "pause-circle" },
  { type: "income_once", label: "One-time income", detail: "Add one future deposit", icon: "arrow-down-circle" },
  { type: "bill_add", label: "Add a bill", detail: "Add a non-debt bill", icon: "file-plus" },
  { type: "bill_edit", label: "Edit a bill", detail: "Change future amounts", icon: "edit" },
  { type: "bill_pause", label: "Pause a bill", detail: "Pause future occurrences", icon: "slash" },
  { type: "bill_move", label: "Move a bill", detail: "Move one open occurrence", icon: "calendar" },
  { type: "spending_once", label: "One-time spending", detail: "Test a future purchase", icon: "shopping-bag" },
  { type: "savings_once", label: "Add to savings", detail: "Move checking money once", icon: "archive" },
  { type: "debt_extra", label: "Extra debt payment", detail: "Use your payoff method", icon: "trending-down" },
  { type: "debt_payoff", label: "Pay off a debt", detail: "Close one selected balance", icon: "check-circle" },
];

function todayString() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function money(value: number) {
  return value.toLocaleString(undefined, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function shortDate(value: string) {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function monthLabel(value: string) {
  const [year, month] = value.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

function parseMoney(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(trimmed)) return null;
  const amount = Number(trimmed);
  return Number.isFinite(amount) && amount > 0.005 ? Math.round(amount * 100) / 100 : null;
}

function nextLocalId() {
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function safeClose(router: ReturnType<typeof useRouter>) {
  if (router.canGoBack()) router.back();
  else router.replace("/(tabs)/monthly");
}

function Button({
  label,
  icon,
  onPress,
  disabled = false,
  danger = false,
  primary = false,
}: {
  label: string;
  icon?: React.ComponentProps<typeof Feather>["name"];
  onPress: () => void;
  disabled?: boolean;
  danger?: boolean;
  primary?: boolean;
}) {
  const c = useColors();
  const foreground = primary ? c.primaryForeground : danger ? c.destructive : c.foreground;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: primary ? c.primary : danger ? c.destructive + "12" : c.card,
          borderColor: primary ? c.primary : danger ? c.destructive + "55" : c.border,
          opacity: disabled ? 0.45 : pressed ? 0.72 : 1,
        },
      ]}
    >
      {icon ? <Feather name={icon} size={15} color={foreground} /> : null}
      <AppText tone="button" style={[styles.buttonText, { color: foreground }]}>{label}</AppText>
    </Pressable>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  const c = useColors();
  return <AppText tone="label" style={[styles.fieldLabel, { color: c.mutedForeground }]}>{children}</AppText>;
}

function Input({
  value,
  onChangeText,
  placeholder,
  label,
  keyboardType,
}: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  label: string;
  keyboardType?: "default" | "decimal-pad";
}) {
  const c = useColors();
  return (
    <TextInput
      accessibilityLabel={label}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={c.mutedForeground}
      keyboardType={keyboardType}
      style={[styles.input, { color: c.foreground, backgroundColor: c.background, borderColor: c.border }]}
    />
  );
}

function ChoiceChips({
  values,
  selected,
  onSelect,
}: {
  values: Array<{ id: string; label: string }>;
  selected: string;
  onSelect: (id: string) => void;
}) {
  const c = useColors();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} style={styles.chipScroll}>
      {values.map(value => {
        const active = value.id === selected;
        return (
          <Pressable
            key={value.id}
            accessibilityRole="radio"
            accessibilityState={{ checked: active }}
            onPress={() => onSelect(value.id)}
            style={({ pressed }) => [styles.chip, { backgroundColor: active ? c.primary : c.background, borderColor: active ? c.primary : c.border, opacity: pressed ? 0.75 : 1 }]}
          >
            <AppText style={[styles.chipText, { color: active ? c.primaryForeground : c.foreground }]}>{value.label}</AppText>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function ChangeComposer({
  references,
  startDate,
  endDate,
  onAdd,
}: {
  references: PlanSimulationReferences;
  startDate: string;
  endDate: string;
  onAdd: (change: PlanSimulationChange) => void;
}) {
  const c = useColors();
  const [type, setType] = useState<ChangeKind>("spending_once");
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(startDate);
  const [newDate, setNewDate] = useState(startDate);
  const [frequency, setFrequency] = useState("monthly");
  const [targetId, setTargetId] = useState("");
  const [error, setError] = useState("");

  const needsIncome = type === "income_edit" || type === "income_pause";
  const needsBill = type === "bill_edit" || type === "bill_pause" || type === "bill_move";
  const needsDebt = type === "debt_payoff";
  const needsName = type === "income_add" || type === "income_once" || type === "bill_add" || type === "spending_once" || type === "savings_once";
  const needsAmount = type !== "income_pause" && type !== "bill_pause" && type !== "bill_move" && type !== "debt_payoff";
  const isRecurringAdd = type === "income_add" || type === "bill_add";
  const billChoices = references.bills.filter(bill => !bill.isDebt).map(bill => ({ id: bill.id, label: bill.name }));
  const incomeChoices = references.incomes.map(income => ({ id: income.id, label: income.name }));
  const debtChoices = references.debts
    .filter(debt => debt.balance > 0.005 && (!debt.endDate || debt.endDate.slice(0, 10) >= startDate))
    .map(debt => ({ id: debt.id, label: `${debt.name} · ${money(debt.balance)}` }));
  const targetChoices = needsIncome ? incomeChoices : needsBill ? billChoices : needsDebt ? debtChoices : [];
  const selectedTarget = targetId || targetChoices[0]?.id || "";

  const add = () => {
    const parsedAmount = needsAmount ? parseMoney(amount) : null;
    if (needsAmount && parsedAmount === null) { setError("Enter a valid amount with up to two decimal places."); return; }
    if (needsName && !safePlanSimulationName(name)) { setError("Enter a name between 1 and 80 characters."); return; }
    if ((needsIncome || needsBill || needsDebt) && !selectedTarget) { setError(`Add an eligible ${needsIncome ? "income" : needsDebt ? "open debt" : "non-debt bill"} to the live plan first.`); return; }
    const id = nextLocalId();
    let candidate: PlanSimulationChange;
    switch (type) {
      case "income_add": candidate = { id, type, name: name.trim(), amount: parsedAmount!, frequency: frequency === "weekly" || frequency === "biweekly" ? frequency : "monthly", startDate: date }; break;
      case "income_edit": candidate = { id, type, incomeId: selectedTarget, amount: parsedAmount!, effectiveDate: date }; break;
      case "income_pause": candidate = { id, type, incomeId: selectedTarget, effectiveDate: date }; break;
      case "income_once": candidate = { id, type, name: name.trim(), amount: parsedAmount!, date }; break;
      case "bill_add": candidate = { id, type, name: name.trim(), amount: parsedAmount!, frequency: frequency === "weekly" || frequency === "biweekly" || frequency === "quarterly" ? frequency : "monthly", startDate: date }; break;
      case "bill_edit": candidate = { id, type, billId: selectedTarget, amount: parsedAmount!, effectiveDate: date }; break;
      case "bill_pause": candidate = { id, type, billId: selectedTarget, effectiveDate: date }; break;
      case "bill_move": candidate = { id, type, billId: selectedTarget, occurrenceDate: date, newDate }; break;
      case "spending_once": candidate = { id, type, name: name.trim(), amount: parsedAmount!, date }; break;
      case "savings_once": candidate = { id, type, name: name.trim(), amount: parsedAmount!, date }; break;
      case "debt_extra": candidate = { id, type, amount: parsedAmount!, date }; break;
      case "debt_payoff": candidate = { id, type, debtId: selectedTarget, date }; break;
    }
    if (!decodePlanSimulationChanges([candidate])) { setError("Check the date and amount, then try again."); return; }
    setError("");
    onAdd(candidate);
    setAmount("");
    if (needsName) setName("");
  };

  return (
    <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
      <AppText tone="title" style={[styles.cardTitle, { color: c.foreground }]}>Test a change</AppText>
      <AppText style={[styles.cardDescription, { color: c.mutedForeground }]}>Only future, unsettled plan items can change here.</AppText>
      <View accessibilityRole="radiogroup" style={styles.changeGrid}>
        {CHANGE_OPTIONS.map(option => {
          const active = option.type === type;
          return (
            <Pressable
              key={option.type}
              accessibilityRole="radio"
              accessibilityState={{ checked: active }}
              onPress={() => { setType(option.type); setError(""); setTargetId(""); setFrequency("monthly"); }}
              style={({ pressed }) => [styles.changeOption, { backgroundColor: active ? c.primary + "18" : c.background, borderColor: active ? c.primary : c.border, opacity: pressed ? 0.72 : 1 }]}
            >
              <Feather name={option.icon} size={17} color={active ? c.primary : c.mutedForeground} />
              <View style={styles.changeOptionCopy}>
                <AppText style={[styles.changeOptionTitle, { color: c.foreground }]}>{option.label}</AppText>
                <AppText style={[styles.changeOptionDetail, { color: c.mutedForeground }]}>{option.detail}</AppText>
              </View>
            </Pressable>
          );
        })}
      </View>

      {targetChoices.length ? <View style={styles.field}><FieldLabel>{needsIncome ? "Income" : needsDebt ? "Debt" : "Bill"}</FieldLabel><ChoiceChips values={targetChoices} selected={selectedTarget} onSelect={setTargetId} /></View> : null}
      {needsName ? <View style={styles.field}><FieldLabel>Name</FieldLabel><Input label="Change name" value={name} onChangeText={setName} placeholder={type === "savings_once" ? "Emergency fund" : "Name"} /></View> : null}
      {needsAmount ? <View style={styles.field}><FieldLabel>Amount</FieldLabel><Input label="Change amount" value={amount} onChangeText={setAmount} placeholder="0.00" keyboardType="decimal-pad" /></View> : null}
      {isRecurringAdd ? <View style={styles.field}><FieldLabel>Frequency</FieldLabel><ChoiceChips values={(type === "bill_add" ? ["monthly", "quarterly", "biweekly", "weekly"] : ["monthly", "biweekly", "weekly"]).map(id => ({ id, label: id[0].toUpperCase() + id.slice(1) }))} selected={frequency} onSelect={setFrequency} /></View> : null}
      <View style={styles.field}><FieldLabel>{type === "bill_move" ? "Occurrence date" : type.endsWith("_pause") || type.endsWith("_edit") ? "Effective date" : "Date"}</FieldLabel><DatePickerField value={date} onChange={setDate} minDate={startDate} maxDate={endDate} placeholder="Choose a date" /></View>
      {type === "bill_move" ? <View style={styles.field}><FieldLabel>New date</FieldLabel><DatePickerField value={newDate} onChange={setNewDate} minDate={startDate} maxDate={endDate} placeholder="Choose a new date" /></View> : null}
      {error ? <AppText accessibilityRole="alert" style={[styles.errorText, { color: c.destructive }]}>{error}</AppText> : null}
      {type === "income_edit" || type === "bill_edit" ? <AppText style={[styles.editSemantics, { color: c.mutedForeground }]}>The new amount is the full intended occurrence total. Any amount already settled stays unchanged; only the remaining Forecast amount is replaced.</AppText> : null}
      {type === "debt_payoff" ? <AppText style={[styles.editSemantics, { color: c.mutedForeground }]}>The simulator calculates that debt’s remaining balance on the selected date and tests paying it in full. It does not change the real debt or schedule a payment.</AppText> : null}
      <Button label="Add to scenario" icon="plus" onPress={add} primary />
    </View>
  );
}

function changeLabel(change: PlanSimulationChange, references: PlanSimulationReferences) {
  const option = CHANGE_OPTIONS.find(item => item.type === change.type)?.label ?? "Scenario change";
  if ("incomeId" in change) return `${option}: ${references.incomes.find(item => item.id === change.incomeId)?.name ?? "Missing income"}`;
  if ("billId" in change) return `${option}: ${references.bills.find(item => item.id === change.billId)?.name ?? "Missing bill"}`;
  if ("debtId" in change) return `${option}: ${references.debts.find(item => item.id === change.debtId)?.name ?? "Missing debt"}`;
  if ("name" in change) return `${option}: ${change.name}`;
  return `${option}: ${money(change.amount)}`;
}

function ChangeList({ changes, references, issues, onRemove }: { changes: PlanSimulationChange[]; references: PlanSimulationReferences; issues: PlanSimulationResult["issues"]; onRemove: (id: string) => void }) {
  const c = useColors();
  if (!changes.length) return <View style={[styles.emptyCard, { borderColor: c.border }]}><AppText style={[styles.emptyTitle, { color: c.foreground }]}>No changes yet</AppText><AppText style={[styles.emptyText, { color: c.mutedForeground }]}>Your result currently matches the real Forecast exactly.</AppText></View>;
  return (
    <View style={styles.changeList}>
      {changes.map(change => {
        const issue = issues.find(item => item.changeId === change.id);
        return (
          <View key={change.id} style={[styles.changeRow, { backgroundColor: c.card, borderColor: issue ? c.warning : c.border }]}>
            <View style={styles.changeRowCopy}>
              <AppText style={[styles.changeRowTitle, { color: c.foreground }]}>{changeLabel(change, references)}</AppText>
              {issue ? <AppText style={[styles.changeIssue, { color: c.warning }]}>Needs Attention · {issue.message}</AppText> : <AppText style={[styles.changeOkay, { color: c.success }]}>Ready to compare</AppText>}
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${changeLabel(change, references)}`} onPress={() => onRemove(change.id)} hitSlop={8} style={({ pressed }) => ({ opacity: pressed ? 0.55 : 1, padding: 8 })}>
              <Feather name="x" size={18} color={c.mutedForeground} />
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

function Metric({ label, real, scenario, tone }: { label: string; real: string; scenario: string; tone?: "good" | "warn" }) {
  const c = useColors();
  const scenarioColor = tone === "good" ? c.success : tone === "warn" ? c.warning : c.foreground;
  return (
    <View style={[styles.metric, { backgroundColor: c.background, borderColor: c.border }]}>
      <AppText tone="label" style={[styles.metricLabel, { color: c.mutedForeground }]}>{label}</AppText>
      <View style={styles.metricValues}><View><AppText style={[styles.metricCaption, { color: c.mutedForeground }]}>Real plan</AppText><AppText tone="number" style={[styles.metricValue, { color: c.foreground }]}>{real}</AppText></View><View style={styles.metricScenario}><AppText style={[styles.metricCaption, { color: c.mutedForeground }]}>Scenario</AppText><AppText tone="number" style={[styles.metricValue, { color: scenarioColor }]}>{scenario}</AppText></View></View>
    </View>
  );
}

function ResultsPanel({ baseline, scenario, safetyFloor }: { baseline: PlanSimulationResult; scenario: PlanSimulationResult; safetyFloor: number }) {
  const c = useColors();
  const maxFlow = Math.max(1, ...scenario.months.flatMap(month => [month.inflows, month.outflows]));
  return (
    <View style={[styles.resultsCard, { backgroundColor: c.card, borderColor: c.border }]}>
      <View style={styles.resultsHeader}><View><AppText tone="label" style={[styles.eyebrow, { color: c.primary }]}>LIVE COMPARISON</AppText><AppText tone="title" style={[styles.resultsTitle, { color: c.foreground }]}>What could change</AppText></View>{scenario.complete ? <View style={[styles.statusBadge, { backgroundColor: c.success + "18" }]}><Feather name="check" size={12} color={c.success} /><AppText style={[styles.statusText, { color: c.success }]}>Complete</AppText></View> : <View style={[styles.statusBadge, { backgroundColor: c.warning + "18" }]}><Feather name="alert-triangle" size={12} color={c.warning} /><AppText style={[styles.statusText, { color: c.warning }]}>Needs Attention</AppText></View>}</View>
      <AppText style={[styles.resultsNote, { color: c.mutedForeground }]}>Recalculated from your latest real plan. Nothing here changes Forecast, balances, bills, or debt.</AppText>
      {!scenario.complete ? <View accessibilityRole="alert" style={[styles.attention, { backgroundColor: c.warning + "12", borderColor: c.warning + "45" }]}><AppText style={[styles.attentionTitle, { color: c.warning }]}>Repair or remove stale changes</AppText>{scenario.issues.map(issue => <AppText key={`${issue.changeId}:${issue.message}`} style={[styles.attentionText, { color: c.foreground }]}>• {issue.message}</AppText>)}</View> : null}
      <View style={styles.metricsGrid}>
        <Metric label="Ending balance" real={money(baseline.endingBalance)} scenario={money(scenario.endingBalance)} tone={scenario.endingBalance >= baseline.endingBalance ? "good" : "warn"} />
        <Metric label="Lowest balance" real={`${money(baseline.lowestBalance)} · ${shortDate(baseline.lowestBalanceDate)}`} scenario={`${money(scenario.lowestBalance)} · ${shortDate(scenario.lowestBalanceDate)}`} tone={scenario.lowestBalance >= safetyFloor ? "good" : "warn"} />
        <Metric label="Flow Score" real={`${baseline.flowScore}`} scenario={`${scenario.flowScore}`} tone={scenario.flowScore >= baseline.flowScore ? "good" : "warn"} />
        <Metric label="Protected Days" real={`${baseline.protectedDays} days`} scenario={`${scenario.protectedDays} days`} tone={scenario.protectedDays >= baseline.protectedDays ? "good" : "warn"} />
      </View>
      <View style={[styles.safetyRow, { borderColor: c.border }]}><View><AppText style={[styles.safetyLabel, { color: c.mutedForeground }]}>Current safety floor</AppText><AppText tone="number" style={[styles.safetyValue, { color: c.foreground }]}>{money(safetyFloor)}</AppText></View><View><AppText style={[styles.safetyLabel, { color: c.mutedForeground }]}>Hypothetical savings added</AppText><AppText tone="number" style={[styles.safetyValue, { color: c.success }]}>{money(scenario.savingsAdded)}</AppText></View></View>
      <View style={[styles.debtImpact, { backgroundColor: c.background, borderColor: c.border }]}><Feather name="trending-down" size={18} color={c.primary} /><View style={styles.debtImpactCopy}><AppText style={[styles.debtImpactTitle, { color: c.foreground }]}>Potential debt-free date</AppText><AppText style={[styles.debtImpactValue, { color: c.primary }]}>{scenario.potentialDebtFreeDate ?? "Not available"}</AppText><AppText style={[styles.debtImpactNote, { color: c.mutedForeground }]}>{scenario.payoffImpactMonths === null ? "Complete the debt details to compare payoff timing." : scenario.payoffImpactMonths > 0 ? `${scenario.payoffImpactMonths} month${scenario.payoffImpactMonths === 1 ? "" : "s"} sooner` : scenario.payoffImpactMonths < 0 ? `${Math.abs(scenario.payoffImpactMonths)} month${scenario.payoffImpactMonths === -1 ? "" : "s"} later` : "Same payoff timing"}</AppText></View></View>
      <View style={styles.monthSection}><AppText tone="title" style={[styles.monthSectionTitle, { color: c.foreground }]}>Monthly outlook</AppText>{scenario.months.map(month => <View key={month.month} style={[styles.monthRow, { borderColor: c.border }]}><View style={styles.monthRowTop}><AppText style={[styles.monthName, { color: c.foreground }]}>{monthLabel(month.month)}</AppText><AppText tone="number" style={[styles.monthNet, { color: month.cashRemaining >= 0 ? c.success : c.destructive }]}>{money(month.cashRemaining)}</AppText></View><View style={styles.barTrack}><View style={[styles.bar, { backgroundColor: c.success, width: `${Math.max(2, month.inflows / maxFlow * 100)}%` }]} /><View style={[styles.bar, { backgroundColor: c.primary, width: `${Math.max(2, month.outflows / maxFlow * 100)}%` }]} /></View><View style={styles.monthDetails}><AppText style={[styles.monthDetail, { color: c.mutedForeground }]}>In {money(month.inflows)}</AppText><AppText style={[styles.monthDetail, { color: c.mutedForeground }]}>Out {money(month.outflows)}</AppText><AppText style={[styles.monthDetail, { color: c.mutedForeground }]}>Ends {money(month.endingBalance)}</AppText></View></View>)}</View>
    </View>
  );
}

function LockedPlanSimulator() {
  const c = useColors();
  const router = useRouter();
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: c.background }]}>
      <View style={styles.lockedHeader}><Pressable accessibilityRole="button" accessibilityLabel="Close Plan Simulator" onPress={() => safeClose(router)} style={styles.closeButton}><Feather name="x" size={22} color={c.foreground} /></Pressable></View>
      <PlanFeatureGate feature="plan_simulator"><View /></PlanFeatureGate>
    </SafeAreaView>
  );
}

function PlanSimulatorWorkspace() {
  const c = useColors();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const desktop = useDesktopExperience() && width >= 1024;
  const { user } = useAuth();
  const {
    accounts,
    activeHousehold,
    bills,
    canEditHousehold,
    categories,
    connectedBankAccounts,
    demoMode,
    forecastConfidence,
    getBillEffectiveMonthlyTotal,
    getBillMonthlyTotal,
    getBillOccurrencesInMonth,
    getCashFlow,
    getDailyBalances,
    getMonthlyBills,
    getMonthlyIncome,
    getPaidAmount,
    getPlanSimulationBaseline,
    getTransactionsForMonth,
    goals,
    incomes,
    pendingBankTransactions,
    pendingPlanMatches,
    previewDebtSnowball,
    settings,
  } = useBudget();
  const now = useMemo(() => new Date(), []);
  const startDate = useMemo(todayString, []);
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();
  const defaultHorizon = isPlanSimulationHorizon(settings.forecast_horizon_months) ? settings.forecast_horizon_months : 6;
  const householdId = activeHousehold?.householdId ?? "local";
  const draftStorageKey = user?.id ? planSimulationStorageKey(user.id, householdId) : null;
  const [scenarios, setScenarios] = useState<PlanSimulationDefinition[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftState>({ name: "Untitled scenario", horizonMonths: defaultHorizon, changes: [] });
  const [categoryBudgets, setCategoryBudgets] = useState<Record<string, number>>(() => readCategoryBudgetCache(currentMonth, currentYear, { userId: user?.id, householdId, budgetId: activeHousehold?.budgetId }));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const selectedScenario = useMemo(() => scenarios.find(item => item.id === selectedId) ?? null, [scenarios, selectedId]);

  useEffect(() => {
    let cancelled = false;
    const scope = { userId: user?.id, householdId, budgetId: activeHousehold?.budgetId };
    setCategoryBudgets(readCategoryBudgetCache(currentMonth, currentYear, scope));
    void loadCategoryBudgets(scope, currentMonth, currentYear).then(value => { if (!cancelled) setCategoryBudgets(value); });
    return () => { cancelled = true; };
  }, [activeHousehold?.budgetId, currentMonth, currentYear, householdId, user?.id]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setScenarios([]);
    setSelectedId(null);
    setDraft({ name: "Untitled scenario", horizonMonths: defaultHorizon, changes: [] });
    void (async () => {
      try {
        const [rows, storedDraft] = await Promise.all([
          demoMode || householdId === "local" ? Promise.resolve([]) : loadPlanSimulations(householdId),
          !canEditHousehold && draftStorageKey ? AsyncStorage.getItem(draftStorageKey) : Promise.resolve(null),
        ]);
        if (cancelled) return;
        setScenarios(rows);
        if (!canEditHousehold && storedDraft) {
          const parsed = JSON.parse(storedDraft) as Partial<DraftState>;
          const changes = decodePlanSimulationChanges(parsed.changes);
          if (typeof parsed.name === "string" && isPlanSimulationHorizon(parsed.horizonMonths) && changes) setDraft({ name: parsed.name, horizonMonths: parsed.horizonMonths, changes });
        }
      } catch (error) {
        if (!cancelled) setMessage(error instanceof Error ? error.message : "Plan Simulator could not load saved scenarios.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [canEditHousehold, defaultHorizon, demoMode, draftStorageKey, householdId]);

  useEffect(() => {
    if (canEditHousehold || !draftStorageKey || loading) return;
    void AsyncStorage.setItem(draftStorageKey, JSON.stringify(draft)).catch(() => undefined);
  }, [canEditHousehold, draft, draftStorageKey, loading]);

  const baseline = useMemo(() => getPlanSimulationBaseline(draft.horizonMonths, startDate), [draft.horizonMonths, getPlanSimulationBaseline, startDate]);
  const currentMonthBalances = useMemo(() => getDailyBalances(currentMonth, currentYear), [currentMonth, currentYear, getDailyBalances]);
  const cashFlow = useMemo(() => getCashFlow(currentMonth, currentYear), [currentMonth, currentYear, getCashFlow]);
  const dashboardModel = useMemo(() => buildDashboardFinancialModel({
    now,
    selectedYear: currentYear,
    settings,
    forecastConfidence,
    accounts,
    connectedBankAccounts,
    pendingBankTransactions,
    pendingPlanMatches,
    categories,
    categoryBudgets,
    goals,
    incomes,
    cashFlow,
    currentMonthBalances,
    getMonthlyBills,
    getMonthlyIncome,
    getTransactionsForMonth,
    getDailyBalances,
    getBillMonthlyTotal,
    getPaidAmount,
    getBillOccurrencesInMonth,
  }), [accounts, cashFlow, categories, categoryBudgets, connectedBankAccounts, currentMonthBalances, currentYear, forecastConfidence, getBillMonthlyTotal, getBillOccurrencesInMonth, getDailyBalances, getMonthlyBills, getMonthlyIncome, getPaidAmount, getTransactionsForMonth, goals, incomes, now, pendingBankTransactions, pendingPlanMatches, settings]);
  const livePayoffPreview = useMemo(() => {
    try { return previewDebtSnowball(currentMonth, currentYear, 0); } catch { return null; }
  }, [currentMonth, currentYear, previewDebtSnowball]);
  const references = useMemo<PlanSimulationReferences>(() => ({
    incomes: incomes.map(income => ({ id: income.id, name: income.name, amount: income.amount })),
    bills: bills.map(bill => {
      const occurrenceCount = getBillOccurrencesInMonth(bill, currentMonth, currentYear).length;
      const openOccurrenceCount = baseline.days.flatMap(day => day.events).filter(event =>
        event.sourceType === "bill"
        && event.sourceId === bill.id
        && event.date.startsWith(`${currentYear}-${String(currentMonth + 1).padStart(2, "0")}`)
        && (event.status === "planned" || event.status === "scheduled")
      ).length;
      return {
        id: bill.id,
        name: bill.name,
        amount: bill.amount,
        frequency: bill.frequency,
        isDebt: bill.is_debt,
        isRequired: bill.is_debt || bill.smart_priority !== "flexible" && bill.smart_priority !== "optional",
        currentMonthEffectiveTotal: getBillEffectiveMonthlyTotal(bill, currentMonth, currentYear),
        currentMonthConfiguredTotal: getBillMonthlyTotal(bill, currentMonth, currentYear),
        currentMonthOccurrenceCount: occurrenceCount,
        currentMonthOpenOccurrenceCount: openOccurrenceCount,
      };
    }),
    debts: bills.filter(bill => bill.is_debt).map(bill => ({
      id: bill.id,
      name: bill.name,
      balance: Math.max(0, bill.balance),
      minimum: effectiveDebtMinimum(bill.amount, Number(bill.snowball_minimum_boost ?? 0)),
      apr: Math.max(0, bill.interest_rate),
      dueDay: bill.due_day,
      included: bill.include_in_snowball !== false,
      frequency: bill.frequency,
      dayOfWeek: bill.day_of_week,
      nextPaymentDate: bill.next_payment_date,
      startDate: bill.start_date,
      endDate: bill.end_date,
    })),
    debtMethod: settings.paymentMethod,
    payoffStrategyExtrasByMonth: Object.fromEntries((livePayoffPreview?.months ?? []).map(month => [
      `${month.year}-${String(month.month + 1).padStart(2, "0")}`,
      Math.max(0, month.extraPayment),
    ])),
  }), [baseline.days, bills, currentMonth, currentYear, getBillEffectiveMonthlyTotal, getBillMonthlyTotal, getBillOccurrencesInMonth, incomes, livePayoffPreview?.months, settings.paymentMethod]);
  const metrics = useMemo(() => ({
    flowScore: dashboardModel.algorithmSuite.flowScore.score,
    protectedDays: dashboardModel.algorithmSuite.stability.protectedDays,
    requiredMonthlyOutflow: dashboardModel.algorithmSuite.stability.reserveTarget,
    forecastConfidence: forecastConfidence.level,
    currentDebtFreeDate: livePayoffPreview?.debtFreeDate ?? null,
  }), [dashboardModel.algorithmSuite.flowScore.score, dashboardModel.algorithmSuite.stability.protectedDays, dashboardModel.algorithmSuite.stability.reserveTarget, forecastConfidence.level, livePayoffPreview?.debtFreeDate]);
  const baselineResult = useMemo(() => projectPlanSimulation({ baseline, changes: [], references, metrics, safetyFloor: settings.safety_floor }), [baseline, metrics, references, settings.safety_floor]);
  const scenarioResult = useMemo(() => projectPlanSimulation({
    baseline,
    changes: draft.changes,
    references,
    metrics,
    safetyFloor: settings.safety_floor,
    definitionIssue: draft.invalidDefinition ? "This saved scenario uses an unsupported definition. Reset it before saving or duplicating." : null,
  }), [baseline, draft.changes, draft.invalidDefinition, metrics, references, settings.safety_floor]);

  const selectScenario = useCallback((scenario: PlanSimulationDefinition) => {
    setSelectedId(scenario.id);
    setDraft({ name: scenario.name, horizonMonths: scenario.horizonMonths, changes: scenario.changes, invalidDefinition: scenario.invalidDefinition });
    setMessage(scenario.invalidDefinition ? "This saved scenario has an unsupported definition. Choose Reset before saving or duplicating it." : "");
  }, []);
  const makeLocalDraft = useCallback(() => {
    if (!canEditHousehold && selectedId) {
      setSelectedId(null);
      setDraft(previous => ({ ...previous, name: `${previous.name} local draft` }));
      setMessage("You are editing an unsaved local draft. The household scenario remains unchanged.");
    }
  }, [canEditHousehold, selectedId]);
  const addChange = useCallback((change: PlanSimulationChange) => {
    makeLocalDraft();
    setDraft(previous => ({ ...previous, changes: [...previous.changes, change] }));
  }, [makeLocalDraft]);
  const removeChange = useCallback((id: string) => {
    makeLocalDraft();
    setDraft(previous => ({ ...previous, changes: previous.changes.filter(change => change.id !== id) }));
  }, [makeLocalDraft]);
  const newDraft = useCallback(() => {
    setSelectedId(null);
    setDraft({ name: "Untitled scenario", horizonMonths: defaultHorizon, changes: [] });
    setMessage("");
  }, [defaultHorizon]);
  const resetDraft = useCallback(() => {
    if (selectedScenario?.invalidDefinition) {
      setDraft({ name: selectedScenario.name, horizonMonths: selectedScenario.horizonMonths, changes: [], invalidDefinition: false });
      setMessage("Unsupported changes were cleared. Review the empty scenario before saving.");
      return;
    }
    if (selectedScenario) setDraft({ name: selectedScenario.name, horizonMonths: selectedScenario.horizonMonths, changes: selectedScenario.changes });
    else setDraft({ name: "Untitled scenario", horizonMonths: defaultHorizon, changes: [] });
    setMessage("Draft reset.");
  }, [defaultHorizon, selectedScenario]);
  const saveDraft = useCallback(async () => {
    if (!canEditHousehold || demoMode) { setMessage(canEditHousehold ? "Demo scenarios stay local and are not saved to a household." : "View-only members can run local drafts but cannot save household scenarios."); return; }
    if (draft.invalidDefinition) { setMessage("Reset the unsupported saved definition before saving or renaming it."); return; }
    const name = safePlanSimulationName(draft.name);
    if (!name) { setMessage("Scenario names must be between 1 and 80 characters."); return; }
    setSaving(true);
    try {
      const saved = selectedScenario
        ? await updatePlanSimulation({ scenario: selectedScenario, name, horizonMonths: draft.horizonMonths, changes: draft.changes })
        : await createPlanSimulation({ householdId, name, horizonMonths: draft.horizonMonths, changes: draft.changes });
      setScenarios(previous => [saved, ...previous.filter(item => item.id !== saved.id)]);
      setSelectedId(saved.id);
      setDraft({ name: saved.name, horizonMonths: saved.horizonMonths, changes: saved.changes });
      setMessage("Scenario saved. Your real plan was not changed.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Scenario could not be saved."); }
    finally { setSaving(false); }
  }, [canEditHousehold, demoMode, draft, householdId, selectedScenario]);
  const duplicate = useCallback(async () => {
    if (!canEditHousehold || demoMode) { setMessage("Only household editors can duplicate saved scenarios."); return; }
    if (draft.invalidDefinition) { setMessage("Reset the unsupported saved definition before duplicating it."); return; }
    setSaving(true);
    try {
      const usedNames = new Set(scenarios.map(item => item.name.toLowerCase()));
      let suffix = 1;
      let copyName = `${draft.name} copy`;
      while (usedNames.has(copyName.toLowerCase())) { suffix += 1; copyName = `${draft.name} copy ${suffix}`; }
      const saved = await createPlanSimulation({ householdId, name: copyName.slice(0, 80), horizonMonths: draft.horizonMonths, changes: draft.changes });
      setScenarios(previous => [saved, ...previous]);
      selectScenario(saved);
      setMessage("Scenario duplicated. Your real plan was not changed.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Scenario could not be duplicated."); }
    finally { setSaving(false); }
  }, [canEditHousehold, demoMode, draft, householdId, scenarios, selectScenario]);
  const removeScenario = useCallback(() => {
    if (!selectedScenario || !canEditHousehold || demoMode) return;
    Alert.alert("Delete scenario?", `Delete “${selectedScenario.name}”? Your real plan will not change.`, [{ text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: () => { setSaving(true); void deletePlanSimulation(selectedScenario).then(() => { setScenarios(previous => previous.filter(item => item.id !== selectedScenario.id)); newDraft(); setMessage("Scenario deleted. Your real plan was not changed."); }).catch(error => setMessage(error instanceof Error ? error.message : "Scenario could not be deleted.")).finally(() => setSaving(false)); } }]);
  }, [canEditHousehold, demoMode, newDraft, selectedScenario]);

  if (loading) return <SafeAreaView style={[styles.screen, styles.center, { backgroundColor: c.background }]}><ActivityIndicator size="large" color={c.primary} /><AppText style={[styles.loadingText, { color: c.mutedForeground }]}>Loading Plan Simulator…</AppText></SafeAreaView>;

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: c.background }]} edges={["top", "bottom"]}>
      <View style={[styles.header, { borderColor: c.border, backgroundColor: c.background }]}>
        <View style={styles.headerCopy}><AppText tone="label" style={[styles.eyebrow, { color: c.primary }]}>PRO PLAN SIMULATOR</AppText><AppText accessibilityRole="header" tone="title" style={[styles.title, { color: c.foreground }]}>Test a plan without changing it</AppText><AppText style={[styles.subtitle, { color: c.mutedForeground }]}>Compare your real Forecast with a saved “what if.” Nothing in this workspace changes the real plan.</AppText></View>
        <Pressable accessibilityRole="button" accessibilityLabel="Close Plan Simulator" onPress={() => safeClose(router)} style={({ pressed }) => [styles.closeButton, { backgroundColor: c.card, borderColor: c.border, opacity: pressed ? 0.66 : 1 }]}><Feather name="x" size={21} color={c.foreground} /></Pressable>
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={[styles.content, desktop && styles.contentDesktop]} keyboardShouldPersistTaps="handled">
        <View style={[styles.readOnlyBanner, { backgroundColor: c.primary + "12", borderColor: c.primary + "40" }]}><Feather name="shield" size={18} color={c.primary} /><View style={styles.readOnlyCopy}><AppText style={[styles.readOnlyTitle, { color: c.foreground }]}>Simulation only</AppText><AppText style={[styles.readOnlyText, { color: c.mutedForeground }]}>There is no Apply action. Balances, APR, safety floor, goals, bills, debt, and past activity stay unchanged.</AppText></View></View>
        <View style={[styles.scenarioBar, { backgroundColor: c.card, borderColor: c.border }]}>
          <View style={styles.scenarioSelect}><FieldLabel>Scenario</FieldLabel><ChoiceChips values={[{ id: "draft", label: "Local draft" }, ...scenarios.map(item => ({ id: item.id, label: item.invalidDefinition ? `${item.name} · Needs Attention` : item.name }))]} selected={selectedId ?? "draft"} onSelect={id => { if (id === "draft") newDraft(); else { const scenario = scenarios.find(item => item.id === id); if (scenario) selectScenario(scenario); } }} /></View>
          <Button label="New" icon="plus" onPress={newDraft} />
        </View>
        {!canEditHousehold ? <View style={[styles.viewerNote, { backgroundColor: c.warning + "12", borderColor: c.warning + "40" }]}><Feather name="eye" size={16} color={c.warning} /><AppText style={[styles.viewerText, { color: c.foreground }]}>View-only access: saved household scenarios are readable. Any changes you try are kept as a private local draft and cannot be saved.</AppText></View> : null}
        {message ? <View accessibilityRole="alert" style={[styles.message, { backgroundColor: c.card, borderColor: c.border }]}><AppText style={[styles.messageText, { color: c.foreground }]}>{message}</AppText><Pressable accessibilityRole="button" accessibilityLabel="Dismiss message" onPress={() => setMessage("")} hitSlop={8}><Feather name="x" size={16} color={c.mutedForeground} /></Pressable></View> : null}
        <View style={[styles.workspace, desktop && styles.workspaceDesktop]}>
          <View style={styles.editorColumn}>
            <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
              <AppText tone="title" style={[styles.cardTitle, { color: c.foreground }]}>Scenario details</AppText>
              <View style={styles.field}><FieldLabel>Name</FieldLabel><Input label="Scenario name" value={draft.name} onChangeText={name => { makeLocalDraft(); setDraft(previous => ({ ...previous, name })); }} placeholder="Name this scenario" /></View>
              <View style={styles.field}><FieldLabel>Horizon</FieldLabel><ChoiceChips values={PLAN_SIMULATION_HORIZONS.map(value => ({ id: String(value), label: `${value} months` }))} selected={String(draft.horizonMonths)} onSelect={value => { makeLocalDraft(); setDraft(previous => ({ ...previous, horizonMonths: Number(value) as PlanSimulationHorizon })); }} /></View>
              <AppText style={[styles.scopeNote, { color: c.mutedForeground }]}>Saved scenarios store only their name and hypothetical changes. Every result is rebuilt from the latest live Forecast.</AppText>
              <View style={styles.actionWrap}><Button label={selectedScenario ? "Save changes" : "Save"} icon="save" onPress={() => void saveDraft()} disabled={!canEditHousehold || saving || demoMode || Boolean(draft.invalidDefinition)} primary /><Button label="Rename" icon="type" onPress={() => void saveDraft()} disabled={!selectedScenario || !canEditHousehold || saving || demoMode || Boolean(draft.invalidDefinition)} /><Button label="Duplicate" icon="copy" onPress={() => void duplicate()} disabled={!canEditHousehold || saving || demoMode || Boolean(draft.invalidDefinition)} /><Button label={draft.invalidDefinition ? "Reset unsupported changes" : "Reset"} icon="rotate-ccw" onPress={resetDraft} disabled={saving} /><Button label="Delete" icon="trash-2" onPress={removeScenario} disabled={!selectedScenario || !canEditHousehold || saving || demoMode} danger /></View>
              {saving ? <View style={styles.savingRow}><ActivityIndicator size="small" color={c.primary} /><AppText style={[styles.savingText, { color: c.mutedForeground }]}>Saving scenario…</AppText></View> : null}
            </View>
            <ChangeComposer references={references} startDate={startDate} endDate={baseline.endDate} onAdd={addChange} />
            <View><AppText tone="title" style={[styles.sectionTitle, { color: c.foreground }]}>Scenario changes</AppText><ChangeList changes={draft.changes} references={references} issues={scenarioResult.issues} onRemove={removeChange} /></View>
          </View>
          <View style={[styles.resultsColumn, desktop && styles.resultsColumnDesktop]}><ResultsPanel baseline={baselineResult} scenario={scenarioResult} safetyFloor={settings.safety_floor} /></View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

export default function PlanSimulatorScreen() {
  const { loading, isFeatureLocked } = useMembership();
  const c = useColors();
  if (loading) return <SafeAreaView style={[styles.screen, styles.center, { backgroundColor: c.background }]}><ActivityIndicator size="large" color={c.primary} /></SafeAreaView>;
  if (isFeatureLocked("plan_simulator")) return <LockedPlanSimulator />;
  return <PlanSimulatorWorkspace />;
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, center: { alignItems: "center", justifyContent: "center" }, scroll: { flex: 1 }, content: { padding: 16, paddingBottom: 40, gap: 14 }, contentDesktop: { width: "100%", maxWidth: 1480, alignSelf: "center", paddingHorizontal: 28, paddingBottom: 64 },
  header: { minHeight: 88, borderBottomWidth: 1, paddingHorizontal: 18, paddingVertical: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16 }, headerCopy: { flex: 1, maxWidth: 820 }, eyebrow: { fontSize: 10, fontFamily: "Inter_800ExtraBold", letterSpacing: 0.9 }, title: { fontSize: 25, fontFamily: "Inter_800ExtraBold", marginTop: 2 }, subtitle: { fontSize: 13, marginTop: 4, lineHeight: 19 }, closeButton: { width: 44, height: 44, borderRadius: 14, borderWidth: 1, alignItems: "center", justifyContent: "center" }, lockedHeader: { height: 60, alignItems: "flex-end", justifyContent: "center", paddingHorizontal: 16 }, loadingText: { fontSize: 13, marginTop: 12 },
  readOnlyBanner: { borderWidth: 1, borderRadius: 18, padding: 14, flexDirection: "row", gap: 12, alignItems: "center" }, readOnlyCopy: { flex: 1 }, readOnlyTitle: { fontSize: 14, fontFamily: "Inter_800ExtraBold" }, readOnlyText: { fontSize: 12, marginTop: 2, lineHeight: 17 },
  scenarioBar: { borderWidth: 1, borderRadius: 18, padding: 12, flexDirection: "row", alignItems: "flex-end", gap: 10 }, scenarioSelect: { flex: 1, minWidth: 0 }, viewerNote: { borderWidth: 1, borderRadius: 16, padding: 12, flexDirection: "row", gap: 10, alignItems: "center" }, viewerText: { flex: 1, fontSize: 12, lineHeight: 17 }, message: { borderWidth: 1, borderRadius: 14, padding: 12, flexDirection: "row", alignItems: "center", gap: 10 }, messageText: { flex: 1, fontSize: 12 },
  workspace: { gap: 16 }, workspaceDesktop: { flexDirection: "row", alignItems: "flex-start", gap: 20 }, editorColumn: { flex: 1, minWidth: 0, gap: 16 }, resultsColumn: { minWidth: 0 }, resultsColumnDesktop: { width: "42%", maxWidth: 600, position: Platform.OS === "web" ? "sticky" as any : "relative", top: 16 },
  card: { borderWidth: 1, borderRadius: 22, padding: 16 }, cardTitle: { fontSize: 18, fontFamily: "Inter_800ExtraBold" }, cardDescription: { fontSize: 12, marginTop: 4, marginBottom: 12 }, field: { marginTop: 13 }, fieldLabel: { fontSize: 10, fontFamily: "Inter_800ExtraBold", marginBottom: 6 }, input: { width: "100%", minHeight: 44, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, fontFamily: "Inter_500Medium" }, scopeNote: { fontSize: 11, lineHeight: 16, marginTop: 12 },
  button: { minHeight: 44, borderWidth: 1, borderRadius: 12, paddingHorizontal: 13, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 }, buttonText: { fontSize: 12, fontFamily: "Inter_800ExtraBold" }, actionWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 }, savingRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12 }, savingText: { fontSize: 11 },
  chipScroll: { flexGrow: 0, flexShrink: 0 }, chips: { gap: 7, paddingRight: 2 }, chip: { minHeight: 44, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, alignItems: "center", justifyContent: "center" }, chipText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  changeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, changeOption: { width: "48.5%", minHeight: 62, borderWidth: 1, borderRadius: 14, padding: 10, flexDirection: "row", alignItems: "center", gap: 9 }, changeOptionCopy: { flex: 1 }, changeOptionTitle: { fontSize: 12, fontFamily: "Inter_800ExtraBold" }, changeOptionDetail: { fontSize: 10, marginTop: 2, lineHeight: 14 }, errorText: { fontSize: 12, fontFamily: "Inter_600SemiBold", marginVertical: 10 }, editSemantics: { fontSize: 11, lineHeight: 16, marginVertical: 10 },
  sectionTitle: { fontSize: 17, fontFamily: "Inter_800ExtraBold", marginBottom: 10 }, emptyCard: { borderWidth: 1, borderStyle: "dashed", borderRadius: 18, padding: 22, alignItems: "center" }, emptyTitle: { fontSize: 14, fontFamily: "Inter_800ExtraBold" }, emptyText: { fontSize: 12, marginTop: 4, textAlign: "center" }, changeList: { gap: 8 }, changeRow: { minHeight: 60, borderWidth: 1, borderRadius: 14, paddingLeft: 12, paddingRight: 4, paddingVertical: 8, flexDirection: "row", alignItems: "center" }, changeRowCopy: { flex: 1 }, changeRowTitle: { fontSize: 12, fontFamily: "Inter_700Bold" }, changeIssue: { fontSize: 10, fontFamily: "Inter_600SemiBold", marginTop: 3 }, changeOkay: { fontSize: 10, fontFamily: "Inter_600SemiBold", marginTop: 3 },
  resultsCard: { borderWidth: 1, borderRadius: 24, padding: 17 }, resultsHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }, resultsTitle: { fontSize: 20, fontFamily: "Inter_800ExtraBold", marginTop: 2 }, statusBadge: { minHeight: 30, borderRadius: 999, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 5 }, statusText: { fontSize: 10, fontFamily: "Inter_800ExtraBold" }, resultsNote: { fontSize: 11, lineHeight: 16, marginTop: 8 }, attention: { borderWidth: 1, borderRadius: 14, padding: 11, marginTop: 12 }, attentionTitle: { fontSize: 12, fontFamily: "Inter_800ExtraBold", marginBottom: 4 }, attentionText: { fontSize: 11, lineHeight: 16 }, metricsGrid: { gap: 9, marginTop: 14 }, metric: { borderWidth: 1, borderRadius: 15, padding: 12 }, metricLabel: { fontSize: 9, fontFamily: "Inter_800ExtraBold" }, metricValues: { flexDirection: "row", justifyContent: "space-between", gap: 12, marginTop: 7 }, metricScenario: { alignItems: "flex-end", flex: 1 }, metricCaption: { fontSize: 9 }, metricValue: { fontSize: 16, fontFamily: "Inter_800ExtraBold", marginTop: 1 },
  safetyRow: { borderTopWidth: 1, borderBottomWidth: 1, marginTop: 14, paddingVertical: 13, flexDirection: "row", justifyContent: "space-between", gap: 12 }, safetyLabel: { fontSize: 10 }, safetyValue: { fontSize: 16, fontFamily: "Inter_800ExtraBold", marginTop: 2 }, debtImpact: { borderWidth: 1, borderRadius: 16, padding: 13, flexDirection: "row", gap: 11, marginTop: 14 }, debtImpactCopy: { flex: 1 }, debtImpactTitle: { fontSize: 11, fontFamily: "Inter_700Bold" }, debtImpactValue: { fontSize: 18, fontFamily: "Inter_800ExtraBold", marginTop: 2 }, debtImpactNote: { fontSize: 10, marginTop: 2 }, monthSection: { marginTop: 18 }, monthSectionTitle: { fontSize: 16, fontFamily: "Inter_800ExtraBold", marginBottom: 7 }, monthRow: { borderTopWidth: 1, paddingVertical: 11 }, monthRowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, monthName: { fontSize: 12, fontFamily: "Inter_700Bold" }, monthNet: { fontSize: 13, fontFamily: "Inter_800ExtraBold" }, barTrack: { marginTop: 8, gap: 3 }, bar: { height: 4, borderRadius: 2 }, monthDetails: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", marginTop: 7, gap: 7 }, monthDetail: { fontSize: 9 },
});
