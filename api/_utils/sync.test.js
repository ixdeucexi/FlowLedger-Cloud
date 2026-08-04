const assert = require("node:assert/strict");
const test = require("node:test");

const {
  creditCardDebtValues,
  duplicatePlaidAccountIds,
  editablePlaidFields,
  plaidAccountIdentity,
  isCreditAccount,
  isCreditCardPaymentTransaction,
  isLiabilitiesUnavailable,
  persistCanonicalPlaidTransaction,
  stablePlaidFingerprint,
  shouldImportPlaidTransaction,
  shouldQueuePendingNotification,
  shouldQueuePostedNotification,
} = require("./sync");

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
  const canonicalRow = { id: "plaid:user-1:transaction-1", user_id: "user-1" };

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
    plaid_transaction_id: "transaction-1",
    amount: -12,
  };

  await persistCanonicalPlaidTransaction({ db, existing: null, canonicalRow, userId: "user-1" });

  assert.deepEqual(updates, [{
    user_id: "user-1",
    plaid_transaction_id: "transaction-1",
    amount: -12,
  }]);
});

test("Plaid account identity falls back to institution, mask, type, and name", () => {
  const account = { id: "account-1", mask: "1234", account_type: "depository", account_subtype: "checking", name: "Checking" };
  assert.equal(plaidAccountIdentity(account, "ins_1"), "fallback:ins_1:1234:depository:checking:checking");
  assert.notEqual(plaidAccountIdentity(account, "ins_1"), plaidAccountIdentity(account, "ins_2"));
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

test("only posted Plaid activity becomes a FlowLedger transaction", () => {
  assert.equal(shouldImportPlaidTransaction({ pending: true }), false);
  assert.equal(shouldImportPlaidTransaction({ pending: false }), true);
  assert.equal(shouldImportPlaidTransaction({}), true);
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
