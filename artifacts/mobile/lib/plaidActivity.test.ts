import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalConnectedAccounts,
  isInferredPendingBankHold,
  pendingPlaidActivityWithBalanceHolds,
  plaidAccountIdentity,
  summarizePendingCheckingActivity,
  unplannedPendingExpenses,
  visiblePendingPlaidActivity,
} from "./plaidActivity";
import type { PendingPlaidActivityRow, PlaidAccountIdentityRow } from "./plaidActivity";

test("inferred balance holds are distinct from actual pending bank charges", () => {
  assert.equal(isInferredPendingBankHold({ plaid_transaction_id: "pending-hold:checking:50.00" }), true);
  assert.equal(isInferredPendingBankHold({ plaid_transaction_id: "cached-hold", name: "  Pending   Bank HOLD " }), true);
  assert.equal(isInferredPendingBankHold({ plaid_transaction_id: "cached-hold", merchant_name: "Pending bank hold" }), true);
  assert.equal(isInferredPendingBankHold({ plaid_transaction_id: "actual-charge", name: "Card payment" }), false);
  assert.equal(isInferredPendingBankHold({ plaid_transaction_id: "pending-charge" }), false);
});

const duplicateAccounts = [
  { id: "account-old", persistent_account_id: "physical-checking", name: "Checking", mask: "1234", account_type: "depository", account_subtype: "checking", is_active: true, updated_at: "2026-07-14T00:00:00Z", current_balance: 2171.13 },
  { id: "account-middle", persistent_account_id: "physical-checking", name: "Checking", mask: "1234", account_type: "depository", account_subtype: "checking", is_active: true, updated_at: "2026-07-15T00:00:00Z", current_balance: 2171.13 },
  { id: "account-new", persistent_account_id: "physical-checking", name: "Checking", mask: "1234", account_type: "depository", account_subtype: "checking", is_active: true, updated_at: "2026-07-16T00:00:00Z", current_balance: 2171.13 },
];

test("one explicit persistent account identity linked three times contributes one balance", () => {
  const accounts = canonicalConnectedAccounts(duplicateAccounts);
  assert.equal(accounts.length, 1);
  assert.equal(accounts[0].id, "account-new");
  assert.equal(accounts.reduce((sum, account) => sum + account.current_balance, 0), 2171.13);
});

test("matching names and masks never merge separate accounts without a stored shared identity", () => {
  const accounts = duplicateAccounts.map((account, index) => ({
    ...account, persistent_account_id: undefined, plaid_account_id: `provider-${index}`, current_balance: [1000, 500, 2000][index],
  }));
  assert.deepEqual(canonicalConnectedAccounts(accounts).map(account => account.id), ["account-old", "account-middle", "account-new"]);
  assert.equal(summarizePendingCheckingActivity([], accounts)?.currentBalance, 3500);
  const pending = accounts.map((account, index) => ({
    plaid_transaction_id: `pending-${index}`, plaid_account_id: account.id, transaction_date: "2026-07-16", amount: -50, name: "Same merchant",
  }));
  assert.equal(visiblePendingPlaidActivity(pending, accounts).length, 3);
  assert.deepEqual(pendingPlaidActivityWithBalanceHolds(pending, accounts, "2026-07-16").map(row => row.plaid_account_id), accounts.map(account => account.id));
});

test("account identity falls back only to an exact provider ID or the distinct stored row ID", () => {
  const first = { ...duplicateAccounts[0], persistent_account_id: " ", plaid_account_id: "Provider-Case" };
  const sameProvider = { ...duplicateAccounts[2], persistent_account_id: undefined, plaid_account_id: "Provider-Case", name: "Renamed", mask: "9876" };
  const differentProvider = { ...sameProvider, id: "different-provider", plaid_account_id: "provider-case" };
  assert.equal(plaidAccountIdentity(first), "provider:Provider-Case");
  assert.equal(canonicalConnectedAccounts([first, sameProvider]).length, 1);
  assert.equal(canonicalConnectedAccounts([first, differentProvider]).length, 2);
  const noProvider = [first, sameProvider].map(account => ({ ...account, plaid_account_id: undefined }));
  assert.deepEqual(noProvider.map(plaidAccountIdentity), ["row:account-old", "row:account-new"]);
  assert.equal(canonicalConnectedAccounts(noProvider).length, 2);
  assert.equal(canonicalConnectedAccounts([
    { ...first, persistent_account_id: "Physical-Case" }, { ...sameProvider, persistent_account_id: "physical-case" },
  ]).length, 2, "persistent IDs are also case-sensitive opaque identities");
});

test("one pending charge from duplicate links is shown once", () => {
  const pending = duplicateAccounts.map((account, index) => ({
    plaid_transaction_id: `pending-${index}`,
    plaid_account_id: account.id,
    transaction_date: "2026-07-16",
    amount: -51.38,
    name: "CAPITAL ONE - MOBILE PMT.",
  }));
  assert.equal(visiblePendingPlaidActivity(pending, duplicateAccounts).length, 1);
});

test("pending activity from a sole inactive account is hidden", () => {
  const inactiveAccount = { ...duplicateAccounts[0], is_active: false };
  const pending = [{
    plaid_transaction_id: "inactive-charge",
    plaid_account_id: inactiveAccount.id,
    transaction_date: "2026-07-16",
    amount: -51.38,
    name: "CAPITAL ONE - MOBILE PMT.",
  }, {
    plaid_transaction_id: "accountless-charge",
    transaction_date: "2026-07-16",
    amount: -12,
    name: "Pending cash adjustment",
  }];

  assert.deepEqual(
    visiblePendingPlaidActivity(pending, [inactiveAccount]).map(row => row.plaid_transaction_id),
    ["accountless-charge"],
  );
});

test("mixed active and inactive accounts show only active-account pending activity", () => {
  const activeAccount = duplicateAccounts[2];
  const inactiveAccount = { ...duplicateAccounts[0], id: "closed-account", mask: "9876", is_active: false };
  const pending = [
    { plaid_transaction_id: "active-charge", plaid_account_id: activeAccount.id, transaction_date: "2026-07-16", amount: -20, name: "Active charge" },
    { plaid_transaction_id: "inactive-charge", plaid_account_id: inactiveAccount.id, transaction_date: "2026-07-16", amount: -30, name: "Inactive charge" },
  ];

  assert.deepEqual(
    visiblePendingPlaidActivity(pending, [activeAccount, inactiveAccount]).map(row => row.plaid_transaction_id),
    ["active-charge"],
  );
});

test("reconnected accounts show pending activity only from the active link", () => {
  const inactiveOldLink = { ...duplicateAccounts[0], is_active: false };
  const activeNewLink = duplicateAccounts[2];
  const pending = [
    { plaid_transaction_id: "old-link-charge", plaid_account_id: inactiveOldLink.id, transaction_date: "2026-07-16", amount: -51.38, name: "Card payment" },
    { plaid_transaction_id: "new-link-charge", plaid_account_id: activeNewLink.id, transaction_date: "2026-07-16", amount: -51.38, name: "Card payment" },
  ];

  assert.deepEqual(
    visiblePendingPlaidActivity(pending, [inactiveOldLink, activeNewLink]).map(row => row.plaid_transaction_id),
    ["new-link-charge"],
  );
});

test("a pending charge from an older duplicate link follows the canonical checking account", () => {
  const canonicalAccounts = canonicalConnectedAccounts(duplicateAccounts);
  const pending = pendingPlaidActivityWithBalanceHolds([{
    plaid_transaction_id: "pending-old-link",
    plaid_account_id: "account-old",
    transaction_date: "2026-07-16",
    amount: -51.38,
    name: "CAPITAL ONE - MOBILE PMT.",
  }], duplicateAccounts, "2026-07-16");

  assert.equal(pending.length, 1);
  assert.equal(pending[0].plaid_account_id, "account-new");
  assert.equal(summarizePendingCheckingActivity(pending, canonicalAccounts)?.pendingCount, 1);
  assert.equal(summarizePendingCheckingActivity(pending, canonicalAccounts)?.pendingOutflow, 51.38);
});

test("two identical charges from one real account remain two charges", () => {
  const account = duplicateAccounts[2];
  const pending = ["first", "second"].map(id => ({
    plaid_transaction_id: id,
    plaid_account_id: account.id,
    transaction_date: "2026-07-16",
    amount: -51.38,
    name: "CAPITAL ONE - MOBILE PMT.",
  }));
  assert.equal(visiblePendingPlaidActivity(pending, [account]).length, 2);
});

test("identical charges on two different real accounts remain separate", () => {
  const accounts = [
    duplicateAccounts[0],
    { ...duplicateAccounts[0], id: "other-account", persistent_account_id: "other-physical-account", mask: "9876" },
  ];
  const pending = accounts.map((account, index) => ({
    plaid_transaction_id: `pending-${index}`,
    plaid_account_id: account.id,
    transaction_date: "2026-07-16",
    amount: -51.38,
    name: "CAPITAL ONE - MOBILE PMT.",
  }));
  assert.equal(visiblePendingPlaidActivity(pending, accounts).length, 2);
});

test("checking available balance difference creates one inferred pending hold", () => {
  const pending = pendingPlaidActivityWithBalanceHolds([], [{
    id: "checking",
    name: "Bill Account",
    mask: "3673",
    account_type: "depository",
    account_subtype: "checking",
    current_balance: 2119.75,
    available_balance: 2109.76,
    is_active: true,
    updated_at: "2026-07-17T12:00:00Z",
  }], "2026-07-17");

  assert.equal(pending.length, 1);
  assert.equal(pending[0].name, "Pending bank hold");
  assert.equal(pending[0].amount, -9.99);
  assert.equal(pending[0].category, "Pending");
});

test("savings available balance difference is not shown as checking activity", () => {
  const pending = pendingPlaidActivityWithBalanceHolds([], [{
    id: "savings",
    name: "Savings-Sinking Act",
    mask: "0656",
    account_type: "depository",
    account_subtype: "savings",
    current_balance: 297.86,
    available_balance: 292.86,
    is_active: true,
    updated_at: "2026-07-17T12:00:00Z",
  }], "2026-07-17");

  assert.equal(pending.length, 0);
});

test("inferred pending hold is not added when Plaid already supplied the pending row", () => {
  const account = {
    id: "checking",
    name: "Bill Account",
    mask: "3673",
    account_type: "depository",
    account_subtype: "checking",
    current_balance: 2119.75,
    available_balance: 2109.76,
    is_active: true,
    updated_at: "2026-07-17T12:00:00Z",
  };
  const pending = pendingPlaidActivityWithBalanceHolds([{
    plaid_transaction_id: "pending-apple",
    plaid_account_id: account.id,
    transaction_date: "2026-07-17",
    amount: -9.99,
    name: "Apple",
    category: "GENERAL_MERCHANDISE",
  }], [account], "2026-07-17");

  assert.equal(pending.length, 1);
  assert.equal(pending[0].name, "Apple");
});

test("pending checking summary keeps the bank current and available balances separate", () => {
  const summary = summarizePendingCheckingActivity([{
    plaid_transaction_id: "pending-food",
    plaid_account_id: "checking",
    transaction_date: "2026-07-31",
    amount: -42.75,
    name: "Restaurant",
  }], [{
    id: "checking",
    name: "Checking",
    account_type: "depository",
    account_subtype: "checking",
    current_balance: 1000,
    available_balance: 957.25,
    is_active: true,
  }]);

  assert.deepEqual(summary, {
    currentBalance: 1000,
    availableBalance: 957.25,
    pendingOutflow: 42.75,
    pendingInflow: 0,
    pendingCount: 1,
  });
});

test("pending checking summary derives available money only when the bank omits it", () => {
  const summary = summarizePendingCheckingActivity([
    { plaid_transaction_id: "out", plaid_account_id: "checking", transaction_date: "2026-07-31", amount: -25, name: "Fuel" },
    { plaid_transaction_id: "in", plaid_account_id: "checking", transaction_date: "2026-07-31", amount: 10, name: "Refund" },
  ], [{
    id: "checking",
    name: "Checking",
    account_type: "depository",
    account_subtype: "checking",
    current_balance: 1000,
    available_balance: null,
    is_active: true,
  }]);

  assert.equal(summary?.availableBalance, 985);
});

test("pending checking summary never presents an unavailable current balance as zero", () => {
  const summary = summarizePendingCheckingActivity([], [{
    id: "checking",
    name: "Checking",
    account_type: "depository",
    account_subtype: "checking",
    current_balance: 0,
    current_balance_available: false,
    available_balance: null,
    is_active: true,
  }]);

  assert.equal(summary, null);
});

const checkingFixture = (patch: Partial<PlaidAccountIdentityRow> = {}): PlaidAccountIdentityRow => ({
  id: "checking", name: "Checking", account_type: "depository", account_subtype: "checking",
  current_balance: 1000, available_balance: 900, is_active: true, ...patch,
});
const pendingFixture = (id: string, amount: number, accountId = "checking"): PendingPlaidActivityRow => ({
  plaid_transaction_id: id, plaid_account_id: accountId, transaction_date: "2026-07-31", amount, name: id,
});

test("checking holds require exact bank type metadata regardless of the displayed account name", () => {
  for (const patch of [
    { name: "Checking Bill Account", account_subtype: undefined },
    { name: "Checking Bill Account", account_subtype: "money market" },
    { name: "Checking Bill Account", account_subtype: "savings" },
    { name: "Checking Bill Account", account_type: "credit" },
    { name: "Checking Bill Account", account_type: undefined },
  ]) {
    const accounts = [checkingFixture(patch)];
    assert.deepEqual(pendingPlaidActivityWithBalanceHolds([], accounts, "2026-07-31"), []);
    assert.equal(summarizePendingCheckingActivity([], accounts), null);
  }
  const renamedChecking = [checkingFixture({ name: "Savings for bills", official_name: "My savings plan" })];
  const pending = pendingPlaidActivityWithBalanceHolds([], renamedChecking, "2026-07-31");
  assert.deepEqual(pending.map(row => row.amount), [-100]);
  assert.equal(summarizePendingCheckingActivity(pending, renamedChecking)?.currentBalance, 1000);
});

test("several real pending charges cover one bank balance gap without an extra hold", () => {
  const raw = [pendingFixture("fuel", -40), pendingFixture("groceries", -60)];
  const before = JSON.stringify(raw);
  const accounts = [checkingFixture()];
  const pending = pendingPlaidActivityWithBalanceHolds(raw, accounts, "2026-07-31");

  assert.deepEqual(pending.map(row => row.plaid_transaction_id), ["fuel", "groceries"]);
  assert.deepEqual(summarizePendingCheckingActivity(pending, accounts), {
    currentBalance: 1000, availableBalance: 900, pendingOutflow: 100, pendingInflow: 0, pendingCount: 2,
  });
  assert.equal(JSON.stringify(raw), before);
});

test("only the unexplained remainder of a bank hold is inferred", () => {
  const accounts = [checkingFixture()];
  const pending = pendingPlaidActivityWithBalanceHolds([pendingFixture("fuel", -40)], accounts, "2026-07-31");
  assert.deepEqual(pending.map(row => row.amount), [-40, -60]);
  assert.equal(isInferredPendingBankHold(pending[1]), true);
  assert.equal(summarizePendingCheckingActivity(pending, accounts)?.pendingOutflow, 100);
});

test("pending credits do not create a synthetic debit when real charges cover the bank gap", () => {
  for (const debits of [[-100], [-40, -60]]) {
    const accounts = [checkingFixture()];
    const raw = [...debits.map((amount, index) => pendingFixture(`debit-${index}`, amount)), pendingFixture("refund", 50)];
    const pending = pendingPlaidActivityWithBalanceHolds(raw, accounts, "2026-07-31");
    assert.equal(pending.length, raw.length);
    assert.equal(pending.some(isInferredPendingBankHold), false);
    assert.deepEqual(summarizePendingCheckingActivity(pending, accounts), {
      currentBalance: 1000, availableBalance: 900, pendingOutflow: 100, pendingInflow: 50, pendingCount: raw.length,
    });
  }
});

test("real pending charges above the bank gap remain unchanged without an offsetting invented row", () => {
  const raw = [pendingFixture("first", -60), pendingFixture("second", -90)];
  const pending = pendingPlaidActivityWithBalanceHolds(raw, [checkingFixture()], "2026-07-31");
  assert.deepEqual(pending.map(row => [row.plaid_transaction_id, row.amount]), [["first", -60], ["second", -90]]);
});

test("missing or nonfinite available balances never become full-balance holds", () => {
  for (const available of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
    const accounts = [checkingFixture({ available_balance: available })];
    const pending = pendingPlaidActivityWithBalanceHolds([
      pendingFixture("purchase", -25), pendingFixture("refund", 10),
    ], accounts, "2026-07-31");
    assert.equal(pending.length, 2, String(available));
    assert.equal(pending.some(isInferredPendingBankHold), false, String(available));
    assert.equal(summarizePendingCheckingActivity(pending, accounts)?.availableBalance, 985, String(available));
  }
});

test("zero available and negative current balances remain real bank observations", () => {
  for (const [current, available, held] of [[100, 0, 100], [-20, -35, 15]]) {
    const accounts = [checkingFixture({ current_balance: current, available_balance: available })];
    const pending = pendingPlaidActivityWithBalanceHolds([], accounts, "2026-07-31");
    assert.deepEqual(pending.map(row => row.amount), [-held]);
    assert.equal(summarizePendingCheckingActivity(pending, accounts)?.availableBalance, available);
  }
});

test("unknown current balances never produce an inferred hold or numeric checking summary", () => {
  for (const patch of [{ current_balance: null }, { current_balance: undefined }, { current_balance: Number.NaN }, { current_balance: Number.NEGATIVE_INFINITY }, { current_balance_available: false }]) {
    const accounts = [checkingFixture(patch)];
    assert.deepEqual(pendingPlaidActivityWithBalanceHolds([], accounts, "2026-07-31"), []);
    assert.equal(summarizePendingCheckingActivity([], accounts), null);
  }
});

test("each checking account derives missing availability from only its own signed pending activity", () => {
  for (const [refund, available] of [[0, 850], [20, 870]]) {
    const accounts = [checkingFixture({ id: "first", current_balance: 500, available_balance: 450 }),
      checkingFixture({ id: "second", current_balance: 500, available_balance: null })];
    const raw = [pendingFixture("first-purchase", -50, "first"), pendingFixture("second-purchase", -100, "second")];
    if (refund) raw.push(pendingFixture("second-refund", refund, "second"));
    const pending = pendingPlaidActivityWithBalanceHolds(raw, accounts, "2026-07-31");
    const summary = summarizePendingCheckingActivity(pending, accounts);
    assert.equal(pending.some(isInferredPendingBankHold), false);
    assert.equal(summary?.currentBalance, 1000);
    assert.equal(summary?.availableBalance, available);
    assert.equal(summary?.pendingOutflow, 150);
    assert.equal(summary?.pendingInflow, refund);
  }
});

test("same-name checking and bills accounts retain their own gross pending debit gaps alongside savings", () => {
  const accounts = [
    checkingFixture({ id: "checking", plaid_account_id: "provider-checking", name: "Everyday", mask: "1111", current_balance: 1000, available_balance: 900 }),
    checkingFixture({ id: "bills", plaid_account_id: "provider-bills", name: "Everyday", mask: "1111", current_balance: 500, available_balance: 450 }),
    checkingFixture({ id: "savings", plaid_account_id: "provider-savings", name: "Everyday", mask: "1111", account_subtype: "savings", current_balance: 2000, available_balance: 1900 }),
  ];
  const pending = pendingPlaidActivityWithBalanceHolds([
    pendingFixture("checking-charge", -40, "checking"), pendingFixture("bills-charge", -50, "bills"),
    pendingFixture("savings-charge", -70, "savings"), pendingFixture("checking-refund", 25, "checking"),
  ], accounts, "2026-07-31");
  assert.deepEqual(pending.map(row => [row.plaid_transaction_id, row.plaid_account_id, row.amount]), [
    ["checking-charge", "checking", -40], ["bills-charge", "bills", -50], ["savings-charge", "savings", -70],
    ["checking-refund", "checking", 25], ["pending-hold:checking:60.00", "checking", -60],
  ]);
  assert.deepEqual(summarizePendingCheckingActivity(pending, accounts), {
    currentBalance: 1500, availableBalance: 1350, pendingOutflow: 150, pendingInflow: 25, pendingCount: 4,
  });
});

test("accountless pending activity covers a bank gap only for one canonical checking account", () => {
  const raw = [{ ...pendingFixture("unassigned", -100), plaid_account_id: undefined }];
  const one = [checkingFixture()];
  const single = pendingPlaidActivityWithBalanceHolds(raw, one, "2026-07-31");
  assert.equal(single.length, 1);
  assert.equal(summarizePendingCheckingActivity(single, one)?.pendingOutflow, 100);

  const two = [checkingFixture({ id: "first", current_balance: 500, available_balance: 450 }),
    checkingFixture({ id: "second", current_balance: 500, available_balance: 450 })];
  const multiple = pendingPlaidActivityWithBalanceHolds(raw, two, "2026-07-31");
  assert.equal(multiple.filter(isInferredPendingBankHold).length, 2);
  assert.equal(summarizePendingCheckingActivity(multiple, two)?.pendingCount, 2);
  assert.equal(summarizePendingCheckingActivity(multiple, two)?.pendingOutflow, 100);
});

test("pending charges from other account types cannot explain a checking hold", () => {
  const accounts = [checkingFixture(), checkingFixture({ id: "savings", account_subtype: "savings" }),
    checkingFixture({ id: "card", account_type: "credit", account_subtype: "credit card" })];
  const pending = pendingPlaidActivityWithBalanceHolds([
    pendingFixture("savings-purchase", -100, "savings"), pendingFixture("card-purchase", -100, "card"),
  ], accounts, "2026-07-31");
  assert.equal(pending.filter(isInferredPendingBankHold).length, 1);
  assert.equal(summarizePendingCheckingActivity(pending, accounts)?.pendingOutflow, 100);
});

test("reconnected sources remap multiple genuine charges before calculating the remaining hold", () => {
  const accounts = duplicateAccounts.map(account => ({ ...account, current_balance: 1000, available_balance: 900 }));
  const pending = pendingPlaidActivityWithBalanceHolds([
    pendingFixture("first-identical", -50, "account-old"), pendingFixture("second-identical", -50, "account-old"),
  ], accounts, "2026-07-31");
  assert.deepEqual(pending.map(row => [row.plaid_transaction_id, row.plaid_account_id]), [
    ["first-identical", "account-new"], ["second-identical", "account-new"],
  ]);
  assert.equal(summarizePendingCheckingActivity(pending, accounts)?.pendingOutflow, 100);
});

test("balance-derived holds are idempotent and are rebuilt when the bank observation changes", () => {
  const accounts = [checkingFixture()];
  const first = pendingPlaidActivityWithBalanceHolds([pendingFixture("purchase", -40)], accounts, "2026-07-31");
  const before = JSON.stringify(first);
  assert.deepEqual(pendingPlaidActivityWithBalanceHolds(first, accounts, "2026-07-31"), first);
  assert.equal(JSON.stringify(first), before);
  const released = pendingPlaidActivityWithBalanceHolds(first, [checkingFixture({ available_balance: 960 })], "2026-08-01");
  assert.deepEqual(released.map(row => row.plaid_transaction_id), ["purchase"]);
  const increased = pendingPlaidActivityWithBalanceHolds(first, [checkingFixture({ available_balance: 850 })], "2026-08-01");
  assert.deepEqual(increased.map(row => row.amount), [-40, -110]);
  assert.equal(increased[1].transaction_date, "2026-08-01");
});

test("a real provider row named Pending bank hold remains a real debit during normalization", () => {
  for (const name of ["Pending bank hold", "Another description"]) {
    const accounts = [checkingFixture({ available_balance: null })];
    const real = { ...pendingFixture("provider-real-transaction", -25), name, merchant_name: "Pending bank hold" };
    const normalized = pendingPlaidActivityWithBalanceHolds([real], accounts, "2026-07-31");
    assert.equal(normalized.length, 1);
    assert.equal(normalized[0].plaid_transaction_id, real.plaid_transaction_id);
    assert.equal(normalized[0].amount, -25);
    assert.equal(summarizePendingCheckingActivity(normalized, accounts)?.availableBalance, 975);
  }
});

test("cent rounding does not add a residual hold after split decimal charges", () => {
  const accounts = [checkingFixture({ current_balance: 1, available_balance: 0.7 })];
  const pending = pendingPlaidActivityWithBalanceHolds([
    pendingFixture("first", -0.1), pendingFixture("second", -0.2),
  ], accounts, "2026-07-31");
  assert.equal(pending.length, 2);
  assert.equal(summarizePendingCheckingActivity(pending, accounts)?.pendingOutflow, 0.3);
});

test("Flo only calls out real unmatched pending expenses", () => {
  const pending = [
    { plaid_transaction_id: "new-charge", transaction_date: "2026-07-31", amount: -21.43, name: "Drake's" },
    { plaid_transaction_id: "matched-charge", transaction_date: "2026-07-30", amount: -30, name: "Amazon" },
    { plaid_transaction_id: "pending-hold:checking:9.99", transaction_date: "2026-07-31", amount: -9.99, name: "Pending bank hold" },
    { plaid_transaction_id: "refund", transaction_date: "2026-07-31", amount: 12, name: "Refund" },
  ];

  assert.deepEqual(
    unplannedPendingExpenses(pending, ["matched-charge"]).map(row => row.plaid_transaction_id),
    ["new-charge"],
  );
});
