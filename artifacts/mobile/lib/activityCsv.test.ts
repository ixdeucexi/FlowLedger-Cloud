import assert from "node:assert/strict";
import test from "node:test";

import { activityCsvContent } from "./activityCsv";

test("activity CSV escapes descriptions and includes optional running balances", () => {
  const csv = activityCsvContent([{ date: "2026-08-05", description: 'Coffee, "downtown"', category: "Food", amount: -4.5, type: "Bank", runningBalance: 100.25 }]);
  assert.match(csv, /"Coffee, ""downtown"""/);
  assert.match(csv, /"100\.25"/);
});
