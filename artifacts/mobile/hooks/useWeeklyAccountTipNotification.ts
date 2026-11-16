import { useEffect, useMemo, useState } from "react";
import { AppState, Platform } from "react-native";

import { getWeeklyAccountTip } from "@/lib/accountTips";
import { buildAccountTipNotification, createAccountTipPreferenceLoader, type AccountTipPreferenceState } from "@/lib/accountTipNotifications";
import { subscribeNotificationPreferencesChanged } from "@/lib/notificationPreferences";
import { getNotificationPreferences } from "@/lib/pushNotifications";

type AccountTipScope = {
  userId: string | null;
  householdId: string | null;
  accessToken: string | null;
  ready: boolean;
  demoMode: boolean;
};

export function useWeeklyAccountTipNotification(scope: AccountTipScope) {
  const { userId, householdId, accessToken, ready, demoMode } = scope;
  const [tip, setTip] = useState(() => getWeeklyAccountTip());
  const [preference, setPreference] = useState<AccountTipPreferenceState>(null);

  // Rotate at the UTC date boundary, including when a suspended PWA resumes.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      clearTimeout(timer);
      const now = new Date();
      setTip(getWeeklyAccountTip(now));
      const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
      timer = setTimeout(refresh, Math.max(1, midnight - now.getTime()) + 50);
    };
    refresh();
    const subscription = AppState.addEventListener("change", state => {
      if (state === "active") refresh();
    });
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    if (Platform.OS === "web" && typeof window !== "undefined") {
      window.addEventListener("focus", refresh);
      document.addEventListener("visibilitychange", onVisible);
    }
    return () => {
      clearTimeout(timer);
      subscription.remove();
      if (Platform.OS === "web" && typeof window !== "undefined") {
        window.removeEventListener("focus", refresh);
        document.removeEventListener("visibilitychange", onVisible);
      }
    };
  }, []);

  useEffect(() => {
    setPreference(null);
    // Sample mode has no account preference to consult and makes no requests.
    if (demoMode || !userId || !householdId || !accessToken || !ready) return;
    const loader = createAccountTipPreferenceLoader(userId, householdId, setPreference);
    const refresh = () => loader.refresh(() => getNotificationPreferences(accessToken));
    const unsubscribe = subscribeNotificationPreferencesChanged(loader.saved);
    void refresh();
    const subscription = AppState.addEventListener("change", state => {
      if (state === "active") void refresh();
    });
    const onFocus = () => { void refresh(); };
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    if (Platform.OS === "web" && typeof window !== "undefined") {
      window.addEventListener("focus", onFocus);
      document.addEventListener("visibilitychange", onVisible);
    }
    return () => {
      loader.stop();
      unsubscribe();
      subscription.remove();
      if (Platform.OS === "web" && typeof window !== "undefined") {
        window.removeEventListener("focus", onFocus);
        document.removeEventListener("visibilitychange", onVisible);
      }
    };
  }, [accessToken, demoMode, householdId, ready, userId]);

  return useMemo(() => buildAccountTipNotification(tip, {
    userId, householdId, ready, demoMode, preference,
  }), [demoMode, householdId, preference, ready, tip, userId]);
}
