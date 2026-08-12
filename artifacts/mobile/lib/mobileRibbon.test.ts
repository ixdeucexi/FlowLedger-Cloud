import assert from "node:assert/strict";
import test from "node:test";

import { isMobileRibbonAction, MOBILE_RIBBON_ITEMS } from "./mobileRibbon";

test("mobile ribbon keeps Add centered between primary destinations", () => {
  assert.deepEqual(
    MOBILE_RIBBON_ITEMS.map((item) => item.title),
    ["Dashboard", "Bills", "Add", "Activity", "Forecast"],
  );
  assert.equal(MOBILE_RIBBON_ITEMS[2]?.name, "add");
  assert.equal(isMobileRibbonAction("add"), true);
  assert.equal(isMobileRibbonAction("transactions"), false);
});
