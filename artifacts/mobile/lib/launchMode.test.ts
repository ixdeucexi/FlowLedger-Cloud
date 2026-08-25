import assert from "node:assert/strict";
import test from "node:test";

import { canPersistPlanSimulations } from "./launchMode";

test("Founding Free keeps public Plan Simulator scenarios on the device", () => {
  assert.equal(canPersistPlanSimulations({ tier: "free", source: "default" }, true), false);
  assert.equal(canPersistPlanSimulations({ tier: "pro", source: "billing" }, true), false);
});

test("admin Pro and the paid launch retain remote Plan Simulator persistence", () => {
  assert.equal(canPersistPlanSimulations({ tier: "pro", source: "admin" }, true), true);
  assert.equal(canPersistPlanSimulations({ tier: "pro", source: "billing" }, false), true);
  assert.equal(canPersistPlanSimulations({ tier: "free", source: "default" }, false), false);
});
