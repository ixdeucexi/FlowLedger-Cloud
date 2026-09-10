import {
  createFinancialProjection,
  safeLocalDateInTimeZone,
  type FinancialProjection,
} from "./financialProjection";
import type { FinancialProjectionSnapshot } from "./financialProjectionTypes";

/**
 * Lazy app adapter: reuses one instance per snapshot revision / household date.
 * No timers, eager horizons, network work, or startup barrier. The server uses
 * createFinancialProjection directly with a single request clock.
 */
export function createFinancialProjectionReader(
  snapshot: FinancialProjectionSnapshot,
  options: { now: () => Date; timeZone: string },
): FinancialProjection {
  let instance: FinancialProjection | undefined;
  let instanceDate: string | undefined;
  const current = (dateSensitive: boolean) => {
    if (!instance || dateSensitive) {
      const now = options.now();
      const date = safeLocalDateInTimeZone(now, options.timeZone);
      if (!instance || date !== instanceDate) {
        instance = createFinancialProjection(snapshot, {
          now,
          timeZone: options.timeZone,
        });
        instanceDate = date;
      }
    }
    return instance;
  };
  const methods = [
    "getOverride",
    "getAmount",
    "getPaidAmount",
    "getCustomDueDay",
    "getBillOccurrencesInMonth",
    "getBillMonthlyTotal",
    "getBillEffectiveMonthlyTotal",
    "getMonthlyBills",
    "getDebtMonthSettlements",
    "getDebtSourceCommitment",
    "getExtraPayment",
    "getDebtPlanForMonth",
    "getRemainingDebtPlanForMonth",
    "getMonthlyIncome",
    "getIncomeOccurrencesInMonth",
    "getCashFlow",
    "getDailyBalances",
  ] as const;
  const dated = new Set<string>([
    "getDebtPlanForMonth",
    "getRemainingDebtPlanForMonth",
    "getCashFlow",
    "getDailyBalances",
  ]);
  const reader = {} as FinancialProjection;
  for (const name of methods) {
    Object.defineProperty(reader, name, {
      value: (...args: unknown[]) =>
        Reflect.apply(current(dated.has(name))[name], undefined, args),
      enumerable: true,
    });
  }
  for (const name of [
    "transactionLedger",
    "matchedAllocationIndexes",
    "debtSourceCommitments",
  ] as const) {
    Object.defineProperty(reader, name, {
      get: () => current(false)[name],
      enumerable: true,
    });
  }
  return reader;
}
