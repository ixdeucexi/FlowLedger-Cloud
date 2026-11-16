const assert = require("node:assert/strict");
const test = require("node:test");
const { ACCOUNT_TIPS, getWeeklyAccountTip, getAccountTipForWeek, accountTipRoute, accountTipWeekFromRoute } = require("../../artifacts/mobile/lib/accountTips");
const { allowlistedNativeRoute } = require("./push");

test("a tip is stable throughout a UTC Monday week", () => {
  const monday = getWeeklyAccountTip("2026-11-09T00:00:00Z");
  const sunday = getWeeklyAccountTip("2026-11-15T23:59:59.999Z");
  assert.deepEqual(monday, sunday);
  assert.equal(monday.week, "2026-11-09");
  assert.equal(monday.id, "tip:2026-11-09");
  assert.equal(monday.timestamp, "2026-11-09T00:00:00.000Z");
  assert.notEqual(getWeeklyAccountTip("2026-11-16T00:00:00Z").id, monday.id);
});

test("week selection is deterministic across time zones and year rollover", () => {
  assert.deepEqual(getWeeklyAccountTip("2027-01-03T18:00:00-06:00"), getWeeklyAccountTip("2027-01-04T00:00:00Z"));
  assert.equal(getWeeklyAccountTip("2027-01-01T00:00:00Z").week, "2026-12-28");
  assert.equal(getWeeklyAccountTip("not-a-date"), null);
  const input = new Date("2026-11-15T12:30:00Z");
  getWeeklyAccountTip(input);
  assert.equal(input.toISOString(), "2026-11-15T12:30:00.000Z");
});

test("every tip rotates once per cycle, including dates before the anchor", () => {
  const start = Date.UTC(2025, 11, 29);
  const tips = Array.from({ length: ACCOUNT_TIPS.length }, (_, index) => getWeeklyAccountTip(new Date(start + index * 7 * 86_400_000)));
  assert.equal(new Set(tips.map(tip => tip.key)).size, ACCOUNT_TIPS.length);
  assert.equal(getWeeklyAccountTip(new Date(start + ACCOUNT_TIPS.length * 7 * 86_400_000)).key, tips[0].key);
});

test("educational copy fits push payloads and uses existing native routes", () => {
  for (const tip of ACCOUNT_TIPS) {
    assert.ok(tip.title.length <= 80);
    assert.ok(tip.body.length <= 180);
    assert.equal(allowlistedNativeRoute(tip.route), tip.route);
    assert.doesNotMatch(tip.body, /\$|\d|your account (?:has|is)|you (?:can afford|have)/i);
    assert.ok(tip.explanation.length > tip.body.length);
    assert.match(tip.actionLabel, /^Open /);
  }
});

test("tip details reconstruct the clicked past/current week and reject invalid or future dates", () => {
  const now = "2026-11-18T12:00:00Z";
  assert.deepEqual(getAccountTipForWeek("2026-11-16", now), getWeeklyAccountTip(now));
  assert.deepEqual(getAccountTipForWeek("2026-11-09", now), getWeeklyAccountTip("2026-11-09T00:00:00Z"));
  for (const invalid of [null, ["2026-11-16"], {}, "2026-11-17", "2026-11-23", "2026-02-30", "2026-2-02", "not-a-date", "2026-11-16T00:00:00Z"]) {
    assert.equal(getAccountTipForWeek(invalid, now), null);
  }
  assert.equal(getAccountTipForWeek("2026-11-16", "invalid-now"), null);
});

test("tip links carry only a validated week and never an arbitrary destination", () => {
  const now = "2026-11-18T12:00:00Z";
  assert.equal(accountTipRoute("2026-11-16", now), "/(tabs)?accountTip=2026-11-16");
  assert.equal(accountTipWeekFromRoute("/(tabs)?accountTip=2026-11-09", now), "2026-11-09");
  for (const invalid of [
    "/(tabs)?accountTip=2026-11-23", "/(tabs)?accountTip=2026-11-17",
    "/(tabs)?accountTip=2026-11-16&next=/delete-account",
    "/(tabs)?accountTip=2026-11-16&accountTip=2026-11-09",
    "/(tabs)?accountTip=2026-11-16#other", "/(tabs)?accountTip=2026%2D11%2D16",
    "https://attacker.invalid/(tabs)?accountTip=2026-11-16", "/?accountTip=2026-11-16",
  ]) assert.equal(accountTipWeekFromRoute(invalid, now), null);
  assert.equal(accountTipRoute("https://attacker.invalid", now), null);
});

test("each tip button opens the screen discussed in its explanation", () => {
  const destinations = Object.fromEntries(ACCOUNT_TIPS.map(tip => [tip.key, [tip.route, tip.actionLabel]]));
  assert.deepEqual(destinations, {
    "planned-money": ["/monthly", "Open Forecast"],
    "pending-charges": ["/transactions", "Open Activity"],
    "review-activity": ["/more?section=review", "Open Review Center"],
    "look-ahead": ["/bills", "Open Bills"],
    "savings-purpose": ["/more?section=goals", "Open Goals & buckets"],
    "check-balances": ["/accounts", "Open Accounts"],
  });
});
