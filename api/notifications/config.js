const { optional } = require("../_utils/env");

module.exports = async function notificationConfig(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  const publicKey = optional("VAPID_PUBLIC_KEY");
  if (!publicKey) return res.status(503).json({ error: "PUSH_NOT_CONFIGURED" });
  res.setHeader("Cache-Control", "public, max-age=3600");
  return res.status(200).json({ publicKey });
};
