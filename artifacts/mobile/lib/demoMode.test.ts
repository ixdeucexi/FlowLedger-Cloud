import assert from "node:assert/strict";
import test from "node:test";

import { isDevDemoMode } from "./demoMode";

test("dev demo mode only enables on dev preview hosts", () => {
  assert.equal(isDevDemoMode("flow-ledger-cloud-git-dev-flow-ledger-s-projects.vercel.app"), true);
  assert.equal(isDevDemoMode("localhost"), true);
  assert.equal(isDevDemoMode("flow-ledger-cloud.vercel.app"), false);
});

test("dev demo mode can be disabled for real-account testing", () => {
  assert.equal(isDevDemoMode("flow-ledger-cloud-git-dev-flow-ledger-s-projects.vercel.app", "real"), false);
});
