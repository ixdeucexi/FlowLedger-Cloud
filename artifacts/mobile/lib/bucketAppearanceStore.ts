import {
  EMPTY_BUCKET_APPEARANCE,
  parseBucketAppearance,
  withBucketLook,
  type BucketAppearanceData,
  type BucketLook,
} from "./bucketAppearance";

export type BucketAppearanceSnapshot = {
  data: BucketAppearanceData;
  ready: boolean;
  saving: boolean;
  loadError: string | null;
  saveError: string | null;
};
export interface BucketAppearanceStorage {
  read(): Promise<string | null>;
  write(raw: string): Promise<void>;
}
/** One store per exact scope. Queues persist snapshots before publishing them. */
export class BucketAppearanceStore {
  private state: BucketAppearanceSnapshot = {
    data: EMPTY_BUCKET_APPEARANCE,
    ready: false,
    saving: false,
    loadError: null,
    saveError: null,
  };
  private listeners = new Set<() => void>();
  private queue: Promise<unknown> = Promise.resolve();
  private loading: Promise<void> | null = null;
  private disposed = false;
  private pending = 0;
  constructor(private storage: BucketAppearanceStorage) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private publish(patch: Partial<BucketAppearanceSnapshot>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((f) => f());
  }
  async load(retry = false): Promise<void> {
    if (this.disposed || (this.state.ready && !retry)) return;
    if (this.loading) return this.loading;
    this.publish({ loadError: null, ready: false });
    this.loading = Promise.resolve().then(async () => {
      try {
        const raw = await this.storage.read();
        if (!this.disposed)
          this.publish({ data: parseBucketAppearance(raw), ready: true });
      } catch {
        this.publish({
          ready: true,
          loadError:
            "Couldn’t load your bucket look. Try again before changing it.",
        });
      } finally {
        this.loading = null;
      }
    });
    return this.loading;
  }
  async change<T>(
    operation: (
      data: BucketAppearanceData,
    ) => Promise<{ data: BucketAppearanceData; value: T }>,
    current: () => boolean = () => true,
  ): Promise<T> {
    if (!this.state.ready || this.state.loadError)
      throw new Error("Load your saved bucket look before changing it.");
    this.pending++;
    this.publish({ saving: true, saveError: null });
    const task = this.queue
      .catch(() => undefined)
      .then(async () => {
        if (this.disposed || !current())
          throw new Error("Your household changed. Open the bucket again.");
        const result = await operation(this.state.data);
        if (this.disposed || !current())
          throw new Error("Your household changed. Open the bucket again.");
        await this.storage.write(JSON.stringify(result.data));
        this.publish({ data: result.data, saveError: null });
        return result.value;
      });
    this.queue = task;
    try {
      return await task;
    } catch (e) {
      if (!this.disposed && current())
        this.publish({
          saveError:
            e instanceof Error
              ? e.message
              : "Couldn’t save your bucket look. Please try again.",
        });
      throw e;
    } finally {
      this.pending--;
      this.publish({ saving: this.pending > 0 });
    }
  }
  update(goalId: string, patch: Partial<BucketLook>, current?: () => boolean) {
    return this.change(
      async (data) => ({
        data: withBucketLook(data, goalId, patch),
        value: undefined,
      }),
      current,
    );
  }
  markSeen(keys: string[], current?: () => boolean) {
    return this.change(
      async (data) => ({
        data: {
          ...data,
          seen: [...new Set([...data.seen, ...keys])].slice(-500),
        },
        value: undefined,
      }),
      current,
    );
  }
  /** Invalidate first; wait for in-flight storage writes before account cleanup. */
  async dispose() {
    this.disposed = true;
    this.state = {
      data: EMPTY_BUCKET_APPEARANCE,
      ready: false,
      saving: false,
      loadError: null,
      saveError: null,
    };
    this.listeners.forEach((f) => f());
    await this.queue.catch(() => undefined);
  }
}
