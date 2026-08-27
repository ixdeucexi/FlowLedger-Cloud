interface CallbackCompletion {
  promise: Promise<unknown>;
  settled: boolean;
}

const MAX_REPLAY_ENTRIES = 8;
const REPLAY_WINDOW_MS = 2_000;
const callbackCompletions = new Map<string, CallbackCompletion>();

function trimSettledReplayEntries() {
  if (callbackCompletions.size <= MAX_REPLAY_ENTRIES) return;
  for (const [key, entry] of callbackCompletions) {
    if (!entry.settled) continue;
    callbackCompletions.delete(key);
    if (callbackCompletions.size <= MAX_REPLAY_ENTRIES) return;
  }
}

/**
 * Native auth callbacks can be delivered both to the interactive browser
 * result and the global deep-link listener. Coalesce those deliveries so one
 * provider response performs one Supabase session operation.
 */
export function coalesceAuthCompletion<T>(
  callbackKey: string,
  complete: () => Promise<T>,
): Promise<T> {
  const existing = callbackCompletions.get(callbackKey);
  if (existing) return existing.promise as Promise<T>;

  let pending: Promise<T>;
  try {
    pending = complete();
  } catch (error) {
    pending = Promise.reject(error);
  }
  const entry: CallbackCompletion = { promise: pending, settled: false };
  callbackCompletions.set(callbackKey, entry);
  void pending.then(
    () => {
      entry.settled = true;
      trimSettledReplayEntries();
      const expiry = setTimeout(() => {
        if (callbackCompletions.get(callbackKey) === entry) {
          callbackCompletions.delete(callbackKey);
        }
      }, REPLAY_WINDOW_MS);
      (expiry as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();
    },
    () => {
      if (callbackCompletions.get(callbackKey) === entry) {
        callbackCompletions.delete(callbackKey);
      }
    },
  );
  return pending;
}
