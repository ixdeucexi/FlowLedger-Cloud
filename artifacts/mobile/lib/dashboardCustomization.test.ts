import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_DASHBOARD_LAYOUT,
  moveDashboardWidget,
  normalizeDashboardLayout,
  setDashboardWidgetVisible,
  visibleDashboardWidgets,
} from "./dashboardCustomization";

test("dashboard layout normalization repairs missing, duplicate, and unknown widgets", () => {
  assert.deepEqual(normalizeDashboardLayout({
    order: ["reports_insights", "reports_insights", "unknown"],
    hidden: ["review_center", "today_decisions", "unknown"],
  }), {
    order: ["reports_insights", "today_decisions", "review_center"],
    hidden: ["review_center"],
  });
});

test("dashboard widgets can move and optional widgets can hide", () => {
  const moved = moveDashboardWidget(DEFAULT_DASHBOARD_LAYOUT, "reports_insights", "up");
  assert.deepEqual(moved.order, ["today_decisions", "reports_insights", "review_center"]);
  const hidden = setDashboardWidgetVisible(moved, "review_center", false);
  assert.deepEqual(visibleDashboardWidgets(hidden), ["today_decisions", "reports_insights"]);
  assert.deepEqual(setDashboardWidgetVisible(hidden, "today_decisions", false).hidden, ["review_center"]);
});
