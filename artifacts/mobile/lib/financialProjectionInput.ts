import {
  isActiveTransaction,
  isDeletedTransaction,
  plaidTransactionAccountKind,
} from "./billMatching";
import { canonicalDebtPaymentMethod } from "./debtOrder";
import { normalizeBillImportance } from "./billImportance";
import { selectFlowLedgerTransactions } from "./ledgerEngine";
import { type PendingPlanMatch } from "./pendingPlanMatches";
import type {
  Bill,
  MonthlyOverride,
  BillDateMove,
  Transaction,
  PendingBankTransaction,
  Account,
  ConnectedBankAccount,
  Goal,
  ExtraPayment,
  Settings,
} from "./financialProjectionTypes";

export const DEFAULT_SETTINGS: Settings = {
  zeroBasedBudgetEnabled: false,
  debtPayoffEnabled: true,
  paymentMethod: "snowball",
  starting_balance: 0,
  calendar_start_date: undefined,
  safety_floor: 200,
  forecast_horizon_months: 6,
  onboarding_completed: false,
};

export function normalizeSettingsRow(
  row: any,
  fallback: Settings = DEFAULT_SETTINGS,
): Settings {
  return {
    zeroBasedBudgetEnabled:
      row?.zero_based_budget_enabled ?? fallback.zeroBasedBudgetEnabled,
    debtPayoffEnabled: row?.debt_payoff_enabled ?? fallback.debtPayoffEnabled,
    paymentMethod: canonicalDebtPaymentMethod(
      row?.payment_method ?? fallback.paymentMethod,
    ),
    starting_balance: Number(
      row?.starting_balance ?? fallback.starting_balance,
    ),
    starting_balance_date: row?.starting_balance_date ?? undefined,
    calendar_start_date: row?.calendar_start_date ?? undefined,
    safety_floor: Number(row?.safety_floor ?? fallback.safety_floor),
    forecast_horizon_months: Number(
      row?.forecast_horizon_months ?? fallback.forecast_horizon_months,
    ),
    onboarding_completed:
      row?.onboarding_completed ?? fallback.onboarding_completed,
  };
}

export function normalizeBillRow(bill: any): Bill {
  return {
    ...bill,
    frequency: (bill.frequency ?? "monthly") as
      | "monthly"
      | "quarterly"
      | "biweekly"
      | "weekly",
    day_of_week: bill.day_of_week ?? 0,
    next_payment_date: bill.next_payment_date ?? undefined,
    amount: Number(bill.amount),
    balance: Number(bill.balance),
    interest_rate: Number(bill.interest_rate),
    smart_priority: normalizeBillImportance(
      bill.smart_priority,
      Boolean(bill.is_debt),
    ),
    include_in_snowball: bill.include_in_snowball !== false,
    snowball_minimum_boost: Number(bill.snowball_minimum_boost ?? 0),
  };
}

export function normalizeBillDateMoveRow(row: any): BillDateMove {
  return {
    id: String(row.id ?? genId()),
    bill_id: String(row.bill_id),
    from_date: String(row.from_date).slice(0, 10),
    to_date: String(row.to_date).slice(0, 10),
    move_reason: row.move_reason === "automatic" ? "automatic" : "manual",
    created_at: String(row.created_at ?? new Date().toISOString()),
    updated_at: row.updated_at ? String(row.updated_at) : undefined,
  };
}

export function normalizeGoalRow(goal: any): Goal {
  return {
    ...goal,
    target_amount: Number(goal.target_amount),
    current_amount: Number(goal.current_amount),
    goal_type:
      goal.goal_type ??
      (Number(goal.current_amount) < 0 ? "planned_expense" : "savings"),
  };
}

export function normalizeExtraPaymentRow(payment: any): ExtraPayment {
  return {
    ...payment,
    amount: Number(payment.amount),
    allocations: payment.allocations ?? [],
    payment_date: payment.payment_date ?? undefined,
    sources: payment.sources ?? [
      { type: "manual", amount: Number(payment.amount) },
    ],
  };
}

export function normalizeTransactionRow(transaction: any): Transaction {
  return {
    ...transaction,
    amount: Number(transaction.amount),
    debt_applied_amount: Number(transaction.debt_applied_amount ?? 0),
    debt_applied_bill_id: transaction.debt_applied_bill_id ?? undefined,
    review_allocations: Array.isArray(transaction.review_allocations)
      ? transaction.review_allocations.map((allocation: any) => ({
          ...allocation,
          amount: Number(allocation.amount ?? 0),
          plannedAmount:
            allocation.plannedAmount === undefined
              ? undefined
              : Number(allocation.plannedAmount),
        }))
      : [],
    linked_income_id: transaction.linked_income_id ?? undefined,
    linked_plan_id: transaction.linked_plan_id ?? undefined,
    linked_plan_type: transaction.linked_plan_type ?? undefined,
    matched_occurrence_date: transaction.matched_occurrence_date ?? undefined,
  };
}

export function splitTransactionRows(rows: any[]): {
  active: Transaction[];
  deleted: Transaction[];
} {
  const normalized = rows.map(normalizeTransactionRow);
  return {
    active: normalized.filter(isActiveTransaction),
    deleted: normalized
      .filter(isDeletedTransaction)
      .sort((left, right) =>
        String(right.deleted_at ?? "").localeCompare(
          String(left.deleted_at ?? ""),
        ),
      ),
  };
}

export function accountAwareTransactionCollections(
  rows: any[],
  accountIdentities: readonly ConnectedBankAccount[],
): {
  active: Transaction[];
  deleted: Transaction[];
  unknownPlaid: Transaction[];
} {
  const collections = splitTransactionRows(rows);
  const active = selectFlowLedgerTransactions(
    collections.active,
    accountIdentities,
  );
  const deleted = selectFlowLedgerTransactions(
    collections.deleted,
    accountIdentities,
  );
  return {
    active: active.included,
    deleted: deleted.included,
    unknownPlaid: [...active.unknownPlaid, ...deleted.unknownPlaid],
  };
}

export function checkingPendingBankRows(
  rows: PendingBankTransaction[],
  accountIdentities: readonly ConnectedBankAccount[],
): { included: PendingBankTransaction[]; unknownCount: number } {
  const included: PendingBankTransaction[] = [];
  let unknownCount = 0;
  rows.forEach((row) => {
    const kind = plaidTransactionAccountKind(
      { source: "plaid", plaid_account_id: row.plaid_account_id },
      accountIdentities,
    );
    if (kind === "checking") included.push(row);
    else if (kind === "unknown") unknownCount += 1;
  });
  return { included, unknownCount };
}

export function normalizePendingBankRows(
  rows: any[],
): PendingBankTransaction[] {
  return rows.map((row) => ({
    plaid_transaction_id: String(row.plaid_transaction_id),
    transaction_date: String(row.transaction_date).slice(0, 10),
    amount: Number(row.amount),
    name: String(row.name || row.merchant_name || "Pending transaction"),
    merchant_name: row.merchant_name || undefined,
    category: String(row.category || "Other"),
    plaid_account_id: row.plaid_account_id || undefined,
  }));
}

export function normalizePendingPlanMatchRow(row: any): PendingPlanMatch {
  return {
    id: String(row.id),
    pending_plaid_transaction_id: String(row.pending_plaid_transaction_id),
    pending_account_id: row.pending_account_id || undefined,
    target_type: row.target_type === "manual" ? "manual" : "bill",
    target_id: String(row.target_id),
    target_name: String(row.target_name || "Planned bill"),
    occurrence_date: String(row.occurrence_date).slice(0, 10),
    planned_amount: Number(row.planned_amount),
    pending_amount: Number(row.pending_amount),
    pending_transaction_date: String(row.pending_transaction_date).slice(0, 10),
    status: row.status,
    posted_transaction_id: row.posted_transaction_id || undefined,
    posted_plaid_transaction_id: row.posted_plaid_transaction_id || undefined,
    posted_amount:
      row.posted_amount == null ? undefined : Number(row.posted_amount),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export function normalizeConnectedBankRows(
  rows: any[],
): ConnectedBankAccount[] {
  return rows.map((account) => {
    const currentBalance = Number(account.current_balance);
    const currentBalanceAvailable =
      account.current_balance != null && Number.isFinite(currentBalance);
    return {
      ...account,
      // Existing account presentation expects a number, but forecasting must
      // distinguish an unavailable Plaid balance from a verified zero.
      current_balance: currentBalanceAvailable ? currentBalance : 0,
      current_balance_available: currentBalanceAvailable,
      available_balance:
        account.available_balance == null
          ? undefined
          : Number(account.available_balance),
      minimum_payment_amount:
        account.minimum_payment_amount == null
          ? undefined
          : Number(account.minimum_payment_amount),
      last_statement_balance:
        account.last_statement_balance == null
          ? undefined
          : Number(account.last_statement_balance),
      purchase_apr:
        account.purchase_apr == null ? undefined : Number(account.purchase_apr),
      is_active: account.is_active !== false,
    };
  });
}

export function normalizeAccountRow(account: any): Account {
  return {
    ...account,
    current_balance: Number(account.current_balance || 0),
    last_reconciled_at: account.last_reconciled_at ?? undefined,
    is_active: account.is_active !== false,
  };
}

export function normalizeMonthlyOverrideRow(override: any): MonthlyOverride {
  return {
    ...override,
    paid_amount: Number(override.paid_amount),
    custom_amount:
      override.custom_amount !== null
        ? Number(override.custom_amount)
        : undefined,
    planned_debt_amount:
      override.planned_debt_amount !== null &&
      override.planned_debt_amount !== undefined
        ? Number(override.planned_debt_amount)
        : undefined,
    required_debt_amount:
      override.required_debt_amount !== null &&
      override.required_debt_amount !== undefined
        ? Number(override.required_debt_amount)
        : undefined,
    custom_due_day:
      override.custom_due_day !== null
        ? Number(override.custom_due_day)
        : undefined,
    actual_amount:
      override.actual_amount !== null
        ? Number(override.actual_amount)
        : undefined,
    paid_date: override.paid_date ?? undefined,
  };
}

function genId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
