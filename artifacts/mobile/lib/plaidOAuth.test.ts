import assert from "node:assert/strict";
import test from "node:test";

import {
  beginPlaidCompletion,
  discardPendingPlaidAttempt,
  plaidCompletionInFlight,
  matchesStoredPlaidSession,
  verifiedPlaidConnection,
  savePlaidAccountsPending,
  savedPlaidAccountsAvailability,
  readPlaidAccountsPending,
  clearPlaidAccountsPending,
  PLAID_SAVED_PENDING_KEY,
  PLAID_BACKGROUND_RETURN_DELAY_MS,
  PLAID_CONNECTION_RESULT_KEY,
  PLAID_LINK_SESSION_MAX_AGE_MS,
  clearPlaidOAuthSession,
  PlaidCompletionError,
  markPlaidOAuthAwaitingReturn,
  readPendingPlaidOAuthSession,
  readPlaidOAuthSession,
  receivedPlaidOAuthRedirect,
  pollHostedPlaidCompletion,
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

test("Hosted Link completion is detected immediately when Plaid returns to the PWA", () => {
  const storage = memoryStorage();
  const now = Date.UTC(2026, 7, 4, 21, 30);
  savePlaidOAuthSession(storage, {
    linkToken: "hosted-link-token",
    hostedSession: "encrypted-hosted-session",
    intent: "credit_card",
    householdId: "house-1",
    userId: "user-1",
    createdAt: now,
    awaitingReturn: true,
  });

  assert.equal(readPendingPlaidOAuthSession(storage, "user-1", now)?.hostedSession, "encrypted-hosted-session");
});

test("Plaid connection result is shown once after the OAuth return", () => {
  const storage = memoryStorage();
  const now = Date.UTC(2026, 7, 4, 21, 30);
  savePlaidConnectionResult(storage, "Card attached to Debt and Snowball.", now);
  assert.equal(takePlaidConnectionResult(storage, now + 1_000), "Card attached to Debt and Snowball.");
  assert.equal(takePlaidConnectionResult(storage, now + 2_000), null);
});

test("clearing a completed connection preserves a newer saved attempt", () => {
  const storage = memoryStorage();
  const old = { linkToken: "link-old", hostedSession: "sealed-old", userId: "user-1", householdId: "house-1", intent: "bank" as const, createdAt: Date.now() };
  const next = { ...old, linkToken: "link-next", hostedSession: "sealed-next", createdAt: old.createdAt + 1 };
  savePlaidOAuthSession(storage, next);
  clearPlaidOAuthSession(storage, old);
  assert.equal(readPendingPlaidOAuthSession(storage, "user-1", next.createdAt)?.linkToken, next.linkToken);
  clearPlaidOAuthSession(storage, next);
  assert.equal(readPendingPlaidOAuthSession(storage, "user-1", next.createdAt), null);
});

test("connection confirmation is consumed only by its user and household", () => {
  const storage = memoryStorage();
  const now = Date.now();
  const scope = { userId: "user-1", householdId: "house-1" };
  savePlaidConnectionResult(storage, "Account connected.", now, scope);
  assert.equal(takePlaidConnectionResult(storage, now, { ...scope, userId: "user-2" }), null);
  assert.equal(takePlaidConnectionResult(storage, now, { ...scope, householdId: "house-2" }), null);
  assert.equal(takePlaidConnectionResult(storage, now, scope), "Account connected.");
  assert.equal(takePlaidConnectionResult(storage, now, scope), null);
});

test("connection result stores only scope identifiers and the completion time", () => {
  const storage = memoryStorage();
  const now = Date.now();
  const attempt = {
    userId: "user-1", householdId: "house-1", createdAt: now - 20 * 60_000,
    linkToken: "link-private-fixture", hostedSession: "sealed-private-fixture", intent: "bank" as const,
  };
  savePlaidConnectionResult(storage, "Account connected.", now, attempt);
  assert.deepEqual(JSON.parse(storage.getItem(PLAID_CONNECTION_RESULT_KEY)!), {
    message: "Account connected.", createdAt: now, userId: attempt.userId, householdId: attempt.householdId,
  });
  assert.equal(takePlaidConnectionResult(storage, now, attempt), "Account connected.");
});

test("a delayed Hosted Link result continues the same completion request", async () => {
  let requests = 0;
  let waits = 0;
  const result = { ok: true as const, status: "connected" as const, connection_saved: true as const, item_id: "fixture-item", item_ids: ["fixture-item"], accounts_count: 2 };
  const completed = await pollHostedPlaidCompletion({
    request: async () => ++requests === 1
      ? { status: 202, ok: false, result: {} }
      : { status: 200, ok: true, result },
    isCurrent: () => true,
    wait: async () => { waits += 1; },
  });
  assert.deepEqual(completed, { status: "success", result });
  assert.equal(requests, 2);
  assert.equal(waits, 1);
});

test("a pending Hosted result remains retryable after the bounded wait", async () => {
  let requests = 0;
  let waits = 0;
  const completed = await pollHostedPlaidCompletion({
    request: async () => { requests += 1; return { status: 202, ok: false, result: {} }; },
    isCurrent: () => true,
    wait: async () => { waits += 1; },
    attempts: 3,
  });
  assert.deepEqual(completed, { status: "pending" });
  assert.equal(requests, 3);
  assert.equal(waits, 2);
});

test("leaving a household stops further Hosted completion requests", async () => {
  let current = true;
  let requests = 0;
  const completed = await pollHostedPlaidCompletion({
    request: async () => { requests += 1; current = false; return { status: 202, ok: false, result: {} }; },
    isCurrent: () => current,
    wait: async () => { throw new Error("An obsolete scope must not keep polling"); },
  });
  assert.deepEqual(completed, { status: "inactive" });
  assert.equal(requests, 1);
});

test("Hosted completion distinguishes invalid sessions from retryable server errors", async () => {
  for (const [status, error, clear] of [[400, "PLAID_LINK_SESSION_INVALID", true], [409, "PLAID_LINK_EXITED", true], [409, "PLAID_ACCOUNT_ALREADY_CONNECTED_TO_ANOTHER_HOUSEHOLD", true], [401, "AUTH_REQUIRED", false], [503, "UNAVAILABLE", false]] as const) {
    await assert.rejects(pollHostedPlaidCompletion({
      request: async () => ({ status, ok: false, result: { error, message: "Fixture completion error" } }),
      isCurrent: () => true,
      wait: async () => {},
    }), failure => failure instanceof PlaidCompletionError && failure.clearSession === clear);
  }
});


test("malformed and negative HTTP200 completion never publish success", async () => {
  const valid = { ok: true, status: "connected", connection_saved: true, item_id: "fixture-item", item_ids: ["fixture-item"], accounts_count: 1 };
  for (const result of [null, {}, { ok: false }, { ...valid, ok: false }, { ...valid, item_id: "" }, { ...valid, item_ids: [] }, { ...valid, connection_saved: false }, { ...valid, accounts_count: 0 }, { ...valid, accounts_count: NaN }, { ...valid, accounts_count: -1 }, { ...valid, accounts_count: 1.2 }]) {
    await assert.rejects(pollHostedPlaidCompletion({ request: async () => ({ status: 200, ok: true, result: result as never }), isCurrent: () => true, wait: async () => {} }), error => error instanceof PlaidCompletionError && !error.clearSession);
  }
});

test("verified saved connections awaiting any accounts become token-free recoverable state", () => {
  const storage = memoryStorage();
  const scope = { userId: "fixture-user", householdId: "fixture-household" };
  for (const count of [0, 2]) {
    const result = verifiedPlaidConnection({ ok: true, status: "accounts_pending", connection_saved: true, item_id: "fixture-item", item_ids: ["fixture-item", "fixture-second-item"], accounts_count: count });
    savePlaidAccountsPending(storage, scope, result);
    const pending = readPlaidAccountsPending(storage, scope)!;
    assert.deepEqual(pending.itemIds, result.item_ids);
    assert.equal(readPlaidAccountsPending(storage, { ...scope, userId: "someone-else" }), null);
    assert.equal(readPlaidAccountsPending(storage, { ...scope, householdId: "another-household" }), null);
    assert(!storage.getItem(PLAID_SAVED_PENDING_KEY)!.includes("token"));
    clearPlaidAccountsPending(storage, { ...pending, createdAt: pending.createdAt - 1 });
    assert(readPlaidAccountsPending(storage, scope));
    clearPlaidAccountsPending(storage, pending);
    assert.equal(readPlaidAccountsPending(storage, scope), null);
  }
});

test("Start over is exact-attempt local cleanup only after completion is idle", () => {
  const storage = memoryStorage();
  const attempt = { userId: "fixture-user", householdId: "fixture-household", createdAt: Date.now(), hostedSession: "sealed-fictional", linkToken: "link-fictional", intent: "bank" as const };
  savePlaidOAuthSession(storage, attempt);
  const release = beginPlaidCompletion(attempt);
  assert(plaidCompletionInFlight(attempt));
  assert.equal(discardPendingPlaidAttempt(storage, attempt), false);
  release(); release();
  assert.equal(plaidCompletionInFlight(attempt), false);
  const next = { ...attempt, createdAt: attempt.createdAt + 1, linkToken: "link-newer" };
  savePlaidOAuthSession(storage, next);
  assert.equal(discardPendingPlaidAttempt(storage, attempt), false);
  assert(matchesStoredPlaidSession(storage, next));
  assert.equal(discardPendingPlaidAttempt(storage, next), true);
  assert.equal(readPendingPlaidOAuthSession(storage, next.userId, next.createdAt), null);
});


test("saved-account status requires valid Item and account evidence before local marker cleanup", () => {
  const saved = { userId: "fixture-user", householdId: "fixture-household", itemIds: ["fixture-item"], createdAt: Date.now() };
  const account = { id: "fixture-account", plaid_item_record_id: "fixture-item", is_active: true };
  assert.equal(savedPlaidAccountsAvailability({ items: [{ id: "fixture-item", status: "active" }], accounts: [account] }, saved), "ready");
  assert.equal(savedPlaidAccountsAvailability({ items: [{ id: "fixture-item", status: "needs_repair" }], accounts: [] }, saved), "waiting");
  assert.equal(savedPlaidAccountsAvailability({ items: [], accounts: [] }, saved), "unavailable");
  assert.equal(savedPlaidAccountsAvailability({ items: [{ id: "different-item", status: "active" }], accounts: [] }, saved), "unavailable");
  assert.equal(savedPlaidAccountsAvailability({ items: [{ id: "fixture-item", status: "removed" }], accounts: [account] }, saved), "unavailable");
  assert.equal(savedPlaidAccountsAvailability({ items: [{ id: "fixture-item", status: "active", disconnect_cleanup_needed: true }], accounts: [account] }, saved), "unavailable");
  for (const payload of [null, {}, { items: [] }, { accounts: [] }, { ok: false, items: [], accounts: [] }, { items: [null], accounts: [] }, { items: [{ id: "fixture-item", status: "unknown-future-status" }], accounts: [] }, { items: [], accounts: [null] }, { items: [], accounts: [{ id: "bad-account" }] }]) {
    assert.throws(() => savedPlaidAccountsAvailability(payload, saved), /Could not check saved accounts/);
  }
});
