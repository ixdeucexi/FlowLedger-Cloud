const { serviceSupabase } = require("./supabase");

const EDIT_ROLES = new Set(["owner", "manager", "editor"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requestedHouseholdId(req) {
  const header = req?.headers?.["x-flowledger-household-id"] || req?.headers?.["X-FlowLedger-Household-Id"];
  return String(header || "").trim();
}

async function authorizeProHousehold(userId, householdId, db = serviceSupabase()) {
  if (!UUID_PATTERN.test(String(householdId || ""))) {
    return { ok: false, status: 400, error: "HOUSEHOLD_REQUIRED", message: "Choose a household before connecting a bank." };
  }

  const [membership, plan] = await Promise.all([
    db.from("household_members").select("role").eq("household_id", householdId).eq("user_id", userId).maybeSingle(),
    db.from("household_plans").select("tier").eq("household_id", householdId).maybeSingle(),
  ]);
  if (membership.error) throw membership.error;
  if (plan.error) throw plan.error;
  if (!membership.data || !EDIT_ROLES.has(String(membership.data.role || ""))) {
    return { ok: false, status: 403, error: "HOUSEHOLD_EDIT_REQUIRED", message: "You need household edit access to manage bank connections." };
  }
  if (plan.data?.tier !== "pro") {
    return { ok: false, status: 403, error: "PRO_PLAN_REQUIRED", message: "Bank connection and automatic reconciliation require Pro." };
  }
  return { ok: true, householdId };
}

async function isActualProHousehold(householdId, db = serviceSupabase()) {
  if (!UUID_PATTERN.test(String(householdId || ""))) return false;
  const result = await db.from("household_plans").select("tier").eq("household_id", householdId).maybeSingle();
  if (result.error) throw result.error;
  return result.data?.tier === "pro";
}

module.exports = { authorizeProHousehold, isActualProHousehold, requestedHouseholdId };
