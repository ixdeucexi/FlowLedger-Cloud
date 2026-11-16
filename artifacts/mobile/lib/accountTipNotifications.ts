import type { InAppNotification } from "./notificationCenter";
import { notificationRoute } from "./nativeNotificationRoute";
import type { NotificationPreferencesChanged } from "./notificationPreferences";

export type WeeklyAccountTip = {
  id: string;
  title: string;
  body: string;
  route: string;
  timestamp: string;
};

export type AccountTipPreferenceState = {
  userId: string;
  householdId: string;
  enabled: boolean;
} | null;

export function accountTipDestination(route: string) {
  const destination = notificationRoute(route);
  if (!destination) return null;
  const [pathname, query] = destination.split("?");
  return {
    route: pathname === "/(tabs)" ? pathname : `/(tabs)${pathname}`,
    ...(query ? { params: Object.fromEntries(new URLSearchParams(query)) } : {}),
  };
}

/** Fail closed until preferences and the budget belong to the active account. */
export function buildAccountTipNotification(tip: WeeklyAccountTip | null, scope: {
  userId: string | null;
  householdId: string | null;
  ready: boolean;
  demoMode: boolean;
  preference: AccountTipPreferenceState;
}): InAppNotification | null {
  const { userId, householdId, ready, demoMode, preference } = scope;
  if (!tip || demoMode || !ready || !userId || !householdId
    || preference?.userId !== userId || preference.householdId !== householdId
    || preference.enabled !== true) return null;
  const destination = accountTipDestination(tip.route);
  if (!destination) return null;
  return { ...tip, ...destination, type: "tip", tone: "info" };
}

/** Saved opt-outs outrank older requests; disposed scopes can never publish. */
export function createAccountTipPreferenceLoader(userId: string, householdId: string, publish: (preference: AccountTipPreferenceState) => void) {
  let stopped = false;
  let revision = 0;
  return {
    async refresh(load: () => Promise<{ preferences: { account_tips: boolean } }>) {
      if (stopped) return;
      const requestRevision = ++revision;
      publish(null);
      try {
        const result = await load();
        if (!stopped && revision === requestRevision) {
          publish({ userId, householdId, enabled: result.preferences.account_tips === true });
        }
      } catch {
        if (!stopped && revision === requestRevision) publish(null);
      }
    },
    saved(change: NotificationPreferencesChanged) {
      if (stopped || change.userId !== userId) return;
      revision += 1;
      publish({ userId, householdId, enabled: change.preferences.account_tips === true });
    },
    stop() {
      stopped = true;
      revision += 1;
    },
  };
}
