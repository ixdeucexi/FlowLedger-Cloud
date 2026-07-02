import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { Keyboard, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PremiumBackdrop } from "@/components/PremiumBackdrop";
import colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { useBudget } from "@/context/BudgetContext";
import { useColors } from "@/hooks/useColors";
import { applyCategoryBudgetMove, buildCategoryPlan, buildCategoryRolloverAdjustments, type CategoryPlanRow } from "@/lib/categoryPlanning";
import { CATEGORY_BUDGETS_EVENT, loadCategoryBudgets, readCategoryBudgetCache, saveCategoryBudgets } from "@/lib/categoryBudgetStore";
import { DECISION_HUB_SETTINGS_EVENT, loadDecisionHubSettings, readDecisionHubSettings, type DecisionHubSettings } from "@/lib/decisionHubSettings";

const MONTH_FULL = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const CAT_COLORS: Record<string, string> = {
  Housing: "#0f9b8e", Utilities: "#f0b429", Insurance: "#6366f1",
  Transportation: "#ec4899", Food: "#f97316", Entertainment: "#8b5cf6",
  Health: "#ef4444", Education: "#3b82f6", Savings: "#22c55e", Debt: "#e11d48", Other: "#94a3b8",
};

type Filter = "all" | "over" | "watch" | "available";

export default function CategoryBudgetScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const {
    categories,
    getMonthlyBills,
    getBillMonthlyTotal,
    getTransactionsForMonth,
    selectedYear,
  } = useBudget();
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth());
  const [year, setYear] = useState(selectedYear || now.getFullYear());
  const [filter, setFilter] = useState<Filter>("all");
  const [categoryBudgets, setCategoryBudgets] = useState<Record<string, number>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [decisionHubSettings, setDecisionHubSettings] = useState<DecisionHubSettings>(() => readDecisionHubSettings());
  const [moveTarget, setMoveTarget] = useState<CategoryPlanRow | null>(null);
  const [moveSource, setMoveSource] = useState("");
  const [moveAmount, setMoveAmount] = useState("");
  const [moveError, setMoveError] = useState("");
  const editableCategories = useMemo(() => categories.filter(category => category !== "Debt"), [categories]);

  useEffect(() => {
    let cancelled = false;
    setCategoryBudgets(readCategoryBudgetCache(month, year));
    void loadCategoryBudgets(user?.id, month, year).then(next => {
      if (!cancelled) setCategoryBudgets(next);
    });
    return () => { cancelled = true; };
  }, [month, year, user?.id]);

  useEffect(() => {
    setDrafts(Object.fromEntries(editableCategories.map(category => [category, categoryBudgets[category] === undefined ? "" : String(categoryBudgets[category])])) as Record<string, string>);
  }, [categoryBudgets, editableCategories]);

  useEffect(() => {
    let cancelled = false;
    setDecisionHubSettings(readDecisionHubSettings());
    void loadDecisionHubSettings(user?.id).then(next => {
      if (!cancelled) setDecisionHubSettings(next);
    });
    const refresh = () => setDecisionHubSettings(readDecisionHubSettings());
    globalThis.addEventListener?.(DECISION_HUB_SETTINGS_EVENT, refresh);
    return () => {
      cancelled = true;
      globalThis.removeEventListener?.(DECISION_HUB_SETTINGS_EVENT, refresh);
    };
  }, [user?.id]);

  const previousPlan = useMemo(() => {
    const previous = new Date(year, month - 1, 1);
    const previousMonth = previous.getMonth();
    const previousYear = previous.getFullYear();
    return buildCategoryPlan(
      editableCategories,
      getMonthlyBills(previousMonth, previousYear).filter(bill => !bill.is_debt).map(bill => ({ category: bill.category || "Other", amount: getBillMonthlyTotal(bill, previousMonth, previousYear) })),
      getTransactionsForMonth(previousMonth, previousYear).filter(tx => tx.category !== "Debt" && tx.category !== "Income").map(tx => ({ category: tx.category || "Other", amount: tx.amount })),
      Object.entries(readCategoryBudgetCache(previousMonth, previousYear)).map(([category, amount]) => ({ category, amount })),
    );
  }, [editableCategories, getBillMonthlyTotal, getMonthlyBills, getTransactionsForMonth, month, year]);

  const categoryPlan = useMemo(() => {
    const rollovers = buildCategoryRolloverAdjustments(previousPlan, decisionHubSettings.categoryRolloverEnabled);
    return buildCategoryPlan(
      editableCategories,
      getMonthlyBills(month, year).filter(bill => !bill.is_debt).map(bill => ({ category: bill.category || "Other", amount: getBillMonthlyTotal(bill, month, year) })),
      getTransactionsForMonth(month, year).filter(tx => tx.category !== "Debt" && tx.category !== "Income").map(tx => ({ category: tx.category || "Other", amount: tx.amount })),
      Object.entries(categoryBudgets).map(([category, amount]) => ({ category, amount })),
      rollovers,
    ).sort((left, right) => statusRank(left.status) - statusRank(right.status) || left.remaining - right.remaining);
  }, [categoryBudgets, decisionHubSettings.categoryRolloverEnabled, editableCategories, getBillMonthlyTotal, getMonthlyBills, getTransactionsForMonth, month, previousPlan, year]);

  const visibleRows = categoryPlan.filter(row => filter === "all" || row.status === filter);
  const sourceOptions = categoryPlan.filter(row => moveTarget && row.category !== moveTarget.category && row.remaining > 0.005);
  const totals = categoryPlan.reduce((sum, row) => ({
    planned: sum.planned + row.budgeted,
    spent: sum.spent + row.spent,
    left: sum.left + row.remaining,
  }), { planned: 0, spent: 0, left: 0 });

  const persistBudgets = (next: Record<string, number>) => {
    setCategoryBudgets(next);
    void saveCategoryBudgets(user?.id, month, year, next).catch(() => undefined);
    globalThis.dispatchEvent?.(new Event(CATEGORY_BUDGETS_EVENT));
  };

  const saveDrafts = () => {
    const next: Record<string, number> = {};
    Object.entries(drafts).forEach(([category, raw]) => {
      const parsed = Number(raw);
      if (Number.isFinite(parsed) && parsed >= 0) next[category] = parsed;
    });
    persistBudgets(next);
    Keyboard.dismiss();
  };

  const shiftMonth = (delta: number) => {
    const next = new Date(year, month + delta, 1);
    setMonth(next.getMonth());
    setYear(next.getFullYear());
  };

  const openMove = (row: CategoryPlanRow) => {
    const source = categoryPlan.filter(item => item.category !== row.category && item.remaining > 0.005).sort((a, b) => b.remaining - a.remaining)[0];
    setMoveTarget(row);
    setMoveSource(source?.category ?? "");
    setMoveAmount(row.remaining < 0 ? Math.abs(row.remaining).toFixed(0) : "");
    setMoveError("");
  };

  const applyMove = () => {
    if (!moveTarget || !moveSource) return;
    const amount = Number(moveAmount);
    const source = categoryPlan.find(row => row.category === moveSource);
    if (!Number.isFinite(amount) || amount <= 0 || amount > (source?.remaining ?? 0) + 0.005) {
      setMoveError(`You can move up to $${Math.max(0, source?.remaining ?? 0).toFixed(0)} from ${moveSource}.`);
      return;
    }
    persistBudgets(applyCategoryBudgetMove(categoryBudgets, categoryPlan, moveSource, moveTarget.category, amount));
    setMoveTarget(null);
  };

  return (
    <View style={[styles.screen, { backgroundColor: c.background, paddingTop: insets.top + 10 }]}>
      <PremiumBackdrop variant="green" />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={[styles.backBtn, { backgroundColor: c.card }]}>
          <Feather name="chevron-left" size={20} color={c.foreground} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: c.foreground }]}>Category Budget</Text>
          <Text style={[styles.subtitle, { color: c.mutedForeground }]}>Safe-to-spend by category</Text>
        </View>
        <Pressable onPress={saveDrafts} style={[styles.saveBtn, { backgroundColor: c.primary }]}>
          <Text style={[styles.saveText, { color: c.primaryForeground }]}>Save</Text>
        </Pressable>
      </View>

      <View style={[styles.monthCard, { backgroundColor: c.card }]}>
        <Pressable onPress={() => shiftMonth(-1)} style={styles.monthBtn}><Feather name="chevron-left" size={18} color={c.foreground} /></Pressable>
        <Text style={[styles.monthTitle, { color: c.foreground }]}>{MONTH_FULL[month]} {year}</Text>
        <Pressable onPress={() => shiftMonth(1)} style={styles.monthBtn}><Feather name="chevron-right" size={18} color={c.foreground} /></Pressable>
      </View>

      <View style={styles.summaryRow}>
        <SummaryBox label="Planned" value={`$${totals.planned.toFixed(0)}`} color={c.primary} />
        <SummaryBox label="Spent" value={`$${totals.spent.toFixed(0)}`} color={c.destructive} />
        <SummaryBox label="Left" value={`${totals.left < 0 ? "-" : ""}$${Math.abs(totals.left).toFixed(0)}`} color={totals.left < 0 ? c.destructive : c.success} />
      </View>

      <View style={styles.filterRow}>
        {(["all", "over", "watch", "available"] as Filter[]).map(item => (
          <Pressable key={item} onPress={() => setFilter(item)} style={[styles.filterChip, { backgroundColor: filter === item ? c.primary : c.card }]}>
            <Text style={[styles.filterText, { color: filter === item ? c.primaryForeground : c.mutedForeground }]}>{item === "all" ? "All" : item[0].toUpperCase() + item.slice(1)}</Text>
          </Pressable>
        ))}
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 96 }} keyboardShouldPersistTaps="handled">
        {visibleRows.map(row => {
          const color = row.status === "over" ? c.destructive : row.status === "watch" ? c.warning : CAT_COLORS[row.category] ?? c.primary;
          return (
            <View key={row.category} style={[styles.rowCard, { backgroundColor: c.card, borderColor: c.border }]}>
              <View style={styles.rowTop}>
                <View style={[styles.icon, { backgroundColor: color + "18" }]}>
                  <Feather name={row.status === "over" ? "alert-triangle" : row.status === "watch" ? "eye" : "tag"} size={15} color={color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowName, { color: c.foreground }]}>{row.category}</Text>
                  <Text style={[styles.rowSub, { color: c.mutedForeground }]}>Spent ${row.spent.toFixed(0)} of ${row.budgeted.toFixed(0)}{row.rollover ? ` · rollover ${row.rollover < 0 ? "-" : "+"}$${Math.abs(row.rollover).toFixed(0)}` : ""}</Text>
                </View>
                <Text style={[styles.leftValue, { color }]}>{row.remaining < 0 ? "-" : ""}${Math.abs(row.remaining).toFixed(0)}</Text>
              </View>
              <View style={[styles.track, { backgroundColor: c.muted }]}>
                <View style={[styles.fill, { backgroundColor: color, width: `${Math.min(100, row.percentUsed)}%` as any }]} />
              </View>
              <View style={styles.editLine}>
                <Text style={[styles.inputLabel, { color: c.mutedForeground }]}>Monthly budget</Text>
                <View style={[styles.inputWrap, { backgroundColor: c.muted }]}>
                  <Text style={[styles.dollar, { color: c.mutedForeground }]}>$</Text>
                  <TextInput
                    value={drafts[row.category] ?? ""}
                    onChangeText={value => setDrafts(previous => ({ ...previous, [row.category]: value }))}
                    keyboardType="decimal-pad"
                    placeholder={row.budgeted.toFixed(0)}
                    placeholderTextColor={c.mutedForeground}
                    style={[styles.input, { color: c.foreground }]}
                  />
                </View>
              </View>
              <View style={styles.actions}>
                <Pressable onPress={() => openMove(row)} style={[styles.actionBtn, { backgroundColor: c.success + "18" }]}>
                  <Text style={[styles.actionText, { color: c.success }]}>Move money</Text>
                </Pressable>
                <Pressable onPress={() => router.push({ pathname: "/(tabs)/flo", params: { prompt: row.remaining < 0 ? `Why is ${row.category} over?` : `How much do I have left for ${row.category}?` } } as any)} style={[styles.actionBtn, { backgroundColor: c.primary + "18" }]}>
                  <Text style={[styles.actionText, { color: c.primary }]}>Ask Flo</Text>
                </Pressable>
              </View>
            </View>
          );
        })}
      </ScrollView>

      <Modal visible={!!moveTarget} transparent animationType="slide" onRequestClose={() => setMoveTarget(null)}>
        <Pressable style={styles.overlay} onPress={() => setMoveTarget(null)}>
          <Pressable style={[styles.sheet, { backgroundColor: c.card }]} onPress={() => {}}>
            <View style={[styles.handle, { backgroundColor: c.mutedForeground }]} />
            <Text style={[styles.sheetTitle, { color: c.foreground }]}>Move money to {moveTarget?.category}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sourceScroller}>
              {sourceOptions.map(row => (
                <Pressable key={row.category} onPress={() => setMoveSource(row.category)} style={[styles.sourceChip, { backgroundColor: moveSource === row.category ? c.primary : c.muted, borderColor: moveSource === row.category ? c.primary : c.border }]}>
                  <Text style={[styles.sourceName, { color: moveSource === row.category ? c.primaryForeground : c.foreground }]}>{row.category}</Text>
                  <Text style={[styles.sourceMeta, { color: moveSource === row.category ? c.primaryForeground : c.mutedForeground }]}>${row.remaining.toFixed(0)} left</Text>
                </Pressable>
              ))}
            </ScrollView>
            <View style={[styles.inputWrap, { backgroundColor: c.muted, marginBottom: 8 }]}>
              <Text style={[styles.dollar, { color: c.mutedForeground }]}>$</Text>
              <TextInput value={moveAmount} onChangeText={setMoveAmount} keyboardType="decimal-pad" placeholder="Amount" placeholderTextColor={c.mutedForeground} style={[styles.input, { color: c.foreground }]} />
            </View>
            {moveError ? <Text style={[styles.error, { color: c.destructive }]}>{moveError}</Text> : null}
            <Pressable onPress={applyMove} style={[styles.sheetPrimary, { backgroundColor: c.primary }]}>
              <Text style={[styles.sheetPrimaryText, { color: c.primaryForeground }]}>Apply move</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function SummaryBox({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={styles.summaryBox}>
      <Text style={[styles.summaryValue, { color }]}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

function statusRank(status: CategoryPlanRow["status"]) {
  if (status === "over") return 0;
  if (status === "watch") return 1;
  return 2;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20, paddingBottom: 14 },
  backBtn: { width: 44, height: 44, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 28, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.8 },
  subtitle: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  saveBtn: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12 },
  saveText: { fontSize: 13, fontFamily: "Inter_800ExtraBold" },
  monthCard: { marginHorizontal: 16, borderRadius: 20, padding: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12, borderWidth: 1, borderColor: "rgba(148,163,184,0.12)" },
  monthBtn: { padding: 6 },
  monthTitle: { fontSize: 16, fontFamily: "Inter_800ExtraBold" },
  summaryRow: { flexDirection: "row", gap: 8, paddingHorizontal: 16, marginBottom: 10 },
  summaryBox: { flex: 1, borderRadius: 14, paddingVertical: 12, alignItems: "center", backgroundColor: "rgba(148,163,184,0.10)" },
  summaryValue: { fontSize: 17, fontFamily: "Inter_800ExtraBold" },
  summaryLabel: { fontSize: 10, fontFamily: "Inter_700Bold", color: "#94a3b8", marginTop: 2, textTransform: "uppercase" },
  filterRow: { flexDirection: "row", gap: 8, paddingHorizontal: 16, marginBottom: 2 },
  filterChip: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  filterText: { fontSize: 12, fontFamily: "Inter_800ExtraBold" },
  rowCard: { borderWidth: 1, borderRadius: 22, padding: 14, marginBottom: 12, gap: 10, shadowColor: "#000", shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.16, shadowRadius: 18, elevation: 4 },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  icon: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  rowName: { fontSize: 15, fontFamily: "Inter_800ExtraBold" },
  rowSub: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  leftValue: { fontSize: 16, fontFamily: "Inter_800ExtraBold" },
  track: { height: 7, borderRadius: 4, overflow: "hidden" },
  fill: { height: 7, borderRadius: 4 },
  editLine: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  inputLabel: { fontSize: 11, fontFamily: "Inter_700Bold", textTransform: "uppercase" },
  inputWrap: { height: 44, minWidth: 128, borderRadius: 12, flexDirection: "row", alignItems: "center", paddingHorizontal: 12 },
  dollar: { fontSize: 14, fontFamily: "Inter_700Bold", marginRight: 4 },
  input: { flex: 1, fontSize: 15, fontFamily: "Inter_700Bold" },
  actions: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  actionBtn: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  actionText: { fontSize: 12, fontFamily: "Inter_800ExtraBold" },
  overlay: { flex: 1, backgroundColor: "rgba(2,6,23,0.68)", justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 18, gap: 12 },
  handle: { alignSelf: "center", width: 48, height: 4, borderRadius: 999, opacity: 0.5 },
  sheetTitle: { fontSize: 20, fontFamily: "Inter_800ExtraBold", textAlign: "center" },
  sourceScroller: { gap: 8, paddingVertical: 2 },
  sourceChip: { minWidth: 130, borderWidth: 1, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10 },
  sourceName: { fontSize: 13, fontFamily: "Inter_800ExtraBold" },
  sourceMeta: { fontSize: 11, fontFamily: "Inter_500Medium", marginTop: 3 },
  error: { fontSize: 12, fontFamily: "Inter_700Bold", textAlign: "center" },
  sheetPrimary: { minHeight: 48, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  sheetPrimaryText: { fontSize: 14, fontFamily: "Inter_800ExtraBold" },
});
