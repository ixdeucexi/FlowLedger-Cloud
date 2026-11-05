const assert = require("node:assert/strict");
const test = require("node:test");
const { twoMonthHistoryWindow, newConnectionImportProfile, hasInitialImportProfile, initialHistoryComplete, initialHistoryStatus } = require("./plaidInitialImport");

test("new history uses two clamped calendar months with inclusive days", () => {
  assert.deepEqual(twoMonthHistoryWindow("2026-11-05T12:00:00Z"), { from: "2026-09-05", daysRequested: 62 });
  assert.deepEqual(twoMonthHistoryWindow("2026-04-30T12:00:00Z"), { from: "2026-02-28", daysRequested: 62 });
  assert.deepEqual(twoMonthHistoryWindow("2024-04-30T12:00:00Z"), { from: "2024-02-29", daysRequested: 62 });
  assert.deepEqual(twoMonthHistoryWindow("2026-01-31T12:00:00Z"), { from: "2025-11-30", daysRequested: 63 });
  assert.throws(() => twoMonthHistoryWindow("invalid"), TypeError);
});

test("calendar history always includes at least the requested boundary", () => {
  for (let month = 0; month < 12; month += 1) for (const day of [1, 15, 28, 31]) {
    const now = new Date(Date.UTC(2026, month, day));
    const result = twoMonthHistoryWindow(now);
    assert(result.daysRequested >= 60 && result.daysRequested <= 63);
    assert.equal(new Date(now.getTime() - (result.daysRequested - 1) * 86400000).toISOString().slice(0, 10), result.from);
  }
});

function adminDatabase({ admin = false, fail = false } = {}) {
  const calls = [];
  return { calls, from(table) {
    calls.push(["table", table]);
    return { select(columns) { calls.push(["select", columns]); return this; }, eq(key, value) { calls.push([key, value]); return this; },
      async maybeSingle() { return { data: admin ? { user_id: "actor" } : null, error: fail ? new Error("registry unavailable") : null }; } };
  } };
}

test("actual app-admin connections keep legacy settings without opting in", async () => {
  const db = adminDatabase({ admin: true });
  assert.equal(await newConnectionImportProfile({ db, userId: "actor" }), null);
  assert.deepEqual(db.calls, [["table", "feedback_admins"], ["select", "user_id"], ["user_id", "actor"]]);
});

test("ordinary manually upgraded Pro accounts get a fresh immutable import profile", async () => {
  const db = adminDatabase();
  const profile = await newConnectionImportProfile({ db, userId: "actor", now: "2026-11-05T12:00:00Z" });
  assert.deepEqual(profile, { initial_import_version: 1, initial_import_from: "2026-09-05", initial_history_complete_at: null, daysRequested: 62 });
  assert.equal(db.calls.some(call => call[0] === "table" && call[1] === "household_plans"), false);
});

test("an unavailable trusted admin registry fails closed", async () => {
  await assert.rejects(newConnectionImportProfile({ db: adminDatabase({ fail: true }), userId: "actor" }), /registry unavailable/);
});

test("empty/initial transaction batches cannot claim completed history", () => {
  const item = { initial_import_version: 1, initial_import_from: "2026-09-05", initial_history_complete_at: null };
  assert.equal(hasInitialImportProfile(item), true);
  for (const state of [undefined, "NOT_READY", "INITIAL_UPDATE_COMPLETE", "unknown"]) assert.equal(initialHistoryComplete(item, state), false);
  assert.equal(initialHistoryComplete(item, "HISTORICAL_UPDATE_COMPLETE"), true);
  assert.equal(initialHistoryComplete(item, undefined, true), true);
  assert.equal(initialHistoryStatus(item), "importing");
  assert.equal(initialHistoryStatus({ ...item, initial_history_complete_at: "2026-11-05T13:00:00Z" }), "complete");
});

test("legacy/admin history and reconnects retain their prior completion behavior", () => {
  for (const item of [{}, { initial_import_version: null }, { initial_import_version: 2, initial_import_from: "2026-09-05" }]) {
    assert.equal(hasInitialImportProfile(item), false);
    assert.equal(initialHistoryComplete(item, "NOT_READY"), true);
    assert.equal(initialHistoryStatus(item), null);
  }
  assert.equal(initialHistoryComplete({ initial_import_version: 1, initial_import_from: "2026-09-05", initial_history_complete_at: "2026-11-05T13:00:00Z" }, "INITIAL_UPDATE_COMPLETE"), true);
});
