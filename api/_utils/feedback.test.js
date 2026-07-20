const assert = require("node:assert/strict");
const test = require("node:test");

const { feedbackNotificationPayload, normalizeFeedbackInput } = require("./feedback");

test("feedback input accepts only supported public fields", () => {
  assert.deepEqual(normalizeFeedbackInput({
    feedback_type: "bug",
    message: "  The save button did not work.  ",
    rating: 5,
    can_contact: true,
    screen: "Settings",
    platform: "web",
    user_id: "someone-else",
  }), {
    feedback_type: "bug",
    screen: "Settings",
    message: "The save button did not work.",
    rating: 5,
    can_contact: true,
    app_version: null,
    platform: "web",
  });
});

test("feedback input rejects messages that are too short", () => {
  assert.throws(() => normalizeFeedbackInput({ message: "no" }), /more detail/i);
});

test("feedback notification opens the admin inbox without exposing the message", () => {
  const payload = feedbackNotificationPayload("1234", "idea", "Tia");
  assert.equal(payload.title, "New FlowLedger feedback");
  assert.equal(payload.body, "New idea from Tia. Tap to review it.");
  assert.equal(payload.url, "/more?section=help");
  assert.equal(payload.tag, "feedback-1234");
});
