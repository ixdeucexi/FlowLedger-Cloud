const crypto = require("crypto");
const { required } = require("./env");

function encryptionKey() {
  const raw = required("PLAID_TOKEN_ENCRYPTION_KEY");
  let key = null;
  if (/^[0-9a-f]{64}$/i.test(raw)) key = Buffer.from(raw, "hex");
  if (!key) {
    try { key = Buffer.from(raw, "base64"); } catch { key = null; }
  }
  if (!key || key.length !== 32) {
    const error = new Error("PLAID_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes.");
    error.code = "PLAID_TOKEN_ENCRYPTION_KEY_INVALID";
    throw error;
  }
  return key;
}

function encryptAccessToken(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${ciphertext.toString("base64url")}`;
}

function decryptAccessToken(value) {
  const parts = String(value || "").split(".");
  if (parts.length !== 4 || parts[0] !== "v1") throw new Error("Encrypted Plaid token has an invalid format.");
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(parts[1], "base64url"));
  decipher.setAuthTag(Buffer.from(parts[2], "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(parts[3], "base64url")), decipher.final()]).toString("utf8");
}

module.exports = { encryptAccessToken, decryptAccessToken };
