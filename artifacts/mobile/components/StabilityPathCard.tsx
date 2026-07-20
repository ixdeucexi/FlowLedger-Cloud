import { Feather } from "@expo/vector-icons";
import React, { memo } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { AppText } from "@/components/AppText";
import type { StabilityProgress } from "@/lib/stability";

interface StabilityPathCardProps {
  progress: StabilityProgress;
  onViewGuide: () => void;
}

function currency(value: number) {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function statusColor(status: StabilityProgress["status"]) {
  if (status === "risk") return "#fb7185";
  if (status === "watch") return "#fbbf24";
  return "#34d399";
}

function StabilityPathCardView({ progress, onViewGuide }: StabilityPathCardProps) {
  const color = statusColor(progress.status);
  const progressWidth = `${Math.round(progress.backupProgress * 100)}%` as const;
  const paydayColor = progress.safeUntilPayday === true ? "#34d399" : progress.safeUntilPayday === false ? "#fb7185" : "#fbbf24";
  const paydayTitle = progress.safeUntilPayday === true
    ? `Safe until ${progress.nextPaycheckLabel ?? "payday"}`
    : progress.safeUntilPayday === false
      ? `${currency(progress.paydayShortfall)} short before ${progress.nextPaycheckLabel ?? "payday"}`
      : "Next payday not confirmed";
  const paydayDetail = progress.safeUntilPayday === true
    ? "Your forecast keeps Must Pay bills and the safety floor covered until income arrives."
    : progress.safeUntilPayday === false
      ? "Close this gap before treating any money as extra."
      : "Add the next date in Income so Flo can check the plan through payday.";

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={[styles.icon, { backgroundColor: `${color}18`, borderColor: `${color}38` }]}>
          <Feather name="shield" size={18} color={color} />
        </View>
        <View style={styles.headerCopy}>
          <AppText tone="label" style={styles.eyebrow}>Your stability path</AppText>
          <AppText tone="title" style={styles.stage}>{progress.stageLabel}</AppText>
        </View>
        <View style={[styles.statusPill, { backgroundColor: `${color}18`, borderColor: `${color}38` }]}>
          <View style={[styles.statusDot, { backgroundColor: color }]} />
          <AppText style={[styles.statusText, { color }]}>{progress.status === "risk" ? "Act now" : progress.status === "watch" ? "Building" : "On track"}</AppText>
        </View>
      </View>

      <AppText tone="title" style={styles.headline}>{progress.headline}</AppText>
      <AppText style={styles.explanation}>{progress.explanation}</AppText>

      <View style={[styles.paydayCard, { backgroundColor: `${paydayColor}10`, borderColor: `${paydayColor}35` }]}>
        <Feather name={progress.safeUntilPayday === true ? "check-circle" : progress.safeUntilPayday === false ? "alert-circle" : "calendar"} size={17} color={paydayColor} />
        <View style={styles.paydayCopy}>
          <AppText tone="title" style={[styles.paydayTitle, { color: paydayColor }]}>{paydayTitle}</AppText>
          <AppText style={styles.paydayDetail}>{paydayDetail}</AppText>
        </View>
      </View>

      <View style={styles.progressHeader}>
        <AppText style={styles.progressLabel}>90-day backup path</AppText>
        <AppText tone="number" style={styles.progressValue}>{Math.round(progress.backupProgress * 100)}%</AppText>
      </View>
      <View style={styles.progressTrack} accessibilityLabel={`${progress.protectedDays} of 90 backup days protected`}>
        <View style={[styles.progressFill, { backgroundColor: color, width: progressWidth }]} />
      </View>
      <View style={styles.milestones}>
        {[7, 30, 60, 90].map(days => (
          <AppText key={days} style={[styles.milestone, progress.protectedDays >= days && { color }]}> {days}d </AppText>
        ))}
      </View>

      <View style={styles.metrics}>
        <View style={styles.metric}>
          <AppText tone="number" style={styles.metricValue}>{progress.protectedDays}</AppText>
          <AppText style={styles.metricLabel}>days backed up</AppText>
        </View>
        <View style={styles.metric}>
          <AppText tone="number" style={styles.metricValue}>{currency(progress.protectedAmount)}</AppText>
          <AppText style={styles.metricLabel}>backup money</AppText>
        </View>
        <View style={styles.metric}>
          <AppText tone="number" style={styles.metricValue}>{currency(progress.backupTarget)}</AppText>
          <AppText style={styles.metricLabel}>90-day target</AppText>
        </View>
      </View>

      <View style={styles.nextMove}>
        <View style={styles.nextMoveIcon}>
          <Feather name="arrow-up-right" size={15} color="#c4b5fd" />
        </View>
        <View style={styles.nextMoveCopy}>
          <AppText tone="label" style={styles.nextMoveLabel}>Next action</AppText>
          <AppText style={styles.nextMoveText}>{progress.nextAction}</AppText>
        </View>
      </View>

      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="See how the Stability Path and algorithms work"
          onPress={onViewGuide}
          style={({ pressed }) => [styles.secondaryButton, { opacity: pressed ? 0.72 : 1 }]}
        >
          <Feather name="map" size={14} color="#93c5fd" />
          <AppText style={styles.secondaryButtonText}>See how this works</AppText>
        </Pressable>
      </View>
    </View>
  );
}

export const StabilityPathCard = memo(StabilityPathCardView);

const styles = StyleSheet.create({
  card: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(34,211,238,0.22)",
    backgroundColor: "rgba(15,23,42,0.78)",
    padding: 15,
    marginBottom: 10,
    shadowColor: "#22d3ee",
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.18,
    shadowRadius: 28,
    elevation: 8,
  },
  header: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 10 },
  icon: { width: 40, height: 40, borderRadius: 14, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  headerCopy: { flex: 1, minWidth: 150 },
  eyebrow: { color: "#67e8f9", fontSize: 11, fontFamily: "Inter_800ExtraBold", letterSpacing: 1.1 },
  stage: { color: "#f8fafc", fontSize: 16, fontFamily: "Inter_800ExtraBold", marginTop: 1 },
  statusPill: { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 999, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 6 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 10, fontFamily: "Inter_800ExtraBold", textTransform: "uppercase", letterSpacing: 0.4 },
  headline: { color: "#f8fafc", fontSize: 20, lineHeight: 25, fontFamily: "Inter_800ExtraBold", marginTop: 14 },
  explanation: { color: "#94a3b8", fontSize: 12, lineHeight: 17, fontFamily: "Inter_500Medium", marginTop: 4 },
  paydayCard: { flexDirection: "row", alignItems: "flex-start", gap: 9, borderWidth: 1, borderRadius: 15, padding: 11, marginTop: 13 },
  paydayCopy: { flex: 1 },
  paydayTitle: { fontSize: 13, lineHeight: 17, fontFamily: "Inter_800ExtraBold" },
  paydayDetail: { color: "#94a3b8", fontSize: 12, lineHeight: 17, fontFamily: "Inter_500Medium", marginTop: 2 },
  progressHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 14, marginBottom: 6 },
  progressLabel: { color: "#cbd5e1", fontSize: 12, fontFamily: "Inter_700Bold" },
  progressValue: { color: "#f8fafc", fontSize: 12, fontFamily: "Inter_800ExtraBold" },
  progressTrack: { height: 7, borderRadius: 999, overflow: "hidden", backgroundColor: "rgba(148,163,184,0.18)" },
  progressFill: { height: "100%", borderRadius: 999 },
  milestones: { flexDirection: "row", justifyContent: "space-between", marginTop: 5 },
  milestone: { color: "#94a3b8", fontSize: 10, fontFamily: "Inter_800ExtraBold" },
  metrics: { flexDirection: "row", alignItems: "stretch", flexWrap: "wrap", gap: 8, marginTop: 14 },
  metric: { flexGrow: 1, flexBasis: 90, minWidth: 82, borderRadius: 12, backgroundColor: "rgba(2,6,23,0.34)", padding: 9 },
  metricValue: { color: "#f8fafc", fontSize: 17, fontFamily: "Inter_800ExtraBold" },
  metricLabel: { color: "#94a3b8", fontSize: 11, lineHeight: 14, fontFamily: "Inter_700Bold", marginTop: 2 },
  nextMove: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 16, borderWidth: 1, borderColor: "rgba(192,132,252,0.22)", backgroundColor: "rgba(124,58,237,0.12)", padding: 11, marginTop: 14 },
  nextMoveIcon: { width: 31, height: 31, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(124,58,237,0.24)" },
  nextMoveCopy: { flex: 1 },
  nextMoveLabel: { color: "#c4b5fd", fontSize: 10, fontFamily: "Inter_800ExtraBold" },
  nextMoveText: { color: "#ede9fe", fontSize: 12, lineHeight: 16, fontFamily: "Inter_700Bold", marginTop: 2 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  secondaryButton: { flex: 1, minWidth: 140, minHeight: 42, borderRadius: 14, borderWidth: 1, borderColor: "rgba(96,165,250,0.22)", backgroundColor: "rgba(37,99,235,0.12)", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 10 },
  secondaryButtonText: { color: "#bfdbfe", fontSize: 12, fontFamily: "Inter_800ExtraBold" },
});
