const assert = require("node:assert/strict");
const test = require("node:test");

const { getWeeklyAccountTip } = require("../../artifacts/mobile/lib/accountTips");
const { accountTipEligible, accountTipPayload, currentTipForEvent, readAllRows, runAccountTipNotifications } = require("./accountTipNotifications");
const { deliverPendingNotifications, queueAccountTipNotification, sendExpoNotification, allowlistedNativeRoute } = require("./push");
const { createAccountTipHandler } = require("./notificationRoutes/account-tips");
const { normalizeNotificationPreferencePatch, normalizeNotificationPreferences } = require("./notificationPreferences");
const { notificationTestPayload } = require("./notificationTest");

const NOW = new Date("2026-11-18T15:30:00.000Z");
const tip = getWeeklyAccountTip(NOW);

function fixture(overrides = {}) {
  const tables = {
    user_notification_preferences: [{ user_id: "user-1", account_tips: true }],
    user_preferences: [{ user_id: "user-1", active_household_id: "home-1", notification_center_states: {} }],
    household_members: [{ user_id: "user-1", household_id: "home-1" }, { user_id: "user-1", household_id: "home-2" }],
    push_subscriptions: [{ id: "web-1", user_id: "user-1" }],
    native_push_devices: [],
    push_notification_events: [],
    ...overrides,
  };
  const db = {
    tables,
    failTable: null,
    from(table) {
      assert.ok(Object.hasOwn(tables, table), `Unexpected table: ${table}`);
      const filters = [];
      let update;
      const matches = row => filters.every(filter => filter(row));
      const result = single => {
        if (db.failTable === table) return { data: null, error: new Error("Database unavailable") };
        const rows = tables[table].filter(matches);
        if (update) rows.forEach(row => Object.assign(row, update));
        return { data: single ? rows[0] || null : rows, error: null };
      };
      const query = {
        select() { return query; },
        order() { return query; },
        eq(key, value) { filters.push(row => row[key] === value); return query; },
        in(key, values) { filters.push(row => values.includes(row[key])); return query; },
        limit() { return query; },
        maybeSingle() { return Promise.resolve(result(true)); },
        range(start, end) { const value = result(false); return Promise.resolve({ ...value, data: value.data?.slice(start, end + 1) }); },
        update(values) { update = values; return query; },
        upsert(value, options) {
          for (const row of Array.isArray(value) ? value : [value]) {
            const keys = options.onConflict.split(",");
            const existing = tables[table].find(item => keys.every(key => item[key] === row[key]));
            if (!existing) tables[table].push({ id: `event-${tables[table].length + 1}`, ...row });
          }
          return Promise.resolve({ error: db.failTable === table ? new Error("Database unavailable") : null });
        },
        then(resolve, reject) { return Promise.resolve(result(false)).then(resolve, reject); },
      };
      return query;
    },
    async rpc(name, args) {
      assert.equal(name, "claim_push_notification_events");
      return { data: tables.push_notification_events.filter(event => event.user_id === args.p_user_id && !event.delivered_at), error: null };
    },
  };
  return db;
}

function event(overrides = {}) {
  return { id: "event-1", user_id: "user-1", household_id: "home-1", occurrence_date: tip.week, event_type: "account_tip", event_key: `account-tip:${tip.week}`, ...overrides };
}

test("account tip preference defaults on and preserves opt-out without changing other choices", () => {
  assert.equal(normalizeNotificationPreferences(null).account_tips, true);
  assert.equal(normalizeNotificationPreferences({ account_tips: false }).account_tips, false);
  assert.deepEqual(normalizeNotificationPreferencePatch({ account_tips: false }), { account_tips: false });
  assert.throws(() => normalizeNotificationPreferencePatch({ account_tips: "on" }));
  assert.equal(notificationTestPayload("account_tips").quiet, true);
});

test("tip eligibility requires current membership, active household and an unread enabled tip", async () => {
  const db = fixture();
  assert.equal(await accountTipEligible(db, "user-1", "home-1", tip), true);
  assert.equal(await accountTipEligible(db, "user-1", "home-2", tip), false);
  db.tables.user_notification_preferences[0].account_tips = false;
  assert.equal(await accountTipEligible(db, "user-1", "home-1", tip), false);
  db.tables.user_notification_preferences[0].account_tips = true;
  for (const key of ["readIds", "dismissedIds"]) {
    db.tables.user_preferences[0].notification_center_states = { "home-1": { [key]: [tip.id] } };
    assert.equal(await accountTipEligible(db, "user-1", "home-1", tip), false);
  }
  db.tables.user_preferences[0].notification_center_states = {};
  db.tables.household_members = [];
  assert.equal(await accountTipEligible(db, "user-1", "home-1", tip), false);
  db.failTable = "user_notification_preferences";
  await assert.rejects(accountTipEligible(db, "user-1", "home-1", tip), /Database unavailable/);
});

test("queueing repeated jobs or switching households creates one event and one send per user/week", async () => {
  process.env.PUSH_APP_ENVIRONMENT = "production";
  const db = fixture();
  const sends = [];
  const sendPush = async (...args) => { sends.push(args); return { delivered: 1, activeSubscriptions: 1, errors: [] }; };
  await queueAccountTipNotification("user-1", "home-1", NOW, { db, sendPush });
  await queueAccountTipNotification("user-1", "home-1", NOW, { db, sendPush });
  db.tables.user_preferences[0].active_household_id = "home-2";
  await queueAccountTipNotification("user-1", "home-2", NOW, { db, sendPush });
  assert.equal(db.tables.push_notification_events.length, 1);
  assert.equal(db.tables.push_notification_events[0].event_key, `account-tip:${tip.week}`);
  assert.equal(sends.length, 1);
  assert.equal(sends[0][2], "account_tips");
  assert.equal(sends[0][3], "home-1");
});

test("no destination or missing household preferences never creates an event", async () => {
  process.env.PUSH_APP_ENVIRONMENT = "production";
  const db = fixture({ push_subscriptions: [] });
  await queueAccountTipNotification("user-1", "home-1", NOW, { db });
  db.tables.user_preferences = [];
  await queueAccountTipNotification("user-1", "home-1", NOW, { db });
  assert.equal(db.tables.push_notification_events.length, 0);
});

test("delivery drops expired weeks and rechecks current opt-out, read state, household and membership", async () => {
  for (const change of [
    db => { db.tables.push_notification_events[0].occurrence_date = "2026-11-09"; },
    db => { db.tables.user_notification_preferences[0].account_tips = false; },
    db => { db.tables.user_preferences[0].notification_center_states = { "home-1": { readIds: [tip.id] } }; },
    db => { db.tables.user_preferences[0].notification_center_states = { "home-1": { dismissedIds: [tip.id] } }; },
    db => { db.tables.user_preferences[0].active_household_id = "home-2"; },
    db => { db.tables.household_members = []; },
  ]) {
    const db = fixture({ push_notification_events: [event()] });
    change(db);
    let sends = 0;
    await deliverPendingNotifications("user-1", { db, now: NOW, sendPush: async () => { sends += 1; } });
    assert.equal(sends, 0);
    assert.ok(db.tables.push_notification_events[0].delivered_at);
  }
});

test("queued tip sends the shared current tip and keeps normal transaction routing intact", async () => {
  const db = fixture({ push_notification_events: [
    event({ id: "old", occurrence_date: "2026-11-09", event_key: "account-tip:2026-11-09" }),
    event(),
    event({ id: "transaction", event_type: "posted", transaction_id: "private-transaction", event_key: "posted:private-transaction" }),
  ] });
  const sends = [];
  await deliverPendingNotifications("user-1", { db, now: NOW, sendPush: async (...args) => { sends.push(args); return { delivered: 1, activeSubscriptions: 1, errors: [] }; } });
  assert.equal(sends.length, 2);
  assert.deepEqual(sends[0][1], accountTipPayload(tip));
  assert.equal(sends[1][2], "posted_transactions");
  assert.equal(sends[1][1].url, "/more?section=review");
  assert.equal(sends[1][1].quiet, undefined);
  assert.equal(allowlistedNativeRoute(sends[0][1].url), `/(tabs)?accountTip=${tip.week}`);
  assert.equal(currentTipForEvent(event({ event_key: "malformed" }), NOW), null);
});

test("a transport failure remains retryable and does not create a second weekly event", async () => {
  process.env.PUSH_APP_ENVIRONMENT = "production";
  const db = fixture();
  await queueAccountTipNotification("user-1", "home-1", NOW, { db, sendPush: async () => ({ delivered: 0, activeSubscriptions: 1, errors: ["offline"] }) });
  assert.equal(db.tables.push_notification_events[0].delivered_at, undefined);
  await queueAccountTipNotification("user-1", "home-1", NOW, { db, sendPush: async () => ({ delivered: 1, activeSubscriptions: 1, errors: [] }) });
  assert.equal(db.tables.push_notification_events.length, 1);
  assert.ok(db.tables.push_notification_events[0].delivered_at);
});

test("weekly runner deduplicates subscribed users, pages destinations and uses only their active household", async () => {
  const db = fixture({
    push_subscriptions: Array.from({ length: 501 }, (_, index) => ({ id: `web-${index}`, user_id: index === 500 ? "user-2" : "user-1" })),
    native_push_devices: [
      { id: "native-prod", user_id: "user-1", environment: "production", status: "active" },
      { id: "native-preview", user_id: "user-3", environment: "preview", status: "active" },
    ],
    user_preferences: [
      { user_id: "user-1", active_household_id: "home-1" },
      { user_id: "user-2", active_household_id: "home-2" },
      { user_id: "user-3", active_household_id: "home-3" },
    ],
  });
  const calls = [];
  const result = await runAccountTipNotifications({ db, now: NOW, environment: "production", queue: async (...args) => { calls.push(args); return { delivered: 1, events: 1 }; } });
  assert.equal(result.ok, true);
  assert.equal(result.users, 2);
  assert.deepEqual(calls.map(args => args.slice(0, 2)), [["user-1", "home-1"], ["user-2", "home-2"]]);
  const failed = await runAccountTipNotifications({ db, now: NOW, environment: "production", queue: async () => { throw new Error("offline"); } });
  assert.equal(failed.ok, false);
  assert.equal(failed.failed, 2);
  db.failTable = "push_subscriptions";
  await assert.rejects(readAllRows(() => db.from("push_subscriptions").select("id")), /Database unavailable/);
});

test("cron route rejects unauthenticated work, unsupported methods and reports runner failures", async () => {
  process.env.CRON_SECRET = "test-cron-secret";
  let calls = 0;
  const handler = createAccountTipHandler({ serviceSupabase: () => ({}), pushEnvironment: () => "production", run: async () => { calls += 1; return { ok: true, users: 0 }; } });
  const response = () => ({ setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
  for (const [request, status] of [
    [{ method: "POST", headers: {} }, 405],
    [{ method: "GET", headers: {} }, 401],
    [{ method: "GET", headers: { authorization: "Bearer wrong" } }, 401],
  ]) {
    const res = response(); await handler(request, res); assert.equal(res.code, status);
  }
  assert.equal(calls, 0);
  const res = response();
  await handler({ method: "GET", headers: { authorization: "Bearer test-cron-secret" } }, res);
  assert.equal(res.code, 200);
  assert.equal(calls, 1);
  const failure = createAccountTipHandler({ serviceSupabase: () => ({}), pushEnvironment: () => "production", run: async () => { throw new Error("private details"); } });
  const failedResponse = response();
  await failure({ method: "GET", headers: { authorization: "Bearer test-cron-secret" } }, failedResponse);
  assert.equal(failedResponse.code, 500);
  assert.equal(JSON.stringify(failedResponse.body).includes("private details"), false);
});

test("tip Expo payloads are quiet, scoped and carry no account values or badge override", async () => {
  const original = global.fetch;
  let sent;
  global.fetch = async (_url, options) => { sent = JSON.parse(options.body); return { ok: true, json: async () => ({ data: { status: "ok", id: "ticket" } }) }; };
  const db = {
    from(table) {
      if (table === "native_push_receipts") return { upsert: async () => ({ error: null }) };
      return { update: () => ({ eq: async () => ({ error: null }) }) };
    },
  };
  try { await sendExpoNotification(db, { id: "device", expo_push_token: "fake-token" }, accountTipPayload(tip), "home-1", ["event-1"]); }
  finally { global.fetch = original; }
  assert.equal(sent.sound, null);
  assert.equal(sent.priority, "normal");
  assert.equal(sent.channelId, "flowledger-tips");
  assert.deepEqual(sent.data, { route: `/(tabs)?accountTip=${tip.week}`, householdId: "home-1" });
  assert.equal(Object.hasOwn(sent, "badge"), false);
  assert.equal(sent.body, tip.body.slice(0, 180));
});
