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
  const incomeCents = nonnegativeCents(plannedIncome);
  const assignedCents = rows.reduce((sum, row) => sum + nonnegativeCents(row.budgeted), 0);
  const spentCents = rows.reduce((sum, row) => sum + nonnegativeCents(row.spent), 0);
  const income = incomeCents / 100;
  const assigned = assignedCents / 100;
  const spent = spentCents / 100;
  const leftToAssign = (incomeCents - assignedCents) / 100;
  return {
    plannedIncome: income,
    assigned,
    spent,
    leftToAssign,
    status: leftToAssign === 0 ? "balanced" : leftToAssign > 0 ? "to_assign" : "overassigned",
  };
}

export function applyCategoryBudgetMove(
  currentBudgets: Record<string, number>,
  rows: CategoryPlanRow[],
  fromCategory: string,
  toCategory: string,
  amount: number,
): Record<string, number> {
  const transferCents = Math.round(amount * 100);
  if (!fromCategory || !toCategory || fromCategory === toCategory
    || !Number.isFinite(amount) || !Number.isSafeInteger(transferCents)
    || transferCents <= 0 || transferCents / 100 !== amount) {
    return { ...currentBudgets };
  }

  const fromRow = rows.find(row => row.category === fromCategory);
  const toRow = rows.find(row => row.category === toCategory);
  if (!fromRow || !toRow) return { ...currentBudgets };
  const fromBudget = Object.hasOwn(currentBudgets, fromCategory) ? currentBudgets[fromCategory]! : fromRow.budgeted;
  const toBudget = Object.hasOwn(currentBudgets, toCategory) ? currentBudgets[toCategory]! : toRow.budgeted;
  if (![fromBudget, toBudget, fromRow.spent].every(value => Number.isFinite(value) && value >= 0
    && Number.isSafeInteger(Math.round(value * 100)) && Math.round(value * 100) / 100 === value)) return { ...currentBudgets };
  const fromCents = nonnegativeCents(fromBudget);
  const toCents = nonnegativeCents(toBudget);
  if (transferCents > fromCents - nonnegativeCents(fromRow.spent)
    || !Number.isSafeInteger(toCents + transferCents)) return { ...currentBudgets };

  return {
    ...currentBudgets,
    [fromCategory]: (fromCents - transferCents) / 100,
    [toCategory]: (toCents + transferCents) / 100,
  };
}

/** Forecast links use zero-indexed months, with a bounded full year. */
export function categoryBudgetPeriod(month: unknown, year: unknown): { month: number; year: number } | null {
  if (typeof month !== "string" || !/^(?:[0-9]|1[01])$/.test(month)
    || typeof year !== "string" || !/^\d{4}$/.test(year)) return null;
  const parsedYear = Number(year);
  return parsedYear >= 2000 && parsedYear <= 2200 ? { month: Number(month), year: parsedYear } : null;
}

function nonnegativeCents(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  const cents = Math.round((value + Number.EPSILON) * 100);
  return Number.isSafeInteger(cents) ? cents : 0;
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
      .reduce((sum, transaction) => sum + nonnegativeCents(Math.abs(Number(transaction.amount))), 0) / 100;
    const percentUsed = budgeted > 0 ? Math.round((spent / budgeted) * 100) : spent > 0 ? 100 : 0;
    const remaining = roundCurrency(budgeted - spent);
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
