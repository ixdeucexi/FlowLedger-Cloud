const {
  feedbackStatusNotificationPayload,
  normalizeFeedbackManagementInput,
} = require("../_utils/feedback");
const { sendPushToUser } = require("../_utils/push");
const { authenticatedUser, safeError, serviceSupabase } = require("../_utils/supabase");

module.exports = async function manageFeedback(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });

  const auth = await authenticatedUser(req);
  if (!auth.user) return res.status(401).json({ error: auth.error, message: "Please sign in again." });

  let input;
  try {
    input = normalizeFeedbackManagementInput(req.body);
  } catch (error) {
    return res.status(400).json({ error: error.code || "FEEDBACK_ACTION_INVALID", message: safeError(error) });
  }

  const db = serviceSupabase();
  try {
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
      const { error: deleteError } = await db.from("app_feedback").delete().eq("id", feedback.id);
      if (deleteError) throw deleteError;
      return res.status(200).json({ ok: true, deleted: true, id: feedback.id });
    }

    const now = new Date().toISOString();
    const updates = {
      updated_by: auth.user.id,
      updated_at: now,
    };
    let notificationOutcome = null;

    if (input.action === "reviewing") {
      Object.assign(updates, {
        status: "reviewing",
        admin_note: input.admin_note,
        archived_at: null,
        resolved_at: null,
      });
      if (input.admin_note) notificationOutcome = "reply";
    } else if (input.action === "updated") {
      Object.assign(updates, {
        status: "fixed",
        admin_note: input.admin_note,
        archived_at: now,
        resolved_at: now,
      });
      notificationOutcome = "updated";
    } else if (input.action === "not_planned") {
      Object.assign(updates, {
        status: "wont_fix",
        admin_note: input.admin_note,
        archived_at: now,
        resolved_at: now,
      });
      notificationOutcome = "not_planned";
    } else if (input.action === "archive") {
      Object.assign(updates, { archived_at: now });
    } else if (input.action === "restore") {
      Object.assign(updates, {
        archived_at: null,
        ...(feedback.status === "fixed" || feedback.status === "wont_fix"
          ? { status: "reviewing", resolved_at: null }
          : {}),
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
        );
        notified = delivery.delivered > 0;
        if (notified) {
          await db
            .from("app_feedback")
            .update({ submitter_notified_at: now })
            .eq("id", feedback.id);
          updated.submitter_notified_at = now;
        }
      } catch (error) {
        console.error("Feedback was updated, but the tester push failed:", safeError(error));
      }
    }

    return res.status(200).json({ ok: true, feedback: updated, notified });
  } catch (error) {
    return res.status(500).json({ error: "FEEDBACK_MANAGE_FAILED", message: safeError(error, "Could not update feedback.") });
  }
};
