export const DESKTOP_ADD_ACTIONS = ["income", "bill", "debt", "goal"] as const;

export type DesktopAddAction = typeof DESKTOP_ADD_ACTIONS[number];

export function isDesktopAddAction(value: unknown): value is DesktopAddAction {
  return typeof value === "string" && DESKTOP_ADD_ACTIONS.includes(value as DesktopAddAction);
}

export function desktopAddDestination(action: DesktopAddAction) {
  return {
    pathname: "/(tabs)" as const,
    params: { action },
  };
}

export function desktopPlannerDestination(section: "accounts" | "notifications" | "plaid" | "review") {
  return {
    pathname: "/(tabs)/more" as const,
    params: { section, mode: "planner" },
  };
}

export function desktopActivityDestination(activityId: string, activityAt: string) {
  return {
    pathname: "/(tabs)/transactions" as const,
    params: { activityId, activityAt },
  };
}
