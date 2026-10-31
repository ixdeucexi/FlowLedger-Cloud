import type { FinancialEvent } from "./forecast";
import { getBillOccurrenceDays } from "./schedule";
import { automaticDebtRolloverForMonth } from "./debtPlanDomain";
import { orderDebts, projectDatedSnowballMonth, type DatedSnowballAdditionalPayment } from "./snowball";
import type { PlanSimulationBaseline, PlanSimulationChange, PlanSimulationDebtReference, PlanSimulationIssue, PlanSimulationReferences, PlanSimulationResult } from "./planSimulator";

type DebtAdd = Extract<PlanSimulationChange, { type: "debt_add" }>;
type DebtEdit = Extract<PlanSimulationChange, { type: "debt_edit" }>;
type DebtPause = Extract<PlanSimulationChange, { type: "debt_pause" }>;
const money = (value: number) => Math.round(value * 100) / 100;
const mutable = (event: FinancialEvent) => event.status === "planned" || event.status === "scheduled";
const key = (id: string, date: string) => id + ":" + date;

/** The same hypothetical reference is used by the editor and projection. */
export function simulationDebtReference(change: DebtAdd): PlanSimulationDebtReference {
  const [year, month, day] = change.startDate.split("-").map(Number);
  return {
    id: "simulation-debt:" + change.id, name: change.name, balance: change.balance,
    apr: change.apr, minimum: change.amount, dueDay: day, included: true,
    frequency: change.frequency, startDate: change.startDate, nextPaymentDate: change.startDate,
    dayOfWeek: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
  };
}
export function hasSimulationDebtControls(changes: readonly PlanSimulationChange[]): boolean {
  return changes.some(change => change.type === "debt_add" || change.type === "debt_edit" || change.type === "debt_pause");
}
export interface ControlledDebtProjection {
  events: FinancialEvent[];
  replacedEventIds: Set<string>;
  allocations: PlanSimulationResult["debtAllocations"];
  debtExtraApplied: number;
  potentialDebtFreeDate: string | null;
  issues: PlanSimulationIssue[];
  addedRequiredCurrentMonth: number;
  historicalPrincipal: Array<{ billId: string; amount: number }>;
}

/**
 * A scenario adapter around the SAME monthly dated allocator used by Forecast.
 * The allocator owns interest, payment caps, dated rollover and the lifecycle
 * converting a closed source's monthly requirement into the freed payment pool.
 * Future canonical allocations are evidence, never a second source of funds.
 */
export function projectControlledSimulationDebt(input: {
  baseline: PlanSimulationBaseline;
  references: PlanSimulationReferences;
  changes: readonly PlanSimulationChange[];
  /** Already-absorbed baseline funds cannot change retroactively with a new scenario. */
  historicalPrincipal?: readonly { billId: string; amount: number }[];
}): ControlledDebtProjection {
  const output: ControlledDebtProjection = {
    events: [], replacedEventIds: new Set(), allocations: [], debtExtraApplied: 0,
    potentialDebtFreeDate: null, issues: [], addedRequiredCurrentMonth: 0, historicalPrincipal: [],
  };
  const addIssue = (id: string, message: string) => output.issues.push({ changeId: id, message });
  const inHorizon = (date: string) => date >= input.baseline.startDate && date <= input.baseline.endDate;
  const visibleDays = new Set(input.baseline.days.map(day => day.date));
  const debts = input.references.debts.map(debt => ({ ...debt }));
  const addedIds = new Set<string>();
  input.changes.forEach(change => {
    if (change.type !== "debt_add") return;
    if (!inHorizon(change.startDate)) { addIssue(change.id, "The new debt's first payment is outside this scenario horizon."); return; }
    const debt = simulationDebtReference(change);
    if (debts.some(item => item.id === debt.id)) { addIssue(change.id, "This hypothetical debt has a duplicate identity."); return; }
    debts.push(debt); addedIds.add(debt.id);
  });
  if (debts.some(debt => !Number.isFinite(debt.balance) || debt.balance < 0
    || !Number.isFinite(debt.minimum) || debt.minimum < 0
    || !Number.isFinite(debt.apr) || debt.apr < 0 || debt.apr > 1000
    || !Number.isInteger(debt.dueDay) || debt.dueDay < 1 || debt.dueDay > 31)) {
    addIssue("debt-model", "Complete the debt balance, payment, rate and due date before comparing this scenario.");
    return output;
  }
  const byId = new Map(debts.map(debt => [debt.id, debt]));
  const initiallyOwed = new Set(debts.filter(debt => debt.balance > 0.005).map(debt => debt.id));
  const edits: DebtEdit[] = [], pauses: DebtPause[] = [];
  input.changes.forEach(change => {
    if (change.type !== "debt_edit" && change.type !== "debt_pause") return;
    const debt = byId.get(change.debtId);
    if (!debt || !initiallyOwed.has(debt.id)) { addIssue(change.id, "This debt is closed or no longer exists in the scenario."); return; }
    if (!inHorizon(change.effectiveDate)) { addIssue(change.id, "The debt change starts outside this scenario horizon."); return; }
    if (debt.startDate && change.effectiveDate < debt.startDate || debt.endDate && change.effectiveDate > debt.endDate) {
      addIssue(change.id, "Choose a date while this debt is active."); return;
    }
    if (change.type === "debt_edit") edits.push(change); else pauses.push(change);
  });
  edits.sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate) || input.changes.indexOf(a) - input.changes.indexOf(b));
  const latestEdit = (id: string, date: string) => edits.filter(edit => edit.debtId === id && edit.effectiveDate <= date).at(-1);
  const paused = (id: string, date: string) => pauses.some(pause => pause.debtId === id && date >= pause.effectiveDate && date < pause.resumeDate);
  const active = (debt: PlanSimulationDebtReference, date: string) =>
    (!debt.startDate || date >= debt.startDate) && (!debt.endDate || date <= debt.endDate);
  const allEvents = input.baseline.days.flatMap(day => day.events);
  const sourceFor = (event: FinancialEvent) => {
    if (event.debtPlanSource === "saved_extra") return undefined;
    if (byId.has(event.sourceId) && (event.kind === "debt_payment" || event.kind === "bill")) return event.sourceId;
    return event.debtPlanSource === "canonical" && event.debtTargetBillId && byId.has(event.debtTargetBillId) ? event.debtTargetBillId : undefined;
  };
  const metadata = new Map<string, NonNullable<PlanSimulationDebtReference["occurrences"]>[number]>();
  debts.forEach(debt => debt.occurrences?.forEach(occurrence => metadata.set(key(debt.id, occurrence.date), occurrence)));
  const originalDate = (event: FinancialEvent) => event.id.match(/^debt-plan:(\d{4}-\d{2}-\d{2}):/)?.[1]
    ?? event.id.match(/^pending-debt:[^:]+:(\d{4}-\d{2}-\d{2}):/)?.[1] ?? event.date;
  const sourceGroups = new Map<string, FinancialEvent[]>();
  allEvents.forEach(event => {
    const source = sourceFor(event);
    if (source) sourceGroups.set(key(source, event.date), [...(sourceGroups.get(key(source, event.date)) ?? []), event]);
  });
  const immutableSources = new Set<string>();
  allEvents.forEach(event => { const source = sourceFor(event); if (source && !mutable(event)) immutableSources.add(key(source, originalDate(event))); });
  const protectedByMonth = new Map<string, Array<{ event: FinancialEvent; target: string }>>();
  const savedByMonth = new Map<string, Map<string, number>>();
  allEvents.forEach(event => {
    if (event.kind !== "debt_payment" && !(event.kind === "bill" && event.debtTargetBillId)) return;
    const source = sourceFor(event), target = event.debtTargetBillId ?? source;
    const protectedEvent = !mutable(event) || Boolean(source && metadata.get(key(source, originalDate(event)))?.immutable);
    if (protectedEvent) {
      // Already posted principal is in the current balance; pending commitments
      // still apply later, but their original cash rows are never rewritten.
      if (target && byId.has(target) && (event.status === "pending" || mutable(event))) {
        const prefix = event.date.slice(0, 7);
        protectedByMonth.set(prefix, [...(protectedByMonth.get(prefix) ?? []), { event, target }]);
      }
      return;
    }
    if (!source && !(target && byId.has(target)) && event.debtPlanSource !== "saved_extra") return;
    output.replacedEventIds.add(event.id);
    if (!source) {
      const prefix = event.date.slice(0, 7), amounts = savedByMonth.get(prefix) ?? new Map<string, number>();
      amounts.set(event.date, money((amounts.get(event.date) ?? 0) + Math.abs(event.amount)));
      savedByMonth.set(prefix, amounts);
    }
  });
  const manual = input.changes.filter((change): change is Extract<PlanSimulationChange, { type: "debt_extra" | "debt_payoff" }> =>
    change.type === "debt_extra" || change.type === "debt_payoff");
  manual.forEach(change => {
    if (!inHorizon(change.date)) addIssue(change.id, "The debt payment date is outside this scenario horizon.");
  });
  const balances = new Map(debts.map(debt => [debt.id, money(Math.max(0, debt.balance))]));
  const [startYear, startMonth] = input.baseline.startDate.split("-").map(Number);
  const firstPrefix = input.baseline.startDate.slice(0, 7);
  let rolledPayment = money(debts.reduce((sum, debt) => sum + Math.max(0, debt.monthlyRolloverExtra ?? 0), 0));
  let sequence = 0;
  const closedOn = new Map<string, string>();

  for (let offset = 0; offset < 360; offset += 1) {
    const absolute = startYear * 12 + startMonth - 1 + offset;
    const year = Math.floor(absolute / 12), month = absolute % 12;
    const prefix = String(year) + "-" + String(month + 1).padStart(2, "0");
    const monthEnd = prefix + "-" + String(new Date(Date.UTC(year, month + 1, 0)).getUTCDate()).padStart(2, "0");
    const monthStart = prefix + "-01", firstVisible = offset === 0 ? input.baseline.startDate : monthStart;
    const keepHistory = offset === 0 && input.historicalPrincipal !== undefined;
    const paymentDates = new Map<string, readonly string[]>();
    const monthDebts = debts.filter(debt => (!debt.startDate || debt.startDate <= monthEnd) && (!debt.endDate || debt.endDate >= monthStart))
      .map(debt => {
        const schedule = { frequency: debt.frequency ?? "monthly", due_day: debt.dueDay, day_of_week: debt.dayOfWeek,
          next_payment_date: debt.nextPaymentDate, start_date: debt.startDate, end_date: debt.endDate };
        const nominalDates = getBillOccurrenceDays(schedule, month, year).map(day => prefix + "-" + String(day).padStart(2, "0"));
        const snapshots = debt.occurrences?.filter(item => item.date.startsWith(prefix)) ?? [];
        const canonicalRegularDates = [...sourceGroups.entries()]
          .filter(([groupKey, group]) => groupKey.startsWith(debt.id + ":" + prefix)
            && group.some(event => event.debtPlanAllocationKind !== "rollover"))
          .map(([, group]) => group[0].date);
        const fullRegularDates = snapshots.length
          ? snapshots.filter(item => item.regular !== false).map(item => item.date)
          : nominalDates;
        const dates = [...new Set(snapshots.length
          ? snapshots.filter(item => item.regular !== false).map(item => item.date)
          : canonicalRegularDates.length ? canonicalRegularDates : nominalDates)]
          .filter(date => date >= monthStart && active(debt, date)).sort();
        paymentDates.set(debt.id, dates);
        const required = new Map<string, number>();
        let plannedExtra = 0, paidAboveRequired = 0;
        dates.forEach(date => {
          const occurrence = metadata.get(key(debt.id, date));
          const group = sourceGroups.get(key(debt.id, date)) ?? [];
          const controlDate = date < firstVisible ? firstVisible : date;
          if (paused(debt.id, controlDate) || occurrence?.immutable || immutableSources.has(key(debt.id, date))) { required.set(date, 0); return; }
          const edit = latestEdit(debt.id, controlDate);
          const configured = edit?.amount ?? occurrence?.configuredAmount
            ?? (group.length ? group.reduce((sum, event) => sum + Math.abs(event.amount), 0)
              + Math.max(0, ...group.map(event => event.settledOccurrenceAmount ?? 0)) : debt.minimum);
          const settled = Math.max(0, occurrence?.settledAmount ?? Math.max(0, ...group.map(event => event.settledOccurrenceAmount ?? 0)));
          const requiredConfigured = edit ? configured : Math.min(configured, debt.minimum);
          required.set(date, money(Math.max(0, requiredConfigured - settled)));
          if (!edit) {
            plannedExtra += Math.max(0, configured - requiredConfigured);
            paidAboveRequired += Math.max(0, settled - requiredConfigured);
          }
        });
        const count = Math.max(0, new Set(fullRegularDates).size || nominalDates.length);
        const lifecycleEdit = latestEdit(debt.id, dates[0] && dates[0] >= firstVisible ? dates[0] : firstVisible);
        return {
          ...debt,
          // Real balances use canonical Forecast's monthly interest anchor.
          // Only a new hypothetical loan has no pre-origination interest.
          apr: addedIds.has(debt.id) && debt.startDate?.startsWith(prefix) ? 0 : debt.apr,
          minimum: money((lifecycleEdit?.amount ?? debt.minimum) * count),
          requiredPaymentsByDate: required,
          plannedExtraPayment: keepHistory && (dates[0] ?? monthStart) < firstVisible ? 0 : money(Math.max(0, plannedExtra - paidAboveRequired)),
          suppressRequiredOverflowBefore: keepHistory ? firstVisible : undefined,
        };
      });
    const additional: DatedSnowballAdditionalPayment[] = [];
    const protectedIds = new Set<string>();
    const historicalIds = new Set<string>();
    if (keepHistory) input.historicalPrincipal?.forEach(({ billId, amount }, index) => {
      const id = "historical:" + index;
      historicalIds.add(id);
      additional.push({ id, date: monthStart, amount, targetBillId: billId, kind: "rollover",
        cascade: false, ignoreExtraEligibility: true, phase: "before_required" });
    });
    (protectedByMonth.get(prefix) ?? []).forEach(({ event, target }) => {
      const id = "protected:" + event.id;
      protectedIds.add(id);
      additional.push({ id, date: originalDate(event), amount: Math.abs(event.amount), targetBillId: target,
        sourceBillId: sourceFor(event), cascade: false, ignoreExtraEligibility: true, phase: "before_pools" });
    });
    const fullSaved = input.references.payoffSavedPaymentsByMonth?.[prefix];
    const saved = fullSaved ? new Map([[fullSaved.date, Math.max(0, fullSaved.amount)]])
      : savedByMonth.get(prefix) ?? new Map<string, number>();
    // The preview map is the same saved-funds lineage, not extra cash again.
    if (!fullSaved && prefix > input.baseline.endDate.slice(0, 7)) {
      const amount = Math.max(0, input.references.payoffStrategyExtrasByMonth?.[prefix] ?? 0);
      if (amount > 0.005) saved.set(prefix + "-01", amount);
    }
    saved.forEach((amount, date) => {
      if (!keepHistory || date >= firstVisible) additional.push({ id: "saved:" + date, date, amount });
    });
    const manualForMonth = manual.filter(change => change.date.startsWith(prefix) && inHorizon(change.date))
      .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    manualForMonth.forEach(change => {
      if (change.type === "debt_payoff") {
        const debt = byId.get(change.debtId);
        if (!debt || !active(debt, change.date)) { addIssue(change.id, "This debt is closed, inactive, or no longer exists in the scenario."); return; }
        additional.push({ id: change.id, date: change.date, targetBillId: change.debtId, payoff: true,
          cascade: false, ignoreExtraEligibility: true });
      } else additional.push({ id: change.id, date: change.date, amount: change.amount });
    });
    const protectedGroupDates = [...sourceGroups.values()].filter(group => group[0]?.date.startsWith(prefix)
      && group.every(event => event.debtPlanAllocationKind === "rollover")
      && metadata.get(key(sourceFor(group[0]) ?? "", group[0].date))?.regular === false)
      .map(group => group[0].date).filter(date => date >= firstVisible).sort();
    const target = orderDebts(monthDebts.filter(debt => debt.included && (balances.get(debt.id) ?? 0) > 0.005)
      .map(debt => ({ ...debt, balance: balances.get(debt.id) ?? 0 })), input.references.debtMethod)[0];
    const fallbackRollDate = target ? prefix + "-" + String(Math.min(target.dueDay,
      new Date(Date.UTC(year, month + 1, 0)).getUTCDate())).padStart(2, "0") : firstVisible;
    const rollDate = offset === 0 && protectedGroupDates.length ? protectedGroupDates[0]
      : (target ? paymentDates.get(target.id)?.[0] : undefined) ?? fallbackRollDate;
    const exactPlanIds = new Set(debts.filter(debt => debt.occurrences?.some(occurrence =>
      occurrence.date.startsWith(prefix) && occurrence.exactPlan)
      && !latestEdit(debt.id, rollDate < firstVisible ? firstVisible : rollDate)).map(debt => debt.id));
    const targetPaid = target ? (byId.get(target.id)?.occurrences ?? []).filter(occurrence =>
      occurrence.date.startsWith(prefix) && occurrence.regular !== false).reduce((sum, occurrence) => sum + occurrence.settledAmount, 0) : 0;
    const targetRequired = target ? (byId.get(target.id)?.minimum ?? 0) * (paymentDates.get(target.id)?.length ?? 0) : 0;
    const currentRoll = automaticDebtRolloverForMonth(rolledPayment, target?.id, exactPlanIds, Math.max(0, targetPaid - targetRequired));
    const availableRoll = keepHistory && rollDate < firstVisible ? 0 : currentRoll;
    const projectMonth = (monthly = monthDebts) => projectDatedSnowballMonth({
      debts: monthly, month, year, method: input.references.debtMethod,
      startingBalances: balances, paymentDatesByDebtId: paymentDates,
      rolledPayment: availableRoll, rolledPaymentDate: rollDate, additionalPayments: additional,
      canReceiveExtra: (id, date) => Boolean(byId.get(id) && active(byId.get(id)!, date)
        && !paused(id, date < firstVisible ? firstVisible : date)),
    });
    let plan = projectMonth();
    // A mid-month edit changes the recurring budget from its effective date.
    // Feed the paid-off month's correct budget back through the core lifecycle;
    // its explicit per-date maps keep the same dated cash allocations.
    let rebudget = false;
    const corrected = monthDebts.map(debt => {
      const payoffDate = plan.allocations.find(allocation => allocation.targetBillId === debt.id && allocation.paidOff)?.date;
      if (!payoffDate) return debt;
      const edit = latestEdit(debt.id, payoffDate < firstVisible ? firstVisible : payoffDate);
      if (!edit) return debt;
      const prior = byId.get(debt.id)!;
      const originalDate = paymentDates.get(debt.id)?.[0] ?? firstVisible;
      const originalPerOccurrence = latestEdit(debt.id, originalDate < firstVisible ? firstVisible : originalDate)?.amount ?? prior.minimum;
      const count = originalPerOccurrence > 0.005 ? debt.minimum / originalPerOccurrence : getBillOccurrenceDays({
        frequency: prior.frequency ?? "monthly", due_day: prior.dueDay, day_of_week: prior.dayOfWeek,
        next_payment_date: prior.nextPaymentDate, start_date: prior.startDate, end_date: prior.endDate,
      }, month, year).length;
      const nextMinimum = money(edit.amount * count);
      if (Math.abs(nextMinimum - debt.minimum) <= 0.005) return debt;
      rebudget = true;
      return { ...debt, minimum: nextMinimum };
    });
    if (rebudget) plan = projectMonth(corrected);
    (protectedByMonth.get(prefix) ?? []).forEach(({ event, target }) => {
      const applied = plan.allocations.filter(allocation => allocation.externalPaymentId === "protected:" + event.id)
        .reduce((sum, allocation) => sum + allocation.amount, 0);
      if (applied + .005 >= Math.abs(event.amount)) return;
      const owner = manualForMonth.find(change => change.date < event.date
        && (change.type === "debt_extra" || change.debtId === target))?.id
        ?? edits.find(change => change.debtId === target)?.id ?? "debt-model";
      if (!output.issues.some(issue => issue.changeId === owner)) addIssue(owner,
        "This scenario overlaps an existing bank payment. Choose a payment date after that commitment posts.");
    });
    plan.balances.forEach((balance, id) => balances.set(id, balance));
    rolledPayment = money(rolledPayment - availableRoll + plan.rolledPayment);
    const appliedByChange = new Map<string, number>();
    plan.allocations.forEach(allocation => {
      if (allocation.paidOff && !closedOn.has(allocation.targetBillId)) closedOn.set(allocation.targetBillId,
        allocation.date < firstVisible ? firstVisible : allocation.date);
      const external = allocation.externalPaymentId;
      if (external && protectedIds.has(external)) return;
      if (external && historicalIds.has(external)) return;
      if (offset === 0 && allocation.date < input.baseline.startDate && allocation.kind !== "required") {
        const historical = output.historicalPrincipal.find(item => item.billId === allocation.targetBillId);
        if (historical) historical.amount = money(historical.amount + allocation.amount);
        else output.historicalPrincipal.push({ billId: allocation.targetBillId, amount: allocation.amount });
      }
      const change = external ? manualForMonth.find(item => item.id === external) : undefined;
      if (change) {
        const amount = money(allocation.amount);
        appliedByChange.set(change.id, money((appliedByChange.get(change.id) ?? 0) + amount));
        output.allocations.push({ changeId: change.id, billId: allocation.targetBillId, billName: allocation.targetBillName, amount, date: allocation.date });
        output.debtExtraApplied = money(output.debtExtraApplied + amount);
      }
      // Forecast absorbs earlier strategy/extra cash into its observed anchor,
      // while an unpaid required obligation is reserved at that anchor.
      const cashDate = allocation.date < input.baseline.startDate
        ? allocation.kind === "required" ? input.baseline.startDate : null : allocation.date;
      if (!cashDate || !inHorizon(cashDate) || !visibleDays.has(cashDate)) return;
      output.events.push({
        id: "simulation-debt:" + cashDate + ":" + sequence++,
        sourceType: change ? "decision" : "extra_payment", sourceId: change?.id ?? allocation.sourceBillId ?? allocation.targetBillId,
        date: cashDate, amount: -allocation.amount, kind: "debt_payment", status: "planned",
        name: (byId.get(allocation.targetBillId)?.name ?? "Debt") + " debt payment",
        debtPlanSource: allocation.kind === "extra" ? "saved_extra" : "canonical",
        debtPlanAllocationKind: allocation.kind, debtTargetBillId: allocation.targetBillId,
      });
      if (addedIds.has(allocation.sourceBillId ?? allocation.targetBillId) && prefix === firstPrefix && allocation.kind === "required") {
        output.addedRequiredCurrentMonth = money(output.addedRequiredCurrentMonth + allocation.amount);
      }
    });
    manualForMonth.forEach(change => {
      if ((appliedByChange.get(change.id) ?? 0) > 0.005 || output.issues.some(issue => issue.changeId === change.id)) return;
      addIssue(change.id, change.type === "debt_extra"
        ? "There is no remaining eligible unpaused debt for this payment."
        : "This debt is already paid off by that date.");
    });
    const remaining = debts.filter(debt => debt.included && (!debt.endDate || debt.endDate >= input.baseline.startDate))
      .reduce((sum, debt) => sum + (balances.get(debt.id) ?? 0), 0);
    if (remaining <= 0.009 && output.potentialDebtFreeDate === null) output.potentialDebtFreeDate = prefix;
    if (remaining <= 0.009 && prefix >= input.baseline.endDate.slice(0, 7)) break;
  }
  [...edits, ...pauses].forEach(change => {
    const paid = closedOn.get(change.debtId);
    if (paid && paid < change.effectiveDate) addIssue(change.id, "This debt is already paid off before that change starts.");
  });
  return output;
}

