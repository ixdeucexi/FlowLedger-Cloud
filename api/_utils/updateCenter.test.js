const assert = require("node:assert/strict");
const test = require("node:test");
const supabasePath = require.resolve("./supabase");
const original = require("./supabase");
const id = "123e4567-e89b-42d3-a456-426614174000";
const marker = "Settings / Update Center";
let user, admin, adminError, record, writes, lookups, race, lookupError, writeError;
function reset() {
  user = { id: "owner", email: "owner@example.test" }; admin = true; adminError = null;
  record = { id, user_id: "owner", screen: marker, message: "Original request", status: "reviewing", archived_at: null,
    admin_note: "Under review", resolved_at: null, created_at: "2026-10-05", can_contact: false };
  writes = []; lookups = []; race = false; lookupError = null; writeError = null;
}
const db = {
  from(table) {
    let operation = "select", changes, filters = [];
    const matches = row => row && filters.every(([field, value, mode]) => mode === "in" ? value.includes(row[field]) : row[field] === value);
    return {
      select() { return this; }, eq(field, value) { filters.push([field, value]); return this; },
      in(field, value) { filters.push([field, value, "in"]); return this; }, is(field, value) { filters.push([field, value]); return this; },
      insert(row) { operation = "insert"; changes = row; return this; }, update(row) { operation = "update"; changes = row; return this; },
      delete() { throw new Error("Update Center must never physically delete requests"); },
      async maybeSingle() {
        if (table === "feedback_admins") return { data: admin ? { user_id: user.id } : null, error: adminError };
        assert.equal(table, "app_feedback");
        if (operation === "select") { lookups.push(filters); return { data: matches(record) ? { ...record } : null, error: lookupError }; }
        if (race) record.status = "fixed";
        writes.push({ changes, filters });
        if (writeError) return { data: null, error: writeError };
        if (!matches(record)) return { data: null, error: null };
        record = { ...record, ...changes }; return { data: { ...record }, error: null };
      },
      async single() { assert.equal(operation, "insert"); writes.push({ changes, filters }); return { data: { id, feedback_type: "idea" }, error: null }; },
    };
  },
};
require.cache[supabasePath].exports = { ...original,
  authenticatedUser: async () => ({ user, error: user ? null : "AUTH_TOKEN_INVALID" }), serviceSupabase: () => db,
};
const handler = require("../feedback");
async function request(body = { screen: marker, message: "Make this button clearer", user_id: "spoofed", feedback_type: "bug", can_contact: true }) {
  const res = { statusCode: 0, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await handler({ method: "POST", body }, res); return res;
}
test("Update Center POST rejects signed-out users without writing", async () => {
  reset(); user = null; assert.equal((await request()).statusCode, 401); assert.equal(writes.length, 0);
});
test("Update Center POST rejects a non-admin even with forged metadata", async () => {
  reset(); user = { id: "ordinary", user_metadata: { isAdmin: true } }; admin = false;
  assert.equal((await request()).statusCode, 403); assert.equal(writes.length, 0);
});
test("Update Center admin lookup errors fail closed", async () => {
  reset(); adminError = new Error("offline"); assert.equal((await request()).statusCode, 500); assert.equal(writes.length, 0);
});
test("Update Center saves authorized identity and no automatic notification/job", async () => {
  reset(); assert.equal((await request()).statusCode, 201); assert.equal(writes.length, 1);
  assert.equal(writes[0].changes.user_id, "owner"); assert.equal(writes[0].changes.feedback_type, "idea"); assert.equal(writes[0].changes.can_contact, false);
});
for (const action of ["edit_request", "delete_request", "restore_request"]) {
  test(`${action} requires authentication and admin membership`, async () => {
    reset(); user = null; assert.equal((await request({ action, feedback_id: id, message: "New request" })).statusCode, 401);
    reset(); admin = false; assert.equal((await request({ action, feedback_id: id, message: "New request" })).statusCode, 403); assert.equal(writes.length, 0);
  });
  test(`${action} rejects other authors and ordinary feedback without writes`, async () => {
    for (const changes of [{ user_id: "other-admin" }, { screen: "Settings / Help & Feedback" }]) {
      reset(); Object.assign(record, changes);
      assert.equal((await request({ action, feedback_id: id, message: "New request", user_id: "other-admin", screen: marker })).statusCode, 404); assert.equal(writes.length, 0);
    }
  });
  test(`${action} preserves completed history and fails closed on lookup errors`, async () => {
    for (const status of ["fixed", "wont_fix"]) {
      reset(); record.status = status;
      assert.equal((await request({ action, feedback_id: id, message: "New request" })).statusCode, 409); assert.equal(writes.length, 0);
    }
    reset(); adminError = new Error("offline");
    assert.equal((await request({ action, feedback_id: id, message: "New request" })).statusCode, 500); assert.equal(writes.length, 0);
  });
  test(`${action} rejects malformed id`, async () => {
    reset(); assert.equal((await request({ action, feedback_id: "bad", message: "New request" })).statusCode, 400); assert.equal(writes.length, 0);
  });
}
test("editing sanitizes message, preserves multiline and fields, and scopes read and write", async () => {
  reset(); const before = { ...record };
  const res = await request({ action: "edit_request", feedback_id: id, message: "  New\nrequest  ", status: "fixed", user_id: "attacker", admin_note: "tamper" });
  assert.equal(res.statusCode, 200); assert.equal(record.message, "New\nrequest"); assert.equal(record.updated_by, "owner"); assert.ok(record.updated_at);
  for (const field of ["user_id", "screen", "status", "admin_note", "archived_at", "resolved_at", "created_at", "can_contact"]) assert.equal(record[field], before[field]);
  for (const filters of [lookups[0], writes[0].filters]) {
    assert.ok(filters.some(([f, v]) => f === "id" && v === id)); assert.ok(filters.some(([f, v]) => f === "user_id" && v === "owner")); assert.ok(filters.some(([f, v]) => f === "screen" && v === marker));
  }
});
test("editing rejects invalid messages without truncating or writing", async () => {
  for (const message of ["no", "  ", "x".repeat(4001), null, {}, 123]) {
    reset(); assert.equal((await request({ action: "edit_request", feedback_id: id, message })).statusCode, 400); assert.equal(writes.length, 0);
  }
});
test("delete archives pending work and restore clears only archive and audit fields", async () => {
  reset(); const before = { ...record };
  assert.equal((await request({ action: "delete_request", feedback_id: id })).statusCode, 200); assert.ok(record.archived_at);
  assert.equal((await request({ action: "restore_request", feedback_id: id })).statusCode, 200); assert.equal(record.archived_at, null);
  for (const field of ["message", "status", "admin_note", "resolved_at", "created_at", "user_id", "screen"]) assert.equal(record[field], before[field]);
});
test("deleted pending request cannot edit until restored", async () => {
  reset(); record.archived_at = "2026-10-05";
  assert.equal((await request({ action: "edit_request", feedback_id: id, message: "New request" })).statusCode, 409); assert.equal(writes.length, 0);
});
test("completion between read and write cannot overwrite completed history", async () => {
  for (const action of ["edit_request", "delete_request", "restore_request"]) {
    reset(); race = true;
    assert.equal((await request({ action, feedback_id: id, message: "New request" })).statusCode, 409);
    assert.equal(record.message, "Original request"); assert.equal(record.status, "fixed"); assert.equal(record.archived_at, null);
  }
});
test("lookup and write failures report failure without altering saved request", async () => {
  for (const action of ["edit_request", "delete_request", "restore_request"]) {
    reset(); lookupError = new Error("offline");
    assert.equal((await request({ action, feedback_id: id, message: "New request" })).statusCode, 500); assert.equal(writes.length, 0);
    reset(); writeError = new Error("offline"); const before = { ...record };
    assert.equal((await request({ action, feedback_id: id, message: "New request" })).statusCode, 500); assert.deepEqual(record, before);
  }
});
test("new requests can edit, delete and restore without changing new status", async () => {
  reset(); record.status = "new";
  for (const action of ["edit_request", "delete_request", "restore_request"]) {
    assert.equal((await request({ action, feedback_id: id, message: "New request" })).statusCode, 200); assert.equal(record.status, "new");
  }
});
