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

export interface PayoffSimulationOptions {
  debts: SnowballDebtInput[];
  method: DebtMethod;
  startMonth: number;
  startYear: number;
  firstMonthBalances: Map<string, number>;
  firstPayoffOrder?: string[];
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
  let rolledPayment = 0;

  for (let offset = 1; offset <= MAX_PAYOFF_MONTHS; offset++) {
    const absolute = options.startYear * 12 + options.startMonth + offset;
    const month = absolute % 12;
    const year = Math.floor(absolute / 12);
    let interest = 0;
    const activeIncludedAtStart = new Set(
      options.debts.filter(debt => debt.included && (balances.get(debt.id) ?? 0) > 0.009).map(debt => debt.id),
    );

    for (const debt of options.debts) {
      const before = balances.get(debt.id) ?? 0;
      if (before <= 0.009) continue;
      const charge = cents(before * Math.max(0, debt.apr) / 1200);
      balances.set(debt.id, cents(before + charge));
      interest = cents(interest + charge);
    }

    let minimumPayments = 0;
    let unusedMinimum = 0;
    for (const debt of options.debts) {
      const before = balances.get(debt.id) ?? 0;
      if (before <= 0.009) continue;
      const minimum = cents(Math.max(0, debt.minimum));
      const payment = cents(Math.min(before, minimum));
      balances.set(debt.id, cents(before - payment));
      minimumPayments = cents(minimumPayments + payment);
      if (debt.included && minimum > payment) unusedMinimum = cents(unusedMinimum + minimum - payment);
    }

    const remainingIncludedBeforeExtra = options.debts
      .filter(debt => debt.included)
      .reduce((sum, debt) => sum + (balances.get(debt.id) ?? 0), 0);
    const safe = options.getExtraForMonth(offset, month, year, remainingIncludedBeforeExtra);
    const extra = cents(Math.min(Math.max(0, safe.extra), remainingIncludedBeforeExtra));
    let pool = cents(extra + rolledPayment + unusedMinimum);
    const targetBefore = orderDebts(
      options.debts.filter(debt => debt.included && (balances.get(debt.id) ?? 0) > 0.009)
        .map(debt => ({ ...debt, balance: balances.get(debt.id) ?? 0 })),
      options.method,
    )[0];

    while (pool > 0.009) {
      const target = orderDebts(
        options.debts.filter(debt => debt.included && (balances.get(debt.id) ?? 0) > 0.009)
          .map(debt => ({ ...debt, balance: balances.get(debt.id) ?? 0 })),
        options.method,
      )[0];
      if (!target) break;
      const before = balances.get(target.id) ?? 0;
      const payment = cents(Math.min(before, pool));
      balances.set(target.id, cents(before - payment));
      pool = cents(pool - payment);
      if ((balances.get(target.id) ?? 0) <= 0.009 && !paidNames.has(target.name)) {
        paidNames.add(target.name);
        payoffOrder.push(target.name);
      }
    }

    const newlyPaid = options.debts.filter(debt => activeIncludedAtStart.has(debt.id) && (balances.get(debt.id) ?? 0) <= 0.009);
    for (const debt of newlyPaid) {
      if (!paidNames.has(debt.name)) {
        paidNames.add(debt.name);
        payoffOrder.push(debt.name);
      }
    }
    rolledPayment = cents(rolledPayment + newlyPaid.reduce((sum, debt) => sum + debt.minimum, 0));

    const endingDebt = cents(options.debts.filter(debt => debt.included).reduce((sum, debt) => sum + (balances.get(debt.id) ?? 0), 0));
    months.push({
      month,
      year,
      targetName: targetBefore?.name ?? null,
      minimumPayments,
      extraPayment: extra,
      rolledPayment,
      interest,
      endingDebt,
      lowestAccountBalance: safe.lowestBalance,
    });
    if (endingDebt <= 0.009) {
      return { months, payoffOrder, debtFreeDate: `${year}-${String(month + 1).padStart(2, "0")}` };
    }
  }

  return { months, payoffOrder, debtFreeDate: null };
}
