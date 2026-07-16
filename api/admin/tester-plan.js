const { authenticatedUser, safeError, serviceSupabase } = require("../_utils/supabase");

function requestBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return req.body;
}

async function findUserByEmail(db, email) {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const match = (data.users || []).find(user => String(user.email || "").toLowerCase() === email);
    if (match) return match;
    if ((data.users || []).length < 1000) break;
  }
  return null;
}

module.exports = async function testerPlan(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });

  const auth = await authenticatedUser(req);
  if (!auth.user) return res.status(401).json({ error: auth.error, message: "Please sign in again." });

  const db = serviceSupabase();
  const { data: admin, error: adminError } = await db
    .from("feedback_admins")
    .select("user_id")
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (adminError) return res.status(500).json({ error: "ADMIN_CHECK_FAILED", message: safeError(adminError) });
  if (!admin) return res.status(403).json({ error: "ADMIN_REQUIRED", message: "Admin access is required." });

  const payload = requestBody(req);
  const email = String(payload.email || "").trim().toLowerCase();
  const tier = payload.tier === "pro" ? "pro" : payload.tier === "free" ? "free" : null;
  if (!email || !email.includes("@") || !tier) {
    return res.status(400).json({ error: "INVALID_REQUEST", message: "Enter a tester email and choose Free or Pro." });
  }

  try {
    const tester = await findUserByEmail(db, email);
    if (!tester) return res.status(404).json({ error: "TESTER_NOT_FOUND", message: "No FlowLedger account uses that email." });

    let { data: household, error: householdError } = await db
      .from("households")
      .select("id,name,is_personal")
      .eq("created_by", tester.id)
      .eq("is_personal", true)
      .maybeSingle();
    if (householdError) throw householdError;

    if (!household) {
      const { data: membership, error: membershipError } = await db
        .from("household_members")
        .select("household_id")
        .eq("user_id", tester.id)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (membershipError) throw membershipError;
      if (membership) {
        const result = await db.from("households").select("id,name,is_personal").eq("id", membership.household_id).maybeSingle();
        if (result.error) throw result.error;
        household = result.data;
      }
    }

    if (!household) return res.status(404).json({ error: "HOUSEHOLD_NOT_FOUND", message: "That tester does not have a household yet." });

    const { data: currentPlan, error: currentPlanError } = await db
      .from("household_plans")
      .select("tier,source")
      .eq("household_id", household.id)
      .maybeSingle();
    if (currentPlanError) throw currentPlanError;
    if (tier === "free" && currentPlan && currentPlan.source === "grandfathered") {
      return res.status(409).json({ error: "GRANDFATHERED_PLAN", message: "Grandfathered Pro cannot be removed." });
    }

    const now = new Date().toISOString();
    const { error: saveError } = await db.from("household_plans").upsert({
      household_id: household.id,
      tier,
      source: tier === "pro" ? "admin" : "default",
      grandfathered_at: null,
      updated_at: now,
    }, { onConflict: "household_id" });
    if (saveError) throw saveError;

    return res.status(200).json({
      ok: true,
      email,
      householdId: household.id,
      householdName: household.name || "Personal",
      tier,
    });
  } catch (error) {
    return res.status(500).json({ error: "TESTER_PLAN_FAILED", message: safeError(error, "Could not update tester access.") });
  }
};
