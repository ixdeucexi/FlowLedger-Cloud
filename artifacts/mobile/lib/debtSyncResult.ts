export interface DebtSyncResult {
  changed: boolean;
  changed_transaction_ids: string[];
  changed_bill_ids: string[];
}

export function debtSyncRequiresRefresh(value: unknown): boolean {
  if (!value || typeof value !== "object") return true;
  const result = value as {
    changed?: unknown;
    changed_transaction_ids?: unknown;
    changed_bill_ids?: unknown;
  };
  return !(
    result.changed === false
    && Array.isArray(result.changed_transaction_ids)
    && result.changed_transaction_ids.length === 0
    && Array.isArray(result.changed_bill_ids)
    && result.changed_bill_ids.length === 0
  );
}
