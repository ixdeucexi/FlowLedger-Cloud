import assert from "node:assert/strict";
import test from "node:test";

import { canPersistPlanSimulations } from "./launchMode";

test("Free and founding planning alone never authorize cloud scenario writes", () => {
  for (const foundingLaunch of [true, false]) {
    assert.equal(canPersistPlanSimulations({ tier: "free", source: "default" }, foundingLaunch), false);
    assert.equal(canPersistPlanSimulations(null, foundingLaunch), false);
  }
});

test("actual paid, permanent grandfathered, and admin Pro retain cloud eligibility independently of checkout launch", () => {
  for (const source of ["billing", "grandfathered", "admin"]) {
    for (const foundingLaunch of [true, false]) {
      assert.equal(canPersistPlanSimulations({ tier: "pro", source }, foundingLaunch), true);
    }
  }
});
