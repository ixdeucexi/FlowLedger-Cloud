export type InAppNotificationTone = "safe" | "watch" | "risk" | "info";

export type InAppNotification = {
  id: string;
  type: "bill" | "forecast" | "goal" | "debt" | "review";
  title: string;
  body: string;
  timestamp: string;
  route: string;
  params?: Record<string, string>;
  tone: InAppNotificationTone;
};

export type NotificationCenterState = {
  readIds: string[];
  dismissedIds: string[];
};

export const EMPTY_NOTIFICATION_STATE: NotificationCenterState = { readIds: [], dismissedIds: [] };

function uniqueStrings(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(item => typeof item === "string" && item.length <= 240))].slice(-500);
}

export function normalizeNotificationState(value: unknown): NotificationCenterState {
  const candidate = value && typeof value === "object" ? value as Partial<NotificationCenterState> : {};
  return {
    readIds: uniqueStrings(candidate.readIds),
    dismissedIds: uniqueStrings(candidate.dismissedIds),
  };
}

export function visibleNotifications(notifications: InAppNotification[], state: NotificationCenterState) {
  const dismissed = new Set(state.dismissedIds);
  const seen = new Set<string>();
  return notifications
    .filter(notification => {
      if (dismissed.has(notification.id) || seen.has(notification.id)) return false;
      seen.add(notification.id);
      return true;
    })
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp));
}

export function unreadNotificationCount(notifications: InAppNotification[], state: NotificationCenterState) {
  const read = new Set(state.readIds);
  return visibleNotifications(notifications, state).filter(notification => !read.has(notification.id)).length;
}

export function markNotificationRead(state: NotificationCenterState, id: string): NotificationCenterState {
  const normalized = normalizeNotificationState(state);
  return { ...normalized, readIds: [...new Set([...normalized.readIds, id])] };
}

export function dismissNotification(state: NotificationCenterState, id: string): NotificationCenterState {
  const normalized = normalizeNotificationState(state);
  return { ...normalized, dismissedIds: [...new Set([...normalized.dismissedIds, id])] };
}

export function markAllNotificationsRead(state: NotificationCenterState, notifications: InAppNotification[]) {
  const normalized = normalizeNotificationState(state);
  return { ...normalized, readIds: [...new Set([...normalized.readIds, ...visibleNotifications(notifications, normalized).map(item => item.id)])] };
}
