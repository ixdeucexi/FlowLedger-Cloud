const { randomUUID } = require("node:crypto");

const { plaid } = require("./plaid");
const { serviceSupabase, safeError } = require("./supabase");
const { decryptAccessToken } = require("./crypto");
const { localDateInZone } = require("./moneyHealth");
const {
  displayNameForSyncedPlaidAccount,
  indexedPlaidAccountDisplayNames,
} = require("./plaidAccountNickname");
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

function isLiabilitiesUnavailable(error) {
  return [
    "ADDITIONAL_CONSENT_REQUIRED",
    "PRODUCT_NOT_ENABLED",
    "PRODUCT_NOT_READY",
    "PRODUCT_NOT_SUPPORTED",
    "PRODUCTS_NOT_SUPPORTED",
  ].includes(plaidErrorCode(error));
}

function optionalNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function optionalDate(value) {
  if (!value) return null;
  const date = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

function isCreditAccount(account) {
  const type = normalizedAccountText(account && (account.account_type || account.type));
  return type === "credit";
}

function purchaseApr(liability) {
  const aprs = liability && Array.isArray(liability.aprs) ? liability.aprs : [];
  const purchase = aprs.find(apr => normalizedAccountText(apr && apr.apr_type) === "purchase_apr");
  return optionalNumber(purchase && purchase.apr_percentage);
}

function cardDisplayName(account) {
  const name = String((account && (account.official_name || account.name)) || "Credit card").trim();
  const mask = String((account && account.mask) || "").trim();
  return mask && !name.includes(mask) ? `${name} •••• ${mask}` : name;
}

function creditCardDebtValues({ account, liability, existingBill }) {
  const balances = (account && account.balances) || {};
  const currentBalance = optionalNumber(
    balances.current == null ? account && account.current_balance : balances.current,
  );
  const reportedMinimum = optionalNumber(liability && liability.minimum_payment_amount);
  const minimumPayment = reportedMinimum != null && reportedMinimum > 0.005
    ? reportedMinimum
    : optionalNumber(existingBill && existingBill.amount) || 0;
  const nextPaymentDate = optionalDate(liability && liability.next_payment_due_date)
    || optionalDate(existingBill && existingBill.next_payment_date);
  const apr = purchaseApr(liability);

  return {
    name: existingBill && existingBill.name ? existingBill.name : cardDisplayName(account),
    balance: currentBalance == null
      ? Math.max(0, optionalNumber(existingBill && existingBill.balance) || 0)
      : Math.max(0, currentBalance),
    minimumPayment,
    reportedMinimum,
    nextPaymentDate,
    dueDay: nextPaymentDate
      ? Number(nextPaymentDate.slice(8, 10))
      : Math.max(1, optionalNumber(existingBill && existingBill.due_day) || 1),
    interestRate: apr == null
      ? Math.max(0, optionalNumber(existingBill && existingBill.interest_rate) || 0)
      : Math.max(0, apr),
    purchaseApr: apr,
    lastStatementBalance: optionalNumber(liability && liability.last_statement_balance),
    lastStatementIssueDate: optionalDate(liability && liability.last_statement_issue_date),
    isOverdue: liability && typeof liability.is_overdue === "boolean" ? liability.is_overdue : null,
  };
}

function isCreditCardPaymentTransaction(account, transaction) {
  if (!isCreditAccount(account)) return false;
  if (plaidAmountToFlowLedger(transaction && transaction.amount) <= 0) return false;
  const category = transaction && transaction.personal_finance_category || {};
  const primary = normalizedAccountText(category.primary);
  const detailed = normalizedAccountText(category.detailed);
  return primary === "loan_payments" || detailed.includes("credit_card_payment");
}

function plaidTransactionImportPolicy(account, transaction) {
  const creditSource = isCreditAccount(account);
  return {
    importCanonical: !creditSource && (!transaction || transaction.pending !== true),
    queuePendingNotification: !creditSource && Boolean(transaction && transaction.pending === true),
  };
}

function shouldImportPlaidTransaction(account, transaction) {
  return plaidTransactionImportPolicy(account, transaction).importCanonical;
}

function shouldQueuePostedNotification(originalCursor, imported) {
  return Boolean(originalCursor && imported && imported.isNewPosted && imported.flowledgerId);
}

function shouldQueuePendingNotification(originalCursor, imported) {
  return Boolean(originalCursor && imported && imported.isNewPending && imported.plaidTransactionId);
}

async function acquirePlaidSyncLock({ db, itemId, userId, lockToken }) {
  const { data, error } = await db.rpc("acquire_plaid_sync_lock", {
    p_item_id: itemId,
    p_user_id: userId,
    p_lock_token: lockToken,
  });
  if (error) throw error;
  return data === true;
}

async function releasePlaidSyncLock({ db, itemId, userId, lockToken }) {
  const { data, error } = await db.rpc("release_plaid_sync_lock", {
    p_item_id: itemId,
    p_user_id: userId,
    p_lock_token: lockToken,
  });
  if (error) throw error;
  return data === true;
}

async function withPlaidSyncLock({ db, itemId, userId, lockToken = randomUUID() }, work) {
  const acquired = await acquirePlaidSyncLock({ db, itemId, userId, lockToken });
  if (!acquired) {
    const error = new Error("A sync is already running for this Plaid connection.");
    error.code = "PLAID_SYNC_ALREADY_RUNNING";
    throw error;
  }

  try {
    return await work();
  } finally {
    try {
      await releasePlaidSyncLock({ db, itemId, userId, lockToken });
    } catch (error) {
      console.error("[plaid:sync] lock release deferred", {
        itemRecordId: itemId,
        errorCode: plaidErrorCode(error),
      });
    }
  }
}

async function transferPendingPlaidBillMatch({
  db,
  userId,
  pendingPlaidTransactionId,
  postedTransactionId,
}) {
  const { data, error } = await db.rpc("transfer_pending_plaid_bill_match", {
    p_user_id: userId,
    p_pending_plaid_transaction_id: pendingPlaidTransactionId,
    p_posted_transaction_id: postedTransactionId,
  });
  if (error) throw error;
  return data === true;
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

function conflictingPlaidAccountHousehold(existingAccounts, incomingAccounts, householdId) {
  const incomingAccountIds = new Set((incomingAccounts || []).map(account => account && account.account_id).filter(Boolean));
  const incomingPersistentIds = new Set((incomingAccounts || []).map(account => account && account.persistent_account_id).filter(Boolean));
  return (existingAccounts || []).find(account =>
    account.household_id !== householdId
    && (
      incomingAccountIds.has(account.plaid_account_id)
      || (account.persistent_account_id && incomingPersistentIds.has(account.persistent_account_id))
    )
  ) || null;
}

async function findEquivalentPlaidTransaction({ db, userId, householdId, accountRow, transactionDate, amount, transaction }) {
  if (!accountRow) return null;
  const { data: candidates, error: candidateError } = await db
    .from("plaid_transactions")
    .select("plaid_transaction_id,plaid_account_id,flowledger_transaction_id,raw")
    .eq("user_id", userId)
    .eq("household_id", householdId)
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
    .eq("household_id", householdId)
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

async function canonicalizePlaidAccounts({ userId, householdId }) {
  if (!householdId) throw new Error("PLAID_HOUSEHOLD_REQUIRED");
  const db = serviceSupabase();
  const [{ data: accounts, error: accountsError }, { data: items, error: itemsError }] = await Promise.all([
    db.from("plaid_accounts")
      .select("id,user_id,plaid_item_id,plaid_item_record_id,persistent_account_id,name,official_name,mask,type,subtype,account_type,account_subtype,is_active,created_at")
      .eq("user_id", userId)
      .eq("household_id", householdId),
    db.from("plaid_items")
      .select("id,institution_id,status,created_at")
      .eq("user_id", userId)
      .eq("household_id", householdId),
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
  const householdId = item && item.household_id;
  if (!householdId) throw new Error("PLAID_HOUSEHOLD_REQUIRED");
  const response = await client.accountsGet({ access_token: accessToken });
  const accounts = response.data.accounts || [];
  const db = serviceSupabase();
  const accountIds = [...new Set(accounts.map(account => account.account_id).filter(Boolean))];
  const persistentIds = [...new Set(accounts.map(account => account.persistent_account_id).filter(Boolean))];
  const [exactOwnership, persistentOwnership] = await Promise.all([
    accountIds.length
      ? db.from("plaid_accounts")
          .select("id,household_id,plaid_account_id,persistent_account_id")
          .in("plaid_account_id", accountIds)
      : Promise.resolve({ data: [], error: null }),
    persistentIds.length
      ? db.from("plaid_accounts")
          .select("id,household_id,plaid_account_id,persistent_account_id")
          .in("persistent_account_id", persistentIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (exactOwnership.error) throw exactOwnership.error;
  if (persistentOwnership.error) throw persistentOwnership.error;
  const ownership = [...new Map(
    [...(exactOwnership.data || []), ...(persistentOwnership.data || [])]
      .map(account => [account.id, account])
  ).values()];
  if (conflictingPlaidAccountHousehold(ownership, accounts, householdId)) {
    const error = new Error("This bank account is already connected to another FlowLedger household.");
    error.code = "PLAID_ACCOUNT_ALREADY_CONNECTED_TO_ANOTHER_HOUSEHOLD";
    throw error;
  }
  const namedAccounts = await db
    .from("plaid_accounts")
    .select("plaid_account_id,persistent_account_id,display_name,updated_at")
    .eq("user_id", userId)
    .eq("household_id", householdId)
    .not("display_name", "is", null);
  if (namedAccounts.error) throw namedAccounts.error;
  const displayNameIndex = indexedPlaidAccountDisplayNames(namedAccounts.data || []);
  const rows = accounts.map((account) => {
    const displayName = displayNameForSyncedPlaidAccount(account, displayNameIndex);
    return {
      user_id: userId,
      household_id: householdId,
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
      ...(displayName ? { display_name: displayName } : {}),
    };
  });

  // Use the composite user/item key from the original migration. This works
  // even when a deployment has not yet applied the later global index.
  for (const row of rows) {
    const { error } = await db.from("plaid_accounts").upsert(row, {
      onConflict: "user_id,plaid_account_id",
    });
    if (error) throw error;
  }
  const canonical = await canonicalizePlaidAccounts({ userId, householdId });
  return { accounts, duplicateItemIds: canonical.duplicateItemIds };
}

async function findConnectedCardDebt({ db, userId, householdId, accountRow }) {
  const select = "id,name,amount,balance,interest_rate,due_day,next_payment_date";
  const base = () => db
    .from("bills")
    .select(select)
    .eq("user_id", userId)
    .eq("household_id", householdId)
    .limit(1);

  let result = await base().eq("plaid_account_record_id", accountRow.id).maybeSingle();
  if (result.error) throw result.error;
  if (result.data) return result.data;

  if (accountRow.persistent_account_id) {
    result = await base().eq("plaid_persistent_account_id", accountRow.persistent_account_id).maybeSingle();
    if (result.error) throw result.error;
    if (result.data) return result.data;
  }

  result = await base().eq("plaid_account_id", accountRow.plaid_account_id).maybeSingle();
  if (result.error) throw result.error;
  return result.data || null;
}

async function defaultBudgetId(db, householdId) {
  const result = await db
    .from("budgets")
    .select("id")
    .eq("household_id", householdId)
    .eq("is_default", true)
    .limit(1)
    .maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) throw new Error("DEFAULT_BUDGET_NOT_FOUND");
  return result.data.id;
}

function debtIsCurrentThisMonth(bill, monthStart, monthEnd) {
  const start = optionalDate(bill.start_date);
  const end = optionalDate(bill.end_date);
  return (!start || start <= monthEnd) && (!end || end >= monthStart);
}

function debtPlanMonthBounds(timeZone, now = new Date()) {
  const localDate = localDateInZone(timeZone || "UTC", now);
  const year = Number(localDate.slice(0, 4));
  const month = Number(localDate.slice(5, 7));
  const monthEndDate = new Date(Date.UTC(year, month, 0));
  return {
    monthStart: `${localDate.slice(0, 7)}-01`,
    monthEnd: monthEndDate.toISOString().slice(0, 10),
  };
}

async function recalculateSnowballMinimums({ db, userId, householdId }) {
  const [billResult, householdSettings, userSettings] = await Promise.all([
    db.from("bills")
      .select("id,amount,balance,interest_rate,include_in_snowball,start_date,end_date")
      .eq("household_id", householdId)
      .eq("is_debt", true),
    db.from("household_settings").select("payment_method,time_zone").eq("household_id", householdId).maybeSingle(),
    db.from("settings").select("payment_method").eq("user_id", userId).maybeSingle(),
  ]);
  if (billResult.error) throw billResult.error;
  if (householdSettings.error) throw householdSettings.error;
  if (userSettings.error) throw userSettings.error;

  const debts = billResult.data || [];
  const { monthStart, monthEnd } = debtPlanMonthBounds(householdSettings.data?.time_zone);
  const eligible = debts.filter(debt =>
    debt.include_in_snowball !== false && debtIsCurrentThisMonth(debt, monthStart, monthEnd)
  );
  const freedMinimum = eligible
    .filter(debt => Number(debt.balance || 0) <= 0.009)
    .reduce((sum, debt) => sum + Math.max(0, Number(debt.amount || 0)), 0);
  const method = householdSettings.data?.payment_method || userSettings.data?.payment_method || "snowball";
  const active = eligible.filter(debt => Number(debt.balance || 0) > 0.009).sort((left, right) => {
    if (method === "avalanche") {
      const apr = Number(right.interest_rate || 0) - Number(left.interest_rate || 0);
      if (Math.abs(apr) > 0.00001) return apr;
    }
    const balance = Number(left.balance || 0) - Number(right.balance || 0);
    return Math.abs(balance) > 0.005 ? balance : String(left.id).localeCompare(String(right.id));
  });

  const reset = await db.from("bills").update({ snowball_minimum_boost: 0 }).eq("household_id", householdId).eq("is_debt", true);
  if (reset.error) throw reset.error;
  if (active[0] && freedMinimum > 0.005) {
    const boosted = await db
      .from("bills")
      .update({ snowball_minimum_boost: freedMinimum })
      .eq("id", active[0].id)
      .eq("household_id", householdId);
    if (boosted.error) throw boosted.error;
  }
}

async function syncConnectedCardDebt({ db, userId, item, account, liability, liabilityFetched }) {
  const accountResult = await db
    .from("plaid_accounts")
    .select("id,plaid_account_id,persistent_account_id,name,official_name,mask,current_balance")
    .eq("user_id", userId)
    .eq("household_id", item.household_id)
    .eq("plaid_item_record_id", item.id)
    .eq("plaid_account_id", account.account_id)
    .eq("is_active", true)
    .maybeSingle();
  if (accountResult.error) throw accountResult.error;
  if (!accountResult.data) return false;

  const accountRow = accountResult.data;
  const existingBill = await findConnectedCardDebt({
    db,
    userId,
    householdId: item.household_id,
    accountRow,
  });
  const values = creditCardDebtValues({ account, liability, existingBill });
  const syncedAt = new Date().toISOString();
  const accountUpdate = { current_balance: values.balance, updated_at: syncedAt };
  if (liabilityFetched) {
    Object.assign(accountUpdate, {
      minimum_payment_amount: values.reportedMinimum,
      next_payment_due_date: optionalDate(liability && liability.next_payment_due_date),
      last_statement_balance: values.lastStatementBalance,
      last_statement_issue_date: values.lastStatementIssueDate,
      is_overdue: values.isOverdue,
      purchase_apr: values.purchaseApr,
      liability_last_synced_at: syncedAt,
    });
  }
  const accountUpdateResult = await db.from("plaid_accounts").update(accountUpdate)
    .eq("id", accountRow.id)
    .eq("household_id", item.household_id);
  if (accountUpdateResult.error) throw accountUpdateResult.error;

  const sharedBillFields = {
    is_debt: true,
    category: "Debt",
    balance: values.balance,
    amount: values.minimumPayment,
    interest_rate: values.interestRate,
    due_day: values.dueDay,
    next_payment_date: values.nextPaymentDate,
    is_recurring: true,
    frequency: "monthly",
    plaid_account_record_id: accountRow.id,
    plaid_account_id: accountRow.plaid_account_id,
    plaid_persistent_account_id: accountRow.persistent_account_id || null,
    plaid_last_synced_at: syncedAt,
  };

  if (existingBill) {
    const updated = await db.from("bills").update(sharedBillFields).eq("id", existingBill.id).eq("household_id", item.household_id);
    if (updated.error) throw updated.error;
    return true;
  }

  // Keep a newly connected card available for an explicit user attachment.
  // This prevents creating a duplicate when the same card already exists as a
  // manual Debt/Snowball entry.
  return false;
}

async function syncLiabilities({ client, userId, item, accessToken, accounts }) {
  const creditAccounts = (accounts || []).filter(isCreditAccount);
  if (!creditAccounts.length) return { cards: 0, debts: 0, available: true, error_code: null };

  let data = null;
  let liabilityError = null;
  try {
    const response = await client.liabilitiesGet({ access_token: accessToken });
    data = response.data || response;
  } catch (error) {
    liabilityError = plaidErrorCode(error);
    const expected = isLiabilitiesUnavailable(error);
    console[expected ? "info" : "error"]("[plaid:liabilities] using account balances without statement details", {
      itemRecordId: item.id,
      errorCode: liabilityError,
    });
  }

  const liabilityByAccount = new Map(
    (((data && data.liabilities) || {}).credit || [])
      .filter(liability => liability && liability.account_id)
      .map(liability => [liability.account_id, liability]),
  );
  const freshAccountById = new Map(
    ((data && data.accounts) || [])
      .filter(account => account && account.account_id)
      .map(account => [account.account_id, account]),
  );
  const db = serviceSupabase();
  let debts = 0;
  for (const account of creditAccounts) {
    const freshAccount = freshAccountById.get(account.account_id);
    const latestAccount = freshAccount ? {
      ...account,
      ...freshAccount,
      balances: { ...(account.balances || {}), ...(freshAccount.balances || {}) },
    } : account;
    if (await syncConnectedCardDebt({
      db,
      userId,
      item,
      account: latestAccount,
      liability: liabilityByAccount.get(account.account_id) || null,
      liabilityFetched: Boolean(data),
    })) debts += 1;
  }
  await recalculateSnowballMinimums({ db, userId, householdId: item.household_id });
  return {
    cards: creditAccounts.length,
    debts,
    available: Boolean(data),
    error_code: liabilityError,
  };
}

async function upsertPlaidTransaction({ userId, householdId, accountRow, transaction, removedAt }) {
  if (!householdId) throw new Error("PLAID_HOUSEHOLD_REQUIRED");
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
  const autoTransfer = isCreditCardPaymentTransaction(accountRow, transaction);
  const now = new Date().toISOString();
  const canonicalId = `plaid:${userId}:${plaidTransactionId}`;

  // Never overwrite an explicitly edited/manual FlowLedger transaction.
  const { data: existing, error: existingError } = await db
    .from("transactions")
    .select("id,source,date,category,note,match_reason,review_status,user_edited_at,removed_at")
    .eq("user_id", userId)
    .eq("household_id", householdId)
    .eq("plaid_transaction_id", plaidTransactionId)
    .maybeSingle();
  if (existingError) throw existingError;

  const { data: existingPlaid, error: existingPlaidError } = await db
    .from("plaid_transactions")
    .select("id,removed_at")
    .eq("user_id", userId)
    .eq("household_id", householdId)
    .eq("plaid_transaction_id", plaidTransactionId)
    .maybeSingle();
  if (existingPlaidError) throw existingPlaidError;

  const importPolicy = plaidTransactionImportPolicy(accountRow, transaction);
  const shouldImport = importPolicy.importCanonical;
  if (shouldImport && accountRow && accountRow.has_duplicate_history && (!existing || existing.removed_at)) {
    const equivalent = await findEquivalentPlaidTransaction({ db, userId, householdId, accountRow, transactionDate, amount, transaction });
    if (equivalent) {
      const duplicateLedgerRow = {
        user_id: userId,
        household_id: householdId,
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
  if (transaction.pending === true && !isCreditAccount(accountRow) && existing && existing.source === "plaid") {
    const { error } = await db
      .from("transactions")
      .update({ pending: true, removed_at: removedAt || now })
      .eq("id", existing.id)
      .eq("user_id", userId)
      .eq("household_id", householdId);
    if (error) throw error;
  }

  if (shouldImport && (!existing || existing.source === "plaid")) {
    const editableFields = editablePlaidFields(existing, {
      date: transactionDate,
      category: existing && existing.match_reason === "confirmed_bill_match"
        ? existing.category
        : autoTransfer ? "Transfer" : category,
      note: transaction.name || originalName,
    });
    const canonicalRow = {
      id: flowledgerId || canonicalId,
      user_id: userId,
      household_id: householdId,
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
      review_status: existing && existing.review_status && existing.review_status !== "needs_review"
        ? existing.review_status
        : autoTransfer ? "transfer" : "needs_review",
    };
    await persistCanonicalPlaidTransaction({ db, existing, canonicalRow, userId, householdId });
    flowledgerId = canonicalRow.id;
  }

  const plaidRow = {
    user_id: userId,
    household_id: householdId,
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
      .eq("household_id", householdId)
      .eq("plaid_transaction_id", pendingTransactionId)
      .eq("pending", true);
    if (retirePendingError) throw retirePendingError;

    if (flowledgerId) {
      let pendingPlanUpdate = db
        .from("pending_plan_matches")
        .update({
          status: "ready_review",
          posted_transaction_id: flowledgerId,
          posted_plaid_transaction_id: plaidTransactionId,
          posted_amount: Math.abs(amount),
          updated_at: now,
        })
        .eq("pending_plaid_transaction_id", pendingTransactionId)
        .eq("status", "active");
      pendingPlanUpdate = householdId
        ? pendingPlanUpdate.eq("household_id", householdId)
        : pendingPlanUpdate.eq("user_id", userId);
      const { error: carryPendingPlanError } = await pendingPlanUpdate;
      if (carryPendingPlanError) throw carryPendingPlanError;
    }
  }

  if (!transaction.pending && pendingTransactionId && flowledgerId) {
    await transferPendingPlaidBillMatch({
      db,
      userId,
      pendingPlaidTransactionId: pendingTransactionId,
      postedTransactionId: flowledgerId,
    });
  }
  return {
    flowledgerId,
    plaidTransactionId,
    isNewPosted,
    isNewPending: importPolicy.queuePendingNotification && (!existingPlaid || Boolean(existingPlaid.removed_at)),
  };
}

async function persistCanonicalPlaidTransaction({ db, existing, canonicalRow, userId, householdId = canonicalRow.household_id }) {
  if (!householdId) throw new Error("PLAID_HOUSEHOLD_REQUIRED");
  if (existing) {
    const { error } = await db
      .from("transactions")
      .update(canonicalRow)
      .eq("id", existing.id)
      .eq("user_id", userId)
      .eq("household_id", householdId);
    if (error) throw error;
    return;
  }

  const { error } = await db.from("transactions").insert(canonicalRow);
  if (!error) return;
  if (error.code !== "23505") throw error;

  // Two Plaid webhooks can overlap, and older imports can have a different
  // FlowLedger id for the same Plaid transaction. Resolve either unique-key
  // collision to the already-stored row, then refresh that canonical row.
  const { data: conflicting, error: lookupError } = await db
    .from("transactions")
    .select("id")
    .eq("user_id", userId)
    .eq("household_id", householdId)
    .eq("plaid_transaction_id", canonicalRow.plaid_transaction_id)
    .maybeSingle();
  if (lookupError) throw lookupError;
  if (!conflicting?.id) {
    const conflictError = new Error("A Plaid transaction with this identity belongs to another household.");
    conflictError.code = "PLAID_TRANSACTION_HOUSEHOLD_CONFLICT";
    throw conflictError;
  }

  const { id: _incomingId, ...canonicalFields } = canonicalRow;
  const { error: updateError } = await db
    .from("transactions")
    .update(canonicalFields)
    .eq("id", conflicting.id)
    .eq("user_id", userId)
    .eq("household_id", householdId);
  if (updateError) throw updateError;
}

async function syncTransactions({ client, userId, item, accessToken }) {
  if (!item || !item.household_id) throw new Error("PLAID_HOUSEHOLD_REQUIRED");
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
        .eq("household_id", item.household_id)
        .eq("is_active", true)
        .in("plaid_account_id", [...new Set(accountIds)]);
      if (error) throw error;
      const { data: inactiveAccounts, error: inactiveError } = await db
        .from("plaid_accounts")
        .select("persistent_account_id,name,official_name,mask,type,subtype,account_type,account_subtype")
        .eq("user_id", userId)
        .eq("household_id", item.household_id)
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
      const db = serviceSupabase();
      const { error: plaidError } = await db
        .from("plaid_transactions")
        .update({ removed_at: now, updated_at: now })
        .eq("user_id", userId)
        .eq("household_id", item.household_id)
        .eq("plaid_transaction_id", transaction.transaction_id);
      if (plaidError) throw plaidError;
      const { error: transactionError } = await serviceSupabase()
        .from("transactions")
        .update({ removed_at: now })
        .eq("user_id", userId)
        .eq("household_id", item.household_id)
        .eq("plaid_transaction_id", transaction.transaction_id);
      if (transactionError) throw transactionError;
      let pendingPlanUpdate = db
        .from("pending_plan_matches")
        .update({ status: "expired", updated_at: now })
        .eq("pending_plaid_transaction_id", transaction.transaction_id)
        .eq("status", "active");
      pendingPlanUpdate = item.household_id
        ? pendingPlanUpdate.eq("household_id", item.household_id)
        : pendingPlanUpdate.eq("user_id", userId);
      const { error: pendingPlanError } = await pendingPlanUpdate;
      if (pendingPlanError) throw pendingPlanError;
      removed += 1;
    }

    cursor = page.next_cursor || cursor;
    if (!page.has_more) break;
  }
  try {
    if (originalCursor && pendingNotificationTransactionIds.length) {
      await queuePendingTransactionNotifications(userId, item.household_id, pendingNotificationTransactionIds);
    }
    if (originalCursor && notificationTransactionIds.length) {
      await queuePostedTransactionNotifications(userId, item.household_id, notificationTransactionIds);
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

async function syncItemUnlocked({ userId, item, accessToken, client, db }) {
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
    .eq("user_id", userId)
    .eq("household_id", item.household_id);

  try {
    const accountSync = await syncAccounts({ client, userId, item, accessToken });
    const accounts = accountSync.accounts;
    if (accountSync.duplicateItemIds.includes(item.id)) {
      return {
        accounts: accounts.length,
        liabilities: { cards: 0, debts: 0, available: false, error_code: null },
        transactions: { cursor: item.transactions_cursor || item.cursor || null, added: 0, modified: 0, removed: 0 },
        transactions_pending: false,
        duplicate: true,
      };
    }
    const liabilities = await syncLiabilities({ client, userId, item, accessToken, accounts });
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
        .eq("user_id", userId)
        .eq("household_id", item.household_id);
      return {
        accounts: accounts.length,
        liabilities,
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
      .eq("user_id", userId)
      .eq("household_id", item.household_id);
    if (error) throw error;
    return { accounts: accounts.length, liabilities, transactions, transactions_pending: false };
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
      .eq("user_id", userId)
      .eq("household_id", item.household_id);
    throw error;
  }
}

async function syncItem({ userId, item }) {
  const accessToken = tokenFor(item);
  const client = plaid();
  const db = serviceSupabase();
  return withPlaidSyncLock(
    { db, itemId: item.id, userId },
    () => syncItemUnlocked({ userId, item, accessToken, client, db }),
  );
}

module.exports = {
  syncItem,
  syncAccounts,
  syncLiabilities,
  syncTransactions,
  findConnectedCardDebt,
  defaultBudgetId,
  recalculateSnowballMinimums,
  canonicalizePlaidAccounts,
  duplicatePlaidAccountIds,
  plaidAccountIdentity,
  stablePlaidFingerprint,
  plaidAmountToFlowLedger,
  creditCardDebtValues,
  isCreditAccount,
  isCreditCardPaymentTransaction,
  isLiabilitiesUnavailable,
  plaidTransactionImportPolicy,
  shouldImportPlaidTransaction,
  shouldQueuePendingNotification,
  shouldQueuePostedNotification,
  acquirePlaidSyncLock,
  releasePlaidSyncLock,
  withPlaidSyncLock,
  transferPendingPlaidBillMatch,
  editablePlaidFields,
  debtPlanMonthBounds,
  conflictingPlaidAccountHousehold,
  persistCanonicalPlaidTransaction,
};
