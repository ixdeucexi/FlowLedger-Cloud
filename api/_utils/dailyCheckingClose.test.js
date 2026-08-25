const assert = require("node:assert/strict");
const test = require("node:test");

const {
  captureAfterCoherentHouseholdRefresh,
  captureAfterWebhookSync,
  groupItemsByHousehold,
  refreshHouseholdItems,
  tryRecordHouseholdDailyCheckingClose,
} = require("./dailyCheckingClose");

const activeItems = [
  { id: "item-a", user_id: "user-a", household_id: "house", status: "active" },
  { id: "item-b", user_id: "user-b", household_id: "house", status: "active" },
];

function rpcDatabase({ error = null, data = true } = {}) {
  const calls = [];
  return {
    calls,
    async rpc(name, args) {
      calls.push({ name, args });
      return { data, error };
    },
  };
}

test("a two-item household captures once only after both item refreshes succeed", async () => {
  const db = rpcDatabase();
  const refresh = await refreshHouseholdItems({
    items: activeItems,
    synchronize: async ({ item }) => ({
      account_observed_at: item.id === "item-a" ? "2026-08-25T03:00:00.000Z" : "2026-08-25T03:01:00.000Z",
    }),
  });
  assert.equal(refresh.failures.length, 0);
  assert.equal(await captureAfterCoherentHouseholdRefresh({ db, householdId: "house", refresh }), true);
  assert.equal(db.calls.length, 1);
  assert.deepEqual(db.calls[0].args.p_observations, [
    { item_id: "item-a", observed_at: "2026-08-25T03:00:00.000Z" },
    { item_id: "item-b", observed_at: "2026-08-25T03:01:00.000Z" },
  ]);
});

test("one failed item prevents a household snapshot even when another item succeeds", async () => {
  const db = rpcDatabase();
  const refresh = await refreshHouseholdItems({
    items: activeItems,
    synchronize: async ({ item }) => {
      if (item.id === "item-b") throw new Error("Plaid unavailable");
      return { account_observed_at: "2026-08-25T03:00:00.000Z" };
    },
  });
  assert.equal(refresh.failures.length, 1);
  assert.equal(await captureAfterCoherentHouseholdRefresh({ db, householdId: "house", refresh }), false);
  assert.equal(db.calls.length, 0);
});

test("a successful item without an account observation cannot create a close", async () => {
  const db = rpcDatabase();
  const refresh = await refreshHouseholdItems({
    items: activeItems,
    synchronize: async ({ item }) => item.id === "item-a"
      ? { account_observed_at: "2026-08-25T03:00:00.000Z" }
      : {},
  });
  assert.equal(refresh.failures.length, 0);
  assert.equal(await captureAfterCoherentHouseholdRefresh({ db, householdId: "house", refresh }), false);
  assert.equal(db.calls.length, 0);
});

test("a needs-repair item is part of a successful coherent retry", async () => {
  const db = rpcDatabase();
  const retryItems = [activeItems[0], { ...activeItems[1], status: "needs_repair" }];
  const refresh = await refreshHouseholdItems({
    items: retryItems,
    synchronize: async ({ item }) => ({
      account_observed_at: item.id === "item-a" ? "2026-08-25T03:00:00.000Z" : "2026-08-25T03:01:00.000Z",
    }),
  });
  assert.equal(await captureAfterCoherentHouseholdRefresh({ db, householdId: "house", refresh }), true);
  assert.equal(db.calls.length, 1);
  assert.equal(db.calls[0].args.p_observations.length, 2);
});

test("a failed needs-repair retry prevents the entire household close", async () => {
  const db = rpcDatabase();
  const retryItems = [activeItems[0], { ...activeItems[1], status: "needs_repair" }];
  const refresh = await refreshHouseholdItems({
    items: retryItems,
    synchronize: async ({ item }) => {
      if (item.status === "needs_repair") throw new Error("retry failed");
      return { account_observed_at: "2026-08-25T03:00:00.000Z" };
    },
  });
  assert.equal(await captureAfterCoherentHouseholdRefresh({ db, householdId: "house", refresh }), false);
  assert.equal(db.calls.length, 0);
});

test("webhooks capture single-item households and skip multi-item or disconnected households", async () => {
  const db = rpcDatabase();
  const result = { account_observed_at: "2026-08-25T03:00:00.000Z" };
  assert.equal(await captureAfterWebhookSync({ db, householdId: "house", eligibleItemCount: 2, item: activeItems[0], result }), false);
  assert.equal(await captureAfterWebhookSync({ db, householdId: "house", eligibleItemCount: 1, item: { ...activeItems[0], status: "removed" }, result }), false);
  assert.equal(await captureAfterWebhookSync({ db, householdId: "house", eligibleItemCount: 1, item: { ...activeItems[0], status: "needs_repair" }, result }), true);
  assert.equal(await captureAfterWebhookSync({ db, householdId: "house", eligibleItemCount: 1, item: activeItems[0], result }), true);
  assert.equal(db.calls.length, 2);
});

test("snapshot RPC failure is logged and remains nonfatal to the completed core sync", async () => {
  const db = rpcDatabase({ error: new Error("database unavailable") });
  const errors = [];
  const recorded = await tryRecordHouseholdDailyCheckingClose({
    db,
    householdId: "house",
    observations: [{ item_id: "item-a", observed_at: "2026-08-25T03:00:00.000Z" }],
    logger: { error: (...args) => errors.push(args) },
  });
  assert.equal(recorded, false);
  assert.equal(db.calls.length, 1);
  assert.equal(errors.length, 1);
});

test("automatic refresh grouping keeps households isolated", () => {
  const groups = groupItemsByHousehold([
    activeItems[0],
    activeItems[1],
    { id: "item-c", household_id: "other" },
    { id: "unscoped" },
  ]);
  assert.deepEqual([...groups.keys()], ["house", "other"]);
  assert.deepEqual(groups.get("house").map(item => item.id), ["item-a", "item-b"]);
});
