const { normalizeFeedbackManagementInput } = require("./feedback");
const { createHash } = require("node:crypto");
const UPDATE_CENTER_SCREEN = "Settings / Update Center";
const UPDATE_REQUEST_ACTIONS = new Set(["edit_request", "delete_request", "restore_request"]);

function feedbackCopyRequestId(adminId, feedbackId) {
  // RFC 9562 UUIDv5, using the URL namespace and a versioned FlowLedger name.
  const namespace = Buffer.from("6ba7b8119dad11d180b400c04fd430c8", "hex");
  const name = `flowledger:update-center:feedback-copy:v1\n${adminId.toLowerCase()}\n${feedbackId.toLowerCase()}`;
  const bytes = createHash("sha1").update(namespace).update(name, "utf8").digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function copiedFeedbackMessage(feedback) {
  // Keep the entire saved message. Context is optional when the message fills the field.
  const message = feedback.message;
  if (typeof message !== "string" || message.trim().length < 3 || [...message].length > 4000) {
    throw new Error("The saved feedback cannot be copied.");
  }
  const screen = typeof feedback.screen === "string" ? feedback.screen.trim().slice(0, 160) : "";
  const withContext = screen ? `Source screen: ${screen}\n\n${message}` : message;
  return [...withContext].length <= 4000 ? withContext : message;
}

async function copyFeedbackToUpdateCenter(db, auth, feedback, res) {
  if (feedback.screen === UPDATE_CENTER_SCREEN) {
    return res.status(409).json({ error: "UPDATE_REQUEST_ALREADY_SOURCE", message: "This feedback is already an update request." });
  }
  const id = feedbackCopyRequestId(auth.user.id, feedback.id);
  const { data: inserted, error: insertError } = await db.from("app_feedback").insert({
    id,
    user_id: auth.user.id,
    screen: UPDATE_CENTER_SCREEN,
    feedback_type: "idea",
    message: copiedFeedbackMessage(feedback),
    status: "new",
    can_contact: false,
  }).select("id,archived_at,status").single();

  let copiedRequest = inserted;
  if (insertError) {
    if (insertError.code !== "23505") throw insertError;
    // The primary key makes concurrent copies atomic. Never upsert or restore a prior copy.
    const { data: existing, error: lookupError } = await db.from("app_feedback")
      .select("id,user_id,screen,archived_at,status")
      .eq("id", id).eq("user_id", auth.user.id).eq("screen", UPDATE_CENTER_SCREEN).maybeSingle();
    if (lookupError) throw lookupError;
    if (!existing || existing.id !== id || existing.user_id !== auth.user.id || existing.screen !== UPDATE_CENTER_SCREEN) {
      throw insertError;
    }
    copiedRequest = existing;
  }
  if (!copiedRequest) throw new Error("The copied update request could not be confirmed.");
  return res.status(200).json({
    ok: true,
    copiedRequest: { id: copiedRequest.id, archived_at: copiedRequest.archived_at, status: copiedRequest.status },
    alreadyExists: Boolean(insertError),
  });
}

async function manageUpdateRequest(db, auth, body, res) {
  let id, message;
  try {
    id = normalizeFeedbackManagementInput({ feedback_id: body.feedback_id, action: "archive" }).feedback_id;
    if (body.action === "edit_request") {
      if (typeof body.message !== "string") throw new Error("Enter a valid update request.");
      message = body.message.trim().replace(/\s{3,}/g, " ");
      if (message.length < 3 || message.length > 4000) throw new Error("Use between 3 and 4,000 characters.");
    }
  } catch (error) {
    return res.status(400).json({ error: "UPDATE_REQUEST_INVALID", message: error.message });
  }
  const { data: admin, error: adminError } = await db.from("feedback_admins")
    .select("user_id").eq("user_id", auth.user.id).maybeSingle();
  if (adminError) throw adminError;
  if (!admin) return res.status(403).json({ error: "FEEDBACK_ADMIN_REQUIRED", message: "Admin access is required." });
  // Scope both lookup and write. Recheck pending status on the write to protect completed history.
  const { data: request, error: lookupError } = await db.from("app_feedback").select("*")
    .eq("id", id).eq("user_id", auth.user.id).eq("screen", UPDATE_CENTER_SCREEN).maybeSingle();
  if (lookupError) throw lookupError;
  if (!request) return res.status(404).json({ error: "UPDATE_REQUEST_NOT_FOUND", message: "That update request could not be found." });
  if (!["new", "reviewing"].includes(request.status) || (body.action === "edit_request" && request.archived_at)) {
    return res.status(409).json({ error: "UPDATE_REQUEST_READ_ONLY", message: "Completed or deleted requests cannot be edited. Restore a deleted pending request first." });
  }
  const now = new Date().toISOString();
  const changes = { updated_by: auth.user.id, updated_at: now,
    ...(body.action === "edit_request" ? { message } : { archived_at: body.action === "delete_request" ? now : null }) };
  let write = db.from("app_feedback").update(changes)
    .eq("id", id).eq("user_id", auth.user.id).eq("screen", UPDATE_CENTER_SCREEN).in("status", ["new", "reviewing"]);
  if (body.action === "edit_request") write = write.is("archived_at", null);
  const { data: updated, error: writeError } = await write.select("*").maybeSingle();
  if (writeError) throw writeError;
  if (!updated) return res.status(409).json({ error: "UPDATE_REQUEST_CHANGED", message: "This request changed. Refresh your requests and try again." });
  return res.status(200).json({ ok: true, feedback: updated });
}
module.exports = { UPDATE_CENTER_SCREEN, UPDATE_REQUEST_ACTIONS, copyFeedbackToUpdateCenter, manageUpdateRequest };
