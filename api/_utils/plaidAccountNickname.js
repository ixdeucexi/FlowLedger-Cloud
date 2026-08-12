const MAX_PLAID_ACCOUNT_DISPLAY_NAME_LENGTH = 80;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isPlaidAccountRecordId(value) {
  return UUID_PATTERN.test(String(value || ""));
}

function normalizePlaidAccountDisplayName(value) {
  if (value === null) return { ok: true, value: null };
  if (typeof value !== "string") {
    return { ok: false, message: "Enter an account name." };
  }
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) return { ok: false, message: "Enter an account name." };
  if (normalized.length > MAX_PLAID_ACCOUNT_DISPLAY_NAME_LENGTH) {
    return { ok: false, message: `Keep the account name under ${MAX_PLAID_ACCOUNT_DISPLAY_NAME_LENGTH} characters.` };
  }
  return { ok: true, value: normalized };
}

function indexedPlaidAccountDisplayNames(accounts) {
  const index = new Map();
  const sorted = [...(accounts || [])].sort((left, right) =>
    String(right.updated_at || "").localeCompare(String(left.updated_at || "")),
  );
  for (const account of sorted) {
    const normalized = normalizePlaidAccountDisplayName(account.display_name);
    if (!normalized.ok || !normalized.value) continue;
    if (account.persistent_account_id) {
      const key = `persistent:${account.persistent_account_id}`;
      if (!index.has(key)) index.set(key, normalized.value);
    }
    if (account.plaid_account_id) {
      const key = `plaid:${account.plaid_account_id}`;
      if (!index.has(key)) index.set(key, normalized.value);
    }
  }
  return index;
}

function displayNameForSyncedPlaidAccount(account, index) {
  if (account?.persistent_account_id) {
    const persistentName = index.get(`persistent:${account.persistent_account_id}`);
    if (persistentName) return persistentName;
  }
  return account?.account_id ? index.get(`plaid:${account.account_id}`) : undefined;
}

async function updatePlaidSavingsAccountDisplayName({ db, householdId, accountId, displayName }) {
  const normalized = normalizePlaidAccountDisplayName(displayName);
  if (!normalized.ok) return { ok: false, status: 400, message: normalized.message };

  const existing = await db
    .from("plaid_accounts")
    .select("id,persistent_account_id")
    .eq("household_id", householdId)
    .eq("id", accountId)
    .eq("account_subtype", "savings")
    .eq("is_active", true)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (!existing.data) return { ok: false, status: 404, message: "Savings account not found." };

  let update = db
    .from("plaid_accounts")
    .update({ display_name: normalized.value })
    .eq("household_id", householdId)
    .eq("account_subtype", "savings");
  update = existing.data.persistent_account_id
    ? update.eq("persistent_account_id", existing.data.persistent_account_id)
    : update.eq("id", accountId);
  const updated = await update.select("id,display_name");
  if (updated.error) throw updated.error;
  const account = (updated.data || []).find((row) => row.id === accountId);
  if (!account) return { ok: false, status: 404, message: "Savings account not found." };
  return { ok: true, account };
}

module.exports = {
  MAX_PLAID_ACCOUNT_DISPLAY_NAME_LENGTH,
  displayNameForSyncedPlaidAccount,
  indexedPlaidAccountDisplayNames,
  isPlaidAccountRecordId,
  normalizePlaidAccountDisplayName,
  updatePlaidSavingsAccountDisplayName,
};
