import { type FinancialEvent } from "./forecast";
import { type AccountType } from "./accounts";
import { type DailyBalanceSource } from "./dailyCheckingClose";
import {
  type DecisionResult,
  type DecisionScenario,
  type DecisionType,
} from "./decisions";
import { type BillImportance } from "./billImportance";
import { type PendingPlanMatch } from "./pendingPlanMatches";

export interface Bill {
  id: string;
  name: string;
  amount: number;
  category: string;
  priority: number;
  is_debt: boolean;
  balance: number;
  interest_rate: number;
  due_day: number;
  day_of_week?: number;
  next_payment_date?: string;
  start_date?: string;
  end_date?: string;
  is_recurring: boolean;
  frequency: "monthly" | "quarterly" | "biweekly" | "weekly";
  created_at: string;
  smart_priority?: BillImportance;
  include_in_snowball?: boolean;
  snowball_minimum_boost?: number;
  last_reviewed_at?: string;
}

export interface MonthlyOverride {
  id: string;
  bill_id: string;
  month: number;
  year: number;
  custom_amount?: number;
  planned_debt_amount?: number;
  required_debt_amount?: number;
  custom_due_day?: number;
  paid_amount: number;
  actual_amount?: number;
  paid_date?: string;
}

export interface BillDateMove {
  id: string;
  bill_id: string;
  from_date: string;
  to_date: string;
  move_reason?: "manual" | "automatic";
  created_at: string;
  updated_at?: string;
}

export interface Transaction {
  id: string;
  date: string;
  amount: number;
  category: string;
  note: string;
  linked_bill_id?: string;
  account_id?: string;
  import_hash?: string;
  transfer_group_id?: string;
  debt_applied_amount?: number;
  debt_applied_bill_id?: string;
  source?: string;
  plaid_transaction_id?: string;
  plaid_account_id?: string;
  merchant_name?: string;
  pending?: boolean;
  removed_at?: string;
  deleted_at?: string;
  deleted_by?: string;
  match_confidence?: number;
  match_reason?: string;
  review_status?:
    | "needs_review"
    | "matched"
    | "categorized"
    | "transfer"
    | "legacy_reviewed";
  review_resolution?:
    | "bill"
    | "income"
    | "goal"
    | "decision"
    | "snowball"
    | "manual"
    | "category"
    | "transfer";
  review_allocations?: ReviewAllocation[];
  reviewed_at?: string;
  reviewed_by?: string;
  user_edited_at?: string;
  linked_income_id?: string;
  linked_plan_id?: string;
  linked_plan_type?: "goal" | "decision" | "snowball" | "transaction";
  matched_occurrence_date?: string;
}

export interface PendingBankTransaction {
  plaid_transaction_id: string;
  transaction_date: string;
  amount: number;
  name: string;
  merchant_name?: string;
  category: string;
  plaid_account_id?: string;
}

export interface ReviewAllocation {
  type:
    | "bill"
    | "income"
    | "planned_expense"
    | "category"
    | "transfer"
    | "extra_principal";
  targetId?: string | null;
  source?: "goal" | "decision" | "transaction";
  name?: string;
  category?: string | null;
  amount: number;
  plannedAmount?: number;
  occurrenceDate?: string;
  settlement?:
    | "exact"
    | "full"
    | "partial"
    | "split"
    | "extra_principal"
    | "regular";
}

export interface Account {
  id: string;
  name: string;
  account_type: AccountType;
  current_balance: number;
  balance_as_of: string;
  last_reconciled_at?: string;
  is_active: boolean;
  created_at: string;
}

export interface ConnectedBankAccount {
  id: string;
  plaid_account_id?: string;
  name: string;
  display_name?: string;
  official_name?: string;
  mask?: string;
  persistent_account_id?: string;
  account_type?: string;
  account_subtype?: string;
  current_balance: number;
  current_balance_available?: boolean;
  available_balance?: number;
  minimum_payment_amount?: number;
  next_payment_due_date?: string;
  last_statement_balance?: number;
  last_statement_issue_date?: string;
  is_overdue?: boolean;
  purchase_apr?: number;
  liability_last_synced_at?: string;
  is_active: boolean;
  updated_at?: string;
}

export interface IncomeAmountEntry {
  effective_from: string;
  amount: number;
}

export interface IncomeItem {
  id: string;
  name: string;
  amount: number;
  frequency: "monthly" | "biweekly" | "weekly";
  start_date?: string;
  next_payment_date?: string;
  amount_history?: IncomeAmountEntry[];
  excluded_dates?: string[];
  last_reviewed_at?: string;
}

export interface Goal {
  id: string;
  name: string;
  target_amount: number;
  target_date: string;
  current_amount: number;
  created_at: string;
  goal_type: "savings" | "planned_expense";
  calendar_marker_only?: boolean;
  closed_at?: string;
  closed_by?: string;
  archived_at?: string;
  archived_by?: string;
}

export interface DecisionRecord {
  id: string;
  name: string;
  decision_type: DecisionType;
  scenario: DecisionScenario;
  result: DecisionResult;
  status:
    | "saved"
    | "planned"
    | "completed"
    | "cancelled"
    | "reversed"
    | "calendar"
    | "applied";
  calendar_date?: string;
  applied_change?: Record<string, unknown>;
  actual_amount?: number;
  remind_at?: string;
  next_due_date?: string;
  completed_at?: string;
  created_at: string;
}

export interface SnowballAllocation {
  billId: string;
  billName: string;
  payment: number;
  balanceBefore: number;
  balanceAfter: number;
  paidOff: boolean;
  paymentDate?: string;
}

export interface SnowballFundingSource {
  type: "manual" | "bill_surplus" | "bucket_remainder";
  amount: number;
  billId?: string;
  billName?: string;
  reviewTransactionId?: string;
  bucketId?: string;
  bucketName?: string;
  availableDate?: string;
  pendingBalanceApply?: boolean;
}

export interface ExtraPayment {
  id: string;
  month: number;
  year: number;
  amount: number;
  allocations: SnowballAllocation[];
  payment_date?: string;
  sources?: SnowballFundingSource[];
}

export interface Settings {
  zeroBasedBudgetEnabled: boolean;
  debtPayoffEnabled: boolean;
  paymentMethod: "snowball" | "avalanche";
  starting_balance: number;
  starting_balance_date?: string;
  calendar_start_date?: string;
  safety_floor: number;
  forecast_horizon_months: number;
  onboarding_completed: boolean;
}

export interface CashFlow {
  monthlyIncome: number;
  totalBillsDue: number;
  totalPaid: number;
  netTransactions: number;
  goalAllocations: number;
  remaining: number;
}

export interface GoalExpense {
  id: string;
  name: string;
  amount: number;
}

export interface DailyBalance {
  day: number;
  income: number;
  scheduledIncome: number;
  expense: number;
  bills: number;
  goalExpenses: GoalExpense[];
  net: number;
  balance: number;
  balanceSource: DailyBalanceSource;
  balanceDate: string;
  balanceObservedAt?: string;
  balanceUnavailableReason?:
    | "history_loading"
    | "history_error"
    | "close_not_recorded";
  projectedInflow?: number;
  projectedOutflow?: number;
  events?: FinancialEvent[];
  projectionEvents?: FinancialEvent[];
}

export interface FinancialProjectionSnapshot {
  settings: Settings;
  bills: Bill[];
  overrides: MonthlyOverride[];
  billDateMoves: BillDateMove[];
  transactions: Transaction[];
  deletedTransactions: Transaction[];
  incomes: IncomeItem[];
  goals: Goal[];
  extraPayments: ExtraPayment[];
  decisions: DecisionRecord[];
  accounts: Account[];
  connectedBankAccounts: ConnectedBankAccount[];
  transactionAccountIdentities: ConnectedBankAccount[];
  pendingBankTransactions: PendingBankTransaction[];
  pendingPlanMatches: PendingPlanMatch[];
}
export interface FinancialProjectionOptions {
  now: Date;
  timeZone: string;
}
