import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useAuth } from "@/context/AuthContext";
import { useBudget } from "@/context/BudgetContext";
import {
  createFloLauncherPreferenceStore,
  scopedFloLauncherPreferenceStore,
} from "@/lib/floLauncherVisibility";
import {
  readInterfacePreferences,
  updateInterfacePreferences,
} from "@/lib/interfacePreferences";

const unavailable = createFloLauncherPreferenceStore(
  async () => ({}),
  async () => {},
);

export function useFloLauncherPreference() {
  const { user } = useAuth();
  const { activeHousehold } = useBudget();
  const userId = user?.id;
  const householdId = activeHousehold?.householdId;
  const store = useMemo(() => {
    if (!userId || !householdId) return unavailable;
    return scopedFloLauncherPreferenceStore(
      userId,
      householdId,
      () => readInterfacePreferences(userId, householdId, true),
      (enabled) =>
        updateInterfacePreferences(
          userId,
          householdId,
          {
            floLauncherEnabled: enabled,
          },
          true,
        ),
    );
  }, [userId, householdId]);
  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    unavailable.getSnapshot,
  );
  useEffect(() => {
    if (userId && householdId) void store.hydrate();
  }, [store, userId, householdId]);
  return {
    ...state,
    scope: store,
    setEnabled: store.setEnabled,
    retry: store.hydrate,
  };
}
