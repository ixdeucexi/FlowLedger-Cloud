const { authenticatedUser, safeError, serviceSupabase } = require("../_utils/supabase");
const { runMoneyHealthCheck } = require("../_utils/moneyHealth");

async function approvedAdmin(db, userId) {
  const { data, error } = await db
    .from("feedback_admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

async function householdForAdmin(db, userId, requestedHouseholdId) {
  if (requestedHouseholdId) {
    const { data, error } = await db
      .from("household_members")
      .select("household_id")
      .eq("household_id", requestedHouseholdId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    if (data) return data.household_id;
  }
  const { data, error } = await db
    .from("household_members")
    .select("household_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data && data.household_id;
}

module.exports = async function moneyHealth(req, res) {
  if (!["GET", "POST"].includes(req.method)) {
    return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  }
  const auth = await authenticatedUser(req);
  if (!auth.user) return res.status(401).json({ error: auth.error, message: "Please sign in again." });

  const db = serviceSupabase();
  try {
    if (!(await approvedAdmin(db, auth.user.id))) {
      return res.status(403).json({ error: "ADMIN_REQUIRED", message: "Admin access is required." });
    }
    const requestedHouseholdId = String(
      req.headers["x-flowledger-household-id"] || req.query?.householdId || "",
    ).trim();
    const householdId = await householdForAdmin(db, auth.user.id, requestedHouseholdId);
    if (!householdId) return res.status(404).json({ error: "HOUSEHOLD_NOT_FOUND" });

    if (req.method === "POST") {
      const { data: settings } = await db
        .from("household_settings")
        .select("time_zone")
        .eq("household_id", householdId)
        .maybeSingle();
      await runMoneyHealthCheck({
        householdId,
        timeZone: settings?.time_zone || "UTC",
        triggeredBy: "manual",
        checkedBy: auth.user.id,
        db,
      });
    }

    const { data: runs, error } = await db
      .from("money_health_runs")
      .select("*")
      .eq("household_id", householdId)
      .order("checked_at", { ascending: false })
      .limit(30);
    if (error) throw error;
    return res.status(200).json({ ok: true, householdId, latest: runs?.[0] || null, history: runs || [] });
  } catch (error) {
    return res.status(500).json({
      error: "MONEY_HEALTH_FAILED",
      message: safeError(error, "Could not check Money Health."),
    });
  }
};
