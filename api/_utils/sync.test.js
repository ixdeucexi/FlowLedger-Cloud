const assert = require("node:assert/strict");
const test = require("node:test");

const {
  acquirePlaidSyncLock,
  conflictingPlaidAccountHousehold,
  creditCardDebtValues,
  debtPlanMonthBounds,
  duplicatePlaidAccountIds,
  editablePlaidFields,
  plaidAccountIdentity,
  plaidCurrentBalance,
  isCreditAccount,
  isCreditCardPaymentTransaction,
  isLiabilitiesUnavailable,
  plaidTransactionImportPolicy,
  persistCanonicalPlaidTransaction,
  releasePlaidSyncLock,
  stablePlaidFingerprint,
  shouldImportPlaidTransaction,
  shouldQueuePendingNotification,
  shouldQueuePostedNotification,
  transferPendingPlaidBillMatch,
  withPlaidSyncLock,
} = require("./sync");

test("Plaid current balances preserve unavailable values instead of inventing zero", () => {
  assert.equal(plaidCurrentBalance({ balances: { current: null } }), null);
  assert.equal(plaidCurrentBalance({ balances: {} }), null);
  assert.equal(plaidCurrentBalance({}), null);
  assert.equal(plaidCurrentBalance({ balances: { current: 0 } }), 0);
  assert.equal(plaidCurrentBalance({ balances: { current: 123.45 } }), 123.45);
});

test("Plaid sync lock helpers use the migration RPC boundary", async () => {
  const calls = [];
  const db = {
    async rpc(name, args) {
      calls.push({ name, args });
      return { data: true, error: null };
    },
  };

  assert.equal(await acquirePlaidSyncLock({
    db,
    itemId: "00000000-0000-0000-0000-000000000001",
    userId: "00000000-0000-0000-0000-000000000002",
    lockToken: "00000000-0000-0000-0000-000000000003",
  }), true);
  assert.equal(await releasePlaidSyncLock({
    db,
    itemId: "00000000-0000-0000-0000-000000000001",
    userId: "00000000-0000-0000-0000-000000000002",
    lockToken: "00000000-0000-0000-0000-000000000003",
  }), true);

  assert.deepEqual(calls.map(call => call.name), [
    "acquire_plaid_sync_lock",
    "release_plaid_sync_lock",
  ]);
  assert.equal(calls[0].args.p_lock_token, calls[1].args.p_lock_token);
});

test("a Plaid item sync releases its lock after success and failure", async () => {
  const calls = [];
  const db = {
    async rpc(name) {
      calls.push(name);
      return { data: true, error: null };
    },
  };
  const input = {
    db,
    itemId: "00000000-0000-0000-0000-000000000001",
    userId: "00000000-0000-0000-0000-000000000002",
    lockToken: "00000000-0000-0000-0000-000000000003",
  };

  assert.equal(await withPlaidSyncLock(input, async () => {
    calls.push("work");
    return "synced";
  }), "synced");
  await assert.rejects(
    withPlaidSyncLock(input, async () => {
      calls.push("failed-work");
      throw new Error("sync failed");
    }),
    /sync failed/,
  );

  assert.deepEqual(calls, [
    "acquire_plaid_sync_lock",
    "work",
    "release_plaid_sync_lock",
    "acquire_plaid_sync_lock",
    "failed-work",
    "release_plaid_sync_lock",
  ]);
});

test("an overlapping Plaid item sync stops before doing work", async () => {
  let worked = false;
  const db = {
    async rpc(name) {
      assert.equal(name, "acquire_plaid_sync_lock");
      return { data: false, error: null };
    },
  };

  await assert.rejects(
    withPlaidSyncLock({
      db,
      itemId: "00000000-0000-0000-0000-000000000001",
      userId: "00000000-0000-0000-0000-000000000002",
      lockToken: "00000000-0000-0000-0000-000000000003",
    }, async () => {
      worked = true;
    }),
    error => error?.code === "PLAID_SYNC_ALREADY_RUNNING",
  );
  assert.equal(worked, false);
});

test("pending-to-posted bill replacement uses one atomic migration RPC", async () => {
  const calls = [];
  const db = {
    async rpc(name, args) {
      calls.push({ name, args });
      return { data: true, error: null };
    },
  };

  assert.equal(await transferPendingPlaidBillMatch({
    db,
    userId: "00000000-0000-0000-0000-000000000002",
    pendingPlaidTransactionId: "pending-transaction",
    postedTransactionId: "plaid:user:posted-transaction",
  }), true);
  assert.deepEqual(calls, [{
    name: "transfer_pending_plaid_bill_match",
    args: {
      p_user_id: "00000000-0000-0000-0000-000000000002",
      p_pending_plaid_transaction_id: "pending-transaction",
      p_posted_transaction_id: "plaid:user:posted-transaction",
    },
  }]);
});

test("Plaid credit liabilities become the live Snowball debt values", () => {
  const values = creditCardDebtValues({
    account: {
      name: "Freedom Unlimited",
      mask: "4242",
      balances: { current: 3842.19 },
    },
    liability: {
      minimum_payment_amount: 117,
      next_payment_due_date: "2026-08-27",
      last_statement_balance: 3650.12,
      last_statement_issue_date: "2026-08-02",
      is_overdue: false,
      aprs: [{ apr_type: "purchase_apr", apr_percentage: 24.49 }],
    },
    existingBill: null,
  });

  assert.deepEqual(values, {
    name: "Freedom Unlimited •••• 4242",
    balance: 3842.19,
    minimumPayment: 117,
    reportedMinimum: 117,
    nextPaymentDate: "2026-08-27",
    dueDay: 27,
    interestRate: 24.49,
    purchaseApr: 24.49,
    lastStatementBalance: 3650.12,
    lastStatementIssueDate: "2026-08-02",
    isOverdue: false,
  });
});

test("missing or zero liability fields preserve the user's Snowball minimum and APR", () => {
  const values = creditCardDebtValues({
    account: { current_balance: 900 },
    liability: { minimum_payment_amount: 0, next_payment_due_date: null, aprs: [] },
    existingBill: {
      name: "My card",
      amount: 45,
      balance: 1000,
      interest_rate: 19.9,
      due_day: 12,
      next_payment_date: "2026-08-12",
    },
  });

  assert.equal(values.balance, 900);
  assert.equal(values.minimumPayment, 45);
  assert.equal(values.reportedMinimum, 0);
  assert.equal(values.interestRate, 19.9);
  assert.equal(values.nextPaymentDate, "2026-08-12");
});

test("credit accounts and nonfatal liability availability errors are recognized", () => {
  assert.equal(isCreditAccount({ type: "credit", subtype: "credit card" }), true);
  assert.equal(isCreditAccount({ account_type: "depository", account_subtype: "checking" }), false);
  assert.equal(isLiabilitiesUnavailable({ response: { data: { error_code: "ADDITIONAL_CONSENT_REQUIRED" } } }), true);
  assert.equal(isLiabilitiesUnavailable({ response: { data: { error_code: "INSTITUTION_DOWN" } } }), false);
});

test("only the card-side loan payment is automatically treated as a transfer", () => {
  const card = { account_type: "credit", account_subtype: "credit card" };
  const payment = {
    amount: -125,
    personal_finance_category: {
      primary: "LOAN_PAYMENTS",
      detailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
    },
  };
  assert.equal(isCreditCardPaymentTransaction(card, payment), true);
  assert.equal(isCreditCardPaymentTransaction({ account_type: "depository" }, payment), false);
  assert.equal(isCreditCardPaymentTransaction(card, { ...payment, amount: 125 }), false);
  assert.equal(isCreditCardPaymentTransaction(card, {
    amount: -35,
    personal_finance_category: { primary: "GENERAL_MERCHANDISE" },
  }), false);
});

test("overlapping Plaid webhook inserts are idempotent", async () => {
  const calls = [];
  const db = {
    from(table) {
      assert.equal(table, "transactions");
      return {
        async insert(row) {
          calls.push({ row });
          return { error: null };
        },
      };
    },
  };
  const canonicalRow = { id: "plaid:user-1:transaction-1", user_id: "user-1", household_id: "house-1" };

  await persistCanonicalPlaidTransaction({ db, existing: null, canonicalRow, userId: "user-1" });

  assert.deepEqual(calls, [{
    row: canonicalRow,
  }]);
});

test("a Plaid unique-key race refreshes the row that won the insert", async () => {
  const updates = [];
  const selectBuilder = {
    select() { return this; },
    eq() { return this; },
    async maybeSingle() { return { data: { id: "existing-row" }, error: null }; },
  };
  const updateBuilder = {
    eq() { return this; },
    then(resolve) { resolve({ error: null }); },
  };
  const db = {
    from() {
      return {
        async insert() { return { error: { code: "23505" } }; },
        select() { return selectBuilder; },
        update(fields) { updates.push(fields); return updateBuilder; },
      };
    },
  };
  const canonicalRow = {
    id: "plaid:user-1:transaction-1",
    user_id: "user-1",
    household_id: "house-1",
    plaid_transaction_id: "transaction-1",
    amount: -12,
  };

  await persistCanonicalPlaidTransaction({ db, existing: null, canonicalRow, userId: "user-1" });

  assert.deepEqual(updates, [{
    user_id: "user-1",
    household_id: "house-1",
    plaid_transaction_id: "transaction-1",
    amount: -12,
  }]);
});

test("Plaid account identity falls back to institution, mask, type, and name", () => {
  const account = { id: "account-1", mask: "1234", account_type: "depository", account_subtype: "checking", name: "Checking" };
  assert.equal(plaidAccountIdentity(account, "ins_1"), "fallback:ins_1:1234:depository:checking:checking");
  assert.notEqual(plaidAccountIdentity(account, "ins_1"), plaidAccountIdentity(account, "ins_2"));
});

test("Plaid debt rollover uses the household calendar month at a UTC boundary", () => {
  const instant = new Date("2026-09-01T01:30:00.000Z");
  assert.deepEqual(debtPlanMonthBounds("America/Chicago", instant), {
    monthStart: "2026-08-01",
    monthEnd: "2026-08-31",
  });
  assert.deepEqual(debtPlanMonthBounds("Asia/Tokyo", instant), {
    monthStart: "2026-09-01",
    monthEnd: "2026-09-30",
  });
});

test("a bank account cannot be moved into another household by a later Plaid connection", () => {
  const existing = [{
    household_id: "house-1",
    plaid_account_id: "account-old",
    persistent_account_id: "persistent-card",
  }];

  assert.equal(conflictingPlaidAccountHousehold(existing, [{
    account_id: "account-new",
    persistent_account_id: "persistent-card",
  }], "house-2"), existing[0]);
  assert.equal(conflictingPlaidAccountHousehold(existing, [{
    account_id: "account-old",
    persistent_account_id: null,
  }], "house-2"), existing[0]);
  assert.equal(conflictingPlaidAccountHousehold(existing, [{
    account_id: "account-old",
    persistent_account_id: "persistent-card",
  }], "house-1"), null);
  const crossUser = {
    ...existing[0],
    user_id: "another-user",
  };
  assert.equal(conflictingPlaidAccountHousehold([crossUser], [{
    account_id: "account-old",
  }], "house-2"), crossUser);
  assert.ok(conflictingPlaidAccountHousehold([{
    household_id: null,
    plaid_account_id: "account-old",
  }], [{
    account_id: "account-old",
  }], "house-2"));
});

test("duplicate bank links keep the existing Plaid item account", () => {
  const accounts = [
    { id: "account-retired", user_id: "user-1", plaid_item_id: "item-retired", mask: "1234", account_type: "depository", account_subtype: "checking", name: "Checking", is_active: false, created_at: "2026-07-12T00:00:00Z" },
    { id: "account-old", user_id: "user-1", plaid_item_id: "item-old", mask: "1234", account_type: "depository", account_subtype: "checking", name: "Checking", is_active: true, created_at: "2026-07-14T00:00:00Z" },
    { id: "account-new", user_id: "user-1", plaid_item_id: "item-new", mask: "1234", account_type: "depository", account_subtype: "checking", name: "Checking", is_active: true, created_at: "2026-07-16T00:00:00Z" },
  ];
  const items = new Map([
    ["item-retired", { institution_id: "ins_1", created_at: "2026-07-12T00:00:00Z" }],
    ["item-old", { institution_id: "ins_1", created_at: "2026-07-14T00:00:00Z" }],
    ["item-new", { institution_id: "ins_1", created_at: "2026-07-16T00:00:00Z" }],
  ]);
  assert.deepEqual(duplicatePlaidAccountIds(accounts, items), ["account-new"]);
});

test("Plaid fingerprints ignore only connection-specific IDs", () => {
  const first = {
    account_id: "account-old",
    transaction_id: "transaction-old",
    pending_transaction_id: "pending-old",
    amount: 51.38,
    date: "2026-07-16",
    merchant_name: "Capital One",
    personal_finance_category: { detailed: "LOAN_PAYMENTS_CAR_PAYMENT", primary: "LOAN_PAYMENTS" },
  };
  const copy = {
    personal_finance_category: { primary: "LOAN_PAYMENTS", detailed: "LOAN_PAYMENTS_CAR_PAYMENT" },
    merchant_name: "Capital One",
    date: "2026-07-16",
    amount: 51.38,
    pending_transaction_id: "pending-new",
    transaction_id: "transaction-new",
    account_id: "account-new",
  };
  assert.equal(stablePlaidFingerprint(first), stablePlaidFingerprint(copy));
  assert.notEqual(stablePlaidFingerprint(first), stablePlaidFingerprint({ ...copy, amount: 52.38 }));
});

test("only posted non-credit Plaid activity becomes a FlowLedger transaction", () => {
  const checking = { account_type: "depository", account_subtype: "checking" };
  const credit = { account_type: "credit", account_subtype: "credit card" };
  assert.equal(shouldImportPlaidTransaction(checking, { pending: true }), false);
  assert.equal(shouldImportPlaidTransaction(checking, { pending: false }), true);
  assert.equal(shouldImportPlaidTransaction(checking, {}), true);
  assert.equal(shouldImportPlaidTransaction(credit, { pending: false }), false);
  assert.deepEqual(plaidTransactionImportPolicy(credit, { pending: true }), {
    importCanonical: false,
    queuePendingNotification: false,
  });
  assert.deepEqual(plaidTransactionImportPolicy(credit, { pending: false }), {
    importCanonical: false,
    queuePendingNotification: false,
  });
  const creditImportResult = {
    flowledgerId: null,
    plaidTransactionId: "card-raw-only",
    isNewPosted: false,
    isNewPending: false,
  };
  assert.equal(shouldQueuePostedNotification("cursor-1", creditImportResult), false);
  assert.equal(shouldQueuePendingNotification("cursor-1", creditImportResult), false);
});

test("later Plaid syncs preserve fields the user edited", () => {
  const imported = { date: "2026-07-08", category: "Utilities", note: "Apple" };
  assert.deepEqual(editablePlaidFields(null, imported), { ...imported, user_edited_at: null });
  assert.deepEqual(editablePlaidFields({
    date: "2026-07-01",
    category: "Debt",
    note: "Tia Game",
    user_edited_at: "2026-07-15T15:00:00.000Z",
  }, imported), {
    date: "2026-07-01",
    category: "Debt",
    note: "Tia Game",
    user_edited_at: "2026-07-15T15:00:00.000Z",
  });
});

test("only a newly posted transaction after the initial cursor queues a phone notification", () => {
  const posted = { flowledgerId: "plaid:user:posted", isNewPosted: true };
  assert.equal(shouldQueuePostedNotification("cursor-1", posted), true);
  assert.equal(shouldQueuePostedNotification(null, posted), false);
  assert.equal(shouldQueuePostedNotification("cursor-1", { ...posted, isNewPosted: false }), false);
});

test("only newly seen pending activity after the initial cursor queues a pending alert", () => {
  const pending = { plaidTransactionId: "pending-1", isNewPending: true };
  assert.equal(shouldQueuePendingNotification("cursor-1", pending), true);
  assert.equal(shouldQueuePendingNotification(null, pending), false);
  assert.equal(shouldQueuePendingNotification("cursor-1", { ...pending, isNewPending: false }), false);
});

test("account observation time is captured immediately after Plaid accountsGet", () => {
  const source = require("node:fs").readFileSync(require("node:path").resolve(__dirname, "sync.js"), "utf8");
  const start = source.indexOf("async function syncAccounts");
  const end = source.indexOf("async function findConnectedCardDebt", start);
  const body = source.slice(start, end);
  assert.match(body, /await client\.accountsGet\([^;]+;\s*const observedAt = new Date\(\)\.toISOString\(\);/s);
  assert.ok(body.indexOf("const observedAt") < body.indexOf("serviceSupabase()"));
  assert.match(body, /updated_at: observedAt/);
  assert.match(body, /current_balance: plaidCurrentBalance\(account\)/);
  assert.match(body, /update\(\{ accounts_observed_at: observedAt \}\)/);
  assert.match(source, /account_observed_at: accountSync\.observedAt/);
  assert.doesNotMatch(source, /record_household_daily_checking_close/);
});
