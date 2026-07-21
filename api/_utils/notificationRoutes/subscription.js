const { authenticatedUser, safeError, serviceSupabase } = require("../supabase");
const { validPushEndpoint, validPushKey } = require("../pushValidation");

function body(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return req.body;
}

module.exports = async function notificationSubscription(req, res) {
  if (req.method !== "POST" && req.method !== "DELETE") {
    return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  }
  const auth = await authenticatedUser(req);
  if (!auth.user) return res.status(401).json({ error: auth.error, message: "Please sign in again." });

  const payload = body(req);
  const endpoint = payload.endpoint;
  if (!validPushEndpoint(endpoint)) {
    return res.status(400).json({ error: "PUSH_ENDPOINT_INVALID", message: "This device returned an invalid notification endpoint." });
  }

  try {
    const db = serviceSupabase();
    if (req.method === "DELETE") {
      const { error } = await db
        .from("push_subscriptions")
        .delete()
        .eq("user_id", auth.user.id)
        .eq("endpoint", endpoint);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    const p256dh = payload.keys && payload.keys.p256dh;
    const pushAuth = payload.keys && payload.keys.auth;
    if (!validPushKey(p256dh, 20, 512) || !validPushKey(pushAuth, 8, 256)) {
      return res.status(400).json({ error: "PUSH_KEYS_INVALID", message: "This device returned invalid notification keys." });
    }
    const now = new Date().toISOString();
    const { error } = await db.from("push_subscriptions").upsert({
      user_id: auth.user.id,
      endpoint,
      p256dh,
      auth: pushAuth,
      user_agent: String(req.headers["user-agent"] || "").slice(0, 500) || null,
      updated_at: now,
    }, { onConflict: "endpoint" });
    if (error) throw error;
    return res.status(200).json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: "PUSH_SUBSCRIPTION_FAILED", message: safeError(error, "Could not update notifications.") });
  }
};
