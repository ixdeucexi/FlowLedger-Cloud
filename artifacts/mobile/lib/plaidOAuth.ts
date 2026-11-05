export const PLAID_OAUTH_SESSION_KEY = "flowledger:plaid-oauth:v1";
export const PLAID_CONNECTION_RESULT_KEY = "flowledger:plaid-result:v1";
export const PLAID_CONNECTION_RESULT_EVENT = "flowledger-plaid-connection-result";
export const PLAID_CONNECTION_STATE_EVENT = "flowledger-plaid-connection-state";
export const PLAID_SAVED_PENDING_KEY = "flowledger:plaid-saved-pending:v1";
export const PLAID_RESUME_CONNECTION_EVENT = "flowledger-plaid-resume-connection";
export const PLAID_LINK_SESSION_MAX_AGE_MS = 30 * 60 * 1000;
export const PLAID_BACKGROUND_RETURN_DELAY_MS = 5 * 1000;
const PLAID_RESULT_MAX_AGE_MS = 5 * 60 * 1000;

type BrowserStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type PlaidOAuthSession = {
  linkToken: string;
  hostedSession?: string;
  intent: "bank" | "credit_card";
  householdId: string;
  userId: string;
  createdAt: number;
  awaitingReturn?: boolean;
};

export type PlaidConnectionScope = Pick<PlaidOAuthSession, "userId" | "householdId">;

export function plaidOAuthSessionKey(session: PlaidOAuthSession) {
  return JSON.stringify([session.userId, session.householdId, session.linkToken, session.hostedSession ?? "", session.createdAt]);
}

function storedPlaidOAuthSession(
  storage: BrowserStorage,
  userId: string,
  now: number,
): PlaidOAuthSession | null {
  try {
    const stored = JSON.parse(storage.getItem(PLAID_OAUTH_SESSION_KEY) || "null") as Partial<PlaidOAuthSession> | null;
    if (!stored
      || typeof stored.linkToken !== "string"
      || (stored.hostedSession != null && typeof stored.hostedSession !== "string")
      || !["bank", "credit_card"].includes(String(stored.intent))
      || typeof stored.householdId !== "string"
      || stored.userId !== userId
      || typeof stored.createdAt !== "number"
      || (stored.awaitingReturn != null && typeof stored.awaitingReturn !== "boolean")
      || now - stored.createdAt < 0
      || now - stored.createdAt > PLAID_LINK_SESSION_MAX_AGE_MS) {
      return null;
    }
    return stored as PlaidOAuthSession;
  } catch {
    return null;
  }
}

export function readPlaidOAuthAttempt(storage: BrowserStorage, userId: string, now = Date.now()) {
  return storedPlaidOAuthSession(storage, userId, now);
}

export function receivedPlaidOAuthRedirect(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.searchParams.get("oauth_state_id") ? url : null;
  } catch {
    return null;
  }
}

export function savePlaidOAuthSession(storage: BrowserStorage, session: PlaidOAuthSession) {
  storage.setItem(PLAID_OAUTH_SESSION_KEY, JSON.stringify(session));
}

export function clearPlaidOAuthSession(storage: BrowserStorage, expected?: PlaidOAuthSession) {
  if (expected) {
    try {
      const current = JSON.parse(storage.getItem(PLAID_OAUTH_SESSION_KEY) || "null") as PlaidOAuthSession | null;
      if (!current || plaidOAuthSessionKey(current) !== plaidOAuthSessionKey(expected)) return;
    } catch {
      return;
    }
  }
  storage.removeItem(PLAID_OAUTH_SESSION_KEY);
}

export function markPlaidOAuthAwaitingReturn(
  storage: BrowserStorage,
  userId: string,
  now = Date.now(),
) {
  const stored = storedPlaidOAuthSession(storage, userId, now);
  if (!stored) return;
  savePlaidOAuthSession(storage, { ...stored, awaitingReturn: true });
}

export function readPendingPlaidOAuthSession(
  storage: BrowserStorage,
  userId: string,
  now = Date.now(),
): PlaidOAuthSession | null {
  const stored = storedPlaidOAuthSession(storage, userId, now);
  if (!stored
    || stored.awaitingReturn === false
    || (!stored.hostedSession && now - stored.createdAt < PLAID_BACKGROUND_RETURN_DELAY_MS)) return null;
  return stored;
}

export function readPlaidOAuthSession(
  storage: BrowserStorage,
  receivedRedirectUri: string,
  userId: string,
  now = Date.now(),
): (PlaidOAuthSession & { receivedRedirectUri: string }) | null {
  if (!receivedPlaidOAuthRedirect(receivedRedirectUri)) return null;
  const stored = storedPlaidOAuthSession(storage, userId, now);
  return stored ? { ...stored, receivedRedirectUri } : null;
}

export function savePlaidConnectionResult(storage: BrowserStorage, message: string, now = Date.now(), scope?: PlaidConnectionScope) {
  storage.setItem(PLAID_CONNECTION_RESULT_KEY, JSON.stringify({
    message: message.slice(0, 240),
    createdAt: now,
    ...(scope ? { userId: scope.userId, householdId: scope.householdId } : {}),
  }));
}

export function takePlaidConnectionResult(storage: BrowserStorage, now = Date.now(), scope?: PlaidConnectionScope): string | null {
  try {
    const stored = JSON.parse(storage.getItem(PLAID_CONNECTION_RESULT_KEY) || "null") as { message?: unknown; createdAt?: unknown; userId?: unknown; householdId?: unknown } | null;
    if (!stored
      || typeof stored.message !== "string"
      || typeof stored.createdAt !== "number"
      || now - stored.createdAt < 0
      || now - stored.createdAt > PLAID_RESULT_MAX_AGE_MS) {
      storage.removeItem(PLAID_CONNECTION_RESULT_KEY);
      return null;
    }
    if (scope && (stored.userId !== scope.userId || stored.householdId !== scope.householdId)) return null;
    storage.removeItem(PLAID_CONNECTION_RESULT_KEY);
    return stored.message;
  } catch {
    storage.removeItem(PLAID_CONNECTION_RESULT_KEY);
    return null;
  }
}

export type VerifiedPlaidConnection = {
  ok: true;
  status: "connected" | "already_connected" | "accounts_pending";
  connection_saved: true;
  item_id: string;
  item_ids: string[];
  accounts_count: number;
  credit_cards_count?: number;
  credit_card_debts_count?: number;
  transactions_pending?: boolean;
};

/** A successful HTTP response is insufficient: the server must attest saved records. */
export function verifiedPlaidConnection(value: unknown): VerifiedPlaidConnection {
  const result = value as Partial<VerifiedPlaidConnection> | null;
  if (!result || typeof result !== "object" || result.ok !== true || result.connection_saved !== true
    || !["connected", "already_connected", "accounts_pending"].includes(String(result.status))
    || typeof result.item_id !== "string" || !result.item_id.trim()
    || !Array.isArray(result.item_ids) || !result.item_ids.length
    || !result.item_ids.every(id => typeof id === "string" && Boolean(id.trim()))
    || !result.item_ids.includes(result.item_id)
    || !Number.isSafeInteger(result.accounts_count) || Number(result.accounts_count) < 0
    || (result.status !== "accounts_pending" && Number(result.accounts_count) < 1)) {
    throw new PlaidCompletionError("FlowLedger has not confirmed the saved accounts yet. Check Bank connections before trying again.", false);
  }
  return result as VerifiedPlaidConnection;
}

export const PLAID_ACCOUNTS_PENDING_MESSAGE = "Bank connection saved. Accounts are not available yet. Check Bank connections for the latest status.";
export type SavedPlaidAccountsPending = PlaidConnectionScope & { itemIds: string[]; createdAt: number };

export function savePlaidAccountsPending(storage: BrowserStorage, scope: PlaidConnectionScope, result: VerifiedPlaidConnection) {
  storage.setItem(PLAID_SAVED_PENDING_KEY, JSON.stringify({ userId: scope.userId, householdId: scope.householdId, itemIds: result.item_ids, createdAt: Date.now() }));
}

export function readPlaidAccountsPending(storage: BrowserStorage, scope: PlaidConnectionScope): SavedPlaidAccountsPending | null {
  try {
    const value = JSON.parse(storage.getItem(PLAID_SAVED_PENDING_KEY) || "null") as SavedPlaidAccountsPending | null;
    if (!value || value.userId !== scope.userId || value.householdId !== scope.householdId
      || !Number.isFinite(value.createdAt) || !Array.isArray(value.itemIds) || !value.itemIds.length
      || !value.itemIds.every(id => typeof id === "string" && Boolean(id.trim()))) return null;
    return value;
  } catch { return null; }
}

/** Interpret only a valid scoped status response; stale local IDs reveal no other connection details. */
export function savedPlaidAccountsAvailability(payload: unknown, saved: SavedPlaidAccountsPending): "ready" | "waiting" | "unavailable" {
  const status = payload as { ok?: unknown; error?: unknown; items?: unknown; accounts?: unknown } | null;
  const invalid = () => new Error("Could not check saved accounts. Try again.");
  if (!status || typeof status !== "object" || status.ok === false || status.error
    || !Array.isArray(status.items) || !Array.isArray(status.accounts)) throw invalid();
  const validId = (value: unknown): value is string => typeof value === "string" && Boolean(value.trim()) && value.length <= 128;
  const knownStatuses = new Set(["active", "needs_repair", "removed", "error", "needs_reauth", "login_required", "requires_update", "reauth_required", "pending", "syncing"]);
  type Item = { id: string; status: string; disconnect_cleanup_needed?: boolean };
  type Account = { id: string; plaid_item_record_id: string; is_active: boolean };
  if (!status.items.every((item: Item | null) => item && validId(item.id) && knownStatuses.has(item.status)
    && (item.disconnect_cleanup_needed === undefined || typeof item.disconnect_cleanup_needed === "boolean"))
    || !status.accounts.every((account: Account | null) => account && validId(account.id)
      && validId(account.plaid_item_record_id) && typeof account.is_active === "boolean")) throw invalid();
  const items = status.items as Item[];
  const accounts = status.accounts as Account[];
  const itemsById = new Map(items.map(item => [item.id, item]));
  if (itemsById.size !== items.length) throw invalid();
  if (saved.itemIds.some(id => {
    const item = itemsById.get(id);
    return !item || item.status === "removed" || item.disconnect_cleanup_needed === true;
  })) return "unavailable";
  return saved.itemIds.every(id => accounts.some(account => account.plaid_item_record_id === id && account.is_active)) ? "ready" : "waiting";
}

export function clearPlaidAccountsPending(storage: BrowserStorage, expected: SavedPlaidAccountsPending) {
  const current = readPlaidAccountsPending(storage, expected);
  if (!current || JSON.stringify(current) !== JSON.stringify(expected)) return false;
  storage.removeItem(PLAID_SAVED_PENDING_KEY);
  return true;
}

export function matchesStoredPlaidSession(storage: BrowserStorage, expected: PlaidOAuthSession) {
  try {
    const stored = JSON.parse(storage.getItem(PLAID_OAUTH_SESSION_KEY) || "null") as PlaidOAuthSession | null;
    return Boolean(stored && plaidOAuthSessionKey(stored) === plaidOAuthSessionKey(expected));
  } catch { return false; }
}

const activeCompletions = new Map<string, number>();
export function notifyPlaidConnectionState() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(PLAID_CONNECTION_STATE_EVENT));
}
export function plaidCompletionInFlight(attempt: PlaidOAuthSession) {
  return (activeCompletions.get(plaidOAuthSessionKey(attempt)) || 0) > 0;
}
export function beginPlaidCompletion(attempt: PlaidOAuthSession) {
  const key = plaidOAuthSessionKey(attempt);
  activeCompletions.set(key, (activeCompletions.get(key) || 0) + 1);
  notifyPlaidConnectionState();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const remaining = (activeCompletions.get(key) || 1) - 1;
    if (remaining) activeCompletions.set(key, remaining); else activeCompletions.delete(key);
    notifyPlaidConnectionState();
  };
}

/** Clears only an unfinished local Hosted attempt; never calls a provider or changes saved records. */
export function discardPendingPlaidAttempt(storage: BrowserStorage, expected: PlaidOAuthSession) {
  if (!expected.hostedSession || plaidCompletionInFlight(expected) || !matchesStoredPlaidSession(storage, expected)) return false;
  clearPlaidOAuthSession(storage, expected);
  notifyPlaidConnectionState();
  return true;
}

export class PlaidCompletionError extends Error {
  constructor(message: string, readonly clearSession: boolean) {
    super(message);
    this.name = "PlaidCompletionError";
  }
}

export type PlaidCompletionResponse = { status: number; ok: boolean; result: unknown };

/** Wait for Hosted Link's result without starting another Link session. */
export async function pollHostedPlaidCompletion({
  request,
  isCurrent,
  wait,
  attempts = 20,
}: {
  request: () => Promise<PlaidCompletionResponse>;
  isCurrent: () => boolean;
  wait: () => Promise<void>;
  attempts?: number;
}): Promise<{ status: "success"; result: VerifiedPlaidConnection } | { status: "pending" | "inactive" }> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (!isCurrent()) return { status: "inactive" };
    const response = await request();
    if (response.status === 202) {
      if (!isCurrent()) return { status: "inactive" };
      if (attempt < attempts - 1) await wait();
      continue;
    }
    if (!response.ok) {
      throw new PlaidCompletionError(
        typeof (response.result as { message?: unknown } | null)?.message === "string" ? (response.result as { message: string }).message : "Could not finish connecting this account.",
        response.status === 400 || response.status === 409,
      );
    }
    return { status: "success", result: verifiedPlaidConnection(response.result) };
  }
  return { status: "pending" };
}
