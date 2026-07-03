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

export function effectiveDebtMinimum(baseMinimum: number, rolledMinimum: number): number {
  return cents(Math.max(0, baseMinimum) + Math.max(0, rolledMinimum));
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

  for (const debt of options.debts) {
    const before = balances.get(debt.id) ?? 0;
    if (before <= 0.009) continue;
    const charge = cents(before * Math.max(0, debt.apr) / 1200);
    balances.set(debt.id, cents(before + charge));
    interest = cents(interest + charge);
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
