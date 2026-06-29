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

export function buildCategoryPlan(categories: string[], bills: CategoryPlanBill[], transactions: CategoryPlanTransaction[], budgets: CategoryBudgetLimit[] = []): CategoryPlanRow[] {
  const names = new Set(categories.length ? categories : ["Other"]);
  bills.forEach(bill => names.add(bill.category || "Other"));
  transactions.forEach(transaction => names.add(transaction.category || "Other"));
  budgets.forEach(budget => names.add(budget.category || "Other"));
  const budgetByCategory = new Map(budgets.map(budget => [budget.category || "Other", Math.max(0, Number(budget.amount) || 0)]));

  const rows = Array.from(names).map(category => {
    const billBudget = bills
      .filter(bill => (bill.category || "Other") === category)
      .reduce((sum, bill) => sum + Math.max(0, Number(bill.amount) || 0), 0);
    const budgeted = budgetByCategory.has(category) ? budgetByCategory.get(category)! : billBudget;
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
    .filter(row => row.budgeted > 0.005 || row.spent > 0.005)
    .sort((left, right) => {
      const pressure = statusWeight(right.status) - statusWeight(left.status);
      if (pressure) return pressure;
      return (right.spent + right.budgeted) - (left.spent + left.budgeted);
    });
}

function statusWeight(status: CategoryPlanRow["status"]) {
  if (status === "over") return 3;
  if (status === "watch") return 2;
  return 1;
}
