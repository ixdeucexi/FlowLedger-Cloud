export const HOUSEHOLD_NAME_MAX_LENGTH = 80;

// Match the explicit Unicode whitespace list in the rename_household RPC.
const NAME_WHITESPACE =
  /[ \t\n\r\f\v\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+/gu;

export function normalizeHouseholdName(value: string): string {
  const name = value.replace(NAME_WHITESPACE, " ").trim();
  if (!name) throw new Error("Enter a household name.");
  if (Array.from(name).length > HOUSEHOLD_NAME_MAX_LENGTH) {
    throw new Error("Use 80 characters or fewer.");
  }
  if (/[\u0000-\u001f\u007f-\u009f]/u.test(name)) {
    throw new Error("Use letters, numbers, or symbols in the household name.");
  }
  return name;
}

export interface HouseholdNameIntent {
  userId: string;
  householdId: string;
  name: string;
  version: number;
}

/** Protect only names from reads that started before a verified rename. */
export function mergeHouseholdNameRead<
  T extends { householdId: string; name: string },
>(
  rows: readonly T[],
  userId: string,
  readVersion: number,
  intents: readonly HouseholdNameIntent[],
): T[] {
  const latest = new Map(
    intents
      .filter((row) => row.userId === userId && row.version > readVersion)
      .map((row) => [row.householdId, row.name]),
  );
  return rows.map((row) =>
    latest.has(row.householdId)
      ? { ...row, name: latest.get(row.householdId)! }
      : row,
  );
}

/** Remember newer authoritative names so even older reads cannot undo them. */
export function acknowledgeHouseholdNameRead(
  rows: readonly { householdId: string; name: string }[],
  userId: string,
  readVersion: number,
  intents: readonly HouseholdNameIntent[],
): HouseholdNameIntent[] {
  const byKey = new Map(
    intents.map((row) => [`${row.userId}:${row.householdId}`, row]),
  );
  for (const row of rows) {
    const key = `${userId}:${row.householdId}`;
    if ((byKey.get(key)?.version ?? -1) > readVersion) continue;
    byKey.set(key, {
      userId,
      householdId: row.householdId,
      name: row.name,
      version: readVersion,
    });
  }
  return [...byKey.values()];
}
