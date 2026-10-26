import { confirmedBillMatchId } from "./billMatching";
import { transactionDisplayName, type TransactionDisplayNameInput } from "./reviewCenter";

type NamedPlan = { id: string; name: string };
export type NamedTransaction = TransactionDisplayNameInput & {
  linked_bill_id?: string | null;
  linked_income_id?: string | null;
  review_status?: string;
};

/** Build once for a transaction list so current saved plan names take constant
 * lookup work per row. Only explicit confirmed matches may name a transaction. */
export function createTransactionNameResolver(bills: readonly NamedPlan[], incomes: readonly NamedPlan[] = []) {
  const billNames = new Map(bills.map(bill => [bill.id, bill.name]));
  const incomeNames = new Map(incomes.map(income => [income.id, income.name]));
  return (transaction: NamedTransaction): string => {
    let plannedLabel: string | undefined;
    const billId = confirmedBillMatchId(transaction);
    if (billId) {
      plannedLabel = billNames.get(billId)?.trim()
        || transaction.review_allocations?.find(allocation => allocation?.type === "bill" && allocation.targetId === billId && typeof allocation.name === "string" && allocation.name.trim())?.name?.trim();
    } else if (transaction.match_reason === "confirmed_income_match" && transaction.review_status === "matched" && transaction.review_resolution === "income") {
      const allocation = transaction.review_allocations?.find(item => item?.type === "income" && item.targetId);
      const incomeId = transaction.linked_income_id || allocation?.targetId;
      if (incomeId) plannedLabel = incomeNames.get(incomeId)?.trim()
        || transaction.review_allocations?.find(item => item?.type === "income" && item.targetId === incomeId && typeof item.name === "string" && item.name.trim())?.name?.trim();
    }
    return transactionDisplayName(transaction, plannedLabel);
  };
}
