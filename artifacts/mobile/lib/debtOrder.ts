export interface DebtBalanceItem {
  balance: number;
  name: string;
}

export function sortDebtsLeastToGreatest<T extends DebtBalanceItem>(debts: readonly T[]): T[] {
  return debts.slice().sort((left, right) =>
    left.balance - right.balance || left.name.localeCompare(right.name),
  );
}
