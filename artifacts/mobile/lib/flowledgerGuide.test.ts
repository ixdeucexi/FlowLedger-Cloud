import assert from "node:assert/strict";
import test from "node:test";

import { ALGORITHM_GUIDE, FLOWLEDGER_MONEY_RULES, STABILITY_PATH_GUIDE } from "./flowledgerGuide";

test("stability guide follows the calculation stages in order", () => {
  assert.deepEqual(
    STABILITY_PATH_GUIDE.map(step => step.id),
    ["stabilize", "next_paycheck", "breathing_room", "reserve", "standing"],
  );
  assert.match(STABILITY_PATH_GUIDE.at(-1)?.range ?? "", /30-90 protected days/);
});

test("the guide explains core money rules without unrelated product messaging", () => {
  const copy = [
    ...STABILITY_PATH_GUIDE.flatMap(step => [step.title, step.range, step.description]),
    ...ALGORITHM_GUIDE.flatMap(item => [item.title, item.description]),
    ...FLOWLEDGER_MONEY_RULES,
  ].join(" ");
  assert.match(copy, /Savings stays separate/);
  assert.match(copy, /Pending bank activity/);
  assert.doesNotMatch(copy, /Flowmentum/i);
});
