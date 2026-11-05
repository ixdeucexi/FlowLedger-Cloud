const INITIAL_IMPORT_VERSION = 1;
const INITIAL_IMPORT_COLUMNS = "initial_import_version,initial_import_from,initial_history_complete_at";

/** A clamped calendar-month boundary, rather than an approximate 60-day span. */
function twoMonthHistoryWindow(now = new Date()) {
  const value = new Date(now);
  if (!Number.isFinite(value.getTime())) throw new TypeError("A valid connection date is required.");
  const today = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  const first = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 2, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const from = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(today.getUTCDate(), lastDay)));
  return {
    from: from.toISOString().slice(0, 10),
    daysRequested: Math.ceil((today - from) / 86_400_000) + 1,
  };
}

async function newConnectionImportProfile({ db, userId, now = new Date() }) {
  // This is the trusted app-admin registry. A manually granted Pro plan also
  // has source="admin", so plan provenance must never decide this exclusion.
  const { data, error } = await db.from("feedback_admins").select("user_id").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  if (data) return null;
  const history = twoMonthHistoryWindow(now);
  return {
    initial_import_version: INITIAL_IMPORT_VERSION,
    initial_import_from: history.from,
    initial_history_complete_at: null,
    daysRequested: history.daysRequested,
  };
}

function hasInitialImportProfile(item) {
  return item?.initial_import_version === INITIAL_IMPORT_VERSION
    && typeof item.initial_import_from === "string"
    && /^\d{4}-\d{2}-\d{2}$/.test(item.initial_import_from);
}

function initialHistoryComplete(item, providerStatus, webhookHistoricalComplete = false) {
  if (!hasInitialImportProfile(item)) return true;
  return Boolean(item.initial_history_complete_at)
    || providerStatus === "HISTORICAL_UPDATE_COMPLETE"
    || webhookHistoricalComplete === true;
}

function initialHistoryStatus(item) {
  if (!hasInitialImportProfile(item)) return null;
  return item.initial_history_complete_at ? "complete" : "importing";
}

module.exports = {
  hasInitialImportProfile, INITIAL_IMPORT_COLUMNS, INITIAL_IMPORT_VERSION,
  initialHistoryComplete, initialHistoryStatus, newConnectionImportProfile, twoMonthHistoryWindow,
};
