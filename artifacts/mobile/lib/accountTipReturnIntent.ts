import { getAccountTipForWeek } from "./accountTips";

const STORAGE_KEY = "flowledger_account_tip_return_v1";
const MAX_AGE_MS = 10 * 60 * 1000;
type IntentStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function browserStorage(): IntentStorage | null {
  try { return typeof window !== "undefined" ? window.sessionStorage ?? null : null; }
  catch { return null; }
}

export function clearAccountTipReturnIntent(storage: IntentStorage | null = browserStorage()) {
  try { storage?.removeItem(STORAGE_KEY); } catch { /* Optional public navigation intent. */ }
}

/** Same-tab OAuth may reload the app; keep only the public week for a short, one-use return. */
export function saveAccountTipReturnIntent(week: unknown, storage: IntentStorage | null = browserStorage(), now = new Date()): boolean {
  const tip = getAccountTipForWeek(week, now);
  clearAccountTipReturnIntent(storage);
  if (!storage || !tip) return false;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, week: tip.week, createdAt: now.getTime(), expiresAt: now.getTime() + MAX_AGE_MS }));
    return true;
  } catch { return false; }
}

function readAccountTipReturnIntent(storage: IntentStorage | null, now: Date, consume: boolean): string | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (consume) clearAccountTipReturnIntent(storage);
    if (!raw) return null;
    const saved = JSON.parse(raw) as { version?: unknown; week?: unknown; createdAt?: unknown; expiresAt?: unknown };
    if (saved?.version !== 1 || typeof saved.createdAt !== "number" || typeof saved.expiresAt !== "number"
      || !Number.isFinite(saved.createdAt) || !Number.isFinite(saved.expiresAt)
      || saved.createdAt > now.getTime() || saved.expiresAt <= now.getTime()
      || saved.expiresAt - saved.createdAt !== MAX_AGE_MS) return null;
    return getAccountTipForWeek(saved.week, now)?.week ?? null;
  } catch { return null; }
}

/** Check for an actual tip before deferring ordinary sign-in navigation. */
export function peekAccountTipReturnIntent(storage: IntentStorage | null = browserStorage(), now = new Date()): string | null {
  return readAccountTipReturnIntent(storage, now, false);
}

export function consumeAccountTipReturnIntent(storage: IntentStorage | null = browserStorage(), now = new Date()): string | null {
  return readAccountTipReturnIntent(storage, now, true);
}
