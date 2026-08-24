const { isAuthorizedCron } = require("../cronAuth");
const { optional } = require("../env");
const { processExpoReceipts } = require("../push");
const { safeError } = require("../supabase");

module.exports = async function notificationReceipts(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  const secret = optional("CRON_SECRET");
  if (!secret) return res.status(500).json({ error: "CRON_NOT_CONFIGURED" });
  if (!isAuthorizedCron(req, secret)) return res.status(401).json({ error: "UNAUTHORIZED" });
  try { return res.status(200).json({ ok: true, ...(await processExpoReceipts()) }); }
  catch (error) { return res.status(500).json({ error: "EXPO_RECEIPT_PROCESSING_FAILED", message: safeError(error, "Notification receipts could not be checked.") }); }
};
