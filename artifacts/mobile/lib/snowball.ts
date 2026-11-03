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

/** Current-month cash controls used only by the canonical dated plan. */
export interface DatedSnowballDebtInput extends SnowballDebtInput {
  /** Cash currently scheduled toward the original requirement. Defaults to `minimum`. */
  requiredPayment?: number;
  /** Exact required cash per due date when reviewed history changed one occurrence. */
  requiredPaymentsByDate?: ReadonlyMap<string, number>;
  /** Exact Forecast money above the requirement, targeted to this debt. */
  plannedExtraPayment?: number;
  /** Exact dated optional cash, including partial-month saved pause schedules. */
  plannedExtraPaymentsByDate?: ReadonlyMap<string, number>;
  /** Earlier overflow is already absorbed by the scenario's observed cash anchor. */
  suppressRequiredOverflowBefore?: string;
  /** A paused open creditor still has an explicit zero planned-payment row. */
  retainPaymentRow?: boolean;
  /** Authoritative pending principal must be reserved before optional pools. */
  committedPaymentsByDate?: ReadonlyMap<string, number>;
  /** The caller has already removed reviewed cash from source/date amounts. */
  sourceSettlementsApplied?: boolean;
}

/** Optional dated scenario payments. Existing canonical callers need no changes. */
export interface DatedSnowballAdditionalPayment {
  id: string;
  date: string;
  amount?: number;
  kind?: "rollover" | "extra";
  targetBillId?: string;
  sourceBillId?: string;
  cascade?: boolean;
  /** Resolve this creditor's remaining principal at the payment date. */
  payoff?: boolean;
  ignoreExtraEligibility?: boolean;
  phase?: "before_required" | "before_pools" | "after_pools";
  pauseRedirect?: DebtPauseRedirect;
  /** Protected bank principal, already reserved by its dated debt input. */
  committedPayment?: boolean;
}

export type DebtPauseRedirect = { pauseId: string; fromBillId: string; occurrenceDate: string };

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
  externalPaymentId?: string;
  pauseRedirect?: DebtPauseRedirect;
  sourceSettlementsApplied?: boolean;
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
    // Redirect funding has already excluded the donor's settled cash. It is
    // independent of both the donor's and recipient's ordinary source groups.
    if (allocation.pauseRedirect || allocation.sourceSettlementsApplied) return;
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

/**
 * The lender-required amount for one occurrence. Snowball rollover is an
 * optional payoff commitment and must never raise the amount used for
 * late/missed-payment status.
 */
export function requiredDebtMinimum(baseMinimum: number): number {
  return cents(Math.max(0, baseMinimum));
}

export function monthlyDebtAmount(baseMinimum: number, _rolledMinimum: number, settledAmount?: number): number {
  return settledAmount !== undefined && Number.isFinite(settledAmount)
    ? cents(Math.max(0, settledAmount))
    : requiredDebtMinimum(baseMinimum);
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
  debts: DatedSnowballDebtInput[];
  method: DebtMethod;
  month: number;
  year: number;
  paymentDatesByDebtId?: ReadonlyMap<string, readonly string[]>;
  startingBalances?: Map<string, number>;
  rolledPayment?: number;
  extraPayment?: { amount: number; date: string };
  /** Keeps temporarily paused debts in balances/interest while excluding extra allocations. */
  canReceiveExtra?: (debtId: string, date: string) => boolean;
  additionalPayments?: readonly DatedSnowballAdditionalPayment[];
  /** Recipient extra cash already paid, after automatic rollover/exact-plan credit. */
  pauseRedirectCreditsByDebtId?: ReadonlyMap<string, number>;
  rolledPaymentDate?: string;
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
  const pauseRedirectCredits = new Map(options.pauseRedirectCreditsByDebtId);
  const pendingPrincipal = new Map(options.debts.map(debt => [debt.id,
    cents([...(debt.committedPaymentsByDate?.values() ?? [])].reduce((sum, amount) => sum + Math.max(0, amount), 0))]));

  for (const debt of options.debts) {
    const before = balances.get(debt.id) ?? 0;
    if (before <= 0.009) continue;
    const charge = monthlyInterestCharge(before, debt.apr);
    balances.set(debt.id, cents(before + charge));
    interest = cents(interest + charge);
  }

  type RequiredEvent = { date: string; debt: DatedSnowballDebtInput; amount: number };
  type PoolEvent = {
    date: string;
    amount: number;
    kind: Exclude<DatedDebtAllocationKind, "required">;
    targetBillId?: string;
    cascade?: boolean;
    sourceBillId?: string;
    sourceBillName?: string;
    externalPaymentId?: string;
    payoff?: boolean;
    ignoreExtraEligibility?: boolean;
    phase?: "before_required" | "before_pools" | "after_pools";
    pauseRedirect?: DebtPauseRedirect;
    committedPayment?: boolean;
    sourceSettlementsApplied?: boolean;
  };
  const requiredEvents: RequiredEvent[] = [];
  const poolEvents: PoolEvent[] = [];

  for (const debt of options.debts) {
    if (!activeIncludedAtStart.has(debt.id) && (balances.get(debt.id) ?? 0) <= 0.009) continue;
    const configuredDates = options.paymentDatesByDebtId?.get(debt.id) ?? [];
    const dates = configuredDates.length
      ? [...configuredDates].sort()
      : [isoMonthDate(options.year, options.month, debt.dueDay)];
    const amounts = debt.requiredPaymentsByDate
      ? dates.map(date => cents(Math.max(0, debt.requiredPaymentsByDate?.get(date) ?? 0)))
      : splitCents(
          Math.max(0, debt.requiredPayment ?? debt.minimum),
          dates.length,
        );
    dates.forEach((date, index) => {
      if ((amounts[index] ?? 0) > 0.009) requiredEvents.push({ date, debt, amount: amounts[index] ?? 0 });
    });
    const plannedExtras = debt.plannedExtraPaymentsByDate
      ? [...debt.plannedExtraPaymentsByDate]
      : [[dates[0] ?? isoMonthDate(options.year, options.month, debt.dueDay), debt.plannedExtraPayment ?? 0] as const];
    plannedExtras.forEach(([date, amount]) => {
      const plannedExtra = cents(Math.max(0, amount));
      if (plannedExtra <= 0.009) return;
      poolEvents.push({
        date,
        amount: plannedExtra,
        kind: "rollover",
        targetBillId: debt.id,
        cascade: debt.included,
      });
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
      date: options.rolledPaymentDate ?? firstTargetDates[0] ?? isoMonthDate(options.year, options.month, firstTarget?.dueDay ?? 1),
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
  options.additionalPayments?.forEach(payment => {
    const amount = cents(Math.max(0, payment.amount ?? 0));
    if (amount <= 0.009 && !payment.payoff) return;
    poolEvents.push({
      date: payment.date,
      amount,
      kind: payment.kind ?? "extra",
      targetBillId: payment.targetBillId,
      sourceBillId: payment.sourceBillId,
      cascade: payment.cascade,
      externalPaymentId: payment.id,
      payoff: payment.payoff,
      ignoreExtraEligibility: payment.ignoreExtraEligibility,
      phase: payment.phase,
      pauseRedirect: payment.pauseRedirect,
      committedPayment: payment.committedPayment,
    });
  });

  const addAllocation = (
    target: SnowballDebtInput,
    amount: number,
    date: string,
    kind: DatedDebtAllocationKind,
    sourceAmount: number,
    source?: SnowballDebtInput,
    externalPaymentId?: string,
    pauseRedirect?: DebtPauseRedirect,
    sourceSettlementsApplied?: boolean,
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
      ...(externalPaymentId ? { externalPaymentId } : {}),
      ...(pauseRedirect ? { pauseRedirect } : {}),
      ...(sourceSettlementsApplied ? { sourceSettlementsApplied } : {}),
    });
  };

  const applyPool = (event: PoolEvent) => {
    if (event.committedPayment && event.targetBillId) pendingPrincipal.set(event.targetBillId,
      cents(Math.max(0, (pendingPrincipal.get(event.targetBillId) ?? 0) - event.amount)));
    let remaining = event.payoff && event.targetBillId
      ? cents(Math.max(0, balances.get(event.targetBillId) ?? 0))
      : cents(event.amount);
    const sourceAmount = remaining;
    if (event.pauseRedirect) {
      // A recipient's already committed extra consumes temporary funding even
      // when that commitment has cleared its remaining principal. Credits are
      // shared across redirects and exclude automatic rollover already used.
      const creditedDebts = orderDebts(options.debts.filter(debt => debt.included
        && options.canReceiveExtra?.(debt.id, event.date) !== false), options.method);
      for (const debt of creditedDebts) {
        const credit = Math.max(0, pauseRedirectCredits.get(debt.id) ?? 0);
        const absorbed = cents(Math.min(remaining, credit));
        pauseRedirectCredits.set(debt.id, cents(credit - absorbed));
        remaining = cents(remaining - absorbed);
        if (remaining <= 0.009) break;
      }
    }
    const availablePrincipal = (id: string) => Math.max(0,
      (balances.get(id) ?? 0) - (event.ignoreExtraEligibility ? 0 : pendingPrincipal.get(id) ?? 0));
    let preferredTargetId = event.targetBillId;
    while (remaining > 0.009) {
      const preferred = preferredTargetId
        ? options.debts.find(debt => debt.id === preferredTargetId && availablePrincipal(debt.id) > 0.009
          && (event.ignoreExtraEligibility || options.canReceiveExtra?.(debt.id, event.date) !== false))
        : undefined;
      if (preferredTargetId && event.externalPaymentId && event.cascade === false && !preferred) break;
      const target = preferred ?? orderDebts(
        options.debts
          .filter(debt => debt.included && availablePrincipal(debt.id) > 0.009
            && options.canReceiveExtra?.(debt.id, event.date) !== false)
          .map(debt => ({ ...debt, balance: balances.get(debt.id) ?? 0 })),
        options.method,
      )[0];
      if (!target) break;
      const original = options.debts.find(debt => debt.id === target.id) ?? target;
      const applied = cents(Math.min(availablePrincipal(target.id), remaining));
      addAllocation(original, applied, event.date, event.kind, sourceAmount,
        event.sourceBillId ? options.debts.find(debt => debt.id === event.sourceBillId) : undefined,
        event.externalPaymentId, event.pauseRedirect, event.sourceSettlementsApplied);
      remaining = cents(remaining - applied);
      if (preferredTargetId) {
        preferredTargetId = undefined;
        if (event.cascade === false) break;
      }
    }
    unusedAmount = cents(unusedAmount + remaining);
  };

  const dates = [...new Set([
    ...requiredEvents.map(event => event.date),
    ...poolEvents.map(event => event.date),
  ])].sort();

  for (const date of dates) {
    const overflowPools: PoolEvent[] = [];
    poolEvents.filter(event => event.date === date && event.phase === "before_required").forEach(applyPool);
    requiredEvents
      .filter(event => event.date === date)
      .sort((left, right) => left.debt.id.localeCompare(right.debt.id))
      .forEach(event => {
        const committed = Math.max(0, event.debt.committedPaymentsByDate?.get(date) ?? 0);
        if (committed > 0.005) pendingPrincipal.set(event.debt.id, cents(Math.max(0,
          (pendingPrincipal.get(event.debt.id) ?? 0) - committed)));
        const before = cents(balances.get(event.debt.id) ?? 0);
        const ownPayment = cents(Math.min(Math.max(0, before - (pendingPrincipal.get(event.debt.id) ?? 0)), event.amount));
        if (ownPayment > 0.009) {
          addAllocation(event.debt, ownPayment, date, "required", event.amount, event.debt, undefined, undefined, event.debt.sourceSettlementsApplied);
          minimumPayments = cents(minimumPayments + ownPayment);
        }
        const overflow = cents(event.amount - ownPayment);
        if (overflow <= 0.009 || committed > 0.005 || event.debt.suppressRequiredOverflowBefore && date < event.debt.suppressRequiredOverflowBefore) return;
        if (event.debt.included) {
          overflowPools.push({
            date,
            amount: overflow,
            kind: "rollover",
            sourceBillId: event.debt.id,
            sourceBillName: event.debt.name,
            sourceSettlementsApplied: event.debt.sourceSettlementsApplied,
          });
        } else {
          unusedAmount = cents(unusedAmount + overflow);
        }
      });
    poolEvents.filter(event => event.date === date && event.phase === "before_pools").forEach(applyPool);
    overflowPools.forEach(applyPool);
    poolEvents.filter(event => event.date === date && !event.phase).forEach(applyPool);
    poolEvents.filter(event => event.date === date && event.phase === "after_pools").forEach(applyPool);
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
  for (const debt of options.debts) {
    if (!debt.retainPaymentRow || payments.has(debt.id) || (balances.get(debt.id) ?? 0) <= 0.009) continue;
    const balance = cents(balances.get(debt.id) ?? 0);
    payments.set(debt.id, { billId: debt.id, billName: debt.name, dueDay: debt.dueDay,
      scheduledPayment: 0, extraPayment: 0, totalPayment: 0, balanceBefore: balance, balanceAfter: balance, paidOff: false });
  }
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
