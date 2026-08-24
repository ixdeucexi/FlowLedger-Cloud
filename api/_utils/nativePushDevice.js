const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validExpoPushToken(value) {
  return typeof value === "string" && /^Expo(?:nent)?PushToken\[[A-Za-z0-9_-]{10,300}\]$/.test(value);
}

function normalizeNativePushDevice(payload, requireToken = true) {
  const installationId = String(payload?.installationId || "").trim();
  const householdId = String(payload?.householdId || "").trim();
  const token = String(payload?.token || "").trim();
  const platform = String(payload?.platform || "").trim();
  const environment = String(payload?.environment || "").trim();
  if (!UUID_PATTERN.test(installationId) || !["ios", "android"].includes(platform)
    || !["development", "preview", "production"].includes(environment)
    || (!requireToken && householdId && !UUID_PATTERN.test(householdId))
    || (requireToken && (!UUID_PATTERN.test(householdId) || !validExpoPushToken(token)))) return null;
  return { installationId, householdId, token, platform, environment };
}

function nativePushRegistrationKey(userId, device) {
  return `${userId}:${device.installationId}:${device.environment}`;
}

module.exports = { nativePushRegistrationKey, normalizeNativePushDevice, validExpoPushToken };
