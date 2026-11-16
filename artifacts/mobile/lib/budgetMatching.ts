import type { ForecastAccountRef } from "./accountForecasts";
import { isInferredPendingBankHold, type PendingPlaidActivityRow } from "./plaidActivity";
import { buildReviewQueue, type ReviewTransactionLike } from "./reviewCenter";

export type BudgetMatchingPeriod = { month: number; year: number };
export type BudgetMatchingAccount = ForecastAccountRef | "unassigned" | null;
export type BudgetMatchingTab = "pending" | "posted";

export function budgetMatchingMonth(period: BudgetMatchingPeriod): string | null {
  if (!Number.isInteger(period.month) || period.month < 0 || period.month > 11
    || !Number.isInteger(period.year) || period.year < 1 || period.year > 9999) return null;
  return `${String(period.year).padStart(4, "0")}-${String(period.month + 1).padStart(2, "0")}`;
}

function matchesAccount(account: BudgetMatchingAccount, ref: ForecastAccountRef | null) {
  return account === null || (account === "unassigned" ? ref === null : ref === account);
}

/** Only real pending outflows can reserve an existing plan; never totals. */
export function pendingBudgetMatchingRows<T extends PendingPlaidActivityRow>(rows: T[], period: BudgetMatchingPeriod, account: BudgetMatchingAccount, accountRef: (row: T) => ForecastAccountRef | null): T[] {
  const month = budgetMatchingMonth(period);
  if (!month) return [];
  return rows.filter(row => row.transaction_date.startsWith(`${month}-`)
    && row.amount < -0.005 && !isInferredPendingBankHold(row)
    && matchesAccount(account, accountRef(row)))
    .sort((left, right) => right.transaction_date.localeCompare(left.transaction_date) || left.plaid_transaction_id.localeCompare(right.plaid_transaction_id));
}

/** The budget month is exact; the ordinary Review Center keeps its rollover. */
export function postedBudgetMatchingRows<T extends ReviewTransactionLike>(rows: T[], period: BudgetMatchingPeriod, account: BudgetMatchingAccount, accountRef: (row: T) => ForecastAccountRef | null): T[] {
  const month = budgetMatchingMonth(period);
  if (!month) return [];
  return buildReviewQueue(rows, `${month}-01`).filter(row => row.date.startsWith(`${month}-`) && matchesAccount(account, accountRef(row)));
}
