import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useBudget } from "@/context/BudgetContext";
import {
  DEFAULT_DASHBOARD_LAYOUT,
  type DashboardLayoutPreference,
} from "@/lib/dashboardCustomization";
import {
  DashboardLayoutController,
  DashboardPersistenceCancelled,
  dispatchDashboardLayoutSave,
  initialDashboardLayoutState,
  type DashboardLayoutState,
} from "@/lib/dashboardLayoutPersistence";
import {
  readInterfacePreferences,
  updateInterfacePreferences,
} from "@/lib/interfacePreferences";
import { supabase } from "@/lib/supabase";

export function useDashboardLayoutPreferences() {
  const { user, demoMode } = useAuth();
  const { activeHousehold } = useBudget();
  const userId = user?.id ?? null;
  const householdId = activeHousehold?.householdId ?? null;
  const scope =
    userId && householdId
      ? JSON.stringify([userId, householdId, demoMode])
      : null;
  // A fresh epoch also distinguishes A → B → A from the earlier A instance.
  const scopeRef = useRef({ scope, generation: 0 });
  const generation = scopeRef.current.generation + Number(scopeRef.current.scope !== scope);
  scopeRef.current = { scope, generation };
  const controllerRef = useRef<DashboardLayoutController | null>(null);
  const [snapshot, setSnapshot] = useState<{
    scope: string | null;
    generation: number;
    value: DashboardLayoutState;
  }>({ scope: null, generation: -1, value: initialDashboardLayoutState() });

  useEffect(() => {
    if (!userId || !householdId || !scope) {
      controllerRef.current = null;
      setSnapshot({ scope, generation, value: initialDashboardLayoutState(false) });
      return;
    }
    const controller: DashboardLayoutController = new DashboardLayoutController({
      isCurrent: (): boolean =>
        scopeRef.current.scope === scope && scopeRef.current.generation === generation
        && controllerRef.current === controller,
      remoteEnabled: !demoMode,
      readLocal: async () => {
        const local = await readInterfacePreferences(userId, householdId, true);
        return {
          layout: local.dashboard,
          pendingSync: local.dashboardPendingSync,
        };
      },
      readRemote: async () => {
        const { data, error } = await supabase
          .from("user_preferences")
          .select("dashboard_layouts")
          .eq("user_id", userId)
          .maybeSingle();
        if (error) throw error;
        if (!data) return undefined;
        const layouts = data.dashboard_layouts;
        if (!layouts || typeof layouts !== "object" || Array.isArray(layouts))
          throw new Error("Invalid saved Dashboard preferences");
        return (layouts as Record<string, unknown>)[householdId];
      },
      writeLocal: (layout, pendingSync, canWrite) =>
        updateInterfacePreferences(
          userId,
          householdId,
          (current) => {
            if (!canWrite()) throw new DashboardPersistenceCancelled();
            return {
              ...current,
              dashboard: layout,
              dashboardPendingSync: pendingSync,
            };
          },
          true,
        ),
      writeRemote: (layout, canWrite) =>
        dispatchDashboardLayoutSave({
          userId,
          canWrite,
          getSession: () => supabase.auth.getSession(),
          write: async (accessToken) => {
            const { error } = await supabase
              .rpc("save_dashboard_layout", {
                p_household_id: householdId,
                p_layout: layout,
              })
              .setHeader("Authorization", `Bearer ${accessToken}`);
            if (error) throw error;
          },
        }),
      onChange: (value) => setSnapshot({ scope, generation, value }),
    });
    controllerRef.current = controller;
    setSnapshot({ scope, generation, value: controller.getSnapshot() });
    void controller.load();
    return () => {
      controller.dispose();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [demoMode, generation, householdId, scope, userId]);

  const updateLayout = useCallback(
    (
      value:
        | DashboardLayoutPreference
        | ((current: DashboardLayoutPreference) => DashboardLayoutPreference),
    ) => {
      if (scopeRef.current.scope !== scope || scopeRef.current.generation !== generation) return;
      const controller = controllerRef.current;
      if (controller?.getSnapshot().ready && !controller.getSnapshot().loading) controller.update(value);
    },
    [generation, scope],
  );
  const resetLayout = useCallback(
    () => updateLayout(DEFAULT_DASHBOARD_LAYOUT),
    [updateLayout],
  );
  const retrySave = useCallback(() => {
    if (scopeRef.current.scope === scope && scopeRef.current.generation === generation) controllerRef.current?.retrySave();
  }, [generation, scope]);
  const retryLoad = useCallback(() => {
    if (scopeRef.current.scope === scope && scopeRef.current.generation === generation) void controllerRef.current?.retryLoad();
  }, [generation, scope]);
  const current =
    snapshot.scope === scope && snapshot.generation === generation
      ? snapshot.value
      : initialDashboardLayoutState(Boolean(scope));
  return { ...current, updateLayout, resetLayout, retrySave, retryLoad };
}
