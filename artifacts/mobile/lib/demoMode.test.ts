import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { isDevDemoMode, isStoreCaptureMode } from "./demoMode";

test("dev demo mode is disabled while fake data is paused", () => {
  assert.equal(isDevDemoMode("flow-ledger-cloud-git-dev-flow-ledger-s-projects.vercel.app"), false);
  assert.equal(isDevDemoMode("localhost"), false);
  assert.equal(isDevDemoMode("flow-ledger-cloud.vercel.app"), false);
});

test("dev demo mode stays disabled for real-account testing", () => {
  assert.equal(isDevDemoMode("flow-ledger-cloud-git-dev-flow-ledger-s-projects.vercel.app", "real"), false);
});

test("sample budget cannot enable local demo mode on live", () => {
  assert.equal(isDevDemoMode("flow-ledger-cloud.vercel.app", "demo"), false);
});

test("fictional store capture mode is limited to local development", () => {
  assert.equal(isStoreCaptureMode("localhost", "reviewer-v1"), true);
  assert.equal(isStoreCaptureMode("127.0.0.1", "reviewer-v1"), true);
  assert.equal(isStoreCaptureMode("flowledger-algo.com", "reviewer-v1"), false);
  assert.equal(isStoreCaptureMode("localhost", "production"), false);
  assert.equal(isDevDemoMode("localhost", "real", "reviewer-v1"), true);
});

test("fictional capture screens avoid live account requests", () => {
  const flo = readFileSync("app/(tabs)/flo.tsx", "utf8");
  const activity = readFileSync("app/(tabs)/transactions.tsx", "utf8");
  const dashboard = readFileSync("app/(tabs)/index.tsx", "utf8");
  const installPrompt = readFileSync("components/PwaInstallPrompt.tsx", "utf8");

  assert.match(flo, /demoMode \? storeCaptureChat : initialChat/);
  assert.match(flo, /if \(demoMode \|\| !user\?\.id \|\| !activeHousehold\?\.householdId \|\| floProLocked\)/);
  assert.match(activity, /if \(demoMode\) \{/);
  assert.match(dashboard, /const timeGreeting = demoMode\s+\? "Good morning"/);
  assert.match(installPrompt, /platform === "desktop" \|\| storeCaptureMode/);
});
