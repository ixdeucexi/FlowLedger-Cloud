import type { Bill } from "@/context/BudgetContext";
import { supabase } from "@/lib/supabase";

type JsonRecord = Record<string, unknown>;

function finiteMoney(value: number, label: string, allowZero: boolean) {
  if (
    !Number.isFinite(value) ||
    value > 1_000_000_000 ||
    (allowZero ? value < 0 : value <= 0)
  ) {
    throw new Error(`${label} must be a finite ${allowZero ? "non-negative" : "positive"} amount.`);
  }
}

function dateOnly(value: string, label: string) {
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00.000Z`)
    : null;
  if (
    !parsed ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new Error(`${label} must be a calendar date.`);
  }
}

function responseRecord(value: unknown, action: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${action} returned an invalid result.`);
  }
  return value as JsonRecord;
}

function requiredId(value: unknown, expected: string | undefined, action: string) {
  const id = typeof value === "string" ? value : "";
  if (!id || (expected && id !== expected)) {
    throw new Error(`${action} could not be verified.`);
  }
  return id;
}

export type ManualAccountMutationRecord = {
  id: string;
  name: string;
  // `credit_card` is a legacy public.accounts value. Current UI creation does
  // not offer it, but an existing row must remain renameable/reconcilable and
  // archivable without coercing it into a spendable account type.
  account_type: "checking" | "savings" | "cash" | "credit_card";
  current_balance: number;
  balance_as_of: string;
  last_reconciled_at?: string;
  is_active: boolean;
};

export type UpdateManualAccountIntent = {
  householdId: string;
  budgetId: string;
  expectedAccount: ManualAccountMutationRecord;
  account: ManualAccountMutationRecord;
  mutationId: string;
  balanceId: string;
  recordBalance: boolean;
};

function validateManualAccount(
  account: ManualAccountMutationRecord,
  label: string,
) {
  if (!account.id || !account.name.trim()) {
    throw new Error(`${label} is missing its identity or name.`);
  }
  if (!(["checking", "savings", "cash", "credit_card"] as const).includes(account.account_type)) {
    throw new Error(`${label} has an unsupported account type.`);
  }
  if (
    !Number.isFinite(account.current_balance)
    || Math.abs(account.current_balance) > 1_000_000_000
  ) {
    throw new Error(`${label} balance must be a finite amount.`);
  }
  dateOnly(account.balance_as_of, `${label} balance date`);
  if (
    account.last_reconciled_at != null
    && !Number.isFinite(Date.parse(account.last_reconciled_at))
  ) {
    throw new Error(`${label} reconciliation time is invalid.`);
  }
}

/**
 * Saves one manual-account intent through the database CAS. The caller must
 * retain `balanceId`, `expectedAccount`, and `account` for an interrupted
 * response retry; the RPC verifies an already-committed identical intent.
 */
export async function updateManualAccountWithAnchorAtomically(
  intent: UpdateManualAccountIntent,
) {
  if (!intent.householdId || !intent.budgetId) {
    throw new Error("Choose a household before updating an account.");
  }
  validateManualAccount(intent.expectedAccount, "Existing account");
  validateManualAccount(intent.account, "Updated account");
  if (intent.expectedAccount.id !== intent.account.id) {
    throw new Error("An account update cannot change the account id.");
  }
  if (
    (intent.expectedAccount.account_type === "credit_card"
      || intent.account.account_type === "credit_card")
    && intent.expectedAccount.account_type !== intent.account.account_type
  ) {
    throw new Error("A legacy credit-card account cannot be reclassified.");
  }
  if (!intent.mutationId) {
    throw new Error("Account updates require a stable mutation id.");
  }
  if (intent.recordBalance && !intent.balanceId) {
    throw new Error("Reconciliation history requires a stable id.");
  }
  const { data, error } = await supabase.rpc(
    "update_manual_account_with_anchor",
    {
      p_household_id: intent.householdId,
      p_budget_id: intent.budgetId,
      p_expected_account: intent.expectedAccount,
      p_account: intent.account,
      p_mutation_id: intent.mutationId,
      p_balance_id: intent.balanceId,
      p_record_balance: intent.recordBalance,
    },
  );
  if (error) throw new Error(error.message);
  const result = responseRecord(data, "Account update");
  const account = responseRecord(result.account, "Account update");
  requiredId(account.id, intent.account.id, "Account update");
  return {
    account,
    settings: responseRecord(result.settings, "Account update settings"),
    retry: result.retry === true,
  };
}

export type FundGoalIntent = {
  goalId: string;
  transactionId: string;
  amount: number;
  date: string;
  expectedCurrentAmount: number;
  accountId?: string | null;
};

export async function fundGoalAtomically(intent: FundGoalIntent) {
  finiteMoney(intent.amount, "Contribution", false);
  finiteMoney(intent.expectedCurrentAmount, "Goal balance", true);
  dateOnly(intent.date, "Contribution date");
  const { data, error } = await supabase.rpc("fund_goal", {
    p_goal_id: intent.goalId,
    p_transaction_id: intent.transactionId,
    p_amount: intent.amount,
    p_date: intent.date,
    p_expected_current_amount: intent.expectedCurrentAmount,
    p_account_id: intent.accountId ?? null,
  });
  if (error) throw new Error(error.message);
  const result = responseRecord(data, "Goal funding");
  const currentAmount = Number(result.current_amount);
  const appliedAmount = Number(result.applied_amount);
  if (!Number.isFinite(currentAmount) || !Number.isFinite(appliedAmount)) {
    throw new Error("Goal funding returned invalid amounts.");
  }
  return {
    goalId: requiredId(result.goal_id, intent.goalId, "Goal funding"),
    transactionId: requiredId(
      result.transaction_id,
      intent.transactionId,
      "Goal funding",
    ),
    currentAmount,
    appliedAmount,
    retry: result.retry === true,
  };
}

export type CreateSubscriptionBillIntent = {
  candidateId: string;
  billId: string;
  householdId: string;
  merchant: string;
  cadence: "weekly" | "monthly" | "annual" | "unknown";
  averageAmount: number;
  monthlyEquivalent: number;
  yearlyEquivalent: number;
  confidence: "low" | "medium" | "high";
  sourceTransactionIds: string[];
  amount: number;
  startDate: string;
  dueDay: number;
  frequency: "weekly" | "monthly";
};

export async function createSubscriptionBillAtomically(
  intent: CreateSubscriptionBillIntent,
) {
  finiteMoney(intent.amount, "Bill amount", false);
  finiteMoney(intent.averageAmount, "Average amount", true);
  finiteMoney(intent.monthlyEquivalent, "Monthly amount", true);
  finiteMoney(intent.yearlyEquivalent, "Yearly amount", true);
  dateOnly(intent.startDate, "Subscription start date");
  if (intent.dueDay < 1 || intent.dueDay > 28) {
    throw new Error("Subscription due day must be between 1 and 28.");
  }
  if (intent.sourceTransactionIds.length > 500) {
    throw new Error("Subscription has too many source transactions.");
  }
  const { data, error } = await supabase.rpc("create_subscription_bill", {
    p_candidate_id: intent.candidateId,
    p_bill_id: intent.billId,
    p_household_id: intent.householdId,
    p_merchant: intent.merchant,
    p_cadence: intent.cadence,
    p_average_amount: intent.averageAmount,
    p_monthly_equivalent: intent.monthlyEquivalent,
    p_yearly_equivalent: intent.yearlyEquivalent,
    p_confidence: intent.confidence,
    p_source_transaction_ids: intent.sourceTransactionIds,
    p_amount: intent.amount,
    p_start_date: intent.startDate,
    p_due_day: intent.dueDay,
    p_frequency: intent.frequency,
  });
  if (error) throw new Error(error.message);
  const result = responseRecord(data, "Subscription bill creation");
  return {
    candidateId: requiredId(
      result.candidate_id,
      intent.candidateId,
      "Subscription bill creation",
    ),
    billId: requiredId(
      result.bill_id,
      intent.billId,
      "Subscription bill creation",
    ),
    retry: result.retry === true,
  };
}

export async function createForgottenBillAndReconcile(
  transactionId: string,
  bill: Omit<Bill, "id" | "created_at">,
) {
  finiteMoney(bill.amount, "Bill amount", false);
  finiteMoney(bill.balance, "Bill balance", true);
  finiteMoney(bill.interest_rate, "Interest rate", true);
  if (bill.interest_rate > 1_000) {
    throw new Error("Interest rate is outside the supported range.");
  }
  if (bill.snowball_minimum_boost != null) {
    finiteMoney(bill.snowball_minimum_boost, "Snowball minimum boost", true);
  }
  const { data, error } = await supabase.rpc(
    "create_bill_and_reconcile_transaction",
    { p_transaction_id: transactionId, p_bill: bill },
  );
  if (error) throw new Error(error.message);
  const result = responseRecord(data, "Forgotten bill creation");
  return {
    billId: requiredId(result.bill_id, undefined, "Forgotten bill creation"),
    reconciliation: result.reconciliation,
    retry: result.retry === true,
  };
}

export type CompleteDecisionIntent = {
  decisionId: string;
  actualAmount: number;
  completedDate: string;
  accountId?: string | null;
  debtPlan?: JsonRecord | null;
};

export async function completeDecisionAtomically(
  intent: CompleteDecisionIntent,
) {
  finiteMoney(intent.actualAmount, "Actual amount", true);
  dateOnly(intent.completedDate, "Completion date");
  const { data, error } = await supabase.rpc("complete_decision", {
    p_decision_id: intent.decisionId,
    p_actual_amount: intent.actualAmount,
    p_completed_date: intent.completedDate,
    p_account_id: intent.accountId ?? null,
    p_debt_plan: intent.debtPlan ?? null,
  });
  if (error) throw new Error(error.message);
  const result = responseRecord(data, "Decision completion");
  return {
    decisionId: requiredId(
      result.decision_id,
      intent.decisionId,
      "Decision completion",
    ),
    appliedChange: responseRecord(
      result.applied_change,
      "Decision completion",
    ),
    retry: result.retry === true,
  };
}
