import assert from "node:assert/strict";
import test from "node:test";

import {
  FLOW_SCORE_CONFIDENCE_POINTS,
  FLOW_SCORE_GUIDE,
  FLOW_SCORE_MAX_POINTS,
  FLOW_SCORE_SPENDING_POINTS,
  FLOW_SCORE_WEIGHTS,
} from "./flowScorePolicy";

test("Flow Score guide matches the 100-point scoring policy", () => {
  assert.equal(FLOW_SCORE_MAX_POINTS, 100);
  assert.deepEqual(
    FLOW_SCORE_GUIDE.map(item => item.points),
    Object.values(FLOW_SCORE_WEIGHTS),
  );
});

test("Flow Score explains confidence and spending point levels", () => {
  assert.deepEqual(FLOW_SCORE_CONFIDENCE_POINTS, { high: 10, medium: 6, low: 2 });
  assert.deepEqual(FLOW_SCORE_SPENDING_POINTS, { clear: 5, pressure: 2, over: 0 });
  assert.match(FLOW_SCORE_GUIDE.map(item => item.description).join(" "), /overdue bill/i);
  assert.match(FLOW_SCORE_GUIDE.map(item => item.description).join(" "), /180-day backup/i);
});
