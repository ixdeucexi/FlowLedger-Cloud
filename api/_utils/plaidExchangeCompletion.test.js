const assert = require("node:assert/strict");
const test = require("node:test");
const { sealPlaidLinkSession } = require("./crypto");
const { aggregateConnections, createExchangePublicTokenHandler } = require("../plaid/exchange-public-token");

const previousKey = process.env.PLAID_TOKEN_ENCRYPTION_KEY;
process.env.PLAID_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 31).toString("base64");
test.after(() => {
  if (previousKey == null) delete process.env.PLAID_TOKEN_ENCRYPTION_KEY;
  else process.env.PLAID_TOKEN_ENCRYPTION_KEY = previousKey;
});

function sealedSession(change = {}) {
  return sealPlaidLinkSession({ version: 1, intent: "bank", linkToken: "link-fixture-secret",
    userId: "fixture-user", householdId: "fixture-house", expiresAt: new Date(Date.now() + 600_000).toISOString(), ...change });
}

const finished = { finished_at: "2026-11-05T17:00:00Z", results: null, on_success: null, exit: null, on_exit: null };
const success = { request_id: "fixture_request_id", link_sessions: [{ ...finished,
  results: { item_add_results: [{ public_token: "public-fixture-secret" }] } }] };

function subject(options = {}) {
  const rows = {
    plaid_items: [
      { id: "fixture-item", user_id: "fixture-user", household_id: "fixture-house", status: "active", institution_id: "fixture-bank", institution_name: "Fictional bank", initial_import_version: null, cursor: "legacy-cursor", transactions_cursor: "legacy-cursor" },
      { id: "foreign-item", user_id: "other-user", household_id: "other-house", status: "active", institution_id: "fixture-bank" },
      { id: "admin-item", user_id: "admin-user", household_id: "admin-house", status: "active", initial_import_version: null, cursor: "admin-cursor", transactions_cursor: "admin-cursor" },
    ],
    plaid_accounts: [
      { id: "fixture-account", user_id: "fixture-user", household_id: "fixture-house", plaid_item_record_id: "fixture-item", persistent_account_id: "fixture-persistent", is_active: true },
      { id: "inactive-account", user_id: "fixture-user", household_id: "fixture-house", plaid_item_record_id: "fixture-item", is_active: false },
      { id: "foreign-account", user_id: "other-user", household_id: "other-house", plaid_item_record_id: "foreign-item", persistent_account_id: "fixture-persistent", is_active: true },
    ],
  };
  if (options.rows) Object.assign(rows, options.rows);
  const calls = [], links = [], exchanges = [], diagnostics = [];
  const database = {
    from(table) {
      assert(["plaid_items", "plaid_accounts"].includes(table), "Completion attestation reads only connection records");
      const filters = []; let selection = {};
      const run = () => {
        calls.push({ table, filters: [...filters], selection });
        if (options.failTable === table) return { data: null, count: null, error: new Error("Fictional database failure") };
        const data = rows[table].filter(row => filters.every(([operator, key, value]) => operator === "eq" ? row[key] === value : value.includes(row[key])));
        return { data: structuredClone(data), count: data.length, error: null };
      };
      const chain = {
        select(columns, config = {}) { selection = { columns, ...config }; return chain; },
        eq(key, value) { filters.push(["eq", key, value]); return chain; },
        in(key, value) { filters.push(["in", key, value]); return chain; },
        async maybeSingle() { const result = run(); return { ...result, data: result.data?.[0] || null }; },
        then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject); },
      };
      return chain;
    },
  };
  const handler = createExchangePublicTokenHandler({
    authenticatedUser: async () => options.signedOut ? { user: null, error: "SIGNED_OUT" } : { user: { id: "fixture-user" } },
    authorizeProHousehold: async () => options.denied ? { ok: false, status: 403, error: "PRO_PLAN_REQUIRED", message: "Pro required" } : { ok: true, householdId: "fixture-house" },
    serviceSupabase: () => database,
    plaid: () => ({ async linkTokenGet(input) {
      links.push(input);
      return { data: options.linkResponses?.shift() || success };
    } }),
    connectPlaidPublicToken: async input => {
      exchanges.push(input);
      if (options.exchangeError) throw options.exchangeError;
      if (options.results?.length) return options.results.shift();
      return options.result === undefined ? { item_id: "fixture-item", accounts_count: 2, transactions_count: 7,
        transactions_pending: true, history_status: "importing", subscriptions_pending: true } : options.result;
    },
    completionDiagnostic: entry => diagnostics.push(entry),
  });
  const request = async (body = { hosted_session: sealedSession() }, method = "POST") => {
    const response = { code: 0, data: null, status(code) { this.code = code; return this; }, json(data) { this.data = data; return this; } };
    await handler({ method, body }, response);
    return response;
  };
  return { request, rows, calls, links, exchanges, diagnostics };
}

test("the route keeps finished null-callback sessions pending across polls until results arrive", async () => {
  const pending = { request_id: "fixture_request_id", link_sessions: [finished] };
  const s = subject({ linkResponses: [pending, pending, success] });
  const session = sealedSession();
  for (let poll = 0; poll < 2; poll++) {
    const response = await s.request({ hosted_session: session });
    assert.equal(response.code, 202);
    assert.equal(response.data.status, "pending");
    assert.equal(s.exchanges.length, 0);
    assert.equal(s.calls.length, 0, "Polling must not write or query financial records");
  }
  const response = await s.request({ hosted_session: session });
  assert.equal(response.code, 200);
  assert.equal(response.data.status, "connected");
  assert.equal(response.data.connection_saved, true);
  assert.equal(response.data.accounts_count, 1, "The database, not the claimed provider count, attests active accounts");
  assert.deepEqual(response.data.item_ids, ["fixture-item"]);
  assert.equal(response.data.history_status, "importing");
  assert.equal(response.data.transactions_pending, true);
  assert.equal(response.data.subscriptions_pending, true);
  assert.equal(s.exchanges.length, 1);
  assert(s.links.every(input => input.link_token === "link-fixture-secret"));
  for (const call of s.calls) {
    assert(call.filters.some(([op, field, value]) => op === "eq" && field === "user_id" && value === "fixture-user"));
    assert(call.filters.some(([op, field, value]) => op === "eq" && field === "household_id" && value === "fixture-house"));
  }
});

test("explicit exits return a cancellation without exchanging or touching saved connections", async () => {
  for (const exitField of ["exit", "on_exit"]) {
    const s = subject({ linkResponses: [{ link_sessions: [{ ...finished, [exitField]: {} }] }] });
    const response = await s.request();
    assert.equal(response.code, 409);
    assert.equal(response.data.error, "PLAID_LINK_EXITED");
    assert.equal(s.exchanges.length, 0);
    assert.equal(s.calls.length, 0);
  }
});

test("aggregate completion rejects empty, negative, malformed, and unverified results", () => {
  const valid = { item_id: "fixture-item", accounts_count: 1, connection_saved: true };
  for (const results of [[], null, [{}], [{ ...valid, ok: false }], [{ ...valid, item_id: "" }],
    [{ ...valid, connection_saved: false }], [{ ...valid, accounts_count: undefined }], [{ ...valid, accounts_count: "1" }],
    [{ ...valid, accounts_count: NaN }], [{ ...valid, accounts_count: Infinity }], [{ ...valid, accounts_count: -1 }],
    [{ ...valid, accounts_count: 1.1 }], [{ ...valid, transactions_count: -1 }],
    [{ ...valid, item_ids: ["different-item"] }],
    [{ ...valid, accounts_count: Number.MAX_SAFE_INTEGER }, valid]]) {
    assert.throws(() => aggregateConnections(results), error => error.code === "PLAID_CONNECTION_UNVERIFIED");
  }
  assert.equal(aggregateConnections([valid]).status, "connected");
  assert.equal(aggregateConnections([{ ...valid, already_connected: true }]).status, "already_connected");
  assert.equal(aggregateConnections([{ ...valid, accounts_count: 0 }]).status, "accounts_pending");
  assert.equal(aggregateConnections([valid, { ...valid, item_id: "second-item", accounts_count: 0 }]).status, "accounts_pending");
});

test("a valid saved zero-account Item has a distinct recoverable state and remains saved", async () => {
  const s = subject();
  s.rows.plaid_accounts = s.rows.plaid_accounts.filter(account => account.user_id !== "fixture-user");
  const before = structuredClone(s.rows);
  const response = await s.request();
  assert.equal(response.code, 200);
  assert.equal(response.data.status, "accounts_pending");
  assert.equal(response.data.connection_saved, true);
  assert.equal(response.data.accounts_count, 0);
  assert.deepEqual(response.data.item_ids, ["fixture-item"]);
  assert.deepEqual(s.rows, before);
  assert.equal(s.exchanges.length, 1);
});

test("multi-Item completion keeps a partial account setup pending even with another ready Item", async () => {
  const s = subject({ results: [{ item_id: "fixture-item", accounts_count: 1 }, { item_id: "second-item", accounts_count: 0 }],
    linkResponses: [{ link_sessions: [{ results: { item_add_results: [
      { public_token: "public-fixture-one" }, { public_token: "public-fixture-two" },
    ] } }] }] });
  s.rows.plaid_items.push({ id: "second-item", user_id: "fixture-user", household_id: "fixture-house", status: "active" });
  const response = await s.request();
  assert.equal(response.code, 200);
  assert.equal(response.data.status, "accounts_pending");
  assert.equal(response.data.connection_saved, true);
  assert.equal(response.data.accounts_count, 1);
  assert.deepEqual(response.data.item_ids, ["fixture-item", "second-item"]);
  assert.equal(s.exchanges.length, 2);
});

test("malformed connector results and foreign or removed saved Items never publish success", async () => {
  for (const result of [{}, { ok: false }, { ok: false, item_id: "fixture-item", accounts_count: 1 }, { item_id: "fixture-item", accounts_count: -1 },
    { item_id: "foreign-item", accounts_count: 1 }, { item_id: "missing-item", accounts_count: 1 }]) {
    const s = subject({ result });
    assert.equal((await s.request()).code, 500);
  }
  const removed = subject();
  removed.rows.plaid_items[0].status = "removed";
  assert.equal((await removed.request()).code, 500);
  for (const table of ["plaid_items", "plaid_accounts"]) {
    assert.equal((await subject({ failTable: table }).request()).code, 500);
  }
});

test("canonical dedup completion proves retained same-owner same-household accounts", async () => {
  const s = subject({ result: { item_id: "fixture-item", accounts_count: 1, already_connected: true } });
  s.rows.plaid_items[0].status = "removed";
  s.rows.plaid_accounts[0].is_active = false;
  s.rows.plaid_accounts = s.rows.plaid_accounts.filter(account => account.id !== "inactive-account");
  s.rows.plaid_items.push({ id: "canonical-item", user_id: "fixture-user", household_id: "fixture-house", status: "active", institution_id: "fixture-bank", institution_name: "Fictional bank" });
  s.rows.plaid_accounts.push({ id: "canonical-account", user_id: "fixture-user", household_id: "fixture-house", plaid_item_record_id: "canonical-item", persistent_account_id: "fixture-persistent", is_active: true });
  const before = structuredClone(s.rows);
  const response = await s.request();
  assert.equal(response.code, 200);
  assert.equal(response.data.status, "already_connected");
  assert.equal(response.data.item_id, "canonical-item");
  assert.deepEqual(response.data.item_ids, ["canonical-item"]);
  assert.equal(response.data.accounts_count, 1);
  assert.deepEqual(s.rows, before, "Attestation never modifies canonical, admin, or other records");
  for (const foreignScope of [{ user_id: "other-user" }, { household_id: "other-house" }, { is_active: false }]) {
    Object.assign(s.rows.plaid_accounts.at(-1), { user_id: "fixture-user", household_id: "fixture-house", is_active: true }, foreignScope);
    assert.equal((await s.request()).code, 500);
  }
});

test("session binding, authorization, and input guards prevent provider and database access", async () => {
  for (const [options, input, code] of [
    [{ signedOut: true }, { hosted_session: sealedSession() }, 401],
    [{ denied: true }, { hosted_session: sealedSession() }, 403],
    [{}, { hosted_session: sealedSession({ userId: "other-user" }) }, 400],
    [{}, { hosted_session: sealedSession({ householdId: "other-house" }) }, 400],
    [{}, { hosted_session: sealedSession({ expiresAt: "2020-01-01T00:00:00Z" }) }, 400],
    [{}, {}, 400], [{}, { public_token: "public-fixture", hosted_session: sealedSession() }, 400],
  ]) {
    const s = subject(options);
    assert.equal((await s.request(input)).code, code);
    assert.equal(s.links.length, 0);
    assert.equal(s.exchanges.length, 0);
    assert.equal(s.calls.length, 0);
  }
});

test("inline completion keeps the same contract without changing legacy/admin import state", async () => {
  const s = subject();
  const before = structuredClone(s.rows);
  const response = await s.request({ public_token: "public-fixture-inline" });
  assert.equal(response.code, 200);
  assert.equal(response.data.status, "connected");
  assert.equal(s.links.length, 0);
  assert.equal(s.exchanges.length, 1);
  assert.deepEqual(s.rows, before);
});

test("operational diagnostics contain only classifications, counts, and sanitized request IDs", async () => {
  const s = subject();
  await s.request();
  assert(s.diagnostics.length > 0);
  for (const entry of s.diagnostics) {
    assert.deepEqual(Object.keys(entry).sort(), ["classification", "provider_request_id", "public_token_count", "session_count"]);
    assert.equal(entry.provider_request_id, "fixture_request_id");
    assert.equal(entry.public_token_count, 1);
    assert.equal(entry.session_count, 1);
  }
  assert(!JSON.stringify(s.diagnostics).includes("secret"));
  const malicious = subject({ linkResponses: [{ ...success, request_id: "public-do-not-log" }] });
  await malicious.request();
  assert(malicious.diagnostics.every(entry => entry.provider_request_id === null));
});

test("failed completion diagnostics include only bounded uppercase error codes", async () => {
  for (const code of ["23514", "INVALID_PUBLIC_TOKEN", "PLAID_CONNECTION_UNVERIFIED"]) {
    const s = subject({ exchangeError: { response: { data: { error_code: code, message: "private-error-bait", public_token: "public-private-bait" } } } });
    assert.equal((await s.request()).code, 500);
    const diagnostic = s.diagnostics.at(-1);
    assert.equal(diagnostic.classification, "failed");
    assert.equal(diagnostic.error_code, code);
    assert.deepEqual(Object.keys(diagnostic).sort(), ["classification", "error_code", "provider_request_id", "public_token_count", "session_count"]);
    assert(!JSON.stringify(s.diagnostics).includes("private"));
  }
  for (const code of ["access-sandbox-private-bait", "sk-private-key-bait", "TOKEN\nprivate-bait", "X".repeat(81),
    { access_token: "private-bait" }, 23514, ["INVALID_PUBLIC_TOKEN"]]) {
    const s = subject({ exchangeError: { code, message: "private-message-bait" } });
    assert.equal((await s.request()).code, 500);
    const diagnostic = s.diagnostics.at(-1);
    assert.equal(diagnostic.classification, "failed");
    assert(!Object.hasOwn(diagnostic, "error_code"));
    assert(!JSON.stringify(s.diagnostics).includes("private"));
  }
});
