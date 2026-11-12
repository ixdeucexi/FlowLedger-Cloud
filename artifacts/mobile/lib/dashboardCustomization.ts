import { APP_COMMANDS } from "./universalSearch";

export const DASHBOARD_WIDGET_IDS = [
  "setup",
  "overview",
  "accounts",
  "snapshot",
  "today_decisions",
  "review_center",
  "reports_insights",
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
] as const;
export type DashboardWidgetId = (typeof DASHBOARD_WIDGET_IDS)[number];
export const DASHBOARD_FAVORITE_ACTION_IDS = [
  "add-bill",
  "add-income",
  "add-debt",
  "add-goal",
  "add-transaction",
  "open-calendar",
  "open-review",
  "open-snowball",
] as const;
export type DashboardFavoriteActionId =
  (typeof DASHBOARD_FAVORITE_ACTION_IDS)[number];
export const MAX_DASHBOARD_FAVORITES = 4;
export const DASHBOARD_FAVORITE_ACTIONS = DASHBOARD_FAVORITE_ACTION_IDS.map(
  (id) => ({ ...APP_COMMANDS.find((command) => command.id === id)!, id }),
);
export type DashboardLayoutPreference = {
  order: DashboardWidgetId[];
  hidden: DashboardWidgetId[];
  favoriteActions: DashboardFavoriteActionId[];
  accountsCollapsed: boolean;
};
export const DEFAULT_DASHBOARD_LAYOUT: DashboardLayoutPreference = {
  order: [...DASHBOARD_WIDGET_IDS],
  hidden: [],
  favoriteActions: ["add-transaction", "add-bill", "open-calendar"],
  accountsCollapsed: false,
};
export const DASHBOARD_WIDGETS: Record<
  DashboardWidgetId,
  {
    label: string;
    description: string;
  }
> = {
  setup: {
    label: "Continue setup with Flo",
    description: "Your next setup step, when setup is incomplete.",
  },
  zero_based_budget: {
    label: "Zero-Based Budget",
    description: "Your zero-based plan on wider screens, when enabled.",
  },
  overview: {
    label: "Money overview",
    description: "Your balances and the current plan at a glance.",
  },
  accounts: {
    label: "Accounts",
    description: "Your account balances and manual account details.",
  },
  snapshot: {
    label: "Money snapshot",
    description: "Bills left, safe to spend and next payday.",
  },
  today_decisions: {
    label: "Today’s Decisions",
    description: "The most useful next actions from your current plan.",
  },
  review_center: {
    label: "Review Center",
    description: "Posted activity and plan items that need attention.",
  },
  reports_insights: {
    label: "Reports & Insights",
    description: "Trends, category totals, and financial insights.",
  },
  monthly_plan: {
    label: "This month’s plan",
    description: "Expected income and remaining bills and buckets.",
  },
  buckets: {
    label: "Spending buckets",
    description: "A shortcut to the things you are planning for.",
  },
  stability_path: {
    label: "Stability Path",
    description: "Your backup and protected-day outlook.",
  },
  debt_planner: {
    label: "Debt payoff",
    description: "Your current debt target and payoff planner.",
  },
  quick_actions: {
    label: "Favorite actions",
    description: "Your pinned shortcuts for everyday tasks.",
  },
  recent_activity: {
    label: "Recent Activity",
    description: "Your latest recorded transactions on desktop.",
  },
  upcoming_payments: {
    label: "Upcoming payments",
    description: "The next scheduled payments on desktop.",
  },
  category_budget: {
    label: "Category budget",
    description: "Your category plan summary on desktop.",
  },
  savings_goals: {
    label: "Savings goals",
    description: "Your goals and progress on desktop.",
  },
  breathing_room: {
    label: "Breathing room",
    description: "Your protected-day outlook and next stability step.",
  },
};
const LEGACY_IDS: readonly DashboardWidgetId[] = [
  "today_decisions",
  "review_center",
  "reports_insights",
];
const NEW_WIDGET_IDS: readonly DashboardWidgetId[] = [
  "setup",
  "zero_based_budget",
  "accounts",
  "breathing_room",
];
const ORIGINAL_WIDGET_IDS = DASHBOARD_WIDGET_IDS.filter(
  (id) => !NEW_WIDGET_IDS.includes(id),
);
function isDashboardWidgetId(value: unknown): value is DashboardWidgetId {
  return (
    typeof value === "string" &&
    DASHBOARD_WIDGET_IDS.includes(value as DashboardWidgetId)
  );
}
function isFavoriteActionId(
  value: unknown,
): value is DashboardFavoriteActionId {
  return (
    typeof value === "string" &&
    DASHBOARD_FAVORITE_ACTION_IDS.includes(value as DashboardFavoriteActionId)
  );
}
export function normalizeDashboardLayout(
  value: unknown,
): DashboardLayoutPreference {
  const candidate =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Partial<DashboardLayoutPreference>)
      : {};
  const requested = Array.isArray(candidate.order)
    ? [...new Set(candidate.order.filter(isDashboardWidgetId))]
    : [];
  // Old versions customized only three utilities. Keep their named money-card
  // anchors instead of relying on catalog positions that change as cards grow.
  const legacy =
    requested.length > 0 && requested.every((id) => LEGACY_IDS.includes(id));
  const requestedOrder: DashboardWidgetId[] = legacy
    ? [
        "overview",
        "snapshot",
        ...requested,
        ...LEGACY_IDS.filter((id) => !requested.includes(id)),
        ...ORIGINAL_WIDGET_IDS.filter(
          (id) =>
            id !== "overview" && id !== "snapshot" && !LEGACY_IDS.includes(id),
        ),
      ]
    : requested;
  const order = [
    ...requestedOrder,
    ...ORIGINAL_WIDGET_IDS.filter((id) => !requestedOrder.includes(id)),
  ];
  // Preserve every saved card's relative order. Previously unmanaged cards keep
  // their original leading/trailing positions, and Accounts follows its former
  // parent only when it does not already have its own saved position.
  if (!order.includes("setup")) order.unshift("setup");
  if (!order.includes("accounts"))
    order.splice(order.indexOf("overview") + 1, 0, "accounts");
  if (!order.includes("breathing_room")) order.push("breathing_room");
  if (!order.includes("zero_based_budget"))
    order.splice(order.indexOf("breathing_room"), 0, "zero_based_budget");
  const hidden = Array.isArray(candidate.hidden)
    ? [...new Set(candidate.hidden.filter(isDashboardWidgetId))]
    : [];
  // An old hidden overview also hid the Accounts body nested inside it. Once
  // Accounts has a saved position, the two visibility settings are independent.
  if (
    !requested.includes("accounts") &&
    hidden.includes("overview") &&
    !hidden.includes("accounts")
  )
    hidden.push("accounts");
  const favoriteActions = Array.isArray(candidate.favoriteActions)
    ? [...new Set(candidate.favoriteActions.filter(isFavoriteActionId))].slice(
        0,
        MAX_DASHBOARD_FAVORITES,
      )
    : [...DEFAULT_DASHBOARD_LAYOUT.favoriteActions];
  return {
    order,
    hidden,
    favoriteActions,
    accountsCollapsed: candidate.accountsCollapsed === true,
  };
}
export function moveDashboardWidget(
  layout: DashboardLayoutPreference,
  widgetId: DashboardWidgetId,
  direction: "up" | "down",
  availableIds: readonly DashboardWidgetId[] = DASHBOARD_WIDGET_IDS,
): DashboardLayoutPreference {
  const normalized = normalizeDashboardLayout(layout);
  if (!availableIds.includes(widgetId)) return normalized;
  const index = normalized.order.indexOf(widgetId),
    step = direction === "up" ? -1 : 1;
  let target = index + step;
  while (
    target >= 0 &&
    target < normalized.order.length &&
    !availableIds.includes(normalized.order[target])
  )
    target += step;
  if (index < 0 || target < 0 || target >= normalized.order.length)
    return normalized;
  const order = [...normalized.order];
  [order[index], order[target]] = [order[target], order[index]];
  return { ...normalized, order };
}
export function setDashboardWidgetVisible(
  layout: DashboardLayoutPreference,
  widgetId: DashboardWidgetId,
  visible: boolean,
): DashboardLayoutPreference {
  const normalized = normalizeDashboardLayout(layout);
  if (!isDashboardWidgetId(widgetId)) return normalized;
  return {
    ...normalized,
    hidden: visible
      ? normalized.hidden.filter((id) => id !== widgetId)
      : [...new Set([...normalized.hidden, widgetId])],
  };
}
export function setDashboardAccountsCollapsed(
  layout: DashboardLayoutPreference,
  collapsed: boolean,
): DashboardLayoutPreference {
  return normalizeDashboardLayout({ ...layout, accountsCollapsed: collapsed });
}
export function visibleDashboardWidgets(layout: DashboardLayoutPreference) {
  const normalized = normalizeDashboardLayout(layout);
  return normalized.order.filter((id) => !normalized.hidden.includes(id));
}
export function toggleDashboardFavoriteAction(
  layout: DashboardLayoutPreference,
  actionId: DashboardFavoriteActionId,
): DashboardLayoutPreference {
  const next = normalizeDashboardLayout(layout);
  if (!isFavoriteActionId(actionId)) return next;
  if (next.favoriteActions.includes(actionId))
    return {
      ...next,
      favoriteActions: next.favoriteActions.filter((id) => id !== actionId),
    };
  if (next.favoriteActions.length >= MAX_DASHBOARD_FAVORITES) return next;
  return { ...next, favoriteActions: [...next.favoriteActions, actionId] };
}
const preset = (
  order: DashboardWidgetId[],
  shown: DashboardWidgetId[],
  favoriteActions: DashboardFavoriteActionId[],
): DashboardLayoutPreference =>
  normalizeDashboardLayout({
    order,
    hidden: DASHBOARD_WIDGET_IDS.filter((id) => !shown.includes(id)),
    favoriteActions,
    accountsCollapsed: false,
  });
export const DASHBOARD_LAYOUT_PRESETS = [
  {
    id: "simple",
    name: "Simple",
    description: "Your essentials, with fewer cards.",
    layout: preset(
      [
        "setup",
        "overview",
        "accounts",
        "snapshot",
        "today_decisions",
        "quick_actions",
        "monthly_plan",
      ],
      [
        "setup",
        "overview",
        "accounts",
        "snapshot",
        "today_decisions",
        "quick_actions",
        "monthly_plan",
        "zero_based_budget",
        "breathing_room",
      ],
      ["add-transaction", "add-bill", "open-calendar"],
    ),
  },
  {
    id: "debt_focus",
    name: "Debt Focus",
    description: "Keep your next payoff step in view.",
    layout: preset(
      [
        "setup",
        "overview",
        "accounts",
        "debt_planner",
        "today_decisions",
        "snapshot",
        "quick_actions",
        "stability_path",
        "monthly_plan",
      ],
      [
        "setup",
        "overview",
        "accounts",
        "debt_planner",
        "today_decisions",
        "snapshot",
        "quick_actions",
        "stability_path",
        "monthly_plan",
        "review_center",
        "zero_based_budget",
        "breathing_room",
      ],
      ["open-snowball", "add-debt", "add-transaction", "open-review"],
    ),
  },
  {
    id: "planning_ahead",
    name: "Planning Ahead",
    description: "Make space for upcoming plans and goals.",
    layout: preset(
      [
        "setup",
        "overview",
        "accounts",
        "monthly_plan",
        "buckets",
        "stability_path",
        "today_decisions",
        "quick_actions",
        "snapshot",
        "savings_goals",
        "upcoming_payments",
      ],
      [
        "setup",
        "overview",
        "accounts",
        "monthly_plan",
        "buckets",
        "stability_path",
        "today_decisions",
        "quick_actions",
        "snapshot",
        "savings_goals",
        "upcoming_payments",
        "review_center",
        "zero_based_budget",
        "breathing_room",
      ],
      ["open-calendar", "add-goal", "add-income", "add-transaction"],
    ),
  },
] as const;
export function applyDashboardLayoutPreset(
  id: string,
): DashboardLayoutPreference {
  return normalizeDashboardLayout(
    DASHBOARD_LAYOUT_PRESETS.find((p) => p.id === id)?.layout ??
      DEFAULT_DASHBOARD_LAYOUT,
  );
}
export function dashboardLayoutPreset(layout: DashboardLayoutPreference) {
  const normalized = normalizeDashboardLayout(layout);
  const identity = (value: DashboardLayoutPreference) =>
    JSON.stringify({
      order: value.order,
      hidden: DASHBOARD_WIDGET_IDS.filter((id) => value.hidden.includes(id)),
      favoriteActions: value.favoriteActions,
      accountsCollapsed: value.accountsCollapsed,
    });
  return (
    DASHBOARD_LAYOUT_PRESETS.find(
      (p) =>
        identity(normalizeDashboardLayout(p.layout)) === identity(normalized),
    ) ?? null
  );
}
