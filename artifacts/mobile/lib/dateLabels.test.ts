import assert from "node:assert/strict";
import test from "node:test";

import {
  addDateOnlyDays,
  addDateOnlyMonths,
  dateOnlyToLocalDate,
  localDateString,
  MONTH_NAMES,
} from "./dateLabels";

test("financial dates keep the device's local day late at night", () => {
  assert.equal(localDateString(new Date(2026, 6, 17, 23, 59)), "2026-07-17");
});

test("shared month labels cover the calendar year", () => {
  assert.equal(MONTH_NAMES.length, 12);
  assert.equal(MONTH_NAMES[0], "January");
  assert.equal(MONTH_NAMES[11], "December");
});

test("date-only values stay on their named local calendar day", () => {
  const date = dateOnlyToLocalDate("2026-07-21");
  assert.ok(date);
  assert.equal(localDateString(date), "2026-07-21");
  assert.equal(dateOnlyToLocalDate("2026-02-30"), null);
});

test("date-only arithmetic crosses month boundaries without timezone drift", () => {
  assert.equal(addDateOnlyDays("2026-07-29", 7), "2026-08-05");
  assert.equal(addDateOnlyMonths("2026-01-31", 1), "2026-02-28");
  assert.equal(addDateOnlyMonths("2024-01-31", 1), "2024-02-29");
});
