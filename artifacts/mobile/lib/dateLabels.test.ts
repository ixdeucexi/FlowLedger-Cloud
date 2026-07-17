import assert from "node:assert/strict";
import test from "node:test";

import { localDateString, MONTH_NAMES } from "./dateLabels";

test("financial dates keep the device's local day late at night", () => {
  assert.equal(localDateString(new Date(2026, 6, 17, 23, 59)), "2026-07-17");
});

test("shared month labels cover the calendar year", () => {
  assert.equal(MONTH_NAMES.length, 12);
  assert.equal(MONTH_NAMES[0], "January");
  assert.equal(MONTH_NAMES[11], "December");
});
