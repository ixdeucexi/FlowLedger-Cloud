import { PrivacyPressable as Pressable, PrivacyTextInput as TextInput, PrivacyView as View } from "@/components/privacy/PrivacyPrimitives";
import { SimulatorChoiceChips as ChoiceChips } from "@/components/SimulatorChoiceChips";
import Feather from "@expo/vector-icons/Feather";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { confirmAction } from "@/lib/confirmAction";
import { useOverlayActivity } from "@/hooks/useOverlayActivity";
import { createSimulatorEditorHistory } from "@/lib/simulatorEditorHistory";
import { DESKTOP_MODAL_OVERLAY, DESKTOP_MODAL_WIDE } from "@/lib/desktopModal";
import { useLocalDay } from "@/hooks/useLocalDay";
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { buildSimulationEditorChange, replaceSimulationChange, simulationEditorFields, type SimulationEditorFields } from "@/lib/planSimulationEditor";

import { ScenarioOptionPicker } from "@/components/ScenarioOptionPicker";
import { SavedScenarioComparison } from "@/components/SavedScenarioComparison";
import { compareSavedPlanScenarios, defaultScenarioComparisonHorizon, type SavedComparisonOption } from "@/lib/planSimulationComparison";
import { scenarioDeviceKeys, emptyScenarioLibrary, loadScenarioDeviceState, persistScenarioLibrary, persistScenarioWorking, putDeviceScenario, deleteDeviceScenario, scenarioDraftFingerprint, type DeviceScenarioLibrary } from "@/lib/planSimulationLibrary";

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
import { exportPlanScenario } from "@/lib/planSimulationExport";
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
  type PlanSimulationBaseline,
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
  inputRef,
  disabled = false,
}: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  label: string;
  keyboardType?: "default" | "decimal-pad";
  inputRef?: React.RefObject<TextInput | null>;
  disabled?: boolean;
}) {
  const c = useColors();
  return (
    <TextInput
      ref={inputRef}
      editable={!disabled}
      accessibilityState={{ disabled }}
      accessibilityLabel={label}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={c.mutedForeground}
      keyboardType={keyboardType}
      sensitive={keyboardType === "decimal-pad"}
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
    <View style={styles.composerBody}>
      <View style={styles.composerHeading}>
        <View style={[styles.editorIcon, { backgroundColor: c.primary + "18" }]}><Feather name={editingChange ? "edit-3" : "sliders"} size={20} color={c.primary} /></View>
        <View style={styles.changeOptionCopy}><AppText style={[styles.cardDescription, { color: c.mutedForeground }]}>{editingChange ? `${option.label} · your original change stays in place until you update it.` : "Choose an area, then set the change you want to compare."}</AppText></View>
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
      <View style={styles.composerActions}><Button label={editingChange ? "Update change" : "Add to scenario"} icon={editingChange ? "check" : "plus"} onPress={save} primary /><Button label={editingChange ? "Cancel editing" : "Cancel"} onPress={onCancel} /></View>
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

function ChangeList({ changes, references, issues, editingId, onEdit, onRemove, disabled = false }: { changes: PlanSimulationChange[]; references: PlanSimulationReferences; issues: PlanSimulationResult["issues"]; editingId: string | null; onEdit: (id: string) => void; onRemove: (id: string) => void; disabled?: boolean }) {
  const c = useColors();
  if (!changes.length) return <View style={[styles.emptyCard, { borderColor: c.border }]}><View style={[styles.editorIcon, { backgroundColor: c.primary + "12" }]}><Feather name="git-branch" size={21} color={c.primary} /></View><AppText style={[styles.emptyTitle, { color: c.foreground }]}>Start with one small change</AppText><AppText style={[styles.emptyText, { color: c.mutedForeground }]}>Choose Add change to test income, bills, spending or debt. Your comparison updates as you go.</AppText></View>;
  return <View style={styles.changeList}>{changes.map((change, index) => {
    const issue = issues.find(item => item.changeId === change.id);
    const label = changeLabel(change, references);
    const active = editingId === change.id;
    return <View key={change.id} style={[styles.changeRow, { backgroundColor: c.card, borderColor: active ? c.primary : issue ? c.warning : c.border }]}>
      <View style={styles.changeRowTop}><View style={[styles.changeNumber, { backgroundColor: c.primary + "12" }]}><AppText style={{ color: c.primary, fontFamily: "Inter_700Bold" }}>{index + 1}</AppText></View><View style={styles.changeRowCopy}><AppText style={[styles.changeRowTitle, { color: c.foreground }]}>{label}</AppText><AppText style={[styles.changeSummary, { color: c.mutedForeground }]}>{changeSummary(change)}</AppText></View></View>
      {issue ? <AppText style={[styles.changeIssue, { color: c.warning }]}>{issue.message}</AppText> : null}
      <View style={styles.changeRowActions}><Pressable accessibilityRole="button" accessibilityLabel={`Edit ${label}`} accessibilityState={{ selected: active, disabled }} disabled={disabled} onPress={() => onEdit(change.id)} style={[styles.changeAction, { backgroundColor: c.primary + "12" }]}><Feather name="edit-3" size={15} color={c.primary} /><AppText style={[styles.changeActionText, { color: c.primary }]}>{active ? "Editing" : "Edit"}</AppText></Pressable><Pressable accessibilityRole="button" accessibilityLabel={`Remove ${label}`} accessibilityState={{ disabled }} disabled={disabled} onPress={() => onRemove(change.id)} style={styles.changeAction}><Feather name="trash-2" size={15} color={c.mutedForeground} /><AppText style={[styles.changeActionText, { color: c.mutedForeground }]}>Remove</AppText></Pressable></View>
    </View>;
  })}</View>;
}

function Metric({ label, real, scenario, tone }: { label: string; real: string; scenario: string; tone?: "good" | "warn" }) {
  const c = useColors();
  const [metricWidth, setMetricWidth] = useState(0);
  const stacked = metricWidth < 440;
  const scenarioColor = tone === "good" ? c.success : tone === "warn" ? c.warning : c.foreground;
  return (
    <View onLayout={event => setMetricWidth(event.nativeEvent.layout.width)} style={[styles.metric, { backgroundColor: c.background, borderColor: c.border }]}>
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
      <View style={[styles.safetyRow, { borderColor: c.border }]}><View style={styles.safetyItem}><AppText style={[styles.safetyLabel, { color: c.mutedForeground }]}>Current safety floor</AppText><AppText tone="number" style={[styles.safetyValue, { color: c.foreground }]}>{money(safetyFloor)}</AppText></View><View style={styles.safetyItem}><AppText style={[styles.safetyLabel, { color: c.mutedForeground }]}>Hypothetical savings added</AppText><AppText tone="number" style={[styles.safetyValue, { color: c.success }]}>{money(scenario.savingsAdded)}</AppText></View></View>
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

function PlanSimulatorWorkspace({ canPersistScenarios, canSaveDevice, canCompareSaved, hasFoundingAccess }: { canPersistScenarios: boolean; canSaveDevice: boolean; canCompareSaved: boolean; hasFoundingAccess: boolean }) {
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
  const budgetId = activeHousehold?.budgetId ?? null;
  const draftStorageKey = user?.id ? planSimulationStorageKey(user.id, householdId) : null;
  const [scenarios, setScenarios] = useState<PlanSimulationDefinition[]>([]);
  const [deviceLibrary, setDeviceLibrary] = useState<DeviceScenarioLibrary>(emptyScenarioLibrary);
  const [deviceReady, setDeviceReady] = useState(false);
  const [pendingSwitch, setPendingSwitch] = useState<string | null>(null);
  const [comparisonKeys, setComparisonKeys] = useState<[string, string]>(["", ""]);
  const [comparisonHorizon, setComparisonHorizon] = useState<PlanSimulationHorizon | null>(null);
  const deviceKeys = useMemo(() => user?.id ? scenarioDeviceKeys(user.id, householdId, demoMode) : null, [user?.id, householdId, demoMode]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftState>({ name: "Untitled scenario", horizonMonths: defaultHorizon, changes: [] });
  const [categoryBudgets, setCategoryBudgets] = useState<Record<string, number>>(() => readCategoryBudgetCache(currentMonth, currentYear, { userId: user?.id, householdId, budgetId: activeHousehold?.budgetId }));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const mutationRef = useRef<object | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true;return () => { mountedRef.current = false; }; }, []);
  const scenarioNameRef = useRef<TextInput>(null);
  const [message, setMessage] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editorVersion, setEditorVersion] = useState(0);
  const [editorOpen, setEditorOpen] = useState(false);
  const [mobileView, setMobileView] = useState<"build" | "compare">("build");
  const editorHeadingRef = useRef<View>(null);
  const returnFocusRef = useRef<{ focus: (options?: { preventScroll: boolean }) => void } | null>(null);
  const editingChange = draft.changes.find(change => change.id === editingId) ?? null;
  const focusEditor = useCallback(() => {
    if (Platform.OS === "web") (editorHeadingRef.current as unknown as { focus?: (options: { preventScroll: boolean }) => void })?.focus?.({ preventScroll: true });
  }, []);
  const closeEditor = useCallback(() => {
    setEditorOpen(false);
    setEditingId(null);
    if (Platform.OS === "web") {
      const target = returnFocusRef.current;
      requestAnimationFrame(() => target?.focus({ preventScroll: true }));
    }
  }, []);
  const openEditor = useCallback((id: string | null = null) => {
    if (saving || mutationRef.current || draft.invalidDefinition || (id && !draft.changes.some(change => change.id === id))) return;
    if (Platform.OS === "web" && typeof document !== "undefined") returnFocusRef.current = document.activeElement as HTMLElement | null;
    setEditingId(id);
    setEditorVersion(previous => previous + 1);
    setEditorOpen(true);
  }, [draft.changes, draft.invalidDefinition, saving]);
  useOverlayActivity(editorOpen);
  useEffect(() => {
    if (!editorOpen || Platform.OS !== "web" || typeof window === "undefined") return;
    const history = createSimulatorEditorHistory(window, closeEditor);
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      closeEditor();
    };
    window.addEventListener("keydown", onEscape, true);
    return () => { window.removeEventListener("keydown", onEscape, true); history.dispose(); };
  }, [editorOpen, closeEditor]);
  const selectedScenario = useMemo(() => scenarios.find(item => `household:${item.id}` === selectedId) ?? null, [scenarios, selectedId]);
  const householdWriteEligible = Boolean(selectedScenario && canPersistScenarios && canEditHousehold && !demoMode);
  const selectedDevice = deviceLibrary.scenarios.find(item => `device:${item.id}` === selectedId) ?? null;
  const savedOptions = useMemo<SavedComparisonOption[]>(() => [
    ...deviceLibrary.scenarios.map(item => ({ key: `device:${item.id}`, source: "On this device" as const, draft: { name: item.name, horizonMonths: item.horizonMonths, changes: item.changes } })),
    ...scenarios.map(item => ({ key: `household:${item.id}`, source: "Household" as const, draft: { name: item.name, horizonMonths: item.horizonMonths, changes: item.changes, invalidDefinition: item.invalidDefinition } })),
  ], [deviceLibrary, scenarios]);
  const selectedSaved = savedOptions.find(option => option.key === selectedId);
  const draftDirty = scenarioDraftFingerprint(draft) !== scenarioDraftFingerprint(selectedSaved?.draft ?? { name: "Untitled scenario", horizonMonths: defaultHorizon, changes: [] });
  const foundingFreeLocalOnly = hasFoundingAccess && !canPersistScenarios;
  const scenarioAccessKey = JSON.stringify([canSaveDevice, canCompareSaved, canPersistScenarios, canEditHousehold]);
  const scenarioAccessRef = useRef({ key: scenarioAccessKey, epoch: 0 });
  if (scenarioAccessRef.current.key !== scenarioAccessKey) scenarioAccessRef.current = { key: scenarioAccessKey, epoch: scenarioAccessRef.current.epoch + 1 };
  const scenarioAccessOwner = scenarioAccessRef.current;
  const keepsLocalDraft = Boolean(user?.id);
  const draftScopeKey = JSON.stringify([deviceKeys?.library, householdId, budgetId, defaultHorizon, demoMode]);
  const draftEpochRef = useRef({ key: draftScopeKey, epoch: 0 });
  if (draftEpochRef.current.key !== draftScopeKey) draftEpochRef.current = { key: draftScopeKey, epoch: draftEpochRef.current.epoch + 1 };
  const draftLoadScope = `${draftScopeKey}:${draftEpochRef.current.epoch}`;
  const draftLoadScopeRef = useRef(draftLoadScope);
  draftLoadScopeRef.current = draftLoadScope;
  const [loadedDraftScope, setLoadedDraftScope] = useState<string | null>(null);
  useEffect(() => {
    // A permission change cancels publication of an old write, but keeps the
    // current draft and every saved definition intact.
    mutationRef.current = null;setSaving(false);
    if (!canCompareSaved) { setComparisonKeys(["", ""]);setComparisonHorizon(null); }
  }, [scenarioAccessOwner, canCompareSaved]);

  useEffect(() => {
    let cancelled = false;
    const scope = { userId: user?.id, householdId, budgetId: activeHousehold?.budgetId };
    setCategoryBudgets(readCategoryBudgetCache(currentMonth, currentYear, scope));
    void loadCategoryBudgets(scope, currentMonth, currentYear).then(value => { if (!cancelled) setCategoryBudgets(value); });
    return () => { cancelled = true; };
  }, [activeHousehold?.budgetId, currentMonth, currentYear, householdId, user?.id]);

  useEffect(() => {
    let cancelled = false;
    const isCurrent = () => !cancelled && mountedRef.current && draftLoadScopeRef.current === draftLoadScope;
    setLoading(true);setLoadedDraftScope(null);setDeviceReady(false);setDeviceLibrary(emptyScenarioLibrary());setPendingSwitch(null);setComparisonKeys(["", ""]);setComparisonHorizon(null);setSaving(false);mutationRef.current = null;
    setMobileView("build");returnFocusRef.current = null;setEditorOpen(false);setEditingId(null);setEditorVersion(previous => previous + 1);setMessage("");setScenarios([]);setSelectedId(null);
    setDraft({ name: "Untitled scenario", horizonMonths: defaultHorizon, changes: [] });
    void (async () => {
      try {
        const [cloudLoad, deviceLoad] = await Promise.allSettled([
          !user?.id || demoMode || householdId === "local" ? Promise.resolve([]) : loadPlanSimulations(householdId, { userId: user!.id, isCurrent }),
          deviceKeys ? loadScenarioDeviceState(AsyncStorage, deviceKeys, isCurrent, new Date().toISOString(), () => `device-${nextLocalId()}`) : Promise.resolve({ library: emptyScenarioLibrary(), working: null }),
        ]);
        if (!isCurrent()) return;
        const errors: string[] = [];
        const rows = cloudLoad.status === "fulfilled" ? cloudLoad.value : [];
        setScenarios(rows);
        if (cloudLoad.status === "rejected") errors.push(cloudLoad.reason instanceof Error ? cloudLoad.reason.message : "Household scenarios could not be loaded.");
        if (deviceLoad.status === "fulfilled") {
          const device = deviceLoad.value;setDeviceLibrary(device.library);setDeviceReady(true);
          if (device.working) { setDraft(device.working.draft);const key = device.working.selectedKey;setSelectedId(key && (device.library.scenarios.some(item => `device:${item.id}` === key) || rows.some(item => `household:${item.id}` === key)) ? key : null); }
        } else {
          setDeviceReady(false);
          errors.push(deviceLoad.reason instanceof Error ? deviceLoad.reason.message : "The device library could not be loaded. Stored data was kept.");
        }
        if (errors.length) setMessage(errors.join(" "));
      } catch (error) { if (isCurrent()) setMessage(error instanceof Error ? error.message : "The device library could not be loaded. Stored data was kept."); }
      finally { if (isCurrent()) { setLoadedDraftScope(draftLoadScope);setLoading(false); } }
    })();
    return () => { cancelled = true; };
  }, [defaultHorizon, demoMode, deviceKeys, draftLoadScope, householdId, user?.id]);
  useEffect(() => {
    if (!keepsLocalDraft || !deviceKeys || !deviceReady || loading || loadedDraftScope !== draftLoadScope) return;
    const owner = draftLoadScope;
    void persistScenarioWorking(AsyncStorage, deviceKeys.working, { schemaVersion: 1, selectedKey: selectedId, draft }, () => draftLoadScopeRef.current === owner).catch(error => { if (draftLoadScopeRef.current === owner) setMessage(error instanceof Error ? error.message : "The working draft could not be saved on this device. Your changes are still open."); });
  }, [deviceKeys, deviceReady, draft, draftLoadScope, keepsLocalDraft, loadedDraftScope, loading, selectedId]);
  useEffect(() => { setComparisonKeys(previous => previous.map(key => savedOptions.some(option => option.key === key) ? key : "") as [string, string]); }, [savedOptions]);

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
  const buildReferences = useCallback((sourceBaseline: PlanSimulationBaseline): PlanSimulationReferences => ({
    incomes: incomes.map(income => ({ id: income.id, name: income.name, amount: income.amount })),
    bills: bills.map(bill => {
      const occurrenceCount = getBillOccurrencesInMonth(bill, currentMonth, currentYear).length;
      const openOccurrenceCount = sourceBaseline.days.flatMap(day => day.events).filter(event =>
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
  }), [bills, currentMonth, currentYear, getBillEffectiveMonthlyTotal, getBillMonthlyTotal, getBillOccurrencesInMonth, incomes, livePayoffPreview?.months, settings.paymentMethod]);
  const references = useMemo(() => buildReferences(baseline), [baseline, buildReferences]);
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

  const comparisonOptions = comparisonKeys.map(key => savedOptions.find(option => option.key === key));
  const commonHorizon = comparisonHorizon ?? defaultScenarioComparisonHorizon(comparisonOptions.filter((option): option is SavedComparisonOption => Boolean(option)));
  const commonBaseline = useMemo(() => getPlanSimulationBaseline(commonHorizon, startDate), [commonHorizon, getPlanSimulationBaseline, startDate]);
  const commonReferences = useMemo(() => buildReferences(commonBaseline), [buildReferences, commonBaseline]);
  const savedComparison = useMemo(() => canCompareSaved && comparisonOptions[0] && comparisonOptions[1] && comparisonKeys[0] !== comparisonKeys[1]
    ? compareSavedPlanScenarios({ baseline: commonBaseline, options: [comparisonOptions[0], comparisonOptions[1]], references: commonReferences, metrics, safetyFloor: settings.safety_floor }) : null,
  [canCompareSaved, commonBaseline, commonReferences, comparisonOptions[0], comparisonOptions[1], comparisonKeys[0], comparisonKeys[1], metrics, settings.safety_floor]);

  const scenarioRiskDay = firstNegativeBalanceDay(scenarioResult.days);

  const applySelection = useCallback((key: string) => {
    if (saving || mutationRef.current) return;
    const option = savedOptions.find(item => item.key === key);
    if (key !== "new-draft" && !option) { setPendingSwitch(null);setMessage("That saved scenario is no longer available. Your working changes were kept.");return; }
    setEditorOpen(false);setEditingId(null);setEditorVersion(previous => previous + 1);setPendingSwitch(null);
    setSelectedId(option?.key ?? null);
    setDraft(option ? { ...option.draft } : { name: "Untitled scenario", horizonMonths: defaultHorizon, changes: [] });
    setMessage(option?.draft.invalidDefinition ? "This saved option has an unsupported definition. Reset it before continuing." : "");
  }, [defaultHorizon, savedOptions, saving]);
  const requestSelection = useCallback((key: string) => {
    if (saving || mutationRef.current || key === selectedId) return;
    if (draftDirty) { setPendingSwitch(key);return; }
    applySelection(key);
  }, [applySelection, draftDirty, saving, selectedId]);
  const makeLocalDraft = useCallback(() => {
    if (!canEditHousehold && selectedScenario) {
      setSelectedId(null);
      setMessage("You are editing a private working draft. The household scenario remains unchanged. Your private working changes do not update the saved household scenario.");
    }
  }, [canEditHousehold, selectedScenario]);
  const addChange = useCallback((change: PlanSimulationChange) => { makeLocalDraft();setDraft(previous => ({ ...previous, changes: [...previous.changes, change] })); }, [makeLocalDraft]);
  const removeChange = useCallback((id: string) => {
    if (saving || mutationRef.current) return;
    if (editingId === id) { setEditorOpen(false);setEditingId(null); }
    makeLocalDraft();setDraft(previous => ({ ...previous, changes: previous.changes.filter(change => change.id !== id) }));
  }, [editingId, makeLocalDraft, saving]);
  const saveChange = useCallback((change: PlanSimulationChange): string | null => {
    if (saving || mutationRef.current) return "Wait for the scenario save to finish before changing it.";
    if (draft.invalidDefinition) return "Reset the unsupported scenario definition before changing it.";
    if (editingId) {
      if (!replaceSimulationChange(draft.changes, editingId, change)) return "This change is no longer available to edit. Cancel and choose it again.";
      makeLocalDraft();setDraft(previous => { const next = replaceSimulationChange(previous.changes, editingId, change);return next ? { ...previous, changes: next } : previous; });
    } else {
      if (!decodePlanSimulationChanges([...draft.changes, change])) return "A scenario supports up to 50 valid changes. Remove a change before adding another.";
      addChange(change);
    }
    closeEditor();return null;
  }, [addChange, closeEditor, draft.changes, draft.invalidDefinition, editingId, makeLocalDraft, saving]);
  const resetDraft = useCallback(() => {
    if (saving || mutationRef.current) return;
    setEditorOpen(false);setEditingId(null);setEditorVersion(previous => previous + 1);setPendingSwitch(null);
    const original = savedOptions.find(option => option.key === selectedId);
    if (draft.invalidDefinition) { setDraft(previous => ({ ...previous, changes: [], invalidDefinition: false }));setMessage("Unsupported changes were cleared. Review before saving.");return; }
    setDraft(original ? { ...original.draft } : { name: "Untitled scenario", horizonMonths: defaultHorizon, changes: [] });setMessage("Working draft reset. Saved options were not changed.");
  }, [defaultHorizon, draft.invalidDefinition, savedOptions, selectedId, saving]);
  const updateDraftName = useCallback((name: string) => {
    if (saving || mutationRef.current) return;
    makeLocalDraft();setDraft(previous => ({ ...previous, name }));
  }, [makeLocalDraft, saving]);
  const updateDraftHorizon = useCallback((value: string) => {
    if (saving || mutationRef.current || !isPlanSimulationHorizon(Number(value))) return;
    makeLocalDraft();setDraft(previous => ({ ...previous, horizonMonths: Number(value) as PlanSimulationHorizon }));
  }, [makeLocalDraft, saving]);
  const saveDevice = useCallback(async (asNew: boolean, duplicate = false): Promise<boolean> => {
    if (!mountedRef.current || draftLoadScopeRef.current !== draftLoadScope || scenarioAccessRef.current !== scenarioAccessOwner) return false;
    if (!canSaveDevice) { setMessage("Saving named scenarios is a Pro feature. Your current working draft is kept on this device.");return false; }
    if (editorOpen || saving || mutationRef.current) { setMessage("Update or cancel this change first.");return false; }
    if (!deviceReady || !deviceKeys || loadedDraftScope !== draftLoadScope) { setMessage("Load this account’s device library before saving.");return false; }
    const owner = draftLoadScope;const isCurrent = () => mountedRef.current && draftLoadScopeRef.current === owner && scenarioAccessRef.current === scenarioAccessOwner;
    const operation = {};mutationRef.current = operation;setSaving(true);
    try {
      let name = draft.name;
      if (duplicate) {
        const used = new Set(deviceLibrary.scenarios.map(item => item.name.toLocaleLowerCase()));let suffix = 1;
        do { const tail = suffix === 1 ? " copy" : ` copy ${suffix}`;name = `${draft.name.slice(0, 80 - tail.length)}${tail}`;suffix++; } while (used.has(name.toLocaleLowerCase()));
      }
      const result = putDeviceScenario(deviceLibrary, { ...draft, name }, new Date().toISOString(), `device-${nextLocalId()}`, !asNew && selectedDevice ? selectedDevice.id : undefined);
      await persistScenarioLibrary(AsyncStorage, deviceKeys.library, deviceLibrary, result.library, isCurrent);
      if (!isCurrent()) return false;
      setDeviceLibrary(result.library);setSelectedId(`device:${result.saved.id}`);setDraft({ name: result.saved.name, horizonMonths: result.saved.horizonMonths, changes: result.saved.changes });
      setMessage("Saved on this device. Your real plan was not changed.");return true;
    } catch (error) { if (isCurrent()) setMessage(error instanceof Error ? error.message : "The scenario could not be saved on this device. Your working changes are still open.");return false; }
    finally { if (mutationRef.current === operation) mutationRef.current = null;if (isCurrent()) setSaving(false); }
  }, [canSaveDevice, deviceKeys, deviceLibrary, deviceReady, draft, draftLoadScope, editorOpen, loadedDraftScope, saving, scenarioAccessOwner, selectedDevice, user?.id]);
  const saveDraft = useCallback(async (): Promise<boolean> => {
    if (!mountedRef.current || draftLoadScopeRef.current !== draftLoadScope || scenarioAccessRef.current !== scenarioAccessOwner) return false;
    if (!canSaveDevice) { setMessage("Updating saved scenarios is a Pro feature. Your working changes and saved options are kept.");return false; }
    if (!selectedScenario || !canEditHousehold || !canPersistScenarios || demoMode) return saveDevice(false);
    if (editorOpen || saving || mutationRef.current) { setMessage("Update or cancel this change first.");return false; }
    if (draft.invalidDefinition || !safePlanSimulationName(draft.name)) { setMessage("Use a valid name and reset unsupported changes before saving.");return false; }
    const owner = draftLoadScope;const isCurrent = () => mountedRef.current && draftLoadScopeRef.current === owner && scenarioAccessRef.current === scenarioAccessOwner;const operation = {};mutationRef.current = operation;setSaving(true);
    try {
      const saved = await updatePlanSimulation({ requestScope: { userId: user!.id, isCurrent }, scenario: selectedScenario, name: draft.name, horizonMonths: draft.horizonMonths, changes: draft.changes });
      if (!mountedRef.current || draftLoadScopeRef.current !== owner || scenarioAccessRef.current !== scenarioAccessOwner) return false;
      setScenarios(previous => [saved, ...previous.filter(item => item.id !== saved.id)]);setDraft({ name: saved.name, horizonMonths: saved.horizonMonths, changes: saved.changes });setMessage("Household scenario updated. Your real plan was not changed.");return true;
    } catch (error) { if (mountedRef.current && draftLoadScopeRef.current === owner && scenarioAccessRef.current === scenarioAccessOwner) setMessage(error instanceof Error ? error.message : "Scenario could not be saved.");return false; }
    finally { if (mutationRef.current === operation) mutationRef.current = null;if (mountedRef.current && draftLoadScopeRef.current === owner && scenarioAccessRef.current === scenarioAccessOwner) setSaving(false); }
  }, [canEditHousehold, canPersistScenarios, demoMode, draft, draftLoadScope, editorOpen, saveDevice, saving, scenarioAccessOwner, canSaveDevice, selectedScenario, user?.id]);
  const saveHouseholdCopy = useCallback(async (duplicate = false) => {
    if (!mountedRef.current || draftLoadScopeRef.current !== draftLoadScope || scenarioAccessRef.current !== scenarioAccessOwner) return;
    if (!canPersistScenarios || !canEditHousehold || demoMode || saving || mutationRef.current || editorOpen || draft.invalidDefinition) return;
    const owner = draftLoadScope;const isCurrent = () => mountedRef.current && draftLoadScopeRef.current === owner && scenarioAccessRef.current === scenarioAccessOwner;const operation = {};mutationRef.current = operation;setSaving(true);
    try {
      let name = draft.name;
      if (duplicate) {
        const used = new Set(scenarios.map(item => item.name.toLocaleLowerCase()));let suffix = 1;
        do { const tail = suffix === 1 ? " copy" : ` copy ${suffix}`;name = `${draft.name.slice(0, 80 - tail.length)}${tail}`;suffix++; } while (used.has(name.toLocaleLowerCase()));
      }
      const saved = await createPlanSimulation({ requestScope: { userId: user!.id, isCurrent }, householdId, name, horizonMonths: draft.horizonMonths, changes: draft.changes });
      if (!mountedRef.current || draftLoadScopeRef.current !== owner || scenarioAccessRef.current !== scenarioAccessOwner) return;
      setScenarios(previous => [saved, ...previous]);setSelectedId(`household:${saved.id}`);setDraft({ name: saved.name, horizonMonths: saved.horizonMonths, changes: saved.changes });setMessage("Household copy saved. Your real plan was not changed.");
    } catch (error) { if (mountedRef.current && draftLoadScopeRef.current === owner && scenarioAccessRef.current === scenarioAccessOwner) setMessage(error instanceof Error ? error.message : "Household scenario could not be saved."); }
    finally { if (mutationRef.current === operation) mutationRef.current = null;if (mountedRef.current && draftLoadScopeRef.current === owner && scenarioAccessRef.current === scenarioAccessOwner) setSaving(false); }
  }, [canEditHousehold, canPersistScenarios, demoMode, draft, draftLoadScope, editorOpen, householdId, saving, scenarioAccessOwner, scenarios, user?.id]);
  const reloadLibraries = useCallback(async () => {
    if (!deviceKeys || editorOpen || mutationRef.current) return;
    const owner = draftLoadScope;const operation = {};mutationRef.current = operation;setSaving(true);
    const isCurrent = () => mountedRef.current && draftLoadScopeRef.current === owner;
    try {
      const [deviceLoad, cloudLoad] = await Promise.allSettled([
        loadScenarioDeviceState(AsyncStorage, deviceKeys, isCurrent, new Date().toISOString(), () => `device-${nextLocalId()}`),
        user?.id && !demoMode && householdId !== "local" ? loadPlanSimulations(householdId, { userId: user!.id, isCurrent }) : Promise.resolve(scenarios),
      ]);
      if (!isCurrent()) return;
      const errors: string[] = [];
      const rows = cloudLoad.status === "fulfilled" ? cloudLoad.value : [];
      setScenarios(rows);
      if (cloudLoad.status === "rejected") errors.push(cloudLoad.reason instanceof Error ? cloudLoad.reason.message : "Household scenarios could not be reloaded.");
      if (deviceLoad.status === "fulfilled") { setDeviceLibrary(deviceLoad.value.library);setDeviceReady(true); }
      else { setDeviceReady(false);errors.push(deviceLoad.reason instanceof Error ? deviceLoad.reason.message : "The device library could not be reloaded. Stored data was kept."); }
      setSelectedId(previous => previous && (previous.startsWith("device:") && (deviceLoad.status === "rejected" || deviceLoad.value.library.scenarios.some(item => `device:${item.id}` === previous)) || rows.some(item => `household:${item.id}` === previous)) ? previous : null);
      setMessage(errors.length ? `${errors.join(" ")} Your unsaved working values were kept.` : "Saved scenarios reloaded. Your unsaved working values were kept.");
    } catch (error) { if (isCurrent()) setMessage(error instanceof Error ? error.message : "Saved scenarios could not be reloaded. Your working changes were kept."); }
    finally { if (mutationRef.current === operation) mutationRef.current = null;if (isCurrent()) setSaving(false); }
  }, [demoMode, deviceKeys, draftLoadScope, editorOpen, householdId, scenarios, user?.id]);
  const removeScenario = useCallback(() => {
    if (!mountedRef.current || draftLoadScopeRef.current !== draftLoadScope || scenarioAccessRef.current !== scenarioAccessOwner) return;
    if (saving || mutationRef.current || editorOpen || (!selectedDevice && (!selectedScenario || !canEditHousehold || demoMode))) return;
    const owner = draftLoadScope;const selectedKey = selectedId;
    confirmAction({ title: "Delete saved scenario?", message: `Delete “${selectedDevice?.name ?? selectedScenario?.name}” from ${selectedDevice ? "this device" : "the household"}? Your working copy and real plan will stay unchanged.`, confirmText: "Delete saved scenario", cancelText: "Cancel", destructive: true, onConfirm: async () => {
      if (!mountedRef.current || draftLoadScopeRef.current !== owner || scenarioAccessRef.current !== scenarioAccessOwner || mutationRef.current) return;
      const operation = {};mutationRef.current = operation;setSaving(true);
      try {
        if (selectedDevice && deviceKeys) { const next = deleteDeviceScenario(deviceLibrary, selectedDevice.id);await persistScenarioLibrary(AsyncStorage, deviceKeys.library, deviceLibrary, next, () => mountedRef.current && draftLoadScopeRef.current === owner && scenarioAccessRef.current === scenarioAccessOwner);if (!mountedRef.current || draftLoadScopeRef.current !== owner || scenarioAccessRef.current !== scenarioAccessOwner) return;setDeviceLibrary(next); }
        else if (selectedScenario) { await deletePlanSimulation(selectedScenario, { userId: user!.id, isCurrent: () => mountedRef.current && draftLoadScopeRef.current === owner && scenarioAccessRef.current === scenarioAccessOwner });if (!mountedRef.current || draftLoadScopeRef.current !== owner || scenarioAccessRef.current !== scenarioAccessOwner) return;setScenarios(previous => previous.filter(item => item.id !== selectedScenario.id)); }
        setSelectedId(null);setComparisonKeys(previous => previous.map(key => key === selectedKey ? "" : key) as [string, string]);setMessage("Saved option deleted. Your working copy is still open.");
      } catch (error) { if (mountedRef.current && draftLoadScopeRef.current === owner && scenarioAccessRef.current === scenarioAccessOwner) setMessage(error instanceof Error ? error.message : "The saved scenario could not be deleted.");throw error; }
      finally { if (mutationRef.current === operation) mutationRef.current = null;if (mountedRef.current && draftLoadScopeRef.current === owner && scenarioAccessRef.current === scenarioAccessOwner) setSaving(false); }
    } });
  }, [canEditHousehold, demoMode, deviceKeys, deviceLibrary, draftLoadScope, editorOpen, saving, scenarioAccessOwner, selectedDevice, selectedId, selectedScenario, user?.id]);

  const exportDraft = useCallback(async () => {
    if (editorOpen || saving || mutationRef.current || draftLoadScopeRef.current !== draftLoadScope) return;
    const owner = draftLoadScope;const isCurrent = () => mountedRef.current && draftLoadScopeRef.current === owner;
    const operation = {};mutationRef.current = operation;setSaving(true);
    try {
      if (await exportPlanScenario(draft, isCurrent) && isCurrent()) setMessage("Scenario exported. Your saved options and real plan are unchanged.");
    } catch (error) { if (isCurrent()) setMessage(error instanceof Error ? error.message : "This scenario could not be exported."); }
    finally { if (mutationRef.current === operation) mutationRef.current = null;if (isCurrent()) setSaving(false); }
  }, [draft, draftLoadScope, editorOpen, saving]);

  if (loading) return <AppLoadingIntro phase="simulator" accessibilityLabel="FlowLedger is opening Plan Simulator" />;

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: c.background }]} edges={["top", "bottom"]}>
      <View style={[styles.header, { borderColor: c.border, backgroundColor: c.background }]}>
        <View style={styles.headerCopy}><AppText tone="label" style={[styles.eyebrow, { color: c.primary }]}>{hasFoundingAccess ? "FOUNDING FREE PLAN SIMULATOR" : canSaveDevice ? "PRO PLAN SIMULATOR" : "FREE PLAN SIMULATOR"}</AppText><AppText accessibilityRole="header" tone="title" style={[styles.title, { color: c.foreground }]}>Plan Simulator</AppText><AppText style={[styles.subtitle, { color: c.mutedForeground }]}>{foundingFreeLocalOnly ? "Your private what-if workspace. Nothing changes your real plan." : "Explore possibilities alongside your real Forecast."}</AppText><DataFreshnessLabel compact /></View>
        <Pressable accessibilityRole="button" accessibilityLabel="Close Plan Simulator" onPress={() => safeClose(router)} style={({ pressed }) => [styles.closeButton, { backgroundColor: c.card, borderColor: c.border, opacity: pressed ? 0.66 : 1 }]}><Feather name="x" size={21} color={c.foreground} /></Pressable>
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={[styles.content, desktop && styles.contentDesktop]} keyboardShouldPersistTaps="handled">
        <View style={[styles.readOnlyBanner, { backgroundColor: c.primary + "12", borderColor: c.primary + "40" }]}><Feather name="shield" size={18} color={c.primary} /><View style={styles.readOnlyCopy}><AppText style={[styles.readOnlyTitle, { color: c.foreground }]}>{foundingFreeLocalOnly ? "Private on-device draft" : "Simulation only"}</AppText><AppText style={[styles.readOnlyText, { color: c.mutedForeground }]}>{!canSaveDevice ? "Free includes one current working draft, kept on this device. Pro saves named options and compares them. Your existing saved options remain available to open, export or delete." : foundingFreeLocalOnly ? "Named options are saved privately on this device. Household options are labelled separately. Your financial plan stays unchanged." : "There is no Apply action. Balances, APR, safety floor, goals, bills, debt, and past activity stay unchanged."}</AppText></View></View>
        {!canEditHousehold && canPersistScenarios ? <View style={[styles.viewerNote, { backgroundColor: c.warning + "12", borderColor: c.warning + "40" }]}><Feather name="eye" size={16} color={c.warning} /><AppText style={[styles.viewerText, { color: c.foreground }]}>View-only access: saved household scenarios are readable. Your private working draft remains available. Named copies require Pro; household scenarios cannot be updated with view-only access.</AppText></View> : null}
        {message ? <View accessibilityRole="alert" style={[styles.message, { backgroundColor: c.card, borderColor: c.border }]}><AppText style={[styles.messageText, { color: c.foreground }]}>{message}</AppText><Pressable accessibilityRole="button" accessibilityLabel="Dismiss message" onPress={() => setMessage("")} hitSlop={8}><Feather name="x" size={16} color={c.mutedForeground} /></Pressable></View> : null}
        {pendingSwitch ? <View accessibilityRole="alert" style={[styles.card, { backgroundColor: c.background, borderColor: c.warning }]}><AppText accessibilityRole="header" style={[styles.cardTitle, { color: c.foreground }]}>Save your working changes?</AppText><AppText style={[styles.scopeNote, { color: c.mutedForeground }]}>Save before opening another scenario, discard these working changes, or keep editing. Saved options stay unchanged until you update them.</AppText><View style={styles.actionWrap}>{canSaveDevice ? <Button label="Save & switch" primary disabled={saving || (!deviceReady && !householdWriteEligible)} onPress={() => void (async () => { const next = pendingSwitch;if (await saveDraft()) applySelection(next); })()} /> : null}<Button label="Discard & switch" danger disabled={saving} onPress={() => applySelection(pendingSwitch)} /><Button label="Keep editing" disabled={saving} onPress={() => setPendingSwitch(null)} /></View></View> : null}
        {!desktop ? <View accessibilityRole="tablist" accessibilityLabel="Simulator workspace" style={[styles.workspaceTabs, { backgroundColor: c.card, borderColor: c.border }]}>
          {(["build", "compare"] as const).map(view => <Pressable key={view} accessibilityRole="tab" accessibilityLabel={view === "build" ? "Build" : "Compare"} accessibilityState={{ selected: mobileView === view }} aria-selected={mobileView === view} onPress={() => setMobileView(view)} style={[styles.workspaceTab, { backgroundColor: mobileView === view ? c.primary : "transparent" }]}><Feather name={view === "build" ? "sliders" : "bar-chart-2"} size={16} color={mobileView === view ? c.primaryForeground : c.mutedForeground} /><AppText style={[styles.workspaceTabText, { color: mobileView === view ? c.primaryForeground : c.foreground }]}>{view === "build" ? "Build" : "Compare"}{view === "compare" && (!scenarioResult.complete || scenarioRiskDay) ? " · !" : ""}</AppText></Pressable>)}
        </View> : null}
        <View style={[styles.workspace, desktop && styles.workspaceDesktop]}>
          {desktop || mobileView === "build" ? <View style={styles.editorColumn}>
            <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
              <AppText accessibilityRole="header" tone="title" style={[styles.cardTitle, { color: c.foreground }]}>Your scenario</AppText>
              <View style={styles.libraryPicker}><ScenarioOptionPicker key={draftLoadScope} label="Open saved scenario" options={[{ key: "new-draft", name: "New working draft", source: "On this device" }, ...savedOptions.map(option => ({ key: option.key, name: option.draft.name, source: option.source }))]} selectedKey={selectedId ?? "new-draft"} onSelect={requestSelection} disabled={saving} /></View>
              <View style={styles.actionWrap}><Button label="New working draft" icon="plus" onPress={() => requestSelection("new-draft")} disabled={saving} /></View>
              <AppText style={[styles.scopeNote, { color: draftDirty ? c.warning : c.mutedForeground }]}>{draftDirty ? "Unsaved changes in this working draft" : selectedSaved ? `Saved option · ${selectedSaved.source}` : "Working draft · not a saved option yet"}</AppText>
              <View style={styles.field}><FieldLabel>Name</FieldLabel><Input inputRef={scenarioNameRef} disabled={saving} label="Scenario name" value={draft.name} onChangeText={updateDraftName} placeholder="Name this scenario" /></View>
              <View style={styles.field}><FieldLabel>Compare over</FieldLabel>{saving ? <AppText accessibilityLabel="Scenario horizon while saving" style={[styles.scopeNote, { color: c.mutedForeground }]}>{draft.horizonMonths} months · Saving…</AppText> : <ChoiceChips values={PLAN_SIMULATION_HORIZONS.map(value => ({ id: String(value), label: `${value} months` }))} selected={String(draft.horizonMonths)} onSelect={updateDraftHorizon} />}</View>
              <AppText style={[styles.scopeNote, { color: c.mutedForeground }]}>Your current working draft stays separate from saved options. Existing device and household scenarios remain readable after a plan change. Clearing app data or deleting your account removes device-only copies.</AppText>
              {editorOpen ? <AppText accessibilityRole="alert" style={[styles.editSemantics, { color: c.primary }]}>Update or cancel this change first.</AppText> : null}
              <PlanFeatureGate feature="saved_scenarios" compact><View style={styles.actionWrap}>
                <Button label="Save as new" icon="save" onPress={() => void saveDevice(true)} disabled={!deviceReady || saving || editorOpen || Boolean(draft.invalidDefinition)} primary />
                <Button label="Update saved scenario" icon="check" onPress={() => void saveDraft()} disabled={(!selectedDevice && !selectedScenario) || Boolean(selectedDevice && !deviceReady) || saving || editorOpen || Boolean(draft.invalidDefinition) || Boolean(selectedScenario && (!canEditHousehold || !canPersistScenarios || demoMode))} />
                <Button label="Rename" icon="type" onPress={() => { scenarioNameRef.current?.focus();setMessage("Edit the scenario name, then choose Update saved scenario."); }} disabled={(!selectedDevice && !selectedScenario) || Boolean(selectedDevice && !deviceReady) || saving || editorOpen || Boolean(selectedScenario && (!canEditHousehold || !canPersistScenarios || demoMode))} />
                <Button label="Duplicate" icon="copy" onPress={() => { if (selectedScenario && canPersistScenarios && canEditHousehold && !demoMode) void saveHouseholdCopy(true);else void saveDevice(true, true); }} disabled={(!deviceReady && !householdWriteEligible) || saving || editorOpen || Boolean(draft.invalidDefinition)} />
              </View></PlanFeatureGate>
              <View style={styles.actionWrap}>
                <Button label="Export scenario" icon="download" onPress={() => void exportDraft()} disabled={saving || editorOpen || Boolean(draft.invalidDefinition)} />
                <Button label={draft.invalidDefinition ? "Reset unsupported changes" : "Reset working draft"} icon="rotate-ccw" onPress={resetDraft} disabled={saving} />
                <Button label="Delete saved scenario" icon="trash-2" onPress={removeScenario} disabled={(!selectedDevice && !selectedScenario) || Boolean(selectedDevice && !deviceReady) || saving || editorOpen || Boolean(selectedScenario && (!canEditHousehold || demoMode))} danger />
                {canPersistScenarios && canEditHousehold && !demoMode ? <Button label="Save household copy" icon="users" onPress={() => void saveHouseholdCopy()} disabled={saving || editorOpen || Boolean(draft.invalidDefinition)} /> : null}
                <Button label="Reload saved scenarios" icon="refresh-cw" onPress={() => void reloadLibraries()} disabled={saving || editorOpen} />
              </View>
              {saving ? <View style={styles.savingRow}><ActivityIndicator size="small" color={c.primary} /><AppText style={[styles.savingText, { color: c.mutedForeground }]}>Saving scenario…</AppText></View> : null}
            </View>
            {!desktop ? <View style={[styles.buildStatus, { backgroundColor: scenarioResult.complete && !scenarioRiskDay ? c.primary + "0B" : c.warning + "10", borderColor: scenarioResult.complete && !scenarioRiskDay ? c.primary + "35" : c.warning + "55" }]}>
              <View style={styles.changeRowCopy}><AppText style={[styles.buildStatusTitle, { color: c.foreground }]}>{scenarioRiskDay ? "This scenario goes below $0" : !scenarioResult.complete ? "Some changes need attention" : "Your comparison is ready"}</AppText><AppText style={[styles.buildStatusText, { color: c.mutedForeground }]}>{scenarioRiskDay ? `First below zero: ${shortDate(scenarioRiskDay.date)}. Open Compare for the full warning.` : !scenarioResult.complete ? "Review the highlighted changes. Compare shows the limits of this result." : `${draft.changes.length} ${draft.changes.length === 1 ? "change" : "changes"} · ${draft.horizonMonths}-month outlook`}</AppText></View><Button label="View comparison" icon="arrow-right" onPress={() => setMobileView("compare")} />
            </View> : null}
            <View><View style={styles.changesToolbar}><View style={styles.sectionHeading}><AppText accessibilityRole="header" tone="title" style={[styles.sectionTitle, { color: c.foreground }]}>Your changes</AppText><View style={[styles.countBadge, { backgroundColor: c.primary + "12" }]}><AppText style={{ color: c.primary, fontFamily: "Inter_700Bold", fontSize: 12 }}>{draft.changes.length}</AppText></View></View><View style={!desktop ? styles.mobileAddChange : undefined}><Button label="Add change" icon="plus" onPress={() => openEditor()} disabled={saving || Boolean(draft.invalidDefinition)} primary /></View></View><ChangeList changes={draft.changes} references={references} issues={scenarioResult.issues} disabled={saving} editingId={editingId} onEdit={id => openEditor(id)} onRemove={removeChange} /></View>
            {draft.invalidDefinition ? <AppText accessibilityRole="alert" style={[styles.editSemantics, { color: c.warning }]}>Reset unsupported changes before adding or editing this scenario.</AppText> : null}
          </View> : null}
          {desktop || mobileView === "compare" ? <View style={[styles.resultsColumn, desktop && styles.resultsColumnDesktop]}>{!canCompareSaved ? <ResultsPanel baseline={baselineResult} scenario={scenarioResult} safetyFloor={settings.safety_floor} /> : null}<PlanFeatureGate feature="scenario_comparison" compact><SavedScenarioComparison key={draftLoadScope} options={savedOptions} selected={comparisonKeys} onSelect={(index, key) => { if (!canCompareSaved || draftLoadScopeRef.current !== draftLoadScope || scenarioAccessRef.current !== scenarioAccessOwner) return;setComparisonKeys(previous => { const next: [string, string] = [...previous];next[index] = key;return next; });setComparisonHorizon(null); }} horizon={commonHorizon} onHorizon={value => { if (canCompareSaved && draftLoadScopeRef.current === draftLoadScope && scenarioAccessRef.current === scenarioAccessOwner) setComparisonHorizon(value); }} comparison={savedComparison} /></PlanFeatureGate>{canCompareSaved && !savedComparison ? <ResultsPanel baseline={baselineResult} scenario={scenarioResult} safetyFloor={settings.safety_floor} /> : null}</View> : null}
        </View>
      </ScrollView>
      {editorOpen ? <Modal visible transparent animationType={desktop ? "fade" : "slide"} onRequestClose={closeEditor} onShow={focusEditor}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={[styles.editorOverlay, desktop && DESKTOP_MODAL_OVERLAY]}>
          <Pressable accessibilityLabel="Dismiss change editor" onPress={closeEditor} style={StyleSheet.absoluteFillObject} />
          <View accessibilityViewIsModal style={[styles.editorSheet, { backgroundColor: c.background, borderColor: c.border }, desktop && DESKTOP_MODAL_WIDE]}>
            {!desktop ? <View style={[styles.sheetHandle, { backgroundColor: c.border }]} /> : null}
            <View style={[styles.editorSheetHeader, { borderColor: c.border }]}>
              <View ref={editorHeadingRef} focusable tabIndex={-1} accessibilityRole="header" accessibilityLabel={editingChange ? "Edit scenario change" : "Add a what-if change"} style={styles.changeRowCopy}><AppText tone="title" style={[styles.cardTitle, { color: c.foreground }]}>{editingChange ? "Edit scenario change" : "Add a what-if change"}</AppText></View>
              <Pressable accessibilityRole="button" accessibilityLabel="Close change editor" onPress={closeEditor} style={styles.closeButton}><Feather name="x" size={22} color={c.mutedForeground} /></Pressable>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator contentContainerStyle={styles.editorScrollContent}>
              <ChangeComposer key={`${draftStorageKey ?? householdId}:${selectedId ?? "local"}:${editorVersion}:${editingId ?? "new"}`} references={references} startDate={startDate} endDate={baseline.endDate} editingChange={editingChange} onSave={saveChange} onCancel={closeEditor} />
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal> : null}
    </SafeAreaView>
  );
}

export default function PlanSimulatorScreen() {
  const { actualPlan, loading, isFeatureLocked, hasFoundingAccess } = useMembership();
  if (loading) return <AppLoadingIntro phase="simulator" accessibilityLabel="FlowLedger is opening Plan Simulator" />;
  if (isFeatureLocked("plan_simulator")) return <LockedPlanSimulator />;
  return <PlanSimulatorWorkspace canPersistScenarios={actualPlan.tier === "pro" && !isFeatureLocked("cloud_scenarios")} canSaveDevice={!isFeatureLocked("saved_scenarios")} canCompareSaved={!isFeatureLocked("scenario_comparison")} hasFoundingAccess={hasFoundingAccess} />;
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, scroll: { flex: 1 }, content: { padding: 16, paddingBottom: 40, gap: 14 }, contentDesktop: { width: "100%", maxWidth: 1480, alignSelf: "center", paddingHorizontal: 28, paddingBottom: 64 },
  header: { minHeight: 88, borderBottomWidth: 1, paddingHorizontal: 18, paddingVertical: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16 }, headerCopy: { flex: 1, maxWidth: 820 }, eyebrow: { fontSize: 10, fontFamily: "Inter_800ExtraBold", letterSpacing: 0.9 }, title: { fontSize: 25, fontFamily: "Inter_800ExtraBold", marginTop: 2 }, subtitle: { fontSize: 13, marginTop: 4, lineHeight: 19 }, closeButton: { width: 44, height: 44, borderRadius: 14, borderWidth: 1, alignItems: "center", justifyContent: "center" }, lockedHeader: { height: 60, alignItems: "flex-end", justifyContent: "center", paddingHorizontal: 16 },
  readOnlyBanner: { borderWidth: 1, borderRadius: 18, padding: 14, flexDirection: "row", gap: 12, alignItems: "center" }, readOnlyCopy: { flex: 1 }, readOnlyTitle: { fontSize: 14, fontFamily: "Inter_800ExtraBold" }, readOnlyText: { fontSize: 12, marginTop: 2, lineHeight: 17 },
  libraryPicker: { marginTop: 14 }, scenarioBar: { marginTop: 14, flexWrap: "wrap", flexDirection: "row", alignItems: "flex-end", gap: 10 }, scenarioSelect: { flex: 1, minWidth: 0 }, viewerNote: { borderWidth: 1, borderRadius: 16, padding: 12, flexDirection: "row", gap: 10, alignItems: "center" }, viewerText: { flex: 1, fontSize: 12, lineHeight: 17 }, message: { borderWidth: 1, borderRadius: 14, padding: 12, flexDirection: "row", alignItems: "center", gap: 10 }, messageText: { flex: 1, fontSize: 12 },
  workspace: { gap: 16 }, workspaceDesktop: { flexDirection: "row", alignItems: "flex-start", gap: 20 }, editorColumn: { flex: 1, minWidth: 0, gap: 16 }, resultsColumn: { minWidth: 0, gap: 16 }, resultsColumnDesktop: { width: "42%", maxWidth: 600, position: Platform.OS === "web" ? "sticky" as any : "relative", top: 16 },
  card: { borderWidth: 1, borderRadius: 22, padding: 16 }, cardTitle: { fontSize: 18, fontFamily: "Inter_800ExtraBold" }, cardDescription: { fontSize: 12, marginTop: 4, lineHeight: 18 }, field: { marginTop: 13 }, fieldLabel: { fontSize: 12, fontFamily: "Inter_800ExtraBold", marginBottom: 6 }, input: { width: "100%", minHeight: 44, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, fontFamily: "Inter_500Medium" }, scopeNote: { fontSize: 12, lineHeight: 16, marginTop: 12 },
  button: { minHeight: 44, borderWidth: 1, borderRadius: 12, paddingHorizontal: 13, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 }, buttonText: { fontSize: 12, fontFamily: "Inter_800ExtraBold" }, actionWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 }, savingRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12 }, savingText: { fontSize: 11 },
  workspaceTabs: { flexDirection: "row", borderWidth: 1, borderRadius: 15, padding: 4, gap: 4 }, workspaceTab: { flex: 1, minHeight: 44, borderRadius: 11, flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center" }, workspaceTabText: { fontSize: 14, fontFamily: "Inter_700Bold" },
  mobileAddChange: { width: "100%" }, changesToolbar: { flexDirection: "row", flexWrap: "wrap", gap: 12, alignItems: "center", justifyContent: "space-between", marginBottom: 12 }, buildStatus: { borderWidth: 1, borderRadius: 17, padding: 13, gap: 12 }, buildStatusTitle: { fontSize: 14, fontFamily: "Inter_700Bold" }, buildStatusText: { fontSize: 12, lineHeight: 18, marginTop: 4 },
  editorOverlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(2,6,23,0.7)" }, editorSheet: { maxHeight: "92%", width: "100%", borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, overflow: "hidden" }, sheetHandle: { height: 4, width: 42, borderRadius: 2, alignSelf: "center", marginTop: 10 }, editorSheetHeader: { paddingHorizontal: 18, paddingVertical: 12, flexDirection: "row", alignItems: "center", gap: 12, borderBottomWidth: 1 }, editorScrollContent: { paddingBottom: 24 }, composerBody: { padding: 18 },
  composerHeading: { flexDirection: "row", gap: 12, alignItems: "flex-start", marginBottom: 16 }, editorIcon: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  categoryTabs: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginBottom: 12 }, categoryTab: { minHeight: 44, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, alignItems: "center", justifyContent: "center" }, categoryTabText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  editingBadge: { padding: 11, borderRadius: 12, flexDirection: "row", alignItems: "center", gap: 8 }, editingBadgeText: { fontSize: 13, fontFamily: "Inter_700Bold" }, composerActions: { marginTop: 16, flexDirection: "row", flexWrap: "wrap", gap: 8 },
  sectionHeading: { flexDirection: "row", alignItems: "center", gap: 9 }, countBadge: { minWidth: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  changeRowTop: { flexDirection: "row", alignItems: "flex-start", gap: 10 }, changeNumber: { width: 28, height: 28, borderRadius: 9, alignItems: "center", justifyContent: "center" }, changeSummary: { fontSize: 12, lineHeight: 18, marginTop: 4 }, changeRowActions: { flexDirection: "row", gap: 8, flexWrap: "wrap" }, changeAction: { minHeight: 44, paddingHorizontal: 12, borderRadius: 11, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 }, changeActionText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  changeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, changeOption: { width: "100%", minHeight: 60, borderWidth: 1, borderRadius: 14, padding: 10, flexDirection: "row", alignItems: "center", gap: 9 }, changeOptionCopy: { flex: 1 }, changeOptionTitle: { fontSize: 12, fontFamily: "Inter_800ExtraBold" }, changeOptionDetail: { fontSize: 12, marginTop: 2, lineHeight: 14 }, errorText: { fontSize: 12, fontFamily: "Inter_600SemiBold", marginVertical: 10 }, editSemantics: { fontSize: 12, lineHeight: 16, marginVertical: 10 },
  sectionTitle: { fontSize: 18, fontFamily: "Inter_800ExtraBold" }, emptyCard: { borderWidth: 1, borderStyle: "dashed", borderRadius: 18, padding: 22, alignItems: "center" }, emptyTitle: { marginTop: 10, fontSize: 15, fontFamily: "Inter_800ExtraBold" }, emptyText: { fontSize: 12, marginTop: 4, textAlign: "center" }, changeList: { gap: 8 }, changeRow: { borderWidth: 1, borderRadius: 18, padding: 14, gap: 10 }, changeRowCopy: { flex: 1 }, changeRowTitle: { fontSize: 14, fontFamily: "Inter_700Bold" }, changeIssue: { fontSize: 12, fontFamily: "Inter_600SemiBold", marginTop: 3 }, changeOkay: { fontSize: 10, fontFamily: "Inter_600SemiBold", marginTop: 3 },
  resultsCard: { borderWidth: 1, borderRadius: 24, padding: 17 }, resultsHeader: { flexWrap: "wrap", flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }, resultsTitle: { fontSize: 20, fontFamily: "Inter_800ExtraBold", marginTop: 2 }, statusBadge: { minHeight: 30, borderRadius: 999, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 5 }, statusText: { fontSize: 11, fontFamily: "Inter_800ExtraBold" }, resultsNote: { fontSize: 12, lineHeight: 16, marginTop: 8 }, attention: { borderWidth: 1, borderRadius: 14, padding: 11, marginTop: 12 }, negativeHeader: { flexDirection: "row", alignItems: "center", gap: 7 }, attentionTitle: { fontSize: 12, fontFamily: "Inter_800ExtraBold", marginBottom: 4 }, attentionText: { fontSize: 12, lineHeight: 16 }, metricsGrid: { gap: 9, marginTop: 14 }, metric: { borderWidth: 1, borderRadius: 15, padding: 12 }, metricLabel: { fontSize: 12, fontFamily: "Inter_800ExtraBold" }, metricValues: { flexDirection: "row", justifyContent: "space-between", gap: 12, marginTop: 7 }, metricValuesStack: { flexDirection: "column", gap: 12 }, metricReal: { flex: 1, minWidth: 0 }, metricScenarioStack: { alignItems: "flex-start" }, metricScenario: { alignItems: "flex-end", flex: 1, minWidth: 0 }, metricCaption: { fontSize: 11 }, metricValueRight: { textAlign: "right" }, metricValue: { width: "100%", flexShrink: 1, fontSize: 20, fontFamily: "Inter_800ExtraBold", marginTop: 1 },
  safetyRow: { borderTopWidth: 1, borderBottomWidth: 1, marginTop: 14, paddingVertical: 13, flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: 12 }, safetyItem: { flexGrow: 1, flexBasis: 180, minWidth: 0 }, safetyLabel: { fontSize: 12 }, safetyValue: { fontSize: 16, fontFamily: "Inter_800ExtraBold", marginTop: 2 }, debtImpact: { borderWidth: 1, borderRadius: 16, padding: 13, flexDirection: "row", gap: 11, marginTop: 14 }, debtImpactCopy: { flex: 1 }, debtImpactTitle: { fontSize: 12, fontFamily: "Inter_700Bold" }, debtImpactValue: { fontSize: 18, fontFamily: "Inter_800ExtraBold", marginTop: 2 }, debtImpactNote: { fontSize: 12, marginTop: 2 }, monthSection: { marginTop: 18 }, monthSectionTitle: { fontSize: 16, fontFamily: "Inter_800ExtraBold", marginBottom: 7 }, monthRow: { borderTopWidth: 1, paddingVertical: 11 }, monthRowTop: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 8 }, monthName: { fontSize: 12, fontFamily: "Inter_700Bold" }, monthNet: { flexShrink: 0, maxWidth: "100%", fontSize: 13, fontFamily: "Inter_800ExtraBold" }, barTrack: { marginTop: 8, gap: 3 }, bar: { height: 4, borderRadius: 2 }, monthDetails: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", marginTop: 7, gap: 7 }, monthDetail: { fontSize: 11 },
});
