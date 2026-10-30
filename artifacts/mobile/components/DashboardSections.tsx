import React from "react";
import { StyleSheet, View } from "react-native";
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
  "overview", "snapshot", "today_decisions", "review_center", "reports_insights",
  "monthly_plan", "buckets", "stability_path", "debt_planner", "quick_actions",
];

/** Presentation order only. Every section receives the existing financial values. */
export function DashboardSections({ layout, sections, desktop = false }: {
  layout: DashboardLayoutPreference;
  sections: Partial<Record<DashboardWidgetId, React.ReactNode>>;
  desktop?: boolean;
}) {
  return (
    <View style={[styles.sections, desktop && styles.desktop]}>
      {visibleDashboardWidgets(layout).map(id => sections[id] == null ? null : (
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
  sections: { width: "100%", gap: 16 },
  desktop: { gap: 18, flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start" },
  section: { width: "100%", minWidth: 0 },
  halfSection: { width: "48%", flexGrow: 1, minWidth: 0 },
});
