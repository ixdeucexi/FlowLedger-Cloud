import test from "node:test";
import assert from "node:assert/strict";

import { compactFloText, humanizeFloText, isWeakFloReply } from "./floLanguage";

test("Flo replies hide internal field names and use readable dates", () => {
  const reply = humanizeFloText(`Quick snapshot:
- Available today: $1,216.39 (record: balanceToday)
- Safety floor: $200 (record: safetyFloor)
- Next upcoming: Discover due 2026-07-22 (record: upcoming)`);

  assert.equal(reply.includes("record:"), false);
  assert.equal(reply.includes("balanceToday"), false);
  assert.equal(reply.includes("2026-07-22"), false);
  assert.match(reply, /• Available today/);
  assert.match(reply, /July 22, 2026/);
});

test("Flo replies replace exposed technical terms", () => {
  const reply = humanizeFloText("The deterministic snapshot needs revalidation. forecastConfidence is medium.");
  assert.equal(reply, "The FlowLedger plan needs checking the latest numbers. forecast confidence is medium.");
});

test("Flo replies stay concise", () => {
  const reply = compactFloText(Array.from({ length: 90 }, (_, index) => `word${index}`).join(" "));
  assert.equal(reply.split(/\s+/).length, 65);
  assert.match(reply, /…$/);
});

test("weak model fallbacks are recognized", () => {
  assert.equal(isWeakFloReply("I couldn't form a reliable account answer."), true);
  assert.equal(isWeakFloReply("You have two bills left."), false);
});
