export interface PlaidAccountIdentityRow {
  id: string;
  persistent_account_id?: string | null;
  name?: string | null;
  official_name?: string | null;
  mask?: string | null;
  account_type?: string | null;
  account_subtype?: string | null;
  is_active: boolean;
  updated_at?: string | null;
}

export interface PendingPlaidActivityRow {
  plaid_transaction_id: string;
  plaid_account_id?: string | null;
  transaction_date: string;
  amount: number;
  name: string;
  merchant_name?: string | null;
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
