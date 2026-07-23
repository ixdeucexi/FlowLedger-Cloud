const NOTIFICATION_TEST_PAYLOADS = Object.freeze({
  pending_transactions: Object.freeze({
    title: "Test: Pending bank activity",
    body: "A bank charge is pending. It is visible in Activity but is not counted yet.",
    url: "/transactions",
    tag: "flowledger-test-pending",
  }),
  posted_transactions: Object.freeze({
    title: "Test: Posted transaction",
    body: "A posted bank transaction is ready to match in Review Center.",
    url: "/more?section=review",
    tag: "flowledger-test-posted",
  }),
  overdue_bills: Object.freeze({
    title: "Test: Bill past due",
    body: "A planned bill is past due and still needs your attention.",
    url: "/bills?attention=overdue",
    tag: "flowledger-test-overdue",
  }),
  feedback_updates: Object.freeze({
    title: "Test: Feedback update",
    body: "FlowLedger replied to feedback you sent.",
    url: "/more?section=help",
    tag: "flowledger-test-feedback-update",
  }),
  admin_feedback: Object.freeze({
    title: "Test: New tester feedback",
    body: "A tester sent new feedback to the admin inbox.",
    url: "/more?section=admin",
    tag: "flowledger-test-admin-feedback",
  }),
});

function notificationTestPayload(type) {
  const payload = NOTIFICATION_TEST_PAYLOADS[type];
  if (!payload) {
    const error = new Error("Choose a valid notification to test.");
    error.code = "NOTIFICATION_TEST_TYPE_INVALID";
    throw error;
  }
  return payload;
}

module.exports = {
  NOTIFICATION_TEST_PAYLOADS,
  notificationTestPayload,
};
