const { getWeeklyAccountTip } = require("../../artifacts/mobile/lib/accountTips");
const { notificationPreferenceEnabled } = require("./notificationPreferences");

function accountTipPayload(tip) {
  return {
    title: `Account tip: ${tip.title}`,
    body: tip.body,
    url: tip.route,
    tag: `flowledger-tip-${tip.week}`,
    quiet: true,
  };
}

function currentTipForEvent(event, now = new Date()) {
  const tip = getWeeklyAccountTip(now);
  return tip && event.occurrence_date === tip.week
    && event.event_key === `account-tip:${tip.week}` ? tip : null;
}

async function accountTipEligible(db, userId, householdId, tip) {
  if (!tip || !userId || !householdId) return false;
  if (!(await notificationPreferenceEnabled(db, userId, "account_tips"))) return false;
  const [{ data: preferences, error }, { data: member, error: membershipError }] = await Promise.all([
    db.from("user_preferences").select("active_household_id,notification_center_states").eq("user_id", userId).maybeSingle(),
    db.from("household_members").select("user_id").eq("user_id", userId).eq("household_id", householdId).maybeSingle(),
  ]);
  if (error) throw error;
  if (membershipError) throw membershipError;
  if (!member || preferences?.active_household_id !== householdId) return false;
  const state = preferences.notification_center_states?.[householdId];
  return ![state?.readIds, state?.dismissedIds].some(ids => Array.isArray(ids) && ids.includes(tip.id));
}

async function readAllRows(makeQuery, pageSize = 500) {
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await makeQuery().range(offset, offset + pageSize - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) return rows;
  }
}

/** One active household per subscribed user; no account balances or activity are read. */
async function runAccountTipNotifications({ db, queue, environment, now = new Date() }) {
  const tip = getWeeklyAccountTip(now);
  if (!tip) throw new Error("Invalid account tip date.");
  const [web, native] = await Promise.all([
    readAllRows(() => db.from("push_subscriptions").select("id,user_id").order("id")),
    readAllRows(() => db.from("native_push_devices").select("id,user_id").eq("status", "active")
      .eq("environment", environment).order("id")),
  ]);
  const subscribedUsers = [...new Set([...web, ...native].map(row => row.user_id).filter(Boolean))];
  const totals = { users: 0, delivered: 0, events: 0, failed: 0 };
  // Keep IN lists bounded and pages below the project's 1,000-row REST cap.
  for (let index = 0; index < subscribedUsers.length; index += 100) {
    const ids = subscribedUsers.slice(index, index + 100);
    const preferences = await readAllRows(() => db.from("user_preferences")
      .select("user_id,active_household_id").in("user_id", ids).order("user_id"));
    for (const preference of preferences) {
      if (!preference.active_household_id) continue;
      totals.users += 1;
      try {
        const result = await queue(preference.user_id, preference.active_household_id, now, { db });
        totals.delivered += result.delivered || 0;
        totals.events += result.events || 0;
      } catch {
        // Count failures without putting user/account details in cron output.
        totals.failed += 1;
      }
    }
  }
  return { ok: totals.failed === 0, ...totals };
}

module.exports = { accountTipPayload, currentTipForEvent, accountTipEligible, readAllRows, runAccountTipNotifications };
