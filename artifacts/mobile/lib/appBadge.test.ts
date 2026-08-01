import assert from "node:assert/strict";
import test from "node:test";

import { appNotificationCount } from "./appBadge";

test("app badge combines every actionable notification group", () => {
  assert.equal(appNotificationCount(2, 3, 1), 6);
});

test("app badge ignores invalid and negative counts", () => {
  assert.equal(appNotificationCount(-4, Number.NaN, 2.9), 2);
});
