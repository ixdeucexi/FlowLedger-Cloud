import assert from "node:assert/strict";
import test from "node:test";

import { tabBadgeValue } from "./tabBadge";

test("tab badges hide empty counts and cap large counts", () => {
  assert.equal(tabBadgeValue(0), undefined);
  assert.equal(tabBadgeValue(-2), undefined);
  assert.equal(tabBadgeValue(3), 3);
  assert.equal(tabBadgeValue(105), "99+");
});
