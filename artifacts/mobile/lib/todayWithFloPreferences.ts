import type { FloDailyHistory } from "./todayWithFlo";
export type TodayWithFloSaved = {
  enabled?: boolean;
  history?: Record<string, FloDailyHistory>;
};
type State = {
  enabled: boolean;
  ready: boolean;
  saving: boolean;
  error: string | null;
  history: Record<string, FloDailyHistory>;
};
export function createTodayWithFloStore(
  read: () => Promise<TodayWithFloSaved>,
  write: (value: TodayWithFloSaved) => Promise<unknown>,
) {
  let state: State = {
    enabled: true,
    ready: false,
    saving: false,
    error: null,
    history: {},
  };
  let disposed = false;
  let writeRevision = 0;
  let hydration: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  const attempts = new Set<string>();
  const publish = (patch: Partial<State>) => {
    if (!disposed) {
      state = { ...state, ...patch };
      listeners.forEach((fn) => fn());
    }
  };
  const hydrate = (refresh = false) => {
    if ((state.ready && !refresh) || disposed || state.saving)
      return Promise.resolve();
    if (hydration) return hydration;
    const readRevision = writeRevision;
    hydration = (async () => {
      try {
        const saved = await read();
        if (readRevision !== writeRevision || disposed) return;
        if (
          !saved ||
          typeof saved !== "object" ||
          Array.isArray(saved) ||
          (saved.enabled !== undefined && typeof saved.enabled !== "boolean") ||
          (saved.history !== undefined &&
            (!saved.history ||
              typeof saved.history !== "object" ||
              Array.isArray(saved.history)))
        )
          throw new Error("Invalid daily preferences");
        const history: State["history"] = {};
        if (saved.history && typeof saved.history === "object")
          for (const [key, value] of Object.entries(saved.history)) {
            if (
              !Array.isArray(value) ||
              value.some(
                (h) =>
                  !h ||
                  typeof h.day !== "string" ||
                  !/^\d{4}-\d{2}-\d{2}$/.test(h.day) ||
                  typeof h.topic !== "string",
              )
            )
              throw new Error("Invalid daily history");
            history[key] = value
              .slice(0, 14)
              .map((h) => ({ day: h.day, topic: h.topic }));
          }
        publish({
          enabled: saved.enabled !== false,
          history,
          ready: true,
          error: null,
        });
      } catch {
        if (readRevision !== writeRevision || disposed) return;
        publish({
          ready: false,
          error:
            "Today with Flo preferences could not be loaded. Retry to enable daily takeaways.",
        });
      } finally {
        hydration = null;
      }
    })();
    return hydration;
  };
  const save = async (patch: Partial<State>) => {
    if (!state.ready || state.saving || disposed) return false;
    writeRevision += 1;
    publish({ saving: true, error: null });
    try {
      await write({ enabled: patch.enabled, history: patch.history });
      publish({ ...patch, saving: false });
      return !disposed;
    } catch {
      publish({
        saving: false,
        error: "Your change could not be saved on this device. Please retry.",
      });
      return false;
    }
  };
  return {
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    getSnapshot: () => state,
    hydrate,
    setEnabled: (enabled: boolean) => save({ enabled }),
    canPresent: (_budget: string, day: string) =>
      !disposed &&
      state.ready &&
      state.enabled &&
      !state.saving &&
      !state.error &&
      !attempts.has(day) &&
      !Object.values(state.history).some((rows) =>
        rows.some((h) => h.day === day),
      ),
    /** Durable claim immediately before presentation, never during selection/scheduling. */
    claimPresentation: (budget: string, day: string, topic: string) => {
      if (
        disposed ||
        !state.ready ||
        !state.enabled ||
        state.saving ||
        state.error
      )
        return Promise.resolve(false);
      if (
        attempts.has(day) ||
        Object.values(state.history).some((rows) =>
          rows.some((h) => h.day === day),
        )
      )
        return Promise.resolve(false);
      attempts.add(day);
      return save({
        history: {
          ...state.history,
          [budget]: [
            { day, topic },
            ...(state.history[budget] ?? []).filter((h) => h.day !== day),
          ].slice(0, 14),
        },
      });
    },
    dispose: () => {
      disposed = true;
      listeners.clear();
    },
  };
}
type Store = ReturnType<typeof createTodayWithFloStore>;
const stores = new Map<string, Store>();
export function scopedTodayWithFloStore(
  user: string,
  household: string,
  read: () => Promise<TodayWithFloSaved>,
  write: (value: TodayWithFloSaved) => Promise<unknown>,
) {
  const key = JSON.stringify([user, household]);
  let store = stores.get(key);
  if (!store) {
    store = createTodayWithFloStore(read, write);
    stores.set(key, store);
  }
  return store;
}
export function clearTodayWithFloStoresForUser(user: string) {
  for (const [key, store] of stores)
    if (JSON.parse(key)[0] === user) {
      store.dispose();
      stores.delete(key);
    }
}
