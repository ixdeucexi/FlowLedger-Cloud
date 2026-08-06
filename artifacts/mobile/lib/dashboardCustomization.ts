export const DASHBOARD_WIDGET_IDS = [
  "today_decisions",
  "review_center",
  "reports_insights",
] as const;

export type DashboardWidgetId = (typeof DASHBOARD_WIDGET_IDS)[number];

export type DashboardLayoutPreference = {
  order: DashboardWidgetId[];
  hidden: DashboardWidgetId[];
};

export const DEFAULT_DASHBOARD_LAYOUT: DashboardLayoutPreference = {
  order: [...DASHBOARD_WIDGET_IDS],
  hidden: [],
};

export const DASHBOARD_WIDGETS: Record<DashboardWidgetId, {
  label: string;
  description: string;
  required?: boolean;
}> = {
  today_decisions: {
    label: "Today’s Decisions",
    description: "The most useful next actions from your current plan.",
    required: true,
  },
  review_center: {
    label: "Review Center",
    description: "Posted activity and plan items that need attention.",
  },
  reports_insights: {
    label: "Reports & Insights",
    description: "Trends, category totals, and financial insights.",
  },
};

function isDashboardWidgetId(value: unknown): value is DashboardWidgetId {
  return typeof value === "string" && DASHBOARD_WIDGET_IDS.includes(value as DashboardWidgetId);
}

export function normalizeDashboardLayout(value: unknown): DashboardLayoutPreference {
  const candidate = value && typeof value === "object"
    ? value as Partial<DashboardLayoutPreference>
    : {};
  const requestedOrder = Array.isArray(candidate.order)
    ? candidate.order.filter(isDashboardWidgetId)
    : [];
  const order = [
    ...new Set(requestedOrder),
    ...DASHBOARD_WIDGET_IDS.filter(id => !requestedOrder.includes(id)),
  ];
  const hidden = Array.isArray(candidate.hidden)
    ? [...new Set(candidate.hidden.filter(id => isDashboardWidgetId(id) && !DASHBOARD_WIDGETS[id].required))]
    : [];
  return { order, hidden };
}

export function moveDashboardWidget(
  layout: DashboardLayoutPreference,
  widgetId: DashboardWidgetId,
  direction: "up" | "down",
): DashboardLayoutPreference {
  const normalized = normalizeDashboardLayout(layout);
  const index = normalized.order.indexOf(widgetId);
  const target = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || target < 0 || target >= normalized.order.length) return normalized;
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
  if (DASHBOARD_WIDGETS[widgetId].required) return normalized;
  const hidden = visible
    ? normalized.hidden.filter(id => id !== widgetId)
    : [...new Set([...normalized.hidden, widgetId])];
  return { ...normalized, hidden };
}

export function visibleDashboardWidgets(layout: DashboardLayoutPreference) {
  const normalized = normalizeDashboardLayout(layout);
  return normalized.order.filter(id => !normalized.hidden.includes(id));
}
