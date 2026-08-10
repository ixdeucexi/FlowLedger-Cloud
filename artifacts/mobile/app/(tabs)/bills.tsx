import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AddBillModal } from "@/components/AddBillModal";
import { CommandPlusButton } from "@/components/CommandPlusButton";
import { DesktopBillsDebtsPage } from "@/components/desktop/DesktopBillsDebtsPage";
import { EmptyState } from "@/components/EmptyState";
import { PremiumBackdrop } from "@/components/PremiumBackdrop";
import { PlanFeatureGate } from "@/components/PlanFeatureGate";
import colors from "@/constants/colors";
import type { Bill } from "@/context/BudgetContext";
import { useBudget } from "@/context/BudgetContext";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { useDesktopExperience } from "@/hooks/useDesktopExperience";
import { confirmAction } from "@/lib/confirmAction";
import { effectiveDebtMinimum } from "@/lib/snowball";
import { buildDebtPaymentPlanSummary } from "@/lib/debtPaymentPlan";
import {
  orderActiveDebtsForStrategy,
  sortDebtsWithPaidLast,
} from "@/lib/debtOrder";
import { loadCategoryBudgets } from "@/lib/categoryBudgetStore";
import {
  buildOverdueBillOccurrences,
  groupOverdueBills,
} from "@/lib/overdueBills";
import {
  activePendingPlanMatches,
  pendingOccurrenceKeySet,
} from "@/lib/pendingPlanMatches";

const CAT_COLORS: Record<string, string> = {
  Housing: "#0f9b8e",
  Utilities: "#f0b429",
  Insurance: "#6366f1",
  Transportation: "#ec4899",
  Food: "#f97316",
  Entertainment: "#8b5cf6",
  Health: "#ef4444",
  Education: "#3b82f6",
  Savings: "#22c55e",
  Debt: "#e11d48",
  Other: "#94a3b8",
};

type Tab = "bills" | "debt";
type Filter = "all" | "recurring" | "one-time" | "stopped";
type SortMode = "priority" | "balance" | "interest";
const MONTH_FULL = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const FILTER_LABELS: Record<Filter, string> = {
  all: "All",
  recurring: "Recurring",
  "one-time": "One-Time",
  stopped: "Stopped",
};

function debtMonthlyMinimum(
  debt: Pick<Bill, "amount" | "snowball_minimum_boost">,
): number {
  return effectiveDebtMinimum(
    debt.amount,
    Number(debt.snowball_minimum_boost ?? 0),
  );
}

function debtRequiredMinimum(debt: Pick<Bill, "amount">): number {
  return Math.max(0, Number(debt.amount) || 0);
}

export default function BillsScreen() {
  const c = useColors();
  const isDesktop = useDesktopExperience();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const {
    bills,
    addBill,
    updateBill,
    stopFutureBill,
    deleteBill,
    deleteBillMistake,
    dashboardFilter,
    setDashboardFilter,
    settings,
    updateSettings,
    previewDebtSnowball,
    getExtraPayment,
    getMonthlyBills,
    getBillOccurrencesInMonth,
    getBillMonthlyTotal,
    getBillEffectiveMonthlyTotal,
    getDebtPlanForMonth,
    getPaidAmount,
    activeHousehold,
    pendingBankTransactions,
    pendingPlanMatches,
  } = useBudget();

  const [activeTab, setActiveTab] = useState<Tab>("bills");
  const [modalVisible, setModalVisible] = useState(false);
  const [editBill, setEditBill] = useState<Bill | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [sortMode, setSortMode] = useState<SortMode>("priority");
  const [debtInfoVisible, setDebtInfoVisible] = useState(false);
  const [categoryBudgets, setCategoryBudgets] = useState<
    Record<string, number>
  >({});

  useEffect(() => {
    if (dashboardFilter === "debt") {
      setActiveTab("debt");
      setDashboardFilter(null);
    }
  }, [dashboardFilter]);

  const webTopPad = Platform.OS === "web" ? 4 : 0;

  // ── Bills data ──────────────────────────────────────────────────
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();
  const categoryBudgetScope = useMemo(
    () => ({
      userId: user?.id,
      householdId: activeHousehold?.householdId,
      budgetId: activeHousehold?.budgetId,
    }),
    [activeHousehold?.budgetId, activeHousehold?.householdId, user?.id],
  );

  useEffect(() => {
    if (!settings.zeroBasedBudgetEnabled) {
      setCategoryBudgets({});
      return;
    }
    let cancelled = false;
    void loadCategoryBudgets(
      categoryBudgetScope,
      currentMonth,
      currentYear,
    ).then((budgets) => {
      if (!cancelled) setCategoryBudgets(budgets);
    });
    return () => {
      cancelled = true;
    };
  }, [
    categoryBudgetScope,
    currentMonth,
    currentYear,
    settings.zeroBasedBudgetEnabled,
  ]);
  const currentDay = now.getDate();
  const billOccurrenceDays = useCallback(
    (bill: Bill) => getBillOccurrencesInMonth(bill, currentMonth, currentYear),
    [currentMonth, currentYear, getBillOccurrencesInMonth],
  );
  const nextBillOccurrence = useCallback(
    (bill: Bill) => {
      const searchWindowMonths = 72;
      for (let offset = 0; offset < searchWindowMonths; offset += 1) {
        const absoluteMonth = currentMonth + offset;
        const month = absoluteMonth % 12;
        const year = currentYear + Math.floor(absoluteMonth / 12);
        const days = getBillOccurrencesInMonth(bill, month, year).filter(
          (day) => offset > 0 || day >= currentDay,
        );
        if (days.length > 0) {
          return {
            month,
            year,
            days,
            sortTime: new Date(year, month, days[0], 12).getTime(),
          };
        }
      }

      return {
        month: currentMonth,
        year: currentYear,
        days: [] as number[],
        sortTime: Number.MAX_SAFE_INTEGER,
      };
    },
    [currentDay, currentMonth, currentYear, getBillOccurrencesInMonth],
  );
  const stoppedCutoff = useMemo(
    () => new Date(currentYear, currentMonth + 1, 0),
    [currentMonth, currentYear],
  );
  const isStoppedFutureBill = useCallback(
    (bill: Bill) => {
      if (!bill.end_date) return false;
      const [endYear, endMonth, endDay] = bill.end_date.split("-").map(Number);
      if (![endYear, endMonth].every(Number.isFinite)) return false;
      const endDate = new Date(
        endYear,
        endMonth - 1,
        Number.isFinite(endDay) ? endDay : 1,
      );
      return endDate <= stoppedCutoff;
    },
    [stoppedCutoff],
  );
  const currentMonthBills = bills.filter(
    (b) => billOccurrenceDays(b).length > 0,
  );
  const visibleBills = bills;
  const nonDebtBills = visibleBills.filter((b) => !b.is_debt);
  const activeNonDebtBills = nonDebtBills.filter(
    (b) => !isStoppedFutureBill(b),
  );
  const stoppedNonDebtBills = nonDebtBills.filter(isStoppedFutureBill);
  const filteredBills = (
    filter === "stopped" ? stoppedNonDebtBills : activeNonDebtBills
  )
    .filter((b) => {
      if (filter === "stopped") return true;
      if (filter === "recurring") return b.is_recurring;
      if (filter === "one-time") return !b.is_recurring;
      return true;
    })
    .sort((a, b) => {
      if (filter === "stopped")
        return (
          (b.end_date ?? "").localeCompare(a.end_date ?? "") ||
          a.name.localeCompare(b.name)
        );
      return (
        nextBillOccurrence(a).sortTime - nextBillOccurrence(b).sortTime ||
        a.name.localeCompare(b.name)
      );
    });

  const totalAmount = activeNonDebtBills
    .filter((b) => b.is_recurring)
    .reduce((s, b) => s + getBillMonthlyTotal(b, currentMonth, currentYear), 0);
  const totalCount = activeNonDebtBills.length;
  const currentNonDebtBills = currentMonthBills.filter((bill) => !bill.is_debt);
  const currentBillTotal = currentNonDebtBills.reduce(
    (sum, bill) => sum + getBillMonthlyTotal(bill, currentMonth, currentYear),
    0,
  );
  const paidBillCount = currentNonDebtBills.filter((bill) => {
    const planned = getBillMonthlyTotal(bill, currentMonth, currentYear);
    return (
      planned > 0 &&
      getPaidAmount(bill.id, currentMonth, currentYear) >= planned - 0.005
    );
  }).length;
  const livePendingMatches = useMemo(
    () => activePendingPlanMatches(pendingPlanMatches, pendingBankTransactions),
    [pendingBankTransactions, pendingPlanMatches],
  );
  const pendingOccurrenceKeys = useMemo(
    () => pendingOccurrenceKeySet(pendingPlanMatches, pendingBankTransactions),
    [pendingBankTransactions, pendingPlanMatches],
  );
  const overdueBills = useMemo(
    () =>
      groupOverdueBills(
        buildOverdueBillOccurrences(
          getMonthlyBills(currentMonth, currentYear).map((bill) => ({
            billId: bill.id,
            name: bill.name,
            occurrenceDays: getBillOccurrencesInMonth(
              bill,
              currentMonth,
              currentYear,
            ),
            plannedTotal: getBillEffectiveMonthlyTotal(
              bill,
              currentMonth,
              currentYear,
            ),
            paidTotal: getPaidAmount(bill.id, currentMonth, currentYear),
          })),
          currentMonth,
          currentYear,
          currentDay,
        ).filter(
          (occurrence) =>
            !pendingOccurrenceKeys.has(
              `${occurrence.billId}:${occurrence.occurrenceDate}`,
            ),
        ),
      ),
    [
      currentDay,
      currentMonth,
      currentYear,
      getBillEffectiveMonthlyTotal,
      getBillOccurrencesInMonth,
      getMonthlyBills,
      getPaidAmount,
      pendingOccurrenceKeys,
    ],
  );
  const overdueByBill = useMemo(
    () => new Map(overdueBills.map((alert) => [alert.billId, alert])),
    [overdueBills],
  );
  const firstOverdueBill = overdueBills[0] ?? null;
  const pendingByBill = useMemo(() => {
    const result = new Map<string, (typeof livePendingMatches)[number]>();
    livePendingMatches.forEach((match) => {
      if (!result.has(match.target_id)) result.set(match.target_id, match);
    });
    return result;
  }, [livePendingMatches]);
  const formatBillDueText = useCallback(
    (bill: Bill) => {
      const next = nextBillOccurrence(bill);
      if (next.days.length > 0)
        return `Next occurrence: ${MONTH_FULL[next.month]} ${next.days[0]}, ${next.year}`;
      return "No upcoming occurrence";
    },
    [nextBillOccurrence],
  );
  const frequencyText = useCallback((bill: Bill) => {
    if (!bill.is_recurring) return "one-time";
    if (bill.frequency === "weekly") return "/week";
    if (bill.frequency === "biweekly") return "biweekly";
    if (bill.frequency === "quarterly") return "every 3 months";
    return "/month";
  }, []);
  const formatStoppedText = useCallback((bill: Bill) => {
    if (!bill.end_date) return "Stopped";
    const [endYear, endMonth, endDay] = bill.end_date.split("-").map(Number);
    if (![endYear, endMonth, endDay].every(Number.isFinite)) return "Stopped";
    return `Stopped after ${MONTH_FULL[endMonth - 1]} ${endDay}, ${endYear}`;
  }, []);
  const handleRestartStoppedBill = useCallback(
    (bill: Bill) => {
      const noun = bill.is_debt ? "debt" : "bill";
      confirmAction({
        title: `Restart ${noun}`,
        message: `Add "${bill.name}" back to active ${noun}s and future calendar dates?`,
        confirmText: "Restart",
        onConfirm: async () => {
          try {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            await updateBill({ ...bill, end_date: undefined });
          } catch (error) {
            Alert.alert(
              "Couldn’t restart bill",
              error instanceof Error ? error.message : "Please try again.",
            );
          }
        },
      });
    },
    [updateBill],
  );

  // ── Debt data ───────────────────────────────────────────────────
  const debtBills = visibleBills.filter((bill) => bill.is_debt);
  const { month: debtPlanMonth, year: debtPlanYear } = useMemo(() => {
    for (let offset = 0; offset < 72; offset += 1) {
      const absoluteMonth = currentMonth + offset;
      const month = absoluteMonth % 12;
      const year = currentYear + Math.floor(absoluteMonth / 12);
      if (
        getMonthlyBills(month, year).some(
          (bill) => bill.is_debt && bill.balance > 0.009,
        )
      )
        return { month, year };
    }
    return { month: currentMonth, year: currentYear };
  }, [bills, currentMonth, currentYear, getMonthlyBills]);
  const debtPlanIsFuture =
    debtPlanMonth !== currentMonth || debtPlanYear !== currentYear;
  const baseSnowballPreview = useMemo(
    () => previewDebtSnowball(debtPlanMonth, debtPlanYear),
    [bills, debtPlanMonth, debtPlanYear, previewDebtSnowball],
  );
  const existingSnowball = getExtraPayment(debtPlanMonth, debtPlanYear);
  const datedDebtPlan = getDebtPlanForMonth(debtPlanMonth, debtPlanYear);
  const cashFlowSafeSnowballAmount = baseSnowballPreview.safeMaximum;

  const debtPlanIds = new Set(
    getMonthlyBills(debtPlanMonth, debtPlanYear)
      .filter((bill) => bill.is_debt)
      .map((bill) => bill.id),
  );
  const planDebts = debtBills.filter(
    (debt) => debt.balance > 0.009 && debtPlanIds.has(debt.id),
  );
  const activeDebts = planDebts.filter(
    (debt) => debt.include_in_snowball !== false,
  );
  const snowballOrder = orderActiveDebtsForStrategy(activeDebts, "snowball");
  const avalancheOrder = orderActiveDebtsForStrategy(activeDebts, "avalanche");
  const strategyOrder =
    settings.paymentMethod === "avalanche" ? avalancheOrder : snowballOrder;
  const strategyRankById = new Map(
    strategyOrder.map((debt, index) => [debt.id, index + 1]),
  );
  const debts = (() => {
    if (sortMode === "balance") return sortDebtsWithPaidLast(debtBills);
    return debtBills.slice().sort((left, right) => {
      const leftPaid = left.balance <= 0.009;
      const rightPaid = right.balance <= 0.009;
      if (leftPaid !== rightPaid) return leftPaid ? 1 : -1;
      if (sortMode === "priority") {
        const leftRank =
          strategyRankById.get(left.id) ?? Number.MAX_SAFE_INTEGER;
        const rightRank =
          strategyRankById.get(right.id) ?? Number.MAX_SAFE_INTEGER;
        return leftRank - rightRank || left.name.localeCompare(right.name);
      }
      return (
        right.interest_rate - left.interest_rate ||
        left.balance - right.balance ||
        left.name.localeCompare(right.name)
      );
    });
  })();

  const totalDebt = debtBills.reduce((sum, debt) => sum + debt.balance, 0);
  const totalMinPayments = planDebts.reduce(
    (sum, debt) => sum + debtRequiredMinimum(debt),
    0,
  );
  const rolledSnowballPayments = planDebts.reduce(
    (sum, debt) => sum + Math.max(0, Number(debt.snowball_minimum_boost ?? 0)),
    0,
  );
  const debtPaymentPlan = buildDebtPaymentPlanSummary(
    totalMinPayments,
    rolledSnowballPayments + (existingSnowball?.amount ?? 0),
  );
  const assignedDebtExtra = settings.zeroBasedBudgetEnabled
    ? Math.max(
        0,
        Number(categoryBudgets.Debt ?? totalMinPayments) - totalMinPayments,
      )
    : cashFlowSafeSnowballAmount;
  const highestAPR = debts.length
    ? Math.max(...debts.map((b) => b.interest_rate))
    : 0;
  const snowballTarget = snowballOrder[0] ?? null;
  const avalancheTarget = avalancheOrder[0] ?? null;
  const activeDebtTarget =
    settings.paymentMethod === "avalanche"
      ? (avalancheTarget ?? snowballTarget)
      : snowballTarget;
  const activeDebtMinimum = activeDebtTarget
    ? debtMonthlyMinimum(activeDebtTarget)
    : 0;
  const nextStrategyTarget = strategyOrder[1] ?? null;
  const activeDebtRollover = activeDebtTarget && datedDebtPlan
    ? datedDebtPlan.allocations.filter(allocation =>
      allocation.kind === "rollover"
      && allocation.sourceBillId === activeDebtTarget.id
      && allocation.targetBillId !== activeDebtTarget.id)
    : [];
  const activeDebtRolloverAmount = activeDebtRollover.reduce((sum, allocation) => sum + allocation.amount, 0);
  const activeDebtRolloverNames = Array.from(new Set(activeDebtRollover.map(allocation => allocation.targetBillName))).join(", ");
  const activeDebtRolloverDate = activeDebtRollover[0]?.date;
  const forecastDebtPayment = datedDebtPlan?.plannedPayment ?? totalMinPayments;
  const forecastPaymentByDebtId = new Map(
    datedDebtPlan?.payments.map(payment => [payment.billId, payment.totalPayment]) ?? [],
  );
  const forecastRolloverByDebtId = new Map<string, number>();
  datedDebtPlan?.allocations.filter(allocation => allocation.kind === "rollover").forEach(allocation => {
    forecastRolloverByDebtId.set(
      allocation.targetBillId,
      (forecastRolloverByDebtId.get(allocation.targetBillId) ?? 0) + allocation.amount,
    );
  });

  const priorityColors = [
    "#22c55e",
    "#f0b429",
    "#ef4444",
    "#8b5cf6",
    "#ec4899",
  ];
  // ── Handlers ────────────────────────────────────────────────────
  const handleSave = useCallback(
    (data: Omit<Bill, "id" | "created_at"> | Bill) => {
      if ("id" in data) return updateBill(data as Bill);
      return addBill(data);
    },
    [addBill, updateBill],
  );

  const openSnowballPlanner = () => {
    if (
      settings.zeroBasedBudgetEnabled &&
      cashFlowSafeSnowballAmount > 0 &&
      assignedDebtExtra <= 0
    ) {
      Alert.alert(
        "Assign money to Debt",
        "Zero-Based Budget is protecting your category plan. Assign money above your debt minimums before scheduling an extra payment.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Open Budget",
            onPress: () => router.push("/(tabs)/category-budget" as any),
          },
        ],
      );
      return;
    }
    router.push("/snowball-plan" as never);
  };

  // ── Subtitle ─────────────────────────────────────────────────────
  const subtitle =
    activeTab === "bills"
      ? `${totalCount} bill${totalCount !== 1 ? "s" : ""} · $${totalAmount.toFixed(0)}/mo recurring`
      : `${debts.length} debt${debts.length !== 1 ? "s" : ""} · $${totalDebt.toLocaleString(undefined, { maximumFractionDigits: 0 })} total`;
  const listBottomPadding = isDesktop
    ? 48
    : insets.bottom + (Platform.OS === "web" ? 128 : 118);

  if (isDesktop) return <DesktopBillsDebtsPage />;

  return (
    <View style={[styles.screen, { backgroundColor: c.background }]}>
      <PremiumBackdrop variant={activeTab === "debt" ? "purple" : "blue"} />
      <ScrollView
        showsVerticalScrollIndicator
        contentContainerStyle={{ paddingBottom: listBottomPadding }}
        scrollIndicatorInsets={{ bottom: listBottomPadding }}
      >
        <View style={isDesktop ? styles.desktopCanvas : undefined}>
          {/* ── Header ── */}
          <View
            style={[
              styles.header,
              isDesktop && styles.desktopHeader,
              { paddingTop: isDesktop ? 8 : insets.top + 12 + webTopPad },
            ]}
          >
            <View>
              <Text
                style={[
                  styles.title,
                  isDesktop && styles.desktopTitle,
                  { color: c.foreground },
                ]}
              >
                Bills
              </Text>
              <Text style={[styles.subtitle, { color: c.mutedForeground }]}>
                {subtitle}
              </Text>
            </View>
            <CommandPlusButton
              onPress={() => {
                setEditBill(null);
                setModalVisible(true);
              }}
              accessibilityLabel={
                activeTab === "debt" ? "Add debt" : "Add bill"
              }
            />
          </View>

          {/* Keep the Bills / Debt switch in one stable location for both views. */}
          <View
            style={[
              styles.segmentWrap,
              { paddingHorizontal: 16, marginBottom: 12 },
            ]}
          >
            <View style={[styles.segment, { backgroundColor: c.muted }]}>
              {(["bills", "debt"] as Tab[]).map((t) => (
                <Pressable
                  key={t}
                  accessibilityRole="tab"
                  accessibilityLabel={t === "bills" ? "Bills" : "Debt"}
                  accessibilityState={{ selected: activeTab === t }}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setActiveTab(t);
                  }}
                  style={[
                    styles.segmentBtn,
                    {
                      backgroundColor:
                        activeTab === t ? c.primary : "transparent",
                    },
                  ]}
                >
                  <Feather
                    name={t === "bills" ? "file-text" : "credit-card"}
                    size={13}
                    color={
                      activeTab === t ? c.primaryForeground : c.mutedForeground
                    }
                  />
                  <Text
                    style={[
                      styles.segmentText,
                      {
                        color:
                          activeTab === t
                            ? c.primaryForeground
                            : c.mutedForeground,
                      },
                    ]}
                  >
                    {t === "bills" ? "Bills" : "Debt"}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          {activeTab === "bills" && firstOverdueBill ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${firstOverdueBill.name} is past due. Review it on the calendar.`}
              onPress={() =>
                router.push({
                  pathname: "/(tabs)/monthly",
                  params: {
                    openDate: firstOverdueBill.firstOccurrenceDate,
                    openDateAt: String(Date.now()),
                  },
                } as any)
              }
              style={({ pressed }) => [
                styles.overdueCard,
                isDesktop && styles.desktopSection,
                {
                  backgroundColor: c.destructive + "12",
                  borderColor: c.destructive + "70",
                  opacity: pressed ? 0.82 : 1,
                },
              ]}
            >
              <View
                style={[
                  styles.overdueIcon,
                  { backgroundColor: c.destructive + "20" },
                ]}
              >
                <Feather
                  name="alert-triangle"
                  size={19}
                  color={c.destructive}
                />
              </View>
              <View style={styles.overdueCopy}>
                <Text style={[styles.overdueEyebrow, { color: c.destructive }]}>
                  Past due · action needed
                </Text>
                <Text style={[styles.overdueTitle, { color: c.foreground }]}>
                  {firstOverdueBill.name} still needs $
                  {firstOverdueBill.remainingAmount.toFixed(2)}
                </Text>
                <Text
                  style={[styles.overdueText, { color: c.mutedForeground }]}
                >
                  {new Date(
                    `${firstOverdueBill.firstOccurrenceDate}T12:00:00`,
                  ).toLocaleDateString("en-US", {
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  })}{" "}
                  has passed. Tap to review or mark it paid.
                  {overdueBills.length > 1
                    ? ` ${overdueBills.length - 1} more ${overdueBills.length - 1 === 1 ? "bill needs" : "bills need"} action.`
                    : ""}
                </Text>
              </View>
              <Feather name="chevron-right" size={18} color={c.destructive} />
            </Pressable>
          ) : null}

          {activeTab === "bills" ? (
            <View
              style={[
                styles.billSnapshotCard,
                isDesktop && styles.desktopSection,
                { backgroundColor: c.card, borderColor: c.border },
              ]}
            >
              <View style={styles.billSnapshotHeader}>
                <View>
                  <Text
                    style={[
                      styles.billSnapshotLabel,
                      { color: c.mutedForeground },
                    ]}
                  >
                    Bill snapshot
                  </Text>
                  <Text
                    style={[styles.billSnapshotTitle, { color: c.foreground }]}
                  >
                    {MONTH_FULL[currentMonth]} {currentYear}
                  </Text>
                </View>
                <View
                  style={[
                    styles.billSnapshotBadge,
                    {
                      backgroundColor:
                        paidBillCount === currentNonDebtBills.length &&
                        currentNonDebtBills.length > 0
                          ? c.success + "18"
                          : c.warning + "18",
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.billSnapshotBadgeText,
                      {
                        color:
                          paidBillCount === currentNonDebtBills.length &&
                          currentNonDebtBills.length > 0
                            ? c.success
                            : c.warning,
                      },
                    ]}
                  >
                    {paidBillCount} paid
                  </Text>
                </View>
              </View>
              <View style={styles.billSnapshotStats}>
                <View
                  style={[
                    styles.billSnapshotStat,
                    { backgroundColor: c.background, borderColor: c.border },
                  ]}
                >
                  <Text
                    style={[styles.billSnapshotValue, { color: c.foreground }]}
                  >
                    ${currentBillTotal.toFixed(0)}
                  </Text>
                  <Text
                    style={[
                      styles.billSnapshotStatLabel,
                      { color: c.mutedForeground },
                    ]}
                  >
                    Due this month
                  </Text>
                </View>
                <View
                  style={[
                    styles.billSnapshotStat,
                    { backgroundColor: c.background, borderColor: c.border },
                  ]}
                >
                  <Text
                    style={[styles.billSnapshotValue, { color: c.primary }]}
                  >
                    {currentNonDebtBills.length}
                  </Text>
                  <Text
                    style={[
                      styles.billSnapshotStatLabel,
                      { color: c.mutedForeground },
                    ]}
                  >
                    Scheduled
                  </Text>
                </View>
                <View
                  style={[
                    styles.billSnapshotStat,
                    { backgroundColor: c.background, borderColor: c.border },
                  ]}
                >
                  <Text
                    style={[styles.billSnapshotValue, { color: c.success }]}
                  >
                    {paidBillCount}
                  </Text>
                  <Text
                    style={[
                      styles.billSnapshotStatLabel,
                      { color: c.mutedForeground },
                    ]}
                  >
                    Paid
                  </Text>
                </View>
              </View>
            </View>
          ) : null}

          {/* ════════════════════ BILLS VIEW ════════════════════ */}
          {activeTab === "bills" && (
            <>
              <View
                style={[styles.filterRow, isDesktop && styles.desktopToolbar]}
              >
                {(["all", "recurring", "one-time", "stopped"] as Filter[]).map(
                  (f) => (
                    <Pressable
                      key={f}
                      onPress={() => setFilter(f)}
                      style={[
                        styles.filterChip,
                        {
                          backgroundColor: filter === f ? c.primary : c.card,
                          borderRadius: colors.radius,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.filterText,
                          {
                            color:
                              filter === f
                                ? c.primaryForeground
                                : c.mutedForeground,
                          },
                        ]}
                      >
                        {FILTER_LABELS[f]}
                      </Text>
                    </Pressable>
                  ),
                )}
              </View>

              <View style={[styles.list, isDesktop && styles.desktopList]}>
                {filteredBills.length === 0 ? (
                  <EmptyState
                    icon="file-text"
                    title={
                      filter === "stopped" ? "No Stopped Bills" : "No Bills"
                    }
                    message={
                      filter === "stopped"
                        ? "Bills you stop for the future will live here."
                        : "Tap + to add your first bill."
                    }
                    actionLabel={filter === "stopped" ? undefined : "Add Bill"}
                    onAction={
                      filter === "stopped"
                        ? undefined
                        : () => {
                            setEditBill(null);
                            setModalVisible(true);
                          }
                    }
                  />
                ) : (
                  filteredBills.map((item) => {
                    const catColor = CAT_COLORS[item.category] ?? c.primary;
                    const stopped = isStoppedFutureBill(item);
                    const overdue = overdueByBill.get(item.id);
                    const pending = pendingByBill.get(item.id);
                    return (
                      <Pressable
                        key={item.id}
                        onPress={() => {
                          setEditBill(item);
                          setModalVisible(true);
                        }}
                        style={({ pressed }) => [
                          styles.card,
                          styles.activitySizedBillCard,
                          {
                            backgroundColor: c.card,
                            borderRadius: colors.radius,
                            opacity: pressed ? 0.88 : 1,
                          },
                        ]}
                      >
                        <View
                          style={[styles.catBar, { backgroundColor: catColor }]}
                        />
                        <View
                          style={[
                            styles.cardBody,
                            styles.activitySizedBillCardBody,
                          ]}
                        >
                          <View
                            style={[
                              styles.cardTop,
                              styles.activitySizedBillCardTop,
                            ]}
                          >
                            <View style={styles.cardLeft}>
                              <Text
                                style={[
                                  styles.billName,
                                  styles.activitySizedBillName,
                                  { color: c.foreground },
                                ]}
                                numberOfLines={1}
                              >
                                {item.name}
                              </Text>
                              <View
                                style={[
                                  styles.metaRow,
                                  styles.activitySizedBillMetaRow,
                                ]}
                              >
                                <View
                                  style={[
                                    styles.tag,
                                    styles.activitySizedBillTag,
                                    { backgroundColor: catColor + "18" },
                                  ]}
                                >
                                  <Text
                                    style={[
                                      styles.tagText,
                                      styles.activitySizedBillTagText,
                                      { color: catColor },
                                    ]}
                                  >
                                    {item.category}
                                  </Text>
                                </View>
                                <Text
                                  style={[
                                    styles.metaText,
                                    styles.activitySizedBillMetaText,
                                    { color: c.mutedForeground },
                                  ]}
                                >
                                  {stopped
                                    ? formatStoppedText(item)
                                    : formatBillDueText(item)}
                                </Text>
                                {stopped ? (
                                  <View
                                    style={[
                                      styles.tag,
                                      styles.activitySizedBillTag,
                                      { backgroundColor: c.muted },
                                    ]}
                                  >
                                    <Text
                                      style={[
                                        styles.tagText,
                                        styles.activitySizedBillTagText,
                                        { color: c.mutedForeground },
                                      ]}
                                    >
                                      Stopped
                                    </Text>
                                  </View>
                                ) : null}
                                {overdue ? (
                                  <View
                                    style={[
                                      styles.tag,
                                      styles.activitySizedBillTag,
                                      { backgroundColor: c.destructive + "18" },
                                    ]}
                                  >
                                    <Text
                                      style={[
                                        styles.tagText,
                                        styles.activitySizedBillTagText,
                                        { color: c.destructive },
                                      ]}
                                    >
                                      Past due · $
                                      {overdue.remainingAmount.toFixed(2)}
                                    </Text>
                                  </View>
                                ) : null}
                                {pending ? (
                                  <View
                                    style={[
                                      styles.tag,
                                      styles.activitySizedBillTag,
                                      {
                                        backgroundColor:
                                          colors.brand.blue + "18",
                                      },
                                    ]}
                                  >
                                    <Text
                                      style={[
                                        styles.tagText,
                                        styles.activitySizedBillTagText,
                                        { color: colors.brand.blue },
                                      ]}
                                    >
                                      {pending.status === "ready_review"
                                        ? "Ready to review"
                                        : "Payment pending"}
                                    </Text>
                                  </View>
                                ) : null}
                                {!item.is_recurring && (
                                  <View
                                    style={[
                                      styles.tag,
                                      styles.activitySizedBillTag,
                                      { backgroundColor: c.muted },
                                    ]}
                                  >
                                    <Text
                                      style={[
                                        styles.tagText,
                                        styles.activitySizedBillTagText,
                                        { color: c.mutedForeground },
                                      ]}
                                    >
                                      One-time
                                    </Text>
                                  </View>
                                )}
                              </View>
                            </View>
                            <View
                              style={[
                                styles.cardRight,
                                styles.activitySizedBillCardRight,
                              ]}
                            >
                              <Text
                                style={[
                                  styles.amount,
                                  styles.activitySizedBillAmount,
                                  { color: c.foreground },
                                ]}
                              >
                                ${item.amount.toFixed(2)}
                              </Text>
                              <Text
                                style={[
                                  styles.amountSub,
                                  styles.activitySizedBillAmountSub,
                                  { color: c.mutedForeground },
                                ]}
                              >
                                {frequencyText(item)}
                              </Text>
                            </View>
                          </View>
                        </View>
                        {stopped ? (
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Restart ${item.name}`}
                            onPress={(event) => {
                              event.stopPropagation?.();
                              handleRestartStoppedBill(item);
                            }}
                            style={({ pressed }) => [
                              styles.restartHint,
                              {
                                backgroundColor: c.primary + "18",
                                opacity: pressed ? 0.78 : 1,
                              },
                            ]}
                          >
                            <Feather
                              name="refresh-cw"
                              size={17}
                              color={c.primary}
                            />
                          </Pressable>
                        ) : (
                          <View
                            style={[
                              styles.editHint,
                              styles.activitySizedBillEditHint,
                            ]}
                          >
                            <Feather
                              name="edit-2"
                              size={13}
                              color={c.mutedForeground}
                            />
                          </View>
                        )}
                      </Pressable>
                    );
                  })
                )}
              </View>
            </>
          )}

          {/* ════════════════════ DEBT VIEW ════════════════════ */}
          {activeTab === "debt" && (
            <View style={[styles.list, isDesktop && styles.desktopList]}>
              <>
                <PlanFeatureGate feature="debt_payoff" compact>
                  {debts.length > 0 && (
                    <View
                      style={[
                        styles.statsRow,
                        { marginHorizontal: 0, gap: 10 },
                      ]}
                    >
                      {[
                        {
                          label: "Total Debt",
                          value: `$${totalDebt.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
                          color: c.destructive,
                          icon: "trending-down" as const,
                        },
                        {
                          label: debtPlanIsFuture
                            ? `${MONTH_FULL[debtPlanMonth].slice(0, 3)} Forecast`
                            : "Forecast",
                          value: `$${forecastDebtPayment.toFixed(0)}`,
                          color: c.warning,
                          icon: "calendar" as const,
                        },
                        {
                          label: "Highest APR",
                          value: `${highestAPR}%`,
                          color: c.primary,
                          icon: "percent" as const,
                        },
                      ].map((s) => (
                        <View
                          key={s.label}
                          style={[
                            styles.statCard,
                            {
                              backgroundColor: c.card,
                              borderRadius: colors.radius,
                            },
                          ]}
                        >
                          <Feather name={s.icon} size={14} color={s.color} />
                          <Text style={[styles.statValue, { color: s.color }]}>
                            {s.value}
                          </Text>
                          <Text
                            style={[
                              styles.statLabel,
                              { color: c.mutedForeground },
                            ]}
                          >
                            {s.label}
                          </Text>
                        </View>
                      ))}
                    </View>
                  )}

                  {settings.debtPayoffEnabled && debts.length > 0 && (
                    <View
                      style={[
                        styles.debtAlgoCard,
                        {
                          backgroundColor: c.card,
                          borderColor: c.border,
                          marginHorizontal: 0,
                          borderRadius: colors.radius,
                        },
                      ]}
                    >
                      <View style={styles.debtAlgoHeader}>
                        <View
                          style={[
                            styles.dataIcon,
                            { backgroundColor: c.primary + "18" },
                          ]}
                        >
                          <Feather
                            name="trending-down"
                            size={17}
                            color={c.primary}
                          />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text
                            style={[
                              styles.debtAlgoEyebrow,
                              { color: c.primary },
                            ]}
                          >
                            {settings.paymentMethod === "avalanche"
                              ? "Avalanche Plan"
                              : "Snowball Plan"}
                          </Text>
                          <Text
                            style={[
                              styles.debtAlgoTitle,
                              { color: c.foreground },
                            ]}
                          >
                            {activeDebtTarget?.name ?? "No active target"}
                          </Text>
                        </View>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`How the ${settings.paymentMethod} plan works`}
                          onPress={() => setDebtInfoVisible(true)}
                          style={({ pressed }) => [
                            styles.debtInfoButton,
                            {
                              borderColor: c.border,
                              opacity: pressed ? 0.7 : 1,
                            },
                          ]}
                        >
                          <Feather name="info" size={17} color={c.primary} />
                        </Pressable>
                      </View>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={
                          existingSnowball
                            ? "View or change Snowball payment"
                            : "Make a Snowball payment"
                        }
                        onPress={openSnowballPlanner}
                        style={({ pressed }) => [
                          styles.debtPlanApplyButton,
                          {
                            backgroundColor: c.primary,
                            opacity: pressed ? 0.8 : 1,
                          },
                        ]}
                      >
                        <Feather
                          name="calendar"
                          size={16}
                          color={c.primaryForeground}
                        />
                        <Text
                          style={[
                            styles.debtPlanApplyText,
                            { color: c.primaryForeground },
                          ]}
                        >
                          {existingSnowball
                            ? "View or change Snowball payment"
                            : "Make a Snowball Payment"}
                        </Text>
                      </Pressable>
                      {existingSnowball ? (
                        <View
                          style={[
                            styles.debtPaymentSummary,
                            {
                              backgroundColor: c.background + "88",
                              borderColor: c.border,
                            },
                          ]}
                        >
                          <View style={styles.debtPaymentStat}>
                            <Text
                              style={[
                                styles.debtPaymentStatLabel,
                                { color: c.mutedForeground },
                              ]}
                            >
                              EXTRA
                            </Text>
                            <Text
                              style={[
                                styles.debtPaymentStatValue,
                                { color: c.primary },
                              ]}
                            >
                              +${debtPaymentPlan.extraPayment.toFixed(0)}
                            </Text>
                          </View>
                          <View
                            style={[
                              styles.debtPaymentStat,
                              styles.debtPaymentStatBorder,
                              { borderLeftColor: c.border },
                            ]}
                          >
                            <Text
                              style={[
                                styles.debtPaymentStatLabel,
                                { color: c.mutedForeground },
                              ]}
                            >
                              TOTAL
                            </Text>
                            <Text
                              style={[
                                styles.debtPaymentStatValue,
                                { color: c.success },
                              ]}
                            >
                              ${debtPaymentPlan.totalPlanned.toFixed(0)}
                            </Text>
                          </View>
                        </View>
                      ) : null}
                      {debtPlanIsFuture ? (
                        <Text
                          style={[
                            styles.debtAlgoCopy,
                            { color: c.mutedForeground },
                          ]}
                        >
                          Your next payoff order begins{" "}
                          {MONTH_FULL[debtPlanMonth]} {debtPlanYear}.
                        </Text>
                      ) : null}
                      {activeDebtTarget && activeDebtRolloverAmount > 0.005 ? (
                        <View
                          style={[
                            styles.rolloverCard,
                            {
                              backgroundColor: c.success + "10",
                              borderColor: c.success + "24",
                            },
                          ]}
                        >
                          <Feather name="repeat" size={13} color={c.success} />
                          <Text
                            style={[
                              styles.rolloverText,
                              { color: c.foreground },
                            ]}
                          >
                            ${activeDebtRolloverAmount.toFixed(2)} rolls to {activeDebtRolloverNames} on{" "}
                            {activeDebtRolloverDate
                              ? `${MONTH_FULL[Number(activeDebtRolloverDate.slice(5, 7)) - 1]} ${Number(activeDebtRolloverDate.slice(8, 10))}`
                              : "the same day"}.
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  )}

                  {settings.debtPayoffEnabled && (
                    <View
                      style={[
                        styles.methodRow,
                        { marginHorizontal: 0, marginTop: 10 },
                      ]}
                    >
                      <View
                        style={[
                          styles.methodToggle,
                          { backgroundColor: c.muted, borderRadius: 10 },
                        ]}
                      >
                        {(["snowball", "avalanche"] as const).map((m) => (
                          <Pressable
                            key={m}
                            onPress={() => {
                              Haptics.impactAsync(
                                Haptics.ImpactFeedbackStyle.Light,
                              );
                              setSortMode("priority");
                              updateSettings({ paymentMethod: m });
                            }}
                            style={[
                              styles.methodBtn,
                              {
                                backgroundColor:
                                  settings.paymentMethod === m
                                    ? c.primary
                                    : "transparent",
                                borderRadius: 8,
                              },
                            ]}
                          >
                            <Feather
                              name={
                                m === "snowball" ? "trending-down" : "percent"
                              }
                              size={12}
                              color={
                                settings.paymentMethod === m
                                  ? c.primaryForeground
                                  : c.mutedForeground
                              }
                            />
                            <Text
                              style={[
                                styles.methodBtnText,
                                {
                                  color:
                                    settings.paymentMethod === m
                                      ? c.primaryForeground
                                      : c.mutedForeground,
                                },
                              ]}
                            >
                              {m === "snowball" ? "Snowball" : "Avalanche"}
                            </Text>
                          </Pressable>
                        ))}
                      </View>

                      <View
                        style={[
                          styles.sortToggle,
                          { backgroundColor: c.muted, borderRadius: 10 },
                        ]}
                      >
                        {(
                          ["priority", "balance", "interest"] as SortMode[]
                        ).map((s) => (
                          <Pressable
                            key={s}
                            onPress={() => setSortMode(s)}
                            style={[
                              styles.sortBtn,
                              {
                                backgroundColor:
                                  sortMode === s ? c.card : "transparent",
                                borderRadius: 8,
                              },
                            ]}
                          >
                            <Text
                              style={[
                                styles.sortBtnText,
                                {
                                  color:
                                    sortMode === s
                                      ? c.foreground
                                      : c.mutedForeground,
                                },
                              ]}
                            >
                              {s === "priority"
                                ? "#"
                                : s === "balance"
                                  ? "$"
                                  : "%"}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                    </View>
                  )}
                </PlanFeatureGate>
              </>
              {debts.length === 0 ? (
                <EmptyState
                  icon="credit-card"
                  title="No Debts Tracked"
                  message="Add a debt to build your payoff plan."
                  actionLabel="Add Debt"
                  onAction={() => {
                    setEditBill(null);
                    setModalVisible(true);
                  }}
                />
              ) : (
                debts.map((item) => {
                  const isPaidOff = item.balance <= 0.009;
                  const strategyRank = strategyRankById.get(item.id);
                  const isExcluded =
                    !isPaidOff && item.include_in_snowball === false;
                  const isUnranked = !isPaidOff && strategyRank === undefined;
                  const priorityColor = isPaidOff
                    ? c.success
                    : isUnranked
                      ? c.mutedForeground
                      : (priorityColors[
                          Math.min(
                            (strategyRank ?? 1) - 1,
                            priorityColors.length - 1,
                          )
                        ] ?? c.primary);
                  const effectiveMinimum = debtMonthlyMinimum(item);
                  const requiredMinimum = debtRequiredMinimum(item);
                  const forecastPayment = forecastPaymentByDebtId.get(item.id);
                  const forecastRollover = forecastRolloverByDebtId.get(item.id) ?? 0;
                  const monthsToPayoff =
                    item.balance > 0 && effectiveMinimum > 0
                      ? Math.ceil(item.balance / effectiveMinimum)
                      : 0;

                  return (
                    <Pressable
                      key={item.id}
                      onPress={() => {
                        setEditBill(item);
                        setModalVisible(true);
                      }}
                      style={({ pressed }) => [
                        styles.card,
                        isDesktop && styles.desktopCard,
                        {
                          backgroundColor: c.card,
                          borderRadius: colors.radius,
                          opacity: pressed ? 0.88 : 1,
                        },
                      ]}
                    >
                      <View
                        style={[
                          styles.priorityStrip,
                          { backgroundColor: priorityColor },
                        ]}
                      >
                        <Text style={styles.priorityNum}>
                          {isPaidOff
                            ? "PAID"
                            : isExcluded
                              ? "OFF"
                              : isUnranked
                                ? "WAIT"
                                : `#${strategyRank}`}
                        </Text>
                      </View>

                      <View style={styles.cardBody}>
                        <View style={styles.cardTop}>
                          <View style={styles.cardLeft}>
                            <Text
                              style={[styles.debtName, { color: c.foreground }]}
                            >
                              {item.name}
                            </Text>
                            <View style={styles.metaRow}>
                              {item.interest_rate > 0 && (
                                <View
                                  style={[
                                    styles.aprBadge,
                                    { backgroundColor: c.destructive + "20" },
                                  ]}
                                >
                                  <Text
                                    style={[
                                      styles.aprText,
                                      { color: c.destructive },
                                    ]}
                                  >
                                    {item.interest_rate}% APR
                                  </Text>
                                </View>
                              )}
                              <Text
                                style={[
                                  styles.metaText,
                                  {
                                    color: isPaidOff
                                      ? c.success
                                      : c.mutedForeground,
                                  },
                                ]}
                              >
                                {isPaidOff
                                  ? "Paid off"
                                  : formatBillDueText(item)}
                              </Text>
                              {monthsToPayoff > 0 && (
                                <Text
                                  style={[
                                    styles.metaText,
                                    { color: c.mutedForeground },
                                  ]}
                                >
                                  ~{monthsToPayoff} mo left
                                </Text>
                              )}
                            </View>
                          </View>
                          <View style={styles.cardRight}>
                            <Text
                              style={[
                                styles.balance,
                                {
                                  color: isPaidOff ? c.success : c.destructive,
                                },
                              ]}
                            >
                              {isPaidOff
                                ? "Paid"
                                : `$${item.balance.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
                            </Text>
                            {!isPaidOff && (
                              <Text
                                style={[
                                  styles.minPay,
                                  { color: c.mutedForeground },
                                ]}
                              >
                                {forecastPayment !== undefined
                                  ? `$${forecastPayment.toFixed(2)} forecast payment`
                                  : `$${requiredMinimum.toFixed(2)}/mo required`}
                              </Text>
                            )}
                            {!isPaidOff &&
                              forecastRollover > 0.005 && (
                                <Text
                                  style={[
                                    styles.metaText,
                                    { color: c.success },
                                  ]}
                                >
                                  Includes ${forecastRollover.toFixed(2)} rollover
                                </Text>
                              )}
                          </View>
                        </View>

                        {isPaidOff ? (
                          <View style={styles.progressSection}>
                            <View style={styles.progressHeader}>
                              <Text
                                style={[
                                  styles.progressLabel,
                                  { color: c.mutedForeground },
                                ]}
                              >
                                Payoff status
                              </Text>
                              <Text
                                style={[
                                  styles.progressPct,
                                  { color: c.success },
                                ]}
                              >
                                Complete
                              </Text>
                            </View>
                            <View
                              style={[
                                styles.progressBg,
                                { backgroundColor: c.muted },
                              ]}
                            >
                              <View
                                style={[
                                  styles.progressFill,
                                  {
                                    width: "100%" as any,
                                    backgroundColor: c.success,
                                  },
                                ]}
                              />
                            </View>
                          </View>
                        ) : null}

                        {settings.paymentMethod === "snowball" && (
                          <View
                            style={[
                              styles.strategyNote,
                              { backgroundColor: priorityColor + "12" },
                            ]}
                          >
                            <Feather
                              name="zap"
                              size={11}
                              color={priorityColor}
                            />
                            <Text
                              style={[
                                styles.strategyText,
                                { color: c.mutedForeground },
                              ]}
                            >
                              {isPaidOff
                                ? "Paid off — no longer in the active order"
                                : isExcluded
                                  ? "Not included in your payoff plan"
                                  : isUnranked
                                    ? `Not active in the ${MONTH_FULL[debtPlanMonth]} payoff order`
                                    : strategyRank === 1
                                      ? "Target first — put all extra here"
                                      : `Pay off #${(strategyRank ?? 1) - 1} first, then cascade here`}
                            </Text>
                          </View>
                        )}
                        {settings.paymentMethod === "avalanche" &&
                          item.interest_rate > 0 && (
                            <View
                              style={[
                                styles.strategyNote,
                                { backgroundColor: c.primary + "12" },
                              ]}
                            >
                              <Feather
                                name="trending-up"
                                size={11}
                                color={c.primary}
                              />
                              <Text
                                style={[
                                  styles.strategyText,
                                  { color: c.mutedForeground },
                                ]}
                              >
                                {isPaidOff
                                  ? "Paid off — no longer in the active order"
                                  : isExcluded
                                    ? "Not included in your payoff plan"
                                    : isUnranked
                                      ? `Not active in the ${MONTH_FULL[debtPlanMonth]} payoff order`
                                      : strategyRank === 1
                                        ? "Highest interest — target this first"
                                        : `Pay off #${(strategyRank ?? 1) - 1} first, then cascade here`}
                              </Text>
                            </View>
                          )}
                      </View>

                      <View style={styles.editHint}>
                        <Feather
                          name="edit-2"
                          size={13}
                          color={c.mutedForeground}
                        />
                      </View>
                    </Pressable>
                  );
                })
              )}
            </View>
          )}
        </View>
      </ScrollView>

      <Modal
        animationType="fade"
        transparent
        visible={debtInfoVisible}
        onRequestClose={() => setDebtInfoVisible(false)}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close payoff information"
          onPress={() => setDebtInfoVisible(false)}
          style={styles.debtInfoOverlay}
        >
          <Pressable
            accessibilityRole="none"
            onPress={(event) => event.stopPropagation()}
            style={[
              styles.debtInfoModal,
              { backgroundColor: c.card, borderColor: c.border },
            ]}
          >
            <View style={styles.debtInfoHeader}>
              <View
                style={[
                  styles.debtInfoIcon,
                  { backgroundColor: c.primary + "18" },
                ]}
              >
                <Feather name="info" size={20} color={c.primary} />
              </View>
              <Text style={[styles.debtInfoTitle, { color: c.foreground }]}>
                How{" "}
                {settings.paymentMethod === "avalanche"
                  ? "Avalanche"
                  : "Snowball"}{" "}
                works
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close"
                onPress={() => setDebtInfoVisible(false)}
                hitSlop={10}
              >
                <Feather name="x" size={21} color={c.mutedForeground} />
              </Pressable>
            </View>
            {activeDebtTarget ? (
              <View
                style={[
                  styles.debtInfoTarget,
                  {
                    backgroundColor: c.primary + "10",
                    borderColor: c.primary + "28",
                  },
                ]}
              >
                <Text
                  style={[styles.debtInfoTargetLabel, { color: c.primary }]}
                >
                  WHY {activeDebtTarget.name.toUpperCase()} IS FIRST
                </Text>
                <Text
                  style={[styles.debtInfoTargetCopy, { color: c.foreground }]}
                >
                  Put safe extra money toward {activeDebtTarget.name} first. It
                  has your{" "}
                  {settings.paymentMethod === "avalanche"
                    ? "highest interest rate"
                    : "smallest active balance"}
                  . Using extra will reduce your backup days.
                </Text>
              </View>
            ) : null}
            <View style={styles.debtInfoSteps}>
              <Text style={[styles.debtInfoStep, { color: c.foreground }]}>
                1. Pay every minimum.
              </Text>
              <Text style={[styles.debtInfoStep, { color: c.foreground }]}>
                2. Send extra to the{" "}
                {settings.paymentMethod === "avalanche"
                  ? "highest-interest debt"
                  : "smallest balance"}
                .
              </Text>
              <Text style={[styles.debtInfoStep, { color: c.foreground }]}>
                3. Roll that payment to the next debt.
              </Text>
            </View>
            {activeDebtTarget && nextStrategyTarget ? (
              <View
                style={[
                  styles.debtInfoRollover,
                  {
                    backgroundColor: c.success + "10",
                    borderColor: c.success + "28",
                  },
                ]}
              >
                <Feather name="repeat" size={15} color={c.success} />
                <Text
                  style={[styles.debtInfoRolloverText, { color: c.foreground }]}
                >
                  After {activeDebtTarget.name} is paid off, its $
                  {activeDebtMinimum.toFixed(2)}/month rolls into{" "}
                  {nextStrategyTarget.name}.
                </Text>
              </View>
            ) : null}
            <Pressable
              accessibilityRole="button"
              onPress={() => setDebtInfoVisible(false)}
              style={({ pressed }) => [
                styles.debtInfoDone,
                { backgroundColor: c.primary, opacity: pressed ? 0.8 : 1 },
              ]}
            >
              <Text
                style={[
                  styles.debtInfoDoneText,
                  { color: c.primaryForeground },
                ]}
              >
                Got it
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <AddBillModal
        visible={modalVisible}
        onClose={() => {
          setModalVisible(false);
          setEditBill(null);
        }}
        onSave={handleSave}
        onDelete={deleteBill}
        onStopFuture={stopFutureBill}
        onDeleteMistake={deleteBillMistake}
        editBill={editBill}
        forceDebt={activeTab === "debt"}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  desktopCanvas: { width: "100%", paddingTop: 16 },
  desktopHeader: { width: "100%", paddingHorizontal: 18, paddingBottom: 10 },
  desktopTitle: { fontSize: 30, letterSpacing: -0.8 },
  desktopSection: { alignSelf: "stretch" },
  desktopToolbar: { alignSelf: "stretch" },
  desktopList: { alignSelf: "stretch", paddingTop: 8 },
  activitySizedBillCard: {
    minHeight: 58,
    marginBottom: 7,
    alignItems: "center",
    shadowOpacity: 0.1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  activitySizedBillCardBody: { padding: 11 },
  activitySizedBillCardTop: { alignItems: "center", marginBottom: 0 },
  activitySizedBillName: { fontSize: 13, marginBottom: 3, letterSpacing: 0 },
  activitySizedBillMetaRow: { gap: 5 },
  activitySizedBillMetaText: { fontSize: 9 },
  activitySizedBillTag: {
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 5,
  },
  activitySizedBillTagText: { fontSize: 9 },
  activitySizedBillCardRight: { marginLeft: 10 },
  activitySizedBillAmount: { fontSize: 14 },
  activitySizedBillAmountSub: { fontSize: 9 },
  activitySizedBillEditHint: { paddingHorizontal: 11, paddingVertical: 10 },
  desktopCard: {
    minHeight: 82,
    borderRadius: 16,
    shadowOpacity: 0.12,
    shadowRadius: 16,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingBottom: 14,
  },
  title: {
    fontSize: 34,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: -1.1,
  },
  subtitle: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    marginTop: 3,
    letterSpacing: 0.2,
  },
  overdueCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    borderWidth: 1,
    borderRadius: 22,
    padding: 14,
    marginHorizontal: 16,
    marginBottom: 12,
  },
  overdueIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  overdueCopy: { flex: 1 },
  overdueEyebrow: {
    fontSize: 10,
    fontFamily: "Inter_800ExtraBold",
    textTransform: "uppercase",
    letterSpacing: 0.7,
  },
  overdueTitle: {
    fontSize: 15,
    fontFamily: "Inter_800ExtraBold",
    marginTop: 2,
  },
  overdueText: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    lineHeight: 17,
    marginTop: 3,
  },
  billSnapshotCard: {
    borderWidth: 1,
    borderRadius: 20,
    padding: 12,
    marginHorizontal: 16,
    marginBottom: 10,
  },
  billSnapshotHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 10,
  },
  billSnapshotLabel: {
    fontSize: 9,
    fontFamily: "Inter_800ExtraBold",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  billSnapshotTitle: {
    fontSize: 17,
    fontFamily: "Inter_800ExtraBold",
    marginTop: 2,
  },
  billSnapshotBadge: {
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  billSnapshotBadgeText: {
    fontSize: 10,
    fontFamily: "Inter_800ExtraBold",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  billSnapshotStats: { flexDirection: "row", gap: 10 },
  billSnapshotStat: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  billSnapshotValue: { fontSize: 17, fontFamily: "Inter_800ExtraBold" },
  billSnapshotStatLabel: {
    fontSize: 10,
    fontFamily: "Inter_700Bold",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 2,
  },

  // Segment toggle
  segmentWrap: {},
  segment: {
    flexDirection: "row",
    borderRadius: 18,
    padding: 5,
    gap: 5,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.10)",
  },
  segmentBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 11,
    borderRadius: 13,
  },
  segmentText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },

  // Bills filters
  filterRow: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  filterChip: { paddingHorizontal: 14, paddingVertical: 8 },
  filterText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },

  // Shared list / card
  list: { paddingHorizontal: 16, paddingTop: 6 },
  card: {
    flexDirection: "row",
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.12)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.18,
    shadowRadius: 22,
    elevation: 5,
    overflow: "hidden",
  },
  cardBody: { flex: 1, padding: 14 },
  cardTop: { flexDirection: "row", alignItems: "flex-start", marginBottom: 10 },
  cardLeft: { flex: 1 },
  cardRight: { alignItems: "flex-end", marginLeft: 8 },
  metaRow: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    flexWrap: "wrap",
  },
  metaText: { fontSize: 11, fontFamily: "Inter_400Regular" },
  editHint: { padding: 14, justifyContent: "center" },
  restartHint: {
    width: 46,
    marginVertical: 12,
    marginRight: 10,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },

  // Bills-specific
  catBar: { width: 4 },
  billName: {
    fontSize: 17,
    fontFamily: "Inter_800ExtraBold",
    marginBottom: 7,
    letterSpacing: -0.2,
  },
  tag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  tagText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  amount: { fontSize: 18, fontFamily: "Inter_700Bold" },
  amountSub: { fontSize: 10, fontFamily: "Inter_400Regular" },

  // Debt-specific
  statsRow: { flexDirection: "row" },
  statCard: { flex: 1, alignItems: "center", paddingVertical: 12, gap: 4 },
  statValue: { fontSize: 16, fontFamily: "Inter_700Bold" },
  statLabel: {
    fontSize: 10,
    fontFamily: "Inter_500Medium",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  debtAlgoCard: {
    borderWidth: 1,
    padding: 14,
    marginTop: 10,
    marginBottom: 2,
    gap: 10,
  },
  debtAlgoHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  dataIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  debtAlgoEyebrow: {
    fontSize: 10,
    fontFamily: "Inter_800ExtraBold",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  debtAlgoTitle: {
    fontSize: 17,
    fontFamily: "Inter_800ExtraBold",
    marginTop: 2,
  },
  debtInfoButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  debtInfoOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.72)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  debtInfoModal: {
    width: "100%",
    maxWidth: 420,
    borderWidth: 1,
    borderRadius: 22,
    padding: 18,
    gap: 18,
  },
  debtInfoHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  debtInfoIcon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  debtInfoTitle: { flex: 1, fontSize: 18, fontFamily: "Inter_800ExtraBold" },
  debtInfoTarget: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 6 },
  debtInfoTargetLabel: {
    fontSize: 11,
    letterSpacing: 0.7,
    fontFamily: "Inter_800ExtraBold",
  },
  debtInfoTargetCopy: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: "Inter_600SemiBold",
  },
  debtInfoSteps: { gap: 12 },
  debtInfoStep: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: "Inter_600SemiBold",
  },
  debtInfoRollover: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    gap: 10,
  },
  debtInfoRolloverText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: "Inter_600SemiBold",
  },
  debtInfoDone: {
    height: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  debtInfoDoneText: { fontSize: 14, fontFamily: "Inter_800ExtraBold" },
  debtPlanApplyButton: {
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
  },
  debtPlanApplyText: {
    fontSize: 14,
    fontFamily: "Inter_800ExtraBold",
    textAlign: "center",
  },
  debtPaymentSummary: {
    flexDirection: "row",
    borderWidth: 1,
    borderRadius: 15,
    paddingVertical: 10,
  },
  debtPaymentStat: {
    flex: 1,
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 5,
  },
  debtPaymentStatBorder: { borderLeftWidth: 1 },
  debtPaymentStatLabel: {
    fontSize: 9,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: 0.6,
  },
  debtPaymentStatValue: { fontSize: 15, fontFamily: "Inter_800ExtraBold" },
  debtAlgoCopy: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    lineHeight: 18,
  },
  rolloverCard: {
    marginTop: 2,
    borderWidth: 1,
    borderRadius: 14,
    padding: 10,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  rolloverText: {
    flex: 1,
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    lineHeight: 16,
  },
  methodRow: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    marginBottom: 6,
  },
  methodToggle: { flex: 1, flexDirection: "row", padding: 4, gap: 4 },
  methodBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingVertical: 9,
  },
  methodBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  sortToggle: { flexDirection: "row", padding: 4, gap: 2 },
  sortBtn: { paddingHorizontal: 12, paddingVertical: 9 },
  sortBtnText: { fontSize: 13, fontFamily: "Inter_700Bold" },
  priorityStrip: { width: 32, alignItems: "center", justifyContent: "center" },
  priorityNum: {
    fontSize: 11,
    fontFamily: "Inter_700Bold",
    color: "#fff",
    transform: [{ rotate: "-90deg" }],
  },
  debtName: { fontSize: 16, fontFamily: "Inter_700Bold", marginBottom: 6 },
  aprBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 5 },
  aprText: { fontSize: 11, fontFamily: "Inter_700Bold" },
  balance: { fontSize: 20, fontFamily: "Inter_700Bold" },
  minPay: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  progressSection: { marginBottom: 8 },
  progressHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 5,
  },
  progressLabel: { fontSize: 11, fontFamily: "Inter_400Regular" },
  progressPct: { fontSize: 11, fontFamily: "Inter_700Bold" },
  progressBg: { height: 6, borderRadius: 3, overflow: "hidden" },
  progressFill: { height: 6, borderRadius: 3 },
  strategyNote: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    padding: 7,
    borderRadius: 6,
  },
  strategyText: {
    flex: 1,
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    lineHeight: 15,
  },
});
