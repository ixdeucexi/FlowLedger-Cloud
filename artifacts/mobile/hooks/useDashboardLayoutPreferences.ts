import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/context/AuthContext";
import { useBudget } from "@/context/BudgetContext";
import {
  DEFAULT_DASHBOARD_LAYOUT,
  normalizeDashboardLayout,
  type DashboardLayoutPreference,
} from "@/lib/dashboardCustomization";
import { readInterfacePreferences, updateInterfacePreferences } from "@/lib/interfacePreferences";
import { supabase } from "@/lib/supabase";

export function useDashboardLayoutPreferences() {
  const { user, demoMode } = useAuth();
  const { activeHousehold } = useBudget();
  const userId = user?.id ?? null;
  const householdId = activeHousehold?.householdId ?? null;
  const [layout, setLayout] = useState<DashboardLayoutPreference>(DEFAULT_DASHBOARD_LAYOUT);
  const [loading, setLoading] = useState(true);
  const layoutRef = useRef<DashboardLayoutPreference>(DEFAULT_DASHBOARD_LAYOUT);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLayout(DEFAULT_DASHBOARD_LAYOUT);
    layoutRef.current = DEFAULT_DASHBOARD_LAYOUT;

    if (!userId || !householdId) {
      setLoading(false);
      return () => { cancelled = true; };
    }

    void (async () => {
      const [local, remoteResult] = await Promise.all([
        readInterfacePreferences(userId, householdId),
        demoMode
          ? Promise.resolve(null)
          : supabase
            .from("user_preferences")
            .select("dashboard_layouts")
            .eq("user_id", userId)
            .maybeSingle(),
      ]);
      let next = normalizeDashboardLayout(local.dashboard);

      if (remoteResult && !remoteResult.error) {
          const layouts = remoteResult.data?.dashboard_layouts;
          if (layouts && typeof layouts === "object" && !Array.isArray(layouts)) {
            const remote = (layouts as Record<string, unknown>)[householdId];
            if (remote) next = normalizeDashboardLayout(remote);
          }
      }

      if (cancelled) return;
      layoutRef.current = next;
      setLayout(next);
      setLoading(false);
      void updateInterfacePreferences(userId, householdId, { dashboard: next });
    })();

    return () => { cancelled = true; };
  }, [demoMode, householdId, userId]);

  const updateLayout = useCallback((nextValue: DashboardLayoutPreference | ((current: DashboardLayoutPreference) => DashboardLayoutPreference)) => {
    const next = normalizeDashboardLayout(
      typeof nextValue === "function" ? nextValue(layoutRef.current) : nextValue,
    );
    layoutRef.current = next;
    setLayout(next);
    if (userId && householdId) {
      void updateInterfacePreferences(userId, householdId, { dashboard: next });
      if (!demoMode) {
        saveQueue.current = saveQueue.current.catch(() => undefined).then(async () => {
          const { error } = await supabase.rpc("save_dashboard_layout", {
            p_household_id: householdId,
            p_layout: next,
          });
          if (error) throw error;
        }).catch(() => undefined);
      }
    }
  }, [demoMode, householdId, userId]);

  const resetLayout = useCallback(() => updateLayout(DEFAULT_DASHBOARD_LAYOUT), [updateLayout]);

  return { layout, loading, updateLayout, resetLayout };
}
