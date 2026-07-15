import { Platform } from "react-native";
import { supabase } from "@/lib/supabase";

export const CATEGORY_BUDGETS_EVENT = "flowledger-category-budgets-updated";
const categoryBudgetListeners = new Set<() => void>();

export interface CategoryBudgetScope {
  userId?: string | null;
  householdId?: string | null;
  budgetId?: string | null;
}

function scopeKey(scope?: CategoryBudgetScope) {
  return scope?.budgetId || scope?.householdId || scope?.userId || "local";
}

export function categoryBudgetStorageKey(month: number, year: number, scope?: CategoryBudgetScope) {
  return `flowledger-category-budgets-${scopeKey(scope)}-${year}-${String(month + 1).padStart(2, "0")}`;
}

export function readCategoryBudgetCache(month: number, year: number, scope?: CategoryBudgetScope): Record<string, number> {
  if (Platform.OS !== "web") return {};
  try {
    const raw = globalThis.localStorage?.getItem(categoryBudgetStorageKey(month, year, scope));
    const parsed = raw ? JSON.parse(raw) as Record<string, unknown> : {};
    return normalizeBudgetMap(parsed);
  } catch {
    return {};
  }
}

export function writeCategoryBudgetCache(month: number, year: number, budgets: Record<string, number>, scope?: CategoryBudgetScope, notify = true) {
  const clean = normalizeBudgetMap(budgets);
  if (Platform.OS === "web") {
    const key = categoryBudgetStorageKey(month, year, scope);
    if (Object.keys(clean).length) globalThis.localStorage?.setItem(key, JSON.stringify(clean));
    else globalThis.localStorage?.removeItem(key);
    if (notify) globalThis.dispatchEvent?.(new Event(CATEGORY_BUDGETS_EVENT));
  }
  if (notify) categoryBudgetListeners.forEach(listener => listener());
}

export function subscribeCategoryBudgets(listener: () => void) {
  categoryBudgetListeners.add(listener);
  return () => categoryBudgetListeners.delete(listener);
}

export async function loadCategoryBudgets(scope: CategoryBudgetScope, month: number, year: number): Promise<Record<string, number>> {
  const cached = readCategoryBudgetCache(month, year, scope);
  if (!scope.userId) return cached;

  const query = applyScope(
    supabase.from("category_budgets").select("category, amount"),
    scope,
  ).eq("month", month).eq("year", year);
  const { data, error } = await query;
  if (error) return cached;

  const remote: Record<string, number> = {};
  (data ?? []).forEach((row: any) => {
    const category = String(row.category ?? "").trim();
    const amount = Number(row.amount);
    if (category && Number.isFinite(amount) && amount >= 0) remote[category] = amount;
  });
  const result = remote;
  writeCategoryBudgetCache(month, year, result, scope, false);
  return result;
}

export async function saveCategoryBudgets(scope: CategoryBudgetScope, month: number, year: number, budgets: Record<string, number>): Promise<void> {
  const clean = normalizeBudgetMap(budgets);
  writeCategoryBudgetCache(month, year, clean, scope, false);
  if (!scope.userId) {
    writeCategoryBudgetCache(month, year, clean, scope);
    return;
  }

  if (!Object.keys(clean).length) {
    const { error } = await applyScope(
      supabase.from("category_budgets").delete(),
      scope,
    ).eq("month", month).eq("year", year);
    if (error) throw new Error(`Clear category budgets: ${error.message}`);
    writeCategoryBudgetCache(month, year, clean, scope);
    return;
  }

  const rows = Object.entries(clean).map(([category, amount]) => ({
    user_id: scope.userId,
    household_id: scope.householdId ?? null,
    budget_id: scope.budgetId ?? null,
    category,
    amount,
    month,
    year,
    updated_at: new Date().toISOString(),
  }));
  const conflictKey = scope.budgetId ? "budget_id,category,month,year" : "user_id,category,month,year";
  const { error } = await supabase.from("category_budgets").upsert(rows, { onConflict: conflictKey });
  if (error) throw new Error(`Save category budgets: ${error.message}`);

  const existing = await applyScope(
    supabase.from("category_budgets").select("category"),
    scope,
  ).eq("month", month).eq("year", year);
  if (existing.error) throw new Error(`Check category budgets: ${existing.error.message}`);
  const savedCategories = new Set(Object.keys(clean));
  const removed = (existing.data ?? [])
    .map((row: any) => String(row.category ?? ""))
    .filter((category: string) => category && !savedCategories.has(category));
  if (removed.length) {
    const deleted = await applyScope(
      supabase.from("category_budgets").delete(),
      scope,
    ).eq("month", month).eq("year", year).in("category", removed);
    if (deleted.error) throw new Error(`Remove category budgets: ${deleted.error.message}`);
  }
  writeCategoryBudgetCache(month, year, clean, scope);
}

function applyScope(query: any, scope: CategoryBudgetScope) {
  if (scope.budgetId) return query.eq("budget_id", scope.budgetId);
  if (scope.householdId) return query.eq("household_id", scope.householdId);
  return query.eq("user_id", scope.userId);
}

function normalizeBudgetMap(value: Record<string, unknown>): Record<string, number> {
  const next: Record<string, number> = {};
  Object.entries(value).forEach(([category, amount]) => {
    const cleanCategory = String(category ?? "").trim();
    const cleanAmount = Number(amount);
    if (cleanCategory && Number.isFinite(cleanAmount) && cleanAmount >= 0) {
      next[cleanCategory] = Math.round(cleanAmount * 100) / 100;
    }
  });
  return next;
}
