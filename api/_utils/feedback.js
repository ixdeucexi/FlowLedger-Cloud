const FEEDBACK_TYPES = new Set(["bug", "idea", "confusing", "design", "setup", "other"]);
const FEEDBACK_TYPE_LABELS = {
  bug: "Bug report",
  idea: "New idea",
  confusing: "Confusing experience",
  design: "Design feedback",
  setup: "Setup feedback",
  other: "General feedback",
};
const FEEDBACK_MANAGEMENT_ACTIONS = new Set(["reviewing", "updated", "not_planned", "archive", "restore", "delete"]);

function boundedText(value, maximum, fallback = null) {
  const text = String(value || "").trim();
  return text ? text.slice(0, maximum) : fallback;
}

function normalizeFeedbackInput(body) {
  const message = boundedText(body?.message, 4000, "");
  if (message.length < 3) {
    const error = new Error("Add a little more detail before sending.");
    error.code = "FEEDBACK_MESSAGE_TOO_SHORT";
    throw error;
  }

  const requestedType = boundedText(body?.feedback_type, 20, "other");
  const numericRating = Number(body?.rating);
  const rating = Number.isInteger(numericRating) && numericRating >= 1 && numericRating <= 5
    ? numericRating
    : null;

  return {
    feedback_type: FEEDBACK_TYPES.has(requestedType) ? requestedType : "other",
    screen: boundedText(body?.screen, 160, "Settings / Help & Feedback"),
    message,
    rating,
    can_contact: body?.can_contact === true,
    app_version: boundedText(body?.app_version, 80),
    platform: boundedText(body?.platform, 40),
  };
}

function feedbackNotificationPayload(feedbackId, feedbackType, sender) {
  const typeLabel = FEEDBACK_TYPE_LABELS[feedbackType] || FEEDBACK_TYPE_LABELS.other;
  const senderLabel = boundedText(sender, 80, "a FlowLedger tester");
  return {
    title: "New FlowLedger feedback",
    body: `${typeLabel} from ${senderLabel}. Tap to review it.`,
    url: "/more?section=help",
    tag: `feedback-${feedbackId}`,
  };
}

function normalizeFeedbackManagementInput(body) {
  const feedbackId = boundedText(body?.feedback_id, 80, "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(feedbackId)) {
    const error = new Error("Choose valid feedback before continuing.");
    error.code = "FEEDBACK_ID_INVALID";
    throw error;
  }
  const action = boundedText(body?.action, 24, "");
  if (!FEEDBACK_MANAGEMENT_ACTIONS.has(action)) {
    const error = new Error("Choose a valid feedback action.");
    error.code = "FEEDBACK_ACTION_INVALID";
    throw error;
  }
  return {
    feedback_id: feedbackId,
    action,
    admin_note: boundedText(body?.admin_note, 1000),
  };
}

function feedbackStatusNotificationPayload(feedbackId, outcome) {
  const content = outcome === "updated"
    ? {
        title: "Your feedback helped improve FlowLedger",
        body: "The update is now live. Thank you for helping us improve it.",
      }
    : outcome === "not_planned"
      ? {
          title: "An update on your FlowLedger feedback",
          body: "Thank you for sharing it. This change is not planned right now.",
        }
      : {
          title: "FlowLedger replied to your feedback",
          body: "There is a new response waiting in My Feedback.",
        };
  return {
    ...content,
    url: `/more?section=help&feedback=${encodeURIComponent(feedbackId)}`,
    tag: `feedback-${outcome}-${feedbackId}`,
  };
}

module.exports = {
  feedbackNotificationPayload,
  feedbackStatusNotificationPayload,
  normalizeFeedbackInput,
  normalizeFeedbackManagementInput,
};
