export interface PlaidAccountIdentityRow {
  id: string;
  persistent_account_id?: string | null;
  name?: string | null;
  official_name?: string | null;
  mask?: string | null;
  account_type?: string | null;
  account_subtype?: string | null;
  current_balance?: number | null;
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

function normalizedText(value: string | null | undefined): string {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
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
  if (!activeAccounts.length) return pendingRows;

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

function hasMatchingPendingAmount(pendingRows: PendingPlaidActivityRow[], accountId: string, amount: number): boolean {
  return pendingRows.some(row =>
    row.plaid_account_id === accountId &&
    Math.abs(roundCurrency(Number(row.amount || 0)) - amount) < 0.005
  );
}

export function pendingPlaidActivityWithBalanceHolds<
  T extends PendingPlaidActivityRow,
  A extends PlaidAccountIdentityRow,
>(pendingRows: T[], accounts: A[], today: string): Array<PendingPlaidActivityRow & { category: string }> {
  const visibleRows = visiblePendingPlaidActivity(pendingRows, accounts)
    .map(row => ({
      ...row,
      plaid_account_id: row.plaid_account_id || undefined,
      category: String(row.category || "Pending"),
    }));
  const inferredRows = canonicalConnectedAccounts(accounts)
    .filter(isCheckingAccount)
    .flatMap(account => {
      const current = Number(account.current_balance);
      const available = Number(account.available_balance);
      if (!Number.isFinite(current) || !Number.isFinite(available)) return [];
      const hold = roundCurrency(current - available);
      if (hold <= 0.005) return [];
      const amount = -hold;
      if (hasMatchingPendingAmount(visibleRows, account.id, amount)) return [];
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
