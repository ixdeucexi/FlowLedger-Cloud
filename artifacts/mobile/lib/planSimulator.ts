import type { FinancialEvent } from "./forecast";
import { FLOW_SCORE_WEIGHTS } from "./flowScorePolicy";
import { allocateSnowballExtra, projectSnowballMonth, type DebtMethod, type SnowballDebtInput } from "./snowball";
import { getBillOccurrenceDays, isBillActiveForMonth } from "./schedule";
import { buildStabilityProgress } from "./stability";

export const PLAN_SIMULATION_VERSION = 1;
export const PLAN_SIMULATION_HORIZONS = [3, 6, 12, 24] as const;
export type PlanSimulationHorizon = typeof PLAN_SIMULATION_HORIZONS[number];
export type SimulationIncomeFrequency = "monthly" | "biweekly" | "weekly";
export type SimulationBillFrequency = "monthly" | "quarterly" | "biweekly" | "weekly";

type ChangeBase = { id: string };
export type PlanSimulationChange =
  | (ChangeBase & { type: "income_add"; name: string; amount: number; frequency: SimulationIncomeFrequency; startDate: string })
  | (ChangeBase & { type: "income_edit"; incomeId: string; amount: number; effectiveDate: string })
  | (ChangeBase & { type: "income_pause"; incomeId: string; effectiveDate: string })
  | (ChangeBase & { type: "income_once"; name: string; amount: number; date: string })
  | (ChangeBase & { type: "bill_add"; name: string; amount: number; frequency: SimulationBillFrequency; startDate: string })
  | (ChangeBase & { type: "bill_edit"; billId: string; amount: number; effectiveDate: string })
  | (ChangeBase & { type: "bill_pause"; billId: string; effectiveDate: string })
  | (ChangeBase & { type: "bill_move"; billId: string; occurrenceDate: string; newDate: string })
  | (ChangeBase & { type: "spending_once"; name: string; amount: number; date: string })
  | (ChangeBase & { type: "savings_once"; name: string; amount: number; date: string })
  | (ChangeBase & { type: "debt_extra"; amount: number; date: string });

export interface PlanSimulationDefinition {
  id: string;
  householdId: string;
  name: string;
  horizonMonths: PlanSimulationHorizon;
  changes: PlanSimulationChange[];
  schemaVersion: number;
  version: number;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  invalidDefinition?: boolean;
}

export interface CanonicalPlanSimulationDay {
  date: string;
  inflow: number;
  outflow: number;
  net: number;
  balance: number;
  events: FinancialEvent[];
}

export interface PlanSimulationBaseline {
  startDate: string;
  endDate: string;
  openingBalance: number;
  days: CanonicalPlanSimulationDay[];
}

export interface PlanSimulationIncomeReference {
  id: string;
  name: string;
  amount: number;
}

export interface PlanSimulationBillReference {
  id: string;
  name: string;
  amount: number;
  frequency: SimulationBillFrequency;
  isDebt: boolean;
  isRequired?: boolean;
  /** Canonical selected-month amounts/counts; recurring averages are not used. */
  currentMonthEffectiveTotal?: number;
  currentMonthConfiguredTotal?: number;
  currentMonthOccurrenceCount?: number;
  currentMonthOpenOccurrenceCount?: number;
}

export interface PlanSimulationDebtReference extends SnowballDebtInput {
  frequency?: SimulationBillFrequency;
  dayOfWeek?: number;
  nextPaymentDate?: string;
  startDate?: string;
  endDate?: string;
}

export interface PlanSimulationReferences {
  incomes: PlanSimulationIncomeReference[];
  bills: PlanSimulationBillReference[];
  debts: PlanSimulationDebtReference[];
  debtMethod: DebtMethod;
  /** Existing live safe-extra strategy, keyed YYYY-MM, shared by both comparisons. */
  payoffStrategyExtrasByMonth?: Readonly<Record<string, number>>;
}

export interface PlanSimulationMetricsBaseline {
  flowScore: number;
  protectedDays: number;
  requiredMonthlyOutflow: number;
  forecastConfidence: "high" | "medium" | "low";
  currentDebtFreeDate: string | null;
}

export interface PlanSimulationIssue {
  changeId: string;
  message: string;
}

export interface PlanSimulationMonthResult {
  month: string;
  inflows: number;
  outflows: number;
  cashRemaining: number;
  endingBalance: number;
  lowestBalance: number;
  lowestBalanceDate: string;
}

export interface PlanSimulationResult {
  days: CanonicalPlanSimulationDay[];
  months: PlanSimulationMonthResult[];
  endingBalance: number;
  lowestBalance: number;
  lowestBalanceDate: string;
  safetyFloor: number;
  flowScore: number;
  protectedDays: number;
  requiredMonthlyOutflow: number;
  savingsAdded: number;
  debtExtraApplied: number;
  debtAllocations: Array<{ changeId: string; billId: string; billName: string; amount: number; date: string }>;
  potentialDebtFreeDate: string | null;
  payoffImpactMonths: number | null;
  issues: PlanSimulationIssue[];
  complete: boolean;
}

export interface CanonicalDailyBalanceLike {
  day: number;
  net: number;
  balance: number;
  projectedInflow?: number;
  projectedOutflow?: number;
  income?: number;
  events?: FinancialEvent[];
  projectionEvents?: FinancialEvent[];
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CHANGE_TYPES = new Set<PlanSimulationChange["type"]>([
  "income_add", "income_edit", "income_pause", "income_once",
  "bill_add", "bill_edit", "bill_pause", "bill_move",
  "spending_once", "savings_once", "debt_extra",
]);

function cents(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export function isPlanSimulationHorizon(value: unknown): value is PlanSimulationHorizon {
  return typeof value === "number" && PLAN_SIMULATION_HORIZONS.includes(value as PlanSimulationHorizon);
}

export function isValidPlanSimulationDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isName(value: unknown): value is string {
  return typeof value === "string" && value.trim().length >= 1 && value.trim().length <= 80;
}

function isId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length >= 1 && value.length <= 160;
}

function isAmount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0.005 && value <= 1_000_000_000;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function decodeChange(value: unknown): PlanSimulationChange | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (!isId(row.id) || typeof row.type !== "string" || !CHANGE_TYPES.has(row.type as PlanSimulationChange["type"])) return null;
  switch (row.type) {
    case "income_add":
      return hasExactKeys(row, ["id", "type", "name", "amount", "frequency", "startDate"])
        && isName(row.name) && isAmount(row.amount)
        && (row.frequency === "monthly" || row.frequency === "biweekly" || row.frequency === "weekly")
        && isValidPlanSimulationDate(row.startDate)
        ? { id: row.id, type: row.type, name: row.name.trim(), amount: cents(row.amount), frequency: row.frequency, startDate: row.startDate }
        : null;
    case "income_edit":
      return hasExactKeys(row, ["id", "type", "incomeId", "amount", "effectiveDate"])
        && isId(row.incomeId) && isAmount(row.amount) && isValidPlanSimulationDate(row.effectiveDate)
        ? { id: row.id, type: row.type, incomeId: row.incomeId, amount: cents(row.amount), effectiveDate: row.effectiveDate }
        : null;
    case "income_pause":
      return hasExactKeys(row, ["id", "type", "incomeId", "effectiveDate"])
        && isId(row.incomeId) && isValidPlanSimulationDate(row.effectiveDate)
        ? { id: row.id, type: row.type, incomeId: row.incomeId, effectiveDate: row.effectiveDate }
        : null;
    case "income_once":
      return hasExactKeys(row, ["id", "type", "name", "amount", "date"])
        && isName(row.name) && isAmount(row.amount) && isValidPlanSimulationDate(row.date)
        ? { id: row.id, type: row.type, name: row.name.trim(), amount: cents(row.amount), date: row.date }
        : null;
    case "bill_add":
      return hasExactKeys(row, ["id", "type", "name", "amount", "frequency", "startDate"])
        && isName(row.name) && isAmount(row.amount)
        && (row.frequency === "monthly" || row.frequency === "quarterly" || row.frequency === "biweekly" || row.frequency === "weekly")
        && isValidPlanSimulationDate(row.startDate)
        ? { id: row.id, type: row.type, name: row.name.trim(), amount: cents(row.amount), frequency: row.frequency, startDate: row.startDate }
        : null;
    case "bill_edit":
      return hasExactKeys(row, ["id", "type", "billId", "amount", "effectiveDate"])
        && isId(row.billId) && isAmount(row.amount) && isValidPlanSimulationDate(row.effectiveDate)
        ? { id: row.id, type: row.type, billId: row.billId, amount: cents(row.amount), effectiveDate: row.effectiveDate }
        : null;
    case "bill_pause":
      return hasExactKeys(row, ["id", "type", "billId", "effectiveDate"])
        && isId(row.billId) && isValidPlanSimulationDate(row.effectiveDate)
        ? { id: row.id, type: row.type, billId: row.billId, effectiveDate: row.effectiveDate }
        : null;
    case "bill_move":
      return hasExactKeys(row, ["id", "type", "billId", "occurrenceDate", "newDate"])
        && isId(row.billId) && isValidPlanSimulationDate(row.occurrenceDate) && isValidPlanSimulationDate(row.newDate)
        ? { id: row.id, type: row.type, billId: row.billId, occurrenceDate: row.occurrenceDate, newDate: row.newDate }
        : null;
    case "spending_once":
    case "savings_once":
      return hasExactKeys(row, ["id", "type", "name", "amount", "date"])
        && isName(row.name) && isAmount(row.amount) && isValidPlanSimulationDate(row.date)
        ? { id: row.id, type: row.type, name: row.name.trim(), amount: cents(row.amount), date: row.date }
        : null;
    case "debt_extra":
      return hasExactKeys(row, ["id", "type", "amount", "date"])
        && isAmount(row.amount) && isValidPlanSimulationDate(row.date)
        ? { id: row.id, type: row.type, amount: cents(row.amount), date: row.date }
        : null;
  }
  return null;
}

export function decodePlanSimulationChanges(value: unknown, schemaVersion = PLAN_SIMULATION_VERSION): PlanSimulationChange[] | null {
  if (schemaVersion !== PLAN_SIMULATION_VERSION) return null;
  if (!Array.isArray(value) || value.length > 50) return null;
  let encoded = "";
  try { encoded = JSON.stringify(value); } catch { return null; }
  if (new TextEncoder().encode(encoded).length > 65_536) return null;
  const decoded = value.map(decodeChange);
  if (decoded.some(change => change === null)) return null;
  const changes = decoded as PlanSimulationChange[];
  return new Set(changes.map(change => change.id)).size === changes.length ? changes : null;
}

export function normalizePlanSimulationRow(row: Record<string, unknown>): PlanSimulationDefinition | null {
  if (!isId(row.id) || !isId(row.household_id) || !isName(row.name) || !isPlanSimulationHorizon(row.horizon_months)) return null;
  const schemaVersion = Number(row.schema_version);
  const version = Number(row.version);
  if (!Number.isInteger(schemaVersion) || schemaVersion < 1 || !Number.isInteger(version) || version < 1) return null;
  const versionedChanges = decodePlanSimulationChanges(row.changes, schemaVersion);
  return {
    id: row.id,
    householdId: row.household_id,
    name: row.name.trim(),
    horizonMonths: row.horizon_months,
    changes: versionedChanges ?? [],
    schemaVersion,
    version,
    createdBy: typeof row.created_by === "string" ? row.created_by : "",
    updatedBy: typeof row.updated_by === "string" ? row.updated_by : "",
    createdAt: typeof row.created_at === "string" ? row.created_at : "",
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : "",
    invalidDefinition: versionedChanges === null,
  };
}

function endOfHorizon(startDate: string, horizonMonths: PlanSimulationHorizon): string {
  const [year, month] = startDate.split("-").map(Number);
  const end = new Date(Date.UTC(year, month - 1 + horizonMonths, 0));
  return end.toISOString().slice(0, 10);
}

export function buildCanonicalPlanSimulationBaseline(input: {
  startDate: string;
  horizonMonths: PlanSimulationHorizon;
  getDailyBalances: (month: number, year: number) => CanonicalDailyBalanceLike[];
}): PlanSimulationBaseline {
  if (!isValidPlanSimulationDate(input.startDate)) throw new Error("Invalid simulator start date");
  const [startYear, startMonth] = input.startDate.split("-").map(Number);
  const endDate = endOfHorizon(input.startDate, input.horizonMonths);
  const days: CanonicalPlanSimulationDay[] = [];
  for (let offset = 0; offset < input.horizonMonths; offset += 1) {
    const cursor = new Date(Date.UTC(startYear, startMonth - 1 + offset, 1));
    const year = cursor.getUTCFullYear();
    const month = cursor.getUTCMonth();
    const prefix = `${year}-${String(month + 1).padStart(2, "0")}`;
    input.getDailyBalances(month, year).forEach(day => {
      const date = `${prefix}-${String(day.day).padStart(2, "0")}`;
      if (date < input.startDate || date > endDate) return;
      const net = cents(day.net);
      const inflow = cents(day.projectedInflow ?? Math.max(0, Number(day.income) || 0));
      const outflow = cents(day.projectedOutflow ?? Math.max(0, inflow - net));
      days.push({ date, inflow, outflow, net, balance: cents(day.balance), events: (day.projectionEvents ?? day.events ?? []).map(event => ({ ...event })) });
    });
  }
  days.sort((left, right) => left.date.localeCompare(right.date));
  const openingBalance = days[0] ? cents(days[0].balance - days[0].net) : 0;
  return { startDate: input.startDate, endDate, openingBalance, days };
}

function dateFromIso(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function recurringSimulationDates(
  startDate: string,
  endDate: string,
  frequency: SimulationBillFrequency,
): string[] {
  if (!isValidPlanSimulationDate(startDate) || !isValidPlanSimulationDate(endDate) || startDate > endDate) return [];
  const output: string[] = [];
  if (frequency === "weekly" || frequency === "biweekly") {
    const cursor = dateFromIso(startDate);
    const step = frequency === "weekly" ? 7 : 14;
    while (isoDate(cursor) <= endDate) {
      output.push(isoDate(cursor));
      cursor.setUTCDate(cursor.getUTCDate() + step);
    }
    return output;
  }
  const [startYear, startMonth, anchorDay] = startDate.split("-").map(Number);
  const step = frequency === "quarterly" ? 3 : 1;
  for (let offset = 0; ; offset += step) {
    const first = new Date(Date.UTC(startYear, startMonth - 1 + offset, 1));
    const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
    const occurrence = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(anchorDay, lastDay)));
    const value = isoDate(occurrence);
    if (value > endDate) break;
    if (value >= startDate) output.push(value);
  }
  return output;
}

function mutableEvent(event: FinancialEvent): boolean {
  return event.status === "planned" || event.status === "scheduled";
}

function changeEffectiveDate(change: PlanSimulationChange): string {
  if ("effectiveDate" in change) return change.effectiveDate;
  if ("occurrenceDate" in change) return change.occurrenceDate;
  if ("startDate" in change) return change.startDate;
  return change.date;
}

function monthDistance(from: string | null, to: string | null): number | null {
  if (!from || !to) return null;
  const [fromYear, fromMonth] = from.split("-").map(Number);
  const [toYear, toMonth] = to.split("-").map(Number);
  if (![fromYear, fromMonth, toYear, toMonth].every(Number.isFinite)) return null;
  return (fromYear - toYear) * 12 + fromMonth - toMonth;
}

function monthKey(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

function debtMinimumForMonth(debt: PlanSimulationDebtReference, month: number, year: number): number {
  if (!debt.frequency) return Math.max(0, debt.minimum);
  const occurrences = getBillOccurrenceDays({
    frequency: debt.frequency,
    due_day: debt.dueDay,
    day_of_week: debt.dayOfWeek,
    next_payment_date: debt.nextPaymentDate,
    start_date: debt.startDate,
    end_date: debt.endDate,
  }, month, year).length;
  return cents(Math.max(0, debt.minimum) * occurrences);
}

function debtSchedule(debt: PlanSimulationDebtReference) {
  return {
    frequency: debt.frequency ?? "monthly",
    due_day: debt.dueDay,
    day_of_week: debt.dayOfWeek,
    next_payment_date: debt.nextPaymentDate,
    start_date: debt.startDate,
    end_date: debt.endDate,
  } as const;
}

function isDebtActiveInMonth(debt: PlanSimulationDebtReference, month: number, year: number): boolean {
  return isBillActiveForMonth(debtSchedule(debt), month, year);
}

function isDebtActiveOnDate(debt: PlanSimulationDebtReference, date: string): boolean {
  const [year, month] = date.split("-").map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return false;
  return isDebtActiveInMonth(debt, month - 1, year)
    && (!debt.startDate || date >= debt.startDate.slice(0, 10))
    && (!debt.endDate || date <= debt.endDate.slice(0, 10));
}

function comparablePayoffDate(input: {
  baseline: PlanSimulationBaseline;
  references: PlanSimulationReferences;
  scenarioExtrasByMonth?: ReadonlyMap<string, number>;
}): string | null {
  const debts = input.references.debts.map(debt => ({ ...debt, balance: cents(Math.max(0, debt.balance)) }));
  const payoffDebts = debts.filter(debt => debt.included && (!debt.endDate || debt.endDate.slice(0, 10) >= input.baseline.startDate));
  if (!payoffDebts.some(debt => debt.balance > 0.005)) return input.baseline.startDate.slice(0, 7);
  const [startYear, startMonthNumber] = input.baseline.startDate.split("-").map(Number);
  const canonicalMinimums = new Map<string, Map<string, number>>();
  const liveSavedExtras = new Map<string, number>();
  input.baseline.days.flatMap(day => day.events).forEach(event => {
    if (event.kind !== "debt_payment") return;
    const key = event.date.slice(0, 7);
    if (event.debtPlanSource === "saved_extra") {
      liveSavedExtras.set(key, cents((liveSavedExtras.get(key) ?? 0) + Math.abs(event.amount)));
      return;
    }
    if (!event.debtTargetBillId || event.debtPlanSource !== "canonical") return;
    const byDebt = canonicalMinimums.get(key) ?? new Map<string, number>();
    byDebt.set(event.debtTargetBillId, cents((byDebt.get(event.debtTargetBillId) ?? 0) + Math.abs(event.amount)));
    canonicalMinimums.set(key, byDebt);
  });
  let balances = new Map(debts.map(debt => [debt.id, debt.balance]));
  let rolledPayment = 0;
  for (let offset = 0; offset < 360; offset += 1) {
    const absolute = startYear * 12 + startMonthNumber - 1 + offset;
    const month = absolute % 12;
    const year = Math.floor(absolute / 12);
    const key = monthKey(year, month);
    const canonicalByDebt = canonicalMinimums.get(key);
    const withinCanonicalHorizon = key >= input.baseline.startDate.slice(0, 7)
      && key <= input.baseline.endDate.slice(0, 7);
    const monthlyDebts = payoffDebts.filter(debt => isDebtActiveInMonth(debt, month, year)).map(debt => ({
      ...debt,
      minimum: withinCanonicalHorizon
        ? canonicalByDebt?.get(debt.id) ?? 0
        : debtMinimumForMonth(debt, month, year),
    }));
    const strategyExtra = Math.max(0, Number(input.references.payoffStrategyExtrasByMonth?.[key]) || 0);
    const savedExtra = liveSavedExtras.get(key) ?? 0;
    const scenarioExtra = Math.max(0, input.scenarioExtrasByMonth?.get(key) ?? 0);
    const plan = projectSnowballMonth({
      debts: monthlyDebts,
      method: input.references.debtMethod,
      startingBalances: balances,
      rolledPayment,
      extraPayment: cents(strategyExtra + savedExtra + scenarioExtra),
      applyInterest: offset > 0,
    });
    plan.balances.forEach((balance, id) => balances.set(id, balance));
    rolledPayment = plan.rolledPayment;
    const remainingEligibleDebt = payoffDebts.reduce((sum, debt) => sum + (balances.get(debt.id) ?? 0), 0);
    if (remainingEligibleDebt <= 0.009) return key;
  }
  return null;
}

function dynamicFlowPoints(days: CanonicalPlanSimulationDay[], todayDay: number, safetyFloor: number, requiredMonthlyOutflow: number): number {
  if (!days.length) return 0;
  const balances = days.map(day => ({ day: Number(day.date.slice(8, 10)), balance: day.balance, income: day.inflow }));
  const stability = buildStabilityProgress({
    balances,
    todayDay,
    safetyFloor,
    monthlyRequiredOutflow: requiredMonthlyOutflow,
    overdueBills: 0,
    forecastConfidence: "high",
  });
  const riskDays = days.filter(day => day.balance < safetyFloor).length;
  const safety = riskDays === 0 ? FLOW_SCORE_WEIGHTS.balanceSafety : 0;
  const backup = requiredMonthlyOutflow > 0
    ? (stability.reserveProgress * 0.5 + stability.backupProgress * 0.5) * FLOW_SCORE_WEIGHTS.backupProgress
    : 0;
  const safeDays = (stability.safeForecastDays / days.length) * FLOW_SCORE_WEIGHTS.safeForecastDays;
  return safety + backup + safeDays;
}

export function projectPlanSimulation(input: {
  baseline: PlanSimulationBaseline;
  changes: readonly PlanSimulationChange[];
  references: PlanSimulationReferences;
  metrics: PlanSimulationMetricsBaseline;
  safetyFloor: number;
  definitionIssue?: string | null;
}): PlanSimulationResult {
  const baselineDays = input.baseline.days.map(day => ({ ...day, events: day.events.map(event => ({ ...event })) }));
  const baselinePayoffDate = comparablePayoffDate({ baseline: input.baseline, references: input.references });
  if (input.changes.length === 0 && !input.definitionIssue) {
    return summarizeProjection({
      baselineDays,
      projectedDays: baselineDays,
      safetyFloor: input.safetyFloor,
      flowScore: input.metrics.flowScore,
      protectedDays: input.metrics.protectedDays,
      requiredMonthlyOutflow: input.metrics.requiredMonthlyOutflow,
      savingsAdded: 0,
      debtExtraApplied: 0,
      debtAllocations: [],
      potentialDebtFreeDate: baselinePayoffDate,
      payoffImpactMonths: 0,
      issues: [],
    });
  }

  const incomeById = new Map(input.references.incomes.map(income => [income.id, income]));
  const billById = new Map(input.references.bills.map(bill => [bill.id, bill]));
  const dayByDate = new Map(baselineDays.map(day => [day.date, { ...day, events: day.events.map(event => ({ ...event })) }]));
  const issues: PlanSimulationIssue[] = input.definitionIssue
    ? [{ changeId: "definition", message: input.definitionIssue }]
    : [];
  const debtAllocations: PlanSimulationResult["debtAllocations"] = [];
  let savingsAdded = 0;
  let debtExtraApplied = 0;
  let requiredMonthlyOutflow = Math.max(0, input.metrics.requiredMonthlyOutflow);
  const currentMonthPrefix = input.baseline.startDate.slice(0, 7);
  const configuredCurrentOccurrence = (event: FinancialEvent, reference: PlanSimulationBillReference): number => {
    if (Number.isFinite(event.configuredOccurrenceAmount)) return Math.max(0, Number(event.configuredOccurrenceAmount));
    const occurrenceCount = Math.max(0, Number(reference.currentMonthOccurrenceCount) || 0);
    const configuredTotal = Math.max(0, Number(reference.currentMonthConfiguredTotal ?? reference.currentMonthEffectiveTotal) || 0);
    return occurrenceCount > 0 ? cents(configuredTotal / occurrenceCount) : Math.max(0, reference.amount);
  };

  const addEvent = (event: FinancialEvent): boolean => {
    const day = dayByDate.get(event.date);
    if (!day) return false;
    day.events.push(event);
    day.net = cents(day.net + event.amount);
    if (event.amount >= 0) day.inflow = cents(day.inflow + event.amount);
    else day.outflow = cents(day.outflow + Math.abs(event.amount));
    return true;
  };
  const removeEvents = (predicate: (event: FinancialEvent) => boolean): FinancialEvent[] => {
    const removed: FinancialEvent[] = [];
    dayByDate.forEach(day => {
      const retained: FinancialEvent[] = [];
      day.events.forEach(event => {
        if (!predicate(event) || !mutableEvent(event)) {
          retained.push(event);
          return;
        }
        removed.push(event);
        day.net = cents(day.net - event.amount);
        if (event.amount >= 0) day.inflow = cents(day.inflow - event.amount);
        else day.outflow = cents(day.outflow - Math.abs(event.amount));
      });
      day.events = retained;
    });
    return removed;
  };
  const addIssue = (changeId: string, message: string) => issues.push({ changeId, message });

  const nonDebtChanges = input.changes
    .filter(change => change.type !== "debt_extra")
    .slice()
    .sort((left, right) => changeEffectiveDate(left).localeCompare(changeEffectiveDate(right)));
  nonDebtChanges.forEach(change => {
    switch (change.type) {
      case "income_add": {
        recurringSimulationDates(change.startDate, input.baseline.endDate, change.frequency).forEach((date, index) => {
          if (date < input.baseline.startDate) return;
          addEvent(simulationEvent(change, date, change.amount, "scheduled_income", change.name, index));
        });
        break;
      }
      case "income_once":
        if (!addEvent(simulationEvent(change, change.date, change.amount, "scheduled_income", change.name))) addIssue(change.id, "The one-time income date is outside this scenario horizon.");
        break;
      case "income_edit":
      case "income_pause": {
        const reference = incomeById.get(change.incomeId);
        if (!reference) { addIssue(change.id, "This income no longer exists in the live plan."); break; }
        const removed = removeEvents(event => event.sourceType === "income" && event.sourceId === change.incomeId && event.date >= change.effectiveDate);
        if (!removed.length) { addIssue(change.id, `${reference.name} has no open occurrence in this horizon.`); break; }
        if (change.type === "income_edit") removed.forEach((event, index) => {
          const remaining = cents(Math.max(0, change.amount - Math.max(0, event.settledOccurrenceAmount ?? 0)));
          addEvent(replacementEvent(change, event, remaining, change.amount, reference.name, index));
        });
        break;
      }
      case "bill_add": {
        const dates = recurringSimulationDates(change.startDate, input.baseline.endDate, change.frequency);
        dates.forEach((date, index) => {
          if (date < input.baseline.startDate) return;
          addEvent(simulationEvent(change, date, -change.amount, "bill", change.name, index));
        });
        requiredMonthlyOutflow += dates.filter(date => date.startsWith(currentMonthPrefix) && date >= input.baseline.startDate).length * change.amount;
        break;
      }
      case "bill_edit":
      case "bill_pause": {
        const reference = billById.get(change.billId);
        if (!reference) { addIssue(change.id, "This bill no longer exists in the live plan."); break; }
        if (reference.isDebt) { addIssue(change.id, "Debt terms cannot be changed in Plan Simulator."); break; }
        const removed = removeEvents(event => event.sourceType === "bill" && event.sourceId === change.billId && event.date >= change.effectiveDate);
        if (!removed.length) { addIssue(change.id, `${reference.name} has no open occurrence in this horizon.`); break; }
        const affectedCurrentOccurrences = removed.filter(event => event.date.startsWith(currentMonthPrefix));
        if (change.type === "bill_edit") {
          removed.forEach((event, index) => {
            const remaining = cents(Math.max(0, change.amount - Math.max(0, event.settledOccurrenceAmount ?? 0)));
            addEvent(replacementEvent(change, event, -remaining, change.amount, reference.name, index));
          });
        }
        if (reference.isRequired !== false && affectedCurrentOccurrences.length > 0) {
          const previousRequired = affectedCurrentOccurrences.reduce((sum, event) => sum + configuredCurrentOccurrence(event, reference), 0);
          const nextRequired = change.type === "bill_edit" ? change.amount * affectedCurrentOccurrences.length : 0;
          requiredMonthlyOutflow += nextRequired - previousRequired;
        }
        break;
      }
      case "bill_move": {
        const reference = billById.get(change.billId);
        if (!reference) { addIssue(change.id, "This bill no longer exists in the live plan."); break; }
        if (reference.isDebt) { addIssue(change.id, "Debt payment dates cannot be changed in Plan Simulator."); break; }
        const sourceDay = dayByDate.get(change.occurrenceDate);
        const event = sourceDay?.events.find(item => item.sourceType === "bill" && item.sourceId === change.billId && mutableEvent(item));
        if (!event) { addIssue(change.id, "That bill occurrence is settled, pending, outside the horizon, or no longer exists."); break; }
        removeEvents(item => item.id === event.id && item.date === change.occurrenceDate);
        if (!addEvent({ ...event, id: `simulation:${change.id}:move`, date: change.newDate, status: "planned" })) {
          addIssue(change.id, "The new bill date is outside this scenario horizon.");
          addEvent(event);
        }
        break;
      }
      case "spending_once":
        if (!addEvent(simulationEvent(change, change.date, -change.amount, "transaction_expense", change.name))) addIssue(change.id, "The spending date is outside this scenario horizon.");
        break;
      case "savings_once":
        if (addEvent(simulationEvent(change, change.date, -change.amount, "goal", change.name))) savingsAdded = cents(savingsAdded + change.amount);
        else addIssue(change.id, "The savings date is outside this scenario horizon.");
        break;
    }
  });

  const debtChanges = input.changes
    .filter((change): change is Extract<PlanSimulationChange, { type: "debt_extra" }> => change.type === "debt_extra")
    .slice()
    .sort((left, right) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id));
  let allocationDebts = input.references.debts.map(debt => ({ ...debt, balance: cents(Math.max(0, debt.balance)) }));
  const scenarioExtrasByMonth = new Map<string, number>();
  const canonicalDebtEvents = baselineDays
    .flatMap(day => day.events)
    .filter(event => event.kind === "debt_payment" && event.debtTargetBillId && (event.status === "planned" || event.status === "scheduled" || event.status === "pending"))
    .sort((left, right) => left.date.localeCompare(right.date));
  let canonicalDebtIndex = 0;
  let allocationMonth = input.baseline.startDate.slice(0, 7);
  const applyCanonicalEventsThrough = (date: string) => {
    while (canonicalDebtIndex < canonicalDebtEvents.length && canonicalDebtEvents[canonicalDebtIndex].date <= date) {
      const event = canonicalDebtEvents[canonicalDebtIndex];
      allocationDebts = allocationDebts.map(debt => debt.id === event.debtTargetBillId
        ? { ...debt, balance: cents(Math.max(0, debt.balance - Math.abs(event.amount))) }
        : debt);
      canonicalDebtIndex += 1;
    }
  };
  const advanceCanonicalDebtThrough = (date: string) => {
    const targetMonth = date.slice(0, 7);
    while (allocationMonth < targetMonth) {
      const [year, month] = allocationMonth.split("-").map(Number);
      const monthEnd = `${allocationMonth}-${String(new Date(year, month, 0).getDate()).padStart(2, "0")}`;
      applyCanonicalEventsThrough(monthEnd);
      const next = new Date(Date.UTC(year, month, 1));
      allocationMonth = monthKey(next.getUTCFullYear(), next.getUTCMonth());
      allocationDebts = allocationDebts.map(debt => isDebtActiveInMonth(debt, next.getUTCMonth(), next.getUTCFullYear())
        ? { ...debt, balance: cents(debt.balance + debt.balance * Math.max(0, debt.apr) / 1200) }
        : debt);
    }
    applyCanonicalEventsThrough(date);
  };
  debtChanges.forEach(change => {
      advanceCanonicalDebtThrough(change.date);
      if (!dayByDate.has(change.date)) { addIssue(change.id, "The extra debt payment date is outside this scenario horizon."); return; }
      const activeDebts = allocationDebts.filter(debt => isDebtActiveOnDate(debt, change.date));
      if (!activeDebts.some(debt => debt.included && debt.balance > 0.005)) { addIssue(change.id, "There is no remaining eligible debt for this payment."); return; }
      const allocation = allocateSnowballExtra(activeDebts, change.amount, input.references.debtMethod, change.date);
      const applied = cents(allocation.allocations.reduce((sum, item) => sum + item.payment, 0));
      if (applied <= 0.005) { addIssue(change.id, "There is no remaining eligible debt for this payment."); return; }
      addEvent(simulationEvent(change, change.date, -applied, "debt_payment", "Extra debt payment"));
      debtExtraApplied = cents(debtExtraApplied + applied);
      const extraMonth = change.date.slice(0, 7);
      scenarioExtrasByMonth.set(extraMonth, cents((scenarioExtrasByMonth.get(extraMonth) ?? 0) + applied));
      allocation.allocations.forEach(item => debtAllocations.push({ changeId: change.id, billId: item.billId, billName: item.billName, amount: item.payment, date: change.date }));
      allocationDebts = allocationDebts.map(debt => ({ ...debt, balance: allocation.balances.get(debt.id) ?? debt.balance }));
    });

  requiredMonthlyOutflow = cents(Math.max(0, requiredMonthlyOutflow));
  let cumulativeDelta = 0;
  const projectedDays = baselineDays.map(baselineDay => {
    const changed = dayByDate.get(baselineDay.date) ?? baselineDay;
    cumulativeDelta = cents(cumulativeDelta + changed.net - baselineDay.net);
    return { ...changed, balance: cents(baselineDay.balance + cumulativeDelta) };
  });
  const currentBaselineDays = baselineDays.filter(day => day.date.startsWith(currentMonthPrefix));
  const currentProjectedDays = projectedDays.filter(day => day.date.startsWith(currentMonthPrefix));
  const todayDay = Number(input.baseline.startDate.slice(8, 10));
  const baselineDynamic = dynamicFlowPoints(currentBaselineDays, todayDay, input.safetyFloor, input.metrics.requiredMonthlyOutflow);
  const scenarioDynamic = dynamicFlowPoints(currentProjectedDays, todayDay, input.safetyFloor, requiredMonthlyOutflow);
  const flowScore = Math.max(0, Math.min(100, Math.round(input.metrics.flowScore - baselineDynamic + scenarioDynamic)));
  const baselineStability = buildStabilityProgress({
    balances: currentBaselineDays.map(day => ({ day: Number(day.date.slice(8, 10)), balance: day.balance, income: day.inflow })),
    todayDay,
    safetyFloor: input.safetyFloor,
    monthlyRequiredOutflow: input.metrics.requiredMonthlyOutflow,
    overdueBills: 0,
    forecastConfidence: input.metrics.forecastConfidence,
  });
  const scenarioStability = buildStabilityProgress({
    balances: currentProjectedDays.map(day => ({ day: Number(day.date.slice(8, 10)), balance: day.balance, income: day.inflow })),
    todayDay,
    safetyFloor: input.safetyFloor,
    monthlyRequiredOutflow: requiredMonthlyOutflow,
    overdueBills: 0,
    forecastConfidence: input.metrics.forecastConfidence,
  });
  const protectedDays = Math.max(0, Math.min(180,
    input.metrics.protectedDays - baselineStability.protectedDays + scenarioStability.protectedDays,
  ));
  const potentialDebtFreeDate = comparablePayoffDate({
    baseline: input.baseline,
    references: input.references,
    scenarioExtrasByMonth,
  });
  return summarizeProjection({
    baselineDays,
    projectedDays,
    safetyFloor: input.safetyFloor,
    flowScore,
    protectedDays,
    requiredMonthlyOutflow,
    savingsAdded,
    debtExtraApplied,
    debtAllocations,
    potentialDebtFreeDate,
    payoffImpactMonths: monthDistance(baselinePayoffDate, potentialDebtFreeDate),
    issues,
  });
}

function simulationEvent(
  change: PlanSimulationChange,
  date: string,
  amount: number,
  kind: FinancialEvent["kind"],
  name: string,
  index = 0,
): FinancialEvent {
  return {
    id: `simulation:${change.id}:${index}:${date}`,
    sourceType: "decision",
    sourceId: change.id,
    date,
    kind,
    amount: cents(amount),
    status: "planned",
    name,
  };
}

function replacementEvent(
  change: PlanSimulationChange,
  original: FinancialEvent,
  amount: number,
  configuredTotal: number,
  name: string,
  index: number,
): FinancialEvent {
  return {
    ...original,
    id: `simulation:${change.id}:${index}:${original.date}`,
    amount: cents(amount),
    status: "planned",
    name,
    configuredOccurrenceAmount: cents(configuredTotal),
    settledOccurrenceAmount: cents(Math.max(0, original.settledOccurrenceAmount ?? 0)),
  };
}

function summarizeProjection(input: {
  baselineDays: CanonicalPlanSimulationDay[];
  projectedDays: CanonicalPlanSimulationDay[];
  safetyFloor: number;
  flowScore: number;
  protectedDays: number;
  requiredMonthlyOutflow: number;
  savingsAdded: number;
  debtExtraApplied: number;
  debtAllocations: PlanSimulationResult["debtAllocations"];
  potentialDebtFreeDate: string | null;
  payoffImpactMonths: number | null;
  issues: PlanSimulationIssue[];
}): PlanSimulationResult {
  const monthGroups = new Map<string, CanonicalPlanSimulationDay[]>();
  input.projectedDays.forEach(day => monthGroups.set(day.date.slice(0, 7), [...(monthGroups.get(day.date.slice(0, 7)) ?? []), day]));
  const months = [...monthGroups.entries()].map(([month, days]) => {
    const lowest = days.reduce((current, day) => day.balance < current.balance ? day : current, days[0]);
    return {
      month,
      inflows: cents(days.reduce((sum, day) => sum + day.inflow, 0)),
      outflows: cents(days.reduce((sum, day) => sum + day.outflow, 0)),
      cashRemaining: cents(days.reduce((sum, day) => sum + day.net, 0)),
      endingBalance: days[days.length - 1]?.balance ?? 0,
      lowestBalance: lowest?.balance ?? 0,
      lowestBalanceDate: lowest?.date ?? month,
    };
  });
  const lowest = input.projectedDays.reduce<CanonicalPlanSimulationDay | null>((current, day) => !current || day.balance < current.balance ? day : current, null);
  return {
    days: input.projectedDays,
    months,
    endingBalance: input.projectedDays[input.projectedDays.length - 1]?.balance ?? 0,
    lowestBalance: lowest?.balance ?? 0,
    lowestBalanceDate: lowest?.date ?? input.baselineDays[0]?.date ?? "",
    safetyFloor: cents(Math.max(0, input.safetyFloor)),
    flowScore: input.flowScore,
    protectedDays: input.protectedDays,
    requiredMonthlyOutflow: cents(Math.max(0, input.requiredMonthlyOutflow)),
    savingsAdded: cents(input.savingsAdded),
    debtExtraApplied: cents(input.debtExtraApplied),
    debtAllocations: input.debtAllocations,
    potentialDebtFreeDate: input.potentialDebtFreeDate,
    payoffImpactMonths: input.payoffImpactMonths,
    issues: input.issues,
    complete: input.issues.length === 0,
  };
}

export function planSimulationStorageKey(userId: string, householdId: string): string {
  return `${planSimulationStoragePrefix(userId)}${householdId}`;
}

export function planSimulationStoragePrefix(userId: string): string {
  return `flowledger-plan-simulator-draft-v${PLAN_SIMULATION_VERSION}:${userId}:`;
}

export function safePlanSimulationName(value: string): string | null {
  const name = value.trim();
  return name.length >= 1 && name.length <= 80 ? name : null;
}
