import { Platform } from "react-native";
import { supabase } from "@/lib/supabase";
import { assertFinancialMutationOnline } from "@/lib/networkStatus";
import { changedCategoryBudgets } from "@/lib/categoryBudgetRules";
import { remapCategoryBudgetMap } from "@/lib/categoryCatalog";
import {
  createExactCategoryBudgetMemoryCache,
  parseCategoryBudgetCache,
  resolveGuardedRemoteValue,
} from "@/lib/categoryBudgetLoadPolicy";

export const CATEGORY_BUDGETS_EVENT = "flowledger-category-budgets-updated";
const categoryBudgetListeners = new Set<() => void>();
const categoryBudgetCacheRevisions = new Map<string, number>();
const categoryBudgetMemoryCache = createExactCategoryBudgetMemoryCache();
const categoryRecurringMemory = new Map<string, string[]>();
const categoryCatalogListeners = new Set<(change: CategoryCatalogChange) => void>();

export interface CategoryBudgetScope {
  userId?: string | null;
  householdId?: string | null;
  budgetId?: string | null;
}

export interface CategoryCatalogChange {
  scope: CategoryBudgetScope;
  oldName: string;
  newName: string;
}

export function subscribeCategoryCatalog(listener: (change: CategoryCatalogChange) => void) {
  categoryCatalogListeners.add(listener);
  return () => { categoryCatalogListeners.delete(listener); };
}

/** Publish an already-committed rename/merge to every cached month in this scope. */
export function remapCategoryBudgetCaches(scope: CategoryBudgetScope, oldName: string, newName: string): void {
  const prefix = `flowledger-category-budgets-${scopeKey(scope)}-`;
  const keys = new Set([...categoryBudgetMemoryCache.keys(), ...categoryBudgetCacheRevisions.keys()]);
  if (Platform.OS === "web") {
    try {
      for (let index = 0; index < (globalThis.localStorage?.length ?? 0); index++) {
        const key = globalThis.localStorage.key(index);
        if (key) keys.add(key);
      }
    } catch { /* Memory and fresh remote loads remain authoritative. */ }
  }
  for (const key of keys) {
    if (!key.startsWith(prefix)) continue;
    categoryBudgetCacheRevisions.set(key, (categoryBudgetCacheRevisions.get(key) ?? 0) + 1);
    let values = categoryBudgetMemoryCache.read(key);
    if (!values && Platform.OS === "web") {
      try { values = parseCategoryBudgetCache(globalThis.localStorage?.getItem(key)); } catch { /* No confirmed cache. */ }
    }
    if (!values) continue;
    const next = remapCategoryBudgetMap(values, oldName, newName);
    categoryBudgetMemoryCache.write(key, next);
    if (Platform.OS === "web") {
      try { globalThis.localStorage?.setItem(key, JSON.stringify(next)); } catch { /* Keep confirmed memory value. */ }
    }
  }
  categoryCatalogListeners.forEach(listener => listener({ scope, oldName, newName }));
  categoryBudgetListeners.forEach(listener => listener());
  if (Platform.OS === "web") globalThis.dispatchEvent?.(new Event(CATEGORY_BUDGETS_EVENT));
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
    try { globalThis.localStorage?.setItem(storageKey, JSON.stringify(clean)); } catch { /* Confirmed memory still publishes when browser storage is unavailable. */ }
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
  recurringCategories?: string[];
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
  categoryBudgetCacheRevisions.set(storageKey, revisionAtStart);
  try {
    const result = await resolveGuardedRemoteValue({
      revisionAtStart,
      currentRevision: () => categoryBudgetCacheRevisions.get(storageKey) ?? 0,
      readCurrent: () => ({ budgets: readCategoryBudgetCache(month, year, scope), recurringCategories: categoryRecurringMemory.get(storageKey) ?? [] }),
      loadRemote: async () => {
        if (scope.householdId && scope.budgetId) {
          const { data, error } = await supabase.rpc("get_monthly_category_budget_plan", {
            p_household_id: scope.householdId, p_budget_id: scope.budgetId, p_month: month, p_year: year,
          });
          if (error) throw error;
          return parseMonthlyCategoryBudgetPlan(data);
        }
        const { data, error } = await applyScope(
          supabase.from("category_budgets").select("category, amount"), scope,
        ).eq("month", month).eq("year", year);
        if (error) throw error;
        const remote: Array<[string, number]> = [];
        (data ?? []).forEach((row: any) => {
          const category = String(row.category ?? "").trim();
          const amount = Number(row.amount);
          if (category && Number.isFinite(amount) && amount >= 0) remote.push([category, amount]);
        });
        return { budgets: Object.fromEntries(remote), recurringCategories: [] as string[] };
      },
      commitRemote: result => {
        categoryRecurringMemory.set(storageKey, result.recurringCategories);
        writeCategoryBudgetCache(month, year, result.budgets, scope, false);
      },
    });
    return {
      value: result.budgets,
      recurringCategories: result.recurringCategories,
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

export interface MonthlyCategoryBudgetPlan {
  budgets: Record<string, number>;
  recurringCategories: string[];
}

function parseMonthlyCategoryBudgetPlan(value: unknown): MonthlyCategoryBudgetPlan {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Could not confirm your saved category budgets.");
  const result = value as Record<string, unknown>;
  const budgets = parseCategoryBudgetCache(JSON.stringify(result.budgets));
  if (!budgets || !Array.isArray(result.recurringCategories) || result.recurringCategories.some(category => typeof category !== "string")) {
    throw new Error("Could not confirm your saved category budgets.");
  }
  return { budgets, recurringCategories: result.recurringCategories as string[] };
}

function invalidateFutureCategoryBudgets(scope: CategoryBudgetScope, month: number, year: number) {
  const prefix = `flowledger-category-budgets-${scopeKey(scope)}-`;
  const period = `${year}-${String(month + 1).padStart(2, "0")}`;
  const keys = new Set([...categoryBudgetMemoryCache.keys(), ...categoryBudgetCacheRevisions.keys()]);
  if (Platform.OS === "web") {
    try {
      for (let index = 0; index < (globalThis.localStorage?.length ?? 0); index++) {
        const key = globalThis.localStorage.key(index);
        if (key) keys.add(key);
      }
    } catch { /* Fresh remote loads remain authoritative. */ }
  }
  for (const key of keys) {
    if (!key.startsWith(prefix) || key.slice(prefix.length) < period) continue;
    categoryBudgetCacheRevisions.set(key, (categoryBudgetCacheRevisions.get(key) ?? 0) + 1);
    categoryBudgetMemoryCache.remove(key);
    categoryRecurringMemory.delete(key);
    if (Platform.OS === "web") {
      try { globalThis.localStorage?.removeItem(key); } catch { /* Keep memory invalidation. */ }
    }
  }
}

/** Apply only edited categories so another editor's unrelated changes survive. */
export async function saveMonthlyCategoryBudgetChanges(
  scope: CategoryBudgetScope, month: number, year: number,
  changes: Record<string, number | null>, repeat: boolean,
): Promise<MonthlyCategoryBudgetPlan> {
  if (!scope.userId || !scope.householdId || !scope.budgetId) {
    throw new Error("Sign in and select a household before saving monthly budgets.");
  }
  assertFinancialMutationOnline();
  const { data, error } = await supabase.rpc("save_monthly_category_budget_plan", {
    p_household_id: scope.householdId, p_budget_id: scope.budgetId,
    p_month: month, p_year: year, p_changes: changes, p_repeat: repeat,
  });
  if (error) throw new Error(`Save category budgets: ${error.message}`);
  const result = parseMonthlyCategoryBudgetPlan(data);
  if (repeat) invalidateFutureCategoryBudgets(scope, month, year);
  categoryRecurringMemory.set(categoryBudgetStorageKey(month, year, scope), result.recurringCategories);
  writeCategoryBudgetCache(month, year, result.budgets, scope);
  return result;
}

export async function saveCategoryBudgets(scope: CategoryBudgetScope, month: number, year: number, budgets: Record<string, number>, baseline?: Record<string, number>): Promise<Record<string, number>> {
  if (scope.userId) assertFinancialMutationOnline();
  const clean = normalizeBudgetMap(budgets);
  if (scope.userId && scope.householdId && scope.budgetId) {
    const previous = baseline ?? readCategoryBudgetCache(month, year, scope);
    const changes = changedCategoryBudgets(previous, clean);
    return (await saveMonthlyCategoryBudgetChanges(scope, month, year, changes, false)).budgets;
  }
  if (!scope.userId) {
    writeCategoryBudgetCache(month, year, clean, scope);
    return clean;
  }

  if (!Object.keys(clean).length) {
    const { error } = await applyScope(
      supabase.from("category_budgets").delete(),
      scope,
    ).eq("month", month).eq("year", year);
    if (error) throw new Error(`Clear category budgets: ${error.message}`);
    writeCategoryBudgetCache(month, year, clean, scope);
    return clean;
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
  return clean;
}

function applyScope(query: any, scope: CategoryBudgetScope) {
  if (scope.budgetId) return query.eq("budget_id", scope.budgetId);
  if (scope.householdId) return query.eq("household_id", scope.householdId);
  return query.eq("user_id", scope.userId);
}

function normalizeBudgetMap(value: Record<string, unknown>): Record<string, number> {
  const next: Array<[string, number]> = [];
  Object.entries(value).forEach(([category, amount]) => {
    const cleanCategory = String(category ?? "").trim();
    const cleanAmount = Number(amount);
    if (cleanCategory && Number.isFinite(cleanAmount) && cleanAmount >= 0) {
      next.push([cleanCategory, Math.round(cleanAmount * 100) / 100]);
    }
  });
  return Object.fromEntries(next);
}
