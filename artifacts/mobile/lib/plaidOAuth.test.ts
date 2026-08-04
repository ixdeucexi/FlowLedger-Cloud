import assert from "node:assert/strict";
import test from "node:test";

import {
  PLAID_BACKGROUND_RETURN_DELAY_MS,
  PLAID_LINK_SESSION_MAX_AGE_MS,
  clearPlaidOAuthSession,
  markPlaidOAuthAwaitingReturn,
  readPendingPlaidOAuthSession,
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

test("Plaid OAuth resumes after an installed Android app returns without an OAuth query", () => {
  const storage = memoryStorage();
  const now = Date.UTC(2026, 7, 4, 21, 30);
  savePlaidOAuthSession(storage, {
    linkToken: "android-link-token",
    intent: "credit_card",
    householdId: "house-1",
    userId: "user-1",
    createdAt: now,
    awaitingReturn: false,
  });

  assert.equal(readPendingPlaidOAuthSession(storage, "user-1", now + PLAID_BACKGROUND_RETURN_DELAY_MS), null);
  markPlaidOAuthAwaitingReturn(storage, "user-1", now + 1_000);
  assert.equal(
    readPendingPlaidOAuthSession(storage, "user-1", now + PLAID_BACKGROUND_RETURN_DELAY_MS)?.linkToken,
    "android-link-token",
  );
  assert.equal(readPendingPlaidOAuthSession(storage, "another-user", now + PLAID_BACKGROUND_RETURN_DELAY_MS), null);
});

test("Plaid OAuth can recover a fresh legacy handoff session from before return tracking", () => {
  const storage = memoryStorage();
  const now = Date.UTC(2026, 7, 4, 21, 30);
  savePlaidOAuthSession(storage, {
    linkToken: "legacy-link-token",
    intent: "credit_card",
    householdId: "house-1",
    userId: "user-1",
    createdAt: now,
  });
  assert.equal(
    readPendingPlaidOAuthSession(storage, "user-1", now + PLAID_BACKGROUND_RETURN_DELAY_MS)?.linkToken,
    "legacy-link-token",
  );
  assert.equal(
    readPendingPlaidOAuthSession(storage, "user-1", now + PLAID_LINK_SESSION_MAX_AGE_MS + 1),
    null,
  );
});

test("Plaid connection result is shown once after the OAuth return", () => {
  const storage = memoryStorage();
  const now = Date.UTC(2026, 7, 4, 21, 30);
  savePlaidConnectionResult(storage, "Card attached to Debt and Snowball.", now);
  assert.equal(takePlaidConnectionResult(storage, now + 1_000), "Card attached to Debt and Snowball.");
  assert.equal(takePlaidConnectionResult(storage, now + 2_000), null);
});
