import { Platform } from "react-native";
import { supabase } from "@/lib/supabase";

export const CATEGORY_BUDGETS_EVENT = "flowledger-category-budgets-updated";

export function categoryBudgetStorageKey(month: number, year: number) {
  return `flowledger-category-budgets-${year}-${String(month + 1).padStart(2, "0")}`;
}

export function readCategoryBudgetCache(month: number, year: number): Record<string, number> {
  if (Platform.OS !== "web") return {};
  try {
    const raw = globalThis.localStorage?.getItem(categoryBudgetStorageKey(month, year));
    const parsed = raw ? JSON.parse(raw) as Record<string, unknown> : {};
    return normalizeBudgetMap(parsed);
  } catch {
    return {};
  }
}

export function writeCategoryBudgetCache(month: number, year: number, budgets: Record<string, number>) {
  if (Platform.OS !== "web") return;
  const clean = normalizeBudgetMap(budgets);
  const key = categoryBudgetStorageKey(month, year);
  if (Object.keys(clean).length) {
    globalThis.localStorage?.setItem(key, JSON.stringify(clean));
  } else {
    globalThis.localStorage?.removeItem(key);
  }
  globalThis.dispatchEvent?.(new Event(CATEGORY_BUDGETS_EVENT));
}

export async function loadCategoryBudgets(userId: string | undefined | null, month: number, year: number): Promise<Record<string, number>> {
  const cached = readCategoryBudgetCache(month, year);
  if (!userId) return cached;
  const { data, error } = await supabase
    .from("category_budgets")
    .select("category, amount")
    .eq("user_id", userId)
    .eq("month", month)
    .eq("year", year);
  if (error) return cached;
  const remote: Record<string, number> = {};
  (data ?? []).forEach(row => {
    const category = String(row.category ?? "").trim();
    const amount = Number(row.amount);
    if (category && Number.isFinite(amount) && amount >= 0) remote[category] = amount;
  });
  const merged = { ...cached, ...remote };
  if (Object.keys(cached).length) {
    void saveCategoryBudgets(userId, month, year, merged).catch(() => undefined);
  } else {
    writeCategoryBudgetCache(month, year, merged);
  }
  return merged;
}

export async function saveCategoryBudgets(userId: string | undefined | null, month: number, year: number, budgets: Record<string, number>): Promise<void> {
  const clean = normalizeBudgetMap(budgets);
  writeCategoryBudgetCache(month, year, clean);
  if (!userId) return;

  const { error: deleteError } = await supabase
    .from("category_budgets")
    .delete()
    .eq("user_id", userId)
    .eq("month", month)
    .eq("year", year);
  if (deleteError) throw new Error(`Clear category budgets: ${deleteError.message}`);

  const rows = Object.entries(clean).map(([category, amount]) => ({
    user_id: userId,
    category,
    amount,
    month,
    year,
    updated_at: new Date().toISOString(),
  }));
  if (!rows.length) return;
  const { error } = await supabase.from("category_budgets").insert(rows);
  if (error) throw new Error(`Save category budgets: ${error.message}`);
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
