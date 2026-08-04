const { plaid } = require("./plaid");
const { serviceSupabase } = require("./supabase");
const { encryptAccessToken } = require("./crypto");
const { savePlaidItemConnection } = require("./plaidItemStore");
const { syncItem } = require("./sync");

async function connectPlaidPublicToken({ publicToken, userId, householdId }) {
  const exchanged = (await plaid().itemPublicTokenExchange({ public_token: publicToken })).data;
  const accessToken = exchanged.access_token;
  const itemId = exchanged.item_id;
  const client = serviceSupabase();
  let institutionId = null;
  let institutionName = "Connected bank";
  let consentExpiration = null;
  try {
    const item = (await plaid().itemGet({ access_token: accessToken })).data.item;
    institutionId = item && item.institution_id || null;
    consentExpiration = item && item.consent_expiration_time || null;
    if (institutionId) {
      const institution = await plaid().institutionsGet({ institution_ids: [institutionId], country_codes: ["US"], options: { include_optional_metadata: true } });
      institutionName = institution.data && institution.data.institutions && institution.data.institutions[0] && institution.data.institutions[0].name || institutionName;
    }
  } catch { /* metadata is optional; the connection remains valid */ }
  const encrypted = encryptAccessToken(accessToken);
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
  const saved = await savePlaidItemConnection({
    client,
    userId,
    householdId,
    plaidItemId: itemId,
    row,
  });
  const sync = await syncItem({ userId, item: { id: saved.data.id, household_id: saved.data.household_id, encrypted_access_token: encrypted, transactions_cursor: null, cursor: null } });
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
}

module.exports = { connectPlaidPublicToken };
