const { isAuthorizedCron } = require("../cronAuth");
const { optional } = require("../env");
const { buildOverdueOccurrences } = require("../overdueBills");
const { queueOverdueBillNotifications } = require("../push");
const { safeError, serviceSupabase } = require("../supabase");

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

module.exports = async function overdueBillNotifications(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });

  const secret = optional("CRON_SECRET");
  if (!secret) return res.status(500).json({ error: "CRON_NOT_CONFIGURED" });
  if (!isAuthorizedCron(req, secret)) return res.status(401).json({ error: "UNAUTHORIZED" });

  try {
    const db = serviceSupabase();
    const today = new Date().toISOString().slice(0, 10);
    const [year, monthNumber] = today.split("-").map(Number);
    const month = monthNumber - 1;
    const { data: subscriptions, error: subscriptionError } = await db
      .from("push_subscriptions")
      .select("user_id");
    if (subscriptionError) throw subscriptionError;
    const subscribedUserIds = unique((subscriptions || []).map(row => row.user_id));
    if (!subscribedUserIds.length) return res.status(200).json({ ok: true, users: 0, overdue: 0, delivered: 0 });

    const { data: memberships, error: membershipError } = await db
      .from("household_members")
      .select("household_id,user_id")
      .in("user_id", subscribedUserIds);
    if (membershipError) throw membershipError;
    const householdIds = unique((memberships || []).map(row => row.household_id));

    const billSelect = "id,user_id,household_id,name,amount,due_day,day_of_week,next_payment_date,start_date,end_date,is_debt,is_recurring,frequency,snowball_minimum_boost";
    const householdBillsRequest = householdIds.length
      ? db.from("bills").select(billSelect).in("household_id", householdIds)
      : Promise.resolve({ data: [], error: null });
    const legacyBillsRequest = db.from("bills").select(billSelect).is("household_id", null).in("user_id", subscribedUserIds);
    const [householdBillsResult, legacyBillsResult] = await Promise.all([householdBillsRequest, legacyBillsRequest]);
    if (householdBillsResult.error) throw householdBillsResult.error;
    if (legacyBillsResult.error) throw legacyBillsResult.error;
    const bills = Array.from(new Map(
      [...(householdBillsResult.data || []), ...(legacyBillsResult.data || [])]
        .filter(bill => bill.is_recurring || bill.is_debt)
        .map(bill => [bill.id, bill]),
    ).values());
    if (!bills.length) return res.status(200).json({ ok: true, users: subscribedUserIds.length, overdue: 0, delivered: 0 });

    const billIds = bills.map(bill => bill.id);
    const [{ data: overrides, error: overrideError }, { data: moves, error: moveError }] = await Promise.all([
      db.from("monthly_overrides")
        .select("bill_id,custom_amount,custom_due_day,paid_amount,actual_amount,paid_date")
        .eq("month", month)
        .eq("year", year)
        .in("bill_id", billIds),
      db.from("bill_date_moves")
        .select("bill_id,from_date,to_date,created_at,updated_at")
        .in("bill_id", billIds),
    ]);
    if (overrideError) throw overrideError;
    if (moveError) throw moveError;

    const overdue = buildOverdueOccurrences({ bills, overrides, moves, today });
    const householdRecipients = new Map();
    (memberships || []).forEach(membership => {
      if (!householdRecipients.has(membership.household_id)) householdRecipients.set(membership.household_id, []);
      householdRecipients.get(membership.household_id).push(membership.user_id);
    });
    const alertsByUser = new Map();
    overdue.forEach(alert => {
      const recipients = alert.householdId
        ? householdRecipients.get(alert.householdId) || []
        : subscribedUserIds.includes(alert.ownerUserId) ? [alert.ownerUserId] : [];
      recipients.forEach(userId => {
        if (!alertsByUser.has(userId)) alertsByUser.set(userId, []);
        alertsByUser.get(userId).push(alert);
      });
    });

    let delivered = 0;
    let failed = 0;
    for (const [userId, alerts] of alertsByUser.entries()) {
      try {
        const result = await queueOverdueBillNotifications(userId, alerts);
        delivered += result.delivered || 0;
      } catch (error) {
        failed += 1;
        console.error("[notifications:overdue-bills] user delivery failed", {
          userId,
          error: safeError(error, "Overdue bill notification failed."),
        });
      }
    }

    const totals = { users: alertsByUser.size, overdue: overdue.length, delivered, failed };
    console.log("[notifications:overdue-bills] completed", totals);
    return res.status(failed ? 500 : 200).json({ ok: failed === 0, ...totals });
  } catch (error) {
    console.error("[notifications:overdue-bills] failed", { error: safeError(error, "Overdue bill notifications failed.") });
    return res.status(500).json({ error: "OVERDUE_BILL_NOTIFICATIONS_FAILED" });
  }
};
