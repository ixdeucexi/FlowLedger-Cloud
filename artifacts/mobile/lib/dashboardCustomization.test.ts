import assert from "node:assert/strict";
import test from "node:test";
import {
  DASHBOARD_FAVORITE_ACTIONS,
  DASHBOARD_LAYOUT_PRESETS,
  DASHBOARD_WIDGET_IDS,
  DEFAULT_DASHBOARD_LAYOUT,
  applyDashboardLayoutPreset,
  dashboardLayoutPreset,
  moveDashboardWidget,
  normalizeDashboardLayout,
  setDashboardWidgetVisible,
  toggleDashboardFavoriteAction,
  visibleDashboardWidgets,
} from "./dashboardCustomization";

test("legacy utility layouts keep their own order below the money overview", () => {
  const next = normalizeDashboardLayout({
    order: ["reports_insights", "reports_insights", "unknown"],
    hidden: ["review_center", "today_decisions", "overview", "unknown"],
  });
  assert.deepEqual(next.order.slice(0, 5), [
    "overview",
    "snapshot",
    "reports_insights",
    "today_decisions",
    "review_center",
  ]);
  assert.deepEqual(next.order.slice(5), DASHBOARD_WIDGET_IDS.slice(5));
  assert.deepEqual(next.hidden, ["review_center"]);
  assert.deepEqual(
    next.favoriteActions,
    DEFAULT_DASHBOARD_LAYOUT.favoriteActions,
  );
});

test("normalization closes layout fields, repairs malformed arrays and deduplicates all cards", () => {
  for (const input of [null, [], "bad", 4, { order: "overview", hidden: {} }])
    assert.deepEqual(normalizeDashboardLayout(input), DEFAULT_DASHBOARD_LAYOUT);
  const next = normalizeDashboardLayout({
    order: ["buckets", "buckets", "overview", "constructor"],
    hidden: ["buckets", "buckets", "overview", "today_decisions"],
    favoriteActions: [],
    financialBalance: 123,
  });
  assert.deepEqual(next.order.slice(0, 2), ["buckets", "overview"]);
  assert.equal(new Set(next.order).size, DASHBOARD_WIDGET_IDS.length);
  assert.deepEqual(next.hidden, ["buckets"]);
  assert.deepEqual(next.favoriteActions, []);
  assert.deepEqual(Object.keys(next).sort(), [
    "favoriteActions",
    "hidden",
    "order",
  ]);
});

test("actual cards reorder and optional cards hide without mutating their input", () => {
  const before = JSON.stringify(DEFAULT_DASHBOARD_LAYOUT);
  const moved = moveDashboardWidget(
    DEFAULT_DASHBOARD_LAYOUT,
    "monthly_plan",
    "up",
  );
  assert.equal(moved.order.indexOf("monthly_plan"), 4);
  const hidden = setDashboardWidgetVisible(moved, "buckets", false);
  assert.ok(!visibleDashboardWidgets(hidden).includes("buckets"));
  assert.deepEqual(
    setDashboardWidgetVisible(hidden, "overview", false).hidden,
    ["buckets"],
  );
  assert.deepEqual(
    setDashboardWidgetVisible(hidden, "today_decisions", false).hidden,
    ["buckets"],
  );
  assert.ok(
    visibleDashboardWidgets(
      setDashboardWidgetVisible(hidden, "buckets", true),
    ).includes("buckets"),
  );
  assert.equal(JSON.stringify(DEFAULT_DASHBOARD_LAYOUT), before);
  assert.deepEqual(
    moveDashboardWidget(DEFAULT_DASHBOARD_LAYOUT, "overview", "up"),
    DEFAULT_DASHBOARD_LAYOUT,
  );
});

test("mobile moves skip desktop-only cards while retaining their positions", () => {
  const next = normalizeDashboardLayout({
    ...DEFAULT_DASHBOARD_LAYOUT,
    order: ["overview", "recent_activity", "savings_goals", "buckets"],
  });
  const moved = moveDashboardWidget(next, "buckets", "up", [
    "overview",
    "buckets",
  ]);
  assert.deepEqual(moved.order.slice(0, 4), [
    "buckets",
    "recent_activity",
    "savings_goals",
    "overview",
  ]);
  assert.deepEqual(
    moveDashboardWidget(next, "recent_activity", "up", ["overview", "buckets"]),
    next,
  );
});

test("favorites are bounded canonical commands, never arbitrary persisted routes", () => {
  const next = normalizeDashboardLayout({
    favoriteActions: [
      "add-bill",
      "add-bill",
      "javascript:bad",
      "add-income",
      "add-debt",
      "add-goal",
      "open-calendar",
    ],
  });
  assert.deepEqual(next.favoriteActions, [
    "add-bill",
    "add-income",
    "add-debt",
    "add-goal",
  ]);
  assert.equal(
    toggleDashboardFavoriteAction(next, "open-calendar").favoriteActions.length,
    4,
  );
  const removed = toggleDashboardFavoriteAction(next, "add-debt");
  assert.deepEqual(
    toggleDashboardFavoriteAction(removed, "open-calendar").favoriteActions,
    ["add-bill", "add-income", "add-goal", "open-calendar"],
  );
  assert.equal(DASHBOARD_FAVORITE_ACTIONS.length, 8);
  for (const command of DASHBOARD_FAVORITE_ACTIONS)
    assert.ok(command.route.startsWith("/"));
});

test("all three presets are complete, distinct, identify honestly and preserve required cards", () => {
  const identities = new Set<string>();
  for (const preset of DASHBOARD_LAYOUT_PRESETS) {
    const value = applyDashboardLayoutPreset(preset.id);
    assert.equal(value.order.length, DASHBOARD_WIDGET_IDS.length);
    assert.equal(new Set(value.order).size, DASHBOARD_WIDGET_IDS.length);
    assert.ok(visibleDashboardWidgets(value).includes("overview"));
    assert.ok(visibleDashboardWidgets(value).includes("today_decisions"));
    assert.equal(dashboardLayoutPreset(value)?.id, preset.id);
    assert.ok(value.favoriteActions.length <= 4);
    assert.ok(JSON.stringify(value).length < 16384);
    identities.add(JSON.stringify(value));
    const before = JSON.stringify(preset.layout);
    value.order.reverse();
    value.hidden.reverse();
    value.favoriteActions.pop();
    assert.equal(JSON.stringify(preset.layout), before);
  }
  assert.equal(identities.size, 3);
  const simple = applyDashboardLayoutPreset("simple");
  assert.equal(
    dashboardLayoutPreset({ ...simple, hidden: [...simple.hidden].reverse() })
      ?.id,
    "simple",
  );
  assert.equal(
    dashboardLayoutPreset(moveDashboardWidget(simple, "quick_actions", "up")),
    null,
  );
  assert.deepEqual(
    applyDashboardLayoutPreset("unknown"),
    DEFAULT_DASHBOARD_LAYOUT,
  );
});
