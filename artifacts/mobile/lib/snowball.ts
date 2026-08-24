export const SNOWBALL_BUFFER = 200;
export const MAX_PAYOFF_MONTHS = 360;

export type DebtMethod = "snowball" | "avalanche";

export interface SnowballDebtInput {
  id: string;
  name: string;
  balance: number;
  minimum: number;
  apr: number;
  dueDay: number;
  included: boolean;
}

export interface SnowballAllocationResult {
  billId: string;
  billName: string;
  payment: number;
  balanceBefore: number;
  balanceAfter: number;
  paidOff: boolean;
  paymentDate: string;
}

export interface SnowballMonthProjection {
  month: number;
  year: number;
  targetName: string | null;
  minimumPayments: number;
  extraPayment: number;
  rolledPayment: number;
  interest: number;
  endingDebt: number;
  lowestAccountBalance: number;
  paidOffNames?: string[];
}

export interface SnowballMonthPayment {
  billId: string;
  billName: string;
  dueDay: number;
  scheduledPayment: number;
  extraPayment: number;
  totalPayment: number;
  balanceBefore: number;
  balanceAfter: number;
  paidOff: boolean;
}

export interface SnowballMonthPlanResult {
  payments: SnowballMonthPayment[];
  balances: Map<string, number>;
  payoffOrder: string[];
  paidOffNames: string[];
  rolledPayment: number;
  minimumPayments: number;
  scheduledPayments: number;
  extraPayment: number;
  interest: number;
  endingDebt: number;
}

export type DatedDebtAllocationKind = "required" | "rollover" | "extra";

export interface DatedDebtAllocation {
  id: string;
  date: string;
  sourceBillId?: string;
  sourceBillName?: string;
  targetBillId: string;
  targetBillName: string;
  kind: DatedDebtAllocationKind;
  amount: number;
  sourceAmount: number;
  balanceBefore: number;
  balanceAfter: number;
  paidOff: boolean;
}

export interface DatedSnowballMonthPlanResult extends SnowballMonthPlanResult {
  allocations: DatedDebtAllocation[];
  plannedPayment: number;
  unusedAmount: number;
}

export interface DatedDebtSettlement {
  sourceType: "bill" | "extra";
  billId: string;
  date: string;
  amount: number;
}

function datedSettlementKey(sourceType: DatedDebtSettlement["sourceType"], billId: string, date: string) {
  return `${sourceType}:${billId}:${date}`;
}

/** Removes cash already represented by matched bank activity from a dated plan. */
export function remainingDatedDebtAllocations(
  allocations: readonly DatedDebtAllocation[],
  settlements: readonly DatedDebtSettlement[],
): DatedDebtAllocation[] {
  const remainingSettledByKey = new Map<string, number>();
  settlements.forEach(settlement => {
    const key = datedSettlementKey(settlement.sourceType, settlement.billId, settlement.date);
    remainingSettledByKey.set(key, cents((remainingSettledByKey.get(key) ?? 0) + Math.max(0, settlement.amount)));
  });

  const absorbedByIndex = new Map<number, number>();
  const settlementOrder = allocations
    .map((allocation, index) => ({ allocation, index }))
    // A partially paid debt can already have a lower live balance. In that
    // case the canonical plan turns the balance gap into rollover. Consume
    // that projected rollover before the payment still owed to the source
    // debt, or the same payment is deducted twice and the real remainder
    // disappears from Forecast.
    .sort((left, right) => Number(left.allocation.kind !== "rollover") - Number(right.allocation.kind !== "rollover"));

  settlementOrder.forEach(({ allocation, index }) => {
    const key = allocation.kind === "extra"
      ? datedSettlementKey("extra", allocation.targetBillId, allocation.date)
      : allocation.sourceBillId
        ? datedSettlementKey("bill", allocation.sourceBillId, allocation.date)
        : undefined;
    if (!key) return;
    const settled = remainingSettledByKey.get(key) ?? 0;
    if (settled <= 0.009) return;
    const absorbed = cents(Math.min(settled, allocation.amount));
    remainingSettledByKey.set(key, cents(settled - absorbed));
    absorbedByIndex.set(index, absorbed);
  });

  return allocations.flatMap((allocation, index) => {
    const remaining = cents(allocation.amount - (absorbedByIndex.get(index) ?? 0));
    return remaining > 0.009 ? [{ ...allocation, amount: remaining }] : [];
  });
}

export interface SnowballProjectionResult {
  safeMaximum: number;
  selectedExtra: number;
  paymentDate: string;
  allocations: SnowballAllocationResult[];
  months: SnowballMonthProjection[];
  payoffOrder: string[];
  debtFreeDate: string | null;
  lowestSixMonthBalance: number;
}

const cents = (value: number) => Math.round((Number(value) || 0) * 100) / 100;

type PaymentAllocation = Pick<SnowballAllocationResult, "billId" | "payment">;

export function diffAppliedSnowballAllocations(
  previous: PaymentAllocation[],
  previousApplied: boolean,
  next: PaymentAllocation[],
  nextApplied: boolean,
): Map<string, number> {
  const deltas = new Map<string, number>();
  const add = (allocation: PaymentAllocation, direction: number) => {
    deltas.set(allocation.billId, cents((deltas.get(allocation.billId) ?? 0) + allocation.payment * direction));
  };
  if (previousApplied) previous.forEach(allocation => add(allocation, -1));
  if (nextApplied) next.forEach(allocation => add(allocation, 1));
  return new Map([...deltas].filter(([, delta]) => Math.abs(delta) >= 0.005));
}

export function monthlyInterestCharge(balance: number, annualPercentageRate: number): number {
  return cents(Math.max(0, Number(balance) || 0) * (Math.max(0, Number(annualPercentageRate) || 0) / 100) / 12);
}

export function effectiveDebtMinimum(baseMinimum: number, rolledMinimum: number): number {
  return cents(Math.max(0, baseMinimum) + Math.max(0, rolledMinimum));
}

export function monthlyDebtAmount(baseMinimum: number, rolledMinimum: number, settledAmount?: number): number {
  return settledAmount !== undefined && Number.isFinite(settledAmount)
    ? cents(Math.max(0, settledAmount))
    : effectiveDebtMinimum(baseMinimum, rolledMinimum);
}

export function scheduledDebtPaymentAmount(amount: number, paymentDate: string, today: string, balance: number): number {
  if (amount >= 0 || paymentDate > today) return 0;
  return cents(Math.min(Math.abs(amount), Math.max(0, balance)));
}

export function orderDebts<T extends SnowballDebtInput>(debts: T[], method: DebtMethod): T[] {
  return [...debts].sort((a, b) => {
    if (method === "avalanche") {
      return b.apr - a.apr || a.balance - b.balance || a.id.localeCompare(b.id);
    }
    return a.balance - b.balance || b.apr - a.apr || a.id.localeCompare(b.id);
  });
}

export function allocateSnowballExtra(
  debts: SnowballDebtInput[],
  amount: number,
  method: DebtMethod,
  paymentDate: string,
): { allocations: SnowballAllocationResult[]; balances: Map<string, number>; payoffOrder: string[] } {
  const balances = new Map(debts.map(debt => [debt.id, cents(Math.max(0, debt.balance))]));
  const allocations: SnowballAllocationResult[] = [];
  const payoffOrder: string[] = [];
  let remaining = cents(Math.max(0, amount));

  while (remaining > 0.009) {
    const active = orderDebts(
      debts.filter(debt => debt.included && (balances.get(debt.id) ?? 0) > 0.009)
        .map(debt => ({ ...debt, balance: balances.get(debt.id) ?? 0 })),
      method,
    );
    const target = active[0];
    if (!target) break;
    const before = balances.get(target.id) ?? 0;
    const payment = cents(Math.min(before, remaining));
    const after = cents(Math.max(0, before - payment));
    balances.set(target.id, after);
    remaining = cents(remaining - payment);
    allocations.push({
      billId: target.id,
      billName: target.name,
      payment,
      balanceBefore: before,
      balanceAfter: after,
      paidOff: after <= 0.009,
      paymentDate,
    });
    if (after <= 0.009) payoffOrder.push(target.name);
  }

  return { allocations, balances, payoffOrder };
}

function addMonthPayment(
  payments: Map<string, SnowballMonthPayment>,
  debt: SnowballDebtInput,
  amount: number,
  kind: "scheduled" | "extra",
  balanceBefore: number,
  balanceAfter: number,
) {
  const clean = cents(amount);
  if (clean <= 0.009) return;
  const existing = payments.get(debt.id) ?? {
    billId: debt.id,
    billName: debt.name,
    dueDay: debt.dueDay,
    scheduledPayment: 0,
    extraPayment: 0,
    totalPayment: 0,
    balanceBefore,
    balanceAfter,
    paidOff: false,
  };
  if (kind === "scheduled") existing.scheduledPayment = cents(existing.scheduledPayment + clean);
  else existing.extraPayment = cents(existing.extraPayment + clean);
  existing.totalPayment = cents(existing.scheduledPayment + existing.extraPayment);
  existing.balanceBefore = Math.max(existing.balanceBefore, balanceBefore);
  existing.balanceAfter = balanceAfter;
  existing.paidOff = balanceAfter <= 0.009;
  payments.set(debt.id, existing);
}

function applyPoolToNextDebt(
  debts: SnowballDebtInput[],
  balances: Map<string, number>,
  payments: Map<string, SnowballMonthPayment>,
  method: DebtMethod,
  amount: number,
  kind: "scheduled" | "extra",
) {
  let pool = cents(Math.max(0, amount));
  while (pool > 0.009) {
    const target = orderDebts(
      debts
        .filter(debt => debt.included && (balances.get(debt.id) ?? 0) > 0.009)
        .map(debt => ({ ...debt, balance: balances.get(debt.id) ?? 0 })),
      method,
    )[0];
    if (!target) break;
    const original = debts.find(debt => debt.id === target.id) ?? target;
    const before = cents(balances.get(target.id) ?? 0);
    const payment = cents(Math.min(before, pool));
    const after = cents(Math.max(0, before - payment));
    balances.set(target.id, after);
    addMonthPayment(payments, original, payment, kind, before, after);
    pool = cents(pool - payment);
  }
  return cents(amount - pool);
}

export function projectSnowballMonth(options: {
  debts: SnowballDebtInput[];
  method: DebtMethod;
  startingBalances?: Map<string, number>;
  rolledPayment?: number;
  extraPayment?: number;
  applyInterest?: boolean;
}): SnowballMonthPlanResult {
  const balances = new Map(
    options.debts.map(debt => [
      debt.id,
      cents(Math.max(0, options.startingBalances?.get(debt.id) ?? debt.balance)),
    ]),
  );
  const payments = new Map<string, SnowballMonthPayment>();
  const activeIncludedAtStart = new Set(
    options.debts
      .filter(debt => debt.included && (balances.get(debt.id) ?? 0) > 0.009)
      .map(debt => debt.id),
  );
  let interest = 0;

  if (options.applyInterest !== false) {
    for (const debt of options.debts) {
      const before = balances.get(debt.id) ?? 0;
      if (before <= 0.009) continue;
      const charge = monthlyInterestCharge(before, debt.apr);
      balances.set(debt.id, cents(before + charge));
      interest = cents(interest + charge);
    }
  }

  let minimumPayments = 0;
  let scheduledPool = cents(Math.max(0, options.rolledPayment ?? 0));
  for (const debt of options.debts) {
    const before = cents(balances.get(debt.id) ?? 0);
    if (before <= 0.009) continue;
    const minimum = cents(Math.max(0, debt.minimum));
    const payment = cents(Math.min(before, minimum));
    const after = cents(Math.max(0, before - payment));
    balances.set(debt.id, after);
    minimumPayments = cents(minimumPayments + payment);
    addMonthPayment(payments, debt, payment, "scheduled", before, after);
    if (debt.included && minimum > payment) {
      scheduledPool = cents(scheduledPool + minimum - payment);
    }
  }

  const scheduledRolloverApplied = applyPoolToNextDebt(options.debts, balances, payments, options.method, scheduledPool, "scheduled");
  const extraPayment = applyPoolToNextDebt(options.debts, balances, payments, options.method, options.extraPayment ?? 0, "extra");
  const paidOffNames: string[] = [];
  const paidOffIds: string[] = [];
  for (const debt of options.debts) {
    if (!activeIncludedAtStart.has(debt.id)) continue;
    if ((balances.get(debt.id) ?? 0) > 0.009) continue;
    paidOffIds.push(debt.id);
    paidOffNames.push(debt.name);
  }
  const rolledPayment = cents(
    Math.max(0, options.rolledPayment ?? 0) +
    paidOffIds.reduce((sum, id) => {
      const debt = options.debts.find(item => item.id === id);
      return sum + Math.max(0, debt?.minimum ?? 0);
    }, 0),
  );
  const endingDebt = cents(options.debts
    .filter(debt => debt.included)
    .reduce((sum, debt) => sum + (balances.get(debt.id) ?? 0), 0));
  const paymentList = Array.from(payments.values()).map(payment => ({
    ...payment,
    scheduledPayment: cents(payment.scheduledPayment),
    extraPayment: cents(payment.extraPayment),
    totalPayment: cents(payment.totalPayment),
    balanceAfter: cents(balances.get(payment.billId) ?? payment.balanceAfter),
    paidOff: (balances.get(payment.billId) ?? payment.balanceAfter) <= 0.009,
  }));
  return {
    payments: paymentList,
    balances,
    payoffOrder: paidOffNames,
    paidOffNames,
    rolledPayment,
    minimumPayments,
    scheduledPayments: cents(minimumPayments + scheduledRolloverApplied),
    extraPayment,
    interest,
    endingDebt,
  };
}

function isoMonthDate(year: number, month: number, day: number): string {
  const lastDay = new Date(year, month + 1, 0).getDate();
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(Math.min(lastDay, Math.max(1, day))).padStart(2, "0")}`;
}

function splitCents(total: number, parts: number): number[] {
  if (parts <= 0) return [];
  const totalCents = Math.round(cents(total) * 100);
  const base = Math.floor(totalCents / parts);
  const remainder = totalCents - base * parts;
  return Array.from({ length: parts }, (_, index) => (base + (index < remainder ? 1 : 0)) / 100);
}

/**
 * Builds the canonical dated debt plan used by every forecast surface.
 *
 * Required payments stay with their creditor first. Any amount above the
 * creditor's remaining balance becomes a same-day rollover pool for the next
 * eligible debt. The parent amount is never emitted alongside its child
 * allocations, so the returned rows are the complete cash-impact schedule.
 */
export function projectDatedSnowballMonth(options: {
  debts: SnowballDebtInput[];
  method: DebtMethod;
  month: number;
  year: number;
  paymentDatesByDebtId?: ReadonlyMap<string, readonly string[]>;
  startingBalances?: Map<string, number>;
  rolledPayment?: number;
  extraPayment?: { amount: number; date: string };
}): DatedSnowballMonthPlanResult {
  const balances = new Map(
    options.debts.map(debt => [
      debt.id,
      cents(Math.max(0, options.startingBalances?.get(debt.id) ?? debt.balance)),
    ]),
  );
  const payments = new Map<string, SnowballMonthPayment>();
  const allocations: DatedDebtAllocation[] = [];
  const activeIncludedAtStart = new Set(
    options.debts
      .filter(debt => debt.included && (balances.get(debt.id) ?? 0) > 0.009)
      .map(debt => debt.id),
  );
  let interest = 0;
  let minimumPayments = 0;
  let unusedAmount = 0;
  let sequence = 0;

  for (const debt of options.debts) {
    const before = balances.get(debt.id) ?? 0;
    if (before <= 0.009) continue;
    const charge = monthlyInterestCharge(before, debt.apr);
    balances.set(debt.id, cents(before + charge));
    interest = cents(interest + charge);
  }

  type RequiredEvent = { date: string; debt: SnowballDebtInput; amount: number };
  type PoolEvent = {
    date: string;
    amount: number;
    kind: Exclude<DatedDebtAllocationKind, "required">;
    sourceBillId?: string;
    sourceBillName?: string;
  };
  const requiredEvents: RequiredEvent[] = [];
  const poolEvents: PoolEvent[] = [];

  for (const debt of options.debts) {
    if (!activeIncludedAtStart.has(debt.id) && (balances.get(debt.id) ?? 0) <= 0.009) continue;
    const configuredDates = options.paymentDatesByDebtId?.get(debt.id) ?? [];
    const dates = configuredDates.length
      ? [...configuredDates].sort()
      : [isoMonthDate(options.year, options.month, debt.dueDay)];
    const amounts = splitCents(Math.max(0, debt.minimum), dates.length);
    dates.forEach((date, index) => {
      if ((amounts[index] ?? 0) > 0.009) requiredEvents.push({ date, debt, amount: amounts[index] ?? 0 });
    });
  }

  const firstTarget = orderDebts(
    options.debts
      .filter(debt => debt.included && (balances.get(debt.id) ?? 0) > 0.009)
      .map(debt => ({ ...debt, balance: balances.get(debt.id) ?? 0 })),
    options.method,
  )[0];
  const firstTargetDates = firstTarget
    ? options.paymentDatesByDebtId?.get(firstTarget.id) ?? []
    : [];
  if ((options.rolledPayment ?? 0) > 0.009) {
    poolEvents.push({
      date: firstTargetDates[0] ?? isoMonthDate(options.year, options.month, firstTarget?.dueDay ?? 1),
      amount: cents(Math.max(0, options.rolledPayment ?? 0)),
      kind: "rollover",
    });
  }
  if ((options.extraPayment?.amount ?? 0) > 0.009) {
    poolEvents.push({
      date: options.extraPayment?.date ?? isoMonthDate(options.year, options.month, 1),
      amount: cents(Math.max(0, options.extraPayment?.amount ?? 0)),
      kind: "extra",
    });
  }

  const addAllocation = (
    target: SnowballDebtInput,
    amount: number,
    date: string,
    kind: DatedDebtAllocationKind,
    sourceAmount: number,
    source?: SnowballDebtInput,
  ) => {
    const payment = cents(amount);
    if (payment <= 0.009) return;
    const before = cents(balances.get(target.id) ?? 0);
    const applied = cents(Math.min(before, payment));
    if (applied <= 0.009) return;
    const after = cents(Math.max(0, before - applied));
    balances.set(target.id, after);
    addMonthPayment(payments, target, applied, kind === "extra" ? "extra" : "scheduled", before, after);
    allocations.push({
      id: `debt-plan:${date}:${source?.id ?? kind}:${target.id}:${kind}:${sequence++}`,
      date,
      sourceBillId: source?.id,
      sourceBillName: source?.name,
      targetBillId: target.id,
      targetBillName: target.name,
      kind,
      amount: applied,
      sourceAmount: cents(sourceAmount),
      balanceBefore: before,
      balanceAfter: after,
      paidOff: after <= 0.009,
    });
  };

  const applyPool = (event: PoolEvent) => {
    let remaining = cents(event.amount);
    while (remaining > 0.009) {
      const target = orderDebts(
        options.debts
          .filter(debt => debt.included && (balances.get(debt.id) ?? 0) > 0.009)
          .map(debt => ({ ...debt, balance: balances.get(debt.id) ?? 0 })),
        options.method,
      )[0];
      if (!target) break;
      const original = options.debts.find(debt => debt.id === target.id) ?? target;
      const before = balances.get(target.id) ?? 0;
      const applied = cents(Math.min(before, remaining));
      addAllocation(original, applied, event.date, event.kind, event.amount,
        event.sourceBillId ? options.debts.find(debt => debt.id === event.sourceBillId) : undefined);
      remaining = cents(remaining - applied);
    }
    unusedAmount = cents(unusedAmount + remaining);
  };

  const dates = [...new Set([
    ...requiredEvents.map(event => event.date),
    ...poolEvents.map(event => event.date),
  ])].sort();

  for (const date of dates) {
    const overflowPools: PoolEvent[] = [];
    requiredEvents
      .filter(event => event.date === date)
      .sort((left, right) => left.debt.id.localeCompare(right.debt.id))
      .forEach(event => {
        const before = cents(balances.get(event.debt.id) ?? 0);
        const ownPayment = cents(Math.min(before, event.amount));
        if (ownPayment > 0.009) {
          addAllocation(event.debt, ownPayment, date, "required", event.amount, event.debt);
          minimumPayments = cents(minimumPayments + ownPayment);
        }
        const overflow = cents(event.amount - ownPayment);
        if (overflow <= 0.009) return;
        if (event.debt.included) {
          overflowPools.push({
            date,
            amount: overflow,
            kind: "rollover",
            sourceBillId: event.debt.id,
            sourceBillName: event.debt.name,
          });
        } else {
          unusedAmount = cents(unusedAmount + overflow);
        }
      });
    overflowPools.forEach(applyPool);
    poolEvents.filter(event => event.date === date).forEach(applyPool);
  }

  const paidOffNames = options.debts
    .filter(debt => activeIncludedAtStart.has(debt.id) && (balances.get(debt.id) ?? 0) <= 0.009)
    .map(debt => debt.name);
  const paidOffIds = new Set(options.debts
    .filter(debt => activeIncludedAtStart.has(debt.id) && (balances.get(debt.id) ?? 0) <= 0.009)
    .map(debt => debt.id));
  const rolledPayment = cents(
    Math.max(0, options.rolledPayment ?? 0) +
    options.debts.reduce((sum, debt) => sum + (paidOffIds.has(debt.id) ? Math.max(0, debt.minimum) : 0), 0),
  );
  const endingDebt = cents(options.debts
    .filter(debt => debt.included)
    .reduce((sum, debt) => sum + (balances.get(debt.id) ?? 0), 0));
  const paymentList = Array.from(payments.values()).map(payment => ({
    ...payment,
    scheduledPayment: cents(payment.scheduledPayment),
    extraPayment: cents(payment.extraPayment),
    totalPayment: cents(payment.totalPayment),
    balanceAfter: cents(balances.get(payment.billId) ?? payment.balanceAfter),
    paidOff: (balances.get(payment.billId) ?? payment.balanceAfter) <= 0.009,
  }));
  const scheduledPayments = cents(allocations
    .filter(allocation => allocation.kind !== "extra")
    .reduce((sum, allocation) => sum + allocation.amount, 0));
  const extraPayment = cents(allocations
    .filter(allocation => allocation.kind === "extra")
    .reduce((sum, allocation) => sum + allocation.amount, 0));
  const plannedPayment = cents(scheduledPayments + extraPayment);

  return {
    payments: paymentList,
    balances,
    payoffOrder: paidOffNames,
    paidOffNames,
    rolledPayment,
    minimumPayments,
    scheduledPayments,
    extraPayment,
    interest,
    endingDebt,
    allocations,
    plannedPayment,
    unusedAmount,
  };
}

export interface PayoffSimulationOptions {
  debts: SnowballDebtInput[];
  method: DebtMethod;
  startMonth: number;
  startYear: number;
  firstMonthBalances: Map<string, number>;
  firstPayoffOrder?: string[];
  initialRolledPayment?: number;
  getExtraForMonth: (monthOffset: number, month: number, year: number, remainingDebt: number) => { extra: number; lowestBalance: number };
}

export function simulateSnowballPayoff(options: PayoffSimulationOptions): {
  months: SnowballMonthProjection[];
  payoffOrder: string[];
  debtFreeDate: string | null;
} {
  const balances = new Map(options.firstMonthBalances);
  const payoffOrder = [...(options.firstPayoffOrder ?? [])];
  const paidNames = new Set(payoffOrder);
  const months: SnowballMonthProjection[] = [];
  let rolledPayment = cents(options.initialRolledPayment ?? 0);

  for (let offset = 1; offset <= MAX_PAYOFF_MONTHS; offset++) {
    const absolute = options.startYear * 12 + options.startMonth + offset;
    const month = absolute % 12;
    const year = Math.floor(absolute / 12);
    const remainingDebtBeforePayment = options.debts
      .filter(debt => debt.included)
      .reduce((sum, debt) => sum + (balances.get(debt.id) ?? 0), 0);
    const safe = options.getExtraForMonth(offset, month, year, remainingDebtBeforePayment);
    const extra = cents(Math.min(Math.max(0, safe.extra), remainingDebtBeforePayment));
    const targetBefore = orderDebts(
      options.debts.filter(debt => debt.included && (balances.get(debt.id) ?? 0) > 0.009)
        .map(debt => ({ ...debt, balance: balances.get(debt.id) ?? 0 })),
      options.method,
    )[0];
    const monthPlan = projectSnowballMonth({
      debts: options.debts,
      method: options.method,
      startingBalances: balances,
      rolledPayment,
      extraPayment: extra,
    });
    balances.clear();
    monthPlan.balances.forEach((balance, id) => balances.set(id, balance));
    rolledPayment = monthPlan.rolledPayment;
    const paidOffNamesThisMonth = monthPlan.paidOffNames.filter(name => !paidNames.has(name));
    paidOffNamesThisMonth.forEach(name => {
      paidNames.add(name);
      payoffOrder.push(name);
    });
    months.push({
      month,
      year,
      targetName: targetBefore?.name ?? null,
      minimumPayments: monthPlan.minimumPayments,
      extraPayment: monthPlan.extraPayment,
      rolledPayment,
      interest: monthPlan.interest,
      endingDebt: monthPlan.endingDebt,
      lowestAccountBalance: safe.lowestBalance,
      paidOffNames: paidOffNamesThisMonth,
    });
    if (monthPlan.endingDebt <= 0.009) {
      return { months, payoffOrder, debtFreeDate: `${year}-${String(month + 1).padStart(2, "0")}` };
    }
  }

  return { months, payoffOrder, debtFreeDate: null };
}
