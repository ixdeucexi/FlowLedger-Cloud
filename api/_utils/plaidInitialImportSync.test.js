const assert = require("node:assert/strict");
const test = require("node:test");
const { syncTransactions, createItemSynchronizer, syncItemUnlocked } = require("./sync");

const baseItem = { id: "item", household_id: "house", initial_import_version: 1,
  initial_import_from: "2026-09-05", initial_history_complete_at: null };

function transactionHarness(pages) {
  const providerCalls = [], imported = [], writes = [], notifications = [];
  const db = {
    from(table) {
      const state = { table, filters: [], update: null };
      const chain = {
        select() { return chain; }, eq(key, value) { state.filters.push([key, value]); return chain; },
        in() { return chain; }, update(value) { state.update = value; return chain; },
        then(resolve) {
          if (state.update) writes.push(state);
          const active = state.filters.find(([key]) => key === "is_active")?.[1];
          return Promise.resolve({ data: table === "plaid_accounts" && active === true
            ? [{ id: "account-row", plaid_account_id: "checking", account_type: "depository", account_subtype: "checking" }] : [], error: null }).then(resolve);
        },
      };
      return chain;
    },
  };
  const client = { async transactionsSync(args) { providerCalls.push(args); const next = pages.shift(); if (next instanceof Error) throw next; return { data: next }; } };
  const args = { client, userId: "actor", accessToken: "fictional-token", database: () => db,
    importTransaction: async ({ transaction, householdId }) => {
      imported.push({ transaction, householdId });
      return { isNewPosted: !transaction.pending, isNewPending: !!transaction.pending,
        flowledgerId: "canonical:" + transaction.transaction_id, plaidTransactionId: transaction.transaction_id };
    },
    queuePending: async (...input) => notifications.push(["pending", ...input]),
    queuePosted: async (...input) => notifications.push(["posted", ...input]),
    deliverPending: async (...input) => notifications.push(["deliver", ...input]),
  };
  return { args, providerCalls, imported, writes, notifications };
}

function charge(id, date = "2026-10-01") { return { transaction_id: id, account_id: "checking", amount: 9.99, date, pending: false }; }

test("partial new history retains each cursor and suppresses historical notifications until a subsequent completed sync", async () => {
  const h = transactionHarness([
    { added: [charge("initial")], next_cursor: "initial-cursor", has_more: false, transactions_update_status: "INITIAL_UPDATE_COMPLETE" },
    { added: [charge("historical", "2026-06-01")], next_cursor: "history-cursor", has_more: false, transactions_update_status: "HISTORICAL_UPDATE_COMPLETE" },
    { added: [charge("fresh")], next_cursor: "fresh-cursor", has_more: false, transactions_update_status: "HISTORICAL_UPDATE_COMPLETE" },
  ]);
  const first = await syncTransactions({ ...h.args, item: baseItem });
  assert.equal(first.cursor, "initial-cursor"); assert.equal(first.history_complete, false);
  const second = await syncTransactions({ ...h.args, item: { ...baseItem, transactions_cursor: first.cursor } });
  assert.equal(second.cursor, "history-cursor"); assert.equal(second.history_complete, true);
  assert.deepEqual(h.notifications, []);
  assert.equal(h.imported[1].transaction.date, "2026-06-01", "Two months is a minimum request; valid older records are not dropped");
  await syncTransactions({ ...h.args, item: { ...baseItem, transactions_cursor: second.cursor, initial_history_complete_at: "2026-11-05T12:00:00Z" } });
  assert.deepEqual(h.providerCalls.map(c => c.cursor ?? null), [null, "initial-cursor", "history-cursor"]);
  assert.deepEqual(h.notifications, [["posted", "actor", "house", ["canonical:fresh"]]]);
});

test("empty and paginated initial batches do not invent completion", async () => {
  const h = transactionHarness([
    { added: [], next_cursor: "empty", has_more: false, transactions_update_status: "NOT_READY" },
    { added: [charge("one")], next_cursor: "page1", has_more: true, transactions_update_status: "HISTORICAL_UPDATE_COMPLETE" },
    { modified: [charge("two")], next_cursor: "page2", has_more: false },
  ]);
  assert.equal((await syncTransactions({ ...h.args, item: baseItem })).history_complete, false);
  const result = await syncTransactions({ ...h.args, item: { ...baseItem, transactions_cursor: "empty" } });
  assert.equal(result.history_complete, true); assert.equal(result.cursor, "page2");
  assert.equal(result.added, 1); assert.equal(result.modified, 1);
  assert.deepEqual(h.notifications, []);
});

test("verified historical webhook completion handles providers lacking sync status", async () => {
  const h = transactionHarness([{ added: [], next_cursor: "ready", has_more: false }]);
  const result = await syncTransactions({ ...h.args, item: baseItem, webhookHistoricalComplete: true });
  assert.equal(result.history_complete, true);
});

test("legacy/admin sync retains prior notification semantics and has no profile state", async () => {
  const h = transactionHarness([{ added: [charge("legacy")], next_cursor: "next", has_more: false }]);
  const result = await syncTransactions({ ...h.args, item: { id: "legacy", household_id: "house", transactions_cursor: "before" } });
  assert.equal(Object.hasOwn(result, "history_complete"), false);
  assert.deepEqual(h.notifications, [["posted", "actor", "house", ["canonical:legacy"]]]);
});

test("older modifications and removals still reach the existing reconciliation paths", async () => {
  const h = transactionHarness([{ modified: [charge("old", "2025-01-01")], removed: [{ transaction_id: "removed-old" }], next_cursor: "next", has_more: false }]);
  const result = await syncTransactions({ ...h.args, item: baseItem });
  assert.equal(h.imported[0].transaction.date, "2025-01-01"); assert.equal(result.removed, 1);
  assert.deepEqual(h.writes.map(w => w.table), ["plaid_transactions", "transactions", "pending_plan_matches"]);
  assert(h.writes.every(w => w.filters.some(([key, value]) => key === "household_id" && value === "house")));
});

test("queued sync rechecks removed status inside the unlink lease before using any provider token", async () => {
  const calls = [];
  const db = { async rpc(name) { calls.push(name); return { data: true, error: null }; }, from(table) {
    calls.push("read:" + table); return { select() { return this; }, eq() { return this; },
      async maybeSingle() { return { data: { id: "item", household_id: "house", status: "removed", encrypted_access_token: null }, error: null }; } };
  } };
  const synchronize = createItemSynchronizer({ serviceSupabase: () => db,
    plaid: () => { throw new Error("Removed item must never contact provider"); },
    tokenFor: () => { throw new Error("Removed item must never decrypt a stale token"); },
    syncItemUnlocked: () => { throw new Error("Removed item must not reactivate accounts"); },
  });
  const result = await synchronize({ userId: "actor", item: { id: "item", household_id: "house", encrypted_access_token: "old-snapshot" } });
  assert.equal(result.skipped, true); assert.equal(result.reason, "disconnected");
  assert.deepEqual(calls, ["acquire_plaid_sync_lock", "read:plaid_items", "release_plaid_sync_lock"]);
});

test("sync uses the current protected cursor and profile rather than a stale queued snapshot", async () => {
  const current = { ...baseItem, user_id: "actor", status: "active", transactions_cursor: "fresh-db-cursor", encrypted_access_token: "current-cipher" };
  let input;
  const db = { async rpc() { return { data: true, error: null }; }, from() { return {
    select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: current, error: null }; },
  }; } };
  const synchronize = createItemSynchronizer({ serviceSupabase: () => db, plaid: () => ({ fake: true }),
    tokenFor: item => { assert.equal(item.encrypted_access_token, "current-cipher"); return "fresh-token"; },
    syncItemUnlocked: async args => { input = args; return { ok: true }; },
  });
  assert.deepEqual(await synchronize({ userId: "actor", item: { id: "item", household_id: "house", transactions_cursor: null }, webhookHistoricalComplete: true }), { ok: true });
  assert.equal(input.item.transactions_cursor, "fresh-db-cursor"); assert.equal(input.item.initial_import_version, 1);
  assert.equal(input.webhookHistoricalComplete, true);
});

function itemHarness() {
  const writes = [];
  const db = { from(table) { const filters = [];let value;
    const q = { update(row) { value = row; return q; }, eq(key, v) { filters.push([key, v]); return q; },
      then(resolve) { writes.push({ table, value, filters }); return Promise.resolve({ error: null }).then(resolve); } };
    return q;
  } };
  return { writes, args: { userId: "actor", item: { ...baseItem, status: "active" }, db, client: {}, accessToken: "fake",
    synchronizeAccounts: async () => ({ accounts: [], duplicateItemIds: [], observedAt: "2026-11-05T12:00:00Z" }),
    synchronizeLiabilities: async () => ({ cards: 0, debts: 0, available: true }),
  } };
}

test("item progress persists partial cursor without claiming history complete", async () => {
  const h = itemHarness();
  const result = await syncItemUnlocked({ ...h.args,
    synchronizeTransactions: async () => ({ cursor: "partial", added: 0, modified: 0, removed: 0, history_complete: false }),
    refreshSubscriptions: async () => ({ candidates: 0 }),
  });
  assert.equal(result.transactions_pending, true); assert.equal(result.history_status, "importing");
  const completedWrite = h.writes.find(w => w.value.transactions_cursor === "partial");
  assert(completedWrite); assert.equal(Object.hasOwn(completedWrite.value, "initial_history_complete_at"), false);
});

test("subscription storage failure cannot break a successful connection or restart authentication", async () => {
  const h = itemHarness();let scans = 0;
  const args = { ...h.args,
    synchronizeTransactions: async () => ({ cursor: "completed", added: 2, modified: 0, removed: 0, history_complete: true }),
    refreshSubscriptions: async () => { scans += 1; if (scans === 1) throw new Error("temporary review storage outage"); return { candidates: 1 }; },
  };
  const first = await syncItemUnlocked(args);
  assert.equal(first.transactions_pending, false); assert.equal(first.history_status, "complete");
  assert.equal(first.subscriptions_pending, true); assert.equal(first.subscriptions_count, 0);
  assert.equal(h.writes.some(w => w.value.status === "needs_repair"), false);
  const saved = h.writes.find(w => w.value.transactions_cursor === "completed");
  assert(saved.value.initial_history_complete_at);
  const second = await syncItemUnlocked({ ...args, item: { ...args.item, ...saved.value } });
  assert.equal(second.subscriptions_pending, false); assert.equal(second.subscriptions_count, 1); assert.equal(scans, 2);
  assert(h.writes.every(w => w.filters.some(([key, value]) => key === "household_id" && value === "house")));
});

test("legacy and administrator items never call the new subscription pipeline", async () => {
  const h = itemHarness();
  const result = await syncItemUnlocked({ ...h.args, item: { id: "legacy", household_id: "house", status: "active" },
    synchronizeTransactions: async () => ({ cursor: "legacy", added: 0, modified: 0, removed: 0 }),
    refreshSubscriptions: async () => { throw new Error("Legacy/admin pipeline must remain untouched"); },
  });
  assert.equal(result.transactions_pending, false);
  assert.equal(Object.hasOwn(result, "subscriptions_pending"), false);
  assert.equal(h.writes.some(w => Object.hasOwn(w.value, "initial_history_complete_at")), false);
});
