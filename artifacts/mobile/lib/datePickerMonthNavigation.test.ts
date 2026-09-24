import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("the shared date picker exposes accessible previous and next month controls", () => {
  const source = readFileSync("components/DatePickerField.tsx", "utf8");
  assert.match(source, /accessibilityLabel="Previous month"/);
  assert.match(source, /accessibilityLabel="Next month"/);
  assert.match(source, /shiftMonth\(-1\)/);
  assert.match(source, /shiftMonth\(1\)/);
});

test("Forecast date changes accept full dates outside the displayed month", () => {
  const source = readFileSync("app/(tabs)/monthly.tsx", "utf8");
  assert.match(source, /label="Move this occurrence to"/);
  assert.match(source, /moveBillOccurrence\(picker\.bill\.id, cleanFrom, cleanTarget\)/);
  assert.match(source, /label="Move this payday to"/);
  assert.match(source, /next_payment_date: date/);
  assert.match(source, /Use the arrows to choose another month/);
  assert.doesNotMatch(source, /Select the new due day for this month only/);
});
