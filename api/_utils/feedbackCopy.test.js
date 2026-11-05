const assert = require("node:assert/strict");
const test = require("node:test");

const SOURCE_ID = "123e4567-e89b-42d3-a456-426614174000";
const OTHER_ID = "123e4567-e89b-42d3-a456-426614174001";
const ADMIN_ID = "223e4567-e89b-42d3-a456-426614174000";
const SECOND_ADMIN_ID = "323e4567-e89b-42d3-a456-426614174000";
const UPDATE_SCREEN = "Settings / Update Center";
let state;

function reset() {
  const source = {
    id: SOURCE_ID, user_id: "tester", user_email: "private-tester@example.test", user_name: "Private Tester",
    screen: "Dashboard / Bills", message: "Persisted\nfeedback stays exact.", feedback_type: "bug", rating: 2,
    status: "fixed", archived_at: "2026-10-01T00:00:00.000Z", resolved_at: "2026-09-30T00:00:00.000Z",
    admin_note: "Private tester reply", can_contact: true, submitter_notified_at: "2026-10-02T00:00:00.000Z",
    platform: "private-platform", app_version: "private-version", updated_by: "previous-admin",
  };
  state = {
    user: { id: ADMIN_ID, email: "admin@example.test", user_metadata: { full_name: "Current Admin" } },
    admins: new Set([ADMIN_ID, SECOND_ADMIN_ID]), rows: new Map([[SOURCE_ID, source]]),
    events: [], queries: [], insertAttempts: [], writes: [], pushes: [], network: [],
    adminError: null, sourceError: null, conflictReadError: null, insertError: null, onInsert: null,
  };
}

function copy(value) { return value == null ? value : structuredClone(value); }

const db = {
  from(table) {
    assert.ok(["feedback_admins", "app_feedback"].includes(table), `Unexpected table: ${table}`);
    let operation = "select", changes, filters = [], projection;
    const query = {
      select(fields) { projection = fields; return this; },
      eq(field, value) { filters.push([field, value]); return this; },
      insert(row) { operation = "insert"; changes = copy(row); return this; },
      update(row) { state.writes.push({ table, operation: "update", row }); throw new Error("Copy must never update feedback"); },
      upsert(row) { state.writes.push({ table, operation: "upsert", row }); throw new Error("Copy must use atomic insert"); },
      delete() { state.writes.push({ table, operation: "delete" }); throw new Error("Copy must never delete feedback"); },
      async maybeSingle() { return execute(); },
      async single() { return execute(); },
      then(resolve, reject) { return Promise.resolve(execute()).then(resolve, reject); },
    };
    function execute() {
      state.queries.push({ table, operation, filters: copy(filters), projection });
      state.events.push(`${table}:${operation}`);
      if (table === "feedback_admins") {
        const requestedAdmin = filters.find(([field]) => field === "user_id")?.[1];
        assert.ok(requestedAdmin, "Admin lookup must use the authenticated user");
        return { data: state.admins.has(requestedAdmin) ? { user_id: requestedAdmin } : null, error: state.adminError };
      }
      if (operation === "insert") {
        state.insertAttempts.push(copy(changes));
        if (state.onInsert) state.onInsert(changes);
        if (state.insertError) return { data: null, error: state.insertError };
        if (state.rows.has(changes.id)) return { data: null, error: { code: "23505", message: "Duplicate primary key" } };
        const row = { archived_at: null, ...changes };
        state.rows.set(row.id, row);
        state.writes.push({ table, operation: "insert", row: copy(row) });
        return { data: copy(row), error: null };
      }
      const requestedId = filters.find(([field]) => field === "id")?.[1];
      const error = requestedId === SOURCE_ID ? state.sourceError : state.conflictReadError;
      const row = [...state.rows.values()].find(candidate => filters.every(([field, value]) => candidate[field] === value));
      return { data: copy(row || null), error };
    }
    return query;
  },
  rpc() { throw new Error("Copy must never schedule work or invoke a database function"); },
};

const supabasePath = require.resolve("./supabase");
require.cache[supabasePath] = {
  id: supabasePath, filename: supabasePath, loaded: true,
  exports: {
    authenticatedUser: async req => {
      state.events.push("authenticate");
      const user = Object.hasOwn(req, "testUser") ? req.testUser : state.user;
      return { user: copy(user), error: user ? null : "AUTH_TOKEN_INVALID" };
    },
    serviceSupabase: () => db,
    safeError: (error, fallback = "Request failed.") => error?.message || fallback,
    publicError: (_error, fallback = "Request failed.") => fallback,
    bearerToken: () => null,
  },
};
const pushPath = require.resolve("./push");
require.cache[pushPath] = {
  id: pushPath, filename: pushPath, loaded: true,
  exports: { sendPushToUser: async (...args) => { state.pushes.push(args); return { delivered: 1 }; } },
};
const originalFetch = global.fetch;
global.fetch = async (...args) => { state.network.push(args); throw new Error("Network is disabled in feedback copy tests"); };
test.after(() => { global.fetch = originalFetch; });

const handler = require("../feedback");
async function request(fields = {}, user) {
  const req = { method: "POST", body: { action: "copyToUpdateCenter", feedback_id: SOURCE_ID, ...fields } };
  if (arguments.length > 1) req.testUser = user;
  const res = {
    statusCode: 0, body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  await handler(req, res);
  return res;
}

test.beforeEach(reset);
test.afterEach(() => {
  assert.deepEqual(state.pushes, [], "Copying must never notify anyone");
  assert.deepEqual(state.network, [], "All handler tests must remain offline");
  assert.ok(state.writes.every(write => write.operation === "insert" && write.row.id !== SOURCE_ID), "Only separate copies may be inserted");
});

test("feedback copy requires authentication before any database access", async () => {
  const result = await request({}, null);
  assert.equal(result.statusCode, 401);
  assert.deepEqual(state.events, ["authenticate"]);
});

test("feedback copy checks current admin membership and rejects forged admin metadata", async () => {
  state.admins.delete(ADMIN_ID);
  state.user.user_metadata.isAdmin = true;
  const result = await request({ isAdmin: true, user_id: SECOND_ADMIN_ID });
  assert.equal(result.statusCode, 403);
  assert.deepEqual(state.events, ["authenticate", "feedback_admins:select"]);
  assert.equal(state.insertAttempts.length, 0);
});

test("feedback copy admin lookup failure fails closed before source access", async () => {
  state.adminError = new Error("Admin lookup unavailable");
  assert.equal((await request()).statusCode, 500);
  assert.deepEqual(state.events, ["authenticate", "feedback_admins:select"]);
  assert.equal(state.insertAttempts.length, 0);
});

test("feedback copy reads persisted source after admin check and ignores forged copy fields", async () => {
  const before = copy(state.rows.get(SOURCE_ID));
  const result = await request({
    sourceFeedbackId: OTHER_ID, message: "Forged message", source: { message: "Forged source" },
    user_id: "attacker", user_name: "Forged Author", user_email: "attacker@example.test", screen: "Forged screen",
    feedback_type: "setup", status: "fixed", can_contact: true, archived_at: "forged", admin_note: "Forged reply",
    resolved_at: "forged", release_notes: "Forged release", submitter_notified_at: "forged",
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.alreadyExists, false);
  const inserted = state.writes[0].row;
  assert.equal(inserted.id, result.body.copiedRequest.id);
  assert.match(inserted.id, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(inserted.user_id, ADMIN_ID);
  assert.equal(inserted.screen, UPDATE_SCREEN);
  assert.equal(inserted.feedback_type, "idea");
  assert.equal(inserted.status, "new");
  assert.equal(inserted.can_contact, false);
  assert.ok(inserted.message.includes(before.message), "The complete persisted message must survive");
  assert.ok(inserted.message.includes(before.screen), "The source screen should give useful context");
  for (const value of [before.user_id, before.user_email, before.user_name, before.admin_note, before.platform, before.app_version, "Forged"])
    assert.ok(!JSON.stringify(inserted).includes(value), `Copy leaked unapproved metadata: ${value}`);
  for (const field of ["admin_note", "resolved_at", "submitter_notified_at", "rating", "release_notes"])
    assert.ok(inserted[field] == null, `Copy must not preserve ${field}`);
  assert.deepEqual(result.body.copiedRequest, { id: inserted.id, archived_at: null, status: "new" });
  assert.deepEqual(state.rows.get(SOURCE_ID), before);
  assert.deepEqual(state.events.slice(0, 3), ["authenticate", "feedback_admins:select", "app_feedback:select"]);
  assert.equal(state.writes.length, 1);
});

test("feedback copy rejects missing, malformed, and non-string source IDs", async () => {
  for (const feedback_id of [undefined, null, "", "invalid", "1".repeat(81), 123, {}, [], [SOURCE_ID], `${SOURCE_ID}extra`]) {
    reset();
    const result = await request({ feedback_id });
    assert.equal(result.statusCode, 400);
    assert.equal(state.insertAttempts.length, 0);
    assert.ok(!state.events.includes("app_feedback:select"));
  }
});

test("feedback copy fails when the source disappeared or cannot be read", async () => {
  state.rows.delete(SOURCE_ID);
  assert.equal((await request()).statusCode, 404);
  assert.equal(state.insertAttempts.length, 0);
  reset();
  state.sourceError = new Error("Source lookup unavailable");
  assert.equal((await request()).statusCode, 500);
  assert.equal(state.insertAttempts.length, 0);
});

test("feedback copy rejects recursive Update Center requests without changing them", async () => {
  state.rows.get(SOURCE_ID).screen = UPDATE_SCREEN;
  const before = copy(state.rows.get(SOURCE_ID));
  assert.equal((await request()).statusCode, 409);
  assert.equal(state.insertAttempts.length, 0);
  assert.deepEqual(state.rows.get(SOURCE_ID), before);
});

test("simultaneous copies atomically create one request and return that request to both calls", async () => {
  const before = copy(state.rows.get(SOURCE_ID));
  const results = await Promise.all([request(), request()]);
  assert.deepEqual(results.map(result => result.statusCode), [200, 200]);
  assert.deepEqual(results.map(result => result.body.alreadyExists).sort(), [false, true]);
  assert.equal(results[0].body.copiedRequest.id, results[1].body.copiedRequest.id);
  assert.equal(state.writes.length, 1);
  assert.equal(state.rows.size, 2);
  assert.deepEqual(state.rows.get(SOURCE_ID), before);
});

test("different admins save independent copies of the same source", async () => {
  const first = await request();
  const second = await request({}, { id: SECOND_ADMIN_ID, email: "second-admin@example.test" });
  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  assert.notEqual(first.body.copiedRequest.id, second.body.copiedRequest.id);
  assert.deepEqual(state.writes.map(write => write.row.user_id), [ADMIN_ID, SECOND_ADMIN_ID]);
  assert.equal(first.body.alreadyExists, false);
  assert.equal(second.body.alreadyExists, false);
});

test("uppercase and lowercase source UUIDs identify the same saved copy", async () => {
  const first = await request({ feedback_id: SOURCE_ID.toUpperCase() });
  const retry = await request();
  assert.equal(first.statusCode, 200);
  assert.equal(retry.statusCode, 200);
  assert.equal(first.body.copiedRequest.id, retry.body.copiedRequest.id);
  assert.equal(retry.body.alreadyExists, true);
  assert.equal(state.writes.length, 1);
});

test("full-length persisted messages survive exactly when source-screen context does not fit", async () => {
  for (const message of ["a".repeat(4000), "\u{1f680}".repeat(4000)]) {
    reset();
    state.rows.get(SOURCE_ID).message = message;
    const sourceBefore = copy(state.rows.get(SOURCE_ID));
    const result = await request();
    assert.equal(result.statusCode, 200);
    assert.equal(state.writes[0].row.message, message);
    assert.deepEqual(state.rows.get(SOURCE_ID), sourceBefore);
  }
});

test("copy retries preserve edited, completed, and archived requests unchanged", async () => {
  for (const existingState of [
    { status: "reviewing", archived_at: null },
    { status: "new", archived_at: "2026-11-01T00:00:00.000Z" },
    { status: "fixed", archived_at: "2026-11-01T00:00:00.000Z" },
    { status: "wont_fix", archived_at: "2026-11-01T00:00:00.000Z" },
  ]) {
    reset();
    const initial = await request();
    const saved = state.rows.get(initial.body.copiedRequest.id);
    Object.assign(saved, existingState, { message: "Admin edited the saved request", admin_note: "Completion reply" });
    const before = copy(saved);
    const retry = await request({ message: "Replacement forged on retry", status: "new", archived_at: null });
    assert.equal(retry.statusCode, 200);
    assert.equal(retry.body.alreadyExists, true);
    assert.deepEqual(retry.body.copiedRequest, { id: saved.id, ...existingState });
    assert.deepEqual(state.rows.get(saved.id), before);
    assert.equal(state.writes.length, 1);
    const reread = state.queries.filter(query => query.table === "app_feedback" && query.operation === "select").at(-1);
    assert.deepEqual(reread.filters, [["id", saved.id], ["user_id", ADMIN_ID], ["screen", UPDATE_SCREEN]]);
  }
});

test("duplicate insert conflicts require an exact copy ID, current owner, and Update Center screen", async () => {
  for (const conflict of [{ user_id: SECOND_ADMIN_ID }, { screen: "Settings / Help & Feedback" }, { id: OTHER_ID }, null]) {
    reset();
    state.insertError = { code: "23505", message: "Unrelated unique constraint" };
    state.onInsert = row => { if (conflict) state.rows.set(conflict.id || row.id, { ...row, ...conflict }); };
    const result = await request();
    assert.ok([409, 500].includes(result.statusCode));
    assert.ok(!result.body.copiedRequest);
    assert.equal(state.writes.length, 0);
    const attempted = state.insertAttempts[0];
    const reread = state.queries.filter(query => query.table === "app_feedback" && query.operation === "select").at(-1);
    assert.deepEqual(reread.filters, [["id", attempted.id], ["user_id", ADMIN_ID], ["screen", UPDATE_SCREEN]]);
  }
});

test("insert failures and duplicate-conflict reread failures return an error without modifying source", async () => {
  const before = copy(state.rows.get(SOURCE_ID));
  state.insertError = { code: "XX000", message: "Insert unavailable" };
  assert.equal((await request()).statusCode, 500);
  assert.deepEqual(state.rows.get(SOURCE_ID), before);
  assert.equal(state.writes.length, 0);
  reset();
  const initial = await request();
  const savedBefore = copy(state.rows.get(initial.body.copiedRequest.id));
  state.conflictReadError = new Error("Retry lookup unavailable");
  assert.equal((await request()).statusCode, 500);
  assert.deepEqual(state.rows.get(initial.body.copiedRequest.id), savedBefore);
  assert.equal(state.writes.length, 1);
});
