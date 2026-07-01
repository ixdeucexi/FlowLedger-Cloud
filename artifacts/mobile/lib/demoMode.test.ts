import assert from "node:assert/strict";
import test from "node:test";

import { isDevDemoMode } from "./demoMode";

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
