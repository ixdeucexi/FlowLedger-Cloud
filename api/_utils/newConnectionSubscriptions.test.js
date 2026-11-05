const assert = require("node:assert/strict");
const test = require("node:test");
const { detectSubscriptions } = require("../../artifacts/mobile/lib/subscriptionDetector");
const { candidatePayloads, refreshNewConnectionSubscriptions, stableSubscriptionId, subscriptionEvidence } = require("./newConnectionSubscriptions");

const HOUSE = "11111111-1111-4111-8111-111111111111";
const ITEM = "22222222-2222-4222-8222-222222222222";
const USER = "new-pro-user";
function row(id, extra = {}) {
  return { id, household_id: HOUSE, plaid_account_id: "account", plaid_transaction_id: id,
    flowledger_transaction_id: `cash-${id}`, transaction_date: id.endsWith("2") ? "2026-10-05" : "2026-09-05",
    amount: -14.99, merchant_name: "Netflix", name: `Electronic Withdrawal ref ${id}`,
    category: "Entertainment", pending: false, removed_at: null, raw: {}, ...extra };
}
function database(overrides = {}) {
  const tables = {
    feedback_admins: [],
    plaid_items: [{ id: ITEM, user_id: USER, household_id: HOUSE, initial_import_version: 1, status: "active" }],
    plaid_accounts: [{ id: "account", household_id: HOUSE, plaid_item_record_id: ITEM, is_active: true }],
    plaid_transactions: [row("n1"), row("n2")],
    transactions: ["n1", "n2"].map(id => ({ id: `cash-${id}`, household_id: HOUSE, category: "Other", review_status: "needs_review" })),
    ...overrides,
  };
  const calls = [], writes = [];
  return { tables, calls, writes,
    from(table) {
      assert(Object.hasOwn(tables, table), `Unexpected table ${table}`);
      const filters = [];
      const query = {
        select() { return query; },
        eq(k, v) { filters.push(r => r[k] === v); return query; },
        in(k, values) { filters.push(r => values.includes(r[k])); return query; },
        is(k, value) { filters.push(r => (r[k] ?? null) === value); return query; },
        order() { return query; },
        async maybeSingle() { calls.push(table); return { data: tables[table].filter(r => filters.every(fn => fn(r)))[0] || null, error: null }; },
        async range(start, end) { calls.push(table); return { data: tables[table].filter(r => filters.every(fn => fn(r))).slice(start, end + 1), error: null }; },
      };
      return query;
    },
    async rpc(name, args) { assert.equal(name, "merge_new_connection_subscription_candidates"); writes.push(args); return { data: { saved: args.p_candidates.length }, error: null }; },
  };
}

test("shared detector retains monthly, weekly, annual and provisional confidence rules", () => {
  const monthly = detectSubscriptions([
    { id: "a", date: "2026-09-01", amount: -15.99, description: "Netflix" },
    { id: "b", date: "2026-10-01", amount: -17.99, description: "Netflix" },
    { id: "c", date: "2026-11-01", amount: -17.99, description: "Netflix" },
  ])[0];
  assert.equal(monthly.cadence, "monthly"); assert.equal(monthly.confidence, "high");
  assert.equal(monthly.averageAmount, 17.32); assert.equal(monthly.priceIncrease, true);
  assert.equal(detectSubscriptions([{ id: "one", date: "2026-11-01", amount: -9.99, description: "Spotify" }])[0].confidence, "medium");
  assert.equal(detectSubscriptions([{ id: "one", date: "2026-11-01", amount: -9.99, description: "Unknown shop" }]).length, 0);
  for (const [dates, expected] of [[['2026-10-01','2026-10-08'], 'weekly'], [['2025-10-01','2026-10-01'], 'annual']]) {
    assert.equal(detectSubscriptions(dates.map((date, i) => ({ id: String(i), date, amount: -10, description: "Membership" })))[0].cadence, expected);
  }
});

test("stable merchant input includes posted needs-review charges without changing cash data", async () => {
  const db = database(); const result = await refreshNewConnectionSubscriptions({ db, userId: USER, item: db.tables.plaid_items[0] });
  assert.equal(result.candidates, 1); assert.equal(db.writes.length, 1);
  const payload = db.writes[0]; assert.equal(payload.p_household_id, HOUSE); assert.equal(payload.p_item_id, ITEM);
  assert.equal(payload.p_candidates[0].merchant, "netflix"); assert.equal(payload.p_candidates[0].cadence, "monthly");
  assert.deepEqual(payload.p_candidates[0].source_transaction_ids, ["cash-n1", "cash-n2"]);
  assert.deepEqual(payload.p_candidates[0].source_plaid_transaction_ids, ["n1", "n2"]);
  assert(!Object.hasOwn(payload.p_candidates[0], "status"), "Atomic RPC owns review-only preservation");
  assert.equal(db.tables.transactions.length, 2);
});

test("credit purchases supply review evidence without invented canonical transaction IDs", async () => {
  const db = database({ plaid_transactions: [row("c1", { flowledger_transaction_id: null }), row("c2", { flowledger_transaction_id: null })], transactions: [] });
  await refreshNewConnectionSubscriptions({ db, userId: USER, item: db.tables.plaid_items[0] });
  assert.deepEqual(db.writes[0].p_candidates[0].source_transaction_ids, []);
  assert.deepEqual(db.writes[0].p_candidates[0].source_plaid_transaction_ids, ["c1", "c2"]);
  assert.equal(db.tables.transactions.length, 0);
});

test("pending, removed, deleted, transfer and debt-payment motions are excluded", () => {
  for (const extra of [{ pending: true }, { removed_at: "2026-10-05" }, { amount: 15 }, { category: "Transfer" }, { category: "Debt" }, { raw: { personal_finance_category: { primary: "TRANSFER_OUT" } } }, { raw: { personal_finance_category: { primary: "LOAN_PAYMENTS" } } }]) {
    assert.equal(subscriptionEvidence(row("n1", extra), { id: "cash-n1" }), null);
  }
  for (const extra of [{ deleted_at: "2026-10-05" }, { removed_at: "2026-10-05" }, { pending: true }, { review_status: "transfer" }, { transfer_group_id: "group" }, { debt_applied_bill_id: "debt" }]) {
    assert.equal(subscriptionEvidence(row("n1"), { id: "cash-n1", ...extra }), null);
  }
  assert(subscriptionEvidence(row("n1"), { id: "cash-n1", review_status: "needs_review" }));
});

test("legacy, removed and actual-admin connections perform no candidate writes", async () => {
  for (const item of [{ initial_import_version: null }, { initial_import_version: 1, status: "removed" }]) {
    const db = database(); assert.deepEqual(await refreshNewConnectionSubscriptions({ db, userId: USER, item: { household_id: HOUSE, ...item } }), { candidates: 0, skipped: true });
    assert.equal(db.calls.length, 0); assert.equal(db.writes.length, 0);
  }
  const db = database({ feedback_admins: [{ user_id: USER }] });
  assert.deepEqual(await refreshNewConnectionSubscriptions({ db, userId: USER, item: db.tables.plaid_items[0] }), { candidates: 0, skipped: true });
  assert.deepEqual(db.calls, ["feedback_admins"]); assert.equal(db.writes.length, 0);
});

test("old or admin-owned items never enter a new connection's evidence feed", async () => {
  const db = database();
  db.tables.plaid_items.push({ id: "legacy", household_id: HOUSE, user_id: USER, initial_import_version: null, status: "active" },
    { id: "admin-item", household_id: HOUSE, user_id: "admin", initial_import_version: 1, status: "active" });
  db.tables.feedback_admins.push({ user_id: "admin" });
  db.tables.plaid_accounts.push({ id: "old-account", household_id: HOUSE, plaid_item_record_id: "legacy", is_active: true },
    { id: "admin-account", household_id: HOUSE, plaid_item_record_id: "admin-item", is_active: true });
  db.tables.plaid_transactions.push(row("old", { plaid_account_id: "old-account", merchant_name: "Spotify", flowledger_transaction_id: null }),
    row("admin", { plaid_account_id: "admin-account", merchant_name: "Hulu", flowledger_transaction_id: null }));
  await refreshNewConnectionSubscriptions({ db, userId: USER, item: db.tables.plaid_items[0] });
  assert.deepEqual(db.writes[0].p_candidates.map(c => c.merchant), ["netflix"]);
});

test("complete paging reads more than1000 retained transactions and bounds evidence arrays", async () => {
  const rows = Array.from({ length: 1201 }, (_, i) => row(`large-${i}`, { flowledger_transaction_id: null, transaction_date: "2026-10-05" }));
  const db = database({ plaid_transactions: rows, transactions: [] });
  await refreshNewConnectionSubscriptions({ db, userId: USER, item: db.tables.plaid_items[0] });
  assert.equal(db.calls.filter(t => t === "plaid_transactions").length, 3);
  assert.equal(db.writes[0].p_candidates[0].source_plaid_transaction_ids.length, 500);
});

test("missing canonical rows do not resurrect as raw evidence", async () => {
  const db = database({ transactions: [] });
  const result = await refreshNewConnectionSubscriptions({ db, userId: USER, item: db.tables.plaid_items[0] });
  assert.equal(result.candidates, 0); assert.equal(db.writes.length, 0);
});

test("candidate refresh errors propagate for a later metadata retry", async () => {
  const db = database(); db.rpc = async () => ({ error: new Error("Temporary candidate save failure") });
  await assert.rejects(refreshNewConnectionSubscriptions({ db, userId: USER, item: db.tables.plaid_items[0] }), /Temporary candidate save failure/);
});

test("candidate IDs and normalized merchant keys are deterministic across retries", () => {
  const source = [subscriptionEvidence(row("n1"), { id: "cash-n1" }), subscriptionEvidence(row("n2"), { id: "cash-n2" })];
  assert.deepEqual(candidatePayloads(source, HOUSE), candidatePayloads(source, HOUSE));
  assert.match(stableSubscriptionId(`subscription:${HOUSE}:netflix`), /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-a[a-f0-9]{3}-[a-f0-9]{12}$/);
});
