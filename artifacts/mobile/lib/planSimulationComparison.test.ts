import assert from "node:assert/strict";
import test from "node:test";
import { buildCanonicalPlanSimulationBaseline, type PlanSimulationReferences } from "./planSimulator";
import { compareSavedPlanScenarios, defaultScenarioComparisonHorizon, type SavedComparisonOption } from "./planSimulationComparison";
const references: PlanSimulationReferences = { incomes: [], bills: [], debts: [], debtMethod: "snowball" };
const metrics = { flowScore: 80, flowScoreRequiredAmountDue: 100, flowScoreRequiredAmountCovered: 100, protectedDays: 20, requiredMonthlyOutflow: 100, forecastConfidence: "high" as const, currentDebtFreeDate: null };
function baseline(opening = 5000) { return buildCanonicalPlanSimulationBaseline({ startDate: "2026-10-27", horizonMonths: 6, getDailyBalances: (month, year) => Array.from({ length: new Date(year, month + 1, 0).getDate() }, (_, index) => ({ day: index + 1, net: 0, balance: opening, projectedInflow: 0, projectedOutflow: 0, events: [] })) }); }
const a: SavedComparisonOption = { key: "device:a", source: "On this device", draft: { name: "Option A", horizonMonths: 3, changes: [{ id: "a", type: "spending_once", name: "A purchase", amount: 100, date: "2026-11-01" }] } };
const b: SavedComparisonOption = { key: "household:b", source: "Household", draft: { name: "Option B", horizonMonths: 12, changes: [{ id: "b", type: "spending_once", name: "B purchase", amount: 200, date: "2026-11-01" }] } };
test("two options and Current plan share exact range, live baseline, references, metrics and floor without mutating saved horizons", () => {
  const before = JSON.stringify([a, b]);const result = compareSavedPlanScenarios({ baseline: baseline(), options: [a, b], references, metrics, safetyFloor: 400 });
  assert.equal(result.current.endingBalance, 5000);assert.equal(result.options[0].result.endingBalance, 4900);assert.equal(result.options[1].result.endingBalance, 4800);
  for (const projection of [result.current, ...result.options.map(option => option.result)]) { assert.equal(projection.days[0].date, result.startDate);assert.equal(projection.days.at(-1)!.date, result.endDate);assert.equal(projection.safetyFloor, 400); }
  assert.equal(JSON.stringify([a, b]), before);assert.equal(defaultScenarioComparisonHorizon([a, b]), 12);
  const fresh = compareSavedPlanScenarios({ baseline: baseline(6000), options: [a, b], references, metrics, safetyFloor: 400 });assert.equal(fresh.current.endingBalance, 6000);assert.equal(fresh.options[0].result.endingBalance, 5900);
});
test("missing references, unsupported definitions, out-of-common-range dates and below-zero options remain explicit", () => {
  const out = { ...b, draft: { ...b.draft, changes: [{ id: "future", type: "income_add" as const, name: "Later", amount: 100, frequency: "monthly" as const, startDate: "2027-12-01" }] } };
  const negative = { ...a, draft: { ...a.draft, changes: [{ ...a.draft.changes[0], amount: 6000 }] } } as SavedComparisonOption;
  const result = compareSavedPlanScenarios({ baseline: baseline(), options: [negative, out], references, metrics, safetyFloor: 400 });assert.ok(result.options[0].result.lowestBalance < 0);assert.equal(result.options[1].result.complete, false);assert.match(result.options[1].result.issues.map(issue => issue.message).join(" "), /common comparison range/);
  const missing = { ...a, draft: { ...a.draft, changes: [{ id: "missing", type: "income_edit" as const, incomeId: "gone", amount: 100, effectiveDate: "2026-11-01" }] } };
  assert.equal(compareSavedPlanScenarios({ baseline: baseline(), options: [missing, b], references, metrics, safetyFloor: 400 }).options[0].result.complete, false);
  assert.equal(compareSavedPlanScenarios({ baseline: baseline(), options: [{ ...a, draft: { ...a.draft, invalidDefinition: true } }, b], references, metrics, safetyFloor: 400 }).options[0].result.complete, false);
  assert.throws(() => compareSavedPlanScenarios({ baseline: baseline(), options: [a, a], references, metrics, safetyFloor: 400 }), /different/);
});
