import assert from "node:assert/strict";
import {
  canSubmitFeedback,
  feedbackStatusLabel,
  normalizeFeedbackStatus,
  normalizeFeedbackType,
  sanitizeFeedbackMessage,
} from "./feedback";

assert.equal(canSubmitFeedback(""), false);
assert.equal(canSubmitFeedback("ok"), false);
assert.equal(canSubmitFeedback("App froze on setup"), true);

assert.equal(sanitizeFeedbackMessage("  App     froze     here  "), "App  froze  here");
assert.equal(sanitizeFeedbackMessage("x".repeat(4100)).length, 4000);

assert.equal(normalizeFeedbackType("bug"), "bug");
assert.equal(normalizeFeedbackType("bad-value"), "other");

assert.equal(normalizeFeedbackStatus("fixed"), "fixed");
assert.equal(normalizeFeedbackStatus("bad-value"), "new");
assert.equal(feedbackStatusLabel("wont_fix"), "Not planned");
