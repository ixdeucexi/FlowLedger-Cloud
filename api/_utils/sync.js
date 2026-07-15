const { plaid } = require("./plaid");
const { serviceSupabase, safeError } = require("./supabase");
const { decryptAccessToken } = require("./crypto");

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

async function syncAccounts({ client, userId, item, accessToken }) {
  const response = await client.accountsGet({ access_token: accessToken });
  const accounts = response.data.accounts || [];
  const db = serviceSupabase();
  const rows = accounts.map((account) => ({
    user_id: userId,
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
  return accounts;
}

async function upsertPlaidTransaction({ userId, accountRow, transaction, removedAt }) {
  const db = serviceSupabase();
  const plaidTransactionId = transaction.transaction_id;
  if (!plaidTransactionId) return;

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
    .select("id,source,category,match_reason,review_status")
    .eq("user_id", userId)
    .eq("plaid_transaction_id", plaidTransactionId)
    .maybeSingle();
  if (existingError) throw existingError;

  const shouldImport = shouldImportPlaidTransaction(transaction);
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
    const canonicalRow = {
      id: flowledgerId || canonicalId,
      user_id: userId,
      date: transactionDate,
      amount,
      category: existing && existing.match_reason === "confirmed_bill_match" ? existing.category : category,
      note: transaction.name || originalName,
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
    const { error } = existing
      ? await db.from("transactions").update(canonicalRow).eq("id", existing.id).eq("user_id", userId)
      : await db.from("transactions").insert(canonicalRow);
    if (error) throw error;
    flowledgerId = canonicalRow.id;
  }

  const plaidRow = {
    user_id: userId,
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
}

async function syncTransactions({ client, userId, item, accessToken }) {
  const originalCursor = item.transactions_cursor || item.cursor || null;
  let cursor = originalCursor;
  let restarted = false;
  let added = 0;
  let modified = 0;
  let removed = 0;

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
      const { data, error } = await serviceSupabase()
        .from("plaid_accounts")
        .select("id,plaid_account_id")
        .eq("user_id", userId)
        .in("plaid_account_id", [...new Set(accountIds)]);
      if (error) throw error;
      (data || []).forEach((row) => {
        accountRows[row.plaid_account_id] = row;
      });
    }

    for (const transaction of page.added || []) {
      await upsertPlaidTransaction({ userId, accountRow: accountRows[transaction.account_id], transaction });
      added += 1;
    }
    for (const transaction of page.modified || []) {
      await upsertPlaidTransaction({ userId, accountRow: accountRows[transaction.account_id], transaction });
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
    const accounts = await syncAccounts({ client, userId, item, accessToken });
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
  plaidAmountToFlowLedger,
  shouldImportPlaidTransaction,
};
