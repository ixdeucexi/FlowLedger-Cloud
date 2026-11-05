export const PLAID_OAUTH_SESSION_KEY = "flowledger:plaid-oauth:v1";
export const PLAID_CONNECTION_RESULT_KEY = "flowledger:plaid-result:v1";
export const PLAID_CONNECTION_RESULT_EVENT = "flowledger-plaid-connection-result";
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

export class PlaidCompletionError extends Error {
  constructor(message: string, readonly clearSession: boolean) {
    super(message);
    this.name = "PlaidCompletionError";
  }
}

export type PlaidCompletionResponse<T> = { status: number; ok: boolean; result: T & { message?: string; error?: string } };

/** Wait for Hosted Link's result without starting another Link session. */
export async function pollHostedPlaidCompletion<T>({
  request,
  isCurrent,
  wait,
  attempts = 20,
}: {
  request: () => Promise<PlaidCompletionResponse<T>>;
  isCurrent: () => boolean;
  wait: () => Promise<void>;
  attempts?: number;
}): Promise<{ status: "success"; result: T } | { status: "pending" | "inactive" }> {
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
        response.result.message || "Could not finish connecting this account.",
        response.status === 400 || response.status === 409,
      );
    }
    return { status: "success", result: response.result };
  }
  return { status: "pending" };
}
