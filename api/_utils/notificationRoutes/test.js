const { sendPushToUser } = require("../push");
const { notificationTestPayload } = require("../notificationTest");
const { authenticatedUser, safeError, serviceSupabase } = require("../supabase");

function body(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return req.body;
}

module.exports = async function testNotification(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  const auth = await authenticatedUser(req);
  if (!auth.user) return res.status(401).json({ error: auth.error, message: "Please sign in again." });

  const type = body(req).type || "pending_transactions";
  let payload;
  try {
    payload = notificationTestPayload(type);
  } catch (error) {
    return res.status(400).json({ error: error.code, message: safeError(error) });
  }

  try {
    if (type === "admin_feedback") {
      const { data: admin, error: adminError } = await serviceSupabase()
        .from("feedback_admins")
        .select("user_id")
        .eq("user_id", auth.user.id)
        .maybeSingle();
      if (adminError) throw adminError;
      if (!admin) return res.status(403).json({ error: "FEEDBACK_ADMIN_REQUIRED", message: "Admin access is required." });
    }

    const result = await sendPushToUser(auth.user.id, payload, type);
    if (result.skipped) {
      return res.status(409).json({ error: "NOTIFICATION_TEST_DISABLED", message: "Turn on this alert before testing it." });
    }
    if (!result.delivered) {
      return res.status(409).json({ error: "NO_ACTIVE_PUSH_DEVICE", message: "No active notification device was found." });
    }
    return res.status(200).json({ ok: true, delivered: result.delivered, type });
  } catch (error) {
    return res.status(500).json({ error: "PUSH_TEST_FAILED", message: safeError(error, "Could not send the test notification.") });
  }
};
