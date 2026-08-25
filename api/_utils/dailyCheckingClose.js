function syncObservation(item, result) {
  const observedAt = result && result.account_observed_at;
  if (!item?.id || !observedAt || !Number.isFinite(Date.parse(observedAt))) return null;
  return { item_id: item.id, observed_at: observedAt };
}

async function refreshHouseholdItems({ items, synchronize }) {
  const results = [];
  const failures = [];
  for (const item of items) {
    try {
      const result = await synchronize({ userId: item.user_id, item });
      results.push({ item, result });
    } catch (error) {
      failures.push({ item, error });
    }
  }
  return {
    results,
    failures,
    observations: results.map(entry => syncObservation(entry.item, entry.result)).filter(Boolean),
  };
}

async function recordHouseholdDailyCheckingClose({ db, householdId, observations }) {
  const { data, error } = await db.rpc("record_household_daily_checking_close", {
    p_household_id: householdId,
    p_observations: observations,
  });
  if (error) throw error;
  return data === true;
}

async function tryRecordHouseholdDailyCheckingClose({ db, householdId, observations, logger = console }) {
  try {
    return await recordHouseholdDailyCheckingClose({ db, householdId, observations });
  } catch (error) {
    logger.error("[plaid:daily-close] snapshot deferred", {
      householdId,
      error: error instanceof Error ? error.message : "Daily close persistence failed.",
    });
    return false;
  }
}

async function captureAfterCoherentHouseholdRefresh({ db, householdId, refresh, logger = console }) {
  if (
    refresh.failures.length
    || !refresh.observations.length
    || refresh.observations.length !== refresh.results.length
  ) return false;
  return tryRecordHouseholdDailyCheckingClose({
    db,
    householdId,
    observations: refresh.observations,
    logger,
  });
}

async function captureAfterWebhookSync({ db, householdId, eligibleItemCount, item, result, logger = console }) {
  if (eligibleItemCount !== 1 || !["active", "needs_repair"].includes(item?.status)) return false;
  const observation = syncObservation(item, result);
  if (!observation) return false;
  return tryRecordHouseholdDailyCheckingClose({
    db,
    householdId,
    observations: [observation],
    logger,
  });
}

function groupItemsByHousehold(items) {
  const grouped = new Map();
  for (const item of items || []) {
    if (!item?.household_id) continue;
    grouped.set(item.household_id, [...(grouped.get(item.household_id) || []), item]);
  }
  return grouped;
}

module.exports = {
  captureAfterCoherentHouseholdRefresh,
  captureAfterWebhookSync,
  groupItemsByHousehold,
  recordHouseholdDailyCheckingClose,
  refreshHouseholdItems,
  syncObservation,
  tryRecordHouseholdDailyCheckingClose,
};
