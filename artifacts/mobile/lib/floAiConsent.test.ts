import assert from "node:assert/strict";
import test from "node:test";

import { createFloAiConsent, floAiConsentStorageKey, parseFloAiConsent } from "./floAiConsent";

test("Flo AI consent is current and user-specific", () => {
  const stored = createFloAiConsent("user-a", "2026-08-15T12:00:00.000Z");
  assert.equal(parseFloAiConsent(stored, "user-a"), true);
  assert.equal(parseFloAiConsent(stored, "user-b"), false);
  assert.equal(floAiConsentStorageKey("user-a"), "flowledger_flo_ai_consent:v1:user-a");
});

test("Flo AI consent fails closed for stale or malformed records", () => {
  assert.equal(parseFloAiConsent(null, "user-a"), false);
  assert.equal(parseFloAiConsent("not-json", "user-a"), false);
  assert.equal(parseFloAiConsent('{"version":"old","userId":"user-a","acceptedAt":"2026-08-15T12:00:00.000Z"}', "user-a"), false);
});
