const {
  DEFAULT_NOTIFICATION_PREFERENCES,
  normalizeNotificationPreferencePatch,
  normalizeNotificationPreferences,
} = require("../_utils/notificationPreferences");
const { authenticatedUser, safeError, serviceSupabase } = require("../_utils/supabase");

function body(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return req.body;
}

module.exports = async function notificationPreferences(req, res) {
  if (req.method !== "GET" && req.method !== "PATCH") {
    return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  }
  const auth = await authenticatedUser(req);
  if (!auth.user) return res.status(401).json({ error: auth.error, message: "Please sign in again." });

  try {
    const db = serviceSupabase();
    if (req.method === "GET") {
      const [{ data: row, error }, { data: admin, error: adminError }] = await Promise.all([
        db.from("user_notification_preferences").select("*").eq("user_id", auth.user.id).maybeSingle(),
        db.from("feedback_admins").select("user_id").eq("user_id", auth.user.id).maybeSingle(),
      ]);
      if (error) throw error;
      if (adminError) throw adminError;
      return res.status(200).json({
        preferences: normalizeNotificationPreferences(row),
        isFeedbackAdmin: Boolean(admin),
      });
    }

    let patch;
    try {
      patch = normalizeNotificationPreferencePatch(body(req));
    } catch (error) {
      return res.status(400).json({ error: error.code || "NOTIFICATION_PREFERENCE_INVALID", message: safeError(error) });
    }
    const now = new Date().toISOString();
    const { data: existing, error: existingError } = await db
      .from("user_notification_preferences")
      .select("*")
      .eq("user_id", auth.user.id)
      .maybeSingle();
    if (existingError) throw existingError;
    const preferences = { ...DEFAULT_NOTIFICATION_PREFERENCES, ...normalizeNotificationPreferences(existing), ...patch };
    const { data: saved, error: saveError } = await db
      .from("user_notification_preferences")
      .upsert({ user_id: auth.user.id, ...preferences, updated_at: now }, { onConflict: "user_id" })
      .select("*")
      .single();
    if (saveError) throw saveError;
    return res.status(200).json({ preferences: normalizeNotificationPreferences(saved) });
  } catch (error) {
    return res.status(500).json({
      error: "NOTIFICATION_PREFERENCES_FAILED",
      message: safeError(error, "Could not update notification choices."),
    });
  }
};
