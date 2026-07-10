const PLAID_OAUTH_SESSION_KEY = "flowledger_plaid_oauth_link_session_v1";
const PLAID_OAUTH_SESSION_MAX_AGE_MS = 30 * 60 * 1000;

type StoredPlaidOAuthSession = {
  linkToken: string;
  expiration: string | null;
  createdAt: number;
};

function getWebStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  }
}

function isExpired(session: StoredPlaidOAuthSession) {
  const createdAtExpired = Date.now() - Number(session.createdAt || 0) > PLAID_OAUTH_SESSION_MAX_AGE_MS;
  const plaidExpirationExpired = session.expiration ? Date.now() > Date.parse(session.expiration) : false;
  return createdAtExpired || plaidExpirationExpired;
}

export function storePlaidOAuthLinkSession(linkToken: string, expiration?: string | null) {
  const storage = getWebStorage();
  if (!storage || !linkToken) return;
  const payload: StoredPlaidOAuthSession = {
    linkToken,
    expiration: expiration || null,
    createdAt: Date.now(),
  };
  try {
    storage.setItem(PLAID_OAUTH_SESSION_KEY, JSON.stringify(payload));
  } catch {
    // Plaid OAuth can still work in browsers that preserve React state; this
    // storage is only a short-lived redirect resume helper.
  }
}

export function readPlaidOAuthLinkSession(): StoredPlaidOAuthSession | null {
  const storage = getWebStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(PLAID_OAUTH_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredPlaidOAuthSession;
    if (!parsed?.linkToken || isExpired(parsed)) {
      storage.removeItem(PLAID_OAUTH_SESSION_KEY);
      return null;
    }
    return parsed;
  } catch {
    try {
      storage.removeItem(PLAID_OAUTH_SESSION_KEY);
    } catch {}
    return null;
  }
}

export function clearPlaidOAuthLinkSession() {
  const storage = getWebStorage();
  if (!storage) return;
  try {
    storage.removeItem(PLAID_OAUTH_SESSION_KEY);
  } catch {}
}
