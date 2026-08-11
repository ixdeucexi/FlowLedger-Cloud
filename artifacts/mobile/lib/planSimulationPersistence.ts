import { supabase } from "./supabase";
import {
  decodePlanSimulationChanges,
  normalizePlanSimulationRow,
  safePlanSimulationName,
  type PlanSimulationChange,
  type PlanSimulationDefinition,
  type PlanSimulationHorizon,
} from "./planSimulator";

const SELECT_COLUMNS = "id,household_id,name,horizon_months,changes,schema_version,version,created_by,updated_by,created_at,updated_at";

function validDefinitionInput(name: string, changes: readonly PlanSimulationChange[]) {
  const normalizedName = safePlanSimulationName(name);
  const decodedChanges = decodePlanSimulationChanges(changes);
  if (!normalizedName) throw new Error("Scenario names must be between 1 and 80 characters.");
  if (!decodedChanges) throw new Error("This scenario contains an unsupported change. Remove it and try again.");
  return { normalizedName, decodedChanges };
}

function normalizeSavedRow(row: unknown): PlanSimulationDefinition {
  const normalized = row && typeof row === "object"
    ? normalizePlanSimulationRow(row as Record<string, unknown>)
    : null;
  if (!normalized) throw new Error("FlowLedger could not read the saved scenario.");
  return normalized;
}

export async function loadPlanSimulations(householdId: string): Promise<PlanSimulationDefinition[]> {
  const result = await supabase
    .from("plan_simulations")
    .select(SELECT_COLUMNS)
    .eq("household_id", householdId)
    .order("updated_at", { ascending: false });
  if (result.error) throw new Error(`Load Plan Simulator: ${result.error.message}`);
  return (result.data ?? []).map(row => normalizeSavedRow(row));
}

export async function createPlanSimulation(input: {
  householdId: string;
  name: string;
  horizonMonths: PlanSimulationHorizon;
  changes: readonly PlanSimulationChange[];
}): Promise<PlanSimulationDefinition> {
  const { normalizedName, decodedChanges } = validDefinitionInput(input.name, input.changes);
  const result = await supabase
    .from("plan_simulations")
    .insert({
      household_id: input.householdId,
      name: normalizedName,
      horizon_months: input.horizonMonths,
      changes: decodedChanges,
      schema_version: 1,
    })
    .select(SELECT_COLUMNS)
    .single();
  if (result.error) throw new Error(`Save Plan Simulator: ${result.error.message}`);
  return normalizeSavedRow(result.data);
}

export async function updatePlanSimulation(input: {
  scenario: PlanSimulationDefinition;
  name: string;
  horizonMonths: PlanSimulationHorizon;
  changes: readonly PlanSimulationChange[];
}): Promise<PlanSimulationDefinition> {
  const { normalizedName, decodedChanges } = validDefinitionInput(input.name, input.changes);
  const result = await supabase
    .from("plan_simulations")
    .update({
      name: normalizedName,
      horizon_months: input.horizonMonths,
      changes: decodedChanges,
      version: input.scenario.version + 1,
    })
    .eq("id", input.scenario.id)
    .eq("household_id", input.scenario.householdId)
    .eq("version", input.scenario.version)
    .select(SELECT_COLUMNS)
    .maybeSingle();
  if (result.error) throw new Error(`Update Plan Simulator: ${result.error.message}`);
  if (!result.data) throw new Error("This scenario changed somewhere else. Refresh it before saving again.");
  return normalizeSavedRow(result.data);
}

export async function deletePlanSimulation(scenario: PlanSimulationDefinition): Promise<void> {
  const result = await supabase
    .from("plan_simulations")
    .delete()
    .eq("id", scenario.id)
    .eq("household_id", scenario.householdId)
    .eq("version", scenario.version)
    .select("id")
    .maybeSingle();
  if (result.error) throw new Error(`Delete Plan Simulator: ${result.error.message}`);
  if (!result.data) throw new Error("This scenario changed somewhere else. Refresh it before deleting.");
}
