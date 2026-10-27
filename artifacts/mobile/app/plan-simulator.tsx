import { SimulatorChoiceChips as ChoiceChips } from "@/components/SimulatorChoiceChips";
import Feather from "@expo/vector-icons/Feather";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocalDay } from "@/hooks/useLocalDay";
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

import { buildSimulationEditorChange, replaceSimulationChange, simulationEditorFields, type SimulationEditorFields } from "@/lib/planSimulationEditor";

import { AppText } from "@/components/AppText";
import { AppLoadingIntro } from "@/components/AppLoadingIntro";
import { DatePickerField } from "@/components/DatePickerField";
import { DataFreshnessLabel } from "@/components/DataFreshnessLabel";
import { PlanFeatureGate } from "@/components/PlanFeatureGate";
import { useAuth } from "@/context/AuthContext";
import { useBudget } from "@/context/BudgetContext";
import { useMembership } from "@/context/MembershipContext";
import { useColors } from "@/hooks/useColors";
import { useDesktopExperience } from "@/hooks/useDesktopExperience";
import { loadCategoryBudgets, readCategoryBudgetCache } from "@/lib/categoryBudgetStore";
import { buildDashboardFinancialModel } from "@/lib/dashboardFinancialModel";
import { FOUNDING_FREE_LAUNCH, canPersistPlanSimulations } from "@/lib/launchMode";
import {
  decodePlanSimulationChanges,
  firstNegativeBalanceDay,
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

const CHANGE_GROUPS = [
  { id: "income", label: "Income" },
  { id: "bills", label: "Bills" },
  { id: "spending", label: "Spending & savings" },
  { id: "debt", label: "Debt" },
] as const;
function changeGroup(type: ChangeKind): typeof CHANGE_GROUPS[number]["id"] {
  return type.startsWith("income_") ? "income" : type.startsWith("bill_") ? "bills" : type.startsWith("debt_") ? "debt" : "spending";
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

function ChangeComposer({
  references,
  startDate,
  endDate,
  editingChange,
  onSave,
  onCancel,
}: {
  references: PlanSimulationReferences;
  startDate: string;
  endDate: string;
  editingChange: PlanSimulationChange | null;
  onSave: (change: PlanSimulationChange) => string | null;
  onCancel: () => void;
}) {
  const c = useColors();
  const [fields, setFields] = useState(() => simulationEditorFields(editingChange, startDate));
  const [error, setError] = useState("");
  const { type, name, amount, date, newDate, frequency, targetId } = fields;
  const setField = <K extends keyof SimulationEditorFields>(key: K, value: SimulationEditorFields[K]) => {
    setFields(previous => ({ ...previous, [key]: value }));
    setError("");
  };
  const group = changeGroup(type);
  const option = CHANGE_OPTIONS.find(item => item.type === type)!;
  const needsIncome = type === "income_edit" || type === "income_pause";
  const needsBill = type === "bill_edit" || type === "bill_pause" || type === "bill_move";
  const needsDebt = type === "debt_payoff";
  const needsName = type === "income_add" || type === "income_once" || type === "bill_add" || type === "spending_once" || type === "savings_once";
  const needsAmount = type !== "income_pause" && type !== "bill_pause" && type !== "bill_move" && type !== "debt_payoff";
  const isRecurringAdd = type === "income_add" || type === "bill_add";
  const targetChoices = needsIncome
    ? references.incomes.map(income => ({ id: income.id, label: income.name }))
    : needsBill ? references.bills.filter(bill => !bill.isDebt).map(bill => ({ id: bill.id, label: bill.name }))
    : needsDebt ? references.debts.filter(debt => debt.balance > 0.005 && (!debt.endDate || debt.endDate.slice(0, 10) >= startDate)).map(debt => ({ id: debt.id, label: `${debt.name} · ${money(debt.balance)}` })) : [];
  const missingTarget = Boolean(targetId && !targetChoices.some(item => item.id === targetId));
  const outsideRange = date < startDate || date > endDate || type === "bill_move" && (newDate < startDate || newDate > endDate);
  const selectType = (next: ChangeKind) => {
    if (editingChange) return;
    setFields({ ...simulationEditorFields(null, startDate), type: next });
    setError("");
  };
  const save = () => {
    const result = buildSimulationEditorChange(fields, editingChange?.id ?? nextLocalId(), references, startDate, endDate);
    if (!result.change) { setError(result.error); return; }
    const failure = onSave(result.change);
    if (failure) { setError(failure); return; }
    setError("");
    if (!editingChange) setFields(previous => ({ ...previous, amount: "", name: "" }));
  };

  return (
    <View style={[styles.card, { backgroundColor: c.card, borderColor: editingChange ? c.primary : c.border }]}>
      <View style={styles.composerHeading}>
        <View style={[styles.editorIcon, { backgroundColor: c.primary + "18" }]}><Feather name={editingChange ? "edit-3" : "sliders"} size={20} color={c.primary} /></View>
        <View style={styles.changeOptionCopy}><AppText accessibilityRole="header" tone="title" style={[styles.cardTitle, { color: c.foreground }]}>{editingChange ? "Edit scenario change" : "Add a what-if change"}</AppText><AppText style={[styles.cardDescription, { color: c.mutedForeground }]}>{editingChange ? `${option.label} · your original change stays in place until you update it.` : "Choose an area, then set the change you want to compare."}</AppText></View>
      </View>
      {!editingChange ? <>
        <View accessibilityRole="radiogroup" accessibilityLabel="Change category" style={styles.categoryTabs}>
          {CHANGE_GROUPS.map(item => <Pressable key={item.id} accessibilityRole="radio" accessibilityLabel={item.label} accessibilityState={{ checked: item.id === group }} aria-checked={item.id === group} onPress={() => selectType(CHANGE_OPTIONS.find(change => changeGroup(change.type) === item.id)!.type)} style={[styles.categoryTab, { borderColor: item.id === group ? c.primary : c.border, backgroundColor: item.id === group ? c.primary : c.background }]}><AppText style={[styles.categoryTabText, { color: item.id === group ? c.primaryForeground : c.foreground }]}>{item.label}</AppText></Pressable>)}
        </View>
        <View accessibilityRole="radiogroup" accessibilityLabel="Change type" style={styles.changeGrid}>
          {CHANGE_OPTIONS.filter(item => changeGroup(item.type) === group).map(item => {
            const active = item.type === type;
            return <Pressable key={item.type} accessibilityRole="radio" accessibilityLabel={item.label} accessibilityState={{ checked: active }} aria-checked={active} onPress={() => selectType(item.type)} style={({ pressed }) => [styles.changeOption, { backgroundColor: active ? c.primary + "12" : c.background, borderColor: active ? c.primary : c.border, opacity: pressed ? 0.72 : 1 }]}><Feather name={item.icon} size={18} color={active ? c.primary : c.mutedForeground} /><View style={styles.changeOptionCopy}><AppText style={[styles.changeOptionTitle, { color: c.foreground }]}>{item.label}</AppText><AppText style={[styles.changeOptionDetail, { color: c.mutedForeground }]}>{item.detail}</AppText></View></Pressable>;
          })}
        </View>
      </> : <View style={[styles.editingBadge, { backgroundColor: c.primary + "12" }]}><Feather name={option.icon} size={16} color={c.primary} /><AppText style={[styles.editingBadgeText, { color: c.primary }]}>{option.label}</AppText></View>}
      {needsIncome || needsBill || needsDebt ? <View style={styles.field}><FieldLabel>{needsIncome ? "Income" : needsDebt ? "Debt" : "Bill"}</FieldLabel>
        {missingTarget ? <AppText accessibilityRole="alert" style={[styles.errorText, { color: c.warning }]}>The original {needsIncome ? "income" : needsDebt ? "debt" : "bill"} is unavailable. Choose a replacement below.</AppText> : null}
        {targetChoices.length ? <ChoiceChips values={targetChoices} selected={targetId} onSelect={id => setField("targetId", id)} desktopDebtNavigation={needsDebt} /> : <AppText style={[styles.editSemantics, { color: c.mutedForeground }]}>No eligible {needsIncome ? "incomes" : needsDebt ? "open debts" : "non-debt bills"} are available. Add one to your live plan first.</AppText>}
      </View> : null}
      {needsName ? <View style={styles.field}><FieldLabel>Name</FieldLabel><Input label="Change name" value={name} onChangeText={value => setField("name", value)} placeholder={type === "savings_once" ? "Emergency fund" : "Name this change"} /></View> : null}
      {needsAmount ? <View style={styles.field}><FieldLabel>Amount</FieldLabel><Input label="Change amount" value={amount} onChangeText={value => setField("amount", value)} placeholder="0.00" keyboardType="decimal-pad" /></View> : null}
      {isRecurringAdd ? <View style={styles.field}><FieldLabel>Frequency</FieldLabel><ChoiceChips values={(type === "bill_add" ? ["monthly", "quarterly", "biweekly", "weekly"] : ["monthly", "biweekly", "weekly"]).map(id => ({ id, label: id[0].toUpperCase() + id.slice(1) }))} selected={frequency} onSelect={value => setField("frequency", value)} /></View> : null}
      <View style={styles.field}><FieldLabel>{type === "bill_move" ? "Occurrence date" : type.endsWith("_pause") || type.endsWith("_edit") ? "Effective date" : "Date"}</FieldLabel><DatePickerField value={date} onChange={value => setField("date", value)} minDate={startDate} maxDate={endDate} placeholder="Choose a date" /></View>
      {type === "bill_move" ? <View style={styles.field}><FieldLabel>New date</FieldLabel><DatePickerField value={newDate} onChange={value => setField("newDate", value)} minDate={startDate} maxDate={endDate} placeholder="Choose a new date" /></View> : null}
      {outsideRange ? <AppText accessibilityRole="alert" style={[styles.errorText, { color: c.warning }]}>This change has a date outside the selected horizon. Choose dates from {shortDate(startDate)} to {shortDate(endDate)}.</AppText> : null}
      {error ? <AppText accessibilityRole="alert" style={[styles.errorText, { color: c.destructive }]}>{error}</AppText> : null}
      {type === "income_edit" || type === "bill_edit" ? <AppText style={[styles.editSemantics, { color: c.mutedForeground }]}>The new amount is the full intended occurrence total. Settled amounts stay unchanged; only the remaining Forecast amount is replaced.</AppText> : null}
      {type === "debt_payoff" ? <AppText style={[styles.editSemantics, { color: c.mutedForeground }]}>Flo tests paying that debt’s remaining balance on the selected date. It does not change the real debt or schedule a payment.</AppText> : null}
      <View style={styles.composerActions}><Button label={editingChange ? "Update change" : "Add to scenario"} icon={editingChange ? "check" : "plus"} onPress={save} primary />{editingChange ? <Button label="Cancel editing" onPress={onCancel} /> : null}</View>
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

function changeSummary(change: PlanSimulationChange) {
  const date = "effectiveDate" in change ? `From ${shortDate(change.effectiveDate)}` : "startDate" in change ? `From ${shortDate(change.startDate)}` : "occurrenceDate" in change ? `${shortDate(change.occurrenceDate)} → ${shortDate(change.newDate)}` : shortDate(change.date);
  return ["amount" in change ? money(change.amount) : null, "frequency" in change ? change.frequency[0].toUpperCase() + change.frequency.slice(1) : null, date].filter(Boolean).join(" · ");
}

function ChangeList({ changes, references, issues, editingId, onEdit, onRemove }: { changes: PlanSimulationChange[]; references: PlanSimulationReferences; issues: PlanSimulationResult["issues"]; editingId: string | null; onEdit: (id: string) => void; onRemove: (id: string) => void }) {
  const c = useColors();
  if (!changes.length) return <View style={[styles.emptyCard, { borderColor: c.border }]}><View style={[styles.editorIcon, { backgroundColor: c.primary + "12" }]}><Feather name="git-branch" size={21} color={c.primary} /></View><AppText style={[styles.emptyTitle, { color: c.foreground }]}>Start with one small change</AppText><AppText style={[styles.emptyText, { color: c.mutedForeground }]}>Add income, adjust a bill or test a purchase below. Your comparison updates as you go.</AppText></View>;
  return <View style={styles.changeList}>{changes.map((change, index) => {
    const issue = issues.find(item => item.changeId === change.id);
    const label = changeLabel(change, references);
    const active = editingId === change.id;
    return <View key={change.id} style={[styles.changeRow, { backgroundColor: c.card, borderColor: active ? c.primary : issue ? c.warning : c.border }]}>
      <View style={styles.changeRowTop}><View style={[styles.changeNumber, { backgroundColor: c.primary + "12" }]}><AppText style={{ color: c.primary, fontFamily: "Inter_700Bold" }}>{index + 1}</AppText></View><View style={styles.changeRowCopy}><AppText style={[styles.changeRowTitle, { color: c.foreground }]}>{label}</AppText><AppText style={[styles.changeSummary, { color: c.mutedForeground }]}>{changeSummary(change)}</AppText></View></View>
      {issue ? <AppText style={[styles.changeIssue, { color: c.warning }]}>{issue.message}</AppText> : null}
      <View style={styles.changeRowActions}><Pressable accessibilityRole="button" accessibilityLabel={`Edit ${label}`} accessibilityState={{ selected: active }} onPress={() => onEdit(change.id)} style={[styles.changeAction, { backgroundColor: c.primary + "12" }]}><Feather name="edit-3" size={15} color={c.primary} /><AppText style={[styles.changeActionText, { color: c.primary }]}>{active ? "Editing" : "Edit"}</AppText></Pressable><Pressable accessibilityRole="button" accessibilityLabel={`Remove ${label}`} onPress={() => onRemove(change.id)} style={styles.changeAction}><Feather name="trash-2" size={15} color={c.mutedForeground} /><AppText style={[styles.changeActionText, { color: c.mutedForeground }]}>Remove</AppText></Pressable></View>
    </View>;
  })}</View>;
}

function Metric({ label, real, scenario, tone }: { label: string; real: string; scenario: string; tone?: "good" | "warn" }) {
  const c = useColors();
  const { width } = useWindowDimensions();
  const stacked = width < 600;
  const scenarioColor = tone === "good" ? c.success : tone === "warn" ? c.warning : c.foreground;
  return (
    <View style={[styles.metric, { backgroundColor: c.background, borderColor: c.border }]}>
      <AppText tone="label" style={[styles.metricLabel, { color: c.mutedForeground }]}>{label}</AppText>
      <View style={[styles.metricValues, stacked && styles.metricValuesStack]}><View style={styles.metricReal}><AppText style={[styles.metricCaption, { color: c.mutedForeground }]}>Real plan</AppText><AppText tone="number" style={[styles.metricValue, { color: c.foreground }]}>{real}</AppText></View><View style={[styles.metricScenario, stacked && styles.metricScenarioStack]}><AppText style={[styles.metricCaption, { color: c.mutedForeground }]}>Scenario</AppText><AppText tone="number" style={[styles.metricValue, !stacked && styles.metricValueRight, { color: scenarioColor }]}>{scenario}</AppText></View></View>
    </View>
  );
}

function ResultsPanel({ baseline, scenario, safetyFloor }: { baseline: PlanSimulationResult; scenario: PlanSimulationResult; safetyFloor: number }) {
  const c = useColors();
  const maxFlow = Math.max(1, ...scenario.months.flatMap(month => [month.inflows, month.outflows]));
  const baselineNegativeDay = firstNegativeBalanceDay(baseline.days);
  const scenarioNegativeDay = firstNegativeBalanceDay(scenario.days);
  return (
    <View style={[styles.resultsCard, { backgroundColor: c.card, borderColor: c.border }]}>
      <View style={styles.resultsHeader}><View><AppText tone="label" style={[styles.eyebrow, { color: c.primary }]}>FORECAST COMPARISON</AppText><AppText tone="title" style={[styles.resultsTitle, { color: c.foreground }]}>See the difference</AppText></View>{scenario.complete ? <View style={[styles.statusBadge, { backgroundColor: c.success + "18" }]}><Feather name="check" size={12} color={c.success} /><AppText style={[styles.statusText, { color: c.success }]}>Complete</AppText></View> : <View style={[styles.statusBadge, { backgroundColor: c.warning + "18" }]}><Feather name="edit-3" size={12} color={c.warning} /><AppText style={[styles.statusText, { color: c.warning }]}>Ready to adjust</AppText></View>}</View>
      <AppText style={[styles.resultsNote, { color: c.mutedForeground }]}>Recalculated from your latest real plan. Nothing here changes Forecast, balances, bills, or debt.</AppText>
      {!scenario.complete ? <View accessibilityRole="alert" style={[styles.attention, { backgroundColor: c.warning + "12", borderColor: c.warning + "45" }]}><AppText style={[styles.attentionTitle, { color: c.warning }]}>Repair or remove stale changes</AppText>{scenario.issues.map(issue => <AppText key={`${issue.changeId}:${issue.message}`} style={[styles.attentionText, { color: c.foreground }]}>• {issue.message}</AppText>)}</View> : null}
      {scenario.complete && (scenarioNegativeDay || baselineNegativeDay) ? <View accessibilityRole="alert" style={[styles.attention, { backgroundColor: c.destructive + "12", borderColor: c.destructive + "55" }]}><View style={styles.negativeHeader}><Feather name="alert-triangle" size={16} color={c.destructive} /><AppText style={[styles.attentionTitle, { color: c.destructive }]}>Below-zero warning</AppText></View>{scenarioNegativeDay ? <AppText style={[styles.attentionText, { color: c.foreground }]}>This scenario first takes the account below $0 on <AppText style={{ color: c.destructive, fontFamily: "Inter_800ExtraBold" }}>{shortDate(scenarioNegativeDay.date)}</AppText>, reaching {money(scenarioNegativeDay.balance)}.</AppText> : <AppText style={[styles.attentionText, { color: c.foreground }]}>This scenario stays above $0 through {shortDate(scenario.days.at(-1)?.date ?? "")}. Your real plan first falls below $0 on <AppText style={{ color: c.destructive, fontFamily: "Inter_800ExtraBold" }}>{shortDate(baselineNegativeDay!.date)}</AppText>, reaching {money(baselineNegativeDay!.balance)}.</AppText>}{scenarioNegativeDay && baselineNegativeDay && scenarioNegativeDay.date !== baselineNegativeDay.date ? <AppText style={[styles.attentionText, { color: c.mutedForeground, marginTop: 5 }]}>Your real plan first falls below $0 on {shortDate(baselineNegativeDay.date)}.</AppText> : null}</View> : null}
      <View style={styles.metricsGrid}>
        <Metric label="Ending balance" real={money(baseline.endingBalance)} scenario={money(scenario.endingBalance)} tone={scenario.endingBalance >= baseline.endingBalance ? "good" : "warn"} />
        <Metric label="Tightest forecast point" real={`${money(baseline.lowestBalance)} · ${shortDate(baseline.lowestBalanceDate)}`} scenario={`${money(scenario.lowestBalance)} · ${shortDate(scenario.lowestBalanceDate)}`} tone={scenario.lowestBalance >= safetyFloor ? "good" : "warn"} />
        <Metric label="Flow Score" real={`${baseline.flowScore}`} scenario={`${scenario.flowScore}`} tone={scenario.flowScore >= baseline.flowScore ? "good" : "warn"} />
        <Metric label="Protected Days" real={`${baseline.protectedDays} days`} scenario={`${scenario.protectedDays} days`} tone={scenario.protectedDays >= baseline.protectedDays ? "good" : "warn"} />
      </View>
      <View style={[styles.safetyRow, { borderColor: c.border }]}><View><AppText style={[styles.safetyLabel, { color: c.mutedForeground }]}>Current safety floor</AppText><AppText tone="number" style={[styles.safetyValue, { color: c.foreground }]}>{money(safetyFloor)}</AppText></View><View><AppText style={[styles.safetyLabel, { color: c.mutedForeground }]}>Hypothetical savings added</AppText><AppText tone="number" style={[styles.safetyValue, { color: c.success }]}>{money(scenario.savingsAdded)}</AppText></View></View>
      <View style={[styles.debtImpact, { backgroundColor: c.background, borderColor: c.border }]}><Feather name="trending-down" size={18} color={c.primary} /><View style={styles.debtImpactCopy}><AppText style={[styles.debtImpactTitle, { color: c.foreground }]}>Potential debt-free date</AppText><AppText style={[styles.debtImpactValue, { color: c.primary }]}>{scenario.potentialDebtFreeDate ?? "Not available"}</AppText><AppText style={[styles.debtImpactNote, { color: c.mutedForeground }]}>{scenario.payoffImpactMonths === null ? "Complete the debt details to compare payoff timing." : scenario.payoffImpactMonths > 0 ? `${scenario.payoffImpactMonths} month${scenario.payoffImpactMonths === 1 ? "" : "s"} sooner` : scenario.payoffImpactMonths < 0 ? `${Math.abs(scenario.payoffImpactMonths)} month${scenario.payoffImpactMonths === -1 ? "" : "s"} later` : "Same payoff timing"}</AppText></View></View>
      <View style={styles.monthSection}><AppText tone="title" style={[styles.monthSectionTitle, { color: c.foreground }]}>Scenario timeline</AppText>{scenario.months.map(month => <View key={month.month} style={[styles.monthRow, { borderColor: c.border }]}><View style={styles.monthRowTop}><AppText style={[styles.monthName, { color: c.foreground }]}>{monthLabel(month.month)}</AppText><AppText tone="number" style={[styles.monthNet, { color: month.cashRemaining >= 0 ? c.success : c.destructive }]}>{money(month.cashRemaining)}</AppText></View><View style={styles.barTrack}><View style={[styles.bar, { backgroundColor: c.success, width: `${Math.max(2, month.inflows / maxFlow * 100)}%` }]} /><View style={[styles.bar, { backgroundColor: c.primary, width: `${Math.max(2, month.outflows / maxFlow * 100)}%` }]} /></View><View style={styles.monthDetails}><AppText style={[styles.monthDetail, { color: c.mutedForeground }]}>In {money(month.inflows)}</AppText><AppText style={[styles.monthDetail, { color: c.mutedForeground }]}>Out {money(month.outflows)}</AppText><AppText style={[styles.monthDetail, { color: c.mutedForeground }]}>Ends {money(month.endingBalance)}</AppText></View></View>)}</View>
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

function PlanSimulatorWorkspace({ canPersistScenarios }: { canPersistScenarios: boolean }) {
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
  const startDate = useLocalDay();
  const now = useMemo(() => new Date(`${startDate}T12:00:00`), [startDate]);
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editorVersion, setEditorVersion] = useState(0);
  const [editorRevealVersion, setEditorRevealVersion] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const editorRef = useRef<View>(null);
  const workspaceYRef = useRef(0);
  const editorYRef = useRef(0);
  const editingChange = draft.changes.find(change => change.id === editingId) ?? null;
  useEffect(() => {
    if (!editingId) return;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({ y: workspaceYRef.current + editorYRef.current - 12, animated: true });
        if (Platform.OS === "web") (editorRef.current as unknown as { focus?: (options: { preventScroll: boolean }) => void })?.focus?.({ preventScroll: true });
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [editingId, editorRevealVersion]);
  const selectedScenario = useMemo(() => scenarios.find(item => item.id === selectedId) ?? null, [scenarios, selectedId]);
  const foundingFreeLocalOnly = FOUNDING_FREE_LAUNCH && !canPersistScenarios;
  const keepsLocalDraft = foundingFreeLocalOnly || !canEditHousehold;
  const draftLoadScope = JSON.stringify([draftStorageKey, householdId, canPersistScenarios, defaultHorizon, demoMode, keepsLocalDraft]);
  const draftLoadScopeRef = useRef(draftLoadScope);
  draftLoadScopeRef.current = draftLoadScope;
  const [loadedDraftScope, setLoadedDraftScope] = useState<string | null>(null);

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
    setLoadedDraftScope(null);
    setEditingId(null);
    setEditorVersion(previous => previous + 1);
    setMessage("");
    setScenarios([]);
    setSelectedId(null);
    setDraft({ name: "Untitled scenario", horizonMonths: defaultHorizon, changes: [] });
    void (async () => {
      try {
        const [rows, storedDraft] = await Promise.all([
          !canPersistScenarios || demoMode || householdId === "local" ? Promise.resolve([]) : loadPlanSimulations(householdId),
          keepsLocalDraft && draftStorageKey ? AsyncStorage.getItem(draftStorageKey) : Promise.resolve(null),
        ]);
        if (cancelled || draftLoadScopeRef.current !== draftLoadScope) return;
        setScenarios(rows);
        if (keepsLocalDraft && storedDraft) {
          const parsed = JSON.parse(storedDraft) as Partial<DraftState>;
          const changes = decodePlanSimulationChanges(parsed.changes);
          if (typeof parsed.name === "string" && isPlanSimulationHorizon(parsed.horizonMonths) && changes) setDraft({ name: parsed.name, horizonMonths: parsed.horizonMonths, changes });
        }
      } catch (error) {
        if (!cancelled && draftLoadScopeRef.current === draftLoadScope) setMessage(error instanceof Error ? error.message : "Plan Simulator could not load household scenarios.");
      } finally {
        if (!cancelled && draftLoadScopeRef.current === draftLoadScope) { setLoadedDraftScope(draftLoadScope); setLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, [canPersistScenarios, defaultHorizon, demoMode, draftStorageKey, householdId, keepsLocalDraft, draftLoadScope]);

  useEffect(() => {
    if (!keepsLocalDraft || !draftStorageKey || loading || loadedDraftScope !== draftLoadScope) return;
    void AsyncStorage.setItem(draftStorageKey, JSON.stringify(draft)).catch(() => undefined);
  }, [draft, draftStorageKey, keepsLocalDraft, loading, loadedDraftScope, draftLoadScope]);

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
      minimum: Math.max(0, bill.amount),
      monthlyRolloverExtra: Math.max(0, Number(bill.snowball_minimum_boost ?? 0)),
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
    flowScoreRequiredAmountDue: dashboardModel.algorithmSuite.flowScore.requiredAmountDue,
    flowScoreRequiredAmountCovered: dashboardModel.algorithmSuite.flowScore.requiredAmountCovered,
    protectedDays: dashboardModel.algorithmSuite.stability.protectedDays,
    requiredMonthlyOutflow: dashboardModel.algorithmSuite.stability.reserveTarget,
    forecastConfidence: forecastConfidence.level,
    currentDebtFreeDate: livePayoffPreview?.debtFreeDate ?? null,
  }), [dashboardModel.algorithmSuite.flowScore.requiredAmountCovered, dashboardModel.algorithmSuite.flowScore.requiredAmountDue, dashboardModel.algorithmSuite.flowScore.score, dashboardModel.algorithmSuite.stability.protectedDays, dashboardModel.algorithmSuite.stability.reserveTarget, forecastConfidence.level, livePayoffPreview?.debtFreeDate]);
  const baselineResult = useMemo(() => projectPlanSimulation({ baseline, changes: [], references, metrics, safetyFloor: settings.safety_floor }), [baseline, metrics, references, settings.safety_floor]);
  const scenarioResult = useMemo(() => projectPlanSimulation({
    baseline,
    changes: draft.changes,
    references,
    metrics,
    safetyFloor: settings.safety_floor,
    definitionIssue: draft.invalidDefinition ? "This scenario uses an unsupported definition. Reset it before continuing." : null,
  }), [baseline, draft.changes, draft.invalidDefinition, metrics, references, settings.safety_floor]);

  const selectScenario = useCallback((scenario: PlanSimulationDefinition) => {
    setEditingId(null);
    setEditorVersion(previous => previous + 1);
    setSelectedId(scenario.id);
    setDraft({ name: scenario.name, horizonMonths: scenario.horizonMonths, changes: scenario.changes, invalidDefinition: scenario.invalidDefinition });
    setMessage(scenario.invalidDefinition ? "This scenario has an unsupported definition. Choose Reset before continuing." : "");
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
    setEditingId(previous => previous === id ? null : previous);
    makeLocalDraft();
    setDraft(previous => ({ ...previous, changes: previous.changes.filter(change => change.id !== id) }));
  }, [makeLocalDraft]);
  const saveChange = useCallback((change: PlanSimulationChange): string | null => {
    if (draft.invalidDefinition) return "Reset the unsupported scenario definition before changing it.";
    if (editingId) {
      const next = replaceSimulationChange(draft.changes, editingId, change);
      if (!next) return "This change is no longer available to edit. Cancel and choose it again.";
      makeLocalDraft();
      setDraft(previous => {
        const replacement = replaceSimulationChange(previous.changes, editingId, change);
        return replacement ? { ...previous, changes: replacement } : previous;
      });
      setEditingId(null);
    } else {
      if (!decodePlanSimulationChanges([...draft.changes, change])) return "A scenario supports up to 50 valid changes. Remove a change before adding another.";
      addChange(change);
    }
    return null;
  }, [addChange, draft.changes, draft.invalidDefinition, editingId, makeLocalDraft]);
  const cancelEditing = useCallback(() => { setEditingId(null); setEditorVersion(previous => previous + 1); }, []);
  const newDraft = useCallback(() => {
    setEditingId(null);
    setEditorVersion(previous => previous + 1);
    setSelectedId(null);
    setDraft({ name: "Untitled scenario", horizonMonths: defaultHorizon, changes: [] });
    setMessage("");
  }, [defaultHorizon]);
  const resetDraft = useCallback(() => {
    setEditingId(null);
    setEditorVersion(previous => previous + 1);
    if (selectedScenario?.invalidDefinition) {
      setDraft({ name: selectedScenario.name, horizonMonths: selectedScenario.horizonMonths, changes: [], invalidDefinition: false });
      setMessage("Unsupported changes were cleared. Review the empty scenario before continuing.");
      return;
    }
    if (selectedScenario) setDraft({ name: selectedScenario.name, horizonMonths: selectedScenario.horizonMonths, changes: selectedScenario.changes });
    else setDraft({ name: "Untitled scenario", horizonMonths: defaultHorizon, changes: [] });
    setMessage("Draft reset.");
  }, [defaultHorizon, selectedScenario]);
  const saveDraft = useCallback(async () => {
    if (editingId) { setMessage("Update or cancel this change first."); return; }
    if (!canPersistScenarios) { setMessage("Founding Free keeps this draft on this device. Household scenario saving is planned for Pro."); return; }
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
  }, [canEditHousehold, canPersistScenarios, demoMode, draft, editingId, householdId, selectedScenario]);
  const duplicate = useCallback(async () => {
    if (editingId) { setMessage("Update or cancel this change first."); return; }
    if (!canPersistScenarios) { setMessage("Founding Free uses one private on-device draft. Household scenario copies are planned for Pro."); return; }
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
  }, [canEditHousehold, canPersistScenarios, demoMode, draft, editingId, householdId, scenarios, selectScenario]);
  const removeScenario = useCallback(() => {
    if (!canPersistScenarios || !selectedScenario || !canEditHousehold || demoMode) return;
    Alert.alert("Delete scenario?", `Delete “${selectedScenario.name}”? Your real plan will not change.`, [{ text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: () => { setSaving(true); void deletePlanSimulation(selectedScenario).then(() => { setScenarios(previous => previous.filter(item => item.id !== selectedScenario.id)); newDraft(); setMessage("Scenario deleted. Your real plan was not changed."); }).catch(error => setMessage(error instanceof Error ? error.message : "Scenario could not be deleted.")).finally(() => setSaving(false)); } }]);
  }, [canEditHousehold, canPersistScenarios, demoMode, newDraft, selectedScenario]);

  if (loading) return <AppLoadingIntro phase="simulator" accessibilityLabel="FlowLedger is opening Plan Simulator" />;

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: c.background }]} edges={["top", "bottom"]}>
      <View style={[styles.header, { borderColor: c.border, backgroundColor: c.background }]}>
        <View style={styles.headerCopy}><AppText tone="label" style={[styles.eyebrow, { color: c.primary }]}>{foundingFreeLocalOnly ? "FOUNDING FREE PLAN SIMULATOR" : "PRO PLAN SIMULATOR"}</AppText><AppText accessibilityRole="header" tone="title" style={[styles.title, { color: c.foreground }]}>Plan Simulator</AppText><AppText style={[styles.subtitle, { color: c.mutedForeground }]}>{foundingFreeLocalOnly ? "Try a different plan. See the impact before you make a decision. Nothing changes your real plan." : "Explore a what-if scenario alongside your real Forecast."}</AppText><DataFreshnessLabel compact /></View>
        <Pressable accessibilityRole="button" accessibilityLabel="Close Plan Simulator" onPress={() => safeClose(router)} style={({ pressed }) => [styles.closeButton, { backgroundColor: c.card, borderColor: c.border, opacity: pressed ? 0.66 : 1 }]}><Feather name="x" size={21} color={c.foreground} /></Pressable>
      </View>
      <ScrollView ref={scrollRef} style={styles.scroll} contentContainerStyle={[styles.content, desktop && styles.contentDesktop]} keyboardShouldPersistTaps="handled">
        <View style={[styles.readOnlyBanner, { backgroundColor: c.primary + "12", borderColor: c.primary + "40" }]}><Feather name="shield" size={18} color={c.primary} /><View style={styles.readOnlyCopy}><AppText style={[styles.readOnlyTitle, { color: c.foreground }]}>{foundingFreeLocalOnly ? "Private on-device draft" : "Simulation only"}</AppText><AppText style={[styles.readOnlyText, { color: c.mutedForeground }]}>{foundingFreeLocalOnly ? "Founding Free keeps this draft on this device and does not sync it to your household. Your financial plan stays unchanged." : "There is no Apply action. Balances, APR, safety floor, goals, bills, debt, and past activity stay unchanged."}</AppText></View></View>
        <View style={[styles.scenarioBar, { backgroundColor: c.card, borderColor: c.border }]}>
          <View style={styles.scenarioSelect}><FieldLabel>Scenario</FieldLabel><ChoiceChips values={[{ id: "draft", label: "Local draft" }, ...scenarios.map(item => ({ id: item.id, label: item.invalidDefinition ? `${item.name} · Ready to adjust` : item.name }))]} selected={selectedId ?? "draft"} onSelect={id => { if (id === "draft") newDraft(); else { const scenario = scenarios.find(item => item.id === id); if (scenario) selectScenario(scenario); } }} /></View>
          <Button label={foundingFreeLocalOnly ? "New local draft" : "New"} icon="plus" onPress={newDraft} />
        </View>
        {!canEditHousehold && canPersistScenarios ? <View style={[styles.viewerNote, { backgroundColor: c.warning + "12", borderColor: c.warning + "40" }]}><Feather name="eye" size={16} color={c.warning} /><AppText style={[styles.viewerText, { color: c.foreground }]}>View-only access: saved household scenarios are readable. Any changes you try are kept as a private local draft and cannot be saved.</AppText></View> : null}
        {message ? <View accessibilityRole="alert" style={[styles.message, { backgroundColor: c.card, borderColor: c.border }]}><AppText style={[styles.messageText, { color: c.foreground }]}>{message}</AppText><Pressable accessibilityRole="button" accessibilityLabel="Dismiss message" onPress={() => setMessage("")} hitSlop={8}><Feather name="x" size={16} color={c.mutedForeground} /></Pressable></View> : null}
        <View onLayout={event => { workspaceYRef.current = event.nativeEvent.layout.y; }} style={[styles.workspace, desktop && styles.workspaceDesktop]}>
          <View style={styles.editorColumn}>
            <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
              <AppText tone="title" style={[styles.cardTitle, { color: c.foreground }]}>Your scenario</AppText>
              <View style={styles.field}><FieldLabel>Name</FieldLabel><Input label="Scenario name" value={draft.name} onChangeText={name => { makeLocalDraft(); setDraft(previous => ({ ...previous, name })); }} placeholder="Name this scenario" /></View>
              <View style={styles.field}><FieldLabel>Compare over</FieldLabel><ChoiceChips values={PLAN_SIMULATION_HORIZONS.map(value => ({ id: String(value), label: `${value} months` }))} selected={String(draft.horizonMonths)} onSelect={value => { makeLocalDraft(); setDraft(previous => ({ ...previous, horizonMonths: Number(value) as PlanSimulationHorizon })); }} /></View>
              <AppText style={[styles.scopeNote, { color: c.mutedForeground }]}>{foundingFreeLocalOnly ? "This draft is saved only on this device. Household scenario sync and saved copies are planned for Pro." : "Saved scenarios store only their name and hypothetical changes. Every result is rebuilt from the latest live Forecast."}</AppText>
              {editingId ? <AppText accessibilityRole="alert" style={[styles.editSemantics, { color: c.primary }]}>Update or cancel this change first. Reset or choose another scenario to discard this edit.</AppText> : null}
              <View style={styles.actionWrap}>{foundingFreeLocalOnly ? <Button label={draft.invalidDefinition ? "Reset unsupported changes" : "Reset local draft"} icon="rotate-ccw" onPress={resetDraft} disabled={saving} /> : <><Button label={selectedScenario ? "Save changes" : "Save"} icon="save" onPress={() => void saveDraft()} disabled={!canEditHousehold || saving || demoMode || Boolean(draft.invalidDefinition) || Boolean(editingId)} primary /><Button label="Rename" icon="type" onPress={() => void saveDraft()} disabled={!selectedScenario || !canEditHousehold || saving || demoMode || Boolean(draft.invalidDefinition) || Boolean(editingId)} /><Button label="Duplicate" icon="copy" onPress={() => void duplicate()} disabled={!canEditHousehold || saving || demoMode || Boolean(draft.invalidDefinition) || Boolean(editingId)} /><Button label={draft.invalidDefinition ? "Reset unsupported changes" : "Reset"} icon="rotate-ccw" onPress={resetDraft} disabled={saving} /><Button label="Delete" icon="trash-2" onPress={removeScenario} disabled={!selectedScenario || !canEditHousehold || saving || demoMode} danger /></>}</View>
              {saving && canPersistScenarios ? <View style={styles.savingRow}><ActivityIndicator size="small" color={c.primary} /><AppText style={[styles.savingText, { color: c.mutedForeground }]}>Saving scenario…</AppText></View> : null}
            </View>
            <View><View style={styles.sectionHeading}><AppText accessibilityRole="header" tone="title" style={[styles.sectionTitle, { color: c.foreground }]}>Your changes</AppText><View style={[styles.countBadge, { backgroundColor: c.primary + "12" }]}><AppText style={{ color: c.primary, fontFamily: "Inter_700Bold", fontSize: 12 }}>{draft.changes.length}</AppText></View></View><ChangeList changes={draft.changes} references={references} issues={scenarioResult.issues} editingId={editingId} onEdit={id => { setEditingId(id); setEditorRevealVersion(previous => previous + 1); }} onRemove={removeChange} /></View>
            {!draft.invalidDefinition ? <View ref={editorRef} focusable tabIndex={-1} accessibilityLabel={editingChange ? `Editing ${changeLabel(editingChange, references)}` : "Add a scenario change"} onLayout={event => { editorYRef.current = event.nativeEvent.layout.y; }}><ChangeComposer key={`${draftStorageKey ?? householdId}:${editorVersion}:${editingId ?? "new"}`} references={references} startDate={startDate} endDate={baseline.endDate} editingChange={editingChange} onSave={saveChange} onCancel={cancelEditing} /></View> : <AppText accessibilityRole="alert" style={[styles.editSemantics, { color: c.warning }]}>Reset unsupported changes before adding or editing this scenario.</AppText>}

          </View>
          <View style={[styles.resultsColumn, desktop && styles.resultsColumnDesktop]}><ResultsPanel baseline={baselineResult} scenario={scenarioResult} safetyFloor={settings.safety_floor} /></View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

export default function PlanSimulatorScreen() {
  const { actualPlan, loading, isFeatureLocked } = useMembership();
  if (loading) return <AppLoadingIntro phase="simulator" accessibilityLabel="FlowLedger is opening Plan Simulator" />;
  if (isFeatureLocked("plan_simulator")) return <LockedPlanSimulator />;
  return <PlanSimulatorWorkspace canPersistScenarios={canPersistPlanSimulations(actualPlan)} />;
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, scroll: { flex: 1 }, content: { padding: 16, paddingBottom: 40, gap: 14 }, contentDesktop: { width: "100%", maxWidth: 1480, alignSelf: "center", paddingHorizontal: 28, paddingBottom: 64 },
  header: { minHeight: 88, borderBottomWidth: 1, paddingHorizontal: 18, paddingVertical: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16 }, headerCopy: { flex: 1, maxWidth: 820 }, eyebrow: { fontSize: 10, fontFamily: "Inter_800ExtraBold", letterSpacing: 0.9 }, title: { fontSize: 25, fontFamily: "Inter_800ExtraBold", marginTop: 2 }, subtitle: { fontSize: 13, marginTop: 4, lineHeight: 19 }, closeButton: { width: 44, height: 44, borderRadius: 14, borderWidth: 1, alignItems: "center", justifyContent: "center" }, lockedHeader: { height: 60, alignItems: "flex-end", justifyContent: "center", paddingHorizontal: 16 },
  readOnlyBanner: { borderWidth: 1, borderRadius: 18, padding: 14, flexDirection: "row", gap: 12, alignItems: "center" }, readOnlyCopy: { flex: 1 }, readOnlyTitle: { fontSize: 14, fontFamily: "Inter_800ExtraBold" }, readOnlyText: { fontSize: 12, marginTop: 2, lineHeight: 17 },
  scenarioBar: { flexWrap: "wrap", borderWidth: 1, borderRadius: 18, padding: 12, flexDirection: "row", alignItems: "flex-end", gap: 10 }, scenarioSelect: { flex: 1, minWidth: 0 }, viewerNote: { borderWidth: 1, borderRadius: 16, padding: 12, flexDirection: "row", gap: 10, alignItems: "center" }, viewerText: { flex: 1, fontSize: 12, lineHeight: 17 }, message: { borderWidth: 1, borderRadius: 14, padding: 12, flexDirection: "row", alignItems: "center", gap: 10 }, messageText: { flex: 1, fontSize: 12 },
  workspace: { gap: 16 }, workspaceDesktop: { flexDirection: "row", alignItems: "flex-start", gap: 20 }, editorColumn: { flex: 1, minWidth: 0, gap: 16 }, resultsColumn: { minWidth: 0 }, resultsColumnDesktop: { width: "42%", maxWidth: 600, position: Platform.OS === "web" ? "sticky" as any : "relative", top: 16 },
  card: { borderWidth: 1, borderRadius: 22, padding: 16 }, cardTitle: { fontSize: 18, fontFamily: "Inter_800ExtraBold" }, cardDescription: { fontSize: 12, marginTop: 4, lineHeight: 18 }, field: { marginTop: 13 }, fieldLabel: { fontSize: 12, fontFamily: "Inter_800ExtraBold", marginBottom: 6 }, input: { width: "100%", minHeight: 44, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, fontFamily: "Inter_500Medium" }, scopeNote: { fontSize: 12, lineHeight: 16, marginTop: 12 },
  button: { minHeight: 44, borderWidth: 1, borderRadius: 12, paddingHorizontal: 13, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 }, buttonText: { fontSize: 12, fontFamily: "Inter_800ExtraBold" }, actionWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 }, savingRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12 }, savingText: { fontSize: 11 },
  composerHeading: { flexDirection: "row", gap: 12, alignItems: "flex-start", marginBottom: 16 }, editorIcon: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  categoryTabs: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginBottom: 12 }, categoryTab: { minHeight: 44, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, alignItems: "center", justifyContent: "center" }, categoryTabText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  editingBadge: { padding: 11, borderRadius: 12, flexDirection: "row", alignItems: "center", gap: 8 }, editingBadgeText: { fontSize: 13, fontFamily: "Inter_700Bold" }, composerActions: { marginTop: 16, flexDirection: "row", flexWrap: "wrap", gap: 8 },
  sectionHeading: { flexDirection: "row", alignItems: "center", gap: 9, marginBottom: 12 }, countBadge: { minWidth: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  changeRowTop: { flexDirection: "row", alignItems: "flex-start", gap: 10 }, changeNumber: { width: 28, height: 28, borderRadius: 9, alignItems: "center", justifyContent: "center" }, changeSummary: { fontSize: 12, lineHeight: 18, marginTop: 4 }, changeRowActions: { flexDirection: "row", gap: 8, flexWrap: "wrap" }, changeAction: { minHeight: 44, paddingHorizontal: 12, borderRadius: 11, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 }, changeActionText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  changeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, changeOption: { width: "100%", minHeight: 60, borderWidth: 1, borderRadius: 14, padding: 10, flexDirection: "row", alignItems: "center", gap: 9 }, changeOptionCopy: { flex: 1 }, changeOptionTitle: { fontSize: 12, fontFamily: "Inter_800ExtraBold" }, changeOptionDetail: { fontSize: 12, marginTop: 2, lineHeight: 14 }, errorText: { fontSize: 12, fontFamily: "Inter_600SemiBold", marginVertical: 10 }, editSemantics: { fontSize: 12, lineHeight: 16, marginVertical: 10 },
  sectionTitle: { fontSize: 18, fontFamily: "Inter_800ExtraBold" }, emptyCard: { borderWidth: 1, borderStyle: "dashed", borderRadius: 18, padding: 22, alignItems: "center" }, emptyTitle: { marginTop: 10, fontSize: 15, fontFamily: "Inter_800ExtraBold" }, emptyText: { fontSize: 12, marginTop: 4, textAlign: "center" }, changeList: { gap: 8 }, changeRow: { borderWidth: 1, borderRadius: 18, padding: 14, gap: 10 }, changeRowCopy: { flex: 1 }, changeRowTitle: { fontSize: 14, fontFamily: "Inter_700Bold" }, changeIssue: { fontSize: 12, fontFamily: "Inter_600SemiBold", marginTop: 3 }, changeOkay: { fontSize: 10, fontFamily: "Inter_600SemiBold", marginTop: 3 },
  resultsCard: { borderWidth: 1, borderRadius: 24, padding: 17 }, resultsHeader: { flexWrap: "wrap", flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }, resultsTitle: { fontSize: 20, fontFamily: "Inter_800ExtraBold", marginTop: 2 }, statusBadge: { minHeight: 30, borderRadius: 999, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 5 }, statusText: { fontSize: 11, fontFamily: "Inter_800ExtraBold" }, resultsNote: { fontSize: 12, lineHeight: 16, marginTop: 8 }, attention: { borderWidth: 1, borderRadius: 14, padding: 11, marginTop: 12 }, negativeHeader: { flexDirection: "row", alignItems: "center", gap: 7 }, attentionTitle: { fontSize: 12, fontFamily: "Inter_800ExtraBold", marginBottom: 4 }, attentionText: { fontSize: 12, lineHeight: 16 }, metricsGrid: { gap: 9, marginTop: 14 }, metric: { borderWidth: 1, borderRadius: 15, padding: 12 }, metricLabel: { fontSize: 12, fontFamily: "Inter_800ExtraBold" }, metricValues: { flexDirection: "row", justifyContent: "space-between", gap: 12, marginTop: 7 }, metricValuesStack: { flexDirection: "column", gap: 12 }, metricReal: { flex: 1, minWidth: 0 }, metricScenarioStack: { alignItems: "flex-start" }, metricScenario: { alignItems: "flex-end", flex: 1, minWidth: 0 }, metricCaption: { fontSize: 11 }, metricValueRight: { textAlign: "right" }, metricValue: { width: "100%", flexShrink: 1, fontSize: 20, fontFamily: "Inter_800ExtraBold", marginTop: 1 },
  safetyRow: { borderTopWidth: 1, borderBottomWidth: 1, marginTop: 14, paddingVertical: 13, flexDirection: "row", justifyContent: "space-between", gap: 12 }, safetyLabel: { fontSize: 12 }, safetyValue: { fontSize: 16, fontFamily: "Inter_800ExtraBold", marginTop: 2 }, debtImpact: { borderWidth: 1, borderRadius: 16, padding: 13, flexDirection: "row", gap: 11, marginTop: 14 }, debtImpactCopy: { flex: 1 }, debtImpactTitle: { fontSize: 12, fontFamily: "Inter_700Bold" }, debtImpactValue: { fontSize: 18, fontFamily: "Inter_800ExtraBold", marginTop: 2 }, debtImpactNote: { fontSize: 12, marginTop: 2 }, monthSection: { marginTop: 18 }, monthSectionTitle: { fontSize: 16, fontFamily: "Inter_800ExtraBold", marginBottom: 7 }, monthRow: { borderTopWidth: 1, paddingVertical: 11 }, monthRowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, monthName: { fontSize: 12, fontFamily: "Inter_700Bold" }, monthNet: { fontSize: 13, fontFamily: "Inter_800ExtraBold" }, barTrack: { marginTop: 8, gap: 3 }, bar: { height: 4, borderRadius: 2 }, monthDetails: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", marginTop: 7, gap: 7 }, monthDetail: { fontSize: 11 },
});
