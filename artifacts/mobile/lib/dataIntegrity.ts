import type { Account, Bill, IncomeItem, Transaction } from "@/context/BudgetContext";

export interface DataIntegrityIssue {
  severity: "error" | "warning" | "info";
  title: string;
  detail: string;
}

const dayMs = 86_400_000;

export function buildDataIntegrityIssues(input: {
  accounts: Account[];
  bills: Bill[];
  incomes: IncomeItem[];
  transactions: Transaction[];
  now?: Date;
}): DataIntegrityIssue[] {
  const now = input.now ?? new Date();
  const issues: DataIntegrityIssue[] = [];
  const activeAccounts = input.accounts.filter(account => account.is_active);

  if (!activeAccounts.length) {
    issues.push({
      severity: "warning",
      title: "No active account",
      detail: "Add a checking, savings, or cash account so forecasts start from a real balance.",
    });
  }

  const unlinkedTransactions = input.transactions.filter(transaction => !transaction.account_id);
  if (unlinkedTransactions.length) {
    issues.push({
      severity: "info",
      title: `${unlinkedTransactions.length} transaction${unlinkedTransactions.length === 1 ? "" : "s"} without an account`,
      detail: "Future edits can link each transaction to the account it came from.",
    });
  }

  const staleAccounts = activeAccounts.filter(account => {
    const reviewed = account.last_reconciled_at ?? account.balance_as_of;
    const age = Math.floor((now.getTime() - new Date(reviewed).getTime()) / dayMs);
    return Number.isFinite(age) && age > 30;
  });
  if (staleAccounts.length) {
    issues.push({
      severity: "warning",
      title: `${staleAccounts.length} account${staleAccounts.length === 1 ? "" : "s"} need review`,
      detail: "Reconcile accounts older than 30 days to keep the forecast trustworthy.",
    });
  }

  const invalidBills = input.bills.filter(bill => bill.amount < 0 || bill.due_day < 1 || bill.due_day > 31);
  if (invalidBills.length) {
    issues.push({
      severity: "error",
      title: `${invalidBills.length} bill${invalidBills.length === 1 ? "" : "s"} need cleanup`,
      detail: "Bill amounts should be positive and due days should be between 1 and 31.",
    });
  }

  const recurringKeys = new Set<string>();
  const duplicateBills = input.bills.filter(bill => {
    if (!bill.is_recurring || bill.is_debt) return false;
    const key = `${bill.name.trim().toLowerCase()}|${Number(bill.amount).toFixed(2)}|${bill.due_day}`;
    if (recurringKeys.has(key)) return true;
    recurringKeys.add(key);
    return false;
  });
  if (duplicateBills.length) {
    issues.push({
      severity: "info",
      title: "Possible duplicate recurring bills",
      detail: "Two or more recurring bills share the same name, amount, and due day.",
    });
  }

  if (!input.incomes.length) {
    issues.push({
      severity: "warning",
      title: "No income source",
      detail: "Add income so FlowLedger can answer affordability questions accurately.",
    });
  }

  return issues;
}
