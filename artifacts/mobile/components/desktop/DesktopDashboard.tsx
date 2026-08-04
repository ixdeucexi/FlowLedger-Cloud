import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  ViewStyle,
} from "react-native";
import Svg, {
  Circle,
  Defs,
  LinearGradient as SvgLinearGradient,
  Stop,
} from "react-native-svg";

import { useAuth } from "@/context/AuthContext";
import { useBudget } from "@/context/BudgetContext";
import { isActiveTransaction } from "@/lib/billMatching";
import {
  categoryBudgetStorageKey,
  loadCategoryBudgets,
  readCategoryBudgetCache,
  subscribeCategoryBudgets,
} from "@/lib/categoryBudgetStore";
import { buildDashboardFinancialModel } from "@/lib/dashboardFinancialModel";
import { WIDE_DESKTOP_BREAKPOINT } from "@/lib/desktopExperience";

type FeatherName = React.ComponentProps<typeof Feather>["name"];
type Accent = "cyan" | "purple" | "green" | "amber" | "blue" | "neutral";

type UpcomingBill = {
  key: string;
  id: string;
  name: string;
  category: string;
  amount: number;
  day: number;
  month: number;
  year: number;
  isDebt: boolean;
  pending: boolean;
};

const BRAND = {
  background: "#03040b",
  surface: "rgba(10, 16, 36, 0.92)",
  surfaceStrong: "rgba(12, 20, 44, 0.96)",
  text: "#f8fafc",
  muted: "#94a3b8",
  subtle: "#64748b",
  purple: "#9f5cff",
  blue: "#2f6fff",
  cyan: "#22d3ee",
  green: "#22c55e",
  amber: "#fbbf24",
  rose: "#fb7185",
} as const;

const ACCENTS: Record<Accent, { color: string; border: string; wash: string }> = {
  cyan: {
    color: BRAND.cyan,
    border: "rgba(34,211,238,0.28)",
    wash: "rgba(34,211,238,0.10)",
  },
  purple: {
    color: BRAND.purple,
    border: "rgba(159,92,255,0.28)",
    wash: "rgba(159,92,255,0.10)",
  },
  green: {
    color: BRAND.green,
    border: "rgba(34,197,94,0.27)",
    wash: "rgba(34,197,94,0.09)",
  },
  amber: {
    color: BRAND.amber,
    border: "rgba(251,191,36,0.26)",
    wash: "rgba(251,191,36,0.09)",
  },
  blue: {
    color: "#60a5fa",
    border: "rgba(47,111,255,0.29)",
    wash: "rgba(47,111,255,0.10)",
  },
  neutral: {
    color: "#a8b7cf",
    border: "rgba(148,163,184,0.16)",
    wash: "rgba(148,163,184,0.05)",
  },
};

const CATEGORY_COLORS = [
  BRAND.purple,
  BRAND.blue,
  BRAND.cyan,
  BRAND.green,
  BRAND.amber,
  "#f472b6",
];

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

function currency(value: number, digits = 0) {
  const safe = Number.isFinite(value) ? value : 0;
  return safe.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function displayName(user: ReturnType<typeof useAuth>["user"]) {
  const metadata = user?.user_metadata ?? {};
  const candidate =
    metadata.full_name ?? metadata.name ?? metadata.display_name;
  if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  if (user?.email) return user.email.split("@")[0].replace(/[._-]+/g, " ");
  return "John";
}

function greetingForHour(hour: number) {
  if (hour < 5) return "Good night";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function formatActivityDate(date: string) {
  const today = new Date();
  const local = new Date(`${date.slice(0, 10)}T12:00:00`);
  const dateKey = (value: Date) =>
    `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  const todayKey = dateKey(today);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.slice(0, 10) === todayKey) return "Today";
  if (date.slice(0, 10) === dateKey(yesterday)) return "Yesterday";
  return local.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatMonthDay(year: number, month: number, day: number) {
  return new Date(year, month, day).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function SurfaceCard({
  children,
  accent = "neutral",
  style,
  onPress,
  accessibilityLabel,
}: {
  children: React.ReactNode;
  accent?: Accent;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  accessibilityLabel?: string;
}) {
  const lift = useRef(new Animated.Value(0)).current;
  const tone = ACCENTS[accent];
  const animate = (value: number) => {
    Animated.timing(lift, {
      toValue: value,
      duration: 170,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  };

  return (
    <Pressable
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      onHoverIn={() => animate(1)}
      onHoverOut={() => animate(0)}
      style={[styles.cardPressable, style]}
    >
      <Animated.View
        style={[
          styles.card,
          {
            borderColor: tone.border,
            shadowColor: tone.color,
            transform: [
              {
                translateY: lift.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, -3],
                }),
              },
            ],
          },
        ]}
      >
        <View pointerEvents="none" style={[styles.cardAccent, { backgroundColor: tone.wash }]} />
        {children}
      </Animated.View>
    </Pressable>
  );
}

function ProgressBar({
  percent,
  color = BRAND.purple,
  height = 6,
}: {
  percent: number;
  color?: string;
  height?: number;
}) {
  const progress = useRef(new Animated.Value(0)).current;
  const clamped = Math.max(0, Math.min(100, Number(percent) || 0));

  useEffect(() => {
    Animated.timing(progress, {
      toValue: clamped,
      duration: 850,
      delay: 100,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [clamped, progress]);

  return (
    <View style={[styles.progressTrack, { height }]}>
      <Animated.View
        style={[
          styles.progressFill,
          {
            height,
            backgroundColor: color,
            width: progress.interpolate({
              inputRange: [0, 100],
              outputRange: ["0%", "100%"],
            }),
          },
        ]}
      />
    </View>
  );
}

function FlowScoreRing({ score }: { score: number }) {
  const size = 142;
  const strokeWidth = 10;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const animated = useRef(new Animated.Value(0)).current;
  const clamped = Math.max(0, Math.min(100, Number(score) || 0));

  useEffect(() => {
    Animated.timing(animated, {
      toValue: clamped,
      duration: 1100,
      delay: 120,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [animated, clamped]);

  return (
    <View
      style={styles.scoreRingWrap}
      accessibilityLabel={`Flow Score ${Math.round(clamped)} out of 100`}
    >
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <Defs>
          <SvgLinearGradient id="desktopScoreGradient" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={BRAND.purple} stopOpacity="1" />
            <Stop offset="0.52" stopColor={BRAND.cyan} stopOpacity="1" />
            <Stop offset="1" stopColor={BRAND.green} stopOpacity="1" />
          </SvgLinearGradient>
        </Defs>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="rgba(2,6,23,0.62)"
          stroke="rgba(148,163,184,0.15)"
          strokeWidth={strokeWidth}
        />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="transparent"
          stroke="url(#desktopScoreGradient)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={animated.interpolate({
            inputRange: [0, 100],
            outputRange: [circumference, 0],
          })}
          rotation="-90"
          originX={size / 2}
          originY={size / 2}
        />
      </Svg>
      <View style={styles.scoreRingCenter}>
        <Text style={styles.scoreValue}>{Math.round(clamped)}</Text>
        <Text style={styles.scoreLabel}>FLOW SCORE</Text>
      </View>
    </View>
  );
}

function SectionHeader({
  title,
  subtitle,
  action,
  onAction,
}: {
  title: string;
  subtitle?: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.sectionHeader}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}
      </View>
      {action && onAction ? (
        <Pressable
          accessibilityRole="button"
          onPress={onAction}
          style={({ pressed }) => [styles.sectionAction, { opacity: pressed ? 0.7 : 1 }]}
        >
          <Text style={styles.sectionActionText}>{action}</Text>
          <Feather name="arrow-up-right" size={13} color="#91a7c6" />
        </Pressable>
      ) : null}
    </View>
  );
}

function MetricCard({
  label,
  value,
  detail,
  icon,
  accent,
  width,
  percent,
  onPress,
}: {
  label: string;
  value: string;
  detail: string;
  icon: FeatherName;
  accent: Accent;
  width: string;
  percent?: number;
  onPress: () => void;
}) {
  const tone = ACCENTS[accent];
  return (
    <SurfaceCard
      accent={accent}
      style={{ flexBasis: width as never, flexGrow: 1, minWidth: 0 }}
      onPress={onPress}
      accessibilityLabel={`${label}: ${value}`}
    >
      <View style={styles.metricCard}>
        <View style={styles.metricHeader}>
          <Text style={styles.metricLabel}>{label.toUpperCase()}</Text>
          <View style={[styles.metricIcon, { backgroundColor: tone.wash, borderColor: tone.border }]}>
            <Feather name={icon} size={15} color={tone.color} />
          </View>
        </View>
        <Text style={styles.metricValue}>{value}</Text>
        {percent !== undefined ? (
          <View style={styles.metricProgress}>
            <ProgressBar percent={percent} color={tone.color} height={4} />
          </View>
        ) : null}
        <Text style={styles.metricDetail} numberOfLines={1}>{detail}</Text>
      </View>
    </SurfaceCard>
  );
}

function EmptyState({ icon, text }: { icon: FeatherName; text: string }) {
  return (
    <View style={styles.emptyState}>
      <View style={styles.emptyIcon}>
        <Feather name={icon} size={16} color="#7f91ad" />
      </View>
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

export function DesktopDashboard() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { user } = useAuth();
  const {
    accounts,
    activeHousehold,
    categories,
    connectedBankAccounts,
    forecastConfidence,
    getBillMonthlyTotal,
    getBillOccurrencesInMonth,
    getCashFlow,
    getDailyBalances,
    getMonthlyBills,
    getMonthlyIncome,
    getPaidAmount,
    getTransactionsForMonth,
    goals,
    incomes,
    pendingBankTransactions,
    pendingPlanMatches,
    selectedYear,
    setDashboardFilter,
    settings,
  } = useBudget();

  const now = new Date();
  const currentMonth = now.getMonth();
  const today = now.getDate();
  const isWide = width >= WIDE_DESKTOP_BREAKPOINT;
  const isPrimaryRow = width >= 1180;
  const metricWidth = isWide ? "23.5%" : "48%";
  const detailWidth = isWide ? "31.5%" : width >= 1100 ? "48%" : "100%";
  const name = displayName(user);
  const firstName = name.split(/\s+/)[0] || name;

  const dailyBalances = useMemo(
    () => getDailyBalances(currentMonth, selectedYear),
    [currentMonth, getDailyBalances, selectedYear],
  );
  const cashFlow = useMemo(
    () => getCashFlow(currentMonth, selectedYear),
    [currentMonth, getCashFlow, selectedYear],
  );

  const categoryBudgetScope = useMemo(
    () => ({
      userId: user?.id,
      householdId: activeHousehold?.householdId,
      budgetId: activeHousehold?.budgetId,
    }),
    [activeHousehold?.budgetId, activeHousehold?.householdId, user?.id],
  );
  const categoryBudgetKey = useMemo(
    () => categoryBudgetStorageKey(currentMonth, selectedYear, categoryBudgetScope),
    [categoryBudgetScope, currentMonth, selectedYear],
  );
  const [categoryBudgets, setCategoryBudgets] = useState<Record<string, number>>({});

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      setCategoryBudgets(
        readCategoryBudgetCache(currentMonth, selectedYear, categoryBudgetScope),
      );
      void loadCategoryBudgets(categoryBudgetScope, currentMonth, selectedYear).then((next) => {
        if (!cancelled) setCategoryBudgets(next);
      });
    };
    refresh();
    const unsubscribe = subscribeCategoryBudgets(refresh);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [categoryBudgetKey, categoryBudgetScope, currentMonth, selectedYear]);

  const dashboardModel = useMemo(
    () => buildDashboardFinancialModel({
      now,
      selectedYear,
      settings,
      forecastConfidence,
      accounts,
      connectedBankAccounts,
      pendingBankTransactions,
      pendingPlanMatches,
      categories,
      categoryBudgets,
      goals,
      incomes,
      cashFlow,
      currentMonthBalances: dailyBalances,
      getMonthlyBills,
      getMonthlyIncome,
      getTransactionsForMonth,
      getDailyBalances,
      getBillMonthlyTotal,
      getPaidAmount,
      getBillOccurrencesInMonth,
    }),
    [
      accounts,
      cashFlow,
      categories,
      categoryBudgets,
      connectedBankAccounts,
      currentMonth,
      dailyBalances,
      forecastConfidence,
      getBillMonthlyTotal,
      getBillOccurrencesInMonth,
      getDailyBalances,
      getMonthlyBills,
      getMonthlyIncome,
      getPaidAmount,
      getTransactionsForMonth,
      goals,
      incomes,
      pendingBankTransactions,
      pendingPlanMatches,
      selectedYear,
      settings,
      today,
    ],
  );
  const {
    activeAccountCount,
    activePendingMatches,
    algorithmSuite,
    categoryPlan,
    checkingAccountBalance: checkingBalance,
    currentGoals: activeGoals,
    goalPercent,
    goalTotals,
    monthTransactions,
    monthlyIncome,
    pendingCheckingSummary,
    savingsAccountBalance: savingsBalance,
    unpaidCount,
    unpaidTotal,
  } = dashboardModel;

  const upcoming = useMemo(() => {
    const candidates: UpcomingBill[] = [];
    const appendMonth = (month: number, year: number, minimumDay: number) => {
      getMonthlyBills(month, year).forEach((bill) => {
        const days = getBillOccurrencesInMonth(bill, month, year).sort((a, b) => a - b);
        if (!days.length) return;
        const monthlyTotal = getBillMonthlyTotal(bill, month, year);
        const occurrenceAmount = monthlyTotal / days.length;
        let paidRemaining = getPaidAmount(bill.id, month, year);
        days.forEach((day) => {
          const paid = Math.min(occurrenceAmount, Math.max(0, paidRemaining));
          paidRemaining = Math.max(0, paidRemaining - paid);
          const remaining = Math.max(0, occurrenceAmount - paid);
          if (remaining <= 0.005 || day < minimumDay) return;
          const occurrenceDate = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          candidates.push({
            key: `${bill.id}:${occurrenceDate}`,
            id: bill.id,
            name: bill.name,
            category: bill.is_debt ? "Debt payment" : bill.category || "Bill",
            amount: remaining,
            day,
            month,
            year,
            isDebt: bill.is_debt,
            pending: activePendingMatches.some(
              (match) =>
                match.target_id === bill.id && match.occurrence_date === occurrenceDate,
            ),
          });
        });
      });
    };

    appendMonth(currentMonth, selectedYear, today);
    if (candidates.length < 5) {
      const nextMonth = (currentMonth + 1) % 12;
      const nextYear = selectedYear + (currentMonth === 11 ? 1 : 0);
      appendMonth(nextMonth, nextYear, 1);
    }
    return candidates
      .sort(
        (left, right) =>
          left.year - right.year || left.month - right.month || left.day - right.day,
      )
      .slice(0, 5);
  }, [
    activePendingMatches,
    currentMonth,
    getBillMonthlyTotal,
    getBillOccurrencesInMonth,
    getMonthlyBills,
    getPaidAmount,
    selectedYear,
    today,
  ]);

  const recentActivity = useMemo(
    () =>
      monthTransactions
        .filter(isActiveTransaction)
        .sort((left, right) => right.date.localeCompare(left.date))
        .slice(0, 5),
    [monthTransactions],
  );
  const available = algorithmSuite.safeCushion.amount;
  const progress = algorithmSuite.stability;
  const nextMilestone =
    [7, 30, 60, 90, 180].find((day) => day > progress.protectedDays) ?? 180;

  const chartBars = useMemo(() => {
    const values = dailyBalances
      .filter((day) => day.day <= today)
      .slice(-14)
      .map((day) => day.balance);
    if (!values.length) return Array.from({ length: 14 }, () => 26);
    const minimum = Math.min(...values);
    const maximum = Math.max(...values);
    const range = Math.max(1, maximum - minimum);
    return values.map((value) => 20 + ((value - minimum) / range) * 52);
  }, [dailyBalances, today]);

  const go = (pathname: string, params?: Record<string, string>) =>
    router.push({ pathname: pathname as never, params } as never);
  const openBills = (filter: "bills" | "debt" = "bills") => {
    setDashboardFilter(filter);
    go("/(tabs)/bills");
  };
  const askFlo = (prompt: string) => go("/(tabs)/flo", { prompt });

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View pointerEvents="none" style={styles.ambientLayer}>
        <View style={styles.ambientPurple} />
        <View style={styles.ambientBlue} />
        <View style={styles.ambientCyan} />
        <View style={styles.ambientGrid} />
      </View>

      <View style={styles.pageHeader}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.greeting}>
            {greetingForHour(now.getHours())}, {firstName}
          </Text>
          <Text style={styles.greetingSub}>Here&apos;s your financial overview for today.</Text>
        </View>
        <View style={styles.planStatus}>
          <View style={styles.planStatusDot} />
          <View>
            <Text style={styles.planStatusLabel}>LIVE PLAN</Text>
            <Text style={styles.planStatusValue}>{forecastConfidence.label} confidence</Text>
          </View>
        </View>
      </View>

      <View style={styles.metricGrid}>
        <MetricCard
          label="Available to Spend"
          value={currency(available, 2)}
          detail={
            algorithmSuite.safeCushion.status === "safe"
              ? "Safe above your protection floor"
              : "Review the lowest projected balance"
          }
          icon="dollar-sign"
          accent="green"
          width={metricWidth}
          onPress={() => askFlo(`Explain why I have ${currency(available)} available to spend.`)}
        />
        <MetricCard
          label="Upcoming Bills"
          value={currency(unpaidTotal, 2)}
          detail={`${unpaidCount} ${unpaidCount === 1 ? "bill" : "bills"} remaining this month`}
          icon="file-text"
          accent="amber"
          width={metricWidth}
          onPress={() => openBills("bills")}
        />
        <MetricCard
          label="Monthly Income"
          value={currency(monthlyIncome, 2)}
          detail={`${incomes.length} active income ${incomes.length === 1 ? "source" : "sources"}`}
          icon="trending-up"
          accent="purple"
          width={metricWidth}
          onPress={() => go("/(tabs)/more", { section: "money" })}
        />
        <MetricCard
          label="Goal Progress"
          value={`${Math.round(goalPercent)}%`}
          detail={`${currency(goalTotals.current)} of ${currency(goalTotals.target)} funded`}
          icon="target"
          accent="cyan"
          width={metricWidth}
          percent={goalPercent}
          onPress={() => go("/(tabs)/more", { section: "goals" })}
        />
      </View>

      <View style={[styles.primaryGrid, !isPrimaryRow && styles.primaryGridStacked]}>
        <View style={styles.primaryColumn}>
          <SurfaceCard
            accent="blue"
            style={styles.accountCardWrap}
            accessibilityLabel={`Checking balance ${currency(checkingBalance, 2)}. Flow Score ${algorithmSuite.flowScore.score}.`}
          >
            <View style={styles.accountCard}>
              <View style={styles.accountHeader}>
                <View>
                  <Text style={styles.cardEyebrow}>CHECKING BALANCE</Text>
                  <Text style={styles.checkingValue}>{currency(checkingBalance, 2)}</Text>
                  <Text style={styles.accountMeta}>
                    {pendingCheckingSummary && pendingCheckingSummary.pendingCount > 0
                      ? `${currency(pendingCheckingSummary.availableBalance, 2)} available after ${pendingCheckingSummary.pendingCount} pending`
                      : `${activeAccountCount} active ${activeAccountCount === 1 ? "account" : "accounts"}`}
                  </Text>
                </View>
                <View style={styles.accountPills}>
                  <Pressable
                    onPress={() => go("/(tabs)/more", { section: "accounts" })}
                    style={({ pressed }) => [styles.accountPill, { opacity: pressed ? 0.7 : 1 }]}
                  >
                    <Feather name="refresh-cw" size={12} color="#a7b8d2" />
                    <Text style={styles.accountPillText}>Accounts</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => askFlo("Explain my checking balance and what is safe to spend.")}
                    style={({ pressed }) => [styles.accountPill, styles.floPill, { opacity: pressed ? 0.7 : 1 }]}
                  >
                    <Feather name="message-circle" size={12} color="#d8b4fe" />
                    <Text style={[styles.accountPillText, { color: "#e9ddff" }]}>Flo</Text>
                  </Pressable>
                </View>
              </View>

              <View style={styles.accountBody}>
                <View style={styles.balancePathWrap}>
                  <View style={styles.balancePathHeader}>
                    <Text style={styles.balancePathLabel}>14-DAY BALANCE PATH</Text>
                    <Text style={styles.savingsText}>{currency(savingsBalance)} saved</Text>
                  </View>
                  <View style={styles.balanceBars}>
                    {chartBars.map((height, index) => (
                      <View
                        key={`${index}:${Math.round(height)}`}
                        style={[
                          styles.balanceBar,
                          {
                            height,
                            opacity: 0.42 + (index / Math.max(1, chartBars.length - 1)) * 0.5,
                          },
                        ]}
                      />
                    ))}
                  </View>
                  <View style={styles.balancePathFooter}>
                    <View style={styles.balanceSignal}>
                      <Feather
                        name={cashFlow.remaining >= 0 ? "arrow-up-right" : "arrow-down-right"}
                        size={14}
                        color={cashFlow.remaining >= 0 ? BRAND.green : BRAND.rose}
                      />
                      <Text
                        style={[
                          styles.balanceSignalText,
                          { color: cashFlow.remaining >= 0 ? "#86efac" : "#fda4af" },
                        ]}
                      >
                        {currency(Math.abs(cashFlow.remaining))} {cashFlow.remaining >= 0 ? "left" : "short"} this month
                      </Text>
                    </View>
                  </View>
                </View>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Flow Score ${algorithmSuite.flowScore.score}. ${algorithmSuite.flowScore.label}.`}
                  onPress={() => askFlo(`Why is my Flow Score ${algorithmSuite.flowScore.score}?`)}
                  style={({ pressed }) => [styles.scoreSummary, { opacity: pressed ? 0.76 : 1 }]}
                >
                  <FlowScoreRing score={algorithmSuite.flowScore.score} />
                  <Text style={styles.scoreStatus}>{algorithmSuite.flowScore.label}</Text>
                  <Text style={styles.scoreReason} numberOfLines={2}>
                    {algorithmSuite.flowScore.topReason}
                  </Text>
                </Pressable>
              </View>
            </View>
          </SurfaceCard>

          <SurfaceCard accent="neutral" style={styles.recentCardWrap} accessibilityLabel="Recent activity">
            <View style={styles.sectionCardContent}>
              <SectionHeader
                title="Recent Activity"
                subtitle="The latest activity shown in your PWA"
                action="View all"
                onAction={() => go("/(tabs)/transactions")}
              />
              <View style={styles.activityList}>
                {recentActivity.length ? (
                  recentActivity.map((transaction, index) => {
                    const positive = transaction.amount >= 0;
                    return (
                      <View
                        key={transaction.id}
                        style={[styles.activityRow, index > 0 && styles.rowDivider]}
                      >
                        <View
                          style={[
                            styles.activityIcon,
                            {
                              backgroundColor: positive
                                ? "rgba(34,197,94,0.12)"
                                : "rgba(47,111,255,0.12)",
                              borderColor: positive
                                ? "rgba(34,197,94,0.18)"
                                : "rgba(47,111,255,0.18)",
                            },
                          ]}
                        >
                          <Feather
                            name={positive ? "arrow-down-left" : "shopping-bag"}
                            size={15}
                            color={positive ? "#4ade80" : "#7cb2ff"}
                          />
                        </View>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={styles.activityName} numberOfLines={1}>
                            {transaction.merchant_name ||
                              transaction.note ||
                              transaction.category ||
                              "Transaction"}
                          </Text>
                          <Text style={styles.activityMeta} numberOfLines={1}>
                            {transaction.review_status === "needs_review"
                              ? "Needs review"
                              : transaction.category || (positive ? "Income" : "Spending")}
                          </Text>
                        </View>
                        <View style={styles.activityAmountWrap}>
                          <Text
                            style={[
                              styles.activityAmount,
                              { color: positive ? "#4ade80" : BRAND.text },
                            ]}
                          >
                            {positive ? "+" : "−"}{currency(Math.abs(transaction.amount), 2)}
                          </Text>
                          <Text style={styles.activityDate}>{formatActivityDate(transaction.date)}</Text>
                        </View>
                      </View>
                    );
                  })
                ) : (
                  <EmptyState icon="activity" text="Your recent activity will appear here." />
                )}
              </View>
            </View>
          </SurfaceCard>
        </View>

        <View style={styles.primaryColumn}>
          <SurfaceCard accent="purple" style={styles.stabilityWrap} accessibilityLabel={`Stability path: ${progress.stageLabel}`}>
            <View style={styles.stabilityCard}>
              <View style={styles.stabilityHeader}>
                <View style={styles.stabilityIcon}>
                  <Feather name="shield" size={18} color="#d8b4fe" />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.stabilityEyebrow}>STABILITY PATH</Text>
                  <Text style={styles.stabilityTitle}>{progress.stageLabel}</Text>
                </View>
                <View
                  style={[
                    styles.statusBadge,
                    progress.status === "risk"
                      ? styles.statusRisk
                      : progress.status === "watch"
                        ? styles.statusWatch
                        : styles.statusSafe,
                  ]}
                >
                  <View
                    style={[
                      styles.statusDot,
                      {
                        backgroundColor:
                          progress.status === "risk"
                            ? BRAND.rose
                            : progress.status === "watch"
                              ? BRAND.amber
                              : BRAND.green,
                      },
                    ]}
                  />
                  <Text style={styles.statusText}>
                    {progress.status === "risk"
                      ? "ACT NOW"
                      : progress.status === "watch"
                        ? "BUILDING"
                        : "ON TRACK"}
                  </Text>
                </View>
              </View>

              <View style={styles.stabilitySummary}>
                <View style={styles.protectedMetric}>
                  <Text style={styles.protectedValue}>{progress.protectedDays}</Text>
                  <View>
                    <Text style={styles.protectedUnit}>days</Text>
                    <Text style={styles.protectedSub}>backed up</Text>
                  </View>
                </View>
                <View style={styles.summaryDivider} />
                <View style={styles.summaryMetric}>
                  <Text style={styles.summaryLabel}>NEXT GOAL</Text>
                  <Text style={styles.summaryValue}>{nextMilestone} protected days</Text>
                </View>
                <View style={styles.summaryDivider} />
                <View style={styles.summaryMetric}>
                  <Text style={styles.summaryLabel}>PROTECTED AMOUNT</Text>
                  <Text style={styles.summaryValue}>{currency(progress.protectedAmount)}</Text>
                </View>
              </View>

              <View style={styles.stabilityCallout}>
                <View style={styles.calloutIcon}>
                  <Feather name="check" size={13} color="#5ee6b5" />
                </View>
                <Text style={styles.stabilityCalloutText} numberOfLines={2}>
                  {progress.explanation}
                </Text>
              </View>

              <View style={styles.pathHeader}>
                <Text style={styles.pathLabel}>180-day path</Text>
                <Text style={styles.pathPercent}>{Math.round(progress.reserveProgress * 100)}%</Text>
              </View>
              <ProgressBar percent={progress.reserveProgress * 100} color={BRAND.purple} height={7} />
              <View style={styles.pathMilestones}>
                {[7, 30, 60, 90, 180].map((day) => (
                  <Text key={day} style={styles.pathMilestone}>{day}d</Text>
                ))}
              </View>

              <View style={styles.nextAction}>
                <View style={styles.nextActionIcon}>
                  <Feather name="arrow-up-right" size={16} color="#e2c6ff" />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.nextActionLabel}>NEXT</Text>
                  <Text style={styles.nextActionText} numberOfLines={2}>{progress.nextAction}</Text>
                </View>
                <Pressable
                  onPress={() => askFlo(`Explain my stability path and why ${progress.nextAction}`)}
                  style={({ pressed }) => [styles.floButton, { opacity: pressed ? 0.72 : 1 }]}
                >
                  <Feather name="message-circle" size={13} color="#ffffff" />
                  <Text style={styles.floButtonText}>Ask Flo</Text>
                </Pressable>
              </View>

              <Pressable
                onPress={() => go("/(tabs)/how-flowledger-works", { section: "stability" })}
                style={({ pressed }) => [styles.howItWorks, { opacity: pressed ? 0.7 : 1 }]}
              >
                <Feather name="book-open" size={14} color="#9db2d0" />
                <Text style={styles.howItWorksText}>How Stability Path works</Text>
              </Pressable>
            </View>
          </SurfaceCard>

          <SurfaceCard accent="neutral" style={styles.quickCardWrap} accessibilityLabel="Quick actions">
            <View style={styles.sectionCardContent}>
              <SectionHeader title="Quick Actions" subtitle="Keep your plan current" />
              <View style={styles.quickGrid}>
                {[
                  {
                    label: "Add Income",
                    icon: "arrow-down-left" as const,
                    color: BRAND.green,
                    onPress: () => go("/(tabs)/more", { section: "money", add: "income" }),
                  },
                  {
                    label: "Add Bill",
                    icon: "file-plus" as const,
                    color: "#60a5fa",
                    onPress: () => openBills("bills"),
                  },
                  {
                    label: "Add Debt",
                    icon: "credit-card" as const,
                    color: BRAND.purple,
                    onPress: () => openBills("debt"),
                  },
                  {
                    label: "Add Goal",
                    icon: "target" as const,
                    color: "#f472b6",
                    onPress: () => go("/(tabs)/more", { section: "goals" }),
                  },
                ].map((action) => (
                  <Pressable
                    key={action.label}
                    accessibilityRole="button"
                    accessibilityLabel={action.label}
                    onPress={action.onPress}
                    style={({ pressed }) => [
                      styles.quickAction,
                      { opacity: pressed ? 0.72 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] },
                    ]}
                  >
                    <View
                      style={[
                        styles.quickIcon,
                        {
                          backgroundColor: `${action.color}16`,
                          borderColor: `${action.color}36`,
                        },
                      ]}
                    >
                      <Feather name={action.icon} size={19} color={action.color} />
                    </View>
                    <Text style={styles.quickLabel}>{action.label}</Text>
                  </Pressable>
                ))}
              </View>
              <View style={styles.quickFooter}>
                <Pressable
                  onPress={() => askFlo("Can I afford a purchase? Help me choose a safe amount and date.")}
                  style={({ pressed }) => [styles.quickFooterButton, { opacity: pressed ? 0.7 : 1 }]}
                >
                  <Feather name="help-circle" size={14} color={BRAND.amber} />
                  <Text style={styles.quickFooterText}>Can I afford it?</Text>
                </Pressable>
                <Pressable
                  onPress={() => go("/(tabs)/flo")}
                  style={({ pressed }) => [styles.quickFooterButton, { opacity: pressed ? 0.7 : 1 }]}
                >
                  <Feather name="message-circle" size={14} color={BRAND.cyan} />
                  <Text style={styles.quickFooterText}>Ask Flo</Text>
                </Pressable>
              </View>
            </View>
          </SurfaceCard>
        </View>
      </View>

      <View style={styles.detailGrid}>
        <SurfaceCard
          accent="amber"
          style={{ flexBasis: detailWidth as never, flexGrow: 1, minWidth: 0 }}
          accessibilityLabel="Upcoming bills timeline"
        >
          <View style={styles.sectionCardContent}>
            <SectionHeader
              title="Upcoming Bills"
              subtitle="The next unpaid occurrences"
              action="Manage"
              onAction={() => openBills("bills")}
            />
            <View style={styles.timelineList}>
              {upcoming.length ? (
                upcoming.map((bill, index) => (
                  <View key={bill.key} style={[styles.timelineRow, index > 0 && styles.rowDivider]}>
                    <View style={styles.timelineDate}>
                      <Text style={styles.timelineMonth}>
                        {new Date(bill.year, bill.month, 1)
                          .toLocaleDateString("en-US", { month: "short" })
                          .toUpperCase()}
                      </Text>
                      <Text style={styles.timelineDay}>{bill.day}</Text>
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.timelineName} numberOfLines={1}>{bill.name}</Text>
                      <Text style={styles.timelineMeta} numberOfLines={1}>
                        {bill.category} · {formatMonthDay(bill.year, bill.month, bill.day)}
                        {bill.pending ? " · pending at bank" : ""}
                      </Text>
                    </View>
                    <Text style={styles.timelineAmount}>{currency(bill.amount, 2)}</Text>
                  </View>
                ))
              ) : (
                <EmptyState icon="calendar" text="No upcoming bills are waiting." />
              )}
            </View>
          </View>
        </SurfaceCard>

        <SurfaceCard
          accent="blue"
          style={{ flexBasis: detailWidth as never, flexGrow: 1, minWidth: 0 }}
          accessibilityLabel="Budget categories"
        >
          <View style={styles.sectionCardContent}>
            <SectionHeader
              title="Budget Categories"
              subtitle={
                settings.zeroBasedBudgetEnabled
                  ? "The same category plan shown in your PWA"
                  : "Zero-based budgeting is currently off"
              }
              action="Open budget"
              onAction={() => go("/(tabs)/category-budget")}
            />
            <View style={styles.categoryList}>
              {categoryPlan.length ? (
                categoryPlan.slice(0, 5).map((row, index) => {
                  const color =
                    row.status === "over"
                      ? BRAND.rose
                      : row.status === "watch"
                        ? BRAND.amber
                        : CATEGORY_COLORS[index % CATEGORY_COLORS.length];
                  return (
                    <View key={row.category} style={styles.categoryRow}>
                      <View style={styles.categoryLabelRow}>
                        <View style={[styles.categoryDot, { backgroundColor: color }]} />
                        <Text style={styles.categoryName} numberOfLines={1}>{row.category}</Text>
                        <Text style={styles.categoryAmount}>
                          {currency(row.spent)} <Text style={styles.categoryBudget}>/ {currency(row.budgeted)}</Text>
                        </Text>
                      </View>
                      <ProgressBar percent={row.percentUsed} color={color} height={5} />
                    </View>
                  );
                })
              ) : (
                <EmptyState
                  icon="pie-chart"
                  text={
                    settings.zeroBasedBudgetEnabled
                      ? "Your category plan will appear as budgets and activity are added."
                      : "Turn on Zero-Based Budgeting to see category progress here."
                  }
                />
              )}
            </View>
          </View>
        </SurfaceCard>

        <SurfaceCard
          accent="green"
          style={{ flexBasis: detailWidth as never, flexGrow: 1, minWidth: 0 }}
          accessibilityLabel="Goal progress"
        >
          <View style={styles.sectionCardContent}>
            <SectionHeader
              title="Goal Progress"
              subtitle="Active goals from your shared plan"
              action="View goals"
              onAction={() => go("/(tabs)/more", { section: "goals" })}
            />
            <View style={styles.goalSummary}>
              <View>
                <Text style={styles.goalSummaryValue}>{Math.round(goalPercent)}%</Text>
                <Text style={styles.goalSummaryLabel}>overall funded</Text>
              </View>
              <View style={styles.goalSummaryMoney}>
                <Text style={styles.goalFunded}>{currency(goalTotals.current)}</Text>
                <Text style={styles.goalTarget}>of {currency(goalTotals.target)}</Text>
              </View>
            </View>
            <ProgressBar percent={goalPercent} color={BRAND.green} height={7} />
            <View style={styles.goalList}>
              {activeGoals.length ? (
                activeGoals.slice(0, 3).map((goal, index) => {
                  const percent =
                    goal.target_amount > 0
                      ? Math.min(100, (goal.current_amount / goal.target_amount) * 100)
                      : 0;
                  return (
                    <View key={goal.id} style={[styles.goalRow, index > 0 && styles.rowDivider]}>
                      <View style={styles.goalIcon}>
                        <Feather
                          name={goal.goal_type === "savings" ? "shield" : "star"}
                          size={14}
                          color="#6ee7b7"
                        />
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.goalName} numberOfLines={1}>{goal.name}</Text>
                        <Text style={styles.goalMeta}>{Math.round(percent)}% funded</Text>
                      </View>
                      <Text style={styles.goalAmount}>{currency(goal.current_amount)}</Text>
                    </View>
                  );
                })
              ) : (
                <EmptyState icon="target" text="Add a goal to start tracking progress." />
              )}
            </View>
          </View>
        </SurfaceCard>
      </View>

      <View style={styles.footer}>
        <View style={styles.footerBrand}>
          <View style={styles.footerDot} />
          <Text style={styles.footerText}>FlowLedger Algo · one plan across web and PWA</Text>
        </View>
        <Text style={styles.footerMeta}>Forecast confidence: {forecastConfidence.label}</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "transparent" },
  content: {
    width: "100%",
    maxWidth: 1580,
    alignSelf: "center",
    paddingHorizontal: 26,
    paddingTop: 28,
    paddingBottom: 34,
    gap: 16,
    position: "relative",
  },
  ambientLayer: { ...StyleSheet.absoluteFillObject, overflow: "hidden" },
  ambientPurple: {
    position: "absolute",
    width: 520,
    height: 520,
    borderRadius: 260,
    top: -310,
    right: 30,
    backgroundColor: "rgba(124,58,237,0.08)",
    shadowColor: BRAND.purple,
    shadowOpacity: 0.22,
    shadowRadius: 105,
    shadowOffset: { width: 0, height: 0 },
  },
  ambientBlue: {
    position: "absolute",
    width: 520,
    height: 520,
    borderRadius: 260,
    top: 420,
    left: -390,
    backgroundColor: "rgba(37,99,235,0.07)",
    shadowColor: BRAND.blue,
    shadowOpacity: 0.2,
    shadowRadius: 110,
    shadowOffset: { width: 0, height: 0 },
  },
  ambientCyan: {
    position: "absolute",
    width: 380,
    height: 380,
    borderRadius: 190,
    bottom: 40,
    right: -240,
    backgroundColor: "rgba(34,211,238,0.05)",
    shadowColor: BRAND.cyan,
    shadowOpacity: 0.18,
    shadowRadius: 100,
    shadowOffset: { width: 0, height: 0 },
  },
  ambientGrid: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: "rgba(148,163,184,0.03)",
  },
  pageHeader: {
    minHeight: 70,
    flexDirection: "row",
    alignItems: "center",
    gap: 20,
  },
  greeting: {
    color: BRAND.text,
    fontSize: 27,
    lineHeight: 34,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.8,
  },
  greetingSub: {
    color: BRAND.muted,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: "Inter_500Medium",
    marginTop: 4,
  },
  planStatus: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(34,197,94,0.18)",
    backgroundColor: "rgba(34,197,94,0.06)",
  },
  planStatusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: BRAND.green,
    shadowColor: BRAND.green,
    shadowOpacity: 0.7,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  planStatusLabel: {
    color: "#73dba6",
    fontSize: 8,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: 1.1,
  },
  planStatusValue: {
    color: "#b5c3d8",
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    marginTop: 2,
  },
  cardPressable: { minWidth: 0 },
  card: {
    flex: 1,
    minWidth: 0,
    borderRadius: 20,
    borderWidth: 1,
    backgroundColor: BRAND.surface,
    overflow: "hidden",
    shadowOpacity: 0.09,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 12 },
  },
  cardAccent: {
    position: "absolute",
    width: 160,
    height: 160,
    borderRadius: 80,
    top: -112,
    right: -72,
    shadowColor: "#ffffff",
    shadowOpacity: 0.03,
    shadowRadius: 45,
    shadowOffset: { width: 0, height: 0 },
  },
  metricGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  metricCard: { minHeight: 126, padding: 16 },
  metricHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  metricLabel: {
    flex: 1,
    color: "#a9b5c8",
    fontSize: 9,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: 0.72,
  },
  metricIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  metricValue: {
    color: "#ffffff",
    fontSize: 23,
    lineHeight: 29,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: -0.7,
    marginTop: 10,
  },
  metricProgress: { marginTop: 8 },
  metricDetail: {
    color: "#8190a7",
    fontSize: 9,
    fontFamily: "Inter_500Medium",
    marginTop: 7,
  },
  progressTrack: {
    width: "100%",
    borderRadius: 999,
    backgroundColor: "rgba(148,163,184,0.14)",
    overflow: "hidden",
  },
  progressFill: {
    borderRadius: 999,
    shadowColor: "#ffffff",
    shadowOpacity: 0.18,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 0 },
  },
  primaryGrid: { flexDirection: "row", alignItems: "stretch", gap: 14 },
  primaryGridStacked: { flexDirection: "column" },
  primaryColumn: { flex: 1, minWidth: 0, gap: 14 },
  accountCardWrap: { minHeight: 338 },
  accountCard: { flex: 1, padding: 20 },
  accountHeader: { flexDirection: "row", alignItems: "flex-start", gap: 14 },
  cardEyebrow: {
    color: "#a8b5ca",
    fontSize: 9,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: 0.8,
  },
  checkingValue: {
    color: "#ffffff",
    fontSize: 32,
    lineHeight: 39,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: -1.1,
    marginTop: 4,
  },
  accountMeta: {
    color: "#8292aa",
    fontSize: 10,
    fontFamily: "Inter_500Medium",
    marginTop: 4,
  },
  accountPills: { marginLeft: "auto", flexDirection: "row", gap: 7 },
  accountPill: {
    height: 30,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.15)",
    backgroundColor: "rgba(15,23,42,0.7)",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 9,
  },
  floPill: {
    borderColor: "rgba(159,92,255,0.25)",
    backgroundColor: "rgba(124,58,237,0.12)",
  },
  accountPillText: { color: "#aab8cd", fontSize: 9, fontFamily: "Inter_700Bold" },
  accountBody: { flex: 1, flexDirection: "row", alignItems: "stretch", gap: 18, marginTop: 18 },
  balancePathWrap: {
    flex: 1,
    minWidth: 0,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(47,111,255,0.15)",
    backgroundColor: "rgba(2,6,23,0.36)",
    padding: 14,
  },
  balancePathHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  balancePathLabel: {
    flex: 1,
    color: "#71829e",
    fontSize: 8,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: 0.7,
  },
  savingsText: { color: "#76deb3", fontSize: 9, fontFamily: "Inter_700Bold" },
  balanceBars: {
    height: 82,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 5,
    paddingTop: 10,
  },
  balanceBar: {
    flex: 1,
    minWidth: 3,
    maxWidth: 14,
    borderRadius: 999,
    backgroundColor: BRAND.cyan,
    shadowColor: BRAND.cyan,
    shadowOpacity: 0.26,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 0 },
  },
  balancePathFooter: { marginTop: 8 },
  balanceSignal: { flexDirection: "row", alignItems: "center", gap: 6 },
  balanceSignalText: { fontSize: 9, fontFamily: "Inter_700Bold" },
  scoreSummary: {
    width: 178,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(159,92,255,0.16)",
    backgroundColor: "rgba(2,6,23,0.3)",
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  scoreRingWrap: { width: 142, height: 142, alignItems: "center", justifyContent: "center" },
  scoreRingCenter: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  scoreValue: {
    color: "#ffffff",
    fontSize: 30,
    lineHeight: 34,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: -1,
  },
  scoreLabel: {
    color: "#aab6cb",
    fontSize: 7,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: 0.9,
    marginTop: 1,
  },
  scoreStatus: { color: "#63e6b1", fontSize: 11, fontFamily: "Inter_800ExtraBold", marginTop: 2 },
  scoreReason: {
    color: "#7e8ca3",
    fontSize: 8,
    lineHeight: 12,
    textAlign: "center",
    fontFamily: "Inter_500Medium",
    marginTop: 4,
  },
  recentCardWrap: { minHeight: 310 },
  sectionCardContent: { flex: 1, padding: 18 },
  sectionHeader: { flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: 12 },
  sectionTitle: { color: BRAND.text, fontSize: 14, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.25 },
  sectionSubtitle: { color: "#77879f", fontSize: 9, fontFamily: "Inter_500Medium", marginTop: 3 },
  sectionAction: { flexDirection: "row", alignItems: "center", gap: 5, paddingVertical: 4 },
  sectionActionText: { color: "#91a7c6", fontSize: 9, fontFamily: "Inter_700Bold" },
  activityList: { flex: 1 },
  activityRow: { minHeight: 49, flexDirection: "row", alignItems: "center", gap: 10 },
  rowDivider: { borderTopWidth: 1, borderTopColor: "rgba(148,163,184,0.09)" },
  activityIcon: {
    width: 31,
    height: 31,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  activityName: { color: "#e8eef8", fontSize: 10, fontFamily: "Inter_700Bold" },
  activityMeta: { color: "#6f7d94", fontSize: 8, fontFamily: "Inter_500Medium", marginTop: 2 },
  activityAmountWrap: { alignItems: "flex-end" },
  activityAmount: { fontSize: 10, fontFamily: "Inter_800ExtraBold" },
  activityDate: { color: "#627087", fontSize: 8, fontFamily: "Inter_500Medium", marginTop: 2 },
  stabilityWrap: { minHeight: 458 },
  stabilityCard: { flex: 1, padding: 20 },
  stabilityHeader: { flexDirection: "row", alignItems: "center", gap: 11 },
  stabilityIcon: {
    width: 37,
    height: 37,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(159,92,255,0.24)",
    backgroundColor: "rgba(124,58,237,0.14)",
  },
  stabilityEyebrow: { color: "#55d7e8", fontSize: 8, fontFamily: "Inter_800ExtraBold", letterSpacing: 0.9 },
  stabilityTitle: { color: "#f3f6fb", fontSize: 17, fontFamily: "Inter_800ExtraBold", marginTop: 2 },
  statusBadge: {
    height: 26,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 9,
  },
  statusRisk: { borderColor: "rgba(251,113,133,0.27)", backgroundColor: "rgba(251,113,133,0.08)" },
  statusWatch: { borderColor: "rgba(251,191,36,0.25)", backgroundColor: "rgba(251,191,36,0.07)" },
  statusSafe: { borderColor: "rgba(34,197,94,0.24)", backgroundColor: "rgba(34,197,94,0.07)" },
  statusDot: { width: 5, height: 5, borderRadius: 3 },
  statusText: { color: "#d5deea", fontSize: 8, fontFamily: "Inter_800ExtraBold", letterSpacing: 0.5 },
  stabilitySummary: {
    minHeight: 76,
    flexDirection: "row",
    alignItems: "center",
    gap: 18,
    marginTop: 16,
  },
  protectedMetric: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  protectedValue: { color: "#ffffff", fontSize: 34, lineHeight: 38, fontFamily: "Inter_800ExtraBold", letterSpacing: -1.2 },
  protectedUnit: { color: "#dbe5f3", fontSize: 12, fontFamily: "Inter_700Bold" },
  protectedSub: { color: "#718097", fontSize: 8, fontFamily: "Inter_500Medium", marginTop: 2 },
  summaryDivider: { width: 1, height: 40, backgroundColor: "rgba(148,163,184,0.12)" },
  summaryMetric: { flex: 1, minWidth: 0 },
  summaryLabel: { color: "#49cae1", fontSize: 8, fontFamily: "Inter_800ExtraBold", letterSpacing: 0.7 },
  summaryValue: { color: "#e7edf7", fontSize: 11, fontFamily: "Inter_700Bold", marginTop: 5 },
  stabilityCallout: {
    minHeight: 38,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: "rgba(34,197,94,0.14)",
    backgroundColor: "rgba(16,185,129,0.06)",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    marginTop: 4,
  },
  calloutIcon: { width: 22, height: 22, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(34,197,94,0.1)" },
  stabilityCalloutText: { flex: 1, color: "#7be2b7", fontSize: 9, lineHeight: 13, fontFamily: "Inter_600SemiBold" },
  pathHeader: { flexDirection: "row", alignItems: "center", marginTop: 15, marginBottom: 7 },
  pathLabel: { flex: 1, color: "#9aa9bf", fontSize: 9, fontFamily: "Inter_700Bold" },
  pathPercent: { color: "#d9e1ee", fontSize: 9, fontFamily: "Inter_800ExtraBold" },
  pathMilestones: { flexDirection: "row", justifyContent: "space-between", marginTop: 6 },
  pathMilestone: { color: "#65758e", fontSize: 8, fontFamily: "Inter_600SemiBold" },
  nextAction: {
    minHeight: 58,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(159,92,255,0.22)",
    backgroundColor: "rgba(124,58,237,0.11)",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 10,
    marginTop: 13,
  },
  nextActionIcon: { width: 31, height: 31, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(159,92,255,0.16)" },
  nextActionLabel: { color: "#c8a8ff", fontSize: 8, fontFamily: "Inter_800ExtraBold", letterSpacing: 0.7 },
  nextActionText: { color: "#e9ddff", fontSize: 10, lineHeight: 14, fontFamily: "Inter_700Bold", marginTop: 2 },
  floButton: {
    height: 31,
    borderRadius: 10,
    backgroundColor: "#9f5cff",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
  },
  floButtonText: { color: "#ffffff", fontSize: 9, fontFamily: "Inter_800ExtraBold" },
  howItWorks: {
    minHeight: 32,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(47,111,255,0.17)",
    backgroundColor: "rgba(47,111,255,0.05)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    marginTop: 9,
  },
  howItWorksText: { color: "#9db2d0", fontSize: 9, fontFamily: "Inter_700Bold" },
  quickCardWrap: { minHeight: 190 },
  quickGrid: { flexDirection: "row", gap: 9 },
  quickAction: {
    flex: 1,
    minWidth: 0,
    minHeight: 78,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.11)",
    backgroundColor: "rgba(2,6,23,0.28)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  quickIcon: { width: 34, height: 34, borderRadius: 11, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  quickLabel: { color: "#cbd5e1", fontSize: 8, fontFamily: "Inter_700Bold", marginTop: 7, textAlign: "center" },
  quickFooter: { flexDirection: "row", gap: 8, marginTop: 10 },
  quickFooterButton: {
    flex: 1,
    height: 31,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.1)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  quickFooterText: { color: "#9aa9be", fontSize: 8, fontFamily: "Inter_700Bold" },
  detailGrid: { flexDirection: "row", flexWrap: "wrap", alignItems: "stretch", gap: 14 },
  timelineList: { flex: 1 },
  timelineRow: { minHeight: 55, flexDirection: "row", alignItems: "center", gap: 10 },
  timelineDate: {
    width: 39,
    height: 39,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(251,191,36,0.18)",
    backgroundColor: "rgba(251,191,36,0.07)",
    alignItems: "center",
    justifyContent: "center",
  },
  timelineMonth: { color: "#d6a92d", fontSize: 6, fontFamily: "Inter_800ExtraBold", letterSpacing: 0.5 },
  timelineDay: { color: "#f5f7fb", fontSize: 14, lineHeight: 16, fontFamily: "Inter_800ExtraBold" },
  timelineName: { color: "#e5ecf6", fontSize: 10, fontFamily: "Inter_700Bold" },
  timelineMeta: { color: "#6f7d94", fontSize: 8, fontFamily: "Inter_500Medium", marginTop: 2 },
  timelineAmount: { color: "#f2f5fa", fontSize: 10, fontFamily: "Inter_800ExtraBold" },
  categoryList: { flex: 1, gap: 12 },
  categoryRow: { gap: 6 },
  categoryLabelRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  categoryDot: { width: 7, height: 7, borderRadius: 4 },
  categoryName: { flex: 1, color: "#dce5f2", fontSize: 9, fontFamily: "Inter_700Bold" },
  categoryAmount: { color: "#dce5f2", fontSize: 8, fontFamily: "Inter_700Bold" },
  categoryBudget: { color: "#65758d", fontFamily: "Inter_500Medium" },
  goalSummary: { flexDirection: "row", alignItems: "flex-end", marginBottom: 10 },
  goalSummaryValue: { color: "#ffffff", fontSize: 28, lineHeight: 31, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.9 },
  goalSummaryLabel: { color: "#718198", fontSize: 8, fontFamily: "Inter_500Medium", marginTop: 2 },
  goalSummaryMoney: { marginLeft: "auto", alignItems: "flex-end" },
  goalFunded: { color: "#72dfb0", fontSize: 13, fontFamily: "Inter_800ExtraBold" },
  goalTarget: { color: "#6f7d94", fontSize: 8, fontFamily: "Inter_500Medium", marginTop: 2 },
  goalList: { marginTop: 9 },
  goalRow: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 9 },
  goalIcon: { width: 29, height: 29, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(34,197,94,0.1)" },
  goalName: { color: "#e2eaf5", fontSize: 9, fontFamily: "Inter_700Bold" },
  goalMeta: { color: "#718097", fontSize: 8, fontFamily: "Inter_500Medium", marginTop: 2 },
  goalAmount: { color: "#cdd7e6", fontSize: 9, fontFamily: "Inter_800ExtraBold" },
  emptyState: { flex: 1, minHeight: 126, alignItems: "center", justifyContent: "center", padding: 18 },
  emptyIcon: { width: 34, height: 34, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(148,163,184,0.08)", marginBottom: 8 },
  emptyText: { maxWidth: 260, color: "#718097", fontSize: 9, lineHeight: 14, textAlign: "center", fontFamily: "Inter_500Medium" },
  footer: {
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 3,
    marginTop: 2,
  },
  footerBrand: { flex: 1, flexDirection: "row", alignItems: "center", gap: 7 },
  footerDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: BRAND.cyan },
  footerText: { color: "#5f6d82", fontSize: 8, fontFamily: "Inter_600SemiBold" },
  footerMeta: { color: "#5f6d82", fontSize: 8, fontFamily: "Inter_600SemiBold" },
});
