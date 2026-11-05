export interface ManagedBankAccount {
  id: string;
  name: string;
  mask: string;
  type: string;
}

export interface ManagedBankConnection {
  id: string;
  name: string;
  status: string;
  canDisconnect: boolean;
  cleanupNeeded: boolean;
  historyStatus: "importing" | "complete" | null;
  lastSuccessfulSync: string | null;
  accounts: ManagedBankAccount[];
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function label(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 200) : fallback;
}

/** Only safe, scoped status fields reach the bank management view. */
export function parseBankConnections(value: unknown): ManagedBankConnection[] {
  const payload = record(value);
  if (!payload || !Array.isArray(payload.items) || !Array.isArray(payload.accounts)) throw new Error("Could not confirm the bank connection details.");
  const savedAccounts = payload.accounts;
  return payload.items.flatMap(raw => {
    const item = record(raw);
    const id = label(item?.id);
    if (!item || !id || item.status === "removed" && item.disconnect_cleanup_needed !== true) return [];
    const accounts = savedAccounts.flatMap(rawAccount => {
      const account = record(rawAccount);
      if (!account || account.plaid_item_record_id !== id || account.is_active === false) return [];
      const accountId = label(account.id);
      if (!accountId) return [];
      return [{
        id: accountId,
        name: label(account.display_name, label(account.name, "Unnamed account")),
        mask: typeof account.mask === "string" ? account.mask.replace(/\D/g, "").slice(-4) : "",
        type: [label(account.account_type), label(account.account_subtype)].filter(Boolean).join(" · "),
      }];
    });
    return [{
      id,
      name: label(item.institution_name, "Connected bank"),
      status: label(item.status, "unknown"),
      canDisconnect: item.can_disconnect === true,
      cleanupNeeded: item.disconnect_cleanup_needed === true,
      historyStatus: item.initial_import_version === 1 && (item.history_status === "importing" || item.history_status === "complete") ? item.history_status : null,
      lastSuccessfulSync: typeof item.last_successful_sync_at === "string" && Number.isFinite(Date.parse(item.last_successful_sync_at)) ? item.last_successful_sync_at : null,
      accounts,
    }];
  });
}

export function bankConnectionAccountLabel(account: ManagedBankAccount): string {
  return `${account.name}${account.mask ? ` · •••• ${account.mask}` : ""}`;
}

export function bankConnectionConfirmation(connection: ManagedBankConnection): string {
  const names = connection.accounts.map(account => `• ${bankConnectionAccountLabel(account)}`).join("\n");
  return `This unlinks the entire ${connection.name} connection${names ? ` and all of these accounts:\n\n${names}` : ". Account details are not available yet; every account on this bank connection will be unlinked"}.\n\nYour saved transactions, matches, bills, and debts stay in FlowLedger. New bank updates will stop.`;
}

export function bankConnectionStatusLabel(status: string): string {
  if (status === "active") return "Connected";
  if (["error", "needs_reauth", "needs_repair", "login_required", "requires_update", "reauth_required"].includes(status)) return "Needs attention";
  if (["pending", "syncing"].includes(status)) return "Connecting";
  return "Status unavailable";
}

export function bankConnectionSignature(connection: ManagedBankConnection): string {
  return JSON.stringify([connection.id, connection.canDisconnect, connection.accounts.map(account => [account.id, account.name, account.mask])]);
}

export function bankManagementHeaders(accessToken: string, householdId: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}`, "X-FlowLedger-Household-Id": householdId, "Content-Type": "application/json" };
}
