import React from "react";
import { StyleSheet, View } from "react-native";
import { PrivacyPressable as Pressable } from "@/components/privacy/PrivacyPrimitives";
import { AppText } from "@/components/AppText";
import { useColors } from "@/hooks/useColors";
import {
  DASHBOARD_WIDGETS,
  visibleDashboardWidgets,
  type DashboardLayoutPreference,
  type DashboardWidgetId,
} from "@/lib/dashboardCustomization";

const DESKTOP_HALF_WIDTH = new Set<DashboardWidgetId>([
  "review_center", "reports_insights", "recent_activity", "upcoming_payments", "category_budget", "savings_goals",
]);

export const MOBILE_DASHBOARD_WIDGET_IDS: readonly DashboardWidgetId[] = [
  "setup", "zero_based_budget", "overview", "accounts", "snapshot", "today_decisions", "review_center", "reports_insights",
  "monthly_plan", "buckets", "stability_path", "debt_planner", "quick_actions", "breathing_room",
];

export const DESKTOP_DASHBOARD_WIDGET_IDS: readonly DashboardWidgetId[] = [
  "setup", "overview", "accounts", "snapshot", "today_decisions", "review_center", "reports_insights",
  "monthly_plan", "buckets", "stability_path", "debt_planner", "quick_actions",
  "recent_activity", "upcoming_payments", "category_budget", "savings_goals",
];

/** Presentation order only. Every section receives the existing financial values. */
export function DashboardSections({ layout, sections, desktop = false, ready = true, loading = false, onCustomize, onReset }: {
  layout: DashboardLayoutPreference;
  sections: Partial<Record<DashboardWidgetId, React.ReactNode>>;
  desktop?: boolean;
  ready?: boolean;
  loading?: boolean;
  onCustomize?: () => void;
  onReset?: () => void;
}) {
  const c = useColors();
  if (!ready) return null;
  const visible = visibleDashboardWidgets(layout).filter(id => sections[id] != null && sections[id] !== false);
  if (!visible.length) return (
    <View style={[styles.empty, { backgroundColor: c.card, borderColor: c.border }]}>
      <AppText accessibilityRole="header" style={[styles.emptyTitle, { color: c.foreground }]}>Your Dashboard is empty</AppText>
      <AppText style={[styles.emptyCopy, { color: c.mutedForeground }]}>Choose the cards you want to see. Your accounts and plan are saved.</AppText>
      <View style={styles.emptyActions}>
        {onCustomize ? <Pressable accessibilityRole="button" onPress={onCustomize} style={[styles.button, { backgroundColor: c.primary }]}>
          <AppText style={[styles.buttonText, { color: c.primaryForeground }]}>Choose cards</AppText>
        </Pressable> : null}
        {onReset ? <Pressable accessibilityRole="button" disabled={loading} onPress={onReset} style={[styles.button, { borderWidth: 1, borderColor: c.border, opacity: loading ? 0.5 : 1 }]}>
          <AppText style={[styles.buttonText, { color: c.foreground }]}>Restore default layout</AppText>
        </Pressable> : null}
      </View>
    </View>
  );
  return (
    <View style={[styles.sections, desktop && styles.desktop]}>
      {visible.map(id => (
        <View
          key={id}
          accessibilityLabel={`Dashboard section: ${DASHBOARD_WIDGETS[id].label}`}
          style={[styles.section, desktop && DESKTOP_HALF_WIDTH.has(id) && styles.halfSection]}
        >
          {sections[id]}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { width: "100%", minWidth: 0, padding: 24, borderRadius: 22, borderWidth: 1, gap: 12 },
  emptyTitle: { fontSize: 20, fontWeight: "700" },
  emptyCopy: { fontSize: 14, lineHeight: 21 },
  emptyActions: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 4 },
  button: { minHeight: 44, justifyContent: "center", alignItems: "center", borderRadius: 12, paddingHorizontal: 16, paddingVertical: 10 },
  buttonText: { fontSize: 14, fontWeight: "600" },
  sections: { width: "100%", gap: 16 },
  desktop: { gap: 18, flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start" },
  section: { width: "100%", minWidth: 0 },
  halfSection: { width: "48%", flexGrow: 1, minWidth: 0 },
});
