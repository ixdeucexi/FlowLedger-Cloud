import assert from "node:assert/strict";
import test from "node:test";

import {
  PLAID_LINK_SESSION_MAX_AGE_MS,
  clearPlaidOAuthSession,
  readPlaidOAuthSession,
  receivedPlaidOAuthRedirect,
  savePlaidConnectionResult,
  savePlaidOAuthSession,
  takePlaidConnectionResult,
} from "./plaidOAuth";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

test("Plaid OAuth resumes only the same user's fresh Link session", () => {
  const storage = memoryStorage();
  const now = Date.UTC(2026, 7, 4, 21, 30);
  savePlaidOAuthSession(storage, {
    linkToken: "link-token",
    intent: "credit_card",
    householdId: "house-1",
    userId: "user-1",
    createdAt: now,
  });
  const redirect = "https://flowledger-algo.com/?oauth_state_id=oauth-state";

  assert.equal(receivedPlaidOAuthRedirect(redirect), redirect);
  assert.equal(readPlaidOAuthSession(storage, redirect, "user-1", now + 1_000)?.linkToken, "link-token");
  assert.equal(readPlaidOAuthSession(storage, redirect, "another-user", now + 1_000), null);
  assert.equal(readPlaidOAuthSession(storage, redirect, "user-1", now + PLAID_LINK_SESSION_MAX_AGE_MS + 1), null);
  assert.equal(readPlaidOAuthSession(storage, "https://flowledger-algo.com/", "user-1", now), null);
  clearPlaidOAuthSession(storage);
  assert.equal(readPlaidOAuthSession(storage, redirect, "user-1", now), null);
});

test("Plaid connection result is shown once after the OAuth return", () => {
  const storage = memoryStorage();
  const now = Date.UTC(2026, 7, 4, 21, 30);
  savePlaidConnectionResult(storage, "Card attached to Debt and Snowball.", now);
  assert.equal(takePlaidConnectionResult(storage, now + 1_000), "Card attached to Debt and Snowball.");
  assert.equal(takePlaidConnectionResult(storage, now + 2_000), null);
});
