import { Feather } from "@expo/vector-icons";
import React, { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import colors from "@/constants/colors";
import { useColors } from "@/hooks/useColors";
import type { ReminderItem, ReportsSummary } from "@/lib/competitiveGrowth";

interface ReportsInsightsViewProps {
  monthLabel: string;
  summary: ReportsSummary;
  reminders: ReminderItem[];
  onOpenReview: () => void;
  onOpenBills: () => void;
}

const money = (value: number) => `$${Math.abs(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

export function ReportsInsightsView({
  monthLabel,
  summary,
  reminders,
  onOpenReview,
  onOpenBills,
}: ReportsInsightsViewProps) {
  const c = useColors();
  const hasActivity = summary.income > 0 || summary.spending > 0;
  const moneyKept = summary.net >= 0;
  const spendingPercent = summary.income > 0
    ? Math.min(100, Math.round((summary.spending / summary.income) * 100))
    : summary.spending > 0 ? 100 : 0;
  const largestCategory = summary.categoryTotals[0]?.amount ?? 0;
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
        <View style={styles.heroHeading}>
          <View>
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

        <View style={styles.metricRow}>
          <Metric label="Money in" value={money(summary.income)} color={c.success} background={c.muted} />
          <Metric label="Money out" value={money(summary.spending)} color={c.destructive} background={c.muted} />
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

      <SectionTitle label="Where money went" />
      <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
        {summary.categoryTotals.length ? summary.categoryTotals.slice(0, 6).map((category, index) => {
          const share = summary.spending > 0 ? Math.round((category.amount / summary.spending) * 100) : 0;
          const width = largestCategory > 0 ? Math.max(4, Math.round((category.amount / largestCategory) * 100)) : 0;
          return (
            <View key={category.category} style={[styles.categoryRow, index > 0 && { borderTopColor: c.border, borderTopWidth: 1 }]}>
              <View style={styles.categoryTop}>
                <View style={styles.categoryLabelRow}>
                  <View style={[styles.rank, { backgroundColor: c.primary + "18" }]}>
                    <Text style={[styles.rankText, { color: c.primary }]}>{index + 1}</Text>
                  </View>
                  <Text style={[styles.categoryName, { color: c.foreground }]} numberOfLines={1}>{category.category}</Text>
                </View>
                <View style={styles.categoryAmountWrap}>
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
        <PlanRow icon="calendar" label="Recurring bills" detail="planned each month" value={money(summary.plannedBills)} color={c.warning} />
        <PlanRow icon="credit-card" label="Debt minimums" detail="required each month" value={money(summary.debtMinimums)} color={c.primary} borderColor={c.border} />
        <PlanRow icon="repeat" label="Subscriptions" detail="estimated monthly" value={money(summary.subscriptionTotal)} color="#8b5cf6" borderColor={c.border} />
        <PlanRow icon="trending-down" label="Debt remaining" detail="current balances" value={money(summary.debtTotal)} color={c.destructive} borderColor={c.border} />
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
                <Text style={[styles.reminderText, { color: c.mutedForeground }]} numberOfLines={2}>{reminder.message}</Text>
              </View>
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.buttonRow}>
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
}: {
  icon: React.ComponentProps<typeof Feather>["name"];
  label: string;
  detail: string;
  value: string;
  color: string;
  borderColor?: string;
}) {
  const c = useColors();
  return (
    <View style={[styles.planRow, borderColor ? { borderTopColor: borderColor, borderTopWidth: 1 } : null]}>
      <View style={[styles.planIcon, { backgroundColor: color + "18" }]}>
        <Feather name={icon} size={17} color={color} />
      </View>
      <View style={styles.planCopy}>
        <Text style={[styles.planLabel, { color: c.foreground }]}>{label}</Text>
        <Text style={[styles.planDetail, { color: c.mutedForeground }]}>{detail}</Text>
      </View>
      <Text style={[styles.planValue, { color: c.foreground }]}>{value}</Text>
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
  eyebrow: { fontFamily: "Inter_700Bold", fontSize: 11, letterSpacing: 1 },
  heroTitle: { fontFamily: "Inter_700Bold", fontSize: 22, marginTop: 3 },
  statusPill: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 999 },
  statusText: { fontFamily: "Inter_700Bold", fontSize: 11 },
  netValue: { fontFamily: "Inter_700Bold", fontSize: 42, letterSpacing: -1.2, marginTop: 22 },
  netCaption: { fontFamily: "Inter_400Regular", fontSize: 13, marginTop: 2 },
  metricRow: { flexDirection: "row", gap: 10, marginTop: 18 },
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
  categoryLabelRow: { flex: 1, flexDirection: "row", alignItems: "center", gap: 9 },
  rank: { width: 26, height: 26, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  rankText: { fontFamily: "Inter_700Bold", fontSize: 12 },
  categoryName: { flex: 1, fontFamily: "Inter_600SemiBold", fontSize: 15 },
  categoryAmountWrap: { alignItems: "flex-end" },
  categoryAmount: { fontFamily: "Inter_700Bold", fontSize: 15 },
  categoryShare: { fontFamily: "Inter_400Regular", fontSize: 11, marginTop: 1 },
  categoryTrack: { height: 4, borderRadius: 99, overflow: "hidden", marginTop: 9, marginLeft: 35 },
  categoryFill: { height: "100%", borderRadius: 99 },
  planRow: { minHeight: 70, flexDirection: "row", alignItems: "center", gap: 11, paddingVertical: 12 },
  planIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  planCopy: { flex: 1 },
  planLabel: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  planDetail: { fontFamily: "Inter_400Regular", fontSize: 11, marginTop: 2 },
  planValue: { fontFamily: "Inter_700Bold", fontSize: 16 },
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
  button: { flex: 1, minHeight: 50, borderRadius: 15, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  buttonText: { fontFamily: "Inter_700Bold", fontSize: 13 },
  empty: { minHeight: 110, alignItems: "center", justifyContent: "center", gap: 8 },
  emptyText: { fontFamily: "Inter_400Regular", fontSize: 13 },
});
