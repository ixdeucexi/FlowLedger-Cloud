import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated, Image, Keyboard, Modal, NativeScrollEvent, NativeSyntheticEvent, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Defs, LinearGradient as SvgLinearGradient, Stop } from "react-native-svg";

import { AddBillModal } from "@/components/AddBillModal";
import { DatePickerField } from "@/components/DatePickerField";
import { GoalModal } from "@/components/GoalModal";
import { PremiumBackdrop } from "@/components/PremiumBackdrop";

import colors from "@/constants/colors";
import type { Bill, DashboardFilter, Goal } from "@/context/BudgetContext";
import { useBudget } from "@/context/BudgetContext";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { applyCategoryBudgetMove, buildCategoryPlan } from "@/lib/categoryPlanning";
import { CATEGORY_BUDGETS_EVENT, categoryBudgetStorageKey, loadCategoryBudgets, readCategoryBudgetCache, saveCategoryBudgets as saveCategoryBudgetsRemote } from "@/lib/categoryBudgetStore";
import { DECISION_HUB_SETTINGS_EVENT, loadDecisionHubSettings, readDecisionHubSettings, type DecisionHubSettings } from "@/lib/decisionHubSettings";
import { buildDecisionHistory } from "@/lib/decisionHistory";
import { summarizeMonthlyBills } from "@/lib/monthlySummary";
import { buildPaycheckPlan, makeDateKey } from "@/lib/paycheckPlanning";
import { buildAlgorithmSuite, type AlgorithmInsight } from "@/lib/algorithmSuite";
import { isAlgorithmEnabled, type AlgorithmId } from "@/lib/algorithmCatalog";

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MONTH_FULL  = ["January","February","March","April","May","June","July","August","September","October","November","December"];

const CAT_COLORS: Record<string, string> = {
  Housing: "#0f9b8e", Utilities: "#f0b429", Insurance: "#6366f1",
  Transportation: "#ec4899", Food: "#f97316", Entertainment: "#8b5cf6",
  Health: "#ef4444", Education: "#3b82f6", Savings: "#22c55e", Debt: "#e11d48", Other: "#94a3b8",
};

const FLOWLEDGER_LOGO = require("@/assets/brand/flowledger-dashboard-logo.jpg");

function algoToneColor(tone: AlgorithmInsight["tone"]) {
  if (tone === "safe") return "#22c55e";
  if (tone === "watch") return "#f59e0b";
  if (tone === "risk") return "#fb7185";
  return "#38bdf8";
}

function FlowScoreGauge({ score }: { score: number }) {
  const size = 152;
  const stroke = 10;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, score));
  const dash = (clamped / 100) * circumference;

  return (
    <View style={styles.referenceGaugeWrap}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <Defs>
          <SvgLinearGradient id="flowScoreGradient" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#a855f7" stopOpacity="1" />
            <Stop offset="0.52" stopColor="#22d3ee" stopOpacity="1" />
            <Stop offset="1" stopColor="#22c55e" stopOpacity="1" />
          </SvgLinearGradient>
        </Defs>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="rgba(148,163,184,0.18)"
          strokeWidth={stroke}
          fill="rgba(2,6,23,0.48)"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="url(#flowScoreGradient)"
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="transparent"
          strokeDasharray={`${dash} ${circumference}`}
          rotation="-90"
          originX={size / 2}
          originY={size / 2}
        />
      </Svg>
      <View style={styles.referenceGaugeCenter}>
        <Text style={styles.referenceGaugeScore}>{score}</Text>
        <Text style={styles.referenceGaugeLabel}>Flow Score</Text>
      </View>
    </View>
  );
}

export default function DashboardScreen() {
  const c = useColors();
  const [isFocused, setIsFocused] = useState(true);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width: viewportWidth } = useWindowDimensions();
  const isCommandWide = Platform.OS === "web" && viewportWidth >= 900;
  const isIosWeb = Platform.OS === "web" && typeof navigator !== "undefined" && /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const dashboardTopPadding = Platform.OS === "web" ? (isIosWeb ? 72 : 16) : insets.top + 16;
  const dashboardBottomPadding = Platform.OS === "web" ? (isIosWeb ? 60 : 100) : insets.bottom + 100;
  const { user } = useAuth();
  const {
    bills, getPaidAmount, getBillMonthlyTotal, getMonthlyBills, selectedYear, setDashboardFilter,
    getBillOccurrencesInMonth, getIncomeOccurrencesInMonth,
    goals, addGoal, updateGoal, deleteGoal, checkGoalAffordability,
    getCashFlow, getMonthlyIncome, addBill, addTransaction, getDailyBalances, getTransactionsForMonth, settings,
    accounts, incomes, decisions, updateSettings, forecastConfidence,
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
  const [flowScoreVisible, setFlowScoreVisible] = useState(false);
  const [safeCushionVisible, setSafeCushionVisible] = useState(false);
  const [activeAlgoCard, setActiveAlgoCard] = useState(0);
  const [startupAlertVisible, setStartupAlertVisible] = useState(false);
  const algorithmCarouselRef = useRef<ScrollView | null>(null);
  const algorithmSnapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startupAlertShownRef = useRef(false);

  useFocusEffect(useCallback(() => {
    setIsFocused(true);
    return () => setIsFocused(false);
  }, []));

  // ── Hero card flip ──────────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (algorithmSnapTimerRef.current) clearTimeout(algorithmSnapTimerRef.current);
    };
  }, []);

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
  const stormAnim = useRef(new Animated.Value(0)).current;
  const lightningAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const stormLoop = Animated.loop(
      Animated.timing(stormAnim, {
        toValue: 1,
        duration: 14000,
        useNativeDriver: true,
      }),
    );
    const lightningLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(lightningAnim, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(lightningAnim, { toValue: 0, duration: 1700, useNativeDriver: true }),
        Animated.timing(lightningAnim, { toValue: 1, duration: 180, useNativeDriver: true }),
        Animated.timing(lightningAnim, { toValue: 0, duration: 5200, useNativeDriver: true }),
      ]),
    );
    stormLoop.start();
    lightningLoop.start();
    return () => {
      stormLoop.stop();
      lightningLoop.stop();
    };
  }, [lightningAnim, stormAnim]);

  const stormShift = stormAnim.interpolate({ inputRange: [0, 1], outputRange: [-70, 90] });
  const stormLift = stormAnim.interpolate({ inputRange: [0, 1], outputRange: [16, -22] });
  const lightningOpacity = lightningAnim.interpolate({
    inputRange: [0, 0.35, 0.5, 0.68, 1],
    outputRange: [0.05, 0.32, 0.1, 0.44, 0.06],
  });

  const now          = new Date();
  const currentMonth = now.getMonth();
  const today        = now.getDate();
  const timeGreeting = now.getHours() < 5
    ? "Good night"
    : now.getHours() < 12
    ? "Good morning"
    : now.getHours() < 17
    ? "Good afternoon"
    : "Good evening";

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
    return buildCategoryPlan(categories.filter(category => category !== "Debt"), monthBills, monthTransactions, budgetLimits);
  }, [categories, categoryBudgets, getMonthlyBills, getBillMonthlyTotal, getTransactionsForMonth, currentMonth, selectedYear]);

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
    if (!decisionHubSettings.algorithmSuiteEnabled) return null;
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
  }, [categoryPlan, decisionHubSettings]);

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
      else if (action === "goal")     { setEditGoal(null); setGoalModalVisible(true); }
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
    if (!isAlgorithmEnabled(decisionHubSettings, "paydaySplit")) return null;
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
    decisionHubSettings,
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
  const monthlyReview = useMemo(() => {
    const overCategory = [...categoryPlan]
      .filter(row => row.remaining < -0.005)
      .sort((left, right) => left.remaining - right.remaining)[0];
    const bestCategory = [...categoryPlan]
      .filter(row => row.remaining > 0.005 && row.budgeted > 0)
      .sort((left, right) => right.remaining - left.remaining)[0];
    const savingsPct = savingsData.totalTarget > 0
      ? Math.min(100, (savingsData.totalSaved / savingsData.totalTarget) * 100)
      : 0;
    const billDelta = stats.totalDue - stats.totalPaid;
    const lowestBalance = balanceMetrics?.lowestBalance ?? 0;
    const lowestDay = balanceMetrics?.lowestDay ?? today;
    const headline = stats.unpaidCount <= 0
      ? "This month is caught up"
      : `${stats.unpaidCount} bill${stats.unpaidCount === 1 ? "" : "s"} left`;
    const nextStep = overCategory
      ? `${overCategory.category} is over by $${Math.abs(overCategory.remaining).toFixed(0)}.`
      : lowestBalance < settings.safety_floor
        ? `Lowest balance is $${lowestBalance.toFixed(0)} on ${MONTH_NAMES[currentMonth]} ${lowestDay}.`
        : bestCategory
          ? `${bestCategory.category} has $${bestCategory.remaining.toFixed(0)} left.`
          : "Looks steady. Keep updating actuals as bills clear.";
    return {
      headline,
      billDelta,
      overCategory,
      bestCategory,
      paidCount: stats.paidCount,
      billCount: stats.billCount,
      unpaidCount: stats.unpaidCount,
      lowestBalance,
      lowestDay,
      savingsPct,
      nextStep,
      prompt: "Review my month and tell me what needs attention.",
    };
  }, [balanceMetrics, categoryPlan, currentMonth, savingsData.totalSaved, savingsData.totalTarget, settings.safety_floor, stats.billCount, stats.paidCount, stats.totalDue, stats.totalPaid, stats.unpaidCount, today]);
  const algorithmSuite = useMemo(() => buildAlgorithmSuite({
    month: currentMonth,
    year: selectedYear,
    todayDay: today,
    safetyFloor: settings.safety_floor,
    cashFlow,
    dailyBalances: currentMonthBalances.map(day => ({
      day: day.day,
      income: day.income,
      bills: day.bills,
      expense: day.expense,
      net: day.net,
      balance: day.balance,
    })),
    bills: getMonthlyBills(currentMonth, selectedYear).map(bill => ({
      id: bill.id,
      name: bill.name,
      amount: getBillMonthlyTotal(bill, currentMonth, selectedYear),
      paidAmount: getPaidAmount(bill.id, currentMonth, selectedYear),
      category: bill.category || "Other",
      due_day: bill.due_day,
      is_debt: bill.is_debt,
      is_recurring: bill.is_recurring,
      balance: bill.balance,
      interest_rate: bill.interest_rate,
    })),
    transactions: getTransactionsForMonth(currentMonth, selectedYear).map(transaction => ({
      id: transaction.id,
      date: transaction.date,
      amount: transaction.amount,
      category: transaction.category || "Other",
      note: transaction.note,
    })),
    incomes: incomes.map(income => ({
      id: income.id,
      name: income.name,
      amount: income.amount,
      frequency: income.frequency,
    })),
    goals: goals.map(goal => ({
      id: goal.id,
      name: goal.name,
      target_amount: goal.target_amount,
      current_amount: goal.current_amount,
      target_date: goal.target_date,
      goal_type: goal.goal_type,
    })),
    categoryPlan,
    forecastConfidence,
    settings: decisionHubSettings,
  }), [
    cashFlow,
    categoryPlan,
    currentMonth,
    currentMonthBalances,
    decisionHubSettings,
    forecastConfidence,
    getBillMonthlyTotal,
    getMonthlyBills,
    getPaidAmount,
    getTransactionsForMonth,
    goals,
    incomes,
    selectedYear,
    settings.safety_floor,
    today,
  ]);
  const nextWeekRisk = useMemo(() => {
    if (!decisionHubSettings.algorithmSuiteEnabled) return null;
    const weekEndDate = new Date(now);
    weekEndDate.setDate(now.getDate() + 7);
    const weekEnd = `${weekEndDate.getFullYear()}-${String(weekEndDate.getMonth() + 1).padStart(2, "0")}-${String(weekEndDate.getDate()).padStart(2, "0")}`;
    const weekDays = decisionForecastDays.filter(day => day.date >= todayIso && day.date <= weekEnd);
    const lowest = weekDays.reduce<{ date: string; balance: number } | null>(
      (best, day) => !best || day.balance < best.balance ? day : best,
      null,
    );
    const sensitivityBuffer = 150;
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
  }, [decisionForecastDays, decisionHubSettings, now, settings.safety_floor, todayIso]);
  useEffect(() => {
    if (nextWeekRisk && !startupAlertShownRef.current) {
      startupAlertShownRef.current = true;
      setStartupAlertVisible(true);
    }
  }, [nextWeekRisk]);
  const openFloWithPrompt = (prompt: string) => {
    router.push({ pathname: "/(tabs)/flo", params: { prompt } } as any);
  };
  const algorithmCardWidth = isCommandWide ? 500 : Math.max(286, viewportWidth - 68);
  const algorithmSnapInterval = algorithmCardWidth + 12;
  const algorithmCards = useMemo(() => {
    const safeTone = algoToneColor(algorithmSuite.safeCushion.status);
    const cards = [
      {
        id: "flowScore",
        settingId: "flowScore" as AlgorithmId,
        title: "Flow Score",
        value: `${algorithmSuite.flowScore.score} · ${algorithmSuite.flowScore.label}`,
        detail: algorithmSuite.flowScore.topReason,
        action: algorithmSuite.flowScore.topAction,
        icon: "activity" as const,
        color: "#a855f7",
        prompt: `Why is my Flow Score ${algorithmSuite.flowScore.score}? ${algorithmSuite.flowScore.topReason} ${algorithmSuite.flowScore.topAction}`,
      },
      {
        id: "safeCushion",
        settingId: "safeCushion" as AlgorithmId,
        title: "Safe Cushion",
        value: `$${algorithmSuite.safeCushion.amount.toFixed(0)}`,
        detail: algorithmSuite.safeCushion.compactReason,
        action: algorithmSuite.safeCushion.topAction,
        icon: "shield" as const,
        color: safeTone,
        prompt: "What is my Safe Cushion and what can I safely do with it?",
      },
      {
        id: "purchaseDecision",
        settingId: "purchaseDecision" as AlgorithmId,
        title: "Purchase Decision",
        value: `$${algorithmSuite.purchaseDecision.safeNowLimit.toFixed(0)} safe now`,
        detail: algorithmSuite.purchaseDecision.detail,
        action: algorithmSuite.purchaseDecision.nextMove,
        icon: "shopping-bag" as const,
        color: "#22d3ee",
        prompt: "What purchase amount is safe right now and when should I wait?",
      },
      {
        id: "billPriority",
        settingId: "billPriority" as AlgorithmId,
        title: "Bill Priority",
        value: algorithmSuite.billPriority.nextBill?.name ?? "All clear",
        detail: algorithmSuite.billPriority.summary,
        action: algorithmSuite.billPriority.nextMove,
        icon: "file-text" as const,
        color: "#fbbf24",
        prompt: "Which bill should I handle first and why?",
      },
      {
        id: "debtPayoff",
        settingId: "debtPayoff" as AlgorithmId,
        title: "Debt Payoff",
        value: algorithmSuite.debtPayoff.nextDebtName ?? "No debt target",
        detail: algorithmSuite.debtPayoff.detail,
        action: algorithmSuite.debtPayoff.nextMove,
        icon: "trending-down" as const,
        color: "#fb7185",
        prompt: "What is my best next debt payoff move?",
      },
      {
        id: "paydaySplit",
        settingId: "paydaySplit" as AlgorithmId,
        title: "Payday Split",
        value: algorithmSuite.paydaySplit.summary,
        detail: algorithmSuite.paydaySplit.nextMove,
        action: `${algorithmSuite.paydaySplit.bills.toFixed(0)}% bills / ${algorithmSuite.paydaySplit.debt.toFixed(0)}% debt`,
        icon: "git-branch" as const,
        color: "#818cf8",
        prompt: "How should my next paycheck be split?",
      },
      {
        id: "spendingLimit",
        settingId: "spendingLimit" as AlgorithmId,
        title: "Spending Limit",
        value: `$${algorithmSuite.spendingLimit.daily.toFixed(0)}/day`,
        detail: algorithmSuite.spendingLimit.detail,
        action: `$${algorithmSuite.spendingLimit.weekly.toFixed(0)} weekly limit`,
        icon: "sliders" as const,
        color: "#60a5fa",
        prompt: "What can I safely spend daily and weekly?",
      },
      {
        id: "extraMoneyRouter",
        settingId: "extraMoneyRouter" as AlgorithmId,
        title: "Extra Money Router",
        value: `$${algorithmSuite.extraMoneyRouter.amount.toFixed(0)}`,
        detail: algorithmSuite.extraMoneyRouter.detail,
        action: algorithmSuite.extraMoneyRouter.nextMove,
        icon: "corner-up-right" as const,
        color: "#34d399",
        prompt: "Where should extra money go right now: debt, savings, bills, or available cash?",
      },
      {
        id: "monthly-health",
        title: "Monthly Health",
        value: `${algorithmSuite.monthlyHealth.grade} · ${algorithmSuite.monthlyHealth.score}`,
        detail: algorithmSuite.monthlyHealth.summary,
        action: algorithmSuite.forecastConfidence.reason,
        icon: "bar-chart-2" as const,
        color: "#8b5cf6",
        prompt: "Review my monthly health and tell me the cleanest next move.",
      },
    ];
    return cards
      .filter((card): card is typeof card & { settingId: AlgorithmId } => Boolean(card.settingId))
      .filter(card => isAlgorithmEnabled(decisionHubSettings, card.settingId));
  }, [algorithmSuite, decisionHubSettings]);
  const activeAlgorithmCardNumber = algorithmCards.length ? Math.min(activeAlgoCard + 1, algorithmCards.length) : 0;
  useEffect(() => {
    if (algorithmCards.length === 0 && activeAlgoCard !== 0) {
      setActiveAlgoCard(0);
    } else if (algorithmCards.length > 0 && activeAlgoCard >= algorithmCards.length) {
      setActiveAlgoCard(algorithmCards.length - 1);
    }
  }, [activeAlgoCard, algorithmCards.length]);
  const syncActiveAlgorithmCard = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const index = Math.round(event.nativeEvent.contentOffset.x / Math.max(1, algorithmSnapInterval));
    const nextIndex = Math.max(0, Math.min(algorithmCards.length - 1, index));
    setActiveAlgoCard(current => current === nextIndex ? current : nextIndex);
  };
  const snapAlgorithmCarouselToNearest = (offsetX: number, animated = true) => {
    const index = Math.round(offsetX / Math.max(1, algorithmSnapInterval));
    const nextIndex = Math.max(0, Math.min(algorithmCards.length - 1, index));
    setActiveAlgoCard(current => current === nextIndex ? current : nextIndex);
    algorithmCarouselRef.current?.scrollTo({
      x: nextIndex * algorithmSnapInterval,
      animated,
    });
  };
  const scheduleAlgorithmCarouselSnap = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetX = event.nativeEvent.contentOffset.x;
    syncActiveAlgorithmCard(event);
    if (algorithmSnapTimerRef.current) clearTimeout(algorithmSnapTimerRef.current);
    algorithmSnapTimerRef.current = setTimeout(() => {
      snapAlgorithmCarouselToNearest(offsetX, true);
    }, 110);
  };
  const jumpToAlgorithmCard = (index: number) => {
    const nextIndex = Math.max(0, Math.min(algorithmCards.length - 1, index));
    if (algorithmSnapTimerRef.current) clearTimeout(algorithmSnapTimerRef.current);
    setActiveAlgoCard(nextIndex);
    algorithmCarouselRef.current?.scrollTo({
      x: nextIndex * algorithmSnapInterval,
      animated: true,
    });
  };

  return (
    <ScrollView
      style={[styles.screen, styles.dashboardStage]}
      contentContainerStyle={[styles.content, isCommandWide && styles.contentWide, { paddingTop: dashboardTopPadding, paddingBottom: dashboardBottomPadding }]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <View pointerEvents="none" style={styles.stormBackdrop}>
        <PremiumBackdrop variant="purple" />
        <LinearGradient
          colors={["rgba(3,7,18,0.32)", "rgba(8,13,32,0.10)", "rgba(15,23,42,0.16)"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.stormBase}
        />
        <Animated.View
          style={[
            styles.stormOrb,
            styles.stormOrbBlue,
            { transform: [{ translateX: stormShift }, { translateY: stormLift }] },
          ]}
        />
        <Animated.View
          style={[
            styles.stormOrb,
            styles.stormOrbViolet,
            { transform: [{ translateX: stormLift }, { translateY: stormShift }] },
          ]}
        />
        <Animated.View
          style={[
            styles.lightningBeam,
            styles.lightningBeamOne,
            { opacity: lightningOpacity, transform: [{ translateX: stormShift }, { rotate: "-24deg" }] },
          ]}
        />
        <Animated.View
          style={[
            styles.lightningBeam,
            styles.lightningBeamTwo,
            { opacity: lightningOpacity, transform: [{ translateX: stormLift }, { rotate: "18deg" }] },
          ]}
        />
        <View style={styles.stormGrid} />
      </View>
      {isCommandWide ? (
        <View style={[styles.referenceDesktopRail, { top: dashboardTopPadding }]}>
          <View style={styles.referenceRailLogoRow}>
            <Image source={FLOWLEDGER_LOGO} style={styles.referenceRailLogo} resizeMode="cover" />
            <View>
              <Text style={styles.referenceRailBrand}>FlowLedger</Text>
              <Text style={styles.referenceRailAlgo}>ALGO</Text>
            </View>
          </View>
          {[
            { label: "Dashboard", icon: "home" as const, active: true, to: "/(tabs)" },
            { label: "Calendar", icon: "calendar" as const, to: "/(tabs)/monthly" },
            { label: "Bills", icon: "file-text" as const, to: "/(tabs)/bills" },
            { label: "Transactions", icon: "repeat" as const, to: "/(tabs)/transactions" },
            { label: "Flo", icon: "message-circle" as const, to: "/(tabs)/flo" },
            { label: "Settings", icon: "settings" as const, to: "/(tabs)/more" },
          ].map(item => (
            <Pressable
              key={item.label}
              onPress={() => router.push(item.to as any)}
              style={({ pressed }) => [styles.referenceRailItem, item.active && styles.referenceRailItemActive, { opacity: pressed ? 0.8 : 1 }]}
            >
              <Feather name={item.icon} size={17} color={item.active ? "#f8fafc" : "#94a3b8"} />
              <Text style={[styles.referenceRailText, item.active && styles.referenceRailTextActive]}>{item.label}</Text>
            </Pressable>
          ))}
          <Pressable onPress={() => router.push("/(tabs)/flo" as any)} style={styles.referenceRailFlo}>
            <Feather name="cpu" size={18} color="#22d3ee" />
            <View>
              <Text style={styles.referenceRailFloTitle}>Flo</Text>
              <Text style={styles.referenceRailFloSub}>Decision co-pilot</Text>
            </View>
          </Pressable>
        </View>
      ) : null}
      <View style={styles.dashboardHeader}>
        <View style={styles.brandLockup}>
          <View style={styles.brandMark}>
            <Image source={FLOWLEDGER_LOGO} style={styles.brandMarkImage} resizeMode="cover" />
          </View>
          <View>
            <Text style={styles.brandEyebrow}>FLOWLEDGER</Text>
            <Text style={styles.brandAlgo}>ALGO</Text>
            <Text style={styles.heading}>Command Center</Text>
            <Text style={styles.subheading}>{MONTH_FULL[currentMonth]} {selectedYear} · live forecast</Text>
          </View>
        </View>
        <Pressable
          onPress={() => setActionModalVisible(true)}
          style={({ pressed }) => [styles.headerActionButton, { opacity: pressed ? 0.82 : 1 }]}
        >
          <Feather name="plus" size={20} color="#f8fafc" />
        </Pressable>
      </View>

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
          <View style={styles.setupHeader}><View style={{ flex: 1 }}><Text style={[styles.setupTitle, { color: c.foreground }]}>Continue setup with Flo</Text><Text style={[styles.setupDesc, { color: c.mutedForeground }]}>Flo will pick up where you left off. {steps.filter(step => step.done).length} of {steps.length} setup steps complete</Text></View><Pressable onPress={() => void updateSettings({ onboarding_completed: true })}><Feather name="x" size={18} color={c.mutedForeground} /></Pressable></View>
          {steps.map(step => <View key={step.label} style={styles.setupStep}><Feather name={step.done ? "check-circle" : "circle"} size={15} color={step.done ? c.success : c.mutedForeground} /><Text style={[styles.setupStepText, { color: step.done ? c.mutedForeground : c.foreground }]}>{step.label}</Text></View>)}
          <Pressable onPress={() => complete ? void updateSettings({ onboarding_completed: true }) : router.push("/setup" as any)} style={[styles.setupButton, { backgroundColor: c.primary }]}><Text style={[styles.setupButtonText, { color: c.primaryForeground }]}>{complete ? "Finish Setup" : "Continue with Flo"}</Text></Pressable>
        </View>;
      })()}

      <Modal
        visible={startupAlertVisible && !!nextWeekRisk}
        transparent
        animationType="fade"
        onRequestClose={() => setStartupAlertVisible(false)}
      >
        <View style={styles.startupAlertBackdrop}>
          {nextWeekRisk && (
            <View style={[styles.startupAlertCard, { borderColor: nextWeekRisk.tone === "risk" ? c.destructive + "80" : c.warning + "80" }]}>
              <View style={styles.startupAlertHandle} />
              <View style={styles.startupAlertHeader}>
                <View style={[styles.proactiveAlertIcon, { backgroundColor: nextWeekRisk.tone === "risk" ? c.destructive + "18" : c.warning + "18" }]}>
                  <Feather name="alert-triangle" size={18} color={nextWeekRisk.tone === "risk" ? c.destructive : c.warning} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.proactiveAlertTitle, { color: c.foreground }]}>{nextWeekRisk.title}</Text>
                  <Text style={[styles.proactiveAlertText, { color: c.mutedForeground }]}>{nextWeekRisk.detail}</Text>
                </View>
                <Pressable onPress={() => setStartupAlertVisible(false)} hitSlop={10}>
                  <Feather name="x" size={20} color={c.mutedForeground} />
                </Pressable>
              </View>
              <View style={styles.proactiveActionRow}>
                <Pressable
                  onPress={() => {
                    setStartupAlertVisible(false);
                    openFloWithPrompt(nextWeekRisk.prompt);
                  }}
                  style={({ pressed }) => [styles.proactiveActionButton, { backgroundColor: c.primary + "18", opacity: pressed ? 0.75 : 1 }]}
                >
                  <Text style={[styles.proactiveActionText, { color: c.primary }]}>Show why</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    setStartupAlertVisible(false);
                    openFloWithPrompt(nextWeekRisk.saferBillPrompt);
                  }}
                  style={({ pressed }) => [styles.proactiveActionButton, { backgroundColor: c.warning + "18", opacity: pressed ? 0.75 : 1 }]}
                >
                  <Text style={[styles.proactiveActionText, { color: c.warning }]}>Find safer bill date</Text>
                </Pressable>
                <Pressable
                  onPress={() => setStartupAlertVisible(false)}
                  style={({ pressed }) => [styles.proactiveActionButton, { backgroundColor: "rgba(148,163,184,0.12)", opacity: pressed ? 0.75 : 1 }]}
                >
                  <Text style={[styles.proactiveActionText, { color: c.mutedForeground }]}>Not now</Text>
                </Pressable>
              </View>
            </View>
          )}
        </View>
      </Modal>

      {false ? (
        <Pressable
          onPress={() => openFloWithPrompt(nextWeekRisk!.prompt)}
          style={({ pressed }) => [
            styles.proactiveAlertCard,
            {
              backgroundColor: nextWeekRisk!.tone === "risk" ? c.destructive + "12" : c.warning + "14",
              borderColor: nextWeekRisk!.tone === "risk" ? c.destructive + "70" : c.warning + "70",
              opacity: pressed ? 0.82 : 1,
            },
          ]}
        >
          <View style={[styles.proactiveAlertIcon, { backgroundColor: nextWeekRisk!.tone === "risk" ? c.destructive + "18" : c.warning + "18" }]}>
            <Feather name="alert-triangle" size={17} color={nextWeekRisk!.tone === "risk" ? c.destructive : c.warning} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.proactiveAlertTitle, { color: c.foreground }]}>{nextWeekRisk!.title}</Text>
            <Text style={[styles.proactiveAlertText, { color: c.mutedForeground }]}>{nextWeekRisk!.detail}</Text>
            <View style={styles.proactiveActionRow}>
              <Pressable
                onPress={() => openFloWithPrompt(nextWeekRisk!.prompt)}
                style={({ pressed }) => [styles.proactiveActionButton, { backgroundColor: c.primary + "18", opacity: pressed ? 0.75 : 1 }]}
              >
                <Text style={[styles.proactiveActionText, { color: c.primary }]}>Show why</Text>
              </Pressable>
              <Pressable
                onPress={() => openFloWithPrompt(nextWeekRisk!.saferBillPrompt)}
                style={({ pressed }) => [styles.proactiveActionButton, { backgroundColor: c.warning + "18", opacity: pressed ? 0.75 : 1 }]}
              >
                <Text style={[styles.proactiveActionText, { color: c.warning }]}>Find safer bill date</Text>
              </Pressable>
              <Pressable
                onPress={() => openFloWithPrompt(nextWeekRisk!.reducePlanPrompt)}
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

      <View style={[styles.referenceCommandHero, isCommandWide && styles.referenceCommandHeroWide]}>
        <View style={styles.referenceHeroCopy}>
          <Text style={styles.referenceGreeting}>{timeGreeting} 👋</Text>
          <Text style={styles.referenceGreetingSub}>Here’s your financial flow for {MONTH_FULL[currentMonth]}.</Text>
          <Text style={styles.referenceHeroLabel}>Available to spend</Text>
          <Text style={styles.referenceHeroAmount}>
            {(balanceMetrics?.currentBalance ?? cashFlow.remaining) < 0 ? "−" : ""}$
            {Math.abs(balanceMetrics?.currentBalance ?? cashFlow.remaining).toLocaleString("en-US", { maximumFractionDigits: 2 })}
          </Text>
          <Text style={styles.referenceHeroHint}>After bills, planned moves, and your safety floor.</Text>

          <View style={styles.referenceSummaryRow}>
            {[
              { label: "Income", value: `$${monthlyIncome.toLocaleString("en-US", { maximumFractionDigits: 0 })}`, color: "#22c55e" },
              { label: "Bills", value: `$${stats.totalDue.toLocaleString("en-US", { maximumFractionDigits: 0 })}`, color: "#60a5fa" },
              { label: "Available", value: `$${Math.max(0, algorithmSuite.safeCushion.amount).toLocaleString("en-US", { maximumFractionDigits: 0 })}`, color: "#a855f7" },
            ].map(item => (
              <View key={item.label} style={styles.referenceSummaryCard}>
                <Text style={[styles.referenceSummaryLabel, { color: item.color }]}>{item.label}</Text>
                <Text style={styles.referenceSummaryValue}>{item.value}</Text>
              </View>
            ))}
          </View>
        </View>

        <Pressable
          onPress={() => setFlowScoreVisible(true)}
          style={({ pressed }) => [styles.referenceScorePanel, { opacity: pressed ? 0.86 : 1 }]}
        >
          <FlowScoreGauge score={algorithmSuite.flowScore.score} />
          <Text style={styles.referenceScoreStatus}>{algorithmSuite.flowScore.label}</Text>
          <View style={styles.referenceScoreUnderline} />
          <Text style={styles.referenceScoreReason} numberOfLines={2}>{algorithmSuite.flowScore.topReason}</Text>
          <Text style={styles.referenceScoreTapHint}>Tap for details</Text>
        </Pressable>
      </View>

      <View style={[styles.referenceLowerGrid, isCommandWide && styles.referenceLowerGridWide]}>
        <View style={styles.referenceAlgoCarouselPanel}>
          <View style={styles.referenceAlgoHeaderRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.referenceInsightTitle}>Algorithm Suite</Text>
              <Text style={styles.referenceAlgoSubtitle}>Swipe through the engines guiding your money plan.</Text>
            </View>
            <View style={styles.referenceAlgoCountPill}>
              <Text style={styles.referenceAlgoCountActive}>{String(activeAlgorithmCardNumber).padStart(2, "0")}</Text>
              <Text style={styles.referenceAlgoCountTotal}>/{String(algorithmCards.length).padStart(2, "0")}</Text>
            </View>
          </View>

          <ScrollView
            ref={algorithmCarouselRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            decelerationRate="fast"
            snapToInterval={algorithmSnapInterval}
            snapToAlignment="start"
            disableIntervalMomentum
            scrollEventThrottle={16}
            contentContainerStyle={styles.referenceAlgoScrollContent}
            onScroll={scheduleAlgorithmCarouselSnap}
            onScrollEndDrag={(event) => snapAlgorithmCarouselToNearest(event.nativeEvent.contentOffset.x)}
            onMomentumScrollEnd={(event) => snapAlgorithmCarouselToNearest(event.nativeEvent.contentOffset.x)}
          >
            {algorithmCards.map(card => (
              <Pressable
                key={card.id}
                onPress={() => openFloWithPrompt(card.prompt)}
                style={({ pressed }) => [
                  styles.referenceAlgorithmCard,
                  {
                    width: algorithmCardWidth,
                    borderColor: `${card.color}55`,
                    opacity: pressed ? 0.84 : 1,
                  },
                ]}
              >
                <View style={[styles.referenceAlgorithmIcon, { backgroundColor: `${card.color}22` }]}>
                  <Feather name={card.icon} size={18} color={card.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.referenceAlgorithmTitle}>{card.title}</Text>
                  <Text style={[styles.referenceAlgorithmValue, { color: card.color }]}>{card.value}</Text>
                  <Text style={styles.referenceAlgorithmDetail} numberOfLines={2}>{card.detail}</Text>
                  <Text style={styles.referenceAlgorithmAction} numberOfLines={1}>{card.action}</Text>
                </View>
                <Feather name="message-circle" size={16} color="rgba(226,232,240,0.72)" />
              </Pressable>
            ))}
          </ScrollView>

          <View style={styles.referenceAlgoDots}>
            {algorithmCards.map((card, index) => (
              <Pressable
                key={card.id}
                onPress={() => jumpToAlgorithmCard(index)}
                hitSlop={8}
                style={[
                  styles.referenceAlgoDot,
                  index === activeAlgoCard && styles.referenceAlgoDotActive,
                ]}
                accessibilityRole="tab"
                accessibilityState={{ selected: index === activeAlgoCard }}
              />
            ))}
          </View>
        </View>

        {false && (
        <Pressable
          onPress={() => openFloWithPrompt(`Explain my ${MONTH_FULL[currentMonth]} flow and the best next move.`)}
          style={({ pressed }) => [styles.referenceInsightCard, { opacity: pressed ? 0.82 : 1 }]}
        >
          <View style={styles.referenceInsightIcon}>
            <Feather name="zap" size={18} color="#e9d5ff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.referenceInsightTitle}>Algo Insight</Text>
            <Text style={styles.referenceInsightText}>{algorithmSuite.flowScore.topAction}</Text>
            <Text style={styles.referenceInsightLink}>See details →</Text>
          </View>
          <View style={styles.referenceMiniChart}>
            {[14, 28, 18, 42, 34, 58, 46, 74].map((height, index) => (
              <View key={index} style={[styles.referenceMiniBar, { height }]} />
            ))}
          </View>
        </Pressable>
        )}

      </View>

      {/* ── HERO: flip card — front = Balance Today, back = Savings ── */}
      {false && (() => {
        const cur = balanceMetrics?.currentBalance ?? cashFlow.remaining;
        const isNeg = cur < 0;
        const isLow = !isNeg && cur < settings.safety_floor;
        const gradColors: [string, string] = isNeg
          ? ["#210512", "#881337"]
          : isLow
          ? ["#271406", "#7c2d12"]
          : ["#020617", "#1e1b4b"];
        const statusLabel = isNeg ? "Risk" : isLow ? "Tight" : "On track";
        const statusColor = isNeg ? "#fb7185" : isLow ? "#fbbf24" : "#22c55e";

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
                <View style={styles.heroSignalLine} />

                <View style={styles.heroTopRow}>
                  <View style={[styles.heroStatusBadge, { borderColor: statusColor + "55", backgroundColor: statusColor + "18" }]}>
                    <View style={[styles.heroStatusDot, { backgroundColor: statusColor }]} />
                    <Text style={[styles.heroStatusText, { color: statusColor }]}>{statusLabel}</Text>
                  </View>
                  <View style={styles.heroFlipHint}>
                    <Feather name="refresh-cw" size={12} color="rgba(255,255,255,0.62)" />
                    <Text style={styles.heroFlipHintText}>savings</Text>
                  </View>
                </View>

                <Text style={styles.heroLabel}>Available today</Text>
                <Text style={styles.heroValue}>
                  {cur < 0 ? "−" : ""}${Math.abs(cur).toFixed(0)}
                </Text>
                <Text style={styles.heroSubtitle}>Projected command balance after scheduled money moves.</Text>

                <View style={styles.heroMetrics}>
                  <View style={styles.heroMetric}>
                    <Text style={styles.heroMetricLabel}>Month close</Text>
                    <Text style={[styles.heroMetricValue, {
                      color: (balanceMetrics?.endOfMonthBalance ?? 0) < 0 ? "#fca5a5" : "rgba(255,255,255,0.95)"
                    }]}>
                      {(balanceMetrics?.endOfMonthBalance ?? 0) < 0 ? "−" : ""}
                      ${Math.abs(balanceMetrics?.endOfMonthBalance ?? 0).toFixed(0)}
                    </Text>
                  </View>
                  <View style={styles.heroMetricDivider} />
                  <View style={styles.heroMetric}>
                    <Text style={styles.heroMetricLabel}>Lowest point</Text>
                    <Text style={[styles.heroMetricValue, {
                      color: (balanceMetrics?.lowestBalance ?? 0) < 0 ? "#fca5a5"
                        : (balanceMetrics?.lowestBalance ?? 0) < settings.safety_floor ? "#fde68a"
                        : "#bbf7d0"
                    }]}>
                      {(balanceMetrics?.lowestBalance ?? 0) < 0 ? "−" : ""}
                      ${Math.abs(balanceMetrics?.lowestBalance ?? 0).toFixed(0)}
                      {balanceMetrics ? ` · ${MONTH_NAMES[currentMonth]} ${balanceMetrics?.lowestDay ?? ""}` : ""}
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
                      Bill runway: {stats.paidCount} of {stats.billCount} cleared
                      {stats.unpaidCount > 0 ? ` · ${stats.unpaidCount} left` : ""}
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
                colors={["#052e2b", "#064e3b"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={[styles.heroCard, { overflow: "hidden", marginBottom: 0, height: cardHeight || undefined }]}
              >
                <View style={styles.heroGlowTop} />
                <View style={styles.heroGlowBottom} />
                <View style={styles.heroSignalLine} />

                <View style={styles.heroTopRow}>
                  <View style={[styles.heroStatusBadge, { borderColor: "#34d39955", backgroundColor: "#34d39918" }]}>
                    <View style={[styles.heroStatusDot, { backgroundColor: "#34d399" }]} />
                    <Text style={[styles.heroStatusText, { color: "#86efac" }]}>Savings lane</Text>
                  </View>
                  <View style={styles.heroFlipHint}>
                    <Feather name="refresh-cw" size={12} color="rgba(255,255,255,0.62)" />
                    <Text style={styles.heroFlipHintText}>balance</Text>
                  </View>
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
                      : "No savings goals yet — tap +, then Add Goal"}
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
      {false && decisionHubSettings.algorithmSuiteEnabled && (
        <Pressable
          onPress={() => setFlowScoreVisible(true)}
          style={({ pressed }) => [styles.algoSuiteCard, { opacity: pressed ? 0.9 : 1 }]}
        >
          <View style={styles.algoSuiteHeader}>
            <View style={styles.algoScoreRing}>
              <Text style={styles.algoScoreValue}>{algorithmSuite.flowScore.score}</Text>
              <Text style={styles.algoScoreLabel}>FLOW</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.algoEyebrow}>FLOW SCORE - {algorithmSuite.activeCount} ACTIVE</Text>
              <Text style={styles.algoTitle}>{algorithmSuite.flowScore.score} - {algorithmSuite.flowScore.label}</Text>
              <Text style={styles.algoDesc}>{algorithmSuite.flowScore.topReason}</Text>
            </View>
            <Feather name="chevron-right" size={20} color="rgba(226,232,240,0.72)" />
          </View>

          <View style={styles.algoMetricRow}>
            <Pressable
              onPress={(event) => {
                event.stopPropagation();
                setSafeCushionVisible(true);
              }}
              style={({ pressed }) => [styles.algoMiniMetric, { opacity: pressed ? 0.78 : 1 }]}
            >
              <Text style={styles.algoMiniLabel}>Safe Cushion</Text>
              <Text style={styles.algoMiniValue}>${algorithmSuite.safeCushion.amount.toFixed(0)}</Text>
              <Text style={styles.algoMiniHint} numberOfLines={1}>{algorithmSuite.safeCushion.compactReason}</Text>
            </Pressable>
            <View style={styles.algoMiniMetric}>
              <Text style={styles.algoMiniLabel}>Daily Limit</Text>
              <Text style={styles.algoMiniValue}>${algorithmSuite.spendingLimit.daily.toFixed(0)}</Text>
            </View>
            <View style={styles.algoMiniMetric}>
              <Text style={styles.algoMiniLabel}>Tight Days</Text>
              <Text style={[styles.algoMiniValue, { color: algorithmSuite.riskDay.risk ? "#fb7185" : "#4ade80" }]}>{algorithmSuite.riskDay.risk}</Text>
            </View>
          </View>

          <Pressable
            onPress={(event) => {
              event.stopPropagation();
              openFloWithPrompt(`Why is my Flow Score ${algorithmSuite.flowScore.score}? ${algorithmSuite.flowScore.topReason} ${algorithmSuite.flowScore.topAction}`);
            }}
            style={({ pressed }) => [styles.algoActionButton, { opacity: pressed ? 0.78 : 1 }]}
          >
            <Feather name="message-circle" size={15} color="#dbeafe" />
            <Text style={styles.algoActionText}>{algorithmSuite.flowScore.topAction}</Text>
          </Pressable>
        </Pressable>
      )}

      {false && <View style={styles.commandDeck}>
        <Pressable
          onPress={() => router.push("/(tabs)/flo" as any)}
          style={({ pressed }) => [styles.primaryCommandCard, { opacity: pressed ? 0.82 : 1 }]}
        >
          <LinearGradient
            colors={["#2563eb", "#7c3aed"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.primaryCommandGradient}
          >
            <View style={styles.primaryCommandIcon}>
              <Feather name="message-circle" size={19} color="#dbeafe" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.primaryCommandEyebrow}>DECISION LAYER</Text>
              <Text style={styles.primaryCommandTitle}>Ask Flo before you move money</Text>
              <Text style={styles.primaryCommandSub}>Affordability, low-balance causes, bill timing, and category moves.</Text>
            </View>
            <Feather name="arrow-up-right" size={18} color="#ffffff" />
          </LinearGradient>
        </Pressable>

        <View style={styles.quickCommandRow}>
          {[
            { label: "Calendar", icon: "calendar" as const, color: "#38bdf8", action: () => router.push("/(tabs)/monthly" as any) },
            { label: "Bills", icon: "file-text" as const, color: "#fbbf24", action: () => router.push("/(tabs)/bills" as any) },
            { label: "Activity", icon: "repeat" as const, color: "#34d399", action: () => router.push("/(tabs)/transactions" as any) },
          ].map(item => (
            <Pressable
              key={item.label}
              onPress={item.action}
              style={({ pressed }) => [styles.quickCommand, { opacity: pressed ? 0.76 : 1 }]}
            >
              <View style={[styles.quickCommandIcon, { backgroundColor: item.color + "1f" }]}>
                <Feather name={item.icon} size={16} color={item.color} />
              </View>
              <Text style={styles.quickCommandText}>{item.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>}

      {false && <View style={styles.moneyRadarCard}>
        <View style={styles.moneyRadarHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.moneyRadarEyebrow}>MONTHLY MONEY RADAR</Text>
            <Text style={styles.moneyRadarTitle}>{breakdownText}</Text>
          </View>
          <View style={[styles.moneyRadarBadge, { backgroundColor: (balanceMetrics?.lowestBalance ?? 0) < settings.safety_floor ? "#f59e0b22" : "#22c55e22" }]}>
            <Text style={[styles.moneyRadarBadgeText, { color: (balanceMetrics?.lowestBalance ?? 0) < settings.safety_floor ? "#fbbf24" : "#4ade80" }]}>
              {(balanceMetrics?.lowestBalance ?? 0) < settings.safety_floor ? "WATCH" : "SAFE"}
            </Text>
          </View>
        </View>
        <View style={styles.moneyRadarGrid}>
          {statCards.map(card => (
            <Pressable
              key={card.title}
              onPress={() => navigate(card.filter, card.tab)}
              style={({ pressed }) => [styles.radarMetric, { opacity: pressed ? 0.78 : 1 }]}
            >
              <View style={[styles.radarMetricIcon, { backgroundColor: card.col + "1f" }]}>
                <Feather name={card.icon} size={15} color={card.col} />
              </View>
              <Text style={[styles.radarMetricValue, { color: card.col }]} numberOfLines={1}>{card.value}</Text>
              <Text style={styles.radarMetricLabel}>{card.title}</Text>
            </Pressable>
          ))}
        </View>
      </View>}

      {false && <View style={[styles.statsPillRow, { marginBottom: 8 }]}>
        {statCards.slice(0, 3).map(card => (
          <Pressable
            key={card.title}
            onPress={() => navigate(card.filter, card.tab)}
            style={({ pressed }) => [styles.statPill, { backgroundColor: c.card, borderColor: c.border, opacity: pressed ? 0.8 : 1 }]}
          >
            <View style={[styles.statPillIcon, { backgroundColor: card.col + "18" }]}>
              <Feather name={card.icon} size={14} color={card.col} />
            </View>
            <Text style={[styles.statPillValue, { color: card.col }]} numberOfLines={1}>{card.value}</Text>
            <Text style={[styles.statPillLabel, { color: c.mutedForeground }]}>{card.title.toUpperCase()}</Text>
          </Pressable>
        ))}
      </View>}
      {/* Row 2: Debt — full width */}
      {false && (() => {
        const debt = statCards[3];
        return (
          <Pressable
            onPress={() => navigate(debt.filter, debt.tab)}
            style={({ pressed }) => [styles.statDebtRow, { backgroundColor: c.card, borderColor: c.border, opacity: pressed ? 0.8 : 1 }]}
          >
            <View style={styles.statDebtLeft}>
              <View style={[styles.statDebtIcon, { backgroundColor: debt.col + "16" }]}>
                <Feather name={debt.icon} size={18} color={debt.col} />
              </View>
              <View>
                <Text style={[styles.statPillLabel, { color: c.mutedForeground }]}>DEBT</Text>
                <Text style={[styles.statDebtValue, { color: debt.col }]}>{debt.value}</Text>
              </View>
            </View>
            <Feather name="chevron-right" size={16} color={c.mutedForeground} />
          </Pressable>
        );
      })()}

      {false && <View style={styles.commandGrid}>
        {[
          { label: "Ask Flo", sub: "Decide before you spend", icon: "message-circle" as const, color: c.primary, action: () => router.push("/(tabs)/flo" as any) },
          { label: "Calendar", sub: "See the month", icon: "calendar" as const, color: c.success, action: () => router.push("/(tabs)/monthly" as any) },
          { label: "Bills", sub: "Setup & debt", icon: "file-text" as const, color: c.warning, action: () => router.push("/(tabs)/bills" as any) },
        ].map(item => (
          <Pressable
            key={item.label}
            onPress={item.action}
            style={({ pressed }) => [styles.commandCard, { backgroundColor: c.card, borderColor: c.border, opacity: pressed ? 0.78 : 1 }]}
          >
            <View style={[styles.commandIcon, { backgroundColor: item.color + "18" }]}>
              <Feather name={item.icon} size={17} color={item.color} />
            </View>
            <Text style={[styles.commandLabel, { color: c.foreground }]}>{item.label}</Text>
            <Text style={[styles.commandSub, { color: c.mutedForeground }]}>{item.sub}</Text>
          </Pressable>
        ))}
      </View>}

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

      {false && <View style={styles.monthlyReviewCard}>
        <View style={styles.monthlyReviewHeader}>
          <View style={styles.monthlyReviewIcon}>
            <Feather name="activity" size={17} color="#38bdf8" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.decisionHubEyebrow}>FLO BRIEFING</Text>
            <Text style={styles.monthlyReviewTitle}>{monthlyReview.headline}</Text>
            <Text style={styles.monthlyReviewDesc}>{monthlyReview.nextStep}</Text>
          </View>
          <Pressable
            onPress={() => openFloWithPrompt(monthlyReview.prompt)}
            style={({ pressed }) => [styles.monthlyReviewAsk, { opacity: pressed ? 0.75 : 1 }]}
          >
            <Text style={styles.monthlyReviewAskText}>Ask Flo</Text>
          </Pressable>
        </View>
        <View style={styles.monthlyReviewGrid}>
          <Pressable
            onPress={() => navigate("unpaid", "monthly")}
            style={({ pressed }) => [styles.monthlyReviewMetric, { opacity: pressed ? 0.75 : 1 }]}
          >
            <Text style={styles.monthlyReviewLabel}>Bills paid</Text>
            <Text style={[styles.monthlyReviewValue, { color: monthlyReview.unpaidCount > 0 ? c.warning : c.success }]}>{monthlyReview.paidCount}/{monthlyReview.billCount}</Text>
          </Pressable>
          <Pressable
            onPress={() => navigate("unpaid", "monthly")}
            style={({ pressed }) => [styles.monthlyReviewMetric, { opacity: pressed ? 0.75 : 1 }]}
          >
            <Text style={styles.monthlyReviewLabel}>Unpaid</Text>
            <Text style={[styles.monthlyReviewValue, { color: monthlyReview.billDelta > 0 ? c.warning : c.success }]}>${Math.max(0, monthlyReview.billDelta).toFixed(0)}</Text>
          </Pressable>
          <Pressable
            onPress={() => router.push("/(tabs)/monthly" as any)}
            style={({ pressed }) => [styles.monthlyReviewMetric, { opacity: pressed ? 0.75 : 1 }]}
          >
            <Text style={styles.monthlyReviewLabel}>Low point</Text>
            <Text style={[styles.monthlyReviewValue, { color: monthlyReview.lowestBalance < settings.safety_floor ? c.warning : c.success }]}>${monthlyReview.lowestBalance.toFixed(0)}</Text>
          </Pressable>
          <Pressable
            onPress={() => router.push("/(tabs)/more" as any)}
            style={({ pressed }) => [styles.monthlyReviewMetric, { opacity: pressed ? 0.75 : 1 }]}
          >
            <Text style={styles.monthlyReviewLabel}>Savings</Text>
            <Text style={[styles.monthlyReviewValue, { color: c.success }]}>{monthlyReview.savingsPct.toFixed(0)}%</Text>
          </Pressable>
        </View>
        <View style={styles.monthlyReviewActions}>
          <Pressable
            onPress={() => router.push("/(tabs)/monthly" as any)}
            style={({ pressed }) => [styles.monthlyReviewAction, { backgroundColor: c.primary + "18", opacity: pressed ? 0.75 : 1 }]}
          >
            <Feather name="calendar" size={12} color={c.primary} />
            <Text style={[styles.monthlyReviewActionText, { color: c.primary }]}>Open monthly plan</Text>
          </Pressable>
          <Pressable
            onPress={() => openFloWithPrompt(monthlyReview.prompt)}
            style={({ pressed }) => [styles.monthlyReviewAction, { backgroundColor: c.success + "18", opacity: pressed ? 0.75 : 1 }]}
          >
            <Feather name="message-circle" size={12} color={c.success} />
            <Text style={[styles.monthlyReviewActionText, { color: c.success }]}>Ask Flo to review</Text>
          </Pressable>
        </View>
      </View>}

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
      {false && upcomingBills.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Next 7 Days</Text>
          <View style={styles.upcomingCard}>
            {upcomingBills.map((bill, i) => {
              const catColor = CAT_COLORS[bill.category] ?? c.primary;
              const daysLeft = bill.due_day - today;
              return (
                <Pressable
                  key={bill.id}
                  onPress={() => { router.push("/(tabs)/monthly" as any); }}
                  style={({ pressed }) => [styles.upcomingRow, { borderTopWidth: i > 0 ? 1 : 0, opacity: pressed ? 0.75 : 1 }]}
                >
                  <View style={[styles.upcomingDot, { backgroundColor: catColor + "20" }]}>
                    <Feather name="calendar" size={13} color={catColor} />
                  </View>
                  <View style={styles.upcomingInfo}>
                    <Text style={styles.upcomingName}>{bill.name}</Text>
                    <Text style={styles.upcomingDate}>
                      Due {daysLeft === 0 ? "today" : daysLeft === 1 ? "tomorrow" : `in ${daysLeft} days`}
                    </Text>
                  </View>
                  <Text style={styles.upcomingAmt}>${bill.amount.toFixed(0)}</Text>
                  <Feather name="chevron-right" size={13} color="#64748b" style={{ marginLeft: 4 }} />
                </Pressable>
              );
            })}
          </View>
        </>
      )}

      {false && <>
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

      </>}

      {/* ── "What can I do?" modal ── */}
      <Modal
        visible={flowScoreVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setFlowScoreVisible(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setFlowScoreVisible(false)}>
          <Pressable style={[styles.actionSheet, { backgroundColor: c.card }]} onPress={() => {}}>
            <View style={[styles.sheetHandle, { backgroundColor: c.muted }]} />
            <View style={styles.flowScoreSheetHeader}>
              <View style={styles.algoScoreRing}>
                <Text style={styles.algoScoreValue}>{algorithmSuite.flowScore.score}</Text>
                <Text style={styles.algoScoreLabel}>FLOW</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.sheetTitle, { color: c.foreground }]}>{algorithmSuite.flowScore.score} - {algorithmSuite.flowScore.label}</Text>
                <Text style={[styles.sheetSub, { color: c.mutedForeground }]}>{algorithmSuite.flowScore.topReason}</Text>
              </View>
            </View>

            <View style={styles.flowScoreColumns}>
              <View style={[styles.flowScoreColumn, { backgroundColor: c.muted }]}>
                <Text style={[styles.flowScoreColumnTitle, { color: c.success }]}>Helped</Text>
                {(algorithmSuite.flowScore.positiveFactors.length ? algorithmSuite.flowScore.positiveFactors : ["Your plan has enough data to create a Flow Score."]).slice(0, 3).map(item => (
                  <Text key={item} style={[styles.flowScoreFactor, { color: c.foreground }]}>- {item}</Text>
                ))}
              </View>
              <View style={[styles.flowScoreColumn, { backgroundColor: c.muted }]}>
                <Text style={[styles.flowScoreColumnTitle, { color: c.warning }]}>Hurt</Text>
                {(algorithmSuite.flowScore.negativeFactors.length ? algorithmSuite.flowScore.negativeFactors : ["No major pressure points are showing right now."]).slice(0, 3).map(item => (
                  <Text key={item} style={[styles.flowScoreFactor, { color: c.foreground }]}>- {item}</Text>
                ))}
              </View>
            </View>

            <View style={[styles.flowScoreNextMove, { backgroundColor: c.primary + "18", borderColor: c.primary + "35" }]}>
              <Text style={[styles.flowScoreColumnTitle, { color: c.primary }]}>Best next move</Text>
              <Text style={[styles.flowScoreFactor, { color: c.foreground }]}>{algorithmSuite.flowScore.topAction}</Text>
            </View>

            <View style={styles.flowScoreBreakdown}>
              {algorithmSuite.flowScore.breakdownItems.slice(0, 5).map(item => (
                <View key={item.label} style={[styles.flowScoreBreakdownRow, { borderTopColor: c.border }]}>
                  <Text style={[styles.flowScoreBreakdownLabel, { color: c.mutedForeground }]}>{item.label}</Text>
                  <Text style={[styles.flowScoreBreakdownValue, { color: algoToneColor(item.tone === "watch" ? "watch" : item.tone === "risk" ? "risk" : item.tone === "safe" ? "safe" : "info") }]}>{item.value}</Text>
                </View>
              ))}
            </View>

            <Pressable
              onPress={() => {
                setFlowScoreVisible(false);
                openFloWithPrompt(`Why is my Flow Score ${algorithmSuite.flowScore.score}? ${algorithmSuite.flowScore.topReason} ${algorithmSuite.flowScore.topAction}`);
              }}
              style={({ pressed }) => [styles.flowScoreFloButton, { backgroundColor: c.primary, opacity: pressed ? 0.82 : 1 }]}
            >
              <Feather name="message-circle" size={16} color={c.primaryForeground} />
              <Text style={[styles.flowScoreFloText, { color: c.primaryForeground }]}>Ask Flo about this</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={safeCushionVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setSafeCushionVisible(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setSafeCushionVisible(false)}>
          <Pressable style={[styles.actionSheet, { backgroundColor: c.card }]} onPress={() => {}}>
            <View style={[styles.sheetHandle, { backgroundColor: c.muted }]} />
            <Text style={[styles.sheetTitle, { color: c.foreground }]}>Safe Cushion</Text>
            <Text style={[styles.sheetSub, { color: c.mutedForeground }]}>
              The calm number: what is still safe after your plan protects the floor.
            </Text>

            <View style={[
              styles.safeCushionHero,
              {
                backgroundColor: algoToneColor(algorithmSuite.safeCushion.status) + "16",
                borderColor: algoToneColor(algorithmSuite.safeCushion.status) + "38",
              },
            ]}>
              <View>
                <Text style={[styles.flowScoreColumnTitle, { color: algoToneColor(algorithmSuite.safeCushion.status) }]}>
                  {algorithmSuite.safeCushion.label}
                </Text>
                <Text style={[styles.safeCushionHeroAmount, { color: c.foreground }]}>
                  ${algorithmSuite.safeCushion.amount.toFixed(0)}
                </Text>
              </View>
              <Text style={[styles.safeCushionHeroCopy, { color: c.mutedForeground }]}>
                {algorithmSuite.safeCushion.topReason}
              </Text>
            </View>

            <View style={styles.flowScoreBreakdown}>
              {algorithmSuite.safeCushion.breakdownItems.map(item => (
                <View key={item.label} style={[styles.flowScoreBreakdownRow, { borderTopColor: c.border }]}>
                  <Text style={[styles.flowScoreBreakdownLabel, { color: c.mutedForeground }]}>{item.label}</Text>
                  <Text style={[styles.flowScoreBreakdownValue, { color: algoToneColor(item.tone === "watch" ? "watch" : item.tone === "risk" ? "risk" : item.tone === "safe" ? "safe" : "info") }]}>{item.value}</Text>
                </View>
              ))}
            </View>

            <View style={[styles.flowScoreNextMove, { backgroundColor: c.primary + "18", borderColor: c.primary + "35" }]}>
              <Text style={[styles.flowScoreColumnTitle, { color: c.primary }]}>What this means</Text>
              <Text style={[styles.flowScoreFactor, { color: c.foreground }]}>{algorithmSuite.safeCushion.reservedLabel}</Text>
              <Text style={[styles.flowScoreFactor, { color: c.foreground, marginTop: 6 }]}>{algorithmSuite.safeCushion.topAction}</Text>
              <Text style={[styles.flowScoreFactor, { color: c.mutedForeground, marginTop: 6 }]}>{algorithmSuite.safeCushion.calendarHint}</Text>
            </View>

            <Pressable
              onPress={() => {
                setSafeCushionVisible(false);
                openFloWithPrompt("What is my Safe Cushion and what can I safely do with it?");
              }}
              style={({ pressed }) => [styles.flowScoreFloButton, { backgroundColor: c.primary, opacity: pressed ? 0.82 : 1 }]}
            >
              <Feather name="message-circle" size={16} color={c.primaryForeground} />
              <Text style={[styles.flowScoreFloText, { color: c.primaryForeground }]}>Ask Flo about this</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

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
              { id: "goal",    icon: "target"      as const, label: "Add Goal",          sub: "Plan savings or a future purchase",   col: "#8b5cf6"     },
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
  dashboardStage: { backgroundColor: "#030712" },
  content: { paddingHorizontal: 16, position: "relative", overflow: "hidden" },
  contentWide: { paddingLeft: 220, paddingRight: 28, maxWidth: 1320, alignSelf: "center", width: "100%" },
  referenceDesktopRail: {
    position: "absolute",
    left: 18,
    width: 184,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.16)",
    backgroundColor: "rgba(2,6,23,0.74)",
    borderRadius: 24,
    padding: 12,
    shadowColor: "#7c3aed",
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.26,
    shadowRadius: 30,
  },
  referenceRailLogoRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 18 },
  referenceRailLogo: { width: 38, height: 38, borderRadius: 12 },
  referenceRailBrand: { color: "#f8fafc", fontSize: 16, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.3 },
  referenceRailAlgo: { color: "#a78bfa", fontSize: 9, fontFamily: "Inter_800ExtraBold", letterSpacing: 5 },
  referenceRailItem: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 11, marginBottom: 5 },
  referenceRailItemActive: { backgroundColor: "rgba(79,70,229,0.48)", borderWidth: 1, borderColor: "rgba(34,211,238,0.28)" },
  referenceRailText: { color: "#94a3b8", fontSize: 13, fontFamily: "Inter_700Bold" },
  referenceRailTextActive: { color: "#f8fafc" },
  referenceRailFlo: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 14, borderRadius: 18, borderWidth: 1, borderColor: "rgba(34,211,238,0.16)", backgroundColor: "rgba(15,23,42,0.70)", padding: 11 },
  referenceRailFloTitle: { color: "#e0f2fe", fontSize: 13, fontFamily: "Inter_800ExtraBold" },
  referenceRailFloSub: { color: "#94a3b8", fontSize: 10, fontFamily: "Inter_500Medium" },
  stormBackdrop: { position: "absolute", top: 0, left: 0, right: 0, height: 820 },
  stormBase: { ...StyleSheet.absoluteFillObject },
  stormOrb: { position: "absolute", width: 330, height: 330, borderRadius: 165, opacity: 0.32 },
  stormOrbBlue: { top: -130, right: -150, backgroundColor: "#2563eb" },
  stormOrbViolet: { top: 210, left: -190, backgroundColor: "#7c3aed" },
  lightningBeam: { position: "absolute", height: 2, borderRadius: 2, backgroundColor: "#93c5fd", shadowColor: "#38bdf8", shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.9, shadowRadius: 14 },
  lightningBeamOne: { top: 116, left: -40, width: 300 },
  lightningBeamTwo: { top: 360, right: -80, width: 260, backgroundColor: "#a78bfa" },
  stormGrid: { position: "absolute", top: 0, left: -20, right: -20, height: 740, borderWidth: 1, borderColor: "rgba(148,163,184,0.05)", opacity: 0.55 },
  dashboardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 14, marginBottom: 18 },
  brandLockup: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
  brandMark: { width: 48, height: 48, borderRadius: 17, alignItems: "center", justifyContent: "center", overflow: "hidden", borderWidth: 1, borderColor: "rgba(96,165,250,0.35)", backgroundColor: "#020617", shadowColor: "#38bdf8", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.35, shadowRadius: 18, elevation: 9 },
  brandMarkImage: { width: "100%", height: "100%" },
  brandEyebrow: { color: "#38bdf8", fontSize: 10, fontFamily: "Inter_800ExtraBold", letterSpacing: 2.3, marginBottom: -1 },
  brandAlgo: { color: "#a78bfa", fontSize: 9, fontFamily: "Inter_800ExtraBold", letterSpacing: 7, marginBottom: 1, opacity: 0.9 },
  heading:    { fontSize: 30, fontFamily: "Inter_800ExtraBold", letterSpacing: -1.0, color: "#f8fafc", textShadowColor: "rgba(56,189,248,0.35)", textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 12 },
  subheading: { fontSize: 12, fontFamily: "Inter_600SemiBold", marginTop: 2, color: "#a5b4fc" },
  headerActionButton: { width: 54, height: 54, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(124,58,237,0.82)", borderWidth: 1, borderColor: "rgba(34,211,238,0.38)", shadowColor: "#8b5cf6", shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.52, shadowRadius: 22, elevation: 12 },
  setupCard: { borderWidth: 1, borderRadius: 18, padding: 14, marginBottom: 12 },
  setupHeader: { flexDirection: "row", alignItems: "flex-start", marginBottom: 8 },
  setupTitle: { fontSize: 15, fontFamily: "Inter_700Bold" },
  setupDesc: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  setupStep: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 },
  setupStepText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  setupButton: { height: 40, borderRadius: 9, alignItems: "center", justifyContent: "center", marginTop: 10 },
  setupButtonText: { fontSize: 13, fontFamily: "Inter_700Bold" },
  confidenceCard: { flexDirection: "row", alignItems: "center", gap: 9, padding: 12, borderRadius: 12, marginBottom: 14 },
  proactiveAlertCard: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 18, padding: 13, marginBottom: 14 },
  proactiveAlertIcon: { width: 38, height: 38, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  proactiveAlertTitle: { fontSize: 14, fontFamily: "Inter_800ExtraBold" },
  proactiveAlertText: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17, marginTop: 2 },
  proactiveActionRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  proactiveActionButton: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 999 },
  proactiveActionText: { fontSize: 11, fontFamily: "Inter_800ExtraBold" },
  askFloPill: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 999 },
  askFloPillText: { fontSize: 11, fontFamily: "Inter_800ExtraBold" },
  startupAlertBackdrop: { flex: 1, backgroundColor: "rgba(2,6,23,0.72)", alignItems: "center", justifyContent: "center", padding: 22 },
  startupAlertCard: { width: "100%", maxWidth: 480, borderRadius: 28, borderWidth: 1, backgroundColor: "rgba(15,23,42,0.96)", padding: 18, shadowColor: "#000", shadowOffset: { width: 0, height: 22 }, shadowOpacity: 0.38, shadowRadius: 34, elevation: 16 },
  startupAlertHandle: { alignSelf: "center", width: 44, height: 4, borderRadius: 999, backgroundColor: "rgba(148,163,184,0.45)", marginBottom: 16 },
  startupAlertHeader: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  confidenceTitle: { fontSize: 13, fontFamily: "Inter_700Bold" },
  confidenceDesc: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },

  referenceCommandHero: {
    borderRadius: 32,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.14)",
    backgroundColor: "rgba(2,6,23,0.42)",
    padding: 18,
    marginBottom: 14,
    overflow: "hidden",
    shadowColor: "#22d3ee",
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.24,
    shadowRadius: 34,
    elevation: 10,
  },
  referenceCommandHeroWide: { flexDirection: "row", minHeight: 320, padding: 30, alignItems: "center", gap: 22 },
  referenceHeroCopy: { flex: 1 },
  referenceGreeting: { color: "#f8fafc", fontSize: 23, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.7 },
  referenceGreetingSub: { color: "#94a3b8", fontSize: 13, fontFamily: "Inter_500Medium", marginTop: 4, marginBottom: 24 },
  referenceHeroLabel: { color: "#cbd5e1", fontSize: 11, fontFamily: "Inter_800ExtraBold", letterSpacing: 1.4, textTransform: "uppercase" },
  referenceHeroAmount: { color: "#ffffff", fontSize: 54, lineHeight: 61, fontFamily: "Inter_800ExtraBold", letterSpacing: -2.2, textShadowColor: "rgba(34,211,238,0.25)", textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 18 },
  referenceHeroHint: { color: "#94a3b8", fontSize: 13, fontFamily: "Inter_600SemiBold", marginTop: 4, marginBottom: 20 },
  referenceSummaryRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  referenceSummaryCard: { flexGrow: 1, flexBasis: "30%", minWidth: 96, borderRadius: 15, borderWidth: 1, borderColor: "rgba(148,163,184,0.12)", backgroundColor: "rgba(15,23,42,0.62)", padding: 12 },
  referenceSummaryLabel: { fontSize: 10, fontFamily: "Inter_800ExtraBold", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 7 },
  referenceSummaryValue: { color: "#f8fafc", fontSize: 18, fontFamily: "Inter_800ExtraBold" },
  referenceScorePanel: { alignItems: "center", justifyContent: "center", paddingTop: 14 },
  referenceGaugeWrap: { width: 152, height: 152, alignItems: "center", justifyContent: "center", shadowColor: "#a855f7", shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.55, shadowRadius: 22 },
  referenceGaugeCenter: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  referenceGaugeScore: { color: "#ffffff", fontSize: 42, fontFamily: "Inter_800ExtraBold", lineHeight: 47 },
  referenceGaugeLabel: { color: "#cbd5e1", fontSize: 11, fontFamily: "Inter_700Bold" },
  referenceScoreStatus: { color: "#4ade80", fontSize: 14, fontFamily: "Inter_800ExtraBold", marginTop: 10 },
  referenceScoreUnderline: { width: 86, height: 3, borderRadius: 3, backgroundColor: "#22c55e", marginTop: 8, marginBottom: 8 },
  referenceScoreReason: { color: "#94a3b8", maxWidth: 220, textAlign: "center", fontSize: 12, fontFamily: "Inter_600SemiBold", lineHeight: 17 },
  referenceScoreTapHint: { color: "#60a5fa", fontSize: 11, fontFamily: "Inter_800ExtraBold", marginTop: 8 },
  referenceLowerGrid: { gap: 12, marginBottom: 14 },
  referenceLowerGridWide: { flexDirection: "row" },
  referenceAlgoCarouselPanel: { flex: 1.45, borderRadius: 24, borderWidth: 1, borderColor: "rgba(168,85,247,0.22)", backgroundColor: "rgba(15,23,42,0.72)", padding: 14, shadowColor: "#8b5cf6", shadowOffset: { width: 0, height: 14 }, shadowOpacity: 0.22, shadowRadius: 26, elevation: 8 },
  referenceAlgoHeaderRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10, marginBottom: 10 },
  referenceAlgoSubtitle: { color: "#94a3b8", fontSize: 11, fontFamily: "Inter_600SemiBold", lineHeight: 15, marginTop: 2 },
  referenceAlgoCount: { color: "#a78bfa", fontSize: 12, fontFamily: "Inter_800ExtraBold", marginTop: 1 },
  referenceAlgoCountPill: { minWidth: 64, height: 30, borderRadius: 999, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", justifyContent: "center", backgroundColor: "rgba(37,99,235,0.16)", borderWidth: 1, borderColor: "rgba(96,165,250,0.28)" },
  referenceAlgoCountActive: { color: "#dbeafe", fontSize: 13, fontFamily: "Inter_800ExtraBold" },
  referenceAlgoCountTotal: { color: "#818cf8", fontSize: 11, fontFamily: "Inter_800ExtraBold" },
  referenceAlgoScrollContent: { gap: 12, paddingRight: 4 },
  referenceAlgorithmCard: { minHeight: 148, borderRadius: 22, borderWidth: 1, backgroundColor: "rgba(2,6,23,0.62)", padding: 14, flexDirection: "row", gap: 12, alignItems: "flex-start" },
  referenceAlgorithmIcon: { width: 42, height: 42, borderRadius: 15, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(226,232,240,0.08)" },
  referenceAlgorithmTitle: { color: "#e2e8f0", fontSize: 12, fontFamily: "Inter_800ExtraBold", letterSpacing: 0.8, textTransform: "uppercase" },
  referenceAlgorithmValue: { fontSize: 22, fontFamily: "Inter_800ExtraBold", marginTop: 4 },
  referenceAlgorithmDetail: { color: "#cbd5e1", fontSize: 12, fontFamily: "Inter_600SemiBold", lineHeight: 17, marginTop: 4 },
  referenceAlgorithmAction: { color: "#a78bfa", fontSize: 11, fontFamily: "Inter_800ExtraBold", marginTop: 8 },
  referenceAlgoDots: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 7, marginTop: 10 },
  referenceAlgoDot: { width: 7, height: 7, borderRadius: 999, backgroundColor: "rgba(148,163,184,0.34)" },
  referenceAlgoDotActive: { width: 24, backgroundColor: "#60a5fa", shadowColor: "#60a5fa", shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.7, shadowRadius: 8, elevation: 4 },
  referenceInsightCard: { flex: 1.45, minHeight: 130, borderRadius: 24, borderWidth: 1, borderColor: "rgba(168,85,247,0.22)", backgroundColor: "rgba(15,23,42,0.72)", padding: 16, flexDirection: "row", alignItems: "center", gap: 12, shadowColor: "#8b5cf6", shadowOffset: { width: 0, height: 14 }, shadowOpacity: 0.22, shadowRadius: 26 },
  referenceInsightIcon: { width: 40, height: 40, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(124,58,237,0.28)" },
  referenceInsightTitle: { color: "#d8b4fe", fontSize: 14, fontFamily: "Inter_800ExtraBold", marginBottom: 6 },
  referenceInsightText: { color: "#f8fafc", fontSize: 13, fontFamily: "Inter_600SemiBold", lineHeight: 18 },
  referenceInsightLink: { color: "#c084fc", fontSize: 12, fontFamily: "Inter_800ExtraBold", marginTop: 8 },
  referenceMiniChart: { flexDirection: "row", alignItems: "flex-end", gap: 4, height: 82, width: 90 },
  referenceMiniBar: { width: 6, borderRadius: 5, backgroundColor: "#8b5cf6", shadowColor: "#a855f7", shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.7, shadowRadius: 10 },
  referenceQuickPanel: { flex: 1, borderRadius: 24, borderWidth: 1, borderColor: "rgba(148,163,184,0.12)", backgroundColor: "rgba(2,6,23,0.50)", padding: 14 },
  referenceQuickTitle: { color: "#f8fafc", fontSize: 14, fontFamily: "Inter_800ExtraBold", marginBottom: 10 },
  referenceQuickGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  referenceQuickTile: { width: "48%", minHeight: 82, borderRadius: 18, borderWidth: 1, borderColor: "rgba(148,163,184,0.12)", backgroundColor: "rgba(15,23,42,0.72)", alignItems: "center", justifyContent: "center", gap: 8, padding: 10 },
  referenceQuickText: { color: "#e2e8f0", textAlign: "center", fontSize: 11, lineHeight: 14, fontFamily: "Inter_800ExtraBold" },

  // Hero
  heroCard:          { borderRadius: 36, padding: 24, marginBottom: 14, minHeight: 255, borderWidth: 1, borderColor: "rgba(34,211,238,0.26)", shadowColor: "#7c3aed", shadowOffset: { width: 0, height: 20 }, shadowOpacity: 0.46, shadowRadius: 34, elevation: 16 },
  heroGlowTop:       { position: "absolute", top: -60, right: -40, width: 230, height: 230, borderRadius: 115, backgroundColor: "rgba(34,211,238,0.18)" },
  heroGlowBottom:    { position: "absolute", bottom: -80, left: -40, width: 190, height: 190, borderRadius: 95, backgroundColor: "rgba(124,58,237,0.18)" },
  heroSignalLine:    { position: "absolute", left: 18, right: 18, bottom: 72, height: 1, backgroundColor: "rgba(125,211,252,0.18)" },
  heroTopRow:        { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 18 },
  heroStatusBadge:   { flexDirection: "row", alignItems: "center", gap: 7, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  heroStatusDot:     { width: 7, height: 7, borderRadius: 4 },
  heroStatusText:    { fontSize: 11, fontFamily: "Inter_800ExtraBold", textTransform: "uppercase", letterSpacing: 0.8 },
  heroLabel:         { fontSize: 12, fontFamily: "Inter_800ExtraBold", color: "rgba(219,234,254,0.82)", textTransform: "uppercase", letterSpacing: 1.3, marginBottom: 3 },
  heroValue:         { fontSize: 58, fontFamily: "Inter_800ExtraBold", color: "#fff", lineHeight: 63, letterSpacing: -2.2 },
  heroSubtitle:      { fontSize: 12, fontFamily: "Inter_500Medium", color: "rgba(203,213,225,0.75)", marginTop: 4, maxWidth: 270, lineHeight: 17 },
  heroMetrics:       { flexDirection: "row", marginTop: 18, paddingTop: 17, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.16)" },
  heroMetric:        { flex: 1 },
  heroMetricLabel:   { fontSize: 11, fontFamily: "Inter_500Medium", color: "rgba(255,255,255,0.7)", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 3 },
  heroMetricValue:   { fontSize: 15, fontFamily: "Inter_800ExtraBold" },
  heroMetricDivider: { width: 1, backgroundColor: "rgba(255,255,255,0.2)", marginHorizontal: 14 },
  heroProgress:      { marginTop: 14 },
  heroProgressTrack: { height: 5, borderRadius: 3, overflow: "hidden" },
  heroProgressFill:  { height: 5, borderRadius: 3 },
  heroProgressLabel: { fontSize: 11, fontFamily: "Inter_500Medium", color: "rgba(255,255,255,0.75)", marginTop: 5 },
  heroFlipHint:      { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 6, backgroundColor: "rgba(15,23,42,0.42)" },
  heroFlipHintText:  { fontSize: 10, fontFamily: "Inter_800ExtraBold", color: "rgba(255,255,255,0.72)", textTransform: "uppercase", letterSpacing: 0.7 },
  heroGoalRow:       { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 },
  heroGoalName:      { fontSize: 11, fontFamily: "Inter_500Medium", color: "rgba(255,255,255,0.85)", width: 90 },
  heroGoalTrack:     { flex: 1, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.2)", overflow: "hidden" },
  heroGoalFill:      { height: 4, borderRadius: 2, backgroundColor: "#6ee7b7" },
  heroGoalPct:       { fontSize: 10, fontFamily: "Inter_700Bold", color: "rgba(255,255,255,0.75)", width: 30, textAlign: "right" },
  algoSuiteCard: { borderRadius: 30, padding: 15, marginBottom: 12, backgroundColor: "rgba(2,6,23,0.72)", borderWidth: 1, borderColor: "rgba(168,85,247,0.24)", shadowColor: "#38bdf8", shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.22, shadowRadius: 26, elevation: 9 },
  algoSuiteHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  algoScoreRing: { width: 68, height: 68, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(124,58,237,0.24)", borderWidth: 1, borderColor: "rgba(34,211,238,0.42)" },
  algoScoreValue: { color: "#f8fafc", fontSize: 24, fontFamily: "Inter_800ExtraBold", lineHeight: 27 },
  algoScoreLabel: { color: "#93c5fd", fontSize: 9, fontFamily: "Inter_800ExtraBold", letterSpacing: 1 },
  algoEyebrow: { color: "#38bdf8", fontSize: 10, fontFamily: "Inter_800ExtraBold", letterSpacing: 1.1, marginBottom: 2 },
  algoTitle: { color: "#f8fafc", fontSize: 17, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.3 },
  algoDesc: { color: "#94a3b8", fontSize: 12, fontFamily: "Inter_500Medium", lineHeight: 17, marginTop: 3 },
  algoGradeBadge: { width: 42, height: 42, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(34,197,94,0.16)", borderWidth: 1, borderColor: "rgba(74,222,128,0.28)" },
  algoGradeText: { color: "#86efac", fontSize: 19, fontFamily: "Inter_800ExtraBold" },
  algoMetricRow: { flexDirection: "row", gap: 8, marginTop: 13 },
  algoMiniMetric: { flex: 1, borderRadius: 16, padding: 10, backgroundColor: "rgba(15,23,42,0.72)", borderWidth: 1, borderColor: "rgba(148,163,184,0.12)" },
  algoMiniLabel: { color: "#94a3b8", fontSize: 9, fontFamily: "Inter_800ExtraBold", letterSpacing: 0.7, textTransform: "uppercase", marginBottom: 4 },
  algoMiniValue: { color: "#f8fafc", fontSize: 17, fontFamily: "Inter_800ExtraBold" },
  algoMiniHint: { color: "#64748b", fontSize: 9, fontFamily: "Inter_700Bold", marginTop: 2 },
  algoActionButton: { marginTop: 12, minHeight: 44, borderRadius: 16, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "rgba(37,99,235,0.28)", borderWidth: 1, borderColor: "rgba(147,197,253,0.24)" },
  algoActionText: { color: "#dbeafe", fontSize: 12, fontFamily: "Inter_800ExtraBold", textAlign: "center", flexShrink: 1 },
  algoInsightStack: { gap: 8, marginTop: 12 },
  algoInsightRow: { flexDirection: "row", alignItems: "center", gap: 9, borderRadius: 16, padding: 10, backgroundColor: "rgba(15,23,42,0.56)", borderWidth: 1, borderColor: "rgba(148,163,184,0.1)" },
  algoInsightDot: { width: 8, height: 8, borderRadius: 4 },
  algoInsightTitle: { color: "#e5edf8", fontSize: 13, fontFamily: "Inter_800ExtraBold" },
  algoInsightDetail: { color: "#94a3b8", fontSize: 11, fontFamily: "Inter_500Medium", lineHeight: 15, marginTop: 2 },
  algoInsightTag: { maxWidth: 90, textAlign: "right", fontSize: 9, fontFamily: "Inter_800ExtraBold", textTransform: "uppercase", letterSpacing: 0.5 },
  commandDeck:       { gap: 10, marginBottom: 12 },
  primaryCommandCard: { borderRadius: 26, overflow: "hidden", borderWidth: 1, borderColor: "rgba(147,197,253,0.28)", shadowColor: "#7c3aed", shadowOffset: { width: 0, height: 14 }, shadowOpacity: 0.26, shadowRadius: 24, elevation: 9 },
  primaryCommandGradient: { minHeight: 112, padding: 16, flexDirection: "row", alignItems: "center", gap: 12 },
  primaryCommandIcon: { width: 44, height: 44, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(15,23,42,0.36)", borderWidth: 1, borderColor: "rgba(219,234,254,0.28)" },
  primaryCommandEyebrow: { color: "rgba(219,234,254,0.75)", fontSize: 10, fontFamily: "Inter_800ExtraBold", letterSpacing: 1.2, marginBottom: 3 },
  primaryCommandTitle: { color: "#ffffff", fontSize: 17, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.3 },
  primaryCommandSub: { color: "rgba(226,232,240,0.78)", fontSize: 12, fontFamily: "Inter_500Medium", lineHeight: 17, marginTop: 4 },
  quickCommandRow: { flexDirection: "row", gap: 9 },
  quickCommand: { flex: 1, minHeight: 82, borderRadius: 22, padding: 11, justifyContent: "space-between", backgroundColor: "rgba(15,23,42,0.68)", borderWidth: 1, borderColor: "rgba(148,163,184,0.16)" },
  quickCommandIcon: { width: 34, height: 34, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  quickCommandText: { color: "#e5edf8", fontSize: 12, fontFamily: "Inter_800ExtraBold" },
  flowScoreSheetHeader: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 14 },
  flowScoreColumns: { flexDirection: "row", gap: 10, marginTop: 6 },
  flowScoreColumn: { flex: 1, borderRadius: 16, padding: 12 },
  flowScoreColumnTitle: { fontSize: 11, fontFamily: "Inter_800ExtraBold", letterSpacing: 0.7, textTransform: "uppercase", marginBottom: 7 },
  flowScoreFactor: { fontSize: 12, fontFamily: "Inter_600SemiBold", lineHeight: 17 },
  flowScoreNextMove: { borderWidth: 1, borderRadius: 16, padding: 12, marginTop: 10 },
  safeCushionHero: { borderWidth: 1, borderRadius: 20, padding: 14, marginTop: -2, marginBottom: 8, gap: 8 },
  safeCushionHeroAmount: { fontSize: 34, fontFamily: "Inter_800ExtraBold", letterSpacing: -1 },
  safeCushionHeroCopy: { fontSize: 13, fontFamily: "Inter_600SemiBold", lineHeight: 18 },
  flowScoreBreakdown: { marginTop: 8 },
  flowScoreBreakdownRow: { borderTopWidth: 1, paddingVertical: 9, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  flowScoreBreakdownLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  flowScoreBreakdownValue: { fontSize: 13, fontFamily: "Inter_800ExtraBold" },
  flowScoreFloButton: { minHeight: 48, borderRadius: 16, marginTop: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  flowScoreFloText: { fontSize: 14, fontFamily: "Inter_800ExtraBold" },
  moneyRadarCard: { borderRadius: 26, padding: 15, marginBottom: 14, backgroundColor: "rgba(15,23,42,0.82)", borderWidth: 1, borderColor: "rgba(148,163,184,0.16)", shadowColor: "#000", shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.3, shadowRadius: 22, elevation: 8 },
  moneyRadarHeader: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginBottom: 12 },
  moneyRadarEyebrow: { color: "#60a5fa", fontSize: 10, fontFamily: "Inter_800ExtraBold", letterSpacing: 1.1, marginBottom: 4 },
  moneyRadarTitle: { color: "#cbd5e1", fontSize: 12, fontFamily: "Inter_600SemiBold", lineHeight: 17 },
  moneyRadarBadge: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 6 },
  moneyRadarBadgeText: { fontSize: 10, fontFamily: "Inter_800ExtraBold", letterSpacing: 0.8 },
  moneyRadarGrid: { flexDirection: "row", flexWrap: "wrap", gap: 9 },
  radarMetric: { flexBasis: "47%", flexGrow: 1, minHeight: 94, borderRadius: 20, padding: 12, backgroundColor: "rgba(2,6,23,0.48)", borderWidth: 1, borderColor: "rgba(148,163,184,0.12)" },
  radarMetricIcon: { width: 31, height: 31, borderRadius: 11, alignItems: "center", justifyContent: "center", marginBottom: 10 },
  radarMetricValue: { fontSize: 22, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.4 },
  radarMetricLabel: { color: "#94a3b8", fontSize: 11, fontFamily: "Inter_800ExtraBold", textTransform: "uppercase", letterSpacing: 0.8, marginTop: 2 },
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
  decisionHubEyebrow: { fontSize: 10, fontFamily: "Inter_800ExtraBold", textTransform: "uppercase", letterSpacing: 1.1, marginBottom: 3, color: "#60a5fa" },
  decisionHubTitle: { fontSize: 15, fontFamily: "Inter_700Bold" },
  decisionHubDesc: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17, marginTop: 2 },
  decisionHubStats: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  decisionHubStat: { fontSize: 11, fontFamily: "Inter_700Bold" },
  monthlyReviewCard: { borderWidth: 1, borderColor: "rgba(148,163,184,0.16)", backgroundColor: "rgba(15,23,42,0.78)", borderRadius: 26, padding: 15, marginBottom: 14, shadowColor: "#000", shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.26, shadowRadius: 22, elevation: 8 },
  monthlyReviewHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  monthlyReviewIcon: { width: 40, height: 40, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(56,189,248,0.14)", borderWidth: 1, borderColor: "rgba(56,189,248,0.24)" },
  monthlyReviewTitle: { fontSize: 16, fontFamily: "Inter_800ExtraBold", color: "#f8fafc" },
  monthlyReviewDesc: { fontSize: 12, fontFamily: "Inter_500Medium", lineHeight: 17, marginTop: 2, color: "#94a3b8" },
  monthlyReviewAsk: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: "rgba(37,99,235,0.18)", borderWidth: 1, borderColor: "rgba(96,165,250,0.22)" },
  monthlyReviewAskText: { fontSize: 11, fontFamily: "Inter_800ExtraBold", color: "#60a5fa" },
  monthlyReviewGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  monthlyReviewMetric: { flexBasis: "48%", flexGrow: 1, borderRadius: 16, padding: 11, backgroundColor: "rgba(2,6,23,0.45)", borderWidth: 1, borderColor: "rgba(148,163,184,0.12)" },
  monthlyReviewLabel: { fontSize: 10, fontFamily: "Inter_800ExtraBold", textTransform: "uppercase", marginBottom: 4, color: "#94a3b8", letterSpacing: 0.7 },
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
  sectionTitle:  { fontSize: 18, fontFamily: "Inter_800ExtraBold", marginBottom: 10, marginTop: 8, letterSpacing: -0.2, color: "#f8fafc" },
  upcomingCard:  { marginBottom: 16, overflow: "hidden", borderWidth: 1, borderColor: "rgba(148,163,184,0.16)", borderRadius: 24, backgroundColor: "rgba(15,23,42,0.78)" },
  upcomingRow:   { flexDirection: "row", alignItems: "center", padding: 13, gap: 11, borderTopColor: "rgba(148,163,184,0.13)" },
  upcomingDot:   { width: 38, height: 38, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  upcomingInfo:  { flex: 1 },
  upcomingName:  { fontSize: 14, fontFamily: "Inter_700Bold", color: "#e5edf8" },
  upcomingDate:  { fontSize: 12, fontFamily: "Inter_500Medium", marginTop: 1, color: "#94a3b8" },
  upcomingAmt:   { fontSize: 15, fontFamily: "Inter_800ExtraBold", color: "#f8fafc" },

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
  statsPillRow:  { flexDirection: "row", gap: 8, marginBottom: 14 },
  statPill:      { flex: 1, borderWidth: 1, borderRadius: 18, paddingVertical: 13, paddingHorizontal: 6, alignItems: "center", justifyContent: "center" },
  statPillIcon:  { width: 28, height: 28, borderRadius: 10, alignItems: "center", justifyContent: "center", marginBottom: 7 },
  statPillValue: { fontSize: 19, fontFamily: "Inter_800ExtraBold", marginBottom: 4 },
  statPillLabel: { fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 0.35 },
  statDebtRow:   { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: 1, borderRadius: 18, paddingVertical: 15, paddingHorizontal: 16, marginBottom: 14 },
  statDebtLeft:  { flexDirection: "row", alignItems: "center", gap: 12 },
  statDebtIcon:  { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  statDebtValue: { fontSize: 28, fontFamily: "Inter_800ExtraBold", marginTop: 2, letterSpacing: -0.6 },
  commandGrid: { flexDirection: "row", gap: 8, marginBottom: 14 },
  commandCard: { flex: 1, borderWidth: 1, borderRadius: 18, padding: 11, minHeight: 104 },
  commandIcon: { width: 34, height: 34, borderRadius: 12, alignItems: "center", justifyContent: "center", marginBottom: 10 },
  commandLabel: { fontSize: 13, fontFamily: "Inter_800ExtraBold" },
  commandSub: { fontSize: 10, fontFamily: "Inter_500Medium", lineHeight: 13, marginTop: 3 },

  // Goals
  goalsHeader:        { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10, marginTop: 8, gap: 8 },
  goalHeaderActions:  { flexDirection: "row", alignItems: "center", gap: 6 },
  addGoalBtn:         { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 20 },
  addGoalText:        { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  goalsEmpty:         { padding: 24, alignItems: "center", marginBottom: 16 },
  goalsEmptyText:     { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 10, marginBottom: 16, lineHeight: 20 },
  goalsEmptyBtn:      { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10 },
  goalsEmptyBtnText:  { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  goalCard:           { marginBottom: 12, padding: 15, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 3, elevation: 2 },
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

