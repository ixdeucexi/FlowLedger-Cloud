const { isAuthorizedCron } = require("../_utils/cronAuth");
const { optional } = require("../_utils/env");
const { runMoneyHealthCheck } = require("../_utils/moneyHealth");
const { sendPushToUser } = require("../_utils/push");
const { publicError, serviceSupabase } = require("../_utils/supabase");

module.exports = async function nightlyMoneyHealth(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  const secret = optional("CRON_SECRET");
  if (!secret) return res.status(500).json({ error: "CRON_NOT_CONFIGURED" });
  if (!isAuthorizedCron(req, secret)) return res.status(401).json({ error: "UNAUTHORIZED" });

  const db = serviceSupabase();
  const now = new Date();
  try {
    const { data: settings, error } = await db
      .from("household_settings")
      .select("household_id,time_zone");
    if (error) throw error;
    const due = settings || [];
    const results = [];
    for (const row of due) {
      try {
        const run = await runMoneyHealthCheck({
          householdId: row.household_id,
          timeZone: row.time_zone || "UTC",
          triggeredBy: "nightly",
          db,
          now,
        });
        results.push({ householdId: row.household_id, status: run.status, issueCount: run.issue_count });
        if (run.issue_count > 0 && !run.notified_at) {
          const { data: admins } = await db.from("feedback_admins").select("user_id");
          for (const admin of admins || []) {
            await sendPushToUser(admin.user_id, {
              title: "Money Health needs review",
              body: `${run.issue_count} integrity ${run.issue_count === 1 ? "issue was" : "issues were"} found. No money was changed.`,
              url: "/more?section=admin",
              tag: "flowledger-money-health",
            });
          }
          await db.from("money_health_runs").update({ notified_at: new Date().toISOString() }).eq("id", run.id);
        }
      } catch (error) {
        results.push({ householdId: row.household_id, status: "failed", error: publicError(error, "Money Health check failed.") });
      }
    }
    return res.status(200).json({ ok: true, checked: results.length, results });
  } catch (error) {
    return res.status(500).json({ error: "MONEY_HEALTH_NIGHTLY_FAILED", message: publicError(error, "Money Health checks failed.") });
  }
};
