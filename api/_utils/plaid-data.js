"use strict";

const crypto = require("crypto");
const {
  accountTypeFromPlaid,
  decryptAccessToken,
  mapPlaidCategory,
  normalizePlaidAmount,
  safePlaidError,
  safeAccountPreview,
  supabaseRest,
} = require("./plaid");

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function makeId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function eq(value) {
  return encodeURIComponent(String(value));
}

function first(rows) {
  return Array.isArray(rows) ? rows[0] : rows;
}

function unsupportedColumn(error, columnName) {
  const text = JSON.stringify(error?.payload || {});
  return error?.status === 400 && (!columnName || text.includes(columnName));
}

function plaidErrorCode(error) {
  return (
    error?.response?.data?.error_code ||
    error?.payload?.error_code ||
    error?.error_code ||
    error?.code ||
    null
  );
}

function isTransactionsMutationDuringPagination(error) {
  return plaidErrorCode(error) === "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION";
}

async function getItemById(userId, itemRecordId) {
  const rows = await supabaseRest(
    `plaid_items?id=eq.${eq(itemRecordId)}&user_id=eq.${eq(userId)}&select=*`,
    "GET",
  );
  return first(rows) || null;
}

async function getItemByPlaidItemId(userId, plaidItemId) {
  try {
    const rows = await supabaseRest(
      `plaid_items?user_id=eq.${eq(userId)}&plaid_item_id=eq.${eq(plaidItemId)}&select=*`,
      "GET",
    );
    const row = first(rows);
    if (row) return row;
  } catch (error) {
    if (!unsupportedColumn(error, "plaid_item_id")) throw error;
  }

  const legacyRows = await supabaseRest(
    `plaid_items?user_id=eq.${eq(userId)}&item_id=eq.${eq(plaidItemId)}&select=*`,
    "GET",
  );
  return first(legacyRows) || null;
}

async function getItemByPlaidItemIdForWebhook(plaidItemId) {
  try {
    const rows = await supabaseRest(
      `plaid_items?plaid_item_id=eq.${eq(plaidItemId)}&select=*`,
      "GET",
    );
    const row = first(rows);
    if (row) return row;
  } catch (error) {
    if (!unsupportedColumn(error, "plaid_item_id")) throw error;
  }

  const legacyRows = await supabaseRest(
    `plaid_items?item_id=eq.${eq(plaidItemId)}&select=*`,
    "GET",
  );
  return first(legacyRows) || null;
}

async function savePlaidItem({
  userId,
  householdId,
  plaidItemId,
  encryptedAccessToken,
  institutionId,
  institutionName,
  status = "active",
  consentExpirationTime = null,
}) {
  const existing = await getItemByPlaidItemId(userId, plaidItemId);
  const now = new Date().toISOString();
  const modernPayload = {
    user_id: userId,
    household_id: householdId || null,
    plaid_item_id: plaidItemId,
    item_id: plaidItemId,
    encrypted_access_token: encryptedAccessToken,
    access_token_ciphertext: encryptedAccessToken,
    institution_id: institutionId || null,
    institution_name: institutionName || null,
    consent_expiration_time: consentExpirationTime || null,
    status,
    updated_at: now,
  };
  const legacyPayload = {
    user_id: userId,
    household_id: householdId || null,
    item_id: plaidItemId,
    access_token_ciphertext: encryptedAccessToken,
    institution_id: institutionId || null,
    institution_name: institutionName || null,
    status,
    updated_at: now,
  };

  if (existing?.id) {
    try {
      const rows = await supabaseRest(
        `plaid_items?id=eq.${eq(existing.id)}&user_id=eq.${eq(userId)}`,
        "PATCH",
        modernPayload,
      );
      return first(rows) || existing;
    } catch (error) {
      if (!unsupportedColumn(error)) throw error;
      const rows = await supabaseRest(
        `plaid_items?id=eq.${eq(existing.id)}&user_id=eq.${eq(userId)}`,
        "PATCH",
        legacyPayload,
      );
      return first(rows) || existing;
    }
  }

  try {
    const rows = await supabaseRest("plaid_items", "POST", {
      ...modernPayload,
      created_at: now,
    });
    return first(rows);
  } catch (error) {
    if (!unsupportedColumn(error)) throw error;
    const rows = await supabaseRest("plaid_items", "POST", {
      ...legacyPayload,
      created_at: now,
    });
    return first(rows);
  }
}

async function patchPlaidItem(item, modernPatch, legacyPatch = modernPatch) {
  const modern = { ...modernPatch, updated_at: new Date().toISOString() };
  const legacy = { ...legacyPatch, updated_at: new Date().toISOString() };
  try {
    const rows = await supabaseRest(`plaid_items?id=eq.${eq(item.id)}`, "PATCH", modern);
    return first(rows) || item;
  } catch (error) {
    if (!unsupportedColumn(error)) throw error;
    const rows = await supabaseRest(`plaid_items?id=eq.${eq(item.id)}`, "PATCH", legacy);
    return first(rows) || item;
  }
}

function getEncryptedAccessToken(item) {
  return item?.encrypted_access_token || item?.access_token_ciphertext || null;
}

function getTransactionsCursor(item) {
  return item?.transactions_cursor || item?.cursor || null;
}

function accountBalance(account) {
  const current = account?.balances?.current;
  const available = account?.balances?.available;
  return Number.isFinite(Number(current)) ? Number(current) : Number(available || 0);
}

async function getPlaidAccountLinkByPlaidId(userId, plaidAccountId) {
  const rows = await supabaseRest(
    `plaid_accounts?user_id=eq.${eq(userId)}&plaid_account_id=eq.${eq(plaidAccountId)}&select=*`,
    "GET",
  );
  return first(rows) || null;
}

async function upsertPlaidAccountMetadata(userId, householdId, itemRecordId, account, flowledgerAccountId = null) {
  const modernPayload = {
    user_id: userId,
    household_id: householdId || null,
    plaid_item_record_id: itemRecordId,
    plaid_item_id: itemRecordId,
    account_id: flowledgerAccountId,
    flowledger_account_id: flowledgerAccountId,
    plaid_account_id: account.account_id,
    persistent_account_id: account.persistent_account_id || null,
    name: account.name || account.official_name || "Bank account",
    official_name: account.official_name || null,
    mask: account.mask || null,
    account_type: account.type || null,
    account_subtype: account.subtype || null,
    type: account.type || null,
    subtype: account.subtype || null,
    current_balance: account.balances?.current ?? null,
    available_balance: account.balances?.available ?? null,
    credit_limit: account.balances?.limit ?? null,
    currency_code: account.balances?.iso_currency_code || account.balances?.unofficial_currency_code || null,
    is_active: true,
    updated_at: new Date().toISOString(),
  };
  const legacyPayload = {
    user_id: userId,
    household_id: householdId || null,
    plaid_item_id: itemRecordId,
    account_id: flowledgerAccountId,
    flowledger_account_id: flowledgerAccountId,
    plaid_account_id: account.account_id,
    name: account.name || account.official_name || "Bank account",
    mask: account.mask || null,
    type: account.type || null,
    subtype: account.subtype || null,
    current_balance: account.balances?.current ?? null,
    available_balance: account.balances?.available ?? null,
    updated_at: new Date().toISOString(),
  };

  try {
    const rows = await supabaseRest(
      "plaid_accounts?on_conflict=user_id,plaid_account_id",
      "POST",
      modernPayload,
      { prefer: "resolution=merge-duplicates,return=representation" },
    );
    return first(rows);
  } catch (error) {
    if (!unsupportedColumn(error)) throw error;
    const rows = await supabaseRest(
      "plaid_accounts?on_conflict=user_id,plaid_account_id",
      "POST",
      legacyPayload,
      { prefer: "resolution=merge-duplicates,return=representation" },
    );
    return first(rows);
  }
}

async function syncPlaidAccountMetadata(client, accessToken, item, userId) {
  const response = await client.accountsGet({ access_token: accessToken });
  const accounts = response?.data?.accounts || [];
  const synced = [];
  for (const account of accounts) {
    const row = await upsertPlaidAccountMetadata(userId, item.household_id || null, item.id, account);
    synced.push({ row, account });
  }
  return { accounts, synced, previews: accounts.map(safeAccountPreview) };
}

async function upsertFlowLedgerAccountForPlaid(userId, householdId, itemRecordId, plaidAccount) {
  const existing = await getPlaidAccountLinkByPlaidId(userId, plaidAccount.account_id);
  const mappedType = accountTypeFromPlaid(plaidAccount);
  if (mappedType !== "checking" && mappedType !== "savings") {
    await upsertPlaidAccountMetadata(userId, householdId, itemRecordId, plaidAccount);
    return { skipped: true, reason: "unsupported_account_type" };
  }

  const balance = accountBalance(plaidAccount);
  const balanceDate = todayIso();
  const accountName = plaidAccount.official_name || plaidAccount.name || "Bank account";
  const accountId = existing?.flowledger_account_id || existing?.account_id || makeId("plaid-account");

  if (existing?.flowledger_account_id || existing?.account_id) {
    await supabaseRest(
      `accounts?id=eq.${eq(accountId)}&user_id=eq.${eq(userId)}`,
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

  const link = await upsertPlaidAccountMetadata(userId, householdId, itemRecordId, plaidAccount, accountId);
  return {
    skipped: false,
    account_id: accountId,
    plaid_account_id: plaidAccount.account_id,
    plaid_account_row_id: link?.id || null,
  };
}

async function getPlaidAccountLinksForItem(userId, itemRecordId) {
  try {
    const rows = await supabaseRest(
      `plaid_accounts?user_id=eq.${eq(userId)}&plaid_item_record_id=eq.${eq(itemRecordId)}&select=*`,
      "GET",
    );
    if (Array.isArray(rows) && rows.length) return rows;
  } catch (error) {
    if (!unsupportedColumn(error, "plaid_item_record_id")) throw error;
  }

  const legacyRows = await supabaseRest(
    `plaid_accounts?user_id=eq.${eq(userId)}&plaid_item_id=eq.${eq(itemRecordId)}&select=*`,
    "GET",
  );
  return Array.isArray(legacyRows) ? legacyRows : [];
}

async function getExistingTransactionByHash(userId, importHash) {
  const rows = await supabaseRest(
    `transactions?user_id=eq.${eq(userId)}&import_hash=eq.${eq(importHash)}&select=id`,
    "GET",
  );
  return first(rows) || null;
}

async function upsertPlaidTransaction(userId, householdId, plaidAccountLink, plaidTransaction) {
  if (plaidTransaction.pending_transaction_id) {
    await removePlaidTransaction(userId, plaidTransaction.pending_transaction_id);
  }

  const importHash = `plaid:${plaidTransaction.transaction_id}`;
  const existing = await getExistingTransactionByHash(userId, importHash);
  const amount = normalizePlaidAmount(plaidTransaction.amount);
  const note = plaidTransaction.merchant_name || plaidTransaction.name || "Plaid transaction";
  const category = mapPlaidCategory(plaidTransaction);
  const transactionId = existing?.id || makeId("plaid-tx");
  const primary = plaidTransaction.personal_finance_category?.primary || null;
  const detailed = plaidTransaction.personal_finance_category?.detailed || null;
  const basePayload = {
    user_id: userId,
    household_id: householdId || null,
    account_id: plaidAccountLink.flowledger_account_id || plaidAccountLink.account_id || null,
    date: plaidTransaction.date,
    amount,
    category,
    note,
    import_hash: importHash,
  };
  const enrichedPayload = {
    ...basePayload,
    source: "plaid",
    plaid_transaction_id: plaidTransaction.transaction_id,
    plaid_account_id: plaidTransaction.account_id,
    authorized_date: plaidTransaction.authorized_date || null,
    merchant_name: plaidTransaction.merchant_name || null,
    original_name: plaidTransaction.name || null,
    pending: Boolean(plaidTransaction.pending),
    payment_channel: plaidTransaction.payment_channel || null,
    plaid_category_primary: primary,
    plaid_category_detailed: detailed,
    iso_currency_code: plaidTransaction.iso_currency_code || plaidTransaction.unofficial_currency_code || null,
  };

  try {
    if (existing?.id) {
      await supabaseRest(`transactions?id=eq.${eq(existing.id)}&user_id=eq.${eq(userId)}`, "PATCH", enrichedPayload);
    } else {
      await supabaseRest("transactions", "POST", { id: transactionId, ...enrichedPayload });
    }
  } catch (error) {
    if (!unsupportedColumn(error)) throw error;
    if (existing?.id) {
      await supabaseRest(`transactions?id=eq.${eq(existing.id)}&user_id=eq.${eq(userId)}`, "PATCH", basePayload);
    } else {
      await supabaseRest("transactions", "POST", { id: transactionId, ...basePayload });
    }
  }

  const plaidTxPayload = {
    user_id: userId,
    household_id: householdId || null,
    plaid_account_id: plaidAccountLink.id || null,
    transaction_id: transactionId,
    flowledger_transaction_id: transactionId,
    plaid_transaction_id: plaidTransaction.transaction_id,
    transaction_date: plaidTransaction.date,
    authorized_date: plaidTransaction.authorized_date || null,
    name: note,
    merchant_name: plaidTransaction.merchant_name || null,
    original_name: plaidTransaction.name || null,
    amount,
    category,
    pending: Boolean(plaidTransaction.pending),
    payment_channel: plaidTransaction.payment_channel || null,
    iso_currency_code: plaidTransaction.iso_currency_code || plaidTransaction.unofficial_currency_code || null,
    raw: plaidTransaction,
  };
  const legacyPlaidTxPayload = {
    user_id: userId,
    household_id: householdId || null,
    plaid_account_id: plaidAccountLink.id || null,
    transaction_id: transactionId,
    flowledger_transaction_id: transactionId,
    plaid_transaction_id: plaidTransaction.transaction_id,
    transaction_date: plaidTransaction.date,
    name: note,
    amount,
    category,
    pending: Boolean(plaidTransaction.pending),
    raw: plaidTransaction,
  };

  try {
    await supabaseRest(
      "plaid_transactions?on_conflict=user_id,plaid_transaction_id",
      "POST",
      plaidTxPayload,
      { prefer: "resolution=merge-duplicates,return=representation" },
    );
  } catch (error) {
    if (!unsupportedColumn(error)) throw error;
    await supabaseRest(
      "plaid_transactions?on_conflict=user_id,plaid_transaction_id",
      "POST",
      legacyPlaidTxPayload,
      { prefer: "resolution=merge-duplicates,return=representation" },
    );
  }

  return existing?.id ? "updated" : "created";
}

async function removePlaidTransaction(userId, plaidTransactionId) {
  const importHash = `plaid:${plaidTransactionId}`;
  try {
    await supabaseRest(
      `transactions?user_id=eq.${eq(userId)}&import_hash=eq.${eq(importHash)}`,
      "PATCH",
      { removed_at: new Date().toISOString() },
    );
  } catch (error) {
    if (!unsupportedColumn(error)) throw error;
    await supabaseRest(
      `transactions?user_id=eq.${eq(userId)}&import_hash=eq.${eq(importHash)}`,
      "DELETE",
      undefined,
      { prefer: "return=minimal" },
    );
  }

  try {
    await supabaseRest(
      `plaid_transactions?user_id=eq.${eq(userId)}&plaid_transaction_id=eq.${eq(plaidTransactionId)}`,
      "PATCH",
      { removed_at: new Date().toISOString() },
    );
  } catch (error) {
    if (!unsupportedColumn(error)) throw error;
    await supabaseRest(
      `plaid_transactions?user_id=eq.${eq(userId)}&plaid_transaction_id=eq.${eq(plaidTransactionId)}`,
      "DELETE",
      undefined,
      { prefer: "return=minimal" },
    );
  }
}

async function syncPlaidTransactions(client, item, accessToken, accountLinks = null) {
  const originalCursor = getTransactionsCursor(item);
  const userId = item.user_id;
  const householdId = item.household_id || null;
  const links = accountLinks || await getPlaidAccountLinksForItem(userId, item.id);
  const linksByPlaidAccountId = new Map(links.map(link => [link.plaid_account_id, link]));
  let restartCount = 0;

  await patchPlaidItem(
    item,
    { last_attempted_sync_at: new Date().toISOString() },
    {},
  );

  while (restartCount < 3) {
    let cursor = originalCursor;
    let hasMore = true;
    let pages = 0;
    let created = 0;
    let updated = 0;
    let removed = 0;
    const transactionPages = [];

    try {
      while (hasMore) {
        pages += 1;
        const response = await client.transactionsSync({
          access_token: accessToken,
          cursor: cursor || undefined,
          count: 500,
          options: {
            include_personal_finance_category: true,
          },
        });
        const page = response.data || {};
        cursor = page.next_cursor || cursor;
        hasMore = Boolean(page.has_more);
        transactionPages.push(page);
      }

      for (const page of transactionPages) {
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

      await patchPlaidItem(
        item,
        {
          transactions_cursor: cursor,
          cursor,
          last_successful_sync_at: new Date().toISOString(),
          last_attempted_sync_at: new Date().toISOString(),
          last_synced_at: new Date().toISOString(),
          status: "active",
          error_code: null,
          error_message: null,
        },
        {
          cursor,
          last_synced_at: new Date().toISOString(),
          status: "active",
        },
      );

      return {
        created,
        updated,
        removed,
        cursor,
        pages,
        restarted: restartCount > 0,
        empty: created + updated + removed === 0,
      };
    } catch (error) {
      if (isTransactionsMutationDuringPagination(error)) {
        restartCount += 1;
        continue;
      }

      const safe = safePlaidError(error, "Unable to sync Plaid transactions.");
      await patchPlaidItem(
        item,
        {
          last_attempted_sync_at: new Date().toISOString(),
          error_code: safe.error_code || "TRANSACTIONS_SYNC_FAILED",
          error_message: safe.error || null,
          status: safe.error_code === "ITEM_LOGIN_REQUIRED" ? "needs_repair" : item.status || "active",
        },
        {
          status: safe.error_code === "ITEM_LOGIN_REQUIRED" ? "needs_repair" : item.status || "active",
        },
      );
      throw error;
    }
  }

  const error = new Error("Plaid transactions changed during sync. Try again.");
  error.code = "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION";
  await patchPlaidItem(
    item,
    {
      last_attempted_sync_at: new Date().toISOString(),
      error_code: error.code,
      error_message: "Plaid transactions changed during sync. Try again.",
    },
    {},
  );
  throw error;
}

function decryptItemAccessToken(item) {
  const token = decryptAccessToken(getEncryptedAccessToken(item));
  if (!token) {
    const error = new Error("Bank token could not be read securely.");
    error.status = 500;
    throw error;
  }
  return token;
}

module.exports = {
  decryptItemAccessToken,
  getEncryptedAccessToken,
  getItemById,
  getItemByPlaidItemId,
  getItemByPlaidItemIdForWebhook,
  getPlaidAccountLinkByPlaidId,
  getPlaidAccountLinksForItem,
  getTransactionsCursor,
  patchPlaidItem,
  savePlaidItem,
  syncPlaidAccountMetadata,
  syncPlaidTransactions,
  upsertFlowLedgerAccountForPlaid,
  upsertPlaidAccountMetadata,
};
