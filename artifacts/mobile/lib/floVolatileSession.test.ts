import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createFloVolatileSession, FLO_VOLATILE_MAX_BYTES, FLO_VOLATILE_MAX_MESSAGES, type FloVolatileSnapshot } from "./floVolatileSession";
import { floConversationContext } from "./floExperience";

const snapshot = (): FloVolatileSnapshot => ({ messages: [{ id: "u", role: "user", text: "Cedar balance?", contextEligible: true }, { id: "a", role: "flo", text: "Recorded balance checked. Keep the required cushion.", contextEligible: true }], sources: { a: [{ id: "source", type: "account", label: "Recorded account balance", route: "/(tabs)/accounts", asOf: "2026-09-10" }] }, followups: { a: ["What bills are due before my next paycheck?"] }, grounding: { a: { partial: true, caveat: "This is not safe-to-spend cash.", coverage: "Limited recorded observations", dataAsOf: "2026-09-10" } } });

test("source navigation retains completed transcript and all grounding metadata in one volatile scope", () => {
  const store = createFloVolatileSession();store.observeScope("A:home:owner");const first = store.claim("A:home:owner")!;
  const value = snapshot();assert.equal(store.save(first.lease, value), true);value.messages[1].text = "Mutated old object";
  store.release(first.lease);const back = store.claim("A:home:owner")!;
  assert.deepEqual(back.snapshot, { ...snapshot(), messages: snapshot().messages.map(message=>({...message,thinking:false})) });assert.equal(floConversationContext(back.snapshot!.messages).length, 2);
  assert.equal(store.save(first.lease, { ...snapshot(), messages: [] }), false, "old unmount cannot overwrite a new screen");
});

test("household user logout and role epochs clear even while Flo has no mounted owner and never resurrect A on return", () => {
  for (const other of ["A:other:owner", "B:home:owner", "A:home:viewer", null]) {
    const store = createFloVolatileSession();store.observeScope("A:home:owner");const first = store.claim("A:home:owner")!;store.save(first.lease, snapshot());store.release(first.lease);
    store.observeScope(other);store.observeScope("A:home:owner");const returned = store.claim("A:home:owner")!;
    assert.equal(returned.snapshot, null);assert.equal(store.save(first.lease, snapshot()), false);assert.equal(store.claim("foreign"), null);
  }
});

test("New chat invalidates the old owner and stale release cannot clear the new conversation", () => {
  const store = createFloVolatileSession();store.observeScope("A");const old = store.claim("A")!;store.save(old.lease, snapshot());
  const next = store.reset(old.lease)!;assert.equal(store.isCurrent(old.lease), false);assert.equal(store.isCurrent(next), true);
  store.release(old.lease);assert.equal(store.isCurrent(next), true);assert.equal(store.save(old.lease, snapshot()), false);
  store.save(next, { messages: [], sources: {}, followups: {}, grounding: {} });store.release(next);
  assert.deepEqual(store.claim("A")!.snapshot!.messages, []);
});

test("an interrupted response restores stopped with no stream lock or incomplete sources/context", () => {
  const store = createFloVolatileSession();store.observeScope("A");const first = store.claim("A")!;
  const value = snapshot();value.messages.push({ id: "u2", role: "user", text: "Reserve 2 instead" }, { id: "a2", role: "flo", text: "Unverified streamed $99999", thinking: false });
  value.sources.a2 = value.sources.a;value.followups.a2 = ["Unsafe unfinished chip"];value.grounding.a2 = { dataAsOf: "2026-09-10" };
  store.save(first.lease, value);store.release(first.lease);const back = store.claim("A")!.snapshot!;
  assert.match(back.messages.at(-1)!.text, /Response stopped/);assert.equal(back.messages.at(-1)!.thinking, false);assert.equal(back.sources.a2, undefined);assert.equal(back.followups.a2, undefined);assert.equal(back.grounding.a2.partial, true);assert.deepEqual(floConversationContext(back.messages), []);
});

test("volatile retention bounds whole messages and metadata without trimming material warnings", () => {
  const store = createFloVolatileSession();store.observeScope("A");const lease = store.claim("A")!.lease;
  const value = snapshot();value.messages = Array.from({ length: 100 }, (_, i) => ({ id: String(i), role: i % 2 ? "flo" : "user", text: `${i}: ${"x".repeat(20_000)} Important warning.`, contextEligible: true }));
  store.save(lease, value);store.release(lease);const restored = store.claim("A")!.snapshot!;
  assert.ok(restored.messages.length <= FLO_VOLATILE_MAX_MESSAGES);assert.ok(new TextEncoder().encode(JSON.stringify(restored)).byteLength <= FLO_VOLATILE_MAX_BYTES);assert.ok(restored.messages.every(message => message.text.endsWith("Important warning.")));
  const source = readFileSync("lib/floVolatileSession.ts", "utf8");assert.doesNotMatch(source, /localStorage|sessionStorage|AsyncStorage|supabase|fetch\(/);
});

test("provider lives below auth budget membership and above routes without a scope-based navigation key", () => {
  const root = readFileSync("app/_layout.tsx", "utf8");assert.match(root, /<MembershipProvider>\s*<FloVolatileSessionProvider>\s*<RootNavigator/);assert.doesNotMatch(root, /<FloVolatileSessionProvider[^>]*key=/);
  const provider = readFileSync("context/FloVolatileSessionContext.tsx", "utf8");assert.match(provider, /observeScope\(scope\)/);assert.doesNotMatch(provider, /localStorage|sessionStorage|AsyncStorage|supabase|fetch\(/);
  const screen = readFileSync("app/(tabs)/flo.tsx", "utf8");assert.match(screen, /volatileRenderOwner === lease.owner/);assert.match(screen, /volatileStore.isCurrent\(requestLease\)/);assert.match(screen, /volatileStore.reset\(volatileLeaseRef.current\)/);
});
