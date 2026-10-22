import type { RankedBillMatch } from "./billMatching";

export type PendingMatchKind = "bill" | "debt" | "manual";
export const pendingMatchKindLabels: Record<PendingMatchKind, string> = {
  bill: "Bill", debt: "Debt", manual: "Manual transaction",
};

/** Keep canonical eligibility and ranking; this only separates display types. */
export function pendingMatchesForKind(
  kind: PendingMatchKind | null,
  billOptions: readonly RankedBillMatch[],
  manualOptions: readonly RankedBillMatch[],
  bills: readonly { id: string; is_debt?: boolean | null }[],
) {
  if (!kind) return [];
  if (kind === "manual") return manualOptions.map(option => ({ ...option, targetType: "manual" as const }));
  const currentBills = new Map(bills.map(bill => [bill.id, bill]));
  return billOptions.filter(option => {
    const bill = currentBills.get(option.billId);
    return bill && Boolean(bill.is_debt) === (kind === "debt");
  }).map(option => ({ ...option, targetType: "bill" as const }));
}
