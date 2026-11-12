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
  setDashboardAccountsCollapsed,
  setDashboardWidgetVisible,
  toggleDashboardFavoriteAction,
  visibleDashboardWidgets,
} from "./dashboardCustomization";

// A saved pre-Accounts layout, intentionally ordered differently from defaults.
const oldOrder = [
  "buckets",
  "reports_insights",
  "recent_activity",
  "overview",
  "monthly_plan",
  "snapshot",
  "savings_goals",
  "review_center",
  "today_decisions",
  "debt_planner",
  "quick_actions",
  "stability_path",
  "category_budget",
  "upcoming_payments",
] as const;

test("legacy utility layouts retain named money-card anchors and saved utility choices", () => {
  const next = normalizeDashboardLayout({
    order: ["reports_insights", "reports_insights", "unknown"],
    hidden: ["review_center", "today_decisions", "overview", "unknown"],
    favoriteActions: ["add-goal", "open-calendar"],
  });
  assert.deepEqual(next.order.slice(0, 7), [
    "setup",
    "overview",
    "accounts",
    "snapshot",
    "reports_insights",
    "today_decisions",
    "review_center",
  ]);
  assert.deepEqual(next.order.slice(7), [
    "monthly_plan",
    "buckets",
    "stability_path",
    "debt_planner",
    "quick_actions",
    "recent_activity",
    "upcoming_payments",
    "category_budget",
    "savings_goals",
    "zero_based_budget",
    "breathing_room",
  ]);
  assert.deepEqual(next.hidden, [
    "review_center",
    "today_decisions",
    "overview",
    "accounts",
  ]);
  assert.deepEqual(next.favoriteActions, ["add-goal", "open-calendar"]);
  assert.equal(next.accountsCollapsed, false);
});

test("old full layouts preserve all old relative order, visibility and favorites", () => {
  const next = normalizeDashboardLayout({
    order: oldOrder,
    hidden: ["snapshot", "today_decisions", "buckets"],
    favoriteActions: ["open-review", "add-debt"],
  });
  assert.deepEqual(
    next.order.filter((id) => oldOrder.some((oldId) => oldId === id)),
    oldOrder,
  );
  assert.equal(next.order[0], "setup");
  assert.equal(next.order[next.order.indexOf("overview") + 1], "accounts");
  assert.deepEqual(next.order.slice(-2), ["zero_based_budget", "breathing_room"]);
  assert.deepEqual(next.hidden, ["snapshot", "today_decisions", "buckets"]);
  assert.deepEqual(next.favoriteActions, ["open-review", "add-debt"]);
  assert.equal(next.accountsCollapsed, false);
  assert.deepEqual(normalizeDashboardLayout(next), next);
});

test("already-saved positions of all new cards survive normalization", () => {
  const explicitOrder = [
    "zero_based_budget", "breathing_room", "accounts", "setup", ...oldOrder,
  ];
  const next = normalizeDashboardLayout({
    order: explicitOrder,
    hidden: ["accounts", "setup"],
    accountsCollapsed: true,
  });
  assert.deepEqual(next.order, explicitOrder);
  assert.deepEqual(next.hidden, ["accounts", "setup"]);
  assert.equal(next.accountsCollapsed, true);
  assert.deepEqual(normalizeDashboardLayout(next), next);
});

test("normalization closes fields, repairs malformed arrays and deduplicates cards", () => {
  for (const input of [null, [], "bad", 4, { order: "overview", hidden: {} }])
    assert.deepEqual(normalizeDashboardLayout(input), DEFAULT_DASHBOARD_LAYOUT);
  const next = normalizeDashboardLayout({
    order: ["buckets", "buckets", "overview", "constructor"],
    hidden: ["buckets", "buckets", "overview", "today_decisions", "constructor"],
    favoriteActions: [],
    financialBalance: 123,
  });
  assert.deepEqual(next.order.slice(0, 5), [
    "setup",
    "buckets",
    "overview",
    "accounts",
    "snapshot",
  ]);
  assert.equal(new Set(next.order).size, DASHBOARD_WIDGET_IDS.length);
  assert.deepEqual(next.hidden, [
    "buckets",
    "overview",
    "today_decisions",
    "accounts",
  ]);
  assert.deepEqual(next.favoriteActions, []);
  assert.deepEqual(Object.keys(next).sort(), [
    "accountsCollapsed",
    "favoriteActions",
    "hidden",
    "order",
  ]);
});

test("Accounts collapse accepts only a saved boolean true", () => {
  for (const value of [
    undefined, null, false, 0, 1, "true", [], {}, new Boolean(true),
  ])
    assert.equal(
      normalizeDashboardLayout({ accountsCollapsed: value }).accountsCollapsed,
      false,
    );
  assert.equal(
    normalizeDashboardLayout({ accountsCollapsed: true }).accountsCollapsed,
    true,
  );
});

test("every card can hide and an all-hidden collapsed layout survives serialization", () => {
  const before = JSON.stringify(DEFAULT_DASHBOARD_LAYOUT);
  let hidden = setDashboardAccountsCollapsed(DEFAULT_DASHBOARD_LAYOUT, true);
  for (const id of DASHBOARD_WIDGET_IDS)
    hidden = setDashboardWidgetVisible(hidden, id, false);
  assert.equal(hidden.hidden.length, DASHBOARD_WIDGET_IDS.length);
  assert.deepEqual(visibleDashboardWidgets(hidden), []);
  assert.equal(hidden.accountsCollapsed, true);
  const restored = normalizeDashboardLayout(JSON.parse(JSON.stringify(hidden)));
  assert.deepEqual(restored, hidden);
  for (const id of DASHBOARD_WIDGET_IDS)
    hidden = setDashboardWidgetVisible(hidden, id, true);
  assert.deepEqual(hidden.hidden, []);
  assert.deepEqual(visibleDashboardWidgets(hidden), hidden.order);
  assert.equal(hidden.accountsCollapsed, true);
  assert.equal(JSON.stringify(DEFAULT_DASHBOARD_LAYOUT), before);
});

test("Accounts visibility is independent after migration from its old overview parent", () => {
  const migrated = normalizeDashboardLayout({
    order: oldOrder,
    hidden: ["overview"],
  });
  assert.deepEqual(migrated.hidden, ["overview", "accounts"]);
  const accountsShown = setDashboardWidgetVisible(migrated, "accounts", true);
  assert.deepEqual(accountsShown.hidden, ["overview"]);
  assert.deepEqual(normalizeDashboardLayout(accountsShown), accountsShown);
  const overviewShown = setDashboardWidgetVisible(migrated, "overview", true);
  assert.deepEqual(overviewShown.hidden, ["accounts"]);
  assert.deepEqual(
    setDashboardWidgetVisible(DEFAULT_DASHBOARD_LAYOUT, "overview", false).hidden,
    ["overview"],
  );
  assert.deepEqual(
    setDashboardWidgetVisible(DEFAULT_DASHBOARD_LAYOUT, "accounts", false).hidden,
    ["accounts"],
  );
});

test("collapse and ordinary layout edits preserve each other's choices without mutation", () => {
  const initial = normalizeDashboardLayout({
    order: [...oldOrder].reverse(),
    hidden: ["review_center", "buckets"],
    favoriteActions: ["add-goal"],
  });
  const before = JSON.stringify(initial);
  const collapsed = setDashboardAccountsCollapsed(initial, true);
  assert.deepEqual(collapsed, { ...initial, accountsCollapsed: true });
  const moved = moveDashboardWidget(collapsed, "monthly_plan", "up");
  assert.equal(
    moved.order.indexOf("monthly_plan"),
    initial.order.indexOf("monthly_plan") - 1,
  );
  const hidden = setDashboardWidgetVisible(moved, "today_decisions", false);
  const favorite = toggleDashboardFavoriteAction(hidden, "add-income");
  assert.equal(favorite.accountsCollapsed, true);
  assert.deepEqual(favorite.hidden, [
    "review_center", "buckets", "today_decisions",
  ]);
  assert.deepEqual(favorite.favoriteActions, ["add-goal", "add-income"]);
  assert.deepEqual(setDashboardAccountsCollapsed(favorite, false), {
    ...favorite,
    accountsCollapsed: false,
  });
  assert.equal(JSON.stringify(initial), before);
  assert.deepEqual(
    moveDashboardWidget(DEFAULT_DASHBOARD_LAYOUT, "setup", "up"),
    DEFAULT_DASHBOARD_LAYOUT,
  );
});

test("mobile moves skip desktop-only cards while retaining their positions and collapse", () => {
  const next = normalizeDashboardLayout({
    ...DEFAULT_DASHBOARD_LAYOUT,
    order: [
      "overview", "recent_activity", "savings_goals", "buckets", "accounts",
    ],
    accountsCollapsed: true,
  });
  const moved = moveDashboardWidget(next, "buckets", "up", [
    "overview",
    "buckets",
  ]);
  assert.deepEqual(moved.order.slice(1, 5), [
    "buckets",
    "recent_activity",
    "savings_goals",
    "overview",
  ]);
  assert.equal(
    moved.order.indexOf("recent_activity"),
    next.order.indexOf("recent_activity"),
  );
  assert.equal(
    moved.order.indexOf("savings_goals"),
    next.order.indexOf("savings_goals"),
  );
  assert.equal(moved.accountsCollapsed, true);
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

test("presets and reset expand Accounts and keep formerly unmanaged cards visible", () => {
  const identities = new Set<string>();
  for (const preset of DASHBOARD_LAYOUT_PRESETS) {
    const value = applyDashboardLayoutPreset(preset.id);
    assert.equal(value.order.length, DASHBOARD_WIDGET_IDS.length);
    assert.equal(new Set(value.order).size, DASHBOARD_WIDGET_IDS.length);
    for (const id of [
      "overview", "accounts", "today_decisions",
      "setup", "zero_based_budget", "breathing_room",
    ] as const)
      assert.ok(visibleDashboardWidgets(value).includes(id));
    assert.equal(value.order[value.order.indexOf("overview") + 1], "accounts");
    assert.deepEqual(value.order.slice(-2), ["zero_based_budget", "breathing_room"]);
    assert.equal(value.accountsCollapsed, false);
    assert.equal(dashboardLayoutPreset(value)?.id, preset.id);
    assert.equal(
      dashboardLayoutPreset(setDashboardAccountsCollapsed(value, true)),
      null,
    );
    assert.ok(value.favoriteActions.length <= 4);
    assert.ok(JSON.stringify(value).length < 16384);
    identities.add(JSON.stringify(value));
    const before = JSON.stringify(preset.layout);
    value.order.reverse();
    value.hidden.reverse();
    value.favoriteActions.pop();
    value.accountsCollapsed = true;
    assert.equal(JSON.stringify(preset.layout), before);
  }
  assert.equal(identities.size, 3);
  const simple = applyDashboardLayoutPreset("simple");
  assert.equal(
    dashboardLayoutPreset({ ...simple, hidden: [...simple.hidden].reverse() })?.id,
    "simple",
  );
  assert.equal(
    dashboardLayoutPreset(moveDashboardWidget(simple, "quick_actions", "up")),
    null,
  );
  const reset = normalizeDashboardLayout(DEFAULT_DASHBOARD_LAYOUT);
  assert.equal(reset.accountsCollapsed, false);
  assert.deepEqual(reset.hidden, []);
  assert.deepEqual(reset.order, DASHBOARD_WIDGET_IDS);
  assert.deepEqual(applyDashboardLayoutPreset("unknown"), reset);
});
