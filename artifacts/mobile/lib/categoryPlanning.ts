export interface CategoryPlanBill {
  category: string;
  amount: number;
  is_debt?: boolean;
}

export interface CategoryPlanTransaction {
  category: string;
  amount: number;
}

export interface CategoryBudgetLimit {
  category: string;
  amount: number;
}

export interface CategoryPlanRow {
  category: string;
  budgeted: number;
  spent: number;
  remaining: number;
  status: "available" | "watch" | "over";
  percentUsed: number;
}

export interface ZeroBudgetSummary {
  plannedIncome: number;
  assigned: number;
  spent: number;
  leftToAssign: number;
  status: "balanced" | "to_assign" | "overassigned";
}

export function buildZeroBudgetSummary(plannedIncome: number, rows: CategoryPlanRow[]): ZeroBudgetSummary {
  const income = Math.max(0, roundCurrency(Number(plannedIncome) || 0));
  const assigned = roundCurrency(rows.reduce((sum, row) => sum + Math.max(0, Number(row.budgeted) || 0), 0));
  const spent = roundCurrency(rows.reduce((sum, row) => sum + Math.max(0, Number(row.spent) || 0), 0));
  const leftToAssign = roundCurrency(income - assigned);
  return {
    plannedIncome: income,
    assigned,
    spent,
    leftToAssign,
    status: Math.abs(leftToAssign) <= 0.01 ? "balanced" : leftToAssign > 0 ? "to_assign" : "overassigned",
  };
}

export function applyCategoryBudgetMove(
  currentBudgets: Record<string, number>,
  rows: CategoryPlanRow[],
  fromCategory: string,
  toCategory: string,
  amount: number,
): Record<string, number> {
  const transfer = Math.max(0, Number(amount) || 0);
  if (!fromCategory || !toCategory || fromCategory === toCategory || transfer <= 0) {
    return { ...currentBudgets };
  }

  const fromRow = rows.find(row => row.category === fromCategory);
  const toRow = rows.find(row => row.category === toCategory);
  const fromBudget = currentBudgets[fromCategory] ?? fromRow?.budgeted ?? 0;
  const toBudget = currentBudgets[toCategory] ?? toRow?.budgeted ?? 0;

  return {
    ...currentBudgets,
    [fromCategory]: Math.max(0, roundCurrency(fromBudget - transfer)),
    [toCategory]: roundCurrency(toBudget + transfer),
  };
}

export function buildCategoryPlan(
  categories: string[],
  bills: CategoryPlanBill[],
  transactions: CategoryPlanTransaction[],
  budgets: CategoryBudgetLimit[] = [],
): CategoryPlanRow[] {
  const explicitCategories = new Set((categories.length ? categories : ["Other"]).map(category => category || "Other"));
  const names = new Set(explicitCategories);
  bills.forEach(bill => names.add(bill.category || "Other"));
  transactions.forEach(transaction => names.add(transaction.category || "Other"));
  budgets.forEach(budget => names.add(budget.category || "Other"));
  const budgetByCategory = new Map(budgets.map(budget => [budget.category || "Other", Math.max(0, Number(budget.amount) || 0)]));

  const rows = Array.from(names).map(category => {
    const billBudget = bills
      .filter(bill => (bill.category || "Other") === category)
      .reduce((sum, bill) => sum + Math.max(0, Number(bill.amount) || 0), 0);
    const baseBudget = budgetByCategory.has(category) ? budgetByCategory.get(category)! : billBudget;
    const budgeted = Math.max(0, roundCurrency(baseBudget));
    const spent = transactions
      .filter(transaction => (transaction.category || "Other") === category && transaction.amount < 0)
      .reduce((sum, transaction) => sum + Math.abs(Number(transaction.amount) || 0), 0);
    const percentUsed = budgeted > 0 ? Math.round((spent / budgeted) * 100) : spent > 0 ? 100 : 0;
    const remaining = budgeted - spent;
    return {
      category,
      budgeted,
      spent,
      remaining,
      percentUsed,
      status: remaining < -0.005 ? "over" : percentUsed >= 85 ? "watch" : "available",
    } satisfies CategoryPlanRow;
  });

  return rows
    .filter(row => explicitCategories.has(row.category) || row.budgeted > 0.005 || row.spent > 0.005)
    .sort((left, right) => {
      const pressure = statusWeight(right.status) - statusWeight(left.status);
      if (pressure) return pressure;
      return (right.spent + right.budgeted) - (left.spent + left.budgeted);
    });
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

function statusWeight(status: CategoryPlanRow["status"]) {
  if (status === "over") return 3;
  if (status === "watch") return 2;
  return 1;
}
