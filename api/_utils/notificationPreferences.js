const NOTIFICATION_PREFERENCE_KEYS = Object.freeze([
  "pending_transactions",
  "posted_transactions",
  "overdue_bills",
  "feedback_updates",
  "admin_feedback",
]);

const DEFAULT_NOTIFICATION_PREFERENCES = Object.freeze(
  Object.fromEntries(NOTIFICATION_PREFERENCE_KEYS.map(key => [key, true])),
);

function normalizeNotificationPreferences(row) {
  return Object.fromEntries(NOTIFICATION_PREFERENCE_KEYS.map(key => [
    key,
    typeof row?.[key] === "boolean" ? row[key] : DEFAULT_NOTIFICATION_PREFERENCES[key],
  ]));
}

function normalizeNotificationPreferencePatch(body) {
  const patch = {};
  for (const key of NOTIFICATION_PREFERENCE_KEYS) {
    if (body?.[key] === undefined) continue;
    if (typeof body[key] !== "boolean") {
      const error = new Error("Notification choices must be on or off.");
      error.code = "NOTIFICATION_PREFERENCE_INVALID";
      throw error;
    }
    patch[key] = body[key];
  }
  if (!Object.keys(patch).length) {
    const error = new Error("Choose at least one notification setting to update.");
    error.code = "NOTIFICATION_PREFERENCE_EMPTY";
    throw error;
  }
  return patch;
}

async function notificationPreferenceEnabled(db, userId, preferenceKey) {
  if (!NOTIFICATION_PREFERENCE_KEYS.includes(preferenceKey)) return true;
  const { data, error } = await db
    .from("user_notification_preferences")
    .select(preferenceKey)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return normalizeNotificationPreferences(data)[preferenceKey];
}

module.exports = {
  DEFAULT_NOTIFICATION_PREFERENCES,
  NOTIFICATION_PREFERENCE_KEYS,
  normalizeNotificationPreferencePatch,
  normalizeNotificationPreferences,
  notificationPreferenceEnabled,
};
