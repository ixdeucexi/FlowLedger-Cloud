function validPushKey(value, min, max) {
  return typeof value === "string"
    && value.length >= min
    && value.length <= max
    && /^[A-Za-z0-9_-]+$/.test(value);
}

function validPushEndpoint(value) {
  if (typeof value !== "string" || value.length < 10 || value.length > 4096) return false;
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}

module.exports = { validPushEndpoint, validPushKey };
