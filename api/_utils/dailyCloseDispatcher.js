const { recordHouseholdDailyCheckingClose } = require("./dailyCheckingClose");
const { safeError } = require("./supabase");
const { isLocalCloseWindow } = require("./timeZone");

function groupObservations(items) {
  const grouped = new Map();
  for (const item of items || []) {
    if (!item.household_id || !item.id || !item.accounts_observed_at) continue;
    const observations = grouped.get(item.household_id) || [];
    observations.push({ item_id: item.id, observed_at: item.accounts_observed_at });
    grouped.set(item.household_id, observations);
  }
  return grouped;
}

async function dispatchDailyCheckingCloses({ db, now = new Date(), logger = console }) {
  const { data: items, error: itemError } = await db
    .from("plaid_items")
    .select("id,household_id,accounts_observed_at")
    .in("status", ["active", "needs_repair"])
    .not("accounts_observed_at", "is", null);
  if (itemError) throw itemError;

  const grouped = groupObservations(items);
  const householdIds = [...grouped.keys()];
  if (!householdIds.length) return { ok: true, eligible: 0, captured: 0, deferred: 0 };

  const { data: settings, error: settingsError } = await db
    .from("household_settings")
    .select("household_id,time_zone")
    .in("household_id", householdIds);
  if (settingsError) throw settingsError;
  const timeZoneByHousehold = new Map(
    (settings || []).map(row => [row.household_id, row.time_zone || "UTC"]),
  );

  let eligible = 0;
  let captured = 0;
  let deferred = 0;
  for (const [householdId, observations] of grouped) {
    const timeZone = timeZoneByHousehold.get(householdId) || "UTC";
    // Vercel Hobby permits only a once-daily cron. 05:55 UTC lands at
    // 11:55 PM CST or 12:55 AM CDT for the current Chicago household. The
    // RPC still derives balance_date from the bank observation, never from
    // this dispatcher instant, so the saved historical close stays honest.
    if (!isLocalCloseWindow(now, timeZone, [23, 0])) continue;
    eligible += 1;
    try {
      if (await recordHouseholdDailyCheckingClose({ db, householdId, observations })) captured += 1;
      else deferred += 1;
    } catch (error) {
      deferred += 1;
      logger.error("[plaid:daily-close] household deferred", {
        householdId,
        error: safeError(error, "Daily close persistence failed."),
      });
    }
  }

  return { ok: true, eligible, captured, deferred };
}

module.exports = { dispatchDailyCheckingCloses, groupObservations };
