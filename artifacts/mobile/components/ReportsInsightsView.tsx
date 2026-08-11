import { Feather } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";

import colors from "@/constants/colors";
import { useColors } from "@/hooks/useColors";
import type { MonthlyMoneyInsight, ReminderItem, ReportsSummary, SubscriptionCandidate } from "@/lib/competitiveGrowth";
import type { CategoryPlanRow } from "@/lib/categoryPlanning";
import { shouldExpandReportDetails, shouldStackSettingsMetrics } from "@/lib/settingsLayout";

interface ReportsInsightsViewProps {
  monthLabel: string;
  summary: ReportsSummary;
  reminders: ReminderItem[];
  categoryPlan: CategoryPlanRow[];
  monthlyInsights: MonthlyMoneyInsight[];
  recurringCandidates: SubscriptionCandidate[];
  plannedMonthlyIncome: number;
  onOpenReview: () => void;
  onOpenBills: () => void;
  onOpenSubscriptions: () => void;
}

const money = (value: number) => `$${Math.abs(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

export function ReportsInsightsView({
  monthLabel,
  summary,
  reminders,
  categoryPlan,
  monthlyInsights,
  recurringCandidates,
  plannedMonthlyIncome,
  onOpenReview,
  onOpenBills,
  onOpenSubscriptions,
}: ReportsInsightsViewProps) {
  const c = useColors();
  const { width: viewportWidth } = useWindowDimensions();
  const stackCompactContent = shouldStackSettingsMetrics(viewportWidth);
  const expandCompactDetails = shouldExpandReportDetails(viewportWidth);
  const [insightRange, setInsightRange] = useState<"six" | "year">("six");
  const hasActivity = summary.income > 0 || summary.spending > 0;
  const moneyKept = summary.net >= 0;
  const spendingPercent = summary.income > 0
    ? Math.min(100, Math.round((summary.spending / summary.income) * 100))
    : summary.spending > 0 ? 100 : 0;
  const largestCategory = summary.categoryTotals[0]?.amount ?? 0;
  const visibleInsights = insightRange === "six" ? monthlyInsights.slice(-6) : monthlyInsights;
  const trendIncome = visibleInsights.reduce((sum, item) => sum + item.income, 0);
  const trendSpending = visibleInsights.reduce((sum, item) => sum + item.spending, 0);
  const trendNet = trendIncome - trendSpending;
  const largestTrendValue = Math.max(1, ...visibleInsights.flatMap(item => [item.income, item.spending]));
  const visibleCategoryPlan = categoryPlan
    .filter(row => row.budgeted > 0.005 || row.spent > 0.005)
    .slice(0, 6);
  const nextMove = useMemo(() => {
    if (reminders.length) return reminders[0].title;
    if (!hasActivity) return "Add activity to start your monthly report.";
    if (!moneyKept) return `Review ${summary.topCategory ?? "your largest spending area"} first.`;
    if (summary.debtTotal > 0) return "Decide how much of the money left should go toward debt.";
    return "Your month is on track. Keep following the plan.";
  }, [hasActivity, moneyKept, reminders, summary.debtTotal, summary.topCategory]);

  return (
    <View style={styles.page}>
      <View style={[styles.hero, { backgroundColor: c.card, borderColor: c.border }]}>
        <View style={[styles.heroHeading, stackCompactContent && styles.heroHeadingCompact]}>
          <View style={styles.heroCopy}>
            <Text style={[styles.eyebrow, { color: c.primary }]}>{monthLabel.toUpperCase()}</Text>
            <Text style={[styles.heroTitle, { color: c.foreground }]}>Your month at a glance</Text>
          </View>
          <View style={[styles.statusPill, { backgroundColor: (moneyKept ? c.success : c.warning) + "18" }]}>
            <Feather name={moneyKept ? "trending-up" : "alert-circle"} size={14} color={moneyKept ? c.success : c.warning} />
            <Text style={[styles.statusText, { color: moneyKept ? c.success : c.warning }]}>
              {!hasActivity ? "Getting started" : moneyKept ? "Money left" : "Over income"}
            </Text>
          </View>
        </View>

        <Text style={[styles.netValue, { color: !hasActivity ? c.foreground : moneyKept ? c.success : c.destructive }]}>
          {hasActivity ? `${moneyKept ? "+" : "-"}${money(summary.net)}` : "$0"}
        </Text>
        <Text style={[styles.netCaption, { color: c.mutedForeground }]}>
          {!hasActivity
            ? "Posted and manual activity will appear here."
            : moneyKept
              ? "came in above what went out"
              : "more went out than came in"}
        </Text>

        <View style={[styles.metricRow, stackCompactContent && styles.metricRowCompact]}>
          <Metric label="Inflows" value={money(summary.income)} color={c.success} background={c.muted} />
          <Metric label="Outflows" value={money(summary.spending)} color={c.destructive} background={c.muted} />
        </View>

        <View style={styles.paceRow}>
          <Text style={[styles.paceText, { color: c.mutedForeground }]}>Income used</Text>
          <Text style={[styles.paceValue, { color: c.foreground }]}>{spendingPercent}%</Text>
        </View>
        <View style={[styles.track, { backgroundColor: c.muted }]}>
          <View
            style={[
              styles.fill,
              {
                width: `${spendingPercent}%`,
                backgroundColor: spendingPercent > 100 ? c.destructive : spendingPercent > 85 ? c.warning : c.success,
              },
            ]}
          />
        </View>
      </View>

      <SectionTitle label="Flo starting plan" />
      <View style={[styles.startingPlan, { backgroundColor: c.card, borderColor: c.primary + "44" }]}>
        <View style={[styles.startingIcon, { backgroundColor: c.primary + "18" }]}>
          <Feather name="zap" size={20} color={c.primary} />
        </View>
        <View style={styles.startingCopy}>
          <Text style={[styles.startingTitle, { color: c.foreground }]}>
            {recurringCandidates.length
              ? `${recurringCandidates.length} repeating charge${recurringCandidates.length === 1 ? "" : "s"} found`
              : "Your starting plan is ready"}
          </Text>
          <Text style={[styles.startingText, { color: c.mutedForeground }]}>
            {money(plannedMonthlyIncome)} planned income · {money(recurringCandidates.reduce((sum, item) => sum + item.monthlyEquivalent, 0))} in possible recurring charges
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Review recurring charge drafts"
          onPress={onOpenSubscriptions}
          style={({ pressed }) => [styles.smallButton, { borderColor: c.primary + "66", opacity: pressed ? 0.7 : 1 }]}
        >
          <Text style={[styles.smallButtonText, { color: c.primary }]}>Review</Text>
        </Pressable>
      </View>

      <SectionTitle label="Category pace" />
      <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
        {visibleCategoryPlan.length ? visibleCategoryPlan.map((row, index) => {
          const statusColor = row.status === "over" ? c.destructive : row.status === "watch" ? c.warning : c.success;
          return (
            <View key={row.category} style={[styles.planPaceRow, index > 0 && { borderTopColor: c.border, borderTopWidth: 1 }]}>
              <View style={styles.planPaceHeading}>
                <Text style={[styles.planPaceName, { color: c.foreground }]} numberOfLines={1}>{row.category}</Text>
                <Text style={[styles.planPaceStatus, { color: statusColor }]}>
                  {row.status === "over" ? `${money(Math.abs(row.remaining))} over` : `${money(row.remaining)} left`}
                </Text>
              </View>
              <Text style={[styles.planPaceMeta, { color: c.mutedForeground }]}>
                {money(row.spent)} spent of {money(row.budgeted)} planned
              </Text>
              <View style={[styles.categoryPlanTrack, { backgroundColor: c.muted }]}>
                <View style={[styles.categoryPlanFill, { backgroundColor: statusColor, width: `${Math.min(100, row.percentUsed)}%` }]} />
              </View>
            </View>
          );
        }) : <EmptyState icon="target" text="Add bills or category plans to see your pace." />}
      </View>

      <View style={styles.insightHeading}>
        <SectionTitle label="Money over time" />
        <View style={[styles.rangeToggle, { backgroundColor: c.muted }]}>
          {(["six", "year"] as const).map(range => (
            <Pressable
              key={range}
              accessibilityRole="button"
              accessibilityLabel={range === "six" ? "Show six months" : "Show one year"}
              onPress={() => setInsightRange(range)}
              style={[styles.rangeButton, insightRange === range && { backgroundColor: c.card }]}
            >
              <Text style={[styles.rangeText, { color: insightRange === range ? c.foreground : c.mutedForeground }]}>
                {range === "six" ? "6 months" : "Year"}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
      <View style={[styles.trendCard, { backgroundColor: c.card, borderColor: c.border }]}>
        <View style={styles.trendSummary}>
          <View>
            <Text style={[styles.trendLabel, { color: c.mutedForeground }]}>NET</Text>
            <Text style={[styles.trendNet, { color: trendNet >= 0 ? c.success : c.destructive }]}>
              {trendNet >= 0 ? "+" : "−"}{money(trendNet)}
            </Text>
          </View>
          <Text style={[styles.trendTotals, { color: c.mutedForeground }]}>
            {money(trendIncome)} in · {money(trendSpending)} out
          </Text>
        </View>
        <View style={styles.bars}>
          {visibleInsights.map(item => (
            <View key={item.key} style={styles.barColumn}>
              <View style={styles.barPair}>
                <View style={[styles.bar, { height: Math.max(3, Math.round((item.income / largestTrendValue) * 62)), backgroundColor: c.success }]} />
                <View style={[styles.bar, { height: Math.max(3, Math.round((item.spending / largestTrendValue) * 62)), backgroundColor: c.primary }]} />
              </View>
              <Text style={[styles.barLabel, { color: c.mutedForeground }]}>{item.label}</Text>
            </View>
          ))}
        </View>
        <View style={styles.legend}>
          <View style={[styles.legendDot, { backgroundColor: c.success }]} /><Text style={[styles.legendText, { color: c.mutedForeground }]}>In</Text>
          <View style={[styles.legendDot, { backgroundColor: c.primary }]} /><Text style={[styles.legendText, { color: c.mutedForeground }]}>Out</Text>
        </View>
      </View>

      <SectionTitle label="Where money went" />
      <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
        {summary.categoryTotals.length ? summary.categoryTotals.slice(0, 6).map((category, index) => {
          const share = summary.spending > 0 ? Math.round((category.amount / summary.spending) * 100) : 0;
          const width = largestCategory > 0 ? Math.max(4, Math.round((category.amount / largestCategory) * 100)) : 0;
          return (
            <View key={category.category} style={[styles.categoryRow, index > 0 && { borderTopColor: c.border, borderTopWidth: 1 }]}>
              <View style={[styles.categoryTop, expandCompactDetails && styles.categoryTopCompact]}>
                <View style={styles.categoryLabelRow}>
                  <View style={[styles.rank, { backgroundColor: c.primary + "18" }]}>
                    <Text style={[styles.rankText, { color: c.primary }]}>{index + 1}</Text>
                  </View>
                  <Text
                    style={[styles.categoryName, { color: c.foreground }]}
                    numberOfLines={expandCompactDetails ? undefined : 1}
                  >
                    {category.category}
                  </Text>
                </View>
                <View style={[styles.categoryAmountWrap, expandCompactDetails && styles.categoryAmountWrapCompact]}>
                  <Text style={[styles.categoryAmount, { color: c.foreground }]}>{money(category.amount)}</Text>
                  <Text style={[styles.categoryShare, { color: c.mutedForeground }]}>{share}%</Text>
                </View>
              </View>
              <View style={[styles.categoryTrack, { backgroundColor: c.muted }]}>
                <View style={[styles.categoryFill, { width: `${width}%`, backgroundColor: c.primary }]} />
              </View>
            </View>
          );
        }) : (
          <EmptyState icon="pie-chart" text="No spending to break down yet." />
        )}
      </View>

      <SectionTitle label="Plan at a glance" />
      <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
        <PlanRow icon="calendar" label="Recurring bills" detail="planned each month" value={money(summary.plannedBills)} color={c.warning} compact={expandCompactDetails} />
        <PlanRow icon="credit-card" label="Debt minimums" detail="required each month" value={money(summary.debtMinimums)} color={c.primary} borderColor={c.border} compact={expandCompactDetails} />
        <PlanRow icon="repeat" label="Subscriptions" detail="estimated monthly" value={money(summary.subscriptionTotal)} color="#8b5cf6" borderColor={c.border} compact={expandCompactDetails} />
        <PlanRow icon="trending-down" label="Debt remaining" detail="current balances" value={money(summary.debtTotal)} color={c.destructive} borderColor={c.border} compact={expandCompactDetails} />
      </View>

      {summary.goalProgress.length ? (
        <>
          <SectionTitle label="Goals" />
          <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
            {summary.goalProgress.map((goal, index) => (
              <View key={goal.goalId} style={[styles.goalRow, index > 0 && { borderTopColor: c.border, borderTopWidth: 1 }]}>
                <View style={styles.goalHeading}>
                  <Text style={[styles.goalName, { color: c.foreground }]}>{goal.name}</Text>
                  <Text style={[styles.goalPercent, { color: c.success }]}>{goal.percent}%</Text>
                </View>
                <View style={[styles.track, { backgroundColor: c.muted }]}>
                  <View style={[styles.fill, { width: `${goal.percent}%`, backgroundColor: c.success }]} />
                </View>
              </View>
            ))}
          </View>
        </>
      ) : null}

      <SectionTitle label="What to do next" />
      <View style={[styles.actionCard, { backgroundColor: c.primary + "12", borderColor: c.primary + "38" }]}>
        <View style={[styles.actionIcon, { backgroundColor: c.primary + "20" }]}>
          <Feather name="arrow-up-right" size={20} color={c.primary} />
        </View>
        <View style={styles.actionCopy}>
          <Text style={[styles.actionTitle, { color: c.foreground }]}>{nextMove}</Text>
          <Text style={[styles.actionText, { color: c.mutedForeground }]}>
            {reminders.length ? `${reminders.length} item${reminders.length === 1 ? "" : "s"} may need attention.` : summary.insight}
          </Text>
        </View>
      </View>

      {reminders.length ? (
        <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
          {reminders.slice(0, 4).map((reminder, index) => (
            <View key={reminder.id} style={[styles.reminderRow, index > 0 && { borderTopColor: c.border, borderTopWidth: 1 }]}>
              <Feather
                name={reminder.severity === "risk" ? "alert-triangle" : "bell"}
                size={17}
                color={reminder.severity === "risk" ? c.destructive : reminder.severity === "watch" ? c.warning : c.primary}
              />
              <View style={styles.reminderCopy}>
                <Text style={[styles.reminderTitle, { color: c.foreground }]}>{reminder.title}</Text>
                <Text
                  style={[styles.reminderText, { color: c.mutedForeground }]}
                  numberOfLines={expandCompactDetails ? undefined : 2}
                >
                  {reminder.message}
                </Text>
              </View>
            </View>
          ))}
        </View>
      ) : null}

      <View style={[styles.buttonRow, expandCompactDetails && styles.buttonRowCompact]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open Review Center"
          onPress={onOpenReview}
          style={({ pressed }) => [styles.button, { backgroundColor: c.primary, opacity: pressed ? 0.78 : 1 }]}
        >
          <Feather name="check-square" size={16} color={c.primaryForeground} />
          <Text style={[styles.buttonText, { color: c.primaryForeground }]}>Review activity</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open bills"
          onPress={onOpenBills}
          style={({ pressed }) => [styles.button, { backgroundColor: c.card, borderColor: c.border, borderWidth: 1, opacity: pressed ? 0.72 : 1 }]}
        >
          <Feather name="calendar" size={16} color={c.foreground} />
          <Text style={[styles.buttonText, { color: c.foreground }]}>View bills</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Metric({ label, value, color, background }: { label: string; value: string; color: string; background: string }) {
  return (
    <View style={[styles.metric, { backgroundColor: background }]}>
      <Text style={[styles.metricLabel, { color }]}>{label}</Text>
      <Text style={[styles.metricValue, { color }]}>{value}</Text>
    </View>
  );
}

function PlanRow({
  icon,
  label,
  detail,
  value,
  color,
  borderColor,
  compact = false,
}: {
  icon: React.ComponentProps<typeof Feather>["name"];
  label: string;
  detail: string;
  value: string;
  color: string;
  borderColor?: string;
  compact?: boolean;
}) {
  const c = useColors();
  return (
    <View style={[styles.planRow, compact && styles.planRowCompact, borderColor ? { borderTopColor: borderColor, borderTopWidth: 1 } : null]}>
      <View style={[styles.planIcon, { backgroundColor: color + "18" }]}>
        <Feather name={icon} size={17} color={color} />
      </View>
      <View style={styles.planCopy}>
        <Text style={[styles.planLabel, { color: c.foreground }]}>{label}</Text>
        <Text style={[styles.planDetail, { color: c.mutedForeground }]}>{detail}</Text>
      </View>
      <Text style={[styles.planValue, compact && styles.planValueCompact, { color: c.foreground }]}>{value}</Text>
    </View>
  );
}

function SectionTitle({ label }: { label: string }) {
  const c = useColors();
  return <Text style={[styles.sectionTitle, { color: c.mutedForeground }]}>{label.toUpperCase()}</Text>;
}

function EmptyState({ icon, text }: { icon: React.ComponentProps<typeof Feather>["name"]; text: string }) {
  const c = useColors();
  return (
    <View style={styles.empty}>
      <Feather name={icon} size={20} color={c.mutedForeground} />
      <Text style={[styles.emptyText, { color: c.mutedForeground }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { gap: 12 },
  hero: { borderWidth: 1, borderRadius: colors.radius, padding: 18 },
  heroHeading: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10 },
  heroHeadingCompact: { flexDirection: "column" },
  heroCopy: { flex: 1, minWidth: 0 },
  eyebrow: { fontFamily: "Inter_700Bold", fontSize: 11, letterSpacing: 1 },
  heroTitle: { fontFamily: "Inter_700Bold", fontSize: 22, marginTop: 3 },
  statusPill: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 999 },
  statusText: { fontFamily: "Inter_700Bold", fontSize: 11 },
  startingPlan: { borderWidth: 1, borderRadius: colors.radius, padding: 14, flexDirection: "row", alignItems: "center", gap: 11 },
  startingIcon: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  startingCopy: { flex: 1, minWidth: 0 },
  startingTitle: { fontFamily: "Inter_700Bold", fontSize: 15 },
  startingText: { fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 17, marginTop: 3 },
  smallButton: { minHeight: 38, borderWidth: 1, borderRadius: 12, paddingHorizontal: 11, alignItems: "center", justifyContent: "center" },
  smallButtonText: { fontFamily: "Inter_700Bold", fontSize: 12 },
  netValue: { fontFamily: "Inter_700Bold", fontSize: 42, letterSpacing: -1.2, marginTop: 22 },
  netCaption: { fontFamily: "Inter_400Regular", fontSize: 13, marginTop: 2 },
  metricRow: { flexDirection: "row", gap: 10, marginTop: 18 },
  metricRowCompact: { flexDirection: "column" },
  metric: { flex: 1, borderRadius: 14, padding: 13 },
  metricLabel: { fontFamily: "Inter_600SemiBold", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6 },
  metricValue: { fontFamily: "Inter_700Bold", fontSize: 21, marginTop: 5 },
  paceRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 16 },
  paceText: { fontFamily: "Inter_600SemiBold", fontSize: 12 },
  paceValue: { fontFamily: "Inter_700Bold", fontSize: 12 },
  track: { height: 7, borderRadius: 99, overflow: "hidden", marginTop: 7 },
  fill: { height: "100%", borderRadius: 99 },
  sectionTitle: { fontFamily: "Inter_700Bold", fontSize: 11, letterSpacing: 0.9, marginTop: 8, marginLeft: 2 },
  card: { borderWidth: 1, borderRadius: colors.radius, paddingHorizontal: 16 },
  categoryRow: { paddingVertical: 14 },
  categoryTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  categoryTopCompact: { flexDirection: "column", alignItems: "stretch", gap: 7 },
  categoryLabelRow: { flex: 1, flexDirection: "row", alignItems: "center", gap: 9 },
  rank: { width: 26, height: 26, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  rankText: { fontFamily: "Inter_700Bold", fontSize: 12 },
  categoryName: { flex: 1, fontFamily: "Inter_600SemiBold", fontSize: 15 },
  categoryAmountWrap: { alignItems: "flex-end" },
  categoryAmountWrapCompact: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  categoryAmount: { fontFamily: "Inter_700Bold", fontSize: 15 },
  categoryShare: { fontFamily: "Inter_400Regular", fontSize: 11, marginTop: 1 },
  categoryTrack: { height: 4, borderRadius: 99, overflow: "hidden", marginTop: 9, marginLeft: 35 },
  categoryFill: { height: "100%", borderRadius: 99 },
  planPaceRow: { paddingVertical: 13 },
  planPaceHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  planPaceName: { flex: 1, fontFamily: "Inter_700Bold", fontSize: 14 },
  planPaceStatus: { fontFamily: "Inter_700Bold", fontSize: 12 },
  planPaceMeta: { fontFamily: "Inter_400Regular", fontSize: 11, marginTop: 3 },
  categoryPlanTrack: { height: 5, borderRadius: 99, overflow: "hidden", marginTop: 8 },
  categoryPlanFill: { height: "100%", borderRadius: 99 },
  insightHeading: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  rangeToggle: { flexDirection: "row", padding: 3, borderRadius: 11 },
  rangeButton: { minHeight: 30, borderRadius: 8, paddingHorizontal: 10, alignItems: "center", justifyContent: "center" },
  rangeText: { fontFamily: "Inter_700Bold", fontSize: 11 },
  trendCard: { borderWidth: 1, borderRadius: colors.radius, padding: 15 },
  trendSummary: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 10 },
  trendLabel: { fontFamily: "Inter_700Bold", fontSize: 10, letterSpacing: 0.8 },
  trendNet: { fontFamily: "Inter_700Bold", fontSize: 24, marginTop: 2 },
  trendTotals: { fontFamily: "Inter_500Medium", fontSize: 11, textAlign: "right" },
  bars: { minHeight: 88, flexDirection: "row", alignItems: "flex-end", justifyContent: "space-around", gap: 3, marginTop: 16 },
  barColumn: { flex: 1, alignItems: "center", justifyContent: "flex-end" },
  barPair: { height: 64, flexDirection: "row", alignItems: "flex-end", gap: 2 },
  bar: { width: 5, borderRadius: 3 },
  barLabel: { fontFamily: "Inter_600SemiBold", fontSize: 9, marginTop: 5 },
  legend: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, marginTop: 9 },
  legendDot: { width: 7, height: 7, borderRadius: 4, marginLeft: 8 },
  legendText: { fontFamily: "Inter_500Medium", fontSize: 10 },
  planRow: { minHeight: 70, flexDirection: "row", alignItems: "center", gap: 11, paddingVertical: 12 },
  planRowCompact: { flexWrap: "wrap" },
  planIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  planCopy: { flex: 1 },
  planLabel: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  planDetail: { fontFamily: "Inter_400Regular", fontSize: 11, marginTop: 2 },
  planValue: { fontFamily: "Inter_700Bold", fontSize: 16 },
  planValueCompact: { width: "100%", textAlign: "right", marginTop: 2 },
  goalRow: { paddingVertical: 14 },
  goalHeading: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  goalName: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  goalPercent: { fontFamily: "Inter_700Bold", fontSize: 13 },
  actionCard: { borderWidth: 1, borderRadius: colors.radius, padding: 16, flexDirection: "row", alignItems: "center", gap: 12 },
  actionIcon: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  actionCopy: { flex: 1 },
  actionTitle: { fontFamily: "Inter_700Bold", fontSize: 15, lineHeight: 20 },
  actionText: { fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 17, marginTop: 3 },
  reminderRow: { flexDirection: "row", alignItems: "flex-start", gap: 11, paddingVertical: 14 },
  reminderCopy: { flex: 1 },
  reminderTitle: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  reminderText: { fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 17, marginTop: 3 },
  buttonRow: { flexDirection: "row", gap: 10, marginTop: 2 },
  buttonRowCompact: { flexDirection: "column" },
  button: { flex: 1, minHeight: 50, borderRadius: 15, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  buttonText: { fontFamily: "Inter_700Bold", fontSize: 13 },
  empty: { minHeight: 110, alignItems: "center", justifyContent: "center", gap: 8 },
  emptyText: { fontFamily: "Inter_400Regular", fontSize: 13 },
});
