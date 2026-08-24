const { authenticatedUser, publicError, serviceSupabase } = require("../supabase");
const { validPushEndpoint, validPushKey } = require("../pushValidation");
const { normalizeNativePushDevice } = require("../nativePushDevice");
const { pushEnvironment } = require("../env");

function body(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return req.body;
}

module.exports = async function notificationSubscription(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Vary", "Authorization");
  if (!["GET", "POST", "DELETE"].includes(req.method)) {
    return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  }
  const auth = await authenticatedUser(req);
  if (!auth.user) return res.status(401).json({ error: auth.error, message: "Please sign in again." });

  const payload = req.method === "GET" ? req.query || {} : body(req);
  if (payload.kind === "expo") {
    const device = normalizeNativePushDevice(payload, req.method === "POST");
    if (!device) {
      return res.status(400).json({ error: "EXPO_PUSH_DEVICE_INVALID", message: "This app returned invalid notification device details." });
    }
    const { installationId, householdId, token, platform, environment } = device;
    try {
      if (environment !== pushEnvironment()) {
        return res.status(409).json({ error: "PUSH_ENVIRONMENT_MISMATCH", message: "This build cannot register notifications with this deployment." });
      }
      const db = serviceSupabase();
      if (req.method === "GET") {
        if (!householdId) return res.status(400).json({ error: "HOUSEHOLD_REQUIRED" });
        const { data: membership, error: membershipError } = await db.from("household_members").select("role")
          .eq("user_id", auth.user.id).eq("household_id", householdId).maybeSingle();
        if (membershipError) throw membershipError;
        if (!membership) return res.status(403).json({ error: "HOUSEHOLD_FORBIDDEN", message: "Choose a household available to this account." });
        const { data: registration, error } = await db.from("native_push_devices").select("id,status")
          .eq("user_id", auth.user.id).eq("household_id", householdId).eq("installation_id", installationId)
          .eq("platform", platform).eq("environment", environment).eq("status", "active").maybeSingle();
        if (error) throw error;
        return res.status(200).json({ ok: true, registered: Boolean(registration) });
      }
      if (req.method === "DELETE") {
        const { error } = await db.from("native_push_devices").delete()
          .eq("user_id", auth.user.id).eq("installation_id", installationId).eq("environment", environment);
        if (error) throw error;
        return res.status(200).json({ ok: true });
      }
      const { data: membership, error: membershipError } = await db.from("household_members").select("role")
        .eq("user_id", auth.user.id).eq("household_id", householdId).maybeSingle();
      if (membershipError) throw membershipError;
      if (!membership) return res.status(403).json({ error: "HOUSEHOLD_FORBIDDEN", message: "Choose a household available to this account." });
      const { data: existingToken, error: tokenError } = await db.from("native_push_devices").select("user_id")
        .eq("expo_push_token", token).maybeSingle();
      if (tokenError) throw tokenError;
      if (existingToken && existingToken.user_id !== auth.user.id) {
        return res.status(409).json({ error: "EXPO_PUSH_IDENTITY_MISMATCH", message: "Sign out of the other FlowLedger account on this device first." });
      }
      if (existingToken) {
        const { error: staleTokenError } = await db.from("native_push_devices").delete()
          .eq("user_id", auth.user.id).eq("expo_push_token", token).neq("installation_id", installationId);
        if (staleTokenError) throw staleTokenError;
      }
      const now = new Date().toISOString();
      const { error } = await db.from("native_push_devices").upsert({
        user_id: auth.user.id,
        household_id: householdId,
        installation_id: installationId,
        expo_push_token: token,
        platform,
        environment,
        status: "active",
        last_error: null,
        last_registered_at: now,
        updated_at: now,
      }, { onConflict: "user_id,installation_id,environment" });
      if (error) throw error;
      return res.status(200).json({ ok: true });
    } catch (error) {
      return res.status(500).json({ error: "EXPO_PUSH_DEVICE_FAILED", message: publicError(error, "Could not update notifications for this device.") });
    }
  }

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
    return res.status(500).json({ error: "PUSH_SUBSCRIPTION_FAILED", message: publicError(error, "Could not update notifications.") });
  }
};
