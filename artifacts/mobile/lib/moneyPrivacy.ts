/** Presentation only. Never use these strings as inputs to financial calculations. */
export const HIDDEN_MONEY = "••••";

const gap = String.raw`[\s\u200e\u200f\u061c]*`;
// Follow real Intl grouping rather than accepting arbitrary separator runs:
// "$12.99, 2026-10-30" contains a date, not a larger monetary number.
const number = String.raw`(?:\p{Nd}{1,2}(?:,\p{Nd}{2})+,\p{Nd}{3}(?:\.\p{Nd}+)?|\p{Nd}{1,3}(?:,\p{Nd}{3})+(?:\.\p{Nd}+)?|\p{Nd}{1,3}(?:\.\p{Nd}{3})+(?:,\p{Nd}+)?|\p{Nd}{1,3}(?:[\u00a0\u202f ]\p{Nd}{3})+(?:[.,]\p{Nd}+)?|\p{Nd}{1,3}(?:\u066c\p{Nd}{3})+(?:\u066b\p{Nd}+)?|\p{Nd}+(?:[.,\u066b]\p{Nd}+)?)(?:[eE][+\-−]?\p{Nd}+)?(?:[kKmMbB])?(?!\p{Nd})`;
const prefix = String.raw`(?:US\$|CA\$|A\$|[$£€¥₹]|\b(?:USD|CAD|AUD|GBP|EUR))`;
const suffix = String.raw`(?:US\$|CA\$|A\$|[$£€¥₹]|(?:USD|CAD|AUD|GBP|EUR|dollars?|cents?|euros?|pounds?)\b)(?!${gap}[+\-−]?${gap}\p{Nd})`;
const currency = new RegExp(
  String.raw`[+\-−]?${gap}(?:${prefix}${gap}[+\-−]?${gap}${number}|${number}${gap}${suffix})`,
  "giu",
);

/** Display runs only: preserve the source text while identifying complete currency tokens. */
export function moneyTextSegments(text: string): { kind: "text" | "money"; text: string }[] {
  const segments: { kind: "text" | "money"; text: string }[] = [];
  let cursor = 0;
  for (const match of text.matchAll(new RegExp(currency.source, currency.flags))) {
    const leadingWhitespace = match[0].match(/^\s*/u)?.[0].length ?? 0;
    const start = match.index + leadingWhitespace;
    const end = match.index + match[0].length;
    if (start > cursor) segments.push({ kind: "text", text: text.slice(cursor, start) });
    segments.push({ kind: "money", text: text.slice(start, end) });
    cursor = end;
  }
  if (cursor < text.length) segments.push({ kind: "text", text: text.slice(cursor) });
  return segments;
}

export function maskMoneyText(text: string, hidden: boolean): string {
  if (!hidden || !text) return text;
  // Keep whitespace outside the currency token so words/lines do not run together.
  return text.replace(currency, match => `${match.match(/^\s*/)?.[0] ?? ""}${HIDDEN_MONEY}`);
}

export function moneyPrivacyPreference(value: unknown): boolean {
  return value === true;
}

/** Mixed financial search can contain a bare amount; keep an unambiguous ISO date readable. */
export function moneyPrivacySearchSensitive(query: string): boolean {
  const text = query.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  return /\p{Nd}/u.test(text);
}

/** Read only after scoped writes/intent settle, including failed intents on ABA returns. */
export async function readSettledMoneyPrivacy(
  read: () => Promise<unknown>,
  waitForWrites: () => Promise<void>,
  latestIntent: () => Promise<void> | undefined,
): Promise<boolean> {
  await waitForWrites();
  await latestIntent();
  return moneyPrivacyPreference(await read());
}

/** Alert/error prose can contain unlabelled amounts returned by a service. */
export function privateAlertText(text: string, mask: (value: string) => string): string {
  const masked = mask(text);
  return mask("$0") !== "$0" && /\p{Nd}/u.test(masked)
    ? "Details hidden in Privacy Mode. Show amounts to read them."
    : masked;
}

/** Drop numeric accessibility values only for explicitly monetary controls. */
export function moneyPrivacyAccessibility<T extends object>(
  props: T,
  hidden: boolean,
  sensitive = false,
): T {
  if (!hidden) return props;
  const result = { ...props } as Record<string, unknown>;
  for (const name of ["accessibilityLabel", "accessibilityHint", "aria-label", "aria-description", "aria-valuetext", "title"]) {
    if (typeof result[name] === "string") result[name] = maskMoneyText(result[name], true);
  }
  const value = result.accessibilityValue;
  if (value && typeof value === "object") {
    result.accessibilityValue = sensitive
      ? { text: "Amount hidden" }
      : { ...value, ...("text" in value && typeof value.text === "string" ? { text: maskMoneyText(value.text, true) } : {}) };
  }
  if (sensitive) {
    delete result["aria-valuenow"];
    delete result["aria-valuemin"];
    delete result["aria-valuemax"];
  }
  return result as T;
}

export function moneyPrivacyScope(userId: string | null, householdId: string | null): string | null {
  return userId && householdId ? JSON.stringify([userId, householdId]) : null;
}

/** Match the app's user-owned legacy plan fallback, never a loading/error transition. */
export function moneyPrivacyHouseholdScope(input: {
  userId: string | null;
  householdId: string | null;
  loading: boolean;
  loadError: unknown;
}): string | null {
  if (!input.userId) return null;
  if (input.householdId) return input.householdId;
  return !input.loading && !input.loadError ? `personal-${input.userId}` : null;
}

export function canCommitMoneyPrivacy(
  request: { scope: string; revision: number },
  current: { scope: string | null; revision: number },
) {
  return request.scope === current.scope && request.revision === current.revision;
}
