const { sendPushToUser } = require("../push");
const { notificationTestPayload } = require("../notificationTest");
const { authenticatedUser, publicError, safeError, serviceSupabase } = require("../supabase");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
    const householdId = String(body(req).householdId || "").trim();
    if (!UUID_PATTERN.test(householdId)) {
      return res.status(400).json({ error: "HOUSEHOLD_REQUIRED", message: "Choose a household before testing notifications." });
    }
    const db = serviceSupabase();
    const { data: membership, error: membershipError } = await db.from("household_members").select("role")
      .eq("user_id", auth.user.id).eq("household_id", householdId).maybeSingle();
    if (membershipError) throw membershipError;
    if (!membership) return res.status(403).json({ error: "HOUSEHOLD_FORBIDDEN", message: "Choose a household available to this account." });
    if (type === "admin_feedback") {
      const { data: admin, error: adminError } = await db
        .from("feedback_admins")
        .select("user_id")
        .eq("user_id", auth.user.id)
        .maybeSingle();
      if (adminError) throw adminError;
      if (!admin) return res.status(403).json({ error: "FEEDBACK_ADMIN_REQUIRED", message: "Admin access is required." });
    }

    const result = await sendPushToUser(auth.user.id, payload, type, householdId);
    if (result.skipped) {
      return res.status(409).json({ error: "NOTIFICATION_TEST_DISABLED", message: "Turn on this alert before testing it." });
    }
    if (!result.delivered && !result.accepted) {
      return res.status(409).json({ error: "NO_ACTIVE_PUSH_DEVICE", message: "No active notification device was found." });
    }
    return res.status(200).json({ ok: true, delivered: result.delivered, accepted: result.accepted, type });
  } catch (error) {
    return res.status(500).json({ error: "PUSH_TEST_FAILED", message: publicError(error, "Could not send the test notification.") });
  }
};
