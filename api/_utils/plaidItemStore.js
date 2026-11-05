const { INITIAL_IMPORT_COLUMNS, newConnectionImportProfile } = require("./plaidInitialImport");

class PlaidItemConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = "PlaidItemConflictError";
    this.code = "PLAID_ITEM_ALREADY_CONNECTED";
    this.status = 409;
  }
}

async function savePlaidItemConnection({ client, userId, householdId, plaidItemId, row, now }) {
  const existing = await client
    .from("plaid_items")
    .select("id,user_id,household_id,plaid_item_id,item_id")
    .eq("plaid_item_id", plaidItemId)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data && existing.data.user_id !== userId) {
    throw new PlaidItemConflictError("That bank connection is already linked to another FlowLedger user.");
  }
  if (existing.data?.household_id && existing.data.household_id !== householdId) {
    throw new PlaidItemConflictError("That bank connection is already linked to another FlowLedger household.");
  }

  const safeRow = { ...row };
  for (const field of [...INITIAL_IMPORT_COLUMNS.split(","), "transactions_cursor", "cursor"]) delete safeRow[field];
  // Stamp only a genuinely new non-admin item. Reconnecting the exact same
  // item cannot reset its cursor, import history, or opt legacy items in.
  if (!existing.data) {
    const profile = await newConnectionImportProfile({ db: client, userId, now });
    if (profile) {
      const { daysRequested: _days, ...columns } = profile;
      Object.assign(safeRow, columns);
    }
  }
  const selected = `id,household_id,status,institution_name,transactions_cursor,cursor,${INITIAL_IMPORT_COLUMNS}`;
  // A fresh Plaid Item is always inserted. Existing Items are never removed or
  // replaced when another bank or card is connected. Only reconnecting the
  // exact same Plaid Item refreshes that Item's token and metadata.
  const saved = existing.data
    ? await client
      .from("plaid_items")
      .update(safeRow)
      .eq("id", existing.data.id)
      .eq("user_id", userId)
      .select(selected)
      .single()
    : await client
      .from("plaid_items")
      .insert(safeRow)
      .select(selected)
      .single();
  if (saved.error) throw saved.error;
  return { data: saved.data, refreshedExistingItem: Boolean(existing.data) };
}

module.exports = { PlaidItemConflictError, savePlaidItemConnection };
