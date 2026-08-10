export type TransactionDebtReference = {
  linked_bill_id?: string | null;
  debt_applied_bill_id?: string | null;
};

export type DebtRecord = {
  id: string;
  name: string;
  is_debt: boolean;
};

export function transactionDebt(
  transaction: TransactionDebtReference,
  bills: DebtRecord[],
) {
  const linkedDebt = transaction.linked_bill_id
    ? bills.find(
        (bill) => bill.id === transaction.linked_bill_id && bill.is_debt,
      )
    : undefined;
  if (linkedDebt) return linkedDebt;

  return transaction.debt_applied_bill_id
    ? bills.find(
        (bill) => bill.id === transaction.debt_applied_bill_id && bill.is_debt,
      )
    : undefined;
}

export function transactionDebtId(
  transaction: TransactionDebtReference,
  bills: DebtRecord[],
) {
  return transactionDebt(transaction, bills)?.id;
}
