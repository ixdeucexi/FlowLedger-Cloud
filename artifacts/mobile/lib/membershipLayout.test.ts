import assert from "node:assert/strict";
import test from "node:test";

import { isCompactMembershipLayout } from "./membershipLayout";

test("membership pricing stacks under enlarged-text viewport pressure", () => {
  assert.equal(isCompactMembershipLayout(240), true);
  assert.equal(isCompactMembershipLayout(275), true);
  assert.equal(isCompactMembershipLayout(320), false);
  assert.equal(isCompactMembershipLayout(360), false);
});
