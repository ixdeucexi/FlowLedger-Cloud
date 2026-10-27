import { projectPlanSimulation, type PlanSimulationBaseline, type PlanSimulationHorizon, type PlanSimulationMetricsBaseline, type PlanSimulationReferences } from "./planSimulator";
import type { ScenarioDraft } from "./planSimulationLibrary";
export type SavedComparisonOption = { key: string; source: "On this device" | "Household"; draft: ScenarioDraft };
export function defaultScenarioComparisonHorizon(options: readonly SavedComparisonOption[]): PlanSimulationHorizon {
  return Math.max(3, ...options.map(option => option.draft.horizonMonths)) as PlanSimulationHorizon;
}
/** All three projections receive the exact same immutable real-plan inputs. */
export function compareSavedPlanScenarios(input: { baseline: PlanSimulationBaseline; options: readonly [SavedComparisonOption, SavedComparisonOption]; references: PlanSimulationReferences; metrics: PlanSimulationMetricsBaseline; safetyFloor: number }) {
  if (input.options[0].key === input.options[1].key) throw new Error("Choose two different saved scenarios.");
  const shared = { baseline: input.baseline, references: input.references, metrics: input.metrics, safetyFloor: input.safetyFloor };
  return {
    startDate: input.baseline.startDate, endDate: input.baseline.endDate,
    current: projectPlanSimulation({ ...shared, changes: [] }),
    options: input.options.map(option => {
      const result = projectPlanSimulation({ ...shared, changes: option.draft.changes, definitionIssue: option.draft.invalidDefinition ? "This saved option has an unsupported definition. Reset it before using this comparison." : null });
      const coverage = option.draft.changes.filter(change => Object.entries(change).some(([key, value]) => ["date", "startDate", "effectiveDate", "occurrenceDate", "newDate"].includes(key) && typeof value === "string" && (value < input.baseline.startDate || value > input.baseline.endDate)))
        .filter(change => !result.issues.some(issue => issue.changeId === change.id && /horizon|range|outside|no open occurrence/.test(issue.message)))
        .map(change => ({ changeId: change.id, message: "This saved change has dates outside the common comparison range. Its full saved time span is not represented here." }));
      return { ...option, result: coverage.length ? { ...result, complete: false, issues: [...result.issues, ...coverage] } : result };
    }),
  };
}
