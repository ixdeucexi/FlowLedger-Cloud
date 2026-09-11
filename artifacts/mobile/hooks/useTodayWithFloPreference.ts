import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useAuth } from "@/context/AuthContext";
import { useBudget } from "@/context/BudgetContext";
import {
  createTodayWithFloStore,
  scopedTodayWithFloStore,
} from "@/lib/todayWithFloPreferences";
import {
  readInterfacePreferences,
  updateInterfacePreferences,
} from "@/lib/interfacePreferences";
const unavailable = createTodayWithFloStore(
  async () => ({}),
  async () => {},
);
export function useTodayWithFloPreference() {
  const { user } = useAuth();
  const { activeHousehold } = useBudget();
  const userId = user?.id;
  const householdId = activeHousehold?.householdId;
  const store = useMemo(
    () =>
      !userId || !householdId
        ? unavailable
        : scopedTodayWithFloStore(
            userId,
            householdId,
            async () => {
              const saved = (
                await readInterfacePreferences(userId, householdId, true)
              ).todayWithFlo;
              return saved === undefined ? {} : saved;
            },
            (value) =>
              updateInterfacePreferences(
                userId,
                householdId,
                (current) => ({
                  ...current,
                  todayWithFlo: {
                    ...current.todayWithFlo,
                    ...(value.enabled !== undefined
                      ? { enabled: value.enabled }
                      : {}),
                    ...(value.history
                      ? {
                          history: {
                            ...current.todayWithFlo?.history,
                            ...value.history,
                          },
                        }
                      : {}),
                  },
                }),
                true,
              ),
          ),
    [userId, householdId],
  );
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
    store,
    userId,
    householdId,
    budgetId: activeHousehold?.budgetId ?? null,
  };
}
