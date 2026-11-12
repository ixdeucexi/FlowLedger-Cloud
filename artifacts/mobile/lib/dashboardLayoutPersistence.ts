import {
  DEFAULT_DASHBOARD_LAYOUT,
  normalizeDashboardLayout,
  type DashboardLayoutPreference,
} from "./dashboardCustomization";

export class DashboardPersistenceCancelled extends Error {}

/** Bind a queued save to both its live view scope and its authenticated SDK session. */
export async function dispatchDashboardLayoutSave(dependencies: {
  userId: string;
  canWrite: () => boolean;
  getSession: () => Promise<{
    data: { session: { user: { id: string }; access_token: string } | null };
    error: unknown;
  }>;
  write: (accessToken: string) => Promise<void>;
}) {
  if (!dependencies.canWrite()) throw new DashboardPersistenceCancelled();
  const { data, error } = await dependencies.getSession();
  if (!dependencies.canWrite()) throw new DashboardPersistenceCancelled();
  if (error) throw error;
  const session = data.session;
  if (session?.user.id !== dependencies.userId || !session.access_token)
    throw new DashboardPersistenceCancelled();
  // Use this exact session for the request; the SDK's shared auth state can
  // change again before its own asynchronous fetch authorization resolves.
  await dependencies.write(session.access_token);
}
export type DashboardLayoutState = {
  layout: DashboardLayoutPreference;
  loading: boolean;
  /** A scoped saved layout, or confirmed absence, has been read. */
  ready: boolean;
  saving: boolean;
  loadError: string | null;
  saveError: string | null;
};
export function initialDashboardLayoutState(
  loading = true,
): DashboardLayoutState {
  return {
    layout: normalizeDashboardLayout(DEFAULT_DASHBOARD_LAYOUT),
    loading,
    ready: false,
    saving: false,
    loadError: null,
    saveError: null,
  };
}
type Dependencies = {
  isCurrent: () => boolean;
  remoteEnabled: boolean;
  readLocal: () => Promise<{ layout?: unknown; pendingSync?: boolean }>;
  readRemote: () => Promise<unknown>;
  writeLocal: (
    layout: DashboardLayoutPreference,
    pendingSync: boolean,
    canWrite: () => boolean,
  ) => Promise<void>;
  writeRemote: (
    layout: DashboardLayoutPreference,
    canWrite: () => boolean,
  ) => Promise<void>;
  onChange: (state: DashboardLayoutState) => void;
};

/** Presentation-only persistence. Financial rows and household settings are never changed. */
export class DashboardLayoutController {
  private state = initialDashboardLayoutState();
  private active = true;
  private revision = 0;
  private loadGeneration = 0;
  private dirty = false;
  private remoteQueue: Promise<void> = Promise.resolve();
  constructor(private readonly dependencies: Dependencies) {}
  getSnapshot() {
    return this.state;
  }
  private current = () => this.active && this.dependencies.isCurrent();
  private sameRevision = (revision: number) =>
    this.current() && this.revision === revision;
  private publish(patch: Partial<DashboardLayoutState>) {
    if (!this.current()) return;
    this.state = { ...this.state, ...patch };
    this.dependencies.onChange(this.state);
  }
  dispose() {
    this.active = false;
    this.loadGeneration += 1;
  }

  async load() {
    if (!this.current()) return;
    const generation = ++this.loadGeneration;
    const revision = this.revision;
    const dirtyAtStart = this.dirty;
    this.publish({ loading: true, loadError: null });
    const isLayout = (value: unknown): value is Record<string, unknown> =>
      Boolean(value && typeof value === "object" && !Array.isArray(value));
    const localRead = Promise.resolve().then(() => this.dependencies.readLocal()).then(value => {
      if (value.layout != null && !isLayout(value.layout)) throw new Error("Invalid saved Dashboard layout");
      // A verified cache belongs to this exact actor/household. It may render
      // while the cloud read is pending; an absent cache cannot verify defaults.
      if (isLayout(value.layout) && this.sameRevision(revision)
        && generation === this.loadGeneration && !dirtyAtStart && !this.dirty) {
        this.publish({ layout: normalizeDashboardLayout(value.layout), ready: true });
      }
      return value;
    });
    const remoteRead = this.dependencies.remoteEnabled
      ? Promise.resolve().then(() => this.dependencies.readRemote()).then(value => {
          if (value != null && !isLayout(value)) throw new Error("Invalid account Dashboard layout");
          return value;
        })
      : Promise.resolve(undefined);
    const [local, remote] = await Promise.allSettled([localRead, remoteRead]);
    if (!this.current() || generation !== this.loadGeneration) return;
    const loadError =
      local.status === "rejected" || remote.status === "rejected"
        ? "Couldn’t load all saved Dashboard preferences. Retry loading."
        : null;
    // A retry or delayed hydration must never replace a newer on-screen edit.
    if (!this.sameRevision(revision) || dirtyAtStart || this.dirty) {
      this.publish({ loading: false, loadError });
      return;
    }
    const localValue = local.status === "fulfilled" ? local.value : undefined;
    const localLayout = isLayout(localValue?.layout) ? localValue.layout : undefined;
    const ready = Boolean(localLayout) || (this.dependencies.remoteEnabled
      ? remote.status === "fulfilled"
      : local.status === "fulfilled");
    if (!ready) {
      this.publish({ loading: false, ready: false, loadError });
      return;
    }
    const pending = this.dependencies.remoteEnabled
      && localValue?.pendingSync === true && Boolean(localLayout);
    const remoteValue =
      remote.status === "fulfilled" ? remote.value : undefined;
    const next = normalizeDashboardLayout(
      pending || remoteValue === undefined || remoteValue === null
        ? localValue?.layout
        : remoteValue,
    );
    this.publish({ layout: next, ready: true, loading: false, loadError });
    if (pending) {
      this.update(next);
      return;
    }
    // Do not overwrite a corrupt/unreadable local preference object with defaults.
    if (local.status === "fulfilled") {
      try {
        await this.dependencies.writeLocal(next, false, () =>
          this.sameRevision(revision),
        );
      } catch (error) {
        if (
          this.sameRevision(revision) &&
          !(error instanceof DashboardPersistenceCancelled)
        ) {
          this.publish({
            saveError:
              "Dashboard is loaded, but couldn’t be saved on this device. Try saving again.",
          });
        }
      }
    }
  }

  update(
    value:
      | DashboardLayoutPreference
      | ((current: DashboardLayoutPreference) => DashboardLayoutPreference),
  ) {
    if (!this.current()) return;
    const next = normalizeDashboardLayout(
      typeof value === "function" ? value(this.state.layout) : value,
    );
    const revision = ++this.revision;
    this.dirty = true;
    this.publish({ layout: next, ready: true, saving: true, saveError: null });
    // Start the local snapshot immediately. A slow remote save must not hold up
    // the newest local edit while this device is offline or the app is reloaded.
    const local = this.dependencies.writeLocal(
      next,
      this.dependencies.remoteEnabled,
      () => this.sameRevision(revision),
    );
    const run = async () => {
      try {
        await local;
      } catch (error) {
        if (
          this.sameRevision(revision) &&
          !(error instanceof DashboardPersistenceCancelled)
        ) {
          this.publish({
            saving: false,
            saveError:
              "Couldn’t save Dashboard on this device. Your changes are still shown. Try saving again.",
          });
        }
        return;
      }
      if (!this.sameRevision(revision)) return;
      if (!this.dependencies.remoteEnabled) {
        this.dirty = false;
        this.publish({ saving: false });
        return;
      }
      try {
        if (!this.sameRevision(revision)) return;
        await this.dependencies.writeRemote(next, () =>
          this.sameRevision(revision),
        );
      } catch {
        if (this.sameRevision(revision))
          this.publish({
            saving: false,
            saveError:
              "Saved on this device. Couldn’t sync Dashboard to your account. Try saving again.",
          });
        return;
      }
      if (!this.sameRevision(revision)) return;
      try {
        await this.dependencies.writeLocal(next, false, () =>
          this.sameRevision(revision),
        );
        if (this.sameRevision(revision)) {
          this.dirty = false;
          this.publish({ saving: false, saveError: null });
        }
      } catch (error) {
        if (
          this.sameRevision(revision) &&
          !(error instanceof DashboardPersistenceCancelled)
        )
          this.publish({
            saving: false,
            saveError:
              "Dashboard synced, but couldn’t finish saving on this device. Try saving again.",
          });
      }
    };
    // Observe rejection immediately, even when a previous network request is
    // still in flight and this save has not reached the remote queue yet.
    void local.catch((error) => {
      if (
        this.sameRevision(revision) &&
        !(error instanceof DashboardPersistenceCancelled)
      ) {
        this.publish({
          saving: false,
          saveError:
            "Couldn’t save Dashboard on this device. Your changes are still shown. Try saving again.",
        });
      }
    });
    this.remoteQueue = this.remoteQueue.catch(() => undefined).then(run);
  }
  retrySave() {
    if (!this.state.ready) return;
    this.update(this.state.layout);
  }
  retryLoad() {
    return this.load();
  }
  /** Exposed for deterministic persistence tests and graceful callers. */
  settled() {
    return this.remoteQueue;
  }
}
