const { sendPushToUser } = require("../_utils/push");
const { authenticatedUser, safeError } = require("../_utils/supabase");

module.exports = async function testNotification(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  const auth = await authenticatedUser(req);
  if (!auth.user) return res.status(401).json({ error: auth.error, message: "Please sign in again." });
  try {
    const result = await sendPushToUser(auth.user.id, {
      title: "FlowLedger notifications are on",
      body: "New posted transactions will notify you and open Review Center.",
      url: "/more?section=review",
      tag: "flowledger-test",
    });
    if (!result.delivered) {
      return res.status(409).json({ error: "NO_ACTIVE_PUSH_DEVICE", message: "No active notification device was found." });
    }
    return res.status(200).json({ ok: true, delivered: result.delivered });
  } catch (error) {
    return res.status(500).json({ error: "PUSH_TEST_FAILED", message: safeError(error, "Could not send the test notification.") });
  }
};
