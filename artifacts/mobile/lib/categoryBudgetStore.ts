import { Platform } from "react-native";
import { supabase } from "@/lib/supabase";
import { assertFinancialMutationOnline } from "@/lib/networkStatus";
import {
  createExactCategoryBudgetMemoryCache,
  parseCategoryBudgetCache,
  resolveGuardedRemoteValue,
} from "@/lib/categoryBudgetLoadPolicy";

export const CATEGORY_BUDGETS_EVENT = "flowledger-category-budgets-updated";
const categoryBudgetListeners = new Set<() => void>();
const categoryBudgetCacheRevisions = new Map<string, number>();
const categoryBudgetMemoryCache = createExactCategoryBudgetMemoryCache();

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
  const key = categoryBudgetStorageKey(month, year, scope);
  const memory = categoryBudgetMemoryCache.read(key);
  if (memory) return memory;
  if (Platform.OS !== "web") return {};
  try {
    const parsed = parseCategoryBudgetCache(globalThis.localStorage?.getItem(key));
    if (parsed) categoryBudgetMemoryCache.write(key, parsed);
    return parsed ?? {};
  } catch {
    return {};
  }
}

export function hasCategoryBudgetCache(month: number, year: number, scope?: CategoryBudgetScope): boolean {
  const key = categoryBudgetStorageKey(month, year, scope);
  if (categoryBudgetMemoryCache.has(key)) return true;
  if (Platform.OS !== "web") return false;
  try {
    const value = parseCategoryBudgetCache(
      globalThis.localStorage?.getItem(key) ?? null,
    );
    if (value) categoryBudgetMemoryCache.write(key, value);
    return value !== null;
  } catch {
    return false;
  }
}

export function writeCategoryBudgetCache(month: number, year: number, budgets: Record<string, number>, scope?: CategoryBudgetScope, notify = true) {
  const clean = normalizeBudgetMap(budgets);
  const storageKey = categoryBudgetStorageKey(month, year, scope);
  categoryBudgetMemoryCache.write(storageKey, clean);
  categoryBudgetCacheRevisions.set(
    storageKey,
    (categoryBudgetCacheRevisions.get(storageKey) ?? 0) + 1,
  );
  if (Platform.OS === "web") {
    globalThis.localStorage?.setItem(storageKey, JSON.stringify(clean));
    if (notify) globalThis.dispatchEvent?.(new Event(CATEGORY_BUDGETS_EVENT));
  }
  if (notify) categoryBudgetListeners.forEach(listener => listener());
}

export function subscribeCategoryBudgets(listener: () => void) {
  categoryBudgetListeners.add(listener);
  return () => categoryBudgetListeners.delete(listener);
}

export interface CategoryBudgetLoadResult {
  value: Record<string, number>;
  exact: boolean;
  error: string | null;
}

export async function loadCategoryBudgetsExact(scope: CategoryBudgetScope, month: number, year: number): Promise<CategoryBudgetLoadResult> {
  const cached = readCategoryBudgetCache(month, year, scope);
  if (!scope.userId) return {
    value: cached,
    exact: hasCategoryBudgetCache(month, year, scope),
    error: null,
  };
  const storageKey = categoryBudgetStorageKey(month, year, scope);
  const revisionAtStart = categoryBudgetCacheRevisions.get(storageKey) ?? 0;
  try {
    const value = await resolveGuardedRemoteValue({
      revisionAtStart,
      currentRevision: () => categoryBudgetCacheRevisions.get(storageKey) ?? 0,
      readCurrent: () => readCategoryBudgetCache(month, year, scope),
      loadRemote: async () => {
        const query = applyScope(
          supabase.from("category_budgets").select("category, amount"),
          scope,
        ).eq("month", month).eq("year", year);
        const { data, error } = await query;
        if (error) throw error;
        const remote: Record<string, number> = {};
        (data ?? []).forEach((row: any) => {
          const category = String(row.category ?? "").trim();
          const amount = Number(row.amount);
          if (category && Number.isFinite(amount) && amount >= 0) remote[category] = amount;
        });
        return remote;
      },
      commitRemote: value => {
        writeCategoryBudgetCache(month, year, value, scope, false);
      },
    });
    return {
      value,
      exact: hasCategoryBudgetCache(month, year, scope),
      error: null,
    };
  } catch (error) {
    return {
      value: readCategoryBudgetCache(month, year, scope),
      exact: hasCategoryBudgetCache(month, year, scope),
      error: error instanceof Error ? error.message : "Category plan unavailable.",
    };
  }
}

export async function loadCategoryBudgets(scope: CategoryBudgetScope, month: number, year: number): Promise<Record<string, number>> {
  return (await loadCategoryBudgetsExact(scope, month, year)).value;
}

export async function saveCategoryBudgets(scope: CategoryBudgetScope, month: number, year: number, budgets: Record<string, number>): Promise<void> {
  if (scope.userId) assertFinancialMutationOnline();
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
