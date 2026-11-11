import { resolveForecastAccountReference } from "./accountForecasts";
import type { Account, ConnectedBankAccount } from "./financialProjectionTypes";
export interface AccountNameIntent {
  scope: string;
  version: number;
  kind: "manual" | "bank";
  id: string;
  name: string | null;
}
export function normalizeAccountDisplayName(
  value: string | null,
): string | null {
  if (value === null) return null;
  const name = value.trim().replace(/\s+/g, " ");
  if (!name) throw new Error("Enter an account name.");
  if (name.length > 80)
    throw new Error("Keep the account name to 80 characters or fewer.");
  return name;
}
/** A saved name may overlay an older in-flight read, never its balance/date. */
export function mergeAccountNameRead<T extends Account | ConnectedBankAccount>(
  rows: readonly T[],
  kind: "manual" | "bank",
  scope: string,
  readVersion: number,
  intents: readonly AccountNameIntent[],
): T[] {
  const latest = new Map(
    intents
      .filter(
        (row) =>
          row.kind === kind && row.scope === scope && row.version > readVersion,
      )
      .map((row) => [row.id, row]),
  );
  return rows.map((row) => {
    const intent = latest.get(row.id);
    return !intent
      ? row
      : kind === "bank"
        ? { ...row, display_name: intent.name ?? undefined }
        : { ...row, name: intent.name! };
  });
}

/** Keep the latest accepted server name as the guard for older in-flight reads. */
export function acknowledgeAccountNameRead<
  T extends Account | ConnectedBankAccount,
>(
  rows: readonly T[],
  kind: "manual" | "bank",
  scope: string,
  readVersion: number,
  intents: readonly AccountNameIntent[],
): AccountNameIntent[] {
  const byKey = new Map(
    intents.map((intent) => [
      `${intent.scope}:${intent.kind}:${intent.id}`,
      intent,
    ]),
  );
  for (const row of rows) {
    const key = `${scope}:${kind}:${row.id}`,
      previous = byKey.get(key);
    if (previous && previous.version > readVersion) continue;
    byKey.set(key, {
      scope,
      kind,
      id: row.id,
      version: readVersion,
      name:
        kind === "bank"
          ? ((row as ConnectedBankAccount).display_name ?? null)
          : row.name,
    });
  }
  return [...byKey.values()];
}

export function verifiedRoutingMetadataPatch(
  patch: import("./accountForecasts").ForecastRoutingPatch,
  row: Record<string, unknown>,
  accounts: readonly import("./accountForecasts").ForecastAccountDescriptor[],
): import("./accountForecasts").ForecastRoutingPatch {
  const result: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(patch)) {
    if (
      ![
        "funding_account_ref",
        "deposit_account_ref",
        "forecast_account_ref",
        "account_id",
      ].includes(field)
    )
      throw new Error("The account assignment could not be verified.");
    const actual = row[field] ?? null;
    if (field === "account_id" || value === null) {
      if (actual !== value)
        throw new Error("The account assignment could not be verified.");
    } else if (
      !resolveForecastAccountReference(value, accounts) ||
      resolveForecastAccountReference(actual, accounts) !==
        resolveForecastAccountReference(value, accounts)
    )
      throw new Error("The account assignment could not be verified.");
    result[field] = actual;
  }
  return result as import("./accountForecasts").ForecastRoutingPatch;
}
export function mergeRoutingMetadata<T extends { id: string }>(
  row: T,
  expected: object,
  patch: object,
): T {
  const applicable: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(patch)) {
    if (
      ![
        "funding_account_ref",
        "deposit_account_ref",
        "forecast_account_ref",
        "account_id",
      ].includes(field)
    )
      throw new Error("Only account metadata may be published here.");
    if (
      (row as any)[field] === value ||
      ((row as any)[field] ?? null) ===
        ((expected as Record<string, unknown>)[field] ?? null)
    )
      applicable[field] = value;
  }
  return { ...row, ...applicable };
}
