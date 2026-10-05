import { createFinancialProjection, hasPendingSnowballBalanceApply, safeLocalDateInTimeZone } from "./financialProjection";
import type { FinancialProjectionOptions, FinancialProjectionSnapshot, ExtraPayment } from "./financialProjectionTypes";
import { isValidExtraPaymentPlan } from "./debtPlanDomain";
import { orderDebts, type SnowballProjectionResult } from "./snowball";
import { isBillActiveForMonth } from "./schedule";

const cents = (value: number) => Math.round(value * 100) / 100;
// Revision-scoped, weakly held cache: typing an amount does not repeat the safety search.
// A new account/financial snapshot has a different identity and can never reuse old room.
const safeRoomCache = new WeakMap<FinancialProjectionSnapshot, Map<string, number>>();

/** A read-only candidate in the same dated ledger as Forecast, not a parallel payoff engine. */
export function previewCanonicalDebtSnowball(
  snapshot: FinancialProjectionSnapshot,
  options: FinancialProjectionOptions,
  month: number,
  year: number,
  requestedExtra?: number,
  additionalSafeCredit = 0,
  paymentDateOverride?: string,
  editingPaymentId?: string,
): SnowballProjectionResult {
  const today = safeLocalDateInTimeZone(options.now, options.timeZone);
  const prefix = `${year}-${String(month + 1).padStart(2, "0")}`;
  const startAbsolute = Number(today.slice(0, 4)) * 12 + Number(today.slice(5, 7)) - 1;
  const selectedAbsolute = year * 12 + month;
  const original = editingPaymentId
    ? snapshot.extraPayments.find(payment => payment.id === editingPaymentId && isValidExtraPaymentPlan(payment))
    : snapshot.extraPayments.find(payment => payment.month === month && payment.year === year && isValidExtraPaymentPlan(payment));
  const restored = new Map<string, number>();
  if (original && !hasPendingSnowballBalanceApply(original) && (original.payment_date ?? "") <= today) {
    original.allocations.forEach(allocation => restored.set(allocation.billId, (restored.get(allocation.billId) ?? 0) + Math.max(0, allocation.payment)));
  }
  const bills = snapshot.bills.map(bill => restored.has(bill.id) ? { ...bill, balance: cents(Number(bill.balance) + restored.get(bill.id)!) } : bill);
  const target = orderDebts(bills.filter(bill => bill.is_debt && bill.include_in_snowball !== false && Number(bill.balance) > 0 && isBillActiveForMonth(bill, month, year))
    .map(bill => ({ id: bill.id, name: bill.name, balance: Number(bill.balance), minimum: bill.amount, apr: Number(bill.interest_rate), dueDay: bill.due_day, included: true })), snapshot.settings.paymentMethod)[0];
  const defaultDay = Math.max(1, Math.min(new Date(year, month + 1, 0).getDate(), target?.dueDay ?? 1));
  const defaultDate = `${prefix}-${String(defaultDay).padStart(2, "0")}`;
  const dateMatch = paymentDateOverride?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const validDate = dateMatch && paymentDateOverride!.startsWith(`${prefix}-`) && Number(dateMatch[3]) >= 1 && Number(dateMatch[3]) <= new Date(year, month + 1, 0).getDate();
  const paymentDate = validDate ? paymentDateOverride! : defaultDate < today && today.startsWith(prefix) ? today : defaultDate;
  const empty: SnowballProjectionResult = { safeMaximum: 0, selectedExtra: 0, paymentDate, allocations: [], months: [], payoffOrder: [], debtFreeDate: null, lowestSixMonthBalance: 0 };
  const conflict = snapshot.extraPayments.some(payment => payment.id !== original?.id && payment.month === month && payment.year === year && isValidExtraPaymentPlan(payment));
  if (!snapshot.settings.debtPayoffEnabled || conflict || paymentDate < today || !target || selectedAbsolute >= startAbsolute + 240) return empty;
  const base = { ...snapshot, bills, extraPayments: snapshot.extraPayments.filter(payment => payment.id !== original?.id) };
  const build = (amount: number) => {
    // The canonical engine validates saved allocation totals before accepting an extra.
    // This seed only admits the candidate; the dated engine recalculates its real targets.
    const candidate: ExtraPayment = { id: "preview-only", month, year, amount, payment_date: paymentDate, allocations: [{ billId: target.id, billName: target.name, payment: amount, balanceBefore: target.balance, balanceAfter: Math.max(0, target.balance - amount), paidOff: amount >= target.balance, paymentDate }], sources: [{ type: "manual", amount, pendingBalanceApply: true }] };
    return createFinancialProjection({ ...base, extraPayments: amount > 0 ? [...base.extraPayments, candidate] : base.extraPayments }, options);
  };
  const baseline = build(0);
  const baselinePlan = baseline.getDebtPlanForMonth(month, year);
  if (!baselinePlan) return empty;
  const includedIds = new Set(bills.filter(bill => bill.is_debt && bill.include_in_snowball !== false).map(bill => bill.id));
  const upperBound = bills.filter(bill => includedIds.has(bill.id)).reduce((sum, bill) => sum + Math.max(0, Number(bill.balance)), 0) * 2 + baselinePlan.interest;
  // A large dated probe tells us exactly what the allocator can still pay on this date,
  // excluding debts already cleared by intervening minimums and excluded debts.
  const totalDebt = build(upperBound).getDebtPlanForMonth(month, year)?.allocations
    .filter(allocation => allocation.kind === "extra" && allocation.date === paymentDate && includedIds.has(allocation.targetBillId))
    .reduce((sum, allocation) => sum + allocation.amount, 0) ?? 0;
  const cashEnd = selectedAbsolute + Math.max(1, snapshot.settings.forecast_horizon_months);
  const minimumCash = (projection: ReturnType<typeof build>, months = cashEnd) => {
    let lowest = Infinity;
    for (let absolute = startAbsolute; absolute < months; absolute++) {
      projection.getDailyBalances(absolute % 12, Math.floor(absolute / 12)).forEach(day => {
        if (day.balanceDate >= today) lowest = day.balanceUnavailableReason ? -Infinity : Math.min(lowest, day.balance + (day.balanceDate >= paymentDate ? Math.max(0, additionalSafeCredit) : 0));
      });
    }
    return Number.isFinite(lowest) ? lowest : -Infinity;
  };
  // Binary search evaluates the candidate's actual changed payments, interest and rollover.
  // Before the selected date its cash is unchanged, so an earlier risk remains a risk.
  const cacheKey = `${today}:${paymentDate}:${original?.id ?? "new"}:${additionalSafeCredit}`;
  const revisionCache = safeRoomCache.get(snapshot) ?? new Map<string, number>();
  safeRoomCache.set(snapshot, revisionCache);
  const cachedMaximum = revisionCache.get(cacheKey);
  let low = cachedMaximum === undefined ? 0 : Math.round(cachedMaximum * 100);
  let high = Math.max(0, Math.floor(totalDebt * 100));
  if (cachedMaximum === undefined && minimumCash(baseline) >= snapshot.settings.safety_floor) {
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (minimumCash(build(middle / 100)) + 0.005 >= snapshot.settings.safety_floor) low = middle;
      else high = middle - 1;
    }
  }
  const safeMaximum = low / 100;
  if (revisionCache.size >= 16 && !revisionCache.has(cacheKey)) revisionCache.delete(revisionCache.keys().next().value!);
  revisionCache.set(cacheKey, safeMaximum);
  const selectedExtra = cents(Math.max(0, Math.min(Number.isFinite(requestedExtra) ? requestedExtra! : safeMaximum, safeMaximum)));
  const projection = build(selectedExtra);
  const selectedPlan = projection.getDebtPlanForMonth(month, year)!;
  const allocations = selectedPlan.allocations.filter(allocation => allocation.kind === "extra" && allocation.date === paymentDate).map(allocation => ({
    billId: allocation.targetBillId, billName: allocation.targetBillName, payment: allocation.amount,
    balanceBefore: allocation.balanceBefore, balanceAfter: allocation.balanceAfter, paidOff: allocation.paidOff, paymentDate,
  }));
  const months: SnowballProjectionResult["months"] = [];
  const payoffOrder: string[] = [];
  let debtFreeDate: string | null = null;
  // Canonical monthly plans contain active debts only. Preserve inactive outstanding
  // balances in the overall payoff total rather than calling paused debts paid off.
  const outstanding = new Map(bills.filter(bill => bill.is_debt).map(bill => [bill.id, Math.max(0, Number(bill.balance))]));
  for (let absolute = startAbsolute; absolute < selectedAbsolute; absolute++) {
    projection.getDebtPlanForMonth(absolute % 12, Math.floor(absolute / 12))?.balances.forEach((balance, id) => outstanding.set(id, balance));
  }
  // Canonical projection supports 240 months from its as-of month. Do not invent a date beyond it.
  for (let absolute = selectedAbsolute; absolute < startAbsolute + 240; absolute++) {
    const projectedMonth = absolute % 12;
    const projectedYear = Math.floor(absolute / 12);
    const plan = projection.getDebtPlanForMonth(projectedMonth, projectedYear);
    if (!plan) break;
    plan.balances.forEach((balance, id) => outstanding.set(id, balance));
    const endingDebt = cents(Array.from(outstanding.values()).reduce((sum, balance) => sum + balance, 0));
    plan.paidOffNames.forEach(name => { if (!payoffOrder.includes(name)) payoffOrder.push(name); });
    const days = projection.getDailyBalances(projectedMonth, projectedYear).filter(day => day.balanceDate >= today);
    months.push({ month: projectedMonth, year: projectedYear, targetName: plan.allocations.find(allocation => allocation.kind !== "required")?.targetBillName ?? null,
      minimumPayments: plan.minimumPayments, extraPayment: plan.extraPayment, rolledPayment: plan.rolledPayment, interest: plan.interest,
      endingDebt, lowestAccountBalance: days.length ? Math.min(...days.map(day => day.balance)) : 0, paidOffNames: plan.paidOffNames });
    if (endingDebt <= 0.009) { debtFreeDate = `${projectedYear}-${String(projectedMonth + 1).padStart(2, "0")}`; break; }
  }
  return { safeMaximum, selectedExtra, paymentDate, allocations, months, payoffOrder, debtFreeDate,
    lowestSixMonthBalance: months.length ? Math.min(...months.slice(0, 6).map(item => item.lowestAccountBalance)) : 0 };
}
