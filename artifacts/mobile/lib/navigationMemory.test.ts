import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  normalizeRestorableRoute,
  createAppRouteMemory,
  resolveAppEntryRoute,
} from "./navigationMemory";

test("normalizes tab routes without retaining action parameters", () => {
  assert.equal(normalizeRestorableRoute("/(tabs)/bills?add=1"), "/bills");
  assert.equal(normalizeRestorableRoute("/"), "/(tabs)");
});

test("retains allow-listed page presentation parameters", () => {
  assert.equal(
    normalizeRestorableRoute("/transactions?range=last_90_days&category=Food&activityId=private"),
    "/transactions?range=last_90_days&category=Food",
  );
  assert.equal(normalizeRestorableRoute("/more?section=security"), "/more?section=security");
});

test("rejects blocked, unknown, and privileged restoration targets", () => {
  assert.equal(normalizeRestorableRoute("/login"), null);
  assert.equal(normalizeRestorableRoute("/somewhere-else"), null);
  assert.equal(normalizeRestorableRoute("/more?section=admin"), "/more");
});

test("treats the How FlowLedger works guide as a transient route", () => {
  assert.equal(normalizeRestorableRoute("/how-flowledger-works?section=stability"), "/(tabs)");
  assert.equal(normalizeRestorableRoute("/(tabs)/how-flowledger-works?protectedDays=42"), "/(tabs)");
});

test("entry navigation waits for scoped core/privacy readiness and preserves explicit routes", () => {
  let reads = 0;
  const resolve = (overrides: Partial<Parameters<typeof resolveAppEntryRoute>[0]> = {}) =>
    resolveAppEntryRoute({
      applyReady: true,
      expectedScopeKey: "user-a:household-a",
      currentScopeKey: "user-a:household-a",
      eligibleEntry: true,
      readRoute: () => { reads += 1; return "/transactions"; },
      ...overrides,
    });

  assert.equal(resolve({ applyReady: false }), null);
  assert.equal(resolve({ currentScopeKey: "user-b:household-b" }), null);
  assert.equal(resolve({ currentScopeKey: null }), null);
  assert.equal(resolve({ eligibleEntry: false }), null);
  assert.equal(reads, 0);
  assert.equal(resolve(), "/transactions");
  assert.equal(reads, 1);
});

test("cold runtime opens Dashboard; warm entry reads the most recent page synchronously", async () => {
  const runtime = createAppRouteMemory();
  const resolve = () => resolveAppEntryRoute({
    applyReady: true,
    expectedScopeKey: "a:h",
    currentScopeKey: "a:h",
    eligibleEntry: true,
    readRoute: () => runtime.read("a", "h"),
  });
  assert.equal(resolve(), "/(tabs)");
  runtime.remember("a", "h", "/bills");
  assert.equal(resolve(), "/bills");
  runtime.remember("a", "h", "/monthly?month=9&year=2026");
  assert.equal(resolve(), "/monthly?month=9&year=2026");
  await Promise.resolve();
  assert.equal(resolve(), "/monthly?month=9&year=2026");
  const freshRuntime = createAppRouteMemory();
  assert.equal(freshRuntime.read("a", "h"), null);
});

test("memory isolates households/users and sign-out clears only that user's routes", () => {
  const runtime = createAppRouteMemory();
  runtime.remember("a", "one", "/bills?add=1");
  runtime.remember("a", "two", "/monthly");
  runtime.remember("b", "one", "/transactions");
  runtime.remember("a", "one", "/auth/reset-password?token=private");
  assert.equal(runtime.read("a", "one"), "/bills");
  assert.equal(runtime.read("a", "two"), "/monthly");
  assert.equal(runtime.read("b", "one"), "/transactions");
  assert.equal(runtime.read("b", "two"), null);
  runtime.clear();
  assert.equal(runtime.read("a", "one"), "/bills");
  runtime.clear("a");
  assert.equal(runtime.read("a", "one"), null);
  assert.equal(runtime.read("a", "two"), null);
  assert.equal(runtime.read("b", "one"), "/transactions");
});

test("a subsequent notification/deep link cannot be overwritten by delayed restoration", async () => {
  const runtime = createAppRouteMemory();
  runtime.remember("a", "h", "/bills");
  let route = "/";
  const applyEntry = () => {
    const destination = resolveAppEntryRoute({
      applyReady: true,
      expectedScopeKey: "a:h",
      currentScopeKey: "a:h",
      eligibleEntry: route === "/",
      readRoute: () => runtime.read("a", "h"),
    });
    if (destination) route = destination;
  };
  applyEntry();
  assert.equal(route, "/bills");
  route = "/transactions?activityId=notification-target";
  await Promise.resolve();
  applyEntry();
  assert.equal(route, "/transactions?activityId=notification-target");
});

test("navigation memory has no durable storage and pause listeners only remember, never redirect", () => {
  const memory = readFileSync("lib/navigationMemory.ts", "utf8");
  assert.doesNotMatch(memory, /interfacePreferences|AsyncStorage|localStorage|sessionStorage/);
  const layout = readFileSync("app/_layout.tsx", "utf8");
  const pauseStart = layout.indexOf("const rememberRouteBeforePause");
  const pauseEnd = layout.indexOf("return null;", pauseStart);
  assert.ok(pauseStart >= 0 && pauseEnd > pauseStart);
  assert.doesNotMatch(layout.slice(pauseStart, pauseEnd), /router\.|replaceRoute|clearLastAppRoute/);
  const auth = readFileSync("context/AuthContext.tsx", "utf8");
  assert.match(auth, /clearLastAppRoute\(signedOutUserId\)/);
});
