import { PrivacyView as View } from "@/components/privacy/PrivacyPrimitives";
import React from "react";
import { StyleSheet, useWindowDimensions } from "react-native";
import { AppText } from "./AppText";
import { ScenarioOptionPicker } from "./ScenarioOptionPicker";
import { SimulatorChoiceChips } from "./SimulatorChoiceChips";
import { useColors } from "@/hooks/useColors";
import { PLAN_SIMULATION_HORIZONS, firstNegativeBalanceDay, type PlanSimulationHorizon } from "@/lib/planSimulator";
import { type SavedComparisonOption, type compareSavedPlanScenarios } from "@/lib/planSimulationComparison";
const money = (amount: number) => amount.toLocaleString(undefined, { style: "currency", currency: "USD" });
export function SavedScenarioComparison({ options, selected, onSelect, horizon, onHorizon, comparison }: { options: SavedComparisonOption[]; selected: [string, string]; onSelect: (index: 0 | 1, key: string) => void; horizon: PlanSimulationHorizon; onHorizon: (horizon: PlanSimulationHorizon) => void; comparison: ReturnType<typeof compareSavedPlanScenarios> | null }) {
  const c = useColors();
  const { width } = useWindowDimensions();
  const compact = width < 600;
  const values = comparison ? [{ key: "current-plan", name: "Current plan", source: "Live Forecast", savedHorizon: null, result: comparison.current }, ...comparison.options.map(option => ({ key: option.key, name: option.draft.name, source: option.source, savedHorizon: option.draft.horizonMonths, result: option.result }))] : [];
  return <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
    <AppText accessibilityRole="header" style={[styles.title, { color: c.foreground }]}>Compare saved scenarios</AppText>
    <AppText style={[styles.description, { color: c.mutedForeground }]}>Choose two saved options. Save working changes first to include them. All three columns use the same current plan, start date, forecast range and safety floor. No changes are applied.</AppText>
    {options.length < 2 ? <AppText style={[styles.note, { color: c.mutedForeground }]}>Save at least two named scenarios to compare them with your current plan.</AppText> : null}
    {([0, 1] as const).map(index => <ScenarioOptionPicker key={index} label={`Comparison option ${index === 0 ? "A" : "B"}`} options={options.map(option => ({ key: option.key, name: option.draft.name, source: option.source }))} selectedKey={selected[index] || null} onSelect={key => onSelect(index, key)} />)}
    <AppText style={[styles.label, { color: c.mutedForeground }]}>Common comparison horizon</AppText>
    <SimulatorChoiceChips values={PLAN_SIMULATION_HORIZONS.map(value => ({ id: String(value), label: `${value} months` }))} selected={String(horizon)} onSelect={value => onHorizon(Number(value) as PlanSimulationHorizon)} />
    {selected[0] && selected[0] === selected[1] ? <AppText accessibilityRole="alert" style={[styles.note, { color: c.warning }]}>Choose two different saved scenarios.</AppText> : null}
    {comparison ? <>
      <AppText style={[styles.note, { color: c.mutedForeground }]}>Shared date coverage: {comparison.startDate} to {comparison.endDate}. Saved horizons are shown below and remain unchanged. Results are rebuilt from the latest records.</AppText>
      {values.map(value => { const negative = firstNegativeBalanceDay(value.result.days);return <View key={value.key} style={[styles.result, { backgroundColor: c.background, borderColor: !value.result.complete || negative ? c.warning : c.border }]}>
        <AppText style={[styles.name, { color: c.foreground }]}>{value.name}</AppText><AppText style={[styles.source, { color: c.mutedForeground }]}>{value.source}{value.savedHorizon ? ` · saved with ${value.savedHorizon} months` : ""}</AppText>
        <AppText style={[styles.complete, { color: value.result.complete ? c.success : c.warning }]}>{value.result.complete ? "Complete for this range" : "Partial comparison — review the limitations"}</AppText>
        {!value.result.complete ? value.result.issues.map((issue, index) => <AppText key={index} accessibilityRole="alert" style={[styles.note, { color: c.warning }]}>{issue.message}</AppText>) : null}
        {negative ? <AppText accessibilityRole="alert" style={[styles.note, { color: c.destructive }]}>Below-zero warning: first below $0 on {negative.date} ({money(negative.balance)}).</AppText> : null}

      </View>; })}
      {([
        { label: "Ending balance", read: (result: typeof comparison.current) => money(result.endingBalance) },
        { label: "Tightest forecast point", read: (result: typeof comparison.current) => `${money(result.lowestBalance)} · ${result.lowestBalanceDate}` },
        { label: "Safety floor", read: (result: typeof comparison.current) => money(result.safetyFloor) },
        { label: "FlowScore", read: (result: typeof comparison.current) => String(result.flowScore) },
        { label: "Protected days", read: (result: typeof comparison.current) => String(result.protectedDays) },
        { label: "Savings added", read: (result: typeof comparison.current) => money(result.savingsAdded) },
        { label: "Extra debt applied", read: (result: typeof comparison.current) => money(result.debtExtraApplied) },
        { label: "Potential debt-free date", read: (result: typeof comparison.current) => result.potentialDebtFreeDate ?? "Not available" },
      ]).map(metric => <View key={metric.label} style={[styles.metricRow, { backgroundColor: c.background, borderColor: c.border }]}><AppText style={[styles.metricHeading, { color: c.foreground }]}>{metric.label}</AppText><View style={styles.cells}>{values.map((value, index) => <View key={value.key} style={[styles.cell, compact && index === 0 ? styles.currentCell : null]}><AppText style={[styles.metricLabel, { color: c.mutedForeground }]}>{value.name}</AppText><AppText style={[styles.amount, { color: c.foreground }]}>{metric.read(value.result)}</AppText></View>)}</View></View>)}
      <AppText style={[styles.note, { color: c.mutedForeground }]}>These are trade-offs, not a recommendation or a safe-to-spend promise. A partial or below-zero option needs review.</AppText>
    </> : null}
  </View>;
}
const styles = StyleSheet.create({ card: { borderWidth: 1, borderRadius: 23, padding: 17, gap: 13 }, title: { fontSize: 20, fontFamily: "Inter_800ExtraBold" }, description: { fontSize: 12, lineHeight: 18 }, label: { fontSize: 12, fontFamily: "Inter_700Bold" }, note: { fontSize: 12, lineHeight: 18 }, result: { borderWidth: 1, borderRadius: 16, padding: 13, gap: 7 }, name: { fontSize: 17, fontFamily: "Inter_700Bold" }, source: { fontSize: 12 }, complete: { fontSize: 12, fontFamily: "Inter_600SemiBold" }, metricRow: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 10 }, metricHeading: { fontSize: 13, fontFamily: "Inter_700Bold" }, cells: { flexDirection: "row", flexWrap: "wrap", gap: 12 }, cell: { flex: 1, minWidth: 0, gap: 4 }, currentCell: { flexBasis: "100%", flexGrow: 0, flexShrink: 0 }, metric: { gap: 3, marginTop: 5 }, metricLabel: { fontSize: 11 }, amount: { width: "100%", flexShrink: 1, fontSize: 16, fontFamily: "Inter_700Bold" } });
