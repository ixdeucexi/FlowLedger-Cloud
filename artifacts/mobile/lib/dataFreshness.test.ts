import assert from "node:assert/strict";
import test from "node:test";

import { dataFreshnessLabel, formatExactDataTimestamp, validDataTimestamp } from "./dataFreshness";

test("formats an exact financial-data timestamp", () => {
  assert.equal(
    formatExactDataTimestamp("2026-08-25T14:14:00.000Z", "en-US", "UTC"),
    "Aug 25, 2026 at 2:14 PM",
  );
});

test("returns no freshness copy for a missing or invalid timestamp", () => {
  assert.equal(validDataTimestamp("not-a-date"), null);
  assert.equal(formatExactDataTimestamp(null), null);
  assert.equal(dataFreshnessLabel(undefined), null);
});
