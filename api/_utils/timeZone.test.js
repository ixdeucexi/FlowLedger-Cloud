const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { isLocalCloseHour, isLocalCloseWindow, localDateTimeParts, validTimeZone } = require("./timeZone");

test("resolves each household's own calendar date", () => {
  const instant = new Date("2026-08-27T04:30:00.000Z");
  assert.deepEqual(localDateTimeParts(instant, "America/Chicago"), {
    date: "2026-08-26",
    hour: 23,
    timeZone: "America/Chicago",
  });
  assert.deepEqual(localDateTimeParts(instant, "Asia/Tokyo"), {
    date: "2026-08-27",
    hour: 13,
    timeZone: "Asia/Tokyo",
  });
});

test("local close selection remains correct on DST transition days", () => {
  assert.equal(isLocalCloseHour(new Date("2026-11-02T05:30:00.000Z"), "America/Chicago"), true);
  assert.equal(isLocalCloseHour(new Date("2026-03-09T04:30:00.000Z"), "America/Chicago"), true);
  assert.equal(isLocalCloseWindow(new Date("2026-11-02T05:55:00.000Z"), "America/Chicago", [23, 0]), true);
  assert.equal(isLocalCloseWindow(new Date("2026-03-09T05:55:00.000Z"), "America/Chicago", [23, 0]), true);
});

test("invalid stored time zones fail safely to UTC", () => {
  assert.equal(validTimeZone("Not/A_Zone"), "UTC");
  assert.equal(validTimeZone(undefined), "UTC");
  assert.equal(localDateTimeParts(new Date("2026-08-27T23:00:00.000Z"), "Not/A_Zone").hour, 23);
});

test("overdue notification dates are computed per household instead of global UTC", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "notificationRoutes/overdue-bills.js"),
    "utf8",
  );
  assert.match(source, /household_settings/);
  assert.match(source, /timeZoneByHousehold/);
  assert.match(source, /personalHouseholdByOwner/);
  assert.match(source, /bill\.household_id[\s\S]+personalHouseholdByOwner\.get\(bill\.user_id\)/);
  assert.match(source, /localDateTimeParts\(now, timeZone\)\.date/);
  assert.doesNotMatch(source, /new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/);
});
