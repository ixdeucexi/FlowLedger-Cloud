import {
  decodePlanSimulationChanges,
  isValidPlanSimulationDate,
  safePlanSimulationName,
  type PlanSimulationChange,
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
};

export function simulationEditorFields(change: PlanSimulationChange | null, startDate: string): SimulationEditorFields {
  return {
    type: change?.type ?? "spending_once",
    name: change && "name" in change ? change.name : "",
    amount: change && "amount" in change ? String(change.amount) : "",
    date: change ? "effectiveDate" in change ? change.effectiveDate : "startDate" in change ? change.startDate : "occurrenceDate" in change ? change.occurrenceDate : change.date : startDate,
    newDate: change?.type === "bill_move" ? change.newDate : startDate,
    frequency: change && "frequency" in change ? change.frequency : "monthly",
    targetId: change ? "incomeId" in change ? change.incomeId : "billId" in change ? change.billId : "debtId" in change ? change.debtId : "" : "",
  };
}

/** Form validation delegates definition semantics to the existing strict decoder.
 * Reference and horizon checks belong to the editor, never to financial math. */
export function buildSimulationEditorChange(fields: SimulationEditorFields, id: string, references: PlanSimulationReferences, startDate: string, endDate: string): { change: PlanSimulationChange; error?: never } | { change?: never; error: string } {
  const { type, name, targetId, date, newDate, frequency } = fields;
  const needsAmount = !["income_pause", "bill_pause", "bill_move", "debt_payoff"].includes(type);
  const needsName = ["income_add", "income_once", "bill_add", "spending_once", "savings_once"].includes(type);
  const amount = /^\d+(?:\.\d{1,2})?$/.test(fields.amount.trim()) ? Number(fields.amount.trim()) : NaN;
  if (needsAmount && (!Number.isFinite(amount) || amount <= 0.005 || amount > 1_000_000_000)) return { error: "Enter an amount greater than zero and no more than $1 billion, with up to two decimal places." };
  if (needsName && !safePlanSimulationName(name)) return { error: "Enter a name between 1 and 80 characters." };
  if (!isValidPlanSimulationDate(date) || date < startDate || date > endDate || (type === "bill_move" && (!isValidPlanSimulationDate(newDate) || newDate < startDate || newDate > endDate))) return { error: "Choose dates within this scenario’s forecast range." };
  if ((type === "income_edit" || type === "income_pause") && !references.incomes.some(item => item.id === targetId)) return { error: "Choose an available income. The original selection may no longer exist." };
  if ((type === "bill_edit" || type === "bill_pause" || type === "bill_move") && !references.bills.some(item => item.id === targetId && !item.isDebt)) return { error: "Choose an available non-debt bill. The original selection may no longer exist." };
  if (type === "debt_payoff" && !references.debts.some(item => item.id === targetId && item.balance > 0.005 && (!item.endDate || item.endDate.slice(0, 10) >= startDate))) return { error: "Choose an eligible open debt. The original selection may no longer be available." };
  let candidate: PlanSimulationChange;
  switch (type) {
    case "income_add": if (!["weekly", "biweekly", "monthly"].includes(frequency)) return { error: "Choose an income frequency." }; candidate = { id, type, name: name.trim(), amount, frequency: frequency as "weekly" | "biweekly" | "monthly", startDate: date }; break;
    case "income_edit": candidate = { id, type, incomeId: targetId, amount, effectiveDate: date }; break;
    case "income_pause": candidate = { id, type, incomeId: targetId, effectiveDate: date }; break;
    case "income_once": candidate = { id, type, name: name.trim(), amount, date }; break;
    case "bill_add": if (!["weekly", "biweekly", "monthly", "quarterly"].includes(frequency)) return { error: "Choose a bill frequency." }; candidate = { id, type, name: name.trim(), amount, frequency: frequency as "weekly" | "biweekly" | "monthly" | "quarterly", startDate: date }; break;
    case "bill_edit": candidate = { id, type, billId: targetId, amount, effectiveDate: date }; break;
    case "bill_pause": candidate = { id, type, billId: targetId, effectiveDate: date }; break;
    case "bill_move": candidate = { id, type, billId: targetId, occurrenceDate: date, newDate }; break;
    case "spending_once": case "savings_once": candidate = { id, type, name: name.trim(), amount, date }; break;
    case "debt_extra": candidate = { id, type, amount, date }; break;
    case "debt_payoff": candidate = { id, type, debtId: targetId, date }; break;
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
