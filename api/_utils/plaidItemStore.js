class PlaidItemConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = "PlaidItemConflictError";
    this.code = "PLAID_ITEM_ALREADY_CONNECTED";
    this.status = 409;
  }
}

async function savePlaidItemConnection({ client, userId, householdId, plaidItemId, row }) {
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

  // A fresh Plaid Item is always inserted. Existing Items are never removed or
  // replaced when another bank or card is connected. Only reconnecting the
  // exact same Plaid Item refreshes that Item's token and metadata.
  const saved = existing.data
    ? await client
      .from("plaid_items")
      .update(row)
      .eq("id", existing.data.id)
      .eq("user_id", userId)
      .select("id, household_id, status, institution_name")
      .single()
    : await client
      .from("plaid_items")
      .insert(row)
      .select("id, household_id, status, institution_name")
      .single();
  if (saved.error) throw saved.error;
  return { data: saved.data, refreshedExistingItem: Boolean(existing.data) };
}

module.exports = { PlaidItemConflictError, savePlaidItemConnection };
