import type { Transaction } from "./financialProjectionTypes";
export type TransferMutation = { groupId: string; fromId: string; toId: string; amount: number; date: string; fromAccountId: string; toAccountId: string; fromNote: string; toNote: string; expected: ReturnType<typeof transferExpected>[] | null };
export function transferExpected(t: Transaction) { return { id: t.id, amount: t.amount, date: t.date, account_id: t.account_id ?? null, note: t.note, category: t.category }; }
export function assertUnallocatedEdit(existing: Transaction | undefined, next: Transaction) {
  if (!existing || (existing.amount === next.amount && existing.date === next.date)) return;
  if (existing.transfer_group_id) throw new Error("Edit both sides using the transfer editor.");
  const confirmedLink = (existing.source === "plaid" || Boolean(existing.import_hash) || existing.review_status === "matched")
    && (existing.linked_bill_id || existing.debt_applied_bill_id || Math.abs(existing.debt_applied_amount ?? 0) > 0.005);
  if (confirmedLink || existing.linked_income_id || existing.linked_plan_id
    || (existing.review_resolution && !["category", "transfer"].includes(existing.review_resolution))
    || existing.review_allocations?.some(a => a.type !== "category" && a.type !== "transfer")) {
    throw new Error("Undo this transaction's match before changing its amount or date. Its payment and allocation will stay consistent.");
  }
}
