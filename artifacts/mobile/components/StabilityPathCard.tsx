import { Feather } from "@expo/vector-icons";
import React, { memo } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { AppText } from "@/components/AppText";
import { useColors } from "@/hooks/useColors";
import type { StabilityProgress } from "@/lib/stability";

interface StabilityPathCardProps {
  progress: StabilityProgress;
  onViewGuide: () => void;
}

const STABILITY_THEMES = {
  dark: {
    card: "rgba(15,23,42,0.78)", border: "rgba(34,211,238,0.22)", shadow: "#22d3ee", shadowOpacity: 0.18,
    eyebrow: "#67e8f9", text: "#f8fafc", mutedText: "#94a3b8", labelText: "#cbd5e1",
    track: "rgba(148,163,184,0.18)", metric: "rgba(2,6,23,0.34)", purpleText: "#c4b5fd",
    purpleStrongText: "#ede9fe", purpleSurface: "rgba(124,58,237,0.12)", purpleIconSurface: "rgba(124,58,237,0.24)",
    purpleBorder: "rgba(192,132,252,0.22)", buttonText: "#bfdbfe", buttonIcon: "#93c5fd",
    buttonSurface: "rgba(37,99,235,0.12)", buttonBorder: "rgba(96,165,250,0.22)",
  },
  light: {
    card: "rgba(255,255,255,0.92)", border: "rgba(14,116,144,0.22)", shadow: "#64748b", shadowOpacity: 0.12,
    eyebrow: "#0e7490", text: "#0f172a", mutedText: "#64748b", labelText: "#334155",
    track: "rgba(100,116,139,0.20)", metric: "rgba(241,245,249,0.96)", purpleText: "#6d28d9",
    purpleStrongText: "#4c1d95", purpleSurface: "rgba(124,58,237,0.09)", purpleIconSurface: "rgba(124,58,237,0.14)",
    purpleBorder: "rgba(109,40,217,0.22)", buttonText: "#1d4ed8", buttonIcon: "#2563eb",
    buttonSurface: "rgba(37,99,235,0.08)", buttonBorder: "rgba(37,99,235,0.20)",
  },
} as const;

function currency(value: number) {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function statusColor(status: StabilityProgress["status"], isDark: boolean) {
  if (status === "risk") return isDark ? "#fb7185" : "#e11d48";
  if (status === "watch") return isDark ? "#fbbf24" : "#b45309";
  return isDark ? "#34d399" : "#15803d";
}

function StabilityPathCardView({ progress, onViewGuide }: StabilityPathCardProps) {
  const c = useColors();
  const color = statusColor(progress.status, c.isDark);
  const theme = STABILITY_THEMES[c.mode];
  const progressWidth = `${Math.round(progress.backupProgress * 100)}%` as const;
  const paydayColor = progress.safeUntilPayday === true
    ? statusColor("safe", c.isDark)
    : progress.safeUntilPayday === false
      ? statusColor("risk", c.isDark)
      : statusColor("watch", c.isDark);
  const paydayTitle = progress.safeUntilPayday === true
    ? `Safe until ${progress.nextPaycheckLabel ?? "payday"}`
    : progress.safeUntilPayday === false
      ? `${currency(progress.paydayShortfall)} short before ${progress.nextPaycheckLabel ?? "payday"}`
      : "Next payday not confirmed";
  const paydayAccessibilityDetail = progress.safeUntilPayday === true
    ? "Your forecast keeps Must Pay bills and the safety floor covered until income arrives."
    : progress.safeUntilPayday === false
      ? "Close this gap before treating any money as extra."
      : "Add the next date in Income so Flo can check the plan through payday.";

  return (
    <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border, shadowColor: theme.shadow, shadowOpacity: theme.shadowOpacity }]}>
      <View style={styles.header}>
        <View style={[styles.icon, { backgroundColor: `${color}18`, borderColor: `${color}38` }]}>
          <Feather name="shield" size={18} color={color} />
        </View>
        <View style={styles.headerCopy}>
          <AppText tone="label" style={[styles.eyebrow, { color: theme.eyebrow }]}>Your stability path</AppText>
          <AppText tone="title" style={[styles.stage, { color: theme.text }]}>{progress.stageLabel}</AppText>
        </View>
        <View style={[styles.statusPill, { backgroundColor: `${color}18`, borderColor: `${color}38` }]}>
          <View style={[styles.statusDot, { backgroundColor: color }]} />
          <AppText style={[styles.statusText, { color }]}>{progress.status === "risk" ? "Act now" : progress.status === "watch" ? "Building" : "On track"}</AppText>
        </View>
      </View>

      <AppText tone="title" style={[styles.headline, { color: theme.text }]}>{progress.headline}</AppText>
      <AppText style={[styles.explanation, { color: theme.mutedText }]}>{progress.explanation}</AppText>

      <View
        accessible
        accessibilityLabel={`${paydayTitle}. ${paydayAccessibilityDetail}`}
        style={[styles.paydayCard, { backgroundColor: `${paydayColor}10`, borderColor: `${paydayColor}35` }]}
      >
        <Feather name={progress.safeUntilPayday === true ? "check-circle" : progress.safeUntilPayday === false ? "alert-circle" : "calendar"} size={16} color={paydayColor} />
        <AppText tone="title" numberOfLines={1} style={[styles.paydayTitle, { color: paydayColor }]}>{paydayTitle}</AppText>
      </View>

      <View style={styles.progressHeader}>
        <AppText style={[styles.progressLabel, { color: theme.labelText }]}>90-day backup path</AppText>
        <AppText tone="number" style={[styles.progressValue, { color: theme.text }]}>{Math.round(progress.backupProgress * 100)}%</AppText>
      </View>
      <View style={[styles.progressTrack, { backgroundColor: theme.track }]} accessibilityLabel={`${progress.protectedDays} of 90 backup days protected`}>
        <View style={[styles.progressFill, { backgroundColor: color, width: progressWidth }]} />
      </View>
      <View style={styles.milestones}>
        {[7, 30, 60, 90].map(days => (
          <AppText key={days} style={[styles.milestone, { color: theme.mutedText }, progress.protectedDays >= days && { color }]}> {days}d </AppText>
        ))}
      </View>

      <View style={styles.metrics}>
        <View style={[styles.metric, { backgroundColor: theme.metric }]}>
          <AppText tone="number" style={[styles.metricValue, { color: theme.text }]}>{progress.protectedDays}</AppText>
          <AppText style={[styles.metricLabel, { color: theme.mutedText }]}>days backed up</AppText>
        </View>
        <View style={[styles.metric, { backgroundColor: theme.metric }]}>
          <AppText tone="number" style={[styles.metricValue, { color: theme.text }]}>{currency(progress.protectedAmount)}</AppText>
          <AppText style={[styles.metricLabel, { color: theme.mutedText }]}>backup money</AppText>
        </View>
        <View style={[styles.metric, { backgroundColor: theme.metric }]}>
          <AppText tone="number" style={[styles.metricValue, { color: theme.text }]}>{currency(progress.backupTarget)}</AppText>
          <AppText style={[styles.metricLabel, { color: theme.mutedText }]}>90-day target</AppText>
        </View>
      </View>

      <View style={[styles.nextMove, { backgroundColor: theme.purpleSurface, borderColor: theme.purpleBorder }]}>
        <View style={[styles.nextMoveIcon, { backgroundColor: theme.purpleIconSurface }]}>
          <Feather name="arrow-up-right" size={15} color={theme.purpleText} />
        </View>
        <View style={styles.nextMoveCopy}>
          <AppText tone="label" style={[styles.nextMoveLabel, { color: theme.purpleText }]}>Next action</AppText>
          <AppText style={[styles.nextMoveText, { color: theme.purpleStrongText }]}>{progress.nextAction}</AppText>
        </View>
      </View>

      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="See how the Stability Path and algorithms work"
          onPress={onViewGuide}
          style={({ pressed }) => [styles.secondaryButton, { backgroundColor: theme.buttonSurface, borderColor: theme.buttonBorder, opacity: pressed ? 0.72 : 1 }]}
        >
          <Feather name="map" size={14} color={theme.buttonIcon} />
          <AppText style={[styles.secondaryButtonText, { color: theme.buttonText }]}>See how this works</AppText>
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
  paydayCard: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8, marginTop: 11 },
  paydayTitle: { flex: 1, fontSize: 12, lineHeight: 16, fontFamily: "Inter_800ExtraBold" },
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
