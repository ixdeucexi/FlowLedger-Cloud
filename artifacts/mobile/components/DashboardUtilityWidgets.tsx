import { Feather } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import { visibleDashboardWidgets, type DashboardLayoutPreference } from "@/lib/dashboardCustomization";
import type { TodayDecision, TodayDecisionTone } from "@/lib/todaysDecisions";

type Props = {
  layout: DashboardLayoutPreference;
  decisions: TodayDecision[];
  reviewCount: number;
  compact?: boolean;
  onNavigate: (route: string, params?: Record<string, string>) => void;
};

const TONE_ICON: Record<TodayDecisionTone, React.ComponentProps<typeof Feather>["name"]> = {
  safe: "check-circle",
  watch: "clock",
  risk: "alert-triangle",
  info: "compass",
};

export function DashboardUtilityWidgets({ layout, decisions, reviewCount, compact = false, onNavigate }: Props) {
  const c = useColors();
  const { width } = useWindowDimensions();
  const stack = compact || width < 1120;
  const [expanded, setExpanded] = useState(false);
  const visible = useMemo(() => visibleDashboardWidgets(layout), [layout]);
  const compactDecisionLimit = 2;
  const visibleDecisions = compact && !expanded ? decisions.slice(0, compactDecisionLimit) : decisions;

  const toneColor = (tone: TodayDecisionTone) => {
    if (tone === "safe") return c.success;
    if (tone === "watch") return c.warning;
    if (tone === "risk") return c.destructive;
    return c.accent;
  };

  return (
    <View style={[styles.grid, stack && styles.gridStacked]}>
      {visible.map(widgetId => {
        if (widgetId === "today_decisions") {
          return (
            <View
              key={widgetId}
              style={[
                styles.card,
                styles.decisionsCard,
                !stack && styles.decisionsCardWide,
                { backgroundColor: c.card, borderColor: c.border },
              ]}
            >
              <View style={styles.cardHeader}>
                <View style={[styles.cardIcon, { backgroundColor: c.primary + "18" }]}>
                  <Feather name="sun" size={18} color={c.primary} />
                </View>
                <View style={styles.headerCopy}>
                  <Text accessibilityRole="header" style={[styles.cardTitle, { color: c.foreground }]}>Next up</Text>
                  <Text style={[styles.cardSubtitle, { color: c.mutedForeground }]}>The few things worth your attention</Text>
                </View>
              </View>
              <View style={styles.decisionList}>
                {visibleDecisions.map((decision, index) => {
                  const color = toneColor(decision.tone);
                  return (
                    <View key={decision.id} style={[styles.decisionRow, index > 0 && { borderTopColor: c.border, borderTopWidth: 1 }]}>
                      <View style={[styles.decisionIcon, { backgroundColor: color + "17", borderColor: color + "30" }]}>
                        <Feather name={TONE_ICON[decision.tone]} size={16} color={color} />
                      </View>
                      <View style={styles.decisionCopy}>
                        <Text style={[styles.decisionTitle, { color: c.foreground }]}>{decision.title}</Text>
                        <Text style={[styles.decisionReason, { color: c.mutedForeground }]}>{decision.reason}</Text>
                        <Pressable
                          accessibilityRole="link"
                          accessibilityLabel={`${decision.actionLabel}: ${decision.title}`}
                          onPress={() => onNavigate(decision.route, decision.params)}
                          style={({ pressed }) => [styles.decisionAction, { opacity: pressed ? 0.65 : 1 }]}
                        >
                          <Text style={[styles.decisionActionText, { color }]}>{decision.actionLabel}</Text>
                          <Feather name="arrow-right" size={13} color={color} />
                        </Pressable>
                      </View>
                    </View>
                  );
                })}
              </View>
              {compact && decisions.length > compactDecisionLimit ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded }}
                  onPress={() => setExpanded(value => !value)}
                  style={[styles.expandButton, { borderTopColor: c.border }]}
                >
                  <Text style={[styles.expandText, { color: c.primary }]}>{expanded ? "Show less" : `View ${decisions.length - compactDecisionLimit} more`}</Text>
                  <Feather name={expanded ? "chevron-up" : "chevron-down"} size={15} color={c.primary} />
                </Pressable>
              ) : null}
            </View>
          );
        }

        const review = widgetId === "review_center";
        const title = review ? "Review Center" : "Reports & Insights";
        const subtitle = review
          ? reviewCount > 0
            ? `${reviewCount} ${reviewCount === 1 ? "item needs" : "items need"} your attention`
            : "Your posted activity is reviewed"
          : "Explore trends, categories, and next steps";
        const icon = review ? "check-square" : "bar-chart-2";
        const color = review ? c.primary : c.accent;
        const route = review ? "/(tabs)/review" : "/(tabs)/reports";

        return (
          <Pressable
            key={widgetId}
            accessibilityRole="link"
            accessibilityLabel={`Open ${title}`}
            onPress={() => onNavigate(route)}
            style={({ pressed }) => [
              styles.card,
              styles.shortcutCard,
              !stack && styles.shortcutCardWide,
              { backgroundColor: c.card, borderColor: c.border, opacity: pressed ? 0.76 : 1 },
            ]}
          >
            <View style={[styles.shortcutIcon, { backgroundColor: color + "18", borderColor: color + "32" }]}>
              <Feather name={icon} size={21} color={color} />
            </View>
            <View style={styles.shortcutCopy}>
              <Text style={[styles.shortcutTitle, { color: c.foreground }]}>{title}</Text>
              <Text style={[styles.shortcutSubtitle, { color: c.mutedForeground }]}>{subtitle}</Text>
            </View>
            <Feather name="arrow-up-right" size={18} color={color} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", alignItems: "stretch", gap: 14, width: "100%" },
  gridStacked: { flexDirection: "column" },
  card: { borderWidth: 1, borderRadius: 20, overflow: "hidden" },
  decisionsCard: { width: "100%", padding: 17 },
  decisionsCardWide: { flex: 2.1, minWidth: 0 },
  shortcutCard: { minHeight: 88, flexDirection: "row", alignItems: "center", gap: 13, padding: 16 },
  shortcutCardWide: { flex: 1, minWidth: 0 },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 11 },
  cardIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  headerCopy: { flex: 1, minWidth: 0 },
  cardTitle: { fontFamily: "Inter_800ExtraBold", fontSize: 17, letterSpacing: -0.2 },
  cardSubtitle: { fontFamily: "Inter_500Medium", fontSize: 12, marginTop: 2 },
  decisionList: { marginTop: 8 },
  decisionRow: { flexDirection: "row", alignItems: "flex-start", gap: 11, paddingVertical: 12 },
  decisionIcon: { width: 34, height: 34, borderRadius: 11, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  decisionCopy: { flex: 1, minWidth: 0 },
  decisionTitle: { fontFamily: "Inter_700Bold", fontSize: 14, lineHeight: 19 },
  decisionReason: { fontFamily: "Inter_500Medium", fontSize: 12, lineHeight: 18, marginTop: 2 },
  decisionAction: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 5, marginTop: 7, minHeight: 32, paddingHorizontal: 10, borderRadius: 10 },
  decisionActionText: { fontFamily: "Inter_700Bold", fontSize: 12 },
  expandButton: { minHeight: 42, borderTopWidth: 1, marginHorizontal: -17, marginBottom: -17, paddingHorizontal: 17, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  expandText: { fontFamily: "Inter_700Bold", fontSize: 13 },
  shortcutIcon: { width: 44, height: 44, borderRadius: 14, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  shortcutCopy: { flex: 1, minWidth: 0 },
  shortcutTitle: { fontFamily: "Inter_800ExtraBold", fontSize: 15 },
  shortcutSubtitle: { fontFamily: "Inter_500Medium", fontSize: 12, lineHeight: 17, marginTop: 4 },
});
