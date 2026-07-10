const crypto = require("crypto");
const {
  decryptAccessToken,
  encryptionConfigured,
  getSupabaseUser,
  plaidConfigured,
  plaidPost,
  readJsonBody,
  sendJson,
  supabaseConfigured,
  supabaseRest,
} = require("../_utils/plaid");

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function makeId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function accountTypeFromPlaid(account) {
  if (account.type === "depository" && account.subtype === "savings") return "savings";
  if (account.type === "depository") return "checking";
  return null;
}

function accountBalance(account) {
  const current = account.balances?.current;
  const available = account.balances?.available;
  return Number.isFinite(Number(current)) ? Number(current) : Number(available || 0);
}

function mapPlaidCategory(transaction) {
  if (Number(transaction.amount) < 0) return "Income";
  const primary = transaction.personal_finance_category?.primary || "";
  const legacy = Array.isArray(transaction.category) ? transaction.category.join(" ") : "";
  const source = `${primary} ${legacy}`.toLowerCase();
  if (/food|restaurant|coffee|grocery/.test(source)) return "Food";
  if (/transport|gas|parking|taxi|rideshare/.test(source)) return "Transportation";
  if (/rent|utility|utilities|telephone|internet|electric|water/.test(source)) return "Utilities";
  if (/medical|health|pharmacy|doctor/.test(source)) return "Health";
  if (/education|school|tuition/.test(source)) return "Education";
  if (/loan|credit|debt/.test(source)) return "Debt";
  if (/merchandise|shopping|retail/.test(source)) return "Shopping";
  if (/entertainment|streaming|subscription|recreation/.test(source)) return "Entertainment";
  return "Other";
}

async function getStoredItem(userId, itemRecordId) {
  const rows = await supabaseRest(
    `plaid_items?id=eq.${encodeURIComponent(itemRecordId)}&user_id=eq.${encodeURIComponent(userId)}&select=*`,
    "GET",
  );
  return Array.isArray(rows) ? rows[0] : null;
}

async function getExistingPlaidAccount(userId, plaidAccountId) {
  const rows = await supabaseRest(
    `plaid_accounts?user_id=eq.${encodeURIComponent(userId)}&plaid_account_id=eq.${encodeURIComponent(plaidAccountId)}&select=*`,
    "GET",
  );
  return Array.isArray(rows) ? rows[0] : null;
}

async function upsertAccountForPlaid(userId, householdId, plaidItemId, plaidAccount) {
  const existing = await getExistingPlaidAccount(userId, plaidAccount.account_id);
  const mappedType = accountTypeFromPlaid(plaidAccount);
  if (!mappedType) return { skipped: true, reason: "unsupported_account_type" };

  const balance = accountBalance(plaidAccount);
  const balanceDate = todayIso();
  const accountName = plaidAccount.official_name || plaidAccount.name || "Bank account";

  let accountId = existing?.flowledger_account_id || makeId("plaid-account");
  if (existing?.flowledger_account_id) {
    await supabaseRest(
      `accounts?id=eq.${encodeURIComponent(accountId)}&user_id=eq.${encodeURIComponent(userId)}`,
      "PATCH",
      {
        name: accountName,
        account_type: mappedType,
        current_balance: balance,
        balance_as_of: balanceDate,
        last_reconciled_at: new Date().toISOString(),
        is_active: true,
      },
    );
  } else {
    await supabaseRest("accounts", "POST", {
      id: accountId,
      user_id: userId,
      household_id: householdId || null,
      name: accountName,
      account_type: mappedType,
      current_balance: balance,
      balance_as_of: balanceDate,
      last_reconciled_at: new Date().toISOString(),
      is_active: true,
    });
    await supabaseRest("account_balances", "POST", {
      id: makeId("plaid-balance"),
      account_id: accountId,
      user_id: userId,
      balance,
      as_of_date: balanceDate,
      source: "import",
    });
  }

  const linkPayload = {
    user_id: userId,
    household_id: householdId || null,
    plaid_item_id: plaidItemId,
    account_id: null,
    flowledger_account_id: accountId,
    plaid_account_id: plaidAccount.account_id,
    name: accountName,
    mask: plaidAccount.mask || null,
    type: plaidAccount.type,
    subtype: plaidAccount.subtype || null,
    current_balance: plaidAccount.balances?.current ?? null,
    available_balance: plaidAccount.balances?.available ?? null,
  };

  const linked = await supabaseRest(
    "plaid_accounts?on_conflict=user_id,plaid_account_id",
    "POST",
    linkPayload,
    { prefer: "resolution=merge-duplicates,return=representation" },
  );

  return {
    skipped: false,
    account_id: accountId,
      plaid_account_id: plaidAccount.account_id,
      plaid_account_row_id: Array.isArray(linked) ? linked[0]?.id : linked?.id,
    };
}

async function getExistingTransactionByHash(userId, importHash) {
  const rows = await supabaseRest(
    `transactions?user_id=eq.${encodeURIComponent(userId)}&import_hash=eq.${encodeURIComponent(importHash)}&select=id`,
    "GET",
  );
  return Array.isArray(rows) ? rows[0] : null;
}

async function upsertPlaidTransaction(userId, householdId, plaidAccountLink, plaidTransaction) {
  const importHash = `plaid:${plaidTransaction.transaction_id}`;
  const existing = await getExistingTransactionByHash(userId, importHash);
  const amount = -Number(plaidTransaction.amount || 0);
  const payload = {
    user_id: userId,
    household_id: householdId || null,
    account_id: plaidAccountLink.account_id,
    date: plaidTransaction.date,
    amount,
    category: mapPlaidCategory(plaidTransaction),
    note: plaidTransaction.merchant_name || plaidTransaction.name || "Plaid transaction",
    import_hash: importHash,
  };

  const transactionId = existing?.id || makeId("plaid-tx");
  if (existing?.id) {
    await supabaseRest(
      `transactions?id=eq.${encodeURIComponent(existing.id)}&user_id=eq.${encodeURIComponent(userId)}`,
      "PATCH",
      payload,
    );
  } else {
    await supabaseRest("transactions", "POST", { id: transactionId, ...payload });
  }

  await supabaseRest(
    "plaid_transactions?on_conflict=user_id,plaid_transaction_id",
    "POST",
    {
      user_id: userId,
      household_id: householdId || null,
      plaid_account_id: plaidAccountLink.plaid_account_row_id || null,
      transaction_id: null,
      flowledger_transaction_id: transactionId,
      plaid_transaction_id: plaidTransaction.transaction_id,
      transaction_date: plaidTransaction.date,
      name: payload.note,
      amount: payload.amount,
      category: payload.category,
      pending: Boolean(plaidTransaction.pending),
      raw: plaidTransaction,
    },
    { prefer: "resolution=merge-duplicates,return=representation" },
  );

  return existing?.id ? "updated" : "created";
}

async function removePlaidTransaction(userId, plaidTransactionId) {
  const importHash = `plaid:${plaidTransactionId}`;
  await supabaseRest(
    `transactions?user_id=eq.${encodeURIComponent(userId)}&import_hash=eq.${encodeURIComponent(importHash)}`,
    "DELETE",
    undefined,
    { prefer: "return=minimal" },
  );
  await supabaseRest(
    `plaid_transactions?user_id=eq.${encodeURIComponent(userId)}&plaid_transaction_id=eq.${encodeURIComponent(plaidTransactionId)}`,
    "DELETE",
    undefined,
    { prefer: "return=minimal" },
  );
}

async function syncTransactions(userId, householdId, item, accountLinks, accessToken) {
  let cursor = item.cursor || null;
  let hasMore = true;
  let pages = 0;
  let created = 0;
  let updated = 0;
  let removed = 0;
  const linksByPlaidAccountId = new Map(accountLinks.map(link => [link.plaid_account_id, link]));

  while (hasMore && pages < 8) {
    pages += 1;
    const page = await plaidPost("/transactions/sync", {
      access_token: accessToken,
      cursor,
      count: 500,
      options: {
        include_personal_finance_category: true,
      },
    });

    cursor = page.next_cursor || cursor;
    hasMore = Boolean(page.has_more);

    for (const tx of [...(page.added || []), ...(page.modified || [])]) {
      const link = linksByPlaidAccountId.get(tx.account_id);
      if (!link) continue;
      const result = await upsertPlaidTransaction(userId, householdId, link, tx);
      if (result === "created") created += 1;
      else updated += 1;
    }

    for (const tx of page.removed || []) {
      if (!tx.transaction_id) continue;
      await removePlaidTransaction(userId, tx.transaction_id);
      removed += 1;
    }
  }

  await supabaseRest(
    `plaid_items?id=eq.${encodeURIComponent(item.id)}&user_id=eq.${encodeURIComponent(userId)}`,
    "PATCH",
    {
      cursor,
      last_synced_at: new Date().toISOString(),
      status: "active",
    },
  );

  return { created, updated, removed, cursor };
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  if (!plaidConfigured() || !supabaseConfigured() || !encryptionConfigured()) {
    return sendJson(res, 503, { error: "Bank sync is not fully configured yet." });
  }

  const user = await getSupabaseUser(req);
  if (!user?.id) {
    return sendJson(res, 401, { error: "Sign in again before importing bank accounts." });
  }

  const body = readJsonBody(req);
  const selectedAccountIds = Array.isArray(body.selected_account_ids)
    ? body.selected_account_ids.filter(id => typeof id === "string")
    : [];

  if (!body.plaid_item_record_id || !selectedAccountIds.length) {
    return sendJson(res, 400, { error: "Choose at least one account to add." });
  }

  try {
    const item = await getStoredItem(user.id, body.plaid_item_record_id);
    if (!item?.id) return sendJson(res, 404, { error: "Bank connection was not found. Connect again." });

    const accessToken = decryptAccessToken(item.access_token_ciphertext);
    if (!accessToken) return sendJson(res, 500, { error: "Bank token could not be read securely." });

    const accountsPayload = await plaidPost("/accounts/get", { access_token: accessToken });
    const selectedAccounts = (accountsPayload.accounts || []).filter(account => selectedAccountIds.includes(account.account_id));
    const importedLinks = [];
    let accountsAdded = 0;
    let accountsSkipped = 0;

    for (const account of selectedAccounts) {
      const result = await upsertAccountForPlaid(user.id, item.household_id || body.household_id || null, item.id, account);
      if (result.skipped) {
        accountsSkipped += 1;
      } else {
        accountsAdded += 1;
        importedLinks.push(result);
      }
    }

    let syncResult = { created: 0, updated: 0, removed: 0, pending: false };
    try {
      syncResult = await syncTransactions(user.id, item.household_id || body.household_id || null, item, importedLinks, accessToken);
    } catch (error) {
      if (error.payload?.error_code === "PRODUCT_NOT_READY") {
        syncResult = { created: 0, updated: 0, removed: 0, pending: true };
      } else {
        throw error;
      }
    }

    return sendJson(res, 200, {
      accounts_added: accountsAdded,
      accounts_skipped: accountsSkipped,
      transactions_imported: syncResult.created,
      transactions_updated: syncResult.updated,
      transactions_removed: syncResult.removed,
      transactions_pending: Boolean(syncResult.pending),
      message: syncResult.pending
        ? "Accounts were added. Plaid is still preparing transactions, so sync again in a moment."
        : `Added ${accountsAdded} account${accountsAdded === 1 ? "" : "s"} and imported ${syncResult.created} transaction${syncResult.created === 1 ? "" : "s"}.`,
    });
  } catch (error) {
    return sendJson(res, error.status || 500, {
      error: error.message || "Bank accounts could not be imported.",
      request_id: error.payload?.request_id,
    });
  }
};
