import assert from "node:assert/strict";
import test from "node:test";

import { ALGORITHM_GUIDE, FLOWLEDGER_MONEY_RULES, FLOW_GUIDE_SECTIONS, STABILITY_PATH_GUIDE, flowGuideSectionIndex } from "./flowledgerGuide";

test("stability guide follows the calculation stages in order", () => {
  assert.deepEqual(
    STABILITY_PATH_GUIDE.map(step => step.id),
    ["stabilize", "next_paycheck", "breathing_room", "reserve", "momentum", "freedom", "standing"],
  );
  assert.match(STABILITY_PATH_GUIDE.at(-1)?.range ?? "", /180 protected days/);
  assert.match(STABILITY_PATH_GUIDE.map(step => step.range).join(" "), /7-29 protected days/);
  assert.match(STABILITY_PATH_GUIDE.map(step => step.range).join(" "), /30-59 protected days/);
  assert.match(STABILITY_PATH_GUIDE.map(step => step.range).join(" "), /60-179 protected days/);
});

test("the responsive walkthrough exposes each requested section in order", () => {
  assert.deepEqual(FLOW_GUIDE_SECTIONS.map(section => section.id), [
    "overview", "flow-score", "protected-days", "stability", "backup", "algorithms", "faq",
  ]);
  assert.equal(flowGuideSectionIndex("stability"), 3);
  assert.equal(flowGuideSectionIndex("unknown"), 0);
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
