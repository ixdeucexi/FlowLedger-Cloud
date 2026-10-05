const assert = require("node:assert/strict");
const test = require("node:test");
const supabasePath = require.resolve("./supabase");
const original = require("./supabase");
let user = null;
let admin = false;
let adminError = null;
let writes = [];
const db = {
  from(table) {
    if (table === "feedback_admins") return {
      select() { return this; }, eq(field, id) { assert.equal(field, "user_id"); assert.equal(id, user.id); return this; },
      async maybeSingle() { return { data: admin ? { user_id: user.id } : null, error: adminError }; },
    };
    if (table === "app_feedback") return {
      insert(row) { writes.push(row); return this; }, select() { return this; },
      async single() { return { data: { id: "saved-id", feedback_type: "idea" }, error: null }; },
    };
    throw new Error(`Unexpected table ${table}`);
  },
};
require.cache[supabasePath].exports = { ...original,
  authenticatedUser: async () => ({ user, error: user ? null : "AUTH_TOKEN_INVALID" }),
  serviceSupabase: () => db,
};
const handler = require("../feedback");
function response() { return { statusCode: 0, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } }; }
async function request() {
  const res = response();
  await handler({ method: "POST", body: { screen: "Settings / Update Center", message: "Make this button clearer", user_id: "spoofed", feedback_type: "bug", can_contact: true } }, res);
  return res;
}
test("Update Center POST rejects signed-out users without writing", async () => {
  user = null; writes = [];
  assert.equal((await request()).statusCode, 401); assert.equal(writes.length, 0);
});
test("Update Center POST rejects a non-admin even with a forged marker", async () => {
  user = { id: "ordinary", user_metadata: { isAdmin: true } }; admin = false; writes = [];
  assert.equal((await request()).statusCode, 403); assert.equal(writes.length, 0);
});
test("Update Center admin lookup errors fail closed", async () => {
  adminError = new Error("offline"); writes = [];
  assert.equal((await request()).statusCode, 500); assert.equal(writes.length, 0); adminError = null;
});
test("Update Center saves authorized owner identity and no automatic notification/job", async () => {
  user = { id: "owner", email: "owner@example.test" }; admin = true; writes = [];
  assert.equal((await request()).statusCode, 201);
  assert.equal(writes.length, 1); assert.equal(writes[0].user_id, "owner");
  assert.equal(writes[0].feedback_type, "idea"); assert.equal(writes[0].can_contact, false);
});
