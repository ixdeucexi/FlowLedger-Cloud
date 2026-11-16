import assert from "node:assert/strict";
import test from "node:test";

import { accountTipRoute } from "./accountTips";
import { clearAccountTipReturnIntent, consumeAccountTipReturnIntent, peekAccountTipReturnIntent, saveAccountTipReturnIntent } from "./accountTipReturnIntent";

function fixture() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}
const NOW = new Date("2026-11-18T12:00:00Z");

test("same-tab OAuth returns to the public tip exactly once", () => {
  const storage = fixture();
  assert.equal(saveAccountTipReturnIntent("2026-11-16", storage, NOW), true);
  const saved = JSON.parse([...storage.values.values()][0]);
  assert.deepEqual(Object.keys(saved).sort(), ["createdAt", "expiresAt", "version", "week"]);
  assert.equal(peekAccountTipReturnIntent(storage, NOW), "2026-11-16");
  assert.equal(peekAccountTipReturnIntent(storage, NOW), "2026-11-16");
  assert.equal(storage.values.size, 1, "readiness checks do not consume the one-use intent");
  const week = consumeAccountTipReturnIntent(storage, new Date(NOW.getTime() + 60_000));
  assert.equal(accountTipRoute(week, NOW), "/(tabs)?accountTip=2026-11-16");
  assert.equal(consumeAccountTipReturnIntent(storage, NOW), null);
  assert.equal(storage.values.size, 0);
});

test("a second valid click replaces an older tip and invalid input clears it", () => {
  const storage = fixture();
  saveAccountTipReturnIntent("2026-11-09", storage, NOW);
  saveAccountTipReturnIntent("2026-11-16", storage, NOW);
  assert.equal(consumeAccountTipReturnIntent(storage, NOW), "2026-11-16");
  for (const invalid of ["2026-11-23", "2026-11-17", ["2026-11-16"], "https://attacker.invalid", { week: "2026-11-16", destination: "/delete-account" }]) {
    saveAccountTipReturnIntent("2026-11-16", storage, NOW);
    assert.equal(saveAccountTipReturnIntent(invalid, storage, NOW), false);
    assert.equal(consumeAccountTipReturnIntent(storage, NOW), null);
  }
});

test("expired, malformed, future-created and unsupported records cannot reopen tips", () => {
  const storage = fixture();
  saveAccountTipReturnIntent("2026-11-16", storage, NOW);
  const key = [...storage.values.keys()][0];
  assert.equal(consumeAccountTipReturnIntent(storage, new Date(NOW.getTime() + 10 * 60_000)), null);
  const badRecords = ["not-json", JSON.stringify({ version: 1, week: "2026-11-16", createdAt: NOW.getTime() + 1, expiresAt: NOW.getTime() + 600001 }), JSON.stringify({ version: 2, week: "2026-11-16", createdAt: NOW.getTime(), expiresAt: NOW.getTime() + 600000 }), JSON.stringify({ version: 1, week: "2026-11-16", createdAt: NOW.getTime(), expiresAt: NOW.getTime() + 86400000 })];
  for (const raw of badRecords) {
    storage.setItem(key, raw);
    assert.equal(consumeAccountTipReturnIntent(storage, NOW), null);
    assert.equal(storage.values.size, 0);
  }
});

test("sign-out cleanup clears the optional intent and unavailable storage is harmless", () => {
  const storage = fixture();
  saveAccountTipReturnIntent("2026-11-16", storage, NOW);
  clearAccountTipReturnIntent(storage);
  assert.equal(consumeAccountTipReturnIntent(storage, NOW), null);
  assert.equal(saveAccountTipReturnIntent("2026-11-16", null, NOW), false);
  assert.equal(consumeAccountTipReturnIntent(null, NOW), null);
  const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
  assert.equal(saveAccountTipReturnIntent("2026-11-16", blocked, NOW), false);
  assert.equal(consumeAccountTipReturnIntent(blocked, NOW), null);
});
