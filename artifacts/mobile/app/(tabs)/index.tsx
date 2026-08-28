import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert, Animated, Image, Keyboard, Linking, Modal, PanResponder, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Defs, LinearGradient as SvgLinearGradient, Stop } from "react-native-svg";

import { AddBillModal } from "@/components/AddBillModal";
import { AppText } from "@/components/AppText";
import { DashboardCustomizer } from "@/components/DashboardCustomizer";
import { DashboardSnapshotStage } from "@/components/DashboardSnapshotStage";
import { DataFreshnessLabel } from "@/components/DataFreshnessLabel";
import { DashboardUtilityWidgets } from "@/components/DashboardUtilityWidgets";
import { FlowmentumHandoffModal } from "@/components/FlowmentumHandoffModal";
import { GoalModal } from "@/components/GoalModal";
import { HouseholdSwitcher } from "@/components/HouseholdSwitcher";
import { MonthlyDebtCheckInModal } from "@/components/MonthlyDebtCheckInModal";
import { PremiumBackdrop } from "@/components/PremiumBackdrop";
import { SavingsAccountNameModal } from "@/components/SavingsAccountNameModal";
import { StabilityPathCard } from "@/components/StabilityPathCard";

import colors from "@/constants/colors";
import type { Bill, Goal, PendingBankTransaction } from "@/context/BudgetContext";
import { useBudget } from "@/context/BudgetContext";
import { useAuth } from "@/context/AuthContext";
import { useAppDiscovery } from "@/context/AppDiscoveryContext";
import { useDashboardFinancialSnapshot } from "@/context/DashboardFinancialSnapshotContext";
import { useMembership } from "@/context/MembershipContext";
import { useColors } from "@/hooks/useColors";
import { useDesktopExperience } from "@/hooks/useDesktopExperience";
import { useBackDismiss } from "@/hooks/useBackDismiss";
import { useDashboardLayoutPreferences } from "@/hooks/useDashboardLayoutPreferences";
import { useSetupReadiness } from "@/hooks/useSetupReadiness";
import { applyCategoryBudgetMove, buildZeroBudgetSummary } from "@/lib/categoryPlanning";
import { saveCategoryBudgets as saveCategoryBudgetsRemote } from "@/lib/categoryBudgetStore";
import type { DashboardSavingsAccount } from "@/lib/dashboardFinancialModel";
import {
  isDashboardFinancialSnapshotReadyForScope,
  type DashboardFinancialSnapshot,
} from "@/lib/dashboardFinancialSnapshot";
import { isBillEligibleForUpcomingPlan } from "@/lib/billEligibility";
import { compactDateLabel } from "@/lib/dateLabels";
import {
  FLOWMENTUM_URL,
  flowmentumPreviewStorageKey,
  flowmentumSeenStorageKey,
  isFlowmentumHandoffEligible,
  shouldShowFlowmentumHandoff,
} from "@/lib/flowmentumHandoff";
import { transactionCategoryParts } from "@/lib/reviewCenter";
import type { AlgorithmInsight } from "@/lib/algorithmSuite";
import { unplannedPendingExpenses } from "@/lib/plaidActivity";
import { buildFlowGuideRouteParams } from "@/lib/flowledgerGuide";

const MONTH_FULL  = ["January","February","March","April","May","June","July","August","September","October","November","December"];

const CAT_COLORS: Record<string, string> = {
  Housing: "#0f9b8e", Utilities: "#f0b429", Insurance: "#6366f1",
  Transportation: "#ec4899", Food: "#f97316", Entertainment: "#8b5cf6",
  Health: "#ef4444", Education: "#3b82f6", Savings: "#22c55e", Debt: "#e11d48", Other: "#94a3b8",
};

const FLOWLEDGER_LOGO = require("@/assets/brand/flowledger-dashboard-logo.jpg");
const FLO_LOGO = require("@/assets/brand/flo-logo.jpg");
const DesktopDashboard = React.lazy(() =>
  import("@/components/desktop/DesktopDashboard").then((module) => ({
    default: module.DesktopDashboard,
  })),
);

function pendingInsightStorageKey(userId: string, householdId: string): string {
  return `flowledger:pending-insights:${userId}:${householdId}`;
}

const DASHBOARD_THEMES = {
  dark: {
    screen: "#030712",
    hero: "rgba(2,6,23,0.42)",
    heroBorder: "rgba(148,163,184,0.14)",
    heroShadow: "#22d3ee",
    heroShadowOpacity: 0.24,
    text: "#f8fafc",
    mutedText: "#cbd5e1",
    subtleText: "#94a3b8",
    amount: "#ffffff",
    purpleText: "#c4b5fd",
    purpleSurface: "rgba(124,58,237,0.18)",
    purpleBorder: "rgba(196,181,253,0.28)",
    goalSurface: "rgba(15,23,42,0.56)",
    goalBorder: "rgba(148,163,184,0.12)",
    gaugeTrack: "rgba(148,163,184,0.18)",
    gaugeFill: "rgba(2,6,23,0.22)",
    score: "#ffffff",
    scoreLabel: "#cbd5e1",
    scoreStatus: "#4ade80",
    savings: "#6ee7b7",
  },
  light: {
    screen: "#f8fafc",
    hero: "rgba(255,255,255,0.90)",
    heroBorder: "rgba(148,163,184,0.34)",
    heroShadow: "#64748b",
    heroShadowOpacity: 0.14,
    text: "#0f172a",
    mutedText: "#334155",
    subtleText: "#64748b",
    amount: "#0f172a",
    purpleText: "#6d28d9",
    purpleSurface: "rgba(124,58,237,0.10)",
    purpleBorder: "rgba(109,40,217,0.24)",
    goalSurface: "rgba(241,245,249,0.96)",
    goalBorder: "rgba(148,163,184,0.28)",
    gaugeTrack: "rgba(100,116,139,0.20)",
    gaugeFill: "rgba(241,245,249,0.92)",
    score: "#0f172a",
    scoreLabel: "#475569",
    scoreStatus: "#15803d",
    savings: "#15803d",
  },
} as const;

type DashboardTheme = (typeof DASHBOARD_THEMES)[keyof typeof DASHBOARD_THEMES];

function algoToneColor(tone: AlgorithmInsight["tone"]) {
  if (tone === "safe") return "#22c55e";
  if (tone === "watch") return "#f59e0b";
  if (tone === "risk") return "#fb7185";
  return "#38bdf8";
}

function formatDashboardCurrency(value: number | null): string {
  if (value === null) return "Balance unavailable";
  const safeValue = Number.isFinite(value) ? value : 0;
  return safeValue.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function FlowScoreGauge({ score, theme }: { score: number; theme: DashboardTheme }) {
  const size = 112;
  const stroke = 8;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, score));
  const dash = (clamped / 100) * circumference;

  return (
    <View style={styles.referenceGaugeWrap}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={styles.referenceGaugeSvg}>
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
          stroke={theme.gaugeTrack}
          strokeWidth={stroke}
          fill={theme.gaugeFill}
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
        <AppText tone="number" style={[styles.referenceGaugeScore, { color: theme.score }]}>{score}</AppText>
        <AppText tone="label" style={[styles.referenceGaugeLabel, { color: theme.scoreLabel }]}>Flow Score</AppText>
      </View>
    </View>
  );
}

export default function DashboardScreen() {
  const showDesktopDashboard = useDesktopExperience();

  if (!showDesktopDashboard) return <MobileDashboardScreen />;

  return (
    <React.Suspense
      fallback={<DashboardSnapshotStage failed={false} />}
    >
      <DesktopDashboard />
    </React.Suspense>
  );
}

function MobileDashboardScreen() {
  const { user } = useAuth();
  const { activeHousehold } = useBudget();
  const {
    acknowledgeDashboardSnapshotContentMounted,
    dashboardFinancialSnapshot,
    retryDashboardFinancialSnapshot,
  } = useDashboardFinancialSnapshot();
  const householdId = activeHousehold?.householdId ?? null;
  const budgetId = activeHousehold?.budgetId ?? null;

  if (isDashboardFinancialSnapshotReadyForScope(
    dashboardFinancialSnapshot,
    user?.id,
    householdId,
    budgetId,
  )) {
    return (
      <MobileDashboardContent
        acknowledgeMounted={acknowledgeDashboardSnapshotContentMounted}
        dashboardSnapshot={dashboardFinancialSnapshot.value}
        snapshotKey={dashboardFinancialSnapshot.key}
      />
    );
  }

  const exactScopeError = dashboardFinancialSnapshot?.status === "error"
    && dashboardFinancialSnapshot.identity.userId === user?.id
    && dashboardFinancialSnapshot.identity.householdId === householdId
    && dashboardFinancialSnapshot.identity.budgetId === budgetId;
  return (
    <DashboardSnapshotStage
      acknowledgeMounted={exactScopeError
        ? acknowledgeDashboardSnapshotContentMounted
        : undefined}
      failed={exactScopeError}
      onRetry={exactScopeError ? retryDashboardFinancialSnapshot : undefined}
      snapshotKey={exactScopeError ? dashboardFinancialSnapshot.key : undefined}
    />
  );
}

function MobileDashboardContent({
  acknowledgeMounted,
  dashboardSnapshot,
  snapshotKey,
}: {
  acknowledgeMounted: (snapshotKey: string) => () => void;
  dashboardSnapshot: DashboardFinancialSnapshot;
  snapshotKey: string;
}) {
  const c = useColors();
  const { openNotifications, unreadNotificationCount } = useAppDiscovery();
  const dashboardTheme = DASHBOARD_THEMES[c.mode];
  const heroSurface = Platform.OS === "web"
    ? dashboardTheme.hero
    : c.isDark
      ? "#050816"
      : "#ffffff";
  const [isFocused, setIsFocused] = useState(true);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const routeParams = useLocalSearchParams<{ add?: string; action?: string }>();
  const { width: viewportWidth } = useWindowDimensions();
  const compactDashboardHeader = viewportWidth < 430;
  const isCommandWide = Platform.OS === "web" && viewportWidth >= 900;
  const isIosWeb = Platform.OS === "web" && typeof navigator !== "undefined" && /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const dashboardTopPadding = Platform.OS === "web" ? (isIosWeb ? 58 : 12) : insets.top + 10;
  const dashboardBottomPadding = Platform.OS === "web" ? (isIosWeb ? 108 : 104) : insets.bottom + 104;
  const { user } = useAuth();
  const { isAdmin } = useMembership();
  const {
    getPaidAmount, getBillMonthlyTotal, getMonthlyBills,
    addGoal, updateGoal, deleteGoal,
    addBill, getDailyBalances, getTransactionsForMonth, settings,
    accounts, updateAccount, updateConnectedBankAccountDisplayName, forecastConfidence,
    categories, activeHousehold, canEditHousehold, demoMode,
  } = useBudget();
  const {
    model: dashboardModel,
    reviewCenterCount,
    todayDecisions,
    postedIncome,
  } = dashboardSnapshot;
  const { cashFlow, currentMonth } = dashboardModel;
  const currentYear = Number(dashboardModel.todayIso.slice(0, 4));
  const now = new Date();
  const { readiness: setupReadiness } = useSetupReadiness();
  const categoryBudgetScope = useMemo(() => ({
    userId: user?.id,
    householdId: activeHousehold?.householdId,
    budgetId: activeHousehold?.budgetId,
  }), [activeHousehold?.budgetId, activeHousehold?.householdId, user?.id]);
  const flowmentumHouseholdId = activeHousehold?.householdId ?? activeHousehold?.budgetId ?? "personal";
  const flowmentumSeenKey = user?.id ? flowmentumSeenStorageKey(user.id, flowmentumHouseholdId) : null;
  const flowmentumPreviewKey = user?.id ? flowmentumPreviewStorageKey(user.id, flowmentumHouseholdId) : null;
  const pendingInsightKey = user?.id ? pendingInsightStorageKey(user.id, flowmentumHouseholdId) : null;

  const [goalModalVisible, setGoalModalVisible]     = useState(false);
  const [editGoal, setEditGoal]                     = useState<Goal | null>(null);
  const [savingsAccountNameTarget, setSavingsAccountNameTarget] = useState<DashboardSavingsAccount | null>(null);
  const [actionModalVisible, setActionModalVisible] = useState(false);
  const [addBillVisible, setAddBillVisible]         = useState(false);
  const [addBillForceDebt, setAddBillForceDebt]     = useState(false);
  const [negCalendarVisible, setNegCalendarVisible]  = useState(false);
  const [categoryBudgetModalVisible, setCategoryBudgetModalVisible] = useState(false);
  const [categoryBudgets, setCategoryBudgets] = useState<Record<string, number>>(
    () => ({ ...dashboardSnapshot.categoryBudgets }),
  );
  const [categoryBudgetDrafts, setCategoryBudgetDrafts] = useState<Record<string, string>>({});
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [moveMoneyVisible, setMoveMoneyVisible] = useState(false);
  const [moveTargetCategory, setMoveTargetCategory] = useState<string | null>(null);
  const [moveSourceCategory, setMoveSourceCategory] = useState("");
  const [moveAmount, setMoveAmount] = useState("");
  const [moveError, setMoveError] = useState("");
  const [flowScoreVisible, setFlowScoreVisible] = useState(false);
  const [safeCushionVisible, setSafeCushionVisible] = useState(false);
  const [flowmentumVisible, setFlowmentumVisible] = useState(false);
  const [flowmentumAdminPreview, setFlowmentumAdminPreview] = useState(false);
  const [pendingFloCharge, setPendingFloCharge] = useState<PendingBankTransaction | null>(null);
  const [customizerOpen, setCustomizerOpen] = useState(false);
  const { layout: dashboardLayout, updateLayout: updateDashboardLayout, resetLayout: resetDashboardLayout } = useDashboardLayoutPreferences();
  const checkedPendingSignatureRef = useRef("");

  useEffect(
    () => acknowledgeMounted(snapshotKey),
    [acknowledgeMounted, snapshotKey],
  );
  useEffect(() => {
    setCategoryBudgets({ ...dashboardSnapshot.categoryBudgets });
  }, [dashboardSnapshot.categoryBudgets]);
  const flowScoreSwipeResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => gesture.dy > 10 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
    onPanResponderRelease: (_event, gesture) => {
      if (gesture.dy > 64 || gesture.vy > 0.75) setFlowScoreVisible(false);
    },
  }), []);

  useBackDismiss(actionModalVisible, () => setActionModalVisible(false));
  useBackDismiss(negCalendarVisible, () => setNegCalendarVisible(false));
  useBackDismiss(categoryBudgetModalVisible, () => setCategoryBudgetModalVisible(false));
  useBackDismiss(Boolean(selectedCategory), () => setSelectedCategory(null));
  useBackDismiss(moveMoneyVisible, () => setMoveMoneyVisible(false));
  useBackDismiss(flowScoreVisible, () => setFlowScoreVisible(false));
  useBackDismiss(safeCushionVisible, () => setSafeCushionVisible(false));
  useEffect(() => {
    const requestedAdd = Array.isArray(routeParams.add)
      ? routeParams.add[0]
      : routeParams.add;
    const requestedAction = Array.isArray(routeParams.action)
      ? routeParams.action[0]
      : routeParams.action;
    if (requestedAdd !== "1") return;
    if (requestedAction === "bill" || requestedAction === "debt") {
      setAddBillForceDebt(requestedAction === "debt");
      setAddBillVisible(true);
      router.setParams({ add: "", action: "" });
      return;
    }
    if (requestedAction === "goal") {
      setEditGoal(null);
      setGoalModalVisible(true);
      router.setParams({ add: "", action: "" });
      return;
    }
    if (requestedAction === "income") {
      router.replace({ pathname: "/(tabs)/more", params: { section: "money", add: "income" } } as any);
      return;
    }
    setActionModalVisible(true);
    router.setParams({ add: "", action: "" });
  }, [routeParams.action, routeParams.add, router]);
  const dismissFlowmentum = useCallback(() => {
    setFlowmentumVisible(false);
    if (!flowmentumAdminPreview && flowmentumSeenKey) {
      void AsyncStorage.setItem(flowmentumSeenKey, new Date().toISOString()).catch(() => undefined);
    }
    setFlowmentumAdminPreview(false);
  }, [flowmentumAdminPreview, flowmentumSeenKey]);
  useBackDismiss(flowmentumVisible, dismissFlowmentum);
  const exploreFlowmentum = useCallback(() => {
    dismissFlowmentum();
    void Linking.openURL(FLOWMENTUM_URL).catch(() => {
      Alert.alert("Could not open the page", "Visit flowmentum-algo.com in your browser.");
    });
  }, [dismissFlowmentum]);

  useFocusEffect(useCallback(() => {
    setIsFocused(true);
    return () => setIsFocused(false);
  }, []));

  // ── Hero card flip ──────────────────────────────────────────────────────────
  const flipAnim   = useRef(new Animated.Value(0)).current;
  const [flipped, setFlipped] = useState(false);

  const doFlip = () => {
    const toValue = flipped ? 0 : 1;
    Animated.spring(flipAnim, { toValue, friction: 8, tension: 10, useNativeDriver: true }).start();
    setFlipped(f => !f);
  };

  const frontRotate = flipAnim.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "180deg"] });
  const backRotate  = flipAnim.interpolate({ inputRange: [0, 1], outputRange: ["180deg", "360deg"] });

  const timeGreeting = demoMode
    ? "Good morning"
    : now.getHours() < 5
    ? "Good night"
    : now.getHours() < 12
    ? "Good morning"
    : now.getHours() < 17
    ? "Good afternoon"
    : "Good evening";

  // ── 12-month negative schedule ─────────────────────────────────────────────
  type OutlookMonth = { month: number; year: number; label: string; firstNegDay: number | null; lowestBalance: number };
  const [yearNegSchedule, setYearNegSchedule] = useState<OutlookMonth[]>([]);

  useEffect(() => {
    // This full-horizon projection is user-requested on every responsive
    // MobileDashboardContent layout. Even one cold month can be expensive, so
    // never start it merely because a 900-1023px browser viewport is "wide".
    if (!isFocused || !negCalendarVisible) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let i = 0;
    const nextSchedule: OutlookMonth[] = [];
    setYearNegSchedule([]);

    const calculateNextMonth = () => {
      if (cancelled || i >= settings.forecast_horizon_months) return;
      const m = (currentMonth + i) % 12;
      const y = currentYear + Math.floor((currentMonth + i) / 12);
      const balances = getDailyBalances(m, y);
      const negEntry = balances.find(db => db.balance < 0);
      const lowest = balances.reduce((min, db) => db.balance < min ? db.balance : min, Infinity);
      const next: OutlookMonth = {
        month: m, year: y,
        label: `${MONTH_FULL[m]} ${y}`,
        firstNegDay: negEntry?.day ?? null,
        lowestBalance: lowest === Infinity ? 0 : lowest,
      };
      nextSchedule.push(next);
      i += 1;
      if (i < settings.forecast_horizon_months) {
        timer = setTimeout(calculateNextMonth, 0);
        return;
      }
      if (!cancelled) setYearNegSchedule(nextSchedule);
    };

    timer = setTimeout(calculateNextMonth, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [getDailyBalances, currentMonth, currentYear, isFocused, negCalendarVisible, settings.forecast_horizon_months]);

  // First month (across all 12) that needs added breathing room
  const firstYearNegEntry = yearNegSchedule.find(e => e.firstNegDay !== null) ?? null;
  const outlookReady = yearNegSchedule.length >= settings.forecast_horizon_months;

  const { categoryPlan } = dashboardModel;

  const categoryDetail = useMemo(() => {
    if (!selectedCategory) return null;
    const row = categoryPlan.find(item => item.category === selectedCategory);
    if (!row) return null;

    const categoryBills = getMonthlyBills(currentMonth, currentYear)
      .filter(isBillEligibleForUpcomingPlan)
      .filter(bill => (bill.is_debt ? "Debt" : bill.category || "Other") === selectedCategory)
      .map(bill => ({
        id: bill.id,
        name: bill.name,
        amount: getBillMonthlyTotal(bill, currentMonth, currentYear),
        paid: getPaidAmount(bill.id, currentMonth, currentYear),
        dueDay: bill.due_day,
      }))
      .sort((left, right) => left.dueDay - right.dueDay || left.name.localeCompare(right.name));

    const categoryTransactions = getTransactionsForMonth(currentMonth, currentYear)
      .flatMap(transaction => transactionCategoryParts(transaction).map((part, index) => ({
        id: `${transaction.id}:${index}`,
        name: part.label,
        amount: part.amount,
        date: transaction.date,
        category: part.category,
      })))
      .filter(transaction => transaction.category === selectedCategory && transaction.category !== "Income")
      .sort((left, right) => right.date.localeCompare(left.date))
      .map(transaction => ({ id: transaction.id, name: transaction.name || selectedCategory, amount: transaction.amount, date: transaction.date }));

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
  }, [selectedCategory, categoryPlan, categoryBudgets, getMonthlyBills, getBillMonthlyTotal, getPaidAmount, getTransactionsForMonth, currentMonth, currentYear]);

  const budgetEditableCategories = useMemo(() => {
    const names = new Set<string>();
    categories.forEach(category => names.add(category));
    categoryPlan.forEach(row => names.add(row.category));
    return Array.from(names).sort((left, right) => left.localeCompare(right));
  }, [categories, categoryPlan]);

  const moveSourceOptions = useMemo(() => {
    if (!moveTargetCategory) return [];
    return categoryPlan
      .filter(row => row.category !== moveTargetCategory && row.remaining > 0.005)
      .sort((left, right) => right.remaining - left.remaining);
  }, [categoryPlan, moveTargetCategory]);

  const zeroBudgetSummary = buildZeroBudgetSummary(
    settings.zeroBasedBudgetEnabled ? dashboardModel.monthlyIncome : 0,
    categoryPlan,
  );
  const zeroBudgetIncome = zeroBudgetSummary.plannedIncome;
  const zeroBudgetLeftToAssign = zeroBudgetSummary.leftToAssign;
  const persistCategoryBudgets = (next: Record<string, number>) => {
    setCategoryBudgets(next);
    void saveCategoryBudgetsRemote(categoryBudgetScope, currentMonth, currentYear, next).catch(() => undefined);
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
    void saveCategoryBudgetsRemote(categoryBudgetScope, currentMonth, currentYear, {}).catch(() => undefined);
    setCategoryBudgetModalVisible(false);
  };

  const {
    activePendingMatchIds,
    algorithmSuite,
    bankCurrentCheckingBalance,
    checkingPendingTransactions,
    currentGoals,
    pendingCheckingSummary,
    savingsAccountBalance,
    savingsAccounts,
  } = dashboardModel;
  const unplannedCheckingPending = useMemo(
    () => unplannedPendingExpenses(checkingPendingTransactions, activePendingMatchIds),
    [activePendingMatchIds, checkingPendingTransactions],
  );
  // The hero is a bank snapshot. Forecasted balances belong on Monthly only.
  const dashboardCheckingBalance = bankCurrentCheckingBalance;
  const savingsAccountRowsHeight = savingsAccounts.length > 0
    ? savingsAccounts.length * 36 + 8
    : 44;
  const compactSavingsFaceHeight = 92
    + savingsAccountRowsHeight
    + (currentGoals.length === 0
      ? 80
      : Math.min(currentGoals.length, 3) * 38 + (currentGoals.length > 3 ? 14 : 0));
  const heroFrontFaceHeight = isCommandWide ? 260 : 250;
  const heroCardVerticalPadding = isCommandWide ? 60 : 22;
  const heroFrontCardHeight = heroFrontFaceHeight + heroCardVerticalPadding;
  const heroBackCardHeight = Math.max(compactSavingsFaceHeight, heroFrontFaceHeight)
    + heroCardVerticalPadding;

  const saveSavingsAccountName = useCallback(async (account: DashboardSavingsAccount, name: string) => {
    if (account.source === "connected") {
      await updateConnectedBankAccountDisplayName(account.id, name);
      return;
    }
    const manualAccount = accounts.find(item => item.id === account.id && item.account_type === "savings");
    if (!manualAccount) throw new Error("Savings account not found.");
    await updateAccount({ ...manualAccount, name });
  }, [accounts, updateAccount, updateConnectedBankAccountDisplayName]);

  const resetSavingsAccountName = useCallback(async (account: DashboardSavingsAccount) => {
    if (account.source !== "connected") return;
    await updateConnectedBankAccountDisplayName(account.id, null);
  }, [updateConnectedBankAccountDisplayName]);

  // ── Savings summary for back of hero card ──────────────────────────────────
  // ── Affordability check (real calendar projection) ──────────────────────────
  const openAction = (action: string) => {
    setActionModalVisible(false);
    setTimeout(() => {
      if (action === "bill")          setAddBillVisible(true);
      else if (action === "income")   router.push({ pathname: "/(tabs)/more", params: { section: "money", add: "income" } } as any);
      else if (action === "expense")  router.push("/(tabs)/monthly" as any);
      else if (action === "snowball") router.push("/snowball-plan" as any);
      else if (action === "goal")     { setEditGoal(null); setGoalModalVisible(true); }
      else if (action === "buckets")  router.push({ pathname: "/(tabs)/more", params: { section: "review" } } as any);
      else if (action === "afford") {} // handled inline
    }, 250);
  };

  const flowmentumEligible = isFlowmentumHandoffEligible({
    protectedDays: algorithmSuite.stability.protectedDays,
    stage: algorithmSuite.stability.stage,
    status: algorithmSuite.stability.status,
    riskDays: algorithmSuite.stability.riskDays,
    forecastConfidence: forecastConfidence.level,
  });
  useFocusEffect(useCallback(() => {
    if (!flowmentumSeenKey || !flowmentumPreviewKey) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    void AsyncStorage.multiGet([flowmentumSeenKey, flowmentumPreviewKey]).then(values => {
      if (cancelled) return;
      const seen = Boolean(values[0]?.[1]);
      const adminPreview = isAdmin && values[1]?.[1] === "true";
      if (adminPreview) {
        void AsyncStorage.removeItem(flowmentumPreviewKey).catch(() => undefined);
      }
      if (!shouldShowFlowmentumHandoff({ eligible: flowmentumEligible, seen, adminPreview })) return;
      setFlowmentumAdminPreview(adminPreview);
      timer = setTimeout(() => {
        if (!cancelled) setFlowmentumVisible(true);
      }, adminPreview ? 250 : 1400);
    }).catch(() => undefined);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [flowmentumEligible, flowmentumPreviewKey, flowmentumSeenKey, isAdmin]));
  const openFloWithPrompt = useCallback((prompt: string) => {
    router.push({ pathname: "/(tabs)/flo", params: { prompt } } as any);
  }, [router]);
  const openFlo = useCallback(() => {
    router.push("/(tabs)/flo" as any);
  }, [router]);
  const rememberPendingInsights = useCallback(async (transactionIds: string[]) => {
    if (!pendingInsightKey || !transactionIds.length) return;
    try {
      const stored = await AsyncStorage.getItem(pendingInsightKey);
      const parsed = stored ? JSON.parse(stored) : [];
      const seen = new Set<string>(Array.isArray(parsed) ? parsed.filter(item => typeof item === "string") : []);
      transactionIds.forEach(id => seen.add(id));
      await AsyncStorage.setItem(pendingInsightKey, JSON.stringify([...seen].slice(-150)));
    } catch {
      // A dismissed insight is a convenience preference. Pending money remains visible in Activity.
    }
  }, [pendingInsightKey]);
  const openPendingActivity = useCallback((charge?: PendingBankTransaction | null) => {
    router.push({
      pathname: "/(tabs)/transactions",
      params: charge ? {
        pendingId: charge.plaid_transaction_id,
        pendingAt: String(Date.now()),
      } : undefined,
    } as any);
  }, [router]);
  const dismissPendingFlo = useCallback(() => {
    setPendingFloCharge(null);
    void rememberPendingInsights(unplannedCheckingPending.map(charge => charge.plaid_transaction_id));
  }, [rememberPendingInsights, unplannedCheckingPending]);
  const reviewPendingFloCharge = useCallback(() => {
    const charge = pendingFloCharge;
    if (!charge) return;
    setPendingFloCharge(null);
    void rememberPendingInsights([charge.plaid_transaction_id]);
    openPendingActivity(charge);
  }, [openPendingActivity, pendingFloCharge, rememberPendingInsights]);
  useBackDismiss(Boolean(pendingFloCharge), dismissPendingFlo);
  const pendingInsightSignature = useMemo(
    () => unplannedCheckingPending.map(charge => charge.plaid_transaction_id).sort().join("|"),
    [unplannedCheckingPending],
  );
  useEffect(() => {
    const anotherModalIsOpen = flowmentumVisible
      || actionModalVisible
      || goalModalVisible
      || addBillVisible
      || flowScoreVisible
      || safeCushionVisible
      || categoryBudgetModalVisible
      || moveMoneyVisible
      || Boolean(selectedCategory);
    if (!isFocused || anotherModalIsOpen || pendingFloCharge || !pendingInsightKey || !pendingInsightSignature) return;

    const requestKey = `${pendingInsightKey}:${pendingInsightSignature}`;
    if (checkedPendingSignatureRef.current === requestKey) return;
    checkedPendingSignatureRef.current = requestKey;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    void AsyncStorage.getItem(pendingInsightKey).then(stored => {
      if (cancelled) return;
      let seenIds: string[] = [];
      try {
        const parsed = stored ? JSON.parse(stored) : [];
        seenIds = Array.isArray(parsed) ? parsed.filter(item => typeof item === "string") : [];
      } catch {
        seenIds = [];
      }
      const seen = new Set(seenIds);
      const unseenCharge = unplannedCheckingPending.find(charge => !seen.has(charge.plaid_transaction_id));
      if (!unseenCharge) return;
      timer = setTimeout(() => {
        if (!cancelled) setPendingFloCharge(unseenCharge);
      }, 1500);
    }).catch(() => undefined);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [
    actionModalVisible,
    addBillVisible,
    categoryBudgetModalVisible,
    flowScoreVisible,
    flowmentumVisible,
    goalModalVisible,
    isFocused,
    moveMoneyVisible,
    pendingFloCharge,
    pendingInsightKey,
    pendingInsightSignature,
    safeCushionVisible,
    selectedCategory,
    unplannedCheckingPending,
  ]);
  const openStabilityGuide = useCallback((sectionId: "overview" | "flow-score" = "overview") => {
    router.push({
      pathname: "/(tabs)/how-flowledger-works",
      params: buildFlowGuideRouteParams({
        section: sectionId,
        stage: algorithmSuite.stability.stage,
        stageLabel: algorithmSuite.stability.stageLabel,
        protectedDays: algorithmSuite.stability.protectedDays,
        protectedAmount: algorithmSuite.stability.protectedAmount,
        reserveTarget: algorithmSuite.stability.reserveTarget,
        backupTarget: algorithmSuite.stability.backupTarget,
        safeUntilPayday: algorithmSuite.stability.safeUntilPayday,
        nextPaycheckLabel: algorithmSuite.stability.nextPaycheckLabel,
        nextAction: algorithmSuite.stability.nextAction,
        nextMilestone: algorithmSuite.stability.nextMilestone,
        nextMilestoneAmount: algorithmSuite.stability.nextMilestoneAmount,
        lowestBalance: algorithmSuite.safeCushion.lowestBalance,
        safetyFloor: settings.safety_floor,
        confidence: forecastConfidence.label,
        flowScore: algorithmSuite.flowScore.score,
        flowScoreLabel: algorithmSuite.flowScore.label,
        flowScorePlanCoverage: algorithmSuite.flowScore.components.find(component => component.id === "planCoverage")?.earned ?? 0,
        flowScoreMustPay: algorithmSuite.flowScore.components.find(component => component.id === "requiredPayments")?.earned ?? 0,
        flowScoreBackup: algorithmSuite.flowScore.components.find(component => component.id === "backupProgress")?.earned ?? 0,
      }),
    } as any);
  }, [algorithmSuite.flowScore.components, algorithmSuite.flowScore.label, algorithmSuite.flowScore.score, algorithmSuite.safeCushion.lowestBalance, algorithmSuite.stability, forecastConfidence.label, router, settings.safety_floor]);
  const dashboardBillsLeft = Math.max(0, cashFlow.totalBillsDue);
  const dashboardSafeToSpend = Math.max(0, algorithmSuite.safeCushion.amount);
  const dashboardNextPaydayFull = algorithmSuite.stability.nextPaycheckLabel || "Not scheduled";
  const dashboardNextPayday = compactDateLabel(dashboardNextPaydayFull);
  const dashboardPlanned = Math.max(0, cashFlow.totalBillsDue + cashFlow.goalAllocations);
  const dashboardProgress = cashFlow.monthlyIncome > 0
    ? Math.max(0, Math.min(1, dashboardPlanned / cashFlow.monthlyIncome))
    : 0;
  return (
    <ScrollView
      style={[styles.screen, styles.dashboardStage, { backgroundColor: dashboardTheme.screen }]}
      contentContainerStyle={[
        styles.content,
        isCommandWide && styles.contentWide,
        { paddingTop: dashboardTopPadding, paddingBottom: dashboardBottomPadding },
      ]}
      scrollEnabled
      bounces={false}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentInsetAdjustmentBehavior="never"
    >
      <PremiumBackdrop variant="purple" />
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
            { label: "Activity", icon: "repeat" as const, to: "/(tabs)/transactions" },
            { label: "Flo", icon: "message-circle" as const, to: "/(tabs)/flo" },
            { label: "More", icon: "settings" as const, to: "/(tabs)/more" },
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
              <AppText tone="title" style={styles.referenceRailFloTitle}>Flo</AppText>
              <AppText style={styles.referenceRailFloSub}>Decision co-pilot</AppText>
            </View>
          </Pressable>
        </View>
      ) : null}
      <View style={[styles.dashboardHeader, compactDashboardHeader && styles.dashboardHeaderCompact]}>
        <View style={styles.brandLockup}>
          <View style={[styles.brandMark, compactDashboardHeader && styles.brandMarkCompact]}>
            <Image source={FLOWLEDGER_LOGO} style={styles.brandMarkImage} resizeMode="cover" />
          </View>
        </View>
        <View style={styles.dashboardHeaderActions}>
          <HouseholdSwitcher appearance="header" />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open notifications${unreadNotificationCount ? `, ${unreadNotificationCount} unread` : ""}`}
            onPress={openNotifications}
            style={({ pressed }) => [
              styles.settingsHeaderButton,
              { backgroundColor: c.card, borderColor: c.border, opacity: pressed ? 0.72 : 1 },
            ]}
          >
            <Feather name="bell" size={20} color={c.foreground} />
            {unreadNotificationCount ? (
              <View style={[styles.discoveryHeaderBadge, { backgroundColor: c.destructive }]}>
                <Text style={styles.discoveryHeaderBadgeText}>{Math.min(unreadNotificationCount, 9)}</Text>
              </View>
            ) : null}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Customize dashboard"
            onPress={() => setCustomizerOpen(true)}
            style={({ pressed }) => [
              styles.settingsHeaderButton,
              { backgroundColor: c.card, borderColor: c.border, opacity: pressed ? 0.72 : 1 },
            ]}
          >
            <Feather name="sliders" size={20} color={c.foreground} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open Settings"
            onPress={() =>
              router.push({
                pathname: "/(tabs)/more",
                params: { section: "overview" },
              } as any)
            }
            style={({ pressed }) => [
              styles.settingsHeaderButton,
              {
                backgroundColor: c.card,
                borderColor: c.border,
                opacity: pressed ? 0.72 : 1,
              },
            ]}
          >
            <Feather name="settings" size={20} color={c.foreground} />
          </Pressable>
        </View>
      </View>
      <DataFreshnessLabel inset compact />
      {!settings.onboarding_completed && (
        <View style={[styles.setupCard, { backgroundColor: c.card, borderColor: c.border }]}>
          <View style={styles.setupHeader}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.setupTitle, { color: c.foreground }]}>Continue setup with Flo</Text>
              <Text style={[styles.setupDesc, { color: c.mutedForeground }]}>Flo will pick up where you left off. {setupReadiness.completeCount} of {setupReadiness.stages.length} stages complete</Text>
            </View>
          </View>
          {setupReadiness.stages.map(stageItem => (
            <View key={stageItem.id} style={styles.setupStep}>
              <Feather name={stageItem.complete ? "check-circle" : "circle"} size={15} color={stageItem.complete ? c.success : c.mutedForeground} />
              <Text style={[styles.setupStepText, { color: stageItem.complete ? c.mutedForeground : c.foreground }]}>{stageItem.label}</Text>
            </View>
          ))}
          <Pressable accessibilityRole="button" onPress={() => router.push("/setup" as any)} style={[styles.setupButton, { backgroundColor: c.primary }]}>
            <Text style={[styles.setupButtonText, { color: c.primaryForeground }]}>{setupReadiness.isComplete ? "Review and finish" : "Continue with Flo"}</Text>
          </Pressable>
        </View>
      )}

      {pendingFloCharge ? <Modal
        visible={Boolean(pendingFloCharge)}
        transparent
        animationType="fade"
        onRequestClose={dismissPendingFlo}
      >
        <View style={styles.pendingFloBackdrop}>
          <View style={[styles.pendingFloCard, { backgroundColor: c.card, borderColor: colors.brand.blue + "65" }]}>
            <View style={styles.pendingFloHandle} />
            <View style={styles.pendingFloHeader}>
              <View style={[styles.pendingFloAvatarWrap, { borderColor: c.primary + "55" }]}>
                <Image source={FLO_LOGO} style={styles.pendingFloAvatar} resizeMode="cover" />
              </View>
              <View style={{ flex: 1 }}>
                <AppText tone="label" style={[styles.pendingFloEyebrow, { color: c.primary }]}>Flo noticed this</AppText>
                <AppText tone="title" style={[styles.pendingFloTitle, { color: c.foreground }]}>A charge is pending</AppText>
              </View>
              <Pressable accessibilityLabel="Dismiss pending charge message" onPress={dismissPendingFlo} hitSlop={10}>
                <Feather name="x" size={21} color={c.mutedForeground} />
              </Pressable>
            </View>

            <AppText style={[styles.pendingFloMessage, { color: c.foreground }]}>
              {pendingFloCharge?.merchant_name || pendingFloCharge?.name || "This charge"} is pending for {formatDashboardCurrency(Math.abs(pendingFloCharge?.amount ?? 0))}. I don&apos;t see it in your plan yet.
            </AppText>
            {unplannedCheckingPending.length > 1 ? (
              <AppText style={[styles.pendingFloSecondary, { color: c.mutedForeground }]}>
                You also have {unplannedCheckingPending.length - 1} more unplanned pending charge{unplannedCheckingPending.length - 1 === 1 ? "" : "s"}.
              </AppText>
            ) : null}

            <View style={[styles.pendingFloBalanceBox, { backgroundColor: colors.brand.blue + "10", borderColor: colors.brand.blue + "30" }]}>
              <View>
                <AppText tone="label" style={[styles.pendingFloBalanceLabel, { color: c.mutedForeground }]}>Bank balance</AppText>
                <AppText tone="number" style={[styles.pendingFloBalanceValue, { color: c.foreground }]}>
                  {formatDashboardCurrency(dashboardCheckingBalance)}
                </AppText>
              </View>
              <Feather name="arrow-right" size={17} color={colors.brand.blue} />
              <View style={styles.pendingFloAvailableColumn}>
                <AppText tone="label" style={[styles.pendingFloBalanceLabel, { color: c.mutedForeground }]}>Available</AppText>
                <AppText tone="number" style={[styles.pendingFloBalanceValue, { color: c.success }]}>
                  {formatDashboardCurrency(pendingCheckingSummary?.availableBalance ?? dashboardCheckingBalance)}
                </AppText>
              </View>
            </View>

            <AppText style={[styles.pendingFloNote, { color: c.mutedForeground }]}>Pending amounts can change. FlowLedger will replace this preview when the final charge posts.</AppText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Plan this pending charge"
              onPress={reviewPendingFloCharge}
              style={({ pressed }) => [styles.pendingFloPrimaryButton, { backgroundColor: c.primary, opacity: pressed ? 0.8 : 1 }]}
            >
              <Feather name="calendar" size={17} color={c.primaryForeground} />
              <AppText tone="title" style={[styles.pendingFloPrimaryText, { color: c.primaryForeground }]}>Plan this charge</AppText>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Wait until this pending charge posts"
              onPress={dismissPendingFlo}
              style={({ pressed }) => [styles.pendingFloSecondaryButton, { borderColor: c.border, opacity: pressed ? 0.72 : 1 }]}
            >
              <AppText tone="title" style={[styles.pendingFloSecondaryText, { color: c.foreground }]}>Wait until it posts</AppText>
            </Pressable>
          </View>
        </View>
      </Modal> : null}

      {flowmentumVisible ? <FlowmentumHandoffModal
        visible={flowmentumVisible}
        isAdminPreview={flowmentumAdminPreview}
        onDismiss={dismissFlowmentum}
        onExplore={exploreFlowmentum}
      /> : null}

      <MonthlyDebtCheckInModal
        onReview={() => router.push({ pathname: "/(tabs)/bills", params: { view: "debt" } } as any)}
      />

      {savingsAccountNameTarget ? <SavingsAccountNameModal
        account={savingsAccountNameTarget}
        onClose={() => setSavingsAccountNameTarget(null)}
        onSave={saveSavingsAccountName}
        onReset={resetSavingsAccountName}
      /> : null}

      <View
        style={[
          styles.referenceCommandHeroFlipShell,
          { minHeight: flipped ? heroBackCardHeight : heroFrontCardHeight },
        ]}
      >
          <Animated.View
            pointerEvents={flipped ? "none" : "auto"}
            style={[
              styles.referenceCommandHero,
              isCommandWide && styles.referenceCommandHeroWide,
              isCommandWide ? styles.referenceHeroFrontWide : styles.referenceHeroFaceCompact,
              styles.referenceCommandHeroFlipFace,
              {
                minHeight: flipped ? heroBackCardHeight : heroFrontCardHeight,
                backgroundColor: heroSurface,
                borderColor: dashboardTheme.heroBorder,
                shadowColor: dashboardTheme.heroShadow,
                shadowOpacity: dashboardTheme.heroShadowOpacity,
              },
              { transform: [{ perspective: 1000 }, { rotateY: frontRotate }] },
            ]}
          >
            <View style={[styles.referenceHeroMoneyPanel, isCommandWide && styles.referenceHeroMoneyPanelWide]}>
              <View style={styles.referenceMoneyHeader}>
                <View style={{ flex: 1 }}>
                  <AppText tone="title" style={[styles.referenceGreeting, { color: dashboardTheme.text }]}>{timeGreeting}</AppText>
                </View>
                <Pressable onPress={doFlip} accessibilityLabel="Show savings and goals" style={[styles.referenceFlipButton, { backgroundColor: dashboardTheme.purpleSurface, borderColor: dashboardTheme.purpleBorder }]}>
                  <Feather name="repeat" size={13} color={dashboardTheme.purpleText} />
                  <AppText style={[styles.referenceFlipButtonText, { color: dashboardTheme.purpleText }]}>Savings</AppText>
                </Pressable>
              </View>
              <View style={styles.referenceHeroPrimaryRow}>
                <View style={styles.referenceBalanceAmount}>
                  <AppText tone="label" style={[styles.referenceHeroLabel, { color: dashboardTheme.mutedText }]}>Checking balance</AppText>
                  <AppText tone="number" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.62} style={[styles.referenceHeroAmount, { color: dashboardTheme.amount, textShadowColor: "transparent" }]}>{formatDashboardCurrency(dashboardCheckingBalance)}</AppText>
                  {pendingCheckingSummary && pendingCheckingSummary.pendingCount > 0 ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`${pendingCheckingSummary.pendingCount} pending bank transaction${pendingCheckingSummary.pendingCount === 1 ? "" : "s"}. ${formatDashboardCurrency(pendingCheckingSummary.availableBalance)} available after pending activity.`}
                      onPress={() => openPendingActivity(unplannedCheckingPending[0] ?? checkingPendingTransactions[0])}
                      style={({ pressed }) => [styles.pendingBalanceStrip, { backgroundColor: c.warning + "12", borderColor: c.warning + "38", opacity: pressed ? 0.76 : 1 }]}
                    >
                      <Feather name="clock" size={12} color={c.warning} />
                      <AppText style={[styles.pendingBalancePrimary, { color: c.warning }]} numberOfLines={1}>
                        {pendingCheckingSummary.pendingOutflow > 0
                          ? `−${formatDashboardCurrency(pendingCheckingSummary.pendingOutflow)} pending`
                          : `+${formatDashboardCurrency(pendingCheckingSummary.pendingInflow)} pending`}
                      </AppText>
                      <View style={[styles.pendingBalanceDot, { backgroundColor: dashboardTheme.subtleText }]} />
                      <AppText style={[styles.pendingBalanceAvailable, { color: dashboardTheme.mutedText }]} numberOfLines={1}>
                        {formatDashboardCurrency(pendingCheckingSummary.availableBalance)} available
                      </AppText>
                    </Pressable>
                  ) : (
                    <AppText style={[styles.referenceSafeThrough, { color: algorithmSuite.stability.safeUntilPayday === false ? c.warning : dashboardTheme.scoreStatus }]} numberOfLines={1}>
                      {algorithmSuite.stability.safeUntilPayday === true
                        ? `Safe through ${compactDateLabel(algorithmSuite.stability.nextPaycheckLabel || "next payday")}`
                        : algorithmSuite.stability.safeUntilPayday === false
                        ? "Review your plan before payday"
                        : "Add an income date to finish your plan"}
                    </AppText>
                  )}
                </View>
                <Pressable
                  nativeID="guided-tour-index"
                  accessibilityRole="button"
                  accessibilityLabel={`View Flow Score details. ${algorithmSuite.flowScore.score}, ${algorithmSuite.flowScore.label}.`}
                  onPress={() => setFlowScoreVisible(true)}
                  style={({ pressed }) => [styles.referenceScorePanel, { opacity: pressed ? 0.86 : 1 }]}
                >
                  <FlowScoreGauge score={algorithmSuite.flowScore.score} theme={dashboardTheme} />
                  <AppText tone="title" style={[styles.referenceScoreStatus, { color: dashboardTheme.scoreStatus }]}>{algorithmSuite.flowScore.label}</AppText>
                </Pressable>
              </View>
              <View style={styles.referenceHeroActionRow}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Ask Flo about your plan"
                  onPress={openFlo}
                  style={({ pressed }) => [styles.referenceHeroFloButton, { backgroundColor: c.primary + "14", borderColor: c.primary + "38", opacity: pressed ? 0.78 : 1 }]}
                >
                  <View style={[styles.referenceHeroFloIcon, { backgroundColor: c.primary + "22" }]}>
                    <Feather name="message-circle" size={16} color={c.primary} />
                  </View>
                  <AppText tone="title" style={[styles.referenceHeroFloText, { color: dashboardTheme.text }]}>Ask Flo</AppText>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Open monthly forecast"
                  onPress={() => router.push("/(tabs)/monthly" as any)}
                  style={({ pressed }) => [styles.referenceHeroForecastButton, { borderColor: dashboardTheme.goalBorder, opacity: pressed ? 0.78 : 1 }]}
                >
                  <Feather name="calendar" size={14} color={dashboardTheme.mutedText} />
                  <AppText style={[styles.referenceHeroForecastText, { color: dashboardTheme.mutedText }]}>Forecast</AppText>
                </Pressable>
              </View>
            </View>
          </Animated.View>

          <Animated.View
            pointerEvents={flipped ? "auto" : "none"}
            style={[
              styles.referenceCommandHero,
              isCommandWide && styles.referenceCommandHeroWide,
              !isCommandWide && styles.referenceHeroFaceCompact,
              styles.referenceCommandHeroFlipFace,
              styles.referenceCommandHeroBackFace,
              {
                backgroundColor: heroSurface,
                borderColor: dashboardTheme.heroBorder,
                shadowColor: dashboardTheme.heroShadow,
                shadowOpacity: dashboardTheme.heroShadowOpacity,
              },
              { transform: [{ perspective: 1000 }, { rotateY: backRotate }] },
            ]}
          >
            <View style={styles.referenceMoneyHeader}>
              <View style={styles.referenceSavingsHeaderCopy}>
                <AppText tone="label" style={[styles.referenceHeroLabel, { color: dashboardTheme.mutedText }]}>Savings accounts</AppText>
                <AppText tone="number" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.62} style={[styles.referenceHeroAmount, styles.referenceSavingsAmount, { color: dashboardTheme.savings, textShadowColor: "transparent" }]}>{formatDashboardCurrency(savingsAccountBalance)}</AppText>
              </View>
              <Pressable onPress={doFlip} accessibilityLabel="Show checking balance" style={[styles.referenceFlipButton, { backgroundColor: dashboardTheme.purpleSurface, borderColor: dashboardTheme.purpleBorder }]}>
                <Feather name="repeat" size={13} color={dashboardTheme.purpleText} />
                <AppText style={[styles.referenceFlipButtonText, { color: dashboardTheme.purpleText }]}>Checking</AppText>
              </Pressable>
            </View>
            <View style={styles.referenceSavingsList}>
              {savingsAccounts.length > 0 ? savingsAccounts.map((account) => (
                <View
                  key={account.id}
                  style={[styles.referenceSavingsItem, { backgroundColor: dashboardTheme.goalSurface, borderColor: dashboardTheme.goalBorder }]}
                >
                  <View style={styles.referenceSavingsIdentity}>
                    <AppText style={[styles.referenceSavingsName, { color: dashboardTheme.mutedText }]} numberOfLines={1}>
                      {account.name}
                    </AppText>
                    {account.mask ? (
                      <AppText style={[styles.referenceSavingsMask, { color: dashboardTheme.subtleText }]}>•••• {account.mask}</AppText>
                    ) : null}
                  </View>
                  <View style={styles.referenceSavingsValue}>
                    <AppText tone="number" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72} style={[styles.referenceSavingsBalance, { color: dashboardTheme.savings }]}>
                      {formatDashboardCurrency(account.balance)}
                    </AppText>
                    {canEditHousehold ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Name ${account.name} savings account`}
                        hitSlop={8}
                        onPress={() => setSavingsAccountNameTarget(account)}
                        style={({ pressed }) => [styles.referenceSavingsEdit, { backgroundColor: dashboardTheme.purpleSurface, borderColor: dashboardTheme.purpleBorder, opacity: pressed ? 0.68 : 1 }]}
                      >
                        <Feather name="edit-2" size={12} color={dashboardTheme.purpleText} />
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              )) : (
                <View style={[styles.referenceSavingsEmpty, { backgroundColor: dashboardTheme.goalSurface, borderColor: dashboardTheme.goalBorder }]}>
                  <AppText style={[styles.referenceSavingsEmptyText, { color: dashboardTheme.mutedText }]}>No savings accounts added.</AppText>
                </View>
              )}
            </View>
            <View style={styles.referenceGoalsHeader}>
              <AppText tone="title" style={[styles.referenceGoalsTitle, { color: dashboardTheme.text }]}>Current goals</AppText>
              <Pressable onPress={() => { setEditGoal(null); setGoalModalVisible(true); }} accessibilityLabel="Add goal" style={styles.referenceGoalAddButton}>
                <Feather name="plus" size={14} color="#f8fafc" />
              </Pressable>
            </View>
            {currentGoals.length > 0 ? currentGoals.slice(0, 3).map(goal => {
              const percent = goal.target_amount > 0 ? Math.min(100, Math.max(0, (goal.current_amount / goal.target_amount) * 100)) : 0;
              return (
                <Pressable
                  key={goal.id}
                  onPress={() => { setEditGoal(goal); setGoalModalVisible(true); }}
                  accessibilityLabel={`Edit ${goal.name} goal`}
                  style={({ pressed }) => [styles.referenceGoalItem, { backgroundColor: dashboardTheme.goalSurface, borderColor: dashboardTheme.goalBorder, opacity: pressed ? 0.72 : 1 }]}
                >
                  <View style={styles.referenceGoalTopRow}>
                    <AppText style={[styles.referenceGoalName, { color: dashboardTheme.mutedText }]} numberOfLines={1}>{goal.name}</AppText>
                    <AppText numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={[styles.referenceGoalAmounts, { color: dashboardTheme.subtleText }]}>{formatDashboardCurrency(goal.current_amount)} / {formatDashboardCurrency(goal.target_amount)}</AppText>
                  </View>
                  <View style={styles.referenceGoalTrack}>
                    <View style={[styles.referenceGoalFill, { width: `${percent}%` as any }]} />
                  </View>
                </Pressable>
              );
            }) : (
              <Pressable onPress={() => { setEditGoal(null); setGoalModalVisible(true); }} style={[styles.referenceGoalsEmpty, { backgroundColor: dashboardTheme.purpleSurface, borderColor: dashboardTheme.purpleBorder }]}>
                <Feather name="target" size={17} color="#a78bfa" />
                <AppText style={[styles.referenceGoalsEmptyText, { color: dashboardTheme.mutedText }]}>No goals yet.</AppText>
              </Pressable>
            )}
            {currentGoals.length > 3 && <AppText style={styles.referenceGoalsMore}>+{currentGoals.length - 3} more goal{currentGoals.length - 3 === 1 ? "" : "s"}</AppText>}
          </Animated.View>
      </View>

      <View style={[styles.dashboardSnapshotCard, { backgroundColor: c.card, borderColor: c.border }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open bills. ${formatDashboardCurrency(dashboardBillsLeft)} left this month.`}
          onPress={() => router.push("/(tabs)/bills" as any)}
          style={styles.dashboardSnapshotItem}
        >
          <View style={[styles.dashboardSnapshotIcon, { backgroundColor: c.primary + "16" }]}>
            <Feather name="file-text" size={18} color={c.primary} />
          </View>
          <AppText style={[styles.dashboardSnapshotLabel, { color: c.mutedForeground }]}>Bills left</AppText>
          <AppText tone="number" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={[styles.dashboardSnapshotValue, { color: c.foreground }]}>{formatDashboardCurrency(dashboardBillsLeft)}</AppText>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`See safe-to-spend details. ${formatDashboardCurrency(dashboardSafeToSpend)} safe to spend.`}
          onPress={() => setSafeCushionVisible(true)}
          style={[styles.dashboardSnapshotItem, styles.dashboardSnapshotItemBorder, { borderColor: c.border }]}
        >
          <View style={[styles.dashboardSnapshotIcon, { backgroundColor: c.success + "16" }]}>
            <Feather name="shield" size={18} color={c.success} />
          </View>
          <AppText style={[styles.dashboardSnapshotLabel, { color: c.mutedForeground }]}>Safe to spend</AppText>
          <AppText tone="number" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={[styles.dashboardSnapshotValue, { color: c.success }]}>{formatDashboardCurrency(dashboardSafeToSpend)}</AppText>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open income plan. Next payday ${dashboardNextPaydayFull}.`}
          onPress={() => router.push({ pathname: "/(tabs)/more", params: { section: "money" } } as any)}
          style={[styles.dashboardSnapshotItem, styles.dashboardSnapshotItemBorder, { borderColor: c.border }]}
        >
          <View style={[styles.dashboardSnapshotIcon, { backgroundColor: c.warning + "16" }]}>
            <Feather name="calendar" size={18} color={c.warning} />
          </View>
          <AppText style={[styles.dashboardSnapshotLabel, { color: c.mutedForeground }]}>Next payday</AppText>
          <AppText tone="number" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={[styles.dashboardSnapshotValue, { color: c.foreground }]}>{dashboardNextPayday}</AppText>
        </Pressable>
      </View>

      <DashboardUtilityWidgets
        layout={dashboardLayout}
        decisions={todayDecisions}
        reviewCount={reviewCenterCount}
        compact
        onNavigate={(pathname, params) => router.push({ pathname: pathname as any, params } as any)}
      />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open monthly forecast progress"
        onPress={() => router.push("/(tabs)/monthly" as any)}
        style={({ pressed }) => [styles.dashboardProgressCard, { backgroundColor: c.card, borderColor: c.border, opacity: pressed ? 0.78 : 1 }]}
      >
        <View style={styles.dashboardProgressHeader}>
          <View style={styles.dashboardProgressHeaderCopy}>
            <AppText tone="title" style={[styles.dashboardProgressTitle, { color: c.foreground }]}>Monthly progress</AppText>
            <AppText style={[styles.dashboardProgressCopy, { color: c.mutedForeground }]}>Your planned income and commitments</AppText>
          </View>
          <Feather name="arrow-up-right" size={18} color={c.primary} />
        </View>
        <View style={[styles.dashboardProgressTrack, { backgroundColor: c.muted }]}>
          <View style={[styles.dashboardProgressFill, { width: `${dashboardProgress * 100}%` as any }]} />
        </View>
        <View style={styles.dashboardProgressStats}>
          <View style={styles.dashboardProgressStat}>
            <View style={[styles.dashboardProgressDot, { backgroundColor: "#4f86ff" }]} />
            <AppText style={[styles.dashboardProgressLabel, { color: c.mutedForeground }]}>Income</AppText>
            <AppText tone="number" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={[styles.dashboardProgressValue, { color: c.foreground }]}>{formatDashboardCurrency(cashFlow.monthlyIncome)}</AppText>
          </View>
          <View style={[styles.dashboardProgressDivider, { backgroundColor: c.border }]} />
          <View style={styles.dashboardProgressStat}>
            <View style={[styles.dashboardProgressDot, { backgroundColor: c.success }]} />
            <AppText style={[styles.dashboardProgressLabel, { color: c.mutedForeground }]}>Planned</AppText>
            <AppText tone="number" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={[styles.dashboardProgressValue, { color: c.foreground }]}>{formatDashboardCurrency(dashboardPlanned)}</AppText>
          </View>
        </View>
      </Pressable>

      <StabilityPathCard
        progress={algorithmSuite.stability}
        onViewGuide={() => openStabilityGuide()}
      />

      {customizerOpen ? <DashboardCustomizer
        visible={customizerOpen}
        layout={dashboardLayout}
        onChange={updateDashboardLayout}
        onReset={resetDashboardLayout}
        onClose={() => setCustomizerOpen(false)}
      /> : null}

      {isCommandWide && settings.zeroBasedBudgetEnabled && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open this month's zero-based budget"
          onPress={() => router.push("/(tabs)/category-budget" as any)}
          style={({ pressed }) => [styles.zeroBudgetDashboardCard, { backgroundColor: c.card, borderColor: c.border, opacity: pressed ? 0.84 : 1 }]}
        >
          <View style={styles.zeroBudgetDashboardHeader}>
            <View style={[styles.categoryPlanIcon, { backgroundColor: c.primary + "18" }]}>
              <Feather name="pie-chart" size={16} color={c.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.zeroBudgetDashboardTitle, { color: c.foreground }]}>Zero-Based Budget</Text>
              <Text style={[styles.zeroBudgetDashboardSub, { color: c.mutedForeground }]}>{MONTH_FULL[currentMonth]} · ${postedIncome.toFixed(0)} received so far</Text>
            </View>
            <View style={[styles.categoryPlanBadge, { backgroundColor: Math.abs(zeroBudgetLeftToAssign) <= 0.01 ? c.success + "18" : zeroBudgetLeftToAssign > 0 ? c.warning + "18" : c.destructive + "18" }]}>
              <Text style={[styles.categoryPlanBadgeText, { color: Math.abs(zeroBudgetLeftToAssign) <= 0.01 ? c.success : zeroBudgetLeftToAssign > 0 ? c.warning : c.destructive }]}>
                {Math.abs(zeroBudgetLeftToAssign) <= 0.01 ? "Balanced" : zeroBudgetLeftToAssign > 0 ? "To assign" : "Overassigned"}
              </Text>
            </View>
          </View>
          <View style={styles.zeroBudgetDashboardStats}>
            <ZeroBudgetStat label="Income" value={zeroBudgetIncome} color={c.success} />
            <ZeroBudgetStat label="Assigned" value={zeroBudgetSummary.assigned} color={c.primary} />
            <ZeroBudgetStat label={zeroBudgetLeftToAssign < -0.01 ? "Over" : "Left"} value={Math.abs(zeroBudgetLeftToAssign)} color={Math.abs(zeroBudgetLeftToAssign) <= 0.01 ? c.success : zeroBudgetLeftToAssign > 0 ? c.warning : c.destructive} />
          </View>
          <View style={styles.zeroBudgetDashboardAction}>
            <Text style={[styles.categoryBudgetEditText, { color: c.primary }]}>{canEditHousehold ? "Assign or move money" : "View category assignments"}</Text>
            <Feather name="chevron-right" size={15} color={c.primary} />
          </View>
        </Pressable>
      )}

      {/* ── HERO: flip card — front = Balance Today, back = Savings ── */}

      {/* ── Stat Pill Cards ── */}
      {/* Row 1: Bills · Paid · Unpaid */}



      {/* Row 2: Debt — full width */}


      {/* ── Breathing-room opportunity (tappable → 12-month outlook) ── */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open the breathing room outlook"
        onPress={() => {
          setYearNegSchedule([]);
          setNegCalendarVisible(true);
        }}
        style={({ pressed }) => [styles.negWarning, { backgroundColor: c.primary + "18", borderRadius: colors.radius, opacity: pressed ? 0.8 : 1 }]}
      >
        <Feather name={firstYearNegEntry ? "trending-up" : "calendar"} size={15} color={c.primary} />
        <Text style={[styles.negWarningText, { color: c.primary }]}>
          {!outlookReady
            ? `Review your ${settings.forecast_horizon_months}-month breathing room outlook — tap to calculate`
            : firstYearNegEntry
              ? <>
                  Build more breathing room by{" "}
                  <Text style={{ fontFamily: "Inter_700Bold" }}>
                    {formatMonthDay(firstYearNegEntry.month, firstYearNegEntry.year, firstYearNegEntry.firstNegDay)}
                  </Text>
                  {" "}— tap to see full outlook
                </>
              : `No below-zero day found in your ${settings.forecast_horizon_months}-month outlook — tap to review`}
        </Text>
        <Feather name="chevron-right" size={14} color={c.primary} />
      </Pressable>


      {/* ── Upcoming Bills ── */}


      {flowScoreVisible ? <Modal
        visible={flowScoreVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setFlowScoreVisible(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setFlowScoreVisible(false)}>
          <Pressable {...flowScoreSwipeResponder.panHandlers} style={[styles.actionSheet, { backgroundColor: c.card }]} onPress={() => {}}>
            <View style={[styles.sheetHandle, { backgroundColor: c.muted }]} />
            <Text style={[styles.swipeDismissHint, { color: c.mutedForeground }]}>Swipe down to close</Text>
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
                <Text style={[styles.flowScoreColumnTitle, { color: c.success }]}>Your progress</Text>
                {(algorithmSuite.flowScore.positiveFactors.length ? algorithmSuite.flowScore.positiveFactors : ["Your plan has enough data to create a Flow Score."]).slice(0, 3).map(item => (
                  <Text key={item} style={[styles.flowScoreFactor, { color: c.foreground }]}>- {item}</Text>
                ))}
              </View>
              <View style={[styles.flowScoreColumn, { backgroundColor: c.muted }]}>
                <Text style={[styles.flowScoreColumnTitle, { color: c.primary }]}>Next opportunities</Text>
                {(algorithmSuite.flowScore.negativeFactors.length ? algorithmSuite.flowScore.negativeFactors : ["Your plan is ready for the next step."]).slice(0, 3).map(item => (
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

            <View style={[styles.flowScoreNextMove, { backgroundColor: c.muted, borderColor: c.border }]}>
              <Text style={[styles.flowScoreColumnTitle, { color: c.foreground }]}>Forecast confidence - not scored</Text>
              <Text style={[styles.flowScoreFactor, { color: c.mutedForeground }]}>{forecastConfidence.label}. Confidence reflects how current the plan inputs are and never changes the score.</Text>
            </View>

            <Pressable
              onPress={() => {
                setFlowScoreVisible(false);
                openStabilityGuide("flow-score");
              }}
              accessibilityRole="button"
              accessibilityLabel="See how the Flow Score works"
              style={({ pressed }) => [styles.flowScoreFloButton, { backgroundColor: c.primary, opacity: pressed ? 0.82 : 1 }]}
            >
              <Feather name="info" size={16} color={c.primaryForeground} />
              <Text style={[styles.flowScoreFloText, { color: c.primaryForeground }]}>See how the score works</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal> : null}

      {safeCushionVisible ? <Modal
        visible={safeCushionVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setSafeCushionVisible(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setSafeCushionVisible(false)}>
          <Pressable style={[styles.actionSheet, { backgroundColor: c.card }]} onPress={() => {}}>
            <View style={[styles.sheetHandle, { backgroundColor: c.muted }]} />
            <Text style={[styles.sheetTitle, { color: c.foreground }]}>Breathing Room</Text>
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
                openFloWithPrompt("What is my breathing room, how was it calculated, and what can I safely do with it?");
              }}
              style={({ pressed }) => [styles.flowScoreFloButton, { backgroundColor: c.primary, opacity: pressed ? 0.82 : 1 }]}
            >
              <Feather name="message-circle" size={16} color={c.primaryForeground} />
              <Text style={[styles.flowScoreFloText, { color: c.primaryForeground }]}>Ask Flo about this</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal> : null}

      {actionModalVisible ? <Modal
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
              { id: "goal",    icon: "target"      as const, label: "Set Aside Money",   sub: "Create a savings goal or spending bucket", col: "#8b5cf6" },
              { id: "buckets", icon: "archive"     as const, label: "Spending Buckets",  sub: "Open, close, or manage your buckets", col: "#06b6d4" },
              { id: "snowball", icon: "trending-down" as const, label: "Debt Payoff Planner", sub: "See the payoff ladder or plan safe extra money", col: c.destructive },
            ].map(item => (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={item.label}
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
      </Modal> : null}

      {categoryBudgetModalVisible ? <Modal
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
              {MONTH_FULL[currentMonth]} {currentYear} · leave blank to use planned bills.
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
      </Modal> : null}

      {selectedCategory ? <Modal
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
                      {MONTH_FULL[currentMonth]} {currentYear} category detail
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
                          Due {formatMonthDay(currentMonth, currentYear, bill.dueDay)}{bill.paid > 0 ? ` · $${bill.paid.toFixed(0)} paid` : ""}
                        </Text>
                      </View>
                      <Text style={[styles.categoryDetailItemAmount, { color: c.foreground }]}>${bill.amount.toFixed(0)}</Text>
                    </View>
                  )) : (
                    <Text style={[styles.categoryDetailEmpty, { color: c.mutedForeground }]}>No planned bills in this category.</Text>
                  )}

                  <Text style={[styles.categoryDetailSectionTitle, { color: c.mutedForeground, marginTop: 14 }]}>Activity</Text>
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
                    <Text style={[styles.categoryDetailActionText, { color: c.foreground }]}>Activity</Text>
                  </Pressable>
                </View>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal> : null}

      {moveMoneyVisible ? <Modal
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
      </Modal> : null}

      {addBillVisible ? <AddBillModal
        visible={addBillVisible}
        onClose={() => { setAddBillVisible(false); setAddBillForceDebt(false); }}
        onSave={(data) => addBill(data as Omit<Bill, "id" | "created_at">)}
        onDelete={() => {}}
        editBill={null}
        forceDebt={addBillForceDebt}
      /> : null}

      {goalModalVisible ? <GoalModal
        visible={goalModalVisible}
        onClose={() => { setGoalModalVisible(false); setEditGoal(null); }}
        onSave={(data) => {
          if ("id" in data) return updateGoal(data as Goal);
          return addGoal(data);
        }}
        onDelete={deleteGoal}
        editGoal={editGoal}
      /> : null}

      {/* ── Add savings contribution modal ── */}
      {/* ── 12-Month Balance Outlook modal ── */}
      {negCalendarVisible ? <Modal visible transparent animationType="slide" onRequestClose={() => setNegCalendarVisible(false)}>
        <Pressable style={styles.negSheetOverlay} onPress={() => setNegCalendarVisible(false)}>
          <Pressable style={[styles.negSheet, { backgroundColor: c.card }]} onPress={() => {}}>
            {/* Handle */}
            <View style={[styles.negSheetHandle, { backgroundColor: c.border }]} />
              <Text style={[styles.negSheetTitle, { color: c.foreground }]}>{settings.forecast_horizon_months}-Month Breathing Room Outlook</Text>
            <Text style={[styles.negSheetSub, { color: c.mutedForeground }]}>
              See where small changes can strengthen each month
            </Text>

            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 420 }}>
              {yearNegSchedule.length === 0 ? (
                <View
                  accessible
                  accessibilityRole="progressbar"
                  accessibilityLabel="Building the breathing room outlook"
                  accessibilityLiveRegion="polite"
                  style={styles.negSheetLoading}
                >
                  <Text style={[styles.negSheetRowDetail, { color: c.mutedForeground }]}>Building outlook...</Text>
                </View>
              ) : yearNegSchedule.map(entry => {
                const isNeg = entry.firstNegDay !== null;
                const isLow = !isNeg && entry.lowestBalance < settings.safety_floor;
                const iconName = isNeg ? "trending-up" as const : isLow ? "target" as const : "check-circle" as const;
                const iconColor = isNeg ? c.primary : isLow ? "#f0b429" : c.success;
                const bgColor  = isNeg ? c.primary + "12" : isLow ? "#f0b42912" : c.success + "0a";
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
                      <Text style={[styles.negSheetRowDetail, { color: isNeg ? c.primary : isLow ? "#f0b429" : c.mutedForeground }]}>
                        {isNeg
                          ? `Build more room by ${formatMonthDay(entry.month, entry.year, entry.firstNegDay)}`
                          : isLow
                          ? `Growing cushion · $${entry.lowestBalance.toFixed(0)}`
                          : `Protected · $${entry.lowestBalance.toFixed(0)}`}
                      </Text>
                    </View>
                    {isNeg && (
                      <View style={[styles.negSheetBadge, { backgroundColor: c.primary }]}>
                        <Text style={styles.negSheetBadgeText}>BUILD</Text>
                      </View>
                    )}
                    {isLow && !isNeg && (
                      <View style={[styles.negSheetBadge, { backgroundColor: "#f0b429" }]}>
                        <Text style={styles.negSheetBadgeText}>GROW</Text>
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
      </Modal> : null}

      {/* ── Save to Budget popup ── */}
    </ScrollView>
  );
}

function formatMonthDay(month: number, year: number, day: number | null | undefined): string {
  if (!day) return `${MONTH_FULL[month] ?? "Month"} ${year}`;
  return `${MONTH_FULL[month] ?? "Month"} ${day}, ${year}`;
}

function ZeroBudgetStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={styles.zeroBudgetDashboardStat}>
      <Text style={[styles.zeroBudgetDashboardValue, { color }]}>${value.toFixed(0)}</Text>
      <Text style={styles.zeroBudgetDashboardLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen:  { flex: 1 },
  dashboardStage: { backgroundColor: "#030712" },
  content: { paddingHorizontal: 16, position: "relative" },
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
  dashboardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 14, marginBottom: 18 },
  dashboardHeaderCompact: { gap: 9 },
  brandLockup: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1, minWidth: 0 },
  brandMark: { width: 48, height: 48, borderRadius: 17, alignItems: "center", justifyContent: "center", overflow: "hidden", borderWidth: 1, borderColor: "rgba(96,165,250,0.30)", backgroundColor: "#020617", shadowColor: "#020617", shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.22, shadowRadius: 12, elevation: 4 },
  brandMarkCompact: { width: 40, height: 40, borderRadius: 14 },
  brandMarkImage: { width: "100%", height: "100%" },
  dashboardHeaderActions: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 8 },
  settingsHeaderButton: { width: 44, height: 44, borderWidth: 1, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  discoveryHeaderBadge: { position: "absolute", right: -3, top: -3, minWidth: 16, height: 16, borderRadius: 8, alignItems: "center", justifyContent: "center", paddingHorizontal: 3 },
  discoveryHeaderBadgeText: { color: "#ffffff", fontFamily: "Inter_800ExtraBold", fontSize: 8 },
  setupCard: { borderWidth: 1, borderRadius: 18, padding: 14, marginBottom: 12 },
  setupHeader: { flexDirection: "row", alignItems: "flex-start", marginBottom: 8 },
  setupTitle: { fontSize: 15, fontFamily: "Inter_700Bold" },
  setupDesc: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  setupStep: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 },
  setupStepText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  setupButton: { height: 40, borderRadius: 9, alignItems: "center", justifyContent: "center", marginTop: 10 },
  setupButtonText: { fontSize: 13, fontFamily: "Inter_700Bold" },
  dashboardQuickAccess: { borderWidth: 1, borderRadius: 18, padding: 14, marginTop: 12, marginBottom: 12 },
  dashboardQuickTitle: { fontSize: 14, fontFamily: "Inter_800ExtraBold", marginBottom: 10 },
  dashboardQuickRow: { gap: 9 },
  dashboardQuickButton: { minHeight: 64, borderWidth: 1, borderRadius: 15, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 11 },
  dashboardQuickIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  dashboardQuickCopy: { flex: 1, minWidth: 0 },
  dashboardQuickLabel: { fontSize: 13, fontFamily: "Inter_700Bold" },
  dashboardQuickMeta: { fontSize: 11, lineHeight: 15, fontFamily: "Inter_500Medium", marginTop: 2 },
  pendingFloBackdrop: { flex: 1, backgroundColor: "rgba(2,6,23,0.78)", alignItems: "center", justifyContent: "center", padding: 20 },
  pendingFloCard: { width: "100%", maxWidth: 480, borderRadius: 28, borderWidth: 1, padding: 18, shadowColor: "#000", shadowOffset: { width: 0, height: 22 }, shadowOpacity: 0.42, shadowRadius: 34, elevation: 18 },
  pendingFloHandle: { alignSelf: "center", width: 42, height: 4, borderRadius: 999, backgroundColor: "rgba(148,163,184,0.42)", marginBottom: 15 },
  pendingFloHeader: { flexDirection: "row", alignItems: "center", gap: 11 },
  pendingFloAvatarWrap: { width: 52, height: 52, borderRadius: 18, overflow: "hidden", borderWidth: 1, backgroundColor: "#020617" },
  pendingFloAvatar: { width: "100%", height: "100%" },
  pendingFloEyebrow: { fontSize: 9, letterSpacing: 1.4, textTransform: "uppercase" },
  pendingFloTitle: { fontSize: 21, lineHeight: 25, letterSpacing: -0.5 },
  pendingFloMessage: { fontSize: 17, lineHeight: 24, fontFamily: "Inter_700Bold", marginTop: 17 },
  pendingFloSecondary: { fontSize: 12, lineHeight: 17, fontFamily: "Inter_500Medium", marginTop: 6 },
  pendingFloBalanceBox: { borderWidth: 1, borderRadius: 17, paddingHorizontal: 13, paddingVertical: 11, marginTop: 15, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  pendingFloAvailableColumn: { alignItems: "flex-end" },
  pendingFloBalanceLabel: { fontSize: 9, letterSpacing: 0.8, textTransform: "uppercase" },
  pendingFloBalanceValue: { fontSize: 18, lineHeight: 22, letterSpacing: -0.4 },
  pendingFloNote: { fontSize: 11, lineHeight: 16, fontFamily: "Inter_500Medium", marginTop: 11 },
  pendingFloPrimaryButton: { minHeight: 50, borderRadius: 16, marginTop: 16, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  pendingFloPrimaryText: { fontSize: 14 },
  pendingFloSecondaryButton: { minHeight: 46, borderRadius: 16, borderWidth: 1, marginTop: 8, alignItems: "center", justifyContent: "center" },
  pendingFloSecondaryText: { fontSize: 13 },

  referenceCommandHero: {
    borderRadius: 28,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.14)",
    backgroundColor: "rgba(2,6,23,0.42)",
    padding: 16,
    marginBottom: 10,
    overflow: "hidden",
    shadowColor: "#020617",
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.32,
    shadowRadius: 24,
    elevation: 6,
  },
  referenceCommandHeroWide: { minHeight: 320, padding: 30 },
  referenceCommandHeroFlipShell: { width: "100%", position: "relative", marginBottom: 6 },
  referenceCommandHeroFlipFace: { width: "100%", marginBottom: 0, backfaceVisibility: "hidden" },
  referenceCommandHeroBackFace: { ...StyleSheet.absoluteFillObject, marginBottom: 0 },
  referenceHeroFaceCompact: { minHeight: 250 },
  referenceHeroFrontWide: { minHeight: 260, alignItems: "stretch" },
  referenceHeroMoneyPanel: { width: "100%" },
  referenceHeroMoneyPanelWide: { flex: 1, width: "auto" },
  referenceMoneyHeader: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  referenceHeroPrimaryRow: { flexDirection: "row", alignItems: "center", gap: 14, marginTop: 12 },
  referenceBalanceAmount: { flex: 1, minWidth: 0 },
  pendingBalanceStrip: { alignSelf: "flex-start", maxWidth: "100%", minHeight: 27, borderRadius: 999, borderWidth: 1, paddingHorizontal: 8, marginTop: 3, flexDirection: "row", alignItems: "center", gap: 5 },
  pendingBalancePrimary: { fontSize: 10, fontFamily: "Inter_800ExtraBold" },
  pendingBalanceDot: { width: 3, height: 3, borderRadius: 2 },
  pendingBalanceAvailable: { flexShrink: 1, fontSize: 10, fontFamily: "Inter_700Bold" },
  referenceHeroActionRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12 },
  referenceHeroFloButton: { minHeight: 42, flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, borderWidth: 1, borderRadius: 14, paddingHorizontal: 11 },
  referenceHeroFloIcon: { width: 29, height: 29, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  referenceHeroFloText: { fontSize: 13, paddingRight: 3 },
  referenceHeroForecastButton: { minHeight: 42, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1, borderRadius: 14, paddingHorizontal: 12 },
  referenceHeroForecastText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  referenceFlipButton: { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 999, borderWidth: 1, borderColor: "rgba(196,181,253,0.28)", backgroundColor: "rgba(124,58,237,0.18)", paddingHorizontal: 9, paddingVertical: 6 },
  referenceFlipButtonText: { color: "#c4b5fd", fontSize: 9, fontFamily: "Inter_800ExtraBold", textTransform: "uppercase", letterSpacing: 0.5 },
  referenceSavingsHeaderCopy: { flex: 1, minWidth: 0 },
  referenceSavingsAmount: { color: "#6ee7b7", fontSize: 34, lineHeight: 38, letterSpacing: -1.4 },
  referenceSavingsList: { marginTop: 8, gap: 5 },
  referenceSavingsItem: { minHeight: 31, borderRadius: 10, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 6, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  referenceSavingsIdentity: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 6 },
  referenceSavingsName: { flexShrink: 1, fontSize: 11, fontFamily: "Inter_700Bold" },
  referenceSavingsMask: { fontSize: 9, fontFamily: "Inter_600SemiBold" },
  referenceSavingsValue: { maxWidth: "48%", minWidth: 0, flexShrink: 1, flexDirection: "row", alignItems: "center", gap: 6 },
  referenceSavingsBalance: { flexShrink: 1, fontSize: 12, lineHeight: 16, fontFamily: "Inter_800ExtraBold" },
  referenceSavingsEdit: { width: 28, height: 28, borderRadius: 9, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  referenceSavingsEmpty: { minHeight: 36, borderRadius: 10, borderWidth: 1, borderStyle: "dashed", alignItems: "center", justifyContent: "center", paddingHorizontal: 9 },
  referenceSavingsEmptyText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  referenceGoalsHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 8, marginBottom: 5 },
  referenceGoalsTitle: { color: "#f8fafc", fontSize: 13, fontFamily: "Inter_800ExtraBold" },
  referenceGoalAddButton: { width: 28, height: 28, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(124,58,237,0.42)", borderWidth: 1, borderColor: "rgba(196,181,253,0.28)" },
  referenceGoalItem: { borderRadius: 10, backgroundColor: "rgba(15,23,42,0.56)", borderWidth: 1, borderColor: "rgba(148,163,184,0.12)", paddingHorizontal: 9, paddingVertical: 6, marginTop: 4 },
  referenceGoalTopRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  referenceGoalName: { flex: 1, color: "#e2e8f0", fontSize: 11, fontFamily: "Inter_700Bold" },
  referenceGoalAmounts: { maxWidth: "52%", flexShrink: 1, color: "#94a3b8", fontSize: 9, fontFamily: "Inter_700Bold", textAlign: "right" },
  referenceGoalTrack: { height: 4, borderRadius: 999, overflow: "hidden", backgroundColor: "rgba(148,163,184,0.22)", marginTop: 5 },
  referenceGoalFill: { height: "100%", borderRadius: 999, backgroundColor: "#34d399" },
  referenceGoalsEmpty: { minHeight: 74, borderRadius: 14, borderWidth: 1, borderStyle: "dashed", borderColor: "rgba(167,139,250,0.38)", backgroundColor: "rgba(124,58,237,0.10)", alignItems: "center", justifyContent: "center", gap: 7, padding: 12 },
  referenceGoalsEmptyText: { color: "#cbd5e1", fontSize: 11, lineHeight: 15, textAlign: "center", fontFamily: "Inter_600SemiBold" },
  referenceGoalsMore: { color: "#a78bfa", fontSize: 9, fontFamily: "Inter_800ExtraBold", textAlign: "right", marginTop: 5 },
  referenceGreeting: { color: "#f8fafc", fontSize: 21, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.8 },
  referenceHeroLabel: { color: "#cbd5e1", fontSize: 11, fontFamily: "Inter_800ExtraBold", letterSpacing: 1.4, textTransform: "uppercase" },
  referenceHeroAmount: { color: "#ffffff", fontSize: 42, lineHeight: 46, fontFamily: "Inter_800ExtraBold", letterSpacing: -2.4, textShadowColor: "transparent", textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 0 },
  referenceSafeThrough: { fontSize: 11, fontFamily: "Inter_700Bold", marginTop: 7 },
  referenceScorePanel: { width: 112, alignItems: "center", justifyContent: "center", paddingVertical: 1 },
  referenceGaugeWrap: { width: 98, height: 98, alignItems: "center", justifyContent: "center", backgroundColor: "transparent" },
  referenceGaugeSvg: { backgroundColor: "transparent" },
  referenceGaugeCenter: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  referenceGaugeScore: { color: "#ffffff", fontSize: 29, fontFamily: "Inter_800ExtraBold", lineHeight: 33 },
  referenceGaugeLabel: { color: "#cbd5e1", fontSize: 9, fontFamily: "Inter_700Bold" },
  referenceScoreStatus: { color: "#4ade80", fontSize: 12, fontFamily: "Inter_800ExtraBold", marginTop: 2 },
  referenceScoreUnderline: { width: 64, height: 3, borderRadius: 3, backgroundColor: "#22c55e", marginTop: 4, marginBottom: 4 },
  dashboardSnapshotCard: { minHeight: 134, flexDirection: "row", borderRadius: 24, borderWidth: 1, overflow: "hidden", marginBottom: 12 },
  dashboardSnapshotItem: { flex: 1, minWidth: 0, paddingVertical: 15, paddingHorizontal: 9, alignItems: "center", justifyContent: "center" },
  dashboardSnapshotItemBorder: { borderLeftWidth: 1 },
  dashboardSnapshotIcon: { width: 34, height: 34, borderRadius: 11, alignItems: "center", justifyContent: "center", marginBottom: 7 },
  dashboardSnapshotLabel: { fontSize: 10, lineHeight: 13, fontFamily: "Inter_700Bold", textAlign: "center" },
  dashboardSnapshotValue: { maxWidth: "100%", fontSize: 18, lineHeight: 23, letterSpacing: -0.5, fontFamily: "Inter_800ExtraBold", marginTop: 4, textAlign: "center" },
  dashboardProgressCard: { borderWidth: 1, borderRadius: 24, padding: 17, marginTop: 12, marginBottom: 12 },
  dashboardProgressHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
  dashboardProgressHeaderCopy: { flex: 1, minWidth: 0 },
  dashboardProgressTitle: { fontSize: 18, letterSpacing: -0.4 },
  dashboardProgressCopy: { fontSize: 12, fontFamily: "Inter_500Medium", marginTop: 3 },
  dashboardProgressTrack: { height: 11, borderRadius: 999, overflow: "hidden", marginTop: 15 },
  dashboardProgressFill: { height: "100%", borderRadius: 999, backgroundColor: "#38bdf8" },
  dashboardProgressStats: { flexDirection: "row", alignItems: "stretch", marginTop: 16 },
  dashboardProgressStat: { flex: 1, minWidth: 0 },
  dashboardProgressDivider: { width: 1, marginHorizontal: 14 },
  dashboardProgressDot: { width: 8, height: 8, borderRadius: 4, marginBottom: 5 },
  dashboardProgressLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  dashboardProgressValue: { fontSize: 20, lineHeight: 26, letterSpacing: -0.7, marginTop: 2 },
  algoScoreRing: { width: 68, height: 68, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(124,58,237,0.24)", borderWidth: 1, borderColor: "rgba(34,211,238,0.42)" },
  algoScoreValue: { color: "#f8fafc", fontSize: 24, fontFamily: "Inter_800ExtraBold", lineHeight: 27 },
  algoScoreLabel: { color: "#93c5fd", fontSize: 9, fontFamily: "Inter_800ExtraBold", letterSpacing: 1 },
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
  negWarning:          { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, marginBottom: 14 },
  negWarningText:      { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium" },
  // 12-month outlook sheet
  negSheetOverlay:     { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.5)" },
  negSheet:            { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 36 },
  negSheetHandle:      { width: 40, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 16 },
  negSheetTitle:       { fontSize: 20, fontFamily: "Inter_700Bold", marginBottom: 4 },
  negSheetSub:         { fontSize: 13, fontFamily: "Inter_400Regular", marginBottom: 16 },
  negSheetLoading:     { minHeight: 160, alignItems: "center", justifyContent: "center", paddingVertical: 32 },
  negSheetRow:         { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  negSheetRowMonth:    { fontSize: 15, fontFamily: "Inter_600SemiBold", marginBottom: 2 },
  negSheetRowDetail:   { fontSize: 12, fontFamily: "Inter_400Regular" },
  negSheetBadge:       { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  negSheetBadgeText:   { fontSize: 10, fontFamily: "Inter_700Bold", color: "#fff" },
  negSheetClose:       { marginTop: 12, paddingVertical: 14, borderRadius: 12, alignItems: "center" },
  negSheetCloseText:   { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  // Financial Outlook
  zeroBudgetDashboardCard: { borderWidth: 1, borderRadius: 20, padding: 14, marginBottom: 14 },
  zeroBudgetDashboardHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  zeroBudgetDashboardTitle: { fontSize: 16, fontFamily: "Inter_800ExtraBold" },
  zeroBudgetDashboardSub: { fontSize: 11, fontFamily: "Inter_500Medium", marginTop: 2 },
  zeroBudgetDashboardStats: { flexDirection: "row", marginTop: 14 },
  zeroBudgetDashboardStat: { flex: 1, alignItems: "center" },
  zeroBudgetDashboardValue: { fontSize: 18, fontFamily: "Inter_800ExtraBold" },
  zeroBudgetDashboardLabel: { color: "#94a3b8", fontSize: 9, fontFamily: "Inter_700Bold", textTransform: "uppercase", marginTop: 2 },
  zeroBudgetDashboardAction: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 4, marginTop: 12 },
  categoryBudgetEditText: { fontSize: 10, fontFamily: "Inter_700Bold" },
  categoryPlanBadge: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5 },
  categoryPlanBadgeText: { fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
  categoryPlanIcon: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
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

  // Upcoming

  expenseBtns:        { flexDirection: "row", gap: 10 },
  expenseBtn:         { flex: 1, paddingVertical: 13, borderRadius: 12, alignItems: "center" },
  expenseBtnText:     { fontSize: 15, fontFamily: "Inter_600SemiBold" },

  // Action sheet modal
  modalOverlay:    { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.5)" },
  actionSheet:     { borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 12, paddingBottom: 36, paddingHorizontal: 20 },
  sheetHandle:     { width: 40, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 16 },
  swipeDismissHint: { fontSize: 10, fontFamily: "Inter_600SemiBold", textAlign: "center", marginTop: -10, marginBottom: 12 },
  sheetTitle:      { fontSize: 20, fontFamily: "Inter_700Bold", marginBottom: 4 },
  sheetSub:        { fontSize: 13, fontFamily: "Inter_400Regular", marginBottom: 16 },
  actionRow:       { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 14, borderTopWidth: 1 },
  actionIcon:      { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  actionLabel:     { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  actionSub:       { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  sheetCancel:     { marginTop: 14, paddingVertical: 14, alignItems: "center" },
  sheetCancelText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },

});
