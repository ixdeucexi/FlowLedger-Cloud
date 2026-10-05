const { normalizeFeedbackManagementInput } = require("./feedback");
const UPDATE_CENTER_SCREEN = "Settings / Update Center";
const UPDATE_REQUEST_ACTIONS = new Set(["edit_request", "delete_request", "restore_request"]);

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
module.exports = { UPDATE_CENTER_SCREEN, UPDATE_REQUEST_ACTIONS, manageUpdateRequest };
