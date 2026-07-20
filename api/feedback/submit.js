const { feedbackNotificationPayload, normalizeFeedbackInput } = require("../_utils/feedback");
const { sendPushToUser } = require("../_utils/push");
const { authenticatedUser, safeError, serviceSupabase } = require("../_utils/supabase");

module.exports = async function submitFeedback(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });

  const auth = await authenticatedUser(req);
  if (!auth.user) return res.status(401).json({ error: auth.error, message: "Please sign in again." });

  let input;
  try {
    input = normalizeFeedbackInput(req.body);
  } catch (error) {
    return res.status(400).json({ error: error.code || "FEEDBACK_INVALID", message: safeError(error, "Check the feedback and try again.") });
  }

  const db = serviceSupabase();
  const userMeta = auth.user.user_metadata || {};
  const senderName = String(userMeta.full_name || userMeta.name || "").trim() || auth.user.email || "a FlowLedger tester";

  try {
    const { data: feedback, error: insertError } = await db
      .from("app_feedback")
      .insert({
        ...input,
        user_id: auth.user.id,
        user_email: auth.user.email || null,
        user_name: String(userMeta.full_name || userMeta.name || "").trim() || null,
      })
      .select("id,feedback_type")
      .single();
    if (insertError) throw insertError;

    const { data: admins, error: adminError } = await db.from("feedback_admins").select("user_id");
    if (adminError) {
      console.error("Feedback saved, but admins could not be loaded:", safeError(adminError));
    } else {
      const payload = feedbackNotificationPayload(feedback.id, feedback.feedback_type, senderName);
      const deliveries = await Promise.allSettled(
        [...new Set((admins || []).map(admin => admin.user_id).filter(Boolean))]
          .map(adminUserId => sendPushToUser(adminUserId, payload)),
      );
      for (const delivery of deliveries) {
        if (delivery.status === "rejected") {
          console.error("Feedback saved, but an admin push failed:", safeError(delivery.reason));
        }
      }
    }

    return res.status(201).json({ ok: true, id: feedback.id });
  } catch (error) {
    return res.status(500).json({ error: "FEEDBACK_SUBMIT_FAILED", message: safeError(error, "Could not send feedback.") });
  }
};
