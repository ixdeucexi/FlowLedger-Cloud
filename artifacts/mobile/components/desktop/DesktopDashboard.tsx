import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useEffect, useMemo, useRef } from "react";
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
import { buildAlgorithmSuite } from "@/lib/algorithmSuite";
import { WIDE_DESKTOP_BREAKPOINT } from "@/lib/desktopExperience";
import { DEFAULT_DECISION_HUB_SETTINGS } from "@/lib/decisionHubSettings";
import { transactionCategoryParts } from "@/lib/reviewCenter";

type FeatherName = React.ComponentProps<typeof Feather>["name"];

const CATEGORY_COLORS = [
  "#8b5cf6",
  "#3b82f6",
  "#06b6d4",
  "#22c55e",
  "#f59e0b",
  "#ec4899",
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
  if (typeof candidate === "string" && candidate.trim())
    return candidate.trim();
  if (user?.email) return user.email.split("@")[0].replace(/[._-]+/g, " ");
  return "John";
}

function greetingForHour(hour: number) {
  if (hour < 5) return "Good evening";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function monthDay(month: number, day: number) {
  return new Date(2024, month, day).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function formatActivityDate(date: string) {
  const parsed = new Date(`${date}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;
  const parsedKey = `${parsed.getFullYear()}-${parsed.getMonth()}-${parsed.getDate()}`;
  if (todayKey === parsedKey) return "Today";
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function HoverCard({
  children,
  style,
  onPress,
  accessibilityLabel,
  glow = "purple",
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  accessibilityLabel?: string;
  glow?: "purple" | "blue" | "green" | "amber" | "none";
}) {
  const hover = useRef(new Animated.Value(0)).current;

  const animate = (toValue: number) => {
    Animated.spring(hover, {
      toValue,
      friction: 9,
      tension: 90,
      useNativeDriver: true,
    }).start();
  };
  const glowStyle =
    glow === "purple"
      ? styles.cardGlowPurple
      : glow === "blue"
        ? styles.cardGlowBlue
        : glow === "green"
          ? styles.cardGlowGreen
          : glow === "amber"
            ? styles.cardGlowAmber
            : undefined;

  return (
    <Pressable
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      onHoverIn={() => animate(1)}
      onHoverOut={() => animate(0)}
      style={style}
    >
      <Animated.View
        style={[
          styles.card,
          glowStyle,
          {
            transform: [
              {
                translateY: hover.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, -3],
                }),
              },
              {
                scale: hover.interpolate({
                  inputRange: [0, 1],
                  outputRange: [1, 1.006],
                }),
              },
            ],
          },
        ]}
      >
        {children}
      </Animated.View>
    </Pressable>
  );
}

function AnimatedProgress({
  percent,
  color = "#8b5cf6",
  height = 7,
}: {
  percent: number;
  color?: string;
  height?: number;
}) {
  const progress = useRef(new Animated.Value(0)).current;
  const clamped = Math.max(0, Math.min(100, percent));

  useEffect(() => {
    Animated.timing(progress, {
      toValue: clamped,
      duration: 900,
      delay: 140,
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

function FlowScoreGauge({ score }: { score: number }) {
  const size = 174;
  const strokeWidth = 12;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const animatedScore = useRef(new Animated.Value(0)).current;
  const clamped = Math.max(0, Math.min(100, score));

  useEffect(() => {
    Animated.timing(animatedScore, {
      toValue: clamped,
      duration: 1200,
      delay: 120,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [animatedScore, clamped]);

  return (
    <View
      style={styles.gaugeWrap}
      accessibilityLabel={`Flow Score ${Math.round(clamped)} out of 100`}
    >
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <Defs>
          <SvgLinearGradient id="desktopFlowScore" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#8b5cf6" stopOpacity="1" />
            <Stop offset="0.55" stopColor="#3b82f6" stopOpacity="1" />
            <Stop offset="1" stopColor="#22d3ee" stopOpacity="1" />
          </SvgLinearGradient>
        </Defs>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="rgba(2,6,23,0.42)"
          stroke="rgba(148,163,184,0.13)"
          strokeWidth={strokeWidth}
        />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="transparent"
          stroke="url(#desktopFlowScore)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={animatedScore.interpolate({
            inputRange: [0, 100],
            outputRange: [circumference, 0],
          })}
          rotation="-90"
          originX={size / 2}
          originY={size / 2}
        />
      </Svg>
      <View style={styles.gaugeCenter}>
        <Text style={styles.gaugeScore}>{Math.round(clamped)}</Text>
        <Text style={styles.gaugeLabel}>FLOW SCORE</Text>
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
      <View style={{ flex: 1 }}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {subtitle ? (
          <Text style={styles.sectionSubtitle}>{subtitle}</Text>
        ) : null}
      </View>
      {action && onAction ? (
        <Pressable
          onPress={onAction}
          style={({ pressed }) => [
            styles.sectionAction,
            { opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Text style={styles.sectionActionText}>{action}</Text>
          <Feather name="arrow-up-right" size={13} color="#9caeff" />
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
  tone,
  width,
  percent,
  onPress,
}: {
  label: string;
  value: string;
  detail: string;
  icon: FeatherName;
  tone: "purple" | "blue" | "green" | "amber";
  width: string;
  percent?: number;
  onPress?: () => void;
}) {
  const toneMap = {
    purple: { color: "#b794ff", background: "rgba(124,58,237,0.16)" },
    blue: { color: "#70a5ff", background: "rgba(37,99,235,0.16)" },
    green: { color: "#45d6a0", background: "rgba(16,185,129,0.14)" },
    amber: { color: "#fbbf55", background: "rgba(245,158,11,0.14)" },
  }[tone];

  return (
    <HoverCard
      style={{ flexBasis: width as never, flexGrow: 1, minWidth: 0 }}
      onPress={onPress}
      accessibilityLabel={`${label}: ${value}`}
      glow={tone}
    >
      <View style={styles.metricTop}>
        <View
          style={[styles.metricIcon, { backgroundColor: toneMap.background }]}
        >
          <Feather name={icon} size={17} color={toneMap.color} />
        </View>
        <View
          style={[styles.metricStatus, { backgroundColor: toneMap.background }]}
        >
          <View
            style={[styles.metricStatusDot, { backgroundColor: toneMap.color }]}
          />
          <Text style={[styles.metricStatusText, { color: toneMap.color }]}>
            LIVE
          </Text>
        </View>
      </View>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
      {percent !== undefined ? (
        <View style={styles.metricProgressWrap}>
          <AnimatedProgress
            percent={percent}
            color={toneMap.color}
            height={5}
          />
        </View>
      ) : null}
      <Text style={styles.metricDetail}>{detail}</Text>
    </HoverCard>
  );
}

export function DesktopDashboard() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { user } = useAuth();
  const {
    accounts,
    categories,
    goals,
    incomes,
    selectedYear,
    settings,
    forecastConfidence,
    getBillMonthlyTotal,
    getDailyBalances,
    getMonthlyBills,
    getMonthlyIncome,
    getPaidAmount,
    getCashFlow,
    getTransactionsForMonth,
    setDashboardFilter,
  } = useBudget();

  const now = new Date();
  const currentMonth = now.getMonth();
  const today = now.getDate();
  const isWide = width >= WIDE_DESKTOP_BREAKPOINT;
  const metricWidth = isWide ? "23%" : "47%";
  const lowerWidth = isWide ? "31%" : "47%";
  const name = displayName(user);
  const firstName = name.split(/\s+/)[0] || name;
  const dailyBalances = useMemo(
    () => getDailyBalances(currentMonth, selectedYear),
    [currentMonth, getDailyBalances, selectedYear],
  );
  const monthlyBills = useMemo(
    () => getMonthlyBills(currentMonth, selectedYear),
    [currentMonth, getMonthlyBills, selectedYear],
  );
  const monthTransactions = useMemo(
    () => getTransactionsForMonth(currentMonth, selectedYear),
    [currentMonth, getTransactionsForMonth, selectedYear],
  );
  const cashFlow = useMemo(
    () => getCashFlow(currentMonth, selectedYear),
    [currentMonth, getCashFlow, selectedYear],
  );
  const decisionSettings = DEFAULT_DECISION_HUB_SETTINGS;

  const categoryRows = useMemo(() => {
    const spending = new Map<string, number>();
    monthTransactions.forEach((transaction) => {
      const parts = transactionCategoryParts(transaction);
      if (parts.length) {
        parts.forEach((part) =>
          spending.set(
            part.category || "Other",
            (spending.get(part.category || "Other") ?? 0) +
              Math.abs(part.amount),
          ),
        );
      } else if (transaction.amount < 0) {
        const category = transaction.category || "Other";
        spending.set(
          category,
          (spending.get(category) ?? 0) + Math.abs(transaction.amount),
        );
      }
    });
    const planned = new Map<string, number>();
    monthlyBills.forEach((bill) => {
      const category = bill.category || "Other";
      planned.set(
        category,
        (planned.get(category) ?? 0) +
          getBillMonthlyTotal(bill, currentMonth, selectedYear),
      );
    });
    const keys = new Set([
      ...categories,
      ...spending.keys(),
      ...planned.keys(),
    ]);
    return [...keys]
      .map((category) => {
        const spent = spending.get(category) ?? 0;
        const committed = planned.get(category) ?? 0;
        const budgeted = Math.max(committed, spent * 1.18, 1);
        return {
          category,
          spent,
          budgeted,
          percent: Math.min(100, (spent / budgeted) * 100),
        };
      })
      .filter((row) => row.spent > 0.005 || row.budgeted > 1)
      .sort((a, b) => b.spent - a.spent)
      .slice(0, 5);
  }, [
    categories,
    currentMonth,
    getBillMonthlyTotal,
    monthTransactions,
    monthlyBills,
    selectedYear,
  ]);

  const algorithmSuite = useMemo(
    () =>
      buildAlgorithmSuite({
        month: currentMonth,
        year: selectedYear,
        todayDay: today,
        safetyFloor: settings.safety_floor,
        cashFlow,
        dailyBalances: dailyBalances.map((day) => ({
          day: day.day,
          income: day.income,
          bills: day.bills,
          expense: day.expense,
          net: day.net,
          balance: day.balance,
        })),
        bills: monthlyBills.map((bill) => ({
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
          snowball_minimum_boost: bill.snowball_minimum_boost,
        })),
        transactions: monthTransactions.flatMap((transaction) => {
          const parts = transactionCategoryParts(transaction);
          if (parts.length)
            return parts.map((part, index) => ({
              id: `${transaction.id}:${index}`,
              date: transaction.date,
              amount: part.amount,
              category: part.category,
              note: part.label,
            }));
          return [
            {
              id: transaction.id,
              date: transaction.date,
              amount: transaction.amount,
              category: transaction.category || "Other",
              note: transaction.note,
            },
          ];
        }),
        incomes: incomes.map((income) => ({
          id: income.id,
          name: income.name,
          amount: income.amount,
          frequency: income.frequency,
        })),
        goals: goals.map((goal) => ({
          id: goal.id,
          name: goal.name,
          target_amount: goal.target_amount,
          current_amount: goal.current_amount,
          target_date: goal.target_date,
          goal_type: goal.goal_type,
        })),
        categoryPlan: categoryRows.map((row) => ({
          category: row.category,
          budgeted: row.budgeted,
          spent: row.spent,
          remaining: row.budgeted - row.spent,
          status:
            row.spent > row.budgeted
              ? ("over" as const)
              : row.percent >= 80
                ? ("watch" as const)
                : ("available" as const),
        })),
        forecastConfidence,
        settings: decisionSettings,
      }),
    [
      cashFlow,
      categoryRows,
      currentMonth,
      dailyBalances,
      decisionSettings,
      forecastConfidence,
      getBillMonthlyTotal,
      getPaidAmount,
      goals,
      incomes,
      monthTransactions,
      monthlyBills,
      selectedYear,
      settings.safety_floor,
      today,
    ],
  );

  const checkingBalance = useMemo(() => {
    const operating = accounts.filter(
      (account) => account.is_active && account.account_type !== "savings",
    );
    const total = operating.reduce(
      (sum, account) => sum + account.current_balance,
      0,
    );
    if (operating.length) return total;
    return (
      dailyBalances.find((day) => day.day === today)?.balance ??
      dailyBalances[0]?.balance ??
      0
    );
  }, [accounts, dailyBalances, today]);

  const upcoming = useMemo(() => {
    const current = monthlyBills
      .map((bill) => ({
        ...bill,
        displayMonth: currentMonth,
        displayYear: selectedYear,
        remaining: Math.max(
          0,
          getBillMonthlyTotal(bill, currentMonth, selectedYear) -
            getPaidAmount(bill.id, currentMonth, selectedYear),
        ),
      }))
      .filter((bill) => bill.remaining > 0.005 && bill.due_day >= today)
      .sort((a, b) => a.due_day - b.due_day);

    if (current.length >= 5) return current.slice(0, 5);
    const nextMonth = (currentMonth + 1) % 12;
    const nextYear = selectedYear + (currentMonth === 11 ? 1 : 0);
    const next = getMonthlyBills(nextMonth, nextYear)
      .map((bill) => ({
        ...bill,
        displayMonth: nextMonth,
        displayYear: nextYear,
        remaining: Math.max(
          0,
          getBillMonthlyTotal(bill, nextMonth, nextYear) -
            getPaidAmount(bill.id, nextMonth, nextYear),
        ),
      }))
      .filter((bill) => bill.remaining > 0.005)
      .sort((a, b) => a.due_day - b.due_day);
    return [...current, ...next].slice(0, 5);
  }, [
    currentMonth,
    getBillMonthlyTotal,
    getMonthlyBills,
    getPaidAmount,
    monthlyBills,
    selectedYear,
    today,
  ]);

  const recentActivity = useMemo(
    () =>
      [...monthTransactions]
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 5),
    [monthTransactions],
  );
  const goalTotals = useMemo(
    () =>
      goals.reduce(
        (total, goal) => ({
          current: total.current + Math.max(0, goal.current_amount),
          target: total.target + Math.max(0, goal.target_amount),
        }),
        { current: 0, target: 0 },
      ),
    [goals],
  );
  const goalPercent =
    goalTotals.target > 0
      ? Math.min(100, (goalTotals.current / goalTotals.target) * 100)
      : 0;
  const unpaidTotal = monthlyBills.reduce(
    (sum, bill) =>
      sum +
      Math.max(
        0,
        getBillMonthlyTotal(bill, currentMonth, selectedYear) -
          getPaidAmount(bill.id, currentMonth, selectedYear),
      ),
    0,
  );
  const unpaidCount = monthlyBills.filter(
    (bill) =>
      getPaidAmount(bill.id, currentMonth, selectedYear) + 0.005 <
      getBillMonthlyTotal(bill, currentMonth, selectedYear),
  ).length;
  const monthlyIncome = getMonthlyIncome(currentMonth, selectedYear);
  const available = algorithmSuite.safeCushion.amount;
  const progress = algorithmSuite.stability;
  const nextMilestone =
    [7, 30, 60, 90, 180].find((day) => day > progress.protectedDays) ?? 180;

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
      <View pointerEvents="none" style={styles.dashboardAmbient}>
        <View style={styles.dashboardGlowOne} />
        <View style={styles.dashboardGlowTwo} />
      </View>

      <View style={styles.pageHeader}>
        <View style={{ flex: 1 }}>
          <View style={styles.eyebrowRow}>
            <View style={styles.livePulse} />
            <Text style={styles.pageEyebrow}>FINANCIAL COMMAND CENTER</Text>
          </View>
          <Text style={styles.greeting}>
            {greetingForHour(now.getHours())}, {firstName}
          </Text>
          <Text style={styles.greetingSub}>
            Here’s your financial overview for today.
          </Text>
        </View>
        <View style={styles.monthPill}>
          <Feather name="calendar" size={14} color="#a8b7cf" />
          <Text style={styles.monthPillText}>
            {now.toLocaleDateString("en-US", {
              month: "long",
              year: "numeric",
            })}
          </Text>
          <Feather name="chevron-down" size={13} color="#64748b" />
        </View>
      </View>

      <View style={styles.metricGrid}>
        <MetricCard
          label="Available to Spend"
          value={currency(available, 2)}
          detail={
            algorithmSuite.safeCushion.status === "safe"
              ? "Protected above your safety floor"
              : "Keep an eye on your lowest balance"
          }
          icon="dollar-sign"
          tone="green"
          width={metricWidth}
          onPress={() =>
            askFlo(
              `Explain why I have ${currency(available)} available to spend.`,
            )
          }
        />
        <MetricCard
          label="Upcoming Bills"
          value={currency(unpaidTotal, 2)}
          detail={`${unpaidCount} unpaid ${unpaidCount === 1 ? "bill" : "bills"} this month`}
          icon="file-text"
          tone="amber"
          width={metricWidth}
          onPress={() => openBills("bills")}
        />
        <MetricCard
          label="Monthly Income"
          value={currency(monthlyIncome, 2)}
          detail={`${incomes.length} active income ${incomes.length === 1 ? "source" : "sources"}`}
          icon="trending-up"
          tone="purple"
          width={metricWidth}
          onPress={() => go("/(tabs)/more", { section: "money" })}
        />
        <MetricCard
          label="Goal Progress"
          value={`${Math.round(goalPercent)}%`}
          detail={`${currency(goalTotals.current)} of ${currency(goalTotals.target)} funded`}
          icon="target"
          tone="blue"
          width={metricWidth}
          percent={goalPercent}
          onPress={() => go("/(tabs)/more", { section: "goals" })}
        />
      </View>

      <View style={styles.balanceScoreGrid}>
        <HoverCard
          style={styles.balanceCardWrap}
          glow="blue"
          onPress={() => go("/(tabs)/more", { section: "accounts" })}
          accessibilityLabel={`Checking balance ${currency(checkingBalance, 2)}`}
        >
          <View style={styles.balanceCardContent}>
            <View style={styles.balanceHeader}>
              <View>
                <Text style={styles.cardEyebrow}>CHECKING BALANCE</Text>
                <Text style={styles.balanceValue}>
                  {currency(checkingBalance, 2)}
                </Text>
              </View>
              <View style={styles.bankIcon}>
                <Feather name="briefcase" size={18} color="#8db8ff" />
              </View>
            </View>
            <View style={styles.balanceFooter}>
              <View style={styles.balanceDelta}>
                <Feather
                  name={
                    cashFlow.remaining >= 0
                      ? "arrow-up-right"
                      : "arrow-down-right"
                  }
                  size={14}
                  color={cashFlow.remaining >= 0 ? "#4ade80" : "#fb7185"}
                />
                <Text
                  style={[
                    styles.balanceDeltaText,
                    { color: cashFlow.remaining >= 0 ? "#4ade80" : "#fb7185" },
                  ]}
                >
                  {currency(Math.abs(cashFlow.remaining))} projected this month
                </Text>
              </View>
              <Text style={styles.balanceUpdated}>
                Updated from{" "}
                {accounts.filter((account) => account.is_active).length} active{" "}
                {accounts.filter((account) => account.is_active).length === 1
                  ? "account"
                  : "accounts"}
              </Text>
            </View>
            <View pointerEvents="none" style={styles.balanceChart}>
              {[22, 31, 27, 46, 40, 58, 52, 72, 66, 82, 76, 92].map(
                (height, index) => (
                  <View
                    key={index}
                    style={[
                      styles.balanceChartBar,
                      {
                        height: `${height}%` as never,
                        opacity: 0.26 + index * 0.045,
                      },
                    ]}
                  />
                ),
              )}
            </View>
          </View>
        </HoverCard>

        <HoverCard
          style={styles.scoreCardWrap}
          glow="purple"
          onPress={() =>
            askFlo(`Why is my Flow Score ${algorithmSuite.flowScore.score}?`)
          }
          accessibilityLabel={`Flow Score ${algorithmSuite.flowScore.score}`}
        >
          <View style={styles.scoreCardContent}>
            <View style={styles.scoreCopy}>
              <Text style={styles.cardEyebrow}>FINANCIAL MOMENTUM</Text>
              <Text style={styles.scoreTitle}>Flow Score</Text>
              <Text style={styles.scoreDescription}>
                {algorithmSuite.flowScore.topReason}
              </Text>
              <View style={styles.scoreStatusRow}>
                <View style={styles.scoreStatusDot} />
                <Text style={styles.scoreStatus}>
                  {algorithmSuite.flowScore.label}
                </Text>
              </View>
              <Text style={styles.scoreHint}>
                Select to see what’s shaping your score
              </Text>
            </View>
            <FlowScoreGauge score={algorithmSuite.flowScore.score} />
          </View>
        </HoverCard>
      </View>

      <HoverCard
        style={styles.stabilityWrap}
        glow="purple"
        accessibilityLabel={`Stability path: ${progress.stageLabel}`}
      >
        <View style={styles.stabilityCard}>
          <View style={styles.stabilityHeader}>
            <View style={styles.stabilityIcon}>
              <Feather name="shield" size={20} color="#b7a6ff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.stabilityEyebrow}>STABILITY PATH</Text>
              <Text style={styles.stabilityTitle}>{progress.stageLabel}</Text>
            </View>
            <View style={styles.stabilityStatus}>
              <View style={styles.stabilityStatusDot} />
              <Text style={styles.stabilityStatusText}>
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
              <Text style={styles.protectedValue}>
                {progress.protectedDays}
              </Text>
              <View>
                <Text style={styles.protectedLabel}>days</Text>
                <Text style={styles.protectedSub}>currently protected</Text>
              </View>
            </View>
            <View style={styles.stabilityDivider} />
            <View style={styles.stabilityMiniMetric}>
              <Text style={styles.stabilityMiniLabel}>NEXT MILESTONE</Text>
              <Text style={styles.stabilityMiniValue}>
                {nextMilestone} protected days
              </Text>
            </View>
            <View style={styles.stabilityDivider} />
            <View style={styles.stabilityMiniMetric}>
              <Text style={styles.stabilityMiniLabel}>BREATHING ROOM</Text>
              <Text style={styles.stabilityMiniValue}>
                {currency(progress.protectedAmount)}
              </Text>
            </View>
          </View>

          <View style={styles.stabilityCallout}>
            <View style={styles.safeCheck}>
              <Feather name="check" size={14} color="#44d7a4" />
            </View>
            <Text style={styles.stabilityCalloutText}>
              {progress.explanation}
            </Text>
          </View>

          <View style={styles.pathHeader}>
            <Text style={styles.pathLabel}>180-day backup path</Text>
            <Text style={styles.pathPercent}>
              {Math.round(progress.reserveProgress * 100)}%
            </Text>
          </View>
          <AnimatedProgress
            percent={progress.reserveProgress * 100}
            color="#8b5cf6"
            height={8}
          />
          <View style={styles.pathMilestones}>
            {[7, 30, 60, 90, 180].map((day) => (
              <Text key={day} style={styles.pathMilestone}>
                {day}d
              </Text>
            ))}
          </View>

          <View style={styles.nextActionRow}>
            <View style={styles.nextActionIcon}>
              <Feather name="arrow-up-right" size={17} color="#d8b4fe" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.nextActionLabel}>YOUR NEXT BEST MOVE</Text>
              <Text style={styles.nextActionText}>{progress.nextAction}</Text>
            </View>
            <Pressable
              onPress={() =>
                askFlo(
                  `Explain my stability path and why ${progress.nextAction}`,
                )
              }
              style={({ pressed }) => [
                styles.askFloButton,
                { opacity: pressed ? 0.76 : 1 },
              ]}
            >
              <Feather name="message-circle" size={14} color="#ffffff" />
              <Text style={styles.askFloText}>Ask Flo</Text>
            </Pressable>
          </View>
        </View>
      </HoverCard>

      <View style={styles.operationalGrid}>
        <HoverCard
          style={styles.operationalCardWrap}
          glow="blue"
          accessibilityLabel="Recent activity"
        >
          <View style={styles.sectionCardContent}>
            <SectionHeader
              title="Recent Activity"
              subtitle="Your latest money movement"
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
                      style={[
                        styles.activityRow,
                        index > 0 && styles.listDivider,
                      ]}
                    >
                      <View
                        style={[
                          styles.activityIcon,
                          {
                            backgroundColor: positive
                              ? "rgba(16,185,129,0.12)"
                              : "rgba(59,130,246,0.12)",
                          },
                        ]}
                      >
                        <Feather
                          name={positive ? "arrow-down-left" : "shopping-bag"}
                          size={15}
                          color={positive ? "#45d6a0" : "#79a9ff"}
                        />
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.activityName} numberOfLines={1}>
                          {transaction.merchant_name ||
                            transaction.note ||
                            transaction.category ||
                            "Transaction"}
                        </Text>
                        <Text style={styles.activityMeta}>
                          {transaction.category ||
                            (positive ? "Income" : "Spending")}
                        </Text>
                      </View>
                      <View style={styles.activityAmountWrap}>
                        <Text
                          style={[
                            styles.activityAmount,
                            { color: positive ? "#4ade80" : "#eef4fc" },
                          ]}
                        >
                          {positive ? "+" : "−"}
                          {currency(Math.abs(transaction.amount), 2)}
                        </Text>
                        <Text style={styles.activityDate}>
                          {formatActivityDate(transaction.date)}
                        </Text>
                      </View>
                    </View>
                  );
                })
              ) : (
                <EmptyState
                  icon="activity"
                  text="Your recent activity will appear here."
                />
              )}
            </View>
          </View>
        </HoverCard>

        <HoverCard
          style={styles.operationalCardWrap}
          glow="amber"
          accessibilityLabel="Upcoming bills timeline"
        >
          <View style={styles.sectionCardContent}>
            <SectionHeader
              title="Upcoming Bills Timeline"
              subtitle="What’s due next"
              action="Manage"
              onAction={() => openBills("bills")}
            />
            <View style={styles.timelineList}>
              {upcoming.length ? (
                upcoming.map((bill, index) => (
                  <View
                    key={`${bill.id}:${bill.displayMonth}`}
                    style={styles.timelineRow}
                  >
                    <View style={styles.timelineRail}>
                      <View
                        style={[
                          styles.timelineDot,
                          index === 0 && styles.timelineDotActive,
                        ]}
                      />
                      {index < upcoming.length - 1 ? (
                        <View style={styles.timelineLine} />
                      ) : null}
                    </View>
                    <View style={styles.timelineDateBlock}>
                      <Text style={styles.timelineMonth}>
                        {new Date(bill.displayYear, bill.displayMonth, 1)
                          .toLocaleDateString("en-US", { month: "short" })
                          .toUpperCase()}
                      </Text>
                      <Text style={styles.timelineDay}>{bill.due_day}</Text>
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.timelineName} numberOfLines={1}>
                        {bill.name}
                      </Text>
                      <Text style={styles.timelineMeta}>
                        {bill.is_debt
                          ? "Debt payment"
                          : bill.category || "Bill"}{" "}
                        · {monthDay(bill.displayMonth, bill.due_day)}
                      </Text>
                    </View>
                    <Text style={styles.timelineAmount}>
                      {currency(bill.remaining, 2)}
                    </Text>
                  </View>
                ))
              ) : (
                <EmptyState
                  icon="calendar"
                  text="No upcoming bills are waiting."
                />
              )}
            </View>
          </View>
        </HoverCard>
      </View>

      <View style={styles.lowerGrid}>
        <HoverCard
          style={{ flexBasis: lowerWidth as never, flexGrow: 1, minWidth: 0 }}
          glow="blue"
          accessibilityLabel="Budget categories"
        >
          <View style={styles.sectionCardContent}>
            <SectionHeader
              title="Budget Categories"
              subtitle="This month’s spending pace"
              action="Open budget"
              onAction={() => go("/(tabs)/category-budget")}
            />
            <View style={styles.categoryList}>
              {categoryRows.length ? (
                categoryRows.map((row, index) => (
                  <View key={row.category} style={styles.categoryRow}>
                    <View style={styles.categoryLabelRow}>
                      <View
                        style={[
                          styles.categoryDot,
                          {
                            backgroundColor:
                              CATEGORY_COLORS[index % CATEGORY_COLORS.length],
                          },
                        ]}
                      />
                      <Text style={styles.categoryName} numberOfLines={1}>
                        {row.category}
                      </Text>
                      <Text style={styles.categoryAmount}>
                        {currency(row.spent)}{" "}
                        <Text style={styles.categoryBudget}>
                          / {currency(row.budgeted)}
                        </Text>
                      </Text>
                    </View>
                    <AnimatedProgress
                      percent={row.percent}
                      color={CATEGORY_COLORS[index % CATEGORY_COLORS.length]}
                      height={5}
                    />
                  </View>
                ))
              ) : (
                <EmptyState
                  icon="pie-chart"
                  text="Budget categories will fill in as activity arrives."
                />
              )}
            </View>
          </View>
        </HoverCard>

        <HoverCard
          style={{ flexBasis: lowerWidth as never, flexGrow: 1, minWidth: 0 }}
          glow="green"
          accessibilityLabel="Goal progress"
        >
          <View style={styles.sectionCardContent}>
            <SectionHeader
              title="Goal Progress"
              subtitle="Momentum toward what matters"
              action="View goals"
              onAction={() => go("/(tabs)/more", { section: "goals" })}
            />
            <View style={styles.goalSummary}>
              <View>
                <Text style={styles.goalSummaryValue}>
                  {Math.round(goalPercent)}%
                </Text>
                <Text style={styles.goalSummaryLabel}>overall funded</Text>
              </View>
              <View style={styles.goalSummaryMoney}>
                <Text style={styles.goalFunded}>
                  {currency(goalTotals.current)}
                </Text>
                <Text style={styles.goalTarget}>
                  of {currency(goalTotals.target)}
                </Text>
              </View>
            </View>
            <AnimatedProgress
              percent={goalPercent}
              color="#38d39f"
              height={7}
            />
            <View style={styles.goalList}>
              {goals.length ? (
                goals.slice(0, 3).map((goal, index) => {
                  const percent =
                    goal.target_amount > 0
                      ? Math.min(
                          100,
                          (goal.current_amount / goal.target_amount) * 100,
                        )
                      : 0;
                  return (
                    <View
                      key={goal.id}
                      style={[styles.goalRow, index > 0 && styles.listDivider]}
                    >
                      <View style={styles.goalIcon}>
                        <Feather
                          name={
                            goal.goal_type === "savings" ? "shield" : "star"
                          }
                          size={14}
                          color="#77e0b6"
                        />
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.goalName} numberOfLines={1}>
                          {goal.name}
                        </Text>
                        <Text style={styles.goalMeta}>
                          {Math.round(percent)}% funded
                        </Text>
                      </View>
                      <Text style={styles.goalAmount}>
                        {currency(goal.current_amount)}
                      </Text>
                    </View>
                  );
                })
              ) : (
                <EmptyState
                  icon="target"
                  text="Add a goal to start tracking progress."
                />
              )}
            </View>
          </View>
        </HoverCard>

        <HoverCard
          style={{ flexBasis: lowerWidth as never, flexGrow: 1, minWidth: 0 }}
          glow="purple"
          accessibilityLabel="Quick actions"
        >
          <View style={styles.sectionCardContent}>
            <SectionHeader
              title="Quick Actions"
              subtitle="Keep your plan up to date"
            />
            <View style={styles.quickGrid}>
              {[
                {
                  label: "Add income",
                  icon: "arrow-down-left" as const,
                  color: "#45d6a0",
                  onPress: () => go("/(tabs)/more", { section: "money" }),
                },
                {
                  label: "Add bill",
                  icon: "file-plus" as const,
                  color: "#79a9ff",
                  onPress: () => openBills("bills"),
                },
                {
                  label: "Add debt",
                  icon: "credit-card" as const,
                  color: "#b794ff",
                  onPress: () => openBills("debt"),
                },
                {
                  label: "Add goal",
                  icon: "target" as const,
                  color: "#f27fc0",
                  onPress: () => go("/(tabs)/more", { section: "goals" }),
                },
                {
                  label: "Can I afford it?",
                  icon: "help-circle" as const,
                  color: "#fbbf55",
                  onPress: () =>
                    askFlo(
                      "Can I afford a purchase? Help me choose a safe amount and date.",
                    ),
                },
                {
                  label: "Ask Flo",
                  icon: "message-circle" as const,
                  color: "#67e8f9",
                  onPress: () => go("/(tabs)/flo"),
                },
              ].map((action) => (
                <Pressable
                  key={action.label}
                  accessibilityRole="button"
                  onPress={action.onPress}
                  style={({ pressed }) => [
                    styles.quickAction,
                    {
                      opacity: pressed ? 0.74 : 1,
                      transform: [{ scale: pressed ? 0.98 : 1 }],
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.quickIcon,
                      {
                        backgroundColor: `${action.color}18`,
                        borderColor: `${action.color}32`,
                      },
                    ]}
                  >
                    <Feather
                      name={action.icon}
                      size={16}
                      color={action.color}
                    />
                  </View>
                  <Text style={styles.quickLabel}>{action.label}</Text>
                  <Feather name="chevron-right" size={13} color="#56637a" />
                </Pressable>
              ))}
            </View>
          </View>
        </HoverCard>
      </View>

      <View style={styles.footer}>
        <View style={styles.footerBrand}>
          <View style={styles.footerDot} />
          <Text style={styles.footerText}>
            FlowLedger Algo · Your plan updates with every change
          </Text>
        </View>
        <Text style={styles.footerMeta}>
          Forecast confidence: {forecastConfidence.label}
        </Text>
      </View>
    </ScrollView>
  );
}

function EmptyState({ icon, text }: { icon: FeatherName; text: string }) {
  return (
    <View style={styles.emptyState}>
      <View style={styles.emptyIcon}>
        <Feather name={icon} size={16} color="#7786a0" />
      </View>
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "transparent" },
  content: {
    width: "100%",
    maxWidth: 1680,
    alignSelf: "center",
    paddingHorizontal: 30,
    paddingTop: 28,
    paddingBottom: 44,
    position: "relative",
  },
  dashboardAmbient: { ...StyleSheet.absoluteFillObject, overflow: "hidden" },
  dashboardGlowOne: {
    position: "absolute",
    width: 420,
    height: 420,
    borderRadius: 210,
    top: 160,
    left: -280,
    backgroundColor: "rgba(59,130,246,0.07)",
    shadowColor: "#2563eb",
    shadowOpacity: 0.24,
    shadowRadius: 110,
    shadowOffset: { width: 0, height: 0 },
  },
  dashboardGlowTwo: {
    position: "absolute",
    width: 500,
    height: 500,
    borderRadius: 250,
    top: 620,
    right: -330,
    backgroundColor: "rgba(124,58,237,0.08)",
    shadowColor: "#7c3aed",
    shadowOpacity: 0.24,
    shadowRadius: 120,
    shadowOffset: { width: 0, height: 0 },
  },
  pageHeader: {
    minHeight: 78,
    flexDirection: "row",
    alignItems: "center",
    gap: 20,
    marginBottom: 24,
  },
  eyebrowRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginBottom: 7,
  },
  livePulse: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#22d3ee",
    shadowColor: "#22d3ee",
    shadowOpacity: 0.9,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  pageEyebrow: {
    color: "#7886a0",
    fontSize: 9,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: 1.5,
  },
  greeting: {
    color: "#f5f8fc",
    fontSize: 28,
    lineHeight: 33,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: -0.85,
  },
  greetingSub: {
    color: "#7d8aa2",
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    marginTop: 5,
  },
  monthPill: {
    height: 40,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.14)",
    backgroundColor: "rgba(15,23,42,0.58)",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
  },
  monthPillText: {
    color: "#b7c2d4",
    fontSize: 11,
    fontFamily: "Inter_700Bold",
  },
  metricGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 15,
    marginBottom: 16,
  },
  card: {
    flex: 1,
    minHeight: "100%",
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.13)",
    backgroundColor: "rgba(10,16,35,0.80)",
    padding: 18,
    overflow: "hidden",
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.12,
    shadowRadius: 28,
  },
  cardGlowPurple: { shadowColor: "#7c3aed" },
  cardGlowBlue: { shadowColor: "#2563eb" },
  cardGlowGreen: { shadowColor: "#059669" },
  cardGlowAmber: { shadowColor: "#d97706" },
  metricTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  metricIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  metricStatus: {
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  metricStatusDot: { width: 4, height: 4, borderRadius: 2 },
  metricStatusText: {
    fontSize: 7,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: 0.8,
  },
  metricLabel: {
    color: "#8794aa",
    fontSize: 9,
    fontFamily: "Inter_800ExtraBold",
    textTransform: "uppercase",
    letterSpacing: 1.05,
  },
  metricValue: {
    color: "#f8fafc",
    fontSize: 27,
    lineHeight: 32,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: -0.75,
    marginTop: 6,
  },
  metricProgressWrap: { marginTop: 9, marginBottom: 1 },
  metricDetail: {
    color: "#6e7b92",
    fontSize: 10,
    lineHeight: 14,
    fontFamily: "Inter_500Medium",
    marginTop: 7,
  },
  progressTrack: {
    width: "100%",
    borderRadius: 999,
    backgroundColor: "rgba(148,163,184,0.13)",
    overflow: "hidden",
  },
  progressFill: {
    borderRadius: 999,
    shadowColor: "#8b5cf6",
    shadowOpacity: 0.7,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 0 },
  },
  balanceScoreGrid: { flexDirection: "row", gap: 16, marginBottom: 16 },
  balanceCardWrap: { flex: 1.25, minWidth: 0 },
  scoreCardWrap: { flex: 1, minWidth: 0 },
  balanceCardContent: { minHeight: 250, position: "relative" },
  balanceHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  cardEyebrow: {
    color: "#7e8da6",
    fontSize: 9,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: 1.3,
  },
  balanceValue: {
    color: "#ffffff",
    fontSize: 43,
    lineHeight: 50,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: -1.9,
    marginTop: 9,
  },
  bankIcon: {
    width: 39,
    height: 39,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(59,130,246,0.13)",
    borderWidth: 1,
    borderColor: "rgba(96,165,250,0.17)",
  },
  balanceFooter: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 2,
  },
  balanceDelta: { flexDirection: "row", alignItems: "center", gap: 6 },
  balanceDeltaText: { fontSize: 10, fontFamily: "Inter_700Bold" },
  balanceUpdated: {
    color: "#5f6d84",
    fontSize: 9,
    fontFamily: "Inter_500Medium",
    marginTop: 6,
  },
  balanceChart: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 42,
    height: 90,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 7,
    opacity: 0.9,
  },
  balanceChartBar: {
    flex: 1,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
    backgroundColor: "#4f7cff",
  },
  scoreCardContent: {
    minHeight: 250,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  scoreCopy: { flex: 1, minWidth: 0 },
  scoreTitle: {
    color: "#f5f8fc",
    fontSize: 24,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: -0.55,
    marginTop: 7,
  },
  scoreDescription: {
    color: "#8592a8",
    fontSize: 10,
    lineHeight: 15,
    fontFamily: "Inter_500Medium",
    marginTop: 8,
    maxWidth: 230,
  },
  scoreStatusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 13,
  },
  scoreStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#4ade80",
    shadowColor: "#22c55e",
    shadowOpacity: 0.9,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 0 },
  },
  scoreStatus: {
    color: "#4ade80",
    fontSize: 10,
    fontFamily: "Inter_800ExtraBold",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  scoreHint: {
    color: "#56647b",
    fontSize: 8,
    fontFamily: "Inter_600SemiBold",
    marginTop: 7,
  },
  gaugeWrap: {
    width: 174,
    height: 174,
    alignItems: "center",
    justifyContent: "center",
  },
  gaugeCenter: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  gaugeScore: {
    color: "#ffffff",
    fontSize: 42,
    lineHeight: 47,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: -1.6,
  },
  gaugeLabel: {
    color: "#75839a",
    fontSize: 8,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: 1,
  },
  stabilityWrap: { width: "100%", marginBottom: 16 },
  stabilityCard: { minHeight: 350 },
  stabilityHeader: { flexDirection: "row", alignItems: "center", gap: 11 },
  stabilityIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(124,58,237,0.16)",
    borderWidth: 1,
    borderColor: "rgba(167,139,250,0.20)",
  },
  stabilityEyebrow: {
    color: "#8b7ae0",
    fontSize: 8,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: 1.3,
  },
  stabilityTitle: {
    color: "#f4f7fb",
    fontSize: 17,
    fontFamily: "Inter_800ExtraBold",
    marginTop: 3,
  },
  stabilityStatus: {
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: "rgba(245,158,11,0.10)",
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.18)",
  },
  stabilityStatusDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: "#fbbf24",
  },
  stabilityStatusText: {
    color: "#fbbf55",
    fontSize: 8,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: 0.7,
  },
  stabilitySummary: {
    flexDirection: "row",
    alignItems: "center",
    gap: 22,
    marginTop: 24,
  },
  protectedMetric: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 9,
    minWidth: 180,
  },
  protectedValue: {
    color: "#ffffff",
    fontSize: 42,
    lineHeight: 46,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: -1.8,
  },
  protectedLabel: {
    color: "#d9e3f0",
    fontSize: 14,
    fontFamily: "Inter_800ExtraBold",
    marginBottom: 2,
  },
  protectedSub: {
    color: "#69778f",
    fontSize: 9,
    fontFamily: "Inter_600SemiBold",
    marginBottom: 3,
  },
  stabilityDivider: {
    width: 1,
    height: 43,
    backgroundColor: "rgba(148,163,184,0.13)",
  },
  stabilityMiniMetric: { flex: 1 },
  stabilityMiniLabel: {
    color: "#64728a",
    fontSize: 8,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: 0.9,
  },
  stabilityMiniValue: {
    color: "#dfe7f2",
    fontSize: 14,
    fontFamily: "Inter_800ExtraBold",
    marginTop: 7,
  },
  stabilityCallout: {
    minHeight: 42,
    borderRadius: 13,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingHorizontal: 11,
    marginTop: 18,
    backgroundColor: "rgba(16,185,129,0.07)",
    borderWidth: 1,
    borderColor: "rgba(52,211,153,0.12)",
  },
  safeCheck: {
    width: 24,
    height: 24,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(16,185,129,0.13)",
  },
  stabilityCalloutText: {
    flex: 1,
    color: "#9ed9c4",
    fontSize: 10,
    lineHeight: 14,
    fontFamily: "Inter_600SemiBold",
  },
  pathHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 18,
    marginBottom: 8,
  },
  pathLabel: { color: "#9ba8bc", fontSize: 10, fontFamily: "Inter_700Bold" },
  pathPercent: {
    color: "#d8d2ff",
    fontSize: 10,
    fontFamily: "Inter_800ExtraBold",
  },
  pathMilestones: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 7,
  },
  pathMilestone: { color: "#536078", fontSize: 8, fontFamily: "Inter_700Bold" },
  nextActionRow: {
    minHeight: 65,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    padding: 11,
    marginTop: 16,
    backgroundColor: "rgba(91,33,182,0.12)",
    borderWidth: 1,
    borderColor: "rgba(139,92,246,0.18)",
  },
  nextActionIcon: {
    width: 35,
    height: 35,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(124,58,237,0.23)",
  },
  nextActionLabel: {
    color: "#9988e9",
    fontSize: 7,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: 1.1,
  },
  nextActionText: {
    color: "#e7e3ff",
    fontSize: 11,
    lineHeight: 15,
    fontFamily: "Inter_700Bold",
    marginTop: 4,
  },
  askFloButton: {
    minHeight: 36,
    borderRadius: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 11,
    backgroundColor: "#6d3bd1",
    borderWidth: 1,
    borderColor: "rgba(216,180,254,0.22)",
  },
  askFloText: {
    color: "#ffffff",
    fontSize: 9,
    fontFamily: "Inter_800ExtraBold",
  },
  operationalGrid: { flexDirection: "row", gap: 16, marginBottom: 16 },
  operationalCardWrap: { flex: 1, minWidth: 0 },
  sectionCardContent: { minHeight: 286 },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    marginBottom: 13,
  },
  sectionTitle: {
    color: "#edf3fb",
    fontSize: 15,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: -0.25,
  },
  sectionSubtitle: {
    color: "#68768d",
    fontSize: 9,
    fontFamily: "Inter_500Medium",
    marginTop: 4,
  },
  sectionAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingTop: 2,
  },
  sectionActionText: {
    color: "#9caeff",
    fontSize: 9,
    fontFamily: "Inter_800ExtraBold",
  },
  activityList: { flex: 1 },
  activityRow: {
    minHeight: 47,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  listDivider: { borderTopWidth: 1, borderTopColor: "rgba(148,163,184,0.09)" },
  activityIcon: {
    width: 31,
    height: 31,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  activityName: { color: "#dfe7f2", fontSize: 10, fontFamily: "Inter_700Bold" },
  activityMeta: {
    color: "#647188",
    fontSize: 8,
    fontFamily: "Inter_500Medium",
    marginTop: 3,
  },
  activityAmountWrap: { alignItems: "flex-end" },
  activityAmount: { fontSize: 10, fontFamily: "Inter_800ExtraBold" },
  activityDate: {
    color: "#5e6b82",
    fontSize: 8,
    fontFamily: "Inter_500Medium",
    marginTop: 3,
  },
  timelineList: { flex: 1 },
  timelineRow: {
    minHeight: 47,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  timelineRail: { width: 10, height: 47, alignItems: "center" },
  timelineDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginTop: 20,
    backgroundColor: "#56637a",
    zIndex: 2,
  },
  timelineDotActive: {
    backgroundColor: "#8b5cf6",
    shadowColor: "#8b5cf6",
    shadowOpacity: 0.9,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 0 },
  },
  timelineLine: {
    position: "absolute",
    top: 27,
    bottom: -20,
    width: 1,
    backgroundColor: "rgba(148,163,184,0.13)",
  },
  timelineDateBlock: { width: 37, alignItems: "center" },
  timelineMonth: {
    color: "#66748b",
    fontSize: 7,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: 0.6,
  },
  timelineDay: {
    color: "#dce5f1",
    fontSize: 14,
    fontFamily: "Inter_800ExtraBold",
    marginTop: 1,
  },
  timelineName: { color: "#dfe7f2", fontSize: 10, fontFamily: "Inter_700Bold" },
  timelineMeta: {
    color: "#647188",
    fontSize: 8,
    fontFamily: "Inter_500Medium",
    marginTop: 3,
  },
  timelineAmount: {
    color: "#eef4fc",
    fontSize: 10,
    fontFamily: "Inter_800ExtraBold",
  },
  lowerGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 16,
    marginBottom: 16,
  },
  categoryList: { flex: 1, gap: 12, paddingTop: 2 },
  categoryRow: { gap: 7 },
  categoryLabelRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  categoryDot: { width: 6, height: 6, borderRadius: 3 },
  categoryName: {
    flex: 1,
    color: "#ced8e6",
    fontSize: 9,
    fontFamily: "Inter_700Bold",
  },
  categoryAmount: {
    color: "#dfe7f2",
    fontSize: 9,
    fontFamily: "Inter_800ExtraBold",
  },
  categoryBudget: { color: "#59667d", fontFamily: "Inter_600SemiBold" },
  goalSummary: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    marginBottom: 11,
  },
  goalSummaryValue: {
    color: "#ffffff",
    fontSize: 28,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: -0.8,
  },
  goalSummaryLabel: {
    color: "#66748b",
    fontSize: 8,
    fontFamily: "Inter_600SemiBold",
    marginTop: 1,
  },
  goalSummaryMoney: { alignItems: "flex-end", paddingBottom: 2 },
  goalFunded: {
    color: "#5bd8aa",
    fontSize: 11,
    fontFamily: "Inter_800ExtraBold",
  },
  goalTarget: {
    color: "#59667c",
    fontSize: 8,
    fontFamily: "Inter_600SemiBold",
    marginTop: 2,
  },
  goalList: { marginTop: 10 },
  goalRow: {
    minHeight: 45,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  goalIcon: {
    width: 29,
    height: 29,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(16,185,129,0.11)",
  },
  goalName: { color: "#d9e3f0", fontSize: 9, fontFamily: "Inter_700Bold" },
  goalMeta: {
    color: "#627087",
    fontSize: 8,
    fontFamily: "Inter_500Medium",
    marginTop: 2,
  },
  goalAmount: {
    color: "#c9d3e0",
    fontSize: 9,
    fontFamily: "Inter_800ExtraBold",
  },
  quickGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  quickAction: {
    width: "48%",
    minHeight: 54,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.10)",
    backgroundColor: "rgba(2,6,23,0.28)",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 9,
  },
  quickIcon: {
    width: 29,
    height: 29,
    borderRadius: 9,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  quickLabel: {
    flex: 1,
    color: "#cdd7e5",
    fontSize: 8,
    lineHeight: 11,
    fontFamily: "Inter_700Bold",
  },
  emptyState: {
    minHeight: 130,
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    borderRadius: 15,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "rgba(148,163,184,0.12)",
    backgroundColor: "rgba(2,6,23,0.18)",
    padding: 16,
  },
  emptyIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(148,163,184,0.08)",
  },
  emptyText: {
    color: "#66748b",
    textAlign: "center",
    fontSize: 9,
    lineHeight: 13,
    fontFamily: "Inter_600SemiBold",
  },
  footer: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    borderTopWidth: 1,
    borderTopColor: "rgba(148,163,184,0.08)",
    marginTop: 5,
  },
  footerBrand: { flexDirection: "row", alignItems: "center", gap: 7 },
  footerDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: "#8b5cf6",
  },
  footerText: {
    color: "#56637a",
    fontSize: 8,
    fontFamily: "Inter_600SemiBold",
  },
  footerMeta: {
    color: "#56637a",
    fontSize: 8,
    fontFamily: "Inter_600SemiBold",
    textTransform: "capitalize",
  },
});
