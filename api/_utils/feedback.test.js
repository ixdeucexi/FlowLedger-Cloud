const assert = require("node:assert/strict");
const test = require("node:test");

const {
  feedbackNotificationPayload,
  feedbackStatusNotificationPayload,
  normalizeFeedbackInput,
  normalizeFeedbackManagementInput,
} = require("./feedback");

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
  assert.equal(payload.url, "/more?section=admin");
  assert.equal(payload.tag, "feedback-1234");
});

test("feedback management accepts only supported admin actions and bounded notes", () => {
  const input = normalizeFeedbackManagementInput({
    feedback_id: "123e4567-e89b-42d3-a456-426614174000",
    action: "updated",
    admin_note: "  The calendar fix is live.  ",
    status: "anything",
  });
  assert.deepEqual(input, {
    feedback_id: "123e4567-e89b-42d3-a456-426614174000",
    action: "updated",
    admin_note: "The calendar fix is live.",
  });
  assert.throws(() => normalizeFeedbackManagementInput({ feedback_id: "bad", action: "delete" }), /valid feedback/i);
  assert.throws(() => normalizeFeedbackManagementInput({
    feedback_id: "123e4567-e89b-42d3-a456-426614174000",
    action: "invented",
  }), /valid feedback action/i);
});

test("tester outcome notifications are private and deep-link to My Feedback", () => {
  const updated = feedbackStatusNotificationPayload("1234", "updated");
  assert.equal(updated.title, "Your feedback helped improve FlowLedger");
  assert.match(updated.body, /update is now live/i);
  assert.equal(updated.url, "/more?section=help&feedback=1234");
  assert.doesNotMatch(updated.body, /calendar|bank|bill/i);

  const notPlanned = feedbackStatusNotificationPayload("1234", "not_planned");
  assert.match(notPlanned.body, /not planned/i);
});
