import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { LEARNING_TOUR_STEPS } from "./learningTourCatalog";

test("learning tour teaches the main FlowLedger surfaces in order", () => {
  assert.deepEqual(
    LEARNING_TOUR_STEPS.map(step => step.route),
    ["index", "monthly", "bills", "flo"],
  );
  assert.ok(LEARNING_TOUR_STEPS.every(step => step.floSays.includes("I ")));
  assert.ok(LEARNING_TOUR_STEPS.every(step => step.tryThis.length > 20));
  assert.ok(LEARNING_TOUR_STEPS.every(step => !step.tryThis.includes("July")));
});

test("Flo tour keeps its target visible for Basic and Pro members", () => {
  const tabLayout = readFileSync("app/(tabs)/_layout.tsx", "utf8");
  const basicFlo = readFileSync("components/BasicFlo.tsx", "utf8");
  const proFlo = readFileSync("app/(tabs)/flo.tsx", "utf8");

  assert.match(tabLayout, /activeStep\.route === "flo"[\s\S]*?top:/);
  assert.match(basicFlo, /prompt\.id === "afford" \? "guided-tour-flo"/);
  assert.match(proFlo, /nativeID="guided-tour-flo"/);
});
