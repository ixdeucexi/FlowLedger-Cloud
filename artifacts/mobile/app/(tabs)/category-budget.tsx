import { PrivacyPressable as Pressable, PrivacyText as Text, PrivacyTextInput as TextInput, PrivacyView as View } from "@/components/privacy/PrivacyPrimitives";
import Feather from "@expo/vector-icons/Feather";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Keyboard, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PremiumBackdrop } from "@/components/PremiumBackdrop";
import { DataFreshnessLabel } from "@/components/DataFreshnessLabel";
import { PlanViewSelector } from "@/components/PlanViewSelector";
import { useAuth } from "@/context/AuthContext";
import { useBudget } from "@/context/BudgetContext";
import { useColors } from "@/hooks/useColors";
import { useBackDismiss } from "@/hooks/useBackDismiss";
import { useDesktopExperience } from "@/hooks/useDesktopExperience";
import { isBillEligibleForUpcomingPlan } from "@/lib/billEligibility";
import { buildCategoryPlan, buildZeroBudgetSummary, categoryBudgetPeriod, type CategoryPlanRow } from "@/lib/categoryPlanning";
import { loadCategoryBudgetsExact, readCategoryBudgetCache, saveMonthlyCategoryBudgetChanges, subscribeCategoryBudgets, subscribeCategoryCatalog } from "@/lib/categoryBudgetStore";
import { categoryMatches, normalizeCategoryInput, remapCategoryBudgetMap, remapCategoryDrafts } from "@/lib/categoryCatalog";
import { applyCategoryBudgetChanges, buildCategoryBudgetMoveDraft, buildCategoryBudgetRestartDraft, changedCategoryBudgets, isSpendingBudgetCategory, parseCategoryBudgetChanges, type CategoryBudgetMoveSource } from "@/lib/categoryBudgetRules";
import { buildReviewQueue, transactionCategoryParts } from "@/lib/reviewCenter";
import { unmatchedPendingTransactions } from "@/lib/pendingPlanMatches";
import { assertFinancialMutationOnline } from "@/lib/networkStatus";
import { useLocalDay } from "@/hooks/useLocalDay";
import { parseMoneyInput } from "@/lib/moneyFormInput";
import { confirmAction, type ConfirmActionOptions } from "@/lib/confirmAction";

const MONTH_FULL = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const CAT_COLORS: Record<string, string> = {
  Housing: "#0f9b8e", Utilities: "#f0b429", Insurance: "#6366f1",
  Transportation: "#ec4899", Food: "#f97316", Groceries: "#f97316", Restaurant: "#ea580c", Entertainment: "#8b5cf6",
  Health: "#ef4444", Education: "#3b82f6", Savings: "#22c55e", Debt: "#e11d48", Other: "#94a3b8",
};

type Filter = "all" | "over" | "watch" | "available";

interface CategoryBudgetScreenProps {
  embedded?: boolean;
  requestedPeriod?: { month: number; year: number } | null;
}

export function CategoryBudgetScreen({ embedded = false, requestedPeriod }: CategoryBudgetScreenProps) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const isDesktop = useDesktopExperience();
  const router = useRouter();
  const { user } = useAuth();
  const {
    categories,
    categoriesReady,
    getMonthlyBills,
    getBillMonthlyTotal,
    getMonthlyIncome,
    getTransactionsForMonth,
    transactions,
    pendingBankTransactions,
    pendingPlanMatches,
    selectedYear,
    settings,
    activeHousehold,
    canEditHousehold,
  } = useBudget();
  const now = new Date();
  const localDay = useLocalDay();
  const [month, setMonth] = useState(requestedPeriod?.month ?? now.getMonth());
  const [year, setYear] = useState(requestedPeriod?.year ?? (selectedYear || now.getFullYear()));
  const [filter, setFilter] = useState<Filter>("all");
  const [categoryBudgets, setCategoryBudgets] = useState<Record<string, number>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [repeatChanges, setRepeatChanges] = useState(!settings.zeroBasedBudgetEnabled);
  const [saveMessage, setSaveMessage] = useState("");
  const [loadReady, setLoadReady] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [budgetConflict, setBudgetConflict] = useState(false);
  const busyRef = useRef(false);
  const dirtyRef = useRef(new Set<string>());
  const scopeVersion = useRef(0);
  const loadedScopeKeyRef = useRef<string | null>(null);
  const [moveTarget, setMoveTarget] = useState<CategoryPlanRow | null>(null);
  const [moveSource, setMoveSource] = useState<CategoryBudgetMoveSource | null>(null);
  const [moveAmount, setMoveAmount] = useState("");
  const [moveError, setMoveError] = useState("");
  const moveScopeRef = useRef<{ key: string; version: number } | null>(null);
  const categoryInputs = useRef(new Map<string, React.ElementRef<typeof TextInput>>());
  useBackDismiss(!!moveTarget, () => setMoveTarget(null));
  const editableCategories = useMemo(() => categories.filter(isSpendingBudgetCategory), [categories]);
  const editableCategoryKeys = useMemo(() => new Set(editableCategories.map(category => normalizeCategoryInput(category).toLowerCase())), [editableCategories]);
  const canEditCategory = (category: string) => editableCategoryKeys.has(normalizeCategoryInput(category).toLowerCase());
  const budgetScope = useMemo(() => ({
    userId: user?.id,
    householdId: activeHousehold?.householdId,
    budgetId: activeHousehold?.budgetId,
  }), [activeHousehold?.budgetId, activeHousehold?.householdId, user?.id]);
  const currentScopeKey = `${budgetScope.userId ?? "local"}/${budgetScope.householdId ?? ""}/${budgetScope.budgetId ?? ""}/${year}/${month}`;
  const activeScopeKeyRef = useRef(currentScopeKey);
  activeScopeKeyRef.current = currentScopeKey;
  const categoryBudgetsRef = useRef(categoryBudgets);
  categoryBudgetsRef.current = categoryBudgets;
  const restartAllowed = settings.zeroBasedBudgetEnabled && canEditHousehold && categoriesReady && loadReady
    && loadedScopeKeyRef.current === currentScopeKey && !saving && !budgetConflict;
  const restartAllowedRef = useRef(restartAllowed);
  restartAllowedRef.current = restartAllowed;
  const editingAllowedRef = useRef(false);
  editingAllowedRef.current = canEditHousehold && categoriesReady && loadReady
    && loadedScopeKeyRef.current === currentScopeKey && !saving && !budgetConflict;
  const refreshBudgetsRef = useRef<() => void>(() => {});
  const requestedPeriodKey = requestedPeriod ? `${requestedPeriod.year}/${requestedPeriod.month}` : "";
  const lastRequestedPeriodKey = useRef(requestedPeriodKey);
  const confirmBudgetAction = useCallback((options: ConfirmActionOptions) => {
    const key = currentScopeKey;
    const version = scopeVersion.current;
    confirmAction({ ...options, onConfirm: () => {
      if (activeScopeKeyRef.current !== key || scopeVersion.current !== version || busyRef.current) return;
      return options.onConfirm();
    } });
  }, [currentScopeKey]);

  useEffect(() => { setRepeatChanges(!settings.zeroBasedBudgetEnabled); }, [settings.zeroBasedBudgetEnabled]);

  useEffect(() => {
    if (!requestedPeriod || requestedPeriodKey === lastRequestedPeriodKey.current) return;
    const change = () => {
      dirtyRef.current.clear();
      lastRequestedPeriodKey.current = requestedPeriodKey;
      setMonth(requestedPeriod.month); setYear(requestedPeriod.year);
      router.setParams({ budgetMonth: String(requestedPeriod.month), budgetYear: String(requestedPeriod.year) } as never);
    };
    if (dirtyRef.current.size) {
      // Keep the displayed month and URL together when the user cancels.
      lastRequestedPeriodKey.current = `${year}/${month}`;
      router.setParams({ budgetMonth: String(month), budgetYear: String(year) } as never);
      confirmBudgetAction({ title: "Unsaved budgets", message: "Discard your unsaved changes and open the selected month?", cancelText: "Keep editing", confirmText: "Discard", destructive: true, onConfirm: change });
    } else change();
  }, [requestedPeriodKey, requestedPeriod, confirmBudgetAction, month, year, router]);

  useEffect(() => {
    let cancelled = false;
    scopeVersion.current += 1;
    const version = scopeVersion.current;
    const key = currentScopeKey;
    loadedScopeKeyRef.current = null;
    dirtyRef.current.clear();
    setDrafts({});
    setSaveMessage("");
    setMoveTarget(null);
    setLoadReady(false);
    setLoadError("");
    setBudgetConflict(false);
    setCategoryBudgets(readCategoryBudgetCache(month, year, budgetScope));
    void loadCategoryBudgetsExact(budgetScope, month, year).then(result => {
      if (cancelled || version !== scopeVersion.current || activeScopeKeyRef.current !== key) return;
      loadedScopeKeyRef.current = !result.error && (!budgetScope.userId || result.exact) ? key : null;
      setCategoryBudgets(result.value);
      setLoadReady(!result.error && (!budgetScope.userId || result.exact));
      setLoadError(result.error ?? "");
    });
    return () => { cancelled = true; scopeVersion.current += 1; };
  }, [budgetScope, currentScopeKey, month, year, loadAttempt]);

  useEffect(() => {
    let active = true;
    let request = 0;
    const key = currentScopeKey;
    const refresh = () => {
      if (busyRef.current) return;
      const currentRequest = ++request;
      void loadCategoryBudgetsExact(budgetScope, month, year).then(result => {
        if (!active || currentRequest !== request || activeScopeKeyRef.current !== key) return;
        if (result.error) { loadedScopeKeyRef.current = null; setLoadError(result.error); setLoadReady(false); return; }
        loadedScopeKeyRef.current = !budgetScope.userId || result.exact ? key : null;
        setLoadReady(!budgetScope.userId || result.exact);
        setLoadError("");
        if (dirtyRef.current.size && Object.keys(changedCategoryBudgets(categoryBudgetsRef.current, result.value)).length) {
          setBudgetConflict(true);
          setMoveTarget(null);
          return;
        }
        setCategoryBudgets(result.value);
      });
    };
    refreshBudgetsRef.current = refresh;
    const unsubscribe = subscribeCategoryBudgets(refresh);
    return () => { active = false; request += 1; unsubscribe(); refreshBudgetsRef.current = () => {}; };
  }, [budgetScope, currentScopeKey, month, year]);

  useEffect(() => subscribeCategoryCatalog(change => {
    if (activeScopeKeyRef.current !== currentScopeKey) return;
    if ((change.scope.budgetId ?? null) !== (budgetScope.budgetId ?? null)
      || (change.scope.householdId ?? null) !== (budgetScope.householdId ?? null)
      || (change.scope.userId ?? null) !== (budgetScope.userId ?? null)) return;
    scopeVersion.current += 1;
    const version = scopeVersion.current;
    loadedScopeKeyRef.current = null;
    setLoadReady(false);
    const wasDirty = [...dirtyRef.current].some(name => categoryMatches(name, change.oldName));
    dirtyRef.current = new Set([...dirtyRef.current].map(name => categoryMatches(name, change.oldName) ? change.newName : name));
    setDrafts(previous => remapCategoryDrafts(previous, change.oldName, change.newName));
    setCategoryBudgets(previous => remapCategoryBudgetMap(previous, change.oldName, change.newName));
    setMoveTarget(null);
    if (wasDirty) setSaveMessage(settings.zeroBasedBudgetEnabled ? "Category updated. Review your unsaved edits before saving." : "Category updated. Your unsaved assignment moved with it; review it before saving.");
    void loadCategoryBudgetsExact(budgetScope, month, year).then(result => {
      if (version !== scopeVersion.current || activeScopeKeyRef.current !== currentScopeKey) return;
      loadedScopeKeyRef.current = !result.error && (!budgetScope.userId || result.exact) ? currentScopeKey : null;
      setCategoryBudgets(result.value);
      setLoadReady(!result.error && (!budgetScope.userId || result.exact));
      setLoadError(result.error ?? "");
    });
  }), [budgetScope, currentScopeKey, month, year, settings.zeroBasedBudgetEnabled]);

  useEffect(() => {
    setDrafts(previous => Object.fromEntries(editableCategories.map(category => [category, dirtyRef.current.has(category) ? previous[category] ?? "" : Object.prototype.hasOwnProperty.call(categoryBudgets, category) ? String(categoryBudgets[category]) : ""])));
  }, [categoryBudgets, editableCategories]);

  const draftPreview = useMemo(() => {
    try {
      return { budgets: applyCategoryBudgetChanges(categoryBudgets, parseCategoryBudgetChanges(drafts, [...dirtyRef.current])), error: "" };
    } catch (error) { return { budgets: categoryBudgets, error: error instanceof Error ? error.message : "Check your category amounts first." }; }
  }, [categoryBudgets, drafts]);
  const previewBudgets = draftPreview.budgets;

  const categoryPlan = useMemo(() => {
    return buildCategoryPlan(
      editableCategories,
      getMonthlyBills(month, year)
        .filter(isBillEligibleForUpcomingPlan)
        .map(bill => ({ category: bill.is_debt ? "Debt" : bill.category || "Other", amount: getBillMonthlyTotal(bill, month, year) })),
      getTransactionsForMonth(month, year).flatMap(tx => transactionCategoryParts(tx)).filter(tx => tx.category !== "Income"),
      Object.entries(previewBudgets).map(([category, amount]) => ({ category, amount })),
    ).map(row => {
      const hasBudget = settings.zeroBasedBudgetEnabled || Object.prototype.hasOwnProperty.call(previewBudgets, row.category) || row.budgeted > 0.005;
      return hasBudget ? { ...row, hasBudget } : { ...row, hasBudget, remaining: 0, percentUsed: 0, status: "available" as const };
    }).sort((left, right) => statusRank(left.status) - statusRank(right.status) || left.remaining - right.remaining);
  }, [previewBudgets, editableCategories, getBillMonthlyTotal, getMonthlyBills, getTransactionsForMonth, month, year, settings.zeroBasedBudgetEnabled]);

  const visibleRows = categoryPlan.filter(row => filter === "all" || row.status === filter);
  const monthlyIncome = getMonthlyIncome(month, year);
  const zeroBudgetSummary = buildZeroBudgetSummary(monthlyIncome, categoryPlan);
  const unassigned = zeroBudgetSummary.leftToAssign;
  const sourceOptions: { source: CategoryBudgetMoveSource; label: string; available: number }[] = [
    ...(settings.zeroBasedBudgetEnabled && unassigned > 0 ? [{ source: { kind: "unbudgeted" as const }, label: "Left to budget", available: unassigned }] : []),
    ...categoryPlan.filter(row => moveTarget && row.category !== moveTarget.category && row.remaining > 0.005
      && canEditCategory(row.category))
      .map(row => ({ source: { kind: "category" as const, category: row.category }, label: row.category, available: row.remaining })),
  ];
  const selectedMoveSource = sourceOptions.find(option => option.source.kind === moveSource?.kind
    && (option.source.kind === "unbudgeted" || moveSource?.kind === "category" && option.source.category === moveSource.category));
  const enteredMoveAmount = parseMoneyInput(moveAmount);
  const moveInputError = draftPreview.error || (moveAmount.trim() && (enteredMoveAmount === null || enteredMoveAmount <= 0)
    ? "Enter a positive amount with up to two decimal places."
    : enteredMoveAmount !== null && selectedMoveSource && enteredMoveAmount > selectedMoveSource.available
      ? `You can use up to ${money(selectedMoveSource.available)} from ${selectedMoveSource.label}.` : "");
  const hasDirtyEdits = dirtyRef.current.size > 0;
  const overspentRows = categoryPlan.filter(row => row.hasBudget && row.remaining < -0.005);
  const overspentTotal = overspentRows.reduce((sum, row) => sum + Math.abs(row.remaining), 0);
  const budgetedTotal = categoryPlan.reduce((sum, row) => sum + row.budgeted, 0);
  const spentTotal = categoryPlan.reduce((sum, row) => sum + (row.hasBudget ? row.spent : 0), 0);
  const reviewCount = useMemo(() => {
    return buildReviewQueue(transactions, localDay).length;
  }, [transactions, localDay]);
  const pendingReviewCount = useMemo(
    () => unmatchedPendingTransactions(pendingPlanMatches, pendingBankTransactions).length,
    [pendingBankTransactions, pendingPlanMatches],
  );

  const persistBudgets = async (next: Record<string, number>, changedCategories?: string[], repeat = repeatChanges) => {
    if (!canEditHousehold || !editingAllowedRef.current || !loadReady || busyRef.current || budgetConflict
      || loadedScopeKeyRef.current !== currentScopeKey || activeScopeKeyRef.current !== currentScopeKey) return false;
    const differences = changedCategoryBudgets(categoryBudgets, next);
    const changed = changedCategories ?? Object.keys(differences);
    if (!changed.length) { setSaveMessage("Change a monthly budget before saving."); return false; }
    const nextValues = new Map(Object.entries(next));
    const changes = Object.fromEntries(changed.map(category => [category, nextValues.get(category) ?? null]));
    const version = scopeVersion.current;
    const key = currentScopeKey;
    busyRef.current = true;
    setSaving(true);
    setSaveMessage("Saving…");
    try {
      if (budgetScope.userId) assertFinancialMutationOnline();
      const result = await saveMonthlyCategoryBudgetChanges(budgetScope, month, year, changes, repeat);
      if (version !== scopeVersion.current || activeScopeKeyRef.current !== key) return false;
      dirtyRef.current.clear();
      setCategoryBudgets(result.budgets);
      setSaveMessage(repeat ? "Monthly budgets saved. They repeat from this month." : "Budgets saved for this month.");
      return true;
    } catch (error) {
      if (version === scopeVersion.current) setSaveMessage(error instanceof Error ? error.message : "Could not save these budgets. Your changes are still here; try again.");
      return false;
    } finally {
      busyRef.current = false;
      setSaving(false);
      refreshBudgetsRef.current();
    }
  };

  const saveDrafts = () => {
    try {
      const changed = [...dirtyRef.current];
      const changes = parseCategoryBudgetChanges(drafts, changed);
      void persistBudgets(applyCategoryBudgetChanges(categoryBudgets, changes), changed);
      Keyboard.dismiss();
    } catch (error) { setSaveMessage(error instanceof Error ? error.message : "Check your monthly budgets."); }
  };

  const shiftMonth = (delta: number) => {
    if (busyRef.current) return;
    const next = new Date(year, month + delta, 1);
    const change = () => {
      dirtyRef.current.clear();
      lastRequestedPeriodKey.current = `${next.getFullYear()}/${next.getMonth()}`;
      setMonth(next.getMonth()); setYear(next.getFullYear());
      if (!embedded) router.setParams({ budgetMonth: String(next.getMonth()), budgetYear: String(next.getFullYear()) } as never);
    };
    if (dirtyRef.current.size) {
      confirmBudgetAction({ title: "Unsaved budgets", message: "Save your changes before changing months, or discard them.", cancelText: "Keep editing", confirmText: "Discard", destructive: true, onConfirm: change });
    } else change();
  };

  const focusBudget = (row: CategoryPlanRow) => {
    if (!editingAllowedRef.current || busyRef.current || activeScopeKeyRef.current !== currentScopeKey
      || !canEditCategory(row.category)) return;
    if (!dirtyRef.current.has(row.category)) {
      setDrafts(previous => ({ ...previous, [row.category]: row.budgeted.toFixed(2) }));
    }
    categoryInputs.current.get(row.category)?.focus();
  };

  const openMove = (row: CategoryPlanRow) => {
    if (!editingAllowedRef.current || busyRef.current || activeScopeKeyRef.current !== currentScopeKey
      || !canEditCategory(row.category)) return;
    const source = categoryPlan.filter(item => item.category !== row.category && item.remaining > 0.005
      && canEditCategory(item.category)).sort((a, b) => b.remaining - a.remaining)[0];
    const available = settings.zeroBasedBudgetEnabled && unassigned > 0 ? unassigned : source?.remaining ?? 0;
    Keyboard.dismiss();
    moveScopeRef.current = { key: currentScopeKey, version: scopeVersion.current };
    setMoveTarget(row);
    setMoveSource(settings.zeroBasedBudgetEnabled && unassigned > 0 ? { kind: "unbudgeted" } : source ? { kind: "category", category: source.category } : null);
    setMoveAmount(row.remaining < 0 && available > 0 ? Math.min(Math.abs(row.remaining), available).toFixed(2) : "");
    setMoveError("");
  };

  const applyMove = () => {
    if (!editingAllowedRef.current || busyRef.current) return;
    if (moveScopeRef.current?.key !== activeScopeKeyRef.current || moveScopeRef.current?.version !== scopeVersion.current) {
      setMoveTarget(null);
      return;
    }
    if (!moveTarget || !moveSource || !selectedMoveSource) {
      setMoveError("Choose a source with an available amount.");
      return;
    }
    try {
      const changes = parseCategoryBudgetChanges(drafts, [...dirtyRef.current]);
      const preview = applyCategoryBudgetChanges(categoryBudgets, changes);
      const amount = parseMoneyInput(moveAmount);
      if (amount === null) throw new Error("Enter a positive amount with up to two decimal places.");
      const next = buildCategoryBudgetMoveDraft(preview, categoryPlan, monthlyIncome, moveSource, moveTarget.category, amount);
      const edits = Object.entries(changedCategoryBudgets(preview, next));
      edits.forEach(([category]) => dirtyRef.current.add(category));
      setDrafts(previous => ({ ...previous, ...Object.fromEntries(edits.map(([category, value]) => [category, value!.toFixed(2)])) }));
      setRepeatChanges(false);
      setSaveMessage("Move added to this month’s draft. Save to apply.");
      Keyboard.dismiss();
      setMoveTarget(null);
    } catch (error) { setMoveError(error instanceof Error ? error.message : "Check this budget adjustment and try again."); }
  };

  const assignRemaining = (row: CategoryPlanRow) => {
    if (!editingAllowedRef.current || activeScopeKeyRef.current !== currentScopeKey || busyRef.current || unassigned <= 0
      || !canEditCategory(row.category)) return;
    try {
      parseCategoryBudgetChanges(drafts, [...dirtyRef.current]);
      dirtyRef.current.add(row.category);
      setDrafts(previous => ({ ...previous, [row.category]: (Math.round((row.budgeted + unassigned) * 100) / 100).toFixed(2) }));
      setSaveMessage(`Added ${money(unassigned)} to ${row.category}. Save to keep this budget.`);
    } catch (error) { setSaveMessage(error instanceof Error ? error.message : "Check your category amounts first."); }
  };

  const useBillAmounts = (row: CategoryPlanRow) => {
    if (!editingAllowedRef.current || activeScopeKeyRef.current !== currentScopeKey || busyRef.current
      || !canEditCategory(row.category)) return;
    dirtyRef.current.add(row.category);
    setDrafts(previous => ({ ...previous, [row.category]: "" }));
    setSaveMessage(settings.zeroBasedBudgetEnabled ? "Save to use bill totals. Enter 0 to budget $0."
      : repeatChanges ? "Save to clear this budget and stop repeating it." : "Save to clear this month’s budget.");
  };

  const navigateFromBudget = (navigate: () => void) => {
    if (busyRef.current) return;
    if (!dirtyRef.current.size) { navigate(); return; }
    confirmBudgetAction({ title: "Unsaved budgets", message: "Discard your unsaved changes before leaving this budget?", cancelText: "Keep editing", confirmText: "Discard", destructive: true, onConfirm: () => {
      dirtyRef.current.clear();
      setDrafts(Object.fromEntries(editableCategories.map(category => [category, Object.hasOwn(categoryBudgets, category) ? String(categoryBudgets[category]) : ""])));
      setSaveMessage("");
      navigate();
    } });
  };

  const openIncome = () => navigateFromBudget(() => router.push({ pathname: "/(tabs)/more", params: { section: "money", ...(monthlyIncome <= 0 ? { add: "income" } : {}) } } as any));

  const reloadSavedBudgets = () => confirmBudgetAction({ title: "Reload saved budgets?", message: "Your unsaved edits will be discarded. The latest saved budgets will load.", cancelText: "Keep editing", confirmText: "Reload", destructive: true, onConfirm: () => setLoadAttempt(value => value + 1) });

  const restartBudget = () => {
    if (!restartAllowedRef.current || busyRef.current) return;
    let nextDrafts: Record<string, string>;
    try { nextDrafts = buildCategoryBudgetRestartDraft(editableCategories, categoryPlan, categoryBudgets); }
    catch (error) { setSaveMessage(error instanceof Error ? error.message : "Review your categories before starting over."); return; }
    if (!Object.keys(nextDrafts).length) { setSaveMessage("There are no category budgets to restart."); return; }
    const baseline = { ...categoryBudgets };
    confirmBudgetAction({
      title: `Start over for ${MONTH_FULL[month]} ${year}?`,
      message: "Set category budgets to zero in a new draft. Income, spending and bills stay as they are. Nothing is saved until you choose Save.",
      cancelText: "Keep budget", confirmText: "Start over", destructive: true,
      onConfirm: () => {
        if (!restartAllowedRef.current || busyRef.current) return;
        if (Object.keys(changedCategoryBudgets(baseline, categoryBudgetsRef.current)).length) {
          setSaveMessage("Saved budgets changed. Reload them before starting over.");
          return;
        }
        dirtyRef.current = new Set(Object.keys(nextDrafts));
        setDrafts(nextDrafts);
        setRepeatChanges(false);
        setMoveTarget(null);
        setFilter("all");
        setSaveMessage("Category budgets are zero in this draft. Review and Save.");
      },
    });
  };

  const copyPreviousMonth = async () => {
    if (!loadReady || busyRef.current) return;
    if (dirtyRef.current.size) { setSaveMessage(settings.zeroBasedBudgetEnabled ? "Save your budget edits before copying another month." : "Save your assignments before copying another month."); return; }
    const version = scopeVersion.current;
    const key = currentScopeKey;
    const previousDate = new Date(year, month - 1, 1);
    const result = await loadCategoryBudgetsExact(budgetScope, previousDate.getMonth(), previousDate.getFullYear());
    if (version !== scopeVersion.current || activeScopeKeyRef.current !== key || busyRef.current || dirtyRef.current.size) return;
    if (result.error) { setSaveMessage(`Could not load the previous month: ${result.error}`); return; }
    const previous = result.value;
    if (!Object.keys(previous).length) {
      setSaveMessage("The previous month does not have any saved budgets to copy.");
      return;
    }
    const applyCopy = () => { if (version === scopeVersion.current && activeScopeKeyRef.current === key && !dirtyRef.current.size) void persistBudgets(previous, undefined, false); };
    if (!Object.keys(categoryBudgets).length) {
      applyCopy();
      return;
    }
    confirmBudgetAction({ title: "Replace this month?", message: "Copying will replace this month's saved budgets. Planned bill amounts will still refresh for this month.", confirmText: "Replace", destructive: true, onConfirm: applyCopy });
  };


  if (!categoriesReady) {
    return (
      <View style={[styles.screen, { backgroundColor: c.background, paddingTop: insets.top + 10 }]}>
        <PremiumBackdrop variant="green" />
        <View style={styles.header}>
          {!embedded ? (
            <Pressable onPress={() => navigateFromBudget(() => router.back())} style={[styles.backBtn, { backgroundColor: c.card }]}>
              <Feather name="chevron-left" size={20} color={c.foreground} />
            </Pressable>
          ) : null}
          <View style={{ flex: 1 }}>
            {embedded ? <PlanViewSelector textStyle={styles.title} /> : <Text style={[styles.title, { color: c.foreground }]}>Category budgets</Text>}
            <Text style={[styles.subtitle, { color: c.mutedForeground }]}>{settings.zeroBasedBudgetEnabled ? "Plan this month’s income" : "Set a monthly amount for each category"}</Text>
            <DataFreshnessLabel compact />
          </View>
        </View>
        <View style={[styles.modeGate, { backgroundColor: c.card, borderColor: c.border }]}>
          <View style={[styles.modeGateIcon, { backgroundColor: c.primary + "18" }]}>
            <Feather name="refresh-cw" size={24} color={c.primary} />
          </View>
          <Text accessibilityLiveRegion="polite" style={[styles.modeGateTitle, { color: c.foreground }]}>Loading categories…</Text>
          <Text style={[styles.modeGateText, { color: c.mutedForeground }]}>Your saved category plan will appear here.</Text>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={[styles.screen, { backgroundColor: c.background, paddingTop: insets.top + 10 }]}>
      <PremiumBackdrop variant="green" />
      <ScrollView
        style={styles.pageScroll}
        contentContainerStyle={[styles.pageContent, { paddingBottom: hasDirtyEdits ? 20 : insets.bottom + 96 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
      <View style={styles.header}>
        {!embedded && <Pressable onPress={() => navigateFromBudget(() => router.back())} style={[styles.backBtn, { backgroundColor: c.card }]}>
          <Feather name="chevron-left" size={20} color={c.foreground} />
        </Pressable>}
        <View style={styles.headerCopy}>
          {embedded ? <PlanViewSelector textStyle={styles.title} /> : <Text style={[styles.title, { color: c.foreground }]}>{settings.zeroBasedBudgetEnabled ? "Zero-Based Budget" : "Category budgets"}</Text>}
          <Text style={[styles.subtitle, { color: c.mutedForeground }]}>{settings.zeroBasedBudgetEnabled ? "Plan this month’s income" : "Set a monthly amount for each category"}</Text>
          <DataFreshnessLabel compact />
        </View>
        <View style={styles.headerActions}>
        {settings.zeroBasedBudgetEnabled ? <Pressable {...(Platform.OS === "web" ? { title: `Start over ${MONTH_FULL[month]} ${year} budget` } : {})} accessibilityRole="button" accessibilityLabel={`Start over ${MONTH_FULL[month]} ${year} budget`} accessibilityHint="Prepare a new draft with category budgets set to zero" disabled={!restartAllowed} onPress={restartBudget}
          style={[styles.restartBtn, { backgroundColor: c.card, borderColor: c.border, opacity: restartAllowed ? 1 : 0.45 }]}>
          <Feather name="rotate-ccw" size={18} color={c.primary} />
        </Pressable> : null}
        <Pressable accessibilityRole="button" accessibilityLabel="Save monthly budgets" disabled={!editingAllowedRef.current} onPress={saveDrafts} style={[styles.saveBtn, { backgroundColor: c.primary, opacity: editingAllowedRef.current ? 1 : 0.5 }]}>
          <Text style={[styles.saveText, { color: c.primaryForeground }]}>{saving ? "Saving…" : "Save"}</Text>
        </Pressable>
        </View>
      </View>
      {saveMessage || !loadReady ? <View style={[styles.statusNotice, { backgroundColor: c.card, borderColor: c.border }]}>
        {saveMessage ? <Text accessibilityLiveRegion="polite" style={[styles.noticeText, { color: c.foreground }]}>{saveMessage}</Text> : null}
        {!loadReady ? <Text accessibilityLiveRegion="polite" style={[styles.noticeText, { color: c.mutedForeground }]}>{loadError ? "Could not confirm your saved budgets. Retry before editing." : "Loading saved budgets…"}</Text> : null}
        {loadError ? <Pressable onPress={() => { if (dirtyRef.current.size) reloadSavedBudgets(); else setLoadAttempt(value => value + 1); }} style={styles.inlineButton}><Text style={{ color: c.primary }}>Retry loading budgets</Text></Pressable> : null}
      </View> : null}
      {budgetConflict ? <View style={[styles.notice, { backgroundColor: c.warning + "14", borderColor: c.warning + "55" }]}>
        <Text accessibilityLiveRegion="polite" style={[styles.noticeText, { color: c.foreground }]}>Saved budgets changed. Your edits are still here. Reload before saving.</Text>
        <Pressable accessibilityRole="button" onPress={reloadSavedBudgets} style={styles.inlineButton}><Text style={[styles.actionText, { color: c.primary }]}>Reload saved budgets</Text></Pressable>
      </View> : null}

      <View style={[styles.monthCard, { backgroundColor: c.card }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Previous month" disabled={saving || year === 2000 && month === 0} onPress={() => shiftMonth(-1)} style={styles.monthBtn}><Feather name="chevron-left" size={18} color={c.foreground} /></Pressable>
        <Text style={[styles.monthTitle, { color: c.foreground }]}>{MONTH_FULL[month]} {year}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Next month" disabled={saving || year === 2200 && month === 11} onPress={() => shiftMonth(1)} style={styles.monthBtn}><Feather name="chevron-right" size={18} color={c.foreground} /></Pressable>
      </View>
      <Pressable disabled={!canEditHousehold || saving || !loadReady || budgetConflict} onPress={() => void copyPreviousMonth()} style={styles.copyPreviousButton}>
        <Feather name="copy" size={13} color={canEditHousehold ? c.primary : c.mutedForeground} />
        <Text style={[styles.copyPreviousText, { color: canEditHousehold ? c.primary : c.mutedForeground }]}>Copy previous month</Text>
      </Pressable>

      {settings.zeroBasedBudgetEnabled ? <>
        <View style={[styles.zeroSummary, { backgroundColor: c.card, borderColor: c.border }]}>
          <View style={styles.zeroSummaryHeader}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.inputLabel, { color: c.mutedForeground }]}>{monthlyIncome <= 0 ? "Plan your income" : unassigned < 0 ? "Budget exceeds income" : "Left to budget"}</Text>
              <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5} style={[styles.zeroAmount, { color: unassigned < 0 ? c.destructive : unassigned > 0 ? c.primary : c.success }]}>{money(Math.abs(unassigned))}</Text>
            </View>
            <Feather name={monthlyIncome > 0 && unassigned === 0 ? "check-circle" : "pie-chart"} size={28} color={monthlyIncome > 0 && unassigned === 0 ? c.success : c.primary} />
          </View>
          <View style={[styles.summaryRow, styles.zeroSummaryStats]}>
            <SummaryBox label="Monthly income" value={money(zeroBudgetSummary.plannedIncome)} color={c.success} />
            <SummaryBox label="Budgeted" value={money(zeroBudgetSummary.assigned)} color={c.primary} />
          </View>
          <Text style={[styles.noticeText, { color: c.mutedForeground }]}>{monthlyIncome <= 0
            ? "Add monthly income, then set your category budgets."
            : unassigned < 0 ? `Category budgets exceed monthly income by ${money(Math.abs(unassigned))}.`
              : unassigned > 0 ? "Set category amounts below."
                : "Your monthly income is fully budgeted."}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={monthlyIncome <= 0 ? "Add planned income" : "Review planned income"} onPress={openIncome} style={styles.inlineButton}>
            <Feather name="trending-up" size={14} color={c.primary} /><Text style={[styles.actionText, { color: c.primary }]}>{monthlyIncome <= 0 ? "Add income" : "Review income"}</Text>
          </Pressable>
        </View>
        {overspentRows.length ? <Pressable accessibilityRole="button" accessibilityLabel="Show overspent categories" onPress={() => setFilter("over")} style={[styles.notice, { backgroundColor: c.warning + "14", borderColor: c.warning + "55" }]}>
          <Feather name="alert-circle" size={18} color={c.warning} />
          <View style={{ flex: 1 }}><Text style={[styles.actionText, { color: c.foreground }]}>{overspentRows.length} {overspentRows.length === 1 ? "category" : "categories"} over budget</Text><Text style={[styles.noticeText, { color: c.mutedForeground }]}>{money(overspentTotal)} above their budgets. Review the categories below.</Text></View>
          <Feather name="chevron-right" size={17} color={c.warning} />
        </Pressable> : null}
        <Text style={[styles.totalsNote, { color: c.mutedForeground }]}>Budget totals are separate from account balances.</Text>
      </> : <View style={styles.summaryRow}>
          <SummaryBox label="Budgeted" value={money(budgetedTotal)} color={c.primary} />
          <SummaryBox label="Spent" value={money(spentTotal)} color={c.mutedForeground} />
          <SummaryBox label="Left" value={money(budgetedTotal - spentTotal)} color={budgetedTotal >= spentTotal ? c.success : c.destructive} />
      </View>}
      {!settings.zeroBasedBudgetEnabled ? <Text style={[styles.totalsNote, { color: c.mutedForeground }]}>Totals cover categories with a monthly budget or planned bill amount.</Text> : null}

      <View style={[styles.applyCard, { backgroundColor: c.card, borderColor: c.border }]}>
        {!settings.zeroBasedBudgetEnabled ? <Text style={[styles.inputLabel, { color: c.mutedForeground }]}>Apply edited budgets</Text> : null}
        <View style={styles.applyOptions}>
          {[{ repeat: false, label: "This month only" }, { repeat: true, label: "Every month" }].map(option => (
            <Pressable key={String(option.repeat)} accessibilityRole="radio" accessibilityLabel={option.label}
              accessibilityState={{ checked: repeatChanges === option.repeat, disabled: !canEditHousehold || saving || !loadReady || budgetConflict }}
              aria-checked={repeatChanges === option.repeat} aria-disabled={!canEditHousehold || saving || !loadReady || budgetConflict}
              disabled={!canEditHousehold || saving || !loadReady || budgetConflict} onPress={() => setRepeatChanges(option.repeat)}
              style={[styles.applyOption, { backgroundColor: repeatChanges === option.repeat ? c.primary : c.muted }]}>
              <Text style={[styles.actionText, { color: repeatChanges === option.repeat ? c.primaryForeground : c.foreground }]}>{option.label}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={[styles.rowSub, { color: c.mutedForeground }]}>{settings.zeroBasedBudgetEnabled
          ? repeatChanges ? `Edited amounts repeat from ${MONTH_FULL[month]}.` : "Edits apply to this month. Save when ready."
          : repeatChanges ? `Repeats from ${MONTH_FULL[month]} ${year}. Clearing a budget stops it from this month.`
            : "Only this month changes. Your repeating budgets stay in place for other months."}</Text>
        {!settings.zeroBasedBudgetEnabled ? <Text style={[styles.rowSub, { color: c.mutedForeground }]}>A blank budget uses planned bills, if any. Spending updates as transactions are recorded.</Text> : null}
        {!canEditHousehold ? <Text style={[styles.rowSub, { color: c.mutedForeground }]}>You have view-only access to this household.</Text> : null}
      </View>

      {embedded && <Pressable
        onPress={() => router.push({ pathname: "/(tabs)/more", params: { section: "review" } } as any)}
        style={({ pressed }) => [styles.reviewLink, { backgroundColor: c.card, borderColor: c.border, opacity: pressed ? 0.78 : 1 }]}
      >
        <View style={[styles.reviewLinkIcon, { backgroundColor: c.primary + "18" }]}>
          <Feather name="check-square" size={17} color={c.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.reviewLinkTitle, { color: c.foreground }]}>Review bank activity</Text>
          <Text style={[styles.reviewLinkText, { color: c.mutedForeground }]}>Categorize posted transactions here, then this budget updates automatically.</Text>
        </View>
        <View style={[styles.reviewCount, { backgroundColor: reviewCount + pendingReviewCount > 0 ? c.destructive : c.success }]}>
          <Text style={styles.reviewCountText}>{reviewCount + pendingReviewCount}</Text>
        </View>
      </Pressable>}

      <View style={styles.filterRow}>
        {(["all", "over", "watch", "available"] as Filter[]).map(item => (
          <Pressable key={item} onPress={() => setFilter(item)} style={[styles.filterChip, { backgroundColor: filter === item ? c.primary : c.card }]}>
            <Text style={[styles.filterText, { color: filter === item ? c.primaryForeground : c.mutedForeground }]}>{item === "all" ? "All" : item[0].toUpperCase() + item.slice(1)}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.rows}>
        {visibleRows.map(row => {
          const rowEditable = canEditCategory(row.category);
          const color = !row.hasBudget ? c.mutedForeground : row.status === "over" ? c.destructive : row.status === "watch" ? c.warning : CAT_COLORS[row.category] ?? c.primary;
          return (
            <View key={`${currentScopeKey}/${row.category}`} testID={`category-budget-${row.category}`} style={[styles.rowCard, { backgroundColor: c.card, borderColor: c.border }]}>
              <View style={styles.rowTop}>
                <View style={[styles.icon, { backgroundColor: color + "18" }]}>
                  <Feather name={row.status === "over" ? "alert-triangle" : row.status === "watch" ? "eye" : "tag"} size={15} color={color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowName, { color: c.foreground }]}>{row.category}</Text>
                  <Text style={[styles.rowSub, { color: c.mutedForeground }]}>{row.hasBudget ? `Spent ${money(row.spent)} of ${money(row.budgeted)}` : `Spent ${money(row.spent)} · No monthly budget`}</Text>
                </View>
                <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.65} style={[styles.leftValue, { color }]}>{row.hasBudget ? `${money(row.remaining)} left` : "No limit"}</Text>
              </View>
              <View style={[styles.track, { backgroundColor: c.muted }]}>
                <View style={[styles.fill, { backgroundColor: color, width: `${Math.min(100, row.percentUsed)}%` as any }]} />
              </View>
              <View style={styles.editLine}>
                <View style={styles.editLabel}>
                  <Text style={[styles.inputLabel, { color: c.mutedForeground }]}>{settings.zeroBasedBudgetEnabled ? "Category budget" : "Monthly budget"}</Text>
                  {canEditHousehold && rowEditable ? <Pressable accessibilityRole="button" accessibilityLabel={`Edit budget for ${row.category}`}
                    disabled={!editingAllowedRef.current} onPress={() => focusBudget(row)} style={[styles.editButton, { backgroundColor: c.primary + "18" }]}>
                    <Feather name="edit-2" size={13} color={c.primary} /><Text style={[styles.actionText, { color: c.primary }]}>Edit budget</Text>
                  </Pressable> : null}
                </View>
                <View style={[styles.inputWrap, { backgroundColor: c.muted, borderColor: c.border, borderWidth: 1 }]}>
                  <Text style={[styles.dollar, { color: c.mutedForeground }]}>$</Text>
                  <TextInput sensitive
                    ref={input => { if (input) categoryInputs.current.set(row.category, input); else categoryInputs.current.delete(row.category); }}
                    accessibilityLabel={`Monthly budget for ${row.category}`}
                    value={Object.prototype.hasOwnProperty.call(drafts, row.category) ? drafts[row.category] : ""}
                    onChangeText={value => {
                      if (!editingAllowedRef.current || activeScopeKeyRef.current !== currentScopeKey) return;
                      dirtyRef.current.add(row.category); setSaveMessage("Unsaved monthly budgets"); setDrafts(previous => ({ ...previous, [row.category]: value }));
                    }}
                    editable={rowEditable && editingAllowedRef.current}
                    keyboardType="decimal-pad"
                    returnKeyType="done"
                    onSubmitEditing={Keyboard.dismiss}
                    placeholder={row.budgeted.toFixed(2)}
                    placeholderTextColor={c.mutedForeground}
                    style={[styles.input, { color: c.foreground }]}
                  />
                </View>
              </View>
              {settings.zeroBasedBudgetEnabled ? <Text style={[styles.rowSub, { color: c.mutedForeground }]}>Blank uses bill amounts. Enter 0 for no budget.</Text> : null}
              {!rowEditable ? <Text style={[styles.rowSub, { color: c.mutedForeground }]}>Historical category · manage active categories in Settings.</Text> : null}
              {canEditHousehold && rowEditable && <View style={styles.actions}>
                {settings.zeroBasedBudgetEnabled && unassigned > 0 ? <Pressable accessibilityRole="button" accessibilityLabel={`Add remaining to ${row.category}`}
                  disabled={!editingAllowedRef.current} onPress={() => assignRemaining(row)} style={[styles.actionBtn, { backgroundColor: c.primary + "18" }]}>
                  <Text style={[styles.actionText, { color: c.primary }]}>Add remaining</Text>
                </Pressable> : null}
                <Pressable accessibilityRole="button" accessibilityLabel={settings.zeroBasedBudgetEnabled ? `Use planned bills for ${row.category}` : `Clear budget for ${row.category}`}
                  disabled={!editingAllowedRef.current} onPress={() => useBillAmounts(row)}
                  style={[styles.actionBtn, { backgroundColor: c.muted }]}>
                  <Text style={[styles.actionText, { color: c.mutedForeground }]}>{settings.zeroBasedBudgetEnabled ? "Use bill amounts" : "Clear budget"}</Text>
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel={settings.zeroBasedBudgetEnabled ? `Move budget to ${row.category}` : `Move money to ${row.category}`}
                  disabled={!editingAllowedRef.current} onPress={() => openMove(row)} style={[styles.actionBtn, { backgroundColor: c.success + "18" }]}>
                  <Text style={[styles.actionText, { color: c.success }]}>{settings.zeroBasedBudgetEnabled ? "Move budget" : "Move money"}</Text>
                </Pressable>
              </View>}
            </View>
          );
        })}
      </View>
      </ScrollView>

      {hasDirtyEdits ? <View style={[styles.draftFooter, { backgroundColor: c.card, borderColor: c.border, marginBottom: isDesktop ? 16 : insets.bottom + 96 }]}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[styles.actionText, { color: c.foreground }]}>Unsaved budget changes</Text>
          <Text style={[styles.rowSub, { color: c.mutedForeground }]}>{repeatChanges ? `Repeats from ${MONTH_FULL[month]} ${year}` : `${MONTH_FULL[month]} ${year} only`}</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Save budget changes" disabled={!editingAllowedRef.current}
          onPress={saveDrafts} style={[styles.footerSave, { backgroundColor: c.primary, opacity: editingAllowedRef.current ? 1 : 0.5 }]}>
          <Text style={[styles.saveText, { color: c.primaryForeground }]}>{saving ? "Saving…" : "Save changes"}</Text>
        </Pressable>
      </View> : null}

      <Modal visible={!!moveTarget} transparent animationType="slide" onRequestClose={() => setMoveTarget(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <Pressable style={styles.overlay} onPress={() => setMoveTarget(null)}>
          <Pressable style={[styles.sheet, { backgroundColor: c.card }]} onPress={() => {}}>
            <View style={[styles.handle, { backgroundColor: c.mutedForeground }]} />
            <Text style={[styles.sheetTitle, { color: c.foreground }]}>{settings.zeroBasedBudgetEnabled ? "Move budget to" : "Move money to"} {moveTarget?.category}</Text>
            <Text style={[styles.noticeText, { color: c.mutedForeground }]}>Choose a source. The adjustment stays in your draft until you Save changes.</Text>
            {sourceOptions.length ? <ScrollView style={styles.sourceList} showsVerticalScrollIndicator contentContainerStyle={styles.sourceScroller} keyboardShouldPersistTaps="handled">
              {sourceOptions.map(option => {
                const selected = option.source.kind === moveSource?.kind
                  && (option.source.kind === "unbudgeted" || moveSource?.kind === "category" && option.source.category === moveSource.category);
                return <Pressable key={option.source.kind === "unbudgeted" ? "pool" : `category:${option.source.category}`}
                  accessibilityRole="radio" accessibilityLabel={`Move from ${option.label}`} accessibilityState={{ checked: selected }}
                  onPress={() => { setMoveSource(option.source); setMoveError(""); }}
                  style={[styles.sourceChip, { backgroundColor: selected ? c.primary : c.muted, borderColor: selected ? c.primary : c.border }]}>
                  <Text numberOfLines={2} style={[styles.sourceName, { color: selected ? c.primaryForeground : c.foreground }]}>{option.label}</Text>
                  <Text style={[styles.sourceMeta, { color: selected ? c.primaryForeground : c.mutedForeground }]}>{money(option.available)} available</Text>
                </Pressable>;
              })}
            </ScrollView> : <Text accessibilityRole="alert" style={[styles.noticeText, { color: c.mutedForeground }]}>No unspent budget is available to move. Edit category amounts or review income first.</Text>}
            {sourceOptions.length ? <>
            <View style={[styles.inputWrap, { backgroundColor: c.muted, marginBottom: 8 }]}>
              <Text style={[styles.dollar, { color: c.mutedForeground }]}>$</Text>
              <TextInput sensitive accessibilityLabel="Amount to move" value={moveAmount} onChangeText={value => { setMoveAmount(value); setMoveError(""); }}
                keyboardType="decimal-pad" returnKeyType="done" onSubmitEditing={Keyboard.dismiss} placeholder="Amount" placeholderTextColor={c.mutedForeground} style={[styles.input, { color: c.foreground }]} />
            </View>
            </> : null}
            {moveError || moveInputError ? <Text accessibilityRole="alert" style={[styles.error, { color: c.destructive }]}>{moveError || moveInputError}</Text> : null}
            <Pressable accessibilityRole="button" accessibilityLabel="Add budget move to draft"
              disabled={!editingAllowedRef.current || !selectedMoveSource || enteredMoveAmount === null || enteredMoveAmount <= 0 || Boolean(moveInputError)}
              onPress={applyMove} style={[styles.sheetPrimary, { backgroundColor: c.primary, opacity: !editingAllowedRef.current || !selectedMoveSource || enteredMoveAmount === null || enteredMoveAmount <= 0 || Boolean(moveInputError) ? 0.5 : 1 }]}>
              <Text style={[styles.sheetPrimaryText, { color: c.primaryForeground }]}>Add to draft</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Close budget move" onPress={() => setMoveTarget(null)} style={styles.sheetClose}>
              <Text style={[styles.actionText, { color: c.foreground }]}>Close</Text>
            </Pressable>
          </Pressable>
        </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </KeyboardAvoidingView>
  );
}

export default function CategoryBudgetRoute() {
  const params = useLocalSearchParams<{ budgetMonth?: string; budgetYear?: string }>();
  const requestedPeriod = useMemo(() => categoryBudgetPeriod(params.budgetMonth, params.budgetYear), [params.budgetMonth, params.budgetYear]);
  return <CategoryBudgetScreen requestedPeriod={requestedPeriod} />;
}

function SummaryBox({ label, value, color }: { label: string; value: string; color: string }) {
  const c = useColors();
  return (
    <View style={styles.summaryBox}>
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.55} style={[styles.summaryValue, { color }]}>{value}</Text>
      <Text style={[styles.summaryLabel, { color: c.mutedForeground }]}>{label}</Text>
    </View>
  );
}

function money(amount: number) {
  return `${amount < 0 ? "-" : ""}$${Math.abs(amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function statusRank(status: CategoryPlanRow["status"]) {
  if (status === "over") return 0;
  if (status === "watch") return 1;
  return 2;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  pageScroll: { flex: 1 },
  pageContent: { flexGrow: 1 },
  rows: { padding: 16 },
  header: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingBottom: 14 },
  headerCopy: { flex: 1, minWidth: 150 },
  headerActions: { flexDirection: "row", gap: 8, alignItems: "center", marginLeft: "auto" },
  restartBtn: { width: 44, height: 44, borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  backBtn: { width: 44, height: 44, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 26, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.8 },
  subtitle: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  saveBtn: { minHeight: 44, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, justifyContent: "center" },
  saveText: { fontSize: 13, fontFamily: "Inter_800ExtraBold" },
  monthCard: { marginHorizontal: 16, borderRadius: 20, padding: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12, borderWidth: 1, borderColor: "rgba(148,163,184,0.12)" },
  monthBtn: { padding: 6 },
  monthTitle: { fontSize: 16, fontFamily: "Inter_800ExtraBold" },
  copyPreviousButton: { alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 6, minHeight: 36, paddingHorizontal: 12, marginTop: -6, marginBottom: 8 },
  copyPreviousText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  summaryRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 16, marginBottom: 10 },
  zeroSummaryStats: { paddingHorizontal: 0, marginBottom: 0 },
  summaryBox: { flex: 1, minWidth: 80, borderRadius: 14, paddingHorizontal: 8, paddingVertical: 12, alignItems: "center", backgroundColor: "rgba(148,163,184,0.10)" },
  zeroSummary: { marginHorizontal: 16, marginBottom: 12, borderRadius: 22, padding: 16, borderWidth: 1, gap: 10 },
  zeroSummaryHeader: { flexDirection: "row", gap: 12, alignItems: "center" },
  zeroAmount: { fontSize: 34, fontFamily: "Inter_800ExtraBold", marginTop: 4, letterSpacing: -1 },
  notice: { marginHorizontal: 16, marginBottom: 12, padding: 12, borderWidth: 1, borderRadius: 16, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10 },
  noticeText: { fontSize: 12, fontFamily: "Inter_500Medium", lineHeight: 18 },
  inlineButton: { minHeight: 40, flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 6 },
  summaryValue: { fontSize: 17, fontFamily: "Inter_800ExtraBold" },
  summaryLabel: { fontSize: 10, fontFamily: "Inter_700Bold", marginTop: 2, textTransform: "uppercase" },
  statusNotice: { marginHorizontal: 16, marginBottom: 12, padding: 12, borderWidth: 1, borderRadius: 14, gap: 6 },
  reviewLink: { marginHorizontal: 16, marginBottom: 10, borderWidth: 1, borderRadius: 18, padding: 12, flexDirection: "row", alignItems: "center", gap: 10 },
  reviewLinkIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  reviewLinkTitle: { fontSize: 13, fontFamily: "Inter_800ExtraBold" },
  reviewLinkText: { fontSize: 11, fontFamily: "Inter_500Medium", lineHeight: 15, marginTop: 2 },
  reviewCount: { minWidth: 24, height: 24, borderRadius: 12, paddingHorizontal: 6, alignItems: "center", justifyContent: "center" },
  reviewCountText: { color: "#ffffff", fontSize: 11, fontFamily: "Inter_800ExtraBold" },
  modeGate: { margin: 20, marginTop: 48, borderWidth: 1, borderRadius: 24, padding: 22, alignItems: "center" },
  modeGateIcon: { width: 52, height: 52, borderRadius: 17, alignItems: "center", justifyContent: "center", marginBottom: 14 },
  modeGateTitle: { fontSize: 20, fontFamily: "Inter_800ExtraBold", marginBottom: 7 },
  modeGateText: { fontSize: 13, fontFamily: "Inter_500Medium", lineHeight: 19, textAlign: "center" },
  modeGateButton: { minHeight: 46, borderRadius: 14, alignItems: "center", justifyContent: "center", paddingHorizontal: 18, marginTop: 18 },
  modeGateButtonText: { fontSize: 14, fontFamily: "Inter_800ExtraBold" },
  totalsNote: { marginHorizontal: 16, marginTop: -4, marginBottom: 12, fontSize: 11, lineHeight: 16, fontFamily: "Inter_400Regular" },
  applyCard: { borderWidth: 1, borderRadius: 18, padding: 14, marginHorizontal: 16, marginBottom: 14, gap: 8 },
  applyOptions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  applyOption: { minHeight: 42, borderRadius: 12, paddingHorizontal: 14, justifyContent: "center" },
  filterRow: { flexDirection: "row", gap: 8, paddingHorizontal: 16, marginBottom: 2 },
  filterChip: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  filterText: { fontSize: 12, fontFamily: "Inter_800ExtraBold" },
  rowCard: { borderWidth: 1, borderRadius: 22, padding: 14, marginBottom: 12, gap: 10, shadowColor: "#000", shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.16, shadowRadius: 18, elevation: 4 },
  rowTop: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10 },
  icon: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  rowName: { fontSize: 15, fontFamily: "Inter_800ExtraBold" },
  rowSub: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  leftValue: { maxWidth: "52%", fontSize: 16, fontFamily: "Inter_800ExtraBold" },
  track: { height: 7, borderRadius: 4, overflow: "hidden" },
  fill: { height: 7, borderRadius: 4 },
  editLine: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 },
  editLabel: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  editButton: { minHeight: 44, borderRadius: 12, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 6 },
  inputLabel: { fontSize: 11, fontFamily: "Inter_700Bold", textTransform: "uppercase" },
  inputWrap: { height: 44, minWidth: 128, borderRadius: 12, flexDirection: "row", alignItems: "center", paddingHorizontal: 12 },
  dollar: { fontSize: 14, fontFamily: "Inter_700Bold", marginRight: 4 },
  input: { flex: 1, fontSize: 15, fontFamily: "Inter_700Bold" },
  actions: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  draftFooter: { marginTop: 8, marginHorizontal: 16, borderWidth: 1, borderRadius: 16, padding: 12, flexDirection: "row", alignItems: "center", gap: 12 },
  footerSave: { minHeight: 44, borderRadius: 12, paddingHorizontal: 14, justifyContent: "center", alignItems: "center" },
  actionBtn: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  actionText: { fontSize: 12, fontFamily: "Inter_800ExtraBold" },
  overlay: { flex: 1, backgroundColor: "rgba(2,6,23,0.68)", justifyContent: "flex-end" },
  sheet: { alignSelf: "center", width: "100%", maxWidth: 620, maxHeight: "95%", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 18, gap: 12 },
  handle: { alignSelf: "center", width: 48, height: 4, borderRadius: 999, opacity: 0.5 },
  sheetTitle: { fontSize: 20, fontFamily: "Inter_800ExtraBold", textAlign: "center" },
  sourceScroller: { gap: 8, paddingVertical: 2 },
  sourceList: { maxHeight: 180, flexShrink: 1 },
  sourceChip: { minHeight: 48, borderWidth: 1, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 12 },
  sourceName: { flex: 1, minWidth: 0, fontSize: 13, fontFamily: "Inter_800ExtraBold" },
  sourceMeta: { fontSize: 11, fontFamily: "Inter_500Medium", marginTop: 3 },
  error: { fontSize: 12, fontFamily: "Inter_700Bold", textAlign: "center" },
  sheetPrimary: { minHeight: 48, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  sheetPrimaryText: { fontSize: 14, fontFamily: "Inter_800ExtraBold" },
  sheetClose: { minHeight: 44, justifyContent: "center", alignItems: "center" },
});
