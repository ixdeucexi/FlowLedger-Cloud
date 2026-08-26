const { serviceSupabase } = require("./supabase");

const CENT = 0.005;
const BALANCE_TOLERANCE = 1;
const STALE_SYNC_HOURS = 36;

function absAmount(value) {
  return Math.abs(Number(value) || 0);
}

function allocationTotal(transaction) {
  const allocations = Array.isArray(transaction.review_allocations)
    ? transaction.review_allocations
    : [];
  return allocations.reduce((sum, allocation) => sum + absAmount(allocation && allocation.amount), 0);
}

function activePosted(row) {
  return !row.removed_at && row.pending !== true;
}

function checkingAccount(row) {
  return row
    && row.is_active !== false
    && String(row.account_type || "").toLowerCase() === "depository"
    && String(row.account_subtype || "").toLowerCase() === "checking";
}

function issue(code, title, detail, metadata = {}) {
  return { code, title, detail, ...metadata };
}

function auditMoneyHealthData(data, now = new Date()) {
  const transactions = data.transactions || [];
  const reconciliations = data.reconciliations || [];
  const plaidTransactions = data.plaidTransactions || [];
  const plaidItems = data.plaidItems || [];
  const accounts = data.accounts || [];
  const plaidAccounts = data.plaidAccounts || [];
  const issues = [];

  const transactionsById = new Map(transactions.map(row => [row.id, row]));
  const reconciliationsById = new Map(reconciliations.map(row => [row.transaction_id, row]));
  const postedPlaidIds = new Map();

  transactions.filter(activePosted).forEach(transaction => {
    if (transaction.plaid_transaction_id) {
      const existing = postedPlaidIds.get(transaction.plaid_transaction_id);
      if (existing) {
        issues.push(issue(
          "duplicate_posted_bank_transaction",
          "Duplicate posted bank transaction",
          "One Plaid transaction is linked to more than one FlowLedger cash row.",
          { transactionId: transaction.id, relatedTransactionId: existing },
        ));
      } else {
        postedPlaidIds.set(transaction.plaid_transaction_id, transaction.id);
      }
    }

    if (transaction.review_status === "matched" && !reconciliationsById.has(transaction.id)) {
      issues.push(issue(
        "matched_without_reconciliation",
        "Match history is incomplete",
        "A matched transaction is missing its undo record.",
        { transactionId: transaction.id },
      ));
    }

    if (
      transaction.review_status !== "needs_review"
      && Array.isArray(transaction.review_allocations)
      && transaction.review_allocations.length > 0
      && Math.abs(allocationTotal(transaction) - absAmount(transaction.amount)) >= CENT
    ) {
      issues.push(issue(
        "allocation_mismatch",
        "Split amounts do not balance",
        "The reviewed allocations do not equal the bank transaction.",
        { transactionId: transaction.id },
      ));
    }
  });

  reconciliations.forEach(reconciliation => {
    if (!transactionsById.has(reconciliation.transaction_id)) {
      issues.push(issue(
        "orphan_reconciliation",
        "Match history has no transaction",
        "An undo record points to a transaction that no longer exists.",
        { transactionId: reconciliation.transaction_id },
      ));
    }
  });

  const pendingById = new Map(
    plaidTransactions
      .filter(row => row.pending === true && !row.removed_at)
      .map(row => [row.plaid_transaction_id, row]),
  );
  plaidTransactions.filter(row => row.pending !== true && !row.removed_at).forEach(row => {
    const priorPendingId = row.raw && row.raw.pending_transaction_id;
    if (priorPendingId && pendingById.has(priorPendingId)) {
      issues.push(issue(
        "stale_pending_transition",
        "Pending transaction did not clear",
        "A posted transaction still has its earlier pending copy active.",
        { plaidTransactionId: row.plaid_transaction_id, pendingPlaidTransactionId: priorPendingId },
      ));
    }
  });

  const staleBefore = now.getTime() - STALE_SYNC_HOURS * 60 * 60 * 1000;
  plaidItems.filter(item => item.status === "active").forEach(item => {
    const lastSync = item.last_successful_sync_at || item.last_synced_at;
    if (lastSync && new Date(lastSync).getTime() < staleBefore) {
      issues.push(issue(
        "stale_bank_sync",
        "Bank connection is stale",
        "This connection has not completed a successful sync in more than 36 hours.",
        { plaidItemId: item.id, lastSuccessfulSyncAt: lastSync },
      ));
    }
    if (item.error_code) {
      issues.push(issue(
        "bank_connection_error",
        "Bank connection needs attention",
        "Plaid reported an active connection error.",
        { plaidItemId: item.id, errorCode: item.error_code },
      ));
    }
  });

  const manualChecking = accounts.filter(account =>
    account.is_active !== false && String(account.account_type || "").toLowerCase() === "checking"
  );
  const connectedChecking = plaidAccounts.filter(checkingAccount);
  if (manualChecking.length === 1 && connectedChecking.length === 1) {
    const expectedRaw = manualChecking[0].current_balance;
    const actualRaw = connectedChecking[0].current_balance;
    const expected = expectedRaw == null ? Number.NaN : Number(expectedRaw);
    const actual = actualRaw == null ? Number.NaN : Number(actualRaw);
    if (Number.isFinite(expected) && Number.isFinite(actual) && Math.abs(expected - actual) > BALANCE_TOLERANCE) {
      issues.push(issue(
        "checking_balance_divergence",
        "Checking balances do not agree",
        "The saved checking balance differs from the connected bank by more than $1.",
        { savedBalance: expected, connectedBalance: actual },
      ));
    }
  }

  const uniqueIssues = [...new Map(issues.map(item => [
    `${item.code}:${item.transactionId || item.plaidTransactionId || item.plaidItemId || ""}`,
    item,
  ])).values()];
  return {
    status: uniqueIssues.length ? "issues" : "clean",
    issueCount: uniqueIssues.length,
    issues: uniqueIssues,
    summary: {
      transactions: transactions.length,
      reconciliations: reconciliations.length,
      plaidTransactions: plaidTransactions.length,
      plaidItems: plaidItems.length,
      checkedAt: now.toISOString(),
    },
  };
}

async function loadHouseholdMoneyData(db, householdId) {
  const results = await Promise.all([
    db.from("transactions").select("id,date,amount,source,plaid_transaction_id,pending,removed_at,deleted_at,review_status,review_resolution,review_allocations").eq("household_id", householdId),
    db.from("transaction_reconciliations").select("transaction_id,resolution,target_id,occurrence_date,settlement,planned_amount,allocations").eq("household_id", householdId),
    db.from("plaid_transactions").select("plaid_transaction_id,pending,removed_at,raw").eq("household_id", householdId),
    db.from("plaid_items").select("id,status,last_successful_sync_at,last_synced_at,error_code").eq("household_id", householdId),
    db.from("accounts").select("id,account_type,current_balance,is_active").eq("household_id", householdId),
    db.from("plaid_accounts").select("id,account_type,account_subtype,current_balance,is_active").eq("household_id", householdId),
  ]);
  const failed = results.find(result => result.error);
  if (failed && failed.error) throw failed.error;
  return {
    transactions: results[0].data || [],
    reconciliations: results[1].data || [],
    plaidTransactions: results[2].data || [],
    plaidItems: results[3].data || [],
    accounts: results[4].data || [],
    plaidAccounts: results[5].data || [],
  };
}

function localDateInZone(timeZone, date = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${value.year}-${value.month}-${value.day}`;
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

function localHourInZone(timeZone, date = new Date()) {
  try {
    return Number(new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone || "UTC",
      hour: "2-digit",
      hour12: false,
    }).format(date)) % 24;
  } catch {
    return date.getUTCHours();
  }
}

async function runMoneyHealthCheck({
  householdId,
  timeZone = "UTC",
  triggeredBy = "manual",
  checkedBy = null,
  db = serviceSupabase(),
  now = new Date(),
}) {
  const data = await loadHouseholdMoneyData(db, householdId);
  const result = auditMoneyHealthData(data, now);
  const localDate = localDateInZone(timeZone, now);
  const payload = {
    household_id: householdId,
    local_date: localDate,
    status: result.status,
    issue_count: result.issueCount,
    issues: result.issues,
    summary: result.summary,
    triggered_by: triggeredBy,
    checked_by: checkedBy,
    checked_at: now.toISOString(),
  };
  let query;
  if (triggeredBy === "nightly") {
    const { data: existing, error: existingError } = await db
      .from("money_health_runs")
      .select("id")
      .eq("household_id", householdId)
      .eq("local_date", localDate)
      .eq("triggered_by", "nightly")
      .maybeSingle();
    if (existingError) throw existingError;
    query = existing
      ? db.from("money_health_runs").update(payload).eq("id", existing.id)
      : db.from("money_health_runs").insert(payload);
  } else {
    query = db.from("money_health_runs").insert(payload);
  }
  const { data: run, error } = await query.select("*").single();
  if (error) throw error;
  await db.from("money_health_runs").delete().lt(
    "checked_at",
    new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString(),
  );
  return run;
}

module.exports = {
  auditMoneyHealthData,
  localDateInZone,
  localHourInZone,
  runMoneyHealthCheck,
};
