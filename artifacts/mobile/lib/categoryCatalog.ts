/** Starter labels are seeded once; saved household categories are authoritative. */
export const DEFAULT_CATEGORIES = [
  "Housing", "Utilities", "Insurance", "Transportation", "Food",
  "Entertainment", "Health", "Education", "Savings", "Debt",
  "Shopping", "Rent", "Other",
];

export const PROTECTED_CATEGORIES = ["Savings", "Debt", "Other"];

export interface CategorySaveIntent {
  key: string;
  userId: string;
  householdId: string;
  budgetId: string | null;
  sourceName: string;
  action: "add" | "rename" | "delete";
}

export function categorySaveIntent(userId: string, householdId: string, budgetId: string | null | undefined, sourceName: string, action: CategorySaveIntent["action"]): CategorySaveIntent {
  const normalized = normalizeCategoryInput(sourceName).toLowerCase();
  return { key: JSON.stringify(["category", userId, householdId, budgetId ?? null, normalized]), userId, householdId, budgetId: budgetId ?? null, sourceName: normalized, action };
}

/** A successful authoritative catalog can settle a previously interrupted intent. */
export function categoryFailureIsResolved(failed: CategorySaveIntent, completed: CategorySaveIntent, savedCategories: readonly string[]): boolean {
  if (failed.userId !== completed.userId || failed.householdId !== completed.householdId || failed.budgetId !== completed.budgetId) return false;
  if (failed.key === completed.key) return true;
  const sourceStillExists = savedCategories.some(name => categoryMatches(name, failed.sourceName));
  return failed.action === "add" ? sourceStillExists : !sourceStillExists;
}

export function normalizeCategoryInput(name: string): string {
  return String(name ?? "").trim().replace(/\s+/g, " ");
}

export function categoryMatches(left: string, right: string): boolean {
  return normalizeCategoryInput(left).toLowerCase() === normalizeCategoryInput(right).toLowerCase();
}

export function protectedCategoryReason(name: string): string | null {
  if (categoryMatches(name, "Other")) return "Fallback for uncategorized items";
  if (categoryMatches(name, "Debt")) return "Used by debt payments";
  if (categoryMatches(name, "Savings")) return "Used by savings goals";
  if (categoryMatches(name, "Income")) return "Used by income transactions";
  if (categoryMatches(name, "Transfer")) return "Used by transfers";
  return null;
}

export function assertCategoryName(name: string): void {
  const clean = normalizeCategoryInput(name);
  if (!clean || clean.length > 80) throw new Error("Category names must be between 1 and 80 characters.");
  if (categoryMatches(clean, "Income") || categoryMatches(clean, "Transfer")) {
    throw new Error("Income and Transfer are reserved for money movement. Choose another category name.");
  }
}

export function assertCategoryEditable(name: string): void {
  const reason = protectedCategoryReason(name);
  if (reason) throw new Error(`${normalizeCategoryInput(name)} stays available. ${reason}.`);
}

export function fallbackCategoryList(values: string[]): string[] {
  const result: string[] = [];
  for (const value of [...values, ...PROTECTED_CATEGORIES]) {
    const clean = normalizeCategoryInput(value);
    if (!clean || result.some(existing => categoryMatches(existing, clean))) continue;
    result.push(PROTECTED_CATEGORIES.find(name => categoryMatches(name, clean)) ?? clean);
  }
  return result;
}

/** Remap labels only; allocation amounts, identities and review state stay intact. */
export function remapTransactionCategory<T extends {
  category: string;
  review_allocations?: Array<{ category?: string | null }>;
}>(transaction: T, oldName: string, newName: string): T {
  const category = categoryMatches(transaction.category, oldName) ? newName : transaction.category;
  let allocationChanged = false;
  const allocations = transaction.review_allocations?.map(allocation => {
    if (!allocation.category || !categoryMatches(allocation.category, oldName)) return allocation;
    allocationChanged = true;
    return { ...allocation, category: newName };
  });
  return category !== transaction.category || allocationChanged
    ? { ...transaction, category, ...(allocationChanged ? { review_allocations: allocations } : {}) }
    : transaction;
}

export function remapCategoryBudgetMap(values: Record<string, number>, oldName: string, newName: string): Record<string, number> {
  const next = new Map<string, number>();
  for (const [name, amount] of Object.entries(values)) {
    const target = categoryMatches(name, oldName) || categoryMatches(name, newName) ? newName : name;
    next.set(target, Math.round(((next.get(target) ?? 0) + amount) * 100) / 100);
  }
  return Object.fromEntries(next);
}

/** Keep invalid drafts visible for correction instead of silently discarding them. */
export function remapCategoryDrafts(values: Record<string, string>, oldName: string, newName: string): Record<string, string> {
  const next = new Map<string, string>();
  for (const [name, value] of Object.entries(values)) {
    const target = categoryMatches(name, oldName) || categoryMatches(name, newName) ? newName : name;
    if (!next.has(target)) next.set(target, value);
    else {
      const left = (next.get(target) ?? "").trim(), right = value.trim();
      const a = Number(left || 0), b = Number(right || 0);
      next.set(target, Number.isFinite(a) && Number.isFinite(b) && a >= 0 && b >= 0
        ? left || right ? String(Math.round((a + b) * 100) / 100) : ""
        : [left, right].filter(Boolean).join(" + "));
    }
  }
  return Object.fromEntries(next);
}
