const assert = require("node:assert/strict");
const test = require("node:test");
const { ACCOUNT_TIPS, getWeeklyAccountTip } = require("../../artifacts/mobile/lib/accountTips");
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
  }
});
