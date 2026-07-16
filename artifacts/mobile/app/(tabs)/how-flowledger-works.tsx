import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText } from "@/components/AppText";
import { PremiumBackdrop } from "@/components/PremiumBackdrop";
import { useColors } from "@/hooks/useColors";
import { ALGORITHM_GUIDE, FLOWLEDGER_MONEY_RULES, STABILITY_PATH_GUIDE } from "@/lib/flowledgerGuide";
import type { StabilityStage } from "@/lib/stability";

function param(value: string | string[] | undefined, fallback: string): string {
  return Array.isArray(value) ? value[0] ?? fallback : value ?? fallback;
}

function amount(value: string | string[] | undefined): number {
  const parsed = Number(param(value, "0"));
  return Number.isFinite(parsed) ? parsed : 0;
}

function currency(value: number): string {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export default function HowFlowLedgerWorksScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const c = useColors();
  const params = useLocalSearchParams<{
    stage?: string;
    stageLabel?: string;
    protectedDays?: string;
    protectedAmount?: string;
    reserveTarget?: string;
    nextAction?: string;
    nextMilestone?: string;
    nextMilestoneAmount?: string;
    lowestBalance?: string;
    safetyFloor?: string;
    confidence?: string;
  }>();

  const stage = param(params.stage, "next_paycheck") as StabilityStage;
  const currentStageIndex = Math.max(0, STABILITY_PATH_GUIDE.findIndex(step => step.id === stage));
  const protectedDays = amount(params.protectedDays);
  const protectedAmount = amount(params.protectedAmount);
  const reserveTarget = amount(params.reserveTarget);
  const nextMilestoneAmount = amount(params.nextMilestoneAmount);
  const nextMilestone = param(params.nextMilestone, "Build a complete required-expense plan");
  const milestoneText = nextMilestoneAmount > 0
    ? `${nextMilestone} - ${currency(nextMilestoneAmount)} to go`
    : nextMilestone;

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: c.background }]}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 42 }]}
      showsVerticalScrollIndicator={false}
    >
      <PremiumBackdrop variant="purple" />
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={() => router.canGoBack() ? router.back() : router.replace("/(tabs)" as any)}
          style={({ pressed }) => [styles.backButton, { borderColor: c.border, backgroundColor: c.card, opacity: pressed ? 0.7 : 1 }]}
        >
          <Feather name="arrow-left" size={20} color={c.foreground} />
        </Pressable>
        <View style={styles.headerCopy}>
          <AppText tone="label" style={[styles.eyebrow, { color: c.primary }]}>FLOWLEDGER GUIDE</AppText>
          <AppText tone="title" style={[styles.title, { color: c.foreground }]}>How your path works</AppText>
        </View>
      </View>

      <View style={[styles.currentCard, { backgroundColor: c.card, borderColor: c.primary + "55" }]}>
        <AppText tone="label" style={[styles.sectionEyebrow, { color: c.primary }]}>YOUR CURRENT POSITION</AppText>
        <AppText tone="title" style={[styles.currentTitle, { color: c.foreground }]}>{param(params.stageLabel, "Build the first plan")}</AppText>
        <View style={styles.metrics}>
          <Metric label="Protected" value={`${protectedDays} days`} />
          <Metric label="Breathing room" value={currency(protectedAmount)} />
          <Metric label="30-day target" value={currency(reserveTarget)} />
        </View>
        <View style={[styles.nextCard, { backgroundColor: c.primary + "12", borderColor: c.primary + "33" }]}>
          <AppText tone="label" style={[styles.nextLabel, { color: c.primary }]}>NEXT MILESTONE</AppText>
          <AppText style={[styles.nextText, { color: c.foreground }]}>{milestoneText}</AppText>
          <AppText tone="label" style={[styles.nextLabel, styles.nextActionLabel, { color: c.mutedForeground }]}>NEXT ACTION</AppText>
          <AppText style={[styles.actionText, { color: c.foreground }]}>{param(params.nextAction, "Finish listing required income and expenses.")}</AppText>
        </View>
      </View>

      <SectionHeader title="The Stability Path" description="The path can move forward or backward when income, bills, spending, or account balances change." />
      <View style={[styles.sectionCard, { backgroundColor: c.card, borderColor: c.border }]}>
        {STABILITY_PATH_GUIDE.map((step, index) => {
          const active = index === currentStageIndex;
          const complete = index < currentStageIndex;
          const color = active ? c.primary : complete ? c.success : c.mutedForeground;
          return (
            <View key={step.id} style={styles.pathRow}>
              <View style={styles.pathRail}>
                <View style={[styles.pathDot, { backgroundColor: color, borderColor: color }]}>
                  {complete ? <Feather name="check" size={11} color="#fff" /> : <AppText style={styles.pathNumber}>{index + 1}</AppText>}
                </View>
                {index < STABILITY_PATH_GUIDE.length - 1 ? <View style={[styles.pathLine, { backgroundColor: complete ? c.success + "66" : c.border }]} /> : null}
              </View>
              <View style={[styles.pathCopy, active && { borderColor: c.primary + "55", backgroundColor: c.primary + "0D" }]}>
                <View style={styles.pathTitleRow}>
                  <AppText tone="title" style={[styles.pathTitle, { color: active ? c.primary : c.foreground }]}>{step.title}</AppText>
                  {active ? <AppText tone="label" style={[styles.currentPill, { color: c.primary, backgroundColor: c.primary + "18" }]}>CURRENT</AppText> : null}
                </View>
                <AppText style={[styles.pathRange, { color }]}>{step.range}</AppText>
                <AppText style={[styles.pathDescription, { color: c.mutedForeground }]}>{step.description}</AppText>
              </View>
            </View>
          );
        })}
      </View>

      <SectionHeader title="How the numbers are calculated" description="FlowLedger recalculates when real or planned money changes." />
      <View style={[styles.sectionCard, { backgroundColor: c.card, borderColor: c.border }]}>
        <CalculationRow label="Lowest upcoming checking balance" value={currency(amount(params.lowestBalance))} />
        <CalculationRow label="Protected safety floor" value={`-${currency(amount(params.safetyFloor))}`} />
        <CalculationRow label="Breathing room" value={currency(protectedAmount)} emphasized />
        <CalculationRow label="One month of required expenses" value={currency(reserveTarget)} />
        <CalculationRow label="Forecast confidence" value={param(params.confidence, "Building")} />
      </View>

      <SectionHeader title="Money rules" description="These rules keep the same dollars from being mixed together or counted twice." />
      <View style={[styles.sectionCard, { backgroundColor: c.card, borderColor: c.border }]}>
        {FLOWLEDGER_MONEY_RULES.map(rule => (
          <View key={rule} style={styles.ruleRow}>
            <Feather name="check-circle" size={16} color={c.success} />
            <AppText style={[styles.ruleText, { color: c.foreground }]}>{rule}</AppText>
          </View>
        ))}
      </View>

      <SectionHeader title="What each algorithm does" description="Each algorithm answers one specific question using the same verified plan." />
      <View style={styles.algorithmGrid}>
        {ALGORITHM_GUIDE.map(item => (
          <View key={item.id} style={[styles.algorithmCard, { backgroundColor: c.card, borderColor: c.border }]}>
            <View style={[styles.algorithmIcon, { backgroundColor: c.primary + "16" }]}>
              <Feather name="activity" size={15} color={c.primary} />
            </View>
            <View style={styles.algorithmCopy}>
              <AppText tone="title" style={[styles.algorithmTitle, { color: c.foreground }]}>{item.title}</AppText>
              <AppText style={[styles.algorithmDescription, { color: c.mutedForeground }]}>{item.description}</AppText>
            </View>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  const c = useColors();
  return (
    <View style={[styles.metric, { backgroundColor: c.muted, borderColor: c.border }]}>
      <AppText tone="number" style={[styles.metricValue, { color: c.foreground }]}>{value}</AppText>
      <AppText style={[styles.metricLabel, { color: c.mutedForeground }]}>{label}</AppText>
    </View>
  );
}

function SectionHeader({ title, description }: { title: string; description: string }) {
  const c = useColors();
  return (
    <View style={styles.sectionHeader}>
      <AppText tone="title" style={[styles.sectionTitle, { color: c.foreground }]}>{title}</AppText>
      <AppText style={[styles.sectionDescription, { color: c.mutedForeground }]}>{description}</AppText>
    </View>
  );
}

function CalculationRow({ label, value, emphasized = false }: { label: string; value: string; emphasized?: boolean }) {
  const c = useColors();
  return (
    <View style={[styles.calculationRow, { borderBottomColor: c.border }]}>
      <AppText style={[styles.calculationLabel, { color: c.mutedForeground }]}>{label}</AppText>
      <AppText tone="number" style={[styles.calculationValue, { color: emphasized ? c.primary : c.foreground }]}>{value}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: 18 },
  header: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 18 },
  backButton: { width: 44, height: 44, borderRadius: 15, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  headerCopy: { flex: 1 },
  eyebrow: { fontSize: 9, fontFamily: "Inter_700Bold", letterSpacing: 1.1 },
  title: { fontSize: 26, lineHeight: 31, fontFamily: "Inter_700Bold", marginTop: 2 },
  currentCard: { borderWidth: 1, borderRadius: 24, padding: 16 },
  sectionEyebrow: { fontSize: 9, fontFamily: "Inter_700Bold", letterSpacing: 1 },
  currentTitle: { fontSize: 21, lineHeight: 26, fontFamily: "Inter_700Bold", marginTop: 5 },
  metrics: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 },
  metric: { flexGrow: 1, flexBasis: 92, minWidth: 84, borderRadius: 14, borderWidth: 1, padding: 10 },
  metricValue: { fontSize: 17, fontFamily: "Inter_700Bold" },
  metricLabel: { fontSize: 9, lineHeight: 13, fontFamily: "Inter_600SemiBold", marginTop: 2 },
  nextCard: { borderWidth: 1, borderRadius: 16, padding: 12, marginTop: 12 },
  nextLabel: { fontSize: 8, fontFamily: "Inter_700Bold" },
  nextText: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_700Bold", marginTop: 3 },
  nextActionLabel: { marginTop: 11 },
  actionText: { fontSize: 12, lineHeight: 17, fontFamily: "Inter_600SemiBold", marginTop: 3 },
  sectionHeader: { marginTop: 24, marginBottom: 9 },
  sectionTitle: { fontSize: 18, lineHeight: 23, fontFamily: "Inter_700Bold" },
  sectionDescription: { fontSize: 12, lineHeight: 17, marginTop: 3 },
  sectionCard: { borderWidth: 1, borderRadius: 20, padding: 14 },
  pathRow: { flexDirection: "row", alignItems: "stretch" },
  pathRail: { width: 32, alignItems: "center" },
  pathDot: { width: 25, height: 25, borderRadius: 13, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  pathNumber: { color: "#fff", fontSize: 10, fontFamily: "Inter_700Bold" },
  pathLine: { flex: 1, width: 2, minHeight: 62 },
  pathCopy: { flex: 1, borderWidth: 1, borderColor: "transparent", borderRadius: 15, padding: 10, marginBottom: 8 },
  pathTitleRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  pathTitle: { flex: 1, fontSize: 14, fontFamily: "Inter_700Bold" },
  currentPill: { borderRadius: 999, paddingHorizontal: 7, paddingVertical: 4, fontSize: 7, fontFamily: "Inter_700Bold" },
  pathRange: { fontSize: 10, lineHeight: 14, fontFamily: "Inter_700Bold", marginTop: 3 },
  pathDescription: { fontSize: 11, lineHeight: 16, marginTop: 4 },
  calculationRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  calculationLabel: { flex: 1, fontSize: 11, lineHeight: 15, fontFamily: "Inter_600SemiBold" },
  calculationValue: { fontSize: 12, fontFamily: "Inter_700Bold", textAlign: "right" },
  ruleRow: { flexDirection: "row", alignItems: "flex-start", gap: 9, paddingVertical: 8 },
  ruleText: { flex: 1, fontSize: 12, lineHeight: 18, fontFamily: "Inter_600SemiBold" },
  algorithmGrid: { gap: 9 },
  algorithmCard: { borderWidth: 1, borderRadius: 18, padding: 13, flexDirection: "row", alignItems: "flex-start", gap: 10 },
  algorithmIcon: { width: 34, height: 34, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  algorithmCopy: { flex: 1 },
  algorithmTitle: { fontSize: 14, fontFamily: "Inter_700Bold" },
  algorithmDescription: { fontSize: 11, lineHeight: 16, marginTop: 3 },
});
