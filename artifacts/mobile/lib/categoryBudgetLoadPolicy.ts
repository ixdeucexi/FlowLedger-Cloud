export async function resolveGuardedRemoteValue<T>(input: {
  revisionAtStart: number;
  currentRevision: () => number;
  readCurrent: () => T;
  loadRemote: () => Promise<T>;
  commitRemote: (value: T) => void;
}): Promise<T> {
  const remote = await input.loadRemote();
  if (input.currentRevision() !== input.revisionAtStart) {
    return input.readCurrent();
  }
  input.commitRemote(remote);
  return remote;
}

/** A cache marker is exact only when the whole persisted payload is valid. */
export function parseCategoryBudgetCache(
  raw: string | null | undefined,
): Record<string, number> | null {
  if (raw === null || raw === undefined) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      !parsed
      || typeof parsed !== "object"
      || Array.isArray(parsed)
      || Object.getPrototypeOf(parsed) !== Object.prototype
    ) return null;
    const next: Record<string, number> = {};
    for (const [category, amount] of Object.entries(parsed)) {
      const cleanCategory = category.trim();
      if (
        !cleanCategory
        || typeof amount !== "number"
        || !Number.isFinite(amount)
        || amount < 0
      ) return null;
      next[cleanCategory] = Math.round(amount * 100) / 100;
    }
    return next;
  } catch {
    return null;
  }
}

export function createExactCategoryBudgetMemoryCache() {
  const values = new Map<string, Record<string, number>>();
  return {
    has(key: string): boolean {
      return values.has(key);
    },
    read(key: string): Record<string, number> | null {
      const value = values.get(key);
      return value ? { ...value } : null;
    },
    write(key: string, value: Record<string, number>): void {
      values.set(key, { ...value });
    },
  };
}
