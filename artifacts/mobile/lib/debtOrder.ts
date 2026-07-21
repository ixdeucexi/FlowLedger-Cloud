export interface DebtBalanceItem {
  balance: number;
  name: string;
}

export interface DebtStrategyItem extends DebtBalanceItem {
  id: string;
  interest_rate: number;
  include_in_snowball?: boolean;
}

export function sortDebtsLeastToGreatest<T extends DebtBalanceItem>(debts: readonly T[]): T[] {
  return debts.slice().sort((left, right) =>
    left.balance - right.balance || left.name.localeCompare(right.name),
  );
}

export function orderActiveDebtsForStrategy<T extends DebtStrategyItem>(
  debts: readonly T[],
  method: "snowball" | "avalanche",
): T[] {
  const active = debts.filter(debt => debt.balance > 0.009 && debt.include_in_snowball !== false);
  if (method === "avalanche") {
    return active.slice().sort((left, right) =>
      right.interest_rate - left.interest_rate
      || left.balance - right.balance
      || left.name.localeCompare(right.name),
    );
  }
  return sortDebtsLeastToGreatest(active);
}

export function sortDebtsWithPaidLast<T extends DebtBalanceItem>(debts: readonly T[]): T[] {
  return debts.slice().sort((left, right) => {
    const leftPaid = left.balance <= 0.009;
    const rightPaid = right.balance <= 0.009;
    if (leftPaid !== rightPaid) return leftPaid ? 1 : -1;
    return left.balance - right.balance || left.name.localeCompare(right.name);
  });
}
