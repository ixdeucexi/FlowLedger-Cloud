import { connectedCheckingBalance, type ForecastConfidence } from "./accounts";
import { buildAlgorithmSuite } from "./algorithmSuite";
import type { BillImportance } from "./billImportance";
import { isCashFlowTransaction, isCheckingBalanceTransaction } from "./billMatching";
import { buildCategoryPlan } from "./categoryPlanning";
import { dateOnlyToLocalDate } from "./dateLabels";
import { DEFAULT_DECISION_HUB_SETTINGS } from "./decisionHubSettings";
import {
  activePendingPlanMatches,
  type PendingPlanMatch,
} from "./pendingPlanMatches";
import { summarizePendingCheckingActivity } from "./plaidActivity";
import { transactionCategoryParts, type ReviewTransactionLike } from "./reviewCenter";
import { effectiveDebtMinimum } from "./snowball";

export interface DashboardAccount {
  id: string;
  name: string;
  account_type: "checking" | "savings" | "cash";
  current_balance: number;
  balance_as_of: string;
  last_reconciled_at?: string;
  is_active: boolean;
  created_at: string;
}

export interface DashboardConnectedBankAccount {
  id: string;
  plaid_account_id?: string;
  name: string;
  official_name?: string;
  mask?: string;
  persistent_account_id?: string;
  account_type?: string;
  account_subtype?: string;
  current_balance: number;
  available_balance?: number;
  is_active: boolean;
  updated_at?: string;
}

export interface DashboardPendingTransaction {
  plaid_transaction_id: string;
  transaction_date: string;
  amount: number;
  name: string;
  merchant_name?: string;
  category: string;
  plaid_account_id?: string;
}

export interface DashboardBill {
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

export interface DashboardTransaction extends ReviewTransactionLike {
  deleted_at?: string | null;
}

export interface DashboardIncome {
  id: string;
  name: string;
  amount: number;
  frequency: "monthly" | "biweekly" | "weekly";
}

export interface DashboardGoal {
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

export interface DashboardSettings {
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

export interface DashboardCashFlow {
  monthlyIncome: number;
  totalBillsDue: number;
  totalPaid: number;
  netTransactions: number;
  goalAllocations: number;
  remaining: number;
}

export interface DashboardDailyBalance {
  day: number;
  income: number;
  expense: number;
  bills: number;
  net: number;
  balance: number;
}

export interface DashboardFinancialModelInput {
  now: Date;
  selectedYear: number;
  settings: DashboardSettings;
  forecastConfidence: ForecastConfidence;
  accounts: DashboardAccount[];
  connectedBankAccounts: DashboardConnectedBankAccount[];
  pendingBankTransactions: DashboardPendingTransaction[];
  pendingPlanMatches: PendingPlanMatch[];
  categories: string[];
  categoryBudgets: Record<string, number>;
  goals: DashboardGoal[];
  incomes: DashboardIncome[];
  cashFlow: DashboardCashFlow;
  currentMonthBalances: DashboardDailyBalance[];
  getMonthlyBills: (month: number, year: number) => DashboardBill[];
  getMonthlyIncome: (month: number, year: number) => number;
  getTransactionsForMonth: (month: number, year: number) => DashboardTransaction[];
  getDailyBalances: (month: number, year: number) => DashboardDailyBalance[];
  getBillMonthlyTotal: (bill: DashboardBill, month: number, year: number) => number;
  getPaidAmount: (billId: string, month: number, year: number) => number;
  getBillOccurrencesInMonth: (bill: DashboardBill, month: number, year: number) => number[];
}

function localDateLabel(date: string): string {
  const parsed = dateOnlyToLocalDate(date);
  if (!parsed) return date;
  return parsed.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * The single financial projection used by both dashboard presentations.
 * Desktop and mobile may render these values differently, but neither view
 * should calculate its own version of a balance, score, budget, or forecast.
 */
export function buildDashboardFinancialModel(input: DashboardFinancialModelInput) {
  const {
    now,
    selectedYear,
    settings,
    forecastConfidence,
    accounts,
    connectedBankAccounts,
    pendingBankTransactions,
    pendingPlanMatches,
    categories,
    categoryBudgets,
    goals,
    incomes,
    cashFlow,
    currentMonthBalances,
    getMonthlyBills,
    getMonthlyIncome,
    getTransactionsForMonth,
    getDailyBalances,
    getBillMonthlyTotal,
    getPaidAmount,
    getBillOccurrencesInMonth,
  } = input;

  const currentMonth = now.getMonth();
  const today = now.getDate();
  const todayIso = `${now.getFullYear()}-${String(currentMonth + 1).padStart(2, "0")}-${String(today).padStart(2, "0")}`;
  const monthlyBills = getMonthlyBills(currentMonth, selectedYear);
  const monthTransactions = getTransactionsForMonth(currentMonth, selectedYear);

  const categoryPlan = settings.zeroBasedBudgetEnabled
    ? buildCategoryPlan(
        categories,
        monthlyBills.map((bill) => ({
          category: bill.is_debt ? "Debt" : bill.category || "Other",
          amount: getBillMonthlyTotal(bill, currentMonth, selectedYear),
        })),
        monthTransactions
          .flatMap((transaction) => transactionCategoryParts(transaction))
          .filter((transaction) => transaction.category !== "Income"),
        Object.entries(categoryBudgets).map(([category, amount]) => ({ category, amount })),
      )
    : [];

  const currentGoals = goals
    .filter((goal) => !goal.closed_at)
    .sort((left, right) => {
      const leftComplete = left.target_amount > 0 && left.current_amount >= left.target_amount;
      const rightComplete = right.target_amount > 0 && right.current_amount >= right.target_amount;
      if (leftComplete !== rightComplete) return leftComplete ? 1 : -1;
      return left.target_date.localeCompare(right.target_date) || left.name.localeCompare(right.name);
    });

  const connectedCheckingAccounts = connectedBankAccounts.filter(
    (account) => account.is_active && account.account_subtype === "checking",
  );
  const connectedSavingsAccounts = connectedBankAccounts.filter(
    (account) => account.is_active && account.account_subtype === "savings",
  );
  const connectedBalance = connectedCheckingBalance(connectedCheckingAccounts);
  const checkingAccountBalance = connectedBalance ?? accounts
    .filter((account) => account.is_active && account.account_type === "checking")
    .reduce((sum, account) => sum + account.current_balance, 0);
  const savingsAccountBalance = connectedSavingsAccounts.length
    ? connectedSavingsAccounts.reduce((sum, account) => sum + account.current_balance, 0)
    : accounts
        .filter((account) => account.is_active && account.account_type === "savings")
        .reduce((sum, account) => sum + account.current_balance, 0);

  const checkingIds = new Set(connectedCheckingAccounts.map((account) => account.id));
  const checkingPendingTransactions = pendingBankTransactions.filter((transaction) =>
    transaction.plaid_account_id
      ? checkingIds.has(transaction.plaid_account_id)
      : connectedCheckingAccounts.length === 1,
  );
  const pendingCheckingSummary = summarizePendingCheckingActivity(
    checkingPendingTransactions,
    connectedCheckingAccounts,
  );
  const activePendingMatches = activePendingPlanMatches(
    pendingPlanMatches,
    pendingBankTransactions,
  );
  const activePendingMatchIds = new Set(
    activePendingMatches.map((match) => match.pending_plaid_transaction_id),
  );

  const decisionForecastDays: Array<{ date: string; balance: number; income: number }> = [];
  for (let index = 0; index < Math.max(2, settings.forecast_horizon_months); index += 1) {
    const month = (currentMonth + index) % 12;
    const year = selectedYear + Math.floor((currentMonth + index) / 12);
    const prefix = `${year}-${String(month + 1).padStart(2, "0")}`;
    decisionForecastDays.push(
      ...getDailyBalances(month, year).map((day) => ({
        date: `${prefix}-${String(day.day).padStart(2, "0")}`,
        balance: day.balance,
        income: day.income,
      })),
    );
  }
  const futureForecastDays = decisionForecastDays.filter((day) => day.date >= todayIso);
  const nextPaycheck = futureForecastDays.find(
    (day) => day.date > todayIso && day.income > 0.005,
  );
  const nextPaycheckForecast = nextPaycheck
    ? {
        label: localDateLabel(nextPaycheck.date),
        lowestBalance: futureForecastDays
          .filter((day) => day.date <= nextPaycheck.date)
          .reduce(
            (lowest, day) => Math.min(lowest, day.balance),
            futureForecastDays[0]?.balance ?? nextPaycheck.balance,
          ),
      }
    : null;

  const algorithmSuite = buildAlgorithmSuite({
    month: currentMonth,
    year: selectedYear,
    todayDay: today,
    safetyFloor: settings.safety_floor,
    cashFlow,
    dailyBalances: currentMonthBalances.map((day) => ({
      day: day.day,
      income: day.income,
      bills: day.bills,
      expense: day.expense,
      net: day.net,
      balance: day.balance,
    })),
    nextPaycheckForecast,
    bills: monthlyBills.map((bill) => ({
      id: bill.id,
      name: bill.name,
      amount: getBillMonthlyTotal(bill, currentMonth, selectedYear),
      monthlyMinimum: bill.is_debt
        ? effectiveDebtMinimum(bill.amount, Number(bill.snowball_minimum_boost ?? 0))
        : undefined,
      frequency: bill.frequency,
      paidAmount: getPaidAmount(bill.id, currentMonth, selectedYear),
      occurrenceDays: getBillOccurrencesInMonth(bill, currentMonth, selectedYear),
      pendingDays: activePendingMatches
        .filter(
          (match) => match.target_id === bill.id
            && match.occurrence_date.startsWith(
              `${selectedYear}-${String(currentMonth + 1).padStart(2, "0")}-`,
            ),
        )
        .map((match) => Number(match.occurrence_date.slice(8, 10)))
        .filter(Number.isFinite),
      importance: bill.smart_priority,
      category: bill.category || "Other",
      due_day: bill.due_day,
      is_debt: bill.is_debt,
      is_recurring: bill.is_recurring,
      includeInSnowball: bill.include_in_snowball !== false,
      balance: bill.balance,
      interest_rate: bill.interest_rate,
    })),
    transactions: monthTransactions
      .filter(transaction => isCashFlowTransaction(transaction) && (
        transaction.amount < 0
        || isCheckingBalanceTransaction(transaction, connectedBankAccounts)
      ))
      .flatMap((transaction) => {
        const parts = transactionCategoryParts(transaction);
        if (parts.length === 0) {
          return transaction.amount > 0
            ? [{
                id: transaction.id,
                date: transaction.date,
                amount: transaction.amount,
                category: "Income",
                note: transaction.note,
              }]
            : [];
        }
        return parts.map((part, index) => ({
          id: `${transaction.id}:${index}`,
          date: transaction.date,
          amount: part.amount,
          category: part.category,
          note: part.label,
        }));
      }),
    incomes: incomes.map((income) => ({
      id: income.id,
      name: income.name,
      amount: income.amount,
      frequency: income.frequency,
    })),
    goals: goals.map((goal) => ({
      id: goal.id,
      name: goal.name,
      target_amount: goal.target_amount,
      current_amount: goal.current_amount,
      target_date: goal.target_date,
      goal_type: goal.goal_type,
    })),
    categoryPlan,
    forecastConfidence,
    settings: DEFAULT_DECISION_HUB_SETTINGS,
  });

  const goalTotals = currentGoals.reduce(
    (total, goal) => ({
      current: total.current + Math.max(0, goal.current_amount),
      target: total.target + Math.max(0, goal.target_amount),
    }),
    { current: 0, target: 0 },
  );
  const goalPercent = goalTotals.target > 0
    ? Math.min(100, (goalTotals.current / goalTotals.target) * 100)
    : 0;
  const unpaidTotal = monthlyBills.reduce(
    (sum, bill) => sum + Math.max(
      0,
      getBillMonthlyTotal(bill, currentMonth, selectedYear)
        - getPaidAmount(bill.id, currentMonth, selectedYear),
    ),
    0,
  );
  const unpaidCount = monthlyBills.filter(
    (bill) => getPaidAmount(bill.id, currentMonth, selectedYear) + 0.005
      < getBillMonthlyTotal(bill, currentMonth, selectedYear),
  ).length;

  return {
    currentMonth,
    today,
    todayIso,
    cashFlow,
    currentMonthBalances,
    monthlyBills,
    monthTransactions,
    categoryPlan,
    currentGoals,
    connectedCheckingAccounts,
    connectedSavingsAccounts,
    checkingAccountBalance,
    savingsAccountBalance,
    checkingPendingTransactions,
    pendingCheckingSummary,
    activePendingMatches,
    activePendingMatchIds,
    decisionForecastDays: futureForecastDays,
    nextPaycheckForecast,
    algorithmSuite,
    goalTotals,
    goalPercent,
    unpaidTotal,
    unpaidCount,
    monthlyIncome: getMonthlyIncome(currentMonth, selectedYear),
    activeAccountCount: connectedBankAccounts.filter((account) => account.is_active).length
      || accounts.filter((account) => account.is_active).length,
  };
}

export type DashboardFinancialModel = ReturnType<typeof buildDashboardFinancialModel>;
