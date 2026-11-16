const { isAuthorizedCron } = require("../cronAuth");
const { optional, pushEnvironment } = require("../env");
const { runAccountTipNotifications } = require("../accountTipNotifications");
const { queueAccountTipNotification } = require("../push");
const { serviceSupabase } = require("../supabase");

function createAccountTipHandler(dependencies = {}) {
  return async function accountTipNotifications(req, res) {
    res.setHeader("Cache-Control", "private, no-store");
    if (req.method !== "GET") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
    const secret = optional("CRON_SECRET");
    if (!secret) return res.status(500).json({ error: "CRON_NOT_CONFIGURED" });
    if (!isAuthorizedCron(req, secret)) return res.status(401).json({ error: "UNAUTHORIZED" });
    try {
      const result = await (dependencies.run || runAccountTipNotifications)({
        db: (dependencies.serviceSupabase || serviceSupabase)(),
        queue: queueAccountTipNotification,
        environment: (dependencies.pushEnvironment || pushEnvironment)(),
        now: dependencies.now ? dependencies.now() : new Date(),
      });
      return res.status(result.ok ? 200 : 500).json(result);
    } catch {
      return res.status(500).json({ error: "ACCOUNT_TIP_NOTIFICATIONS_FAILED" });
    }
  };
}

module.exports = createAccountTipHandler();
module.exports.createAccountTipHandler = createAccountTipHandler;
