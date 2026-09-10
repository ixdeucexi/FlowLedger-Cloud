export type FloLauncherPreferenceState = {
  enabled: boolean;
  ready: boolean;
  saving: boolean;
  error: string | null;
};

const stores = new Map<
  string,
  ReturnType<typeof createFloLauncherPreferenceStore>
>();
export function scopedFloLauncherPreferenceStore(
  userId: string,
  householdId: string,
  read: () => Promise<{ floLauncherEnabled?: unknown }>,
  write: (enabled: boolean) => Promise<void>,
) {
  const key = JSON.stringify([userId, householdId]);
  let store = stores.get(key);
  if (!store) {
    store = createFloLauncherPreferenceStore(read, write);
    stores.set(key, store);
  }
  return store;
}

export function clearFloLauncherPreferenceStoresForUser(userId: string) {
  for (const key of stores.keys()) {
    if (JSON.parse(key)[0] === userId) stores.delete(key);
  }
}

export function createFloLauncherPreferenceStore(
  read: () => Promise<{ floLauncherEnabled?: unknown }>,
  write: (enabled: boolean) => Promise<void>,
) {
  let state: FloLauncherPreferenceState = {
    enabled: true,
    ready: false,
    saving: false,
    error: null,
  };
  let hydration: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<FloLauncherPreferenceState>) => {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  };
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    hydrate() {
      if (state.ready) return Promise.resolve();
      if (hydration) return hydration;
      publish({ error: null });
      hydration = read()
        .then((preferences) => {
          publish({
            enabled: preferences.floLauncherEnabled !== false,
            ready: true,
          });
        })
        .catch(() => {
          publish({
            error: "Couldn't load the Flo shortcut setting. Try again.",
          });
        })
        .finally(() => {
          hydration = null;
        });
      return hydration;
    },
    async setEnabled(enabled: boolean) {
      if (!state.ready || state.saving) return false;
      publish({ saving: true, error: null });
      try {
        await write(enabled);
        publish({ enabled, saving: false });
        return true;
      } catch {
        publish({
          saving: false,
          error:
            "Couldn't save the Flo shortcut setting. Your previous setting is unchanged.",
        });
        return false;
      }
    },
  };
}
