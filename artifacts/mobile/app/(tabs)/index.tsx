import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated, Keyboard, Modal, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AddBillModal } from "@/components/AddBillModal";
import { DatePickerField } from "@/components/DatePickerField";
import { GoalModal } from "@/components/GoalModal";

import colors from "@/constants/colors";
import type { Bill, DashboardFilter, Goal } from "@/context/BudgetContext";
import { useBudget } from "@/context/BudgetContext";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { applyCategoryBudgetMove, buildCategoryPlan, buildCategoryRolloverAdjustments } from "@/lib/categoryPlanning";
import { CATEGORY_BUDGETS_EVENT, categoryBudgetStorageKey, loadCategoryBudgets, readCategoryBudgetCache, saveCategoryBudgets as saveCategoryBudgetsRemote } from "@/lib/categoryBudgetStore";
import { DECISION_HUB_SETTINGS_EVENT, loadDecisionHubSettings, readDecisionHubSettings, type DecisionHubSettings } from "@/lib/decisionHubSettings";
import { buildDecisionHistory } from "@/lib/decisionHistory";
import { buildDecisionRiskAlerts } from "@/lib/decisionRisk";
import { groupForecastEvents } from "@/lib/forecastDisplay";
import { summarizeMonthlyBills } from "@/lib/monthlySummary";
import { buildPaycheckPlan, makeDateKey } from "@/lib/paycheckPlanning";

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MONTH_FULL  = ["January","February","March","April","May","June","July","August","September","October","November","December"];

const CAT_COLORS: Record<string, string> = {
  Housing: "#0f9b8e", Utilities: "#f0b429", Insurance: "#6366f1",
  Transportation: "#ec4899", Food: "#f97316", Entertainment: "#8b5cf6",
  Health: "#ef4444", Education: "#3b82f6", Savings: "#22c55e", Debt: "#e11d48", Other: "#94a3b8",
};

export default function DashboardScreen() {
  const c = useColors();
  const [isFocused, setIsFocused] = useState(true);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const {
    bills, getPaidAmount, getBillMonthlyTotal, getMonthlyBills, selectedYear, setDashboardFilter,
    getBillOccurrencesInMonth, getIncomeOccurrencesInMonth,
    goals, addGoal, updateGoal, deleteGoal, checkGoalAffordability,
    getCashFlow, getMonthlyIncome, addBill, addTransaction, getDailyBalances, getTransactionsForMonth, settings,
    accounts, incomes, decisions, forecastConfidence, updateSettings,
    categories,
  } = useBudget();

  const [goalModalVisible, setGoalModalVisible]     = useState(false);
  const [editGoal, setEditGoal]                     = useState<Goal | null>(null);
  const [actionModalVisible, setActionModalVisible] = useState(false);
  const [addBillVisible, setAddBillVisible]         = useState(false);
  const [affordAmt, setAffordAmt]                   = useState("");
  const [addedAsExpense, setAddedAsExpense]          = useState(false);
  const [expenseNameModal, setExpenseNameModal]      = useState(false);
  const [expenseNameInput, setExpenseNameInput]      = useState("");
  const [expenseType, setExpenseType]                = useState<"expense" | "goal">("expense");
  const [negCalendarVisible, setNegCalendarVisible]  = useState(false);
  const [savingsModalVisible, setSavingsModalVisible] = useState(false);
  const [savingsGoalId, setSavingsGoalId]             = useState("");
  const [savingsAmount, setSavingsAmount]             = useState("");
  const [categoryBudgetModalVisible, setCategoryBudgetModalVisible] = useState(false);
  const [categoryBudgets, setCategoryBudgets] = useState<Record<string, number>>({});
  const [categoryBudgetDrafts, setCategoryBudgetDrafts] = useState<Record<string, string>>({});
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [decisionHubSettings, setDecisionHubSettings] = useState<DecisionHubSettings>(() => readDecisionHubSettings());
  const [moveMoneyVisible, setMoveMoneyVisible] = useState(false);
  const [moveTargetCategory, setMoveTargetCategory] = useState<string | null>(null);
  const [moveSourceCategory, setMoveSourceCategory] = useState("");
  const [moveAmount, setMoveAmount] = useState("");
  const [moveError, setMoveError] = useState("");

  useFocusEffect(useCallback(() => {
    setIsFocused(true);
    return () => setIsFocused(false);
  }, []));

  // ── Hero card flip ──────────────────────────────────────────────────────────
  const flipAnim   = useRef(new Animated.Value(0)).current;
  const [flipped, setFlipped] = useState(false);
  const [cardHeight, setCardHeight] = useState(0);

  const doFlip = () => {
    const toValue = flipped ? 0 : 1;
    Animated.spring(flipAnim, { toValue, friction: 8, tension: 10, useNativeDriver: true }).start();
    setFlipped(f => !f);
  };

  const frontRotate = flipAnim.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "180deg"] });
  const backRotate  = flipAnim.interpolate({ inputRange: [0, 1], outputRange: ["180deg", "360deg"] });

  const now          = new Date();
  const currentMonth = now.getMonth();
  const today        = now.getDate();

  // ── Afford date picker ─────────────────────────────────────────────────────
  const [affordDate, setAffordDate] = useState<string>(
    () => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
  );

  const cashFlow      = useMemo(() => getCashFlow(currentMonth, selectedYear), [getCashFlow, currentMonth, selectedYear]);
  const monthlyIncome = getMonthlyIncome();

  // ── Real daily balance metrics for current month ───────────────────────────
  const currentBalancesCache = useRef<ReturnType<typeof getDailyBalances>>([]);
  const currentMonthBalances = useMemo(() => {
    if (!isFocused && currentBalancesCache.current.length) return currentBalancesCache.current;
    const balances = getDailyBalances(currentMonth, selectedYear);
    currentBalancesCache.current = balances;
    return balances;
  }, [getDailyBalances, currentMonth, selectedYear, isFocused]);

  const balanceMetrics = useMemo(() => {
    if (!currentMonthBalances.length) return null;
    const todayEntry = currentMonthBalances.find(db => db.day === today);
    const currentBalance = todayEntry?.balance ?? currentMonthBalances[0]?.balance ?? 0;
    const endOfMonthBalance = currentMonthBalances[currentMonthBalances.length - 1]?.balance ?? 0;
    let lowestBalance = Infinity;
    let lowestDay = today;
    currentMonthBalances.forEach(db => {
      if (db.balance < lowestBalance) { lowestBalance = db.balance; lowestDay = db.day; }
    });
    const firstNegEntry = currentMonthBalances.find(db => db.balance < 0);
    return { currentBalance, endOfMonthBalance, lowestBalance, lowestDay, firstNegDay: firstNegEntry?.day ?? null };
  }, [currentMonthBalances, today]);

  const forecastTrust = useMemo(() => {
    if (!balanceMetrics || !currentMonthBalances.length) return null;
    const todayEntry = currentMonthBalances.find(day => day.day === today) ?? currentMonthBalances[0];
    const endEntry = currentMonthBalances[currentMonthBalances.length - 1];
    const lowEntry = currentMonthBalances.find(day => day.day === balanceMetrics.lowestDay) ?? todayEntry;
    const groups = groupForecastEvents(lowEntry?.events ?? []);
    const sourceCount = (todayEntry?.events?.length ?? 0) + (endEntry?.events?.length ?? 0) + (lowEntry?.events?.length ?? 0);
    const topDrivers = groups
      .flatMap(group => group.events.map(event => `${event.label} ${event.amountLabel}`))
      .slice(0, 3);
    return {
      todayEntry,
      endEntry,
      lowEntry,
      sourceCount,
      topDrivers,
      prompt: `Explain my forecast numbers. Balance today is $${balanceMetrics.currentBalance.toFixed(0)}, end of month is $${balanceMetrics.endOfMonthBalance.toFixed(0)}, and lowest balance is $${balanceMetrics.lowestBalance.toFixed(0)} on ${MONTH_NAMES[currentMonth]} ${balanceMetrics.lowestDay}.`,
    };
  }, [balanceMetrics, currentMonthBalances, currentMonth, today]);

  // ── 12-month negative schedule ─────────────────────────────────────────────
  type OutlookMonth = { month: number; year: number; label: string; firstNegDay: number | null; lowestBalance: number };
  const [yearNegSchedule, setYearNegSchedule] = useState<OutlookMonth[]>([]);

  useEffect(() => {
    if (!isFocused) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let i = 0;
    setYearNegSchedule([]);

    const calculateNextMonth = () => {
      if (cancelled || i >= settings.forecast_horizon_months) return;
      const m = (currentMonth + i) % 12;
      const y = selectedYear + Math.floor((currentMonth + i) / 12);
      const balances = getDailyBalances(m, y);
      const negEntry = balances.find(db => db.balance < 0);
      const lowest = balances.reduce((min, db) => db.balance < min ? db.balance : min, Infinity);
      const next: OutlookMonth = {
        month: m, year: y,
        label: `${MONTH_FULL[m]} ${y}`,
        firstNegDay: negEntry?.day ?? null,
        lowestBalance: lowest === Infinity ? 0 : lowest,
      };
      setYearNegSchedule(previous => [...previous, next]);
      i += 1;
      if (i < settings.forecast_horizon_months) timer = setTimeout(calculateNextMonth, 0);
    };

    timer = setTimeout(calculateNextMonth, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [getDailyBalances, currentMonth, selectedYear, isFocused, settings.forecast_horizon_months]);

  // First month (across all 12) that goes negative
  const firstYearNegEntry = yearNegSchedule.find(e => e.firstNegDay !== null) ?? null;

  const stats = useMemo(() => {
    const billSummary = summarizeMonthlyBills(
      getMonthlyBills(currentMonth, selectedYear),
      bill => getBillMonthlyTotal(bill, currentMonth, selectedYear),
      bill => getPaidAmount(bill.id, currentMonth, selectedYear),
    );
    const totalDebt  = bills.filter(b => b.is_debt).reduce((s, b) => s + b.balance, 0);
    return { ...billSummary, totalDebt };
  }, [bills, getMonthlyBills, getBillMonthlyTotal, getPaidAmount, currentMonth, selectedYear]);

  const upcomingBills = useMemo(() => {
    const sevenDaysLater = today + 7;
    return bills
      .filter(b => (b.is_recurring || b.is_debt) && b.due_day >= today && b.due_day <= sevenDaysLater)
      .sort((a, b) => a.due_day - b.due_day)
      .slice(0, 5);
  }, [bills, today]);

  const monthlyBarData = useMemo(() =>
    MONTH_NAMES.map((label, i) => ({ label, value: bills.filter(b => b.is_recurring || b.is_debt).reduce((s, b) => s + getBillMonthlyTotal(b, i, selectedYear), 0) })),
    [bills, getBillMonthlyTotal, selectedYear]);

  const categoryData = useMemo(() => {
    const map: Record<string, number> = {};
    bills.forEach(b => { const cat = b.category || "Other"; map[cat] = (map[cat] || 0) + b.amount; });
    return Object.entries(map).map(([label, value]) => ({ label, value, color: CAT_COLORS[label] ?? "#94a3b8" })).sort((a, b) => b.value - a.value);
  }, [bills]);

  const categoryBudgetKey = useMemo(
    () => categoryBudgetStorageKey(currentMonth, selectedYear),
    [selectedYear, currentMonth],
  );

  useEffect(() => {
    let cancelled = false;
    const refreshCategoryBudgets = () => {
      setCategoryBudgets(readCategoryBudgetCache(currentMonth, selectedYear));
      void loadCategoryBudgets(user?.id, currentMonth, selectedYear).then(next => {
        if (!cancelled) setCategoryBudgets(next);
      });
    };
    refreshCategoryBudgets();
    if (Platform.OS !== "web") return;
    globalThis.addEventListener?.(CATEGORY_BUDGETS_EVENT, refreshCategoryBudgets);
    return () => {
      cancelled = true;
      globalThis.removeEventListener?.(CATEGORY_BUDGETS_EVENT, refreshCategoryBudgets);
    };
  }, [categoryBudgetKey, currentMonth, selectedYear, user?.id]);

  useEffect(() => {
    let cancelled = false;
    const refreshDecisionHubSettings = () => {
      setDecisionHubSettings(readDecisionHubSettings());
      void loadDecisionHubSettings(user?.id).then(next => {
        if (!cancelled) setDecisionHubSettings(next);
      });
    };
    refreshDecisionHubSettings();
    if (Platform.OS !== "web") return;
    globalThis.addEventListener?.(DECISION_HUB_SETTINGS_EVENT, refreshDecisionHubSettings);
    return () => {
      cancelled = true;
      globalThis.removeEventListener?.(DECISION_HUB_SETTINGS_EVENT, refreshDecisionHubSettings);
    };
  }, [user?.id]);

  const readCategoryBudgetMap = useCallback((month: number, year: number) => {
    return readCategoryBudgetCache(month, year);
  }, []);

  const previousCategoryPlan = useMemo(() => {
    const previousDate = new Date(selectedYear, currentMonth - 1, 1);
    const month = previousDate.getMonth();
    const year = previousDate.getFullYear();
    const monthBills = getMonthlyBills(month, year)
      .filter(bill => !bill.is_debt)
      .map(bill => ({
        category: bill.category || "Other",
        amount: getBillMonthlyTotal(bill, month, year),
      }));
    const monthTransactions = getTransactionsForMonth(month, year)
      .filter(transaction => transaction.category !== "Debt" && transaction.category !== "Income")
      .map(transaction => ({ category: transaction.category || "Other", amount: transaction.amount }));
    const budgetLimits = Object.entries(readCategoryBudgetMap(month, year)).map(([category, amount]) => ({ category, amount }));
    return buildCategoryPlan(categories.filter(category => category !== "Debt"), monthBills, monthTransactions, budgetLimits);
  }, [categories, getMonthlyBills, getBillMonthlyTotal, getTransactionsForMonth, readCategoryBudgetMap, currentMonth, selectedYear]);

  const categoryPlan = useMemo(() => {
    const monthBills = getMonthlyBills(currentMonth, selectedYear)
      .filter(bill => !bill.is_debt)
      .map(bill => ({
        category: bill.category || "Other",
        amount: getBillMonthlyTotal(bill, currentMonth, selectedYear),
      }));
    const monthTransactions = getTransactionsForMonth(currentMonth, selectedYear)
      .filter(transaction => transaction.category !== "Debt" && transaction.category !== "Income")
      .map(transaction => ({ category: transaction.category || "Other", amount: transaction.amount }));
    const budgetLimits = Object.entries(categoryBudgets).map(([category, amount]) => ({ category, amount }));
    const rollovers = buildCategoryRolloverAdjustments(previousCategoryPlan, decisionHubSettings.categoryRolloverEnabled);
    return buildCategoryPlan(categories.filter(category => category !== "Debt"), monthBills, monthTransactions, budgetLimits, rollovers);
  }, [categories, categoryBudgets, getMonthlyBills, getBillMonthlyTotal, getTransactionsForMonth, currentMonth, selectedYear, previousCategoryPlan, decisionHubSettings.categoryRolloverEnabled]);

  const categoryDetail = useMemo(() => {
    if (!selectedCategory) return null;
    const row = categoryPlan.find(item => item.category === selectedCategory);
    if (!row) return null;

    const categoryBills = getMonthlyBills(currentMonth, selectedYear)
      .filter(bill => !bill.is_debt && (bill.category || "Other") === selectedCategory)
      .map(bill => ({
        id: bill.id,
        name: bill.name,
        amount: getBillMonthlyTotal(bill, currentMonth, selectedYear),
        paid: getPaidAmount(bill.id, currentMonth, selectedYear),
        dueDay: bill.due_day,
      }))
      .sort((left, right) => left.dueDay - right.dueDay || left.name.localeCompare(right.name));

    const categoryTransactions = getTransactionsForMonth(currentMonth, selectedYear)
      .filter(transaction => (transaction.category || "Other") === selectedCategory && transaction.category !== "Income")
      .sort((left, right) => right.date.localeCompare(left.date))
      .map(transaction => ({
        id: transaction.id,
        name: transaction.note?.trim() || selectedCategory,
        amount: transaction.amount,
        date: transaction.date,
      }));

    const largestTransaction = categoryTransactions
      .filter(transaction => transaction.amount < 0)
      .sort((left, right) => Math.abs(right.amount) - Math.abs(left.amount))[0];
    const billTotal = categoryBills.reduce((sum, bill) => sum + bill.amount, 0);
    const actualSpending = categoryTransactions
      .filter(transaction => transaction.amount < 0)
      .reduce((sum, transaction) => sum + Math.abs(transaction.amount), 0);
    const hasCustomBudget = categoryBudgets[selectedCategory] !== undefined;
    const explanation = row.remaining < -0.005
      ? `${selectedCategory} is over by $${Math.abs(row.remaining).toFixed(0)}. ${largestTransaction ? `The biggest transaction is ${largestTransaction.name} at $${Math.abs(largestTransaction.amount).toFixed(0)}.` : "Your actual spending is above the monthly plan."}`
      : row.status === "watch"
      ? `${selectedCategory} is getting close. You've used ${row.percentUsed}% of the monthly plan.`
      : `${selectedCategory} is on plan with $${Math.max(0, row.remaining).toFixed(0)} left.`;

    return { row, categoryBills, categoryTransactions, billTotal, actualSpending, hasCustomBudget, explanation };
  }, [selectedCategory, categoryPlan, categoryBudgets, getMonthlyBills, getBillMonthlyTotal, getPaidAmount, getTransactionsForMonth, currentMonth, selectedYear]);

  const budgetEditableCategories = useMemo(() => {
    const names = new Set<string>();
    categories.filter(category => category !== "Debt").forEach(category => names.add(category));
    categoryPlan.forEach(row => names.add(row.category));
    return Array.from(names).sort((left, right) => left.localeCompare(right));
  }, [categories, categoryPlan]);

  const moveSourceOptions = useMemo(() => {
    if (!moveTargetCategory) return [];
    return categoryPlan
      .filter(row => row.category !== moveTargetCategory && row.remaining > 0.005)
      .sort((left, right) => right.remaining - left.remaining);
  }, [categoryPlan, moveTargetCategory]);

  const categoryPlanTotals = useMemo(() => categoryPlan.reduce((totals, row) => ({
    budgeted: totals.budgeted + row.budgeted,
    spent: totals.spent + row.spent,
    remaining: totals.remaining + row.remaining,
  }), { budgeted: 0, spent: 0, remaining: 0 }), [categoryPlan]);
  const categoryDecisionAlert = useMemo(() => {
    if (!decisionHubSettings.categoryDecisionAlertsEnabled) return null;
    const over = categoryPlan
      .filter(row => row.remaining < -0.005)
      .sort((left, right) => left.remaining - right.remaining)[0];
    if (over) {
      const source = categoryPlan
        .filter(row => row.category !== over.category && row.remaining > 0.005)
        .sort((left, right) => right.remaining - left.remaining)[0];
      return {
        tone: "risk" as const,
        title: `${over.category} is over by $${Math.abs(over.remaining).toFixed(0)}`,
        detail: source
          ? `${source.category} has $${source.remaining.toFixed(0)} available. Ask Flo before moving money.`
          : "No category has enough extra room yet. Review the budget or spending.",
        prompt: source
          ? `Can I move $${Math.abs(over.remaining).toFixed(0)} from ${source.category} to ${over.category}?`
          : `Why is ${over.category} over?`,
      };
    }
    const watch = categoryPlan
      .filter(row => row.status === "watch")
      .sort((left, right) => left.remaining - right.remaining)[0];
    if (!watch) return null;
    return {
      tone: "watch" as const,
      title: `${watch.category} is getting tight`,
      detail: `$${Math.max(0, watch.remaining).toFixed(0)} left this month. Ask Flo before spending more.`,
      prompt: `How much do I have left for ${watch.category}?`,
    };
  }, [categoryPlan, decisionHubSettings.categoryDecisionAlertsEnabled]);

  const openCategoryBudgetEditor = () => {
    const drafts: Record<string, string> = {};
    budgetEditableCategories.forEach(category => {
      drafts[category] = categoryBudgets[category] === undefined ? "" : String(categoryBudgets[category]);
    });
    setCategoryBudgetDrafts(drafts);
    setCategoryBudgetModalVisible(true);
  };

  const persistCategoryBudgets = (next: Record<string, number>) => {
    setCategoryBudgets(next);
    void saveCategoryBudgetsRemote(user?.id, currentMonth, selectedYear, next).catch(() => undefined);
  };

  const openCategoryBudgetEditorForCategory = (category: string) => {
    const drafts: Record<string, string> = {};
    budgetEditableCategories.forEach(item => {
      drafts[item] = categoryBudgets[item] === undefined ? "" : String(categoryBudgets[item]);
    });
    if (!drafts[category]) drafts[category] = categoryBudgets[category] === undefined ? "" : String(categoryBudgets[category]);
    setCategoryBudgetDrafts(drafts);
    setSelectedCategory(null);
    setCategoryBudgetModalVisible(true);
  };

  const openMoveMoney = (targetCategory: string) => {
    const source = categoryPlan
      .filter(row => row.category !== targetCategory && row.remaining > 0.005)
      .sort((left, right) => right.remaining - left.remaining)[0];
    setMoveTargetCategory(targetCategory);
    setMoveSourceCategory(source?.category ?? "");
    setMoveAmount("");
    setMoveError("");
    setSelectedCategory(null);
    setMoveMoneyVisible(true);
  };

  const applyMoveMoney = () => {
    const targetCategory = moveTargetCategory;
    const sourceCategory = moveSourceCategory;
    const amount = Number.parseFloat(moveAmount);
    const sourceRow = categoryPlan.find(row => row.category === sourceCategory);
    if (!targetCategory || !sourceCategory) {
      setMoveError("Choose a category to move money from.");
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setMoveError("Enter an amount to move.");
      return;
    }
    if (!sourceRow || amount > sourceRow.remaining + 0.005) {
      setMoveError(`You can move up to $${Math.max(0, sourceRow?.remaining ?? 0).toFixed(0)} from ${sourceCategory}.`);
      return;
    }

    const next = applyCategoryBudgetMove(categoryBudgets, categoryPlan, sourceCategory, targetCategory, amount);
    persistCategoryBudgets(next);
    setMoveMoneyVisible(false);
    setMoveTargetCategory(null);
    setMoveSourceCategory("");
    setMoveAmount("");
    setMoveError("");
  };

  const saveCategoryBudgets = () => {
    const next: Record<string, number> = {};
    Object.entries(categoryBudgetDrafts).forEach(([category, value]) => {
      const amount = Number.parseFloat(value);
      if (category && Number.isFinite(amount) && amount >= 0) next[category] = amount;
    });
    persistCategoryBudgets(next);
    setCategoryBudgetModalVisible(false);
  };

  const clearCategoryBudgets = () => {
    setCategoryBudgets({});
    setCategoryBudgetDrafts({});
    void saveCategoryBudgetsRemote(user?.id, currentMonth, selectedYear, {}).catch(() => undefined);
    setCategoryBudgetModalVisible(false);
  };

  const debtPayoffData = useMemo(() => {
    const debts = bills.filter(b => b.is_debt && b.balance > 0);
    if (!debts.length) return [];
    const months: { label: string; value: number }[] = [];
    let rem = debts.reduce((s, b) => s + b.balance, 0);
    const monthly = debts.reduce((s, b) => s + b.amount, 0);
    for (let i = 0; i < 12 && rem > 0; i++) {
      rem = Math.max(0, rem - monthly);
      months.push({ label: MONTH_NAMES[(currentMonth + i) % 12], value: rem });
    }
    return months;
  }, [bills, currentMonth]);

  // Budget goals use a negative current amount as a backwards-compatible type marker.
  const savingsGoals = useMemo(() => goals.filter(goal => goal.goal_type === "savings"), [goals]);

  // ── Savings summary for back of hero card ──────────────────────────────────
  const savingsData = useMemo(() => {
    const totalSaved  = savingsGoals.reduce((s, g) => s + g.current_amount, 0);
    const totalTarget = savingsGoals.reduce((s, g) => s + g.target_amount, 0);
    const cf          = getCashFlow(currentMonth, now.getFullYear());
    const monthlySurplus = Math.max(0, cf.remaining);
    return { totalSaved, totalTarget, monthlySurplus, goalCount: savingsGoals.length };
  }, [savingsGoals, getCashFlow, currentMonth]);

  // ── Affordability check (real calendar projection) ──────────────────────────
  const RISKY_THRESHOLD = settings.safety_floor;
  const affordResult = useMemo(() => {
    const amt = parseFloat(affordAmt);
    if (!affordAmt.trim() || isNaN(amt) || amt <= 0) return null;

    const [pyStr, pmStr, pdStr] = affordDate.split("-");
    const purchaseYear  = parseInt(pyStr);
    const purchaseMonth = parseInt(pmStr) - 1;
    const purchaseDay   = parseInt(pdStr);

    // Pull the full daily balance array for the purchase month (uses real income/bills/tx)
    const balances = getDailyBalances(purchaseMonth, purchaseYear);
    const dayEntry = balances.find(db => db.day === purchaseDay);
    if (!balances.length) return null;

    // If the date is beyond the last day computed, use the last day
    const effectiveEntry = dayEntry ?? balances[balances.length - 1];
    const balanceAtDay   = effectiveEntry.balance;
    const balanceAfter   = balanceAtDay - amt;

    // Lowest balance from purchase day forward (purchase reduces every subsequent day by flat amt)
    const fromDay = balances.filter(db => db.day >= (dayEntry?.day ?? effectiveEntry.day));
    let lowestBal = balanceAfter;
    let lowestDay = effectiveEntry.day;
    fromDay.forEach(db => {
      const adj = db.balance - amt;
      if (adj < lowestBal) { lowestBal = adj; lowestDay = db.day; }
    });

    const canAfford = balanceAfter >= 0;
    const isRisky   = canAfford && lowestBal < RISKY_THRESHOLD;
    const shortfall = canAfford ? 0 : Math.abs(balanceAfter);

    // First day where balance goes negative after purchase
    const firstNegAfterEntry = fromDay.find(db => db.balance - amt < 0);
    const firstNegAfterDay   = firstNegAfterEntry?.day ?? purchaseDay;
    const firstNegAfterLabel = new Date(purchaseYear, purchaseMonth, firstNegAfterDay)
      .toLocaleDateString("en-US", { month: "short", day: "numeric" });

    const lowestDateLabel = new Date(purchaseYear, purchaseMonth, lowestDay)
      .toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const affordDateStr = `${purchaseYear}-${String(purchaseMonth + 1).padStart(2, "0")}-${String(purchaseDay).padStart(2, "0")}`;

    return {
      canAfford, isRisky, shortfall,
      balanceAtDay, balanceAfter,
      lowestBal, lowestDay, lowestDateLabel,
      firstNegAfterLabel,
      purchaseMonth, purchaseYear, purchaseDay, affordDateStr, amt,
    };
  }, [affordAmt, affordDate, getDailyBalances]);

  const openSavingsModal = () => {
    if (savingsGoals.length === 0) {
      setEditGoal(null);
      setGoalModalVisible(true);
      return;
    }
    setSavingsGoalId(savingsGoals[0]?.id ?? "");
    setSavingsAmount("");
    setSavingsModalVisible(true);
  };

  const handleAddSavings = async () => {
    const amount = Number.parseFloat(savingsAmount);
    const goal = savingsGoals.find(item => item.id === savingsGoalId);
    if (!goal || !Number.isFinite(amount) || amount <= 0) return;

    await updateGoal({ ...goal, current_amount: goal.current_amount + amount });
    const contributionDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    await addTransaction({
      date: contributionDate,
      amount: -amount,
      category: "Savings",
      note: `Savings contribution · ${goal.name}`,
    });
    setSavingsModalVisible(false);
    setSavingsAmount("");
  };

  const navigate = (filter: DashboardFilter, tab: string) => {
    setDashboardFilter(filter);
    router.push(`/(tabs)/${tab}` as any);
  };

  const openAction = (action: string) => {
    setActionModalVisible(false);
    setTimeout(() => {
      if (action === "bill")          setAddBillVisible(true);
      else if (action === "income")   router.push("/(tabs)/more" as any);
      else if (action === "expense")  router.push("/(tabs)/monthly" as any);
      else if (action === "debt")     navigate("debt", "bills");
      else if (action === "afford") {} // handled inline
    }, 250);
  };

  const webTopPad = Platform.OS === "web" ? 0 : 0;

  const statCards = [
    { title: "Bills",   value: `$${stats.totalDue.toFixed(0)}`,    icon: "file-text"    as const, col: c.primary,                                        filter: null    as DashboardFilter, tab: "bills"   },
    { title: "Paid",    value: `$${stats.totalPaid.toFixed(0)}`,   icon: "check-circle" as const, col: c.success,                                        filter: "paid"  as DashboardFilter, tab: "monthly" },
    { title: "Unpaid",  value: `$${stats.remaining.toFixed(0)}`,   icon: "alert-circle" as const, col: stats.remaining > 0 ? c.warning : c.success,      filter: "unpaid" as DashboardFilter, tab: "monthly" },
    { title: "Debt",    value: `$${stats.totalDebt.toFixed(0)}`,   icon: "credit-card"  as const, col: c.destructive,                                    filter: "debt"  as DashboardFilter, tab: "bills"   },
  ];

  // Build breakdown string: Income − Bills [± Transactions] = Left
  const txSign    = cashFlow.netTransactions >= 0 ? "+" : "−";
  const txDisplay = cashFlow.netTransactions !== 0
    ? ` ${txSign} $${Math.abs(cashFlow.netTransactions).toFixed(0)} spent`
    : "";
  const breakdownText =
    `$${cashFlow.monthlyIncome.toFixed(0)} income − $${cashFlow.totalBillsDue.toFixed(0)} bills${txDisplay} = $${Math.abs(cashFlow.remaining).toFixed(0)} ${cashFlow.remaining >= 0 ? "left" : "short"}`;
  const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const currentYear = now.getFullYear();
  const paycheckPlan = useMemo(() => {
    if (!decisionHubSettings.paycheckPlanningEnabled) return null;
    const horizon = Math.max(2, Math.min(settings.forecast_horizon_months, 6));
    const incomeEvents: { id?: string; name: string; amount: number; date: string }[] = [];
    const billEvents: { id?: string; name: string; amount: number; dueDate: string }[] = [];
    const balanceEvents: { date: string; balance: number }[] = [];

    for (let i = 0; i < horizon; i += 1) {
      const absoluteMonth = currentMonth + i;
      const month = absoluteMonth % 12;
      const year = currentYear + Math.floor(absoluteMonth / 12);

      getIncomeOccurrencesInMonth(month, year).forEach(({ income, days, effectiveAmount }) => {
        days.forEach(day => incomeEvents.push({
          id: income.id,
          name: income.name,
          amount: effectiveAmount,
          date: makeDateKey(year, month, day),
        }));
      });

      getMonthlyBills(month, year).forEach(bill => {
        const occurrences = getBillOccurrencesInMonth(bill, month, year);
        if (!occurrences.length) return;
        const monthlyTotal = getBillMonthlyTotal(bill, month, year);
        const perOccurrence = monthlyTotal / occurrences.length;
        let paidRemaining = getPaidAmount(bill.id, month, year);
        occurrences.forEach(day => {
          const appliedPaid = Math.min(perOccurrence, Math.max(0, paidRemaining));
          paidRemaining = Math.max(0, paidRemaining - perOccurrence);
          const remaining = Math.max(0, perOccurrence - appliedPaid);
          if (remaining > 0.005) {
            billEvents.push({
              id: bill.id,
              name: bill.name,
              amount: remaining,
              dueDate: makeDateKey(year, month, day),
            });
          }
        });
      });

      getDailyBalances(month, year).forEach(day => {
        balanceEvents.push({ date: makeDateKey(year, month, day.day), balance: day.balance });
      });
    }

    return buildPaycheckPlan(incomeEvents, billEvents, balanceEvents, settings.safety_floor, todayIso);
  }, [
    currentMonth,
    currentYear,
    decisionHubSettings.paycheckPlanningEnabled,
    getBillMonthlyTotal,
    getBillOccurrencesInMonth,
    getDailyBalances,
    getIncomeOccurrencesInMonth,
    getMonthlyBills,
    getPaidAmount,
    settings.forecast_horizon_months,
    settings.safety_floor,
    todayIso,
  ]);
  const decisionHistory = useMemo(
    () => buildDecisionHistory(decisions, todayIso, now.toISOString()),
    [decisions, todayIso, now],
  );
  const decisionForecastDays = useMemo(() => {
    const days = [];
    for (let i = 0; i < settings.forecast_horizon_months; i += 1) {
      const month = (currentMonth + i) % 12;
      const year = selectedYear + Math.floor((currentMonth + i) / 12);
      const monthPrefix = `${year}-${String(month + 1).padStart(2, "0")}`;
      days.push(...getDailyBalances(month, year).map(day => ({ date: `${monthPrefix}-${String(day.day).padStart(2, "0")}`, balance: day.balance })));
    }
    return days.filter(day => day.date >= todayIso);
  }, [getDailyBalances, currentMonth, selectedYear, settings.forecast_horizon_months, todayIso]);
  const decisionRiskAlerts = useMemo(
    () => buildDecisionRiskAlerts(decisions, decisionForecastDays, settings.safety_floor, todayIso),
    [decisions, decisionForecastDays, settings.safety_floor, todayIso],
  );
  const decisionAlert = useMemo(() => {
    const sevenDaysLater = new Date(now);
    sevenDaysLater.setDate(now.getDate() + 7);
    const weekEnd = `${sevenDaysLater.getFullYear()}-${String(sevenDaysLater.getMonth() + 1).padStart(2, "0")}-${String(sevenDaysLater.getDate()).padStart(2, "0")}`;
    const upcomingThisWeek = decisionHistory.upcoming.filter(item => item.date >= todayIso && item.date <= weekEnd);
    const recentCompleted = [...decisionHistory.completed].sort((left, right) => right.date.localeCompare(left.date))[0];
    const reviewCount = decisionHubSettings.plannedDecisionReviewAlertsEnabled ? decisionHistory.due.length : 0;
    const totalTracked = reviewCount + decisionHistory.upcoming.length + decisionHistory.completed.length + decisionHistory.changed.length;
    let title = "Ask Flo before you change the plan";
    let detail = "Flo is your one place to check, save, and apply money decisions.";
    let tone: "risk" | "review" | "upcoming" | "completed" | "empty" = "empty";
    if (decisionHubSettings.plannedDecisionReviewAlertsEnabled && decisionRiskAlerts.length > 0) {
      const alert = decisionRiskAlerts[0];
      title = `${decisionRiskAlerts.length} decision${decisionRiskAlerts.length === 1 ? "" : "s"} no longer safe`;
      detail = `${alert.name} drops to $${alert.lowestBalance.toFixed(0)} on ${formatShortDate(alert.lowestBalanceDate)}.`;
      tone = "risk";
    } else if (reviewCount > 0) {
      title = `${reviewCount} decision${reviewCount === 1 ? "" : "s"} need review`;
      detail = "Complete, postpone, or cancel past planned decisions.";
      tone = "review";
    } else if (upcomingThisWeek.length > 0) {
      title = `${upcomingThisWeek.length} planned this week`;
      detail = `${upcomingThisWeek[0].name} is next on ${formatShortDate(upcomingThisWeek[0].date)}.`;
      tone = "upcoming";
    } else if (recentCompleted?.varianceLabel) {
      title = "Last decision completed";
      detail = `${recentCompleted.name}: ${recentCompleted.varianceLabel}.`;
      tone = "completed";
    } else if (totalTracked > 0) {
      title = "Decision plan is current";
      detail = `${decisionHistory.upcoming.length} upcoming · ${decisionHistory.completed.length} completed.`;
      tone = "completed";
    }
    return { title, detail, riskCount: decisionHubSettings.plannedDecisionReviewAlertsEnabled ? decisionRiskAlerts.length : 0, reviewCount, upcomingCount: decisionHistory.upcoming.length, completedCount: decisionHistory.completed.length, tone };
  }, [decisionHistory, decisionRiskAlerts, decisionHubSettings.plannedDecisionReviewAlertsEnabled, now, todayIso]);
  const monthlyReview = useMemo(() => {
    const overCategory = [...categoryPlan]
      .filter(row => row.remaining < -0.005)
      .sort((left, right) => left.remaining - right.remaining)[0];
    const bestCategory = [...categoryPlan]
      .filter(row => row.remaining > 0.005 && row.budgeted > 0)
      .sort((left, right) => right.remaining - left.remaining)[0];
    const totalDebtMinimums = bills
      .filter(bill => bill.is_debt && bill.balance > 0)
      .reduce((sum, bill) => sum + bill.amount + Number(bill.snowball_minimum_boost ?? 0), 0);
    const savingsPct = savingsData.totalTarget > 0
      ? Math.min(100, (savingsData.totalSaved / savingsData.totalTarget) * 100)
      : 0;
    const billDelta = stats.totalDue - stats.totalPaid;
    const headline = billDelta <= 0.005
      ? "Bills are covered"
      : `${stats.unpaidCount} bill${stats.unpaidCount === 1 ? "" : "s"} still open`;
    const nextStep = overCategory
      ? `Review ${overCategory.category}; it is over by $${Math.abs(overCategory.remaining).toFixed(0)}.`
      : bestCategory
        ? `${bestCategory.category} has the best cushion at $${bestCategory.remaining.toFixed(0)} left.`
        : "Keep reviewing actuals as they come in.";
    return {
      headline,
      billDelta,
      overCategory,
      bestCategory,
      completed: decisionHistory.completed.length,
      changed: decisionHistory.changed.length + decisionHistory.due.length,
      totalDebtMinimums,
      savingsPct,
      nextStep,
      prompt: "What should I improve next month?",
    };
  }, [bills, categoryPlan, decisionHistory, savingsData.totalSaved, savingsData.totalTarget, stats.totalDue, stats.totalPaid, stats.unpaidCount]);
  const nextWeekRisk = useMemo(() => {
    if (!decisionHubSettings.lowBalanceAlertsEnabled) return null;
    const weekEndDate = new Date(now);
    weekEndDate.setDate(now.getDate() + 7);
    const weekEnd = `${weekEndDate.getFullYear()}-${String(weekEndDate.getMonth() + 1).padStart(2, "0")}-${String(weekEndDate.getDate()).padStart(2, "0")}`;
    const weekDays = decisionForecastDays.filter(day => day.date >= todayIso && day.date <= weekEnd);
    const lowest = weekDays.reduce<{ date: string; balance: number } | null>(
      (best, day) => !best || day.balance < best.balance ? day : best,
      null,
    );
    const sensitivityBuffer = decisionHubSettings.alertSensitivity === "conservative"
      ? 300
      : decisionHubSettings.alertSensitivity === "quiet"
        ? 0
        : 150;
    if (!lowest || lowest.balance >= settings.safety_floor + sensitivityBuffer) return null;
    const tone = lowest.balance < settings.safety_floor ? "risk" : "tight";
    const prompt = `Why is my balance low next week? My lowest projected balance is $${lowest.balance.toFixed(0)} on ${lowest.date}.`;
    return {
      tone,
      title: tone === "risk" ? "Next week has a low balance risk" : "Next week is tight",
      detail: `Lowest projected balance: $${lowest.balance.toFixed(0)} on ${formatShortDate(lowest.date)}. Ask Flo why before changing the plan.`,
      prompt,
      saferBillPrompt: "What bill should I move?",
      reducePlanPrompt: "Which planned decisions should I reduce or postpone?",
    };
  }, [decisionForecastDays, decisionHubSettings.alertSensitivity, decisionHubSettings.lowBalanceAlertsEnabled, now, settings.safety_floor, todayIso]);
  const openFloWithPrompt = (prompt: string) => {
    router.push({ pathname: "/(tabs)/flo", params: { prompt } } as any);
  };

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: c.background }]}
      contentContainerStyle={[styles.content, { paddingTop: Platform.OS === "web" ? 16 : insets.top + 16, paddingBottom: insets.bottom + 100 }]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[styles.heading,    { color: c.foreground }]}>FlowLedger</Text>
      <Text style={[styles.subheading, { color: c.mutedForeground }]}>{MONTH_FULL[currentMonth]} {selectedYear}</Text>

      {!settings.onboarding_completed && (() => {
        const steps = [
          { label: "Add an account", done: accounts.some(account => account.is_active) },
          { label: "Add income", done: incomes.length > 0 },
          { label: "Add recurring bills", done: bills.some(bill => bill.is_recurring || bill.is_debt) },
          { label: "Review safety settings", done: settings.safety_floor >= 0 && settings.forecast_horizon_months > 0 },
          { label: "See your first forecast", done: accounts.length > 0 && incomes.length > 0 && bills.length > 0 },
        ];
        const complete = steps.every(step => step.done);
        return <View style={[styles.setupCard, { backgroundColor: c.card, borderColor: c.border }]}>
          <View style={styles.setupHeader}><View style={{ flex: 1 }}><Text style={[styles.setupTitle, { color: c.foreground }]}>Let Flo set up your forecast</Text><Text style={[styles.setupDesc, { color: c.mutedForeground }]}>{steps.filter(step => step.done).length} of {steps.length} setup steps complete</Text></View><Pressable onPress={() => void updateSettings({ onboarding_completed: true })}><Feather name="x" size={18} color={c.mutedForeground} /></Pressable></View>
          {steps.map(step => <View key={step.label} style={styles.setupStep}><Feather name={step.done ? "check-circle" : "circle"} size={15} color={step.done ? c.success : c.mutedForeground} /><Text style={[styles.setupStepText, { color: step.done ? c.mutedForeground : c.foreground }]}>{step.label}</Text></View>)}
          <Pressable onPress={() => complete ? void updateSettings({ onboarding_completed: true }) : router.push("/setup" as any)} style={[styles.setupButton, { backgroundColor: c.primary }]}><Text style={[styles.setupButtonText, { color: c.primaryForeground }]}>{complete ? "Finish Setup" : "Start with Flo"}</Text></Pressable>
        </View>;
      })()}

      <Pressable onPress={() => router.push("/(tabs)/more" as any)} style={[styles.confidenceCard, { backgroundColor: forecastConfidence.level === "high" ? c.success + "12" : forecastConfidence.level === "medium" ? "#f59e0b16" : c.destructive + "10" }]}>
        <Feather name={forecastConfidence.level === "high" ? "check-circle" : "alert-circle"} size={17} color={forecastConfidence.level === "high" ? c.success : forecastConfidence.level === "medium" ? "#d97706" : c.destructive} />
        <View style={{ flex: 1 }}><Text style={[styles.confidenceTitle, { color: c.foreground }]}>Forecast confidence: {forecastConfidence.label}</Text><Text style={[styles.confidenceDesc, { color: c.mutedForeground }]}>{forecastConfidence.reasons[0]}</Text></View><Feather name="chevron-right" size={16} color={c.mutedForeground} />
      </Pressable>

      {nextWeekRisk ? (
        <Pressable
          onPress={() => openFloWithPrompt(nextWeekRisk.prompt)}
          style={({ pressed }) => [
            styles.proactiveAlertCard,
            {
              backgroundColor: nextWeekRisk.tone === "risk" ? c.destructive + "12" : c.warning + "14",
              borderColor: nextWeekRisk.tone === "risk" ? c.destructive + "70" : c.warning + "70",
              opacity: pressed ? 0.82 : 1,
            },
          ]}
        >
          <View style={[styles.proactiveAlertIcon, { backgroundColor: nextWeekRisk.tone === "risk" ? c.destructive + "18" : c.warning + "18" }]}>
            <Feather name="alert-triangle" size={17} color={nextWeekRisk.tone === "risk" ? c.destructive : c.warning} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.proactiveAlertTitle, { color: c.foreground }]}>{nextWeekRisk.title}</Text>
            <Text style={[styles.proactiveAlertText, { color: c.mutedForeground }]}>{nextWeekRisk.detail}</Text>
            <View style={styles.proactiveActionRow}>
              <Pressable
                onPress={() => openFloWithPrompt(nextWeekRisk.prompt)}
                style={({ pressed }) => [styles.proactiveActionButton, { backgroundColor: c.primary + "18", opacity: pressed ? 0.75 : 1 }]}
              >
                <Text style={[styles.proactiveActionText, { color: c.primary }]}>Show why</Text>
              </Pressable>
              <Pressable
                onPress={() => openFloWithPrompt(nextWeekRisk.saferBillPrompt)}
                style={({ pressed }) => [styles.proactiveActionButton, { backgroundColor: c.warning + "18", opacity: pressed ? 0.75 : 1 }]}
              >
                <Text style={[styles.proactiveActionText, { color: c.warning }]}>Find safer bill date</Text>
              </Pressable>
              <Pressable
                onPress={() => openFloWithPrompt(nextWeekRisk.reducePlanPrompt)}
                style={({ pressed }) => [styles.proactiveActionButton, { backgroundColor: c.destructive + "12", opacity: pressed ? 0.75 : 1 }]}
              >
                <Text style={[styles.proactiveActionText, { color: c.destructive }]}>Reduce planned spending</Text>
              </Pressable>
            </View>
          </View>
          <View style={[styles.askFloPill, { backgroundColor: c.primary + "18" }]}>
            <Text style={[styles.askFloPillText, { color: c.primary }]}>Ask Flo</Text>
          </View>
        </Pressable>
      ) : null}

      {/* ── HERO: flip card — front = Balance Today, back = Savings ── */}
      {(() => {
        const cur = balanceMetrics?.currentBalance ?? cashFlow.remaining;
        const isNeg = cur < 0;
        const isLow = !isNeg && cur < settings.safety_floor;
        const gradColors: [string, string] = isNeg
          ? [c.destructive, "#b91c1c"]
          : isLow
          ? ["#d97706", "#b45309"]
          : ["#1d4ed8", "#16a34a"];

        const savingsPct = savingsData.totalTarget > 0
          ? Math.min((savingsData.totalSaved / savingsData.totalTarget) * 100, 100)
          : 0;

        return (
          <Pressable
            onPress={doFlip}
            style={{ marginBottom: 14 }}
            onLayout={e => setCardHeight(e.nativeEvent.layout.height)}
          >
            {/* ── FRONT: Balance Today ── */}
            <Animated.View
              style={{
                transform: [{ perspective: 1000 }, { rotateY: frontRotate }],
                backfaceVisibility: "hidden",
              }}
            >
              <LinearGradient
                colors={gradColors}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={[styles.heroCard, { overflow: "hidden", marginBottom: 0 }]}
              >
                <View style={styles.heroGlowTop} />
                <View style={styles.heroGlowBottom} />

                <View style={styles.heroFlipHint}>
                  <Feather name="refresh-cw" size={12} color="rgba(255,255,255,0.55)" />
                  <Text style={styles.heroFlipHintText}>tap to see savings</Text>
                </View>

                <Text style={styles.heroLabel}>Balance Today</Text>
                <Text style={styles.heroValue}>
                  {cur < 0 ? "−" : ""}${Math.abs(cur).toFixed(0)}
                </Text>

                <View style={styles.heroMetrics}>
                  <View style={styles.heroMetric}>
                    <Text style={styles.heroMetricLabel}>End of Month</Text>
                    <Text style={[styles.heroMetricValue, {
                      color: (balanceMetrics?.endOfMonthBalance ?? 0) < 0 ? "#fca5a5" : "rgba(255,255,255,0.95)"
                    }]}>
                      {(balanceMetrics?.endOfMonthBalance ?? 0) < 0 ? "−" : ""}
                      ${Math.abs(balanceMetrics?.endOfMonthBalance ?? 0).toFixed(0)}
                    </Text>
                  </View>
                  <View style={styles.heroMetricDivider} />
                  <View style={styles.heroMetric}>
                    <Text style={styles.heroMetricLabel}>Lowest Balance</Text>
                    <Text style={[styles.heroMetricValue, {
                      color: (balanceMetrics?.lowestBalance ?? 0) < 0 ? "#fca5a5"
                        : (balanceMetrics?.lowestBalance ?? 0) < settings.safety_floor ? "#fde68a"
                        : "#bbf7d0"
                    }]}>
                      {(balanceMetrics?.lowestBalance ?? 0) < 0 ? "−" : ""}
                      ${Math.abs(balanceMetrics?.lowestBalance ?? 0).toFixed(0)}
                      {balanceMetrics ? ` · ${MONTH_NAMES[currentMonth]} ${balanceMetrics.lowestDay}` : ""}
                    </Text>
                  </View>
                </View>

                {stats.totalDue > 0 && (
                  <View style={styles.heroProgress}>
                    <View style={[styles.heroProgressTrack, { backgroundColor: "rgba(255,255,255,0.25)" }]}>
                      <LinearGradient
                        colors={["rgba(255,255,255,0.6)", "rgba(255,255,255,0.95)"]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 0 }}
                        style={[styles.heroProgressFill, { width: `${Math.min(stats.billProgressPercent, 100)}%` as any }]}
                      />
                    </View>
                    <Text style={styles.heroProgressLabel}>
                      {stats.paidCount} of {stats.billCount} bills paid this month
                      {stats.unpaidCount > 0 ? ` • ${stats.unpaidCount} left` : ""}
                    </Text>
                  </View>
                )}
              </LinearGradient>
            </Animated.View>

            {/* ── BACK: Savings ── */}
            <Animated.View
              style={[
                StyleSheet.absoluteFill,
                {
                  transform: [{ perspective: 1000 }, { rotateY: backRotate }],
                  backfaceVisibility: "hidden",
                },
              ]}
            >
              <LinearGradient
                colors={["#065f46", "#047857"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={[styles.heroCard, { overflow: "hidden", marginBottom: 0, height: cardHeight || undefined }]}
              >
                <View style={styles.heroGlowTop} />
                <View style={styles.heroGlowBottom} />

                <View style={styles.heroFlipHint}>
                  <Feather name="refresh-cw" size={12} color="rgba(255,255,255,0.55)" />
                  <Text style={styles.heroFlipHintText}>tap to go back</Text>
                </View>

                <Text style={styles.heroLabel}>Savings</Text>
                <Text style={styles.heroValue}>
                  ${savingsData.totalSaved.toFixed(0)}
                </Text>

                <View style={styles.heroMetrics}>
                  <View style={styles.heroMetric}>
                    <Text style={styles.heroMetricLabel}>Total Target</Text>
                    <Text style={[styles.heroMetricValue, { color: "rgba(255,255,255,0.95)" }]}>
                      ${savingsData.totalTarget.toFixed(0)}
                    </Text>
                  </View>
                  <View style={styles.heroMetricDivider} />
                  <View style={styles.heroMetric}>
                    <Text style={styles.heroMetricLabel}>Monthly Surplus</Text>
                    <Text style={[styles.heroMetricValue, {
                      color: savingsData.monthlySurplus > 0 ? "#bbf7d0" : "#fca5a5"
                    }]}>
                      {savingsData.monthlySurplus > 0 ? "+" : ""}${savingsData.monthlySurplus.toFixed(0)}/mo
                    </Text>
                  </View>
                </View>

                {/* Savings progress bar */}
                <View style={styles.heroProgress}>
                  <View style={[styles.heroProgressTrack, { backgroundColor: "rgba(255,255,255,0.25)" }]}>
                    <LinearGradient
                      colors={["#6ee7b7", "#34d399"]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={[styles.heroProgressFill, { width: `${savingsPct}%` as any }]}
                    />
                  </View>
                  <Text style={styles.heroProgressLabel}>
                    {savingsData.goalCount > 0
                      ? `${savingsPct.toFixed(0)}% of ${savingsData.goalCount} goal${savingsData.goalCount !== 1 ? "s" : ""} funded`
                      : "No savings goals yet — tap Goals below to add one"}
                  </Text>
                </View>

                {/* Mini goal list */}
                {savingsGoals.slice(0, 3).map(g => {
                  const pct = g.target_amount > 0
                    ? Math.min((g.current_amount / g.target_amount) * 100, 100)
                    : 0;
                  return (
                    <View key={g.id} style={styles.heroGoalRow}>
                      <Text style={styles.heroGoalName} numberOfLines={1}>{g.name}</Text>
                      <View style={styles.heroGoalTrack}>
                        <View style={[styles.heroGoalFill, { width: `${pct}%` as any }]} />
                      </View>
                      <Text style={styles.heroGoalPct}>{pct.toFixed(0)}%</Text>
                    </View>
                  );
                })}
              </LinearGradient>
            </Animated.View>
          </Pressable>
        );
      })()}

      {/* ── Stat Pill Cards ── */}
      {/* Row 1: Bills · Paid · Unpaid */}
      {forecastTrust && balanceMetrics ? (
        <View style={[styles.forecastTrustCard, { backgroundColor: c.card, borderColor: c.border }]}>
          <View style={styles.forecastTrustHeader}>
            <View style={[styles.forecastTrustIcon, { backgroundColor: c.primary + "18" }]}>
              <Feather name="shield" size={15} color={c.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.forecastTrustTitle, { color: c.foreground }]}>Why these numbers?</Text>
              <Text style={[styles.forecastTrustSub, { color: c.mutedForeground }]}>
                Forecast uses {forecastTrust.sourceCount} dated source item{forecastTrust.sourceCount === 1 ? "" : "s"} across today, month-end, and the low point.
              </Text>
            </View>
            <Pressable
              onPress={() => openFloWithPrompt(forecastTrust.prompt)}
              style={({ pressed }) => [styles.forecastTrustAsk, { backgroundColor: c.primary + "18", opacity: pressed ? 0.75 : 1 }]}
            >
              <Text style={[styles.forecastTrustAskText, { color: c.primary }]}>Ask Flo</Text>
            </Pressable>
          </View>
          <View style={styles.forecastTrustGrid}>
            <View style={[styles.forecastTrustMetric, { backgroundColor: c.muted }]}>
              <Text style={[styles.forecastTrustLabel, { color: c.mutedForeground }]}>Today</Text>
              <Text style={[styles.forecastTrustValue, { color: balanceMetrics.currentBalance < settings.safety_floor ? c.warning : c.success }]}>${balanceMetrics.currentBalance.toFixed(0)}</Text>
            </View>
            <View style={[styles.forecastTrustMetric, { backgroundColor: c.muted }]}>
              <Text style={[styles.forecastTrustLabel, { color: c.mutedForeground }]}>End Month</Text>
              <Text style={[styles.forecastTrustValue, { color: balanceMetrics.endOfMonthBalance < 0 ? c.destructive : c.foreground }]}>${balanceMetrics.endOfMonthBalance.toFixed(0)}</Text>
            </View>
            <View style={[styles.forecastTrustMetric, { backgroundColor: c.muted }]}>
              <Text style={[styles.forecastTrustLabel, { color: c.mutedForeground }]}>Low Point</Text>
              <Text style={[styles.forecastTrustValue, { color: balanceMetrics.lowestBalance < settings.safety_floor ? c.warning : c.success }]}>${balanceMetrics.lowestBalance.toFixed(0)}</Text>
            </View>
          </View>
          <Text style={[styles.forecastTrustDrivers, { color: c.mutedForeground }]}>
            {forecastTrust.topDrivers.length > 0
              ? `Low-point drivers: ${forecastTrust.topDrivers.join(" · ")}`
              : "Tap a calendar day in Monthly for the full source-by-source breakdown."}
          </Text>
        </View>
      ) : null}

      <View style={[styles.statsPillRow, { marginBottom: 8 }]}>
        {statCards.slice(0, 3).map(card => (
          <Pressable
            key={card.title}
            onPress={() => navigate(card.filter, card.tab)}
            style={({ pressed }) => [styles.statPill, { backgroundColor: c.card, opacity: pressed ? 0.8 : 1 }]}
          >
            <Text style={[styles.statPillValue, { color: card.col }]} numberOfLines={1}>{card.value}</Text>
            <Text style={[styles.statPillLabel, { color: c.mutedForeground }]}>{card.title.toUpperCase()}</Text>
          </Pressable>
        ))}
      </View>
      {/* Row 2: Debt — full width */}
      {(() => {
        const debt = statCards[3];
        return (
          <Pressable
            onPress={() => navigate(debt.filter, debt.tab)}
            style={({ pressed }) => [styles.statDebtRow, { backgroundColor: c.card, opacity: pressed ? 0.8 : 1 }]}
          >
            <View>
              <Text style={[styles.statPillLabel, { color: c.mutedForeground }]}>DEBT</Text>
              <Text style={[styles.statDebtValue, { color: debt.col }]}>{debt.value}</Text>
            </View>
            <Feather name="chevron-right" size={16} color={c.mutedForeground} />
          </Pressable>
        );
      })()}

      {/* ── Negative date warning (tappable → 12-month outlook) ── */}
      {firstYearNegEntry && (
        <Pressable
          onPress={() => setNegCalendarVisible(true)}
          style={({ pressed }) => [styles.negWarning, { backgroundColor: c.destructive + "18", borderRadius: colors.radius, opacity: pressed ? 0.8 : 1 }]}
        >
          <Feather name="alert-triangle" size={15} color={c.destructive} />
          <Text style={[styles.negWarningText, { color: c.destructive }]}>
            Your balance goes negative on{" "}
            <Text style={{ fontFamily: "Inter_700Bold" }}>
              {MONTH_NAMES[firstYearNegEntry.month]} {firstYearNegEntry.firstNegDay}
              {firstYearNegEntry.year !== selectedYear ? ` ${firstYearNegEntry.year}` : ""}
            </Text>
            {" "}— tap to see full outlook
          </Text>
          <Feather name="chevron-right" size={14} color={c.destructive} />
        </Pressable>
      )}

      <Pressable
        onPress={() => openFloWithPrompt("What decisions need review?")}
        style={({ pressed }) => [
          styles.decisionHubCard,
          {
            backgroundColor: c.card,
            borderColor: decisionAlert.tone === "risk" ? c.destructive + "80" : decisionAlert.tone === "review" ? c.warning + "80" : c.border,
            opacity: pressed ? 0.82 : 1,
          },
        ]}
      >
        <View style={[styles.decisionHubIcon, { backgroundColor: decisionAlert.tone === "risk" ? c.destructive + "18" : decisionAlert.tone === "review" ? c.warning + "18" : c.primary + "18" }]}>
          <Feather
            name={decisionAlert.tone === "risk" ? "alert-triangle" : decisionAlert.tone === "review" ? "alert-circle" : "clock"}
            size={18}
            color={decisionAlert.tone === "risk" ? c.destructive : decisionAlert.tone === "review" ? c.warning : c.primary}
          />
        </View>
        <View style={styles.decisionHubBody}>
          <Text style={[styles.decisionHubEyebrow, { color: c.mutedForeground }]}>Flo Decision Center</Text>
          <Text style={[styles.decisionHubTitle, { color: c.foreground }]}>{decisionAlert.title}</Text>
          <Text style={[styles.decisionHubDesc, { color: c.mutedForeground }]}>{decisionAlert.detail}</Text>
          <View style={styles.decisionHubStats}>
            <Text style={[styles.decisionHubStat, { color: decisionAlert.riskCount > 0 ? c.destructive : c.mutedForeground }]}>
              {decisionAlert.riskCount} risky
            </Text>
            <Text style={[styles.decisionHubStat, { color: decisionAlert.reviewCount > 0 ? c.warning : c.mutedForeground }]}>
              {decisionAlert.reviewCount} review
            </Text>
            <Text style={[styles.decisionHubStat, { color: c.primary }]}>{decisionAlert.upcomingCount} upcoming</Text>
            <Text style={[styles.decisionHubStat, { color: c.success }]}>{decisionAlert.completedCount} completed</Text>
          </View>
        </View>
        <Feather name="chevron-right" size={18} color={c.mutedForeground} />
      </Pressable>

      <View style={[styles.monthlyReviewCard, { backgroundColor: c.card, borderColor: c.border }]}>
        <View style={styles.monthlyReviewHeader}>
          <View style={[styles.monthlyReviewIcon, { backgroundColor: c.success + "18" }]}>
            <Feather name="bar-chart-2" size={17} color={c.success} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.decisionHubEyebrow, { color: c.mutedForeground }]}>Monthly Review</Text>
            <Text style={[styles.monthlyReviewTitle, { color: c.foreground }]}>{monthlyReview.headline}</Text>
            <Text style={[styles.monthlyReviewDesc, { color: c.mutedForeground }]}>{monthlyReview.nextStep}</Text>
          </View>
          <Pressable
            onPress={() => openFloWithPrompt(monthlyReview.prompt)}
            style={({ pressed }) => [styles.monthlyReviewAsk, { backgroundColor: c.primary + "18", opacity: pressed ? 0.75 : 1 }]}
          >
            <Text style={[styles.monthlyReviewAskText, { color: c.primary }]}>Ask Flo</Text>
          </Pressable>
        </View>
        <View style={styles.monthlyReviewGrid}>
          <Pressable
            onPress={() => navigate("unpaid", "monthly")}
            style={({ pressed }) => [styles.monthlyReviewMetric, { backgroundColor: c.muted, opacity: pressed ? 0.75 : 1 }]}
          >
            <Text style={[styles.monthlyReviewLabel, { color: c.mutedForeground }]}>Bills left</Text>
            <Text style={[styles.monthlyReviewValue, { color: monthlyReview.billDelta > 0 ? c.warning : c.success }]}>${Math.max(0, monthlyReview.billDelta).toFixed(0)}</Text>
          </Pressable>
          <Pressable
            onPress={() => openFloWithPrompt("What decisions need review?")}
            style={({ pressed }) => [styles.monthlyReviewMetric, { backgroundColor: c.muted, opacity: pressed ? 0.75 : 1 }]}
          >
            <Text style={[styles.monthlyReviewLabel, { color: c.mutedForeground }]}>Decisions</Text>
            <Text style={[styles.monthlyReviewValue, { color: monthlyReview.changed > 0 ? c.warning : c.success }]}>{monthlyReview.completed}/{monthlyReview.changed + monthlyReview.completed}</Text>
          </Pressable>
          <Pressable
            onPress={() => navigate("debt", "bills")}
            style={({ pressed }) => [styles.monthlyReviewMetric, { backgroundColor: c.muted, opacity: pressed ? 0.75 : 1 }]}
          >
            <Text style={[styles.monthlyReviewLabel, { color: c.mutedForeground }]}>Debt mins</Text>
            <Text style={[styles.monthlyReviewValue, { color: c.destructive }]}>${monthlyReview.totalDebtMinimums.toFixed(0)}</Text>
          </Pressable>
          <Pressable
            onPress={() => router.push("/(tabs)/more" as any)}
            style={({ pressed }) => [styles.monthlyReviewMetric, { backgroundColor: c.muted, opacity: pressed ? 0.75 : 1 }]}
          >
            <Text style={[styles.monthlyReviewLabel, { color: c.mutedForeground }]}>Savings</Text>
            <Text style={[styles.monthlyReviewValue, { color: c.success }]}>{monthlyReview.savingsPct.toFixed(0)}%</Text>
          </Pressable>
        </View>
        <View style={styles.monthlyReviewActions}>
          <Pressable
            onPress={() => router.push("/(tabs)/category-budget" as any)}
            style={({ pressed }) => [styles.monthlyReviewAction, { backgroundColor: (monthlyReview.overCategory ? c.warning : c.primary) + "18", opacity: pressed ? 0.75 : 1 }]}
          >
            <Feather name={monthlyReview.overCategory ? "alert-triangle" : "grid"} size={12} color={monthlyReview.overCategory ? c.warning : c.primary} />
            <Text style={[styles.monthlyReviewActionText, { color: monthlyReview.overCategory ? c.warning : c.primary }]}>
              {monthlyReview.overCategory ? "Review category leak" : "Review categories"}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => openFloWithPrompt(monthlyReview.prompt)}
            style={({ pressed }) => [styles.monthlyReviewAction, { backgroundColor: c.success + "18", opacity: pressed ? 0.75 : 1 }]}
          >
            <Feather name="message-circle" size={12} color={c.success} />
            <Text style={[styles.monthlyReviewActionText, { color: c.success }]}>Improve next month</Text>
          </Pressable>
        </View>
      </View>

      {paycheckPlan && (
        <View style={[styles.paycheckPlanCard, { backgroundColor: c.card, borderColor: paycheckPlan.status === "risk" ? c.destructive + "80" : paycheckPlan.status === "tight" ? c.warning + "80" : c.border }]}>
          <View style={styles.paycheckPlanHeader}>
            <View style={[styles.paycheckPlanIcon, { backgroundColor: paycheckPlan.status === "risk" ? c.destructive + "18" : paycheckPlan.status === "tight" ? c.warning + "18" : c.success + "18" }]}>
              <Feather
                name={paycheckPlan.status === "risk" ? "alert-triangle" : paycheckPlan.status === "empty" ? "calendar" : "briefcase"}
                size={18}
                color={paycheckPlan.status === "risk" ? c.destructive : paycheckPlan.status === "tight" ? c.warning : c.success}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.decisionHubEyebrow, { color: c.mutedForeground }]}>Paycheck Plan</Text>
              <Text style={[styles.paycheckPlanTitle, { color: c.foreground }]}>
                {paycheckPlan.nextPaycheck
                  ? `Until ${new Date(paycheckPlan.nextPaycheck.date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
                  : "No upcoming paycheck found"}
              </Text>
            </View>
            <Text style={[styles.paycheckPlanSafe, { color: paycheckPlan.status === "risk" ? c.destructive : paycheckPlan.status === "tight" ? c.warning : c.success }]}>
              ${paycheckPlan.safeToSpend.toFixed(0)}
            </Text>
          </View>
          <Text style={[styles.paycheckPlanDesc, { color: c.mutedForeground }]}>
            {paycheckPlan.nextPaycheck
              ? `Safe to spend before ${paycheckPlan.nextPaycheck.name} lands. Lowest forecast: $${paycheckPlan.lowestBalance.toFixed(0)} on ${new Date(paycheckPlan.lowestBalanceDate + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}.`
              : "Add recurring income to unlock paycheck-by-paycheck planning."}
          </Text>
          <View style={styles.paycheckPlanStats}>
            <View style={[styles.paycheckPlanStatBox, { backgroundColor: c.muted }]}>
              <Text style={[styles.paycheckPlanStatLabel, { color: c.mutedForeground }]}>Bills before pay</Text>
              <Text style={[styles.paycheckPlanStatValue, { color: c.foreground }]}>{paycheckPlan.billsDue.length}</Text>
            </View>
            <View style={[styles.paycheckPlanStatBox, { backgroundColor: c.muted }]}>
              <Text style={[styles.paycheckPlanStatLabel, { color: c.mutedForeground }]}>Bills total</Text>
              <Text style={[styles.paycheckPlanStatValue, { color: c.warning }]}>${paycheckPlan.billsTotal.toFixed(0)}</Text>
            </View>
            <View style={[styles.paycheckPlanStatBox, { backgroundColor: c.muted }]}>
              <Text style={[styles.paycheckPlanStatLabel, { color: c.mutedForeground }]}>Next pay</Text>
              <Text style={[styles.paycheckPlanStatValue, { color: c.success }]}>
                {paycheckPlan.nextPaycheck ? `$${paycheckPlan.nextPaycheck.amount.toFixed(0)}` : "—"}
              </Text>
            </View>
          </View>
          {paycheckPlan.billsDue.length > 0 && (
            <View style={[styles.paycheckPlanBills, { borderTopColor: c.border }]}>
              {paycheckPlan.billsDue.slice(0, 3).map(bill => (
                <View key={`${bill.id ?? bill.name}-${bill.dueDate}`} style={styles.paycheckPlanBillRow}>
                  <Text numberOfLines={1} style={[styles.paycheckPlanBillName, { color: c.foreground }]}>{bill.name}</Text>
                  <Text style={[styles.paycheckPlanBillAmount, { color: c.mutedForeground }]}>
                    ${bill.amount.toFixed(0)} · {new Date(bill.dueDate + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </Text>
                </View>
              ))}
            </View>
          )}
          <View style={styles.paycheckPlanActions}>
            <Pressable
              onPress={() => openFloWithPrompt("What can I spend until payday?")}
              style={({ pressed }) => [styles.paycheckPlanAction, { backgroundColor: c.primary + "18", opacity: pressed ? 0.75 : 1 }]}
            >
              <Feather name="message-circle" size={13} color={c.primary} />
              <Text style={[styles.paycheckPlanActionText, { color: c.primary }]}>Ask Flo</Text>
            </Pressable>
            {paycheckPlan.billsDue.length > 0 ? (
              <Pressable
                onPress={() => openFloWithPrompt("What bill should I move?")}
                style={({ pressed }) => [styles.paycheckPlanAction, { backgroundColor: c.warning + "18", opacity: pressed ? 0.75 : 1 }]}
              >
                <Feather name="shuffle" size={13} color={c.warning} />
                <Text style={[styles.paycheckPlanActionText, { color: c.warning }]}>Move a bill</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      )}

      {categoryPlan.length > 0 && (
        <View style={{ marginBottom: 14 }}>
          {categoryDecisionAlert ? (
            <Pressable
              onPress={() => openFloWithPrompt(categoryDecisionAlert.prompt)}
              style={({ pressed }) => [
                styles.categoryDecisionAlert,
                {
                  backgroundColor: categoryDecisionAlert.tone === "risk" ? c.destructive + "12" : c.warning + "14",
                  borderColor: categoryDecisionAlert.tone === "risk" ? c.destructive + "70" : c.warning + "70",
                  opacity: pressed ? 0.8 : 1,
                },
              ]}
            >
              <Feather name={categoryDecisionAlert.tone === "risk" ? "alert-triangle" : "eye"} size={17} color={categoryDecisionAlert.tone === "risk" ? c.destructive : c.warning} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.categoryDecisionAlertTitle, { color: c.foreground }]}>{categoryDecisionAlert.title}</Text>
                <Text style={[styles.categoryDecisionAlertText, { color: c.mutedForeground }]}>{categoryDecisionAlert.detail}</Text>
              </View>
              <View style={[styles.askFloPill, { backgroundColor: c.primary + "18" }]}>
                <Text style={[styles.askFloPillText, { color: c.primary }]}>Ask Flo</Text>
              </View>
            </Pressable>
          ) : null}
          <View style={styles.categoryPlanHeader}>
            <View>
              <Text style={[styles.sectionTitle, { color: c.foreground, marginBottom: 2 }]}>Category Budget</Text>
              <Text style={[styles.categoryPlanSub, { color: c.mutedForeground }]}>
                ${categoryPlanTotals.spent.toFixed(0)} spent · ${Math.max(0, categoryPlanTotals.remaining).toFixed(0)} left
              </Text>
            </View>
            <View style={styles.categoryPlanHeaderActions}>
              <Pressable
                onPress={() => router.push("/(tabs)/category-budget" as any)}
                style={({ pressed }) => [styles.categoryBudgetEdit, { backgroundColor: c.primary + "18", opacity: pressed ? 0.75 : 1 }]}
              >
                <Feather name="grid" size={12} color={c.primary} />
                <Text style={[styles.categoryBudgetEditText, { color: c.primary }]}>Manage</Text>
              </Pressable>
              {categoryPlanTotals.remaining < -0.005 ? (
                <View style={[styles.categoryPlanBadge, { backgroundColor: c.destructive + "18" }]}>
                  <Text style={[styles.categoryPlanBadgeText, { color: c.destructive }]}>OVER</Text>
                </View>
              ) : (
                <View style={[styles.categoryPlanBadge, { backgroundColor: c.success + "18" }]}>
                  <Text style={[styles.categoryPlanBadgeText, { color: c.success }]}>ON PLAN</Text>
                </View>
              )}
            </View>
          </View>
          <View style={[styles.categoryPlanCard, { backgroundColor: c.card, borderRadius: colors.radius }]}>
            {categoryPlan.slice(0, 5).map((row, index) => {
              const color = row.status === "over" ? c.destructive : row.status === "watch" ? c.warning : CAT_COLORS[row.category] ?? c.primary;
              const trackWidth = `${Math.min(100, row.percentUsed)}%` as any;
              return (
                <Pressable
                  key={row.category}
                  onPress={() => setSelectedCategory(row.category)}
                  style={({ pressed }) => [
                    styles.categoryPlanRow,
                    { borderTopColor: c.border, borderTopWidth: index > 0 ? 1 : 0, opacity: pressed ? 0.75 : 1 },
                  ]}
                >
                  <View style={[styles.categoryPlanIcon, { backgroundColor: color + "18" }]}>
                    <Feather name={row.status === "over" ? "alert-triangle" : row.status === "watch" ? "eye" : "tag"} size={14} color={color} />
                  </View>
                  <View style={styles.categoryPlanBody}>
                    <View style={styles.categoryPlanTop}>
                      <Text numberOfLines={1} style={[styles.categoryPlanName, { color: c.foreground }]}>{row.category}</Text>
                      <Text style={[styles.categoryPlanAmount, { color }]}>
                        {row.remaining < 0 ? "-" : ""}${Math.abs(row.remaining).toFixed(0)}
                      </Text>
                    </View>
                    <View style={[styles.categoryPlanTrack, { backgroundColor: c.muted }]}>
                      <View style={[styles.categoryPlanFill, { backgroundColor: color, width: trackWidth }]} />
                    </View>
                    <Text style={[styles.categoryPlanDetail, { color: c.mutedForeground }]}>
                      ${row.spent.toFixed(0)} spent of ${row.budgeted.toFixed(0)} planned
                      {row.rollover ? ` · ${row.rollover > 0 ? "+" : "-"}$${Math.abs(row.rollover).toFixed(0)} rollover` : ""}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>
      )}

      {false && <>
      {/* ── WHAT CAN I DO? button ── */}
      <Pressable
        onPress={() => setActionModalVisible(true)}
        style={({ pressed }) => [styles.whatBtn, { backgroundColor: c.card, borderColor: c.border, borderRadius: colors.radius, opacity: pressed ? 0.85 : 1 }]}
      >
        <View style={[styles.whatBtnIcon, { backgroundColor: c.primary + "18" }]}>
          <Feather name="zap" size={18} color={c.primary} />
        </View>
        <Text style={[styles.whatBtnText, { color: c.foreground }]}>What can I do?</Text>
        <Feather name="chevron-right" size={18} color={c.mutedForeground} />
      </Pressable>

      {/* ── AFFORDABILITY CHECK ── */}
      <View style={[styles.affordCard, { backgroundColor: c.card, borderRadius: colors.radius }]}>
        {/* Header */}
        <View style={styles.affordHeader}>
          <View style={[styles.affordHeaderIcon, { backgroundColor: c.primary + "18" }]}>
            <Feather name="help-circle" size={16} color={c.primary} />
          </View>
          <Text style={[styles.affordTitle, { color: c.foreground }]}>Can I afford this?</Text>
        </View>

        {/* Amount row */}
        <View style={styles.affordAmtRow}>
          <Text style={[styles.affordDollar, { color: c.mutedForeground }]}>$</Text>
          <TextInput
            style={[styles.affordInput, { backgroundColor: c.muted, color: c.foreground, borderRadius: 10 }]}
            placeholder="0.00"
            placeholderTextColor={c.mutedForeground}
            keyboardType="decimal-pad"
            returnKeyType="done"
            onSubmitEditing={Keyboard.dismiss}
            value={affordAmt}
            onChangeText={v => { setAffordAmt(v); setAddedAsExpense(false); }}
          />
          {affordAmt.trim().length > 0 && (
            <Pressable onPress={() => { setAffordAmt(""); setAddedAsExpense(false); }} style={[styles.affordClear, { backgroundColor: c.muted }]}>
              <Feather name="x" size={14} color={c.mutedForeground} />
            </Pressable>
          )}
        </View>

        {/* Date picker */}
        <DatePickerField
          value={affordDate}
          onChange={v => { setAffordDate(v); setAddedAsExpense(false); }}
          placeholder="Today"
        />

        {/* Result */}
        {affordResult && (() => {
          const { canAfford, isRisky, shortfall, balanceAtDay, balanceAfter, lowestBal, lowestDateLabel } = affordResult!;
          const state   = !canAfford ? "red" : isRisky ? "yellow" : "green";
          const bgColor = state === "green" ? c.success + "15" : state === "yellow" ? "#f0b42918" : c.destructive + "15";
          const mainCol = state === "green" ? c.success  : state === "yellow" ? "#f0b429"   : c.destructive;
          const icon    = state === "green" ? "check-circle" as const : state === "yellow" ? "alert-triangle" as const : "x-circle" as const;
          const headline =
            state === "green"  ? "You CAN afford this." :
            state === "yellow" ? "You can afford this, but it will be tight." :
                                 "You CANNOT afford this.";

          return (
            <View style={{ marginTop: 12 }}>
              {/* Main verdict */}
              <View style={[styles.affordVerdict, { backgroundColor: bgColor, borderRadius: 12 }]}>
                <Feather name={icon} size={22} color={mainCol} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.affordVerdictTitle, { color: mainCol }]}>{headline}</Text>

                  {state === "green" && (
                    <Text style={[styles.affordVerdictSub, { color: c.mutedForeground }]}>
                      Balance after purchase:{" "}
                      <Text style={{ color: c.success, fontFamily: "Inter_700Bold" }}>
                        ${balanceAfter.toFixed(2)}
                      </Text>
                    </Text>
                  )}
                  {state === "yellow" && (
                    <Text style={[styles.affordVerdictSub, { color: c.mutedForeground }]}>
                      You may run low before your next income.{"\n"}
                      Balance after purchase:{" "}
                      <Text style={{ color: "#f0b429", fontFamily: "Inter_700Bold" }}>
                        ${balanceAfter.toFixed(2)}
                      </Text>
                    </Text>
                  )}
                  {state === "red" && (
                    <Text style={[styles.affordVerdictSub, { color: c.mutedForeground }]}>
                      {"Shortfall: "}
                      <Text style={{ color: c.destructive, fontFamily: "Inter_700Bold" }}>
                        ${shortfall.toFixed(2)}
                      </Text>
                      {"\nBalance goes negative on "}
                      <Text style={{ color: c.destructive, fontFamily: "Inter_700Bold" }}>
                        {affordResult!.firstNegAfterLabel}
                      </Text>
                    </Text>
                  )}
                </View>
              </View>

              {/* "What happens next" insight */}
              <View style={[styles.affordInsight, { backgroundColor: c.muted, borderRadius: 10 }]}>
                <Feather name="trending-down" size={13} color={lowestBal < 0 ? c.destructive : lowestBal < RISKY_THRESHOLD ? "#f0b429" : c.mutedForeground} />
                <Text style={[styles.affordInsightText, { color: c.mutedForeground }]}>
                  Your lowest balance after this will be{" "}
                  <Text style={{ color: lowestBal < 0 ? c.destructive : lowestBal < RISKY_THRESHOLD ? "#f0b429" : c.foreground, fontFamily: "Inter_700Bold" }}>
                    {lowestBal < 0 ? "-" : ""}${Math.abs(lowestBal).toFixed(2)}
                  </Text>
                  {" "}on {lowestDateLabel}.
                </Text>
              </View>

              {/* Quick action */}
              <View style={styles.affordActions}>
                {addedAsExpense ? (
                  <View style={[styles.affordActionDone, { backgroundColor: c.success + "18", borderRadius: 10 }]}>
                    <Feather name="check" size={14} color={c.success} />
                    <Text style={[styles.affordActionDoneText, { color: c.success }]}>Added as expense</Text>
                  </View>
                ) : (
                  <Pressable
                    onPress={() => { setExpenseNameInput(""); setExpenseType("expense"); setExpenseNameModal(true); }}
                    style={({ pressed }) => [styles.affordActionBtn, { backgroundColor: c.primary + "18", opacity: pressed ? 0.75 : 1 }]}
                  >
                    <Feather name="plus-circle" size={14} color={c.primary} />
                    <Text style={[styles.affordActionBtnText, { color: c.primary }]}>Save to Budget</Text>
                  </Pressable>
                )}
              </View>
            </View>
          );
        })()}
      </View>

      </>}
      {/* ── Upcoming Bills ── */}
      {upcomingBills.length > 0 && (
        <>
          <Text style={[styles.sectionTitle, { color: c.foreground }]}>Upcoming Bills (7 days)</Text>
          <View style={[styles.upcomingCard, { backgroundColor: c.card, borderRadius: colors.radius }]}>
            {upcomingBills.map((bill, i) => {
              const catColor = CAT_COLORS[bill.category] ?? c.primary;
              const daysLeft = bill.due_day - today;
              return (
                <Pressable
                  key={bill.id}
                  onPress={() => { router.push("/(tabs)/monthly" as any); }}
                  style={({ pressed }) => [styles.upcomingRow, { borderTopWidth: i > 0 ? 1 : 0, borderTopColor: c.border, opacity: pressed ? 0.75 : 1 }]}
                >
                  <View style={[styles.upcomingDot, { backgroundColor: catColor + "20" }]}>
                    <Feather name="calendar" size={13} color={catColor} />
                  </View>
                  <View style={styles.upcomingInfo}>
                    <Text style={[styles.upcomingName, { color: c.foreground }]}>{bill.name}</Text>
                    <Text style={[styles.upcomingDate, { color: c.mutedForeground }]}>
                      Due {daysLeft === 0 ? "today" : daysLeft === 1 ? "tomorrow" : `in ${daysLeft} days`}
                    </Text>
                  </View>
                  <Text style={[styles.upcomingAmt, { color: c.foreground }]}>${bill.amount.toFixed(0)}</Text>
                  <Feather name="chevron-right" size={13} color={c.mutedForeground} style={{ marginLeft: 4 }} />
                </Pressable>
              );
            })}
          </View>
        </>
      )}

      {/* ── Financial Outlook ── */}
      {balanceMetrics && (() => {
        const daysUntilLowest = balanceMetrics.lowestDay - today;
        const largestUpcoming = bills
          .filter(b => (b.is_recurring || b.is_debt) && b.due_day >= today && b.due_day <= today + 7)
          .reduce<{ name: string; amount: number } | null>((best, b) => {
            const amt = b.amount;
            return !best || amt > best.amount ? { name: b.name, amount: amt } : best;
          }, null);
        const hasRisk = firstYearNegEntry !== null || balanceMetrics.lowestBalance < settings.safety_floor;
        if (!hasRisk && !largestUpcoming) return null;
        return (
          <View style={{ marginBottom: 14 }}>
            <Text style={[styles.sectionTitle, { color: c.foreground }]}>Financial Outlook</Text>
            <View style={[styles.outlookCard, { backgroundColor: c.card, borderRadius: colors.radius }]}>
              {firstYearNegEntry && (
                <View style={[styles.outlookRow, { borderBottomWidth: 1, borderBottomColor: c.border }]}>
                  <View style={[styles.outlookIcon, { backgroundColor: c.destructive + "18" }]}>
                    <Feather name="alert-triangle" size={16} color={c.destructive} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.outlookLabel, { color: c.mutedForeground }]}>Next Risk Date</Text>
                    <Text style={[styles.outlookValue, { color: c.destructive }]}>
                      {MONTH_NAMES[firstYearNegEntry.month]}{firstYearNegEntry.year !== selectedYear ? ` ${firstYearNegEntry.year}` : ""} {firstYearNegEntry.firstNegDay} — balance goes negative
                    </Text>
                  </View>
                </View>
              )}
              {balanceMetrics.lowestBalance < settings.safety_floor && (
                <View style={[styles.outlookRow, largestUpcoming ? { borderBottomWidth: 1, borderBottomColor: c.border } : {}]}>
                  <View style={[styles.outlookIcon, { backgroundColor: "#f0b42918" }]}>
                    <Feather name="trending-down" size={16} color="#f0b429" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.outlookLabel, { color: c.mutedForeground }]}>
                      {daysUntilLowest > 0 ? `Lowest balance in ${daysUntilLowest} day${daysUntilLowest !== 1 ? "s" : ""}` : "Lowest balance today"}
                    </Text>
                    <Text style={[styles.outlookValue, { color: balanceMetrics.lowestBalance < 0 ? c.destructive : "#f0b429" }]}>
                      {balanceMetrics.lowestBalance < 0 ? "−" : ""}${Math.abs(balanceMetrics.lowestBalance).toFixed(0)} on {MONTH_NAMES[currentMonth]} {balanceMetrics.lowestDay}
                    </Text>
                  </View>
                </View>
              )}
              {largestUpcoming && (
                <View style={styles.outlookRow}>
                  <View style={[styles.outlookIcon, { backgroundColor: c.warning + "18" }]}>
                    <Feather name="calendar" size={16} color={c.warning} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.outlookLabel, { color: c.mutedForeground }]}>Largest upcoming bill (7 days)</Text>
                    <Text style={[styles.outlookValue, { color: c.foreground }]}>
                      {largestUpcoming.name} — ${largestUpcoming.amount.toFixed(0)} due {MONTH_NAMES[currentMonth]} {bills.find(b => b.name === largestUpcoming!.name)?.due_day}
                    </Text>
                  </View>
                </View>
              )}
            </View>
          </View>
        );
      })()}

      {/* ── Financial Goals ── */}
      <View style={styles.goalsHeader}>
        <Text style={[styles.sectionTitle, { color: c.foreground, marginBottom: 0 }]}>Financial Goals</Text>
        <View style={styles.goalHeaderActions}>
          <Pressable
            onPress={openSavingsModal}
            style={({ pressed }) => [styles.addGoalBtn, { backgroundColor: c.success + "20", opacity: pressed ? 0.7 : 1 }]}
          >
            <Feather name="dollar-sign" size={15} color={c.success} />
            <Text style={[styles.addGoalText, { color: c.success }]}>Add Savings</Text>
          </Pressable>
          <Pressable
            onPress={() => { setEditGoal(null); setGoalModalVisible(true); }}
            style={({ pressed }) => [styles.addGoalBtn, { backgroundColor: c.primary + "20", opacity: pressed ? 0.7 : 1 }]}
          >
            <Feather name="plus" size={16} color={c.primary} />
            <Text style={[styles.addGoalText, { color: c.primary }]}>Goal</Text>
          </Pressable>
        </View>
      </View>

      {goals.length === 0 ? (
        <View style={[styles.goalsEmpty, { backgroundColor: c.card, borderRadius: colors.radius }]}>
          <Feather name="target" size={28} color={c.mutedForeground} />
          <Text style={[styles.goalsEmptyText, { color: c.mutedForeground }]}>
            Set a financial goal — Christmas fund, vacation, emergency fund...
          </Text>
          <Pressable
            onPress={() => { setEditGoal(null); setGoalModalVisible(true); }}
            style={[styles.goalsEmptyBtn, { backgroundColor: c.primary }]}
          >
            <Text style={[styles.goalsEmptyBtnText, { color: c.primaryForeground }]}>Create First Goal</Text>
          </Pressable>
        </View>
      ) : (
        goals.map(goal => {
          const isBudgetGoal = goal.goal_type === "planned_expense";
          const savedAmount = Math.max(0, goal.current_amount);
          const pct = goal.target_amount > 0 ? Math.min(savedAmount / goal.target_amount, 1) : 0;
          const rawDate   = goal.target_date ?? "";
          const targetDate = rawDate.includes("T") ? new Date(rawDate) : new Date(rawDate + "T12:00:00");
          const goalMonth = targetDate.getMonth();
          const goalYear  = targetDate.getFullYear();
          const afford    = checkGoalAffordability(goal, goalMonth, goalYear);
          const needed    = Math.max(0, goal.target_amount - savedAmount);
          return (
            <Pressable
              key={goal.id}
              onPress={() => { setEditGoal(goal); setGoalModalVisible(true); }}
              style={[styles.goalCard, { backgroundColor: c.card, borderRadius: colors.radius }]}
            >
              <View style={styles.goalTop}>
                <View style={styles.goalLeft}>
                  <View style={styles.goalNameRow}>
                    <Text style={[styles.goalName, { color: c.foreground }]}>{goal.name}</Text>
                    {isBudgetGoal && (
                      <View style={[styles.goalTypeBadge, { backgroundColor: c.primary + "18" }]}>
                        <Text style={[styles.goalTypeBadgeText, { color: c.primary }]}>CAN I AFFORD IT?</Text>
                      </View>
                    )}
                  </View>
                  <Text style={[styles.goalDate, { color: c.mutedForeground }]}>
                    Target: {targetDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </Text>
                </View>
                <View style={styles.goalRight}>
                  <Text style={[styles.goalAmount, { color: c.foreground }]}>
                    {goal.target_amount.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}
                  </Text>
                  <Text style={[styles.goalTarget, { color: c.mutedForeground }]}>
                    {isBudgetGoal ? "purchase amount" : savedAmount.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }) + " saved"}
                  </Text>
                </View>
              </View>
              {!isBudgetGoal && (
                <View style={[styles.goalProgress, { backgroundColor: c.muted }]}>
                  <View style={[styles.goalProgressFill, { width: `${pct * 100}%` as any, backgroundColor: pct >= 1 ? c.success : c.primary }]} />
                </View>
              )}
              <View style={[styles.affordBox, { backgroundColor: afford.canAfford ? c.success + "18" : c.destructive + "18", borderRadius: 8 }]}>
                <Feather name={afford.canAfford ? "check-circle" : "alert-circle"} size={14} color={afford.canAfford ? c.success : c.destructive} />
                <View style={styles.affordText}>
                  <Text style={[styles.affordBoxTitle, { color: afford.canAfford ? c.success : c.destructive }]}>
                    {afford.canAfford ? "You can afford this" : "You cannot afford this"}
                  </Text>
                  {needed > 0 && (
                    <Text style={[styles.affordSub, { color: c.mutedForeground }]}>
                      {afford.canAfford
                        ? `Projected $${afford.projectedBalance.toLocaleString("en-US", { maximumFractionDigits: 0 })} ≥ $${needed.toLocaleString("en-US", { maximumFractionDigits: 0 })} needed`
                        : `$${afford.shortfall.toLocaleString("en-US", { maximumFractionDigits: 0 })} short · projected $${afford.projectedBalance.toLocaleString("en-US", { maximumFractionDigits: 0 })}`}
                    </Text>
                  )}
                </View>
              </View>
            </Pressable>
          );
        })
      )}

      {/* ── "What can I do?" modal ── */}
      <Modal
        visible={actionModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setActionModalVisible(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setActionModalVisible(false)}>
          <Pressable style={[styles.actionSheet, { backgroundColor: c.card }]} onPress={() => {}}>
            <View style={[styles.sheetHandle, { backgroundColor: c.muted }]} />
            <Text style={[styles.sheetTitle, { color: c.foreground }]}>What can I do?</Text>
            <Text style={[styles.sheetSub, { color: c.mutedForeground }]}>
              You have{" "}
              <Text style={{ color: cashFlow.remaining >= 0 ? c.success : c.destructive, fontFamily: "Inter_700Bold" }}>
                ${Math.abs(cashFlow.remaining).toFixed(0)}
              </Text>
              {cashFlow.remaining >= 0 ? " available" : " short"} this month
            </Text>

            {[
              { id: "bill",    icon: "file-text"   as const, label: "Add a Bill",       sub: "Track a new recurring expense",       col: c.primary     },
              { id: "income",  icon: "trending-up" as const, label: "Add Income",        sub: "Log a salary, freelance, or other",    col: c.success     },
              { id: "expense", icon: "shopping-bag"as const, label: "Add a Transaction", sub: "Record a one-time expense or income",  col: c.warning     },
              { id: "debt",    icon: "credit-card" as const, label: "Pay Down Debt",     sub: "Go to snowball / avalanche planner",   col: c.destructive },
            ].map(item => (
              <Pressable
                key={item.id}
                onPress={() => openAction(item.id)}
                style={({ pressed }) => [styles.actionRow, { borderColor: c.border, opacity: pressed ? 0.75 : 1 }]}
              >
                <View style={[styles.actionIcon, { backgroundColor: item.col + "18" }]}>
                  <Feather name={item.icon} size={20} color={item.col} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.actionLabel, { color: c.foreground }]}>{item.label}</Text>
                  <Text style={[styles.actionSub,   { color: c.mutedForeground }]}>{item.sub}</Text>
                </View>
                <Feather name="chevron-right" size={16} color={c.mutedForeground} />
              </Pressable>
            ))}

            <Pressable
              onPress={() => setActionModalVisible(false)}
              style={[styles.sheetCancel, { backgroundColor: c.muted, borderRadius: colors.radius }]}
            >
              <Text style={[styles.sheetCancelText, { color: c.mutedForeground }]}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={categoryBudgetModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setCategoryBudgetModalVisible(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => { Keyboard.dismiss(); setCategoryBudgetModalVisible(false); }}>
          <Pressable style={[styles.actionSheet, { backgroundColor: c.card }]} onPress={() => {}}>
            <View style={[styles.sheetHandle, { backgroundColor: c.muted }]} />
            <Text style={[styles.sheetTitle, { color: c.foreground }]}>Monthly Category Budgets</Text>
            <Text style={[styles.sheetSub, { color: c.mutedForeground }]}>
              {MONTH_FULL[currentMonth]} {selectedYear} · leave blank to use planned bills.
            </Text>

            <ScrollView style={styles.categoryBudgetList} keyboardShouldPersistTaps="handled">
              {budgetEditableCategories.map(category => (
                <View key={category} style={[styles.categoryBudgetRow, { borderTopColor: c.border }]}>
                  <View style={styles.categoryBudgetCopy}>
                    <Text style={[styles.categoryBudgetName, { color: c.foreground }]}>{category}</Text>
                    <Text style={[styles.categoryBudgetHint, { color: c.mutedForeground }]}>
                      Blank = auto from bills
                    </Text>
                  </View>
                  <View style={[styles.categoryBudgetInputWrap, { backgroundColor: c.muted }]}>
                    <Text style={[styles.categoryBudgetDollar, { color: c.mutedForeground }]}>$</Text>
                    <TextInput
                      value={categoryBudgetDrafts[category] ?? ""}
                      onChangeText={(value) => setCategoryBudgetDrafts(previous => ({ ...previous, [category]: value }))}
                      placeholder="Auto"
                      placeholderTextColor={c.mutedForeground}
                      keyboardType="decimal-pad"
                      style={[styles.categoryBudgetInput, { color: c.foreground }]}
                    />
                  </View>
                </View>
              ))}
            </ScrollView>

            <View style={styles.expenseBtns}>
              <Pressable onPress={clearCategoryBudgets} style={[styles.expenseBtn, { backgroundColor: c.muted }]}>
                <Text style={[styles.expenseBtnText, { color: c.mutedForeground }]}>Clear</Text>
              </Pressable>
              <Pressable onPress={saveCategoryBudgets} style={[styles.expenseBtn, { backgroundColor: c.primary }]}>
                <Text style={[styles.expenseBtnText, { color: c.primaryForeground }]}>Save</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={!!selectedCategory}
        transparent
        animationType="slide"
        onRequestClose={() => setSelectedCategory(null)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setSelectedCategory(null)}>
          <Pressable style={[styles.actionSheet, { backgroundColor: c.card }]} onPress={() => {}}>
            <View style={[styles.sheetHandle, { backgroundColor: c.muted }]} />
            {categoryDetail && (
              <>
                <View style={styles.categoryDetailHeader}>
                  <View style={[styles.categoryPlanIcon, { backgroundColor: (CAT_COLORS[categoryDetail.row.category] ?? c.primary) + "18" }]}>
                    <Feather
                      name={categoryDetail.row.status === "over" ? "alert-triangle" : categoryDetail.row.status === "watch" ? "eye" : "tag"}
                      size={16}
                      color={categoryDetail.row.status === "over" ? c.destructive : categoryDetail.row.status === "watch" ? c.warning : CAT_COLORS[categoryDetail.row.category] ?? c.primary}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.sheetTitle, { color: c.foreground, marginBottom: 0 }]}>{categoryDetail.row.category}</Text>
                    <Text style={[styles.sheetSub, { color: c.mutedForeground, marginBottom: 0 }]}>
                      {MONTH_FULL[currentMonth]} {selectedYear} category detail
                    </Text>
                  </View>
                  <Pressable onPress={() => setSelectedCategory(null)} style={[styles.categoryDetailClose, { backgroundColor: c.muted }]}>
                    <Feather name="x" size={17} color={c.mutedForeground} />
                  </Pressable>
                </View>

                <View style={styles.categoryDetailStats}>
                  <View style={[styles.categoryDetailStat, { backgroundColor: c.muted }]}>
                    <Text style={[styles.categoryDetailStatLabel, { color: c.mutedForeground }]}>Planned</Text>
                    <Text style={[styles.categoryDetailStatValue, { color: c.foreground }]}>${categoryDetail.row.budgeted.toFixed(0)}</Text>
                  </View>
                  <View style={[styles.categoryDetailStat, { backgroundColor: c.muted }]}>
                    <Text style={[styles.categoryDetailStatLabel, { color: c.mutedForeground }]}>Spent</Text>
                    <Text style={[styles.categoryDetailStatValue, { color: c.destructive }]}>${categoryDetail.row.spent.toFixed(0)}</Text>
                  </View>
                  <View style={[styles.categoryDetailStat, { backgroundColor: c.muted }]}>
                    <Text style={[styles.categoryDetailStatLabel, { color: c.mutedForeground }]}>Left</Text>
                    <Text style={[styles.categoryDetailStatValue, { color: categoryDetail.row.remaining < 0 ? c.destructive : c.success }]}>
                      {categoryDetail.row.remaining < 0 ? "-" : ""}${Math.abs(categoryDetail.row.remaining).toFixed(0)}
                    </Text>
                  </View>
                  {categoryDetail.row.rollover ? (
                    <View style={[styles.categoryDetailStat, { backgroundColor: c.muted }]}>
                      <Text style={[styles.categoryDetailStatLabel, { color: c.mutedForeground }]}>Rollover</Text>
                      <Text style={[styles.categoryDetailStatValue, { color: categoryDetail.row.rollover < 0 ? c.destructive : c.success }]}>
                        {categoryDetail.row.rollover < 0 ? "-" : "+"}${Math.abs(categoryDetail.row.rollover).toFixed(0)}
                      </Text>
                    </View>
                  ) : null}
                </View>

                <View style={[styles.categoryInsightBox, { backgroundColor: c.primary + "10", borderColor: c.primary + "30" }]}>
                  <Feather name="info" size={15} color={c.primary} />
                  <Text style={[styles.categoryInsightText, { color: c.foreground }]}>{categoryDetail.explanation}</Text>
                </View>

                <ScrollView style={styles.categoryDetailList} keyboardShouldPersistTaps="handled">
                  <Text style={[styles.categoryDetailSectionTitle, { color: c.mutedForeground }]}>Planned bills</Text>
                  {categoryDetail.categoryBills.length ? categoryDetail.categoryBills.map(bill => (
                    <View key={bill.id} style={[styles.categoryDetailItem, { borderTopColor: c.border }]}>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.categoryDetailItemName, { color: c.foreground }]}>{bill.name}</Text>
                        <Text style={[styles.categoryDetailItemMeta, { color: c.mutedForeground }]}>
                          Due day {bill.dueDay}{bill.paid > 0 ? ` · $${bill.paid.toFixed(0)} paid` : ""}
                        </Text>
                      </View>
                      <Text style={[styles.categoryDetailItemAmount, { color: c.foreground }]}>${bill.amount.toFixed(0)}</Text>
                    </View>
                  )) : (
                    <Text style={[styles.categoryDetailEmpty, { color: c.mutedForeground }]}>No planned bills in this category.</Text>
                  )}

                  <Text style={[styles.categoryDetailSectionTitle, { color: c.mutedForeground, marginTop: 14 }]}>Transactions</Text>
                  {categoryDetail.categoryTransactions.length ? categoryDetail.categoryTransactions.slice(0, 6).map(transaction => (
                    <View key={transaction.id} style={[styles.categoryDetailItem, { borderTopColor: c.border }]}>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.categoryDetailItemName, { color: c.foreground }]}>{transaction.name}</Text>
                        <Text style={[styles.categoryDetailItemMeta, { color: c.mutedForeground }]}>{transaction.date}</Text>
                      </View>
                      <Text style={[styles.categoryDetailItemAmount, { color: transaction.amount < 0 ? c.destructive : c.success }]}>
                        {transaction.amount < 0 ? "-" : "+"}${Math.abs(transaction.amount).toFixed(0)}
                      </Text>
                    </View>
                  )) : (
                    <Text style={[styles.categoryDetailEmpty, { color: c.mutedForeground }]}>No transactions in this category yet.</Text>
                  )}
                </ScrollView>

                <View style={styles.categoryDetailActions}>
                  <Pressable
                    onPress={() => openCategoryBudgetEditorForCategory(categoryDetail.row.category)}
                    style={({ pressed }) => [styles.categoryDetailAction, { backgroundColor: c.primary, opacity: pressed ? 0.75 : 1 }]}
                  >
                    <Feather name="edit-3" size={14} color={c.primaryForeground} />
                    <Text style={[styles.categoryDetailActionText, { color: c.primaryForeground }]}>Edit budget</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => openMoveMoney(categoryDetail.row.category)}
                    style={({ pressed }) => [styles.categoryDetailAction, { backgroundColor: c.success + "20", opacity: pressed ? 0.75 : 1 }]}
                  >
                    <Feather name="repeat" size={14} color={c.success} />
                    <Text style={[styles.categoryDetailActionText, { color: c.success }]}>Move money</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      setSelectedCategory(null);
                      router.push("/(tabs)/transactions" as any);
                    }}
                    style={({ pressed }) => [styles.categoryDetailAction, { backgroundColor: c.muted, opacity: pressed ? 0.75 : 1 }]}
                  >
                    <Feather name="list" size={14} color={c.foreground} />
                    <Text style={[styles.categoryDetailActionText, { color: c.foreground }]}>Transactions</Text>
                  </Pressable>
                </View>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={moveMoneyVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setMoveMoneyVisible(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => { Keyboard.dismiss(); setMoveMoneyVisible(false); }}>
          <Pressable style={[styles.actionSheet, { backgroundColor: c.card }]} onPress={() => {}}>
            <View style={[styles.sheetHandle, { backgroundColor: c.muted }]} />
            <Text style={[styles.sheetTitle, { color: c.foreground }]}>Move money</Text>
            <Text style={[styles.sheetSub, { color: c.mutedForeground }]}>
              Add budget to {moveTargetCategory ?? "this category"} by taking available money from another category.
            </Text>

            <Text style={[styles.categoryDetailSectionTitle, { color: c.mutedForeground }]}>Move from</Text>
            {moveSourceOptions.length ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.moveCategoryScroller}>
                {moveSourceOptions.map(row => {
                  const selected = moveSourceCategory === row.category;
                  return (
                    <Pressable
                      key={row.category}
                      onPress={() => {
                        setMoveSourceCategory(row.category);
                        setMoveError("");
                      }}
                      style={[
                        styles.moveCategoryChip,
                        {
                          backgroundColor: selected ? c.primary : c.muted,
                          borderColor: selected ? c.primary : c.border,
                        },
                      ]}
                    >
                      <Text style={[styles.moveCategoryChipName, { color: selected ? c.primaryForeground : c.foreground }]}>
                        {row.category}
                      </Text>
                      <Text style={[styles.moveCategoryChipMeta, { color: selected ? c.primaryForeground : c.mutedForeground }]}>
                        ${row.remaining.toFixed(0)} left
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            ) : (
              <View style={[styles.categoryInsightBox, { backgroundColor: c.warning + "12", borderColor: c.warning + "35" }]}>
                <Feather name="alert-circle" size={15} color={c.warning} />
                <Text style={[styles.categoryInsightText, { color: c.foreground }]}>
                  No other category has available money to move right now.
                </Text>
              </View>
            )}

            <Text style={[styles.categoryDetailSectionTitle, { color: c.mutedForeground, marginTop: 10 }]}>Amount</Text>
            <View style={[styles.moveAmountInputWrap, { backgroundColor: c.muted }]}>
              <Text style={[styles.categoryBudgetDollar, { color: c.mutedForeground }]}>$</Text>
              <TextInput
                value={moveAmount}
                onChangeText={(value) => {
                  setMoveAmount(value);
                  setMoveError("");
                }}
                placeholder="0.00"
                placeholderTextColor={c.mutedForeground}
                keyboardType="decimal-pad"
                style={[styles.moveAmountInput, { color: c.foreground }]}
              />
            </View>
            {moveError ? <Text style={[styles.moveErrorText, { color: c.destructive }]}>{moveError}</Text> : null}

            <View style={styles.expenseBtns}>
              <Pressable
                onPress={() => setMoveMoneyVisible(false)}
                style={[styles.expenseBtn, { backgroundColor: c.muted }]}
              >
                <Text style={[styles.expenseBtnText, { color: c.mutedForeground }]}>Cancel</Text>
              </Pressable>
              <Pressable
                disabled={!moveSourceOptions.length}
                onPress={applyMoveMoney}
                style={[styles.expenseBtn, { backgroundColor: moveSourceOptions.length ? c.primary : c.muted, opacity: moveSourceOptions.length ? 1 : 0.6 }]}
              >
                <Text style={[styles.expenseBtnText, { color: moveSourceOptions.length ? c.primaryForeground : c.mutedForeground }]}>Move</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <AddBillModal
        visible={addBillVisible}
        onClose={() => setAddBillVisible(false)}
        onSave={(data) => addBill(data as Omit<Bill, "id" | "created_at">)}
        onDelete={() => {}}
        editBill={null}
      />

      <GoalModal
        visible={goalModalVisible}
        onClose={() => { setGoalModalVisible(false); setEditGoal(null); }}
        onSave={(data) => {
          if ("id" in data) return updateGoal(data as Goal);
          return addGoal(data);
        }}
        onDelete={deleteGoal}
        editGoal={editGoal}
      />

      {/* ── Add savings contribution modal ── */}
      <Modal
        visible={savingsModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setSavingsModalVisible(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => { Keyboard.dismiss(); setSavingsModalVisible(false); }}>
          <Pressable style={[styles.actionSheet, { backgroundColor: c.card }]} onPress={() => {}}>
            <View style={[styles.sheetHandle, { backgroundColor: c.muted }]} />
            <Text style={[styles.sheetTitle, { color: c.foreground }]}>Add to Savings</Text>
            <Text style={[styles.sheetSub, { color: c.mutedForeground }]}>
              Choose a goal and record a contribution. It will also appear in Transactions.
            </Text>

            <Text style={[styles.savingsFieldLabel, { color: c.mutedForeground }]}>SAVINGS GOAL</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.savingsGoalRow}>
              {savingsGoals.map(goal => (
                <Pressable
                  key={goal.id}
                  onPress={() => setSavingsGoalId(goal.id)}
                  style={[
                    styles.savingsGoalChip,
                    {
                      backgroundColor: savingsGoalId === goal.id ? c.primary : c.muted,
                      borderColor: savingsGoalId === goal.id ? c.primary : c.border,
                    },
                  ]}
                >
                  <Text style={[styles.savingsGoalText, { color: savingsGoalId === goal.id ? c.primaryForeground : c.foreground }]}>
                    {goal.name}
                  </Text>
                  <Text style={[styles.savingsGoalBalance, { color: savingsGoalId === goal.id ? c.primaryForeground : c.mutedForeground }]}>
                    {`$${goal.current_amount.toFixed(0)} saved`}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>

            <Text style={[styles.savingsFieldLabel, { color: c.mutedForeground }]}>CONTRIBUTION AMOUNT</Text>
            <View style={[styles.savingsAmountWrap, { backgroundColor: c.muted, borderColor: c.border }]}>
              <Text style={[styles.savingsDollar, { color: c.mutedForeground }]}>$</Text>
              <TextInput
                value={savingsAmount}
                onChangeText={setSavingsAmount}
                placeholder="0.00"
                placeholderTextColor={c.mutedForeground}
                keyboardType="decimal-pad"
                style={[styles.savingsInput, { color: c.foreground }]}
                autoFocus
              />
            </View>

            <View style={styles.savingsActions}>
              <Pressable
                onPress={() => setSavingsModalVisible(false)}
                style={[styles.savingsCancel, { backgroundColor: c.muted }]}
              >
                <Text style={[styles.savingsCancelText, { color: c.mutedForeground }]}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={handleAddSavings}
                disabled={!savingsGoalId || !(Number.parseFloat(savingsAmount) > 0)}
                style={[
                  styles.savingsSave,
                  {
                    backgroundColor: c.success,
                    opacity: savingsGoalId && Number.parseFloat(savingsAmount) > 0 ? 1 : 0.45,
                  },
                ]}
              >
                <Feather name="plus" size={16} color="#fff" />
                <Text style={styles.savingsSaveText}>Add Savings</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── 12-Month Balance Outlook modal ── */}
      <Modal visible={negCalendarVisible} transparent animationType="slide" onRequestClose={() => setNegCalendarVisible(false)}>
        <Pressable style={styles.negSheetOverlay} onPress={() => setNegCalendarVisible(false)}>
          <Pressable style={[styles.negSheet, { backgroundColor: c.card }]} onPress={() => {}}>
            {/* Handle */}
            <View style={[styles.negSheetHandle, { backgroundColor: c.border }]} />
              <Text style={[styles.negSheetTitle, { color: c.foreground }]}>{settings.forecast_horizon_months}-Month Balance Outlook</Text>
            <Text style={[styles.negSheetSub, { color: c.mutedForeground }]}>
              Projected first negative date each month
            </Text>

            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 420 }}>
              {yearNegSchedule.map((entry, i) => {
                const isNeg = entry.firstNegDay !== null;
                const isLow = !isNeg && entry.lowestBalance < settings.safety_floor;
                const iconName = isNeg ? "x-circle" as const : isLow ? "alert-circle" as const : "check-circle" as const;
                const iconColor = isNeg ? c.destructive : isLow ? "#f0b429" : c.success;
                const bgColor  = isNeg ? c.destructive + "12" : isLow ? "#f0b42912" : c.success + "0a";
                return (
                  <View
                    key={`${entry.year}-${entry.month}`}
                    style={[styles.negSheetRow, {
                      backgroundColor: bgColor,
                      borderRadius: 12,
                      marginBottom: 8,
                    }]}
                  >
                    <Feather name={iconName} size={20} color={iconColor} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.negSheetRowMonth, { color: c.foreground }]}>{entry.label}</Text>
                      <Text style={[styles.negSheetRowDetail, { color: isNeg ? c.destructive : isLow ? "#f0b429" : c.mutedForeground }]}>
                        {isNeg
                          ? `Goes negative on ${MONTH_NAMES[entry.month]} ${entry.firstNegDay}`
                          : isLow
                          ? `Low — floor $${entry.lowestBalance.toFixed(0)}`
                          : `Safe — floor $${entry.lowestBalance.toFixed(0)}`}
                      </Text>
                    </View>
                    {isNeg && (
                      <View style={[styles.negSheetBadge, { backgroundColor: c.destructive }]}>
                        <Text style={styles.negSheetBadgeText}>NEG</Text>
                      </View>
                    )}
                    {isLow && !isNeg && (
                      <View style={[styles.negSheetBadge, { backgroundColor: "#f0b429" }]}>
                        <Text style={styles.negSheetBadgeText}>LOW</Text>
                      </View>
                    )}
                  </View>
                );
              })}
            </ScrollView>

            <Pressable
              onPress={() => setNegCalendarVisible(false)}
              style={[styles.negSheetClose, { backgroundColor: c.muted }]}
            >
              <Text style={[styles.negSheetCloseText, { color: c.mutedForeground }]}>Close</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── Save to Budget popup ── */}
      <Modal visible={expenseNameModal} transparent animationType="fade" onRequestClose={() => setExpenseNameModal(false)}>
        <Pressable style={styles.expenseOverlay} onPress={() => setExpenseNameModal(false)}>
          <Pressable style={[styles.expenseSheet, { backgroundColor: c.card }]} onPress={() => {}}>
            <Text style={[styles.expenseSheetTitle, { color: c.foreground }]}>Save to Budget</Text>
            <Text style={[styles.expenseSheetSub, { color: c.mutedForeground }]}>
              ${affordResult?.amt.toFixed(2)} · {affordDate}
            </Text>

            {/* Type toggle */}
            <View style={[styles.expenseTypeRow, { backgroundColor: c.muted }]}>
              <Pressable
                onPress={() => setExpenseType("expense")}
                style={[styles.expenseTypeBtn, expenseType === "expense" && { backgroundColor: c.card }]}
              >
                <Feather name="shopping-bag" size={14} color={expenseType === "expense" ? c.destructive : c.mutedForeground} />
                <Text style={[styles.expenseTypeBtnText, { color: expenseType === "expense" ? c.destructive : c.mutedForeground }]}>
                  Expense
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setExpenseType("goal")}
                style={[styles.expenseTypeBtn, expenseType === "goal" && { backgroundColor: c.card }]}
              >
                <Feather name="target" size={14} color={expenseType === "goal" ? "#8b5cf6" : c.mutedForeground} />
                <Text style={[styles.expenseTypeBtnText, { color: expenseType === "goal" ? "#8b5cf6" : c.mutedForeground }]}>
                  Goal
                </Text>
              </Pressable>
            </View>

            {/* Context hint */}
            <Text style={[styles.expenseTypeHint, { color: c.mutedForeground }]}>
              {expenseType === "expense"
                ? "Records a one-time transaction on this date."
                : "Creates a savings goal with this target amount and date."}
            </Text>

            <TextInput
              style={[styles.expenseNameInput, { backgroundColor: c.muted, color: c.foreground }]}
              placeholder={expenseType === "expense" ? "e.g. Dinner out, New shoes…" : "e.g. Vacation, New laptop…"}
              placeholderTextColor={c.mutedForeground}
              autoFocus
              returnKeyType="done"
              value={expenseNameInput}
              onChangeText={setExpenseNameInput}
              onSubmitEditing={() => {
                if (!affordResult) return;
                const name = expenseNameInput.trim() || (expenseType === "expense" ? "Expense" : "Goal");
                if (expenseType === "expense") {
                  addTransaction({ amount: -Math.abs(affordResult.amt), category: "Other", note: name, date: affordResult.affordDateStr });
                } else {
                  addGoal({ name, target_amount: affordResult.amt, current_amount: 0, target_date: affordResult.affordDateStr, goal_type: "planned_expense" });
                }
                setExpenseNameModal(false);
                setAddedAsExpense(true);
              }}
            />

            <View style={styles.expenseBtns}>
              <Pressable onPress={() => setExpenseNameModal(false)} style={[styles.expenseBtn, { backgroundColor: c.muted }]}>
                <Text style={[styles.expenseBtnText, { color: c.mutedForeground }]}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  if (!affordResult) return;
                  const name = expenseNameInput.trim() || (expenseType === "expense" ? "Expense" : "Goal");
                  if (expenseType === "expense") {
                    addTransaction({ amount: -Math.abs(affordResult.amt), category: "Other", note: name, date: affordResult.affordDateStr });
                  } else {
                    addGoal({ name, target_amount: affordResult.amt, current_amount: 0, target_date: affordResult.affordDateStr, goal_type: "planned_expense" });
                  }
                  setExpenseNameModal(false);
                  setAddedAsExpense(true);
                }}
                style={[styles.expenseBtn, { backgroundColor: expenseType === "expense" ? c.destructive : "#8b5cf6" }]}
              >
                <Text style={[styles.expenseBtnText, { color: "#fff" }]}>
                  {expenseType === "expense" ? "Add Expense" : "Add Goal"}
                </Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}

function formatShortDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const styles = StyleSheet.create({
  screen:  { flex: 1 },
  content: { paddingHorizontal: 16 },
  heading:    { fontSize: 28, fontFamily: "Inter_700Bold" },
  subheading: { fontSize: 14, fontFamily: "Inter_400Regular", marginTop: 4, marginBottom: 20 },
  setupCard: { borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 12 },
  setupHeader: { flexDirection: "row", alignItems: "flex-start", marginBottom: 8 },
  setupTitle: { fontSize: 15, fontFamily: "Inter_700Bold" },
  setupDesc: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  setupStep: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 },
  setupStepText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  setupButton: { height: 40, borderRadius: 9, alignItems: "center", justifyContent: "center", marginTop: 10 },
  setupButtonText: { fontSize: 13, fontFamily: "Inter_700Bold" },
  confidenceCard: { flexDirection: "row", alignItems: "center", gap: 9, padding: 12, borderRadius: 12, marginBottom: 14 },
  proactiveAlertCard: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 14, padding: 12, marginBottom: 14 },
  proactiveAlertIcon: { width: 34, height: 34, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  proactiveAlertTitle: { fontSize: 14, fontFamily: "Inter_800ExtraBold" },
  proactiveAlertText: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17, marginTop: 2 },
  proactiveActionRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  proactiveActionButton: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 999 },
  proactiveActionText: { fontSize: 11, fontFamily: "Inter_800ExtraBold" },
  askFloPill: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 999 },
  askFloPillText: { fontSize: 11, fontFamily: "Inter_800ExtraBold" },
  confidenceTitle: { fontSize: 13, fontFamily: "Inter_700Bold" },
  confidenceDesc: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },

  // Hero
  heroCard:          { borderRadius: 22, padding: 22, marginBottom: 14, shadowColor: "#1d4ed8", shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.35, shadowRadius: 16, elevation: 8 },
  heroGlowTop:       { position: "absolute", top: -40, right: -30, width: 160, height: 160, borderRadius: 80, backgroundColor: "rgba(255,255,255,0.08)" },
  heroGlowBottom:    { position: "absolute", bottom: -40, left: 20, width: 120, height: 120, borderRadius: 60, backgroundColor: "rgba(255,255,255,0.05)" },
  heroLabel:         { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "rgba(255,255,255,0.8)", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 4 },
  heroValue:         { fontSize: 46, fontFamily: "Inter_700Bold", color: "#fff", lineHeight: 52 },
  heroMetrics:       { flexDirection: "row", marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.2)" },
  heroMetric:        { flex: 1 },
  heroMetricLabel:   { fontSize: 11, fontFamily: "Inter_500Medium", color: "rgba(255,255,255,0.7)", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 3 },
  heroMetricValue:   { fontSize: 14, fontFamily: "Inter_700Bold" },
  heroMetricDivider: { width: 1, backgroundColor: "rgba(255,255,255,0.2)", marginHorizontal: 14 },
  heroProgress:      { marginTop: 14 },
  heroProgressTrack: { height: 5, borderRadius: 3, overflow: "hidden" },
  heroProgressFill:  { height: 5, borderRadius: 3 },
  heroProgressLabel: { fontSize: 11, fontFamily: "Inter_500Medium", color: "rgba(255,255,255,0.75)", marginTop: 5 },
  heroFlipHint:      { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-end", marginBottom: 6 },
  heroFlipHintText:  { fontSize: 10, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.55)" },
  heroGoalRow:       { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 },
  heroGoalName:      { fontSize: 11, fontFamily: "Inter_500Medium", color: "rgba(255,255,255,0.85)", width: 90 },
  heroGoalTrack:     { flex: 1, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.2)", overflow: "hidden" },
  heroGoalFill:      { height: 4, borderRadius: 2, backgroundColor: "#6ee7b7" },
  heroGoalPct:       { fontSize: 10, fontFamily: "Inter_700Bold", color: "rgba(255,255,255,0.75)", width: 30, textAlign: "right" },
  negWarning:          { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, marginBottom: 14 },
  negWarningText:      { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium" },
  // 12-month outlook sheet
  negSheetOverlay:     { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.5)" },
  negSheet:            { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 36 },
  negSheetHandle:      { width: 40, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 16 },
  negSheetTitle:       { fontSize: 20, fontFamily: "Inter_700Bold", marginBottom: 4 },
  negSheetSub:         { fontSize: 13, fontFamily: "Inter_400Regular", marginBottom: 16 },
  negSheetRow:         { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  negSheetRowMonth:    { fontSize: 15, fontFamily: "Inter_600SemiBold", marginBottom: 2 },
  negSheetRowDetail:   { fontSize: 12, fontFamily: "Inter_400Regular" },
  negSheetBadge:       { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  negSheetBadgeText:   { fontSize: 10, fontFamily: "Inter_700Bold", color: "#fff" },
  negSheetClose:       { marginTop: 12, paddingVertical: 14, borderRadius: 12, alignItems: "center" },
  negSheetCloseText:   { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  // Financial Outlook
  outlookCard:  { overflow: "hidden", marginBottom: 0, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 3, elevation: 2 },
  outlookRow:   { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  outlookIcon:  { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  outlookLabel: { fontSize: 11, fontFamily: "Inter_500Medium", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 },
  outlookValue: { fontSize: 14, fontFamily: "Inter_600SemiBold" },

  // What can I do? button
  decisionHubCard: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: 16, padding: 14, marginBottom: 12, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 3, elevation: 2 },
  decisionHubIcon: { width: 42, height: 42, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  decisionHubBody: { flex: 1 },
  decisionHubEyebrow: { fontSize: 10, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 2 },
  decisionHubTitle: { fontSize: 15, fontFamily: "Inter_700Bold" },
  decisionHubDesc: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17, marginTop: 2 },
  decisionHubStats: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  decisionHubStat: { fontSize: 11, fontFamily: "Inter_700Bold" },
  monthlyReviewCard: { borderWidth: 1, borderRadius: 16, padding: 14, marginBottom: 14 },
  monthlyReviewHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  monthlyReviewIcon: { width: 40, height: 40, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  monthlyReviewTitle: { fontSize: 16, fontFamily: "Inter_800ExtraBold" },
  monthlyReviewDesc: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17, marginTop: 2 },
  monthlyReviewAsk: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 7 },
  monthlyReviewAskText: { fontSize: 11, fontFamily: "Inter_800ExtraBold" },
  monthlyReviewGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  monthlyReviewMetric: { flexBasis: "48%", flexGrow: 1, borderRadius: 12, padding: 10 },
  monthlyReviewLabel: { fontSize: 10, fontFamily: "Inter_700Bold", textTransform: "uppercase", marginBottom: 4 },
  monthlyReviewValue: { fontSize: 17, fontFamily: "Inter_800ExtraBold" },
  monthlyReviewActions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  monthlyReviewAction: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 8 },
  monthlyReviewActionText: { fontSize: 11, fontFamily: "Inter_800ExtraBold" },
  paycheckPlanCard: { borderWidth: 1, borderRadius: 16, padding: 14, marginBottom: 14, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 3, elevation: 2 },
  paycheckPlanHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  paycheckPlanIcon: { width: 42, height: 42, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  paycheckPlanTitle: { fontSize: 16, fontFamily: "Inter_700Bold" },
  paycheckPlanSafe: { fontSize: 23, fontFamily: "Inter_800ExtraBold" },
  paycheckPlanDesc: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17, marginTop: 10 },
  paycheckPlanStats: { flexDirection: "row", gap: 8, marginTop: 12 },
  paycheckPlanStatBox: { flex: 1, borderRadius: 12, padding: 10 },
  paycheckPlanStatLabel: { fontSize: 10, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 },
  paycheckPlanStatValue: { fontSize: 16, fontFamily: "Inter_800ExtraBold" },
  paycheckPlanBills: { borderTopWidth: 1, marginTop: 12, paddingTop: 10, gap: 7 },
  paycheckPlanBillRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  paycheckPlanBillName: { flex: 1, fontSize: 13, fontFamily: "Inter_600SemiBold" },
  paycheckPlanBillAmount: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  paycheckPlanActions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  paycheckPlanAction: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  paycheckPlanActionText: { fontSize: 12, fontFamily: "Inter_800ExtraBold" },
  whatBtn:     { flexDirection: "row", alignItems: "center", gap: 12, padding: 16, marginBottom: 14, borderWidth: 1, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 3, elevation: 2 },
  whatBtnIcon: { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  whatBtnText: { flex: 1, fontSize: 16, fontFamily: "Inter_700Bold" },

  // Phase 4 category planning
  categoryPlanHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 10 },
  categoryDecisionAlert: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 14, padding: 12, marginBottom: 12 },
  categoryDecisionAlertTitle: { fontSize: 14, fontFamily: "Inter_800ExtraBold" },
  categoryDecisionAlertText: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17, marginTop: 2 },
  categoryPlanSub: { fontSize: 12, fontFamily: "Inter_400Regular" },
  categoryPlanHeaderActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  categoryBudgetEdit: { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5 },
  categoryBudgetEditText: { fontSize: 10, fontFamily: "Inter_700Bold" },
  categoryPlanBadge: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5 },
  categoryPlanBadgeText: { fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
  categoryPlanCard: { overflow: "hidden", shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 3, elevation: 2 },
  categoryPlanRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12 },
  categoryPlanIcon: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  categoryPlanBody: { flex: 1 },
  categoryPlanTop: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 7 },
  categoryPlanName: { flex: 1, fontSize: 14, fontFamily: "Inter_700Bold" },
  categoryPlanAmount: { fontSize: 14, fontFamily: "Inter_700Bold" },
  categoryPlanTrack: { height: 6, borderRadius: 3, overflow: "hidden", marginBottom: 5 },
  categoryPlanFill: { height: 6, borderRadius: 3 },
  categoryPlanDetail: { fontSize: 11, fontFamily: "Inter_400Regular" },
  categoryBudgetList: { maxHeight: 420, marginBottom: 14 },
  categoryBudgetRow: { flexDirection: "row", alignItems: "center", gap: 12, borderTopWidth: 1, paddingVertical: 12 },
  categoryBudgetCopy: { flex: 1 },
  categoryBudgetName: { fontSize: 15, fontFamily: "Inter_700Bold" },
  categoryBudgetHint: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  categoryBudgetInputWrap: { flexDirection: "row", alignItems: "center", minWidth: 118, borderRadius: 12, paddingHorizontal: 10 },
  categoryBudgetDollar: { fontSize: 14, fontFamily: "Inter_600SemiBold", marginRight: 2 },
  categoryBudgetInput: { flex: 1, minHeight: 44, fontSize: 15, fontFamily: "Inter_600SemiBold", textAlign: "right" },
  categoryDetailHeader: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 14 },
  categoryDetailClose: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  categoryDetailStats: { flexDirection: "row", gap: 8, marginBottom: 12 },
  categoryDetailStat: { flex: 1, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 10 },
  categoryDetailStatLabel: { fontSize: 10, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 3 },
  categoryDetailStatValue: { fontSize: 18, fontFamily: "Inter_700Bold" },
  categoryInsightBox: { flexDirection: "row", gap: 9, borderWidth: 1, borderRadius: 14, padding: 12, marginBottom: 12 },
  categoryInsightText: { flex: 1, fontSize: 13, lineHeight: 18, fontFamily: "Inter_500Medium" },
  categoryDetailList: { maxHeight: 340, marginBottom: 14 },
  categoryDetailSectionTitle: { fontSize: 11, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 4 },
  categoryDetailItem: { flexDirection: "row", alignItems: "center", gap: 10, borderTopWidth: 1, paddingVertical: 10 },
  categoryDetailItemName: { fontSize: 14, fontFamily: "Inter_700Bold" },
  categoryDetailItemMeta: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  categoryDetailItemAmount: { fontSize: 14, fontFamily: "Inter_700Bold" },
  categoryDetailEmpty: { fontSize: 12, fontFamily: "Inter_400Regular", paddingVertical: 10 },
  categoryDetailActions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  categoryDetailAction: { flex: 1, minHeight: 44, borderRadius: 13, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6, paddingHorizontal: 8 },
  categoryDetailActionText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  moveCategoryScroller: { marginBottom: 14 },
  moveCategoryChip: { minWidth: 130, borderWidth: 1, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 12, marginRight: 8 },
  moveCategoryChipName: { fontSize: 13, fontFamily: "Inter_700Bold" },
  moveCategoryChipMeta: { fontSize: 11, fontFamily: "Inter_500Medium", marginTop: 3 },
  moveAmountInputWrap: { flexDirection: "row", alignItems: "center", borderRadius: 14, paddingHorizontal: 12, marginBottom: 8 },
  moveAmountInput: { flex: 1, minHeight: 48, fontSize: 18, fontFamily: "Inter_700Bold" },
  moveErrorText: { fontSize: 12, fontFamily: "Inter_600SemiBold", marginBottom: 10 },

  // Affordability card
  affordCard:           { padding: 16, marginBottom: 14, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 3, elevation: 2 },
  affordHeader:         { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 14 },
  affordHeaderIcon:     { width: 32, height: 32, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  affordTitle:          { fontSize: 16, fontFamily: "Inter_700Bold" },
  affordAmtRow:         { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10 },
  affordDollar:         { fontSize: 16, fontFamily: "Inter_500Medium", paddingLeft: 4 },
  affordInput:          { flex: 1, height: 44, paddingHorizontal: 14, fontSize: 16, fontFamily: "Inter_500Medium" },
  affordClear:          { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  affordVerdict:        { flexDirection: "row", alignItems: "flex-start", gap: 12, padding: 14, marginBottom: 10 },
  affordVerdictTitle:   { fontSize: 15, fontFamily: "Inter_700Bold", marginBottom: 4 },
  affordVerdictSub:     { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  affordInsight:        { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 12, marginBottom: 10 },
  affordInsightText:    { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  affordActions:        { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  affordActionBtn:      { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10 },
  affordActionBtnText:  { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  affordActionDone:     { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 9 },
  affordActionDoneText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },

  // Upcoming
  sectionTitle:  { fontSize: 18, fontFamily: "Inter_700Bold", marginBottom: 10, marginTop: 4 },
  upcomingCard:  { marginBottom: 16, overflow: "hidden" },
  upcomingRow:   { flexDirection: "row", alignItems: "center", padding: 12, gap: 10 },
  upcomingDot:   { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  upcomingInfo:  { flex: 1 },
  upcomingName:  { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  upcomingDate:  { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
  upcomingAmt:   { fontSize: 15, fontFamily: "Inter_700Bold" },

  // Stat pill cards
  forecastTrustCard: { borderWidth: 1, borderRadius: 16, padding: 12, marginBottom: 10 },
  forecastTrustHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  forecastTrustIcon: { width: 34, height: 34, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  forecastTrustTitle: { fontSize: 14, fontFamily: "Inter_800ExtraBold" },
  forecastTrustSub: { fontSize: 11, fontFamily: "Inter_400Regular", lineHeight: 16, marginTop: 2 },
  forecastTrustAsk: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 7 },
  forecastTrustAskText: { fontSize: 11, fontFamily: "Inter_800ExtraBold" },
  forecastTrustGrid: { flexDirection: "row", gap: 8, marginTop: 10 },
  forecastTrustMetric: { flex: 1, borderRadius: 12, padding: 9 },
  forecastTrustLabel: { fontSize: 10, fontFamily: "Inter_700Bold", textTransform: "uppercase", marginBottom: 3 },
  forecastTrustValue: { fontSize: 16, fontFamily: "Inter_800ExtraBold" },
  forecastTrustDrivers: { fontSize: 11, fontFamily: "Inter_400Regular", lineHeight: 16, marginTop: 9 },
  statsPillRow:  { flexDirection: "row", gap: 6, marginBottom: 14 },
  statPill:      { flex: 1, borderRadius: 14, paddingVertical: 16, paddingHorizontal: 6, alignItems: "center", justifyContent: "center" },
  statPillValue: { fontSize: 18, fontFamily: "Inter_700Bold", marginBottom: 5 },
  statPillLabel: { fontSize: 10, fontFamily: "Inter_600SemiBold", letterSpacing: 0.2 },
  statDebtRow:   { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: 14, paddingVertical: 16, paddingHorizontal: 18, marginBottom: 14 },
  statDebtValue: { fontSize: 28, fontFamily: "Inter_700Bold", marginTop: 2 },

  // Goals
  goalsHeader:        { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10, marginTop: 8, gap: 8 },
  goalHeaderActions:  { flexDirection: "row", alignItems: "center", gap: 6 },
  addGoalBtn:         { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 20 },
  addGoalText:        { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  goalsEmpty:         { padding: 24, alignItems: "center", marginBottom: 16 },
  goalsEmptyText:     { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 10, marginBottom: 16, lineHeight: 20 },
  goalsEmptyBtn:      { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10 },
  goalsEmptyBtnText:  { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  goalCard:           { marginBottom: 12, padding: 14, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 3, elevation: 2 },
  goalTop:            { flexDirection: "row", alignItems: "flex-start", marginBottom: 10 },
  goalLeft:           { flex: 1 },
  goalRight:          { alignItems: "flex-end" },
  goalNameRow:        { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 },
  goalName:           { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  goalTypeBadge:      { borderRadius: 999, paddingHorizontal: 7, paddingVertical: 3 },
  goalTypeBadgeText:  { fontSize: 9, fontFamily: "Inter_700Bold", letterSpacing: 0.45 },
  goalDate:           { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  goalAmount:         { fontSize: 16, fontFamily: "Inter_700Bold" },
  goalTarget:         { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 1 },
  goalProgress:       { height: 6, borderRadius: 3, overflow: "hidden", marginBottom: 10 },
  goalProgressFill:   { height: 6, borderRadius: 3 },
  affordBox:          { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 10 },
  affordText:         { flex: 1 },
  affordBoxTitle:     { fontSize: 13, fontFamily: "Inter_700Bold" },
  affordSub:          { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },

  // Expense name popup
  expenseOverlay:     { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "center", alignItems: "center", padding: 32 },
  expenseSheet:       { width: "100%", borderRadius: 20, padding: 24, shadowColor: "#000", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.25, shadowRadius: 16, elevation: 12 },
  expenseSheetTitle:  { fontSize: 18, fontFamily: "Inter_700Bold", marginBottom: 4 },
  expenseSheetSub:    { fontSize: 13, fontFamily: "Inter_400Regular", marginBottom: 14 },
  expenseTypeRow:     { flexDirection: "row", borderRadius: 12, padding: 4, gap: 4, marginBottom: 10 },
  expenseTypeBtn:     { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 9, borderRadius: 9 },
  expenseTypeBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  expenseTypeHint:    { fontSize: 12, fontFamily: "Inter_400Regular", marginBottom: 14, lineHeight: 17 },
  expenseNameInput:   { height: 50, borderRadius: 12, paddingHorizontal: 16, fontSize: 16, fontFamily: "Inter_500Medium", marginBottom: 20 },
  expenseBtns:        { flexDirection: "row", gap: 10 },
  expenseBtn:         { flex: 1, paddingVertical: 13, borderRadius: 12, alignItems: "center" },
  expenseBtnText:     { fontSize: 15, fontFamily: "Inter_600SemiBold" },

  // Action sheet modal
  modalOverlay:    { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.5)" },
  actionSheet:     { borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 12, paddingBottom: 36, paddingHorizontal: 20 },
  sheetHandle:     { width: 40, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 16 },
  sheetTitle:      { fontSize: 20, fontFamily: "Inter_700Bold", marginBottom: 4 },
  sheetSub:        { fontSize: 13, fontFamily: "Inter_400Regular", marginBottom: 16 },
  actionRow:       { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 14, borderTopWidth: 1 },
  actionIcon:      { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  actionLabel:     { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  actionSub:       { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  sheetCancel:     { marginTop: 14, paddingVertical: 14, alignItems: "center" },
  sheetCancelText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },

  // Savings contribution
  savingsFieldLabel:  { fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 0.7, marginBottom: 8 },
  savingsGoalRow:     { gap: 8, paddingBottom: 16 },
  savingsGoalChip:    { minWidth: 120, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, borderWidth: 1 },
  savingsGoalText:    { fontSize: 13, fontFamily: "Inter_700Bold" },
  savingsGoalBalance: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 3 },
  savingsAmountWrap:  { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 12, marginBottom: 18 },
  savingsDollar:      { fontSize: 20, fontFamily: "Inter_600SemiBold", paddingLeft: 14 },
  savingsInput:       { flex: 1, height: 52, paddingHorizontal: 8, fontSize: 20, fontFamily: "Inter_700Bold" },
  savingsActions:     { flexDirection: "row", gap: 10 },
  savingsCancel:      { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: "center" },
  savingsCancelText:  { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  savingsSave:        { flex: 1.5, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6, paddingVertical: 14, borderRadius: 12 },
  savingsSaveText:    { color: "#fff", fontSize: 15, fontFamily: "Inter_700Bold" },
});

