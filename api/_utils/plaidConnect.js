const { plaid } = require("./plaid");
const { serviceSupabase } = require("./supabase");
const { encryptAccessToken } = require("./crypto");
const { savePlaidItemConnection } = require("./plaidItemStore");
const { syncItem } = require("./sync");

function plaidProviderCode(error) {
  return String(error?.response?.data?.error_code || error?.code || "");
}

async function cleanupConflictingNewPlaidItem({ plaidClient, client, userId, householdId, itemRecordId, accessToken }) {
  try {
    await plaidClient.itemRemove({ access_token: accessToken });
  } catch (error) {
    if (plaidProviderCode(error) !== "ITEM_NOT_FOUND") {
      await client
        .from("plaid_items")
        .update({
          status: "needs_repair",
          error_code: "PLAID_CONFLICT_CLEANUP_REQUIRED",
          error_message: "Provider removal could not be confirmed.",
          updated_at: new Date().toISOString(),
        })
        .eq("id", itemRecordId)
        .eq("user_id", userId)
        .eq("household_id", householdId);
      const cleanupError = new Error("The conflicting bank connection could not be safely removed. Please try again or contact support.");
      cleanupError.code = "PLAID_CONFLICT_CLEANUP_FAILED";
      throw cleanupError;
    }
  }

  const { data, error } = await client
    .from("plaid_items")
    .update({
      status: "removed",
      encrypted_access_token: null,
      access_token_ciphertext: null,
      error_code: "PLAID_ACCOUNT_ALREADY_CONNECTED_TO_ANOTHER_HOUSEHOLD",
      error_message: "Connection removed because this account belongs to another household.",
      updated_at: new Date().toISOString(),
    })
    .eq("id", itemRecordId)
    .eq("user_id", userId)
    .eq("household_id", householdId)
    .select("id,status,encrypted_access_token,access_token_ciphertext")
    .maybeSingle();
  if (error || !data || data.status !== "removed" || data.encrypted_access_token !== null || data.access_token_ciphertext !== null) {
    const cleanupError = new Error("The conflicting bank connection could not be safely removed. Please try again or contact support.");
    cleanupError.code = "PLAID_CONFLICT_CLEANUP_FAILED";
    throw cleanupError;
  }
}

function createPlaidConnector(dependencies = {}) {
  const plaidFactory = dependencies.plaid || plaid;
  const database = dependencies.serviceSupabase || serviceSupabase;
  const encrypt = dependencies.encryptAccessToken || encryptAccessToken;
  const saveConnection = dependencies.savePlaidItemConnection || savePlaidItemConnection;
  const synchronize = dependencies.syncItem || syncItem;

  return async function connectPlaidPublicToken({ publicToken, userId, householdId }) {
  const plaidClient = plaidFactory();
  const exchanged = (await plaidClient.itemPublicTokenExchange({ public_token: publicToken })).data;
  const accessToken = exchanged.access_token;
  const itemId = exchanged.item_id;
  const client = database();
  let institutionId = null;
  let institutionName = "Connected bank";
  let consentExpiration = null;
  try {
    const item = (await plaidClient.itemGet({ access_token: accessToken })).data.item;
    institutionId = item && item.institution_id || null;
    consentExpiration = item && item.consent_expiration_time || null;
    if (institutionId) {
      const institution = await plaidClient.institutionsGet({ institution_ids: [institutionId], country_codes: ["US"], options: { include_optional_metadata: true } });
      institutionName = institution.data && institution.data.institutions && institution.data.institutions[0] && institution.data.institutions[0].name || institutionName;
    }
  } catch { /* metadata is optional; the connection remains valid */ }
  const encrypted = encrypt(accessToken);
  const row = {
    user_id: userId,
    household_id: householdId,
    plaid_item_id: itemId,
    item_id: itemId,
    encrypted_access_token: encrypted,
    access_token_ciphertext: encrypted,
    institution_id: institutionId,
    institution_name: institutionName,
    status: "active",
    consent_expiration_time: consentExpiration,
    error_code: null,
    error_message: null,
    updated_at: new Date().toISOString(),
  };
  const saved = await saveConnection({
    client,
    userId,
    householdId,
    plaidItemId: itemId,
    row,
  });
  let sync;
  try {
    sync = await synchronize({ userId, item: { id: saved.data.id, household_id: saved.data.household_id, encrypted_access_token: encrypted, transactions_cursor: null, cursor: null } });
  } catch (error) {
    if (!saved.refreshedExistingItem && plaidProviderCode(error) === "PLAID_ACCOUNT_ALREADY_CONNECTED_TO_ANOTHER_HOUSEHOLD") {
      await cleanupConflictingNewPlaidItem({ plaidClient, client, userId, householdId, itemRecordId: saved.data.id, accessToken });
    }
    throw error;
  }
  return {
    item_id: saved.data.id,
    institution_name: saved.data.institution_name || institutionName,
    already_connected: Boolean(sync.duplicate),
    accounts_count: sync.accounts,
    credit_cards_count: sync.liabilities.cards,
    credit_card_debts_count: sync.liabilities.debts,
    liability_details_available: sync.liabilities.available,
    transactions_count: sync.transactions.added + sync.transactions.modified,
    transactions_pending: Boolean(sync.transactions_pending),
  };
  };
}

const connectPlaidPublicToken = createPlaidConnector();

module.exports = { cleanupConflictingNewPlaidItem, connectPlaidPublicToken, createPlaidConnector };
