import {
  decodePlanSimulationChanges,
  isValidPlanSimulationDate,
  safePlanSimulationName,
  simulationDebtReference,
  type PlanSimulationChange,
  type PlanSimulationDebtReference,
  type PlanSimulationReferences,
} from "./planSimulator";

export type SimulationEditorFields = {
  type: PlanSimulationChange["type"];
  name: string;
  amount: string;
  date: string;
  newDate: string;
  frequency: string;
  targetId: string;
  balance: string;
  apr: string;
  resumeDate: string;
};

/** One calendar month later, retaining the day when the next month allows it. */
export function defaultSimulationResumeDate(value: string): string {
  if (!isValidPlanSimulationDate(value)) return value;
  const [year, month, day] = value.split("-").map(Number);
  const next = new Date(Date.UTC(year, month, 1));
  const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
}

export function simulationEditorFields(change: PlanSimulationChange | null, startDate: string): SimulationEditorFields {
  const date = change ? "effectiveDate" in change ? change.effectiveDate : "startDate" in change ? change.startDate : "occurrenceDate" in change ? change.occurrenceDate : change.date : startDate;
  return {
    type: change?.type ?? "spending_once",
    name: change && "name" in change ? change.name : "",
    amount: change && "amount" in change ? String(change.amount) : "",
    date,
    newDate: change?.type === "bill_move" ? change.newDate : startDate,
    frequency: change && "frequency" in change ? change.frequency : "monthly",
    targetId: change ? "incomeId" in change ? change.incomeId : "billId" in change ? change.billId : "debtId" in change ? change.debtId : "" : "",
    balance: change?.type === "debt_add" ? String(change.balance) : "",
    apr: change?.type === "debt_add" ? String(change.apr) : "",
    resumeDate: change?.type === "debt_pause" ? change.resumeDate : defaultSimulationResumeDate(date),
  };
}

/** Editor choices may target debts created by another change in this draft.
 * These references are for labels/validation only, never the real baseline. */
export function simulationEditorReferences(references: PlanSimulationReferences, changes: readonly PlanSimulationChange[]): PlanSimulationReferences {
  const debts = [...references.debts];
  const ids = new Set(debts.map(debt => debt.id));
  for (const change of changes) {
    if (change.type !== "debt_add" || !decodePlanSimulationChanges([change])) continue;
    const debt = simulationDebtReference(change);
    if (ids.has(debt.id)) continue;
    ids.add(debt.id);
    debts.push(debt);
  }
  return { ...references, debts };
}

/** Reuse the canonical occurrence snapshot when an exact plan overrides the minimum. */
export function simulationDebtPaymentLabelAmount(debt: PlanSimulationDebtReference, date: string): number {
  return debt.occurrences?.filter(occurrence => occurrence.date >= date && !occurrence.immutable && occurrence.regular !== false)
    .sort((left, right) => left.date.localeCompare(right.date))[0]?.configuredAmount ?? debt.minimum;
}

/** Keep a new, untouched debt form valid when the selected debt begins later.
 * An explicit date choice and every existing edited change retain their dates. */
export function selectSimulationEditorDebt(fields: SimulationEditorFields, debt: PlanSimulationDebtReference, options: { startDate: string; endDate: string; dateCustomized: boolean; editingExisting: boolean }): SimulationEditorFields {
  let date = fields.date;
  const mayDefaultDate = !options.editingExisting && !options.dateCustomized && (fields.type === "debt_edit" || fields.type === "debt_pause");
  const debtStart = debt.startDate?.slice(0, 10);
  if (mayDefaultDate) {
    if (!debtStart || debtStart <= options.startDate) date = options.startDate;
    else if (isValidPlanSimulationDate(debtStart) && debtStart <= options.endDate) date = debtStart;
  }
  return {
    ...fields,
    targetId: debt.id,
    date,
    ...(fields.type === "debt_pause" && fields.resumeDate === defaultSimulationResumeDate(fields.date) ? { resumeDate: defaultSimulationResumeDate(date) } : {}),
    ...(fields.type === "debt_edit" && !options.editingExisting ? { amount: String(simulationDebtPaymentLabelAmount(debt, date)) } : {}),
  };
}

/** Form validation delegates definition semantics to the existing strict decoder.
 * Reference and horizon checks belong to the editor, never to financial math. */
export function buildSimulationEditorChange(fields: SimulationEditorFields, id: string, references: PlanSimulationReferences, startDate: string, endDate: string): { change: PlanSimulationChange; error?: never } | { change?: never; error: string } {
  const { type, name, targetId, date, newDate, frequency, resumeDate } = fields;
  const needsAmount = !["income_pause", "bill_pause", "bill_move", "debt_pause", "debt_payoff"].includes(type);
  const needsName = ["income_add", "income_once", "bill_add", "debt_add", "spending_once", "savings_once"].includes(type);
  const amount = /^\d+(?:\.\d{1,2})?$/.test(fields.amount.trim()) ? Number(fields.amount.trim()) : NaN;
  const balance = /^\d+(?:\.\d{1,2})?$/.test(fields.balance.trim()) ? Number(fields.balance.trim()) : NaN;
  const apr = /^\d+(?:\.\d{1,4})?$/.test(fields.apr.trim()) ? Number(fields.apr.trim()) : NaN;
  if (type === "debt_edit" && amount === 0) return { error: "Use Pause a debt to stop payments temporarily, or enter a payment greater than zero." };
  if (needsAmount && (!Number.isFinite(amount) || amount <= 0.005 || amount > 1_000_000_000)) return { error: "Enter an amount greater than zero and no more than $1 billion, with up to two decimal places." };
  if (needsName && !safePlanSimulationName(name)) return { error: "Enter a name between 1 and 80 characters." };
  if (type === "debt_add" && (!Number.isFinite(balance) || balance <= 0.005 || balance > 1_000_000_000)) return { error: "Enter a debt balance greater than zero and no more than $1 billion, with up to two decimal places." };
  if (type === "debt_add" && (!Number.isFinite(apr) || apr < 0 || apr > 1_000)) return { error: "Enter an APR from 0% to 1,000%, with up to four decimal places." };
  if (!isValidPlanSimulationDate(date) || date < startDate || date > endDate || (type === "bill_move" && (!isValidPlanSimulationDate(newDate) || newDate < startDate || newDate > endDate))) return { error: "Choose dates within this scenario’s forecast range." };
  if (type === "debt_pause" && (!isValidPlanSimulationDate(resumeDate) || resumeDate <= date)) return { error: "Choose a resume date after the pause starts. It may be beyond this scenario’s forecast range." };
  if ((type === "income_edit" || type === "income_pause") && !references.incomes.some(item => item.id === targetId)) return { error: "Choose an available income. The original selection may no longer exist." };
  if ((type === "bill_edit" || type === "bill_pause" || type === "bill_move") && !references.bills.some(item => item.id === targetId && !item.isDebt)) return { error: "Choose an available non-debt bill. The original selection may no longer exist." };
  const needsDebt = type === "debt_edit" || type === "debt_pause" || type === "debt_payoff";
  const debt = needsDebt ? references.debts.find(item => item.id === targetId && item.balance > 0.005 && (!item.endDate || item.endDate.slice(0, 10) >= startDate)) : undefined;
  if (needsDebt && !debt) return { error: "Choose an eligible open debt. The original selection may no longer be available." };
  if (debt?.id.startsWith("simulation-debt:") && debt.startDate && date < debt.startDate.slice(0, 10)) return { error: "Choose a date on or after this hypothetical debt’s first payment date." };
  let candidate: PlanSimulationChange;
  switch (type) {
    case "income_add": if (!["weekly", "biweekly", "monthly"].includes(frequency)) return { error: "Choose an income frequency." }; candidate = { id, type, name: name.trim(), amount, frequency: frequency as "weekly" | "biweekly" | "monthly", startDate: date }; break;
    case "income_edit": candidate = { id, type, incomeId: targetId, amount, effectiveDate: date }; break;
    case "income_pause": candidate = { id, type, incomeId: targetId, effectiveDate: date }; break;
    case "income_once": candidate = { id, type, name: name.trim(), amount, date }; break;
    case "bill_add": if (!["weekly", "biweekly", "monthly", "quarterly", "yearly"].includes(frequency)) return { error: "Choose a bill frequency." }; candidate = { id, type, name: name.trim(), amount, frequency: frequency as "weekly" | "biweekly" | "monthly" | "quarterly" | "yearly", startDate: date }; break;
    case "bill_edit": candidate = { id, type, billId: targetId, amount, effectiveDate: date }; break;
    case "bill_pause": candidate = { id, type, billId: targetId, effectiveDate: date }; break;
    case "bill_move": candidate = { id, type, billId: targetId, occurrenceDate: date, newDate }; break;
    case "spending_once": case "savings_once": candidate = { id, type, name: name.trim(), amount, date }; break;
    case "debt_extra": candidate = { id, type, amount, date }; break;
    case "debt_payoff": candidate = { id, type, debtId: targetId, date }; break;
    case "debt_edit": candidate = { id, type, debtId: targetId, amount, effectiveDate: date }; break;
    case "debt_pause": candidate = { id, type, debtId: targetId, effectiveDate: date, resumeDate }; break;
    case "debt_add": if (!["weekly", "biweekly", "monthly", "quarterly"].includes(frequency)) return { error: "Choose a debt payment frequency." }; candidate = { id, type, name: name.trim(), balance, apr, amount, frequency: frequency as "weekly" | "biweekly" | "monthly" | "quarterly", startDate: date }; break;
  }
  const decoded = decodePlanSimulationChanges([candidate]);
  return decoded ? { change: decoded[0] } : { error: "Check the change’s dates, amount and frequency, then try again." };
}

/** A correction keeps identity, position, count and the other changes intact. */
export function replaceSimulationChange(changes: PlanSimulationChange[], originalId: string, replacement: PlanSimulationChange): PlanSimulationChange[] | null {
  const original = changes.find(change => change.id === originalId);
  if (!original || replacement.id !== originalId || replacement.type !== original.type) return null;
  const next = changes.map(change => change.id === originalId ? replacement : change);
  return decodePlanSimulationChanges(next);
}
