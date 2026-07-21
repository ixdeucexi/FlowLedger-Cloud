"use client";

import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PremiumBackdrop } from "@/components/PremiumBackdrop";
import { useAuth } from "@/context/AuthContext";
import { useMembership } from "@/context/MembershipContext";
import { useColors } from "@/hooks/useColors";
import { confirmAction } from "@/lib/confirmAction";
import {
  applyZeroBudgetMoney,
  categorizeZeroBudgetTransaction,
  createZeroBudgetLabState,
  formatZeroBudgetMonth,
  loadZeroBudgetLabState,
  moveZeroBudgetCategory,
  postZeroBudgetTransaction,
  resetZeroBudgetLabState,
  saveZeroBudgetLabState,
  shiftZeroBudgetMonth,
  summarizeZeroBudget,
  type ZeroBudgetLabCategory,
  type ZeroBudgetLabGroup,
  type ZeroBudgetLabState,
  type ZeroBudgetCategorySummary,
  type ZeroBudgetMonthSummary,
  type ZeroBudgetMoneyAction,
  type ZeroBudgetTargetCadence,
} from "@/lib/zeroBudgetLab";

type LabView = "plan" | "edit" | "settings";
type AssignmentMode = "add" | "subtract" | "set";
type LabColors = ReturnType<typeof useColors>;
type MoneyFormatter = (value: number, digits?: number) => string;
type FeatherName = React.ComponentProps<typeof Feather>["name"];

interface PlanViewProps {
  c: LabColors;
  state: ZeroBudgetLabState;
  summary: ZeroBudgetMonthSummary;
  money: MoneyFormatter;
  bottomInset: number;
  onMonth: () => void;
  onShiftMonth: (delta: number) => void;
  onToggleGroup: (groupId: string) => void;
  onAssign: (categoryId: string) => void;
  onTestSpending: () => void;
  onReviewTransaction: (transactionId: string) => void;
  onPostTransaction: (transactionId: string) => void;
}

interface EditPlanViewProps {
  c: LabColors;
  state: ZeroBudgetLabState;
  summary: ZeroBudgetMonthSummary;
  incomeText: string;
  bottomInset: number;
  onIncomeText: (value: string) => void;
  onSaveIncome: () => void;
  onEditCategory: (category: ZeroBudgetLabCategory) => void;
  onAddCategory: (groupId: string) => void;
  onMoveCategory: (categoryId: string, direction: -1 | 1) => void;
  onEditGroup: (group: ZeroBudgetLabGroup) => void;
  onAddGroup: () => void;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const KEY_PAD = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "backspace"];

export default function ZeroBudgetLabScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { isAdmin, loading: membershipLoading } = useMembership();
  const [state, setState] = useState<ZeroBudgetLabState>(() => createZeroBudgetLabState());
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState<LabView>("plan");
  const [menuVisible, setMenuVisible] = useState(false);
  const [monthVisible, setMonthVisible] = useState(false);
  const [pickerAction, setPickerAction] = useState<ZeroBudgetMoneyAction | null>(null);
  const [moneyCategoryId, setMoneyCategoryId] = useState<string | null>(null);
  const [moneyAction, setMoneyAction] = useState<ZeroBudgetMoneyAction>("assign");
  const [assignmentMode, setAssignmentMode] = useState<AssignmentMode>("add");
  const [moneyText, setMoneyText] = useState("");
  const [categoryForm, setCategoryForm] = useState<ZeroBudgetLabCategory | null>(null);
  const [categoryFormNew, setCategoryFormNew] = useState(false);
  const [groupForm, setGroupForm] = useState<ZeroBudgetLabGroup | null>(null);
  const [groupFormNew, setGroupFormNew] = useState(false);
  const [incomeText, setIncomeText] = useState("");
  const [transactionPickerId, setTransactionPickerId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!user?.id || !isAdmin) {
      setLoaded(true);
      return () => { cancelled = true; };
    }
    void loadZeroBudgetLabState(user.id).then(next => {
      if (!cancelled) {
        setState(next);
        setLoaded(true);
      }
    });
    return () => { cancelled = true; };
  }, [isAdmin, user?.id]);

  useEffect(() => {
    if (!loaded || !user?.id || !isAdmin) return;
    void saveZeroBudgetLabState(user.id, state).catch(() => undefined);
  }, [isAdmin, loaded, state, user?.id]);

  useEffect(() => {
    const income = state.incomeByMonth[state.selectedMonth] ?? state.defaultMonthlyIncome;
    setIncomeText(income.toFixed(2));
  }, [state.defaultMonthlyIncome, state.incomeByMonth, state.selectedMonth]);

  const summary = useMemo(() => summarizeZeroBudget(state), [state]);
  const selectedMoneyCategory = state.categories.find(category => category.id === moneyCategoryId) ?? null;
  const selectedMoneySummary = summary.categories.find(row => row.category.id === moneyCategoryId) ?? null;
  const selectedTransaction = state.transactions.find(transaction => transaction.id === transactionPickerId) ?? null;

  const money = (value: number, digits = 2) => state.hideAmounts
    ? "••••"
    : `$${Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;

  const exitLab = () => router.back();

  const resetLab = () => {
    if (!user?.id) return;
    confirmAction({
      title: "Reset sample plan?",
      message: "This resets only the Zero Budget Lab. Your real household stays untouched.",
      confirmText: "Reset lab",
      destructive: true,
      onConfirm: async () => {
        setState(await resetZeroBudgetLabState(user.id));
        setMenuVisible(false);
        setView("plan");
      },
    });
  };

  const openMoney = (categoryId: string, action: ZeroBudgetMoneyAction) => {
    setMoneyCategoryId(categoryId);
    setMoneyAction(action);
    setAssignmentMode("add");
    setMoneyText("");
    setPickerAction(null);
  };

  const typeMoneyKey = (key: string) => {
    if (key === "backspace") {
      setMoneyText(value => value.slice(0, -1));
      return;
    }
    setMoneyText(value => {
      if (key === "." && value.includes(".")) return value;
      if (value.includes(".") && value.split(".")[1].length >= 2) return value;
      return `${value}${key}`.replace(/^0+(?=\d)/, "");
    });
  };

  const applyMoney = () => {
    if (!moneyCategoryId) return;
    const amount = Number(moneyText);
    if (!Number.isFinite(amount) || amount <= 0) return;
    setState(previous => applyZeroBudgetMoney(previous, moneyCategoryId, amount, moneyAction, assignmentMode));
    setMoneyCategoryId(null);
    setMoneyText("");
  };

  const saveIncome = () => {
    const amount = Math.max(0, Number(incomeText) || 0);
    setState(previous => ({
      ...previous,
      defaultMonthlyIncome: amount,
      incomeByMonth: { ...previous.incomeByMonth, [previous.selectedMonth]: amount },
    }));
  };

  const toggleGroup = (groupId: string) => {
    setState(previous => ({
      ...previous,
      groups: previous.groups.map(group => group.id === groupId ? { ...group, collapsed: !group.collapsed } : group),
    }));
  };

  const openNewCategory = (groupId: string) => {
    setCategoryForm({
      id: `category-${Date.now()}`,
      groupId,
      name: "",
      emoji: "✨",
      targetAmount: 0,
      targetCadence: "monthly",
      assignedByMonth: {},
      spentByMonth: {},
    });
    setCategoryFormNew(true);
  };

  const saveCategory = () => {
    if (!categoryForm?.name.trim()) return;
    setState(previous => ({
      ...previous,
      categories: categoryFormNew
        ? [...previous.categories, { ...categoryForm, name: categoryForm.name.trim(), targetAmount: Math.max(0, Number(categoryForm.targetAmount) || 0) }]
        : previous.categories.map(category => category.id === categoryForm.id
          ? { ...categoryForm, name: categoryForm.name.trim(), targetAmount: Math.max(0, Number(categoryForm.targetAmount) || 0) }
          : category),
    }));
    setCategoryForm(null);
    setCategoryFormNew(false);
  };

  const deleteCategory = () => {
    if (!categoryForm || categoryFormNew) return;
    const categoryId = categoryForm.id;
    confirmAction({
      title: "Remove sample category?",
      message: "This removes it only from the admin lab.",
      confirmText: "Remove",
      destructive: true,
      onConfirm: () => {
        setState(previous => ({ ...previous, categories: previous.categories.filter(category => category.id !== categoryId) }));
        setCategoryForm(null);
      },
    });
  };

  const openNewGroup = () => {
    setGroupForm({ id: `group-${Date.now()}`, name: "", collapsed: false });
    setGroupFormNew(true);
  };

  const saveGroup = () => {
    if (!groupForm?.name.trim()) return;
    setState(previous => ({
      ...previous,
      groups: groupFormNew
        ? [...previous.groups, { ...groupForm, name: groupForm.name.trim() }]
        : previous.groups.map(group => group.id === groupForm.id ? { ...groupForm, name: groupForm.name.trim() } : group),
    }));
    setGroupForm(null);
    setGroupFormNew(false);
  };

  const deleteGroup = () => {
    if (!groupForm || groupFormNew) return;
    const groupId = groupForm.id;
    const categoryCount = state.categories.filter(category => category.groupId === groupId).length;
    if (categoryCount) return;
    setState(previous => ({ ...previous, groups: previous.groups.filter(group => group.id !== groupId) }));
    setGroupForm(null);
  };

  if (membershipLoading || !loaded) {
    return <View style={[styles.screen, styles.center, { backgroundColor: c.background }]}><Text style={{ color: c.mutedForeground }}>Preparing Zero Budget Lab…</Text></View>;
  }

  if (!isAdmin) {
    return (
      <View style={[styles.screen, styles.center, { backgroundColor: c.background, padding: 24 }]}>
        <PremiumBackdrop variant="purple" />
        <View style={[styles.accessCard, { backgroundColor: c.card, borderColor: c.border }]}>
          <Feather name="shield" size={30} color={c.primary} />
          <Text style={[styles.accessTitle, { color: c.foreground }]}>Admin test environment</Text>
          <Text style={[styles.accessText, { color: c.mutedForeground }]}>This isolated Zero Budget Lab is available only to approved FlowLedger admins.</Text>
          <Pressable onPress={exitLab} style={[styles.primaryButton, { backgroundColor: c.primary }]}><Text style={[styles.primaryButtonText, { color: c.primaryForeground }]}>Go back</Text></Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: c.background, paddingTop: insets.top }]}>
      <PremiumBackdrop variant={view === "settings" ? "purple" : "green"} />
      <View style={[styles.header, { borderBottomColor: c.border }]}>
        <Pressable onPress={view === "plan" ? exitLab : () => setView("plan")} style={styles.headerButton} accessibilityLabel={view === "plan" ? "Exit Zero Budget Lab" : "Back to plan"}>
          <Feather name="arrow-left" size={22} color={c.foreground} />
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={[styles.headerTitle, { color: c.foreground }]}>{view === "plan" ? "Zero Budget Lab" : view === "edit" ? "Edit Plan" : "Lab Settings"}</Text>
          <Text style={[styles.headerSubtitle, { color: c.primary }]}>ADMIN TEST ENVIRONMENT</Text>
        </View>
        {view === "edit" ? (
          <Pressable onPress={() => setView("plan")} style={[styles.doneButton, { backgroundColor: c.primary }]}><Text style={[styles.doneText, { color: c.primaryForeground }]}>Done</Text></Pressable>
        ) : (
          <Pressable onPress={() => setMenuVisible(true)} style={styles.headerButton} accessibilityLabel="Open lab menu"><Feather name="more-vertical" size={23} color={c.foreground} /></Pressable>
        )}
      </View>

      <View style={[styles.isolationBanner, { backgroundColor: c.primary + "18", borderColor: c.primary + "45" }]}>
        <Feather name="shield" size={15} color={c.primary} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.isolationTitle, { color: c.foreground }]}>Sample money only</Text>
          <Text style={[styles.isolationText, { color: c.mutedForeground }]}>Nothing here changes your bank, household, calendar, bills, or real plan.</Text>
        </View>
      </View>

      {view === "plan" ? (
        <PlanView
          c={c}
          state={state}
          summary={summary}
          money={money}
          bottomInset={insets.bottom}
          onMonth={() => setMonthVisible(true)}
          onShiftMonth={(delta: number) => setState(previous => ({ ...previous, selectedMonth: shiftZeroBudgetMonth(previous.selectedMonth, delta) }))}
          onToggleGroup={toggleGroup}
          onAssign={(categoryId: string) => openMoney(categoryId, "assign")}
          onTestSpending={() => setPickerAction("spend")}
          onReviewTransaction={setTransactionPickerId}
          onPostTransaction={(transactionId: string) => setState(previous => postZeroBudgetTransaction(previous, transactionId))}
        />
      ) : view === "edit" ? (
        <EditPlanView
          c={c}
          state={state}
          summary={summary}
          incomeText={incomeText}
          bottomInset={insets.bottom}
          onIncomeText={setIncomeText}
          onSaveIncome={saveIncome}
          onEditCategory={(category: ZeroBudgetLabCategory) => { setCategoryForm({ ...category }); setCategoryFormNew(false); }}
          onAddCategory={openNewCategory}
          onMoveCategory={(id: string, direction: -1 | 1) => setState(previous => moveZeroBudgetCategory(previous, id, direction))}
          onEditGroup={(group: ZeroBudgetLabGroup) => { setGroupForm({ ...group }); setGroupFormNew(false); }}
          onAddGroup={openNewGroup}
        />
      ) : (
        <SettingsView c={c} state={state} bottomInset={insets.bottom} onEdit={() => setView("edit")} onToggleHide={() => setState(previous => ({ ...previous, hideAmounts: !previous.hideAmounts }))} onReset={resetLab} onExit={exitLab} />
      )}

      <ActionSheet visible={menuVisible} title="Zero Budget Lab" onClose={() => setMenuVisible(false)} c={c}>
        <SheetRow c={c} icon="edit-3" label="Edit plan" onPress={() => { setMenuVisible(false); setView("edit"); }} />
        <SheetRow c={c} icon="settings" label="Lab settings" onPress={() => { setMenuVisible(false); setView("settings"); }} />
        <SheetRow c={c} icon="refresh-cw" label="Reset sample plan" onPress={resetLab} />
        <SheetRow c={c} icon="log-out" label="Exit test environment" destructive onPress={exitLab} />
      </ActionSheet>

      <MonthPicker visible={monthVisible} value={state.selectedMonth} c={c} onClose={() => setMonthVisible(false)} onChange={(value: string) => { setState(previous => ({ ...previous, selectedMonth: value })); setMonthVisible(false); }} />

      <CategoryPicker visible={Boolean(pickerAction)} action={pickerAction ?? "spend"} categories={state.categories} c={c} onClose={() => setPickerAction(null)} onPick={(categoryId: string) => openMoney(categoryId, pickerAction ?? "spend")} />

      <CategoryPicker
        visible={Boolean(transactionPickerId)}
        action="spend"
        title={selectedTransaction ? `Apply ${selectedTransaction.name} to a category` : "Choose a category"}
        categories={state.categories}
        c={c}
        onClose={() => setTransactionPickerId(null)}
        onPick={(categoryId: string) => {
          if (transactionPickerId) setState(previous => categorizeZeroBudgetTransaction(previous, transactionPickerId, categoryId));
          setTransactionPickerId(null);
        }}
      />

      <MoneySheet
        visible={Boolean(selectedMoneyCategory)}
        c={c}
        category={selectedMoneyCategory}
        categorySummary={selectedMoneySummary}
        action={moneyAction}
        assignmentMode={assignmentMode}
        value={moneyText}
        readyToAssign={summary.readyToAssign}
        onClose={() => setMoneyCategoryId(null)}
        onMode={setAssignmentMode}
        onKey={typeMoneyKey}
        onApply={applyMoney}
      />

      <CategoryEditor visible={Boolean(categoryForm)} c={c} category={categoryForm} groups={state.groups} isNew={categoryFormNew} onChange={setCategoryForm} onClose={() => setCategoryForm(null)} onSave={saveCategory} onDelete={deleteCategory} />
      <GroupEditor visible={Boolean(groupForm)} c={c} group={groupForm} isNew={groupFormNew} canDelete={Boolean(groupForm && !state.categories.some(category => category.groupId === groupForm.id))} onChange={setGroupForm} onClose={() => setGroupForm(null)} onSave={saveGroup} onDelete={deleteGroup} />
    </View>
  );
}

function PlanView({ c, state, summary, money, bottomInset, onMonth, onShiftMonth, onToggleGroup, onAssign, onTestSpending, onReviewTransaction, onPostTransaction }: PlanViewProps) {
  const readyColor = summary.readyToAssign < -0.005 ? c.destructive : summary.readyToAssign <= 0.005 ? c.success : c.primary;
  const transactions = state.transactions
    .filter(transaction => transaction.date.startsWith(state.selectedMonth))
    .sort((left, right) => right.date.localeCompare(left.date));
  const reviewCount = transactions.filter(transaction => transaction.status === "needs_review").length;
  const pendingCount = transactions.filter(transaction => transaction.status === "pending").length;
  return (
    <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottomInset + 116 }]}>
      <View style={[styles.monthBar, { backgroundColor: c.card, borderColor: c.border }]}>
        <Pressable onPress={() => onShiftMonth(-1)} style={styles.monthArrow}><Feather name="chevron-left" size={20} color={c.mutedForeground} /></Pressable>
        <Pressable onPress={onMonth} style={styles.monthCenter}><Text style={[styles.monthTitle, { color: c.foreground }]}>{formatZeroBudgetMonth(state.selectedMonth)}</Text><Feather name="chevron-down" size={16} color={c.primary} /></Pressable>
        <Pressable onPress={() => onShiftMonth(1)} style={styles.monthArrow}><Feather name="chevron-right" size={20} color={c.mutedForeground} /></Pressable>
      </View>

      <View style={[styles.readyCard, { backgroundColor: readyColor + "18", borderColor: readyColor + "55" }]}>
        <Text style={[styles.readyValue, { color: readyColor }]}>{money(summary.readyToAssign)}</Text>
        <Text style={[styles.readyTitle, { color: c.foreground }]}>{summary.readyToAssign < -0.005 ? "Overassigned" : "Ready to Assign"}</Text>
        <Text style={[styles.readyText, { color: c.mutedForeground }]}>{summary.readyToAssign > 0.005 ? "Keep giving your income a job until this reaches zero." : summary.readyToAssign < -0.005 ? "Move money out of a category until your plan reaches zero." : "Every dollar has a job."}</Text>
        <View style={styles.readyStats}><SmallStat label="Income" value={money(summary.income)} color={c.success} /><SmallStat label="Assigned" value={money(summary.assigned)} color={c.primary} /><SmallStat label="Spent" value={money(summary.spent)} color={c.warning} /></View>
      </View>

      <View style={[styles.transactionCard, { backgroundColor: c.card, borderColor: c.border }]}>
        <View style={styles.transactionHeader}>
          <View style={[styles.transactionHeaderIcon, { backgroundColor: c.primary + "18" }]}><Feather name="credit-card" size={18} color={c.primary} /></View>
          <View style={{ flex: 1 }}><Text style={[styles.transactionTitle, { color: c.foreground }]}>Fake bank activity</Text><Text style={[styles.transactionSubtitle, { color: c.mutedForeground }]}>{reviewCount} to review{pendingCount ? ` · ${pendingCount} pending` : ""}</Text></View>
        </View>
        {transactions.map((transaction, index) => {
          const category = state.categories.find(item => item.id === transaction.categoryId);
          const isPending = transaction.status === "pending";
          const isReviewed = transaction.status === "categorized";
          const tone = isPending ? c.warning : isReviewed ? c.success : c.primary;
          return <Pressable
            key={transaction.id}
            onPress={() => { if (!isPending) onReviewTransaction(transaction.id); }}
            style={[styles.transactionRow, index > 0 && { borderTopColor: c.border, borderTopWidth: StyleSheet.hairlineWidth }]}
          >
            <View style={[styles.transactionIcon, { backgroundColor: tone + "18" }]}><Feather name={isPending ? "clock" : isReviewed ? "check" : "tag"} size={15} color={tone} /></View>
            <View style={{ flex: 1, minWidth: 0 }}><Text style={[styles.transactionName, { color: c.foreground }]} numberOfLines={1}>{transaction.name}</Text><Text style={[styles.transactionMeta, { color: c.mutedForeground }]}>{isPending ? "Pending · not counted" : isReviewed ? `Applied to ${category?.name ?? "category"} · tap to change` : "Posted · tap to choose a category"}</Text></View>
            <View style={styles.transactionAmountWrap}><Text style={[styles.transactionAmount, { color: c.destructive }]}>−{money(transaction.amount)}</Text>{isPending ? <Pressable onPress={() => onPostTransaction(transaction.id)} style={[styles.postButton, { backgroundColor: c.warning + "18" }]}><Text style={[styles.postButtonText, { color: c.warning }]}>Post for test</Text></Pressable> : <Text style={[styles.transactionStatus, { color: tone }]}>{isReviewed ? "APPLIED" : "REVIEW"}</Text>}</View>
          </Pressable>;
        })}
      </View>

      {state.groups.map((group: ZeroBudgetLabGroup) => {
        const rows = summary.categories.filter(row => row.category.groupId === group.id);
        const available = rows.reduce((sum, row) => sum + row.available, 0);
        return (
          <View key={group.id} style={styles.groupSection}>
            <Pressable onPress={() => onToggleGroup(group.id)} style={[styles.groupHeader, { backgroundColor: c.card, borderColor: c.border }]}>
              <Feather name={group.collapsed ? "chevron-right" : "chevron-down"} size={18} color={c.foreground} />
              <Text style={[styles.groupName, { color: c.foreground }]}>{group.name}</Text>
              <View><Text style={[styles.groupAmount, { color: available < 0 ? c.destructive : c.foreground }]}>{money(available)}</Text><Text style={[styles.groupCaption, { color: c.mutedForeground }]}>AVAILABLE</Text></View>
            </Pressable>
            {!group.collapsed && <View style={[styles.categoryList, { backgroundColor: c.card, borderColor: c.border }]}>
              {rows.map((row, index) => <BudgetCategoryRow key={row.category.id} c={c} row={row} money={money} first={index === 0} onPress={() => onAssign(row.category.id)} />)}
            </View>}
          </View>
        );
      })}
      <Pressable onPress={onTestSpending} style={[styles.floatingAction, { backgroundColor: c.primary }]}><Feather name="plus" size={20} color={c.primaryForeground} /><Text style={[styles.floatingText, { color: c.primaryForeground }]}>Test transaction</Text></Pressable>
    </ScrollView>
  );
}

function BudgetCategoryRow({ c, row, money, first, onPress }: { c: LabColors; row: ZeroBudgetCategorySummary; money: MoneyFormatter; first: boolean; onPress: () => void }) {
  const tone = row.status === "overspent" ? c.destructive : row.status === "funded" ? c.success : row.status === "partial" ? c.warning : c.mutedForeground;
  const helper = row.status === "overspent"
    ? `${money(Math.abs(row.available))} overspent`
    : row.status === "funded"
      ? "Funded"
      : row.monthlyTarget <= 0
        ? "Add a target"
        : `${money(row.needed)} more needed${row.category.dueDay ? ` by the ${ordinal(row.category.dueDay)}` : " this month"}`;
  return (
    <Pressable onPress={onPress} style={[styles.categoryRow, !first && { borderTopWidth: 1, borderTopColor: c.border }]}>
      <Text style={styles.emoji}>{row.category.emoji}</Text>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={styles.categoryTop}><Text style={[styles.categoryName, { color: c.foreground }]} numberOfLines={1}>{row.category.name}</Text><Text style={[styles.availablePill, { color: tone, backgroundColor: tone + "18" }]}>{row.available < 0 ? "-" : ""}{money(row.available)}</Text></View>
        <View style={[styles.progressTrack, { backgroundColor: c.muted }]}><View style={[styles.progressFill, { backgroundColor: tone, width: `${row.status === "overspent" ? 100 : row.progress}%` }]} /></View>
        <Text style={[styles.categoryHelper, { color: row.status === "overspent" ? c.destructive : c.mutedForeground }]}>{helper}</Text>
      </View>
    </Pressable>
  );
}

function EditPlanView({ c, state, summary, incomeText, bottomInset, onIncomeText, onSaveIncome, onEditCategory, onAddCategory, onMoveCategory, onEditGroup, onAddGroup }: EditPlanViewProps) {
  return (
    <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottomInset + 110 }]} keyboardShouldPersistTaps="handled">
      <View style={[styles.costHero, { backgroundColor: c.primary + "18", borderColor: c.primary + "45" }]}><Text style={[styles.costValue, { color: c.foreground }]}>${summary.monthlyTargets.toFixed(2)}</Text><Text style={[styles.costLabel, { color: c.primary }]}>MONTHLY TARGETS</Text></View>
      <View style={[styles.incomeEditor, { backgroundColor: c.card, borderColor: c.border }]}>
        <View style={{ flex: 1 }}><Text style={[styles.settingTitle, { color: c.foreground }]}>Expected monthly income</Text><Text style={[styles.settingDescription, { color: c.mutedForeground }]}>Sample income used to calculate Ready to Assign.</Text></View>
        <TextInput value={incomeText} onChangeText={onIncomeText} onBlur={onSaveIncome} keyboardType="decimal-pad" style={[styles.incomeInput, { color: c.foreground, backgroundColor: c.muted }]} />
      </View>
      {state.groups.map((group: ZeroBudgetLabGroup) => {
        const categories = state.categories.filter((category: ZeroBudgetLabCategory) => category.groupId === group.id);
        return <View key={group.id} style={styles.editGroup}>
          <View style={styles.editGroupHeader}><Text style={[styles.editGroupTitle, { color: c.foreground }]}>{group.name}</Text><Pressable onPress={() => onAddCategory(group.id)} style={styles.roundAction}><Feather name="plus-circle" size={22} color={c.primary} /></Pressable><Pressable onPress={() => onEditGroup(group)} style={styles.roundAction}><Feather name="more-vertical" size={20} color={c.mutedForeground} /></Pressable></View>
          <View style={[styles.editList, { backgroundColor: c.card, borderColor: c.border }]}>
            {categories.length ? categories.map((category: ZeroBudgetLabCategory, index: number) => <Pressable key={category.id} onPress={() => onEditCategory(category)} style={[styles.editCategoryRow, index > 0 && { borderTopWidth: 1, borderTopColor: c.border }]}>
              <Text style={styles.emoji}>{category.emoji}</Text><View style={{ flex: 1 }}><Text style={[styles.categoryName, { color: c.foreground }]}>{category.name}</Text><Text style={[styles.categoryHelper, { color: c.mutedForeground }]}>{targetLabel(category)}</Text></View>
              <Pressable onPress={() => onMoveCategory(category.id, -1)} hitSlop={8}><Feather name="chevron-up" size={18} color={c.mutedForeground} /></Pressable><Pressable onPress={() => onMoveCategory(category.id, 1)} hitSlop={8}><Feather name="chevron-down" size={18} color={c.mutedForeground} /></Pressable><Feather name="edit-2" size={16} color={c.primary} />
            </Pressable>) : <Text style={[styles.emptyGroup, { color: c.mutedForeground }]}>No categories yet.</Text>}
          </View>
        </View>;
      })}
      <Pressable onPress={onAddGroup} style={[styles.outlineButton, { borderColor: c.primary }]}><Feather name="plus" size={17} color={c.primary} /><Text style={[styles.outlineButtonText, { color: c.primary }]}>Add budget group</Text></Pressable>
    </ScrollView>
  );
}

function SettingsView({ c, state, bottomInset, onEdit, onToggleHide, onReset, onExit }: { c: LabColors; state: ZeroBudgetLabState; bottomInset: number; onEdit: () => void; onToggleHide: () => void; onReset: () => void; onExit: () => void }) {
  return <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottomInset + 100 }]}>
    <Text style={[styles.settingsSectionTitle, { color: c.foreground }]}>Plan</Text>
    <View style={[styles.settingsCard, { backgroundColor: c.card, borderColor: c.border }]}><SettingsRow c={c} icon="edit-3" title="Plan settings" description="Groups, categories, targets, and income" onPress={onEdit} /><SettingsRow c={c} icon="calendar" title="Current test month" description={formatZeroBudgetMonth(state.selectedMonth)} /></View>
    <Text style={[styles.settingsSectionTitle, { color: c.foreground }]}>Display & privacy</Text>
    <View style={[styles.settingsCard, { backgroundColor: c.card, borderColor: c.border }]}><SettingsRow c={c} icon="eye-off" title="Hide sample amounts" description="Useful when sharing screenshots" right={<Switch value={state.hideAmounts} onValueChange={onToggleHide} trackColor={{ false: c.muted, true: c.primary }} />} /><SettingsRow c={c} icon="shield" title="Data isolation" description="Stored locally; never connected to household money" /></View>
    <Text style={[styles.settingsSectionTitle, { color: c.foreground }]}>Lab controls</Text>
    <View style={[styles.settingsCard, { backgroundColor: c.card, borderColor: c.border }]}><SettingsRow c={c} icon="refresh-cw" title="Reset sample plan" description="Restore the original test categories and amounts" onPress={onReset} /><SettingsRow c={c} icon="log-out" title="Exit test environment" description="Return to your unchanged FlowLedger account" destructive onPress={onExit} /></View>
  </ScrollView>;
}

function SmallStat({ label, value, color }: { label: string; value: string; color: string }) { return <View style={styles.smallStat}><Text style={[styles.smallStatValue, { color }]}>{value}</Text><Text style={styles.smallStatLabel}>{label}</Text></View>; }

function ActionSheet({ visible, title, onClose, c, children }: { visible: boolean; title: string; onClose: () => void; c: LabColors; children: React.ReactNode }) { return <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}><Pressable style={styles.overlay} onPress={onClose}><Pressable style={[styles.sheet, { backgroundColor: c.card, borderColor: c.border }]} onPress={() => undefined}><View style={[styles.handle, { backgroundColor: c.mutedForeground }]} /><Text style={[styles.sheetTitle, { color: c.foreground }]}>{title}</Text>{children}</Pressable></Pressable></Modal>; }

function SheetRow({ c, icon, label, onPress, destructive = false }: { c: LabColors; icon: FeatherName; label: string; onPress: () => void; destructive?: boolean }) { const color = destructive ? c.destructive : c.foreground; return <Pressable onPress={onPress} style={[styles.sheetRow, { borderTopColor: c.border }]}><Feather name={icon} size={19} color={color} /><Text style={[styles.sheetRowText, { color }]}>{label}</Text><Feather name="chevron-right" size={18} color={c.mutedForeground} /></Pressable>; }

function MonthPicker({ visible, value, c, onClose, onChange }: { visible: boolean; value: string; c: LabColors; onClose: () => void; onChange: (value: string) => void }) {
  const [selectedYear, selectedMonth] = value.split("-").map(Number);
  const [year, setYear] = useState(selectedYear);
  useEffect(() => { if (visible) setYear(selectedYear); }, [selectedYear, visible]);
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}><Pressable style={styles.overlayCenter} onPress={onClose}><Pressable style={[styles.monthPicker, { backgroundColor: c.card, borderColor: c.border }]} onPress={() => undefined}><View style={styles.yearRow}><Pressable onPress={() => setYear((value: number) => value - 1)}><Feather name="chevron-left" size={22} color={c.primary} /></Pressable><Text style={[styles.yearText, { color: c.foreground }]}>{year}</Text><Pressable onPress={() => setYear((value: number) => value + 1)}><Feather name="chevron-right" size={22} color={c.primary} /></Pressable></View><View style={styles.monthGrid}>{MONTHS.map((month, index) => { const active = year === selectedYear && index + 1 === selectedMonth; return <Pressable key={month} onPress={() => onChange(`${year}-${String(index + 1).padStart(2, "0")}`)} style={[styles.monthCell, active && { backgroundColor: c.primary }]}><Text style={[styles.monthCellText, { color: active ? c.primaryForeground : c.foreground }]}>{month}</Text></Pressable>; })}</View></Pressable></Pressable></Modal>;
}

function CategoryPicker({ visible, action, title, categories, c, onClose, onPick }: { visible: boolean; action: ZeroBudgetMoneyAction; title?: string; categories: ZeroBudgetLabCategory[]; c: LabColors; onClose: () => void; onPick: (categoryId: string) => void }) { return <ActionSheet visible={visible} title={title ?? (action === "spend" ? "Choose a category for test spending" : "Choose a category")} onClose={onClose} c={c}><ScrollView style={{ maxHeight: 410 }}>{categories.map(category => <Pressable key={category.id} onPress={() => onPick(category.id)} style={[styles.pickerRow, { borderTopColor: c.border }]}><Text style={styles.emoji}>{category.emoji}</Text><Text style={[styles.pickerText, { color: c.foreground }]}>{category.name}</Text><Feather name="chevron-right" size={17} color={c.mutedForeground} /></Pressable>)}</ScrollView></ActionSheet>; }

function MoneySheet({ visible, c, category, categorySummary, action, assignmentMode, value, readyToAssign, onClose, onMode, onKey, onApply }: { visible: boolean; c: LabColors; category: ZeroBudgetLabCategory | null; categorySummary: ZeroBudgetCategorySummary | null; action: ZeroBudgetMoneyAction; assignmentMode: AssignmentMode; value: string; readyToAssign: number; onClose: () => void; onMode: (mode: AssignmentMode) => void; onKey: (key: string) => void; onApply: () => void }) {
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}><View style={styles.overlay}><View style={[styles.moneySheet, { backgroundColor: c.card, borderColor: c.border }]}><View style={styles.moneyHeader}><Text style={styles.moneyEmoji}>{category?.emoji}</Text><View style={{ flex: 1 }}><Text style={[styles.sheetTitle, { color: c.foreground, textAlign: "left" }]}>{action === "spend" ? "Test spending for" : "Assign money to"} {category?.name}</Text><Text style={[styles.categoryHelper, { color: c.mutedForeground }]}>{action === "assign" ? `${moneyPlain(readyToAssign)} ready to assign` : `${moneyPlain(categorySummary?.available ?? 0)} currently available`}</Text></View><Pressable onPress={onClose} style={styles.closeButton}><Feather name="x" size={20} color={c.mutedForeground} /></Pressable></View>{action === "assign" && <View style={styles.modeRow}>{(["add", "subtract", "set"] as AssignmentMode[]).map(mode => <Pressable key={mode} onPress={() => onMode(mode)} style={[styles.modeButton, { backgroundColor: assignmentMode === mode ? c.primary : c.muted }]}><Text style={[styles.modeText, { color: assignmentMode === mode ? c.primaryForeground : c.mutedForeground }]}>{mode === "add" ? "+ Add" : mode === "subtract" ? "− Remove" : "= Set"}</Text></Pressable>)}</View>}<View style={[styles.amountDisplay, { backgroundColor: c.muted }]}><Text style={[styles.amountText, { color: c.foreground }]}>${value || "0"}</Text></View><View style={styles.keypad}>{KEY_PAD.map(key => <Pressable key={key} onPress={() => onKey(key)} style={[styles.key, { backgroundColor: c.muted }]}>{key === "backspace" ? <Feather name="delete" size={20} color={c.foreground} /> : <Text style={[styles.keyText, { color: c.foreground }]}>{key}</Text>}</Pressable>)}</View><Pressable onPress={onApply} style={[styles.primaryButton, { backgroundColor: c.primary, opacity: Number(value) > 0 ? 1 : 0.45 }]}><Text style={[styles.primaryButtonText, { color: c.primaryForeground }]}>{action === "spend" ? `Add ${value ? `$${value}` : "spending"}` : `${assignmentMode === "subtract" ? "Remove" : assignmentMode === "set" ? "Set" : "Assign"} ${value ? `$${value}` : "money"}`}</Text></Pressable></View></View></Modal>;
}

function CategoryEditor({ visible, c, category, groups, isNew, onChange, onClose, onSave, onDelete }: { visible: boolean; c: LabColors; category: ZeroBudgetLabCategory | null; groups: ZeroBudgetLabGroup[]; isNew: boolean; onChange: (category: ZeroBudgetLabCategory) => void; onClose: () => void; onSave: () => void; onDelete: () => void }) {
  const update = (patch: Partial<ZeroBudgetLabCategory>) => category && onChange({ ...category, ...patch });
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}><View style={styles.overlay}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.editorSheet, { backgroundColor: c.card, borderColor: c.border }]}><View style={styles.moneyHeader}><Text style={[styles.sheetTitle, { color: c.foreground }]}>{isNew ? "Add category" : "Edit category"}</Text><Pressable onPress={onClose}><Feather name="x" size={20} color={c.mutedForeground} /></Pressable></View><FieldLabel c={c} text="Category name" /><TextInput value={category?.name ?? ""} onChangeText={name => update({ name })} placeholder="Category name" placeholderTextColor={c.mutedForeground} style={[styles.formInput, { color: c.foreground, backgroundColor: c.muted }]} /><FieldLabel c={c} text="Emoji" /><TextInput value={category?.emoji ?? ""} onChangeText={emoji => update({ emoji: emoji.slice(0, 4) })} style={[styles.formInput, { color: c.foreground, backgroundColor: c.muted }]} /><FieldLabel c={c} text="Group" /><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>{groups.map((group: ZeroBudgetLabGroup) => <Pressable key={group.id} onPress={() => update({ groupId: group.id })} style={[styles.choiceChip, { backgroundColor: category?.groupId === group.id ? c.primary : c.muted }]}><Text style={[styles.choiceText, { color: category?.groupId === group.id ? c.primaryForeground : c.foreground }]}>{group.name}</Text></Pressable>)}</ScrollView><FieldLabel c={c} text="Target type" /><View style={styles.wrapRow}>{(["monthly", "weekly", "by_date", "none"] as ZeroBudgetTargetCadence[]).map(cadence => <Pressable key={cadence} onPress={() => update({ targetCadence: cadence })} style={[styles.choiceChip, { backgroundColor: category?.targetCadence === cadence ? c.primary : c.muted }]}><Text style={[styles.choiceText, { color: category?.targetCadence === cadence ? c.primaryForeground : c.foreground }]}>{cadence === "by_date" ? "By date" : cadence[0].toUpperCase() + cadence.slice(1)}</Text></Pressable>)}</View>{category?.targetCadence !== "none" && <><FieldLabel c={c} text={category?.targetCadence === "weekly" ? "Weekly amount" : "Target amount"} /><TextInput value={String(category?.targetAmount ?? 0)} onChangeText={value => update({ targetAmount: Number(value) || 0 })} keyboardType="decimal-pad" style={[styles.formInput, { color: c.foreground, backgroundColor: c.muted }]} /></>}{category?.targetCadence === "by_date" && <><FieldLabel c={c} text="Due day" /><TextInput value={String(category?.dueDay ?? "")} onChangeText={value => update({ dueDay: Math.min(31, Math.max(1, Number(value) || 1)) })} keyboardType="number-pad" style={[styles.formInput, { color: c.foreground, backgroundColor: c.muted }]} /></>}<Pressable onPress={onSave} style={[styles.primaryButton, { backgroundColor: c.primary }]}><Text style={[styles.primaryButtonText, { color: c.primaryForeground }]}>{isNew ? "Add category" : "Update category"}</Text></Pressable>{!isNew && <Pressable onPress={onDelete} style={styles.deleteButton}><Feather name="trash-2" size={17} color={c.destructive} /><Text style={[styles.deleteText, { color: c.destructive }]}>Remove from sample plan</Text></Pressable>}</ScrollView></View></Modal>;
}

function GroupEditor({ visible, c, group, isNew, canDelete, onChange, onClose, onSave, onDelete }: { visible: boolean; c: LabColors; group: ZeroBudgetLabGroup | null; isNew: boolean; canDelete: boolean; onChange: (group: ZeroBudgetLabGroup) => void; onClose: () => void; onSave: () => void; onDelete: () => void }) { return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}><View style={styles.overlay}><View style={[styles.editorSheet, { backgroundColor: c.card, borderColor: c.border }]}><View style={styles.moneyHeader}><Text style={[styles.sheetTitle, { color: c.foreground }]}>{isNew ? "Add budget group" : "Group settings"}</Text><Pressable onPress={onClose}><Feather name="x" size={20} color={c.mutedForeground} /></Pressable></View><FieldLabel c={c} text="Group name" /><TextInput value={group?.name ?? ""} onChangeText={name => group && onChange({ ...group, name })} placeholder="Bills, Needs, Wants…" placeholderTextColor={c.mutedForeground} style={[styles.formInput, { color: c.foreground, backgroundColor: c.muted }]} /><Pressable onPress={onSave} style={[styles.primaryButton, { backgroundColor: c.primary }]}><Text style={[styles.primaryButtonText, { color: c.primaryForeground }]}>{isNew ? "Add group" : "Save group"}</Text></Pressable>{!isNew && <Pressable disabled={!canDelete} onPress={onDelete} style={[styles.deleteButton, { opacity: canDelete ? 1 : 0.4 }]}><Feather name="trash-2" size={17} color={c.destructive} /><Text style={[styles.deleteText, { color: c.destructive }]}>{canDelete ? "Delete empty group" : "Move or remove its categories first"}</Text></Pressable>}</View></View></Modal>; }

function FieldLabel({ c, text }: { c: LabColors; text: string }) { return <Text style={[styles.fieldLabel, { color: c.mutedForeground }]}>{text}</Text>; }

function SettingsRow({ c, icon, title, description, onPress, right, destructive = false }: { c: LabColors; icon: FeatherName; title: string; description: string; onPress?: () => void; right?: React.ReactNode; destructive?: boolean }) { const color = destructive ? c.destructive : c.foreground; const content = <><View style={[styles.settingsIcon, { backgroundColor: (destructive ? c.destructive : c.primary) + "14" }]}><Feather name={icon} size={18} color={destructive ? c.destructive : c.primary} /></View><View style={{ flex: 1 }}><Text style={[styles.settingTitle, { color }]}>{title}</Text><Text style={[styles.settingDescription, { color: c.mutedForeground }]}>{description}</Text></View>{right ?? (onPress ? <Feather name="chevron-right" size={18} color={c.mutedForeground} /> : null)}</>; return onPress ? <Pressable onPress={onPress} style={[styles.settingsRow, { borderTopColor: c.border }]}>{content}</Pressable> : <View style={[styles.settingsRow, { borderTopColor: c.border }]}>{content}</View>; }

function targetLabel(category: ZeroBudgetLabCategory) { if (category.targetCadence === "none") return "Add target"; if (category.targetCadence === "weekly") return `$${category.targetAmount.toFixed(2)} weekly`; if (category.targetCadence === "by_date") return `$${category.targetAmount.toFixed(2)} by the ${ordinal(category.dueDay ?? 1)}`; return `$${category.targetAmount.toFixed(2)} monthly`; }
function ordinal(value: number) { const mod100 = value % 100; if (mod100 >= 11 && mod100 <= 13) return `${value}th`; if (value % 10 === 1) return `${value}st`; if (value % 10 === 2) return `${value}nd`; if (value % 10 === 3) return `${value}rd`; return `${value}th`; }
function moneyPlain(value: number) { return `${value < 0 ? "-" : ""}$${Math.abs(value).toFixed(2)}`; }

const styles = StyleSheet.create({
  screen: { flex: 1 }, center: { alignItems: "center", justifyContent: "center" },
  header: { minHeight: 68, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", borderBottomWidth: 1 },
  headerButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" }, headerCopy: { flex: 1 }, headerTitle: { fontSize: 22, fontFamily: "Inter_800ExtraBold" }, headerSubtitle: { fontSize: 9, fontFamily: "Inter_800ExtraBold", letterSpacing: 1.1, marginTop: 2 },
  doneButton: { minHeight: 40, minWidth: 70, borderRadius: 14, alignItems: "center", justifyContent: "center", paddingHorizontal: 14 }, doneText: { fontSize: 13, fontFamily: "Inter_800ExtraBold" },
  isolationBanner: { marginHorizontal: 16, marginTop: 10, borderWidth: 1, borderRadius: 16, padding: 11, flexDirection: "row", alignItems: "center", gap: 10 }, isolationTitle: { fontSize: 12, fontFamily: "Inter_800ExtraBold" }, isolationText: { fontSize: 10, fontFamily: "Inter_500Medium", lineHeight: 14, marginTop: 2 },
  content: { paddingHorizontal: 16, paddingTop: 12 },
  monthBar: { minHeight: 56, borderWidth: 1, borderRadius: 18, flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }, monthArrow: { width: 48, height: 48, alignItems: "center", justifyContent: "center" }, monthCenter: { flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 12, paddingVertical: 10 }, monthTitle: { fontSize: 17, fontFamily: "Inter_800ExtraBold" },
  readyCard: { borderWidth: 1, borderRadius: 24, padding: 18, alignItems: "center", marginBottom: 16 }, readyValue: { fontSize: 36, fontFamily: "Inter_800ExtraBold", letterSpacing: -1.2 }, readyTitle: { fontSize: 16, fontFamily: "Inter_800ExtraBold", marginTop: 2 }, readyText: { fontSize: 12, fontFamily: "Inter_500Medium", lineHeight: 17, textAlign: "center", marginTop: 5 }, readyStats: { width: "100%", flexDirection: "row", gap: 8, marginTop: 16 }, smallStat: { flex: 1, minWidth: 0, alignItems: "center" }, smallStatValue: { fontSize: 13, fontFamily: "Inter_800ExtraBold" }, smallStatLabel: { color: "#94a3b8", fontSize: 9, fontFamily: "Inter_700Bold", textTransform: "uppercase", marginTop: 2 },
  transactionCard: { borderWidth: 1, borderRadius: 22, overflow: "hidden", marginBottom: 16 }, transactionHeader: { minHeight: 66, flexDirection: "row", alignItems: "center", gap: 11, paddingHorizontal: 14, paddingVertical: 11 }, transactionHeaderIcon: { width: 40, height: 40, borderRadius: 13, alignItems: "center", justifyContent: "center" }, transactionTitle: { fontSize: 16, fontFamily: "Inter_800ExtraBold" }, transactionSubtitle: { fontSize: 11, fontFamily: "Inter_600SemiBold", marginTop: 2 }, transactionRow: { minHeight: 75, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 13, paddingVertical: 10 }, transactionIcon: { width: 34, height: 34, borderRadius: 11, alignItems: "center", justifyContent: "center" }, transactionName: { fontSize: 13, fontFamily: "Inter_800ExtraBold" }, transactionMeta: { fontSize: 9, fontFamily: "Inter_600SemiBold", lineHeight: 13, marginTop: 3 }, transactionAmountWrap: { alignItems: "flex-end", gap: 4 }, transactionAmount: { fontSize: 13, fontFamily: "Inter_800ExtraBold" }, transactionStatus: { fontSize: 8, fontFamily: "Inter_800ExtraBold", letterSpacing: 0.7 }, postButton: { minHeight: 25, borderRadius: 8, paddingHorizontal: 8, alignItems: "center", justifyContent: "center" }, postButtonText: { fontSize: 8, fontFamily: "Inter_800ExtraBold" },
  groupSection: { marginBottom: 14 }, groupHeader: { minHeight: 58, borderWidth: 1, borderRadius: 17, paddingHorizontal: 13, flexDirection: "row", alignItems: "center", gap: 9 }, groupName: { flex: 1, fontSize: 17, fontFamily: "Inter_800ExtraBold" }, groupAmount: { textAlign: "right", fontSize: 15, fontFamily: "Inter_800ExtraBold" }, groupCaption: { textAlign: "right", fontSize: 8, fontFamily: "Inter_800ExtraBold", letterSpacing: 0.7 },
  categoryList: { borderWidth: 1, borderRadius: 20, marginTop: 7, overflow: "hidden" }, categoryRow: { flexDirection: "row", gap: 11, paddingHorizontal: 13, paddingVertical: 14 }, emoji: { fontSize: 20, width: 29, textAlign: "center" }, categoryTop: { flexDirection: "row", alignItems: "center", gap: 8 }, categoryName: { flex: 1, fontSize: 15, fontFamily: "Inter_700Bold" }, availablePill: { overflow: "hidden", borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4, fontSize: 13, fontFamily: "Inter_800ExtraBold" }, progressTrack: { height: 6, borderRadius: 99, overflow: "hidden", marginTop: 9 }, progressFill: { height: 6, borderRadius: 99 }, categoryHelper: { fontSize: 11, fontFamily: "Inter_500Medium", lineHeight: 15, marginTop: 6 },
  floatingAction: { position: "absolute", right: 18, bottom: 28, minHeight: 52, borderRadius: 17, paddingHorizontal: 18, flexDirection: "row", alignItems: "center", gap: 8, shadowColor: "#000", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.28, shadowRadius: 14, elevation: 8 }, floatingText: { fontSize: 14, fontFamily: "Inter_800ExtraBold" },
  costHero: { borderWidth: 1, borderRadius: 22, alignItems: "center", padding: 17, marginBottom: 12 }, costValue: { fontSize: 31, fontFamily: "Inter_800ExtraBold" }, costLabel: { fontSize: 10, fontFamily: "Inter_800ExtraBold", letterSpacing: 1, marginTop: 3 },
  incomeEditor: { borderWidth: 1, borderRadius: 18, padding: 13, flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 18 }, incomeInput: { width: 105, minHeight: 44, borderRadius: 12, paddingHorizontal: 10, fontSize: 15, fontFamily: "Inter_800ExtraBold", textAlign: "right" },
  editGroup: { marginBottom: 17 }, editGroupHeader: { minHeight: 46, flexDirection: "row", alignItems: "center", paddingHorizontal: 7 }, editGroupTitle: { flex: 1, fontSize: 17, fontFamily: "Inter_800ExtraBold" }, roundAction: { width: 38, height: 38, alignItems: "center", justifyContent: "center" }, editList: { borderWidth: 1, borderRadius: 20, overflow: "hidden" }, editCategoryRow: { minHeight: 72, flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 13, paddingVertical: 10 }, emptyGroup: { padding: 18, textAlign: "center", fontSize: 12, fontFamily: "Inter_500Medium" },
  outlineButton: { minHeight: 48, borderWidth: 1, borderRadius: 15, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 }, outlineButtonText: { fontSize: 14, fontFamily: "Inter_800ExtraBold" },
  settingsSectionTitle: { fontSize: 19, fontFamily: "Inter_800ExtraBold", marginTop: 10, marginBottom: 8, paddingHorizontal: 6 }, settingsCard: { borderWidth: 1, borderRadius: 22, overflow: "hidden", marginBottom: 16 }, settingsRow: { minHeight: 72, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth }, settingsIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" }, settingTitle: { fontSize: 14, fontFamily: "Inter_800ExtraBold" }, settingDescription: { fontSize: 11, fontFamily: "Inter_500Medium", lineHeight: 15, marginTop: 3 },
  overlay: { flex: 1, backgroundColor: "rgba(2,6,23,0.72)", justifyContent: "flex-end" }, overlayCenter: { flex: 1, backgroundColor: "rgba(2,6,23,0.66)", justifyContent: "center", padding: 22 }, sheet: { borderWidth: 1, borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 18, paddingBottom: 28 }, handle: { width: 48, height: 4, borderRadius: 99, alignSelf: "center", opacity: 0.45, marginBottom: 13 }, sheetTitle: { fontSize: 20, fontFamily: "Inter_800ExtraBold", textAlign: "center", marginBottom: 10 }, sheetRow: { minHeight: 58, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 6 }, sheetRowText: { flex: 1, fontSize: 15, fontFamily: "Inter_700Bold" },
  monthPicker: { borderWidth: 1, borderRadius: 27, padding: 18 }, yearRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, marginBottom: 14 }, yearText: { fontSize: 20, fontFamily: "Inter_800ExtraBold" }, monthGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, monthCell: { width: "22%", flexGrow: 1, minHeight: 53, borderRadius: 16, alignItems: "center", justifyContent: "center" }, monthCellText: { fontSize: 15, fontFamily: "Inter_700Bold" },
  pickerRow: { minHeight: 55, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: "row", alignItems: "center", gap: 10 }, pickerText: { flex: 1, fontSize: 14, fontFamily: "Inter_700Bold" },
  moneySheet: { borderWidth: 1, borderTopLeftRadius: 27, borderTopRightRadius: 27, padding: 18, paddingBottom: 24 }, moneyHeader: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 }, moneyEmoji: { fontSize: 30 }, closeButton: { width: 38, height: 38, alignItems: "center", justifyContent: "center" }, modeRow: { flexDirection: "row", gap: 8, marginBottom: 10 }, modeButton: { flex: 1, minHeight: 38, borderRadius: 11, alignItems: "center", justifyContent: "center" }, modeText: { fontSize: 11, fontFamily: "Inter_800ExtraBold" }, amountDisplay: { minHeight: 60, borderRadius: 16, alignItems: "center", justifyContent: "center", marginBottom: 10 }, amountText: { fontSize: 28, fontFamily: "Inter_800ExtraBold" }, keypad: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 }, key: { width: "30%", flexGrow: 1, minHeight: 48, borderRadius: 13, alignItems: "center", justifyContent: "center" }, keyText: { fontSize: 19, fontFamily: "Inter_700Bold" },
  primaryButton: { minHeight: 50, borderRadius: 15, alignItems: "center", justifyContent: "center", paddingHorizontal: 16, marginTop: 10 }, primaryButtonText: { fontSize: 14, fontFamily: "Inter_800ExtraBold" },
  editorSheet: { borderWidth: 1, borderTopLeftRadius: 27, borderTopRightRadius: 27, padding: 18, paddingBottom: 26, maxHeight: "92%" }, fieldLabel: { fontSize: 10, fontFamily: "Inter_800ExtraBold", textTransform: "uppercase", letterSpacing: 0.8, marginTop: 10, marginBottom: 6 }, formInput: { minHeight: 48, borderRadius: 13, paddingHorizontal: 13, paddingVertical: 10, fontSize: 15, fontFamily: "Inter_600SemiBold" }, chipRow: { gap: 8 }, wrapRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, choiceChip: { minHeight: 39, borderRadius: 12, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 }, choiceText: { fontSize: 12, fontFamily: "Inter_800ExtraBold" }, deleteButton: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 8 }, deleteText: { fontSize: 13, fontFamily: "Inter_800ExtraBold" },
  accessCard: { width: "100%", maxWidth: 430, borderWidth: 1, borderRadius: 25, padding: 24, alignItems: "center" }, accessTitle: { fontSize: 21, fontFamily: "Inter_800ExtraBold", marginTop: 12 }, accessText: { fontSize: 13, fontFamily: "Inter_500Medium", lineHeight: 19, textAlign: "center", marginTop: 7 },
});
