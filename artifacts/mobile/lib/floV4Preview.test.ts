import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { floV4PreviewEnabled } from "./floV4Preview";

test("v4 endpoint selection is exclusively controlled by exact admin authority", () => {
  assert.equal(floV4PreviewEnabled(true), true);
  assert.equal(floV4PreviewEnabled(false), false);
});

test("Flo client maps v4 to its isolated endpoint and closed request body", () => {
  const source = readFileSync(path.resolve(__dirname, "../lib/floChat.ts"), "utf8");
  assert.match(source, /engine === "v4" \? "flo-chat-v4" : "flo-chat"/);
  assert.match(source, /if \(engine === "v4"\) return \{\s*version: 4,\s*householdId: input\.householdId,\s*question: input\.text,\s*timezone: input\.timezone,\s*\.\.\.\(input\.conversationContext \? \{ conversationContext: input\.conversationContext \} : \{\}\),\s*\}/s);
  assert.match(source, /let ephemeralCleaned = engine === "v4" \|\|/);
});

test("Flo preview UI is visibly history-off and suppresses proposals", () => {
  const source = readFileSync(path.resolve(__dirname, "../app/(tabs)/flo.tsx"), "utf8");
  assert.match(source, /Read only · Chat not saved/);
  assert.match(source, /engine: floV4Preview \? "v4" : "v3"/);
  assert.match(source, /historyEnabled = !floV4Preview/);
  assert.match(source, /proposal=\{floV4Preview \? null/);
  assert.match(source, /!floV4Preview \? \(isDesktop \?/);
});

test("activation has no public environment flag that can drift from server authority", () => {
  const config = readFileSync(path.resolve(__dirname, "../app.config.js"), "utf8");
  const policy = readFileSync(path.resolve(__dirname, "../lib/floV4Preview.ts"), "utf8");
  assert.doesNotMatch(config, /FLO_V4_PREVIEW/);
  assert.doesNotMatch(policy, /process\.env|Constants|FLO_V4_PREVIEW/);
});
