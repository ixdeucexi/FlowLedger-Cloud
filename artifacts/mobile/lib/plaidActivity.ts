export interface PlaidAccountIdentityRow {
  id: string;
  plaid_account_id?: string | null;
  persistent_account_id?: string | null;
  name?: string | null;
  official_name?: string | null;
  mask?: string | null;
  account_type?: string | null;
  account_subtype?: string | null;
  current_balance?: number | null;
  current_balance_available?: boolean;
  available_balance?: number | null;
  is_active: boolean;
  updated_at?: string | null;
}

export interface PendingPlaidActivityRow {
  plaid_transaction_id: string;
  plaid_account_id?: string;
  transaction_date: string;
  amount: number;
  name: string;
  merchant_name?: string;
  category?: string | null;
}

export interface PendingCheckingSummary {
  currentBalance: number;
  availableBalance: number;
  pendingOutflow: number;
  pendingInflow: number;
  pendingCount: number;
}

function normalizedText(value: string | null | undefined): string {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** Balance-derived placeholders have no bank transaction to match or replace. */
export function isInferredPendingBankHold(row: {
  plaid_transaction_id: string;
  name?: string | null;
  merchant_name?: string | null;
}): boolean {
  return row.plaid_transaction_id.startsWith("pending-hold:")
    || normalizedText(row.merchant_name || row.name) === "pending bank hold";
}

export function plaidAccountIdentity(account: PlaidAccountIdentityRow): string {
  const persistentId = normalizedText(account.persistent_account_id);
  if (persistentId) return `persistent:${persistentId}`;

  const mask = normalizedText(account.mask);
  if (!mask) return `row:${account.id}`;
  const name = normalizedText(account.official_name || account.name);
  return ["fallback", mask, normalizedText(account.account_type), normalizedText(account.account_subtype), name].join(":");
}

function isNewerAccount(candidate: PlaidAccountIdentityRow, current: PlaidAccountIdentityRow): boolean {
  return String(candidate.updated_at || "") > String(current.updated_at || "");
}

export function canonicalConnectedAccounts<T extends PlaidAccountIdentityRow>(accounts: T[]): T[] {
  const canonical = new Map<string, T>();
  for (const account of accounts) {
    if (!account.is_active) continue;
    const key = plaidAccountIdentity(account);
    const current = canonical.get(key);
    if (!current || isNewerAccount(account, current)) canonical.set(key, account);
  }
  return [...canonical.values()];
}

export function visiblePendingPlaidActivity<
  T extends PendingPlaidActivityRow,
  A extends PlaidAccountIdentityRow,
>(pendingRows: T[], accounts: A[]): T[] {
  const activeAccounts = accounts.filter(account => account.is_active);
  const accountIdentityById = new Map(activeAccounts.map(account => [account.id, plaidAccountIdentity(account)]));

  // Pick one source account per real-account identity. Filtering by source
  // account (rather than amount/merchant) keeps two genuine identical charges
  // while removing the copies created by reconnecting the same bank account.
  const accountsWithPending = new Set(pendingRows.map(row => row.plaid_account_id).filter(Boolean));
  const canonicalSources = canonicalConnectedAccounts(activeAccounts.filter(account => accountsWithPending.has(account.id)));
  const sourceAccountByIdentity = new Map(canonicalSources.map(account => [plaidAccountIdentity(account), account.id]));

  return pendingRows.filter(pending => {
    const accountId = pending.plaid_account_id || "";
    if (!accountId) return true;
    const identity = accountIdentityById.get(accountId);
    if (!identity) return false;
    return sourceAccountByIdentity.get(identity) === accountId;
  });
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function isCheckingAccount(account: PlaidAccountIdentityRow): boolean {
  const type = normalizedText(account.account_type);
  const subtype = normalizedText(account.account_subtype);
  const name = normalizedText(`${account.name || ""} ${account.official_name || ""}`);
  if (subtype === "savings" || name.includes("savings")) return false;
  return type === "depository" && (subtype === "checking" || name.includes("checking") || name.includes("bill account"));
}

function pendingRowsForCheckingAccount<T extends PendingPlaidActivityRow>(
  pendingRows: T[],
  accountId: string,
  onlyCheckingAccount: boolean,
): T[] {
  return pendingRows.filter(row => row.plaid_account_id
    ? row.plaid_account_id === accountId
    : onlyCheckingAccount);
}

export function summarizePendingCheckingActivity<
  T extends PendingPlaidActivityRow,
  A extends PlaidAccountIdentityRow,
>(pendingRows: T[], accounts: A[]): PendingCheckingSummary | null {
  const checkingAccounts = canonicalConnectedAccounts(accounts).filter(isCheckingAccount);
  if (!checkingAccounts.length) return null;
  if (checkingAccounts.some(account => (
    account.current_balance_available === false
    || account.current_balance == null
    || !Number.isFinite(Number(account.current_balance))
  ))) return null;

  const checkingIds = new Set(checkingAccounts.map(account => account.id));
  const checkingPending = pendingRows.filter(row => {
    if (row.plaid_account_id) return checkingIds.has(row.plaid_account_id);
    return checkingAccounts.length === 1;
  });
  const currentBalance = roundCurrency(checkingAccounts.reduce(
    (sum, account) => sum + Number(account.current_balance || 0),
    0,
  ));
  const pendingOutflow = roundCurrency(checkingPending
    .filter(row => Number(row.amount) < 0)
    .reduce((sum, row) => sum + Math.abs(Number(row.amount) || 0), 0));
  const pendingInflow = roundCurrency(checkingPending
    .filter(row => Number(row.amount) > 0)
    .reduce((sum, row) => sum + Number(row.amount || 0), 0));
  const availableBalance = roundCurrency(checkingAccounts.reduce((sum, account) => {
    const available = account.available_balance == null ? Number.NaN : Number(account.available_balance);
    if (Number.isFinite(available)) return sum + available;
    const accountPending = pendingRowsForCheckingAccount(pendingRows, account.id, checkingAccounts.length === 1);
    return sum + Number(account.current_balance) + accountPending.reduce(
      (net, row) => net + Number(row.amount || 0),
      0,
    );
  }, 0));

  return {
    currentBalance,
    availableBalance,
    pendingOutflow,
    pendingInflow,
    pendingCount: checkingPending.length,
  };
}

export function unplannedPendingExpenses<T extends PendingPlaidActivityRow>(
  pendingRows: T[],
  matchedPendingIds: Iterable<string>,
): T[] {
  const matchedIds = new Set(matchedPendingIds);
  return pendingRows
    .filter(row => Number(row.amount) < 0)
    .filter(row => !matchedIds.has(row.plaid_transaction_id))
    .filter(row => !isInferredPendingBankHold(row))
    .sort((left, right) =>
      right.transaction_date.localeCompare(left.transaction_date)
      || left.plaid_transaction_id.localeCompare(right.plaid_transaction_id)
    );
}

export function pendingPlaidActivityWithBalanceHolds<
  T extends PendingPlaidActivityRow,
  A extends PlaidAccountIdentityRow,
>(pendingRows: T[], accounts: A[], today: string): Array<PendingPlaidActivityRow & { category: string }> {
  const canonicalAccounts = canonicalConnectedAccounts(accounts);
  const checkingAccounts = canonicalAccounts.filter(isCheckingAccount);
  const accountIdentityById = new Map(
    accounts.filter(account => account.is_active).map(account => [account.id, plaidAccountIdentity(account)]),
  );
  const canonicalAccountIdByIdentity = new Map(
    canonicalAccounts.map(account => [plaidAccountIdentity(account), account.id]),
  );
  // Rebuild app-created placeholders for this snapshot. A provider row's name
  // is not an identifier and must never cause a real charge to disappear.
  const realPendingRows = pendingRows.filter(row => !row.plaid_transaction_id.startsWith("pending-hold:"));
  const visibleRows = visiblePendingPlaidActivity(realPendingRows, accounts)
    .map(row => {
      const identity = row.plaid_account_id ? accountIdentityById.get(row.plaid_account_id) : undefined;
      return {
        ...row,
        plaid_account_id: identity
          ? canonicalAccountIdByIdentity.get(identity)
          : row.plaid_account_id || undefined,
        category: String(row.category || "Pending"),
      };
    });
  const inferredRows = checkingAccounts
    .flatMap(account => {
      if (account.current_balance_available === false || account.current_balance == null || account.available_balance == null) return [];
      const current = Number(account.current_balance);
      const available = Number(account.available_balance);
      if (!Number.isFinite(current) || !Number.isFinite(available)) return [];
      const knownOutflow = pendingRowsForCheckingAccount(visibleRows, account.id, checkingAccounts.length === 1)
        .filter(row => Number(row.amount) < 0)
        .reduce((sum, row) => sum + Math.abs(Number(row.amount)), 0);
      // Pending credits may not be cleared into the bank's available balance.
      // Cover only the part of its debit hold that no real charge explains.
      const hold = roundCurrency(current - available - knownOutflow);
      if (hold <= 0.005) return [];
      const amount = -hold;
      return [{
        plaid_transaction_id: `pending-hold:${account.id}:${hold.toFixed(2)}`,
        plaid_account_id: account.id,
        transaction_date: today,
        amount,
        name: "Pending bank hold",
        merchant_name: undefined,
        category: "Pending",
      }];
    });
  return [...visibleRows, ...inferredRows];
}
