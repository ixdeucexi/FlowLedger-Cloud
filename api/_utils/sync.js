const { plaid } = require("./plaid");
const { serviceSupabase, safeError } = require("./supabase");
const { decryptAccessToken } = require("./crypto");
const {
  deliverPendingPostedTransactionNotifications,
  queuePendingTransactionNotifications,
  queuePostedTransactionNotifications,
} = require("./push");

function tokenFor(item) {
  const encrypted = item && (item.encrypted_access_token || item.access_token_ciphertext);
  if (!encrypted) throw new Error("PLAID_ITEM_TOKEN_MISSING");
  return decryptAccessToken(encrypted);
}

function plaidAmountToFlowLedger(amount) {
  const value = Number(amount || 0);
  // Plaid amounts are positive money leaving the account. FlowLedger records
  // expenses as negative values and deposits as positive values.
  return -value;
}

function dateOnly(value) {
  return value ? String(value).slice(0, 10) : new Date().toISOString().slice(0, 10);
}

function plaidErrorCode(error) {
  return String(
    (error && error.response && error.response.data && error.response.data.error_code) ||
      (error && error.error_code) ||
      (error && error.code) ||
      "SYNC_FAILED",
  );
}

function isTransactionsPending(error) {
  return ["PRODUCT_NOT_READY", "PRODUCT_NOT_SUPPORTED"].includes(plaidErrorCode(error));
}

function shouldImportPlaidTransaction(transaction) {
  return !transaction || transaction.pending !== true;
}

function shouldQueuePostedNotification(originalCursor, imported) {
  return Boolean(originalCursor && imported && imported.isNewPosted && imported.flowledgerId);
}

function shouldQueuePendingNotification(originalCursor, imported) {
  return Boolean(originalCursor && imported && imported.isNewPending && imported.plaidTransactionId);
}

function editablePlaidFields(existing, imported) {
  if (!existing || !existing.user_edited_at) return { ...imported, user_edited_at: null };
  return {
    date: existing.date,
    category: existing.category,
    note: existing.note,
    user_edited_at: existing.user_edited_at,
  };
}

function normalizedAccountText(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function plaidAccountIdentity(account, institutionId) {
  const persistentId = normalizedAccountText(account && account.persistent_account_id);
  if (persistentId) return `persistent:${persistentId}`;
  const mask = normalizedAccountText(account && account.mask);
  const institution = normalizedAccountText(institutionId);
  if (!mask || !institution) return null;
  const name = normalizedAccountText((account && account.official_name) || (account && account.name));
  const type = normalizedAccountText((account && account.account_type) || (account && account.type));
  const subtype = normalizedAccountText((account && account.account_subtype) || (account && account.subtype));
  return ["fallback", institution, mask, type, subtype, name].join(":");
}

function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = stableJson(value[key]);
    return result;
  }, {});
}

function stablePlaidFingerprint(transaction) {
  const normalized = { ...(transaction || {}) };
  delete normalized.account_id;
  delete normalized.transaction_id;
  delete normalized.pending_transaction_id;
  return JSON.stringify(stableJson(normalized));
}

function duplicatePlaidAccountIds(accounts, itemsById) {
  const groups = new Map();
  for (const account of accounts || []) {
    if (account.is_active === false) continue;
    const itemId = account.plaid_item_record_id || account.plaid_item_id;
    const item = itemsById.get(itemId) || {};
    const identity = plaidAccountIdentity(account, item.institution_id);
    if (!identity) continue;
    const key = `${account.user_id}:${identity}`;
    const group = groups.get(key) || [];
    group.push({ account, item });
    groups.set(key, group);
  }

  const duplicateIds = [];
  for (const group of groups.values()) {
    group.sort((left, right) => {
      const itemDate = String(left.item.created_at || "").localeCompare(String(right.item.created_at || ""));
      if (itemDate) return itemDate;
      const accountDate = String(left.account.created_at || "").localeCompare(String(right.account.created_at || ""));
      if (accountDate) return accountDate;
      return String(left.account.id).localeCompare(String(right.account.id));
    });
    duplicateIds.push(...group.slice(1).map(entry => entry.account.id));
  }
  return duplicateIds;
}

async function findEquivalentPlaidTransaction({ db, userId, accountRow, transactionDate, amount, transaction }) {
  if (!accountRow) return null;
  const { data: candidates, error: candidateError } = await db
    .from("plaid_transactions")
    .select("plaid_transaction_id,plaid_account_id,flowledger_transaction_id,raw")
    .eq("user_id", userId)
    .eq("transaction_date", transactionDate)
    .eq("amount", amount)
    .eq("pending", false)
    .is("removed_at", null)
    .neq("plaid_transaction_id", transaction.transaction_id)
    .limit(20);
  if (candidateError) throw candidateError;
  if (!candidates || !candidates.length) return null;

  const candidateAccountIds = [...new Set(candidates.map(candidate => candidate.plaid_account_id).filter(Boolean))];
  if (!candidateAccountIds.length) return null;
  const { data: candidateAccounts, error: accountError } = await db
    .from("plaid_accounts")
    .select("id,persistent_account_id,name,official_name,mask,type,subtype,account_type,account_subtype")
    .in("id", candidateAccountIds);
  if (accountError) throw accountError;
  const accountsById = new Map((candidateAccounts || []).map(account => [account.id, account]));
  const currentIdentity = plaidAccountIdentity(accountRow, "same-institution");
  const fingerprint = stablePlaidFingerprint(transaction);
  return candidates
    .filter(candidate => plaidAccountIdentity(accountsById.get(candidate.plaid_account_id), "same-institution") === currentIdentity)
    .filter(candidate => stablePlaidFingerprint(candidate.raw) === fingerprint)
    .sort((left, right) => Number(Boolean(right.flowledger_transaction_id)) - Number(Boolean(left.flowledger_transaction_id)))[0] || null;
}

async function canonicalizePlaidAccounts({ userId }) {
  const db = serviceSupabase();
  const [{ data: accounts, error: accountsError }, { data: items, error: itemsError }] = await Promise.all([
    db.from("plaid_accounts")
      .select("id,user_id,plaid_item_id,plaid_item_record_id,persistent_account_id,name,official_name,mask,type,subtype,account_type,account_subtype,is_active,created_at")
      .eq("user_id", userId),
    db.from("plaid_items")
      .select("id,institution_id,status,created_at")
      .eq("user_id", userId),
  ]);
  if (accountsError) throw accountsError;
  if (itemsError) throw itemsError;

  const itemsById = new Map((items || []).map(item => [item.id, item]));
  const duplicateAccountIds = duplicatePlaidAccountIds(accounts || [], itemsById);
  const duplicateAccountSet = new Set(duplicateAccountIds);
  const now = new Date().toISOString();
  if (duplicateAccountIds.length) {
    const { error: deactivateError } = await db
      .from("plaid_accounts")
      .update({ is_active: false, updated_at: now })
      .in("id", duplicateAccountIds);
    if (deactivateError) throw deactivateError;
    const { error: retirePendingError } = await db
      .from("plaid_transactions")
      .update({ removed_at: now, updated_at: now })
      .eq("pending", true)
      .is("removed_at", null)
      .in("plaid_account_id", duplicateAccountIds);
    if (retirePendingError) throw retirePendingError;
  }

  const accountsByItem = new Map();
  const activeItemIds = new Set();
  for (const account of accounts || []) {
    const itemId = account.plaid_item_record_id || account.plaid_item_id;
    if (!itemId) continue;
    accountsByItem.set(itemId, (accountsByItem.get(itemId) || 0) + 1);
    if (account.is_active !== false && !duplicateAccountSet.has(account.id)) activeItemIds.add(itemId);
  }
  const duplicateItemIds = (items || [])
    .filter(item => ["active", "needs_repair"].includes(item.status))
    .filter(item => accountsByItem.has(item.id) && !activeItemIds.has(item.id))
    .map(item => item.id);
  if (duplicateItemIds.length) {
    const { error: duplicateItemError } = await db
      .from("plaid_items")
      .update({ status: "removed", updated_at: now })
      .in("id", duplicateItemIds);
    if (duplicateItemError) throw duplicateItemError;
  }

  return { duplicateAccountIds, duplicateItemIds };
}

async function syncAccounts({ client, userId, item, accessToken }) {
  const response = await client.accountsGet({ access_token: accessToken });
  const accounts = response.data.accounts || [];
  const db = serviceSupabase();
  const rows = accounts.map((account) => ({
    user_id: userId,
    household_id: item.household_id || null,
    plaid_item_id: item.id,
    plaid_item_record_id: item.id,
    plaid_account_id: account.account_id,
    persistent_account_id: account.persistent_account_id || null,
    name: account.name || "Bank account",
    official_name: account.official_name || null,
    mask: account.mask || null,
    type: account.type || "depository",
    subtype: account.subtype || null,
    account_type: account.type || "depository",
    account_subtype: account.subtype || null,
    current_balance: Number((account.balances && account.balances.current) || 0),
    available_balance:
      account.balances && account.balances.available == null
        ? null
        : Number(account.balances && account.balances.available),
    credit_limit:
      account.balances && account.balances.limit == null
        ? null
        : Number(account.balances && account.balances.limit),
    currency_code: (account.balances && account.balances.iso_currency_code) || "USD",
    is_active: true,
    updated_at: new Date().toISOString(),
  }));

  // Use the composite user/item key from the original migration. This works
  // even when a deployment has not yet applied the later global index.
  for (const row of rows) {
    const { error } = await db.from("plaid_accounts").upsert(row, {
      onConflict: "user_id,plaid_account_id",
    });
    if (error) throw error;
  }
  const canonical = await canonicalizePlaidAccounts({ userId });
  return { accounts, duplicateItemIds: canonical.duplicateItemIds };
}

async function upsertPlaidTransaction({ userId, householdId, accountRow, transaction, removedAt }) {
  const db = serviceSupabase();
  const plaidTransactionId = transaction.transaction_id;
  if (!plaidTransactionId) return { flowledgerId: null, plaidTransactionId: null, isNewPosted: false, isNewPending: false };

  const transactionDate = dateOnly(transaction.date || transaction.authorized_date);
  const authorizedDate = transaction.authorized_date ? dateOnly(transaction.authorized_date) : null;
  const personalCategory = transaction.personal_finance_category || {};
  const category =
    personalCategory.primary ||
    personalCategory.detailed ||
    (transaction.category && transaction.category[0]) ||
    "Other";
  const merchantName = transaction.merchant_name || transaction.name || "Imported transaction";
  const originalName = transaction.original_description || transaction.name || merchantName;
  const amount = plaidAmountToFlowLedger(transaction.amount);
  const now = new Date().toISOString();
  const canonicalId = `plaid:${userId}:${plaidTransactionId}`;

  // Never overwrite an explicitly edited/manual FlowLedger transaction.
  const { data: existing, error: existingError } = await db
    .from("transactions")
    .select("id,source,date,category,note,match_reason,review_status,user_edited_at,removed_at")
    .eq("user_id", userId)
    .eq("plaid_transaction_id", plaidTransactionId)
    .maybeSingle();
  if (existingError) throw existingError;

  const { data: existingPlaid, error: existingPlaidError } = await db
    .from("plaid_transactions")
    .select("id,removed_at")
    .eq("user_id", userId)
    .eq("plaid_transaction_id", plaidTransactionId)
    .maybeSingle();
  if (existingPlaidError) throw existingPlaidError;

  const shouldImport = shouldImportPlaidTransaction(transaction);
  if (shouldImport && accountRow && accountRow.has_duplicate_history && (!existing || existing.removed_at)) {
    const equivalent = await findEquivalentPlaidTransaction({ db, userId, accountRow, transactionDate, amount, transaction });
    if (equivalent) {
      const duplicateLedgerRow = {
        user_id: userId,
        household_id: householdId || null,
        plaid_account_id: accountRow.id,
        flowledger_transaction_id: equivalent.flowledger_transaction_id || null,
        plaid_transaction_id: plaidTransactionId,
        transaction_date: transactionDate,
        authorized_date: authorizedDate,
        amount,
        name: merchantName,
        merchant_name: transaction.merchant_name || null,
        original_name: originalName,
        category,
        pending: false,
        payment_channel: transaction.payment_channel || null,
        iso_currency_code: transaction.iso_currency_code || "USD",
        removed_at: removedAt || now,
        raw: transaction,
        updated_at: now,
      };
      const { error: duplicateError } = await db.from("plaid_transactions").upsert(duplicateLedgerRow, {
        onConflict: "user_id,plaid_transaction_id",
      });
      if (duplicateError) throw duplicateError;
      return {
        flowledgerId: equivalent.flowledger_transaction_id || null,
        plaidTransactionId,
        isNewPosted: false,
        isNewPending: false,
      };
    }
  }
  const isNewPosted = shouldImport && !existing;
  let flowledgerId = shouldImport && existing ? existing.id : null;

  // Keep pending Plaid activity in the import ledger only. It must not affect
  // FlowLedger balances, forecasts, matching, or transaction totals until the
  // bank posts it. Retire any pending row created by an older deployment.
  if (!shouldImport && existing && existing.source === "plaid") {
    const { error } = await db
      .from("transactions")
      .update({ pending: true, removed_at: removedAt || now })
      .eq("id", existing.id)
      .eq("user_id", userId);
    if (error) throw error;
  }

  if (shouldImport && (!existing || existing.source === "plaid")) {
    const editableFields = editablePlaidFields(existing, {
      date: transactionDate,
      category: existing && existing.match_reason === "confirmed_bill_match" ? existing.category : category,
      note: transaction.name || originalName,
    });
    const canonicalRow = {
      id: flowledgerId || canonicalId,
      user_id: userId,
      household_id: householdId || null,
      ...editableFields,
      amount,
      source: "plaid",
      plaid_transaction_id: plaidTransactionId,
      plaid_account_id: transaction.account_id || null,
      authorized_date: authorizedDate,
      merchant_name: transaction.merchant_name || null,
      original_name: originalName,
      pending: false,
      payment_channel: transaction.payment_channel || null,
      plaid_category_primary: personalCategory.primary || null,
      plaid_category_detailed: personalCategory.detailed || null,
      iso_currency_code: transaction.iso_currency_code || "USD",
      removed_at: removedAt || null,
      review_status: existing && existing.review_status ? existing.review_status : "needs_review",
    };
    await persistCanonicalPlaidTransaction({ db, existing, canonicalRow, userId });
    flowledgerId = canonicalRow.id;
  }

  const plaidRow = {
    user_id: userId,
    household_id: householdId || null,
    plaid_account_id: accountRow ? accountRow.id : null,
    flowledger_transaction_id: shouldImport ? flowledgerId || null : null,
    plaid_transaction_id: plaidTransactionId,
    transaction_date: transactionDate,
    authorized_date: authorizedDate,
    amount,
    name: merchantName,
    merchant_name: transaction.merchant_name || null,
    original_name: originalName,
    category,
    pending: Boolean(transaction.pending),
    payment_channel: transaction.payment_channel || null,
    iso_currency_code: transaction.iso_currency_code || "USD",
    removed_at: removedAt || null,
    raw: transaction,
    updated_at: now,
  };
  const { error: importedError } = await db.from("plaid_transactions").upsert(plaidRow, {
    onConflict: "user_id,plaid_transaction_id",
  });
  if (importedError) throw importedError;

  // Plaid can replace a pending transaction with a new posted transaction ID.
  // Carry a user's confirmed bill match forward so the posted row does not
  // become a second expense while the removed pending row keeps the paid bill.
  const pendingTransactionId = transaction.pending_transaction_id;
  if (!transaction.pending && pendingTransactionId) {
    const { error: retirePendingError } = await db
      .from("plaid_transactions")
      .update({ removed_at: now, updated_at: now })
      .eq("user_id", userId)
      .eq("plaid_transaction_id", pendingTransactionId)
      .eq("pending", true);
    if (retirePendingError) throw retirePendingError;
  }

  if (!transaction.pending && pendingTransactionId && flowledgerId) {
    const { data: pendingFlowTransaction, error: pendingLookupError } = await db
      .from("transactions")
      .select("id,linked_bill_id,match_reason")
      .eq("user_id", userId)
      .eq("plaid_transaction_id", pendingTransactionId)
      .maybeSingle();
    if (pendingLookupError) throw pendingLookupError;
    if (
      pendingFlowTransaction &&
      pendingFlowTransaction.id !== flowledgerId &&
      pendingFlowTransaction.linked_bill_id &&
      pendingFlowTransaction.match_reason === "confirmed_bill_match"
    ) {
      const billId = pendingFlowTransaction.linked_bill_id;
      const unmatched = await db.rpc("unmatch_transaction_from_bill", {
        p_transaction_id: pendingFlowTransaction.id,
      });
      if (unmatched.error) throw unmatched.error;
      const rematched = await db.rpc("match_transaction_to_bill", {
        p_transaction_id: flowledgerId,
        p_bill_id: billId,
      });
      if (rematched.error) {
        await db.rpc("match_transaction_to_bill", {
          p_transaction_id: pendingFlowTransaction.id,
          p_bill_id: billId,
        });
        throw rematched.error;
      }
    }
  }
  return {
    flowledgerId,
    plaidTransactionId,
    isNewPosted,
    isNewPending: !shouldImport && (!existingPlaid || Boolean(existingPlaid.removed_at)),
  };
}

async function persistCanonicalPlaidTransaction({ db, existing, canonicalRow, userId }) {
  if (existing) {
    const { error } = await db
      .from("transactions")
      .update(canonicalRow)
      .eq("id", existing.id)
      .eq("user_id", userId);
    if (error) throw error;
    return;
  }

  // Webhooks can overlap and both observe a transaction before either insert
  // commits. The deterministic primary key makes the first insert canonical;
  // the other request must become a no-op instead of failing the whole sync.
  const { error } = await db.from("transactions").upsert(canonicalRow, {
    onConflict: "id",
    ignoreDuplicates: true,
  });
  if (error) throw error;
}

async function syncTransactions({ client, userId, item, accessToken }) {
  const originalCursor = item.transactions_cursor || item.cursor || null;
  let cursor = originalCursor;
  let restarted = false;
  let added = 0;
  let modified = 0;
  let removed = 0;
  const notificationTransactionIds = [];
  const pendingNotificationTransactionIds = [];

  while (true) {
    let page;
    try {
      page = (
        await client.transactionsSync({
          access_token: accessToken,
          ...(cursor ? { cursor } : {}),
        })
      ).data;
    } catch (error) {
      if (plaidErrorCode(error) === "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION" && !restarted) {
        cursor = originalCursor;
        restarted = true;
        continue;
      }
      throw error;
    }

    const accountIds = [
      ...(page.added || []),
      ...(page.modified || []),
    ]
      .map((transaction) => transaction.account_id)
      .filter(Boolean);
    const accountRows = {};
    if (accountIds.length) {
      const db = serviceSupabase();
      const { data, error } = await db
        .from("plaid_accounts")
        .select("id,plaid_account_id,persistent_account_id,name,official_name,mask,type,subtype,account_type,account_subtype")
        .eq("user_id", userId)
        .eq("is_active", true)
        .in("plaid_account_id", [...new Set(accountIds)]);
      if (error) throw error;
      const { data: inactiveAccounts, error: inactiveError } = await db
        .from("plaid_accounts")
        .select("persistent_account_id,name,official_name,mask,type,subtype,account_type,account_subtype")
        .eq("user_id", userId)
        .eq("is_active", false);
      if (inactiveError) throw inactiveError;
      const inactiveIdentities = new Set((inactiveAccounts || []).map(account => plaidAccountIdentity(account, "same-institution")).filter(Boolean));
      (data || []).forEach((row) => {
        const identity = plaidAccountIdentity(row, "same-institution");
        row.has_duplicate_history = Boolean(identity && inactiveIdentities.has(identity));
        accountRows[row.plaid_account_id] = row;
      });
    }

    for (const transaction of page.added || []) {
      const accountRow = accountRows[transaction.account_id];
      if (!accountRow) continue;
      const imported = await upsertPlaidTransaction({ userId, householdId: item.household_id, accountRow, transaction });
      if (shouldQueuePostedNotification(originalCursor, imported)) notificationTransactionIds.push(imported.flowledgerId);
      if (shouldQueuePendingNotification(originalCursor, imported)) pendingNotificationTransactionIds.push(imported.plaidTransactionId);
      added += 1;
    }
    for (const transaction of page.modified || []) {
      const accountRow = accountRows[transaction.account_id];
      if (!accountRow) continue;
      const imported = await upsertPlaidTransaction({ userId, householdId: item.household_id, accountRow, transaction });
      if (shouldQueuePostedNotification(originalCursor, imported)) notificationTransactionIds.push(imported.flowledgerId);
      if (shouldQueuePendingNotification(originalCursor, imported)) pendingNotificationTransactionIds.push(imported.plaidTransactionId);
      modified += 1;
    }
    for (const transaction of page.removed || []) {
      const now = new Date().toISOString();
      const { error: plaidError } = await serviceSupabase()
        .from("plaid_transactions")
        .update({ removed_at: now, updated_at: now })
        .eq("user_id", userId)
        .eq("plaid_transaction_id", transaction.transaction_id);
      if (plaidError) throw plaidError;
      const { error: transactionError } = await serviceSupabase()
        .from("transactions")
        .update({ removed_at: now })
        .eq("user_id", userId)
        .eq("plaid_transaction_id", transaction.transaction_id);
      if (transactionError) throw transactionError;
      removed += 1;
    }

    cursor = page.next_cursor || cursor;
    if (!page.has_more) break;
  }
  try {
    if (originalCursor && pendingNotificationTransactionIds.length) {
      await queuePendingTransactionNotifications(userId, pendingNotificationTransactionIds);
    }
    if (originalCursor && notificationTransactionIds.length) {
      await queuePostedTransactionNotifications(userId, notificationTransactionIds);
    } else if (!pendingNotificationTransactionIds.length) {
      await deliverPendingPostedTransactionNotifications(userId);
    }
  } catch (error) {
    console.error("[plaid:push] notification delivery deferred", {
      error: safeError(error, "Push notification delivery failed."),
    });
  }
  return { cursor, added, modified, removed };
}

async function syncItem({ userId, item }) {
  const accessToken = tokenFor(item);
  const client = plaid();
  const db = serviceSupabase();
  const attempted = new Date().toISOString();
  await db
    .from("plaid_items")
    .update({
      last_attempted_sync_at: attempted,
      status: "active",
      error_code: null,
      error_message: null,
      updated_at: attempted,
    })
    .eq("id", item.id)
    .eq("user_id", userId);

  try {
    const accountSync = await syncAccounts({ client, userId, item, accessToken });
    const accounts = accountSync.accounts;
    if (accountSync.duplicateItemIds.includes(item.id)) {
      return {
        accounts: accounts.length,
        transactions: { cursor: item.transactions_cursor || item.cursor || null, added: 0, modified: 0, removed: 0 },
        transactions_pending: false,
        duplicate: true,
      };
    }
    let transactions;
    try {
      transactions = await syncTransactions({ client, userId, item, accessToken });
    } catch (error) {
      if (!isTransactionsPending(error)) throw error;
      const pendingAt = new Date().toISOString();
      await db
        .from("plaid_items")
        .update({
          status: "active",
          error_code: plaidErrorCode(error).slice(0, 120),
          error_message: safeError(error, "Plaid is still preparing transaction history."),
          updated_at: pendingAt,
        })
        .eq("id", item.id)
        .eq("user_id", userId);
      return {
        accounts: accounts.length,
        transactions: { cursor: item.transactions_cursor || item.cursor || null, added: 0, modified: 0, removed: 0 },
        transactions_pending: true,
      };
    }

    const completed = new Date().toISOString();
    const { error } = await db
      .from("plaid_items")
      .update({
        transactions_cursor: transactions.cursor || null,
        cursor: transactions.cursor || null,
        last_successful_sync_at: completed,
        last_synced_at: completed,
        status: "active",
        error_code: null,
        error_message: null,
        updated_at: completed,
      })
      .eq("id", item.id)
      .eq("user_id", userId);
    if (error) throw error;
    return { accounts: accounts.length, transactions, transactions_pending: false };
  } catch (error) {
    await db
      .from("plaid_items")
      .update({
        status: "needs_repair",
        error_code: plaidErrorCode(error).slice(0, 120),
        error_message: safeError(error, "Plaid sync failed."),
        updated_at: new Date().toISOString(),
      })
      .eq("id", item.id)
      .eq("user_id", userId);
    throw error;
  }
}

module.exports = {
  syncItem,
  syncAccounts,
  syncTransactions,
  canonicalizePlaidAccounts,
  duplicatePlaidAccountIds,
  plaidAccountIdentity,
  stablePlaidFingerprint,
  plaidAmountToFlowLedger,
  shouldImportPlaidTransaction,
  shouldQueuePendingNotification,
  shouldQueuePostedNotification,
  editablePlaidFields,
  persistCanonicalPlaidTransaction,
};
