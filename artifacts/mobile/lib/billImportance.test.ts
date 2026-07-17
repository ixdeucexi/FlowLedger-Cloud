import assert from "node:assert/strict";
import test from "node:test";

import { isRequiredBill, normalizeBillImportance } from "./billImportance";

test("Must Pay is the safe default for existing and new bills", () => {
  assert.equal(normalizeBillImportance(null), "must");
  assert.equal(normalizeBillImportance("unknown"), "must");
  assert.equal(isRequiredBill(undefined), true);
});

test("flexible and optional bills stay outside required backup math", () => {
  assert.equal(normalizeBillImportance("flexible"), "flexible");
  assert.equal(normalizeBillImportance("optional"), "optional");
  assert.equal(isRequiredBill("flexible"), false);
  assert.equal(isRequiredBill("optional"), false);
});

test("debt minimums are always Must Pay", () => {
  assert.equal(normalizeBillImportance("optional", true), "must");
  assert.equal(isRequiredBill("optional", true), true);
});
