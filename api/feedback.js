const {
  feedbackNotificationPayload,
  feedbackStatusNotificationPayload,
  normalizeFeedbackInput,
  normalizeFeedbackManagementInput,
} = require("./_utils/feedback");
const { sendPushToUser } = require("./_utils/push");
const { authenticatedUser, safeError, serviceSupabase } = require("./_utils/supabase");

async function submitFeedback(db, auth, body, res) {
  let input;
  try {
    input = normalizeFeedbackInput(body);
  } catch (error) {
    return res.status(400).json({ error: error.code || "FEEDBACK_INVALID", message: safeError(error, "Check the feedback and try again.") });
  }

  const userMeta = auth.user.user_metadata || {};
  const senderName = String(userMeta.full_name || userMeta.name || "").trim() || auth.user.email || "a FlowLedger tester";
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
        .map(adminUserId => sendPushToUser(adminUserId, payload, "admin_feedback")),
    );
    for (const delivery of deliveries) {
      if (delivery.status === "rejected") console.error("Feedback saved, but an admin push failed:", safeError(delivery.reason));
    }
  }
  return res.status(201).json({ ok: true, id: feedback.id });
}

async function manageFeedback(db, auth, body, res) {
  let input;
  try {
    input = normalizeFeedbackManagementInput(body);
  } catch (error) {
    return res.status(400).json({ error: error.code || "FEEDBACK_ACTION_INVALID", message: safeError(error) });
  }

  const { data: admin, error: adminError } = await db
    .from("feedback_admins")
    .select("user_id")
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (adminError) throw adminError;
  if (!admin) return res.status(403).json({ error: "FEEDBACK_ADMIN_REQUIRED", message: "Admin access is required." });

  const { data: feedback, error: feedbackError } = await db
    .from("app_feedback")
    .select("*")
    .eq("id", input.feedback_id)
    .maybeSingle();
  if (feedbackError) throw feedbackError;
  if (!feedback) return res.status(404).json({ error: "FEEDBACK_NOT_FOUND", message: "That feedback no longer exists." });

  if (input.action === "delete") {
    const { error } = await db.from("app_feedback").delete().eq("id", feedback.id);
    if (error) throw error;
    return res.status(200).json({ ok: true, deleted: true, id: feedback.id });
  }

  const now = new Date().toISOString();
  const updates = { updated_by: auth.user.id, updated_at: now };
  let notificationOutcome = null;
  if (input.action === "reviewing") {
    Object.assign(updates, { status: "reviewing", admin_note: input.admin_note, archived_at: null, resolved_at: null });
    if (input.admin_note) notificationOutcome = "reply";
  } else if (input.action === "updated") {
    Object.assign(updates, { status: "fixed", admin_note: input.admin_note, archived_at: now, resolved_at: now });
    notificationOutcome = "updated";
  } else if (input.action === "not_planned") {
    Object.assign(updates, { status: "wont_fix", admin_note: input.admin_note, archived_at: now, resolved_at: now });
    notificationOutcome = "not_planned";
  } else if (input.action === "archive") {
    Object.assign(updates, { archived_at: now });
  } else if (input.action === "restore") {
    Object.assign(updates, {
      archived_at: null,
      ...(feedback.status === "fixed" || feedback.status === "wont_fix" ? { status: "reviewing", resolved_at: null } : {}),
    });
  }

  const { data: updated, error: updateError } = await db
    .from("app_feedback")
    .update(updates)
    .eq("id", feedback.id)
    .select("*")
    .single();
  if (updateError) throw updateError;

  let notified = false;
  if (notificationOutcome && feedback.can_contact) {
    try {
      const delivery = await sendPushToUser(
        feedback.user_id,
        feedbackStatusNotificationPayload(feedback.id, notificationOutcome),
        "feedback_updates",
      );
      notified = delivery.delivered > 0;
      if (notified) {
        await db.from("app_feedback").update({ submitter_notified_at: now }).eq("id", feedback.id);
        updated.submitter_notified_at = now;
      }
    } catch (error) {
      console.error("Feedback was updated, but the tester push failed:", safeError(error));
    }
  }
  return res.status(200).json({ ok: true, feedback: updated, notified });
}

module.exports = async function feedback(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  const auth = await authenticatedUser(req);
  if (!auth.user) return res.status(401).json({ error: auth.error, message: "Please sign in again." });

  try {
    const db = serviceSupabase();
    return req.body?.action
      ? await manageFeedback(db, auth, req.body, res)
      : await submitFeedback(db, auth, req.body, res);
  } catch (error) {
    const managing = Boolean(req.body?.action);
    return res.status(500).json({
      error: managing ? "FEEDBACK_MANAGE_FAILED" : "FEEDBACK_SUBMIT_FAILED",
      message: safeError(error, managing ? "Could not update feedback." : "Could not send feedback."),
    });
  }
};
