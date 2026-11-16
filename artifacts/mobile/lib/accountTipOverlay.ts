import { getAccountTipForWeek, type WeeklyAccountTip } from "./accountTips";
import { accountTipDestination } from "./accountTipNotifications";
import type { InAppNotification } from "./notificationCenter";

export type AccountTipOverlayScope = {
  userId: string | null;
  householdId: string | null;
  ready: boolean;
  demoMode: boolean;
};

export type AccountTipOverlaySelection = {
  userId: string;
  householdId: string;
  tip: WeeklyAccountTip;
};

/** Only public catalog content can reach the overlay, never URL/push copy. */
export function selectAccountTipOverlay(week: unknown, scope: AccountTipOverlayScope, now?: Date | string): AccountTipOverlaySelection | null {
  if (!scope.ready || scope.demoMode || !scope.userId || !scope.householdId) return null;
  const tip = getAccountTipForWeek(week, now);
  return tip ? { userId: scope.userId, householdId: scope.householdId, tip } : null;
}

export function visibleAccountTipOverlay(selection: AccountTipOverlaySelection | null, scope: AccountTipOverlayScope) {
  if (!selection || !scope.ready || scope.demoMode
    || selection.userId !== scope.userId || selection.householdId !== scope.householdId) return null;
  return selection;
}

export function accountTipOverlayDestination(selection: AccountTipOverlaySelection | null, scope: AccountTipOverlayScope) {
  const current = visibleAccountTipOverlay(selection, scope);
  return current ? accountTipDestination(current.tip.route) : null;
}

export function accountTipNotificationAction(notification: InAppNotification, scope: AccountTipOverlayScope, now?: Date | string) {
  if (notification.type !== "tip") return { kind: "navigate" as const, notification };
  const selection = notification.id.startsWith("tip:")
    ? selectAccountTipOverlay(notification.id.slice(4), scope, now)
    : null;
  return selection ? { kind: "overlay" as const, selection } : { kind: "ignore" as const };
}

export function accountTipMarkerAction(marker: unknown, consumedKey: string | null, scope: AccountTipOverlayScope, now?: Date | string) {
  if (marker === undefined) return { kind: "reset" as const };
  if (!scope.ready || !scope.userId || !scope.householdId) return { kind: "wait" as const };
  const key = JSON.stringify(marker);
  if (key === consumedKey) return { kind: "wait" as const };
  return { kind: "consume" as const, key, selection: selectAccountTipOverlay(marker, scope, now) };
}
